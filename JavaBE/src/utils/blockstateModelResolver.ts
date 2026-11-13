import { normKey, resolveModelTexture, type AssetIndex, type JavaBlockState, type JavaModel } from '@/utils/assetIndex';
import { canonicalGeometryId } from '@/utils/geometryRegistry';
import { buildIntermediateModel, type ModelDiagnostic } from '@/utils/javaModelIR';
import { writeBedrockGeometry, type WrittenGeometry } from '@/utils/bedrockGeometryWriter';

const MAX_VARIANTS = 24;

export interface ResolvedBlockVariant {
  condition: string;
  modelRef: string;
  rotationX: number;
  rotationY: number;
  geometry: WrittenGeometry | null;
}

export interface ResolvedMultipartPart {
  when?: Record<string, unknown>;
  modelRef: string;
  geometry: WrittenGeometry | null;
}

export interface ResolvedBlockState {
  blockId: string;
  properties: string[];
  variants: ResolvedBlockVariant[];
  multipart: ResolvedMultipartPart[];
  diagnostics: ModelDiagnostic[];
}

/** Resolves a Java model reference (`mymod:block/stone_bricks`) to an indexed model. */
export function findModelByRef(index: AssetIndex, ref: string): JavaModel | null {
  const rel = ref.replace(/^[a-z0-9_.-]+:/i, '').replace(/^models\//i, '').toLowerCase();
  const blockPath = rel.startsWith('block/') ? rel : `block/${rel}`;
  const itemPath = rel.startsWith('item/') ? rel : `item/${rel}`;
  const exact = index.modelByPath.get(blockPath) ?? index.modelByPath.get(itemPath);
  if (exact) return exact;

  const stem = rel.split('/').pop() ?? '';
  if (!stem) return null;
  const matches = index.modelCandidatesByNorm.get(normKey(stem)) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function convertVariant(
  modId: string,
  identifier: string,
  model: JavaModel | null,
  index: AssetIndex,
  rotationX: number,
  rotationY: number,
): WrittenGeometry | null {
  if (!model) return null;
  const linked = resolveModelTexture(model, index, ['texture', 'all', 'particle', 'layer0', 'side', 'top']);
  const textureWidth = linked?.width && linked.width >= 8 ? linked.width : 16;
  const textureHeight = linked?.height && linked.height >= 8 ? linked.height : 16;
  const ir = buildIntermediateModel({
    modelId: identifier,
    model,
    index,
    textureWidth,
    textureHeight,
    space: 'block',
  });
  if (ir.cubeCount === 0) return null;
  return writeBedrockGeometry(ir, { identifier, rotationX, rotationY });
}

/**
 * Resolves a Java blockstate into concrete Bedrock geometry per declared variant,
 * with the blockstate `x`/`y` rotation baked in and `uvlock` honoured.
 *
 * Multipart definitions are resolved part-by-part, each part keeping its own `when`
 * clause so a permutation-based Bedrock block can bind the right geometry. Nothing is
 * collapsed into a single guessed cube: a missing or unsupported model reference is
 * reported UNRESOLVED and left without geometry.
 */
export function resolveBlockStateModels(
  modId: string,
  block: JavaBlockState,
  index: AssetIndex,
): ResolvedBlockState {
  const baseId = canonicalGeometryId(modId, block.stem);
  const diagnostics: ModelDiagnostic[] = [];
  const variants: ResolvedBlockVariant[] = [];
  const multipart: ResolvedMultipartPart[] = [];

  const variantEntries = Object.entries(block.variants);
  if (variantEntries.length > MAX_VARIANTS) {
    diagnostics.push({
      code: 'missing_elements',
      severity: 'info',
      target: block.stem,
      detail: `Blockstate declares ${variantEntries.length} variants; only the first ${MAX_VARIANTS} were converted to keep the port bounded.`,
    });
  }

  variantEntries.slice(0, MAX_VARIANTS).forEach(([condition, target], position) => {
    const model = findModelByRef(index, target.model);
    const identifier = `${baseId}_v${position + 1}`;
    const rotationX = target.x ?? 0;
    const rotationY = target.y ?? 0;
    const geometry = convertVariant(modId, identifier, model, index, rotationX, rotationY);
    if (!model) {
      diagnostics.push({
        code: 'missing_model',
        severity: 'warning',
        target: `${block.stem}:${condition}`,
        detail: `Variant model "${target.model}" is referenced by the blockstate but is not in the archive — this variant has no geometry (UNRESOLVED, nothing substituted).`,
      });
    } else if (!geometry) {
      diagnostics.push({
        code: 'missing_elements',
        severity: 'warning',
        target: `${block.stem}:${condition}`,
        detail: `Variant model "${target.model}" resolved but produced no cubes — the blockstate variant stays UNRESOLVED.`,
      });
    }
    variants.push({ condition, modelRef: target.model, rotationX, rotationY, geometry });
  });

  block.multipart.slice(0, MAX_VARIANTS).forEach((part, position) => {
    const model = findModelByRef(index, part.apply.model);
    const identifier = `${baseId}_part${position + 1}`;
    const geometry = convertVariant(modId, identifier, model, index, 0, 0);
    if (!model) {
      diagnostics.push({
        code: 'missing_model',
        severity: 'warning',
        target: `${block.stem}:part${position + 1}`,
        detail: `Multipart model "${part.apply.model}" is referenced by the blockstate but is not in the archive — the part stays UNRESOLVED.`,
      });
    }
    multipart.push({ when: part.when, modelRef: part.apply.model, geometry });
  });

  if (variants.length === 0 && multipart.length === 0) {
    diagnostics.push({
      code: 'missing_model',
      severity: 'warning',
      target: block.stem,
      detail: 'Blockstate declares no resolvable variant or multipart model.',
    });
  }

  return { blockId: block.stem, properties: block.properties, variants, multipart, diagnostics };
}

export interface BlockStateCoverage {
  blocks: number;
  variants: number;
  multipartParts: number;
  unresolvedReferences: string[];
  propertyStates: string[];
}

/**
 * Structural (not geometric) blockstate coverage report: which models a blockstate
 * references, which of those are actually in the archive, and which block properties
 * drive the state space. Cheap enough to run over every blockstate in a pack.
 */
export function summarizeBlockStateCoverage(index: AssetIndex): BlockStateCoverage {
  let variants = 0;
  let multipartParts = 0;
  const unresolvedReferences: string[] = [];
  const propertyStates = new Set<string>();

  for (const block of index.blockstates) {
    for (const property of block.properties) propertyStates.add(property);
    for (const target of Object.values(block.variants)) {
      variants++;
      if (!findModelByRef(index, target.model)) {
        unresolvedReferences.push(`${block.stem} -> ${target.model}`);
      }
    }
    for (const part of block.multipart) {
      multipartParts++;
      if (!findModelByRef(index, part.apply.model)) {
        unresolvedReferences.push(`${block.stem} (multipart) -> ${part.apply.model}`);
      }
    }
  }

  return {
    blocks: index.blockstates.length,
    variants,
    multipartParts,
    unresolvedReferences: [...new Set(unresolvedReferences)],
    propertyStates: [...propertyStates],
  };
}