import type { PackFile } from '@/utils/entityTextureVariants';

/**
 * Per-entity render controller synthesis.
 *
 * Every ported mob used to share one `controller.render.default` that only ever read
 * `Geometry.default` / `Texture.default` / `Material.default`. That made additional
 * geometry or texture variants unreachable, because a render controller is the only
 * place Bedrock resolves which geometry, texture and material to draw. Each entity now
 * gets its own controller whose arrays are built from what actually shipped.
 */

import { buildRenderControllerDocument } from '@/utils/renderControllerSchema';

export function readGeometryIdentifiers(json: PackFile | undefined): string[] {
  if (typeof json !== 'string') return [];
  try {
    const parsed = JSON.parse(json) as {
      'minecraft:geometry'?: Array<{ description?: { identifier?: string } }>;
    };
    const list = parsed['minecraft:geometry'] ?? [];
    return [
      ...new Set(list.map((entry) => String(entry?.description?.identifier ?? '')).filter(Boolean)),
    ];
  } catch {
    return [];
  }
}

export interface EntityRenderControllerInput {
  modId: string;
  mobId: string;
  /** Identifiers in descriptor order: index 0 is `Geometry.default`. */
  geometryIds: string[];
  /** Descriptor keys in selection order: index 0 is `default`. */
  textureKeys: string[];
}

export interface BuiltEntityRenderController {
  controllerId: string;
  filePath: string;
  json: string;
  usesArrays: boolean;
}

/** `math.clamp` keeps a stale `query.skin_id` from indexing past the shipped arrays. */
function indexExpression(count: number): string {
  return `math.clamp(query.skin_id, 0, ${Math.max(0, count - 1)})`;
}

export function buildEntityRenderController(
  input: EntityRenderControllerInput,
): BuiltEntityRenderController {
  const { modId, mobId, geometryIds, textureKeys } = input;
  const controllerId = `controller.render.${modId}.${mobId}`;
  const geometryKeys = geometryIds.map((_, index) =>
    index === 0 ? 'Geometry.default' : `Geometry.variant_${index}`,
  );
  const hasTextureVariants = textureKeys.length > 1;
  const hasGeometryVariants = geometryIds.length > 1;

  // Bedrock accepts only `textures`, `geometries` and `materials` as children of `arrays`,
  // each holding `Array.<name>` entries. A bucket named after the array (`arrays.skins`)
  // is rejected with "child 'skins' not valid here" and the whole controller then fails to
  // load ("Invalid render controller"). The category bucket is what the client reads.
  const arrays: Record<string, Record<string, string[]>> = {};
  const keys = textureKeys.length > 0 ? textureKeys : ['default'];
  if (hasTextureVariants) {
    arrays.textures = { 'Array.skins': keys.map((key) => `Texture.${key}`) };
  }
  if (hasGeometryVariants) {
    arrays.geometries = { 'Array.geos': geometryKeys };
  }

  const geometryExpression = hasGeometryVariants
    ? `Array.geos[${indexExpression(geometryKeys.length)}]`
    : 'Geometry.default';
  const textureExpression = hasTextureVariants
    ? `Array.skins[${indexExpression(keys.length)}]`
    : `Texture.${keys[0]}`;

  // Built through the canonical schema module: `textures` is always an ARRAY of texture
  // expressions, which is the field the client schema rejects when written as a scalar.
  const json = buildRenderControllerDocument({
    controllerId,
    geometry: geometryExpression,
    textures: [textureExpression],
    arrays: Object.keys(arrays).length > 0 ? arrays : undefined,
  });

  return {
    controllerId,
    filePath: `render_controllers/${mobId}.render_controllers.json`,
    json,
    usesArrays: hasTextureVariants || hasGeometryVariants,
  };
}