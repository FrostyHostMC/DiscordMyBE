/**
 * Version-Aware Bedrock Capability Query & Experiment Engine
 *
 * Probes a target Bedrock runtime version and maps required mod features
 * (cameras, custom UI, voxel shapes, beta APIs, PBR, script eval) to their
 * authentic Bedrock execution mechanisms:
 *   - Engine-level manifest capabilities (pbr, chemistry, script_eval)
 *   - Native Script APIs (@minecraft/server, @minecraft/server-ui)
 *   - Custom camera presets (cameras/presets.json + setCamera API)
 *   - Component-driven voxel blocks (minecraft:geometry & collision_box)
 *   - World Settings experiments (Beta APIs, Upcoming Creator Features)
 */

export type CapabilityState = 'supported' | 'engine_native' | 'unsupported' | 'deprecated' | 'unknown';

export type CapabilityRoute = 'manifest' | 'engine_api' | 'deprecated';

export interface CapabilityStatus {
  name: string;
  state: CapabilityState;
  route: CapabilityRoute;
  evidence: string;
  engineDelivery: string;
}

export type BedrockVersionTarget = '1.26.63' | '1.21.50' | '1.21.20' | '1.21.0' | '1.20.80' | 'preview';

export type VersionTriple = [number, number, number];

export interface VersionTargetOption {
  id: BedrockVersionTarget;
  label: string;
  version: VersionTriple;
  scriptApiVersion: string;
  description: string;
  isLatest?: boolean;
}

export const VERSION_TARGETS: VersionTargetOption[] = [
  {
    id: '1.26.63',
    label: 'Bedrock 26.63 (Latest Stable)',
    version: [1, 26, 63],
    scriptApiVersion: '2.11.0',
    description: 'Latest stable Bedrock release verified from Mojang release notes; stable @minecraft/server 2.11.0.',
    isLatest: true,
  },
  {
    id: '1.21.50',
    label: 'Bedrock 1.21.50 (Legacy)',
    version: [1, 21, 50],
    scriptApiVersion: '1.16.0',
    description: 'Legacy Bedrock 1.21.50 target with @minecraft/server 1.16.0.',
  },
  {
    id: '1.21.20',
    label: 'Bedrock 1.21.20',
    version: [1, 21, 20],
    scriptApiVersion: '1.15.0',
    description: 'Tricky Trials update: stabilized camera presets, block permutations, and @minecraft/server v1.15.0.',
  },
  {
    id: '1.21.0',
    label: 'Bedrock 1.21.0',
    version: [1, 21, 0],
    scriptApiVersion: '1.14.0',
    description: 'Initial 1.21 release: modern block geometry, item cooldowns, and camera scripting.',
  },
  {
    id: '1.20.80',
    label: 'Bedrock 1.20.80 (LTS)',
    version: [1, 20, 80],
    scriptApiVersion: '1.13.0',
    description: 'Long-term baseline: rock-solid compatibility across all mobile and console devices.',
  },
  {
    id: 'preview',
    label: 'Bedrock Preview / Beta',
    version: [1, 21, 60],
    scriptApiVersion: '1.17.0-beta',
    description: 'Experimental testing environment: enables script_eval, beta modules, and pre-release engine features.',
  },
];

export interface BedrockExperimentConfig {
  targetVersion: BedrockVersionTarget;
  enableBetaApis: boolean;
  enableCameras: boolean;
  enableCustomUi: boolean;
  enableVoxelShapes: boolean;
  enableUpcomingCreatorFeatures: boolean;
  enablePbr: boolean;
  enableScriptEval: boolean;
}

export interface ExperimentFeature {
  id: string;
  name: string;
  category: 'script' | 'camera' | 'ui' | 'blocks' | 'graphics';
  bedrockImplementation: string;
  worldSettingName?: string;
  manifestDelivery: string;
  enabled: boolean;
  autoDetected: boolean;
  detectionReason?: string;
}

export interface CapabilityQueryResult {
  targetVersion: VersionTriple;
  versionLabel: string;
  queryAvailable: boolean;
  capabilities: CapabilityStatus[];
  supportedCapabilities: string[];
  unsupportedCapabilities: string[];
  unknownCapabilities: string[];
  maxScriptApiVersion: string;
  features: ExperimentFeature[];
}

/** Capabilities modern Bedrock runtimes reject at import ("not supported" errors). */
const REJECTED_CAPABILITIES: Record<string, string> = {
  experimental_custom_ui: 'Custom UI in Bedrock is powered via @minecraft/server-ui modal forms and client scripts, not manifest strings.',
  upcoming_creator_features: 'Block traits and permutations in Bedrock are data-driven via format_version 1.21+ and World Settings.',
  experimental_creator_cameras: 'Creator cameras in Bedrock are defined via cameras/presets.json and driven by @minecraft/server camera APIs.',
  experimental_voxel_shapes: '3D voxel geometry and custom hitboxes are implemented via minecraft:geometry and collision_box components.',
};

/** Legacy flags that still load but are scheduled for retirement. */
const DEPRECATED_CAPABILITIES: Record<string, string> = {
  holiday_creator_features: 'Legacy holiday experiment; loads on older engines but superseded by modern data-driven features.',
  experimental_gameplay: 'Legacy experiment; loads on older engines but superseded by stable component groups.',
};

/** Flags that remain recognized by current engines. */
const ALWAYS_SUPPORTED_CAPABILITIES: Record<string, string> = {
  chemistry: 'Recognized stable experiment toggle in current engines.',
};

/** @minecraft/server module versions and the minimum engine that accepts them. */
const SCRIPT_API_TABLE: Array<{ min: VersionTriple; version: string }> = [
  { min: [1, 26, 70], version: '2.13.0-beta' },\n  { min: [1, 26, 63], version: '2.11.0' },
  { min: [1, 21, 50], version: '1.16.0' },
  { min: [1, 21, 20], version: '1.15.0' },
  { min: [1, 21, 0], version: '1.14.0' },
  { min: [1, 20, 80], version: '1.13.0' },
  { min: [1, 20, 60], version: '1.11.0' },
  { min: [1, 20, 0], version: '1.9.0' },
];

export function compareVersions(a: VersionTriple, b: VersionTriple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function normalizeVersion(raw: unknown): VersionTriple {
  if (typeof raw === 'string') {
    const matched = VERSION_TARGETS.find((vt) => vt.id === raw);
    if (matched) return matched.version;
    const parts = raw.split('.').map(Number).filter((n) => Number.isFinite(n) && n >= 0);
    while (parts.length < 3) parts.push(0);
    return [parts[0] ?? 1, parts[1] ?? 20, parts[2] ?? 80];
  }
  const arr = Array.isArray(raw) ? raw : [1, 26, 63];
  const nums = arr.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);
  while (nums.length < 3) nums.push(0);
  return [nums[0] ?? 1, nums[1] ?? 21, nums[2] ?? 50];
}

/**
 * Probes the imported mod brief and archive to auto-detect which Bedrock
 * experimental features and APIs are required for 1:1 functional parity.
 */
export function detectModExperimentNeeds(
  brief?: string,
  entries?: Array<{ path: string }>,
): Record<string, { detected: boolean; reason: string }> {
  const text = (brief ?? '').toLowerCase();
  const filePaths = entries ? entries.map((e) => e.path.toLowerCase()) : [];

  const hasWeaponsOrSpells =
    /gun|weapon|wand|spell|bullet|projectile|magic|shoot|fire|attack|bow|laser|rocket|artillery|combat|slash|sword/.test(text) ||
    filePaths.some((p) => /projectile|spell|bullet|magic|shoot|weapon/.test(p));

  const hasBossesOrCutscenes =
    /cutscene|cinematic|camera|intro/.test(text) ||
    filePaths.some((p) => /boss|cutscene|cinematic/.test(p));

  const hasCustomBlocks =
    /block|furniture|slab|stair|door|ore|machine|reactor|crate|chest|pipe|voxel|table|chair/.test(text) ||
    filePaths.some((p) => p.includes('models/block') || p.includes('textures/block') || p.includes('blocks/'));

  const hasUiMenus =
    /ui|hud|gui|menu|form|skill|tree|spellbook|backpack|pouch|stats|inventory/.test(text) ||
    filePaths.some((p) => p.includes('textures/gui') || p.includes('gui/'));

  const hasPbrTextures =
    /pbr|normal|roughness|metallic|emissive|glow|deferred|rtx|shader/.test(text) ||
    filePaths.some((p) => /_n\.png|_s\.png|_e\.png|_normal|_metallic|_roughness/.test(p));

  return {
    betaApis: {
      detected: true, // Always recommended for mod actions, sounds, and particle triggers
      reason: hasWeaponsOrSpells
        ? 'Detected weapon arts, spells, or projectiles requiring @minecraft/server action listeners.'
        : 'Powers scripted combat events, custom sound playback, and macro hotkeys.',
    },
    cameras: {
      detected: hasBossesOrCutscenes,
      reason: hasBossesOrCutscenes
        ? 'Detected boss encounters or cinematic transitions requiring cameras/presets.json interpolation.'
        : 'Allows custom cutscene camera sweeps and cinematic view shifts.',
    },
    customUi: {
      detected: hasUiMenus,
      reason: hasUiMenus
        ? 'Detected mod skill menus, equipment screens, or form dialogues requiring @minecraft/server-ui.'
        : 'Enables interactive ActionFormData and ModalFormData dialog popups.',
    },
    voxelShapes: {
      detected: hasCustomBlocks,
      reason: hasCustomBlocks
        ? 'Detected 3D block geometry, slabs, or interactive doors requiring custom collision boxes.'
        : 'Enables non-cube 3D block models and custom collision and selection boundaries.',
    },
    upcomingCreatorFeatures: {
      detected: hasCustomBlocks,
      reason: hasCustomBlocks
        ? 'Requires cardinal placement traits and state-dependent block permutations.'
        : 'Supports data-driven placement traits for custom blocks.',
    },
    pbr: {
      detected: hasPbrTextures,
      reason: hasPbrTextures
        ? 'Detected normal maps or emissive surfaces mapped to Render Dragon Deferred Technical Preview.'
        : 'Generates texture sets for physically-based lighting and metallic reflections.',
    },
    scriptEval: {
      detected: false,
      reason: 'Sandbox-restricted in stable runtimes; enabled only when targeting Bedrock Preview.',
    },
  };
}

/**
 * Query the capability set the target Bedrock version recognizes.
 * Accurately accounts for Deferred PBR and Preview script_eval support,
 * while mapping all creator experiments to their authentic engine delivery.
 */
export function queryBedrockCapabilities(
  targetVersion: unknown,
  userConfig?: Partial<BedrockExperimentConfig>,
  brief?: string,
  entries?: Array<{ path: string }>,
): CapabilityQueryResult {
  const version = normalizeVersion(targetVersion);
  const detected = detectModExperimentNeeds(brief, entries);

  const is121OrNewer = version[0] > 1 || (version[0] === 1 && version[1] >= 21);
  const isPreview = version[1] >= 21 && version[2] >= 60;

  const capabilities: CapabilityStatus[] = [];

  // 1. Chemistry (always recognized)
  capabilities.push({
    name: 'chemistry',
    state: 'supported',
    route: 'manifest',
    evidence: ALWAYS_SUPPORTED_CAPABILITIES.chemistry,
    engineDelivery: 'Supported directly in behavior pack manifest capabilities.',
  });

  // 2. PBR capability (valid for 1.21+ deferred shading pipeline)
  if (is121OrNewer) {
    capabilities.push({
      name: 'pbr',
      state: 'supported',
      route: 'manifest',
      evidence: 'Recognized in Bedrock 1.21+ for Render Dragon Deferred Technical Preview (PBR materials & texture sets).',
      engineDelivery: 'Declared in resource pack manifest capabilities with .texture_set.json maps.',
    });
  } else {
    capabilities.push({
      name: 'pbr',
      state: 'unsupported',
      route: 'manifest',
      evidence: 'PBR manifest capability requires Bedrock 1.21+ engine ceiling.',
      engineDelivery: 'Target Bedrock 1.21+ to enable Deferred PBR shaders.',
    });
  }

  // 3. Script eval (valid for Preview runtimes only)
  if (isPreview) {
    capabilities.push({
      name: 'script_eval',
      state: 'supported',
      route: 'manifest',
      evidence: 'Recognized in Bedrock Beta/Preview runtimes for experimental script evaluation.',
      engineDelivery: 'Declared in behavior pack manifest capabilities on Preview.',
    });
  } else {
    capabilities.push({
      name: 'script_eval',
      state: 'unsupported',
      route: 'manifest',
      evidence: 'Sandbox-restricted in stable runtimes; permitted exclusively in Bedrock Beta/Preview.',
      engineDelivery: 'Permitted in Bedrock Preview / Beta testing environments.',
    });
  }

  // 4. Engine-native capabilities (executed via authentic Bedrock APIs without manifest import errors)
  for (const [name, explanation] of Object.entries(REJECTED_CAPABILITIES)) {
    capabilities.push({
      name,
      state: 'engine_native',
      route: 'engine_api',
      evidence: explanation,
      engineDelivery:
        name === 'experimental_custom_ui'
          ? 'Native @minecraft/server-ui ActionFormData & ModalFormData script dialogs.'
          : name === 'experimental_creator_cameras'
          ? 'Native cameras/presets.json + camera.setCamera() Script API triggers.'
          : name === 'upcoming_creator_features'
          ? 'Data-driven block traits & cardinal permutations in blocks/*.json.'
          : '3D block geometry (minecraft:geometry) & custom collision_box components.',
    });
  }

  // 5. Deprecated flags
  for (const [name, explanation] of Object.entries(DEPRECATED_CAPABILITIES)) {
    capabilities.push({
      name,
      state: 'deprecated',
      route: 'deprecated',
      evidence: explanation,
      engineDelivery: 'Superseded by modern data-driven block and item components.',
    });
  }

  const supported = capabilities.filter((c) => c.state === 'supported').map((c) => c.name);
  const unsupported = capabilities.filter((c) => c.state === 'unsupported').map((c) => c.name);
  const unknown = capabilities.filter((c) => c.state === 'unknown').map((c) => c.name);

  const scriptEntry = SCRIPT_API_TABLE.find((e) => compareVersions(version, e.min) >= 0) ?? SCRIPT_API_TABLE[SCRIPT_API_TABLE.length - 1];

  // Build the complete Bedrock Experiment Feature architecture
  const features: ExperimentFeature[] = [
    {
      id: 'beta_apis',
      name: 'Beta APIs & Script Engine',
      category: 'script',
      bedrockImplementation: `@minecraft/server ${scriptEntry.version}`,
      worldSettingName: 'Beta APIs',
      manifestDelivery: 'BP dependencies (@minecraft/server)',
      enabled: userConfig?.enableBetaApis ?? true,
      autoDetected: detected.betaApis.detected,
      detectionReason: detected.betaApis.reason,
    },
    {
      id: 'creator_cameras',
      name: 'Cinematic Creator Cameras',
      category: 'camera',
      bedrockImplementation: 'cameras/presets.json + setCamera script API',
      worldSettingName: 'Beta APIs',
      manifestDelivery: 'Camera presets & script commands',
      enabled: userConfig?.enableCameras ?? true,
      autoDetected: detected.cameras.detected,
      detectionReason: detected.cameras.reason,
    },
    {
      id: 'custom_ui',
      name: 'Custom UI & Modal Forms',
      category: 'ui',
      bedrockImplementation: '@minecraft/server-ui ActionFormData / ModalFormData',
      worldSettingName: 'Beta APIs',
      manifestDelivery: 'BP dependencies (@minecraft/server-ui)',
      enabled: userConfig?.enableCustomUi ?? true,
      autoDetected: detected.customUi.detected,
      detectionReason: detected.customUi.reason,
    },
    {
      id: 'voxel_shapes',
      name: '3D Voxel Shapes & Block Geometry',
      category: 'blocks',
      bedrockImplementation: `format_version ${version[0]}.${version[1]}.0 block components`,
      worldSettingName: 'Upcoming Creator Features',
      manifestDelivery: 'minecraft:geometry & collision_box in blocks/*.json',
      enabled: userConfig?.enableVoxelShapes ?? true,
      autoDetected: detected.voxelShapes.detected,
      detectionReason: detected.voxelShapes.reason,
    },
    {
      id: 'upcoming_creator_features',
      name: 'Block Traits & Permutations',
      category: 'blocks',
      bedrockImplementation: 'minecraft:placement_direction traits and state permutations',
      worldSettingName: 'Upcoming Creator Features',
      manifestDelivery: 'Behavior pack block traits',
      enabled: userConfig?.enableUpcomingCreatorFeatures ?? true,
      autoDetected: detected.upcomingCreatorFeatures.detected,
      detectionReason: detected.upcomingCreatorFeatures.reason,
    },
    {
      id: 'pbr',
      name: 'Deferred Technical Preview (PBR)',
      category: 'graphics',
      bedrockImplementation: '.texture_set.json color, metalness, and heightmaps',
      worldSettingName: 'Render Dragon Features for Creators',
      manifestDelivery: is121OrNewer ? 'RP capabilities ("pbr")' : 'Requires Bedrock 1.21+',
      enabled: is121OrNewer && (userConfig?.enablePbr ?? false),
      autoDetected: detected.pbr.detected,
      detectionReason: detected.pbr.reason,
    },
    {
      id: 'script_eval',
      name: 'Script Dynamic Evaluation',
      category: 'script',
      bedrockImplementation: 'JavaScript dynamic eval capability in scripts',
      manifestDelivery: isPreview ? 'BP capabilities ("script_eval")' : 'Preview / Beta runtimes only',
      enabled: isPreview && (userConfig?.enableScriptEval ?? false),
      autoDetected: detected.scriptEval.detected,
      detectionReason: detected.scriptEval.reason,
    },
  ];

  return {
    targetVersion: version,
    versionLabel: `Bedrock ${version[0]}.${version[1]}.${version[2]}`,
    queryAvailable: true,
    capabilities,
    supportedCapabilities: supported,
    unsupportedCapabilities: unsupported,
    unknownCapabilities: unknown,
    maxScriptApiVersion: scriptEntry.version,
    features,
  };
}

/**
 * Filter a declared capability list against what the target version supports.
 * Allows "pbr" for 1.21+ and "script_eval" for Preview when enabled, while
 * strictly omitting invalid flags that cause game engine import rejection.
 */
export function sanitizeCapabilitiesForVersion(
  targetVersion: unknown,
  declared: string[],
): { allowed: string[]; rejected: Array<{ name: string; evidence: string }> } {
  const query = queryBedrockCapabilities(targetVersion);
  const allowed: string[] = [];
  const rejected: Array<{ name: string; evidence: string }> = [];
  for (const name of declared) {
    const status = query.capabilities.find((c) => c.name === name);
    const state = status?.state ?? 'unknown';
    if (state === 'supported') {
      allowed.push(name);
    } else {
      rejected.push({
        name,
        evidence: status?.evidence ?? `Unrecognized capability for ${query.versionLabel}; omitted to prevent import rejection.`,
      });
    }
  }
  return { allowed, rejected };
}

/**
 * Automatically calculates the optimal Bedrock version target and experimental
 * features for an imported mod, ensuring 1:1 functional parity with zero manual work.
 */
export function autoConfigureExperimentsForMod(
  brief?: string,
  entries?: Array<{ path: string }>,
  preferredVersion?: BedrockVersionTarget,
): { config: BedrockExperimentConfig; targetVersion: BedrockVersionTarget; reasons: string[] } {
  const detected = detectModExperimentNeeds(brief, entries);
  const reasons: string[] = [];

  let targetVersion: BedrockVersionTarget = preferredVersion ?? '1.26.63';
  if (detected.scriptEval.detected && !preferredVersion) {
    targetVersion = 'preview';
    reasons.push('Target adjusted to Bedrock Preview to support experimental script evaluation.');
  }

  if (detected.betaApis.detected) {
    reasons.push('Beta APIs: Weapon abilities, combat arts & sound events bound to @minecraft/server.');
  }
  if (detected.cameras.detected) {
    reasons.push('Creator Cameras: Boss cutscenes & orbital sweeps bound to cameras/presets.json.');
  }
  if (detected.customUi.detected) {
    reasons.push('Custom UI: Interactive dialogs bound to @minecraft/server-ui ModalFormData.');
  }
  if (detected.voxelShapes.detected) {
    reasons.push('3D Voxel Shapes: Non-cube blocks & hitboxes bound to minecraft:geometry.');
  }
  if (detected.upcomingCreatorFeatures.detected) {
    reasons.push('Block Traits: Cardinal placement permutations bound to Upcoming Creator Features.');
  }
  if (detected.pbr.detected) {
    reasons.push('Deferred PBR: Normal/metallic maps bound to Render Dragon Deferred Technical Preview.');
  }

  const config: BedrockExperimentConfig = {
    targetVersion,
    enableBetaApis: detected.betaApis.detected,
    enableCameras: detected.cameras.detected,
    enableCustomUi: detected.customUi.detected,
    enableVoxelShapes: detected.voxelShapes.detected,
    enableUpcomingCreatorFeatures: detected.upcomingCreatorFeatures.detected,
    enablePbr: detected.pbr.detected,
    enableScriptEval: targetVersion === 'preview' && detected.scriptEval.detected,
  };

  return { config, targetVersion, reasons };
}

/** Highest @minecraft/server module version the target engine accepts. */
export function resolveScriptApiVersion(targetVersion: unknown): string {
  return queryBedrockCapabilities(targetVersion).maxScriptApiVersion;
}

// ─────────────────────────────────────────────────────────────────────────────
// Automated Schema Fetcher
// Periodically retrieves the latest Bedrock manifest schema data from Mojang's
// official public bedrock-samples repository so the capability engine stays
// synchronized with the newest engine versions and experimental flags.
// Falls back to a timestamped local cache, then to bundled defaults.
// ─────────────────────────────────────────────────────────────────────────────

export type SchemaSource = 'remote' | 'cached' | 'bundled' | 'error';

export interface SchemaCatalog {
  source: SchemaSource;
  fetchedAt: string | null;
  latestStableVersion: VersionTriple;
  latestStableLabel: string;
  latestPreviewVersion: VersionTriple | null;
  minEngineVersion: VersionTriple | null;
  discoveredCapabilities: string[];
  note: string;
}

const SCHEMA_CACHE_KEY = 'aippy.bedrockSchemaCatalog.v1';
const SCHEMA_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refresh at most once per day

/** Official Mojang bedrock-samples repository (public, static JSON files). */
const SCHEMA_REMOTE_ENDPOINTS = [
  'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/behavior_pack/manifest.json',
  'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/manifest.json',
];

const BUNDLED_SCHEMA_CATALOG: SchemaCatalog = {
  source: 'bundled',
  fetchedAt: null,
  latestStableVersion: [1, 26, 63],
  latestStableLabel: '1.26.63',
  latestPreviewVersion: [1, 26, 70],
  minEngineVersion: [1, 21, 0],
  discoveredCapabilities: [],
  note: 'Using bundled Bedrock schema defaults (offline or first run).',
};

interface CachedSchemaEnvelope {
  catalog: SchemaCatalog;
  cachedAt: number;
}

function isValidVersionTriple(value: unknown): value is VersionTriple {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => Number.isFinite(n) && n >= 0)
  );
}

function readCachedCatalog(): CachedSchemaEnvelope | null {
  try {
    const raw = localStorage.getItem(SCHEMA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSchemaEnvelope;
    if (parsed?.catalog && isValidVersionTriple(parsed.catalog.latestStableVersion)) {
      return parsed;
    }
  } catch {
    // Corrupt cache entries are treated as absent.
  }
  return null;
}

function writeCachedCatalog(catalog: SchemaCatalog): void {
  try {
    const envelope: CachedSchemaEnvelope = { catalog, cachedAt: Date.now() };
    localStorage.setItem(SCHEMA_CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage quota / private-mode failures are non-fatal; bundled data remains authoritative.
  }
}

function parseManifestVersions(manifest: unknown): {
  minEngine: VersionTriple | null;
  capabilities: string[];
} {
  const minEngine: VersionTriple | null = isValidVersionTriple(
    (manifest as { min_engine_version?: unknown })?.min_engine_version,
  )
    ? ((manifest as { min_engine_version: VersionTriple }).min_engine_version)
    : null;

  const caps: string[] = [];
  const rawCaps = (manifest as { capabilities?: unknown })?.capabilities;
  if (Array.isArray(rawCaps)) {
    for (const c of rawCaps) {
      if (typeof c === 'string') caps.push(c);
    }
  }
  return { minEngine, capabilities: caps };
}

/**
 * Fetches the latest Bedrock manifest schema data from the official repository.
 * Order of resolution: remote -> local cache (if fresh) -> bundled defaults.
 * Always resolves; never throws.
 */
export async function fetchLatestBedrockSchemas(force = false): Promise<SchemaCatalog> {
  const cached = readCachedCatalog();
  if (!force && cached && Date.now() - cached.cachedAt < SCHEMA_CACHE_TTL_MS) {
    return { ...cached.catalog, source: 'cached' };
  }

  for (const endpoint of SCHEMA_REMOTE_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, { cache: 'no-cache' });
      if (!response.ok) continue;
      const manifest = await response.json();
      const { minEngine, capabilities } = parseManifestVersions(manifest);
      const stable: VersionTriple = minEngine && compareVersions(minEngine, BUNDLED_SCHEMA_CATALOG.latestStableVersion) > 0
        ? minEngine
        : BUNDLED_SCHEMA_CATALOG.latestStableVersion;
      const catalog: SchemaCatalog = {
        source: 'remote',
        fetchedAt: new Date().toISOString(),
        latestStableVersion: stable,
        latestStableLabel: stable.join('.'),
        latestPreviewVersion: BUNDLED_SCHEMA_CATALOG.latestPreviewVersion,
        minEngineVersion: minEngine,
        discoveredCapabilities: capabilities,
        note: `Synchronized from official Mojang bedrock-samples repository${minEngine ? ` (sample min_engine_version ${minEngine.join('.')})` : ''}.`,
      };
      writeCachedCatalog(catalog);
      console.log(`[Aippy] Bedrock schema catalog refreshed from remote (${catalog.latestStableLabel}).`);
      return catalog;
    } catch {
      // Try the next endpoint; fall through to cache/bundled below.
    }
  }

  if (cached) {
    return { ...cached.catalog, source: 'cached', note: 'Remote unreachable; using cached schema data.' };
  }
  return BUNDLED_SCHEMA_CATALOG;
}

/** Synchronously reads whatever catalog is currently cached (no network). */
export function peekCachedSchemaCatalog(): SchemaCatalog | null {
  return readCachedCatalog()?.catalog ?? null;
}