const TEXT_EXTENSIONS = new Set([".xml", ".meta", ".ini", ".cfg", ".json", ".txt", ".md", ".lua", ".ymt", ".ymf", ".rel", ".gxt2", ".toml"]);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const REFERENCE_PATTERN = /["']([^"'<>\r\n]{1,260}?\.[a-z0-9]{1,8})["']/gi;
const PATH_PATTERN = /[\\/]/;

function extension(path) {
  const name = String(path || "").split(/[\\/]/).at(-1) || "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function normalizeRelative(value) {
  const parts = [];
  for (const part of String(value || "").replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function decodeText(file) {
  if (!(file?.bytes instanceof Uint8Array) || file.bytes.byteLength > MAX_TEXT_BYTES) return null;
  if (!TEXT_EXTENSIONS.has(extension(file.path))) return null;
  const sample = file.bytes.subarray(0, Math.min(file.bytes.length, 4096));
  if (sample.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    return null;
  }
}

function candidatePaths(sourcePath, reference) {
  const raw = String(reference).trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!raw || raw.includes(":") || raw.startsWith("/")) return [];
  const sourceDirectory = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  const relative = normalizeRelative(sourceDirectory ? sourceDirectory + "/" + raw : raw);
  const direct = normalizeRelative(raw);
  return [...new Set([relative, direct].filter(Boolean))];
}

/**
 * Builds a conservative, data-driven dependency graph from textual references.
 * It never executes scripts or metadata. References are only resolved against
 * files in the same imported package; unknown references remain explicit.
 */
export function analyzeModDependencies(files = []) {
  if (!Array.isArray(files)) throw new Error("files must be an array.");
  const index = new Map();
  for (const file of files) {
    if (typeof file?.path !== "string" || !file.path) continue;
    const normalized = normalizeRelative(file.path);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    const entries = index.get(key) || [];
    entries.push(normalized);
    index.set(key, entries);
  }

  const edges = [];
  const ignored = [];
  for (const file of files) {
    const source = normalizeRelative(file?.path);
    const text = decodeText(file);
    if (!source || text === null) {
      if (file?.bytes instanceof Uint8Array && TEXT_EXTENSIONS.has(extension(file.path)) && file.bytes.byteLength > MAX_TEXT_BYTES) {
        ignored.push({ path: file.path, reason: "text file exceeds bounded dependency scan size" });
      }
      continue;
    }
    const seen = new Set();
    for (const match of text.matchAll(REFERENCE_PATTERN)) {
      const reference = match[1].trim();
      if (!reference || !/[.]/.test(reference) || !/[a-z0-9]/i.test(reference)) continue;
      const key = reference.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const paths = candidatePaths(source, reference);
      const matches = new Set();
      for (const candidate of paths) {
        for (const found of index.get(candidate.toLowerCase()) || []) matches.add(found);
      }
      // A bare filename is useful when metadata references assets by basename.
      if (!PATH_PATTERN.test(reference)) {
        const basename = reference.split("/").at(-1).toLowerCase();
        for (const [indexed, foundPaths] of index) {
          if (indexed.split("/").at(-1) === basename) for (const found of foundPaths) matches.add(found);
        }
      }
      const candidates = [...matches].sort();
      edges.push({
        from: source,
        reference,
        status: candidates.length === 1 ? "resolved" : candidates.length === 0 ? "missing" : "ambiguous",
        targets: candidates
      });
    }
  }

  const summary = {
    scannedTextFiles: files.filter((file) => decodeText(file) !== null).length,
    references: edges.length,
    resolved: edges.filter((edge) => edge.status === "resolved").length,
    missing: edges.filter((edge) => edge.status === "missing").length,
    ambiguous: edges.filter((edge) => edge.status === "ambiguous").length,
    ignoredOversizeTextFiles: ignored.length
  };
  return {
    schemaVersion: 1,
    status: "read-only-reference-analysis",
    summary,
    edges,
    ignored,
    limitations: [
      "References are inferred from quoted filename-like strings; they are not proof of runtime dependency.",
      "Only bounded UTF-8 text files are scanned. Binary archives and compiled resources require format-specific adapters.",
      "No script, XML instruction, or metadata content is executed."
    ]
  };
}
