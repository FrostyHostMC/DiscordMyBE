import { MODEL_FACE_ORDER, type IntermediateModel, type IRCube, type ModelFaceName } from '@/utils/javaModelIR';

/**
 * Precision UV mapping engine.
 *
 * Java and Bedrock describe texture regions in two different coordinate systems:
 *
 *   Java    — one `[u1, v1, u2, v2]` rectangle per face, in 0..16 model space for
 *             block/item models and in absolute pixels for models that declare their
 *             own `texture_size` (entity models, GeckoLib `.geo.json`).
 *   Bedrock — an anchor point `uv` plus a signed `uv_size`, sampled against the sheet
 *             declared by `description.texture_width/texture_height`.
 *
 * The conversion therefore has to (a) work out which space the source UVs live in,
 * (b) declare the sheet that keeps the source sampling ratio 1:1, and (c) translate
 * every rectangle without ever clamping it — a clamp is data loss, and 668 clamps on
 * one conversion is exactly how a whole mod ends up wearing the wrong quarter of its
 * texture atlas.
 *
 * Mirroring, per-face rotation and negative/out-of-range coordinates are resolved
 * mathematically here; anything that genuinely cannot be reconciled is reported by the
 * caller instead of being silently rewritten.
 */

export type UvSpace = 'model' | 'pixel';

export interface UvSheet {
  /** Pixel space the emitted UVs are measured in (written into the geometry description). */
  width: number;
  height: number;
  /** Multiplier that takes a source UV value into that pixel space. */
  scaleU: number;
  scaleV: number;
  /** How the source model authored its UVs. */
  space: UvSpace;
  declaredWidth: number;
  declaredHeight: number;
  actualWidth: number | null;
  actualHeight: number | null;
  notes: string[];
}

/** The subset of a sheet every translation and comparison needs. */
export type UvSheetLike = Pick<UvSheet, 'width' | 'height' | 'scaleU' | 'scaleV'>;

export interface UvExtent {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
  faces: number;
}

export interface UvTranslation {
  uv: [number, number];
  uv_size: [number, number];
  /** in-range: fits the sheet · wrapped: crosses the sheet edge · outside-sheet: anchor is off-sheet. */
  status: 'in-range' | 'wrapped' | 'outside-sheet';
  evidence: string;
}

export interface UvSample {
  pointer: string;
  origin: [number, number];
  span: [number, number];
}

export interface UvRangeVerdict {
  status: 'clean' | 'wrapped' | 'mismatch';
  samples: number;
  wrapped: number;
  mismatched: string[];
  detail: string;
}

export interface UvFaceComparison {
  face: ModelFaceName;
  source: [number, number, number, number];
  expected: UvTranslation;
  emitted: { uv: number[]; uv_size: number[] } | null;
  matched: boolean;
  reason: string;
}

export interface UvComparisonReport {
  faces: number;
  matched: number;
  mismatches: UvFaceComparison[];
  note: string | null;
}

const EPSILON = 0.011;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Smallest power-of-two sheet that can hold `value`, bounded to sane texture sizes. */
export function pow2Sheet(value: number): number {
  const target = Math.max(16, Math.ceil(finite(value)));
  let size = 16;
  while (size < target && size < 2048) size *= 2;
  return size;
}

function cubeDimensions(cube: IRCube): [number, number, number] {
  return [
    Math.max(0.1, Math.abs(cube.to[0] - cube.from[0])),
    Math.max(0.1, Math.abs(cube.to[1] - cube.from[1])),
    Math.max(0.1, Math.abs(cube.to[2] - cube.from[2])),
  ];
}

/** Highest/lowest UV value the model actually uses, across faces and box origins. */
export function measureUvExtent(ir: IntermediateModel): UvExtent {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  let faces = 0;
  const track = (u: number, v: number) => {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  };

  for (const bone of ir.bones) {
    for (const cube of bone.cubes) {
      for (const faceName of MODEL_FACE_ORDER) {
        const face = cube.faces[faceName];
        if (!face) continue;
        faces += 1;
        if (face.uv) {
          track(face.uv[0], face.uv[1]);
          track(face.uv[2], face.uv[3]);
        } else if (cube.boxUv) {
          track(cube.boxUv[0], cube.boxUv[1]);
        }
      }
      if (cube.boxUv) {
        const [width, height, depth] = cubeDimensions(cube);
        // A Java box UV expands to u + 2·depth + width, so the sheet must cover that.
        track(cube.boxUv[0] + width + depth * 2, cube.boxUv[1] + height + depth * 2);
      }
    }
  }

  if (faces === 0) return { minU: 0, minV: 0, maxU: 0, maxV: 0, faces: 0 };
  return { minU, minV, maxU, maxV, faces };
}

export interface UvSheetInput {
  declaredWidth?: number;
  declaredHeight?: number;
  actualWidth?: number | null;
  actualHeight?: number | null;
  extent: UvExtent;
}

/**
 * Decides which UV space the model uses and which sheet declaration keeps the emitted
 * sampling ratio identical to the source. Coordinates are never rescaled to "fix" an
 * out-of-range rectangle: that would move the face, which is the bug this replaces.
 */
export function stabilizeUvSheet(input: UvSheetInput): UvSheet {
  const extent = input.extent;
  const declaredWidth = Math.round(finite(input.declaredWidth ?? 0));
  const declaredHeight = Math.round(finite(input.declaredHeight ?? 0));
  const actualWidth = input.actualWidth && input.actualWidth >= 8 ? Math.round(input.actualWidth) : null;
  const actualHeight = input.actualHeight && input.actualHeight >= 8 ? Math.round(input.actualHeight) : null;
  const declaredKnown = declaredWidth >= 8 && declaredHeight >= 8;
  const pixelSpace = extent.maxU > 16.01 || extent.maxV > 16.01;
  const notes: string[] = [];

  if (pixelSpace) {
    let width = declaredKnown ? declaredWidth : actualWidth ?? pow2Sheet(extent.maxU);
    let height = declaredKnown ? declaredHeight : actualHeight ?? pow2Sheet(extent.maxV);
    if (!declaredKnown && (extent.maxU > width || extent.maxV > height)) {
      // No declared sheet at all (common in GeckoLib): derive a sheet that holds the
      // pixel-space UVs, which keeps every face on the pixels it was authored for.
      width = pow2Sheet(Math.max(extent.maxU, width));
      height = pow2Sheet(Math.max(extent.maxV, height));
      notes.push(`The model declares no texture sheet; ${width}x${height} was derived from its pixel-space UVs.`);
    }
    if (actualWidth && width !== actualWidth) {
      notes.push(
        `UVs are authored against a ${width}px sheet while the shipped texture is ${actualWidth}px — the source ratio is kept and no coordinate is clamped.`,
      );
    }
    if (extent.maxU > width + 0.5 || extent.maxV > height + 0.5) {
      notes.push(
        `UV coordinates reach ${Math.round(extent.maxU)}x${Math.round(extent.maxV)} on a ${width}x${height} sheet; they are preserved as authored because Java and Bedrock clamp sampling identically.`,
      );
    }
    return {
      width,
      height,
      scaleU: 1,
      scaleV: 1,
      space: 'pixel',
      declaredWidth,
      declaredHeight,
      actualWidth,
      actualHeight,
      notes,
    };
  }

  const width = actualWidth ?? (declaredKnown ? declaredWidth : 16);
  const height = actualHeight ?? (declaredKnown ? declaredHeight : 16);
  if (declaredKnown && (declaredWidth !== width || declaredHeight !== height)) {
    notes.push(
      `Model declares a ${declaredWidth}x${declaredHeight} sheet but the bound texture is ${width}x${height}; UVs are scaled to the shipped sheet so the region stays identical.`,
    );
  }
  return {
    width,
    height,
    scaleU: width / 16,
    scaleV: height / 16,
    space: 'model',
    declaredWidth,
    declaredHeight,
    actualWidth,
    actualHeight,
    notes,
  };
}

/** Wraps an off-sheet coordinate instead of clamping it (clamping loses the region). */
export function wrapUvCoordinate(value: number, sheetSize: number): { value: number; wrapped: boolean } {
  if (!Number.isFinite(value)) return { value: 0, wrapped: true };
  if (sheetSize <= 0) return { value, wrapped: false };
  if (value >= 0 && value <= sheetSize) return { value, wrapped: false };
  const wrapped = ((value % sheetSize) + sheetSize) % sheetSize;
  return { value: wrapped, wrapped: true };
}

/** Smallest span an emitted rectangle keeps, so a face never collapses onto one pixel. */
const UV_MIN_SPAN = 0.0001;

/** UV precision is kept at 4 decimals: rounding to whole pixels moves the face. */
export function roundUv(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export interface FaceMirror {
  /** Java authored `u2 < u1`, which means the texture is sampled mirrored on this face. */
  u?: boolean;
  v?: boolean;
}

/**
 * Applies the Bedrock anchor/sign convention for one face to an axis-aligned region.
 *
 * Bedrock draws `south`/`west` and `down` the opposite way round from Java, so those faces
 * move their anchor to the far edge and carry a signed size. A source rectangle that Java
 * authored mirrored flips the sign again — `uv_size` is the only mechanism Bedrock has for
 * mirroring, so dropping that information silently un-mirrors the face.
 */
export function orientFaceRect(
  faceName: ModelFaceName,
  origin: [number, number],
  size: [number, number],
  mirror: FaceMirror = {},
): { uv: [number, number]; uv_size: [number, number] } {
  let signU = 1;
  let signV = 1;
  if (faceName === 'south' || faceName === 'west') signU = -1;
  if (faceName === 'down') signV = -1;
  if (mirror.u) signU *= -1;
  if (mirror.v) signV *= -1;
  return {
    uv: [
      roundUv(signU < 0 ? origin[0] + size[0] : origin[0]),
      roundUv(signV < 0 ? origin[1] + size[1] : origin[1]),
    ],
    uv_size: [roundUv(size[0] * signU), roundUv(size[1] * signV)],
  };
}

/** Classifies a source rectangle against the sheet without moving a single coordinate. */
function classifyRect(
  minU: number,
  minV: number,
  spanU: number,
  spanV: number,
  sheet: UvSheetLike,
): 'in-range' | 'wrapped' | 'outside-sheet' {
  if (
    minU < -EPSILON ||
    minV < -EPSILON ||
    minU > sheet.width + EPSILON ||
    minV > sheet.height + EPSILON
  ) {
    return 'outside-sheet';
  }
  if (minU + spanU > sheet.width + EPSILON || minV + spanV > sheet.height + EPSILON) return 'wrapped';
  return 'in-range';
}

export interface FaceUvRequest {
  faceName: ModelFaceName;
  /** Java rectangle in source model space. */
  rect: [number, number, number, number];
  sheet: UvSheetLike;
}

/**
 * Translates one Java face rectangle into a Bedrock anchor + signed size.
 *
 * The rectangle is never clamped and never relocated: its origin and span are carried over
 * with full precision, Java mirroring (`u2 < u1`) becomes a signed `uv_size`, and the faces
 * Bedrock draws the other way round get their own sign on top of that.
 */
export function translateFaceUv(request: FaceUvRequest): UvTranslation {
  const { faceName, rect, sheet } = request;
  const u1 = rect[0] * sheet.scaleU;
  const u2 = rect[2] * sheet.scaleU;
  const v1 = rect[1] * sheet.scaleV;
  const v2 = rect[3] * sheet.scaleV;
  // Java expresses mirroring by authoring the rectangle backwards. It is carried into the
  // signed Bedrock size instead of being normalised away.
  const mirrorU = u2 < u1;
  const mirrorV = v2 < v1;
  const spanU = Math.max(UV_MIN_SPAN, roundUv(Math.abs(u2 - u1)));
  const spanV = Math.max(UV_MIN_SPAN, roundUv(Math.abs(v2 - v1)));
  const originU = roundUv(Math.min(u1, u2));
  const originV = roundUv(Math.min(v1, v2));
  const oriented = orientFaceRect(faceName, [originU, originV], [spanU, spanV], {
    u: mirrorU,
    v: mirrorV,
  });
  const status = classifyRect(originU, originV, spanU, spanV, sheet);
  const mirrorNote = mirrorU || mirrorV ? ' The source rectangle was mirrored and keeps that mirroring through the signed size.' : '';
  const evidence =
    status === 'in-range'
      ? `[${originU}, ${originV}] ${spanU}x${spanV} sits inside the ${sheet.width}x${sheet.height} sheet.${mirrorNote}`
      : status === 'wrapped'
        ? `Source rect starts at [${originU}, ${originV}] and runs ${spanU}x${spanV}, crossing the ${sheet.width}x${sheet.height} sheet edge; the anchor is preserved as authored because the engine clamps sampling exactly like Java.${mirrorNote}`
        : `Source rectangle starts at [${originU}, ${originV}] on a ${sheet.width}x${sheet.height} sheet; it is preserved as authored (never clamped, never relocated) so the sampled region is unchanged.${mirrorNote}`;

  return { uv: oriented.uv, uv_size: oriented.uv_size, status, evidence };
}

export interface BoxUvRequest {
  /** Element-level box UV origin in source model space. */
  origin: [number, number];
  /** Cube dimensions in model units (width, height, depth). */
  dimensions: [number, number, number];
  faceName: ModelFaceName;
  sheet: UvSheetLike;
}

/** Expands a Java box UV origin into the signed per-face rectangle Bedrock expects. */
export function translateBoxUvFace(request: BoxUvRequest): UvTranslation {
  const { origin, dimensions, faceName, sheet } = request;
  const [width, height, depth] = dimensions;
  const u = roundUv(origin[0] * sheet.scaleU);
  const v = roundUv(origin[1] * sheet.scaleV);
  const w = Math.max(UV_MIN_SPAN, roundUv(width * sheet.scaleU));
  const h = Math.max(UV_MIN_SPAN, roundUv(height * sheet.scaleV));
  const d = Math.max(UV_MIN_SPAN, roundUv(depth * sheet.scaleU));

  let rawU = u;
  let rawV = v;
  let size: [number, number] = [w, h];
  switch (faceName) {
    case 'north':
      rawU = u + d;
      rawV = v + d;
      break;
    case 'east':
      rawU = u;
      rawV = v + d;
      size = [d, h];
      break;
    case 'south':
      rawU = u + d + w + d;
      rawV = v + d;
      size = [-w, h];
      break;
    case 'west':
      rawU = u + d + w;
      rawV = v + d;
      size = [-d, h];
      break;
    case 'up':
      rawU = u + d;
      rawV = v;
      size = [w, d];
      break;
    case 'down':
      rawU = u + d + w;
      rawV = v + d;
      size = [w, -d];
      break;
    default:
      break;
  }

  const anchorU = roundUv(rawU);
  const anchorV = roundUv(rawV);
  const spanU = Math.abs(size[0]);
  const spanV = Math.abs(size[1]);
  const status = classifyRect(anchorU, anchorV, spanU, spanV, sheet);

  return {
    uv: [anchorU, anchorV],
    uv_size: size,
    status,
    evidence:
      status === 'in-range'
        ? `Box UV origin [${u}, ${v}] expands to [${anchorU}, ${anchorV}] ${spanU}x${spanV} on the ${sheet.width}x${sheet.height} sheet.`
        : `Box UV expansion for face "${faceName}" reaches [${anchorU}, ${anchorV}] on a ${sheet.width}x${sheet.height} sheet; the coordinate is preserved as authored, never clamped or relocated.`,
  };
}

/**
 * Classifies already-emitted Bedrock UVs.
 *
 * A rectangle that starts inside the sheet but runs past its edge is legitimate: Java
 * and Bedrock both clamp sampling, so the face is drawn from the same pixels. Only an
 * anchor that sits outside the sheet is an unreconcilable defect worth reporting.
 */
export function classifyUvSamples(samples: UvSample[], sheet: { width: number; height: number }): UvRangeVerdict {
  const mismatched: string[] = [];
  let wrapped = 0;
  for (const sample of samples) {
    const [u, v] = sample.origin;
    const [spanU, spanV] = sample.span;
    if (u < -EPSILON || v < -EPSILON || u > sheet.width + EPSILON || v > sheet.height + EPSILON) {
      mismatched.push(sample.pointer);
      continue;
    }
    if (u + spanU > sheet.width + EPSILON || v + spanV > sheet.height + EPSILON) wrapped += 1;
  }
  const status: UvRangeVerdict['status'] =
    mismatched.length > 0 ? 'mismatch' : wrapped > 0 ? 'wrapped' : 'clean';
  const detail =
    status === 'mismatch'
      ? `${mismatched.length} of ${samples.length} face anchor(s) start outside the declared ${sheet.width}x${sheet.height} sheet (first: ${mismatched[0]}) — the model's UV space disagrees with its sheet declaration.`
      : status === 'wrapped'
        ? `${wrapped} of ${samples.length} face rectangle(s) cross the ${sheet.width}x${sheet.height} sheet edge; that is legitimate wrapping and the anchor is preserved.`
        : `All ${samples.length} face anchor(s) sit inside the ${sheet.width}x${sheet.height} sheet.`;
  return { status, samples: samples.length, wrapped, mismatched, detail };
}

export interface UvCoverageVerdict {
  /** covered: the declared sheet holds every rectangle · sheet-too-small: it does not. */
  status: 'covered' | 'sheet-too-small' | 'no-samples';
  samples: number;
  sheetWidth: number;
  sheetHeight: number;
  /** Extent the emitted rectangles actually reach, in texture pixels. */
  measuredWidth: number;
  measuredHeight: number;
  /** Smallest power-of-two sheet that can hold every rectangle. */
  neededWidth: number;
  neededHeight: number;
  worst: string | null;
  detail: string;
}

/**
 * Verifies the declared texture sheet against the UV rectangles that were actually emitted.
 *
 * This is the UV defect that actually breaks a model: an anchor that starts at or crosses
 * the sheet edge is supported (Bedrock clamps sampling exactly like Java does), but a sheet
 * declaration smaller than the space the rectangles live in makes every face past the edge
 * sample the wrong pixels. The verdict never moves a coordinate — it reports the sheet that
 * must be declared instead.
 */
export function verifySheetCoverage(
  samples: UvSample[],
  sheet: { width: number; height: number },
): UvCoverageVerdict {
  if (samples.length === 0) {
    return {
      status: 'no-samples',
      samples: 0,
      sheetWidth: sheet.width,
      sheetHeight: sheet.height,
      measuredWidth: 0,
      measuredHeight: 0,
      neededWidth: Math.max(16, sheet.width),
      neededHeight: Math.max(16, sheet.height),
      worst: null,
      detail: 'The geometry declares no UV source, so no sheet can be verified.',
    };
  }

  let measuredWidth = 0;
  let measuredHeight = 0;
  let worst: string | null = null;
  let worstReach = 0;
  for (const sample of samples) {
    const reachU = sample.origin[0] + Math.abs(sample.span[0]);
    const reachV = sample.origin[1] + Math.abs(sample.span[1]);
    if (reachU > measuredWidth) measuredWidth = reachU;
    if (reachV > measuredHeight) measuredHeight = reachV;
    const reach = Math.max(reachU / Math.max(1, sheet.width), reachV / Math.max(1, sheet.height));
    if (reach > worstReach) {
      worstReach = reach;
      worst = sample.pointer;
    }
  }

  const neededWidth = Math.max(16, pow2Sheet(Math.max(measuredWidth, sheet.width)));
  const neededHeight = Math.max(16, pow2Sheet(Math.max(measuredHeight, sheet.height)));
  const covered = measuredWidth <= sheet.width + 1 && measuredHeight <= sheet.height + 1;
  if (covered) {
    return {
      status: 'covered',
      samples: samples.length,
      sheetWidth: sheet.width,
      sheetHeight: sheet.height,
      measuredWidth,
      measuredHeight,
      neededWidth,
      neededHeight,
      worst,
      detail: `Every one of the ${samples.length} face rectangle(s) fits the declared ${sheet.width}x${sheet.height} sheet.`,
    };
  }
  return {
    status: 'sheet-too-small',
    samples: samples.length,
    sheetWidth: sheet.width,
    sheetHeight: sheet.height,
    measuredWidth,
    measuredHeight,
    neededWidth,
    neededHeight,
    worst,
    detail: `The declared sheet is ${sheet.width}x${sheet.height}, but the emitted rectangles reach ${Math.round(measuredWidth)}x${Math.round(measuredHeight)} (first: ${worst ?? 'unknown'}). Faces past the edge sample clamped edge pixels instead of their own region, so a ${neededWidth}x${neededHeight} sheet must be declared — the coordinates themselves are correct and are not touched.`,
  };
}

interface EmittedCube {
  uv?: Record<string, { uv?: number[]; uv_size?: number[] }>;
}

/** Collects the emitted per-face UV pairs of a geometry document, in writer order. */
function readEmittedCubes(geometryJson: string): EmittedCube[] | null {
  try {
    const parsed = JSON.parse(geometryJson) as {
      'minecraft:geometry'?: Array<{ bones?: Array<{ cubes?: EmittedCube[] }> }>;
    };
    const variant = parsed['minecraft:geometry']?.[0];
    if (!variant) return null;
    return (variant.bones ?? []).flatMap((bone) => bone.cubes ?? []);
  } catch {
    return null;
  }
}

/**
 * Source-versus-output UV comparison test.
 *
 * Re-derives the expected Bedrock pair for every source face and checks that what was
 * actually written matches it — including the signed size, so a clamped or collapsed
 * rectangle fails instead of passing as "valid".
 */
export function compareGeometryUv(
  ir: IntermediateModel,
  geometryJson: string,
  sheet: UvSheetLike,
): UvComparisonReport {
  const sourceCubes = ir.bones.flatMap((bone) => bone.cubes);
  const emittedCubes = readEmittedCubes(geometryJson);
  if (!emittedCubes) {
    return { faces: 0, matched: 0, mismatches: [], note: 'The emitted geometry could not be parsed, so UVs were not compared.' };
  }
  if (emittedCubes.length !== sourceCubes.length) {
    return {
      faces: 0,
      matched: 0,
      mismatches: [],
      note: `Cube count changed during conversion (${sourceCubes.length} source -> ${emittedCubes.length} emitted), so face pairing was skipped.`,
    };
  }

  const mismatches: UvFaceComparison[] = [];
  let faces = 0;
  let matched = 0;
  sourceCubes.forEach((cube, cubeIndex) => {
    const emitted = emittedCubes[cubeIndex];
    for (const faceName of MODEL_FACE_ORDER) {
      const face = cube.faces[faceName];
      if (!face) continue;
      faces += 1;
      const expected = face.uv
        ? translateFaceUv({ faceName, rect: face.uv, sheet })
        : cube.boxUv
          ? translateBoxUvFace({ origin: cube.boxUv, dimensions: cubeDimensions(cube), faceName, sheet })
          : null;
      const emittedFace = emitted?.uv?.[faceName];
      if (!expected || !emittedFace || !Array.isArray(emittedFace.uv) || !Array.isArray(emittedFace.uv_size)) {
        mismatches.push({
          face: faceName,
          source: face.uv ?? [0, 0, 0, 0],
          expected: expected ?? { uv: [0, 0], uv_size: [0, 0], status: 'outside-sheet', evidence: 'no source UV' },
          emitted: emittedFace ? { uv: emittedFace.uv ?? [], uv_size: emittedFace.uv_size ?? [] } : null,
          matched: false,
          reason: 'The face has no comparable UV pair in the emitted geometry.',
        });
        continue;
      }
      const uvMatches =
        Math.abs(emittedFace.uv[0] - expected.uv[0]) <= EPSILON &&
        Math.abs(emittedFace.uv[1] - expected.uv[1]) <= EPSILON;
      const sizeMatches =
        Math.abs(emittedFace.uv_size[0] - expected.uv_size[0]) <= EPSILON &&
        Math.abs(emittedFace.uv_size[1] - expected.uv_size[1]) <= EPSILON;
      if (uvMatches && sizeMatches) {
        matched += 1;
        continue;
      }
      mismatches.push({
        face: faceName,
        source: face.uv ?? [0, 0, 0, 0],
        expected,
        emitted: { uv: emittedFace.uv, uv_size: emittedFace.uv_size },
        matched: false,
        reason: !sizeMatches
          ? `Size changed: expected ${expected.uv_size.join(', ')} but ${emittedFace.uv_size.join(', ')} was written (a clamped or collapsed rectangle).`
          : `Anchor moved: expected ${expected.uv.join(', ')} but ${emittedFace.uv.join(', ')} was written.`,
      });
    }
  });

  return { faces, matched, mismatches, note: null };
}