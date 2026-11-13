import type { AssetIndex, JavaBlockState } from '@/utils/assetIndex';
import { canonicalGeometryId } from '@/utils/geometryRegistry';
import type { ExtractedGeometry } from '@/utils/modelPortEngine';
import { resolveBlockStateModels } from '@/utils/blockstateModelResolver';

type Bone = { name?: string; parent?: string; cubes?: unknown[]; [key: string]: unknown };
type Geo = { description?: Record<string, unknown>; bones?: Bone[]; [key: string]: unknown };
type Doc = { 'minecraft:geometry'?: Geo[]; [key: string]: unknown };

export interface BlockstateGeometryResult {
  geometry: ExtractedGeometry | null;
  variantCount: number;
  selectedCondition: string;
  multipartCount: number;
  diagnostics: string[];
}

function readGeo(json: string): Geo | null {
  try {
    return (JSON.parse(json) as Doc)['minecraft:geometry']?.[0] ?? null;
  } catch {
    return null;
  }
}

function safeBoneName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'root';
}

/** Compose a default Java blockstate model and its multipart pieces into one Bedrock mesh. */
export function composeBlockstateGeometry(modId: string, block: JavaBlockState, index: AssetIndex): BlockstateGeometryResult {
  const resolved = resolveBlockStateModels(modId, block, index);
  const chosen = resolved.variants.find((variant) => !variant.condition.trim() && variant.geometry)
    ?? resolved.variants.find((variant) => variant.geometry) ?? null;
  const selected = [chosen?.geometry ?? null, ...resolved.multipart.map((part) => part.geometry)]
    .filter((geometry): geometry is NonNullable<typeof geometry> => geometry !== null);
  const diagnostics = resolved.diagnostics.map((diagnostic) => diagnostic.detail);
  const selectedCondition = chosen?.condition ?? '';
  if (resolved.variants.length > 1) diagnostics.push(
    `This block declares ${resolved.variants.length} state variants; the default or first resolvable model is used, and Java state-specific model switching remains unresolved.`,
  );
  const empty = { geometry: null, variantCount: resolved.variants.length, selectedCondition, multipartCount: 0, diagnostics };
  if (selected.length === 0) return empty;
  const first = readGeo(selected[0].json);
  if (!first) return empty;

  const bones: Bone[] = [];
  const usedNames = new Set<string>();
  const signatures = new Set<string>();
  let cubeCount = 0;
  for (const [sourceIndex, geometry] of selected.entries()) {
    const source = readGeo(geometry.json);
    const sourceBones = source?.bones ?? [];
    if (!source || signatures.has(JSON.stringify(sourceBones))) continue;
    signatures.add(JSON.stringify(sourceBones));
    const sourceNames = new Set(sourceBones.map((bone) => String(bone.name ?? 'root')));
    const renamed = new Map<string, string>();
    for (const bone of sourceBones) {
      const raw = String(bone.name ?? 'root');
      const base = `${sourceIndex === 0 ? '' : `part_${sourceIndex + 1}_`}${safeBoneName(raw)}`;
      let name = base;
      let suffix = 2;
      while (usedNames.has(name)) name = `${base}_${suffix++}`;
      usedNames.add(name);
      renamed.set(raw, name);
    }
    for (const bone of sourceBones) {
      const copy: Bone = { ...bone, name: renamed.get(String(bone.name ?? 'root')) };
      if (typeof bone.parent === 'string') {
        if (sourceNames.has(bone.parent)) copy.parent = renamed.get(bone.parent);
        else delete copy.parent;
      }
      cubeCount += bone.cubes?.length ?? 0;
      bones.push(copy);
    }
  }
  if (!bones.length || !cubeCount) return empty;

  const id = canonicalGeometryId(modId, block.stem);
  const document: Doc = { format_version: '1.12.0', 'minecraft:geometry': [{
    ...first, description: { ...(first.description ?? {}), identifier: id }, bones,
  }] };
  return {
    geometry: { id, json: JSON.stringify(document, null, 2), source: 'java_elements', bonesCount: bones.length, cubesCount: cubeCount },
    variantCount: resolved.variants.length,
    selectedCondition,
    multipartCount: Math.max(0, selected.length - (chosen?.geometry ? 1 : 0)),
    diagnostics,
  };
}