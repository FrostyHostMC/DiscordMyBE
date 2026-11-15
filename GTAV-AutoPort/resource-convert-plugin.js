import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_BYTES = 64 * 1024 * 1024;
const ALLOWED = new Set([".yft", ".ytd", ".ydr", ".ydd", ".ybn"]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function findRk() {
  const configured = process.env.GTAV_AUTOPORT_RK;
  if (configured) return configured;
  for (const candidate of ["build/ragekit/Release/rk.exe", "build/ragekit/rk.exe", "build/ragekit/Release/rk", "build/ragekit/rk"]) if (existsSync(path.resolve(candidate))) return path.resolve(candidate);
  return null;
}
function run(executable, args, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; if (Buffer.byteLength(stdout) > 8 * 1024 * 1024) child.kill(); });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; if (Buffer.byteLength(stderr) > 8 * 1024 * 1024) child.kill(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); if (timedOut) return reject(new Error("RageKit conversion timed out.")); if (code !== 0) return reject(new Error(stderr.trim() || stdout.trim() || "RageKit conversion failed.")); resolve({ stdout, stderr }); });
  });
}
export function buildLegacyConvertArgs(input, output) { return ["convert", input, output, "--legacy"]; }

export function resourceConvertPlugin() {
  return { name: "gtav-autoport-resource-convert", configureServer(server) {
    server.middlewares.use("/__autoport/convert-legacy-resource", async (req, res) => {
      if (req.method !== "POST") { res.statusCode = 405; res.end("POST required"); return; }
      let temp;
      try {
        const executable = findRk();
        if (!executable) throw new Error("RageKit is not configured. Run START-AUTOPORT.bat and confirm the native engine build.");
        if (!(await stat(executable)).isFile()) throw new Error("GTAV_AUTOPORT_RK does not point to a file.");
        const chunks = []; let requestBytes = 0;
        for await (const chunk of req) { requestBytes += chunk.length; if (requestBytes > MAX_BYTES * 1.4) throw new Error("Resource conversion request exceeds 64 MiB."); chunks.push(chunk); }
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (typeof payload.name !== "string" || !ALLOWED.has(path.extname(payload.name).toLowerCase())) throw new Error("Only YFT, YTD, YDR, YDD and YBN resources can use this Legacy writer route.");
        const inputBytes = Buffer.from(payload.data || "", "base64");
        if (!inputBytes.length || inputBytes.length > MAX_BYTES) throw new Error("Input resource is empty or exceeds 64 MiB.");
        temp = await mkdtemp(path.join(os.tmpdir(), "gtav-autoport-legacy-"));
        const ext = path.extname(payload.name).toLowerCase();
        const input = path.join(temp, "source" + ext);
        const output = path.join(temp, "legacy-candidate" + ext);
        const roundtrip = path.join(temp, "roundtrip" + ext);
        await writeFile(input, inputBytes);
        await run(executable, buildLegacyConvertArgs(input, output));
        const outputBytes = await readFile(output);
        if (!outputBytes.length || outputBytes.length > MAX_BYTES) throw new Error("Converted output is empty or exceeds 64 MiB.");
        const info = await run(executable, ["info", output, "-v"]);
        await run(executable, ["roundtrip", output, roundtrip]);
        const roundtripBytes = await readFile(roundtrip);
        const result = {
          sourceName: path.basename(payload.name), sourceBytes: inputBytes.length, sourceSha256: sha(inputBytes),
          outputName: path.basename(payload.name), outputBytes: outputBytes.length, outputSha256: sha(outputBytes),
          outputBase64: outputBytes.toString("base64"),
          roundtripVerified: sha(outputBytes) === sha(roundtripBytes),
          info: info.stdout.slice(0, 16000),
          sourceEdition: "auto-detected-by-RageKit", targetEdition: "GTA V PC Legacy resource format",
          ps4Compatibility: "unverified", installable: false,
          warnings: ["This is a GTA V PC Legacy-format candidate, not a certified PS4 resource.", "CUSA00419 update 1.73 resource layout, streaming references and console runtime behavior still require validation."]
        };
        res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(result));
      } catch (error) { res.statusCode = 400; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: error.message || "Resource conversion failed." })); }
      finally { if (temp) await rm(temp, { recursive: true, force: true }); }
    });
  } };
}
