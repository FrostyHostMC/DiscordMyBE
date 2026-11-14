const PKG_MAGIC = 0x7f434e54;
const PARAM_SFO_ID = 0x1000;
const MAX_ENTRIES = 100000;
const MAX_SFO_BYTES = 2 * 1024 * 1024;

function checkedRange(offset, length, total, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > total) {
    throw new Error(`Invalid PS4 PKG ${label} range.`);
  }
}

function readSfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 0x14 || view.getUint32(0, true) !== 0x46535000) {
    throw new Error("PARAM.SFO signature or header is invalid.");
  }
  const keyStart = view.getUint32(8, true);
  const dataStart = view.getUint32(12, true);
  const count = view.getUint32(16, true);
  if (count > 4096 || 0x14 + count * 16 > bytes.byteLength || keyStart >= bytes.byteLength || dataStart >= bytes.byteLength) {
    throw new Error("PARAM.SFO table bounds are invalid.");
  }
  const result = {};
  for (let i = 0; i < count; i++) {
    const at = 0x14 + i * 16;
    const keyOffset = view.getUint16(at, true);
    const format = view.getUint16(at + 2, true);
    const length = view.getUint32(at + 4, true);
    const dataOffset = view.getUint32(at + 12, true);
    const keyAt = keyStart + keyOffset;
    const valueAt = dataStart + dataOffset;
    if (keyAt >= bytes.byteLength || valueAt + length > bytes.byteLength || length > MAX_SFO_BYTES) continue;
    let keyEnd = keyAt;
    while (keyEnd < bytes.byteLength && bytes[keyEnd] !== 0) keyEnd++;
    const key = new TextDecoder().decode(bytes.subarray(keyAt, keyEnd));
    if (!key) continue;
    if (format === 0x0404 && length >= 4) result[key] = view.getUint32(valueAt, true);
    else if (format === 0x0204 && length >= 2) result[key] = view.getUint16(valueAt, true);
    else if (format === 0x0204 || format === 0x0004) result[key] = new TextDecoder().decode(bytes.subarray(valueAt, valueAt + length)).replace(/\0+$/, "");
    else result[key] = { format: `0x${format.toString(16)}`, length };
  }
  return result;
}

export async function inspectPs4Pkg(file) {
  if (!file || typeof file.slice !== "function" || !Number.isFinite(file.size) || file.size < 0x1000) {
    throw new Error("Select a valid PS4 PKG file.");
  }
  const headerBytes = new Uint8Array(await file.slice(0, 0x1000).arrayBuffer());
  const header = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
  if (header.getUint32(0, false) !== PKG_MAGIC) throw new Error("This file does not have a PS4 PKG header (7F CNT).");
  const entryCount = header.getUint32(0x10, false);
  const tableOffset = header.getUint32(0x18, false);
  const entrySize = 32;
  if (!entryCount || entryCount > MAX_ENTRIES) throw new Error("PS4 PKG entry count is outside the supported inspection limit.");
  const tableLength = entryCount * entrySize;
  checkedRange(tableOffset, tableLength, file.size, "entry table");
  const tableBytes = new Uint8Array(await file.slice(tableOffset, tableOffset + tableLength).arrayBuffer());
  const table = new DataView(tableBytes.buffer, tableBytes.byteOffset, tableBytes.byteLength);
  let sfo = null;
  let sfoWarning = null;
  for (let i = 0; i < entryCount; i++) {
    const at = i * entrySize;
    const id = table.getUint32(at, false);
    const offset = table.getUint32(at + 16, false);
    const size = table.getUint32(at + 20, false);
    if (id !== PARAM_SFO_ID) continue;
    try {
      if (size > MAX_SFO_BYTES) throw new Error("PARAM.SFO exceeds the 2 MiB inspection limit.");
      checkedRange(offset, size, file.size, "PARAM.SFO");
      sfo = readSfo(new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()));
    } catch (error) {
      sfoWarning = error.message;
    }
    break;
  }
  const contentId = new TextDecoder().decode(headerBytes.subarray(0x40, 0x64)).replace(/\0+$/, "").trim();
  const titleId = contentId.match(/CUSA\d{5}/i)?.[0]?.toUpperCase() || null;
  const flags = header.getUint32(0x78, false);
  const category = sfo?.CATEGORY || null;
  const packageVersion = sfo?.APP_VER || null;
  const systemVersion = sfo?.SYSTEM_VER || null;
  const isUpdate = typeof category === "string" && /^gp/i.test(category);
  return {
    fileName: file.name || "unnamed.pkg",
    fileSize: file.size,
    contentId,
    titleId,
    packageType: isUpdate ? "update-candidate" : "base-or-other",
    category,
    appVersion: packageVersion,
    requiredSystemVersion: systemVersion,
    contentFlags: `0x${flags.toString(16).padStart(8, "0")}`,
    entryCount,
    paramSfoFound: Boolean(sfo),
    paramSfo: sfo,
    warning: sfoWarning || (!sfo ? "PARAM.SFO was not available as a readable metadata entry; only the PKG header was inspected." : null),
    inspection: "Header, metadata entry table and readable PARAM.SFO only. The encrypted PFS game payload was not opened or extracted.",
    compatibilityVerified: false,
  };
}
