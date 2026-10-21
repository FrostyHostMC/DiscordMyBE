import JSZip from 'jszip';
import { AddonPack, ConflictItem } from '@/types/modpack';

/**
 * Advanced conflict diff support: extracts the raw JSON definition that caused
 * an identifier collision from BOTH packs, then produces a line-level diff so
 * the user can see exactly what each pack defines before choosing a resolution.
 */

const TYPE_FOLDERS: Partial<Record<ConflictItem['type'], string>> = {
  entity: 'entities/',
  item: 'items/',
  block: 'blocks/',
  recipe: 'recipes/',
  loot_table: 'loot_tables/'
};

export async function loadDefinitionText(
  pack: AddonPack | undefined,
  type: ConflictItem['type'],
  identifier: string
): Promise<string | null> {
  if (!pack?.fileBlob) return null;
  const folder = TYPE_FOLDERS[type];
  if (!folder) return null;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(pack.fileBlob);
  } catch {
    return null;
  }

  const idTail = (identifier.split(':').pop() || '').toLowerCase().replace(/[^a-z0-9_.]/g, '');
  let fallback: string | null = null;

  for (const [path, fileObj] of Object.entries(zip.files)) {
    const lower = path.toLowerCase();
    if (fileObj.dir || !lower.startsWith(folder) || !lower.endsWith('.json')) continue;
    let text: string;
    try {
      text = await fileObj.async('text');
    } catch {
      continue;
    }
    if (text.includes(identifier)) {
      zip.files = {} as typeof zip.files;
      return text;
    }
    if (!fallback && idTail && lower.includes(idTail)) fallback = text;
  }
  zip.files = {} as typeof zip.files;
  return fallback;
}

export type DiffRow = { kind: 'same' | 'add' | 'del'; text: string };

/** Line diff via LCS. Inputs are capped so it stays fast on mobile devices. */
export function diffLines(aText: string, bText: string, maxLines = 300): DiffRow[] {
  const a = aText ? aText.split('\n').slice(0, maxLines) : [];
  const b = bText ? bText.split('\n').slice(0, maxLines) : [];
  const n = a.length;
  const m = b.length;

  // dp[i][j] = length of the LCS of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: 'del', text: a[i] });
      i++;
    } else {
      rows.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ kind: 'del', text: a[i++] });
  while (j < m) rows.push({ kind: 'add', text: b[j++] });
  return rows;
}