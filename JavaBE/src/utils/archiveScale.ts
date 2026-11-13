/**
 * Scale guard for very large mod archives.
 *
 * A modpack-sized archive (tens of thousands of files, hundreds of megabytes) used to be
 * inflated and scanned in full on the main thread, which first froze and then crashed the
 * tab. Two budgets keep the conversion inside the mobile budget without changing the result
 * for ordinary mods:
 *
 *  1. Extraction stops inflating once the byte/entry budget is spent, keeping the
 *     highest-evidence files first (loader metadata, animations, models, block definitions,
 *     classes, textures) and leaving audio and oversized binaries unread.
 *  2. The pipeline yields back to the browser between heavy stages, so the page keeps
 *     painting and the progress log keeps updating instead of locking up.
 */

export interface ArchiveEntryLike {
  path: string;
  data: { length: number };
}

/** Hard entry cap for a single archive on a mobile device. */
export const ARCHIVE_ENTRY_LIMIT = 18000;
/** Total inflated-byte budget for a single archive. */
export const ARCHIVE_BYTE_LIMIT = 160 * 1024 * 1024;
/** Largest single entry that will be inflated or scanned. */
export const ARCHIVE_ENTRY_BYTE_LIMIT = 24 * 1024 * 1024;

interface EntryClass {
  key: string;
  label: string;
  priority: number;
  cap: number;
  test: RegExp;
}

/**
 * Ordered by how much conversion evidence a file carries. Order matters: the first match
 * wins, so specific folders are tested before the generic `.json` fallback.
 */
const ENTRY_CLASSES: EntryClass[] = [
  {
    key: 'metadata',
    label: 'loader metadata',
    priority: 100,
    cap: 200,
    test: /(^|\/)(fabric\.mod\.json|quilt\.mod\.json|mods\.toml|neoforge\.mods\.toml|mcmod\.info|pack\.mcmeta)$/,
  },
  {
    key: 'animation',
    label: 'animation document',
    priority: 96,
    cap: 8000,
    test: /\.(animation|animations)\.json$|\/(animations|anim)\//,
  },
  {
    key: 'model',
    label: 'model / geometry',
    priority: 92,
    cap: 8000,
    test: /\/models\/|\.geo\.json$|\.bbmodel$/,
  },
  {
    key: 'blockstate',
    label: 'block definition',
    priority: 88,
    cap: 6000,
    test: /\/(blockstates|blocks)\//,
  },
  {
    key: 'class',
    label: 'java class',
    priority: 84,
    cap: 3000,
    test: /\.class$/,
  },
  {
    key: 'texture',
    label: 'texture',
    priority: 80,
    cap: 9000,
    test: /\.png$/,
  },
  {
    key: 'lang',
    label: 'localisation',
    priority: 76,
    cap: 600,
    test: /\/lang\//,
  },
  {
    key: 'data',
    label: 'recipe / loot / tag',
    priority: 68,
    cap: 4000,
    test: /\/(recipes|loot_tables|tags|advancements|worldgen)\//,
  },
  {
    key: 'effect',
    label: 'particle / shader',
    priority: 60,
    cap: 1500,
    test: /\/(particles|shaders)\/|\.(fsh|vsh|glsl|json)$/,
  },
  {
    key: 'sound',
    label: 'sound',
    priority: 30,
    cap: 800,
    test: /\.(ogg|wav|mp3|flac)$/,
  },
];

const OTHER_CLASS: EntryClass = {
  key: 'other',
  label: 'other file',
  priority: 40,
  cap: 4000,
  test: /^/,
};

function resolveClass(path: string): EntryClass {
  const lower = path.toLowerCase();
  for (const entryClass of ENTRY_CLASSES) {
    if (entryClass.test.test(lower)) return entryClass;
  }
  return OTHER_CLASS;
}

/** Evidence weight of one archive path. Used by the ZIP reader to spend its budget well. */
export function archiveEntryPriority(path: string): number {
  return resolveClass(path).priority;
}

export interface ArchiveBudgetReport {
  limited: boolean;
  entriesBefore: number;
  entriesAfter: number;
  bytesBefore: number;
  bytesAfter: number;
  skipped: Record<string, number>;
  summary: string;
}

export interface ArchiveBudgetOptions {
  maxEntries?: number;
  maxTotalBytes?: number;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatArchiveBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Reduces an archive to what a conversion can actually use when it is larger than the mobile
 * budget. Ordinary mods pass through untouched (same array identity), so their result is
 * bit-for-bit what it was before. Kept entries stay in their original archive order.
 */
export function prioritizeArchiveEntries<T extends ArchiveEntryLike>(
  entries: T[],
  options?: ArchiveBudgetOptions,
): { entries: T[]; report: ArchiveBudgetReport } {
  const maxEntries = options?.maxEntries ?? ARCHIVE_ENTRY_LIMIT;
  const maxTotalBytes = options?.maxTotalBytes ?? ARCHIVE_BYTE_LIMIT;
  const bytesBefore = entries.reduce((sum, entry) => sum + (entry.data?.length ?? 0), 0);

  if (entries.length <= maxEntries && bytesBefore <= maxTotalBytes) {
    return {
      entries,
      report: {
        limited: false,
        entriesBefore: entries.length,
        entriesAfter: entries.length,
        bytesBefore,
        bytesAfter: bytesBefore,
        skipped: {},
        summary: '',
      },
    };
  }

  const counts = new Map<string, number>();
  const skipped: Record<string, number> = {};
  const keep = new Set<number>();
  let bytesKept = 0;

  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        archiveEntryPriority(right.entry.path) - archiveEntryPriority(left.entry.path) ||
        left.index - right.index,
    );

  for (const { entry, index } of ordered) {
    const entryClass = resolveClass(entry.path);
    const used = counts.get(entryClass.key) ?? 0;
    const size = entry.data?.length ?? 0;
    const full = keep.size >= maxEntries || used >= entryClass.cap;
    if (full || bytesKept + size > maxTotalBytes) {
      skipped[entryClass.label] = (skipped[entryClass.label] ?? 0) + 1;
      continue;
    }
    keep.add(index);
    counts.set(entryClass.key, used + 1);
    bytesKept += size;
  }

  const kept = entries.filter((_entry, index) => keep.has(index));
  const skippedTotal = entries.length - kept.length;
  const summary =
    `[MEMORY] Archive scale guard: ${formatCount(entries.length)} entries / ${formatArchiveBytes(bytesBefore)} ` +
    `reduced to ${formatCount(kept.length)} entries / ${formatArchiveBytes(bytesKept)} — highest-evidence files kept ` +
    `first (loader metadata, animation, model, block and texture assets); ${formatCount(skippedTotal)} low-priority or oversized file(s) were left unread so the tab stays inside its memory budget.`;

  return {
    entries: kept,
    report: {
      limited: true,
      entriesBefore: entries.length,
      entriesAfter: kept.length,
      bytesBefore,
      bytesAfter: bytesKept,
      skipped,
      summary,
    },
  };
}

/**
 * Hands the main thread back to the browser. Long conversion stages are synchronous, so
 * without an explicit yield the page cannot paint, cannot scroll and looks crashed.
 */
export function yieldToUi(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A slightly longer pause used after a stage so the log visibly advances. */
export function pauseForUi(milliseconds = 24): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export interface ChunkRunOptions {
  /** Items handled between two main-thread yields. Defaults to 40. */
  chunkSize?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Runs a per-item synchronous job in slices and hands the frame back between them.
 *
 * A modpack-sized archive carries thousands of documents. One uninterrupted loop over all of them
 * is what makes the page look crashed while it works: nothing paints, taps are ignored and the
 * progress log stops advancing. The work and the result are identical here — the loop is only
 * interleaved with paints, so the interface stays alive for the whole pass.
 */
export async function runInChunks<T>(
  items: T[],
  work: (item: T, index: number) => void,
  options?: ChunkRunOptions,
): Promise<void> {
  const chunkSize = Math.max(1, options?.chunkSize ?? 40);
  const total = items.length;
  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total);
    for (let index = start; index < end; index += 1) work(items[index], index);
    options?.onProgress?.(end, total);
    if (end < total) await yieldToUi();
  }
}

/**
 * Budget for a single archive class scan. Reading every class byte of a modpack is what pushed a
 * large conversion out of memory, so the scan stops at whichever budget is reached first and the
 * conversion is told how much of the archive it actually inspected.
 */
export const CLASS_SCAN_BYTE_BUDGET = 48 * 1024 * 1024;
