import type { AssetIndex, JavaElement, JavaModel } from '@/utils/assetIndex';
import { lookupTextureByRef } from '@/utils/assetIndex';

export type ModelFaceName = 'north' | 'east' | 'south' | 'west' | 'up' | 'down';
export const MODEL_FACE_ORDER: ModelFaceName[] = ['north', 'east', 'south', 'west', 'up', 'down'];

export type ModelSpace = 'block' | 'entity';

export interface IRFace {
  /** Texture variable key (`layer0`, `particle`, `all`, …) before alias indirection. */
  textureKey: string;
  /** Java UV rectangle in model space (`[u1, v1, u2, v2]`). */
  uv?: [number, number, number, number];
  /** Java per-face texture rotation in degrees (0 / 90 / 180 / 270). */
  rotation: 0 | 90 | 180 | 270;
  tintIndex?: number;
  cullface?: ModelFaceName;
}

export interface IRElementRotation {
  origin: [number, number, number];
  axis: 'x' | 'y' | 'z';
  angle: number;
  /** Java `rescale` flag: the cube is pre-scaled so the rotated part keeps its footprint. */
  rescale: boolean;
}

export interface IRCube {
  from: [number, number, number];
  to: [number, number, number];
  /** Element-level box UV origin used when faces carry no explicit rectangle. */
  boxUv?: [number, number];
  faces: Partial<Record<ModelFaceName, IRFace>>;
  rotation?: IRElementRotation;
  shade: boolean;
}

export interface IRBone {
  name: string;
  parent?: string;
  pivot: [number, number, number];
  rotation?: [number, number, number];
  cubes: IRCube[];
}

export interface IRDisplayTransform {
  rotation: [number, number, number];
  translation: [number, number, number];
  scale: [number, number, number];
}

export interface IRItemOverride {
  predicate: Record<string, number>;
  model: string;
}

export type ModelDiagnosticCode =
  | 'missing_parent'
  | 'missing_texture'
  | 'unresolved_texture_var'
  | 'connected_textures'
  | 'builtin_parent'
  | 'missing_elements'
  | 'missing_model'
  | 'model_cycle'
  | 'oversized_uv'
  | 'external_geometry';

export interface ModelDiagnostic {
  code: ModelDiagnosticCode;
  severity: 'info' | 'warning' | 'error';
  target: string;
  detail: string;
}

export interface IntermediateModel {
  id: string;
  sourcePath: string;
  space: ModelSpace;
  parentChain: string[];
  textureWidth: number;
  textureHeight: number;
  bones: IRBone[];
  display: Record<string, IRDisplayTransform>;
  overrides: IRItemOverride[];
  /** Variable -> final texture reference (`#alias` chains fully followed). */
  textureRefs: Record<string, string>;
  /** Variable -> the alias it pointed at, when indirection was involved. */
  textureAliases: Record<string, string>;
  /** Variable -> archive texture tail actually resolvable in the mod, or null. */
  resolvedTextures: Record<string, string | null>;
  uvLock: boolean;
  ambientOcclusion: boolean;
  guiLight: 'front' | 'side';
  diagnostics: ModelDiagnostic[];
  cubeCount: number;
}

export interface JavaModelInput {
  modelId: string;
  model: JavaModel;
  index?: AssetIndex | null;
  textureWidth?: number;
  textureHeight?: number;
  space?: ModelSpace;
}

const DEFAULT_VEC3: [number, number, number] = [0, 0, 0];
const ONE_VEC3: [number, number, number] = [1, 1, 1];

/**
 * Vanilla parent models that ship inside Minecraft itself. A mod model that inherits
 * from one of these is not a broken reference — there is simply no archive document to
 * walk into, so the inherited shape comes from the engine's own definition.
 */
const ENGINE_BUILTIN_BLOCK =
  /^(?:item|block)\/(?:generated|handheld|block|cube|cube_all|cube_bottom_top|cube_column|cube_top|cross|tinted_cross|crop|template_|orientable|leaves|slab|slab_top|stairs|inner_stairs|outer_stairs|fence|fence_inventory|fence_post|fence_side|wall_inventory|wall_post|wall_side|wall_side_tall|door|trapdoor|pane|button|pressure_plate|carpet)/;

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function vec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return [...fallback] as [number, number, number];
  return [num(value[0]), num(value[1]), num(value[2])];
}

function normalizeRotation(value: unknown): 0 | 90 | 180 | 270 {
  const angle = ((Math.round(num(value) / 90) * 90) % 360 + 360) % 360;
  if (angle === 90 || angle === 180 || angle === 270) return angle;
  return 0;
}

function normalizeTextureSize(value: number | undefined, fallback: number): number {
  const rounded = Math.round(num(value, fallback));
  if (rounded >= 8 && rounded <= 2048) return rounded;
  return fallback;
}

/**
 * Follows `#variable` indirection to a real texture reference. Minecraft allows
 * arbitrary alias chains (`layer0 -> #all -> mod:block/stone`), and an alias that
 * points at a missing variable must surface as unresolved instead of silently
 * sampling a random pixel.
 */
function resolveTextureVar(
  textures: Record<string, string>,
  key: string,
): { ref: string | null; aliasOf: string | null } {
  let ref: string | undefined = textures[key];
  let aliasOf: string | null = null;
  let guard = 0;
  while (typeof ref === 'string' && ref.startsWith('#') && guard < 8) {
    const next = ref.slice(1);
    if (aliasOf === null) aliasOf = next;
    ref = textures[next];
    guard++;
  }
  if (typeof ref !== 'string' || ref.startsWith('#')) return { ref: null, aliasOf };
  return { ref, aliasOf };
}

function buildCube(element: JavaElement, modelShade: boolean): IRCube | null {
  if (!Array.isArray(element.from) || !Array.isArray(element.to)) return null;
  if (element.from.length < 3 || element.to.length < 3) return null;
  const from: [number, number, number] = [num(element.from[0]), num(element.from[1]), num(element.from[2])];
  const to: [number, number, number] = [num(element.to[0]), num(element.to[1]), num(element.to[2])];

  const faces: Partial<Record<ModelFaceName, IRFace>> = {};
  for (const faceName of MODEL_FACE_ORDER) {
    const source = element.faces?.[faceName];
    if (!source) continue;
    const rawUv = source.uv;
    const uv: [number, number, number, number] | undefined =
      Array.isArray(rawUv) && rawUv.length >= 4
        ? [num(rawUv[0]), num(rawUv[1]), num(rawUv[2]), num(rawUv[3])]
        : undefined;
    faces[faceName] = {
      textureKey: typeof source.texture === 'string' ? source.texture : '#missing',
      uv,
      rotation: normalizeRotation(source.rotation),
      tintIndex: Number.isFinite(num(source.tintindex, NaN)) ? num(source.tintindex) : undefined,
      cullface:
        typeof source.cullface === 'string' && MODEL_FACE_ORDER.includes(source.cullface as ModelFaceName)
          ? (source.cullface as ModelFaceName)
          : undefined,
    };
  }

  const rotation = element.rotation;
  const elementRotation: IRElementRotation | undefined =
    rotation && Array.isArray(rotation.origin) && Math.round(num(rotation.angle)) !== 0
      ? {
          origin: vec3(rotation.origin, DEFAULT_VEC3),
          axis: rotation.axis === 'x' || rotation.axis === 'z' ? rotation.axis : 'y',
          angle: num(rotation.angle),
          rescale: rotation.rescale === true,
        }
      : undefined;

  const boxUv: [number, number] | undefined =
    Array.isArray(element.uv) && element.uv.length >= 2
      ? [num(element.uv[0]), num(element.uv[1])]
      : undefined;

  return {
    from,
    to,
    boxUv,
    faces,
    rotation: elementRotation,
    shade: element.shade !== false && modelShade,
  };
}

/**
 * Builds the intermediate geometry representation from a flattened Java model.
 *
 * Nothing is translated straight into Bedrock here: parent inheritance, texture
 * variable/alias resolution, element rotations, box UVs, display transforms and
 * item overrides are all normalised into one engine-neutral document first, so the
 * Bedrock writers never have to guess.
 */
export function buildIntermediateModel(input: JavaModelInput): IntermediateModel {
  const { model, index, modelId } = input;
  const space: ModelSpace = input.space ?? 'block';
  const textureWidth = normalizeTextureSize(input.textureWidth, space === 'entity' ? 64 : 16);
  const textureHeight = normalizeTextureSize(input.textureHeight, space === 'entity' ? 64 : 16);
  const diagnostics: ModelDiagnostic[] = [];

  const parentChain = (model.chain ?? []).filter((ref) => ref && ref !== '(root)');
  if (parentChain.length >= 12) {
    diagnostics.push({
      code: 'model_cycle',
      severity: 'warning',
      target: modelId,
      detail: 'Model inheritance chain hit the depth limit; remaining parents were not followed.',
    });
  }

  for (const missing of model.missingParents ?? []) {
    if (/^(builtin\/|minecraft:)/i.test(missing) || ENGINE_BUILTIN_BLOCK.test(missing)) continue;
    diagnostics.push({
      code: 'missing_parent',
      severity: 'warning',
      target: modelId,
      detail: `Parent model "${missing}" is not present in the archive — inherited elements/textures from it are marked UNRESOLVED.`,
    });
  }
  for (const parentRef of parentChain) {
    if (/^builtin\/(entity|generated)/i.test(parentRef)) {
      diagnostics.push({
        code: 'builtin_parent',
        severity: 'info',
        target: modelId,
        detail: `Parent "${parentRef}" is an engine builtin (no archive geometry to inherit).`,
      });
    }
  }

  const display: Record<string, IRDisplayTransform> = {};
  for (const [perspective, raw] of Object.entries(model.display ?? {})) {
    const transform = (raw ?? {}) as Record<string, unknown>;
    display[perspective] = {
      rotation: vec3(transform.rotation, DEFAULT_VEC3),
      translation: vec3(transform.translation, DEFAULT_VEC3),
      scale: vec3(transform.scale, ONE_VEC3),
    };
  }

  const overrides: IRItemOverride[] = [];
  const seenOverrides = new Set<string>();
  for (const entry of model.overrides ?? []) {
    const modelRef = typeof entry?.model === 'string' ? entry.model : '';
    if (!modelRef) continue;
    const predicate: Record<string, number> = {};
    for (const [key, value] of Object.entries(entry.predicate ?? {})) {
      if (Number.isFinite(num(value, NaN))) predicate[key] = num(value);
    }
    const signature = `${modelRef}|${JSON.stringify(predicate)}`;
    if (seenOverrides.has(signature)) continue;
    seenOverrides.add(signature);
    overrides.push({ model: modelRef, predicate });
  }

  const textureRefs: Record<string, string> = {};
  const textureAliases: Record<string, string> = {};
  const resolvedTextures: Record<string, string | null> = {};
  for (const key of Object.keys(model.textures ?? {})) {
    const { ref, aliasOf } = resolveTextureVar(model.textures, key);
    if (aliasOf) textureAliases[key] = aliasOf;
    if (ref) textureRefs[key] = ref;
    if (index && ref) {
      const texture = lookupTextureByRef(index, ref);
      resolvedTextures[key] = texture ? texture.tail || texture.stem : null;
      if (!texture) {
        diagnostics.push({
          code: 'missing_texture',
          severity: 'warning',
          target: `${modelId}:${key}`,
          detail: `Texture reference "${ref}" has no matching PNG in the archive — texture stays UNMATCHED (nothing is substituted).`,
        });
      }
      if (/(^|[/_-])(ctm|connected|optifine|skyblend)/i.test(ref)) {
        diagnostics.push({
          code: 'connected_textures',
          severity: 'info',
          target: `${modelId}:${key}`,
          detail: `Reference "${ref}" depends on Java connected-texture (CTM) rule files, which Bedrock does not evaluate — the base texture is bound as a static tile.`,
        });
      }
    } else if (!ref) {
      diagnostics.push({
        code: 'unresolved_texture_var',
        severity: 'warning',
        target: `${modelId}:${key}`,
        detail: `Texture variable "${key}" is an alias chain that never reaches a real texture reference.`,
      });
    }
  }

  const elements = Array.isArray(model.elements) ? model.elements : null;
  if (!elements || elements.length === 0) {
    diagnostics.push({
      code: 'missing_elements',
      severity: 'info',
      target: modelId,
      detail: 'Model declares no elements of its own and no parent supplied any — no cubes can be generated from it.',
    });
  } else if (model.elementsSource === 'builtin_fallback') {
    diagnostics.push({
      code: 'missing_elements',
      severity: 'info',
      target: modelId,
      detail:
        'No element geometry in the model or its parents; the vanilla parent shape was adapted (ADAPTED, not source geometry).',
    });
  }

  const cubes: IRCube[] = [];
  for (const element of elements ?? []) {
    const cube = buildCube(element, model.ambientOcclusion !== false);
    if (cube) cubes.push(cube);
  }

  const bones: IRBone[] = cubes.length > 0 ? [{ name: 'root', pivot: [0, 0, 0], cubes }] : [];

  return {
    id: modelId,
    sourcePath: model.path,
    space,
    parentChain,
    textureWidth,
    textureHeight,
    bones,
    display,
    overrides,
    textureRefs,
    textureAliases,
    resolvedTextures,
    uvLock: model.uvLock === true,
    ambientOcclusion: model.ambientOcclusion !== false,
    guiLight: model.guiLight === 'front' ? 'front' : 'side',
    diagnostics,
    cubeCount: cubes.length,
  };
}

/**
 * Builds intermediate cubes for a loose element list. Used by the entity converter,
 * which assembles several element groups into one multi-bone rig before writing.
 */
export function buildIntermediateCubes(elements: JavaElement[], ambientOcclusion = true): IRCube[] {
  const cubes: IRCube[] = [];
  for (const element of elements ?? []) {
    const cube = buildCube(element, ambientOcclusion);
    if (cube) cubes.push(cube);
  }
  return cubes;
}

/** True when the model's UVs are authored in absolute texture pixels, not a 0..16 box. */
export function usesPixelUv(ir: IntermediateModel): boolean {
  let maxUv = 0;
  for (const bone of ir.bones) {
    for (const cube of bone.cubes) {
      for (const faceName of MODEL_FACE_ORDER) {
        const uv = cube.faces[faceName]?.uv;
        if (uv) maxUv = Math.max(maxUv, uv[0], uv[1], uv[2], uv[3]);
      }
      if (cube.boxUv) maxUv = Math.max(maxUv, cube.boxUv[0], cube.boxUv[1]);
    }
  }
  return maxUv > 16.01;
}