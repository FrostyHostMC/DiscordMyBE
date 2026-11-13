import { readZipArchive, type ExtractedZipEntry } from '@/utils/zip';
import { ARCHIVE_BYTE_LIMIT, ARCHIVE_ENTRY_LIMIT } from '@/utils/archiveScale';

/**
 * Expands bounded nested Java archives while keeping the original archive path in
 * each extracted entry. This lets scanners discover assets stored in bundled mods
 * without treating archive names or wrapper folders as source content themselves.
 *
 * Expansion shares the same entry and byte budget as the outer archive: a modpack that bundles
 * a dozen jars, or one jar that bundles another, can no longer inflate past the mobile budget.
 */
const NESTED_ARCHIVE = /\.(jar|zip)$/i;
const MAX_NESTED = 12;
const MAX_NESTED_DEPTH = 4;
const MAX_NESTED_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_ENTRIES = ARCHIVE_ENTRY_LIMIT;
const MAX_TOTAL_BYTES = ARCHIVE_BYTE_LIMIT;

interface ArchiveCandidate {
  entry: ExtractedZipEntry;
  depth: number;
}

export async function expandNestedArchives(
  entries: ExtractedZipEntry[],
): Promise<{ entries: ExtractedZipEntry[]; expanded: string[]; skipped: string[] }> {
  const out: ExtractedZipEntry[] = [...entries];
  const expanded: string[] = [];
  const skipped: string[] = [];
  const queue: ArchiveCandidate[] = entries
    .filter((entry) => !entry.isDirectory && NESTED_ARCHIVE.test(entry.path))
    .map((entry) => ({ entry, depth: 1 }));
  const seen = new Set<string>();
  let usedBytes = entries.reduce((sum, entry) => sum + (entry.data?.length ?? 0), 0);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    if (out.length >= MAX_TOTAL_ENTRIES || expanded.length >= MAX_NESTED) break;
    const candidate = queue[cursor];
    const path = candidate.entry.path.replace(/\\/g, '/');
    if (seen.has(path)) continue;
    seen.add(path);

    if (candidate.depth > MAX_NESTED_DEPTH) {
      skipped.push(`${path} (nested archive depth limit)`);
      continue;
    }
    const bytes = candidate.entry.data;
    if (bytes.length === 0 || bytes.length > MAX_NESTED_BYTES) {
      skipped.push(`${path} (${Math.round(bytes.length / 1024)} KB — too large to expand)`);
      continue;
    }

    try {
      const remaining = Math.max(0, MAX_TOTAL_BYTES - usedBytes);
      if (remaining <= 0) {
        skipped.push(`${path} (archive budget already used by earlier content)`);
        break;
      }
      const nested = await readZipArchive(bytes, {
        maxEntries: 20000,
        maxTotalBytes: remaining,
      });
      const prefix = path.replace(NESTED_ARCHIVE, '');
      let added = 0;
      for (const item of nested) {
        if (item.isDirectory || item.data.length === 0 || out.length >= MAX_TOTAL_ENTRIES) continue;
        const expandedEntry = { ...item, path: `${prefix}/${item.path}` };
        out.push(expandedEntry);
        usedBytes += item.data.length;
        added += 1;
        if (candidate.depth < MAX_NESTED_DEPTH && NESTED_ARCHIVE.test(item.path)) {
          queue.push({ entry: expandedEntry, depth: candidate.depth + 1 });
        }
      }
      if (added > 0) expanded.push(path);
      else skipped.push(`${path} (no readable entries)`);
    } catch {
      skipped.push(`${path} (not a readable archive)`);
    }
  }

  return { entries: out, expanded, skipped };
}