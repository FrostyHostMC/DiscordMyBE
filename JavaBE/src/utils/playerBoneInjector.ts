import { hasCustomBoneTokens, resolvePlayerBone } from '@/utils/playerBoneAliases';
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
  lower.origin[1] = Number(lower.origin[1]) + halfHeight;
  // Emotecraft's reference implementation creates the second cube from the already-shifted
  // lower cube. Both halves therefore share the shifted origin; the new joint pivot supplies
  // the relative offset. Keeping the original origin on the upper cube causes a visible seam.
  upper.origin[1] = lower.origin[1];

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
  // The upper cube is copied from the patched lower cube in Emotecraft's implementation.
  if (!drawCrossSection) {
    delete upper.uv.up;
    delete upper.uv.down;
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

function buildBendGeometry(bendBones: string[]): {
  identifier: string;
  slimIdentifier: string;
  path: string;
  json: string;
  injected: string[];
} | null {
  const requested = new Set(bendBones.map(canonicalBendBone).filter((name): name is string => Boolean(name)));
  if (requested.size === 0) return null;
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
    for (const baseName of ['body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']) {
      if (!requested.has(baseName)) continue;
      const base = bones.find((bone) => bone.name === baseName);
      const baseCube = base?.cubes?.[0] as JsonObject | undefined;
      if (!base || !baseCube) continue;
      const baseSplit = splitCube(baseCube, true);
      if (!baseSplit) continue;
      const originalHeight = Number(baseCube.size[1]);
      base.cubes[0] = baseSplit.lower;

      const bendName = baseName + '_bend';
      const basePivot = Array.isArray(base.pivot) ? base.pivot : [0, 0, 0];
      additions.push({
        name: bendName,
        parent: baseName,
        pivot: [basePivot[0], Number(basePivot[1]) - baseSplit.halfHeight, basePivot[2]],
        cubes: [baseSplit.upper],
      });
      injected.add(bendName);

      for (const child of bones) {
        if (child.parent !== baseName || child.name === bendName) continue;
        const childCube = child.cubes?.[0] as JsonObject | undefined;
        const isMatchingOverlay = Boolean(
          childCube && childCube.inflate !== undefined &&
          Array.isArray(childCube.size) &&
          Math.abs(Number(childCube.size[1]) - originalHeight) < 0.001,
        );
        if (isMatchingOverlay) {
          const overlaySplit = splitCube(childCube!, false);
          if (overlaySplit) {
            child.cubes[0] = overlaySplit.lower;
            const overlayName = child.name + '_bend';
            const overlayPivot = Array.isArray(child.pivot) ? child.pivot : basePivot;
            additions.push({
              name: overlayName,
              parent: bendName,
              pivot: [overlayPivot[0], Number(overlayPivot[1]) - overlaySplit.halfHeight, overlayPivot[2]],
              cubes: [overlaySplit.upper],
            });
            injected.add(overlayName);
            continue;
          }
        }
        child.parent = bendName;
      }
    }
    description.identifier = isSlim ? slimIdentifier : identifier;
    bones.push(...additions);
  };

  splitRig(geometries.find((geometry) => (geometry.description as JsonObject)?.identifier === 'geometry.humanoid.custom')!, false);
  splitRig(geometries.find((geometry) => (geometry.description as JsonObject)?.identifier === 'geometry.humanoid.customSlim')!, true);
  if (injected.size === 0) return null;
  return {
    identifier,
    slimIdentifier,
    path: 'models/entity/humanoid.custom.geo.json',
    json: JSON.stringify(doc, null, 2),
    injected: [...injected],
  };
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
}): BoneInjectionResult {
  const unresolvedBones = [...new Set(options.clipBones.filter((name) => {
    const base = name.replace(/_bend$/i, '');
    return !resolvePlayerBone(base) || (!/_bend$/i.test(name) && hasCustomBoneTokens(name));
  }))];
  const bendGeometry = buildBendGeometry(options.bendBones ?? []);
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
    approximatedBones: bendGeometry?.injected ?? [],
    unresolvedBones,
    note: bendGeometry
      ? `${candidateNote}; generated ${bendGeometry.injected.length} bend segment/overlay joint(s) for ${options.modId}; ${unresolvedNote}.`
      : `${candidateNote}; no bend segment geometry was needed; ${unresolvedNote}.`,
  };
}
