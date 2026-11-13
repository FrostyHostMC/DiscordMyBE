import type { DecompileClassSummary } from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';

export interface FoliageMotionEvidence {
  count: number;
  paths: string[];
}

const FOLIAGE = /foliage|vegetation|plant|leaves|leaf|grass|flower|fern|crop|vine|tree|sapling|bush|moss/i;
const OFFSET_MOTION = new RegExp([
  '(?:vertex|vertices|mesh|quad).{0,48}(?:offset|displac|wind|sway)',
  '(?:offset|displac).{0,48}(?:vertex|vertices|mesh|wind|sway)',
  '(?:wind|sway|gust).{0,48}(?:vertex|mesh|offset|displac)',
  '\\b(?:vertex_offset|vertexoffset|wind_sway|windsway)\\b',
].join('|'), 'i');
const decoder = new TextDecoder();

/** Finds source-backed wind/vertex-offset hints without treating a filename as proof. */
export function findFoliageMotionEvidence(
  entries: ExtractedZipEntry[],
  classes: DecompileClassSummary[] = [],
): FoliageMotionEvidence {
  const found = new Set<string>();
  for (const item of classes) {
    const evidence = [item.className, ...item.methods, ...(item.signals ?? [])].join(' ');
    if (FOLIAGE.test(item.className) && OFFSET_MOTION.test(evidence)) found.add(item.className);
  }
  let classFilesScanned = 0;
  let foliageFilesScanned = 0;
  let otherFilesScanned = 0;
  for (const entry of entries.slice(0, 50000)) {
    const path = entry.path.replace(/\\/g, '/');
    const isClass = path.endsWith('.class');
    if (!isClass && !/\.(?:java|json|bbmodel)$/i.test(path)) continue;
    if (isClass && ++classFilesScanned > 350) continue;
    if (!isClass && FOLIAGE.test(path) && ++foliageFilesScanned > 512) continue;
    if (!isClass && !FOLIAGE.test(path) && ++otherFilesScanned > 128) continue;
    const limit = isClass ? 96_000 : 128_000;
    const text = decoder.decode(entry.data.subarray(0, Math.min(entry.data.length, limit)));
    if (FOLIAGE.test(`${path} ${text}`) && OFFSET_MOTION.test(text)) found.add(path);
  }
  const paths = [...found];
  return { count: paths.length, paths: paths.slice(0, 12) };
}