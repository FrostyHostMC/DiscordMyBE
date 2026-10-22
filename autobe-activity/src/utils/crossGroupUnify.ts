import JSZip from 'jszip';
import { deepMerge, sanitizeJsonString } from './addonParser';

/**
 * Port of AutoBE._unify_cross_group_items / _entities / _loot_tables /
 * _blocks / _functions / _scripts and the player.json unification pass.
 * When packs are split into separate behavior outputs per script API version,
 * each output was merged in isolation — so an item/entity/loot table/block/
 * function/script that only exists in one group would be invisible to the
 * others even though Bedrock applies all BPs at once. This pass unions
 * everything back across every output so the whole modpack behaves as one
 * compatibility-merged set.
 *
 * The RP-side passes from the legacy code (player animations, texture atlases,
 * HUD files) are not needed here: this engine produces a single merged
 * resource pack, so all RP content is already in one place.
 */

// JSON definition folders unified first-wins per path, then backfilled into
// every group that is missing the file.
const JSON_FOLDERS = ['items/', 'entities/', 'loot_tables/', 'blocks/'];
const PLAYER_JSON = 'entities/player.json';

// Non-JSON unification sets: exact prefix + required suffix (empty = any file).
// NOTE: scripts/ and functions/ are removed to prevent overwriting entry files
// and corrupting binary scripts across different script API groups.
const EXTRA_SETS: Array<{ prefix: string; suffix: string }> = [
  { prefix: 'functions/', suffix: '.mcfunction' },
];

const YIELD_EVERY = 60;

const yieldToUI = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function unifyCrossGroupBps(zips: JSZip[]): Promise<void> {
  if (zips.length < 2) return;

  // --- Pass 1: unified player.json (deep union across every group) ---------
  let unifiedPlayer: Record<string, unknown> = {};
  let hasPlayer = false;
  for (const zip of zips) {
    const file = zip.file(PLAYER_JSON);
    if (!file) continue;
    try {
      unifiedPlayer = deepMerge(unifiedPlayer, JSON.parse(sanitizeJsonString(await file.async('text'))));
      hasPlayer = true;
    } catch {
      // Malformed player.json — leave it untouched rather than corrupt it.
    }
  }
  if (hasPlayer && Object.keys(unifiedPlayer).length > 0) {
    const text = JSON.stringify(unifiedPlayer, null, 2);
    for (const zip of zips) zip.file(PLAYER_JSON, text);
  }

  // --- Pass 2: first-wins canonical set + backfill of missing files --------
  const canonical = new Map<string, string>();

  const collect = async (
    zip: JSZip,
    prefix: string,
    suffix: string,
    skipPaths?: Set<string>
  ): Promise<void> => {
    let batch = 0;
    for (const [path, fileObj] of Object.entries(zip.files)) {
      const lower = path.toLowerCase();
      if (fileObj.dir || !lower.startsWith(prefix)) continue;
      if (suffix && !lower.endsWith(suffix)) continue;
      if (skipPaths?.has(lower)) continue;
      // Use original path as key to preserve case sensitivity on Windows
      if (!canonical.has(path)) {
        try {
          canonical.set(path, await fileObj.async('text'));
        } catch {
          // Unreadable entry — skip; other groups may still provide it.
        }
      }
      if (++batch % YIELD_EVERY === 0) await yieldToUI();
    }
  };

  for (const prefix of JSON_FOLDERS) {
    const skip = prefix === 'entities/' ? new Set([PLAYER_JSON]) : undefined;
    for (const zip of zips) await collect(zip, prefix, '.json', skip);
  }
  for (const set of EXTRA_SETS) {
    for (const zip of zips) await collect(zip, set.prefix, set.suffix);
  }

  if (canonical.size === 0) return;

  // Backfill: every group's BP carries the complete unified content set.
  for (const zip of zips) {
    let batch = 0;
    for (const [path, text] of canonical.entries()) {
      if (!zip.file(path)) zip.file(path, text);
      if (++batch % YIELD_EVERY === 0) await yieldToUI();
    }
  }
}