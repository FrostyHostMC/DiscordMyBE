import JSZip from "jszip";

const MAX_ENTRIES = 5000;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

function normalizeRelativePath(rawPath) {
  if (typeof rawPath !== "string" || rawPath.length === 0 || rawPath.includes("\0")) {
    throw new Error("An imported file has an invalid path.");
  }
  const normalized = rawPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Absolute paths are not accepted: ${rawPath}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === ".")) {
    throw new Error(`Path traversal is not accepted: ${rawPath}`);
  }
  if (parts.some((part) => part === "")) {
    throw new Error(`Malformed path is not accepted: ${rawPath}`);
  }
  return normalized;
}

function extensionOf(path) {
  const basename = path.split("/").at(-1);
  const dot = basename.lastIndexOf(".");
  return dot > 0 ? basename.slice(dot).toLowerCase() : "";
}

function validateInventoryPaths(paths) {
  if (paths.length > MAX_ENTRIES) throw new Error(`Import contains too many files (limit ${MAX_ENTRIES}).`);
  const seen = new Set();
  for (const path of paths) {
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate path (case-insensitive): ${path}`);
    seen.add(key);
  }
}

function summarize(sourceName, files) {
  return {
    sourceName,
    files,
    inventory: files.map(({ path, size, extension }) => ({ path, size, extension })),
    totalBytes: files.reduce((sum, item) => sum + item.size, 0),
  };
}

export async function inspectZipArchive(file) {
  if (!file || !file.name?.toLowerCase().endsWith(".zip")) {
    throw new Error("Choose a ZIP archive. RAR and 7z support is not available in this build.");
  }
  const zip = await JSZip.loadAsync(file, { checkCRC32: true, createFolders: false });
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  validateInventoryPaths(entries.map((entry) => normalizeRelativePath(entry.unsafeOriginalName || entry.name)));

  let declaredTotal = 0;
  for (const entry of entries) {
    const mode = typeof entry.unixPermissions === "number" ? entry.unixPermissions : 0;
    if ((mode & 0o170000) === 0o120000) {
      throw new Error(`Symbolic links are not accepted: ${entry.name}`);
    }
    const declaredSize = entry._data?.uncompressedSize;
    if (!Number.isFinite(declaredSize)) {
      throw new Error(`Could not verify the uncompressed size of ${entry.name}; import was stopped safely.`);
    }
    declaredTotal += declaredSize;
    if (declaredTotal > MAX_UNCOMPRESSED_BYTES) {
      throw new Error("Archive exceeds the 512 MiB uncompressed safety limit.");
    }
  }

  const files = [];
  let actualTotal = 0;
  for (const entry of entries) {
    const path = normalizeRelativePath(entry.unsafeOriginalName || entry.name);
    const bytes = await entry.async("uint8array");
    actualTotal += bytes.byteLength;
    if (actualTotal > MAX_UNCOMPRESSED_BYTES) {
      throw new Error("Extracted data exceeded the 512 MiB safety limit.");
    }
    files.push({ path, bytes, size: bytes.byteLength, extension: extensionOf(path) });
  }
  return summarize(file.name, files);
}

export async function inspectFolderFiles(fileList) {
  const selected = Array.from(fileList || []);
  if (!selected.length) throw new Error("Choose a folder containing mod files.");
  if (selected.length > MAX_ENTRIES) throw new Error(`Folder contains too many files (limit ${MAX_ENTRIES}).`);

  const firstPath = selected[0].webkitRelativePath || selected[0].name;
  const rootName = firstPath.includes("/") ? firstPath.split("/")[0] : "Imported folder";
  const prepared = selected.map((file) => {
    const relative = file.webkitRelativePath || file.name;
    const stripped = relative.includes("/") ? relative.slice(relative.indexOf("/") + 1) : relative;
    return { file, path: normalizeRelativePath(stripped) };
  });
  validateInventoryPaths(prepared.map((item) => item.path));

  const declaredTotal = selected.reduce((sum, file) => sum + file.size, 0);
  if (declaredTotal > MAX_UNCOMPRESSED_BYTES) {
    throw new Error("Folder exceeds the 512 MiB import safety limit.");
  }

  const files = [];
  let actualTotal = 0;
  for (const item of prepared) {
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    actualTotal += bytes.byteLength;
    if (actualTotal > MAX_UNCOMPRESSED_BYTES) {
      throw new Error("Read folder data exceeded the 512 MiB safety limit.");
    }
    files.push({ path: item.path, bytes, size: bytes.byteLength, extension: extensionOf(item.path) });
  }
  return summarize(rootName, files);
}

export function findByBasename(files, basename) {
  const expected = basename.toLowerCase();
  const matches = files.filter((file) => file.path.split("/").at(-1).toLowerCase() === expected);
  if (matches.length > 1) {
    throw new Error(`Found multiple files named "${basename}". Keep one matching metadata file or separate the mod before analysis.`);
  }
  return matches[0] ?? null;
}

export function classifyVehicleAssets(files, modelName) {
  const model = modelName.trim().toLowerCase();
  const expected = [`${model}.yft`, `${model}_hi.yft`, `${model}.ytd`];
  return expected.map((name) => {
    const matches = files.filter((file) => file.path.split("/").at(-1).toLowerCase() === name);
    if (matches.length > 1) {
      return { name, present: true, ambiguous: true, size: matches.reduce((sum, file) => sum + file.size, 0), signature: "Multiple matching files found" };
    }
    const file = matches[0];
    return { name, present: Boolean(file), ambiguous: false, size: file?.size ?? 0, bytes: file?.bytes, path: file?.path, signature: file ? "Awaiting resource inspection" : "missing" };
  });
}
