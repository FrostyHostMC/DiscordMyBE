const RPF7_MAGIC = 0x52504637;
const RPF_OPEN = 0x4e45504f;
const DIRECTORY_IDENT = 0x7fffff00;
const BLOCK_SIZE = 512;
const MAX_OFFSET_BLOCKS = 0x7fffff;
const MAX_U24 = 0xffffff;

function safePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\")) {
    throw new Error("RPF paths must be non-empty relative paths using forward slashes.");
  }
  if (value.startsWith("/") || /^[a-z]:/i.test(value)) throw new Error("Absolute RPF paths are not allowed.");
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("RPF paths cannot contain empty, dot or traversal segments.");
  return parts.join("/");
}
function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("Every RPF input file must provide Uint8Array-compatible bytes.");
}
function align(value, boundary = BLOCK_SIZE) {
  return Math.ceil(value / boundary) * boundary;
}
function writeU24(view, offset, value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U24) throw new Error("RPF 24-bit field overflow.");
  view.setUint8(offset, value & 0xff);
  view.setUint8(offset + 1, (value >>> 8) & 0xff);
  view.setUint8(offset + 2, (value >>> 16) & 0xff);
}
function makeTree(files) {
  const root = { name: "", path: "", directory: true, children: new Map(), parent: null };
  const seen = new Set();
  for (const file of files) {
    const path = safePath(file.path);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate RPF path: " + path);
    seen.add(key);
    const parts = path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const directory = i < parts.length - 1;
      let node = current.children.get(name);
      if (!node) {
        node = { name, path: current.path ? current.path + "/" + name : name, directory, children: directory ? new Map() : null, parent: current };
        current.children.set(name, node);
      } else if (node.directory !== directory) {
        throw new Error("RPF path is both a file and a directory: " + node.path);
      }
      current = node;
    }
    current.bytes = asBytes(file.bytes);
  }
  return root;
}

/**
 * Builds a standard, unencrypted RPF7 archive (OPEN TOC, stored file payloads).
 * This is deliberately NOT the Orbis/PS4 encrypted archive variant.
 */
export function buildOpenRpf7(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("At least one file is required to build an RPF7 archive.");
  const root = makeTree(files);
  const entries = [root];
  const directories = [root];
  for (let cursor = 0; cursor < directories.length; cursor++) {
    const directory = directories[cursor];
    const children = [...directory.children.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    directory.firstChild = entries.length;
    directory.childCount = children.length;
    for (const child of children) {
      entries.push(child);
      if (child.directory) directories.push(child);
    }
  }
  if (entries.length > 0xffffffff) throw new Error("RPF entry count exceeds the format limit.");

  const names = [];
  let namesLength = 0;
  for (const entry of entries) {
    const encoded = new TextEncoder().encode(entry.name + "\0");
    entry.nameOffset = namesLength;
    names.push(encoded);
    namesLength += encoded.length;
  }
  if (namesLength > 0x0fffffff) throw new Error("RPF name table exceeds the supported 28-bit size.");
  for (const entry of entries) {
    if (entry.nameOffset > 0xffff && !entry.directory) throw new Error("RPF file name table offset exceeds the 16-bit file-entry limit.");
  }

  const tocStart = 16;
  const namesStart = tocStart + entries.length * 16;
  const dataStart = align(namesStart + namesLength);
  let dataCursor = dataStart;
  for (const entry of entries) {
    if (entry.directory) continue;
    if (entry.bytes.length > 0xffffffff) throw new Error("RPF file exceeds the 32-bit uncompressed-size limit: " + entry.path);
    if (entry.bytes.length >= 4 && entry.bytes[0] === 0x52 && entry.bytes[1] === 0x53 && entry.bytes[2] === 0x43 && entry.bytes[3] === 0x37) {
      throw new Error("RSC7 resource needs resource page flags; refusing to write it as a generic binary entry: " + entry.path);
    }
    dataCursor = align(dataCursor);
    entry.dataOffset = dataCursor;
    const block = dataCursor / BLOCK_SIZE;
    if (block > MAX_OFFSET_BLOCKS) throw new Error("RPF7 archive exceeds its 4 GiB addressable file-data range.");
    dataCursor += entry.bytes.length;
  }
  if (dataCursor > 0xffffffff) throw new Error("RPF7 archive exceeds the supported 4 GiB output limit.");

  const output = new Uint8Array(dataCursor);
  const view = new DataView(output.buffer);
  view.setUint32(0, RPF7_MAGIC, true);
  view.setUint32(4, entries.length, true);
  view.setUint32(8, namesLength, true);
  view.setUint32(12, RPF_OPEN, true);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const offset = tocStart + index * 16;
    if (entry.directory) {
      view.setUint32(offset, entry.nameOffset, true);
      view.setUint32(offset + 4, DIRECTORY_IDENT, true);
      view.setUint32(offset + 8, entry.firstChild, true);
      view.setUint32(offset + 12, entry.childCount, true);
    } else {
      view.setUint16(offset, entry.nameOffset, true);
      writeU24(view, offset + 2, 0);
      writeU24(view, offset + 5, entry.dataOffset / BLOCK_SIZE);
      view.setUint32(offset + 8, entry.bytes.length, true);
      view.setUint32(offset + 12, 0, true);
      output.set(entry.bytes, entry.dataOffset);
    }
  }
  let nameCursor = namesStart;
  for (const name of names) {
    output.set(name, nameCursor);
    nameCursor += name.length;
  }
  return {
    bytes: output,
    report: {
      format: "RPF7",
      byteOrder: "little-endian",
      encryption: "OPEN",
      compression: "stored/uncompressed",
      entryCount: entries.length,
      fileCount: entries.filter((entry) => !entry.directory).length,
      directoryCount: entries.filter((entry) => entry.directory).length,
      archiveBytes: output.length,
      blockSize: BLOCK_SIZE,
      targetCompatibility: "PC RPF7 only; not Orbis/PS4 validated",
      installable: false
    }
  };
}
