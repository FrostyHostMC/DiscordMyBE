import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, lstat, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sevenZip from "7zip-bin";

const { path7za } = sevenZip;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT_LIMIT = 160 * 1024 * 1024;
const OUTPUT_LIMIT = 512 * 1024 * 1024;
const ENTRY_LIMIT = 5000;
const TIMEOUT_MS = 120_000;

function run(args, timeout = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(path7za, args, { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) { settled = true; reject(new Error("7-Zip exceeded the 2-minute processing limit.")); }
    }, timeout);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; if (stdout.length > 8 * 1024 * 1024) child.kill(); });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; if (stderr.length > 2 * 1024 * 1024) child.kill(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(new Error(error.code === "ENOENT" ? "The bundled 7-Zip executable could not be found. Reinstall AutoPort dependencies." : error.message)); }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || stdout.trim() || \`7-Zip exited with code \${code}.\`));
    });
  });
}

function safeRelativePath(value) {
  if (!value || value.includes("\0")) throw new Error("The 7z archive contains an invalid file path.");
  const normalized = value.replace(/\\/g, "/").replace(/\/$/, "");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) throw new Error(\`Absolute archive path rejected: \${value}\`);
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(\`Unsafe archive path rejected: \${value}\`);
  return normalized;
}

function parseListing(text) {
  const records = text.split(/\r?\n\s*\r?\n/).map((block) => {
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      const index = line.indexOf(" = ");
      if (index > 0) fields[line.slice(0, index)] = line.slice(index + 3);
    }
    return fields;
  }).filter((entry) => entry.Path && (entry.Size !== undefined || entry.Folder === "+"));
  if (records.length > ENTRY_LIMIT) throw new Error(\`Archive contains too many entries (limit \${ENTRY_LIMIT}).\`);
  const seen = new Set();
  let declaredTotal = 0;
  for (const entry of records) {
    const relative = safeRelativePath(entry.Path);
    if (entry["Symbolic Link"] || entry["Hard Link"]) throw new Error(\`Links are not accepted in 7z archives: \${relative}\`);
    if (entry.Encrypted === "+") throw new Error(\`Encrypted 7z entry cannot be inspected without a password: \${relative}\`);
    if (entry.Folder !== "+") {
      const size = Number(entry.Size);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error(\`Could not verify the uncompressed size of \${relative}.\`);
      declaredTotal += size;
      if (declaredTotal > OUTPUT_LIMIT) throw new Error("Archive exceeds the 512 MiB uncompressed safety limit.");
      const key = relative.toLowerCase();
      if (seen.has(key)) throw new Error(\`Duplicate archive path (case-insensitive): \${relative}\`);
      seen.add(key);
    }
  }
  return records;
}

async function collectFiles(directory) {
  const output = [];
  let total = 0;
  async function walk(current, relative) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const childRelative = relative ? \`\${relative}/\${entry.name}\` : entry.name;
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error(\`Unsupported extracted filesystem entry: \${childRelative}\`);
      if (info.isDirectory()) await walk(absolute, childRelative);
      else {
        const safePath = safeRelativePath(childRelative);
        total += info.size;
        if (output.length >= ENTRY_LIMIT || total > OUTPUT_LIMIT) throw new Error("Extracted archive exceeds the file-count or 512 MiB safety limit.");
        const bytes = await readFile(absolute);
        output.push({ path: safePath, size: bytes.length, data: bytes.toString("base64") });
      }
    }
  }
  await walk(directory, "");
  return output;
}

export function sevenZipPlugin() {
  return {
    name: "gtav-autoport-sevenzip",
    configureServer(server) {
      server.middlewares.use("/__autoport/extract-7z", async (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end("POST required"); return; }
        let temp;
        try {
          const chunks = [];
          let requestBytes = 0;
          for await (const chunk of req) {
            requestBytes += chunk.length;
            if (requestBytes > INPUT_LIMIT * 1.4) throw new Error("7z upload exceeds the 160 MiB compressed-input limit.");
            chunks.push(chunk);
          }
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (typeof payload.name !== "string" || !/\.7z$/i.test(payload.name)) throw new Error("Choose a .7z archive.");
          const archiveBytes = Buffer.from(payload.data || "", "base64");
          if (!archiveBytes.length || archiveBytes.length > INPUT_LIMIT) throw new Error("7z archive must be between 1 byte and 160 MiB.");
          temp = await mkdtemp(path.join(os.tmpdir(), "gtav-autoport-7z-"));
          const archivePath = path.join(temp, "source.7z");
          const outputPath = path.join(temp, "extracted");
          await mkdir(outputPath);
          await writeFile(archivePath, archiveBytes);
          const listing = await run(["l", "-slt", "-ba", archivePath]);
          const entries = parseListing(listing);
          if (!entries.some((entry) => entry.Folder !== "+")) throw new Error("The 7z archive contains no files.");
          await run(["x", "-y", "-bd", "-bb0", \`-o\${outputPath}\`, archivePath]);
          const files = await collectFiles(outputPath);
          if (!files.length) throw new Error("7-Zip completed but no files were extracted.");
          const listedFiles = entries.filter((entry) => entry.Folder !== "+").length;
          if (files.length !== listedFiles) throw new Error("Extracted file count did not match the archive listing; import was stopped.");
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ sourceName: path.basename(payload.name), files }));
        } catch (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: error.message || "7z extraction failed." }));
        } finally {
          if (temp) await rm(temp, { recursive: true, force: true });
        }
      });
    },
  };
}
