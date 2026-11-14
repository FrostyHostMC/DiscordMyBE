import type { BedrockRemake, ComponentProvenance, DecompileStats, PerMobAuditItem, ProvenanceEntry, RemakeItem, RemakeMechanic, SourceDiscoveryReport, UniversalIRReport } from '@/types/remaker';
import { createZipArchive, createZipArchiveAsync, type ZipEntry } from '@/utils/zip';
import { preparePackForExport, formatIntegrityLog } from '@/utils/packIntegrity';
import { createPackFiles, generateDefaultPackIcon } from '@/utils/bedrockPackTemplate';
import { randomUuid, safeFileId } from '@/utils/bedrockIds';
import { decompileJavaMod, decompileAndInspectJar } from '@/utils/javaDecompiler';
import { deriveItemAssets, createFullMobTexture64x64, type DerivedItemAsset, type SourceTexture } from '@/utils/assetSynthesizer';
import { analyzeAndPortMod1to1 } from '@/utils/universalModPortEngine';
import type { ExtractedZipEntry } from '@/utils/zip';
import { applyDependencyResolution } from '@/utils/dependencyResolver';
import { portMobAndPlayerAnimations } from '@/utils/animationPortEngine';
import { runSelfHealingRepairPipeline } from '@/utils/parityRepairEngine';
import { extractAndPortModels, rebaseGeometryTexture, type ExtractedGeometry } from '@/utils/modelPortEngine';
import { repairGeometryBones } from '@/utils/geometryMeshRepair';
import { buildModelPortReport } from '@/utils/modelPortReport';
import { extractAndPortRecipes } from '@/utils/recipePortEngine';
import { buildAssetIndex, type AssetIndex } from '@/utils/assetIndex';
import { resolveMobTexture } from '@/utils/universalAssetResolver';
import { readPngDimensions, upscaleLegacyTexture, downscaleLargeTexture, getAutoUpscaleLegacyTextures, setAutoUpscaleLegacyTextures } from '@/utils/pngUtils';
import { inferMobBehaviorProfiles } from '@/utils/mobBehaviorProfiles';
import { buildProvenanceReport, isPlayableModeEnabled, statusFromProvenance } from '@/utils/provenance';
import { boneNamesFromGeometry, classifyLocomotion } from '@/utils/mobLocomotion';
import { normalizeVersion, resolveScriptApiVersion, type BedrockVersionTarget, type BedrockExperimentConfig } from '@/utils/bedrockCapabilityQuery';
import { buildHardcodingAudit } from '@/utils/hardcodingAudit';
import { applyTextureEngineToPack, runUniversalTextureEngine } from '@/utils/universalTextureEngine';
import { applyEntityAnimationEngine } from '@/utils/entityAnimationEngine';
import { validateEntityReferences } from '@/utils/entityReferenceValidator';
import { createStageTracker } from '@/utils/pipelineStages';
import { translateBehaviors } from '@/utils/behaviorTranslationEngine';
import { buildGeyserCompatibility, formatGeyserLog } from '@/utils/geyserCompatibility';
import { DEFAULT_GEYSER_VERSION } from '@/utils/geyserVersionTable';
import { runAssetValidationPipeline, formatValidationLog } from '@/utils/assetValidationPipeline';
import { buildConversionManifest, formatConversionManifestLog } from '@/utils/conversionManifest';
import { runRegressionSuite } from '@/utils/regressionSuite';
import { applyCanonicalGeometryRegistry } from '@/utils/geometryRegistry';
import { rebuildTextureAtlases } from '@/utils/textureAtlasBuilder';
import { runBedrockSchemaGate } from '@/utils/bedrockSchemaGate';
import { runPostProcessPass } from '@/utils/bedrockPostProcess';
import { enforceItemIconsAndBlockGeometry } from '@/utils/itemIconAtlas';
import { classifyItemModels } from '@/utils/itemModelNormalizer';
import { generateMissingClientEntities } from '@/utils/clientEntityGenerator';
import { applySpawnEggPolicy } from '@/utils/spawnEggPolicy';
import { buildPbrMaterials } from '@/utils/pbrMaterialsBuilder';
import { runPortValidation } from '@/utils/packPortValidator';
import { enforcePlayerWiring } from '@/utils/playerWiringEnforcer';
import { resolvePlayerDependencies } from '@/utils/playerDependencyResolver';
import { guaranteePlayerBaselineWiring } from '@/utils/playerBaselineGuard';
import { applyMolangCompatibilityRepairs } from '@/utils/molangCompatibility';
import { bindMolangVariableScopes } from '@/utils/molangScopeBinder';
import { buildMolangDependencyGraph } from '@/utils/molangDependencyGraph';
import { collectSourceVariableEvidence } from '@/utils/sourceVariableEvidence';
import { auditRenderingContextBinding } from '@/utils/renderingContextBinding';
import {
  normalizeEmptyControllerArrays,
  repairAnimationControllerGraphs,
} from '@/utils/animationControllerValidation';
import { resolveAnimationReferences } from '@/utils/animationReferenceResolver';

import { indexSourceDocuments, runSourceDiscovery } from '@/utils/sourceDiscovery';
import { buildUniversalIR } from '@/utils/universalIR';
import { buildMobLinks, summarizeMobLinks } from '@/utils/mobLinking';
import { buildTextureDiscoveryIndex, pickFittingTexture } from '@/utils/textureDiscovery';
import { runFoliageTransparencyPipeline } from '@/utils/foliageTransparencyPipeline';
import { auditAnimationIntegration } from '@/utils/animationIntegrationValidator';
import { buildAnimationResourceRegistry, describeRegistryScopes } from '@/utils/animationResourceRegistry';
import { exportUniversalAnimationIR } from '@/utils/universalAnimationExporter';
import { reconstructAnimationDependencies } from '@/utils/animationDependencyReconstructor';
import { validateAnimationFidelity } from '@/utils/animationFidelityValidator';
import { retargetBones } from '@/utils/dynamicBoneRetargeter';
import { resolveAnimationStateConflicts } from '@/utils/animationStateResolver';
import { auditReferenceIntegrity, reconcileReferenceIntegrityMetrics } from '@/utils/referenceIntegrityAuditor';
import { validateAnimationRuntime } from '@/utils/animationRuntimeValidator';
import { createAnimationPipelineTrace } from '@/utils/pipelineTrace';
import { reconcileAnimationMetrics, type MetricClaimInput } from '@/utils/animationMetricReconciliation';
import { getArchiveBudget, yieldToUi } from '@/utils/archiveScale';

/**
 * Recovers the model that belongs to a mob when its recovered file name drifted
 * away from the mob identifier (`hollow` vs `hollow_universal.geo.json`). Without
 * this lookup the UV re-base pass skipped those mobs entirely, so their skins
 * sampled the wrong quarter of the sheet in game.
 */
function findNearbyGeometry(
  geos: Map<string, ExtractedGeometry>,
  mobId: string,
): ExtractedGeometry | undefined {
  const target = mobId.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!target) return undefined;
  const exact = geos.get(mobId);
  if (exact) return exact;
  for (const [name, geo] of geos) {
    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm && (norm === target || norm.startsWith(target))) return geo;
  }
  return undefined;
}

/**
 * Deterministic UUID for the script module this pack needs. A pack that ships an activation
 * script without a script module is rejected at import, so the declaration is derived from the
 * mod id instead of being left to a random value that changes on every export.
 */
function stableScriptUuid(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < seed.length; index += 1) {
    h1 = ((h1 ^ seed.charCodeAt(index)) * 16777619) >>> 0;
    h2 = (h2 + seed.charCodeAt(index) * (index + 7)) >>> 0;
  }
  const hex = (value: number) => value.toString(16).padStart(8, '0');
  const body = `${hex(h1)}${hex(h2)}${hex(h1 ^ h2)}${hex((h1 + h2) >>> 0)}`;
  return `${body.slice(0, 8)}-${body.slice(8, 12)}-4${body.slice(13, 16)}-8${body.slice(17, 20)}-${body.slice(20, 32)}`;
}

/**
 * Declares the behaviour-pack script module and its API dependency.
 *
 * A shipped `scripts/main.js` that the manifest does not declare never runs, so an animation
 * self-test written after the manifest pass would exist in the archive and do nothing in game.
 * This is the same declaration the earlier pass makes, applied to whatever the animation writer
 * added last.
 */
function ensureScriptModule(
  behaviorPackFiles: Record<string, string | Uint8Array>,
  modId: string,
  log: (line: string) => void,
): void {
  const raw = behaviorPackFiles['manifest.json'];
  if (typeof raw !== 'string') return;
  try {
    const manifest = JSON.parse(raw) as Record<string, any>;
    const modules: Array<Record<string, any>> = Array.isArray(manifest.modules) ? manifest.modules : [];
    const dependencies: Array<Record<string, any>> = Array.isArray(manifest.dependencies)
      ? manifest.dependencies
      : [];
    let touched = false;
    if (!modules.some((module) => module.type === 'script')) {
      modules.push({
        type: 'script',
        language: 'javascript',
        uuid: stableScriptUuid(`script:${modId}`),
        entry: 'scripts/main.js',
        version: [1, 0, 0],
      });
      touched = true;
    }
    if (!dependencies.some((dependency) => dependency.module_name === '@minecraft/server')) {
      dependencies.push({
        module_name: '@minecraft/server',
        version: resolveScriptApiVersion(manifest.header?.min_engine_version ?? [1, 21, 50]),
      });
      touched = true;
    }
    if (!touched) return;
    manifest.modules = modules;
    manifest.dependencies = dependencies;
    behaviorPackFiles['manifest.json'] = JSON.stringify(manifest, null, 2);
    log(
      '[WIRE:SCRIPT] Behaviour manifest declares the animation self-test module and @minecraft/server, so clip playback can be observed in game instead of assumed.',
    );
  } catch {
    log(
      '[WIRE:SCRIPT:WARN] The behaviour manifest could not be parsed, so the animation self-test script stays undeclared and cannot run.',
    );
  }
}

/** Clip identifiers inside a shipped Bedrock animation document. */
function countClipIds(json: string | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { animations?: Record<string, unknown> };
    return Object.keys(parsed.animations ?? {});
  } catch {
    return [];
  }
}

export async function generateBedrockRemake(
  brief: string,
  sourceFileName: string | null,
  fileEntries?: ExtractedZipEntry[],
  onLog?: (line: string) => void,
  statsOverride?: DecompileStats,
  onAutoRepairTrigger?: () => void,
  targetVersion?: BedrockVersionTarget,
  experimentConfig?: BedrockExperimentConfig,
): Promise<BedrockRemake> {
  const log = (line: string) => onLog?.(line);
  const stages = createStageTracker(log);
  let decompileStats: DecompileStats | undefined;
  let packIconBytes: Uint8Array | null = null;
  let packIconDataUrl: string | undefined;
  let sourceTextures: SourceTexture[] = [];

  const targetEngineTriple = normalizeVersion(targetVersion ?? experimentConfig?.targetVersion ?? [1, 21, 50]);
  log(`[TARGET] Target Bedrock engine version: ${targetEngineTriple[0]}.${targetEngineTriple[1]}.${targetEngineTriple[2]}`);
  if (experimentConfig) {
    const active = [
      experimentConfig.enableBetaApis ? 'Beta APIs' : null,
      experimentConfig.enableCameras ? 'Creator Cameras' : null,
      experimentConfig.enableCustomUi ? 'Custom UI Forms' : null,
      experimentConfig.enableVoxelShapes ? '3D Voxel Shapes' : null,
      experimentConfig.enablePbr ? 'Deferred PBR' : null,
    ].filter(Boolean);
    log(`[EXPERIMENTS] Active Bedrock capabilities: ${active.join(', ')}`);
  }

  // 1. Deep Decompile & Bytecode Inspection
  if (fileEntries && fileEntries.length > 0) {
    log(`[DECOMPILE] Unpacking archive: ${fileEntries.length} files indexed...`);
    try {
      // Cached on the entry array, so the dashboard and the conversion share one pass over
      // the bytecode instead of re-reading every class.
      const result = decompileAndInspectJar(fileEntries, sourceFileName ?? undefined);
      decompileStats = result.stats;
      packIconBytes = result.iconBytes;
      packIconDataUrl = result.stats.iconDataUrl;
      sourceTextures = result.sourceTextures;
      log(`[DECOMPILE] ${result.stats.classesCount} Java class files found | ${result.stats.texturesCount} textures | ${result.stats.modelsCount} model JSON files found`);
      log(`[DECOMPILE] Mod identified: ${result.stats.modName} v${result.stats.version}`);
      log(`[DECOMPILE] Metadata source: ${result.stats.metadataFormat}`);
      if (result.stats.animationsCount && result.stats.animationsCount > 0) {
        log(`[DECOMPILE] ${result.stats.animationsCount} animation JSON files found in archive`);
      }
      if (result.stats.dependencies.length > 0) {
        log(`[ANALYSIS] Required mod dependencies detected: ${result.stats.dependencies.join(', ')}`);
        applyDependencyResolution(result.stats, log);
      } else {
        log(`[ANALYSIS] No additional external dependencies required; standalone mod architecture.`);
      }
      if (result.stats.foundIcon) log(`[ASSET] Pack icon extracted from archive: ${result.stats.iconPath}`);
      if (result.stats.registeredItems.length > 0) {
        log(`[ANALYSIS] Registered items detected: ${result.stats.registeredItems.slice(0, 8).join(', ')}`);
      }
      stages.ok('decompile', 'Archive decompile & classification', `${result.stats.classesCount} classes, ${result.stats.texturesCount} textures`);
    } catch (decompileError) {
      console.warn('[JavaBE] Decompilation fallback:', decompileError);
      const detail = decompileError instanceof Error ? decompileError.message : String(decompileError);
      if (statsOverride) {
        // The UI already inspected this exact archive before generation. Keep that proven
        // snapshot if the generator's second pass fails; dropping it here erased registered
        // items/entities/classes and disconnected every later evidence-driven stage.
        decompileStats = statsOverride;
        log(`[DECOMPILE:RECOVERY] Reusing the successful inspection snapshot for ${statsOverride.modName}: ${statsOverride.classesCount} classes, ${statsOverride.registeredItems.length} registered items, ${statsOverride.registeredEntities?.length ?? 0} registered entities.`);
        stages.ok('decompile', 'Archive decompile & classification', `reused prior inspection snapshot after repeat-pass error: ${detail}`);
      } else {
        stages.fail(
          'decompile',
          'Archive decompile & classification',
          detail,
        );
        log('[ERROR] Decompilation failed and no successful inspection snapshot exists; dependent categories are reported as FAILED, not empty or successful.');
      }
    }
  } else if (statsOverride) {
    decompileStats = statsOverride;
    log(`[AI] AI-Assisted Port plan accepted: "${statsOverride.modName}" (${statsOverride.registeredItems.length} items specified).`);
    log('[AI] Feeding AI port specification into the deterministic 1:1 parity compiler...');
  }

  // Yield between stages: a large archive makes each stage a long synchronous block, and
  // without an explicit hand-back the browser cannot paint, scroll or update the log.
  await yieldToUi();

  // 1b. Universal asset resolver: index every texture and Java model in the archive
  const assetIndex: AssetIndex | null = fileEntries && fileEntries.length > 0 ? buildAssetIndex(fileEntries) : null;
  if (assetIndex) {
    log(
      `[RESOLVER] Universal asset index ready: ${assetIndex.textures.length} textures (${assetIndex.items.length} item / ${assetIndex.blocks.length} block / ${assetIndex.entities.length} entity), ${assetIndex.itemModels.length} item models, ${assetIndex.blockModels.length} block models.`,
    );
  }

  // 1c. Universal Texture Engine: decode every texture, preserve dimensions/alpha,
  // interpret Java .mcmeta animation data and plan flipbooks before any file is written.
  const textureEngine = await runUniversalTextureEngine(fileEntries ?? [], assetIndex, log);
  stages.ok(
    'textures-engine',
    'Universal texture engine',
    `${textureEngine.discovered} texture(s) decoded, ${textureEngine.animated} animated, ${textureEngine.repairedReferences.length} reference repair(s)`,
  );

  await yieldToUi();

  // 1d. Universal source discovery & intermediate representation.
  // Analysis runs as its own stage, strictly before any Bedrock writer: it only reads the archive
  // and records what the mod declares, so a later defect can be traced to evidence instead of a
  // naming guess. The record is handed to conversion, never the other way around.
  const sourceDocuments = indexSourceDocuments(fileEntries ?? []);
  let sourceDiscovery: SourceDiscoveryReport | null = null;
  let sourceIR: UniversalIRReport | null = null;
  try {
    sourceDiscovery = runSourceDiscovery({
      entries: fileEntries ?? [],
      documents: sourceDocuments,
      stats: decompileStats,
      onLog: log,
    });
    stages.ok(
      'source-discovery',
      'Universal source discovery',
      `${sourceDiscovery.documentCount} document(s), ${sourceDiscovery.namespaces.length} namespace(s), ${sourceDiscovery.loaders.map((entry) => entry.loader).join('/') || 'no loader metadata'}`,
    );
    sourceIR = buildUniversalIR({
      modId: decompileStats?.modId ?? 'unresolved-mod',
      entries: fileEntries ?? [],
      stats: decompileStats,
      discovery: sourceDiscovery,
      documents: sourceDocuments,
      onLog: log,
    });
    stages.ok(
      'source-ir',
      'Universal intermediate representation',
      `${sourceIR.nodeCount} object(s), ${sourceIR.references.resolved}/${sourceIR.references.total} reference(s) resolved, ${sourceIR.references.unresolved} unresolved`,
    );
  } catch (error) {
    // The IR is diagnostic evidence. When it cannot be built it is reported as NOT MEASURED,
    // never as an empty success, and the conversion itself continues.
    const detail = error instanceof Error ? error.message : String(error);
    stages.skip('source-ir', 'Universal intermediate representation', `NOT MEASURED — ${detail}`);
    log(`[IR:ERROR] The intermediate representation could not be built (${detail}); the IR is reported as NOT MEASURED and the conversion continues.`);
  }

  // 2. Deterministic Rule-Based Porting Engine (Zero AI Dependency)
  log('[PORT-ENGINE] Universal Java-to-Bedrock Parity Compiler engaged...');
  log('[PORT-ENGINE] 100% deterministic rule-based compilation — zero AI dependency.');
  const portAnalysis = analyzeAndPortMod1to1(brief, sourceFileName, decompileStats, fileEntries, sourceIR ?? undefined);
  log(`[ANALYSIS] Deep inspection complete: detected ${portAnalysis.totalDetectedDefinitions} source-backed item/block definition(s), exporting ${portAnalysis.items.length} within the mobile-safe limit; ${portAnalysis.mechanics.length} gameplay mechanics identified.`);
  if (portAnalysis.omittedDefinitionCount > 0) {
    log(`[PORT:LIMIT] ${portAnalysis.omittedDefinitionCount} additional item/block definition(s) were detected but not exported in this mobile-safe pass.`);
  }
  const behaviorCounts = portAnalysis.items.reduce((counts, item) => {
    const kind = item.behaviorProfile?.kind ?? 'unresolved';
    counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  log(
    `[BEHAVIOR] Item scan: ${behaviorCounts.projectile ?? 0} projectile, ${behaviorCounts.spell ?? 0} spell, ${behaviorCounts.melee ?? 0} melee, ${behaviorCounts.food ?? 0} food, ${behaviorCounts.armor ?? 0} armor, ${behaviorCounts.tool ?? 0} tool, ${behaviorCounts.storage ?? 0} storage, ${behaviorCounts.crafting ?? 0} crafting, ${behaviorCounts.block ?? 0} block, ${behaviorCounts.unresolved ?? 0} unresolved.`,
  );

  const name = portAnalysis.addonName;
  const description = portAnalysis.description;
  const items: RemakeItem[] = [...portAnalysis.items];
  const mechanics: RemakeMechanic[] = [...portAnalysis.mechanics];
  const shapes: Record<string, string> = { ...portAnalysis.shapes };

  log(`[MAPPING] Addon target confirmed: "${name}" [Bedrock Edition 1:1 Parity]`);
  for (const it of items) {
    log(`[ITEM] "${it.name}" (${it.type}) -> Bedrock custom item ${it.id} [${it.category ?? 'item'}]`);
    const behavior = it.behaviorProfile;
    if (behavior) {
      const source = behavior.evidence.length > 0 ? behavior.evidence.join(', ') : 'no matching source signature';
      log(`[BEHAVIOR] "${it.name}" -> ${behavior.kind} (${behavior.confidence}); ${source}. ${behavior.note}`);
    }
  }
  for (const m of mechanics) {
    const detail = m.name === 'Item Behavior Evidence Audit' ? m.summary : 'scripted in Bedrock behavior pack';
    log(`[MECHANIC] ${m.name} -> ${detail}`);
  }

  const id = portAnalysis.id;
  const resourceUuid = randomUuid();

  // 3. Pack icon synthesis
  if (!packIconBytes) {
    const generated = generateDefaultPackIcon(name);
    packIconBytes = generated.bytes;
    if (!packIconDataUrl) packIconDataUrl = generated.dataUrl;
    log('[ASSET] Pack icon synthesized with custom crest & monogram.');
  }

  await yieldToUi();

  // 4. Recover authentic Java models & GeckoLib geometries
  log('[MODEL] Scanning for authentic Java JSON models & GeckoLib geometry...');
  const mobIds = portAnalysis.entities
    .map((entity) => safeFileId(entity))
    .filter((mobId) => mobId.length > 2);

  // Mob Linking Protocol: an entity's own renderer and model classes name the model,
  // skin and animation files that belong to it. Those declarations are resolved before
  // any geometry is chosen, so the files a class names are the files that get bound.
  const mobLinks = buildMobLinks({ entries: fileEntries ?? [], mobIds });
  if (mobIds.length > 0) {
    const linking = summarizeMobLinks(mobLinks);
    log(
      `[LINK] Mob linking protocol: ${linking.renderers} renderer class(es) resolved; ${linking.textures} skin(s) and ${linking.animations} animation document(s) bound from the resource strings the mod's own renderer/model classes declare (${mobIds.length} entit(ies) inspected).`,
    );
    log(
      `[TEXTURE:DISCOVERY] Recursive textures/** discovery: ${linking.textures} skin(s) bound — ${linking.textures - linking.discoveredTextures} from a class resource string or archive reference, ${linking.discoveredTextures} from an unreferenced sheet that fits the rig.`,
    );
    for (const linkedMobId of mobIds.slice(0, 40)) {
      const link = mobLinks.get(linkedMobId);
      if (!link) continue;
      const boundText = link.evidence.length > 0 ? link.evidence.join('; ') : 'no class resource string found';
      log(
        `[LINK] ${linkedMobId}: ${boundText}${link.unresolved.length > 0 ? ` | UNRESOLVED: ${link.unresolved.join(', ')}` : ''}`,
      );
    }
    if (linking.unresolved.length > 0) {
      log(
        `[LINK:WARN] ${linking.unresolved.length} entit(ies) have at least one component with no class evidence: ${linking.unresolved.slice(0, 8).join(' | ')}.`,
      );
    }
  }

  const modelResult = extractAndPortModels(decompileStats?.modId || id, fileEntries, mobIds, log, assetIndex, mobLinks);
  stages.ok('models', 'Java model recovery', `${modelResult.entityGeometries.size} entity model(s), ${modelResult.itemGeometries.size} item model(s), ${modelResult.stats.polyMeshModelsConverted} polygon mesh(es)`);

  await yieldToUi();

  // 5. Synthesize 3D geometry & texture atlases (prioritizing authentic assets)
  log('[TEXTURE] Discovering and mapping authentic mod textures from archive...');
  let itemAssets = new Map<string, DerivedItemAsset>();
  try {
    const assetResult = await deriveItemAssets(
      decompileStats?.modId || id,
      items,
      sourceTextures,
      shapes,
      log,
      portAnalysis.palettes,
      modelResult.itemGeometries,
      assetIndex,
      textureEngine,
    );
    itemAssets = assetResult.map;

    // Attach authenticity flags to items for truthful auditing
    for (const it of items) {
      const derived = itemAssets.get(it.id);
      it.hasOriginalTexture = derived?.isAuthenticModTexture ?? false;
      it.hasOriginalModel = derived?.isAuthenticModModel ?? false;
    }
    stages.ok('textures', 'Item texture & geometry derivation', `${itemAssets.size} derived asset(s)`);
  } catch (assetError) {
    console.warn('[Aippy] Item asset derivation failed:', assetError);
    stages.fail(
      'textures',
      'Item texture & geometry derivation',
      assetError instanceof Error
        ? `${assetError.message}; ${items.length} item(s) were not derived`
        : `${String(assetError)}; ${items.length} item(s) were not derived`,
    );
    log(`[ERROR] Item texture & geometry derivation FAILED — ${items.length} item(s) remain unprocessed; no successful asset total is reported.`);
  }

  // 6. Automated Crafting Recipes (parsing authentic Java recipes from data/<modid>/recipes/*.json)
  log('[RECIPES] Extracting authentic Java crafting recipes from data/**/recipes/...');
  const recipeResult = extractAndPortRecipes(decompileStats?.modId || id, items, fileEntries, log);
  log(`[RECIPES] Recipe pipeline ready: ${recipeResult.stats.recipesConverted} converted from mod, ${recipeResult.stats.fallbackRecipesCount} contextual fallbacks.`);

  stages.ok(
    'recipes',
    'Recipe conversion',
    `${recipeResult.stats.recipesConverted} converted, ${recipeResult.stats.fallbackRecipesCount} fallback`,
  );

  log('[SCRIPT] Compiling @minecraft/server v1.13.0 Script API automation engine...');

  // 7. Automated Player & Mob Animation Engine
  const animResult = portMobAndPlayerAnimations(
    decompileStats?.modId || id,
    name,
    items,
    fileEntries,
    log,
    modelResult.entityGeometries,
    {
      controllerClasses: decompileStats?.animationControllers,
      stateMachineClasses: decompileStats?.detectedStateMachines,
      entityClasses: decompileStats?.classes,
    },
    portAnalysis.entities,
  );
  stages.ok(
    'animations',
    'Animation & controller conversion',
    `${animResult.universalAnimationDiscovery?.uniqueClipIdsDiscovered ?? 0} unique animation ID(s) discovered (${animResult.universalAnimationDiscovery?.totalClipsDiscovered ?? 0} discovery record(s)), ${animResult.universalAnimationIR?.clipCount ?? 0} interpreted IR ID(s), ${animResult.sourceClipCount ?? 0} source clip import record(s) from layout importers, ${animResult.geckolibClipsImported ?? 0} GeckoLib imports across ${animResult.geckolibFilesDiscovered ?? 0} documents, ${animResult.inventedClipCount ?? 0} invented, ${animResult.withheldInventedClipCount ?? 0} withheld`,
  );

  // Entities the animation engine bound from recovered-model-plus-archive-skin evidence are
  // real mobs even when the mod registers no spawn-egg item, so the skin resolver runs over
  // them too: every shipped client entity must reference a PNG that actually ships.
  const lateMobIds = (animResult.portedMobList ?? []).filter((boundMobId) => !mobIds.includes(boundMobId));
  if (lateMobIds.length > 0) {
    for (const boundMobId of lateMobIds) mobIds.push(boundMobId);
    // Entities the animation engine discovered get the same class-resource linking and the
    // same recursive texture discovery as the entities known before it ran.
    const lateLinks = buildMobLinks({ entries: fileEntries ?? [], mobIds: lateMobIds });
    for (const [lateMobId, lateLink] of lateLinks) {
      mobLinks.set(lateMobId, lateLink);
      const lateText =
        lateLink.evidence.length > 0 ? lateLink.evidence.join('; ') : 'no class resource string found';
      log(
        `[LINK] ${lateMobId} (bound by the animation engine): ${lateText}${lateLink.unresolved.length > 0 ? ` | UNRESOLVED: ${lateLink.unresolved.join(', ')}` : ''}`,
      );
    }
  }

  // 8. Match or Synthesize Authentic Entity Textures for spawned mobs
  const entityTextures = new Map<string, Uint8Array>();
  const fallbackMobIds: string[] = [];
  const ITEM_BLACKLIST = /meat|cooked|raw|egg|item|icon|gui|particle|font|layer_|overlay|saddle|armor|bullet|projectile/;

  // Display names per mob id so the resolver can match no-underscore skin filenames
  const mobDisplayNames = new Map<string, string>();
  for (const it of items) {
    if (it.category !== 'spawn_egg') continue;
    const cleanName = it.name.replace(/spawn egg/gi, '').replace(/summon egg/gi, '').replace(/egg/gi, '').trim();
    const key = safeFileId(cleanName) || it.id.replace(/_spawn_egg$/, '');
    mobDisplayNames.set(key, cleanName || key.replace(/_/g, ' '));
  }

  // Identity of the sheet each mob finally bound to, so duplicate alias entities can
  // be recognised later in this pass.
  const skinIdentity = new Map<string, string>();
  // Sheets already bound to a mob. Reusing one skin on two unrelated creatures reads in
  // game as a duplicated ghost mob, so the resolver is told who owns what.
  const boundSkins = new Map<string, string>();
  const playableMode = isPlayableModeEnabled();
  // Mobs whose INVENTED code-drawn skin was withheld because playable mode is off.
  const withheldSkinIds: string[] = [];

  // TEXTURE DISCOVERY. Every PNG under any `textures/**` folder — entity/, entities/,
  // mob/, models/, or any other — is indexed recursively, so a mob is never reported
  // ABSENT while an unreferenced sheet that fits its rig exists in the archive.
  const textureDiscovery =
    fileEntries && fileEntries.length > 0 ? buildTextureDiscoveryIndex(fileEntries) : null;
  if (textureDiscovery) {
    const bindableSheets = textureDiscovery.sheets.filter((sheet) => sheet.bindable);
    log(
      `[TEXTURE:DISCOVERY] Recursive textures/** scan indexed ${textureDiscovery.sheets.length} PNG(s) — ${bindableSheets.length} bindable sheet(s), ${bindableSheets.filter((sheet) => sheet.entityFolder).length} of them inside an entity folder. Numeric file names and nested folders are matched as valid resources.`,
    );
  }
  // Sheets already handed to a mob by this pass, and the mobs whose skin came from the
  // discovery tier (an authentic file with no direct class or name reference).
  const claimedDiscovery = new Set<string>();
  const discoveredSkinMobs = new Set<string>();

  // One normalised path index for the whole skin pass. The legacy tiers below used to walk the
  // complete archive again for every mob, re-normalising every path each time — with hundreds of
  // mobs and tens of thousands of files that is what locked up the tab on a large mod.
  const lowerPathEntry = new Map<string, ExtractedZipEntry>();
  const pngIndex: Array<{ lower: string; stem: string; entry: ExtractedZipEntry }> = [];
  for (const entry of fileEntries ?? []) {
    if (entry.isDirectory) continue;
    const lower = entry.path.replace(/\\/g, '/').toLowerCase();
    lowerPathEntry.set(lower, entry);
    if (!lower.endsWith('.png')) continue;
    pngIndex.push({ lower, stem: lower.split('/').pop()?.replace(/\.png$/, '') ?? '', entry });
  }

  for (const mobId of mobIds) {
    let matchedBytes: Uint8Array | null = null;
    let matchedSource = '';

    // A-LINK. Mob Linking Protocol: the skin resolved from the resource strings this
    // entity's own renderer/model class declares, or — when no class names one — the sheet
    // the recursive textures/** discovery scan found for it.
    let linkedSkinTail = '';
    const mobLink = mobLinks.get(mobId);
    const linkedSkinPath = mobLink?.texture;
    if (linkedSkinPath) {
      const linkedEntry = lowerPathEntry.get(linkedSkinPath);
      const linkedSize = linkedEntry ? readPngDimensions(linkedEntry.data) : null;
      if (linkedEntry && (linkedSize?.width ?? 0) >= 16 && (linkedSize?.height ?? 0) >= 16) {
        matchedBytes = linkedEntry.data;
        matchedSource = linkedEntry.path.split('/').pop() ?? 'skin';
        linkedSkinTail = linkedSkinPath.replace(/^.*?textures\//, '').replace(/\.png$/i, '');
        claimedDiscovery.add(linkedSkinPath);
        if (mobLink?.textureTier === 'recursive-discovery') discoveredSkinMobs.add(mobId);
        const origin =
          mobLink?.textureTier === 'class-resource'
            ? 'declared by its own renderer/model class'
            : mobLink?.textureTier === 'recursive-discovery'
              ? 'discovered by the recursive textures/** scan (no class or name match, the sheet was unreferenced)'
              : 'resolved from archive evidence';
        log(
          `[LINK] Mob "${mobId}" -> skin "${linkedSkinPath}" ${origin} (${linkedSize?.width}x${linkedSize?.height}); copied to textures/entity/${mobId}.png and the client entity texture reference now points at it.`,
        );
      }
    }

    // A0. Universal resolver: links `viralexecutioner.png` to `viral_executioner`
    // and understands per-mob texture folders + state-suffix variants.
    const resolvedSkin = assetIndex
      ? resolveMobTexture(
          assetIndex,
          mobId,
          mobDisplayNames.get(mobId) ?? mobId.replace(/_/g, ' '),
          boundSkins,
        )
      : null;
    if (!matchedBytes && resolvedSkin && resolvedSkin.width >= 16 && resolvedSkin.height >= 16) {
      matchedBytes = resolvedSkin.data;
      matchedSource = resolvedSkin.path.split('/').pop() ?? resolvedSkin.stem;
      claimedDiscovery.add(resolvedSkin.path);
    }

    // A. Legacy archive scan fallback
    if (!matchedBytes && fileEntries && fileEntries.length > 0) {
      // 1. Exact entity texture match in entity/models folder
      const exactEntityDirMatch = pngIndex.find(({ lower, stem }) => {
        if (stem !== mobId) return false;
        return lower.includes('/entity/') || lower.includes('/entities/') || lower.includes('/models/entity/');
      })?.entry;
      if (exactEntityDirMatch) {
        matchedBytes = exactEntityDirMatch.data;
        matchedSource = exactEntityDirMatch.path.split('/').pop() || '';
      }

      // 2. Exact name anywhere outside of items/gui/particles
      if (!matchedBytes) {
        const exactAnywhere = pngIndex.find(({ lower, stem }) => {
          if (stem !== mobId) return false;
          return !(lower.includes('/items/') || lower.includes('/item/') || lower.includes('/gui/') || lower.includes('/particle'));
        })?.entry;
        if (exactAnywhere) {
          matchedBytes = exactAnywhere.data;
          matchedSource = exactAnywhere.path.split('/').pop() || '';
        }
      }

      // 3. Substring match in entity directory ONLY if free of item/meat/cooked blacklist
      if (!matchedBytes) {
        const fuzzyEntityDir = pngIndex.find(({ lower, stem }) => {
          if (lower.includes('/items/') || lower.includes('/item/') || lower.includes('/gui/') || lower.includes('/particle')) return false;
          if (ITEM_BLACKLIST.test(stem)) return false;
          const inEntityDir = lower.includes('/entity/') || lower.includes('/entities/');
          return inEntityDir && (stem.startsWith(mobId) || stem.endsWith(mobId));
        })?.entry;
        if (fuzzyEntityDir) {
          matchedBytes = fuzzyEntityDir.data;
          matchedSource = fuzzyEntityDir.path.split('/').pop() || '';
        }
      }
    }

    // B. Check decompiled sourceTextures pool with strict negative blacklist
    if (!matchedBytes) {
      const mobTex = sourceTextures.find((s) => {
        const clean = s.name.toLowerCase().replace(/\.png$/, '');
        if (ITEM_BLACKLIST.test(clean)) return false;
        return clean === mobId || clean === `${mobId}_body` || clean === `${mobId}_texture`;
      });
      if (mobTex) {
        matchedBytes = mobTex.data;
        matchedSource = mobTex.name;
      }
    }

    // B2. Recursive texture discovery: an unreferenced PNG that fits the rig is still an
    // authentic asset. It is copied into textures/entity/ and its reference repointed, so
    // the mob is never reported ABSENT while a usable sheet exists somewhere in the archive.
    if (!matchedBytes && textureDiscovery) {
      const discovered = pickFittingTexture(textureDiscovery, {
        mobId,
        displayName: mobDisplayNames.get(mobId),
        claimed: claimedDiscovery,
      });
      if (discovered) {
        matchedBytes = discovered.data;
        matchedSource = discovered.path.split('/').pop() ?? discovered.stem;
        claimedDiscovery.add(discovered.path);
        discoveredSkinMobs.add(mobId);
        log(
          `[TEXTURE:DISCOVERY] Mob "${mobId}" -> "${discovered.path}" (${discovered.width}x${discovered.height}) found by the recursive textures/** scan; no class resource string or name match existed, so this unreferenced sheet is copied to textures/entity/${mobId}.png instead of reporting the texture ABSENT.`,
        );
      }
    }

    // C. Synthesize a readable fallback only when no authentic skin could be linked
    const skinSize = readPngDimensions(matchedBytes);
    const hasUsableSkin =
      Boolean(matchedBytes) && (skinSize?.width ?? 0) >= 16 && (skinSize?.height ?? 0) >= 16;
    if (!hasUsableSkin) {
      const mobPalette = portAnalysis.palettes[mobId] || ['#475569', '#38bdf8', '#0284c7', '#0f172a'];
      if (playableMode) {
        matchedBytes = createFullMobTexture64x64(mobId, mobPalette);
        log(`[TEXTURE] Synthesized INVENTED fallback skin for mob "${mobId}" (no authentic skin in archive; playable mode on).`);
        fallbackMobIds.push(mobId);
      } else {
        matchedBytes = null;
        withheldSkinIds.push(mobId);
        log(`[PROVENANCE] Mob "${mobId}" -> no authentic skin in the archive; INVENTED code-drawn skin withheld (playable mode off), texture stays UNMATCHED.`);
      }
    } else {
      log(`[TEXTURE] Linked authentic entity texture for mob "${mobId}" (${matchedSource} ${skinSize?.width}x${skinSize?.height})`);
      if ((skinSize?.width ?? 0) > 1024 || (skinSize?.height ?? 0) > 1024) {
        try {
          const downscaled = await downscaleLargeTexture(matchedBytes!, 1024);
          if (downscaled) {
            matchedBytes = downscaled;
            const newSize = readPngDimensions(downscaled);
            log(
              `[TEXTURE] Warning: oversized entity skin for mob "${mobId}" (${skinSize?.width}x${skinSize?.height}) — downscaled to ${newSize?.width}x${newSize?.height} to prevent mobile GPU memory exhaustion.`,
            );
          }
        } catch {
          log(
            `[TEXTURE] Warning: oversized entity skin for mob "${mobId}" (${skinSize?.width}x${skinSize?.height}) — exceeds 1024x1024 mobile Bedrock budget.`,
          );
        }
      }
    }

    if (matchedBytes) entityTextures.set(mobId, matchedBytes);
    skinIdentity.set(
      mobId,
      hasUsableSkin
        ? linkedSkinTail || resolvedSkin?.tail || matchedSource.toLowerCase() || `synthetic:${mobId}`
        : `synthetic:${mobId}`,
    );
    if (hasUsableSkin) {
      const skinKey = (linkedSkinTail || resolvedSkin?.tail || matchedSource).toLowerCase().replace(/\.png$/, '');
      if (skinKey) boundSkins.set(skinKey, mobId);
    }
  }

  // 8b. Final skin gate. Any scan tier can hand back something that is not a body
  // sheet — a GUI screen, an inventory icon, a particle sheet or a vertical animation
  // strip. Binding one of those smears menu art across every cube of the model, so the
  // bind is refused here and a clean code-drawn sheet takes its place.
  const NON_SKIN_SOURCE =
    /(^|_)(gui|menu|inventory|container|crafting|trade|button|panel|hud|slot|icon|logo|title|banner|splash|font|atlas|palette|preview|tooltip|background|interface|ui|book|page)(_|$)/;
  for (const mobId of mobIds) {
    const bytes = entityTextures.get(mobId);
    const size = readPngDimensions(bytes);
    if (!bytes || !size) continue;
    const source = (skinIdentity.get(mobId) ?? '').toLowerCase();
    if (source.startsWith('synthetic:')) continue;
    const stem = source.replace(/\.png$/, '').replace(/[^a-z0-9]+/g, '_');
    const isFrameStrip = size.height > size.width && size.height % size.width === 0;
    // A skin's pixel size is not constrained by Java or by Bedrock: GeckoLib and vanilla
    // models both map UVs onto the sheet's own pixels, so a 90x90 or a 73x73 body sheet is a
    // legitimate entity texture. Only a sheet that cannot be a body texture at all — menu
    // art, or a vertical animation strip — is refused. An unusual size is reported and kept,
    // never replaced.
    const notBlockAligned = size.width % 16 !== 0 || size.height % 16 !== 0;
    if (!NON_SKIN_SOURCE.test(stem) && !isFrameStrip) {
      if (notBlockAligned) {
        log(
          `[TEXTURE] Entity skin for mob "${mobId}" is ${size.width}x${size.height} (not a multiple of 16) — kept as the source shipped it; geometry UVs are re-based to the sheet's real pixel size.`,
        );
      }
      continue;
    }
    skinIdentity.set(mobId, `synthetic:${mobId}`);
    const reasons = [
      NON_SKIN_SOURCE.test(stem) ? 'menu/icon art' : '',
      isFrameStrip ? 'animation frame strip' : '',
    ].filter(Boolean);
    // A rejected sheet is ABSENT. Nothing is drawn in its place unless playable mode
    // explicitly allows INVENTED fallback art.
    entityTextures.delete(mobId);
    if (playableMode) {
      const mobPalette = portAnalysis.palettes[mobId] || ['#475569', '#38bdf8', '#0284c7', '#0f172a'];
      entityTextures.set(mobId, createFullMobTexture64x64(mobId, mobPalette));
      fallbackMobIds.push(mobId);
      log(
        `[TEXTURE] Rejected "${source}" for mob "${mobId}" (${size.width}x${size.height}, ${reasons.join(', ')}) — not an entity skin; substituting an INVENTED sheet because playable mode is on.`,
      );
    } else {
      withheldSkinIds.push(mobId);
      log(
        `[TEXTURE] Rejected "${source}" for mob "${mobId}" (${size.width}x${size.height}, ${reasons.join(', ')}) — not an entity skin; the texture is marked ABSENT and no replacement was drawn (playable mode off).`,
      );
    }
  }

  if (fallbackMobIds.length > 0) {
    log(`[TEXTURE] Synthesized fallback entity skins (no authentic skin in archive): ${fallbackMobIds.join(', ')}.`);
  }

  if (discoveredSkinMobs.size > 0) {
    log(
      `[TEXTURE:DISCOVERY] ${discoveredSkinMobs.size} mob skin(s) came from the recursive textures/** scan (${[...discoveredSkinMobs].slice(0, 12).join(', ')}); each file was copied into textures/entity/ and tagged ADAPTED, because no class resource string names it.`,
    );
  }

  // Duplicate alias collapse: only merge aliases when geometry, skin, AND detected behavior / ID registration match.
  // Mobs registered under different IDs with different behavior stay separate!
  const droppedMobs = new Set<string>();
  const isVariantOrLayer = (name1: string, name2: string): boolean => {
    const n1 = name1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const n2 = name2.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (n1 === n2) return true;
    if (n1.startsWith(n2) || n2.startsWith(n1)) {
      const diff = n1.startsWith(n2) ? n1.slice(n2.length) : n2.slice(n1.length);
      return /^(boss|variant|var|v\d+|alt|sub|phase\d*|stage\d*|form\d*|type\d*|layer|layers|armor|render|mob|entity|base|default|clone|minion|part|overlay|outer|inner)$/.test(diff);
    }
    return false;
  };

  const registeredEntityIds = new Set((decompileStats?.registeredEntities ?? []).map((e) => e.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const archivePaths = fileEntries?.map((entry) => entry.path) ?? [];
  const preBehaviorProfiles = inferMobBehaviorProfiles(mobIds, decompileStats?.classes ?? [], { archivePaths });

  for (const keepMob of mobIds) {
    if (droppedMobs.has(keepMob)) continue;
    const keepSkin = skinIdentity.get(keepMob);
    const keepGeo = findNearbyGeometry(modelResult.entityGeometries, keepMob);
    const keepProf = preBehaviorProfiles[keepMob];

    for (const aliasMob of mobIds) {
      if (aliasMob === keepMob || droppedMobs.has(aliasMob)) continue;
      const aliasSkin = skinIdentity.get(aliasMob);
      const aliasGeo = findNearbyGeometry(modelResult.entityGeometries, aliasMob);
      const aliasProf = preBehaviorProfiles[aliasMob];

      const sharesSkin = keepSkin && aliasSkin && !keepSkin.startsWith('synthetic:') && keepSkin === aliasSkin;
      const sharesGeo = Boolean(
        keepGeo &&
        aliasGeo &&
        (keepGeo.json === aliasGeo.json || (keepGeo.bonesCount === aliasGeo.bonesCount && keepGeo.cubesCount === aliasGeo.cubesCount && keepGeo.cubesCount > 0))
      );

      // Only merge aliases when geometry, skin, AND detected behavior/ID registration match.
      // Mobs registered under different IDs with different behavior stay separate!
      const behaviorsMatch = Boolean(
        keepProf &&
        aliasProf &&
        keepProf.attack === aliasProf.attack &&
        keepProf.disposition === aliasProf.disposition &&
        keepProf.trading === aliasProf.trading
      );

      const kNorm = keepMob.toLowerCase().replace(/[^a-z0-9]/g, '');
      const aNorm = aliasMob.toLowerCase().replace(/[^a-z0-9]/g, '');
      const bothRegisteredDistinct =
        registeredEntityIds.has(kNorm) &&
        registeredEntityIds.has(aNorm) &&
        kNorm !== aNorm;

      // If registered under distinct IDs in Java mod and behaviors differ, NEVER merge!
      if (bothRegisteredDistinct && !behaviorsMatch) {
        continue;
      }
      if (bothRegisteredDistinct) {
        // Distinct entities in the Java registry stay separate
        continue;
      }

      // Aliases collapse only when the names really are the same asset (variant /
      // layer / sub-model), the skin and geometry byte-match AND the detected
      // behaviour matches. Anything else stays a separate entity.
      if (sharesSkin && sharesGeo && behaviorsMatch && isVariantOrLayer(keepMob, aliasMob)) {
        droppedMobs.add(aliasMob);
        log(
          `[MODEL] Collapsed duplicate alias "${aliasMob}" into "${keepMob}" (matching geometry/skin/behavior) — exporting one clean entity instead of duplicate overlapping ghosts.`,
        );
      }
    }
  }

  if (droppedMobs.size > 0) {
    const droppedPatterns = [...droppedMobs].map(
      (mob) => new RegExp(`(^|/)${mob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.|/)`),
    );
    for (const dropped of droppedMobs) {
      entityTextures.delete(dropped);
      modelResult.entityGeometries.delete(dropped);
    }
    const pruneMobFiles = (pack: Record<string, string>) => {
      for (const key of Object.keys(pack)) {
        if (droppedPatterns.some((pattern) => pattern.test(key))) {
          delete (pack as Record<string, string | undefined>)[key];
        }
      }
    };
    pruneMobFiles(animResult.resourcePackFiles);
    pruneMobFiles(animResult.behaviorPackFiles);
    const keptItems = items.filter((it) => {
      if (it.category !== 'spawn_egg') return true;
      const cleanMobName = it.name.replace(/spawn egg/gi, '').replace(/summon egg/gi, '').replace(/egg/gi, '').trim();
      const mobKey = safeFileId(cleanMobName) || it.id.replace(/_spawn_egg$/, '');
      return !droppedMobs.has(mobKey);
    });
    items.length = 0;
    items.push(...keptItems);
  }
  const activeMobIds = mobIds.filter((mobId) => !droppedMobs.has(mobId));
  const mobBehaviorProfiles = inferMobBehaviorProfiles(activeMobIds, decompileStats?.classes ?? [], { archivePaths });

  // Align every mob model to the true pixel size of its linked skin so box UVs
  // never sample the wrong region of 128x128 / 256x256 textures.
  // First pass: upscale low-resolution legacy skins (< 64px) with crisp
  // nearest-neighbor sampling to prevent texture sampling artifacts.
  const shouldUpscaleLegacyTextures = getAutoUpscaleLegacyTextures();
  if (!shouldUpscaleLegacyTextures) {
    log('[TEXTURE] Legacy texture upscaling disabled; preserving original resolutions.');
  }
  for (const mobId of activeMobIds) {
    if (!shouldUpscaleLegacyTextures) continue;
    const bytes = entityTextures.get(mobId);
    const size = readPngDimensions(bytes);
    if (!bytes || !size) continue;
    if (size.width >= 64 && size.height >= 64) continue;
    try {
      const upscaled = await upscaleLegacyTexture(bytes, 64);
      if (upscaled) {
        entityTextures.set(mobId, upscaled);
        const out = readPngDimensions(upscaled);
        log(`[TEXTURE] Upscaled legacy skin for mob "${mobId}" (${size.width}x${size.height} -> ${out?.width ?? '?'}x${out?.height ?? '?'}, nearest-neighbor).`);
      }
    } catch {
      // Upscaling is best-effort; keep original bytes if the browser cannot re-encode
    }
  }
  for (const mobId of activeMobIds) {
    const geo = findNearbyGeometry(modelResult.entityGeometries, mobId);
    const skinSize = readPngDimensions(entityTextures.get(mobId));
    if (!geo || !skinSize) continue;
    const rebased = rebaseGeometryTexture(geo, skinSize.width, skinSize.height);
    if (rebased !== geo) {
      modelResult.entityGeometries.set(mobId, rebased);
      log(`[MODEL] Mob "${mobId}" geometry UVs re-based to its ${skinSize.width}x${skinSize.height} skin.`);
    }
  }

  // 8c. Per-mob parity table: every column is derived from what actually shipped in the
  // pack, so an authentic model or skin always counts as ported and template output is
  // never dressed up as a source-backed conversion.
  const perMobAudit: PerMobAuditItem[] = activeMobIds.map((mobId) => {
    const geo = findNearbyGeometry(modelResult.entityGeometries, mobId);
    // A polygon-mesh model has no cubes, so it is authentic geometry only when it really
    // carries polygons.
    const authenticModel = Boolean(
      geo && geo.source !== 'rigged_template' && (geo.cubesCount > 0 || (geo.polyCount ?? 0) > 0),
    );
    const skin = skinIdentity.get(mobId) ?? '';
    const authenticSkin = skin.length > 0 && !skin.startsWith('synthetic:');
    const profile = mobBehaviorProfiles[mobId];
    const locomotion = classifyLocomotion(
      boneNamesFromGeometry(animResult.resourcePackFiles[`models/entity/${mobId}.geo.json`]),
      profile?.flyingDetected ?? false,
    );
    const aiNote = !profile || profile.isDefault
      ? 'no attack or AI evidence in mod code or data — no combat components written'
      : `${profile.disposition} ${profile.attack} (${profile.confidence}); ${profile.damageDetected ? `${profile.damage} dmg` : 'damage not in mod code'}; ${locomotion.rig} locomotion`;
    const animIds = countClipIds(animResult.resourcePackFiles[`animations/${mobId}.animation.json`]);
    // SOURCE clips are the ids the mod's own animation documents supplied. GeckoLib names its
    // clips `animation.<entity>.<state>`, so a name prefix can never separate source from
    // template output — provenance has to come from the importer's own record.
    const declaredSourceClipIds = animResult.sourceClipIdsByMob?.[mobId] ?? [];
    const sourceClipCount = declaredSourceClipIds.filter((id) => animIds.includes(id)).length;
    const spawnShipped = Boolean(animResult.behaviorPackFiles[`spawn_rules/${mobId}.json`]);
    const lootShipped = Boolean(animResult.behaviorPackFiles[`loot_tables/entities/${mobId}.json`]);
    // Component provenance is the ONLY input to the parity table and the counts.
    const provenance: Record<'model' | 'texture' | 'ai' | 'animations' | 'spawn' | 'loot', ComponentProvenance> = {
      model: authenticModel ? 'SOURCE' : 'SCAFFOLD',
      texture: authenticSkin
        ? discoveredSkinMobs.has(mobId)
          ? 'ADAPTED'
          : 'SOURCE'
        : withheldSkinIds.includes(mobId)
          ? 'ABSENT'
          : 'INVENTED',
      ai: !profile || profile.isDefault
        ? 'INVENTED'
        : profile.confidence === 'bytecode-signature' || profile.confidence === 'data-signature'
          ? 'SOURCE'
          : 'ADAPTED',
      animations: sourceClipCount > 0 ? 'SOURCE' : animIds.length > 0 ? 'INVENTED' : 'ABSENT',
      spawn: spawnShipped ? 'ADAPTED' : 'ABSENT',
      loot: lootShipped ? 'SOURCE' : 'ABSENT',
    };
    const model = statusFromProvenance(provenance.model);
    const texture = statusFromProvenance(provenance.texture);
    const ai = statusFromProvenance(provenance.ai);
    const animations = statusFromProvenance(provenance.animations);
    const spawn = statusFromProvenance(provenance.spawn);
    const loot = statusFromProvenance(provenance.loot);
    const componentValues = Object.values(provenance);
    const columns = [model, texture, ai, animations, spawn, loot];
    const status: PerMobAuditItem['status'] = columns.includes('fallback')
      ? 'fallback'
      : columns.includes('approximated') ? 'approximated' : 'ported';
    return {
      mobId,
      name: mobDisplayNames.get(mobId) ?? mobId.replace(/_/g, ' '),
      provenance,
      parityComponents: componentValues.filter((value) => value === 'SOURCE' || value === 'ADAPTED').length,
      excludedComponents: componentValues.filter((value) => value !== 'SOURCE' && value !== 'ADAPTED').length,
      model,
      modelSource: authenticModel ? 'authentic Java / GeckoLib model' : 'generic rig (scaffold, absent from the mod)',
      texture,
      textureSource: authenticSkin
        ? discoveredSkinMobs.has(mobId)
          ? `${skin} (authentic sheet found by the recursive textures/** scan — no direct class/model reference)`
          : skin
        : withheldSkinIds.includes(mobId) ? 'UNMATCHED — INVENTED skin withheld' : 'INVENTED code-drawn skin',
      ai,
      aiNote,
      animations,
      animCount: animIds.length,
      spawn,
      loot,
      status,
    };
  });
  const provenanceEntries: ProvenanceEntry[] = [];
  for (const row of perMobAudit) {
    const rowSourceClips = (animResult.sourceClipIdsByMob?.[row.mobId] ?? []).length;
    const reasons: Record<string, string> = {
      model: row.modelSource ?? '',
      texture: row.textureSource ?? '',
      ai: row.aiNote ?? '',
      animations: `${row.animCount ?? 0} clip(s) shipped — ${rowSourceClips} SOURCE from the mod, ${Math.max(0, (row.animCount ?? 0) - rowSourceClips)} INVENTED template clip(s)`,
      spawn: 'spawn rules generated from detected mod spawn registration',
      loot: 'loot table shipped from the mod',
    };
    for (const kind of ['model', 'texture', 'ai', 'animations', 'spawn', 'loot'] as const) {
      const value = row.provenance[kind];
      if (value === 'ABSENT') continue;
      provenanceEntries.push({
        id: `mob:${row.mobId}:${kind}`,
        kind,
        target: row.mobId,
        provenance: value,
        reason: reasons[kind] || '',
        enabled: value !== 'INVENTED' || playableMode,
      });
    }
    log(
      `[AUDIT] Mob "${row.mobId}" -> model ${row.provenance.model} | texture ${row.provenance.texture} | AI ${row.provenance.ai} | animations ${row.provenance.animations}${row.animCount > 0 ? ` (${row.animCount} clips)` : ''} | spawn ${row.provenance.spawn} | loot ${row.provenance.loot}`,
    );
  }
  if (perMobAudit.length > 0) {
    const parityComponents = perMobAudit.reduce((acc, row) => acc + row.parityComponents, 0);
    const excludedComponents = perMobAudit.reduce((acc, row) => acc + row.excludedComponents, 0);
    log(
      `[AUDIT] Per-component parity: ${parityComponents} SOURCE/ADAPTED component(s) count toward parity, ${excludedComponents} SCAFFOLD/INVENTED/UNRESOLVED component(s) are excluded (counted per component, never per mob).`,
    );
  }

  await yieldToUi();

  // 9. Assemble Bedrock Behavior & Resource Packs
  log('[PACK] Writing Bedrock manifests, scripts, item definitions, recipes & functions...');
  const actionMessage = `[${name}] loaded successfully! (Ported Using Stonebyte-JavaBE)`;
  const packOptions = {
    targetEngineVersion: targetEngineTriple,
    enableBetaApis: experimentConfig?.enableBetaApis ?? true,
    enableCameras: experimentConfig?.enableCameras ?? true,
    enableCustomUi: experimentConfig?.enableCustomUi ?? true,
    enableVoxelShapes: experimentConfig?.enableVoxelShapes ?? true,
    enableUpcomingCreatorFeatures: experimentConfig?.enableUpcomingCreatorFeatures ?? true,
    enablePbr: experimentConfig?.enablePbr ?? false,
    enableScriptEval: experimentConfig?.enableScriptEval ?? false,
    mobProfiles: mobBehaviorProfiles,
    mobLinks,
  };
  let packs;
  try {
    packs = createPackFiles(
      name,
      id,
      description,
      mechanics,
      items,
      actionMessage,
      resourceUuid,
      packIconBytes,
      itemAssets,
      undefined,
      portAnalysis.scriptCustomLogic,
      animResult,
      recipeResult.behaviorPackRecipes,
      modelResult.entityGeometries,
      entityTextures,
      fileEntries,
      packOptions,
    );
  } catch (packError) {
    console.warn('[Aippy] Pack assembly issue, assembling safe pack:', packError);
    packs = createPackFiles(
      name,
      id,
      description,
      mechanics,
      items,
      actionMessage,
      resourceUuid,
      packIconBytes,
      new Map(),
      undefined,
      portAnalysis.scriptCustomLogic,
      animResult,
      recipeResult.behaviorPackRecipes,
      modelResult.entityGeometries,
      entityTextures,
      fileEntries,
      packOptions,
    );
  }

  if (packs) {
    stages.ok(
      'pack-assembly',
      'Behavior & resource pack assembly',
      `${Object.keys(packs.resourcePackFiles).length} resource / ${Object.keys(packs.behaviorPackFiles).length} behavior files`,
    );
  } else {
    stages.fail('pack-assembly', 'Behavior & resource pack assembly', 'no pack object was produced');
  }

  await yieldToUi();

  // 9b. Entity & Animation Engine: bind every client entity to its own render controller,
  // register the texture/geometry variants that actually shipped, map the material from the
  // real PNG header and ship armour attachables for the recovered armour sheets.
  const entityEngine = packs
    ? applyEntityAnimationEngine({
        modId: id,
        resourcePackFiles: packs.resourcePackFiles,
        items,
        assetIndex,
        onLog: log,
      })
    : null;
  if (entityEngine) {
    stages.ok(
      'entity-engine',
      'Entity & animation engine',
      `${entityEngine.renderControllersGenerated} render controller(s), ${entityEngine.textureVariantsRegistered} texture / ${entityEngine.geometryVariantsRegistered} geometry variant(s), ${entityEngine.attachablesGenerated} attachable(s)`,
    );
  } else {
    stages.fail('entity-engine', 'Entity & animation engine', 'no assembled pack for entity definitions to bind to');
  }

  await yieldToUi();

  // 10. Universal Runtime Validation & Recursive Self-Healing Repair Pipeline
  const healingResult = await runSelfHealingRepairPipeline({
    addonName: name,
    modId: id,
    items,
    bundle: packs,
    sourceTextures,
    animResult,
    perMobAudit,
    mobProfiles: mobBehaviorProfiles,
    stageResults: stages.results(),
    onLog: log,
    onAutoRepairTrigger,
  });

  const finalPacks = healingResult.bundle;
  const finalItems = healingResult.items;
  const foliagePipeline = runFoliageTransparencyPipeline({
    entries: fileEntries ?? [],
    index: assetIndex,
    classes: decompileStats?.classes ?? [],
    behaviorPackFiles: finalPacks.behaviorPackFiles,
    onLog: log,
  });
  stages.ok('foliage-transparency', 'Foliage & plant pipeline', foliagePipeline.summary);
  healingResult.parityHealth.foliagePipeline = foliagePipeline;
  // Flipbooks are registered on the FINAL pack: every entry must reference a PNG and a
  // terrain atlas tile that actually shipped, otherwise Bedrock drops the flipbook.
  applyTextureEngineToPack(textureEngine, finalPacks.resourcePackFiles, log);

  // The bounded repair loop can synthesize a fallback client entity, so the engine is
  // re-applied to the FINAL pack: every shipped definition gets its render controller and
  // material, not only the ones that existed before repair. The pass is idempotent.
  const entityEngineFinal = applyEntityAnimationEngine({
    modId: id,
    resourcePackFiles: finalPacks.resourcePackFiles,
    items: finalItems,
    assetIndex,
  });
  if (entityEngineFinal.mobs > (entityEngine?.mobs ?? 0)) {
    log(
      `[ENTITY] ${entityEngineFinal.mobs - (entityEngine?.mobs ?? 0)} client entity definition(s) created by the repair loop were bound to their geometry, material and render controller.`,
    );
  }

  // 10b. Reference validation on the FINAL pack: a client entity definition may only
  // reference a geometry identifier, texture, material, render controller, clip or bone
  // that really exists. Dangling references are reported, never counted as passing.
  const entityValidation = validateEntityReferences(finalPacks.resourcePackFiles);
  if (entityValidation.mobs > 0) {
    log(
      `[ENTITY:PREFLIGHT] (measured before the animation writer and bone retargeting run; the audit below and the final measurement are the ones reported) ${entityValidation.mobs} client entity definition(s), ${entityValidation.clipsChecked} animation reference(s), ${entityValidation.boneTracksResolved}/${entityValidation.boneTracksChecked} bone track(s) resolve to a shipped bone; ${entityValidation.errorCount} dangling reference(s) UNRESOLVED, ${entityValidation.warningCount} warning(s).`,
    );
    for (const issue of entityValidation.issues.slice(0, 6)) {
      log(`[ENTITY:WARN] ${issue.mobId} — ${issue.kind} ${issue.subject}: ${issue.detail}.`);
    }
    if (entityValidation.issues.length > 6) {
      log(`[ENTITY:WARN] ${entityValidation.issues.length - 6} further entity reference issue(s) not listed.`);
    }
  }
  // 10c. Behaviour Translation Engine: reconstruct AI, movement, combat, loot, trades,
  // timers, inventory and item/block behaviour from the mod's own bytecode and data, and
  // emit only the Bedrock structures the evidence supports. Java mechanics with no honest
  // Bedrock counterpart are reported as UNSUPPORTED instead of being faked.
  const behaviorTranslation = translateBehaviors({
    modId: id,
    entries: fileEntries ?? [],
    classes: decompileStats?.classes ?? [],
    mobProfiles: mobBehaviorProfiles,
    items: finalItems,
    behaviorPackFiles: finalPacks.behaviorPackFiles,
    resourcePackFiles: finalPacks.resourcePackFiles,
    recipeStats: {
      converted: recipeResult.stats.recipesConverted,
      fallback: recipeResult.stats.fallbackRecipesCount,
      unresolved: recipeResult.stats.unresolvedIngredients,
    },
    playableMode,
    stageFailed: stages.hasFailure(),
    onLog: log,
  });
  stages.ok(
    'behavior-translation',
    'Behaviour translation engine',
    `${behaviorTranslation.findings.length} mapping(s), ${behaviorTranslation.emittedFileCount} behaviour file(s) emitted, ${behaviorTranslation.worldgen.filesWritten.length} world-generation file(s), ${behaviorTranslation.unsupported.length} unsupported mechanic(s)`,
  );

  const resCount = Object.keys(finalPacks.resourcePackFiles).length;
  const behCount = Object.keys(finalPacks.behaviorPackFiles).length;
  log(`[PACK] Resource pack: ${resCount} files | Behavior pack: ${behCount} files`);
  if (stages.hasFailure()) {
    stages.fail(
      'validation',
      'Runtime validation & bounded repair',
      `BLOCKED by failed stage(s): ${stages.failedLabels().join(', ')}`,
    );
  } else {
    stages.ok(
      'validation',
      'Runtime validation & bounded repair',
      `${healingResult.parityHealth.unresolvedAnomalyCount ?? 0} unresolved, ${healingResult.parityHealth.repairedCount} repair(s)`,
    );
  }

  // Hardcoding audit: scored against the pack being exported, then reported per pattern.
  const archiveParticleIds = (fileEntries ?? [])
    .map((entry) => entry.path.replace(/\\/g, '/').toLowerCase())
    .filter((path) => path.includes('/particles/') && path.endsWith('.json'))
    .map((path) => safeFileId((path.split('/').pop() ?? '').replace(/\.(particle\.)?json$/i, '')))
    .filter((id) => id.length > 0);
  const hardcodingAudit = buildHardcodingAudit({
    resourcePackFiles: finalPacks.resourcePackFiles,
    behaviorPackFiles: finalPacks.behaviorPackFiles,
    items: finalItems,
    provenanceEntries,
    sourceParticleIds: archiveParticleIds,
    onLog: log,
  });
  const stageResults = stages.results();
  healingResult.parityHealth.stageResults = stageResults;
  const provenanceReport = buildProvenanceReport(provenanceEntries);
  if (healingResult.parityHealth.fidelityAudit) {
    healingResult.parityHealth.fidelityAudit.provenanceReport = provenanceReport;
    healingResult.parityHealth.fidelityAudit.hardcodingAudit = hardcodingAudit;
    healingResult.parityHealth.fidelityAudit.stageResults = stageResults;
  }
  healingResult.parityHealth.hardcodingAudit = hardcodingAudit;
  healingResult.parityHealth.textureEngine = textureEngine;
  healingResult.parityHealth.behaviorTranslation = behaviorTranslation;
  if (sourceDiscovery) healingResult.parityHealth.sourceDiscovery = sourceDiscovery;
  if (sourceIR) healingResult.parityHealth.sourceIR = sourceIR;
  if (animResult.universalAnimationDiscovery) {
    healingResult.parityHealth.universalAnimationDiscovery = animResult.universalAnimationDiscovery;
  }
  if (animResult.universalAnimationIR) {
    healingResult.parityHealth.universalAnimationIR = animResult.universalAnimationIR;
  }
  if (animResult.universalVariables) {
    healingResult.parityHealth.universalVariables = animResult.universalVariables;
  }
  if (healingResult.parityHealth.fidelityAudit) {
    if (sourceDiscovery) healingResult.parityHealth.fidelityAudit.sourceDiscovery = sourceDiscovery;
    if (sourceIR) healingResult.parityHealth.fidelityAudit.sourceIR = sourceIR;
  }
  const entityEngineReport = { ...entityEngineFinal, validation: entityValidation };
  if (entityEngineReport) healingResult.parityHealth.entityEngine = entityEngineReport;
  if (healingResult.parityHealth.fidelityAudit) {
    healingResult.parityHealth.fidelityAudit.textureEngine = textureEngine;
    if (entityEngineReport) healingResult.parityHealth.fidelityAudit.entityEngine = entityEngineReport;
    healingResult.parityHealth.fidelityAudit.behaviorTranslation = behaviorTranslation;
  }
  log(
    `[BEHAVIOR] Behaviour translation: ${behaviorTranslation.totals.ported} ported, ${behaviorTranslation.totals.approximated} approximated, ${behaviorTranslation.totals.fallback} fallback, ${behaviorTranslation.totals.unresolved} unresolved, ${behaviorTranslation.unsupported.length} unsupported mechanic(s); ${behaviorTranslation.emittedFileCount} file(s) emitted, ${behaviorTranslation.unverifiedClaims} claim(s) downgraded for having no shipped output.`,
  );
  log(`[BEHAVIOR:WORLDGEN] ${behaviorTranslation.worldgen.summary}`);
  if (behaviorTranslation.worldgen.filesWritten.length > 0) {
    log(
      `[BEHAVIOR:WORLDGEN] Shipped ${behaviorTranslation.worldgen.filesWritten.slice(0, 6).join(', ')}${behaviorTranslation.worldgen.filesWritten.length > 6 ? ` (+${behaviorTranslation.worldgen.filesWritten.length - 6} more)` : ''}.`,
    );
  }
  if (stages.hasFailure()) log(stages.violationLine());
  log(
    `[PROVENANCE] SOURCE ${provenanceReport.counts.SOURCE} | ADAPTED ${provenanceReport.counts.ADAPTED} | SCAFFOLD ${provenanceReport.counts.SCAFFOLD} | INVENTED ${provenanceReport.counts.INVENTED} — parity counts use SOURCE + ADAPTED only (${provenanceReport.parityCount} component(s)); INVENTED defaults are ${playableMode ? 'ON (playable mode)' : 'OFF'}.`,
  );
  const gc = healingResult.parityHealth.granularCounts;
  const openAnomalies = healingResult.parityHealth.unresolvedAnomalyCount ?? 0;
  if (openAnomalies > 0) {
    log(
      `[AUDIT] ${openAnomalies} anomaly/anomalies remain UNRESOLVED after the bounded repair loop — structural validation is not reported as passed.`,
    );
  }
  if (healingResult.parityHealth.stageFailed) {
    log('[AUDIT] A pipeline stage failed, so dependent category counts are shown as FAILED instead of zero.');
  }
  if (stages.hasFailure()) {
    log('[AUDIT] Conversion audit complete — STRUCTURAL STATUS FAILED; dependent category totals are FAILED, not zero. In-game behavior has not been tested.');
  } else if (gc) {
    log(
      `[AUDIT] Conversion audit complete — ${stages.hasFailure() ? 'STRUCTURAL STATUS FAILED; dependent results are blocked.' : 'simulated structural checks passed.'} Category counts: Blocks (${gc.blocks.ported} ported, ${gc.blocks.approximated} approx, ${gc.blocks.fallback} fallback, ${gc.blocks.unresolved} unresolved) | Items (${gc.items.ported} ported, ${gc.items.approximated} approx, ${gc.items.fallback} fallback, ${gc.items.unresolved} unresolved) | Mobs (${gc.mobs.ported} ported, ${gc.mobs.approximated} approx, ${gc.mobs.fallback} fallback, ${gc.mobs.unresolved} unresolved) | Textures (${gc.textures.ported} ported, ${gc.textures.approximated} approx, ${gc.textures.fallback} fallback, ${gc.textures.unresolved} unresolved) | Animations (${gc.animations.ported} ported, ${gc.animations.approximated} approx, ${gc.animations.fallback} fallback, ${gc.animations.unresolved} unresolved) | Recipes (${gc.recipes.ported} ported, ${gc.recipes.approximated} approx, ${gc.recipes.fallback} fallback, ${gc.recipes.unresolved} unresolved). In-game behavior has not been tested.`,
    );
  } else {
    log(`[AUDIT] Conversion audit complete — ${stages.hasFailure() ? 'STRUCTURAL STATUS FAILED; dependent checks did not pass.' : 'simulated structural checks passed.'} In-game behavior has not been tested.`);
  }
  log(
    stages.hasFailure()
      ? '[DONE] Bedrock addon archive compiled with FAILED conversion stage(s); review the unresolved report before use.'
      : '[DONE] Bedrock addon compiled. Test mob visibility in-game before relying on the port.',
  );

  return {
    name,
    id,
    description,
    sourceFileName,
    mechanics,
    items: finalItems,
    behaviorPackFiles: finalPacks.behaviorPackFiles,
    resourcePackFiles: finalPacks.resourcePackFiles,
    fileName: `${id}_bedrock_port.mcaddon`,
    translationStatus: 'deterministic',
    packIconDataUrl,
    decompileStats,
    modelPortSnapshot: {
      stats: modelResult.stats,
      registry: modelResult.registry,
      animation: {
        sourceFiles: animResult.geckolibFilesDiscovered ?? 0,
        clipsImported: animResult.geckolibClipsImported ?? 0,
        clipsAttributed: animResult.geckolibClipsAttributed ?? 0,
        clipsWithheld: animResult.withheldInventedClipCount ?? 0,
        clipsInvented: animResult.inventedClipCount ?? 0,
        boneTracksRetargeted: animResult.playerRigBoneMappings ?? 0,
        boneTracksUnmapped: animResult.playerRigUnmappedBones ?? [],
        playerRigClips: animResult.playerRigClipsBridged ?? 0,
        playerBoneMappings: animResult.playerRigBoneMappings ?? 0,
      },
    },
    animationsPortedCount: animResult.totalAnimationsPorted,
    animationControllersCount: animResult.totalControllersPorted,
    particlesPortedCount: animResult.totalParticlesPorted,
    lightingAnimationsCount: animResult.totalLightingAnimationsPorted,
    parityHealth: healingResult.parityHealth,
    motionSmoothing: animResult.motionSmoothing,
    sourceIR: sourceIR ?? undefined,
    playerEntityWiring: animResult.playerEntityWiring ?? null,
    playerTriggers: animResult.playerTriggerReport ?? null,
    playerAnimationPort: animResult.playerAnimationPort ?? null,
    playerSourceClipIds: animResult.playerSourceClipIds ?? [],
    playerSourceClipIdToPlayerClipId: animResult.playerSourceClipIdToPlayerClipId ?? {},
    playerWiringFiles: animResult.playerWiringFiles ?? {},
    playerScriptCode: animResult.playerScriptCode ?? '',
    animationExpectedClips: animResult.animationExpectedClips ?? [],
    universalAnimationDiscovery: animResult.universalAnimationDiscovery,
    universalAnimationIR: animResult.universalAnimationIR,
    universalVariables: animResult.universalVariables,
  };
}

export type RemakeResult = BedrockRemake & {
  zipBytes: Uint8Array;
  /** Optional Geyser bundle, produced alongside — never instead of — the Bedrock addon. */
  geyserBundle?: { zipBytes: Uint8Array; fileName: string };
};

export interface ConvertJavaToBedrockOptions {
  brief: string;
  fileName: string | null;
  entries: ExtractedZipEntry[];
  decompileData?: ReturnType<typeof decompileJavaMod>;
  enableUpscaling: boolean;
  onLog?: (line: string) => void;
  onAutoRepairTrigger?: () => void;
  targetVersion?: BedrockVersionTarget;
  experimentConfig?: BedrockExperimentConfig;
  /** Optional Geyser compatibility target (mappings + Geyser resource pack). */
  enableGeyser?: boolean;
  geyserVersion?: string;
}

export async function convertJavaToBedrockAddon(
  options: ConvertJavaToBedrockOptions,
): Promise<RemakeResult> {
  setAutoUpscaleLegacyTextures(options.enableUpscaling);
  const remake = await generateBedrockRemake(
    options.brief,
    options.fileName,
    options.entries,
    options.onLog,
    options.decompileData?.stats,
    options.onAutoRepairTrigger,
    options.targetVersion,
    options.experimentConfig,
  );

  // ── ENGINE EXECUTION TRACE ────────────────────────────────────────────────────────────────────
  // A newer engine living in the code base while an older writer still produces the archive is
  // invisible in the output, so this conversion records which stages actually ran, with the numbers
  // they observed, and later proves that nothing wrote after the final audits measured the pack.
  const animationTrace = createAnimationPipelineTrace({
    seed: remake.id,
    onLog: (line: string) => options.onLog?.(line),
  });
  const archiveAnimationDocuments = (options.entries ?? []).filter((entry) =>
    /\.animation\.json$/i.test(entry.path),
  ).length;
  animationTrace.requireEngine(
    'animationPortEngine → universalAnimationDiscovery / universalAnimationIR',
    remake.universalAnimationIR !== undefined,
      `${remake.universalAnimationDiscovery?.uniqueClipIdsDiscovered ?? 0} unique source animation ID(s) discovered across ${remake.universalAnimationDiscovery?.totalClipsDiscovered ?? 0} scan records, ` +
      `${remake.universalAnimationIR?.clipCount ?? 0} interpreted ID(s)${remake.universalAnimationIR === undefined ? ' (the layout importers were the only writers)' : ''}.`,
  );
  if (archiveAnimationDocuments > 0 && remake.universalAnimationIR === undefined) {
    options.onLog?.(
      '[TRACE:ENGINE] The archive ships animation documents but the interpretation engine produced no result for this conversion, so the clip set that reached the pack came from the layout importers alone. Any animation reported below describes that path, not the interpreted one.',
    );
  }
  animationTrace.stage(
    'entityAnimationEngine.applyEntityAnimationEngine (+ pack assembly)',
    `${remake.parityHealth?.entityEngine?.mobs ?? 0} client entity/ies bound, ` +
      `${remake.parityHealth?.entityEngine?.renderControllersGenerated ?? 0} render controller(s) generated, ` +
    `${new Set(remake.animationExpectedClips ?? []).size} unique clip ID(s) flagged as expected by the animation stage.`,
  );

  // Import gate: every entry path, manifest field, JSON payload and PNG header is
  // validated before the archive is written. A defect that would make Bedrock report
  // "unknown pack or broken" is reported here instead of failing silently on import.
  const integrityLog = (line: string) => {
    options.onLog?.(line);
  };

  // The export audits below are synchronous and long. Hand the frame back first so the log the
  // user is watching keeps advancing instead of freezing at the last conversion line.
  await yieldToUi();
  const resourcePrep = preparePackForExport(remake.resourcePackFiles, 'resources');
  const behaviorPrep = preparePackForExport(remake.behaviorPackFiles, 'behavior');
  for (const line of formatIntegrityLog(resourcePrep.report)) integrityLog(line);
  for (const line of formatIntegrityLog(behaviorPrep.report)) integrityLog(line);
  remake.resourcePackFiles = resourcePrep.files;
  remake.behaviorPackFiles = behaviorPrep.files;

  // Java item-model normalisation (source side). Every `models/item/*.json` is classified from
  // its OWN `parent` pointer: `item/generated` / `item/handheld` is a flat sprite that Bedrock
  // can only show through `textures/item_texture.json`, while a `block/…` parent is a cube that
  // must render through its block definition. The classification is handed to the icon pass so
  // an item's declared sheet is bound before any name-based guess, and a cube whose block never
  // shipped is reported instead of silently degrading to a flat sprite.
  const javaItemModels = classifyItemModels(options.entries ?? []);
  if (javaItemModels.size > 0) {
    const models = [...javaItemModels.values()];
    const flat = models.filter((model) => model.kind === 'flat').length;
    const cube = models.filter((model) => model.kind === 'block').length;
    const shapeless = models.filter((model) => model.kind === 'unresolved').length;
    integrityLog(
      `[ITEMMODEL] Java item-model normaliser: ${javaItemModels.size} item model(s) classified from their own parent pointers — ${flat} flat sprite(s) resolved through the item atlas, ${cube} block-backed cube(s) resolved through their block sheet, ${shapeless} with no expressible shape.`,
    );
  }

  // Bedrock client-schema gate: runs before validation so the validator measures a pack
  // whose render controllers, animation bindings, sound paths, geometry/texture references,
  // item icons and block overrides already satisfy the client schema.
  try {
    runBedrockSchemaGate({
      modId: remake.id,
      resourcePackFiles: remake.resourcePackFiles,
      behaviorPackFiles: remake.behaviorPackFiles,
      onLog: integrityLog,
    });
  } catch (error) {
    // A gate defect must never abort the conversion: whatever could not be measured is
    // reported as not measured instead of crashing the export.
    integrityLog(
      `[SCHEMA:ERROR] The client-schema gate could not complete — ${error instanceof Error ? error.message : String(error)}. The pack is exported unchanged and the unfinished checks are reported as NOT MEASURED.`,
    );
  }

  // Phase 8 — validation and bounded repair on the FINAL pack. Every generated file is
  // checked against the Bedrock requirement it must satisfy, safe defects are repaired and
  // recorded, and any conversion that failed stays in the report instead of being dropped.
  // Long synchronous pass on the whole pack. Hand the frame back first so the log the user is
  // watching keeps advancing instead of freezing on the last conversion line.
  await yieldToUi();
  const validation = runAssetValidationPipeline({
    modId: remake.id,
    targetVersion: options.targetVersion ?? 'declared in manifest',
    playableMode: isPlayableModeEnabled(),
    stageFailed: remake.parityHealth?.stageFailed ?? false,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    items: remake.items,
    onLog: integrityLog,
  });
  for (const line of formatValidationLog(validation.report)) integrityLog(line);
  remake.resourcePackFiles = validation.resourcePackFiles;
  remake.behaviorPackFiles = validation.behaviorPackFiles;

  // Geometry integrity on the exact pack that ships. A bone whose declared parent is not in
  // its own document, a duplicate bone name, a parent cycle, a cube with no UV map and a
  // cube with a zero-size axis each make part of a model — legs, head, torso — disappear in
  // game while the entity definition still looks correct. Those structural defects are
  // repaired inside each geometry document before the identity registry binds models to
  // entities; anything that still declares nothing renderable is reported UNRESOLVED.
  await yieldToUi();
  const meshRepair = repairGeometryBones({
    resourcePackFiles: remake.resourcePackFiles,
    onLog: integrityLog,
  });
  integrityLog(
    `[MESH] ${meshRepair.variants} shipped geometry variant(s) audited for missing parents, duplicate bone names and cube UV coverage; ${meshRepair.unresolved.length} variant(s) remain UNRESOLVED.`,
  );

  // Consolidated model / animation port report. Every number is copied from the engine that
  // produced it: the model source registry (which modelling formats the archive really
  // ships), the model port engine (models recovered per source), the animation engine (clips
  // imported, withheld, invented), the bone retargeter (tracks bound vs unresolved) and this
  // mesh repair pass. Nothing is estimated.
  const modelPortSnapshot = remake.modelPortSnapshot;
  const modelPort = modelPortSnapshot
    ? buildModelPortReport({ ...modelPortSnapshot, mesh: meshRepair })
    : null;
  if (modelPort) integrityLog(`[MODEL:PORT] ${modelPort.summary}`);
  else integrityLog('[MODEL:PORT:WARN] Model and animation audit evidence was unavailable; the port is not reported as complete.');
  delete remake.modelPortSnapshot;

  // Identity and atlas isolation on the exact pack that gets written. The repair and
  // validation stages both create geometry and texture references, so the canonical
  // identifier registry and the atlas rebuild run once more here: every client entity,
  // render controller, attachable, block and item ends up pointing at an identifier and a
  // PNG that really exists, and no phantom atlas entry can reach the archive.
  await yieldToUi();
  const finalIdentity = applyCanonicalGeometryRegistry({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    onLog: integrityLog,
  });
  const finalAtlas = rebuildTextureAtlases({
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    onLog: integrityLog,
  });
  validation.report.geometryRegistry = finalIdentity;
  validation.report.textureAtlas = finalAtlas;

  // Geometry identity gate: a client entity may only reference an identifier the single
  // registry really declares. When one does not resolve, the build fails loudly instead of
  // exporting an entity whose model renders nothing in game.
  if (!finalIdentity.passed) {
    integrityLog(
      `[IDENTITY:FAIL] Build FAILED the geometry identity gate: ${finalIdentity.clientEntityFailures.length} client entity geometry reference(s) resolve to no shipped model — ${finalIdentity.clientEntityFailures.slice(0, 4).join(' | ')}${finalIdentity.clientEntityFailures.length > 4 ? ' …' : ''}`,
    );
    if (remake.parityHealth) remake.parityHealth.stageFailed = true;
  }

  // PBR / Deferred-material port: every PNG in the imported archive is measured against the
  // PBR naming conventions (normal / specular / emissive / height), whatever mod or pack it
  // came from. Matched maps are bound to the colour sheets the converted pack really ships,
  // Java specular + emissive channels are re-encoded into Bedrock's MER sheet, and a
  // `minecraft:texture_set` plus the resource manifest `pbr` capability are declared. Runs
  // after the atlas rebuild so channel maps never pollute the block/item atlases.
  const pbrMaterials = await buildPbrMaterials({
    resourcePackFiles: remake.resourcePackFiles,
    entries: options.entries ?? [],
    onLog: integrityLog,
  });
  if (remake.parityHealth) remake.parityHealth.pbrMaterials = pbrMaterials;

  // Client entity linking on the exact pack that ships. A behavior entity without
  // `entity/<name>.entity.json` has no visual definition at all and renders invisible in game,
  // so the missing file is generated from the model and skin this pack already ships. Runs
  // before the spawn-egg policy so a newly linked mob also receives its registration colours.
  const clientLinks = generateMissingClientEntities({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    onLog: integrityLog,
  });
  integrityLog(
    `[CLIENT-ENTITY] ${clientLinks.created} missing client entity file(s) generated from shipped model + skin evidence, ${clientLinks.unresolved.length} behavior entit(ies) stayed unlinked (no model or skin ships — nothing invented).`,
  );

  // Spawn egg policy on the exact pack that ships: egg colours belong in each spawned mob's
  // client entity and are read from the mod's own Java registration. Standalone egg items and
  // drawn egg art are removed, never re-generated.
  const spawnEggPolicy = applySpawnEggPolicy({
    entries: options.entries ?? [],
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    playableMode: isPlayableModeEnabled(),
    onLog: integrityLog,
  });
  integrityLog(
    `[SPAWN-EGG] ${spawnEggPolicy.coloursApplied.length} mob(s) with registration spawn egg colours, ${spawnEggPolicy.coloursInvented.length} INVENTED, ${spawnEggPolicy.coloursUnresolved.length} UNRESOLVED; ${spawnEggPolicy.spawnableEntitiesEnabled.length} mob behavior definition(s) enabled for player spawning; ${spawnEggPolicy.standaloneEggItemsRemoved} standalone egg item(s) and ${spawnEggPolicy.eggArtRemoved} egg texture(s) removed.`,
  );

  // Final post-processing pass on the exact pack that ships: sound paths, item icon
  // schema, Molang queries and manifest versions are repaired against the four export
  // rules so content-log errors never reach the archive. Runs before the final schema
  // gate so the gate measures the repaired pack.
  const postProcess = runPostProcessPass({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    itemModels: javaItemModels,
    onLog: integrityLog,
  });
  if (remake.parityHealth) remake.parityHealth.postProcess = postProcess;

  // Final schema pass on the exact pack that ships: the registry and atlas rebuild happen
  // after validation, so the client schema is re-checked and the before/after report from
  // this pass is the one attached to the export.
  let schemaGate: ReturnType<typeof runBedrockSchemaGate> | undefined;
  try {
    schemaGate = runBedrockSchemaGate({
      modId: remake.id,
      resourcePackFiles: remake.resourcePackFiles,
      behaviorPackFiles: remake.behaviorPackFiles,
      onLog: integrityLog,
    });
  } catch (error) {
    integrityLog(
      `[SCHEMA:ERROR] The final client-schema gate could not complete — ${error instanceof Error ? error.message : String(error)}. Schema checks are reported as NOT MEASURED, never as passed.`,
    );
  }
  if (schemaGate) validation.report.schemaGate = schemaGate;
  if (remake.parityHealth) {
    remake.parityHealth.geometryRegistry = finalIdentity;
    remake.parityHealth.textureAtlas = finalAtlas;
    if (modelPort) remake.parityHealth.modelPort = modelPort;
    if (modelPort && remake.parityHealth.fidelityAudit) remake.parityHealth.fidelityAudit.modelPort = modelPort;
    if (schemaGate) remake.parityHealth.schemaGate = schemaGate;
    if (remake.parityHealth.fidelityAudit) remake.parityHealth.fidelityAudit.validation = validation.report;
  }
  // Player client entity wiring: every pass above rewrites each entity/*.entity.json it finds
  // to bind that file to a mob rig, and a player.entity.json override REPLACES the whole
  // vanilla file. The wiring is therefore merged on top of the final pack, so the vanilla base
  // it re-declares survives and the ported clips stay registered.
  const playerWiringFiles = remake.playerWiringFiles ?? {};
  if (Object.keys(playerWiringFiles).length > 0) {
    for (const [path, content] of Object.entries(playerWiringFiles)) {
      if (path.startsWith('scripts/') || path.startsWith('entities/')) remake.behaviorPackFiles[path] = content;
      else remake.resourcePackFiles[path] = content;
    }
    integrityLog(
      `[WIRE] Merged ${Object.keys(playerWiringFiles).join(', ')} into the exported pack — ported player clips are registered on the player client entity and gated by translated Java triggers.`,
    );
    // Activation script. The wiring stage names the clips that must be fired from script; a
    // registered clip with no activation path is exactly the "nothing plays, nothing errors"
    // defect, so the script is merged here and its manifest declaration is guaranteed below.
    const playerActivationScript = (remake.playerScriptCode ?? '').trim();
    if (playerActivationScript.length > 0) {
      const existingScript = typeof remake.behaviorPackFiles['scripts/main.js'] === 'string'
        ? (remake.behaviorPackFiles['scripts/main.js'] as string)
        : '';
      remake.behaviorPackFiles['scripts/main.js'] = existingScript.includes(playerActivationScript)
        ? existingScript
        : [existingScript, playerActivationScript].filter(Boolean).join('\n\n');
      integrityLog(
        `[WIRE:SCRIPT] Player animation activation script merged into scripts/main.js (${playerActivationScript.split('\n').length} line(s)); every failed registration or playback attempt is logged at runtime, and /<namespace>:animation_test replays each ported clip on the executing player.`,
      );
    }
    // The pass is idempotent: the merged file goes through the same repair rules as the rest
    // of the pack, so anything it introduced is normalised exactly like the original content.
    const wiringPostProcess = runPostProcessPass({
      modId: remake.id,
      resourcePackFiles: remake.resourcePackFiles,
      behaviorPackFiles: remake.behaviorPackFiles,
      itemModels: javaItemModels,
      onLog: integrityLog,
    });
    postProcess.soundEntriesFixed += wiringPostProcess.soundEntriesFixed;
    postProcess.soundDefinitionsDropped += wiringPostProcess.soundDefinitionsDropped;
    postProcess.iconsFixed += wiringPostProcess.iconsFixed;
    postProcess.particleDocumentsRepaired =
      (postProcess.particleDocumentsRepaired ?? 0) + (wiringPostProcess.particleDocumentsRepaired ?? 0);
    postProcess.particleDocumentsDropped = [
      ...(postProcess.particleDocumentsDropped ?? []),
      ...(wiringPostProcess.particleDocumentsDropped ?? []),
    ];
    postProcess.textureSetVersionsFixed =
      (postProcess.textureSetVersionsFixed ?? 0) + (wiringPostProcess.textureSetVersionsFixed ?? 0);
    postProcess.blockSoundTypesFixed =
      (postProcess.blockSoundTypesFixed ?? 0) + (wiringPostProcess.blockSoundTypesFixed ?? 0);
    postProcess.molangExpressionsRepaired += wiringPostProcess.molangExpressionsRepaired;
    postProcess.manifestsAdjusted += wiringPostProcess.manifestsAdjusted;
    postProcess.molangFilesTouched = [
      ...new Set([...postProcess.molangFilesTouched, ...wiringPostProcess.molangFilesTouched]),
    ];
    postProcess.duplicateIdsRemoved += wiringPostProcess.duplicateIdsRemoved;
    postProcess.moduleFixesApplied.push(...wiringPostProcess.moduleFixesApplied);
    postProcess.modulesDeclared.push(...wiringPostProcess.modulesDeclared);
    postProcess.modulesRemoved.push(...wiringPostProcess.modulesRemoved);
    postProcess.danglingAnimationRefs.push(...wiringPostProcess.danglingAnimationRefs);
    postProcess.wiringWarnings.push(...wiringPostProcess.wiringWarnings);
    postProcess.missingAtlasTextures.push(...wiringPostProcess.missingAtlasTextures);
    postProcess.unregisteredItemIcons.push(...wiringPostProcess.unregisteredItemIcons);
    postProcess.unusedGeometry.push(...wiringPostProcess.unusedGeometry);
    postProcess.uvMismatchWarnings.push(...wiringPostProcess.uvMismatchWarnings);
    postProcess.missingClientEntities.push(...wiringPostProcess.missingClientEntities);
    postProcess.orphanClientEntities.push(...wiringPostProcess.orphanClientEntities);
    postProcess.missingSpawnEggs.push(...wiringPostProcess.missingSpawnEggs);
    postProcess.duplicateTextureFolders.push(...wiringPostProcess.duplicateTextureFolders);
    postProcess.textureFolderMigrations.push(...wiringPostProcess.textureFolderMigrations);
    postProcess.textureReferencesUpdated += wiringPostProcess.textureReferencesUpdated;
    postProcess.textureFolderConflicts.push(...wiringPostProcess.textureFolderConflicts);
    postProcess.armorSheetsShipped.push(...wiringPostProcess.armorSheetsShipped);
    postProcess.armorAttachablesBound += wiringPostProcess.armorAttachablesBound;
    postProcess.armorAttachableIssues.push(...wiringPostProcess.armorAttachableIssues);
    postProcess.orphanArmorSheets.push(...wiringPostProcess.orphanArmorSheets);
  } else {
    integrityLog('[WIRE] No player animation clip shipped, so no player client entity was merged.');
  }
  // Resolve variable dependencies only after every entity, animation, attachable and player
  // wiring document has been merged. Running this earlier misses readers introduced by later
  // writers and leaves source variables disconnected from the scopes that actually evaluate them.
  try {
    const sourceVariableEvidence = collectSourceVariableEvidence(options.entries ?? []);
    const variableGraph = buildMolangDependencyGraph({
      resourcePackFiles: remake.resourcePackFiles,
      behaviorPackFiles: remake.behaviorPackFiles,
      sourceVariables: sourceVariableEvidence,
      onLog: integrityLog,
    });
    if (remake.parityHealth) remake.parityHealth.molangDependencyGraph = variableGraph;
    integrityLog(`[MOLANG:GRAPH] Export audit: ${variableGraph.declaredCount} existing, ${variableGraph.reconstructedCount} reconstructed, ${variableGraph.unresolved.length} unresolved variable(s); ${variableGraph.scopeDeclarationsAdded} scope declaration(s) injected.`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    integrityLog(`[MOLANG:GRAPH:ERROR] Variable dependency linking did not complete: ${detail}. Variable wiring is NOT MEASURED.`);
    if (remake.parityHealth) remake.parityHealth.stageFailed = true;
  }

  if (remake.parityHealth) {
    remake.parityHealth.playerEntityWiring = remake.playerEntityWiring ?? null;
    remake.parityHealth.playerTriggers = remake.playerTriggers ?? null;
    remake.parityHealth.playerAnimationPort = remake.playerAnimationPort ?? null;
    if (remake.universalAnimationDiscovery) {
      remake.parityHealth.universalAnimationDiscovery = remake.universalAnimationDiscovery;
    }
    if (remake.universalAnimationIR) {
      remake.parityHealth.universalAnimationIR = remake.universalAnimationIR;
    }
    if (remake.universalVariables) {
      remake.parityHealth.universalVariables = remake.universalVariables;
    }
  }
  // A script is only kept when a source-driven stage produced one: recovered automation or the
  // activation half of an evidenced animation port. Otherwise the entry module is withheld as
  // before, so a mod with nothing to automate never ships an empty script pack.
  const shipsScript = typeof remake.behaviorPackFiles['scripts/main.js'] === 'string'
    || typeof remake.behaviorPackFiles['scripts/behaviors.js'] === 'string';
  const stripUnsupportedGeneratedContent = (files: Record<string, string | Uint8Array>, keepScriptEntry = false) => {
    const excludedPrefixes = ['scripts/', 'functions/', 'cameras/', 'spawn_rules/', 'ui/'];
    let removed = 0;
    for (const path of Object.keys(files)) {
      if (excludedPrefixes.some((prefix) => path.startsWith(prefix)) || path === 'REMAKE_NOTES.txt') {
        if (keepScriptEntry && path === 'scripts/main.js') continue;
        delete files[path];
        removed += 1;
        continue;
      }
      if (!path.startsWith('items/') && !path.startsWith('entities/')) continue;
      const raw = files[path];
      if (typeof raw !== 'string') continue;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const item = parsed['minecraft:item'] as Record<string, unknown> | undefined;
        const entity = parsed['minecraft:entity'] as Record<string, unknown> | undefined;
        const components = (item?.components ?? entity?.components) as Record<string, unknown> | undefined;
        if (components && 'minecraft:custom_components' in components) {
          delete components['minecraft:custom_components'];
          files[path] = JSON.stringify(parsed, null, 2);
        }
      } catch {
        // Preserve unparsed source/metadata documents; only known generated files are stripped.
      }
    }
    return removed;
  };
  const removedExtras = stripUnsupportedGeneratedContent(remake.behaviorPackFiles, shipsScript);
  stripUnsupportedGeneratedContent(remake.resourcePackFiles);
  const behaviorManifest = remake.behaviorPackFiles['manifest.json'];
  if (typeof behaviorManifest === 'string') {
    try {
      const manifest = JSON.parse(behaviorManifest) as Record<string, unknown>;
      const modules = (manifest.modules as Array<Record<string, unknown>> | undefined) ?? [];
      const dependencies = (manifest.dependencies as Array<Record<string, unknown>> | undefined) ?? [];
      if (!shipsScript) {
        manifest.modules = modules.filter((module) => module.type !== 'script');
        manifest.dependencies = dependencies.filter((dependency) => {
          const moduleName = dependency.module_name;
          return typeof moduleName !== 'string' || !moduleName.startsWith('@minecraft/server');
        });
      } else {
        // Script retention: the pack really ships an entry module, so the manifest must declare it
        // and the script API dependency, or the activation script never runs.
        const scriptModule = modules.find((module) => module.type === 'script');
        if (scriptModule) {
          if (scriptModule.entry !== 'scripts/main.js') scriptModule.entry = 'scripts/main.js';
          manifest.modules = modules;
        } else {
          manifest.modules = [
            ...modules,
            {
              type: 'script',
              language: 'javascript',
              uuid: stableScriptUuid(`script:${remake.id}`),
              entry: 'scripts/main.js',
              version: [1, 0, 0],
            },
          ];
          integrityLog('[WIRE:SCRIPT] Behaviour manifest gained the script module the ported animation activation script needs.');
        }
        const hasServerDependency = dependencies.some((dependency) => dependency.module_name === '@minecraft/server');
        if (!hasServerDependency) {
          manifest.dependencies = [
            ...dependencies,
            {
              module_name: '@minecraft/server',
              version: resolveScriptApiVersion(
                (manifest.header as Record<string, unknown> | undefined)?.min_engine_version ?? [1, 21, 50],
              ),
            },
          ];
          integrityLog('[WIRE:SCRIPT] Behaviour manifest declares @minecraft/server, so clip activation can reach the engine instead of failing silently.');
        }
      }
      if (Array.isArray(manifest.capabilities)) {
        manifest.capabilities = (manifest.capabilities as unknown[]).filter((capability) => capability !== 'script_eval');
      }
      remake.behaviorPackFiles['manifest.json'] = JSON.stringify(manifest, null, 2);
    } catch {
      integrityLog('[PROVENANCE] Generated script declarations could not be safely inspected; they were not altered.');
    }
  }
  if (!Object.keys(remake.resourcePackFiles).some((path) => /^entity\/[^/]+\.entity\.json$/.test(path))) {
    delete remake.resourcePackFiles['render_controllers/default.render_controllers.json'];
  }
  const blockText = Object.entries(remake.behaviorPackFiles)
    .filter(([path]) => path.startsWith('blocks/'))
    .map(([, value]) => typeof value === 'string' ? value : '')
    .join('\n');
  for (const [path, geometryId] of [
    ['models/blocks/stair.geo.json', 'geometry.stair'],
    ['models/blocks/slab.geo.json', 'geometry.slab'],
    ['models/blocks/door.geo.json', 'geometry.door'],
  ]) {
    if (!blockText.includes(geometryId)) delete remake.resourcePackFiles[path];
  }
  integrityLog(`[PROVENANCE] Withheld ${removedExtras} generated menu, script, setup, camera, and spawn-rule file(s) that were not copied from the source archive.`);

  // Animation finalization happens BELOW, after the conformance passes and the schema gate, so
  // every measurement in this function reads the state that is actually zipped. Running it here
  // is what made two auditors disagree about the same pack.

  // FINAL CONFORMANCE ORDER. Each stage above can invalidate a later one — a post-process
  // rewrite changes item and manifest shapes, the atlas rebuild drops every entry that points
  // at a PNG the pack does not ship, and the icon pass has to re-register what the rebuild
  // legitimately dropped. So the last three writers run here, in dependency order, on the
  // exact map that is zipped, and the schema gate measures the result. Nothing writes
  // resource-pack JSON after this block, which is what makes a repair impossible to revert.
  // by a later stage.
  const finalPostProcess = runPostProcessPass({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    itemModels: javaItemModels,
    onLog: integrityLog,
  });
  const finalAtlasRebuild = rebuildTextureAtlases({
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    onLog: integrityLog,
  });
  const finalIconAudit = enforceItemIconsAndBlockGeometry({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    itemModels: javaItemModels,
    onLog: integrityLog,
  });
  postProcess.itemIconsUnresolved = [
    ...new Set([...(postProcess.itemIconsUnresolved ?? []), ...finalIconAudit.missingIcons]),
  ];
  postProcess.atlasReconciled =
    (postProcess.atlasReconciled ?? 0) +
    finalIconAudit.atlasEntriesAdded +
    finalIconAudit.atlasPhantomsRemoved +
    finalIconAudit.texturesCarried;
  integrityLog(
    `[CONFORM] Final conformance order on the exported pack: ${finalPostProcess.iconsFixed} icon schema repair(s), ${finalPostProcess.particleDocumentsRepaired ?? 0} particle document(s) re-rooted, ${finalPostProcess.textureSetVersionsFixed ?? 0} texture-set version(s) corrected, ${finalPostProcess.blockSoundTypesFixed ?? 0} block sound(s) remapped; ${finalAtlasRebuild.itemEntries} item and ${finalAtlasRebuild.terrainEntries} terrain atlas entr(y/ies) rebuilt from shipped PNGs with ${finalAtlasRebuild.phantomsRemoved} phantom reference(s) removed; ${finalIconAudit.iconsRepaired} icon(s) bound to a shipped sheet, ${finalIconAudit.texturesCarried} sheet(s) carried into textures/items, ${finalIconAudit.iconsDropped} unresolvable icon reference(s) removed, ${finalIconAudit.missingIcons.length} item(s) whose source sheet is absent from the mod.`,
  );
  // ── ANIMATION FINALIZATION: the last writer before the gate ────────────────────────────────
  // Every content, repair, post-processing and icon pass has already run, so this is the state
  // that gets zipped. The order is fixed by data dependency: write the clips the interpretation IR
  // knows about, drop references that resolve to nothing, rebuild the skeleton each client entity
  // really renders, resolve state conflicts, then audit every geometry, render-controller,
  // controller and entity edge. Measuring any of this before these writes is exactly what let one
  // auditor report zero unresolved references while the final gate reported several.
  const triggerConditions: Record<string, string> = {};
  const scriptDrivenClips: string[] = [];
  for (const trigger of remake.playerTriggers?.triggers ?? []) {
    if (trigger.scriptDriven) {
      scriptDrivenClips.push(trigger.clipId);
      continue;
    }
    if (trigger.condition) triggerConditions[trigger.clipId] = trigger.condition;
  }
  if (Object.keys(triggerConditions).length > 0 || scriptDrivenClips.length > 0) {
    integrityLog(
      `[ANIM:TRIGGER] ${Object.keys(triggerConditions).length} activation condition(s) come from translated Java triggers; ${scriptDrivenClips.length} clip(s) are fired by the behaviour script and are registered without a Molang gate.`,
    );
  }

  await yieldToUi();
  const universalAnimationExport = exportUniversalAnimationIR({
    ir: remake.universalAnimationIR,
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    triggerConditions,
    // Clips the translated Java trigger hands to the script, plus every clip the writer decided to
    // fire from the script: both are registered and script-activated, never given a Molang gate
    // that would make a one-shot action loop.
    scriptDrivenClips: [
      ...new Set([...scriptDrivenClips, ...(remake.playerEntityWiring?.scriptedClips ?? [])]),
    ],
    // A player source clip already retargeted into player_ported.animation.json must not also
    // be emitted under its unretargeted source identifier by the universal writer.
    handledSourceClipIds: remake.playerSourceClipIds ?? [],
    onLog: integrityLog,
  });
  animationTrace.stage(
    'universalAnimationExporter.exportUniversalAnimationIR',
    `${universalAnimationExport.irClips} interpreted clip(s) → ${universalAnimationExport.emittedClips.length} definition(s) written, ` +
      `${universalAnimationExport.registeredClips.length} registered on ${universalAnimationExport.registeredOnEntities.length} client entity/ies, ` +
      `${universalAnimationExport.activatedClips.length} activated, ${universalAnimationExport.unregisteredClips.length} reported UNREGISTERED.`,
  );
  if (universalAnimationExport.selfTestScript) {
    ensureScriptModule(remake.behaviorPackFiles, remake.id, integrityLog);
  }
  const skeletonReconciliation = retargetBones({
    resourcePackFiles: remake.resourcePackFiles,
    onLog: integrityLog,
  });
  const animationStates = resolveAnimationStateConflicts({
    resourcePackFiles: remake.resourcePackFiles,
    onLog: integrityLog,
  });
  animationTrace.stage(
    'dynamicBoneRetargeter.retargetBones + animationStateResolver.resolveAnimationStateConflicts',
    `${skeletonReconciliation.bonesResolved}/${skeletonReconciliation.bonesExamined} bone track(s) rebound onto the shipped skeleton ` +
      `(${skeletonReconciliation.bonesRenamed} renamed, ${skeletonReconciliation.bonesInjected.length} bone(s) created, ` +
      `${skeletonReconciliation.bonesCollapsed.length} composed onto an ancestor, ${skeletonReconciliation.unmapped.length} unresolved); ` +
      `${animationStates.conflicts.length} state interaction(s) resolved (${animationStates.guarded.length} guarded, ${animationStates.shadowed.length} shadowed).`,
  );
  remake.universalAnimationExport = universalAnimationExport;
  remake.skeletonReconciliation = skeletonReconciliation;
  remake.animationStates = animationStates;
  if (remake.parityHealth) {
    remake.parityHealth.universalAnimationExport = universalAnimationExport;
    remake.parityHealth.skeletonReconciliation = skeletonReconciliation;
    remake.parityHealth.animationStates = animationStates;
  }

  // The gate runs last, so the before/after numbers attached to the export describe the
  // archive the user actually receives.
  try {
    const finalGate = runBedrockSchemaGate({
      modId: remake.id,
      resourcePackFiles: remake.resourcePackFiles,
      behaviorPackFiles: remake.behaviorPackFiles,
      onLog: integrityLog,
    });
    schemaGate = finalGate;
    validation.report.schemaGate = finalGate;
    if (remake.parityHealth) remake.parityHealth.schemaGate = finalGate;
  } catch (error) {
    integrityLog(
      `[SCHEMA:ERROR] The final client-schema gate could not complete — ${error instanceof Error ? error.message : String(error)}. Schema checks are reported as NOT MEASURED for the exported pack, never as passed.`,
    );
  }


  // ── ACTIVE WIRING ENFORCEMENT ─────────────────────────────────────────────
  // Everything the port produced for the player is now on disk. A pack that ships converted
  // animations and generated controllers but leaves `entity/player.entity.json` pointing at none
  // of them plays exactly like vanilla: the override replaces the whole vanilla definition, so the
  // engine never asks for the ported content and reports nothing. This pass re-points the exported
  // player definition at the files that really shipped, validates every controller definition it
  // hooks, and translates every Molang string that the player client-entity context cannot evaluate.
  // It runs before the registry and the auditors below, so every measurement describes the enforced
  // pack — not the one that existed before the wiring was closed.
  // ── KIND-AWARE REFERENCE NORMALISATION (pre-wiring) ────
  // A controller definition filed inside a `*.animation.json`, or a controller identifier that is
  // not spelled `controller.animation.*`, is a definition the engine never evaluates as a
  // controller. Normalising the document kind and the identifier BEFORE the player wiring runs
  // means the wiring registers a controller that can actually be found at runtime, instead of a
  // reference that reports "cannot find controller.animation.…" on every load.
  const preWiringReferences = resolveAnimationReferences({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    onLog: (line) => integrityLog(line),
  });
  animationTrace.stage(
    'animationReferenceResolver.resolveAnimationReferences (document kind)',
    `${preWiringReferences.definitions.clips} clip / ${preWiringReferences.definitions.controllers} controller definition(s) indexed by kind, ` +
      `${preWiringReferences.documentsRelocated.length} document kind relocation(s), ${preWiringReferences.identifiersNormalised.length} identifier normalisation(s), ` +
      `${preWiringReferences.aliasRepairs.length} registration(s) rebound, ${preWiringReferences.unresolved.length} unresolved.`,
  );

  const playerWiringEnforcement = enforcePlayerWiring({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    onLog: integrityLog,
  });
  remake.playerWiringEnforcement = playerWiringEnforcement;
  if (remake.parityHealth) remake.parityHealth.playerWiringEnforcement = playerWiringEnforcement;
  animationTrace.stage(
    'playerWiringEnforcer.enforcePlayerWiring',
    `${playerWiringEnforcement.controllersInjected.length} controller hook(s) injected into scripts.animate, ` +
      `${playerWiringEnforcement.clipsRegisteredInjected.length} shipped clip(s) adopted, ` +
      `${playerWiringEnforcement.molangRewritten} Molang string(s) translated for the player context, ` +
      `${playerWiringEnforcement.blocking.length} blocking finding(s).`,
  );
  for (const finding of playerWiringEnforcement.blocking.slice(0, 6)) {
    integrityLog(`[WIRE:ENFORCE:BLOCK] ${finding}`);
  }

  // ── BASELINE PLAYER DEPENDENCY RESOLUTION ────────────────────────────────────────────────────
  // Every reference the player definition makes into the player rig is traced to a definition:
  // a shipped document, the vanilla resource set the engine still provides, a shipped identifier
  // the reference was altered away from, or nothing at all. Generated documents that occupy a
  // vanilla resource path are relocated so the engine definitions the rig references survive, the
  // vanilla baseline wiring (base_pose / look_at_target / first_person_base_pose) is restored when
  // a stage dropped it, and every variable the player-scoped content reads is either declared,
  // rebuilt from item evidence, or reported as an exact limitation. Nothing is replaced with a
  // constant and no placeholder animation is invented.
  const playerDependencyResolution = resolvePlayerDependencies({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    sourceProfiles: remake.playerTriggers?.sourceProfile ? [remake.playerTriggers.sourceProfile] : [],
    onLog: integrityLog,
  });
  remake.playerDependencyResolution = playerDependencyResolution;
  if (remake.parityHealth) remake.parityHealth.playerDependencyResolution = playerDependencyResolution;
  animationTrace.stage(
    'playerDependencyResolver.resolvePlayerDependencies',
    `${playerDependencyResolution.dependenciesExamined} player reference(s) traced (${playerDependencyResolution.shippedDefinition} shipped, ` +
      `${playerDependencyResolution.vanillaEngineDefinition} vanilla engine), ${playerDependencyResolution.identifiersRepaired.length} identifier(s) repaired, ` +
      `${playerDependencyResolution.missingDefinitions.length} unresolved, ${playerDependencyResolution.documentsPreserved.length} vanilla document(s) preserved, ` +
      `${playerDependencyResolution.variables.reconstructed} variable(s) rebuilt and ${playerDependencyResolution.variables.unresolved.length} reported unresolved.`,
  );
  for (const finding of playerDependencyResolution.blocking.slice(0, 8)) {
    integrityLog(`[PLAYER:BASELINE:BLOCK] ${finding}`);
  }

  // ── UNIVERSAL ANIMATION REFERENCE RESOLUTION ──────────────────────────────────────────────────
  // Final authority for the animation graph of the exported pack. Every reference is traced to a
  // definition of the kind it addresses: an `animations` entry that names a controller must be
  // satisfied by a shipped `*.animation_controllers.json` definition, an entry that names a clip by
  // a shipped `*.animation.json` one, and a `scripts.animate` entry by an alias the same entity
  // declares. Definitions filed under the wrong document kind are relocated, altered identifiers are
  // rewritten with every dependent reference, dangling animate entries are removed and named, and
  // every controller an entity registers is activated. A reference is never accepted because its
  // token appears somewhere in the archive.
  const animationReferenceResolution = resolveAnimationReferences({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    onLog: (line) => integrityLog(line),
  });
  animationTrace.stage(
    'animationReferenceResolver.resolveAnimationReferences',
    `${animationReferenceResolution.referencesExamined} registration(s) traced across ${animationReferenceResolution.entitiesAudited} client entity/ies — ` +
      `${animationReferenceResolution.aliasRepairs.length} rebound, ${animationReferenceResolution.animateEntriesRepaired.length} animate entry/ies re-aliased, ` +
      `${animationReferenceResolution.animateEntriesRemoved.length} unresolvable animate entry/ies removed, ` +
      `${animationReferenceResolution.controllerHooksAdded.length} controller hook(s) added, ${animationReferenceResolution.stateAliasesDeclared.length} state alias(es) declared, ` +
      `${animationReferenceResolution.unresolved.length} unresolved.`,
  );
  if (remake.parityHealth) {
    remake.parityHealth.animationReferenceResolution = animationReferenceResolution;
  }

  // Reference integrity runs HERE, after the last repair pass. The schema gate can drop a file or
  // a reference, so auditing before it produced a clean report for a pack that no longer matched
  // it; this is the only reference audit whose numbers are reported.
  // A state the conflict resolver deliberately shadowed stays deactivated, and a script-fired clip
  // must not also be gated by Molang (a one-shot action would play permanently). The same list is
  // handed to the registry below, so a decision the pipeline already justified is never counted as
  // a silent activation gap.
  const deliberatelyDeactivated = [
    ...new Set([
      ...animationStates.conflicts
        .filter((conflict) => conflict.resolution === 'shadowed')
        .map((conflict) => conflict.lower),
      ...scriptDrivenClips,
      ...(remake.playerEntityWiring?.scriptedClips ?? []),
      ...(remake.playerTriggers?.triggers ?? [])
        .filter((trigger) => trigger.status === 'unresolved' && trigger.concept === 'unreferenced-source-definition')
        .map((trigger) => trigger.clipId),
    ]),
  ];
  // ── SCOPE-AWARE MOLANG VARIABLE BINDING ───────────────────────────────────────────────────────
  // A variable is declared inside the script scope that evaluates it, so a flag one document
  // declares is "unknown" in every other document that reads it. The reported armour-layer
  // variables (`helmet_layer_visible` and its siblings) were declared by the source archive's player
  // definition, which a pack override replaces, while the converted clips and controllers kept
  // reading them. Every scope that reads a variable it never declares gets a declaration rebuilt
  // from the documented destination expression — equipment visibility from the armour-slot presence
  // query, never a constant — and anything with no provable equivalent stays reported.
  const scopeBinding = bindMolangVariableScopes({
    resourcePackFiles: remake.resourcePackFiles,
    onLog: (line) => integrityLog(line),
  });
  animationTrace.stage(
    'molangScopeBinder.bindMolangVariableScopes',
    `${scopeBinding.variablesRead} variable name(s) read across ${scopeBinding.documentsScanned} document(s); ` +
      `${scopeBinding.declarationsAdded.length} scope declaration(s) added in ${scopeBinding.filesTouched} document(s), ` +
      `${scopeBinding.unsupported.length} read in a scope with no provable destination equivalent.`,
  );

  // ── UNIVERSAL MOLANG DEPENDENCY GRAPH ─────────────────────────────────────────────────
  // A variable is only ever read by a specific clip, controller state or client entity, and
  // that edge is what the engine's "unknown variable" message is about. This pass records it:
  // every variable name that ships is traced to the definitions that read it and the documents
  // that activate them, each meaning is resolved from destination evidence (armour-slot presence,
  // shipped-item equipment tests, the canonical query catalog) rather than a constant, and the
  // declared value is translated into the context that will evaluate it. Names with no provable
  // destination meaning stay unresolved and name the animations that cannot evaluate.
  // Variables are resolved against TWO archives: the pack that ships and the source archive the
  // conversion started from. A declaration the export dropped (an overridden player definition, an
  // animation document that was replaced during assembly) is still in the source, so it is read
  // back here and re-bound into the scope that evaluates it. Only whole Molang expressions are
  // eligible; a value the source computes in Java is reported, never frozen to a constant.
  const sourceVariableEvidence = collectSourceVariableEvidence(options.entries ?? []);
  integrityLog(`[MOLANG:SOURCE] ${sourceVariableEvidence.summary}`);

  const molangDependencyGraph = buildMolangDependencyGraph({
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    sourceVariables: sourceVariableEvidence,
    onLog: integrityLog,
  });
  remake.molangDependencyGraph = molangDependencyGraph;
  if (remake.parityHealth) remake.parityHealth.molangDependencyGraph = molangDependencyGraph;
  animationTrace.stage(
    'molangDependencyGraph.buildMolangDependencyGraph',
    `${molangDependencyGraph.variablesDiscovered} variable(s) across ${molangDependencyGraph.activatedDefinitions} activated definition(s): ` +
      `${molangDependencyGraph.declaredCount} declared by the archive, ${molangDependencyGraph.reconstructedCount} rebuilt from evidence ` +
      `(${sourceVariableEvidence.withExpression} recovered from the source archive's own expressions, ${sourceVariableEvidence.codeDriven} produced there by code), ` +
      `${molangDependencyGraph.unresolved.length} unresolved; ${molangDependencyGraph.animationsAtRisk.length} animation(s) depend on an unresolved value.`,
  );
  for (const finding of molangDependencyGraph.blocking.slice(0, 6)) {
    integrityLog(`[MOLANG:GRAPH:BLOCK] ${finding}`);
  }

  // Universal Molang compatibility pass on the exact pack that ships. A query the expression's own
  // context cannot evaluate (the reported `query.attack_time` inside the player client entity) is
  // translated into a supported equivalent and every translation is reported; nothing is deleted to
  // make the gate pass. It runs before every auditor, so all of them measure the repaired pack.
  const molangCompatibility = applyMolangCompatibilityRepairs({
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    onLog: integrityLog,
  });
  remake.molangCompatibility = molangCompatibility;
  if (remake.parityHealth) remake.parityHealth.molangCompatibility = molangCompatibility;
  animationTrace.stage(
    'molangCompatibility.applyMolangCompatibilityRepairs',
    `${molangCompatibility.queriesScanned} query reference(s) checked in ${molangCompatibility.filesScanned} document(s); ` +
      `${molangCompatibility.rewritten} expression(s) rewritten (${molangCompatibility.approximations.length} supported proxy, ` +
      `${molangCompatibility.unsupported.length} variable-backed), ${molangCompatibility.unresolved.length} with no destination equivalent.`,
  );

  // ── RENDERING-CONTEXT BINDING AUDIT ──────────────────────────────────────────────────
  // The same clip is evaluated by two rigs: the third-person body and the first-person hands.
  // This pass reads the gate every player binding carries, works out which context it really
  // reaches, and compares that with the context its own identity and bone tracks say it belongs
  // to. A first-person entry with no perspective gate gets the documented gate so the hand pose
  // is not applied to the body; a body pose that can never play in third person is reported
  // instead of rewritten. First-person readiness is only claimed when first_person_base_pose
  // resolves AND carries its gate.
  const renderingContexts = auditRenderingContextBinding({
    resourcePackFiles: remake.resourcePackFiles,
    onLog: integrityLog,
  });
  remake.renderingContexts = renderingContexts;
  if (remake.parityHealth) remake.parityHealth.renderingContexts = renderingContexts;
  animationTrace.stage(
    'renderingContextBinding.auditRenderingContextBinding',
    `${renderingContexts.bindings.length} player binding(s): ${renderingContexts.firstPersonBindings} first-person, ` +
      `${renderingContexts.thirdPersonBindings} third-person, ${renderingContexts.sharedBindings} shared; ` +
      `${renderingContexts.gatesAdded.length} perspective gate(s) added, ${renderingContexts.mismatches.length} mismatch(es); ` +
      `first person ${renderingContexts.firstPerson.ready ? 'verified' : 'NOT verified'}, third person ${renderingContexts.thirdPerson.ready ? 'verified' : 'NOT verified'}.`,
  );
  for (const finding of renderingContexts.blocking.slice(0, 6)) {
    integrityLog(`[RENDER:CONTEXT:BLOCK] ${finding}`);
  }

  let referenceIntegrity = auditReferenceIntegrity({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    deactivatedClips: deliberatelyDeactivated,
    onLog: integrityLog,
  });
  remake.referenceIntegrity = referenceIntegrity;
  if (remake.parityHealth) remake.parityHealth.referenceIntegrity = referenceIntegrity;

  // Late Molang and controller-schema cleanup must precede the shared registry. Otherwise the
  // integration/fidelity/runtime panels describe a pack that is not the one the archive contains.
  const lateMolangRepairs = applyMolangCompatibilityRepairs({
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    onLog: (line) => integrityLog(`[ANIM:MOLANG:LATE] ${line}`),
  });
  if (lateMolangRepairs.rewritten > 0 || lateMolangRepairs.unresolved.length > 0) {
    molangCompatibility.rewritten += lateMolangRepairs.rewritten;
    molangCompatibility.approximations.push(...lateMolangRepairs.approximations);
    molangCompatibility.unsupported.push(...lateMolangRepairs.unsupported);
    molangCompatibility.unresolved.push(...lateMolangRepairs.unresolved);
    molangCompatibility.handSlotRepairs.push(...lateMolangRepairs.handSlotRepairs);
    molangCompatibility.invalidHandSlots.push(...lateMolangRepairs.invalidHandSlots);
    integrityLog(
      `[ANIM:MOLANG:LATE] ${lateMolangRepairs.rewritten} expression(s) retranslated before the final registry (${lateMolangRepairs.approximations.length} supported proxy, ${lateMolangRepairs.unsupported.length} variable-backed, ${lateMolangRepairs.unresolved.length} unresolved, ${lateMolangRepairs.handSlotRepairs.length} slot argument(s) normalised).`,
    );
  }

  // Controller graph repair runs here — after every writer, before the shared registry and every
  // auditor. Two defects are structural, not content: a state nothing can transition into, and a
  // controller no entity both registers and activates. Both are repaired on the exact pack that
  // ships (state pruned / hook added / dead controller dropped) instead of blocking the export,
  // and the reachable transitions the source declared are left untouched.
  const controllerGraphRepair = repairAnimationControllerGraphs(remake.resourcePackFiles);
  if (
    controllerGraphRepair.filesTouched > 0 ||
    controllerGraphRepair.controllersRemoved > 0 ||
    controllerGraphRepair.documentsRemoved > 0
  ) {
    integrityLog(
      `[ANIM:SCHEMA] Controller graph repair: ${controllerGraphRepair.unreachableStatesPruned} unreachable state(s) pruned, ` +
        `${controllerGraphRepair.controllersRemoved} controller definition(s) removed because no client entity registers them, ` +
        `${controllerGraphRepair.activationHooksAdded} scripts.animate hook(s) added, ${controllerGraphRepair.stateAliasesDeclared} state alias(es) declared, ` +
        `${controllerGraphRepair.documentsRemoved} empty document(s) removed. Reachable transition order and conditions are unchanged.`,
    );
    for (const detail of controllerGraphRepair.details.slice(0, 10)) integrityLog(`[ANIM:SCHEMA:REPAIR] ${detail}`);
  }

  const controllerArrays = normalizeEmptyControllerArrays(remake.resourcePackFiles);
  if (controllerArrays.filesTouched > 0) {
    integrityLog(`[ANIM:SCHEMA] Final controller normalization omitted ${controllerArrays.emptyTransitionsOmitted} empty transition array(s) and ${controllerArrays.emptyAnimationsOmitted} empty animation array(s), preserving every non-empty transition.`);
  }

  // Universal animation write-back, dependency reconstruction and fidelity measurement, all on
  // the exact pack that ships. The interpretation IR already knows every clip the archive
  // contains; the writer turns every one of them that no other stage carried into a real Bedrock
  // definition and registers it on the client entity that owns it, the dependency pass records
  // unresolved edges without deleting their source registrations, and the fidelity pass samples the interpreted
  // source curves against the shipped clips so "ported" is a measurement, never a file count.
  // ONE registry, built here from the exact maps that get zipped, and handed to every remaining
  // animation auditor. This is the fix for "127/127 bones resolved" printed next to "116 unresolved
  // bones": each auditor used to re-derive its own population from the same files, so two numbers
  // could describe two different archives. After this line there is one registry and one answer.
  const exportedRegistry = buildAnimationResourceRegistry({
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    scriptDrivenClips: [...new Set([...scriptDrivenClips, ...(remake.playerEntityWiring?.scriptedClips ?? [])])],
    deactivatedClips: deliberatelyDeactivated,
  });
  referenceIntegrity = reconcileReferenceIntegrityMetrics(referenceIntegrity, exportedRegistry);
  remake.referenceIntegrity = referenceIntegrity;
  if (remake.parityHealth) remake.parityHealth.referenceIntegrity = referenceIntegrity;
  animationTrace.stage(
    'referenceIntegrityAuditor.auditReferenceIntegrity',
    `${referenceIntegrity.entitiesAudited} final client entity/ies; ${exportedRegistry.metrics.clipsDefined} unique animation definitions, ` +
      `${exportedRegistry.metrics.clipsRegistered} selectable, ${exportedRegistry.metrics.clipsActivated} with a start path, ` +
      `${exportedRegistry.metrics.bones.resolved}/${exportedRegistry.metrics.bones.checked} final bone bindings resolve; ` +
      `${referenceIntegrity.geometryRefsUnresolved.length + referenceIntegrity.renderControllerRefsUnresolved.length} final geometry/render reference(s) unresolved.`,
  );
  const finalEntityValidation = validateEntityReferences(remake.resourcePackFiles, exportedRegistry);
  integrityLog(
    `[ENTITY:FINAL] ${finalEntityValidation.mobs} final client entity definition(s), ${finalEntityValidation.clipsChecked} animation reference(s), ` +
      `${finalEntityValidation.boneTracksResolved}/${finalEntityValidation.boneTracksChecked} final bone binding(s) resolve; ` +
      `${finalEntityValidation.errorCount} dangling reference(s) UNRESOLVED, ${finalEntityValidation.warningCount} warning(s).`,
  );
  if (remake.parityHealth?.entityEngine) {
    remake.parityHealth.entityEngine = { ...remake.parityHealth.entityEngine, validation: finalEntityValidation };
  }
  if (remake.parityHealth?.fidelityAudit?.entityEngine) {
    remake.parityHealth.fidelityAudit.entityEngine = {
      ...remake.parityHealth.fidelityAudit.entityEngine,
      validation: finalEntityValidation,
    };
  }
  for (const scope of describeRegistryScopes(exportedRegistry.metrics)) {
    integrityLog(`[ANIM:SCOPE] ${scope}`);
  }
  const sourceClipIdByExportedClipId = Object.fromEntries(
    (remake.playerTriggers?.triggers ?? []).map((trigger) => [trigger.clipId, trigger.sourceClipId]),
  );
  const playerTriggerExportedIdBySourceId = new Map(
    (remake.playerTriggers?.triggers ?? []).map((trigger) => [trigger.sourceClipId, trigger.clipId]),
  );
  const deliberatelyDeactivatedSet = new Set(deliberatelyDeactivated);
  const expectedExportedClipIds = [...new Set([
    ...(remake.animationExpectedClips ?? []),
    ...universalAnimationExport.emittedClips,
  ])]
    .map((clipId) => playerTriggerExportedIdBySourceId.get(clipId) ?? clipId)
    .filter((clipId) => !deliberatelyDeactivatedSet.has(clipId));
  const animationFidelity = validateAnimationFidelity({
    ir: remake.universalAnimationIR,
    discovery: remake.universalAnimationDiscovery,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    expectedClips: Object.keys(remake.universalAnimationIR?.clips ?? {}),
    sourceClipIdByExportedClipId,
    sourceClipIdToExportedClipId: remake.playerSourceClipIdToPlayerClipId,
    registry: exportedRegistry,
    skeleton: skeletonReconciliation,
    onLog: integrityLog,
  });
  remake.universalAnimationExport = universalAnimationExport;
  remake.animationFidelity = animationFidelity;
  if (remake.parityHealth) {
    remake.parityHealth.universalAnimationExport = universalAnimationExport;
    remake.parityHealth.animationFidelity = animationFidelity;
  }

  const discoveredClipIds = Object.keys(remake.universalAnimationDiscovery?.animationGraph ?? {});
  const interpretedClipIds = Object.keys(remake.universalAnimationIR?.clips ?? {});
  const layoutSourceClipIds = remake.animationExpectedClips ?? [];
  const sourceClipIds = [...new Set([...discoveredClipIds, ...interpretedClipIds, ...layoutSourceClipIds])];
  // The clip population the layout importers recognised, counted as unique ids so it can be compared
  // with the document scan instead of with a list that may repeat an identifier.
  const discoveredByLayout = new Set(layoutSourceClipIds).size;
  const interpretedClipCount = interpretedClipIds.length;
  const expectedPlayerClipIds = Object.values(remake.universalAnimationIR?.clips ?? {})
    .filter((clip) => clip.targetClassification === 'player')
    .map((clip) => clip.id);
  // Mandatory animation integration validation on the exact pack that ships. Source discovery,
  // final definitions, registrations, activation and playback remain distinct populations.
  const animationIntegration = auditAnimationIntegration({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    expectedClips: expectedExportedClipIds,
    extractedClipCount: Math.max(discoveredByLayout, interpretedClipCount),
    scriptDrivenClips: [...new Set([...scriptDrivenClips, ...(remake.playerEntityWiring?.scriptedClips ?? [])])],
    registry: exportedRegistry,
    states: animationStates,
  });
  for (const issue of animationIntegration.issues.slice(0, 12)) {
    integrityLog(`[ANIM:INTEGRATION:${issue.severity.toUpperCase()}] ${issue.subject} — ${issue.detail}`);
  }
  if (animationIntegration.issues.length > 12) {
    integrityLog(`[ANIM:INTEGRATION] ${animationIntegration.issues.length - 12} further integration finding(s) recorded in the report.`);
  }
  integrityLog(`[ANIM:INTEGRATION:${animationIntegration.passed ? 'PASS' : 'FAIL'}] ${animationIntegration.summary}`);
  remake.animationIntegration = animationIntegration;
  if (remake.parityHealth) remake.parityHealth.animationIntegration = animationIntegration;
  animationTrace.stage(
    'animationFidelityValidator.validateAnimationFidelity + animationIntegrationValidator.auditAnimationIntegration',
    `${animationFidelity.clipsShipped}/${animationFidelity.clipsInterpreted} interpreted clip(s) shipped: curve preservation ${animationFidelity.averageFidelity === null ? 'not measured' : `${animationFidelity.averageFidelity}%`}, ` +
      `bone track coverage ${animationFidelity.boneTrackCoverage}%, skeleton coverage ${animationFidelity.skeletonCoverage}%, pose drift ${animationFidelity.poseRetargetErrorPct}%; ` +
      `integration ${animationIntegration.passed ? 'PASS' : 'FAIL'} — ` +
      `${animationIntegration.stages.extracted} extracted → ${animationIntegration.stages.converted} converted → ` +
      `${animationIntegration.stages.registered} selectable → ${animationIntegration.stages.activated} with paths ` +
      `(${animationIntegration.stages.activatedByAnimate} animate / ${animationIntegration.stages.activatedByController} controller / ${animationIntegration.stages.activatedByScript} script, ${animationIntegration.stages.registeredNoActivation} without a path), ` +
      `${animationIntegration.issues.filter((issue) => issue.severity === 'error').length} error(s).`,
  );

  // Real animation validation pipeline on the exported pack: definitions, bone references,
  // geometry references, controller definitions, entity registrations, identifier resolution,
  // render-controller references, activation conditions, first/third-person wiring, animation
  // conflicts and dependency resolution are each measured and named. Live playback stays 0
  // because nothing here runs inside a Bedrock client.
  // Stage 1 evidence is reconciled before it is measured: the layout importers report what THEY
  // recognised, the document scan reports every clip the archive really contains. The larger number
  // is the truthful source-clip count, so a port can never report "0 discovered → 27 converted".
  if (interpretedClipCount > discoveredByLayout) {
    integrityLog(
      `[ANIM:RECONCILE] The layout importers recognised ${discoveredByLayout} clip(s) while the document scan recovered ${interpretedClipCount}; discovery reports the archive's real clip count (${interpretedClipCount}) so discovery and conversion are measured against the same population. ${sourceClipIds.length} distinct source clip id(s) exist across every evidence source.`,
    );
  }
  const animationRuntime = validateAnimationRuntime({
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    skeleton: skeletonReconciliation,
    states: animationStates,
    references: referenceIntegrity,
    integration: animationIntegration,
    fidelity: animationFidelity,
    extractedClips: Math.max(discoveredByLayout, interpretedClipCount),
    interpretedClips: interpretedClipCount,
    expectedClips: [...(remake.animationExpectedClips ?? []), ...universalAnimationExport.emittedClips],
    registry: exportedRegistry,
    onLog: integrityLog,
  });
  remake.animationRuntime = animationRuntime;
  if (remake.parityHealth) remake.parityHealth.animationRuntime = animationRuntime;
  animationTrace.stage(
    'animationRuntimeValidator.validateAnimationRuntime',
    `${animationRuntime.passed ? 'PASS' : 'FAIL'} — ${animationRuntime.counts.definitions} definition(s), ` +
      `${animationRuntime.counts.clipsRegistered} registered, ${animationRuntime.counts.clipsActivated} activated, ` +
      `${animationRuntime.counts.boneTracksChecked - animationRuntime.counts.boneTracksUnresolved}/${animationRuntime.counts.boneTracksChecked} bone track(s) resolved, ` +
      `${animationRuntime.pipelineStages.filter((stage) => stage.status === 'unresolved').length} pipeline stage(s) unresolved, playback 0 (never claimed).`,
  );
  const finalAnimationDependencies = reconstructAnimationDependencies({
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    registry: exportedRegistry,
    onLog: integrityLog,
  });
  remake.animationDependencies = finalAnimationDependencies;
  if (remake.parityHealth) remake.parityHealth.animationDependencies = finalAnimationDependencies;
  integrityLog(
    `[ANIM:DEPS:FINAL] Final dependency graph: ${finalAnimationDependencies.dependencyGraph.length} registration, activation, controller-state and transition edge(s); ` +
      `${finalAnimationDependencies.unresolvedEntityAnimationRefs.length + finalAnimationDependencies.unresolvedAnimateEntries.length + finalAnimationDependencies.unresolvedControllerAnimationRefs.length} unresolved animation edge(s) remain on the exact pack queued for export.`,
  );

  // ── METRIC LEDGER ─────────────────────────────────────────────────────────────────────────────
  // Every producer above counted something real about a *different* archive: the writer counted its
  // own edits, the auditors counted reference edges, the retarget pass counted renames, the registry
  // counts unique exported ids. Printed side by side they read as contradictions — "27 converted",
  // "9 registered", "15 activated", "27 registered by the pipeline", "127/127 bones resolved",
  // "116 unresolved bones", "0 controllers generated" next to "2 declared". Here each figure is
  // either the registry's number or is labelled as a stage count with the reason it differs, and a
  // disagreement between two final-export figures is listed as a conflict instead of a summary.
  const metricClaims: MetricClaimInput[] = [
    {
      metric: 'definitions',
      producer: 'interpretation IR',
      value: interpretedClipCount,
      scope: 'source-evidence',
      meaning: 'clips the interpretation stage normalised; an interpreted source clip does not have to become a shipped definition',
    },
    {
      metric: 'definitions',
      producer: 'universal animation writer',
      value: universalAnimationExport.emittedClips.length,
      scope: 'pass-local',
      meaning: 'clips this writer wrote as files; clip sets other stages carried and duplicate ids that collapse to one definition are not in this count',
    },
    {
      metric: 'definitions',
      producer: 'integration audit',
      value: animationIntegration.stages.converted,
      scope: 'final-export',
      meaning: 'unique definitions in the exported pack',
    },
    {
      metric: 'selectable',
      producer: 'universal animation writer registration',
      value: universalAnimationExport.registeredClips.length,
      scope: 'pass-local',
      meaning: 'registration edits this writer made; entities it never touched keep the registrations earlier stages gave them',
    },
    {
      metric: 'selectable',
      producer: 'fidelity audit',
      value: animationFidelity.clipsShipped,
      scope: 'source-evidence',
      meaning: 'interpreted source clips that have a shipped definition — a source-side population, not the count of selectable ids',
    },
    {
      metric: 'selectable',
      producer: 'entity reference validator',
      value: finalEntityValidation.clipsChecked,
      scope: 'pass-local',
      meaning: 'animation-map aliases this validator walked, including vanilla names and controller aliases; one clip reached by two aliases counts twice here',
    },
    {
      metric: 'selectable',
      producer: 'integration audit',
      value: animationIntegration.stages.registered,
      scope: 'final-export',
      meaning: 'unique clip ids a client entity can select',
    },
    {
      metric: 'selectable',
      producer: 'runtime pipeline',
      value: animationRuntime.counts.clipsRegistered,
      scope: 'final-export',
      meaning: 'unique clip ids a client entity can select',
    },
    {
      metric: 'selectable',
      producer: 'fidelity audit registration total',
      value: animationFidelity.registeredClips,
      scope: 'final-export',
      meaning: 'unique clip ids a client entity can select',
    },
    {
      metric: 'activationPaths',
      producer: 'player wiring enforcer',
      value: playerWiringEnforcement.clipsRegisteredInjected.length,
      scope: 'pass-local',
      meaning: 'clips this pass adopted into the player entity; a player-only population, so it is always a subset of the whole-pack figure',
    },
    {
      metric: 'activationPaths',
      producer: 'integration audit',
      value: animationIntegration.stages.activated,
      scope: 'final-export',
      meaning: 'unique selectable ids with a runtime start path',
    },
    {
      metric: 'activationPaths',
      producer: 'runtime pipeline',
      value: animationRuntime.counts.clipsActivated,
      scope: 'final-export',
      meaning: 'unique selectable ids with a runtime start path',
    },
    {
      metric: 'animationControllers',
      producer: 'reference integrity repair pass',
      value: referenceIntegrity.animationControllerHooksActivated.length,
      scope: 'pass-local',
      meaning: 'scripts.animate hook entries this pass added — hook edits, not controller definitions',
    },
    {
      metric: 'animationControllers',
      producer: 'player wiring enforcer',
      value: playerWiringEnforcement.controllersInjected.length,
      scope: 'pass-local',
      meaning: 'controller hooks this pass injected into the player entity, not the controller definitions the pack ships',
    },
    {
      metric: 'renderControllers',
      producer: 'reference integrity repair pass',
      value: referenceIntegrity.renderControllersGenerated.length,
      scope: 'pass-local',
      meaning: 'render-controller definitions this repair pass created; zero means the pass created none, not that the pack ships none',
    },
    {
      metric: 'bonesResolved',
      producer: 'skeleton retarget pass',
      value: skeletonReconciliation.bonesRenamed,
      scope: 'pass-local',
      meaning: 'track names this retarget pass changed so they address the destination skeleton — an action count, not a binding total',
    },
    {
      metric: 'bonesChecked',
      producer: 'entity reference validator',
      value: finalEntityValidation.boneTracksChecked,
      scope: 'final-export',
      meaning: 'unique final owner/clip/bone bindings measured',
    },
    {
      metric: 'bonesResolved',
      producer: 'entity reference validator',
      value: finalEntityValidation.boneTracksResolved,
      scope: 'final-export',
      meaning: 'unique final owner/clip/bone bindings that address a bone the owner renders',
    },
    {
      metric: 'bonesUnresolved',
      producer: 'entity reference validator',
      value: finalEntityValidation.boneTracksUnresolved,
      scope: 'final-export',
      meaning: 'unique final bindings no bone of the owner skeleton answers',
    },
    {
      metric: 'bonesUnresolved',
      producer: 'runtime pipeline',
      value: animationRuntime.counts.boneTracksUnresolved,
      scope: 'final-export',
      meaning: 'unique final bindings no bone of the owner skeleton answers',
    },
  ];
  const animationMetricLedger = reconcileAnimationMetrics({
    metrics: exportedRegistry.metrics,
    claims: metricClaims,
    findings: [
      {
        producer: 'integration audit',
        errors: animationIntegration.issues.filter((issue) => issue.severity === 'error').length,
        warnings: animationIntegration.issues.filter((issue) => issue.severity === 'warning').length,
      },
      {
        producer: 'fidelity audit',
        errors: animationFidelity.issues.filter((issue) => issue.severity === 'error').length,
        warnings: animationFidelity.issues.filter((issue) => issue.severity === 'warning').length,
      },
      { producer: 'runtime pipeline', errors: animationRuntime.errors.length, warnings: animationRuntime.warnings.length },
      { producer: 'final reference validation', errors: finalEntityValidation.errorCount, warnings: finalEntityValidation.warningCount },
    ],
  });
  remake.animationMetricLedger = animationMetricLedger;
  if (remake.parityHealth) remake.parityHealth.animationMetricLedger = animationMetricLedger;
  integrityLog(`[ANIM:LEDGER] ${animationMetricLedger.summary}`);
  for (const scope of animationMetricLedger.scopes) integrityLog(`[ANIM:LEDGER:SCOPE] ${scope}`);
  for (const conflict of animationMetricLedger.conflicts) integrityLog(`[ANIM:LEDGER:CONFLICT] ${conflict}`);
  if (!animationMetricLedger.passed) {
    integrityLog(
      `[ANIM:LEDGER:FAIL] ${animationMetricLedger.conflicts.length} final-scope conflict(s) and ${animationMetricLedger.blockingFindings} stage(s) reporting errors — the run is not a unified success claim until each one is resolved. Figures above remain the honest final-pack totals.`,
    );
  }

  // ── FINAL PLAYER WIRING GUARANTEE ─────────────────────────────────────────────────────────────
  // Every pass above is a repair, and a repair that runs before another writer can be undone by it.
  // This is the last structural pass on the archive: it re-reads the player client entity by the
  // identifier it declares, restores any baseline player wiring (base_pose / look_at_target /
  // first_person_base_pose and the root controller) a later stage dropped, re-binds `scripts.animate`
  // entries that address no declared alias, and declares every Molang variable the player-scoped
  // content reads inside the scope that actually evaluates it. It is idempotent: on a pack that is
  // already correct it changes nothing and reports zero repairs.
  const playerBaselineFinal = resolvePlayerDependencies({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    sourceProfiles: remake.playerTriggers?.sourceProfile ? [remake.playerTriggers.sourceProfile] : [],
    onLog: (line) => integrityLog(`[PLAYER:FINAL] ${line}`),
  });
  if (playerBaselineFinal.baselineWiringAdded.length > 0 || playerBaselineFinal.variables.injected.length > 0) {
    integrityLog(
      `[PLAYER:FINAL] The pack a later stage had disturbed is wired again: ${playerBaselineFinal.baselineWiringAdded.length} baseline ` +
        `entry/ies restored, ${playerBaselineFinal.variables.injected.length} variable declaration(s) re-bound in ` +
        `${playerBaselineFinal.playerEntityFile ?? 'the player definition'}, ${playerBaselineFinal.animateEntriesRemoved.length} ` +
        `unresolvable scripts.animate entry/ies removed. ${playerBaselineFinal.missingDefinitions.length} reference(s) still ` +
        'resolve to no definition and are shipped as reported, never replaced by a placeholder.',
    );
  } else {
    integrityLog(
      `[PLAYER:FINAL] Final player wiring verified on the exported pack: ${playerBaselineFinal.dependenciesExamined} reference(s) traced, ` +
        `${playerBaselineFinal.vanillaEngineDefinition} satisfied by the vanilla player resource set, ` +
        `${playerBaselineFinal.variables.referenced} variable(s) read in player scope and every one of them declared there.`,
    );
  }

  // The invariant on top of the repair: every document that ships a `minecraft:player` client
  // entity declares the full engine-provided alias map and activates it, so the definition the
  // engine selects can resolve base_pose / look_at_target / first_person_base_pose regardless of
  // which of the shipped documents it picked.
  const playerBaselineGuard = guaranteePlayerBaselineWiring({
    resourcePackFiles: remake.resourcePackFiles,
    onLog: integrityLog,
  });
  remake.playerBaselineGuard = playerBaselineGuard;
  if (remake.parityHealth) remake.parityHealth.playerBaselineGuard = playerBaselineGuard;

  // The audit point. Every animation verdict above was measured on exactly this file set; anything
  // created, rewritten or removed after it is reported as a stale result instead of a silent pass.
  animationTrace.markAudit(remake.resourcePackFiles, remake.behaviorPackFiles);

  // Fail-loud pre-export validation on the exact pack that is about to be zipped: JSON,
  // duplicate identifiers, dangling references, context-aware Molang, sound paths, item icons
  // and player wiring. Anything that cannot be expressed in Bedrock is listed as NOT PORTED.
  const portValidation = runPortValidation({
    modId: remake.id,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    registry: exportedRegistry,
    expectedPlayerClipIds,
    archivePaths: (options.entries ?? []).map((entry) => entry.path),
    onLog: integrityLog,
  });
  if (remake.parityHealth) remake.parityHealth.portValidation = portValidation;
  if (!portValidation.passed) {
    const blockingIssues = portValidation.issues.filter((issue) => issue.severity === 'error');
    const examples = blockingIssues.slice(0, 10).map((issue) => `${issue.file} ${issue.subject}: ${issue.detail}`).join(' | ');
    // Validation is diagnostic, not an export veto. A partially converted pack is intentionally
    // useful for Bedrock in-game testing: Content Log may expose additional runtime failures that
    // the static validator cannot predict. Preserve every generated file and attach the complete
    // validation report to parityHealth; only archive assembly/encoding failures should prevent a
    // download.
    integrityLog(
      `[EXPORT:PARTIAL] ${portValidation.errors} blocking validation defect(s) and ${portValidation.warnings} warning(s) remain in the final pack. Continuing to assemble the downloadable add-on for in-game testing. ${examples}`,
    );
  } else {
    integrityLog('[EXPORT:VALIDATED] Final structural validation passed; assembling the downloadable add-on.');
  }

  // Phase 10 — conversion documentation: every imported source file is documented with the
  // generated files it actually produced, and every recorded conversion failure stays in the
  // record instead of being dropped from the audit trail.
  const conversionManifest = buildConversionManifest({
    modId: remake.id,
    playableMode: isPlayableModeEnabled(),
    entries: options.entries,
    resourcePackFiles: remake.resourcePackFiles,
    behaviorPackFiles: remake.behaviorPackFiles,
    validation: validation.report,
    hardcodingAudit: remake.parityHealth?.hardcodingAudit,
    onLog: integrityLog,
  });
  for (const line of formatConversionManifestLog(conversionManifest)) integrityLog(line);
  validation.report.conversionManifest = conversionManifest;
  if (remake.parityHealth) {
    remake.parityHealth.validation = validation.report;
    if (remake.parityHealth.fidelityAudit) remake.parityHealth.fidelityAudit.validation = validation.report;
  }

  // ── FRESH-MERGE VERIFICATION ──────────────────────────────────────────────────────────────────
  // The archive is built from these exact maps. Comparing them with the file set the final audits
  // measured is what turns "the new engine exists in the code" into "the new engine produced this
  // archive": a stage that wrote after the audits, or a run that bypassed them, is reported here.
  const pipelineTrace = animationTrace.verify(remake.resourcePackFiles, remake.behaviorPackFiles);
  remake.pipelineTrace = pipelineTrace;
  if (remake.parityHealth) remake.parityHealth.pipelineTrace = pipelineTrace;
  if (!pipelineTrace.fresh) {
    integrityLog(
      `[TRACE:BLOCK] The archive is not the pack the animation audits measured (${pipelineTrace.verdict}); the port cannot be reported as validated until every animation stage runs before the audits that describe it.`,
    );
    if (remake.parityHealth) remake.parityHealth.stageFailed = true;
  }

  const packEntries = (files: Record<string, string | Uint8Array>): ZipEntry[] =>
    Object.entries(files).map(([path, data]) => ({ path, data }));
  // Archive assembly. The size is measured and reported first: a modpack-sized pack is the one
  // place where peak memory cannot be avoided, and a measured number makes that visible instead of
  // surfacing as a frozen or crashed tab.
  await yieldToUi();
  const packBytes =
    Object.values(remake.resourcePackFiles).reduce(
      (sum, content) => sum + (typeof content === 'string' ? content.length * 2 : content.byteLength),
      0,
    ) +
    Object.values(remake.behaviorPackFiles).reduce(
      (sum, content) => sum + (typeof content === 'string' ? content.length * 2 : content.byteLength),
      0,
    );
  const outputBudget = getArchiveBudget();
  if (packBytes > outputBudget.maxGeneratedBytes) {
    throw new Error(`JavaBE safely stopped before building a ${(packBytes / (1024 * 1024)).toFixed(1)} MB add-on in the ${outputBudget.profile} Activity. The generated files exceed this device's ${(outputBudget.maxGeneratedBytes / (1024 * 1024)).toFixed(0)} MB output-memory budget. Nothing was exported or uploaded. Try the same mod on desktop for the larger working budget.`);
  }
  integrityLog(
    `[ZIP] Assembling the archive from ${Object.keys(remake.resourcePackFiles).length + Object.keys(remake.behaviorPackFiles).length} file(s), ${(packBytes / (1024 * 1024)).toFixed(1)} MB of content. The archive is written into a single buffer, so peak memory stays close to the final pack size instead of several copies of it.`,
  );
  const zipProgress = (label: string) => {
    let lastPercent = -25;
    return (hashed: number, total: number) => {
      if (total <= 0) return;
      const percent = Math.floor((hashed / total) * 100);
      if (percent < 100 && percent - lastPercent < 25) return;
      lastPercent = percent;
      integrityLog(
        `[ZIP] ${label}: ${percent}% hashed (${(hashed / (1024 * 1024)).toFixed(1)} / ${(total / (1024 * 1024)).toFixed(1)} MB). Assembly runs in slices with the frame handed back between them, so the page keeps painting on a modpack-sized pack instead of locking up.`,
      );
    };
  };
  const behaviorPack = await createZipArchiveAsync(packEntries(remake.behaviorPackFiles), {
    onProgress: zipProgress('behaviour pack'),
  });
  const resourcePack = await createZipArchiveAsync(packEntries(remake.resourcePackFiles), {
    onProgress: zipProgress('resource pack'),
  });
  const zipBytes = await createZipArchiveAsync(
    [
      { path: `${remake.id}_behavior.mcpack`, data: behaviorPack },
      { path: `${remake.id}_resources.mcpack`, data: resourcePack },
    ],
    { onProgress: zipProgress('add-on bundle') },
  );

  // Phase 9 — regression suite: the fixture mods are converted with the same engines the
  // user just ran and compared against their own source evidence, so a conversion
  // regression is measured on every export instead of being discovered in game.
  try {
    const regression = runRegressionSuite({
      modId: remake.id,
      playableMode: isPlayableModeEnabled(),
      onLog: integrityLog,
    });
    if (remake.parityHealth) {
      remake.parityHealth.regression = regression;
      if (remake.parityHealth.fidelityAudit) remake.parityHealth.fidelityAudit.regression = regression;
    }
  } catch (error) {
    integrityLog(
      `[REGRESSION:ERROR] Regression suite could not run — ${error instanceof Error ? error.message : String(error)}. The ported pack is unaffected.`,
    );
  }

  if (!options.enableGeyser) return { ...remake, zipBytes };

  // Optional Geyser target: mappings are derived only from the item/block definitions and
  // textures that actually shipped, so an entry can never reference content this port did
  // not produce. A failure here never affects the native Bedrock addon.
  try {
    const geyser = buildGeyserCompatibility({
      modId: remake.id,
      name: remake.name,
      description: remake.description,
      targetVersion: options.targetVersion ?? remake.targetVersion ?? '1.21.50',
      geyserVersion: options.geyserVersion?.trim() || DEFAULT_GEYSER_VERSION,
      items: remake.items,
      javaItemIds: remake.decompileStats?.registeredItems ?? [],
      javaBlockIds: remake.decompileStats?.registeredBlocks ?? [],
      resourcePackFiles: remake.resourcePackFiles,
      behaviorPackFiles: remake.behaviorPackFiles,
    });
    for (const line of formatGeyserLog(geyser.report)) integrityLog(line);
    remake.geyser = geyser.report;
    const geyserBundle = createZipArchive(packEntries(geyser.files));
    return {
      ...remake,
      zipBytes,
      geyserBundle: { zipBytes: geyserBundle, fileName: `${remake.id}_geyser_config.zip` },
    };
  } catch (error) {
    integrityLog(
      `[GEYSER:ERROR] Geyser output failed and was skipped — ${error instanceof Error ? error.message : String(error)}. The native Bedrock addon is unaffected.`,
    );
    return { ...remake, zipBytes };
  }
}
