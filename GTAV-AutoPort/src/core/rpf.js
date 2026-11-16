const MAX_ENTRIES = 10000;

function safeEntryPath(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\")) return false;
  if (value.startsWith("/") || /^[a-z]:/i.test(value)) return false;
  const parts = value.replace(/\/+$/, "").split("/");
  return parts.length > 0 && parts.every((part) => part && part !== "." && part !== "..");
}

/** Parse the documented rk rpf ls --tsv output without trusting archive paths. */
export function parseRpfListing(output) {
  const entries = [];
  const seen = new Set();
  for (const line of String(output || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const columns = line.split("\t");
    if (columns.length < 8) throw new Error("RageKit returned an unrecognized RPF listing row.");
    const [kind, entryPath, rawSize, rawStoredSize, rawUncompressedSize, systemFlags, graphicsFlags, encrypted] = columns;
    if (!safeEntryPath(entryPath)) throw new Error(`RPF archive contains an unsafe entry path: ${entryPath}`);
    const key = entryPath.toLowerCase();
    if (seen.has(key)) throw new Error(`RPF archive contains duplicate entry paths: ${entryPath}`);
    seen.add(key);
    const size = Number(rawSize);
    const storedSize = Number(rawStoredSize);
    const uncompressedSize = Number(rawUncompressedSize);
    if (![size, storedSize, uncompressedSize].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error(`RPF archive contains invalid size metadata: ${entryPath}`);
    }
    const normalizedKind = String(kind).toLowerCase();
    const extension = entryPath.split("/").at(-1).match(/\.[^.]+$/)?.[0]?.toLowerCase() || "";
    entries.push({
      kind: normalizedKind,
      path: entryPath,
      size,
      storedSize,
      uncompressedSize,
      systemFlags,
      graphicsFlags,
      encrypted: encrypted === "1",
      extension,
      resource: normalizedKind.includes("resource") || normalizedKind === "r",
    });
    if (entries.length > MAX_ENTRIES) throw new Error(`RPF archive exceeds the ${MAX_ENTRIES.toLocaleString()} entry inspection limit.`);
  }
  const counts = {};
  for (const entry of entries) {
    const key = entry.extension || (entry.kind.includes("dir") ? "directory" : "other");
    counts[key] = (counts[key] || 0) + 1;
  }
  return {
    entries,
    summary: {
      entryCount: entries.length,
      resourceCount: entries.filter((entry) => entry.resource).length,
      encryptedEntryCount: entries.filter((entry) => entry.encrypted).length,
      extensionCounts: counts,
    },
  };
}
