import type { AssetIndex, JavaElement, JavaModel } from '@/utils/assetIndex';
import {
  buildIntermediateCubes,
  buildIntermediateModel,
  type IntermediateModel,
} from '@/utils/javaModelIR';
import { writeBedrockGeometry, type UvConversionReport } from '@/utils/bedrockGeometryWriter';
import { writeItemPresentation, type ItemPresentationResult } from '@/utils/bedrockItemPresentation';
import { buildRigBones, groupByRigPart } from '@/utils/modelRigBuilder';
import { buildSourceBoneGraph, type SourceBoneGroup } from '@/utils/universalBoneGraph';
import { canonicalGeometryId } from '@/utils/geometryRegistry';

export interface ConvertedGeometry {
  id: string;
  json: string;
  bones: number;
  cubes: number;
  /** Precision UV engine result: the sheet used and how every face was translated. */
  uv: UvConversionReport;
}

export interface ConvertedJavaModel {
  geometry: ConvertedGeometry;
  /** Intermediate representation the geometry was generated from. */
  ir: IntermediateModel;
  /** Bedrock render offsets / reported Java-only presentation data. */
  presentation: ItemPresentationResult;
}

export interface ConvertedEntityGeometry extends ConvertedGeometry {
  ir: IntermediateModel;
  /** True when the recovered element layout is a four-limbed quadruped. */
  quadruped: boolean;
  /** Skeleton provenance: how much of the source part hierarchy survived the port. */
  skeleton?: {
    preserved: number;
    reparented: number;
    syntheticRoot: boolean;
    parts: string[];
  };
}

export interface JavaModelConvertInput {
  modId: string;
  assetId: string;
  model: JavaModel;
  index?: AssetIndex | null;
  textureWidth: number;
  textureHeight: number;
  space?: 'block' | 'entity';
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function normalizeTextureDimension(value: number, fallback: number): number {
  const rounded = Math.round(value || 0);
  if (rounded >= 8 && rounded <= 2048) return rounded;
  return fallback;
}

/**
 * Full Java → Bedrock model conversion.
 *
 * The Java document is first normalised into an engine-neutral intermediate
 * representation (recursive parent inheritance, texture variable + alias resolution,
 * element rotations, box UVs, display transforms, overrides), and only that
 * representation is written into Bedrock geometry. Nothing is string-shuffled from
 * Java JSON into Bedrock JSON, so inheritance and UV space stay correct.
 */
export function convertJavaModelDocument(input: JavaModelConvertInput): ConvertedJavaModel | null {
  const { modId, assetId, model } = input;
  const width = normalizeTextureDimension(input.textureWidth, 16);
  const height = normalizeTextureDimension(input.textureHeight, 16);
  const identifier = canonicalGeometryId(modId, assetId);

  const ir = buildIntermediateModel({
    modelId: identifier,
    model,
    index: input.index,
    textureWidth: width,
    textureHeight: height,
    space: input.space ?? 'block',
  });
  if (ir.cubeCount === 0) return null;

  const written = writeBedrockGeometry(ir, { identifier });
  if (written.cubes === 0) return null;

  return {
    geometry: {
      id: written.identifier,
      json: written.json,
      bones: written.bones,
      cubes: written.cubes,
      uv: written.uv,
    },
    ir,
    presentation: writeItemPresentation(ir),
  };
}

/**
 * Converts a Java block/item element model (16-unit space, per-face UV rectangles)
 * into an authentic Bedrock geometry through the intermediate representation.
 */
export function convertJavaModelToBedrockGeometry(
  modId: string,
  assetId: string,
  model: JavaModel,
  textureWidth: number,
  textureHeight: number,
  index?: AssetIndex | null,
): ConvertedGeometry | null {
  const converted = convertJavaModelDocument({ modId, assetId, model, index, textureWidth, textureHeight });
  return converted ? converted.geometry : null;
}

/**
 * Converts an authentic Java ENTITY model into Bedrock geometry while preserving a real
 * bone hierarchy, so animations drive distinct limbs instead of one rigid cube group.
 *
 * Element rotation, box UVs and texture aliases still travel through the intermediate
 * representation; only the grouping into bones is derived here from each element's own
 * declared part/bone name.
 */
export function convertJavaEntityModelToBedrockGeometry(
  modId: string,
  assetId: string,
  elements: JavaElement[],
  textureWidth: number,
  textureHeight: number,
  model?: JavaModel | null,
  index?: AssetIndex | null,
): ConvertedEntityGeometry | null {
  if (!Array.isArray(elements) || elements.length === 0) return null;

  const identifier = canonicalGeometryId(modId, assetId);
  const source: JavaModel = model ?? {
    stem: assetId,
    norm: sanitizeId(assetId).replace(/_/g, ''),
    bucket: 'block',
    path: `models/entity/${assetId}`,
    chain: [],
    textures: {},
    elements,
  };

  const ir = buildIntermediateModel({
    modelId: identifier,
    model: { ...source, elements },
    index: index ?? null,
    textureWidth,
    textureHeight,
    space: 'entity',
  });
  if (ir.cubeCount === 0) return null;

  const groups: SourceBoneGroup[] = [];
  for (const element of elements) {
    const cubes = buildIntermediateCubes([element]);
    if (cubes.length === 0) continue;
    const rawName = String(element.name ?? (element as { part?: string }).part ?? '');
    const parentHint =
      typeof (element as { parent?: unknown }).parent === 'string'
        ? (element as { parent: string }).parent
        : undefined;
    groups.push({ name: rawName, cubes, parentHint });
  }

  // Universal bone graph: every source part name is carried into the shipped skeleton, so a
  // creature modelled as `tentacle_1..4 / abdomen / mandible` keeps those bones and its own
  // clips keep driving them. Named-part evidence is required: an element list with no names
  // carries no hierarchy, and collapsing it onto the conventional rig-part vocabulary (the
  // fallback below) is then the honest result.
  const namedGroups = groups.filter((group) => group.name.trim().length > 0).length;
  const graph = buildSourceBoneGraph(groups);
  const useUniversal = namedGroups >= 2 && namedGroups >= groups.length / 2 && graph.bones.length > 0;
  const fallbackRig = useUniversal ? null : buildRigBones(groupByRigPart(groups));
  const bones = useUniversal ? graph.bones : fallbackRig?.bones ?? [];
  if (bones.length === 0) return null;

  const written = writeBedrockGeometry(ir, { identifier, bones });
  if (written.cubes === 0) return null;

  return {
    id: written.identifier,
    json: written.json,
    bones: written.bones,
    cubes: written.cubes,
    uv: written.uv,
    ir,
    quadruped: useUniversal ? graph.quadruped : (fallbackRig?.quadruped ?? false),
    skeleton: {
      preserved: useUniversal ? graph.preservedNames : 0,
      reparented: useUniversal ? graph.parentedByContainment + graph.parentedByConvention : 0,
      syntheticRoot: useUniversal ? graph.syntheticRoot : false,
      parts: useUniversal ? graph.parts : [],
    },
  };
}

/** Collects every bone name declared in a Bedrock/GeckoLib geometry JSON. */
export function extractBoneNames(geometryJson: string): string[] {
  try {
    const parsed = JSON.parse(geometryJson) as {
      'minecraft:geometry'?: Array<{ bones?: Array<{ name?: string }> }>;
    };
    const bones = parsed['minecraft:geometry']?.flatMap((geometry) => geometry.bones ?? []) ?? [];
    return [...new Set(bones.map((bone) => String(bone.name ?? '')).filter(Boolean))];
  } catch {
    return [];
  }
}

/** Returns the primary geometry identifier declared inside a geometry JSON. */
export function extractGeometryIdentifier(geometryJson: string): string | null {
  try {
    const parsed = JSON.parse(geometryJson) as {
      'minecraft:geometry'?: Array<{ description?: { identifier?: string } }>;
    };
    return parsed['minecraft:geometry']?.[0]?.description?.identifier ?? null;
  } catch {
    return null;
  }
}