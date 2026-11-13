import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { Cpu, RotateCcw, Download, Activity, Sliders, Wrench, Sparkles } from 'lucide-react';
import { useRemakerAudio } from '@/hooks/useRemakerAudio';
import { type ExtractedZipEntry } from '@/utils/zip';
import { decompileAndInspectJarAsync } from '@/utils/javaDecompiler';
import { convertJavaToBedrockAddon, type RemakeResult } from '@/utils/bedrockGenerator';
import { type BedrockVersionTarget, type BedrockExperimentConfig, autoConfigureExperimentsForMod } from '@/utils/bedrockCapabilityQuery';
import { GEYSER_VERSION_OPTIONS } from '@/utils/geyserVersionTable';
import { runRegressionSuite } from '@/utils/regressionSuite';
import { getArchiveBudget, pauseForUi, prioritizeArchiveEntries } from '@/utils/archiveScale';
import type { DecompileStats, RegressionSuiteReport } from '@/types/remaker';
import { InputPanel } from '@/components/InputPanel';
import { AnalysisPanel } from '@/components/AnalysisPanel';
import { TextureAuditPanel } from '@/components/TextureAuditPanel';
import { ParityGapPanel } from '@/components/ParityGapPanel';
import { MolangSandbox } from '@/components/MolangSandbox';
import { HudCustomizerPanel } from '@/components/HudCustomizerPanel';
import { BedrockHudPreviewOverlay } from '@/components/BedrockHudPreviewOverlay';
import { TexturePreviewComparison } from '@/components/TexturePreviewComparison';
import { CapabilityQueryPanel } from '@/components/CapabilityQueryPanel';
import { MotionSmoothingPanel } from '@/components/MotionSmoothingPanel';
import { BehaviorTranslationPanel } from '@/components/BehaviorTranslationPanel';
import { GeyserConfigPanel } from '@/components/GeyserConfigPanel';
import { ValidationDashboard } from '@/components/ValidationDashboard';
import { ModelPortPanel } from '@/components/ModelPortPanel';
import { exportAddonFile } from '@/utils/iosFileExport';
import { getAutoUpscaleLegacyTextures, setAutoUpscaleLegacyTextures } from '@/utils/pngUtils';

type Workspace = 'convert' | 'audit' | 'tools' | 'more';
type AppTab = 'deterministic' | 'auditor' | 'self_healing' | 'smoother' | 'parity' | 'behavior' | 'geyser' | 'validation' | 'models' | 'ai';
const workspaceTabs: Record<Workspace, { tab: AppTab; label: string }[]> = {
  convert: [{ tab: 'deterministic', label: 'Convert a mod' }],
  audit: [{ tab: 'auditor', label: 'Texture audit' }, { tab: 'models', label: 'Models & bones' }, { tab: 'parity', label: 'Parity gaps' }, { tab: 'behavior', label: 'Behavior report' }, { tab: 'validation', label: 'Validation' }],
  tools: [{ tab: 'self_healing', label: 'Repair overview' }, { tab: 'smoother', label: 'Motion smoothing' }],
  more: [{ tab: 'geyser', label: 'Geyser output' }],
};
const tabWorkspace: Record<AppTab, Workspace> = {
  deterministic: 'convert', auditor: 'audit', models: 'audit', parity: 'audit', behavior: 'audit', validation: 'audit',
  self_healing: 'tools', smoother: 'tools', ai: 'more', geyser: 'more',
};

export default function App() {
  const appName = 'JavaBE';
  const accent = '#B69CFF';
  const accent2 = '#D0C2FF';
  const bgColor = '#09090D';
  const hapticsEnabled = false;
  const configuredUpscaling = true;
  const configuredGeyser = false;
  const configuredGeyserVersion = '2.6.0';
  const [upscalingEnabled, setUpscalingEnabled] = useState(() => configuredUpscaling && getAutoUpscaleLegacyTextures());
  const [enableGeyser, setEnableGeyser] = useState(configuredGeyser);
  const [geyserVersion, setGeyserVersion] = useState(configuredGeyserVersion || GEYSER_VERSION_OPTIONS[0]);
  const [targetVersion, setTargetVersion] = useState<BedrockVersionTarget>('1.21.50');
  const [experimentConfig, setExperimentConfig] = useState<BedrockExperimentConfig>({ targetVersion: '1.21.50', enableBetaApis: true, enableCameras: true, enableCustomUi: true, enableVoxelShapes: true, enableUpcomingCreatorFeatures: true, enablePbr: false, enableScriptEval: false });
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>('convert');
  const [activeTab, setActiveTab] = useState<AppTab>('deterministic');
  const [brief, setBrief] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [entries, setEntries] = useState<ExtractedZipEntry[]>([]);
  const [stage, setStage] = useState<'idle' | 'analyzing' | 'generating' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [remake, setRemake] = useState<RemakeResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [showMolangSandbox, setShowMolangSandbox] = useState(false);
  const [isAutoHealing, setIsAutoHealing] = useState(false);
  const [geyserExporting, setGeyserExporting] = useState(false);
  const [regression, setRegression] = useState<RegressionSuiteReport | null>(null);
  const [regressionRunning, setRegressionRunning] = useState(false);
  // Archive scanning results live in state, never in the render body.
  const [inspectionStats, setInspectionStats] = useState<DecompileStats | null>(null);
  const { playSuccess, playWarning, playError } = useRemakerAudio({ soundVolume: 0.8, soundEnabled: true });

  // Log lines are buffered and flushed in batches. A large conversion emits thousands of lines,
  // and one state update per line re-renders the whole dashboard thousands of times — which on
  // a big archive is what made the page look frozen while it worked.
  const pendingLogs = useRef<string[]>([]);
  useEffect(() => {
    const flush = () => {
      if (pendingLogs.current.length === 0) return;
      const batch = pendingLogs.current.splice(0, pendingLogs.current.length);
      setLogs(previous => [...previous, ...batch].slice(-300));
    };
    const timer = window.setInterval(flush, 200);
    return () => window.clearInterval(timer);
  }, []);
  const appendLog = (line: string) => { pendingLogs.current.push(line); };

  useEffect(() => {
    if (!brief.trim() && entries.length === 0) return;
    const automatic = autoConfigureExperimentsForMod(brief, entries, targetVersion);
    setExperimentConfig(automatic.config);
    if (automatic.targetVersion !== targetVersion) setTargetVersion(automatic.targetVersion);
  }, [brief, entries, targetVersion]);

  // The archive is decompiled ONCE, inside the conversion — never during render. Running the
  // inspector from the render body meant every log line, tab switch and toggle re-decompiled a
  // modpack-sized archive on the main thread, which is what froze the page and eventually crashed
  // the tab. The UI now only reads the stats the conversion produced.
  const currentStats = inspectionStats ?? remake?.decompileStats ?? null;

  const switchWorkspace = (workspace: Workspace) => { setActiveWorkspace(workspace); setActiveTab(workspaceTabs[workspace][0].tab); };
  const switchTab = (tab: AppTab) => { setActiveTab(tab); setActiveWorkspace(tabWorkspace[tab]); };
  const handleReset = () => { pendingLogs.current = []; setStage('idle'); setError(null); setLogs([]); setRemake(null); setFile(null); setEntries([]); setBrief(''); setExportStatus(null); setRegression(null); setInspectionStats(null); };
  const handleGenerate = async (sourceFile: File | null = file, sourceEntries: ExtractedZipEntry[] = entries) => {
    if (!brief.trim() && sourceEntries.length === 0) return;
    const automatic = autoConfigureExperimentsForMod(brief, sourceEntries, targetVersion);
    setExperimentConfig(automatic.config);
    setTargetVersion(automatic.targetVersion);
    setStage('analyzing'); setError(null); setExportStatus(null);
    appendLog(`[INIT] Starting Java mod analysis for Bedrock ${automatic.targetVersion}.`);
    appendLog(`[SETTINGS] Texture resolution: ${upscalingEnabled ? 'legacy upscaling enabled' : 'original resolution preserved'}; Geyser output: ${enableGeyser ? `on (${geyserVersion})` : 'off'}.`);
    try {
      // Keep a very large archive inside the mobile budget before any scanning starts.
      const archiveBudget = getArchiveBudget();
      const budgeted = prioritizeArchiveEntries(sourceEntries, { maxEntries: archiveBudget.maxEntries, maxTotalBytes: archiveBudget.maxTotalBytes });
      if (budgeted.report.limited) appendLog(budgeted.report.summary);
      const workingEntries = budgeted.entries;
      let inspection;
      if (workingEntries.length > 0) {
        appendLog(`[SCAN] Inspecting ${workingEntries.length} archive entries for classes, metadata, models, and textures...`);
        // Let the browser paint the analysing state before the first long pass.
        await pauseForUi(60);
        // Bytecode inspection is walked in slices and hands the frame back between them, so a
        // modpack-sized archive keeps the page painting and the log advancing while it works
        // instead of freezing the tab until the scan finishes.
        let reportedClasses = 0;
        inspection = await decompileAndInspectJarAsync(workingEntries, sourceFile?.name || 'mod.jar', {
          onProgress: (done, total) => {
            if (total === 0) return;
            if (done < total && done - reportedClasses < 96) return;
            reportedClasses = done;
            appendLog(`[SCAN] Bytecode inspection ${done}/${total} classes — the interface stays responsive while this runs.`);
          },
        });
        setInspectionStats(inspection.stats);
        appendLog(`[SCAN] ${inspection.stats.modName} (${inspection.stats.version}): ${inspection.stats.classesCount} classes, ${inspection.stats.texturesCount} textures, ${inspection.stats.modelsCount} models.`);
        // Second frame hand-back before the conversion engine starts its own long passes.
        await pauseForUi(24);
      }
      setStage('generating'); appendLog('[BUILD] Converting supported content and validating the generated add-on...');
      const result = await convertJavaToBedrockAddon({ brief, fileName: sourceFile?.name || null, entries: workingEntries, decompileData: inspection, enableUpscaling: upscalingEnabled, targetVersion: automatic.targetVersion, experimentConfig: automatic.config, enableGeyser, geyserVersion, onLog: appendLog, onAutoRepairTrigger: () => setIsAutoHealing(true) });
      setIsAutoHealing(false); setRemake(result); setStage('ready'); playSuccess();
      appendLog('[DONE] Add-on is ready. Review validation and unsupported-content notes before testing in Minecraft.');
    } catch (err) {
      setIsAutoHealing(false); setStage('error');
      const message = err instanceof Error ? err.message : String(err);
      setError(message); playError(); appendLog(`[ERROR] ${message}`);
    }
  };
  const handleExport = async () => {
    if (!remake) return;
    setExporting(true); setExportStatus(null);
    try {
      const outcome = await exportAddonFile(remake.zipBytes, remake.fileName);
      setExportStatus(outcome.message); appendLog(`[EXPORT] ${outcome.message}`); playSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportStatus(`Export failed: ${message}`); appendLog(`[EXPORT ERROR] ${message}`); playError();
    } finally { setExporting(false); }
  };
  const handleExportGeyser = async () => {
    if (!remake?.geyserBundle) return;
    setGeyserExporting(true);
    try {
      const outcome = await exportAddonFile(remake.geyserBundle.zipBytes, remake.geyserBundle.fileName);
      appendLog(`[GEYSER:EXPORT] ${outcome.message}`); playSuccess();
    } catch (err) { appendLog(`[GEYSER:EXPORT ERROR] ${err instanceof Error ? err.message : String(err)}`); playError(); }
    finally { setGeyserExporting(false); }
  };
  const handleRunRegression = () => {
    setRegressionRunning(true);
    try {
      appendLog('[REGRESSION] Running built-in conversion checks...');
      const report = runRegressionSuite({ onLog: appendLog });
      setRegression(report); appendLog(`[REGRESSION] ${report.summary}`); playSuccess();
    } catch (err) { appendLog(`[REGRESSION:ERROR] ${err instanceof Error ? err.message : String(err)}`); playError(); }
    finally { setRegressionRunning(false); }
  };
  const modContext = currentStats ? `${currentStats.modName} (${currentStats.metadataFormat})\n${currentStats.classesCount} classes | ${currentStats.texturesCount} textures | ${currentStats.modelsCount} models` : brief || 'No mod loaded yet.';
  const audit = remake?.parityHealth?.fidelityAudit;
  const behaviorReport = audit?.behaviorTranslation ?? remake?.parityHealth?.behaviorTranslation;
  const validationReport = remake?.parityHealth?.validation ?? audit?.validation;
  const regressionReport = regression ?? remake?.parityHealth?.regression ?? undefined;
  const modelPortReport = remake?.parityHealth?.modelPort ?? audit?.modelPort;
  const skeletonReport = remake?.parityHealth?.skeletonReconciliation;
  const tabs = workspaceTabs[activeWorkspace];
  const updateUpscaling = (enabled: boolean) => { setUpscalingEnabled(enabled); setAutoUpscaleLegacyTextures(enabled); };

  return (
    <div className="javabe-app-shell min-h-screen w-full font-sans text-slate-100" style={{ '--app-accent': accent, '--app-accent-soft': accent2, '--app-bg': bgColor } as CSSProperties}>
      <div className="javabe-cosmic-backdrop" aria-hidden="true"><span className="javabe-cosmic-cloud javabe-cosmic-cloud--one" /><span className="javabe-cosmic-cloud javabe-cosmic-cloud--two" /><span className="javabe-cosmic-stars" /><span className="javabe-cosmic-horizon" /></div>
      <main className="javabe-app-content mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-3 px-3 pb-8 pt-3 sm:px-6 sm:pt-5">
        <header className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3 sm:p-4">
          <div className="flex min-w-0 items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-400/10"><Cpu className="h-5 w-5" style={{ color: accent }} /></div><div className="min-w-0"><h1 className="truncate text-base font-bold tracking-tight text-white">{appName}</h1><p className="text-xs text-slate-400">Drop a mod archive; JavaBE scans, configures and builds it automatically.</p></div></div>
          <div className="flex shrink-0 items-center gap-2"><button type="button" onClick={handleReset} className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-slate-700 text-slate-300 active:bg-slate-800" aria-label="Start over"><RotateCcw className="h-4 w-4" /></button></div>
        </header>

        <nav className="grid grid-cols-4 gap-1.5 rounded-2xl border border-slate-800 bg-slate-900/70 p-1.5" aria-label="Work areas">
          {([['convert', 'Convert'], ['audit', 'Review'], ['tools', 'Tools'], ['more', 'More']] as const).map(([workspace, label]) => <button key={workspace} type="button" onClick={() => switchWorkspace(workspace)} aria-pressed={activeWorkspace === workspace} className={`flex min-h-[60px] items-center justify-center gap-1.5 rounded-xl px-1.5 text-[11px] font-semibold transition active:scale-[0.98] sm:text-sm ${activeWorkspace === workspace ? 'bg-violet-400/15 text-violet-100 ring-1 ring-violet-300/30' : 'text-slate-400 active:bg-slate-800'}`}>{workspace === 'convert' ? <Cpu className="h-4 w-4 text-violet-300" /> : workspace === 'audit' ? <Activity className="h-4 w-4 text-violet-300" /> : workspace === 'tools' ? <Wrench className="h-4 w-4 text-violet-300" /> : <Sparkles className="h-4 w-4 text-violet-300" />}{label}</button>)}
        </nav>

        {tabs.length > 1 && <label className="flex min-h-[60px] items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3"><span className="shrink-0 text-xs font-medium text-slate-400">{activeWorkspace === 'audit' ? 'Review' : activeWorkspace === 'tools' ? 'Tools' : 'More'}</span><select value={activeTab} onChange={event => switchTab(event.target.value as AppTab)} className="min-h-[48px] w-full bg-transparent text-sm font-semibold text-slate-100 outline-none">{tabs.map(item => <option key={item.tab} value={item.tab} className="bg-slate-900">{item.label}</option>)}</select></label>}

        {activeWorkspace === 'convert' && <>
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3.5 sm:p-5"><InputPanel value={brief} file={file} entries={entries} upscalingEnabled={upscalingEnabled} onChange={setBrief} onFileLoaded={(newFile, newEntries) => { setFile(newFile); setEntries(newEntries); setStage('idle'); setRemake(null); setError(null); setExportStatus(null); setInspectionStats(null); if (newFile) appendLog(`[SCAN] ${newFile.name} loaded; conversion options are inferred from its contents.`); if (newFile && newEntries.length > 0) void handleGenerate(newFile, newEntries); }} onGenerate={() => void handleGenerate()} onUpscalingChange={updateUpscaling} generating={stage === 'analyzing' || stage === 'generating'} accent={accent} /></section>
          {entries.length > 0 && <TexturePreviewComparison entries={entries} upscalingEnabled={upscalingEnabled} />}
          {stage === 'ready' && remake && <section className="flex flex-col gap-3 rounded-2xl border border-emerald-700/40 bg-emerald-950/20 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold text-white">{remake.name}</h2><p className="text-xs text-slate-400">Bedrock add-on ready to download</p></div><span className="max-w-full truncate font-mono text-[10px] text-emerald-200">{remake.fileName}</span></div><p className="text-xs leading-relaxed text-slate-300">Review validation and unsupported-content notes before importing. Conversion results can still require in-game testing.</p><button type="button" onClick={() => void handleExport()} disabled={exporting} className="flex min-h-[60px] items-center justify-center gap-2 rounded-xl bg-violet-300 px-4 text-sm font-bold text-slate-950 active:scale-[0.99] disabled:opacity-50"><Download className="h-5 w-5" />{exporting ? 'Preparing download…' : 'Download Bedrock add-on'}</button>{exportStatus && <p aria-live="polite" className="text-xs text-emerald-200">{exportStatus}</p>}{validationReport && <button type="button" onClick={() => switchTab('validation')} className="min-h-[52px] rounded-xl border border-slate-700 px-3 text-xs font-semibold text-slate-200 active:bg-slate-800">Review validation · {validationReport.repairedCount} repaired · {validationReport.errorCount} unresolved</button>}</section>}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/55 p-3.5 sm:p-4"><AnalysisPanel stage={stage} error={error} accent={accent2} decompileStats={currentStats || remake?.decompileStats} translationStatus={remake?.translationStatus} logs={logs} parityHealth={remake?.parityHealth} isAutoHealing={isAutoHealing} /></section>
          <details className="rounded-2xl border border-slate-800 bg-slate-900/50"><summary className="flex min-h-[60px] cursor-pointer items-center gap-2 px-4 text-sm font-semibold text-slate-200"><Sliders className="h-4 w-4 text-violet-300" />Advanced target and compatibility</summary><div className="border-t border-slate-800 p-3"><CapabilityQueryPanel accent={accent} targetVersion={targetVersion} onTargetVersionChange={version => { setTargetVersion(version); setExperimentConfig(previous => ({ ...previous, targetVersion: version })); }} experimentConfig={experimentConfig} onExperimentConfigChange={setExperimentConfig} brief={brief} entries={entries} /></div></details>
          <label className="flex min-h-[56px] items-center justify-between rounded-xl border border-slate-800 bg-slate-900/40 px-4 text-xs text-slate-300"><span>Upscale legacy textures</span><input type="checkbox" checked={upscalingEnabled} onChange={event => updateUpscaling(event.target.checked)} className="h-5 w-5 accent-violet-400" /></label>
        </>}


        {activeWorkspace === 'tools' && <button type="button" onClick={() => setShowMolangSandbox(true)} className="flex min-h-[54px] items-center justify-center gap-2 rounded-xl border border-violet-400/25 bg-violet-400/[0.07] px-4 text-sm font-semibold text-violet-100 active:bg-violet-400/15"><Activity className="h-4 w-4" />Open expression lab</button>}
        {activeTab === 'auditor' && <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><TextureAuditPanel remake={remake} accent={accent} onReport={lines => lines.forEach(appendLog)} playSuccess={playSuccess} playWarning={playWarning} /></div>}
        {activeTab === 'models' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 sm:p-4">
            <ModelPortPanel
              report={modelPortReport}
              accent={accent}
              resourcePackFiles={remake?.resourcePackFiles}
              skeleton={skeletonReport}
            />
          </div>
        )}
        {activeTab === 'parity' && <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"><ParityGapPanel analysis={audit?.parityGapAnalysis} /></div>}
        {activeTab === 'behavior' && <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"><BehaviorTranslationPanel report={behaviorReport} accent={accent} /></div>}
        {activeTab === 'validation' && <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 sm:p-4"><ValidationDashboard validation={validationReport} regression={regressionReport} accent={accent} runningRegression={regressionRunning} onRunRegression={handleRunRegression} /></div>}
        {activeTab === 'smoother' && <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><MotionSmoothingPanel motionSmoothing={remake?.motionSmoothing} accent={accent} /></div>}
        {activeTab === 'self_healing' && <div className="flex flex-col gap-3"><section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><div className="flex items-center gap-2"><Wrench className="h-4 w-4 text-violet-300" /><h2 className="text-sm font-bold">Automatic repair report</h2></div><p className="mt-2 text-xs leading-relaxed text-slate-400">Repairs and unresolved issues found during conversion appear in the conversion report. Content is not treated as verified until tested in-game.</p></section><BedrockHudPreviewOverlay accent={accent} /><HudCustomizerPanel accent={accent} hapticsEnabled={hapticsEnabled} onApplied={appendLog} /><section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4"><AnalysisPanel stage={stage} error={error} accent={accent2} decompileStats={currentStats || remake?.decompileStats} translationStatus={remake?.translationStatus} logs={logs} parityHealth={remake?.parityHealth} isAutoHealing={isAutoHealing} /></section></div>}
        {activeTab === 'geyser' && <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"><GeyserConfigPanel enabled={enableGeyser} geyserVersion={geyserVersion} versionOptions={GEYSER_VERSION_OPTIONS} targetVersion={targetVersion} report={remake?.geyser} exporting={geyserExporting} hasBundle={Boolean(remake?.geyserBundle)} accent={accent} onToggle={enabled => { setEnableGeyser(enabled); appendLog(enabled ? '[GEYSER] Optional output enabled.' : '[GEYSER] Optional output disabled.'); }} onVersionChange={setGeyserVersion} onExport={() => void handleExportGeyser()} /></div>}
        {showMolangSandbox && <MolangSandbox initialExpression="query.is_moving ? 1.0 : 0.0" onClose={() => setShowMolangSandbox(false)} />}
      </main>
    </div>
  );
}