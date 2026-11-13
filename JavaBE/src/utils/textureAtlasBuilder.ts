/**
 * Texture atlas isolation engine.
 *
 * Entity definitions and texture assets are two different things: an entity JSON path is
 * not a texture path, and an atlas entry is only readable when it points at a PNG that
 * actually ships. This module rebuilds `textures/item_texture.json` from real item
 * textures only and `textures/terrain_texture.json` from real block textures only,
 * resolves entity skins independently of both atlases, strips internal validator labels
 * out of shipped resource paths, and drops every phantom reference it finds.
 */

type PackFiles = Record<string, string | Uint8Array>;

const decoder = new TextDecoder();
const ITEM_ATLAS = 'textures/item_texture.json';
const TERRAIN_ATLAS = 'textures/terrain_texture.json';
/** Words that belong to the audit UI — they must never reach a resource path. */
const LABEL_PATTERN = /\b(UNMATCHED|UNRESOLVED|ABSENT|INVENTED|SCAFFOLD|ADAPTED|VALIDATOR|PLACEHOLDER|MISSING)\b/;

function decode(data: string | Uint8Array | undefined): string | null {
  if (data == null) return null;
  if (typeof data === 'string') return data;
  try {
    return decoder.decode(data);
  } catch {
    return null;
  }
}

function readJson(data: string | Uint8Array | undefined): Record<string, any> | null {
  const text = decode(data);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

/** Removes bracket-paren annotations and validator vocabulary from a path segment. */
function cleanLabel(raw: string): { value: string; removed: boolean } {
  if (!LABEL_PATTERN.test(raw)) return { value: raw, removed: false };
  const value = raw
    .replace(/[[(][^\])]*[)\]]/g, ' ')
    .replace(new RegExp(LABEL_PATTERN.source, 'gi'), ' ')
    .replace(/[^A-Za-z0-9_./-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');
  return { value, removed: true };
}

function normalizeRef(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.png$/i, '');
}

function pngIndex(files: PackFiles): Map<string, string> {
  const index = new Map<string, string>();
  for (const [path, data] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith('.png') || data == null) continue;
    // A zero-length PNG is dropped at export, so it can never back an atlas entry.
    const size = typeof data === 'string' ? data.length : data.byteLength;
    if (!size) continue;
    const clean = path.replace(/\\/g, '/');
    index.set(clean.toLowerCase(), clean.slice(0, -4));
  }
  return index;
}

function findPng(index: Map<string, string>, ref: string): string | null {
  return index.get(`${normalizeRef(ref)}.png`.toLowerCase()) ?? null;
}

function collectMaterialTextures(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((entry) => collectMaterialTextures(entry, out));
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'material_instances' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const instance of Object.values(value as Record<string, unknown>)) {
        const texture = instance && typeof instance === 'object'
          ? (instance as Record<string, unknown>).texture
          : undefined;
        if (typeof texture === 'string' && texture.length > 0) out.push(texture);
      }
      continue;
    }
    collectMaterialTextures(value, out);
  }
}

export interface TextureGraphReport {
  textures: number;
  referenced: number;
  orphanTextures: string[];
}

/** Dependency graph: which shipped texture the generated definitions actually consume. */
export function auditTextureDependencies(rp: PackFiles, bp: PackFiles): TextureGraphReport {
  const index = pngIndex(rp);
  const consumed = new Set<string>();
  for (const [path, data] of Object.entries(rp)) {
    const lower = path.toLowerCase();
    if (!/^(entity|attachables)\/.+\.json$/.test(lower)) continue;
    const doc = readJson(data);
    const description = lower.startsWith('entity/')
      ? doc?.['minecraft:client_entity']?.description
      : doc?.['minecraft:attachable']?.description;
    const textures = description?.textures;
    if (!textures || typeof textures !== 'object') continue;
    for (const value of Object.values(textures as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      const found = findPng(index, value);
      if (found) consumed.add(found);
    }
  }
  for (const [path, data] of Object.entries(bp)) {
    const lower = path.toLowerCase();
    if (!/^(blocks|items)\/.+\.json$/.test(lower)) continue;
    const doc = readJson(data);
    if (!doc) continue;
    const materialTextures: string[] = [];
    collectMaterialTextures(doc, materialTextures);
    for (const texture of materialTextures) {
      const found = findPng(index, `textures/blocks/${texture}`);
      if (found) consumed.add(found);
    }
    const icon = doc?.['minecraft:item']?.components?.['minecraft:icon'];
    const iconKey = typeof icon === 'string'
      ? icon
      : typeof icon?.texture === 'string'
        ? icon.texture
        : typeof icon?.textures?.default === 'string' ? icon.textures.default : '';
    if (iconKey) {
      const found = findPng(index, `textures/items/${iconKey}`) ?? findPng(index, `textures/blocks/${iconKey}`);
      if (found) consumed.add(found);
    }
  }
  const all = [...index.values()];
  const orphanTextures = all.filter(
    (path) => !consumed.has(path) && !/^textures\/(items|blocks)\//i.test(path),
  );
  return { textures: all.length, referenced: consumed.size, orphanTextures };
}

export interface AtlasReport {
  itemEntries: number;
  terrainEntries: number;
  phantomsRemoved: number;
  labelsRemoved: number;
  entityTexturesRepaired: number;
  entityTexturesMissing: string[];
  missingDefinitions: string[];
  orphanTextures: number;
  log: string[];
}

/**
 * Rebuilds both atlases from the PNGs that shipped and rewrites entity texture
 * references against real files. An entry that cannot resolve is removed (a phantom
 * entry makes Bedrock drop the whole atlas); a missing entity skin is reported instead
 * of being substituted.
 */
export function rebuildTextureAtlases(options: {
  resourcePackFiles: PackFiles;
  behaviorPackFiles?: PackFiles;
  onLog?: (line: string) => void;
}): AtlasReport {
  const rp = options.resourcePackFiles;
  const bp = options.behaviorPackFiles ?? {};
  const index = pngIndex(rp);
  const report: AtlasReport = {
    itemEntries: 0,
    terrainEntries: 0,
    phantomsRemoved: 0,
    labelsRemoved: 0,
    entityTexturesRepaired: 0,
    entityTexturesMissing: [],
    missingDefinitions: [],
    orphanTextures: 0,
    log: [],
  };
  const itemEntries = new Map<string, string>();
  const terrainEntries = new Map<string, string>();

  // 1. Keep only atlas entries that point at a texture this pack really ships.
  for (const [atlasPath, target] of [[ITEM_ATLAS, itemEntries], [TERRAIN_ATLAS, terrainEntries]] as const) {
    const doc = readJson(rp[atlasPath]);
    const data = doc?.texture_data;
    if (!data || typeof data !== 'object') continue;
    for (const [key, entry] of Object.entries(data as Record<string, unknown>)) {
      const rawRef = typeof entry === 'string'
        ? entry
        : typeof (entry as Record<string, unknown>)?.textures === 'string'
          ? String((entry as Record<string, unknown>).textures)
          : '';
      if (!rawRef) {
        report.phantomsRemoved += 1;
        continue;
      }
      // An entity definition path is never a texture path.
      if (/\.(entity\.)?json$/i.test(rawRef) || /\.entity$/i.test(rawRef)) {
        report.phantomsRemoved += 1;
        report.log.push(`[ATLAS] Dropped "${key}" from ${atlasPath}: it pointed at an entity definition, not a texture.`);
        continue;
      }
      const keyClean = cleanLabel(key);
      if (keyClean.removed) report.labelsRemoved += 1;
      const refClean = cleanLabel(normalizeRef(rawRef));
      if (refClean.removed) report.labelsRemoved += 1;
      const found = findPng(index, refClean.value);
      const itemAtlas = target === itemEntries;
      const wrongAtlas = itemAtlas
        ? /^textures\/(entity|blocks)\//i.test(refClean.value)
        : /^textures\/(entity|items)\//i.test(refClean.value);
      if (!found || wrongAtlas) {
        report.phantomsRemoved += 1;
        if (report.log.filter((line) => line.startsWith('[ATLAS] Dropped')).length < 12) {
          report.log.push(
            `[ATLAS] Dropped "${key}" from ${atlasPath}: ${found ? 'the texture belongs to a different atlas' : 'no shipped PNG matches that path'}.`,
          );
        }
        continue;
      }
      const finalKey = keyClean.value.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
      if (!finalKey) {
        report.phantomsRemoved += 1;
        continue;
      }
      target.set(finalKey, found);
    }
  }

  // 2. Every shipped item / block texture is a real atlas entry; nothing else is.
  for (const ref of index.values()) {
    const local = ref.split('/').slice(0, 2).join('/').toLowerCase();
    const stem = ref.split('/').pop() ?? '';
    if (local !== 'textures/items' && local !== 'textures/blocks') continue;
    if (!stem) continue;
    if (local === 'textures/items') itemEntries.set(stem, ref);
    else terrainEntries.set(stem, ref);
  }

  // 3. Item definitions resolve their own icon against a shipped sheet. The mod's own item
  //    texture is preferred; a block sheet that carries the same name is the same picture, so
  //    it is carried verbatim into textures/items — the only folder the item atlas reads.
  for (const [path, data] of Object.entries(bp)) {
    if (!/^items\/.+\.json$/i.test(path)) continue;
    const doc = readJson(data);
    const description = doc?.['minecraft:item']?.description;
    if (!description) continue;
    const itemId = String(description.identifier ?? '').replace(/^[a-z0-9_.-]+:/i, '');
    const icon = doc?.['minecraft:item']?.components?.['minecraft:icon'];
    const iconKey = (typeof icon === 'string'
      ? icon
      : typeof icon?.texture === 'string'
        ? icon.texture
        : typeof icon?.textures?.default === 'string' ? icon.textures.default : '').trim();
    const candidates = [cleanLabel(iconKey).value, itemId].filter(Boolean);
    let found = candidates.map((key) => findPng(index, `textures/items/${key}`)).find(Boolean) ?? null;
    if (!found) {
      const source = candidates
        .map((key) => findPng(index, `textures/blocks/${key}`) ?? findPng(index, `textures/block/${key}`))
        .find(Boolean) ?? null;
      const bytes = source ? rp[`${source}.png`] : undefined;
      if (source && bytes != null) {
        const target = `textures/items/${cleanLabel(iconKey).value || itemId}`;
        rp[`${target}.png`] = bytes;
        index.set(`${target}.png`.toLowerCase(), target);
        found = target;
        report.log.push(
          `[ATLAS] Item icon carried verbatim from ${source}.png to ${target}.png — a block-derived item shows the sheet the mod ships for it; nothing is redrawn.`,
        );
      }
    }
    if (!found) {
      report.missingDefinitions.push(`item ${itemId || path} has no shipped icon texture`);
      continue;
    }
    itemEntries.set(cleanLabel(iconKey).value || itemId, found);
  }

  // 4. Block material instances resolve against shipped block textures only.
  for (const [path, data] of Object.entries(bp)) {
    if (!/^blocks\/.+\.json$/i.test(path)) continue;
    const doc = readJson(data);
    if (!doc) continue;
    const referenced: string[] = [];
    collectMaterialTextures(doc, referenced);
    const blockId = String(doc?.['minecraft:block']?.description?.identifier ?? path)
      .replace(/^[a-z0-9_.-]+:/i, '');
    for (const texture of referenced) {
      const key = cleanLabel(texture).value;
      if (cleanLabel(texture).removed) report.labelsRemoved += 1;
      const found = findPng(index, `textures/blocks/${key}`) ?? findPng(index, key);
      if (!found) {
        report.missingDefinitions.push(`block ${blockId} material instance "${texture}" has no shipped texture`);
        continue;
      }
      terrainEntries.set(key || found.split('/').pop() || blockId, found);
    }
  }

  // 5. Entity textures resolve independently of both atlases, and an entity definition
  //    path is never treated as a texture path.
  const entitySheets = [...index.values()].filter((ref) => /^textures\/entity\//i.test(ref));
  const sheetTokens = (value: string): string[] =>
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4);
  /**
   * A shipped entity sheet whose file name drifted from the mob id (`obsidianwraith.png` for
   * `obsidian_wraith`) still belongs to that mob when it carries every distinctive word of the
   * id. Only a unique match is accepted, and nothing is ever substituted or generated here.
   */
  const findEntitySheetByTokens = (mobId: string): string | null => {
    const wanted = sheetTokens(mobId);
    if (wanted.length === 0) return null;
    const matches = entitySheets.filter((ref) => {
      const scope = new Set(sheetTokens(ref.slice('textures/entity/'.length)));
      return wanted.every((token) => scope.has(token));
    });
    return matches.length === 1 ? matches[0] : null;
  };

  // 5. Entity textures resolve independently of both atlases, and an entity definition
  //    path is never treated as a texture path.
  for (const path of Object.keys(rp)) {
    if (!/^entity\/[^/]+\.entity\.json$/i.test(path)) continue;
    const mobId = path.slice('entity/'.length, -'.entity.json'.length);
    const doc = readJson(rp[path]);
    const description = doc?.['minecraft:client_entity']?.description;
    const textures = description?.textures;
    if (!textures || typeof textures !== 'object') continue;
    let changed = false;
    const tokenMatch = findEntitySheetByTokens(mobId);
    for (const [key, value] of Object.entries(textures as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      const bare = cleanLabel(normalizeRef(value)).value.replace(/\.(entity|json)$/i, '');
      const candidates = [
        bare,
        `textures/entity/${mobId}`,
        `textures/entity/${mobId}/${mobId}`,
        // Nested Java skins (`entity/<mob>/<skin>`) are addressed by stem.
        `textures/entity/${mobId}/${bare.split('/').pop() ?? ''}`,
        ...(tokenMatch ? [tokenMatch] : []),
      ];
      const found = candidates.map((candidate) => findPng(index, candidate)).find(Boolean) ?? null;
      if (found) {
        if (found !== value) {
          (textures as Record<string, unknown>)[key] = found;
          report.entityTexturesRepaired += 1;
          changed = true;
          if (found === tokenMatch) {
            report.log.push(
              `[ATLAS] Entity texture "${mobId}" resolved to shipped sheet ${found}.png by full name-token match (evidence: ${value} did not exist).`,
            );
          }
        }
        continue;
      }
      // Genuinely absent: reported so the audit can show an UNMATCHED texture. No path is
      // invented and no sheet is fabricated to make the count look better.
      report.entityTexturesMissing.push(`${mobId}:${key} → ${value}`);
    }
    if (changed) rp[path] = JSON.stringify(doc, null, 2);
  }

  // 6. Write the atlases back. The terrain atlas only exists when blocks shipped.
  const sortedData = (entries: Map<string, string>) => {
    const data: Record<string, { textures: string }> = {};
    for (const key of [...entries.keys()].sort()) data[key] = { textures: entries.get(key) as string };
    return data;
  };
  rp[ITEM_ATLAS] = JSON.stringify(
    { resource_pack_name: 'vanilla', texture_name: 'atlas.items', texture_data: sortedData(itemEntries) },
    null,
    2,
  );
  if (terrainEntries.size > 0) {
    rp[TERRAIN_ATLAS] = JSON.stringify(
      {
        resource_pack_name: 'vanilla',
        texture_name: 'atlas.terrain',
        padding: 8,
        num_mip_levels: 4,
        texture_data: sortedData(terrainEntries),
      },
      null,
      2,
    );
  } else {
    delete rp[TERRAIN_ATLAS];
  }
  report.itemEntries = itemEntries.size;
  report.terrainEntries = terrainEntries.size;

  const graph = auditTextureDependencies(rp, bp);
  report.orphanTextures = graph.orphanTextures.length;
  report.log.unshift(
    `[ATLAS] Texture isolation: item atlas ${report.itemEntries} entr(y/ies) from shipped item textures, terrain atlas ${report.terrainEntries} entr(y/ies) from shipped block textures, ${report.phantomsRemoved} phantom reference(s) removed, ${report.labelsRemoved} internal label(s) stripped, ${report.entityTexturesRepaired} entity texture path(s) resolved independently.`,
  );
  if (report.entityTexturesMissing.length > 0) {
    report.log.push(
      `[ATLAS:WARN] ${report.entityTexturesMissing.length} client entity texture(s) have no shipped PNG and stay UNMATCHED: ${report.entityTexturesMissing.slice(0, 6).join(' | ')}${report.entityTexturesMissing.length > 6 ? ' …' : ''}`,
    );
  }
  if (report.missingDefinitions.length > 0) {
    report.log.push(
      `[ATLAS:WARN] ${report.missingDefinitions.length} definition(s) reference a texture that does not ship: ${report.missingDefinitions.slice(0, 6).join(' | ')}${report.missingDefinitions.length > 6 ? ' …' : ''}`,
    );
  }
  if (report.orphanTextures > 0) {
    report.log.push(
      `[ATLAS] ${report.orphanTextures} shipped texture(s) are referenced by no entity, block or item definition — flagged as orphaned, nothing was deleted.`,
    );
  }
  for (const line of report.log) options.onLog?.(line);
  return report;
}