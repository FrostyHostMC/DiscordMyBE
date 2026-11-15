import { XMLParser, XMLValidator } from "fast-xml-parser";

const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 2000;

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
function text(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object" && "#text" in value) return String(value["#text"]).trim();
  return "";
}
function collectNodes(root, wanted, output = []) {
  if (!root || typeof root !== "object") return output;
  for (const [key, value] of Object.entries(root)) {
    if (wanted.has(key.toLowerCase())) output.push(...asArray(value));
    if (value && typeof value === "object") {
      for (const child of asArray(value)) collectNodes(child, wanted, output);
    }
  }
  return output;
}

/** Inspect GTA V content.xml as data only; never executes or applies its mount instructions. */
export function inspectGtaDlcManifest(input, sourcePath = "content.xml") {
  const xml = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: false }).decode(input || new Uint8Array());
  if (new TextEncoder().encode(xml).byteLength > MAX_XML_BYTES) throw new Error("content.xml exceeds the 2 MiB inspection limit.");
  const validation = XMLValidator.validate(xml);
  if (validation !== true) return { sourcePath, validXml: false, error: validation.err?.msg || "Invalid XML", entries: [], summary: { entryCount: 0, dataFiles: 0, fileTypes: {}, disabledFiles: 0 } };
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: true, isArray: (name) => ["item", "datafile", "includeddatafile", "includedxmlfile"].includes(name.toLowerCase()) }).parse(xml);
  const fileNodes = collectNodes(parsed, new Set(["item", "datafile", "includeddatafile", "includedxmlfile"]));
  const entries = [];
  const seen = new Set();
  for (const node of fileNodes) {
    if (!node || typeof node !== "object") continue;
    const filename = text(node.filename || node.path || node.fileName);
    const fileType = text(node.fileType || node.type || node["@_type"]);
    if (!filename && !fileType) continue;
    const key = filename.toLowerCase();
    if (filename && seen.has(key)) continue;
    if (filename) seen.add(key);
    entries.push({ filename, fileType, isEnabled: text(node["@_enabled"]) !== "false" });
    if (entries.length >= MAX_RECORDS) break;
  }
  const disabledNodes = collectNodes(parsed, new Set(["disabledfiles"]));
  const disabledFiles = disabledNodes.flatMap((node) => typeof node === "string" ? [text(node)].filter(Boolean) : Object.values(node || {}).flatMap(asArray).map(text).filter(Boolean));
  const fileTypes = {};
  for (const entry of entries) if (entry.fileType) fileTypes[entry.fileType] = (fileTypes[entry.fileType] || 0) + 1;
  const roots = parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
  return {
    sourcePath,
    validXml: true,
    rootElements: roots,
    entries,
    disabledFiles,
    summary: { entryCount: entries.length, dataFiles: entries.filter((entry) => entry.fileType).length, fileTypes, disabledFiles: disabledFiles.length },
    limitations: [
      "This is a read-only manifest inspection; no mount or install instructions are executed.",
      "PC DLC mount paths and resource names are not assumed to match PS4 CUSA00411 update 1.73.",
      "The referenced resources must be inspected and validated independently.",
    ],
  };
}
