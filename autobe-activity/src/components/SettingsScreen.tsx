import React, { useState } from 'react';
import {
  Settings2,
  Gamepad2,
  UploadCloud,
  GitMerge,
  Radio,
  Wrench,
  Info,
  ShieldCheck,
  Zap,
  HardDrive,
  AlertTriangle,
  FileText,
  Lock,
  ListChecks,
  Package,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Code2,
  FolderArchive,
  Puzzle,
  Eraser
} from 'lucide-react';
import { aippyTweaks } from '@aippy/runtime/tweaks';
import tweaksConfig from '@/config/tweaksConfig.json';
import {
  isCompatibilityPatcherEnabled,
  hasStoredPatcherPreference,
  setCompatibilityPatcherEnabled,
  getPatchReport,
  clearPatchReport,
  PatchEntry
} from '@/utils/extendedbe/universalCompatibilityPatcher';
import { useSFX } from '@/hooks/useSFX';

const tweaks = aippyTweaks(tweaksConfig);
import { buildProjectArchive, ExportResult } from '@/utils/projectExport';
import { buildCodebaseArchive, CodebaseExportResult } from '@/utils/codebaseExport';
import { CodebasePasswordModal } from '@/components/CodebasePasswordModal';
import { createPersistentDownload, downloadBlob } from '@/utils/download';
import { useModpackAudio } from '@/hooks/useModpackAudio';

interface SettingsScreenProps {
  autoMerge: boolean;
  onToggleAutoMerge: () => void;
  keepOriginals: boolean;
  onToggleKeepOriginals: () => void;
  onOpenAbout: () => void;
  onOpenToS: () => void;
  onOpenPrivacy: () => void;
  onOpenPackExtract: () => void;
  onOpenListMaker: () => void;
  onClearDemoData: () => void;
}

type SettingsCategory =
  | 'general'
  | 'minecraft'
  | 'files'
  | 'merge'
  | 'integrations'
  | 'advanced'
  | 'compatibility'
  | 'about';

const SETTINGS_CATEGORIES: { id: SettingsCategory; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Settings2 className="w-4 h-4" /> },
  { id: 'minecraft', label: 'Minecraft', icon: <Gamepad2 className="w-4 h-4" /> },
  { id: 'files', label: 'Imports & Files', icon: <UploadCloud className="w-4 h-4" /> },
  { id: 'merge', label: 'Merge Engine', icon: <GitMerge className="w-4 h-4" /> },
  { id: 'integrations', label: 'Integrations', icon: <Radio className="w-4 h-4" /> },
  { id: 'advanced', label: 'Advanced', icon: <Wrench className="w-4 h-4" /> },
  { id: 'compatibility', label: 'Compatibility', icon: <Puzzle className="w-4 h-4" /> },
  { id: 'about', label: 'About', icon: <Info className="w-4 h-4" /> }
];

const SettingRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  sub: string;
  right?: React.ReactNode;
  onClick?: () => void;
}> = ({ icon, title, sub, right, onClick }) => {
  const content = (
    <>
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[#A855F7] shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="text-xs sm:text-sm font-semibold text-white">{title}</div>
          <div className="text-[11px] text-[#AAA3BB] leading-tight mt-0.5">{sub}</div>
        </div>
      </div>
      {right}
    </>
  );

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between p-3.5 rounded-xl bg-[#100D18] border border-[#30263F] hover:border-[#762BFF]/50 transition-all text-left active:scale-[0.99]"
    >
      {content}
    </button>
  ) : (
    <div className="w-full flex items-center justify-between p-3.5 rounded-xl bg-[#100D18] border border-[#30263F]">
      {content}
    </div>
  );
};

const SwitchToggle: React.FC<{ on: boolean; onClick: () => void; label: string }> = ({
  on,
  onClick,
  label
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-10 h-5 shrink-0 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${
      on ? 'bg-[#762BFF]' : 'bg-[#15111F] border border-[#30263F]'
    }`}
    aria-label={`Toggle ${label}`}
  >
    <div
      className={`bg-white w-4 h-4 rounded-full shadow transition-transform ${
        on ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  autoMerge,
  onToggleAutoMerge,
  keepOriginals,
  onToggleKeepOriginals,
  onOpenAbout,
  onOpenToS,
  onOpenPrivacy,
  onOpenPackExtract,
  onOpenListMaker,
  onClearDemoData
}) => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const [confirmReset, setConfirmReset] = useState(false);
  const [targetBedrockVersion, setTargetBedrockVersion] = useState('1.20+');
  const [exportState, setExportState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [codebaseState, setCodebaseState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [codebaseResult, setCodebaseResult] = useState<CodebaseExportResult | null>(null);
  const [codebaseUrl, setCodebaseUrl] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const { playSuccess, playError, playSyncChime } = useModpackAudio();
  const { playToggleOn, playToggleOff } = useSFX();
  const patcherDefault = tweaks.compatibilityPatcher.useState();
  const [patcherEnabled, setPatcherEnabled] = useState<boolean | null>(null);
  const [patchLog, setPatchLog] = useState<PatchEntry[]>(() => getPatchReport());
  const patcherActive =
    patcherEnabled ??
    (hasStoredPatcherPreference() ? isCompatibilityPatcherEnabled() : patcherDefault);

  const handleTogglePatcher = async () => {
    const next = !patcherActive;
    setPatcherEnabled(next);
    setCompatibilityPatcherEnabled(next);
    if (next) {
      await playToggleOn();
    } else {
      await playToggleOff();
    }
    setPatchLog(getPatchReport());
  };

  const handleClearPatchLog = () => {
    clearPatchReport();
    setPatchLog([]);
  };

  const handleExportCodebase = async (password: string) => {
    if (codebaseState === 'working') return;
    setCodebaseState('working');
    setCodebaseResult(null);
    if (codebaseUrl) {
      URL.revokeObjectURL(codebaseUrl);
      setCodebaseUrl(null);
    }
    try {
      const result = await buildCodebaseArchive(password);
      const persistent = createPersistentDownload(result.blob, result.fileName);
      setCodebaseUrl(persistent.url);
      setCodebaseResult(result);
      setCodebaseState('done');
      await playSyncChime();

      // Try Discord native sharing first (bypasses iframe sandbox)
      const accessToken = sessionStorage.getItem('discord_access_token');
      const applicationId = sessionStorage.getItem('discord_application_id');

      if (accessToken && applicationId) {
        try {
          const { shareViaDiscordCDN } = await import('../utils/codebaseExport');
          const { cdnUrl } = await shareViaDiscordCDN(result.blob, result.fileName, accessToken, applicationId);
          setTimeout(() => setCodebaseState('idle'), 10000);
          return;
        } catch (discordError) {
          console.warn('[Aippy] Discord CDN share failed, falling back to manual panel:', discordError);
        }
      }

      // Fallback to manual save panel if Discord sharing fails
      const { showManualSavePanel } = await import('../utils/download');
      const lastCdnUrl = sessionStorage.getItem('last_download_url');
      showManualSavePanel(result.blob, result.fileName, lastCdnUrl || undefined);
      setTimeout(() => setCodebaseState('idle'), 10000);
    } catch (e) {
      console.error('[Aippy] Codebase export failed:', e);
      setCodebaseState('error');
      await playError();
      setTimeout(() => setCodebaseState('idle'), 8000);
    }
  };

  const handleExportProject = async () => {
    if (exportState === 'working') return;
    setExportState('working');
    setExportResult(null);
    if (exportUrl) {
      URL.revokeObjectURL(exportUrl);
      setExportUrl(null);
    }
    try {
      const result = await buildProjectArchive();
      downloadBlob(result.blob, result.fileName);
      // Keep a persistent link so the archive can be re-downloaded manually
      // if the automatic download is interrupted on mobile.
      setExportUrl(createPersistentDownload(result.blob, result.fileName).url);
      setExportResult(result);
      setExportState('done');
      await playSuccess();
      setTimeout(() => setExportState('idle'), 8000);
    } catch (e) {
      console.error('[Aippy] Project export failed:', e);
      setExportState('error');
      await playError();
      setTimeout(() => setExportState('idle'), 8000);
    }
  };

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    setConfirmReset(false);
    onClearDemoData();
  };

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-hidden">
      {/* Settings Top Bar */}
      <div className="px-4 sm:px-6 py-4 border-b border-[#30263F]/70 bg-[#100D18]">
        <h1 className="text-base sm:text-lg font-bold text-white">Settings & Studio Preferences</h1>
        <p className="text-xs text-[#AAA3BB] mt-0.5">
          Configure merger behaviors, Minecraft version targets, and storage options
        </p>

        {/* Categories scrollable pill bar */}
        <div className="flex gap-1.5 overflow-x-auto pt-3 pb-1 -mx-1 px-1">
          {SETTINGS_CATEGORIES.map((c) => {
            const isActive = activeCategory === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCategory(c.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-[#762BFF] text-white shadow-[0_0_10px_rgba(118,43,255,0.3)]'
                    : 'bg-[#15111F] text-[#AAA3BB] hover:text-white border border-[#30263F]'
                }`}
              >
                {c.icon}
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content panel */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-28 space-y-3 max-w-3xl mx-auto w-full">
        {activeCategory === 'general' && (
          <>
            <SettingRow
              icon={<Zap className="w-5 h-5 text-[#A855F7]" />}
              title="Automatic Conflict Resolution"
              sub="Automatically prefix colliding identifiers to prevent overwriting content"
              right={<SwitchToggle on={autoMerge} onClick={onToggleAutoMerge} label="Auto Merge" />}
            />
            <SettingRow
              icon={<ShieldCheck className="w-5 h-5 text-[#A855F7]" />}
              title="Retain Source Packs"
              sub="Keep individual input addons in the library after building modpack"
              right={<SwitchToggle on={keepOriginals} onClick={onToggleKeepOriginals} label="Keep Originals" />}
            />
            <div className="p-3 rounded-xl bg-[#100D18] border border-[#30263F] text-xs text-[#AAA3BB] leading-relaxed">
              <strong className="text-white">Live Persistence:</strong> All preferences are saved immediately in client storage and survive page reloads.
            </div>
          </>
        )}

        {activeCategory === 'minecraft' && (
          <>
            <div className="p-3.5 rounded-xl bg-[#100D18] border border-[#30263F] space-y-2">
              <div className="text-xs font-bold text-white uppercase tracking-wider">
                Target Bedrock Edition Version
              </div>
              <p className="text-xs text-[#AAA3BB]">
                AutoBE calculates the highest minimum engine version required by all included manifests.
              </p>
              <div className="grid grid-cols-3 gap-2 pt-1">
                {['1.20+', '1.21.0+', '1.21.50 (Latest)'].map((ver) => (
                  <button
                    key={ver}
                    type="button"
                    onClick={() => setTargetBedrockVersion(ver)}
                    className={`py-2 px-2 rounded-lg text-xs font-semibold border transition-all text-center ${
                      targetBedrockVersion === ver
                        ? 'bg-[#762BFF] text-white border-[#A855F7]'
                        : 'bg-[#15111F] text-[#AAA3BB] border-[#30263F] hover:text-white'
                    }`}
                  >
                    {ver}
                  </button>
                ))}
              </div>
            </div>

            <SettingRow
              icon={<Gamepad2 className="w-5 h-5 text-[#A855F7]" />}
              title="Bedrock Manifest Format"
              sub="Standard format_version: 2 with deterministic UUID regeneration"
              right={<span className="text-xs font-mono text-emerald-400 font-bold">Standard v2</span>}
            />
          </>
        )}

        {activeCategory === 'files' && (
          <>
            <SettingRow
              icon={<HardDrive className="w-5 h-5 text-[#A855F7]" />}
              title="Supported File Extensions"
              sub=".mcpack, .mcaddon, and .zip archives parsed with JSZip"
              right={<span className="text-xs font-mono text-[#AAA3BB]">All Valid</span>}
            />
            <SettingRow
              icon={<UploadCloud className="w-5 h-5 text-[#A855F7]" />}
              title="Folder Import Mode"
              sub="Directory picker enabled for Chromium / WebKit file systems"
              right={<span className="text-xs font-mono text-emerald-400">Supported</span>}
            />
            <SettingRow
              icon={<Package className="w-5 h-5 text-[#A855F7]" />}
              title="Pack Extraction Tool"
              sub="Convert directories to .mcpack or extract files"
              right={<span className="text-xs text-[#A855F7]">Open Tool →</span>}
              onClick={onOpenPackExtract}
            />
            <SettingRow
              icon={<ListChecks className="w-5 h-5 text-[#A855F7]" />}
              title="Addon List Generator"
              sub="Generate formatted markdown/text lists of installed addons"
              right={<span className="text-xs text-[#A855F7]">Open Tool →</span>}
              onClick={onOpenListMaker}
            />
            <SettingRow
              icon={<FolderArchive className="w-5 h-5 text-[#A855F7]" />}
              title="Download App Codebase"
              sub="Export all real files, server functions and configs for this web app"
              right={<span className="text-xs text-[#A855F7]">Download ZIP →</span>}
              onClick={() => setActiveCategory('advanced')}
            />
          </>
        )}

        {activeCategory === 'merge' && (
          <>
            <div className="p-3.5 rounded-xl bg-[#100D18] border border-[#30263F] space-y-2">
              <div className="text-xs font-bold text-white uppercase tracking-wider">
                Deep Merge JSON Registries
              </div>
              <p className="text-xs text-[#AAA3BB] leading-relaxed">
                Textures, sounds, and terrain definitions (<code className="text-purple-300">item_texture.json</code>, <code className="text-purple-300">terrain_texture.json</code>, <code className="text-purple-300">sounds.json</code>) are merged at the object key level so no custom items are lost.
              </p>
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold pt-1">
                <ShieldCheck className="w-4 h-4" />
                <span>Deep Merge Enabled</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#100D18] border border-[#30263F] space-y-2">
              <div className="text-xs font-bold text-white uppercase tracking-wider">
                Script API Isolation
              </div>
              <p className="text-xs text-[#AAA3BB] leading-relaxed">
                When packs use different @minecraft/server versions, AutoBE isolates them into separate behavior packs so scripts do not crash the runtime engine.
              </p>
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold pt-1">
                <ShieldCheck className="w-4 h-4" />
                <span>Script API Version Splitter Active</span>
              </div>
            </div>
          </>
        )}

        {activeCategory === 'integrations' && (
          <>
            <div className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  On-Device Runtime
                </span>
                <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Active
                </span>
              </div>
              <p className="text-xs text-[#AAA3BB] leading-relaxed">
                AutoBE runs entirely on your device with responsive layout adjustments for narrow mobile or wide desktop screens. No account or external service is required.
              </p>
            </div>

            <SettingRow
              icon={<GitMerge className="w-5 h-5 text-[#A855F7]" />}
              title="MCPacker Merge Engine"
              sub="Legacy Python pack-merging logic, ported to on-device TypeScript"
              right={<span className="text-xs font-mono text-emerald-400 font-bold">Enabled</span>}
            />
            <SettingRow
              icon={<HardDrive className="w-5 h-5 text-[#A855F7]" />}
              title="Storage Backend"
              sub="All packs, modpacks and preferences persist in IndexedDB"
              right={<span className="text-xs font-mono text-emerald-400 font-bold">IndexedDB</span>}
            />
            <SettingRow
              icon={<Radio className="w-5 h-5 text-[#A855F7]" />}
              title="External Connections"
              sub="No Discord, accounts, or network services are used by this app"
              right={<span className="text-xs font-mono text-[#AAA3BB]">None</span>}
            />
          </>
        )}

        {activeCategory === 'advanced' && (
          <>
            {/* 1. App Full Codebase Download */}
            <div className="p-4 rounded-xl bg-gradient-to-b from-[#15111F] to-[#100D18] border border-[#762BFF]/60 shadow-[0_0_20px_rgba(118,43,255,0.15)] space-y-3">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-lg bg-[#762BFF]/20 text-[#A855F7] border border-[#762BFF]/30 shrink-0">
                  <Code2 className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                    <span>Download Entire App Codebase</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                      All Files & Folders
                    </span>
                  </div>
                  <div className="text-[11px] text-[#AAA3BB] leading-tight mt-0.5">
                    Download all real files and directories of this AutoBE app (src/, functions/, public/, configs, package.json) into a complete, standalone project zip.
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowPasswordModal(true)}
                disabled={codebaseState === 'working'}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all active:scale-[0.98] ${
                  codebaseState === 'working'
                    ? 'bg-[#15111F] text-[#AAA3BB] border border-[#30263F] cursor-wait'
                    : 'bg-[#762BFF] text-white border border-[#A855F7] hover:brightness-110 disabled:opacity-60 shadow-[0_0_12px_rgba(118,43,255,0.35)]'
                }`}
              >
                {codebaseState === 'working' && <Loader2 className="w-4 h-4 animate-spin" />}
                {codebaseState === 'idle' && <Download className="w-4 h-4" />}
                {codebaseState === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                {codebaseState === 'error' && <XCircle className="w-4 h-4 text-red-400" />}
                {codebaseState === 'working'
                  ? 'Packaging App Files & Folders...'
                  : codebaseState === 'done'
                    ? 'App Codebase Downloaded'
                    : codebaseState === 'error'
                      ? 'Export Failed — Tap to Retry'
                      : 'Download Entire App Codebase (ZIP)'}
              </button>

              {codebaseState === 'working' && (
                <div className="w-full h-1.5 rounded-full bg-[#2A2440] overflow-hidden">
                  <div
                    className="h-full w-1/3 rounded-full bg-gradient-to-r from-[#762BFF] to-[#A855F7]"
                    style={{ animation: 'dl-slide 1.1s ease-in-out infinite' }}
                  />
                </div>
              )}

              {codebaseState === 'done' && codebaseResult && (
                <div className="rounded-lg bg-[#08070D] border border-[#762BFF]/40 p-3 space-y-1.5">
                  <div className="text-[11px] font-semibold text-emerald-400">
                    {codebaseResult.fileName} · {(codebaseResult.blob.size / 1024).toFixed(0)} KB
                  </div>
                  <div className="text-[11px] text-[#AAA3BB]">
                    {codebaseResult.fileCount} application files & directories packaged successfully.
                  </div>
                  {codebaseUrl && (
                    <a
                      href={codebaseUrl}
                      download={codebaseResult.fileName}
                      className="block text-center mt-2 py-2 rounded-lg bg-[#15111F] border border-[#762BFF]/50 text-[11px] font-bold text-[#A855F7] active:scale-[0.98] transition-transform"
                    >
                      Download didn't complete? Tap here to save codebase zip again
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* 2. Workspace Packs & Modpacks Export */}
            <div className="p-3.5 rounded-xl bg-[#100D18] border border-[#30263F] space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-[#A855F7] shrink-0"><Download className="w-5 h-5" /></span>
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-semibold text-white">Export Workspace Addons & Modpacks</div>
                  <div className="text-[11px] text-[#AAA3BB] leading-tight mt-0.5">
                    Download a backup of your Bedrock workspace: imported packs, saved modpack outputs, and project index — packed into an archive.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleExportProject}
                disabled={exportState === 'working'}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all active:scale-[0.98] ${
                  exportState === 'working'
                    ? 'bg-[#15111F] text-[#AAA3BB] border border-[#30263F] cursor-wait'
                    : 'bg-[#15111F] text-[#AAA3BB] border border-[#30263F] hover:text-white hover:border-[#762BFF]/50 disabled:opacity-60'
                }`}
              >
                {exportState === 'working' && <Loader2 className="w-4 h-4 animate-spin" />}
                {exportState === 'idle' && <Download className="w-4 h-4" />}
                {exportState === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                {exportState === 'error' && <XCircle className="w-4 h-4 text-red-400" />}
                {exportState === 'working'
                  ? 'Generating Archive...'
                  : exportState === 'done'
                    ? 'Workspace Exported'
                    : exportState === 'error'
                      ? 'Export Failed — Tap to Retry'
                      : 'Export Workspace Addons & Packs'}
              </button>

              {exportState === 'done' && exportResult && (
                <div className="rounded-lg bg-[#08070D] border border-[#30263F] p-3 space-y-1.5">
                  <div className="text-[11px] font-semibold text-emerald-400">
                    {exportResult.fileName} · {(exportResult.blob.size / 1024).toFixed(0)} KB
                  </div>
                  <div className="text-[11px] text-[#AAA3BB]">
                    {exportResult.packCount} pack{exportResult.packCount === 1 ? '' : 's'} and {exportResult.modpackCount} modpack{exportResult.modpackCount === 1 ? '' : 's'} included. Integrity check passed.
                  </div>
                  {exportResult.warnings.length > 0 && (
                    <div className="text-[11px] text-amber-400 leading-relaxed">
                      {exportResult.warnings.map((w, i) => (
                        <div key={i}>• {w}</div>
                      ))}
                    </div>
                  )}
                  {exportUrl && (
                    <a
                      href={exportUrl}
                      download={exportResult.fileName}
                      className="block text-center mt-2 py-2 rounded-lg bg-[#15111F] border border-[#762BFF]/50 text-[11px] font-bold text-[#A855F7] active:scale-[0.98] transition-transform"
                    >
                      Download didn't complete? Tap here to save the archive again
                    </a>
                  )}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-[#30263F]/70">
              <button
                type="button"
                onClick={handleReset}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border text-xs font-bold transition-all active:scale-[0.98] ${
                  confirmReset
                    ? 'bg-red-600 border-red-400 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]'
                    : 'border-red-500/30 bg-red-950/20 text-red-300 hover:bg-red-950/40'
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                {confirmReset ? 'Tap again to permanently reset data' : 'Reset Storage & Clear All Data'}
              </button>
              <p className="text-[10px] text-[#716885] text-center mt-1.5">
                Permanently wipes all cached addon packs and merged modpacks from IndexedDB.
              </p>
            </div>
          </>
        )}

        {activeCategory === 'compatibility' && (
          <>
            <div
              className={`p-4 rounded-xl border space-y-3 transition-all ${
                patcherActive
                  ? 'bg-[#100D18] border-[#762BFF]/60 shadow-[0_0_18px_rgba(118,43,255,0.15)]'
                  : 'bg-[#100D18] border-[#30263F]'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`p-2 rounded-lg border shrink-0 ${
                      patcherActive
                        ? 'bg-[#762BFF]/20 text-[#A855F7] border-[#762BFF]/30'
                        : 'bg-[#15111F] text-[#716885] border-[#30263F]'
                    }`}
                  >
                    <Puzzle className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-bold text-white">
                      ExtendedBE Compatibility Patcher
                    </div>
                    <div className="text-[11px] text-[#AAA3BB] leading-tight mt-0.5">
                      Automatically restores missing materials, textures, geometry and animations from source packs
                    </div>
                  </div>
                </div>
                <SwitchToggle on={patcherActive} onClick={handleTogglePatcher} label="Compatibility Patcher" />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span
                  className={`flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full border ${
                    patcherActive
                      ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                      : 'text-[#716885] border-[#30263F] bg-[#15111F]'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      patcherActive ? 'bg-emerald-400 animate-pulse' : 'bg-[#716885]'
                    }`}
                  />
                  {patcherActive ? 'Active' : 'Inactive'}
                </span>
                <span className="text-[11px] text-[#716885]">
                  {patcherActive ? 'Fixes apply during the next merge' : 'Merges run without automatic patching'}
                </span>
              </div>
            </div>

            {/* Patch log */}
            <div className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-white uppercase tracking-wider">
                  Patch Log
                </div>
                <button
                  type="button"
                  onClick={handleClearPatchLog}
                  disabled={patchLog.length === 0}
                  className="flex items-center gap-1 text-[11px] font-semibold text-[#A855F7] disabled:text-[#716885] disabled:cursor-default active:scale-95 transition-transform"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  Clear
                </button>
              </div>
              {patchLog.length === 0 ? (
                <p className="text-[11px] text-[#AAA3BB] leading-relaxed">
                  No fixes recorded yet. When the patcher restores missing data during a merge, each fix appears here for transparency and debugging.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-lg bg-[#08070D] border border-[#30263F] divide-y divide-[#30263F]/60">
                  {patchLog.map((entry, i) => (
                    <div key={i} className="px-3 py-2 flex items-start gap-2">
                      <span className="text-[10px] font-mono font-bold text-[#A855F7] shrink-0 mt-0.5">
                        {entry.type}
                      </span>
                      <span className="text-[11px] text-[#AAA3BB] break-all leading-tight">
                        {entry.section ?? entry.animation ?? entry.controller ?? entry.texture ?? 'format_version'}
                        <span className="text-[#716885]"> — {entry.file}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 rounded-xl bg-[#100D18] border border-[#30263F] text-xs text-[#AAA3BB] leading-relaxed">
              <strong className="text-white">Safe by design:</strong> the patcher never removes data — it only restores missing critical sections from the original source packs. It can be toggled off at any time.
            </div>
          </>
        )}

        {activeCategory === 'about' && (
          <>
            <div className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-white">AutoBE Studio</div>
                <div className="text-xs text-[#AAA3BB] mt-0.5">Developed by StoneByte</div>
              </div>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-[#762BFF]/20 text-[#A855F7] border border-[#762BFF]/30">
                v2.3.0
              </span>
            </div>

            <SettingRow
              icon={<Info className="w-5 h-5 text-[#A855F7]" />}
              title="About AutoBE"
              sub="Studio mission, architecture and community links"
              right={<span className="text-xs text-[#AAA3BB]">→</span>}
              onClick={onOpenAbout}
            />

            <SettingRow
              icon={<FileText className="w-5 h-5 text-[#A855F7]" />}
              title="Terms of Service"
              sub="Usage guidelines and intellectual property"
              right={<span className="text-xs text-[#AAA3BB]">→</span>}
              onClick={onOpenToS}
            />

            <SettingRow
              icon={<Lock className="w-5 h-5 text-[#A855F7]" />}
              title="Privacy Policy"
              sub="Local-first sandbox privacy guarantee"
              right={<span className="text-xs text-[#AAA3BB]">→</span>}
              onClick={onOpenPrivacy}
            />
          </>
        )}

        <CodebasePasswordModal
          open={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
          onUnlock={(password) => handleExportCodebase(password)}
        />
      </div>
    </div>
  );
};