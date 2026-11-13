import JSZip from "jszip";

const MAX_ENTRIES = 5000;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const REQUIRED_EXTENSIONS = [".yft", ".ytd", ".meta"];

function safeArchivePath(entry) {
  const original = entry.unsafeOriginalName || entry.name;
  if (!original || original.startsWith("/") || original.startsWith("\\\\") || /^[a-zA-Z]:/.test(original)) {
    throw new Error(`Unsafe absolute archive path: ${original}`);
  }
  const normalized = original.replace(/\\\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((part) => part === ".." || part === ".")) {
    throw new Error(`Unsafe traversal path in archive: ${original}`);
  }
  if (entry.dir) return normalized.endsWith("/") ? normalized : `${normalized}/`;
  return normalized;
}

export async function inspectZipArchive(file) {
  if (!file || !file.name.toLowerCase().endsWith(".zip")) {
    throw new Error("For this build, import a ZIP archive. Folder and RAR/7z intake are not available yet.");
  }
  const zip = await JSZip.loadAsync(file, { checkCRC32: true, createFolders: false });
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_ENTRIES) throw new Error(`Archive has too many files (limit ${MAX_ENTRIES}).`);

  const seen = new Set();
  let declaredTotal = 0;
  for (const entry of Object.values(zip.files)) {
    const path = safeArchivePath(entry);
    if (entry.dir) continue;
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate archive path (case-insensitive): ${path}`);
    seen.add(key);
    const unixMode = typeof entry.unixPermissions === "number" ? entry.unixPermissions : 0;
    if ((unixMode & 0o170000) === 0o120000) throw new Error(`Symbolic links are not accepted: ${path}`);
    const size = entry._data?.uncompressedSize ?? 0;
    declaredTotal += size;
    if (declaredTotal > MAX_UNCOMPRESSED_BYTES) {
      throw new Error("Archive exceeds the 512 MiB uncompressed safety limit.");
    }
  }

  const files = [];
  for (const entry of entries) {
    const path = safeArchivePath(entry);
    const bytes = await entry.async("uint8array");
    files.push({ path, bytes, size: bytes.byteLength, extension: path.includes(".") ? path.slice(path.lastIndexOf(".")).toLowerCase() : "" });
  }
  return {
    sourceName: file.name,
    files,
    inventory: files.map(({ path, size, extension }) => ({ path, size, extension })),
    totalBytes: files.reduce((sum, item) => sum + item.size, 0),
    supportedFileTypes: REQUIRED_EXTENSIONS,
  };
}

export function findByBasename(files, basename) {
  const expected = basename.toLowerCase();
  return files.find((file) => file.path.split("/").at(-1).toLowerCase() === expected);
}

export function classifyVehicleAssets(files, modelName) {
  const model = modelName.trim().toLowerCase();
  const expected = [`${model}.yft`, `${model}_hi.yft`, `${model}.ytd`];
  return expected.map((name) => {
    const file = findByBasename(files, name);
    return { name, present: Boolean(file), size: file?.size ?? 0, signature: file ? signature(file.bytes) : "missing" };
  });
}

function signature(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x53 && bytes[2] === 0x43 && bytes[3] === 0x37) return "RSC7 resource container (platform/build not validated)";
  return "Unknown or non-RSC7 signature";
}
