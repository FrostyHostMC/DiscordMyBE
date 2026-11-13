import type { PackFile } from '@/utils/entityTextureVariants';
import { readPngDimensions } from '@/utils/pngUtils';
import { findItemModelBehavior, type ItemModelBehavior } from '@/utils/itemModelNormalizer';

/**
 * Item icon / atlas integrity.
 *
 * A custom item only shows in an inventory when `minecraft:icon` names a key the item atlas
 * resolves to a shipped PNG, and the key must be written in the modern
 * `{ "textures": { "default": … } }` form the 1.21.30+ item schema expects — the legacy
 * `{ "texture": … }` member is rejected with "this member was found in the input, but is not
 * present in the Schema". A key that resolves to nothing logs "Missing referenced asset".
 *
 * Every rule below is driven by the file's own content and the textures the pack ships, so it
 * behaves the same for any Java mod:
 *   a. an icon is resolved from the item's own texture, then from the block sheet the same mod
 *      ships for that name, then from any shipped sheet that carries the item's own name;
 *   b. a resolved sheet outside `textures/items` is carried there byte-for-byte (the item
 *      atlas only reads that folder) — never redrawn, never re-encoded;
 *   c. an icon that cannot resolve anywhere is removed together with its atlas entry instead
 *      of being shipped as a dangling reference, and reported as UNRESOLVED;
 *   d. atlas entries that point at an unshipped file are pruned, because one phantom entry
 *      can drop the whole atlas;
 *   e. a block rendering through `minecraft:geometry` must not also carry a legacy
 *      `blocks.json` override.
 */

export const ITEM_ICON_RULE =
  'An inventory-visible item needs a minecraft:icon written as { "textures": { "default": … } } whose key textures/item_texture.json resolves to a shipped PNG. A block using minecraft:geometry must not carry a legacy blocks.json entry.';

const CANONICAL_ICON_FOLDER = 'textures/items/';
/** Folders searched for an item's own sheet, in the order the client resolves them. */
const ICON_SOURCE_FOLDERS = ['textures/items/', 'textures/item/', 'textures/blocks/', 'textures/block/'];

interface AtlasDocument {
  resource_pack_name?: string;
  texture_name?: string;
  texture_data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ItemIconAudit {
  itemsChecked: number;
  iconsRepaired: number;
  iconsDropped: number;
  texturesCarried: number;
  atlasEntriesAdded: number;
  atlasPhantomsRemoved: number;
  missingIcons: string[];
  blockOverridesRemoved: number;
  conflicts: string[];
  /** Items the Java source declared as `item/generated`/`item/handheld` flat sprites. */
  flatSpriteItems: number;
  /** Items the Java source declared as cube (block-backed) models. */
  blockBackedItems: number;
  /** Block-backed items that ship no block definition, so the cube has nothing to render. */
  blockBackedWithoutBlock: string[];
}

function parseJson(value: PackFile | undefined): Record<string, any> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function isShippedPng(files: Record<string, PackFile>, path: string): boolean {
  const bytes = files[`${path}.png`];
  if (!(bytes instanceof Uint8Array)) return false;
  return readPngDimensions(bytes) != null;
}

/** Reads the icon key from every accepted declaration form. */
function iconKeyOf(component: unknown): string | null {
  if (typeof component === 'string') return component;
  if (component && typeof component === 'object') {
    const record = component as Record<string, unknown>;
    if (typeof record.texture === 'string') return record.texture;
    const textures = record.textures;
    if (textures && typeof textures === 'object') {
      const preferred = (textures as Record<string, unknown>).default;
      if (typeof preferred === 'string') return preferred;
    }
  }
  return null;
}

function atlasReferenceOf(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const textures = (entry as Record<string, unknown>).textures;
    if (typeof textures === 'string') return textures;
    if (Array.isArray(textures) && typeof textures[0] === 'string') return textures[0];
  }
  return null;
}

/**
 * Resolves an atlas texture reference to a shipped sheet.
 *
 * Atlas values appear both with and without the `textures/` prefix (`textures/items/rune`
 * and `items/rune` are the same file), so both forms are tried before a reference is called
 * unresolvable.
 */
function resolveAtlasReference(files: Record<string, PackFile>, reference: string): string | null {
  const cleaned = reference.replace(/\\/g, '/').replace(/\.png$/i, '').replace(/^\/+/, '');
  if (!cleaned) return null;
  const candidates = cleaned.startsWith('textures/') ? [cleaned] : [`textures/${cleaned}`, cleaned];
  for (const candidate of candidates) {
    if (isShippedPng(files, candidate)) return candidate;
  }
  return null;
}

/** Name reduced to letters and digits, so `mudbrick` and `mud_brick` are the same name. */
function reducedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Path (without extension) of a shipped sheet that carries this asset's own name.
 *
 * Layer 1 matches the name exactly in the folders the client resolves an icon from.
 * Layer 2 matches the same name anywhere under `textures/` (Java mods scatter one picture
 * across item/, block/, models/ and entity/ trees). Layer 3 accepts a sheet whose name
 * reduces to the same letters and digits, because Java identifiers and file names routinely
 * differ only in separators (`mud_brick` vs `mudbrick`, `inca_roof` vs `incaroof`). Every
 * layer still requires a real PNG payload that ships in the pack, so no artwork is invented.
 */
function resolveShippedTexture(files: Record<string, PackFile>, assetId: string): string | null {
  const cleanId = assetId.replace(/[^A-Za-z0-9_.-]+/g, '_');
  if (!cleanId) return null;
  for (const folder of ICON_SOURCE_FOLDERS) {
    const candidate = `${folder}${cleanId}`;
    if (isShippedPng(files, candidate)) return candidate;
  }
  const suffix = `/${cleanId}`.toLowerCase();
  for (const [path, data] of Object.entries(files)) {
    if (!(data instanceof Uint8Array)) continue;
    const lower = path.toLowerCase();
    if (!lower.startsWith('textures/') || !lower.endsWith('.png')) continue;
    if (!lower.slice(0, -4).endsWith(suffix)) continue;
    const candidate = path.slice(0, -4);
    if (isShippedPng(files, candidate)) return candidate;
  }
  // Reduced-name layer: same letters and digits, different separators.
  const wanted = reducedName(cleanId);
  if (wanted.length < 3) return null;
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const [path, data] of Object.entries(files)) {
    if (!(data instanceof Uint8Array)) continue;
    const lower = path.toLowerCase();
    if (!lower.startsWith('textures/') || !lower.endsWith('.png')) continue;
    const candidate = path.slice(0, -4);
    const stem = candidate.split('/').pop() ?? '';
    if (reducedName(stem) !== wanted) continue;
    if (!isShippedPng(files, candidate)) continue;
    // Prefer the folder the item atlas reads, then the shortest path.
    const score = (/\/items?\//.test(candidate) ? 0 : 1) * 100 + candidate.split('/').length;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Texture short names a block definition declares through `minecraft:material_instances`.
 *
 * A Java block exposed as an item frequently carries a texture whose name has nothing to do
 * with the item identifier (`mudbrick_stairs_inner` renders `mudbrick`). The block's own
 * material declaration is structural evidence of which picture that item uses, so it is read
 * before any name-based guess. Only definitions whose identifier reduces to the same name are
 * compared, so an unrelated block can never supply an icon.
 */
function blockMaterialReferences(
  behaviorPackFiles: Record<string, PackFile>,
  assetId: string,
): string[] {
  const wanted = [assetId.toLowerCase(), reducedName(assetId)].filter(Boolean);
  if (wanted.length === 0) return [];
  const references: string[] = [];
  for (const path of Object.keys(behaviorPackFiles)) {
    if (!/^blocks\/[^/]+\.json$/i.test(path)) continue;
    const doc = parseJson(behaviorPackFiles[path]);
    const blockRoot = doc?.['minecraft:block'] as Record<string, any> | undefined;
    const identifier = String(blockRoot?.description?.identifier ?? '')
      .replace(/^[a-z0-9_.-]+:/i, '')
      .trim();
    if (!identifier) continue;
    if (!wanted.includes(identifier.toLowerCase()) && !wanted.includes(reducedName(identifier))) continue;
    const instances = blockRoot?.components?.['minecraft:material_instances'];
    if (!instances || typeof instances !== 'object') continue;
    for (const instance of Object.values(instances as Record<string, unknown>)) {
      const texture = instance && typeof instance === 'object'
        ? (instance as Record<string, unknown>).texture
        : undefined;
      if (typeof texture === 'string' && texture.trim()) references.push(texture.trim());
    }
  }
  return references;
}

/**
 * Sheet a block definition's own material instances point at, when that PNG really ships.
 *
 * This is the evidence layer that keeps a block-derived item from losing its icon: the
 * picture the block renders with is the picture its inventory entry must show, whatever the
 * item identifier is called.
 */
function resolveFromBlockEvidence(
  files: Record<string, PackFile>,
  behaviorPackFiles: Record<string, PackFile>,
  assetId: string,
): string | null {
  for (const reference of blockMaterialReferences(behaviorPackFiles, assetId)) {
    const cleaned = reference
      .replace(/\\/g, '/')
      .replace(/\.png$/i, '')
      .replace(/^\/+/, '')
      .trim();
    if (!cleaned) continue;
    const stem = cleaned.split('/').pop() ?? cleaned;
    const candidates = cleaned.startsWith('textures/')
      ? [cleaned, `textures/blocks/${stem}`, `textures/items/${stem}`]
      : [`textures/blocks/${cleaned}`, `textures/block/${cleaned}`, `textures/items/${cleaned}`, `textures/${cleaned}`];
    for (const candidate of candidates) {
      if (isShippedPng(files, candidate)) return candidate;
    }
    const byName = resolveShippedTexture(files, stem);
    if (byName) return byName;
  }
  return null;
}

/** Carries a resolved sheet into `textures/items` verbatim so the item atlas can read it. */
function carryIntoIconFolder(
  files: Record<string, PackFile>,
  source: string,
  assetId: string,
): { path: string; carried: boolean } {
  if (source.startsWith(CANONICAL_ICON_FOLDER)) return { path: source, carried: false };
  const target = `${CANONICAL_ICON_FOLDER}${assetId}`;
  if (isShippedPng(files, target)) return { path: target, carried: true };
  const bytes = files[`${source}.png`];
  if (!(bytes instanceof Uint8Array)) return { path: source, carried: false };
  files[`${target}.png`] = bytes;
  return { path: target, carried: true };
}

/**
 * Path the pack's OWN texture atlas already maps this key to, when that file really ships.
 *
 * A Java block exposed as an item often lands in the item atlas under the block's short name
 * while no `textures/items` sheet carries that name. The pack's own atlas declaration is
 * source evidence for which picture the asset uses, so it is read instead of guessing — and
 * still only when the referenced PNG actually exists.
 */
function resolveFromAtlasDeclaration(files: Record<string, PackFile>, key: string): string | null {
  const wanted = [key.toLowerCase(), reducedName(key)];
  for (const atlasPath of ['textures/item_texture.json', 'textures/terrain_texture.json']) {
    const atlas = parseJson(files[atlasPath]);
    const data = atlas?.texture_data as Record<string, unknown> | undefined;
    if (!data) continue;
    for (const [entryKey, entry] of Object.entries(data)) {
      if (!wanted.includes(entryKey.toLowerCase()) && !wanted.includes(reducedName(entryKey))) continue;
      const reference = atlasReferenceOf(entry);
      if (!reference) continue;
      const resolved = resolveAtlasReference(files, reference);
      if (resolved) return resolved;
    }
  }
  return null;
}

/**
 * Sheet the Java item model itself declares, when that PNG really ships.
 *
 * The source mod states, in its own `models/item/<name>.json`, which picture the item is
 * drawn from — `textures.layer0` for an `item/generated` sprite, the face texture for a
 * cube model. That declaration is stronger evidence than any filename match, so it is read
 * before block-material inheritance or a name-based guess.
 */
function resolveFromDeclaredItemModel(
  files: Record<string, PackFile>,
  itemModels: Map<string, ItemModelBehavior>,
  keys: Array<string | null | undefined>,
): string | null {
  const behavior = findItemModelBehavior(itemModels, ...keys);
  if (!behavior) return null;
  for (const sheet of behavior.sheets) {
    if (isShippedPng(files, sheet)) return sheet;
    const stem = sheet.split('/').pop() ?? '';
    if (!stem) continue;
    for (const folder of ICON_SOURCE_FOLDERS) {
      const candidate = `${folder}${stem}`;
      if (isShippedPng(files, candidate)) return candidate;
    }
  }
  return null;
}

/** Whether a behavior-pack block definition exists for this item identity. */
function hasBlockDefinition(
  behaviorPackFiles: Record<string, PackFile>,
  identifier: string,
  itemId: string,
): boolean {
  const wanted = [identifier.toLowerCase(), itemId.toLowerCase()];
  const wantedReduced = [reducedName(identifier.split(':').pop() ?? identifier), reducedName(itemId)];
  for (const path of Object.keys(behaviorPackFiles)) {
    if (!/^blocks\/[^/]+\.json$/i.test(path)) continue;
    const blockId = parseJson(behaviorPackFiles[path])?.['minecraft:block']?.description?.identifier;
    if (typeof blockId !== 'string') continue;
    if (wanted.includes(blockId.trim().toLowerCase())) return true;
    const short = blockId.split(':').pop() ?? blockId;
    const candidate = reducedName(short);
    if (wantedReduced.includes(candidate)) return true;
    // An item model and the block it renders are routinely named differently
    // (`mudbrick_stairs_inner` renders the block `mudbrick_stairs`), so a containment match
    // in either direction counts as the same asset.
    if (
      candidate.length >= 4 &&
      wantedReduced.some(
        (wanted) => wanted.length >= 4 && (candidate.includes(wanted) || wanted.includes(candidate)),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Repairs item icon declarations, atlas coverage and legacy block overrides. */
export function enforceItemIconsAndBlockGeometry(input: {
  modId: string;
  resourcePackFiles: Record<string, PackFile>;
  behaviorPackFiles: Record<string, PackFile>;
  /** Item models classified from the Java source's own parent pointers, when available. */
  itemModels?: Map<string, ItemModelBehavior> | null;
  onLog?: (line: string) => void;
}): ItemIconAudit {
  const { resourcePackFiles: rp, behaviorPackFiles: bp, modId } = input;
  const itemModels = input.itemModels ?? null;
  const audit: ItemIconAudit = {
    itemsChecked: 0,
    iconsRepaired: 0,
    iconsDropped: 0,
    texturesCarried: 0,
    atlasEntriesAdded: 0,
    atlasPhantomsRemoved: 0,
    missingIcons: [],
    blockOverridesRemoved: 0,
    conflicts: [],
    flatSpriteItems: 0,
    blockBackedItems: 0,
    blockBackedWithoutBlock: [],
  };

  let atlas = parseJson(rp['textures/item_texture.json']) as AtlasDocument | null;
  if (!atlas) {
    atlas = { resource_pack_name: 'vanilla', texture_name: 'atlas.items', texture_data: {} };
  }
  const textureData = (atlas.texture_data = atlas.texture_data ?? {});
  let atlasChanged = false;

  const itemPaths = Object.keys(bp).filter((path) => /^items\/.+\.json$/i.test(path));
  for (const path of itemPaths) {
    const doc = parseJson(bp[path]);
    const itemRoot = doc?.['minecraft:item'] as Record<string, any> | undefined;
    if (!doc || !itemRoot) continue;
    audit.itemsChecked += 1;
    const itemId = (path.split('/').pop() ?? path).replace(/\.json$/i, '');
    const components = (itemRoot.components as Record<string, any> | undefined) ?? {};
    const iconKey = iconKeyOf(components['minecraft:icon']);
    const descriptor = itemRoot.description as Record<string, any> | undefined;
    const identifier = typeof descriptor?.identifier === 'string' ? descriptor.identifier : `${modId}:${itemId}`;
    const atlasKey = (iconKey ?? itemId).trim();

    // Shape evidence from the Java model's own parent pointer. A block-backed model needs a
    // block definition to render its cube; without one the item falls back to a flat sprite,
    // which is reported instead of being silently accepted.
    if (itemModels) {
      const behavior = findItemModelBehavior(itemModels, itemId, atlasKey, identifier);
      if (behavior?.kind === 'flat') audit.flatSpriteItems += 1;
      if (behavior?.kind === 'block') {
        audit.blockBackedItems += 1;
        if (!hasBlockDefinition(bp, identifier, itemId)) {
          audit.blockBackedWithoutBlock.push(identifier);
          input.onLog?.(
            `[ITEMMODEL:WARN] Item "${identifier}" is a cube (block-backed) Java model (${behavior.evidence}), but no block with that identifier ships — the cube has nothing to render from, so the item can only appear as its flat sprite.`,
          );
        }
      }
    }

    const existingReference = atlasReferenceOf(textureData[atlasKey]);
    const entryResolves = existingReference ? resolveAtlasReference(rp, existingReference) != null : false;

    if (entryResolves) {
      // Registered and resolvable: only the declaration form may need normalising.
      const modern = { textures: { default: atlasKey } };
      if (JSON.stringify(components['minecraft:icon']) !== JSON.stringify(modern)) {
        itemRoot.components = { ...components, 'minecraft:icon': modern };
        bp[path] = JSON.stringify(doc, null, 2);
        audit.iconsRepaired += 1;
        input.onLog?.(
          `[SCHEMA] Item "${identifier}": icon written in the { "textures": { "default": … } } form the 1.21.30+ item schema accepts.`,
        );
      }
      continue;
    }

    const resolved =
      resolveShippedTexture(rp, atlasKey) ??
      resolveShippedTexture(rp, itemId) ??
      // The sheet the Java model itself declares is the strongest evidence for the item's own
      // picture, so it is consulted before any block inheritance or name-based guess.
      (itemModels ? resolveFromDeclaredItemModel(rp, itemModels, [itemId, atlasKey]) : null) ??
      // Structural evidence before any name-based guess: the sheet the block's own material
      // instances declare is the picture this item renders with.
      resolveFromBlockEvidence(rp, bp, itemId) ??
      resolveFromAtlasDeclaration(rp, atlasKey) ??
      resolveFromAtlasDeclaration(rp, itemId);
    if (resolved) {
      const carried = carryIntoIconFolder(rp, resolved, atlasKey);
      if (carried.carried) audit.texturesCarried += 1;
      if (textureData[atlasKey] === undefined) audit.atlasEntriesAdded += 1;
      textureData[atlasKey] = { textures: carried.path };
      atlasChanged = true;
      itemRoot.components = { ...components, 'minecraft:icon': { textures: { default: atlasKey } } };
      bp[path] = JSON.stringify(doc, null, 2);
      audit.iconsRepaired += 1;
      input.onLog?.(
        `[SCHEMA] Item "${identifier}": icon "${atlasKey}" bound to the shipped texture ${carried.path}.png${carried.carried ? ` (carried verbatim from ${resolved}.png so the item atlas resolves it)` : ''}.`,
      );
      continue;
    }

    // Nothing in the pack matches: drop the reference instead of shipping a key that resolves
    // to no file, and keep the item visible through its block/behaviour definition.
    if (textureData[atlasKey] !== undefined) {
      delete textureData[atlasKey];
      atlasChanged = true;
    }
    if (components['minecraft:icon'] !== undefined) {
      delete components['minecraft:icon'];
      itemRoot.components = components;
      bp[path] = JSON.stringify(doc, null, 2);
      audit.iconsDropped += 1;
    }
    audit.missingIcons.push(
      `${identifier} (neither a shipped sheet named "${atlasKey}", nor the sheet its own block definition declares, is in this pack)`,
    );
    input.onLog?.(
      `[SCHEMA:UNRESOLVED] Item "${identifier}": no shipped texture carries the name "${atlasKey}" and its own block definition declares none, so the dangling icon reference was removed — no artwork is invented to fill it.`,
    );
  }

  // Prune atlas entries that resolve to nothing: one phantom entry can drop the whole atlas.
  for (const key of Object.keys(textureData)) {
    const reference = atlasReferenceOf(textureData[key]);
    if (reference && resolveAtlasReference(rp, reference)) continue;
    delete textureData[key];
    atlasChanged = true;
    audit.atlasPhantomsRemoved += 1;
  }
  if (audit.atlasPhantomsRemoved > 0) {
    input.onLog?.(
      `[SCHEMA] Removed ${audit.atlasPhantomsRemoved} item atlas entr(y/ies) that pointed at a texture this pack does not ship.`,
    );
  }

  if (atlasChanged) rp['textures/item_texture.json'] = JSON.stringify(atlas, null, 2);

  // Custom block geometry vs. legacy blocks.json overrides.
  const blocksDoc = parseJson(rp['blocks.json']);
  const blockEntries = blocksDoc as Record<string, any> | null;
  let blocksChanged = false;
  if (blockEntries) {
    for (const path of Object.keys(bp).filter((entry) => /^blocks\/[^/]+\.json$/.test(entry))) {
      const doc = parseJson(bp[path]);
      const blockRoot = doc?.['minecraft:block'] as Record<string, any> | undefined;
      const components = (blockRoot?.components as Record<string, any> | undefined) ?? {};
      if (!components['minecraft:geometry']) continue;
      const descriptor = blockRoot?.description as Record<string, any> | undefined;
      const identifier = typeof descriptor?.identifier === 'string' ? descriptor.identifier : null;
      if (!identifier) continue;
      const shortId = identifier.split(':').pop() ?? identifier;
      for (const key of [identifier, shortId]) {
        if (key in blockEntries) {
          delete blockEntries[key];
          audit.blockOverridesRemoved += 1;
          blocksChanged = true;
          audit.conflicts.push(`${identifier} ← legacy blocks.json entry "${key}" removed`);
        }
      }
    }
  }
  if (blocksChanged) rp['blocks.json'] = JSON.stringify(blockEntries, null, 2);

  if (audit.blockOverridesRemoved > 0) {
    input.onLog?.(
      `[SCHEMA] ${audit.blockOverridesRemoved} legacy blocks.json override(s) removed because the block declares minecraft:geometry.`,
    );
  }
  return audit;
}