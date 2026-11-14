const MAX_COMPRESSED_BYTES = 160 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 5000;

function encodeBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) throw new Error("The extracted archive returned an invalid path.");
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Unsafe extracted path rejected: " + value);
  }
  return normalized;
}

export async function inspect7zArchive(file) {
  if (!file || !/\.7z$/i.test(file.name || "")) throw new Error("Choose a .7z archive.");
  if (!file.size || file.size > MAX_COMPRESSED_BYTES) throw new Error("7z archive must be between 1 byte and 160 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const response = await fetch("/__autoport/extract-7z", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, data: encodeBase64(bytes) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Local 7z extraction failed.");
  if (!Array.isArray(result.files) || !result.files.length || result.files.length > MAX_ENTRIES) throw new Error("The extracted archive returned an invalid file inventory.");
  const seen = new Set();
  let total = 0;
  const files = result.files.map((item) => {
    const path = safePath(item.path);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate extracted path: " + path);
    seen.add(key);
    const data = decodeBase64(item.data || "");
    total += data.byteLength;
    if (total > MAX_EXTRACTED_BYTES || data.byteLength !== item.size) throw new Error("Extracted archive exceeded safety limits or returned inconsistent file data.");
    const basename = path.split("/").at(-1);
    const dot = basename.lastIndexOf(".");
    return { path, bytes: data, size: data.byteLength, extension: dot > 0 ? basename.slice(dot).toLowerCase() : "" };
  });
  return {
    sourceName: result.sourceName || file.name,
    containerFormat: "7z",
    files,
    inventory: files.map(({ path, size, extension }) => ({ path, size, extension })),
    totalBytes: total,
  };
}
