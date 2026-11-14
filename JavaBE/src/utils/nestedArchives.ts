import { readZipArchive, type ExtractedZipEntry } from '@/utils/zip';
import { getArchiveBudget, type ArchiveBudget } from '@/utils/archiveScale';

/**
 * Expands bounded nested Java archives while keeping the original archive path in
 * each extracted entry. This lets scanners discover assets stored in bundled mods
 * without treating archive names or wrapper folders as source content themselves.
 *
 * Expansion shares the same entry and byte budget as the outer archive: a modpack that bundles
 * a dozen jars, or one jar that bundles another, can no longer inflate past the mobile budget.
 */
const NESTED_ARCHIVE = /\.(jar|zip)$/i;
const DEFAULT_BUDGET = getArchiveBudget();

interface ArchiveCandidate {
  entry: ExtractedZipEntry;
  depth: number;
}

export async function expandNestedArchives(
  entries: ExtractedZipEntry[],
  budget: ArchiveBudget = DEFAULT_BUDGET,
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
    if (out.length >= budget.maxEntries || expanded.length >= budget.maxNestedArchives) break;
    const candidate = queue[cursor];
    const path = candidate.entry.path.replace(/\\/g, '/');
    if (seen.has(path)) continue;
    seen.add(path);

    if (candidate.depth > budget.maxNestedDepth) {
      skipped.push(`${path} (nested archive depth limit)`);
      continue;
    }
    const bytes = candidate.entry.data;
    if (bytes.length === 0 || bytes.length > budget.maxNestedArchiveBytes) {
      skipped.push(`${path} (${Math.round(bytes.length / 1024)} KB — too large to expand)`);
      continue;
    }

    try {
      const remaining = Math.max(0, budget.maxTotalBytes - usedBytes);
      if (remaining <= 0) {
        skipped.push(`${path} (archive budget already used by earlier content)`);
        break;
      }
      const nested = await readZipArchive(bytes, {
        maxEntries: Math.min(budget.maxEntries - out.length, 20000),
        maxEntryBytes: budget.maxEntryBytes,
        maxTotalBytes: remaining,
      });
      const prefix = path.replace(NESTED_ARCHIVE, '');
      let added = 0;
      for (const item of nested) {
        if (item.isDirectory || item.data.length === 0 || out.length >= budget.maxEntries || usedBytes + item.data.length > budget.maxTotalBytes) continue;
        const expandedEntry = { ...item, path: `${prefix}/${item.path}` };
        out.push(expandedEntry);
        usedBytes += item.data.length;
        added += 1;
        if (candidate.depth < budget.maxNestedDepth && NESTED_ARCHIVE.test(item.path)) {
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