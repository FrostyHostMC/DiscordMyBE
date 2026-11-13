import {
  MODEL_FACE_ORDER,
  type IntermediateModel,
  type IRBone,
  type IRCube,
  type ModelFaceName,
} from '@/utils/javaModelIR';
import {
  measureUvExtent,
  stabilizeUvSheet,
  translateBoxUvFace,
  translateFaceUv,
  type UvSpace,
  type UvTranslation,
} from '@/utils/uvMapping';

export interface GeometryWriteOptions {
  identifier: string;
  /** Blockstate rotation baked into the geometry (multiples of 90 degrees). */
  rotationX?: number;
  rotationY?: number;
  /** Explicit bone hierarchy, used when several element groups form one rig. */
  bones?: IRBone[];
}

/** What the UV translation actually did, so the auditor can report it instead of guessing. */
export interface UvConversionReport {
  sheet: { width: number; height: number; space: UvSpace; scaleU: number; scaleV: number };
  faces: number;
  inRange: number;
  wrapped: number;
  outsideSheet: number;
  /** Faces whose source carried no UV rectangle and used a layout derived from the cube. */
  approximated?: number;
  notes: string[];
}

export interface WrittenGeometry {
  identifier: string;
  json: string;
  bones: number;
  cubes: number;
  rotated: boolean;
  uv: UvConversionReport;
}

interface BedrockFace {
  uv: [number, number];
  uv_size: [number, number];
  rotation?: 90 | 180 | 270;
}

const DIR_VECTORS: Record<ModelFaceName, [number, number, number]> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const round1 = (value: number): number => Math.round(value * 100) / 100;

/** Rotates a point/direction the way a Java blockstate `x`/`y` rotation rotates the model. */
function rotateVector(
  vector: [number, number, number],
  degreesX: number,
  degreesY: number,
): [number, number, number] {
  let [x, y, z] = vector;
  const stepsX = ((Math.round(degreesX / 90) % 4) + 4) % 4;
  const stepsY = ((Math.round(degreesY / 90) % 4) + 4) % 4;
  for (let i = 0; i < stepsX; i++) {
    const ny = -z;
    const nz = y;
    y = ny;
    z = nz;
  }
  for (let i = 0; i < stepsY; i++) {
    const nx = -z;
    const nz = x;
    x = nx;
    z = nz;
  }
  return [x, y, z];
}

function faceOfDirection(direction: [number, number, number]): ModelFaceName | null {
  for (const faceName of MODEL_FACE_ORDER) {
    const vector = DIR_VECTORS[faceName];
    if (vector[0] === direction[0] && vector[1] === direction[1] && vector[2] === direction[2]) return faceName;
  }
  return null;
}

function cubeDimensions(cube: IRCube): [number, number, number] {
  return [
    Math.max(0.1, Math.abs(cube.to[0] - cube.from[0])),
    Math.max(0.1, Math.abs(cube.to[1] - cube.from[1])),
    Math.max(0.1, Math.abs(cube.to[2] - cube.from[2])),
  ];
}

function recordTranslation(report: UvConversionReport, translation: UvTranslation): void {
  report.faces += 1;
  if (translation.status === 'in-range') report.inRange += 1;
  else if (translation.status === 'wrapped') report.wrapped += 1;
  else report.outsideSheet += 1;
}

/** Applies the Java `rescale` flag so a rotated element keeps its original footprint. */
function rescaleCube(cube: IRCube): IRCube {
  const rotation = cube.rotation;
  if (!rotation || !rotation.rescale) return cube;
  const factor = clamp(Math.abs(Math.cos((rotation.angle * Math.PI) / 180)), 0.25, 1);
  if (factor === 1) return cube;
  const size = cubeDimensions(cube);
  const axes: number[] = rotation.axis === 'x' ? [1, 2] : rotation.axis === 'y' ? [0, 2] : [0, 1];
  const from: [number, number, number] = [...cube.from];
  const to: [number, number, number] = [...cube.to];
  for (const axis of axes) {
    const delta = (size[axis] * (1 - factor)) / 2;
    from[axis] += delta;
    to[axis] -= delta;
  }
  return { ...cube, from, to };
}

/** Bakes a Java blockstate x/y rotation into the cube geometry and its face assignment. */
function rotateCube(cube: IRCube, degreesX: number, degreesY: number, uvLock: boolean): IRCube {
  const corners: Array<[number, number, number]> = [];
  for (const x of [cube.from[0], cube.to[0]]) {
    for (const y of [cube.from[1], cube.to[1]]) {
      for (const z of [cube.from[2], cube.to[2]]) {
        corners.push(rotateVector([x - 8, y - 8, z - 8], degreesX, degreesY));
      }
    }
  }
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  const zs = corners.map((corner) => corner[2]);
  const from: [number, number, number] = [Math.min(...xs) + 8, Math.min(...ys) + 8, Math.min(...zs) + 8];
  const to: [number, number, number] = [Math.max(...xs) + 8, Math.max(...ys) + 8, Math.max(...zs) + 8];

  const faces: Partial<Record<ModelFaceName, IRCube['faces'][ModelFaceName]>> = {};
  for (const faceName of MODEL_FACE_ORDER) {
    const face = cube.faces[faceName];
    if (!face) continue;
    const rotated = faceOfDirection(rotateVector(DIR_VECTORS[faceName], degreesX, degreesY));
    if (!rotated) continue;
    // `uvlock` keeps every texture anchored to its world direction, so the UV that
    // used to live on the destination face is kept after the geometry rotates.
    const lockedUv = uvLock ? cube.faces[rotated]?.uv : undefined;
    faces[rotated] = lockedUv ? { ...face, uv: lockedUv } : { ...face };
  }

  const rotation = cube.rotation
    ? {
        ...cube.rotation,
        origin: rotateVector(
          [cube.rotation.origin[0] - 8, cube.rotation.origin[1] - 8, cube.rotation.origin[2] - 8],
          degreesX,
          degreesY,
        ).map((value) => value + 8) as [number, number, number],
        axis: rotateAxis(cube.rotation.axis, degreesX, degreesY),
      }
    : undefined;

  return { ...cube, from, to, faces, rotation };
}

function rotateAxis(axis: 'x' | 'y' | 'z', degreesX: number, degreesY: number): 'x' | 'y' | 'z' {
  const vector: [number, number, number] = [axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0];
  const rotated = rotateVector(vector, degreesX, degreesY);
  const resolved = faceOfDirection(rotated);
  if (!resolved) return axis;
  if (resolved === 'east' || resolved === 'west') return 'x';
  if (resolved === 'up' || resolved === 'down') return 'y';
  return 'z';
}

/**
 * Converts one face onto the bound texture through the precision UV engine.
 *
 * Nothing is clamped: an anchor outside the sheet is wrapped, and a rectangle that only
 * crosses the sheet edge is preserved as authored because Java clamps sampling exactly
 * the way Bedrock does.
 */
function writeFace(
  cube: IRCube,
  faceName: ModelFaceName,
  sheet: ReturnType<typeof stabilizeUvSheet>,
  report: UvConversionReport,
): BedrockFace | null {
  const face = cube.faces[faceName];
  const faceRotation = face && (face.rotation === 90 || face.rotation === 180 || face.rotation === 270)
    ? face.rotation
    : undefined;

  // A face with no UV rectangle used to be dropped, which is exactly how a torso, head or
  // leg silently stopped rendering while the rest of the model drew. The rectangle is now
  // derived from the cube's own box layout and reported as approximated, so the part is
  // textured from real sheet pixels instead of disappearing.
  const fromFace = face?.uv ? translateFaceUv({ faceName, rect: face.uv, sheet }) : null;
  const fromBox = fromFace
    ? null
    : translateBoxUvFace({
        origin: cube.boxUv ?? [0, 0],
        dimensions: cubeDimensions(cube),
        faceName,
        sheet,
      });
  const translation = fromFace ?? fromBox;
  if (!translation) return null;
  if (!fromFace && !cube.boxUv) report.approximated = (report.approximated ?? 0) + 1;
  recordTranslation(report, translation);

  return {
    uv: translation.uv,
    uv_size: translation.uv_size,
    ...(faceRotation ? { rotation: faceRotation } : {}),
  };
}

function writeCube(
  cube: IRCube,
  offset: number,
  sheet: ReturnType<typeof stabilizeUvSheet>,
  report: UvConversionReport,
): Record<string, unknown> | null {
  const rescaled = rescaleCube(cube);
  const size: [number, number, number] = [
    Math.max(0.1, round1(Math.abs(rescaled.to[0] - rescaled.from[0]))),
    Math.max(0.1, round1(Math.abs(rescaled.to[1] - rescaled.from[1]))),
    Math.max(0.1, round1(Math.abs(rescaled.to[2] - rescaled.from[2]))),
  ];
  // Declared faces are written as authored. A cube that declares no face at all is still a
  // real body part, so all six are written from its box layout instead of dropping it.
  const declared = MODEL_FACE_ORDER.filter((faceName) => Boolean(cube.faces?.[faceName]));
  const faceNames = declared.length > 0 ? declared : MODEL_FACE_ORDER;
  const uv: Record<string, BedrockFace> = {};
  for (const faceName of faceNames) {
    const written = writeFace(cube, faceName, sheet, report);
    if (written) uv[faceName] = written;
  }
  if (Object.keys(uv).length === 0) return null;

  const written: Record<string, unknown> = {
    origin: [
      round1(Math.min(rescaled.from[0], rescaled.to[0]) - offset),
      round1(Math.min(rescaled.from[1], rescaled.to[1])),
      round1(Math.min(rescaled.from[2], rescaled.to[2]) - offset),
    ],
    size,
    uv,
  };

  const rotation = rescaled.rotation;
  if (rotation && Math.round(rotation.angle) !== 0) {
    written.pivot = [
      round1(rotation.origin[0] - offset),
      round1(rotation.origin[1]),
      round1(rotation.origin[2] - offset),
    ];
    written.rotation = [
      rotation.axis === 'x' ? rotation.angle : 0,
      rotation.axis === 'y' ? rotation.angle : 0,
      rotation.axis === 'z' ? rotation.angle : 0,
    ];
  }
  return written;
}

/**
 * Writes the intermediate representation into a Bedrock 1.16.0 geometry document.
 *
 * All Java-specific semantics (element rotation + rescale, per-face UV rectangles,
 * box UV expansion, face rotation, blockstate x/y rotation, uv-lock) are resolved
 * before writing, so the emitted JSON only contains Bedrock primitives. UV coordinates
 * travel through the precision UV engine, which preserves the source sampling ratio and
 * reports (instead of clamping) anything that does not fit the declared sheet.
 */
export function writeBedrockGeometry(ir: IntermediateModel, options: GeometryWriteOptions): WrittenGeometry {
  const offset = ir.space === 'block' ? 8 : 0;
  const extent = measureUvExtent(ir);
  const sheet = stabilizeUvSheet({
    declaredWidth: ir.textureWidth,
    declaredHeight: ir.textureHeight,
    actualWidth: ir.textureWidth,
    actualHeight: ir.textureHeight,
    extent,
  });
  const uvReport: UvConversionReport = {
    sheet: { width: sheet.width, height: sheet.height, space: sheet.space, scaleU: sheet.scaleU, scaleV: sheet.scaleV },
    faces: 0,
    inRange: 0,
    wrapped: 0,
    outsideSheet: 0,
    notes: [...sheet.notes],
  };
  const rotationX = options.rotationX ?? 0;
  const rotationY = options.rotationY ?? 0;
  const shouldRotate = rotationX !== 0 || rotationY !== 0;

  const bones: Array<Record<string, unknown>> = [];
  let cubeTotal = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const sourceBones = options.bones ?? ir.bones;
  // A bone that owns no cubes can still be a parent. Dropping it makes Bedrock log a
  // missing-parent error for its children, so referenced parents are always kept.
  const referencedParents = new Set<string>();
  for (const bone of sourceBones) {
    if (bone.parent) referencedParents.add(bone.parent);
  }

  for (const bone of sourceBones) {
    const cubes: Record<string, unknown>[] = [];
    for (const sourceCube of bone.cubes) {
      const cube = shouldRotate ? rotateCube(sourceCube, rotationX, rotationY, ir.uvLock) : sourceCube;
      const written = writeCube(cube, offset, sheet, uvReport);
      if (!written) continue;
      cubes.push(written);
      const origin = written.origin as number[];
      const size = written.size as number[];
      minX = Math.min(minX, origin[0]);
      maxX = Math.max(maxX, origin[0] + size[0]);
      minY = Math.min(minY, origin[1]);
      maxY = Math.max(maxY, origin[1] + size[1]);
      minZ = Math.min(minZ, origin[2]);
      maxZ = Math.max(maxZ, origin[2] + size[2]);
    }
    if (cubes.length === 0 && !referencedParents.has(bone.name)) continue;
    cubeTotal += cubes.length;
    const entry: Record<string, unknown> = { name: bone.name, pivot: bone.pivot, cubes };
    if (bone.parent) entry.parent = bone.parent;
    if (bone.rotation) entry.rotation = bone.rotation;
    bones.push(entry);
  }

  const hasBounds = Number.isFinite(minX) && Number.isFinite(maxY);
  const spanX = hasBounds ? (maxX - minX) / 16 : 1;
  const spanY = hasBounds ? (maxY - minY) / 16 : 1;
  const spanZ = hasBounds ? (maxZ - minZ) / 16 : 1;

  const document = {
    format_version: '1.16.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: options.identifier,
          texture_width: sheet.width,
          texture_height: sheet.height,
          visible_bounds_width: Math.max(1, round1(Math.max(spanX, spanZ) * 1.6)),
          visible_bounds_height: Math.max(1, round1(spanY + 0.4)),
          visible_bounds_offset: [0, hasBounds ? round1((minY + maxY) / 32) : 0.5, 0],
        },
        bones,
      },
    ],
  };

  return {
    identifier: options.identifier,
    json: JSON.stringify(document, null, 2),
    bones: bones.length,
    cubes: cubeTotal,
    rotated: shouldRotate,
    uv: uvReport,
  };
}