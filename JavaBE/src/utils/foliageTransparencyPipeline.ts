import { findAlphaTextures, findFoliageBlockModels, isCrossFoliageModel } from '@/utils/foliageModelAnalysis';
import type { AssetIndex } from '@/utils/assetIndex';
import { findFoliageMotionEvidence } from '@/utils/foliageMotionEvidence';
import type { DecompileClassSummary } from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';

export interface FoliagePipelineReport {
  blocksInspected: number;
  crossBlocksDetected: number;
  alphaTexturesDetected: number;
  cutoutMaterialsCorrected: number;
  motionSignalsDetected: number;
  motionEvidencePaths: string[];
  motionResolution: 'no-source-signal' | 'unresolved-for-block-target';
  summary: string;
}

function setCutoutMethod(raw: string | Uint8Array | undefined): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const doc = JSON.parse(raw) as Record<string, unknown>;
    const block = doc['minecraft:block'] as Record<string, unknown> | undefined;
    const components = block?.components as Record<string, unknown> | undefined;
    const materials = components?.['minecraft:material_instances'] as Record<string, unknown> | undefined;
    if (!materials) return null;
    let changed = false;
    for (const value of Object.values(materials)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const material = value as Record<string, unknown>;
      if (material.render_method !== 'alpha_test') {
        material.render_method = 'alpha_test';
        changed = true;
      }
    }
    return changed ? JSON.stringify(doc, null, 2) : null;
  } catch {
    return null;
  }
}

export function runFoliageTransparencyPipeline(options: {
  entries: ExtractedZipEntry[];
  index: AssetIndex | null;
  classes: DecompileClassSummary[];
  behaviorPackFiles: Record<string, string | Uint8Array>;
  onLog?: (line: string) => void;
}): FoliagePipelineReport {
  const { entries, index, classes, behaviorPackFiles } = options;
  const crossBlocks = new Set<string>();
  const alphaPaths = new Set<string>();
  const corrected: string[] = [];
  let blocksInspected = 0;
  const blockFiles = Object.keys(behaviorPackFiles)
    .filter((path) => path.startsWith('blocks/') && path.endsWith('.json'))
    .slice(0, 2048);
  for (const file of blockFiles) {
    if (!index) continue;
    const blockId = file.slice('blocks/'.length, -'.json'.length);
    const models = findFoliageBlockModels(index, blockId);
    if (models.length === 0) continue;
    blocksInspected++;
    const cross = models.some(isCrossFoliageModel);
    const textures = findAlphaTextures(models, index);
    if (cross) crossBlocks.add(blockId);
    for (const path of textures) alphaPaths.add(path);
    if ((cross || textures.length > 0) && typeof behaviorPackFiles[file] === 'string') {
      const repaired = setCutoutMethod(behaviorPackFiles[file]);
      if (repaired) {
        behaviorPackFiles[file] = repaired;
        corrected.push(blockId);
      }
    }
  }
  const motion = findFoliageMotionEvidence(entries, classes);
  const motionResolution = motion.count > 0 ? 'unresolved-for-block-target' : 'no-source-signal';
  const motionDetail = motion.count > 0
    ? 'detected but unresolved for custom-block animation'
    : 'detected';
  const summary =
    `Foliage audit: ${blocksInspected} source block model binding(s), ${crossBlocks.size} cross model(s), ` +
    `${alphaPaths.size} alpha texture(s); ${corrected.length} block material(s) corrected to alpha-test. ` +
    `${motion.count} vertex-offset/wind signal(s) ${motionDetail}.`;
  options.onLog?.(`[FOLIAGE] ${summary}`);
  for (const blockId of corrected.slice(0, 8)) {
    options.onLog?.(
      `[FOLIAGE:ALPHA] ${blockId}: source cross geometry or alpha-channel texture bound to Bedrock alpha-test material.`,
    );
  }
  if (motion.count > 0) {
    options.onLog?.(
      '[FOLIAGE:MOTION:UNRESOLVED] Source wind/vertex-offset evidence was found. ' +
      'Bedrock custom blocks do not expose entity bone-animation or arbitrary vertex-displacement tracks; ' +
      'no unsupported Molang or invented sway animation was emitted.',
    );
    for (const path of motion.paths.slice(0, 6)) {
      options.onLog?.(`[FOLIAGE:MOTION] Source evidence: ${path}`);
    }
  }
  return {
    blocksInspected,
    crossBlocksDetected: crossBlocks.size,
    alphaTexturesDetected: alphaPaths.size,
    cutoutMaterialsCorrected: corrected.length,
    motionSignalsDetected: motion.count,
    motionEvidencePaths: motion.paths,
    motionResolution,
    summary,
  };
}