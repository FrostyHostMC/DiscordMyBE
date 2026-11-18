import { resolvePlayerBone } from '@/utils/playerBoneAliases';
import { VANILLA_PLAYER_GEOMETRY_JSON } from '@/utils/vanillaPlayerGeometry';

/** A geometry file the archive really shipped. */
export interface GeometryCandidate {
  key: string;
  json: string;
  source?: string;
}

export interface BoneInjectionResult {
  geometryIdentifier: string | null;
  slimGeometryIdentifier: string | null;
  geometryPath: string | null;
  files: Record<string, string>;
  injectedBones: string[];
  approximatedBones: string[];
  unresolvedBones: string[];
  note: string;
}

type JsonObject = Record<string, any>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expandBoxUv(cube: JsonObject): JsonObject {
  const uv = cube.uv as number[];
  const size = cube.size as number[];
  const [u, v] = uv;
  const [width, height, depth] = size;
  const face = (x: number, y: number, w: number, h: number) => ({ uv: [x, y], uv_size: [w, h] });
  return {
    east: face(u, v + depth, depth, height),
    north: face(u + depth, v + depth, width, height),
    west: face(u + depth + width, v + depth, depth, height),
    south: face(u + depth + width + depth, v + depth, width, height),
    up: face(u + depth, v, width, depth),
    down: face(u + depth + width, v, width, depth),
  };
}

function splitCube(cubeInput: JsonObject, drawCrossSection: boolean): {
  lower: JsonObject;
  upper: JsonObject;
  halfHeight: number;
} | null {
  const lower = clone(cubeInput);
  if (Array.isArray(lower.uv)) lower.uv = expandBoxUv(lower);
  if (!lower.uv || !Array.isArray(lower.size) || !Array.isArray(lower.origin)) return null;
  const halfHeight = Number(lower.size[1]) / 2;
  if (!(halfHeight > 0)) return null;
  const upper = clone(lower);
  lower.size[1] = halfHeight;
  upper.size[1] = halfHeight;
  // The reference bend rig clones the half-sized child cube before shifting the parent
  // cube's origin. The parent becomes the upper half; the child keeps the original origin
  // and is pivoted half a cube-height lower, forming the lower half without overlap.
  lower.origin[1] = Number(lower.origin[1]) + halfHeight;

  const sides = ['north', 'south', 'east', 'west'];
  for (const side of sides) {
    const lowerFace = lower.uv[side];
    const upperFace = upper.uv[side];
    if (!lowerFace || !upperFace || !Array.isArray(lowerFace.uv) || !Array.isArray(upperFace.uv) ||
        !Array.isArray(lowerFace.uv_size) || !Array.isArray(upperFace.uv_size)) continue;
    lowerFace.uv_size[1] = halfHeight;
    upperFace.uv[1] = Number(upperFace.uv[1]) + halfHeight;
    upperFace.uv_size[1] = halfHeight;
  }
  if (drawCrossSection && lower.uv.up) lower.uv.down = clone(lower.uv.up);
  else delete lower.uv.down;
  // Emotecraft keeps both exterior caps for the main mesh; overlay layers omit the internal caps.
  if (!drawCrossSection) {
    // The reference rig removes only the inner up face from the upper overlay half;
    // the down face remains the exterior cap of that split cube.
    delete upper.uv.up;
  }
  return { lower, upper, halfHeight };
}

function canonicalBendBone(raw: string): string | null {
  const base = raw.replace(/_bend$/i, '');
  const hit = resolvePlayerBone(base);
  if (!hit) return null;
  const key = hit.bone.toLowerCase();
  if (key === 'body') return 'body';
  if (key === 'rightarm') return 'rightArm';
  if (key === 'leftarm') return 'leftArm';
  if (key === 'rightleg') return 'rightLeg';
  if (key === 'leftleg') return 'leftLeg';
  return null;
}

function buildBendGeometry(bendBones: string[], needsWaistParenting: boolean, sourceBones: JsonObject[] = []): {
  identifier: string;
  slimIdentifier: string;
  path: string;
  json: string;
  injected: string[];
} | null {
  const requested = new Set(bendBones.map(canonicalBendBone).filter((name): name is string => Boolean(name)));
  if (requested.size === 0 && !needsWaistParenting && sourceBones.length === 0) return null;
  const doc = JSON.parse(VANILLA_PLAYER_GEOMETRY_JSON) as JsonObject;
  const geometries = doc['minecraft:geometry'] as JsonObject[] | undefined;
  if (!Array.isArray(geometries) || geometries.length < 2) {
    throw new Error('Mojang classic/slim player geometry source is malformed.');
  }
  const identifier = 'geometry.humanoid.custom';
  const slimIdentifier = 'geometry.humanoid.customSlim';
  const injected = new Set<string>();

  const splitRig = (geometry: JsonObject, isSlim: boolean): void => {
    const description = geometry.description as JsonObject | undefined;
    const bones = geometry.bones as JsonObject[] | undefined;
    if (!description || !Array.isArray(bones)) throw new Error('Mojang player geometry is missing its description or bones.');
    const additions: JsonObject[] = [];
    for (const injectedName of appendCustomPlayerBones(geometry, sourceBones)) injected.add(injectedName);
    if (needsWaistParenting) {
      // Emotecraft's body channel is the lower waist pivot and also drives the legs.
      // Mojang's stock player model keeps legs under root, so restore that parent chain here.
      for (const legName of ['leftLeg', 'rightLeg']) {
        const leg = bones.find((bone) => bone.name === legName);
        if (leg) leg.parent = 'waist';
      }
    }
    for (const baseName of ['body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']) {
      if (!requested.has(baseName)) continue;
      const base = bones.find((bone) => bone.name === baseName);
      const baseCubes = Array.isArray(base?.cubes) ? base.cubes as JsonObject[] : [];
      if (!base || baseCubes.length === 0) continue;
      const baseLower: JsonObject[] = [];
      const baseUpper: JsonObject[] = [];
      const originalHeights: number[] = [];
      for (const cube of baseCubes) {
        const split = splitCube(cube, true);
        if (!split) {
          baseLower.push(clone(cube));
          continue;
        }
        baseLower.push(split.lower);
        baseUpper.push(split.upper);
        originalHeights.push(Number(cube.size[1]));
      }
      if (baseUpper.length === 0) continue;
      base.cubes = baseLower;

      const bendName = baseName + '_bend';
      const basePivot = Array.isArray(base.pivot) ? base.pivot : [0, 0, 0];
      const primaryHalfHeight = originalHeights[0] / 2;
      additions.push({
        name: bendName,
        parent: baseName,
        pivot: [basePivot[0], Number(basePivot[1]) - primaryHalfHeight, basePivot[2]],
        cubes: baseUpper,
      });
      injected.add(bendName);

      for (const child of bones) {
        if (child.parent !== baseName || child.name === bendName) continue;
        const childCubes = Array.isArray(child.cubes) ? child.cubes as JsonObject[] : [];
        const overlayLower: JsonObject[] = [];
        const overlayUpper: JsonObject[] = [];
        let overlayHalfHeight: number | null = null;
        for (const cube of childCubes) {
          const height = Array.isArray(cube.size) ? Number(cube.size[1]) : Number.NaN;
          const isMatchingOverlay = cube.inflate !== undefined &&
            Number.isFinite(height) && originalHeights.some((original) => Math.abs(original - height) < 0.001);
          const overlaySplit = isMatchingOverlay ? splitCube(cube, false) : null;
          if (overlaySplit) {
            overlayLower.push(overlaySplit.lower);
            overlayUpper.push(overlaySplit.upper);
            overlayHalfHeight ??= overlaySplit.halfHeight;
          } else {
            overlayLower.push(clone(cube));
          }
        }
        if (overlayUpper.length > 0) {
          child.cubes = overlayLower;
          const overlayName = child.name + '_bend';
          const overlayPivot = Array.isArray(child.pivot) ? child.pivot : basePivot;
          additions.push({
            name: overlayName,
            parent: bendName,
            pivot: [overlayPivot[0], Number(overlayPivot[1]) - (overlayHalfHeight ?? primaryHalfHeight), overlayPivot[2]],
            cubes: overlayUpper,
          });
          injected.add(overlayName);
          continue;
        }
        child.parent = bendName;
      }
    }
    description.identifier = isSlim ? slimIdentifier : identifier;
    bones.push(...additions);
  };

  splitRig(geometries.find((geometry) => (geometry.description as JsonObject)?.identifier === 'geometry.humanoid.custom')!, false);
  splitRig(geometries.find((geometry) => (geometry.description as JsonObject)?.identifier === 'geometry.humanoid.customSlim')!, true);
  if (injected.size === 0 && !needsWaistParenting) return null;
  return {
    identifier,
    slimIdentifier,
    path: 'models/entity/humanoid.custom.geo.json',
    json: JSON.stringify(doc, null, 2),
    injected: [...injected],
  };
}


/**
 * Select a source rig only when its real joint names strongly match custom player
 * animation tracks. Unrelated mob models in the same archive are not eligible.
 */
function selectPlayerSourceBones(candidates: GeometryCandidate[], clipBones: string[]): JsonObject[] {
  const wanted = [...new Set(clipBones.map((name) => name.toLowerCase()))];
  const customWanted = wanted.filter((name) => !resolvePlayerBone(name.replace(/_bend$/i, '')));
  let best: { bones: JsonObject[]; score: number } | null = null;
  let tied = false;
  for (const candidate of candidates) {
    try {
      const doc = JSON.parse(candidate.json) as JsonObject;
      const geometry = (doc['minecraft:geometry'] as JsonObject[] | undefined)?.[0];
      const bones = geometry?.bones;
      if (!Array.isArray(bones) || bones.length === 0) continue;
      const names = new Set<string>(bones.map((bone: JsonObject) => String(bone.name ?? '').toLowerCase()));
      const matched = customWanted.filter((name) => names.has(name));
      const keySuggestsPlayer = /player|avatar|humanoid/i.test(candidate.key);
      if (matched.length === 0) continue;
      const ratio = matched.length / Math.max(1, customWanted.length);
      if (ratio < 0.75 || (matched.length === 1 && customWanted.length > 1 && !keySuggestsPlayer)) continue;
      const description = geometry.description ?? {};
      if (Number(description.texture_width ?? 64) !== 64 || Number(description.texture_height ?? 64) !== 64) continue;
      const score = matched.length * 100 + ratio * 10 + (keySuggestsPlayer ? 1 : 0);
      if (!best || score > best.score) { best = { bones, score }; tied = false; }
      else if (score === best.score) tied = true;
    } catch {
      // Invalid source geometry is ignored; it must never replace the player's skin rig.
    }
  }
  if (!best || tied) return [];
  const byName = new Map(best.bones.map((bone) => [String(bone.name ?? '').toLowerCase(), bone]));
  const required = new Set<string>();
  const addAncestors = (name: string, depth = 0): void => {
    if (depth > 64 || required.has(name)) return;
    const bone = byName.get(name);
    if (!bone) return;
    required.add(name);
    if (typeof bone.parent === 'string') addAncestors(bone.parent.toLowerCase(), depth + 1);
  };
  for (const name of customWanted) addAncestors(name);
  return [...required].map((name) => byName.get(name)!).filter(Boolean);
}

function appendCustomPlayerBones(geometry: JsonObject, sourceBones: JsonObject[]): string[] {
  const bones = geometry.bones as JsonObject[];
  const used = new Set(bones.map((bone) => String(bone.name ?? '').toLowerCase()));
  const sourceNames = new Set(sourceBones.map((bone) => String(bone.name ?? '').toLowerCase()));
  const rename = new Map<string, string>();
  for (const source of sourceBones) {
    const raw = String(source.name ?? '').trim();
    if (!raw || resolvePlayerBone(raw)) continue;
    let name = raw, suffix = 2;
    while (used.has(name.toLowerCase())) name = raw + '_' + suffix++;
    used.add(name.toLowerCase());
    rename.set(raw.toLowerCase(), name);
  }
  const injected: string[] = [];
  for (const source of sourceBones) {
    const raw = String(source.name ?? '').toLowerCase();
    const name = rename.get(raw);
    if (!name) continue;
    const copy = clone(source);
    copy.name = name;
    const parent = typeof source.parent === 'string' ? source.parent.toLowerCase() : '';
    if (rename.has(parent)) copy.parent = rename.get(parent);
    else if (parent && sourceNames.has(parent) && resolvePlayerBone(parent)) copy.parent = resolvePlayerBone(parent)?.bone;
    else copy.parent = /head|skull|face|eye|jaw|hat/i.test(name) ? 'head' : 'body';
    bones.push(copy);
    injected.push(name);
  }
  return injected;
}

/**
 * Generates a skin-preserving copy of Mojang's published player model when source clips contain
 * real bend tracks. Each requested vanilla limb/body cube is split into lower and upper segments;
 * overlay layers are split in parallel and attached to the corresponding segment. The resulting
 * child joints are driven by the imported *_bend animation tracks.
 */
export function injectPlayerRigBones(options: {
  candidates: GeometryCandidate[];
  clipBones: string[];
  modId: string;
  bendBones?: string[];
  needsWaistParenting?: boolean;
}): BoneInjectionResult {
  const sourceBones = selectPlayerSourceBones(options.candidates, options.clipBones);
  const bendGeometry = buildBendGeometry(options.bendBones ?? [], options.needsWaistParenting === true, sourceBones);
  const injectedNames = new Set((bendGeometry?.injected ?? []).map((name) => name.toLowerCase()));
  const unresolvedBones = [...new Set(options.clipBones.filter((name) => {
    const base = name.replace(/_bend$/i, '');
    return !resolvePlayerBone(base) && !injectedNames.has(name.toLowerCase()) && !injectedNames.has(base.toLowerCase());
  }))];
  const files = bendGeometry ? { [bendGeometry.path]: bendGeometry.json } : {};
  const candidateNote = options.candidates.length > 0
    ? `${options.candidates.length} source geometry candidate(s) audited; the vanilla skin mesh remains the base`
    : 'Mojang vanilla player geometry used as the skin-preserving base';
  const unresolvedNote = unresolvedBones.length > 0
    ? `${unresolvedBones.length} unrelated custom bone track(s) remain unresolved`
    : 'all mapped player tracks resolve';
  return {
    geometryIdentifier: bendGeometry?.identifier ?? null,
    slimGeometryIdentifier: bendGeometry?.slimIdentifier ?? null,
    geometryPath: bendGeometry?.path ?? null,
    files,
    injectedBones: bendGeometry?.injected ?? [],
    approximatedBones: (bendGeometry?.injected ?? []).filter((name) => /_bend$/i.test(name)),
    unresolvedBones,
    note: bendGeometry
      ? `${candidateNote}; generated ${bendGeometry.injected.length} custom/bend joint(s) for ${options.modId}; ${unresolvedNote}.`
      : `${candidateNote}; no bend segment geometry was needed; ${unresolvedNote}.`,
  };
}
