import type { ExtractedZipEntry } from '@/utils/zip';
import { toBedrockTexturePath } from '@/utils/textureMetadata';

/**
 * Java item-model normaliser.
 *
 * A Java item's on-screen shape is decided entirely by the `parent` pointer chain of
 * `assets/<namespace>/models/item/<name>.json`:
 *   • `item/generated` / `item/handheld` (and the `item/template_*` family) → a FLAT
 *     sprite drawn from `textures.layer0`. Bedrock can only show it through a
 *     `minecraft:icon` shortname that `textures/item_texture.json` resolves to a PNG.
 *   • `block/…` (or any model carrying its own `elements`) → a CUBE model whose faces
 *     sample the block sheet. Bedrock renders that shape only through the block
 *     definition the item belongs to, so the sheet must reach the block/terrain atlas.
 *
 * Treating every item the same way is exactly what produces flat cubes, unrendered
 * planes and black-and-magenta icons, so the model's OWN parent pointer is the evidence
 * read here — never the item name.
 */

export type ItemModelKind = 'flat' | 'block' | 'unresolved';

export interface ItemModelBehavior {
  /** Item model name (the file stem under `models/item/`). */
  assetId: string;
  kind: ItemModelKind;
  /** Bedrock texture paths (no extension) the model's own declaration resolves to. */
  sheets: string[];
  /** Parent chain as declared by the source, child pointer first. */
  chain: string[];
  evidence: string;
}

const MAX_DEPTH = 12;
const FLAT_PARENT = /(?:^|\/)(?:generated|handheld|handheld_rod|handheld_mace|template_[a-z0-9_]+)$/i;
const BLOCK_PARENT =
  /(?:^|\/)(?:block|cube|stairs?|slab|cross|leaves|door|chest|ladder|pane|fence|wall|carpet|orientable|column|log|plant|trapdoor)/i;
const SPRITE_KEYS = ['layer0', 'layer1', 'texture', 'all', 'particle', 'side', 'top', 'bottom', 'front', 'base'];

const decoder = new TextDecoder();

/** Indexes every `models/item|block/*.json` document by its path relative to `models/`. */
export function collectItemModelDocs(
  entries: ExtractedZipEntry[],
): Map<string, Record<string, unknown>> {
  const docs = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    const path = entry.path.replace(/\\/g, '/').toLowerCase();
    const match = path.match(/(?:^|\/)models\/((?:item|block)\/.+)\.json$/);
    if (!match) continue;
    const rel = match[1];
    if (docs.has(rel)) continue;
    try {
      const parsed = JSON.parse(decoder.decode(entry.data)) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') docs.set(rel, parsed);
    } catch {
      // A malformed model contributes nothing; the IR/validator reports it.
    }
  }
  return docs;
}

/** A `parent` pointer reduced to its key inside the `models/` folder. */
function parentKey(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  return text.replace(/^[a-z0-9_.-]+:/i, '').replace(/^models\//i, '').toLowerCase();
}

/** Rewrites a declared Java texture reference to a Bedrock `textures/…` path. */
function bedrockSheetPath(ref: string): string | null {
  let tail = ref.trim().replace(/^[a-z0-9_.-]+:/i, '').replace(/\.png$/i, '');
  const marker = tail.toLowerCase().lastIndexOf('/textures/');
  if (marker >= 0) tail = tail.slice(marker + '/textures/'.length);
  tail = tail.replace(/^textures\//i, '').replace(/^\/+/, '');
  if (!tail) return null;
  return toBedrockTexturePath(tail);
}

/** Follows `#variable` indirection inside one model's texture map. */
function followAlias(textures: Record<string, string>, start: string | undefined): string | null {
  let value = start;
  let guard = 0;
  while (typeof value === 'string' && value.startsWith('#') && guard < 8) {
    value = textures[value.slice(1)];
    guard += 1;
  }
  if (typeof value !== 'string' || !value || value.startsWith('#')) return null;
  return value;
}

/** Bedrock sheet paths the model's own texture variables point at, best first. */
function declaredSheets(textures: Record<string, string>): string[] {
  const sheets: string[] = [];
  for (const key of [...SPRITE_KEYS, ...Object.keys(textures)]) {
    const ref = followAlias(textures, textures[key]);
    if (!ref) continue;
    const path = bedrockSheetPath(ref);
    if (!path || sheets.includes(path)) continue;
    sheets.push(path);
    if (sheets.length >= 4) break;
  }
  return sheets;
}

interface ModelWalk {
  chain: string[];
  textures: Record<string, string>;
  hasElements: boolean;
  missingParent: boolean;
}

/** Walks the parent chain, collecting texture variables and element evidence. */
function walkModel(docs: Map<string, Record<string, unknown>>, start: string): ModelWalk {
  const chain: string[] = [];
  const textures: Record<string, string> = {};
  let hasElements = false;
  let missingParent = false;
  const visited = new Set<string>();
  let key: string | null = start;
  let depth = 0;

  while (key && depth < MAX_DEPTH) {
    if (visited.has(key)) break;
    visited.add(key);
    const doc = docs.get(key);
    if (!doc) {
      chain.push(key);
      // `item/*` and `block/*` parents are Java's own builtin templates, which no mod archive
      // ships; only a parent outside those namespaces can be a genuinely missing document.
      if (!/^(?:item|block)\//.test(key)) missingParent = true;
      break;
    }
    if (Array.isArray(doc.elements) && doc.elements.length > 0) hasElements = true;
    const map = doc.textures;
    if (map && typeof map === 'object') {
      for (const [name, value] of Object.entries(map as Record<string, unknown>)) {
        if (typeof value === 'string' && !(name in textures)) textures[name] = value;
      }
    }
    const next = parentKey(doc.parent);
    chain.push(next ?? '(root)');
    key = next;
    depth += 1;
  }
  return { chain, textures, hasElements, missingParent };
}

/**
 * Classifies ONE item model from its own declarations. Returns null when the archive
 * ships no item model for that name — the caller then keeps its previous behaviour
 * instead of inventing a shape.
 */
export function classifyItemModel(
  assetId: string,
  docs: Map<string, Record<string, unknown>>,
): ItemModelBehavior | null {
  const stem = assetId.trim().replace(/^[a-z0-9_.-]+:/i, '').toLowerCase();
  if (!stem) return null;
  const start = docs.has(`item/${stem}`)
    ? `item/${stem}`
    : docs.has(`block/${stem}`)
      ? `block/${stem}`
      : null;
  if (!start) return null;

  const walk = walkModel(docs, start);
  const sheets = declaredSheets(walk.textures);
  const flatParent = walk.chain.find((entry) => FLAT_PARENT.test(entry));
  const blockParent = walk.chain.find((entry) => BLOCK_PARENT.test(entry));
  const sprite = sheets[0] ?? 'no declared sheet';

  let kind: ItemModelKind;
  let evidence: string;
  if (flatParent) {
    kind = 'flat';
    evidence = `parent chain resolves to the Java sprite template "${flatParent}", so the item is a flat sprite drawn from ${sprite}`;
  } else if (blockParent || walk.hasElements || start.startsWith('block/')) {
    kind = 'block';
    evidence = `parent chain resolves to the cube model "${blockParent ?? start}"${
      walk.hasElements ? ' with its own elements' : ''
    }, so the item renders through its block sheet ${sprite}`;
  } else if (sheets.length > 0) {
    kind = 'flat';
    evidence = `no cube parent in the chain, so the item is treated as the flat sprite ${sprite}`;
  } else {
    kind = 'unresolved';
    evidence = `parent chain "${walk.chain.join(' -> ')}" declares neither a sprite texture nor cube elements, so no Bedrock shape can be derived`;
  }
  if (walk.missingParent) evidence += '; a parent document is absent from the archive, so the chain stops there';

  return { assetId: stem, kind, sheets, chain: walk.chain, evidence };
}

/** Classifies every item model the archive ships, keyed by its lowercase model name. */
export function classifyItemModels(entries: ExtractedZipEntry[]): Map<string, ItemModelBehavior> {
  const docs = collectItemModelDocs(entries);
  const models = new Map<string, ItemModelBehavior>();
  for (const rel of docs.keys()) {
    if (!rel.startsWith('item/')) continue;
    const behavior = classifyItemModel(rel.slice('item/'.length), docs);
    if (behavior) models.set(behavior.assetId, behavior);
  }
  return models;
}

/** Finds a classification by any alias of the same item (identifier, icon key, file stem). */
export function findItemModelBehavior(
  models: Map<string, ItemModelBehavior>,
  ...keys: Array<string | null | undefined>
): ItemModelBehavior | null {
  for (const key of keys) {
    const clean = key?.trim().replace(/^[a-z0-9_.-]+:/i, '').toLowerCase();
    if (!clean) continue;
    const direct = models.get(clean);
    if (direct) return direct;
    const reduced = clean.replace(/[^a-z0-9]/g, '');
    if (reduced.length < 3) continue;
    for (const [id, behavior] of models) {
      if (id.replace(/[^a-z0-9]/g, '') === reduced) return behavior;
    }
  }
  return null;
}