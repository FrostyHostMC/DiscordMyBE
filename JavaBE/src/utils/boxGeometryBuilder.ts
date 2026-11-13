import type { IntermediateModel, IRCube } from '@/utils/javaModelIR';
import { buildSourceBoneGraph, type SourceBoneGroup } from '@/utils/universalBoneGraph';
import { writeBedrockGeometry, type UvConversionReport } from '@/utils/bedrockGeometryWriter';
import { canonicalGeometryId } from '@/utils/geometryRegistry';

/**
 * Shared box → Bedrock geometry writer.
 *
 * Several modelling formats — Tabula, OptiFine CEM, legacy Techne-style documents — express a
 * model as plain boxes with a box-UV origin and a part name, and nothing else. None of them
 * were readable by this engine, so every mob shipped from such a mod fell back to a generic
 * rig (or rendered nothing at all). This module turns that shared shape into a real Bedrock
 * skeleton: the source part names are preserved, the hierarchy is rebuilt from the document's
 * own evidence, and the cubes are written through the same precision UV writer the rest of
 * the pipeline uses, so box UVs land on the real sheet instead of a guessed region.
 */

export const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const vec3 = (value: unknown): [number, number, number] | null =>
  Array.isArray(value) && value.length >= 3
    ? [num(value[0]), num(value[1]), num(value[2])]
    : null;

export const vec2 = (value: unknown): [number, number] | null =>
  Array.isArray(value) && value.length >= 2 ? [num(value[0]), num(value[1])] : null;

const round1 = (value: number): number => Math.round(value * 10) / 10;

export interface BoxSpec {
  from: [number, number, number];
  to: [number, number, number];
  /** Box UV origin (`[u, v]`). Bedrock derives the six face rectangles from it. */
  uvOrigin?: [number, number];
  rotation?: { origin: [number, number, number]; axis: 'x' | 'y' | 'z'; angle: number };
}

/** One source box → one intermediate cube. Degenerate boxes are kept at 0.1 units. */
export function boxCube(spec: BoxSpec): IRCube {
  const lo: [number, number, number] = [
    round1(Math.min(spec.from[0], spec.to[0])),
    round1(Math.min(spec.from[1], spec.to[1])),
    round1(Math.min(spec.from[2], spec.to[2])),
  ];
  const hi: [number, number, number] = [
    round1(Math.max(spec.from[0], spec.to[0])),
    round1(Math.max(spec.from[1], spec.to[1])),
    round1(Math.max(spec.from[2], spec.to[2])),
  ];
  for (let axis = 0; axis < 3; axis += 1) {
    if (hi[axis] - lo[axis] < 0.1) hi[axis] = lo[axis] + 0.1;
  }
  return {
    from: lo,
    to: hi,
    boxUv: spec.uvOrigin ?? [0, 0],
    // Faces are left empty on purpose: the writer then expands all six faces from the box's
    // own UV origin, which is exactly how these formats declare their mapping.
    faces: {},
    rotation: spec.rotation
      ? {
          origin: spec.rotation.origin,
          axis: spec.rotation.axis,
          angle: spec.rotation.angle,
          rescale: false,
        }
      : undefined,
    shade: true,
  };
}

export interface SourceGeometryWrite {
  id: string;
  json: string;
  bones: number;
  cubes: number;
  parts: string[];
  preserved: number;
  quadruped: boolean;
  uv: UvConversionReport;
}

const normaliseKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Writes source part groups into a Bedrock geometry document.
 * Bone rotations declared by the source document (Tabula sections, CEM parts) are applied to
 * the matching shipped bone, never dropped.
 */
export function writeSourceGeometry(input: {
  modId: string;
  assetId: string;
  textureWidth: number;
  textureHeight: number;
  groups: SourceBoneGroup[];
  rotations?: Record<string, [number, number, number]>;
}): SourceGeometryWrite | null {
  const graph = buildSourceBoneGraph(input.groups);
  if (graph.bones.length === 0) return null;

  if (input.rotations) {
    const byKey = new Map<string, [number, number, number]>();
    for (const [name, rotation] of Object.entries(input.rotations)) {
      const key = normaliseKey(name);
      if (key) byKey.set(key, rotation);
    }
    for (const bone of graph.bones) {
      const rotation = byKey.get(normaliseKey(bone.name));
      if (rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0)) {
        bone.rotation = rotation;
      }
    }
  }

  const identifier = canonicalGeometryId(input.modId, input.assetId);
  const ir: IntermediateModel = {
    id: identifier,
    sourcePath: `source/${input.assetId}`,
    space: 'entity',
    parentChain: [],
    textureWidth: input.textureWidth,
    textureHeight: input.textureHeight,
    bones: graph.bones,
    display: {},
    overrides: [],
    textureRefs: { 0: `${input.modId}:${input.assetId}` },
    textureAliases: {},
    resolvedTextures: {},
    uvLock: false,
    ambientOcclusion: true,
    guiLight: 'side',
    diagnostics: [],
    cubeCount: graph.bones.reduce((total, bone) => total + bone.cubes.length, 0),
  };

  const written = writeBedrockGeometry(ir, { identifier });
  if (written.cubes === 0) return null;

  return {
    id: identifier,
    json: written.json,
    bones: written.bones,
    cubes: written.cubes,
    parts: graph.parts,
    preserved: graph.preservedNames,
    quadruped: graph.quadruped,
    uv: written.uv,
  };
}