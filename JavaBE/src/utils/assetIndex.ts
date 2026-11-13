import type { ExtractedZipEntry } from '@/utils/zip';
import { readPngDimensions } from '@/utils/pngUtils';
import { normalizeAssetIdentifier, normalizeAssetPath } from '@/utils/identifierNormalization';

export { normalizeAssetIdentifier, normalizeAssetPath } from '@/utils/identifierNormalization';

export type TextureBucket = 'item' | 'block' | 'entity' | 'gui' | 'particle' | 'other';

export interface IndexedTexture {
  stem: string;
  norm: string;
  /** Path relative to `textures/` without extension, e.g. `entity/flare/flare`. */
  tail: string;
  /** Full lowercase archive path. */
  path: string;
  /** Immediate parent folder name (lowercase). */
  folder: string;
  bucket: TextureBucket;
  width: number;
  height: number;
  data: Uint8Array;
}

export interface JavaElementFace {
  uv?: number[];
  /** Texture variable reference (`#layer0`, `mod:block/stone`, …). */
  texture?: string;
  /** Java per-face texture rotation in degrees. */
  rotation?: number;
  tintindex?: number;
  cullface?: string;
}

export interface JavaElement {
  from?: number[];
  to?: number[];
  /** Legacy element-level box UV origin (`[u, v]`) used when no per-face UVs exist. */
  uv?: number[];
  rotation?: { origin?: number[]; axis?: string; angle?: number; rescale?: boolean };
  faces?: Record<string, JavaElementFace>;
  shade?: boolean;
  /** Optional part name used by multi-part entity models. */
  name?: string;
}

/** One document of a Java model's inheritance chain, child first. */
export interface JavaModelLayer {
  path: string;
  document: Record<string, unknown>;
}

export interface JavaItemOverride {
  predicate?: Record<string, unknown>;
  model?: string;
}

export interface JavaModel {
  stem: string;
  norm: string;
  bucket: 'item' | 'block';
  path: string;
  parent?: string;
  chain: string[];
  textures: Record<string, string>;
  elements: JavaElement[] | null;
  /** Raw inheritance documents (child first) so display/override data is not lost. */
  layers?: JavaModelLayer[];
  /** Parent references declared by the model but absent from the archive. */
  missingParents?: string[];
  /** Where the element list came from; a builtin parent shape is an adaptation. */
  elementsSource?: 'source' | 'builtin_fallback';
  /** Merged `display` transforms per perspective (child overrides parent). */
  display?: Record<string, Record<string, unknown>>;
  overrides?: JavaItemOverride[];
  uvLock?: boolean;
  ambientOcclusion?: boolean;
  guiLight?: string;
}

export interface JavaBlockState {
  stem: string;
  norm: string;
  path: string;
  variants: Record<string, { model: string; x?: number; y?: number }>;
  multipart: Array<{ apply: { model: string }; when?: Record<string, unknown> }>;
  properties: string[];
}

export interface AssetIndex {
  textures: IndexedTexture[];
  items: IndexedTexture[];
  blocks: IndexedTexture[];
  entities: IndexedTexture[];
  byTail: Map<string, IndexedTexture>;
  textureByNorm: Map<string, IndexedTexture[]>;
  itemModels: JavaModel[];
  blockModels: JavaModel[];
  modelByPath: Map<string, JavaModel>;
  modelCandidatesByNorm: Map<string, JavaModel[]>;
  itemModelByNorm: Map<string, JavaModel>;
  blockModelByNorm: Map<string, JavaModel>;
  blockstates: JavaBlockState[];
  blockstateByNorm: Map<string, JavaBlockState>;
  /** Java entity model skin references: normalized model stem -> `entity/<name>` ref. */
  entitySkinRefs: Map<string, string>;
}

export function getStandardElementsForParent(parent: string | undefined): JavaElement[] | null {
  if (!parent) return null;
  const p = parent.toLowerCase().replace(/^[a-z0-9_.-]+:/i, '');
  if (p.includes('stair')) {
    return [
      {
        from: [0, 0, 0],
        to: [16, 8, 16],
        faces: {
          down: { uv: [0, 0, 16, 16] },
          up: { uv: [0, 0, 16, 16] },
          north: { uv: [0, 8, 16, 16] },
          south: { uv: [0, 8, 16, 16] },
          west: { uv: [0, 8, 16, 16] },
          east: { uv: [0, 8, 16, 16] },
        },
      },
      {
        from: [0, 8, 8],
        to: [16, 16, 16],
        faces: {
          up: { uv: [0, 8, 16, 16] },
          north: { uv: [0, 8, 16, 16] },
          south: { uv: [0, 0, 16, 8] },
          west: { uv: [8, 0, 16, 8] },
          east: { uv: [0, 0, 8, 8] },
        },
      },
    ];
  }
  if (p.includes('slab')) {
    const isTop = p.includes('top');
    return [
      {
        from: [0, isTop ? 8 : 0, 0],
        to: [16, isTop ? 16 : 8, 16],
        faces: {
          down: { uv: [0, 0, 16, 16] },
          up: { uv: [0, 0, 16, 16] },
          north: { uv: [0, isTop ? 0 : 8, 16, isTop ? 8 : 16] },
          south: { uv: [0, isTop ? 0 : 8, 16, isTop ? 8 : 16] },
          west: { uv: [0, isTop ? 0 : 8, 16, isTop ? 8 : 16] },
          east: { uv: [0, isTop ? 0 : 8, 16, isTop ? 8 : 16] },
        },
      },
    ];
  }
  if (p.includes('cross') || p.includes('flower') || p.includes('plant') || p.includes('crop') || p.includes('bush') || p.includes('root') || p.includes('cluster')) {
    return [
      {
        from: [0.8, 0, 8],
        to: [15.2, 16, 8.2],
        rotation: { origin: [8, 8, 8], axis: 'y', angle: 45 },
        faces: {
          north: { uv: [0, 0, 16, 16] },
          south: { uv: [0, 0, 16, 16] },
        },
      },
      {
        from: [0.8, 0, 8],
        to: [15.2, 16, 8.2],
        rotation: { origin: [8, 8, 8], axis: 'y', angle: -45 },
        faces: {
          north: { uv: [0, 0, 16, 16] },
          south: { uv: [0, 0, 16, 16] },
        },
      },
    ];
  }
  if (p.includes('door')) {
    return [
      {
        from: [0, 0, 0],
        to: [16, 16, 3],
        faces: {
          north: { uv: [0, 0, 16, 16] },
          south: { uv: [0, 0, 16, 16] },
          east: { uv: [0, 0, 3, 16] },
          west: { uv: [13, 0, 16, 16] },
          up: { uv: [0, 0, 16, 3] },
          down: { uv: [0, 13, 16, 16] },
        },
      },
    ];
  }
  if (p.includes('chest') || p.includes('container')) {
    return [
      {
        from: [1, 0, 1],
        to: [15, 14, 15],
        faces: {
          down: { uv: [0, 0, 14, 14] },
          up: { uv: [0, 0, 14, 14] },
          north: { uv: [0, 0, 14, 14] },
          south: { uv: [0, 0, 14, 14] },
          west: { uv: [0, 0, 14, 14] },
          east: { uv: [0, 0, 14, 14] },
        },
      },
    ];
  }
  if (p.includes('ladder') || p.includes('pane') || p.includes('bars') || p.includes('rail')) {
    return [
      {
        from: [0, 0, 7.5],
        to: [16, 16, 8.5],
        faces: {
          north: { uv: [0, 0, 16, 16] },
          south: { uv: [0, 0, 16, 16] },
          east: { uv: [0, 0, 1, 16] },
          west: { uv: [15, 0, 16, 16] },
          up: { uv: [0, 0, 16, 1] },
          down: { uv: [0, 15, 16, 16] },
        },
      },
    ];
  }
  if (p.includes('carpet') || p.includes('pressure_plate')) {
    return [
      {
        from: [0, 0, 0],
        to: [16, 1, 16],
        faces: {
          down: { uv: [0, 0, 16, 16] },
          up: { uv: [0, 0, 16, 16] },
          north: { uv: [0, 15, 16, 16] },
          south: { uv: [0, 15, 16, 16] },
          west: { uv: [0, 15, 16, 16] },
          east: { uv: [0, 15, 16, 16] },
        },
      },
    ];
  }
  if (p.includes('cube') || p.includes('orientable') || p.includes('column') || p.includes('leaves') || p.includes('block') || p.includes('wood') || p.includes('log') || p.includes('stone') || p.includes('soil') || p.includes('dirt')) {
    return [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: {
          down: { uv: [0, 0, 16, 16] },
          up: { uv: [0, 0, 16, 16] },
          north: { uv: [0, 0, 16, 16] },
          south: { uv: [0, 0, 16, 16] },
          west: { uv: [0, 0, 16, 16] },
          east: { uv: [0, 0, 16, 16] },
        },
      },
    ];
  }
  return null;
}

export function normKey(value: string): string {
  return normalizeAssetIdentifier(value);
}

function bucketOfTexture(lower: string): TextureBucket {
  if (/(?:^|\/)textures\/items?\//.test(lower)) return 'item';
  if (/(?:^|\/)textures\/blocks?\//.test(lower)) return 'block';
  if (/(?:^|\/)textures\/(entity|entities|models\/entity)\//.test(lower)) return 'entity';
  if (lower.includes('/gui/') || lower.startsWith('gui/')) return 'gui';
  if (lower.includes('/particle') || lower.startsWith('particle')) return 'particle';
  return 'other';
}

interface RawModel {
  bucket: 'item' | 'block';
  rel: string;
  stem: string;
  json: Record<string, unknown>;
}

/**
 * Universal Asset Resolver — index pass.
 * Recursively indexes every texture and every Java model JSON in a mod archive so
 * authentic model/texture links can be resolved by exact reference instead of by
 * fragile filename guessing.
 */
export function buildAssetIndex(entries: ExtractedZipEntry[]): AssetIndex {
  const decoder = new TextDecoder();
  const textures: IndexedTexture[] = [];
  const byTail = new Map<string, IndexedTexture>();
  const textureByNorm = new Map<string, IndexedTexture[]>();
  const entitySkinRefs = new Map<string, string>();
  const rawModels = new Map<string, RawModel>();
  const rawByBucket: Record<'item' | 'block', RawModel[]> = { item: [], block: [] };
  const rawBlockstates: JavaBlockState[] = [];
  const blockstateByNorm = new Map<string, JavaBlockState>();

  for (const entry of entries) {
    const clean = normalizeAssetPath(entry.path);
    const lower = clean;

    if (lower.endsWith('.png') && entry.data && entry.data.length > 40) {
      const fileName = lower.split('/').pop() ?? '';
      const stem = fileName.replace(/\.png$/, '');
      if (!stem) continue;
      const size = readPngDimensions(entry.data);
      const tailIdx = lower.lastIndexOf('/textures/');
      const textureTail = lower.startsWith('textures/')
        ? lower.slice('textures/'.length)
        : tailIdx >= 0
          ? lower.slice(tailIdx + '/textures/'.length)
          : '';
      const tail = textureTail.replace(/\.png$/, '');
      const segments = lower.split('/');
      const folder = segments.length >= 2 ? segments[segments.length - 2] : '';
      const texture: IndexedTexture = {
        stem,
        norm: normKey(stem),
        tail,
        path: lower,
        folder,
        bucket: bucketOfTexture(lower),
        width: size?.width ?? 0,
        height: size?.height ?? 0,
        data: entry.data,
      };
      textures.push(texture);
      const sameStem = textureByNorm.get(texture.norm) ?? [];
      sameStem.push(texture);
      textureByNorm.set(texture.norm, sameStem);
      if (tail && !byTail.has(tail)) byTail.set(tail, texture);
      continue;
    }

    // Java ENTITY models declare the skin they were authored against. Indexing that
    // reference links a mob to its true sheet instead of a filename guess.
    if (lower.endsWith('.json') && /(?:^|\/)models\/entity\//.test(lower) && !lower.endsWith('.geo.json')) {
      try {
        const parsed = JSON.parse(decoder.decode(entry.data)) as { textures?: Record<string, unknown> };
        const map = parsed?.textures;
        if (map && typeof map === 'object') {
          const fileName = lower.split('/').pop() ?? '';
          const stem = normKey(fileName.replace(/\.json$/, ''));
          const ref = Object.values(map).find(
            (value): value is string => typeof value === 'string' && value.length > 2 && !value.startsWith('#'),
          );
          if (stem && ref && !entitySkinRefs.has(stem)) entitySkinRefs.set(stem, ref);
        }
      } catch {
        // Malformed entity model JSON — texture index still resolves from paths.
      }
    }

    if (!lower.endsWith('.json')) continue;
    const blockstateMatch = lower.match(/(?:^|\/)blockstates\/(.+)\.json$/);
    if (blockstateMatch) {
      try {
        const parsed = JSON.parse(decoder.decode(entry.data)) as {
          variants?: Record<string, unknown>;
          multipart?: Array<{ apply?: { model?: string }; when?: Record<string, unknown> }>;
        };
        const stem = blockstateMatch[1];
        const variants: Record<string, { model: string; x?: number; y?: number }> = {};
        const properties = new Set<string>();
        if (parsed.variants && typeof parsed.variants === 'object') {
          for (const [cond, target] of Object.entries(parsed.variants)) {
            cond.split(',').forEach((part) => {
              const [prop] = part.split('=');
              if (prop) properties.add(prop.trim());
            });
            const t = Array.isArray(target) ? target[0] : target;
            if (t && typeof t === 'object' && typeof (t as any).model === 'string') {
              variants[cond] = {
                model: (t as any).model,
                x: typeof (t as any).x === 'number' ? (t as any).x : undefined,
                y: typeof (t as any).y === 'number' ? (t as any).y : undefined,
              };
            }
          }
        }
        const multipart: Array<{ apply: { model: string }; when?: Record<string, unknown> }> = [];
        if (Array.isArray(parsed.multipart)) {
          for (const mp of parsed.multipart) {
            if (mp && typeof mp === 'object' && mp.apply && typeof mp.apply.model === 'string') {
              multipart.push({ apply: { model: mp.apply.model }, when: mp.when });
            }
          }
        }
        const state: JavaBlockState = {
          stem,
          norm: normKey(stem),
          path: lower,
          variants,
          multipart,
          properties: [...properties],
        };
        rawBlockstates.push(state);
        if (!blockstateByNorm.has(state.norm)) blockstateByNorm.set(state.norm, state);
      } catch {
        // Skip malformed blockstate
      }
      continue;
    }

    const modelMatch = lower.match(/(?:^|\/)models\/((?:item|block)\/.+)\.json$/);
    if (!modelMatch) continue;
    const rel = modelMatch[1];
    if (rawModels.has(rel)) continue;
    try {
      const parsed = JSON.parse(decoder.decode(entry.data)) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') continue;
      const bucket: 'item' | 'block' = rel.startsWith('block/') ? 'block' : 'item';
      const raw: RawModel = { bucket, rel, stem: rel.split('/').pop() ?? rel, json: parsed };
      rawModels.set(rel, raw);
      rawByBucket[bucket].push(raw);
    } catch {
      // Malformed model JSON — skip, other models still resolve.
    }
  }

  const flatten = (raw: RawModel): JavaModel => {
    const chain: string[] = [];
    const textures: Record<string, string> = {};
    const layers: JavaModelLayer[] = [];
    const display: Record<string, Record<string, unknown>> = {};
    const missingParents: string[] = [];
    let overrides: JavaItemOverride[] | undefined;
    let uvLock: boolean | undefined;
    let ambientOcclusion: boolean | undefined;
    let guiLight: string | undefined;
    let elements: JavaElement[] | null = null;
    let elementsSource: 'source' | 'builtin_fallback' = 'source';
    let current: Record<string, unknown> | null = raw.json;
    let currentPath = raw.rel;
    const visited = new Set<string>();
    let depth = 0;

    while (current && depth < 12) {
      // Every inheritance document is kept, child first, so display transforms and
      // item overrides survive the flatten instead of only the nearest element list.
      layers.push({ path: currentPath, document: current });
      const parent = typeof current.parent === 'string' ? current.parent : undefined;
      const textureMap = current.textures;
      if (textureMap && typeof textureMap === 'object') {
        for (const [key, value] of Object.entries(textureMap as Record<string, unknown>)) {
          if (typeof value === 'string' && !(key in textures)) textures[key] = value;
        }
      }
      if (current.display && typeof current.display === 'object') {
        for (const [perspective, transform] of Object.entries(current.display as Record<string, unknown>)) {
          if (!(perspective in display) && transform && typeof transform === 'object') {
            display[perspective] = transform as Record<string, unknown>;
          }
        }
      }
      if (!overrides && Array.isArray(current.overrides)) {
        overrides = current.overrides as JavaItemOverride[];
      }
      if (uvLock === undefined && typeof current.uvlock === 'boolean') uvLock = current.uvlock;
      if (ambientOcclusion === undefined && typeof current.ambientocclusion === 'boolean') {
        ambientOcclusion = current.ambientocclusion;
      }
      if (guiLight === undefined && typeof current.gui_light === 'string') {
        guiLight = current.gui_light;
      }
      if (!elements && Array.isArray(current.elements) && current.elements.length > 0) {
        elements = current.elements as JavaElement[];
      }
      chain.push(parent ?? '(root)');
      if (!parent) break;
      const parentKey = normalizeAssetPath(parent);
      if (visited.has(parentKey)) break;
      visited.add(parentKey);
      const next = rawModels.get(parentKey);
      if (!next) {
        missingParents.push(parent);
        break;
      }
      currentPath = parentKey;
      current = next.json;
      depth++;
    }

    const isBlockModel =
      raw.bucket === 'block' ||
      chain.some((p) =>
        /(?:^|\/)(?:block|cube|stair|slab|cross|leaves|door|chest|ladder|pane|fence|wall|carpet)/i.test(p),
      );

    if (!elements && isBlockModel) {
      for (const parentRef of chain) {
        const std = getStandardElementsForParent(parentRef);
        if (std) {
          elements = std;
          elementsSource = 'builtin_fallback';
          break;
        }
      }
      if (!elements) {
        elements = getStandardElementsForParent('block/cube_all');
        elementsSource = 'builtin_fallback';
      }
    }

    return {
      stem: raw.stem,
      norm: normKey(raw.stem),
      bucket: raw.bucket,
      path: raw.rel,
      parent: typeof raw.json.parent === 'string' ? raw.json.parent : undefined,
      chain,
      textures,
      elements,
      layers,
      missingParents,
      elementsSource,
      display,
      overrides,
      uvLock,
      ambientOcclusion,
      guiLight,
    };
  };

  const itemModels = rawByBucket.item.map(flatten);
  const blockModels = rawByBucket.block.map(flatten);
  const itemModelByNorm = new Map<string, JavaModel>();
  for (const model of itemModels) if (!itemModelByNorm.has(model.norm)) itemModelByNorm.set(model.norm, model);
  const blockModelByNorm = new Map<string, JavaModel>();
  for (const model of blockModels) if (!blockModelByNorm.has(model.norm)) blockModelByNorm.set(model.norm, model);
  const allModels = [...itemModels, ...blockModels];
  const modelByPath = new Map<string, JavaModel>();
  const modelCandidatesByNorm = new Map<string, JavaModel[]>();
  for (const model of allModels) {
    if (!modelByPath.has(model.path.toLowerCase())) modelByPath.set(model.path.toLowerCase(), model);
    const matches = modelCandidatesByNorm.get(model.norm) ?? [];
    matches.push(model);
    modelCandidatesByNorm.set(model.norm, matches);
  }

  return {
    textures,
    items: textures.filter((t) => t.bucket === 'item'),
    blocks: textures.filter((t) => t.bucket === 'block'),
    entities: textures.filter((t) => t.bucket === 'entity'),
    byTail,
    textureByNorm,
    entitySkinRefs,
    itemModels,
    blockModels,
    modelByPath,
    modelCandidatesByNorm,
    itemModelByNorm,
    blockModelByNorm,
    blockstates: rawBlockstates,
    blockstateByNorm,
  };
}

/** Resolves a Java texture reference (`mymod:item/gun`) to a real archive texture. */
export function lookupTextureByRef(index: AssetIndex, ref: string): IndexedTexture | null {
  const rel = normalizeAssetPath(ref);
  const direct =
    index.byTail.get(rel) ??
    index.byTail.get(`item/${rel}`) ??
    index.byTail.get(`block/${rel}`) ??
    index.byTail.get(`items/${rel}`) ??
    index.byTail.get(`blocks/${rel}`) ??
    index.byTail.get(rel.replace(/^block\//, 'blocks/')) ??
    index.byTail.get(rel.replace(/^blocks\//, 'block/')) ??
    index.byTail.get(rel.replace(/^item\//, 'items/')) ??
    index.byTail.get(rel.replace(/^items\//, 'item/'));
  if (direct) return direct;

  const fileName = rel.split('/').pop()?.replace(/\.png$/i, '') ?? '';
  if (fileName.length >= 3) {
    const isBlockRef = rel.includes('block');
    const candidates = index.textureByNorm.get(normKey(fileName)) ?? [];
    const preferredBuckets: TextureBucket[] = isBlockRef ? ['block', 'item'] : ['item', 'block'];
    for (const bucket of preferredBuckets) {
      const match = candidates.find((texture) => texture.bucket === bucket);
      if (match) return match;
    }
  }
  return null;
}

const DEFAULT_VARS = ['layer0', 'texture', 'all', 'particle', 'side', 'front', 'top', 'bottom', 'cross', '0', 'base'];

/**
 * Follows `#variable` indirection through a model's flattened texture map and
 * returns the first reference that points at a real texture file in the archive.
 */
export function resolveModelTexture(
  model: JavaModel,
  index: AssetIndex,
  preferredVars: string[] = [],
): IndexedTexture | null {
  const keys = [...preferredVars, ...DEFAULT_VARS, ...Object.keys(model.textures)];
  for (const key of keys) {
    let ref: string | undefined = model.textures[key];
    let guard = 0;
    while (typeof ref === 'string' && ref.startsWith('#') && guard++ < 8) {
      ref = model.textures[ref.slice(1)];
    }
    if (typeof ref !== 'string' || ref.startsWith('#')) continue;
    const texture = lookupTextureByRef(index, ref);
    if (texture) return texture;
  }
  return null;
}