import type { PackFile } from '@/utils/entityTextureVariants';

/**
 * Canonical render-controller schema.
 *
 * The content log reports `unknown child schema option type` whenever a render
 * controller declares `textures` as a scalar (`"Texture.default"`) or as a malformed
 * object: Bedrock requires geometry to be a string, materials to be an array of
 * part→material maps and textures to be an ARRAY of texture expressions. Every
 * controller this project writes goes through this module, and every controller that
 * ships is normalised through it before export, so the defect cannot reach the archive.
 */

export const RENDER_CONTROLLER_RULE =
  'A Bedrock render controller requires geometry (string), materials (array of { part: material } maps) and textures (array of texture expressions). A scalar textures value or an empty array is rejected by the client schema with "unknown child schema option type".';

export interface RenderControllerSpec {
  controllerId: string;
  /** `Geometry.default`, `Geometry.variant_1` … */
  geometry: string;
  /** Texture expressions; the first entry is the default selection. */
  textures: string[];
  material?: string;
  /** Optional `arrays` block: `{ textures: { 'Array.skins': ['Texture.default'] } }`. */
  arrays?: Record<string, Record<string, string[]>>;
  formatVersion?: string;
}

const TEXTURE_EXPRESSION =
  /^(?:Texture\.[A-Za-z0-9_.:+-]+|Array\.[A-Za-z0-9_.:+-]+\[[^\]]+\]|Variable\.[A-Za-z0-9_.:+-]+|Material\.[A-Za-z0-9_.:+-]+|Geometry\.[A-Za-z0-9_.:+-]+|query\.[A-Za-z0-9_.()]+)$/;

export function isTextureExpression(value: unknown): boolean {
  return typeof value === 'string' && TEXTURE_EXPRESSION.test(value.trim());
}

/** Builds one schema-valid render controller document. */
export function buildRenderControllerDocument(spec: RenderControllerSpec): string {
  const textures = spec.textures.filter((entry) => typeof entry === 'string' && entry.length > 0);
  const definition: Record<string, unknown> = {};
  if (spec.arrays && Object.keys(spec.arrays).length > 0) definition.arrays = spec.arrays;
  definition.geometry = spec.geometry || 'Geometry.default';
  definition.materials = [{ '*': spec.material || 'Material.default' }];
  // Array, never a scalar: this is the exact field the content log rejects.
  definition.textures = textures.length > 0 ? textures : ['Texture.default'];
  return JSON.stringify(
    {
      format_version: spec.formatVersion ?? '1.10.0',
      render_controllers: { [spec.controllerId]: definition },
    },
    null,
    2,
  );
}

export type RenderControllerFixKind =
  | 'scalar-textures'
  | 'empty-textures'
  | 'invalid-textures'
  | 'geometry'
  | 'materials'
  | 'arrays';

export interface RenderControllerNormalisation {
  json: string;
  controllers: number;
  fixes: RenderControllerFixKind[];
}

interface ControllerLike {
  arrays?: Record<string, unknown>;
  geometry?: unknown;
  materials?: unknown;
  textures?: unknown;
  part_visibility?: unknown;
  [key: string]: unknown;
}

/** Categories the client accepts under `arrays`; anything else is a schema error. */
const ARRAY_CATEGORIES = new Set(['textures', 'geometries', 'materials']);
const PREFIX_BY_CATEGORY: Record<string, string> = {
  textures: 'Texture.',
  geometries: 'Geometry.',
  materials: 'Material.',
};

function arrayEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function categoryOfEntries(entries: string[]): string {
  const lower = entries.map((entry) => entry.trim().toLowerCase());
  if (lower.every((entry) => entry.startsWith('geometry.'))) return 'geometries';
  if (lower.every((entry) => entry.startsWith('material.'))) return 'materials';
  return 'textures';
}

function withCategoryPrefix(category: string, entry: string): string {
  const trimmed = entry.trim();
  // An index expression (`Array.skins[0]`) or a query already resolves itself.
  if (/\[[^\]]+\]/.test(trimmed) || trimmed.toLowerCase().startsWith('query.')) return trimmed;
  // Array references arrive in any casing (`array.skins`) from hand-written and imported
  // controllers; the client only accepts the `Array.` prefix.
  if (/^array\./i.test(trimmed)) return `Array.${trimmed.slice('array.'.length)}`;
  const bare = trimmed.replace(/^(texture|geometry|material)\./i, '');
  return `${PREFIX_BY_CATEGORY[category] ?? ''}${bare}`;
}

/**
 * Rebuilds an `arrays` block in the structure the client reads:
 * `{ textures: { 'Array.<name>': ['Texture.<key>', …] }, geometries: …, materials: … }`.
 * A bucket named after the array (`arrays.skins`, `arrays.geos`) is rejected with
 * "child 'skins' not valid here" and invalidates the whole controller, so its entries are
 * moved into the category the entries themselves declare.
 */
function normaliseArrays(
  value: Record<string, unknown>,
  fixes: RenderControllerFixKind[],
): Record<string, Record<string, string[]>> | undefined {
  const out: Record<string, Record<string, string[]>> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (!childValue || typeof childValue !== 'object' || Array.isArray(childValue)) {
      fixes.push('arrays');
      continue;
    }
    for (const [rawName, rawEntries] of Object.entries(childValue as Record<string, unknown>)) {
      const entries = arrayEntries(rawEntries);
      if (entries.length === 0) continue;
      const name = /^array\./i.test(rawName) ? `Array.${rawName.slice('array.'.length)}` : `Array.${rawName}`;
      if (!ARRAY_CATEGORIES.has(childKey) || name !== rawName) fixes.push('arrays');
      const category = ARRAY_CATEGORIES.has(childKey) ? childKey : categoryOfEntries(entries);
      if (!out[category]) out[category] = {};
      out[category][name] = entries.map((entry) => withCategoryPrefix(category, entry));
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function firstArrayExpression(controller: ControllerLike): string | null {
  const arrays = controller.arrays;
  if (!arrays || typeof arrays !== 'object') return null;
  for (const [category, group] of Object.entries(arrays)) {
    if (category !== 'textures' || !group || typeof group !== 'object') continue;
    for (const [name, value] of Object.entries(group as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const usable = value.some((entry) => typeof entry === 'string' && entry.startsWith('Texture.'));
      if (usable) return `${name.startsWith('Array.') ? name : `Array.${name}`}[0]`;
    }
  }
  return null;
}

/** Rewrites one render-controller document into the schema Bedrock accepts. */
export function normaliseRenderControllerDocument(
  json: string,
): RenderControllerNormalisation | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const root =
    (parsed.render_controllers as Record<string, ControllerLike> | undefined) ??
    (parsed['minecraft:render_controllers'] as Record<string, ControllerLike> | undefined);
  if (!root || typeof root !== 'object') return null;
  const fixes: RenderControllerFixKind[] = [];
  let controllers = 0;

  for (const [controllerId, rawController] of Object.entries(root)) {
    if (!rawController || typeof rawController !== 'object') continue;
    controllers += 1;
    const controller = rawController as ControllerLike;
    // `arrays` is rebuilt before anything reads it: the client validates its child keys, and a
    // bucket the schema rejects makes the whole controller "Invalid render controller".
    if (controller.arrays != null) {
      if (typeof controller.arrays !== 'object' || Array.isArray(controller.arrays)) {
        delete controller.arrays;
        fixes.push('arrays');
      } else {
        const normalised = normaliseArrays(controller.arrays as Record<string, unknown>, fixes);
        if (normalised) controller.arrays = normalised;
        else {
          delete controller.arrays;
          fixes.push('arrays');
        }
      }
    }
    const fallback = firstArrayExpression(controller) ?? 'Texture.default';

    if (typeof controller.geometry !== 'string' || controller.geometry.length === 0) {
      controller.geometry = 'Geometry.default';
      fixes.push('geometry');
    }
    if (!Array.isArray(controller.materials) || controller.materials.length === 0) {
      controller.materials = [{ '*': 'Material.default' }];
      fixes.push('materials');
    }

    const textures = controller.textures;
    if (typeof textures === 'string') {
      controller.textures = [textures];
      fixes.push('scalar-textures');
    } else if (Array.isArray(textures)) {
      const entries = textures.filter((entry) => typeof entry === 'string' && entry.length > 0);
      if (entries.length === 0) {
        controller.textures = [fallback];
        fixes.push('empty-textures');
      } else if (entries.length !== textures.length) {
        controller.textures = entries;
        fixes.push('invalid-textures');
      }
    } else {
      controller.textures = [fallback];
      fixes.push('empty-textures');
    }
    void controllerId;
  }

  return { json: JSON.stringify(parsed, null, 2), controllers, fixes };
}

export interface RenderControllerSanitizeResult {
  filesTouched: number;
  controllersNormalised: number;
  scalarTexturesFixed: number;
  emptyTextureArraysFilled: number;
  textureRefsRepaired: number;
  unknownControllers: string[];
}

/** Declared texture short names for a client entity, or an empty list. */
function declaredTextureKeys(
  files: Record<string, PackFile>,
  mobId: string,
): string[] {
  const raw = files[`entity/${mobId}.entity.json`];
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, any>;
    const textures = parsed?.['minecraft:client_entity']?.description?.textures;
    return textures && typeof textures === 'object' ? Object.keys(textures) : [];
  } catch {
    return [];
  }
}

/**
 * Normalises every render controller in the pack and repairs texture expressions that
 * reference a texture key the owning client entity never declares (the controller then
 * renders nothing, because `Texture.foo` is unresolved at draw time).
 */
export function sanitizeRenderControllers(
  files: Record<string, PackFile>,
  options?: { onLog?: (line: string) => void },
): RenderControllerSanitizeResult {
  const result: RenderControllerSanitizeResult = {
    filesTouched: 0,
    controllersNormalised: 0,
    scalarTexturesFixed: 0,
    emptyTextureArraysFilled: 0,
    textureRefsRepaired: 0,
    unknownControllers: [],
  };

  for (const path of Object.keys(files)) {
    if (!path.startsWith('render_controllers/') || !path.endsWith('.json')) continue;
    const raw = files[path];
    if (typeof raw !== 'string') continue;
    const normalised = normaliseRenderControllerDocument(raw);
    if (!normalised) {
      result.unknownControllers.push(path);
      continue;
    }
    let json = normalised.json;
    const mobId = path
      .slice('render_controllers/'.length)
      .replace(/\.render_controllers\.json$/i, '')
      .replace(/\.json$/i, '');
    const keys = declaredTextureKeys(files, mobId);

    if (keys.length > 0) {
      const parsed = JSON.parse(json) as Record<string, Record<string, ControllerLike>>;
      const root = parsed.render_controllers ?? parsed['minecraft:render_controllers'];
      let repaired = 0;
      for (const controller of Object.values(root ?? {})) {
        if (!controller || typeof controller !== 'object') continue;
        const textures = controller.textures;
        if (!Array.isArray(textures)) continue;
        const preferred = keys.includes('default') ? 'default' : keys[0];
        controller.textures = textures.map((entry) => {
          if (typeof entry !== 'string') return `Texture.${preferred}`;
          const match = /^Texture\.([A-Za-z0-9_.:+-]+)$/.exec(entry.trim());
          if (!match) return entry;
          if (keys.includes(match[1])) return entry;
          repaired += 1;
          return `Texture.${preferred}`;
        });
      }
      if (repaired > 0) {
        json = JSON.stringify(parsed, null, 2);
        result.textureRefsRepaired += repaired;
        options?.onLog?.(
          `[SCHEMA] ${path}: ${repaired} texture expression(s) pointed at a texture key the client entity never declares; rebound to a declared texture.`,
        );
      }
    }

    if (json !== raw) {
      files[path] = json;
      result.filesTouched += 1;
    }
    result.controllersNormalised += normalised.controllers;
    result.scalarTexturesFixed += normalised.fixes.filter((fix) => fix === 'scalar-textures').length;
    result.emptyTextureArraysFilled += normalised.fixes.filter(
      (fix) => fix === 'empty-textures' || fix === 'invalid-textures',
    ).length;
  }

  return result;
}