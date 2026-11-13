import { AlertTriangle, CheckCircle2, Download, Globe, HelpCircle, Info, XCircle } from 'lucide-react';
import type { GeyserCompatibilityReport } from '@/types/remaker';
import { GeyserMappingList } from '@/components/GeyserMappingList';

interface Props {
  enabled: boolean;
  geyserVersion: string;
  versionOptions: string[];
  targetVersion: string;
  report?: GeyserCompatibilityReport;
  exporting: boolean;
  hasBundle: boolean;
  accent: string;
  onToggle: (enabled: boolean) => void;
  onVersionChange: (version: string) => void;
  onExport: () => void;
}

const STATE_STYLE = {
  satisfied: { border: 'border-emerald-700/60', text: 'text-emerald-300', label: 'Ready' },
  unmet: { border: 'border-rose-800/60', text: 'text-rose-300', label: 'Missing' },
  unknown: { border: 'border-amber-700/60', text: 'text-amber-300', label: 'Unverified' },
} as const;

export function GeyserConfigPanel({
  enabled,
  geyserVersion,
  versionOptions,
  targetVersion,
  report,
  exporting,
  hasBundle,
  accent,
  onToggle,
  onVersionChange,
  onExport,
}: Props) {
  const profile = report?.profile;

  return (
    <section aria-label="Geyser compatibility configuration" className="flex flex-col gap-3">
      <header className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 shrink-0" style={{ color: accent }} />
            <div>
              <h2 className="text-sm font-bold text-slate-100">Geyser Compatibility</h2>
              <p className="text-[11px] text-slate-400">Optional extra output — native Bedrock stays primary</p>
            </div>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-400">{enabled ? 'ON' : 'OFF'}</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => onToggle(event.target.checked)}
              className="h-5 w-5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-400"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="geyser-version" className="text-[10px] uppercase text-slate-500">Geyser build</label>
          <select
            id="geyser-version"
            value={geyserVersion}
            onChange={(event) => onVersionChange(event.target.value)}
            className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs font-semibold text-slate-200"
          >
            {versionOptions.map((version) => (
              <option key={version} value={version}>{version}</option>
            ))}
          </select>
          <span className="rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-[10px] text-slate-400">
            Bedrock target {targetVersion}
          </span>
          {profile && (
            <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${profile.source === 'unknown' ? 'border-amber-700/60 text-amber-300' : 'border-sky-700/60 text-sky-300'}`}>
              {profile.source === 'unknown' ? 'profile unknown' : 'bundled snapshot'}
            </span>
          )}
        </div>

        <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
          Geyser protocol translation is not native Bedrock conversion. Mappings are built only from the item/block
          definitions and textures this port shipped; nothing is guessed from asset names.
        </p>
      </header>

      {!enabled && (
        <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-400">
          Geyser output is off. Turn it on before generating a port to also produce item/block mappings, an extension
          descriptor and a Geyser resource pack.
        </p>
      )}

      {enabled && !report && (
        <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-400">
          Geyser output is armed — run the port to generate the mappings and resource pack.
        </p>
      )}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
              <span className="block text-[10px] uppercase text-slate-500">Item maps</span>
              <span className="font-mono text-lg font-bold text-emerald-300">{report.totals.itemMappings}</span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
              <span className="block text-[10px] uppercase text-slate-500">Block maps</span>
              <span className="font-mono text-lg font-bold text-emerald-300">{report.totals.blockMappings}</span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
              <span className="block text-[10px] uppercase text-slate-500">Approximated</span>
              <span className="font-mono text-lg font-bold text-amber-300">{report.totals.approximated}</span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
              <span className="block text-[10px] uppercase text-slate-500">Withheld</span>
              <span className="font-mono text-lg font-bold text-rose-300">{report.totals.unsupported}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {report.requirements.map((requirement) => {
              const style = STATE_STYLE[requirement.state];
              const Icon = requirement.state === 'satisfied' ? CheckCircle2 : requirement.state === 'unmet' ? XCircle : HelpCircle;
              return (
                <article key={requirement.id} className={`rounded-xl border bg-slate-950/70 p-2.5 ${style.border}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-100">{requirement.label}</span>
                    <span className={`flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase ${style.text}`}>
                      <Icon className="h-3 w-3" /> {style.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{requirement.detail}</p>
                </article>
              );
            })}
          </div>

          <GeyserMappingList items={report.items} blocks={report.blocks} />

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <h3 className="text-[11px] font-bold uppercase text-slate-400">Generated bundle files</h3>
            <ul className="mt-1.5 flex flex-col gap-1">
              {report.files.map((file) => (
                <li key={file.path} className="flex items-baseline justify-between gap-2 text-[10px]">
                  <span className="truncate font-mono text-slate-300">{file.path}</span>
                  <span className="shrink-0 text-slate-500">{(file.bytes / 1024).toFixed(1)} KB</span>
                </li>
              ))}
            </ul>
          </div>

          {report.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-800/50 bg-amber-950/30 p-3">
              <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" /> Notes
              </h3>
              <ul className="mt-1.5 flex flex-col gap-1">
                {report.warnings.map((warning) => (
                  <li key={warning} className="text-[11px] leading-relaxed text-amber-100/80">{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={onExport}
            disabled={exporting || !hasBundle}
            className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold text-slate-950 shadow-lg transition active:scale-[0.99] disabled:opacity-60"
            style={{ background: accent }}
          >
            <Download className="h-4 w-4" />
            {exporting ? 'Preparing Geyser bundle…' : hasBundle ? 'Download Geyser bundle' : 'Bundle not generated'}
          </button>
        </>
      )}
    </section>
  );
}