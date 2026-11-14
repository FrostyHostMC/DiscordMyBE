import type { FoliagePipelineReport } from '@/utils/foliageTransparencyPipeline';
import type { UniversalTextureEngineReport } from '@/utils/universalTextureEngine';
import type { GeometryRegistryReport } from '@/utils/geometryRegistry';
import type { ModelPortReport } from '@/utils/modelPortReport';
import type { AtlasReport } from '@/utils/textureAtlasBuilder';
import type { PlayerEntityWiringReport } from '@/utils/playerClientEntity';
import type { PlayerTriggerReport } from '@/utils/playerAnimationTriggers';
import type { PortValidationReport } from '@/utils/packPortValidator';
import type { PbrMaterialReport } from '@/utils/pbrMaterialsBuilder';
import type { PlayerAnimationPortReport } from '@/utils/playerAnimationPipeline';
import type { ModelPortReportInput } from '@/utils/modelPortReport';
import type { UniversalAnimationDiscoveryReport } from '@/utils/universalAnimationDiscovery';
import type { UniversalAnimationIRReport } from '@/utils/universalAnimationIR';
import type { UniversalVariableResolverReport } from '@/utils/universalVariableResolver';
import type { AnimationIntegrationReport } from '@/utils/animationIntegrationValidator';
import type { AnimationFidelityReport } from '@/utils/animationFidelityValidator';
import type { AnimationMetricLedger } from '@/utils/animationMetricReconciliation';
import type { AnimationDependencyReport } from '@/utils/animationDependencyReconstructor';
import type { UniversalAnimationExportReport } from '@/utils/universalAnimationExporter';
import type { SkeletonReconciliationReport } from '@/utils/dynamicBoneRetargeter';
import type { AnimationStateReport } from '@/utils/animationStateResolver';
import type { ReferenceIntegrityReport } from '@/utils/referenceIntegrityAuditor';
import type { AnimationRuntimeReport } from '@/utils/animationRuntimeValidator';
import type { MolangCompatibilityReport } from '@/utils/molangCompatibility';
import type { PlayerWiringEnforcementReport } from '@/utils/playerWiringEnforcer';
import type { PlayerDependencyResolverReport } from '@/utils/playerDependencyResolver';
import type { PlayerBaselineGuardReport } from '@/utils/playerBaselineGuard';
import type { AnimationReferenceResolutionReport } from '@/utils/animationReferenceResolver';
import type { AnimationPipelineTraceReport } from '@/utils/pipelineTrace';
import type { MolangDependencyGraphReport } from '@/utils/molangDependencyGraph';
import type { RenderingContextBindingReport } from '@/utils/renderingContextBinding';

export type ModelPortSnapshot = Omit<ModelPortReportInput, 'mesh'>;

export type Stage = 'input' | 'analyzing' | 'generating' | 'ready';
export type TranslationStatus = 'deterministic' | 'ported' | 'draft';

/**
 * Provenance of every generated file or component.
 * SOURCE   — recovered from the Java mod (models, skins, keyframes, recipes, code).
 * ADAPTED  — converted from mod evidence with some inference.
 * SCAFFOLD — structure the pack needs to load/render (manifests, rigs, atlases).
 * INVENTED — defaults that are not in the mod (template clips, code-drawn skins, fallback recipes).
 * INVENTED content is disabled unless playable mode is enabled.
 */
export type Provenance = 'SOURCE' | 'ADAPTED' | 'SCAFFOLD' | 'INVENTED';
/** Adds ABSENT for a component that shipped nothing at all (counted as unresolved). */
export type ComponentProvenance = Provenance | 'ABSENT';

export interface ProvenanceEntry {
  id: string;
  kind: 'model' | 'texture' | 'ai' | 'animations' | 'spawn' | 'loot' | 'recipe' | 'particle' | 'player-animation';
  target: string;
  provenance: Provenance;
  reason: string;
  /** False when INVENTED content was withheld because playable mode is off. */
  enabled: boolean;
}

export interface ProvenanceReport {
  playableMode: boolean;
  entries: ProvenanceEntry[];
  counts: Record<Provenance, number>;
  /** Components counted as parity: SOURCE + ADAPTED only. */
  parityCount: number;
  /** Components excluded from parity: SCAFFOLD + INVENTED. */
  excludedCount: number;
}

/** Per-stage outcome of the conversion pipeline. A failed stage invalidates its dependents. */
export type StageStatus = 'ok' | 'failed' | 'skipped';

export interface PipelineStageResult {
  id: string;
  label: string;
  status: StageStatus;
  detail: string;
}

/**
 * Outcome of the per-conversion hardcoding audit.
 * removed    — the pattern is genuinely gone from the shipped pack.
 * gated      — the pattern still exists but only as INVENTED content behind playable mode.
 * retained   — intentional product identity, not mod content.
 * unresolved — the pattern (or an unchecked case) is still present and must be fixed.
 */
export type HardcodingFindingStatus = 'removed' | 'gated' | 'retained' | 'unresolved';

export interface HardcodingFinding {
  id: string;
  label: string;
  scope: string;
  previousPattern: string;
  replacedBy: string;
  occurrences: number;
  status: HardcodingFindingStatus;
  evidence: string;
}

export interface HardcodingAuditReport {
  playableMode: boolean;
  findings: HardcodingFinding[];
  removedCount: number;
  gatedCount: number;
  retainedCount: number;
  unresolvedCount: number;
  summary: string;
}

export interface RemakeMechanic {
  name: string;
  summary: string;
  category?: 'storage' | 'combat' | 'recipe' | 'script' | 'ability' | 'world' | 'animation';
  isSupportedInBedrock?: boolean;
  unsupportedReason?: string;
}

export interface ItemBehaviorProfile {
  kind: 'projectile' | 'spell' | 'melee' | 'food' | 'armor' | 'fluid' | 'tool' | 'block' | 'spawn_egg' | 'storage' | 'crafting' | 'unresolved';
  projectileType?: 'minecraft:arrow' | 'minecraft:snowball' | 'minecraft:egg' | 'minecraft:splash_potion';
  spellPatterns?: Array<'area-of-effect' | 'homing-projectile'>;
  confidence: ItemEvidenceSource | 'name-inferred' | 'type-default';
  cooldownTicks: number;
  evidence: string[];
  note: string;
  behaviorComponent?: string;
  sourcePath?: string;
}

/**
 * Semantic role recovered from source evidence only.
 * These are meaning categories, not output templates: a role never implies a component.
 */
export type ItemSemanticRole =
  | 'weapon'
  | 'projectile-launcher'
  | 'ammunition'
  | 'tool'
  | 'armor'
  | 'equipment'
  | 'food'
  | 'spawn-egg'
  | 'block-item'
  | 'storage'
  | 'fluid'
  | 'machine'
  | 'material'
  | 'utility'
  | 'vehicle'
  | 'unresolved';

/** Where a classification came from, strongest first. Nothing below `data-signature` decides a role. */
export type ItemEvidenceSource =
  | 'registry-signature'
  | 'bytecode-signature'
  | 'data-signature'
  | 'asset-signature'
  | 'name-hint'
  | 'unresolved';

/** A capability the source actually declared. Every Bedrock component must trace to one. */
export type ItemCapability =
  | 'melee-strike'
  | 'projectile-launch'
  | 'spell-cast'
  | 'area-of-effect'
  | 'homing-projectile'
  | 'consume'
  | 'wearable'
  | 'fluid-container'
  | 'harvest'
  | 'container'
  | 'summon-entity'
  | 'place-block'
  | 'use-hook';

export interface ItemEvidenceRecord {
  source: ItemEvidenceSource;
  /** Human-readable proof (class, registry string, tag or archive path). */
  detail: string;
  /** 0..1 confidence contribution; only records at or above the decision threshold decide a role. */
  weight: number;
}

/** Per-item classification record kept with the item so every consumer sees the same evidence. */
export interface ItemClassification {
  role: ItemSemanticRole;
  /** Output-facing category used by the Bedrock item template. */
  category: NonNullable<RemakeItem['category']>;
  label: string;
  shape: 'block' | 'bag' | 'tool' | 'flat';
  confidence: ItemEvidenceSource;
  /** Confidence of the deciding evidence (0..1). */
  score: number;
  evidence: ItemEvidenceRecord[];
  capabilities: ItemCapability[];
  /** Cooldown ticks the mod itself declares; 0 when it declares none. */
  cooldownTicks: number;
  slot?: RemakeItem['slot'];
  /** Entity this item spawns, when the role is a spawn egg. */
  entityLink?: string;
  /** Bedrock projectile the source projectile maps to, when one could be recovered. */
  projectileHint?: 'minecraft:arrow' | 'minecraft:snowball' | 'minecraft:egg' | 'minecraft:splash_potion';
  /** True when the role is weak/unknown, so no behaviour may be generated from it. */
  uncertain: boolean;
  /** True when source evidence (not a template) decided the role. */
  behaviourRecovered: boolean;
}

export interface RemakeItem {
  id: string;
  name: string;
  type: string;
  damage?: number;
  durability?: number;
  ability?: string;
  behaviorProfile?: ItemBehaviorProfile;
  category?: 'weapon' | 'tool' | 'armor' | 'storage' | 'food' | 'block' | 'spawn_egg' | 'machine' | 'fluid' | 'item';
  /** Evidence record for the role this item was classified as. */
  classification?: ItemClassification;
  nutrition?: number;
  slot?: 'head' | 'chest' | 'legs' | 'feet' | 'offhand';
  hasOriginalTexture?: boolean;
  hasOriginalModel?: boolean;
}

export interface DependencyResolution {
  javaId: string;
  kind: 'builtin' | 'matched' | 'unresolved';
  bedrockName?: string;
  note: string;
}

export interface DecompileClassSummary {
  className: string;
  /** Fully-qualified class identity; className remains the display-friendly simple name. */
  qualifiedClassName?: string;
  /** Recovered declared fields, including JVM descriptors and access flags. */
  fieldDefinitions?: Array<{ name: string; descriptor: string; access: number; constant?: unknown }>;
  /** Recovered method signatures and local-variable debug metadata. */
  methodSignatures?: Array<{
    name: string; descriptor: string; access: number; codeLength: number;
    localVariables: Array<{ name: string; descriptor: string; index: number; start: number; length: number }>;
  }>;
  /** Fully qualified superclass recovered from the class file, used as inheritance evidence. */
  superName?: string;
  /** Namespaced identifiers (e.g. `mod:rune_blade`) the class itself declares. */
  registryIds?: string[];
  role: 'weapon' | 'combat' | 'entity' | 'animation' | 'utility';
  methods: string[];
  signals?: string[];
}

export interface DecompileStats {
  /** Full instruction-level JVM analysis; present when the asynchronous archive scan ran. */
  jvmAnalysis?: import('@/utils/jvmBytecodeIR').JvmArchiveAnalysisReport;
  modId: string;
  modName: string;
  version: string;
  filesCount: number;
  classesCount: number;
  texturesCount: number;
  modelsCount: number;
  animationsCount?: number;
  detectedAnimations?: string[];
  detectedStateMachines?: string[];
  animationControllers?: string[];
  particlesCount?: number;
  detectedParticles?: string[];
  foundIcon: boolean;
  iconPath?: string;
  iconDataUrl?: string;
  classes: DecompileClassSummary[];
  registeredItems: string[];
  registeredBlocks?: string[];
  registeredEntities?: string[];
  /** Entity display names backed by language/registry declarations, excluding texture-only discoveries. */
  spawnableEntities?: string[];
  mechanics: string[];
  dependencies: string[];
  resolvedDependencies?: DependencyResolution[];
  metadataFormat: string;
}

export interface ParityIssue {
  id: string;
  category: 'texture' | 'geometry' | 'molang' | 'identifier' | 'recipe' | 'entity' | 'script' | 'manifest';
  severity: 'error' | 'warning';
  target: string;
  message: string;
  rootCause: string;
  repaired: boolean;
  repairAction?: string;
  subsystem?: string;
  verifiedAtRuntime?: boolean;
  /** The actual Bedrock requirement this check enforces (never an invented one). */
  bedrockRule?: string;
  /** Provenance of the repair output for this issue. */
  provenance?: ComponentProvenance;
  /** Whether the repair produced content, was skipped, or is still open. */
  resolution?: 'repaired' | 'skipped' | 'unresolved';
}

export interface ParityGapFinding {
  id: string;
  category: 'molang' | 'entity';
  severity: 'high' | 'medium' | 'review';
  title: string;
  target: string;
  expression?: string;
  evidence: string;
  suggestedAction: string;
}

export interface ParityGapAnalysis {
  fidelityScore: number;
  uncoveredPercent: number;
  inspectedEntities: number;
  inspectedMolangExpressions: number;
  findings: ParityGapFinding[];
}

export interface CategoryCounts {
  /** SOURCE components only. */
  ported: number;
  /** ADAPTED components only. */
  approximated: number;
  /** SCAFFOLD components (pack-required structure). */
  fallback: number;
  /** Components present in the mod with nothing generated for them. */
  unresolved: number;
  /** INVENTED defaults — excluded from parity counts. */
  invented?: number;
  /** True when a dependent stage failed, so the real count is unknown (not zero). */
  failed?: boolean;
}

export interface PerMobAuditItem {
  mobId: string;
  name: string;
  /** Per-component provenance — the only source of the parity counts. */
  provenance: Record<'model' | 'texture' | 'ai' | 'animations' | 'spawn' | 'loot', ComponentProvenance>;
  /** SOURCE + ADAPTED components on this mob. */
  parityComponents: number;
  /** SCAFFOLD + INVENTED components on this mob (never parity). */
  excludedComponents: number;
  model: 'ported' | 'approximated' | 'fallback';
  modelSource?: string;
  texture: 'ported' | 'approximated' | 'fallback';
  textureSource?: string;
  ai: 'ported' | 'approximated' | 'fallback';
  aiNote?: string;
  animations: 'ported' | 'approximated' | 'fallback';
  animCount?: number;
  spawn: 'ported' | 'approximated' | 'fallback';
  loot: 'ported' | 'approximated' | 'fallback';
  status: 'ported' | 'approximated' | 'fallback';
}

export interface GranularFidelityAudit {
  blocks: CategoryCounts;
  items: CategoryCounts;
  mobs: CategoryCounts;
  textures: CategoryCounts;
  animations: CategoryCounts;
  recipes: CategoryCounts;
  /** Per-component mob breakdown (model, texture, AI, animations, spawn, loot). */
  mobComponents?: Record<'model' | 'texture' | 'ai' | 'animations' | 'spawn' | 'loot', CategoryCounts>;
  totals: CategoryCounts;
}

export interface FidelityAudit {
  textures: {
    total: number;
    originalRecovered: number;
    contextualSynthesized: number;
    missing: number;
    originalList: string[];
    synthesizedList: string[];
  };
  models: {
    total: number;
    recoveredFromJava: number;
    geckolibImported: number;
    riggedAnatomyMobs: number;
    flat2DSprites: number;
    approximateFallback: number;
  };
  recipes: {
    total: number;
    convertedFromMod: number;
    contextualFallback: number;
    unresolvedIngredients: string[];
  };
  entities: {
    totalMobs: number;
    mobsWithRiggedGeo: number;
    mobsWithTextures: number;
    mobsWithControllers: number;
    mobNames: string[];
  };
  gameplay: {
    supportedBedrock: string[];
    unsupportedJavaEngine: Array<{ name: string; reason: string }>;
  };
  runtimeVerification: {
    simulatedChecksPassed: number;
    simulatedChecksTotal: number;
    inGameTested: boolean;
    inGameTestNote: string;
  };
  truthfulParityScore: number;
  structuralPassRate: number;
  molangTranslator?: {
    translatedExpressions: number;
    customParticlesPorted: number;
    biomeLightingAnimations: number;
    particleNames: string[];
  };
  parityGapAnalysis?: ParityGapAnalysis;
  motionSmoothing?: MotionSmoothingSuiteResult;
  granularCounts?: GranularFidelityAudit;
  perMobAudit?: PerMobAuditItem[];
  provenanceReport?: ProvenanceReport;
  hardcodingAudit?: HardcodingAuditReport;
  stageResults?: PipelineStageResult[];
  /** Anomalies that no bounded repair pass could clear — never reported as passed. */
  unresolvedAnomalyCount?: number;
  /** Universal Texture Engine findings (decoding, animation timing, repairs). */
  textureEngine?: UniversalTextureEngineReport;
  /** Entity & Animation Engine findings (render controllers, variants, attachables). */
  entityEngine?: EntityAnimationEngineReport;
  /** Behaviour Translation Engine findings (AI, combat, loot, trades, timers, unsupported). */
  behaviorTranslation?: BehaviorTranslationReport;
  /** Phase 8 asset validation & repair report. */
  validation?: AssetValidationReport;
  /** Phase 9 regression suite results. */
  regression?: RegressionSuiteReport;
  /** Phase 11 — universal source discovery (loaders, documents, declared references). */
  sourceDiscovery?: SourceDiscoveryReport;
  /** Phase 11 — engine-neutral intermediate representation built from source evidence. */
  sourceIR?: UniversalIRReport;
  /** Model, skeleton and animation porting outcome (formats, bones, retargeted tracks). */
  modelPort?: ModelPortReport;
}

export type TrackChannel = 'rotation' | 'position' | 'scale';

export interface TrajectoryPoint {
  t: number;
  x: number;
  y: number;
  z: number;
}

export interface TrackSmoothingReport {
  boneName: string;
  channel: TrackChannel;
  originalKeyframeCount: number;
  smoothedKeyframeCount: number;
  jitterReductionPercent: number;
  status: 'smoothed' | 'preserved' | 'unsupported';
  reason?: string;
  originalSamplePoints?: TrajectoryPoint[];
  smoothedSamplePoints?: TrajectoryPoint[];
}

export interface AnimationSmoothingResult {
  animationId: string;
  totalTracksAnalyzed: number;
  tracksSmoothed: number;
  tracksPreserved: number;
  averageJitterReduction: number;
  trackReports: TrackSmoothingReport[];
}

export interface MotionSmoothingSuiteResult {
  totalAnimationsSmoothed: number;
  totalTracksSmoothed: number;
  totalTracksPreserved?: number;
  overallJitterReduction: number;
  reports: AnimationSmoothingResult[];
  processedFiles: string[];
}

/** A packed texture or geometry variant registered on a client entity. */
export interface EntityVariantSummary {
  key: string;
  path: string;
  label: string;
}

/** A client entity reference that does not resolve against the shipped pack. */
export interface EntityReferenceIssue {
  mobId: string;
  kind: 'geometry' | 'texture' | 'material' | 'render_controller' | 'animation' | 'controller' | 'bone';
  subject: string;
  detail: string;
  severity: 'error' | 'warning';
}

/** Outcome of validating every shipped client entity definition against the pack. */
export interface EntityReferenceReport {
  mobs: number;
  clipsChecked: number;
  boneTracksChecked: number;
  boneTracksResolved: number;
  boneTracksUnresolved: number;
  issues: EntityReferenceIssue[];
  errorCount: number;
  warningCount: number;
}

/** Entity & Animation Engine output: render controllers, variants, materials, attachables. */
export interface EntityAnimationEngineReport {
  mobs: number;
  renderControllersGenerated: number;
  textureVariantsRegistered: number;
  geometryVariantsRegistered: number;
  materials: Record<string, number>;
  attachablesGenerated: number;
  armorSheetsShipped: number;
  skipped: string[];
  validation?: EntityReferenceReport;
}

/** Behaviour domains the translation engine reconstructs from Java evidence. */
export type BehaviorDomain =
  | 'entity-ai'
  | 'movement'
  | 'combat'
  | 'health-attributes'
  | 'entity-events'
  | 'block-interaction'
  | 'item-interaction'
  | 'custom-items'
  | 'custom-blocks'
  | 'recipes'
  | 'loot-tables'
  | 'villager-trades'
  | 'spawning'
  | 'projectiles'
  | 'effects'
  | 'particles'
  | 'sounds'
  | 'equipment'
  | 'timers-cooldowns'
  | 'inventory'
  | 'worldgen';

/**
 * ported      — reproduced from mod evidence (bytecode, data file, model).
 * approximated — evidence-based conversion with inference.
 * fallback     — generic structure/default shipped instead of mod behaviour.
 * unresolved   — present in the mod with nothing generated.
 * unsupported  — Java mechanism with no honest Bedrock counterpart.
 */
export type BehaviorTranslationStatus =
  | 'ported'
  | 'approximated'
  | 'fallback'
  | 'unresolved'
  | 'unsupported';

export interface BehaviorTranslationFinding {
  id: string;
  domain: BehaviorDomain;
  target: string;
  status: BehaviorTranslationStatus;
  provenance: ComponentProvenance;
  /** Source paths / bytecode signatures the mapping was derived from. */
  javaEvidence: string[];
  /** Bedrock components or files that were actually emitted. */
  bedrockOutput: string[];
  /** Pack files that really exist behind this mapping, resolved against the shipped pack. */
  outputFiles: string[];
  /** True only when at least one shipped file resolves for this mapping. */
  verified: boolean;
  note: string;
}

export interface UnsupportedMechanic {
  id: string;
  domain: BehaviorDomain;
  target: string;
  reason: string;
  sourceEvidence: string;
  alternative: string;
}

/** Java world-generation document kinds recognised from the archive's own layout. */
export type WorldgenSourceKind =
  | 'configured-feature'
  | 'placed-feature'
  | 'biome'
  | 'structure'
  | 'template-pool'
  | 'processor-list'
  | 'noise-settings'
  | 'carver'
  | 'dimension'
  | 'other';

/**
 * converted    — a Bedrock file was generated from the source document.
 * approximated — generated, but a Java concept had to be expressed differently.
 * unresolved   — a Bedrock file should exist but nothing could be written.
 * unsupported  — the definition has no data-driven Bedrock counterpart at all.
 */
export type WorldgenOutcomeStatus = 'converted' | 'approximated' | 'unresolved' | 'unsupported';

export interface WorldgenDefinitionOutcome {
  sourcePath: string;
  kind: WorldgenSourceKind;
  status: WorldgenOutcomeStatus;
  provenance: ComponentProvenance;
  /** Bedrock files this definition really produced. */
  outputs: string[];
  reason: string;
}

/** Per-definition outcome of the world-generation compatibility stage. */
export interface WorldgenPortReport {
  definitions: WorldgenDefinitionOutcome[];
  filesWritten: string[];
  converted: number;
  approximated: number;
  unsupported: number;
  unresolved: number;
  biomeDefinitions: number;
  summary: string;
}

export interface BehaviorTranslationReport {
  playableMode: boolean;
  entitiesAnalyzed: number;
  itemsAnalyzed: number;
  findings: BehaviorTranslationFinding[];
  unsupported: UnsupportedMechanic[];
  domainCounts: Partial<Record<BehaviorDomain, CategoryCounts>>;
  totals: CategoryCounts;
  /** Behavior-pack files written by this stage. */
  filesWritten: string[];
  /** Count of behaviour files that really carry generated output. */
  emittedFileCount: number;
  /** Mappings downgraded because no shipped file backed the claim. */
  unverifiedClaims: number;
  /** True when an upstream stage failed, so success claims are blocked. */
  stageFailed: boolean;
  /** Independently parsed world-generation compatibility outcome. */
  worldgen: WorldgenPortReport;
  summary: string;
}

export interface ParityHealth {
  score: number; // Truthful parity score (0 to 100)
  totalChecks: number;
  passedChecks: number;
  repairedCount: number;
  issues: ParityIssue[];
  verifiedSystems: {
    textures: boolean;
    geometry: boolean;
    molang: boolean;
    recipes: boolean;
    scriptApi: boolean;
    entityAi: boolean;
    manifests: boolean;
    particles?: boolean;
    biomeLighting?: boolean;
  };
  selfHealingActive: boolean;
  regressionGuardPassed: boolean;
  loopPassCount: number;
  runtimeEnvironment?: 'simulated-sandbox' | 'live-bedrock-engine';
  repairedCategories?: Record<string, number>;
  regressionRulesPassed?: number;
  regressionRulesTotal?: number;
  untestedFeatures?: string[];
  verifiedFeatures?: string[];
  fidelityAudit?: FidelityAudit;
  granularCounts?: GranularFidelityAudit;
  perMobAudit?: PerMobAuditItem[];
  /** Anomalies still open after the bounded repair loop finished. */
  unresolvedAnomalyCount?: number;
  /** True when any pipeline stage failed, so counts must be shown as FAILED. */
  stageFailed?: boolean;
  /** Universal Texture Engine findings (decoding, animation timing, repairs). */
  textureEngine?: UniversalTextureEngineReport;
  /** Foliage cutout repairs and evidence-based vertex-offset motion findings. */
  foliagePipeline?: FoliagePipelineReport;
  /** Entity & Animation Engine findings and reference validation results. */
  entityEngine?: EntityAnimationEngineReport;
  /** Behaviour Translation Engine findings. */
  behaviorTranslation?: BehaviorTranslationReport;
  /** Phase 8 asset validation & repair report. */
  validation?: AssetValidationReport;
  /** Phase 9 regression suite results. */
  regression?: RegressionSuiteReport;
  /** Canonical geometry identifier registry outcome (identifiers, aliases, repairs). */
  geometryRegistry?: GeometryRegistryReport;
  /** Texture atlas isolation outcome (phantom entries, label stripping, entity skins). */
  textureAtlas?: AtlasReport;
  /** Bedrock client-schema gate outcome (before/after defect report). */
  schemaGate?: BedrockSchemaGateReport;
  /** Phase 11 — universal source discovery (loaders, documents, declared references). */
  sourceDiscovery?: SourceDiscoveryReport;
  /** Phase 11 — engine-neutral intermediate representation built from source evidence. */
  sourceIR?: UniversalIRReport;
  /** Final post-processing pass on the exported pack (sound paths, item icons, Molang, manifests). */
  postProcess?: PostProcessReport;
  /** PBR / Deferred-material synthesis outcome (channel maps, texture sets, manifest capability). */
  pbrMaterials?: PbrMaterialReport;
  /** Player client entity wiring: a port with player clips but no entity file is a failed port. */
  playerEntityWiring?: PlayerEntityWiringReport | null;
  /** Java trigger -> Bedrock condition translation for the imported player clip set. */
  playerTriggers?: PlayerTriggerReport | null;
  /** Automated player animation port: rig evidence, perspective scope, bone injection, dual-wield. */
  playerAnimationPort?: PlayerAnimationPortReport | null;
  /** Fail-loud pre-export validation of the exact pack that ships. */
  portValidation?: PortValidationReport;
  /** Model, skeleton and animation porting outcome (formats, bones, retargeted tracks). */
  modelPort?: ModelPortReport;
  /** Phase 12 — Universal Animation Discovery Engine report. */
  universalAnimationDiscovery?: UniversalAnimationDiscoveryReport;
  /** Phase 12 — Universal Animation Interpretation Engine (Intermediate Representation). */
  universalAnimationIR?: UniversalAnimationIRReport;
  /** Phase 12 — Universal Variable Resolver report. */
  universalVariables?: UniversalVariableResolverReport;
  /** Mandatory animation integration audit: registration, activation and bone resolution. */
  animationIntegration?: AnimationIntegrationReport;
  /** Metric ledger: every population each stage reports, reconciled against the exported registry. */
  animationMetricLedger?: AnimationMetricLedger;
  /** Clips the universal animation writer emitted from the interpretation IR. */
  universalAnimationExport?: UniversalAnimationExportReport;
  /** Sampled curve fidelity of every interpreted source clip against the shipped pack. */
  animationFidelity?: AnimationFidelityReport;
  /** Post-generation dependency reconstruction (references that resolved to nothing). */
  animationDependencies?: AnimationDependencyReport;
  /** Dynamic bone retargeting: clip tracks rebound onto the skeleton each entity renders. */
  skeletonReconciliation?: SkeletonReconciliationReport;
  /** Animation state analysis: duplicate playback and overlapping pose conflicts resolved. */
  animationStates?: AnimationStateReport;
  /** Reference integrity audit: geometry, render-controller, controller and entity edges. */
  referenceIntegrity?: ReferenceIntegrityReport;
  /** Real validation pipeline: every animation check measured on the exported pack. */
  animationRuntime?: AnimationRuntimeReport;
  /** Proof that the current animation engine produced this run and that no writer ran after the audits. */
  pipelineTrace?: AnimationPipelineTraceReport;
  /** Molang query-context audit: what was translated, what stayed unsupported. */
  molangCompatibility?: MolangCompatibilityReport;
  /** Molang dependency graph: which animations read which variable, and what stayed unresolved. */
  molangDependencyGraph?: MolangDependencyGraphReport;
  /** First-person / third-person perspective binding verification for the exported player. */
  renderingContexts?: RenderingContextBindingReport;
  /** Active player wiring enforcement: controllers actually hooked into the exported entity. */
  playerWiringEnforcement?: PlayerWiringEnforcementReport;
  /** Baseline player dependency resolution: every player reference traced to a definition or reported. */
  playerDependencyResolution?: PlayerDependencyResolverReport;
  /** Final invariant pass over every shipped `minecraft:player` document (baseline alias wiring). */
  playerBaselineGuard?: PlayerBaselineGuardReport;
  /** Kind-aware animation reference resolution: aliases, controllers and registrations traced. */
  animationReferenceResolution?: AnimationReferenceResolutionReport;
}

/** Outcome of the reusable export post-processing pass (see utils/bedrockPostProcess.ts). */
export interface PostProcessReport {
  soundEntriesFixed: number;
  soundDefinitionsDropped: number;
  iconsFixed: number;
  molangExpressionsRepaired: number;
  molangFilesTouched: string[];
  manifestsAdjusted: number;
  /** Learned deny-queries in force during the pass (from pasted content logs). */
  learnedQueriesApplied: string[];
  /** Script-module version repairs applied from learned content-log data. */
  moduleFixesApplied: string[];
  /** Script modules imported by shipped scripts but missing from the manifest (now declared). */
  modulesDeclared: string[];
  /** Declared-but-unused optional script modules removed from the manifest. */
  modulesRemoved: string[];
  /** Identical duplicate animation/controller ids collapsed across files. */
  duplicateIdsRemoved: number;
  /** Controller states that reference an animation the pack does not define. */
  danglingAnimationRefs: string[];
  /** Packs that ship animations no client entity file registers. */
  wiringWarnings: string[];
  /** textures/item_texture.json entries pointing at texture files the pack does not ship. */
  missingAtlasTextures: string[];
  /** Item icons referencing a shortname the atlas never registers. */
  unregisteredItemIcons: string[];
  /** Geometry shipped but referenced by no client entity or attachable. */
  unusedGeometry: string[];
  /** Geometry texture_width/height conflicting with the shipped texture size (UV breakage). */
  uvMismatchWarnings: string[];
  /** Behavior entities with no client entity counterpart (invisible models). */
  missingClientEntities: string[];
  /** Client entities with no matching behavior entity. */
  orphanClientEntities: string[];
  /** Spawnable mobs whose client entity defines no spawn_egg. */
  missingSpawnEggs: string[];
  /** Both textures/item and textures/items shipped — Bedrock only reads textures/items. */
  duplicateTextureFolders: string[];
  /** Legacy textures/item files automatically migrated to textures/items. */
  textureFolderMigrations: string[];
  /** References rewritten from textures/item/… to textures/items/… (atlas + JSON). */
  textureReferencesUpdated: number;
  /** Migrations blocked because a different file already occupies the destination path. */
  textureFolderConflicts: string[];
  /** Armor layer sheets shipped under textures/models/armor/. */
  armorSheetsShipped: string[];
  /** Attachable definitions verified as correctly bound to an armor layer sheet. */
  armorAttachablesBound: number;
  /** Armor attachable/texture binding defects: missing textures, bad geometry, invalid layer names. */
  armorAttachableIssues: string[];
  /** Armor sheets referenced by no attachable or client entity (never render). */
  orphanArmorSheets: string[];
}

export interface BedrockRemake {
  name: string;
  id: string;
  description: string;
  sourceFileName: string | null;
  mechanics: RemakeMechanic[];
  items: RemakeItem[];
  behaviorPackFiles: Record<string, string | Uint8Array>;
  resourcePackFiles: Record<string, string | Uint8Array>;
  fileName: string;
  translationStatus: TranslationStatus;
  packIconDataUrl?: string;
  decompileStats?: DecompileStats;
  /** Temporary evidence snapshot consumed by the final model/animation audit. */
  modelPortSnapshot?: ModelPortSnapshot;
  animationsPortedCount?: number;
  animationControllersCount?: number;
  particlesPortedCount?: number;
  lightingAnimationsCount?: number;
  parityHealth?: ParityHealth;
  motionSmoothing?: MotionSmoothingSuiteResult;
  targetVersion?: string;
  experimentFeaturesActive?: string[];
  /** Optional Geyser compatibility output. Native Bedrock packs remain the primary product. */
  geyser?: GeyserCompatibilityReport;
  /** Engine-neutral analysis record the Bedrock writers consumed (never a conversion claim). */
  sourceIR?: UniversalIRReport;
  /** Player client entity wiring outcome: a port with player clips and no entity file fails. */
  playerEntityWiring?: PlayerEntityWiringReport | null;
  /** Java trigger to Bedrock condition translation outcome for the imported player clips. */
  playerTriggers?: PlayerTriggerReport | null;
  /** Automated player animation port: rig evidence, perspective scope, bone injection, dual-wield. */
  playerAnimationPort?: PlayerAnimationPortReport | null;
  /** Files produced by the wiring stage, merged into the pack after the schema gate. */
  playerWiringFiles?: Record<string, string>;
  /** Behaviour-pack activation script for clips whose Java trigger is one-shot logic. */
  playerScriptCode?: string;
  /** Original player source clips already represented by retargeted bridge clips. */
  playerSourceClipIds?: string[];
  /** Canonical source animation id -> final retargeted player animation id. */
  playerSourceClipIdToPlayerClipId?: Record<string, string>;
  /** Clip ids the animation stage intended to make playable (checked by the integration audit). */
  animationExpectedClips?: string[];
  /** Mandatory animation integration audit performed on the exported pack. */
  animationIntegration?: AnimationIntegrationReport;
  /** Metric ledger: the final-pack figure for each population, plus every stage count it supersedes. */
  animationMetricLedger?: AnimationMetricLedger;
  /** Universal Animation Discovery Engine report. */
  universalAnimationDiscovery?: UniversalAnimationDiscoveryReport;
  /** Universal Animation Interpretation Engine (Intermediate Representation). */
  universalAnimationIR?: UniversalAnimationIRReport;
  /** Universal Variable Resolver report. */
  universalVariables?: UniversalVariableResolverReport;
  /** Clips the universal animation writer emitted from the interpretation IR. */
  universalAnimationExport?: UniversalAnimationExportReport;
  /** Sampled curve fidelity of every interpreted source clip against the shipped pack. */
  animationFidelity?: AnimationFidelityReport;
  /** Post-generation dependency reconstruction outcome for the shipped pack. */
  animationDependencies?: AnimationDependencyReport;
  /** Dynamic bone retargeting outcome for every rendered client entity. */
  skeletonReconciliation?: SkeletonReconciliationReport;
  /** Animation state analysis outcome (guarded, blended and shadowed states). */
  animationStates?: AnimationStateReport;
  /** Geometry / render-controller / controller reference audit outcome. */
  referenceIntegrity?: ReferenceIntegrityReport;
  /** Real animation validation pipeline outcome for the exported pack. */
  animationRuntime?: AnimationRuntimeReport;
  /** Engine execution trace: which animation stages ran in this conversion, and export freshness. */
  pipelineTrace?: AnimationPipelineTraceReport;
  /** Molang query-context audit outcome for the exported pack. */
  molangCompatibility?: MolangCompatibilityReport;
  /** Molang dependency graph outcome: variable -> animation edges and unresolved values. */
  molangDependencyGraph?: MolangDependencyGraphReport;
  /** Rendering-context binding outcome for the exported player definition. */
  renderingContexts?: RenderingContextBindingReport;
  /** Active player wiring enforcement outcome for the exported pack. */
  playerWiringEnforcement?: PlayerWiringEnforcementReport;
  /** Baseline player dependency resolution outcome for the exported pack. */
  playerDependencyResolution?: PlayerDependencyResolverReport;
  /** Final baseline-wiring invariant over every shipped `minecraft:player` document. */
  playerBaselineGuard?: PlayerBaselineGuardReport;
  /** Kind-aware animation reference resolution outcome for the exported pack. */
  animationReferenceResolution?: AnimationReferenceResolutionReport;
}

/**
 * Outcome of one Geyser custom mapping.
 * generated   — the Java identifier and the Bedrock counterpart both resolved.
 * approximated — the mapping is derived from the ported Bedrock id or a substituted geometry.
 * unsupported  — withheld because a required part (texture/geometry) did not ship.
 * unknown-compatibility — the bundled snapshot does not list the capability for this Geyser build.
 */
export type GeyserMappingStatus = 'generated' | 'approximated' | 'unsupported' | 'unknown-compatibility';

/** Capabilities the bundled snapshot lists for a Geyser build. */
export interface GeyserFeatureSupport {
  customItems: boolean;
  customBlocks: boolean;
  customSkulls: boolean;
  customModelData: boolean;
  extensionDescriptors: boolean;
  customMappingsFormatVersion: number;
}

/** Version-aware Geyser compatibility definition resolved from the bundled snapshot. */
export interface GeyserVersionProfile {
  geyserVersion: string;
  bedrockTarget: string;
  /** Bedrock build the snapshot was captured against (never re-verified at runtime). */
  verifiedBedrockTarget: string;
  javaTarget: string;
  source: 'bundled-snapshot' | 'unknown';
  supports: GeyserFeatureSupport;
  notes: string[];
}

export interface GeyserItemMapping {
  /** Java item identifier used as the mapping key (evidence, or derived when not recovered). */
  javaIdentifier: string;
  /** `geyser_custom:` identifier the Geyser build must register. */
  bedrockIdentifier: string;
  name: string;
  stackSize: number;
  creativeCategory: string;
  textureShortName: string;
  /** Path of the texture inside the generated Bedrock resource pack. */
  sourceTexture: string;
  status: GeyserMappingStatus;
  provenance: ComponentProvenance;
  evidence: string[];
  note: string;
}

export interface GeyserBlockMapping {
  javaIdentifier: string;
  bedrockIdentifier: string;
  name: string;
  hardness: number;
  blastResistance: number;
  geometryIdentifier: string;
  /** Shipped geometry file copied into the Geyser pack, when one was resolved. */
  geometrySource?: string;
  textureShortName: string;
  sourceTexture: string;
  renderMethod: string;
  stateCount: number;
  status: GeyserMappingStatus;
  provenance: ComponentProvenance;
  evidence: string[];
  note: string;
}

export interface GeyserRequirement {
  id: string;
  label: string;
  state: 'satisfied' | 'unmet' | 'unknown';
  detail: string;
}

export interface GeyserBundleFile {
  path: string;
  role: 'item-mapping' | 'block-mapping' | 'extension' | 'config' | 'resource-pack' | 'readme';
  description: string;
  bytes: number;
}

/** Additional (optional) Geyser output target — never a replacement for the Bedrock pack. */
export interface GeyserCompatibilityReport {
  enabled: boolean;
  profile: GeyserVersionProfile;
  items: GeyserItemMapping[];
  blocks: GeyserBlockMapping[];
  requirements: GeyserRequirement[];
  files: GeyserBundleFile[];
  warnings: string[];
  totals: {
    itemMappings: number;
    blockMappings: number;
    approximated: number;
    unsupported: number;
    unknownCompatibility: number;
  };
  summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8 — Asset validation & repair
// ─────────────────────────────────────────────────────────────────────────────

/** The fourteen asset check families every generated file is measured against. */
export type ValidationCheckId =
  | 'json'
  | 'reference'
  | 'identifier'
  | 'format-version'
  | 'geometry'
  | 'uv'
  | 'texture'
  | 'animation'
  | 'render-controller'
  | 'material'
  | 'behavior'
  | 'script'
  | 'dependency'
  | 'schema'
  | 'unsupported';

export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * repaired    — the defect was fixed by a recorded structural repair.
 * unresolved  — the defect is still in the pack; it is reported, never dropped.
 * unsupported — Java functionality with no honest Bedrock counterpart.
 */
export type ValidationResolution = 'repaired' | 'unresolved' | 'unsupported';

export interface ValidationFinding {
  id: string;
  check: ValidationCheckId;
  severity: ValidationSeverity;
  /** Pack the finding belongs to. */
  role: 'RP' | 'BP';
  file: string;
  subject: string;
  detail: string;
  /** The actual Bedrock requirement this check enforces. */
  bedrockRule: string;
  resolution: ValidationResolution;
  repair?: {
    action: string;
    provenance: ComponentProvenance;
    detail: string;
  };
  /** True when the finding came from a conversion that produced a broken asset. */
  conversionFailure?: boolean;
  /** True when a safe automatic repair exists for this still-open finding. */
  repairAvailable?: boolean;
}

export interface ValidationCheckSummary {
  check: ValidationCheckId;
  label: string;
  checked: number;
  clean: number;
  repaired: number;
  unresolved: number;
  unsupported: number;
}

export interface ValidationRepairPass {
  pass: number;
  before: number;
  after: number;
  applied: number;
  stopped: boolean;
  note: string;
}

/**
 * One root cause behind many individual findings. A systemic defect is repeated by a single
 * generator path, so repairing instances one by one hides the real defect.
 */
export interface RootCauseGroup {
  /** Signature shared by every instance of this defect. */
  id: string;
  check: ValidationCheckId;
  severity: ValidationSeverity;
  title: string;
  /** What produced every instance in this group. */
  rootCause: string;
  /** How many individual findings collapse into this root cause (never capped). */
  count: number;
  fileCount: number;
  /** First few affected paths, for navigation. */
  files: string[];
  /** True when the defect repeats across files, so one generator fix clears it. */
  systemic: boolean;
  conversionFailures: number;
  /** Instances that carried a safe automatic repair. */
  repairable: number;
  /** Instances skipped because the per-root-cause repair budget was spent. */
  deferred: number;
  /** count x rule weight x severity x spread; higher means fix this first. */
  impactScore: number;
  recommendation: string;
}

/** Mandatory Bedrock manifest/pack schema validation outcome for the exported addon. */
export interface PackSchemaReport {
  manifestsChecked: number;
  /** Manifest schema requirements inspected (format, header, modules, dependencies...). */
  requirements: number;
  /** Open schema defects at the end of the run. */
  defects: number;
  /** True only when no schema requirement failed. */
  passed: boolean;
  resourceModules: number;
  behaviorModules: number;
  dependencies: number;
  scriptModules: number;
  /** True when both halves of the addon ship a pack_icon.png. */
  packIcon: boolean;
  notes: string[];
}

export interface AssetValidationReport {
  targetVersion: string;
  playableMode: boolean;
  /** True when an upstream conversion stage failed, so dependent checks are FAILED. */
  stageFailed: boolean;
  filesChecked: number;
  resourceFiles: number;
  behaviorFiles: number;
  totalChecks: number;
  initialDefects: number;
  cleanChecks: number;
  repairedCount: number;
  unresolvedCount: number;
  unsupportedCount: number;
  errorCount: number;
  warningCount: number;
  findings: ValidationFinding[];
  checks: ValidationCheckSummary[];
  repairPasses: ValidationRepairPass[];
  /** Conversion results that failed and were kept in the report instead of discarded. */
  conversionFailures: string[];
  verifiedSystems: string[];
  /** What structural validation cannot prove. */
  untested: string[];
  summary: string;
  /** Open defects collapsed into root causes, highest impact first. */
  rootCauses: RootCauseGroup[];
  rootCauseCount: number;
  systemicRootCauseCount: number;
  /** Total open finding instances before the per-root-cause reporting cap. */
  openFindingCount: number;
  /** Instances skipped by the per-root-cause repair budget. */
  deferredRepairCount: number;
  /** True when individual finding rows were capped for reporting (counts stay exact). */
  reportingCapped: boolean;
  /** Mandatory Bedrock pack schema outcome for the exported manifests. */
  schema: PackSchemaReport;
  /** Always false: no check in this pipeline runs inside a live Bedrock client. */
  gameplayVerified: boolean;
  /** Phase 10 documentation of every source file consumed and every generated file. */
  conversionManifest?: ConversionManifestReport;
  /** Canonical geometry identifier registry outcome for the exported pack. */
  geometryRegistry?: GeometryRegistryReport;
  /** Texture atlas isolation outcome for the exported pack. */
  textureAtlas?: AtlasReport;
  /** Bedrock client-schema gate outcome (before/after defect report). */
  schemaGate?: BedrockSchemaGateReport;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 9 — Regression testing
// ─────────────────────────────────────────────────────────────────────────────

export type RegressionMetricId =
  | 'assetPreservation'
  | 'geometryAccuracy'
  | 'uvAccuracy'
  | 'textureAccuracy'
  | 'animationAccuracy'
  | 'behaviorPreservation'
  | 'dependencyCompleteness'
  | 'packLoadingSuccess';

export interface RegressionAssertion {
  label: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface RegressionFixtureResult {
  id: string;
  label: string;
  category: string;
  status: 'passed' | 'partial' | 'failed';
  /** 0-100 per metric; null when the fixture cannot measure that metric. */
  metrics: Partial<Record<RegressionMetricId, number>>;
  assertions: RegressionAssertion[];
  /** Conversion findings worth reading (failures and approximations). */
  findings: string[];
  /** Metrics that could not be measured, with the reason. */
  unavailable: string[];
  durationMs: number;
  /** Blocking defects the validator reported for this fixture's converted pack. */
  blockingDefects?: number;
}

export interface RegressionSuiteReport {
  total: number;
  passed: number;
  partial: number;
  failed: number;
  metrics: Partial<Record<RegressionMetricId, number>>;
  fixtures: RegressionFixtureResult[];
  summary: string;
  /** Always true: the suite compares source evidence with converted output, never a live client. */
  simulated: boolean;
  /** Explicit: these percentages never describe in-game gameplay compatibility. */
  gameplayCompatibility: 'not-measured';
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 10 — Conversion documentation
// ─────────────────────────────────────────────────────────────────────────────

/** Asset kinds recognised from the imported archive's own file layout. */
export type SourceAssetKind =
  | 'texture'
  | 'animated-texture'
  | 'model'
  | 'blockstate'
  | 'animation'
  | 'animation-controller'
  | 'recipe'
  | 'loot-table'
  | 'trade-table'
  | 'sound'
  | 'lang'
  | 'java-source'
  | 'bytecode'
  | 'metadata'
  | 'other';

/**
 * carried      — the asset ships as a file the pack contains.
 * converted    — the asset was rewritten into a different generated file.
 * analyzed     — consumed as evidence; it produces behaviour, not a 1:1 file copy.
 * not-carried  — nothing in the exported pack corresponds to this source file.
 * failed       — a generated file for this source exists but is reported as a broken conversion.
 */
export type SourceAssetDisposition = 'carried' | 'converted' | 'analyzed' | 'not-carried' | 'failed';

export interface SourceFileRecord {
  path: string;
  kind: SourceAssetKind;
  bytes: number;
  disposition: SourceAssetDisposition;
  /** Generated files this source produced (empty when nothing in the pack corresponds). */
  outputs: string[];
  evidence: string;
}

export type GeneratedFileOrigin = 'source' | 'structure' | 'no-direct-source';

export interface GeneratedFileRecord {
  path: string;
  role: 'RP' | 'BP';
  bytes: number;
  origin: GeneratedFileOrigin;
  /** Source files this generated file is traceable to. */
  sourcePaths: string[];
}

export interface ConversionManifestCounts {
  total: number;
  carried: number;
  converted: number;
  analyzed: number;
  notCarried: number;
  failed: number;
}

/**
 * Phase 10 record: the documentation of every modified/consumed source file and every
 * generated output file, so a conversion can be audited file by file instead of trusted.
 */
export interface SchemaGateCheck {
  id: string;
  label: string;
  /** The actual Bedrock client-schema requirement this check enforces. */
  rule: string;
  errorsBefore: number;
  errorsAfter: number;
  /** clean = never defective, repaired = fixed here, unresolved = still open. */
  status: 'clean' | 'repaired' | 'unresolved';
  detail: string;
}

/**
 * Bedrock client-schema gate: the before/after defect report produced on the pack that is
 * actually exported. A check is only `repaired` when the defect count really dropped, and
 * `unresolved` when a reference could not be resolved without inventing an asset.
 */
export interface BedrockSchemaGateReport {
  checks: SchemaGateCheck[];
  errorsBefore: number;
  errorsAfter: number;
  renderControllersNormalised: number;
  textureExpressionsRepaired: number;
  emptyAnimationNodesRemoved: number;
  emptyAnimateArraysRemoved: number;
  danglingAnimationRefsRemoved: number;
  soundNamesFixed: number;
  unsupportedSoundEvents: string[];
  geometryReferencesRepaired: number;
  danglingGeometryReferences: string[];
  entityTexturesMissing: string[];
  itemIconsRepaired: number;
  itemIconsMissing: string[];
  blockOverridesRemoved: number;
  unresolvedChecks: number;
  notes: string[];
  /** True only when no schema check is left unresolved. */
  passed: boolean;
  summary: string;
}

export interface ConversionManifestReport {
  modId: string;
  playableMode: boolean;
  sources: SourceFileRecord[];
  outputs: GeneratedFileRecord[];
  categoryCounts: Partial<Record<SourceAssetKind, ConversionManifestCounts>>;
  carried: number;
  converted: number;
  analyzed: number;
  notCarried: number;
  failed: number;
  /** Files that exist because Bedrock requires them (manifest, atlases, texts, scripts). */
  structureFiles: number;
  /** Generated files with no traceable source file (reported for traceability, not as a defect). */
  noDirectSourceFiles: number;
  /** Every conversion failure that was recorded instead of discarded. */
  failures: string[];
  hardcodingSummary?: string;
  /** Markdown documentation lines; truncated for very large archives (flagged below). */
  documentation: string[];
  documentationTruncated: boolean;
  summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 11 — Universal source analysis & intermediate representation
// ─────────────────────────────────────────────────────────────────────────────

/** Mod-loading ecosystem recognised from the archive's own metadata or class packages. */
export type ModLoaderId =
  | 'neoforge'
  | 'forge'
  | 'fabric'
  | 'quilt'
  | 'legacy-forge'
  | 'rift'
  | 'unknown';

/** One detected loader adapter. Detection is evidence, never an assumption about content. */
export interface SourceLoaderEvidence {
  loader: ModLoaderId;
  /** Files/packages that prove this loader is present. */
  evidence: string[];
}

/** Domains the intermediate representation can describe, independent of source and target format. */
export type SourceDomain =
  | 'item'
  | 'entity'
  | 'block'
  | 'model'
  | 'texture'
  | 'animation'
  | 'animation-controller'
  | 'molang'
  | 'particle'
  | 'sound'
  | 'recipe'
  | 'loot'
  | 'behavior'
  | 'interaction'
  | 'worldgen'
  | 'dependency'
  | 'localization'
  | 'tag'
  | 'unknown';

/** A source document (file) the analysis indexed, with the domain its own layout declares. */
export interface SourceDocumentRecord {
  path: string;
  domain: SourceDomain;
  /** Namespace from `assets/<ns>/` or `data/<ns>/`; empty when the file declares none. */
  namespace: string;
  /** File identity without format suffixes (`capac_house`, `rune_blade`, `capac`). */
  logicalId: string;
  format: 'json' | 'text' | 'binary' | 'class';
  bytes: number;
}

/** A reference a source document declares, before it is resolved against the archive. */
export interface SourceRawReference {
  fromPath: string;
  fromDomain: SourceDomain;
  value: string;
  kind: 'namespaced-id' | 'tag' | 'file-reference';
}

/**
 * Result of the discovery stage. It records what the archive contains and what it claims to
 * reference; nothing here is a conversion result.
 */
export interface SourceDiscoveryReport {
  /** Loader adapters detected from metadata files or class packages (empty when none). */
  loaders: SourceLoaderEvidence[];
  namespaces: string[];
  declaredDependencies: string[];
  /** Capped sample of indexed documents; `documentCount` and `documentCounts` stay exact. */
  documents: SourceDocumentRecord[];
  documentCount: number;
  documentCounts: Partial<Record<SourceDomain, number>>;
  /** Capped sample of references declared by source documents. */
  references: SourceRawReference[];
  referenceCount: number;
  /** Documents whose payload could not be parsed — reported, never guessed at. */
  unparsedDocuments: string[];
  /** True when the listed documents/references were capped for reporting. */
  reportingCapped: boolean;
  summary: string;
}

export type IRReferenceStatus = 'resolved' | 'external' | 'unresolved';

/** A relationship one IR object declares. `external` means the target belongs to another pack. */
export interface IRReference {
  target: string;
  domain: SourceDomain;
  status: IRReferenceStatus;
  evidence: string;
}

/** Stage that produced or changed an IR record, so every value keeps its history. */
export interface IRTransformation {
  stage: 'analysis' | 'ir' | 'conversion' | 'validation' | 'packaging';
  action: string;
  detail: string;
  provenance: ComponentProvenance;
}

/**
 * One source object in the shared intermediate representation.
 * Nothing is translated here: the record keeps the source identity, the values the mod declared
 * and the evidence behind every field, so the Bedrock writers never have to guess.
 */
export interface IRNode {
  /** Engine-neutral key (`item:rune_blade`, `model:mod:gem_lamp`). */
  id: string;
  domain: SourceDomain;
  /** Original registry ids, display names or file identities this object carries. */
  sourceIds: string[];
  /** Archive paths this object was read from. */
  sourcePaths: string[];
  /** Original source values, kept verbatim (never invented defaults). */
  values: Record<string, string | number | boolean | string[]>;
  references: IRReference[];
  /** 0..1 confidence in this record, derived from the evidence that produced it. */
  confidence: number;
  evidence: string[];
  provenance: ComponentProvenance;
  transforms: IRTransformation[];
  /** Aspects of this object the engine could not recover (reported, never filled in). */
  unresolved: string[];
}

/** Per-domain totals of the IR. */
export interface IRDomainCount {
  domain: SourceDomain;
  count: number;
}

/**
 * The intermediate representation handed from analysis to conversion.
 * It is an evidence record: a node existing proves the source declared something, not that a
 * Bedrock file was generated for it.
 */
export interface UniversalIRReport {
  modId: string;
  /** Capped sample of IR objects; `nodeCount` and `counts` stay exact. */
  nodes: IRNode[];
  nodeCount: number;
  counts: Partial<Record<SourceDomain, number>>;
  domainCounts: IRDomainCount[];
  references: {
    total: number;
    resolved: number;
    external: number;
    unresolved: number;
    /** Unresolved reference samples with the document that declared them. */
    samples: IRReference[];
  };
  confidence: { high: number; medium: number; low: number; unknown: number };
  transformationCount: number;
  /** Distinct aspects the analysis could not recover, with the object they belong to. */
  unresolvedAspects: string[];
  /** Item roles decided by the analysis stage, reused by conversion instead of re-derived. */
  itemClassifications: Record<string, ItemClassification>;
  reportingCapped: boolean;
  summary: string;
}