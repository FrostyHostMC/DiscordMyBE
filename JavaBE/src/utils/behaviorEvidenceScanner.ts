import type { DecompileClassSummary } from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';

/**
 * Archive evidence index for the behaviour translation engine.
 *
 * Every bucket is filled from real paths inside the imported archive. Nothing here is
 * keyed on a mod, mob, item, block or file name: the same rules run on any mod.
 */
export interface ModEvidenceIndex {
  loot: string[];
  trades: string[];
  recipes: string[];
  spawn: string[];
  particles: string[];
  sounds: string[];
  worldgen: string[];
  blockstates: string[];
  models: string[];
  attributes: string[];
  /** Per-class decompiled method/signature text, keyed by class name. */
  classText: Map<string, string>;
  /** Every class text joined — used only for global mechanism detection. */
  allText: string;
}

const norm = (path: string) => path.replace(/\\/g, '/').toLowerCase();

export function scanModEvidence(
  entries: ExtractedZipEntry[] = [],
  classes: DecompileClassSummary[] = [],
): ModEvidenceIndex {
  const index: ModEvidenceIndex = {
    loot: [],
    trades: [],
    recipes: [],
    spawn: [],
    particles: [],
    sounds: [],
    worldgen: [],
    blockstates: [],
    models: [],
    attributes: [],
    classText: new Map<string, string>(),
    allText: '',
  };

  for (const entry of entries) {
    const path = norm(entry.path);
    const isJson = path.endsWith('.json');
    if (isJson && /(^|\/)(loot_tables?|loot)\//.test(path)) index.loot.push(entry.path);
    else if (isJson && /(^|\/)(trades|offers|villager_trades)\//.test(path)) index.trades.push(entry.path);
    else if (isJson && /(^|\/)recipes?\//.test(path)) index.recipes.push(entry.path);
    else if (isJson && (/(^|\/)(spawn_rules|spawn|entity_spawn)\//.test(path) || /_spawn\.json$/.test(path))) index.spawn.push(entry.path);
    else if (isJson && /(^|\/)particles?\//.test(path)) index.particles.push(entry.path);
    else if (/\.(ogg|wav|mp3)$/.test(path) || /(^|\/)sounds\.json$/.test(path)) index.sounds.push(entry.path);
    else if (isJson && /(^|\/)(worldgen|dimension|dimensions|structure|structures|feature|features|biomes?)\//.test(path)) index.worldgen.push(entry.path);
    else if (isJson && /(^|\/)blockstates?\//.test(path)) index.blockstates.push(entry.path);
    else if (isJson && /(^|\/)(attributes?)\//.test(path)) index.attributes.push(entry.path);
    else if (isJson && /(^|\/)models\//.test(path)) index.models.push(entry.path);
  }

  const allText: string[] = [];
  for (const entry of classes) {
    const fields = (entry.fieldDefinitions ?? []).map((field) => `${field.name} ${field.descriptor}`);
    const methods = (entry.methodSignatures ?? []).map((method) => `${method.name} ${method.descriptor} ${method.localVariables.map((local) => local.name).join(' ')}`);
    const text = [entry.className, ...(entry.methods ?? []), ...fields, ...methods, ...(entry.signals ?? [])].join(' ');
    index.classText.set(entry.className, text);
    allText.push(text);
  }
  index.allText = allText.join(' ');
  return index;
}

/** Decompiled text for the classes a mob/item was actually matched to. */
export function textForClasses(index: ModEvidenceIndex, classNames: string[] = []): string {
  const parts: string[] = [];
  for (const name of classNames) {
    const text = index.classText.get(name);
    if (text) parts.push(text);
  }
  return parts.join(' ');
}

/**
 * Decompiled text for the classes that carry this registry identifier in their own name.
 * Used so per-block/per-item detection never falls back to a global mod-wide scan.
 */
export function textForIdentifier(index: ModEvidenceIndex, identifier: string, limit = 3): string {
  const needle = identifier.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (needle.length < 3) return '';
  const parts: string[] = [];
  for (const [name, text] of index.classText) {
    if (name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(needle)) parts.push(text);
    if (parts.length >= limit) break;
  }
  return parts.join(' ');
}

/** Exact-path read. Evidence paths come from the archive scan, never from a guess. */
export function readEntryText(entries: ExtractedZipEntry[], path: string): string | null {
  const match = entries.find((entry) => entry.path === path);
  if (!match) return null;
  try {
    return new TextDecoder().decode(match.data);
  } catch {
    return null;
  }
}

/** True when the archive ships a Java blockstate for this exact registered block id. */
export function findBlockstateEvidence(index: ModEvidenceIndex, blockId: string): string | null {
  const needle = `/${blockId.toLowerCase()}.json`;
  return index.blockstates.find((path) => norm(path).endsWith(needle)) ?? null;
}