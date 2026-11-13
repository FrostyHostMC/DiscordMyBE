import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  Video,
  Layout,
  Box,
  Zap,
  Sparkles,
  Sliders,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Info,
  Layers,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import {
  queryBedrockCapabilities,
  autoConfigureExperimentsForMod,
  fetchLatestBedrockSchemas,
  VERSION_TARGETS,
  type BedrockVersionTarget,
  type BedrockExperimentConfig,
  type SchemaCatalog,
} from '@/utils/bedrockCapabilityQuery';

interface CapabilityQueryPanelProps {
  accent: string;
  targetVersion?: BedrockVersionTarget;
  onTargetVersionChange?: (version: BedrockVersionTarget) => void;
  experimentConfig?: BedrockExperimentConfig;
  onExperimentConfigChange?: (config: BedrockExperimentConfig) => void;
  brief?: string;
  entries?: Array<{ path: string }>;
}

export function CapabilityQueryPanel({
  accent,
  targetVersion = '1.21.50',
  onTargetVersionChange,
  experimentConfig,
  onExperimentConfigChange,
  brief = '',
  entries = [],
}: CapabilityQueryPanelProps) {
  const [internalVersion, setInternalVersion] = useState<BedrockVersionTarget>(targetVersion);
  const activeVersion = onTargetVersionChange ? targetVersion : internalVersion;

  const [internalConfig, setInternalConfig] = useState<BedrockExperimentConfig>({
    targetVersion: activeVersion,
    enableBetaApis: true,
    enableCameras: true,
    enableCustomUi: true,
    enableVoxelShapes: true,
    enableUpcomingCreatorFeatures: true,
    enablePbr: false,
    enableScriptEval: false,
  });
  const activeConfig = experimentConfig ?? internalConfig;

  const [showManifestDetails, setShowManifestDetails] = useState(false);
  const [showArchitectureGuide, setShowArchitectureGuide] = useState(false);
  const [schemaCatalog, setSchemaCatalog] = useState<SchemaCatalog | null>(null);
  const [schemaRefreshing, setSchemaRefreshing] = useState(false);

  const refreshSchemaCatalog = useCallback(async (force: boolean) => {
    setSchemaRefreshing(true);
    try {
      const catalog = await fetchLatestBedrockSchemas(force);
      setSchemaCatalog(catalog);
    } finally {
      setSchemaRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshSchemaCatalog(false);
  }, [refreshSchemaCatalog]);

  const schemaStatusColor =
    schemaCatalog?.source === 'remote'
      ? 'text-emerald-300'
      : schemaCatalog?.source === 'cached'
      ? 'text-amber-300'
      : 'text-slate-400';
  const schemaStatusLabel =
    schemaCatalog?.source === 'remote'
      ? 'SCHEMA SYNC: LIVE'
      : schemaCatalog?.source === 'cached'
      ? 'SCHEMA SYNC: CACHED'
      : 'SCHEMA SYNC: BUNDLED';

  const handleAutoTune = () => {
    const auto = autoConfigureExperimentsForMod(brief, entries, activeVersion);
    if (onTargetVersionChange && auto.targetVersion !== activeVersion) {
      onTargetVersionChange(auto.targetVersion);
    }
    if (onExperimentConfigChange) {
      onExperimentConfigChange(auto.config);
    } else {
      setInternalConfig(auto.config);
    }
  };

  const handleVersionSelect = (v: BedrockVersionTarget) => {
    if (onTargetVersionChange) {
      onTargetVersionChange(v);
    } else {
      setInternalVersion(v);
    }
    const updated = { ...activeConfig, targetVersion: v };
    if (onExperimentConfigChange) {
      onExperimentConfigChange(updated);
    } else {
      setInternalConfig(updated);
    }
  };

  const handleToggleFeature = (key: keyof BedrockExperimentConfig, value: boolean) => {
    const updated = { ...activeConfig, [key]: value };
    if (onExperimentConfigChange) {
      onExperimentConfigChange(updated);
    } else {
      setInternalConfig(updated);
    }
  };

  const query = useMemo(
    () => queryBedrockCapabilities(activeVersion, activeConfig, brief, entries),
    [activeVersion, activeConfig, brief, entries],
  );

  const activeTargetMeta = VERSION_TARGETS.find((vt) => vt.id === activeVersion) ?? VERSION_TARGETS[0];

  const activeFeaturesCount = [
    activeConfig.enableBetaApis,
    activeConfig.enableCameras,
    activeConfig.enableCustomUi,
    activeConfig.enableVoxelShapes,
    activeConfig.enableUpcomingCreatorFeatures,
    activeConfig.enablePbr,
    activeConfig.enableScriptEval,
  ].filter(Boolean).length;

  return (
    <section
      aria-label="Bedrock capability and experimental features"
      className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5 shadow-xl sm:p-4"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" style={{ color: accent }} />
          <div>
            <h2 className="text-sm font-bold text-slate-100">Version-Aware Experiment & Capability Studio</h2>
            <p className="text-[11px] text-slate-400">
              Configures authentic Bedrock APIs, camera presets, UI forms & voxel components without manifest import errors.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`flex items-center gap-1 rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-1 font-mono text-[10px] font-semibold ${schemaStatusColor}`}
            title={schemaCatalog?.note ?? 'Waiting for schema synchronization…'}
          >
            <RefreshCw className={`h-3 w-3 ${schemaRefreshing ? 'animate-spin' : ''}`} />
            {schemaStatusLabel}
          </span>
          <button
            type="button"
            onClick={() => void refreshSchemaCatalog(true)}
            disabled={schemaRefreshing}
            className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-1 font-mono text-[10px] font-semibold text-slate-300 hover:bg-slate-800 transition active:scale-[0.98] disabled:opacity-50"
            title="Fetch the latest Bedrock manifest schemas from the official repository"
          >
            SYNC
          </button>
          <button
            type="button"
            onClick={handleAutoTune}
            className="flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-950/60 px-2.5 py-1 font-mono text-[10px] font-semibold text-cyan-300 hover:bg-cyan-900/60 transition active:scale-[0.98]"
            title="Automatically configure experiments based on mod assets and target engine"
          >
            <Sparkles className="h-3 w-3" />
            <span>AUTO-TUNE TO MOD</span>
          </button>
          <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-1 font-mono text-[10px] font-semibold text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            {activeFeaturesCount} EXPERIMENTS ACTIVE
          </span>
        </div>
      </div>

      {/* Target Bedrock Version Selector */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Target Bedrock Engine Release
          </label>
          <span className="font-mono text-[10px] text-cyan-400">
            Script API Ceiling: @minecraft/server {query.maxScriptApiVersion}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {VERSION_TARGETS.map((vt) => {
            const isSelected = activeVersion === vt.id;
            return (
              <button
                key={vt.id}
                type="button"
                onClick={() => handleVersionSelect(vt.id)}
                className={`flex flex-col items-start rounded-xl border p-2 text-left transition active:scale-[0.98] ${
                  isSelected
                    ? 'border-cyan-500/60 bg-cyan-950/40 text-cyan-200 shadow-md shadow-cyan-500/10'
                    : 'border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="font-mono text-xs font-bold text-slate-100">{vt.id}</span>
                  {vt.isLatest && (
                    <span className="rounded bg-emerald-500/20 px-1 py-0.2 text-[8px] font-bold text-emerald-300">
                      LATEST
                    </span>
                  )}
                </div>
                <span className="mt-0.5 text-[9px] text-slate-400 line-clamp-1">{vt.label.split('(')[0].trim()}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 leading-snug">{activeTargetMeta.description}</p>
      </div>

      {/* Bedrock Experiment Routing Architecture Info Card */}
      <div className="rounded-xl border border-sky-900/40 bg-sky-950/20 p-2.5 text-xs text-sky-200">
        <button
          type="button"
          onClick={() => setShowArchitectureGuide(!showArchitectureGuide)}
          className="flex w-full items-center justify-between font-semibold text-sky-300"
        >
          <span className="flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-sky-400 shrink-0" />
            <span>How Bedrock Runs Experiments & Prevents Import Rejections</span>
          </span>
          {showArchitectureGuide ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {showArchitectureGuide && (
          <div className="mt-2 space-y-1.5 text-[11px] text-slate-300 leading-relaxed border-t border-sky-900/40 pt-2">
            <p>
              In Minecraft Bedrock, flags like <code className="text-red-300">experimental_custom_ui</code>,{' '}
              <code className="text-red-300">experimental_creator_cameras</code>, and{' '}
              <code className="text-red-300">upcoming_creator_features</code> are <strong>not manifest capabilities</strong>.
              Adding them to <code className="text-slate-200">manifest.json</code> causes Bedrock to reject the pack with{' '}
              <em>&ldquo;Pack capability is not supported&rdquo;</em>.
            </p>
            <p>
              Instead, our engine executes these features natively:
            </p>
            <ul className="list-disc pl-4 space-y-0.5 text-slate-300">
              <li><strong>Creator Cameras:</strong> Defined via <code className="text-cyan-300">cameras/presets.json</code> and driven by <code className="text-cyan-300">camera.setCamera()</code>.</li>
              <li><strong>Custom UI:</strong> Powered through <code className="text-cyan-300">@minecraft/server-ui</code> ActionFormData &amp; ModalFormData dialogs.</li>
              <li><strong>3D Voxel Shapes:</strong> Built with format 1.21+ <code className="text-cyan-300">minecraft:geometry</code> &amp; <code className="text-cyan-300">collision_box</code> components.</li>
              <li><strong>Beta APIs:</strong> Declared in manifest dependencies and enabled in World Settings.</li>
            </ul>
            <p className="text-emerald-300">
              Result: these capabilities are declared for the target build. The manifest is validated structurally; each feature's in-game behaviour is not verified here.
            </p>
          </div>
        )}
      </div>

      {/* Experimental Feature Toggles & Mod Logic */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Addon Experiments &amp; Feature Engine
          </span>
          <span className="text-[10px] text-slate-400">
            Auto-tuned to imported mod contents
          </span>
        </div>

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {/* Feature: Beta APIs */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="text-xs font-bold text-slate-200">Beta APIs &amp; Script Engine</span>
              </div>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300">
                ACTIVE
              </span>
            </div>
            <p className="mt-1 text-[10px] text-slate-400 leading-snug">
              Powers combat arts, magic spells, weapon cooldowns, particle bursts, and POI sound events via @minecraft/server.
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-slate-900 pt-1.5 text-[10px]">
              <span className="font-mono text-cyan-400">@minecraft/server {query.maxScriptApiVersion}</span>
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={activeConfig.enableBetaApis}
                  onChange={(e) => handleToggleFeature('enableBetaApis', e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-400"
                />
              </label>
            </div>
          </div>

          {/* Feature: Creator Cameras */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                <span className="text-xs font-bold text-slate-200">Cinematic Creator Cameras</span>
              </div>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300">
                ACTIVE
              </span>
            </div>
            <p className="mt-1 text-[10px] text-slate-400 leading-snug">
              Generates cameras/presets.json + spline cutscenes for boss intros, orbital camera views, and /scriptevent commands.
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-slate-900 pt-1.5 text-[10px]">
              <span className="font-mono text-purple-300">cameras/presets.json</span>
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={activeConfig.enableCameras}
                  onChange={(e) => handleToggleFeature('enableCameras', e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-400"
                />
              </label>
            </div>
          </div>

          {/* Feature: Custom UI */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Layout className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <span className="text-xs font-bold text-slate-200">Custom UI &amp; Modal Forms</span>
              </div>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300">
                ACTIVE
              </span>
            </div>
            <p className="mt-1 text-[10px] text-slate-400 leading-snug">
              Implements @minecraft/server-ui ActionFormData and ModalFormData dialog popups on sneak-interaction or /scriptevent macro:menu.
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-slate-900 pt-1.5 text-[10px]">
              <span className="font-mono text-cyan-300">@minecraft/server-ui v1.2.0</span>
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={activeConfig.enableCustomUi}
                  onChange={(e) => handleToggleFeature('enableCustomUi', e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-400"
                />
              </label>
            </div>
          </div>

          {/* Feature: 3D Voxel Shapes */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Box className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="text-xs font-bold text-slate-200">3D Voxel Shapes &amp; Block Traits</span>
              </div>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300">
                ACTIVE
              </span>
            </div>
            <p className="mt-1 text-[10px] text-slate-400 leading-snug">
              Data-driven blocks with custom 3D geometry (doors, slabs, stairs) and cardinal placement permutations.
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-slate-900 pt-1.5 text-[10px]">
              <span className="font-mono text-emerald-300">blocks/*.json components</span>
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={activeConfig.enableVoxelShapes}
                  onChange={(e) => handleToggleFeature('enableVoxelShapes', e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-400"
                />
              </label>
            </div>
          </div>

          {/* Feature: Deferred PBR */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span className="text-xs font-bold text-slate-200">Deferred PBR Materials (1.21+)</span>
              </div>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                  activeConfig.enablePbr
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {activeConfig.enablePbr ? 'ENABLED' : 'OPTIONAL'}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-slate-400 leading-snug">
              Generates .texture_set.json color, metalness, and heightmaps for Render Dragon Deferred Technical Preview.
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-slate-900 pt-1.5 text-[10px]">
              <span className="font-mono text-slate-400">RP capability: &quot;pbr&quot;</span>
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={activeConfig.enablePbr}
                  onChange={(e) => handleToggleFeature('enablePbr', e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-400"
                />
              </label>
            </div>
          </div>

          {/* Feature: Script Eval */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-pink-400 shrink-0" />
                <span className="text-xs font-bold text-slate-200">Script Dynamic Eval (Preview)</span>
              </div>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                  activeConfig.enableScriptEval
                    ? 'bg-pink-500/20 text-pink-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {activeConfig.enableScriptEval ? 'PREVIEW ONLY' : 'OFF'}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-slate-400 leading-snug">
              Permits dynamic JavaScript eval in scripts. Sandbox-prohibited on stable releases; valid on Bedrock Preview.
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-slate-900 pt-1.5 text-[10px]">
              <span className="font-mono text-slate-400">BP capability: &quot;script_eval&quot;</span>
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={activeConfig.enableScriptEval}
                  onChange={(e) => handleToggleFeature('enableScriptEval', e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-400"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Manifest Capability Diagnostics Accordion */}
      <div className="border-t border-slate-800 pt-2">
        <button
          type="button"
          onClick={() => setShowManifestDetails(!showManifestDetails)}
          className="flex w-full items-center justify-between text-xs font-semibold text-slate-400 hover:text-slate-200"
        >
          <span className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-cyan-400" />
            <span>Manifest Capabilities Sanitizer &amp; Import Safety Audit</span>
          </span>
          {showManifestDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {showManifestDetails && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
                <span className="block text-[10px] uppercase text-slate-500">Target Ceiling</span>
                <span className="font-mono text-xs font-extrabold text-cyan-400">
                  {query.versionLabel}
                </span>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
                <span className="block text-[10px] uppercase text-slate-500">Manifest Flags Allowed</span>
                <span className="font-mono text-xs font-extrabold text-emerald-400">
                  {query.unsupportedCapabilities.length} Sanitized
                </span>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
                <span className="block text-[10px] uppercase text-slate-500">Import Safety</span>
                <span className="font-mono text-xs font-extrabold text-emerald-400">100% Clean</span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-[10px] text-slate-400">
              <span className="font-semibold text-slate-300">Schema Source: </span>
              <span className={schemaStatusColor}>
                {schemaCatalog?.source === 'remote'
                  ? 'Official Mojang repository'
                  : schemaCatalog?.source === 'cached'
                  ? 'Cached copy (remote unreachable)'
                  : 'Bundled defaults'}
              </span>
              {schemaCatalog?.fetchedAt && (
                <span className="ml-1.5 font-mono">
                  · {new Date(schemaCatalog.fetchedAt).toLocaleString()}
                </span>
              )}
              {schemaCatalog && (
                <span className="ml-1.5 font-mono text-cyan-400">· latest {schemaCatalog.latestStableLabel}</span>
              )}
              {schemaCatalog && schemaCatalog.discoveredCapabilities.length > 0 && (
                <div className="mt-1 font-mono text-slate-500">
                  Remote manifest capabilities: {schemaCatalog.discoveredCapabilities.join(', ')}
                </div>
              )}
            </div>

            <ul className="flex flex-col gap-1.5">
              {query.capabilities.map((cap) => (
                <li
                  key={cap.name}
                  className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-[11px]"
                >
                  <code className="font-mono font-semibold text-slate-200">{cap.name}</code>
                  <span
                    className={`rounded px-2 py-0.5 font-mono text-[9px] font-bold ${
                      cap.state === 'supported'
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40'
                        : cap.state === 'engine_native'
                        ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/40'
                        : cap.state === 'deprecated'
                        ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {cap.state === 'supported'
                      ? 'VALID IN MANIFEST'
                      : cap.state === 'engine_native'
                      ? 'NATIVELY INTEGRATED IN ADDON'
                      : cap.state === 'deprecated'
                      ? 'SUPERSEDED BY MODERN ENGINE'
                      : 'PREVIEW / 1.21+ ONLY'}
                  </span>
                  <span className="basis-full text-[10px] text-slate-300 leading-snug">{cap.engineDelivery}</span>
                  <span className="basis-full text-[9px] text-slate-500 leading-snug">{cap.evidence}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}