const RPF7_MAGIC = 0x52504637;
const RPF_OPEN = 0x4e45504f;
const DIRECTORY_IDENT = 0x7fffff00;
const BLOCK_SIZE = 512;

function fail(message) {
  throw new Error("Invalid RPF7 OPEN archive: " + message);
}

function readName(bytes, namesStart, namesLength, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= namesLength) fail("name offset is outside the name table.");
  const start = namesStart + offset;
  const endLimit = namesStart + namesLength;
  let end = start;
  while (end < endLimit && bytes[end] !== 0) end++;
  if (end === endLimit) fail("filename is not null-terminated.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end));
  } catch {
    fail("filename is not valid UTF-8.");
  }
}

/**
 * Inspects the supported standard PC RPF7 OPEN variant.
 * It deliberately refuses encrypted/Orbis headers rather than guessing.
 */
export function inspectOpenRpf7(input) {
  let bytes;
  if (input instanceof Uint8Array) bytes = input;
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else throw new Error("RPF input must be Uint8Array-compatible bytes.");
  if (bytes.length < 16) fail("header is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== RPF7_MAGIC) fail("RPF7 magic does not match.");
  const entryCount = view.getUint32(4, true);
  const namesLength = view.getUint32(8, true);
  const encryptionMarker = view.getUint32(12, true);
  if (encryptionMarker !== RPF_OPEN) fail("archive is not the supported OPEN variant (marker 0x" + encryptionMarker.toString(16) + ").");
  if (entryCount < 1 || entryCount > Math.floor((bytes.length - 16) / 16)) fail("entry table is truncated or has an invalid count.");
  const tocStart = 16;
  const namesStart = tocStart + entryCount * 16;
  const namesEnd = namesStart + namesLength;
  if (!Number.isSafeInteger(namesEnd) || namesEnd > bytes.length) fail("name table extends beyond the archive.");

  const entries = [];
  for (let index = 0; index < entryCount; index++) {
    const offset = tocStart + index * 16;
    const nameWord = view.getUint32(offset, true);
    const directory = view.getUint32(offset + 4, true) === DIRECTORY_IDENT;
    if (directory) {
      const nameOffset = nameWord;
      const firstChild = view.getUint32(offset + 8, true);
      const childCount = view.getUint32(offset + 12, true);
      if (firstChild > entryCount || childCount > entryCount - firstChild) fail("directory child range exceeds the TOC.");
      const name = readName(bytes, namesStart, namesLength, nameOffset);
      entries.push({ index, type: "directory", name, firstChild, childCount });
    } else {
      const nameOffset = view.getUint16(offset, true);
      const dataBlock = view.getUint8(offset + 5) | (view.getUint8(offset + 6) << 8) | (view.getUint8(offset + 7) << 16);
      const fileSize = view.getUint32(offset + 8, true);
      if (view.getUint8(offset + 2) !== 0 || view.getUint8(offset + 3) !== 0 || view.getUint8(offset + 4) !== 0) fail("unsupported file flags are present.");
      const dataOffset = dataBlock * BLOCK_SIZE;
      if (dataOffset < namesEnd || dataOffset + fileSize > bytes.length || dataOffset + fileSize < dataOffset) fail("file payload range is outside the archive.");
      const name = readName(bytes, namesStart, namesLength, nameOffset);
      entries.push({ index, type: "file", name, dataOffset, size: fileSize });
    }
  }

  if (entries[0].type !== "directory" || entries[0].name !== "") fail("TOC root entry is missing or malformed.");
  const parentByChild = new Map();
  for (const directory of entries) {
    if (directory.type !== "directory") continue;
    const siblingNames = new Set();
    for (let childIndex = directory.firstChild; childIndex < directory.firstChild + directory.childCount; childIndex++) {
      if (childIndex === 0) fail("root entry cannot be a child.");
      if (parentByChild.has(childIndex)) fail("TOC entry is assigned to more than one parent directory.");
      parentByChild.set(childIndex, directory.index);
      const child = entries[childIndex];
      if (!child) fail("directory child entry is missing.");
      if (!child.name || child.name.includes("/") || child.name.includes("\\") || child.name === "." || child.name === "..") fail("entry contains an invalid path segment.");
      const key = child.name.toLowerCase();
      if (siblingNames.has(key)) fail("directory contains duplicate child names.");
      siblingNames.add(key);
    }
  }
  for (let index = 1; index < entries.length; index++) {
    if (!parentByChild.has(index)) fail("TOC entry is not referenced by a parent directory.");
    const visited = new Set([index]);
    let parent = parentByChild.get(index);
    while (parent !== 0) {
      if (visited.has(parent)) fail("directory hierarchy contains a parent cycle.");
      visited.add(parent);
      parent = parentByChild.get(parent);
      if (parent === undefined) fail("directory hierarchy does not lead back to the root.");
    }
  }
  for (let index = 1; index < entries.length; index++) {
    const segments = [];
    let current = index;
    while (current !== 0) {
      segments.push(entries[current].name);
      current = parentByChild.get(current);
      if (current === undefined) fail("directory hierarchy does not lead back to the root.");
    }
    entries[index].path = segments.reverse().join("/");
  }
  entries[0].path = "";
  return {
    format: "RPF7",
    encryption: "OPEN",
    entryCount,
    fileCount: entries.filter((entry) => entry.type === "file").length,
    directoryCount: entries.filter((entry) => entry.type === "directory").length,
    namesLength,
    archiveBytes: bytes.length,
    entries
  };
}

/** Extract raw payloads using paths reconstructed from the validated TOC. */
export function extractOpenRpf7(input) {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!bytes) throw new Error("RPF input must be Uint8Array-compatible bytes.");
  const inspection = inspectOpenRpf7(bytes);
  return inspection.entries.filter((entry) => entry.type === "file").map((entry) => ({ path: entry.path, bytes: bytes.slice(entry.dataOffset, entry.dataOffset + entry.size) }));
}
