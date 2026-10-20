import React from 'react';
import { AppSettings } from '@/utils/settings';
import { VerificationState } from '@/types/modpack';
import { maskDeviceId } from '@/utils/deviceFingerprint';
import { APP_VERSION, compareSemver } from '@/utils/verification';

interface SettingsScreenProps {
  settings: AppSettings;
  onToggle: (key: keyof AppSettings) => void;
  onOpenAbout: () => void;
  onOpenToS: () => void;
  onOpenPrivacy: () => void;
  onOpenPackExtract: () => void;
  onOpenListMaker: () => void;
  onExportCodebase: () => void;
  onClearData: () => void;
  onResetVerification: () => void;
  exporting?: boolean;
  verification: VerificationState | null;
}

interface RowProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
}

const Row: React.FC<RowProps> = ({ icon, title, subtitle, trailing }) => (
  <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20">
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-9 h-9 rounded-xl bg-purple-950/60 border border-purple-500/30 flex items-center justify-center text-purple-300 flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0 pr-1">
        <div className="text-sm font-bold text-white">{title}</div>
        {subtitle && <div className="text-[11px] text-zinc-400 leading-tight">{subtitle}</div>}
      </div>
    </div>
    {trailing}
  </div>
);

const Toggle: React.FC<{ on: boolean; onClick: () => void; label: string }> = ({
  on,
  onClick,
  label
}) => (
  <button
    type="button"
    onClick={onClick}
    role="switch"
    aria-checked={on}
    aria-label={label}
    className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors flex-shrink-0 ${
      on ? 'bg-purple-600' : 'bg-zinc-800'
    }`}
  >
    <div
      className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
        on ? 'translate-x-6' : 'translate-x-0'
      }`}
    />
  </button>
);

const Chevron: React.FC = () => (
  <svg className="w-4 h-4 text-zinc-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  settings,
  onToggle,
  onOpenAbout,
  onOpenToS,
  onOpenPrivacy,
  onOpenPackExtract,
  onOpenListMaker,
  onExportCodebase,
  onClearData,
  onResetVerification,
  exporting,
  verification
}) => {
  const updateAvailable =
    verification?.latestVersion && compareSemver(APP_VERSION, verification.latestVersion) < 0;

  return (
    <div className="flex flex-col h-full bg-[#07050F] text-white select-none px-5 pt-3 pb-24 overflow-y-auto">
      <h1 className="text-xl font-bold text-white mb-4">Settings</h1>

      {/* Merging */}
      <div className="space-y-2 mb-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-purple-300">
          Merging
        </h2>

        <Row
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
          title="Auto Merge Conflicts"
          subtitle="Namespace-prefix duplicate identifiers without reviewing them"
          trailing={
            <Toggle
              on={settings.autoMergeConflicts}
              onClick={() => onToggle('autoMergeConflicts')}
              label="Toggle Auto Merge"
            />
          }
        />

        <Row
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
          title="Keep Originals"
          subtitle="Keep imported addons in your library after a merge"
          trailing={
            <Toggle
              on={settings.keepOriginals}
              onClick={() => onToggle('keepOriginals')}
              label="Toggle Keep Originals"
            />
          }
        />
      </div>

      {/* Feedback */}
      <div className="space-y-2 mb-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-purple-300">
          Feedback
        </h2>

        <Row
          icon={<span>📳</span>}
          title="Haptic Feedback"
          subtitle="Vibrate on selections and toggles"
          trailing={
            <Toggle
              on={settings.hapticEnabled}
              onClick={() => onToggle('hapticEnabled')}
              label="Toggle Haptics"
            />
          }
        />

        <Row
          icon={<span>🔊</span>}
          title="Sound Effects"
          subtitle="Play tactile UI sounds"
          trailing={
            <Toggle
              on={settings.soundEnabled}
              onClick={() => onToggle('soundEnabled')}
              label="Toggle Sound"
            />
          }
        />
      </div>

      {/* Device / verification */}
      <div className="space-y-2 mb-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-purple-300">
          Device &amp; Verification
        </h2>

        <Row
          icon={<span>🆔</span>}
          title="Device ID"
          subtitle={
            <span className="font-mono text-[10px]">{maskDeviceId(verification?.deviceId || '')}</span>
          }
          trailing={
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                verification?.status === 'verified'
                  ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-950/50 border-amber-500/40 text-amber-300'
              }`}
            >
              {verification?.status === 'verified' ? '✓ verified' : 'local'}
            </span>
          }
        />

        {updateAvailable && (
          <Row
            icon={<span>⬆️</span>}
            title="Update available"
            subtitle={`You have v${APP_VERSION}, latest is v${verification?.latestVersion}`}
          />
        )}

        <button
          type="button"
          onClick={onResetVerification}
          className="w-full p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 text-left active:scale-[0.99]"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-white">Reset Device Verification</div>
              <div className="text-[11px] text-zinc-400">
                Clears this device&apos;s activation and returns you to the key screen
              </div>
            </div>
            <Chevron />
          </div>
        </button>
      </div>

      {/* Tools */}
      <div className="space-y-2 mb-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-purple-300">
          Modding Tools
        </h2>

        <button
          type="button"
          onClick={onOpenPackExtract}
          className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 active:scale-[0.99]"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-950/60 border border-purple-500/30 flex items-center justify-center text-purple-300">
              📦
            </div>
            <div className="text-left">
              <div className="text-sm font-bold text-white">Pack &amp; Extract Tool</div>
              <div className="text-xs text-zinc-400">Compress folders to .mcpack, or inspect archives</div>
            </div>
          </div>
          <Chevron />
        </button>

        <button
          type="button"
          onClick={onExportCodebase}
          disabled={exporting}
          className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 active:scale-[0.99] disabled:opacity-50"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-950/60 border border-purple-500/30 flex items-center justify-center text-purple-300">
              💾
            </div>
            <div className="text-left">
              <div className="text-sm font-bold text-white">
                {exporting ? 'Building ZIP…' : 'Export Codebase'}
              </div>
              <div className="text-xs text-zinc-400">Download the app source as a .zip backup</div>
            </div>
          </div>
          <Chevron />
        </button>

        <button
          type="button"
          onClick={onOpenListMaker}
          className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 active:scale-[0.99]"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-950/60 border border-purple-500/30 flex items-center justify-center text-purple-300">
              📋
            </div>
            <div className="text-left">
              <div className="text-sm font-bold text-white">Addon List Maker</div>
              <div className="text-xs text-zinc-400">Generate a formatted .txt addon list</div>
            </div>
          </div>
          <Chevron />
        </button>
      </div>

      {/* About */}
      <div className="space-y-2 mb-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-purple-300">About</h2>

        <Row
          icon={<span>🏷️</span>}
          title="Version"
          subtitle={
            <span className="font-mono text-[10px]">
              v{APP_VERSION}
              {verification?.latestVersion ? ` · latest v${verification.latestVersion}` : ''}
            </span>
          }
        />

        <button
          type="button"
          onClick={onOpenAbout}
          className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 active:scale-[0.99]"
        >
          <span className="text-sm font-bold text-white">About AutoBE &amp; StoneByte</span>
          <Chevron />
        </button>

        <button
          type="button"
          onClick={onOpenToS}
          className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 active:scale-[0.99]"
        >
          <span className="text-sm font-bold text-white">Terms of Service</span>
          <Chevron />
        </button>

        <button
          type="button"
          onClick={onOpenPrivacy}
          className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 active:scale-[0.99]"
        >
          <span className="text-sm font-bold text-white">Privacy Policy</span>
          <Chevron />
        </button>
      </div>

      {/* Danger zone */}
      <button
        type="button"
        onClick={onClearData}
        className="w-full py-3 rounded-xl border border-red-500/30 bg-red-950/20 text-xs font-bold text-red-300 hover:bg-red-950/40 active:scale-95 transition-all text-center"
      >
        Reset &amp; Clear All Local Data
      </button>
      <p className="text-[10px] text-zinc-600 mt-2 leading-relaxed text-center">
        Removes every imported addon, merged modpack, saved setting and cached verification from
        this device. Demo addons will not be restored.
      </p>
    </div>
  );
};