import type { AssetValidationReport, RegressionMetricId, RegressionSuiteReport } from '@/types/remaker';
import { ConversionManifestPanel } from '@/components/ConversionManifestPanel';
import { SchemaGatePanel } from '@/components/SchemaGatePanel';
import { RootCausePanel } from '@/components/RootCausePanel';

/**
 * Validation & Regression dashboard.
 *
 * Shows what was actually checked, what was repaired, and what is still open. Nothing is
 * presented as passing unless the corresponding requirement was measured against a shipped
 * file.
 */

interface ValidationDashboardProps {
  validation?: AssetValidationReport;
  regression?: RegressionSuiteReport;
  accent: string;
  runningRegression: boolean;
  onRunRegression: () => void;
}

const METRIC_LABELS: Array<{ id: RegressionMetricId; label: string }> = [
  { id: 'assetPreservation', label: 'Assets kept' },
  { id: 'geometryAccuracy', label: 'Geometry' },
  { id: 'uvAccuracy', label: 'UV fidelity' },
  { id: 'textureAccuracy', label: 'Textures' },
  { id: 'animationAccuracy', label: 'Animations' },
  { id: 'behaviorPreservation', label: 'Behaviour' },
  { id: 'dependencyCompleteness', label: 'Dependencies' },
  { id: 'packLoadingSuccess', label: 'Pack loading' },
];

const STATUS_STYLE: Record<'passed' | 'partial' | 'failed', string> = {
  passed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  partial: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  failed: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

export function ValidationDashboard({
  validation,
  regression,
  accent,
  runningRegression,
  onRunRegression,
}: ValidationDashboardProps) {
  const checks = validation?.checks ?? [];
  const openFindings = (validation?.findings ?? []).filter((finding) => finding.resolution !== 'repaired');
  const repairedFindings = (validation?.findings ?? []).filter((finding) => finding.resolution === 'repaired');

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div>
            <h2 className="text-sm font-bold text-slate-100">Validation &amp; Repair Pipeline</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Every generated asset is checked against the real Bedrock requirement it must satisfy.
            </p>
          </div>
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={{ borderColor: `${accent}55`, background: `${accent}18`, color: accent }}
          >
            PHASE 8
          </span>
        </div>

        {!validation ? (
          <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
            No pack has been validated yet. Load a mod and run the port engine — the validation report is produced for
            every export.
          </p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
                <span className="block text-[10px] uppercase text-slate-500">Requirements</span>
                <span className="font-mono text-base font-extrabold text-sky-400">{validation.totalChecks}</span>
                <span className="block text-[10px] text-slate-500">{validation.filesChecked} files checked</span>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
                <span className="block text-[10px] uppercase text-slate-500">Auto-repaired</span>
                <span className="font-mono text-base font-extrabold text-amber-400">{validation.repairedCount}</span>
                <span className="block text-[10px] text-slate-500">
                  {validation.repairPasses.filter((pass) => pass.applied > 0).length} repair pass(es)
                </span>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
                <span className="block text-[10px] uppercase text-slate-500">Open defects</span>
                <span className="font-mono text-base font-extrabold text-rose-400">{validation.errorCount}</span>
                <span className="block text-[10px] text-slate-500">{validation.warningCount} warning(s)</span>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
                <span className="block text-[10px] uppercase text-slate-500">Unsupported</span>
                <span className="font-mono text-base font-extrabold text-fuchsia-400">
                  {validation.unsupportedCount}
                </span>
                <span className="block text-[10px] text-slate-500">Java-only functionality</span>
              </div>
            </div>

            <p className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-[11px] leading-relaxed text-slate-300">
              {validation.summary}
            </p>

            <RootCausePanel report={validation} accent={accent} />

            <div className="mt-3 flex flex-col gap-1.5">
              {checks.map((check) => {
                const healthy = check.unresolved === 0 && check.unsupported === 0;
                const total = Math.max(1, check.checked);
                const cleanWidth = Math.round((check.clean / total) * 100);
                const repairedWidth = Math.round((check.repaired / total) * 100);
                return (
                  <div key={check.check} className="rounded-lg border border-slate-800/70 bg-slate-950/50 p-2">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-slate-200">{check.label}</span>
                      <span className={healthy ? 'text-emerald-400' : 'text-rose-400'}>
                        {check.clean}/{check.checked}
                        {check.repaired > 0 ? ` · ${check.repaired} fixed` : ''}
                        {check.unresolved > 0 ? ` · ${check.unresolved} open` : ''}
                        {check.unsupported > 0 ? ` · ${check.unsupported} unsupported` : ''}
                      </span>
                    </div>
                    <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <span className="h-full bg-emerald-500" style={{ width: `${cleanWidth}%` }} />
                      <span className="h-full bg-amber-500" style={{ width: `${repairedWidth}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {validation.repairPasses.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                <span className="text-[10px] font-semibold uppercase text-slate-500">Bounded repair loop</span>
                {validation.repairPasses.map((pass) => (
                  <p key={pass.pass} className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    Pass {pass.pass}: {pass.before} → {pass.after} defect(s), {pass.applied} repair(s). {pass.note}
                  </p>
                ))}
              </div>
            )}

            {openFindings.length > 0 && (
              <details className="mt-3 rounded-lg border border-rose-900/40 bg-rose-950/20 p-2">
                <summary className="min-h-[32px] cursor-pointer text-[11px] font-semibold text-rose-200">
                  {openFindings.length} open requirement(s) — reported, never discarded
                </summary>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {openFindings.slice(0, 12).map((finding) => (
                    <li key={finding.id} className="rounded border border-slate-800/80 bg-slate-950/60 p-2">
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="font-mono text-slate-400">
                          {finding.role}:{finding.file}
                        </span>
                        <span
                          className={
                            finding.resolution === 'unsupported' ? 'text-fuchsia-300' : 'text-rose-300'
                          }
                        >
                          {finding.check}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{finding.detail}</p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{finding.bedrockRule}</p>
                    </li>
                  ))}
                </ul>
                {openFindings.length > 12 && (
                  <p className="mt-1 text-[10px] text-slate-500">
                    {openFindings.length - 12} further finding(s) are available in the exported report.
                  </p>
                )}
              </details>
            )}

            {repairedFindings.length > 0 && (
              <details className="mt-2 rounded-lg border border-amber-900/40 bg-amber-950/20 p-2">
                <summary className="min-h-[32px] cursor-pointer text-[11px] font-semibold text-amber-200">
                  {repairedFindings.length} automatic repair(s) applied
                </summary>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {repairedFindings.slice(0, 10).map((finding) => (
                    <li key={finding.id} className="text-[11px] leading-relaxed text-slate-300">
                      <span className="font-mono text-[10px] text-slate-500">
                        {finding.role}:{finding.file}
                      </span>{' '}
                      — {finding.repair?.action}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {validation.conversionFailures.length > 0 && (
              <div className="mt-2 rounded-lg border border-rose-800/50 bg-rose-950/30 p-2">
                <span className="text-[10px] font-semibold uppercase text-rose-300">Failed conversions kept</span>
                {validation.conversionFailures.slice(0, 5).map((failure) => (
                  <p key={failure} className="mt-1 text-[11px] leading-relaxed text-rose-100/80">
                    {failure}
                  </p>
                ))}
              </div>
            )}

            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              Structural simulation only. Not tested: {validation.untested.join(' · ')}.
            </p>

            {(validation.geometryRegistry || validation.textureAtlas) && (
              <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                <span className="text-[10px] font-semibold uppercase text-slate-500">
                  Identifier registry &amp; atlas isolation
                </span>
                {validation.geometryRegistry && (
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                    One canonical registry for every generated geometry: {validation.geometryRegistry.geometries} identifier(s)
                    across {validation.geometryRegistry.geometryFiles} model file(s),{' '}
                    {validation.geometryRegistry.identifiersNormalised} normalised,{' '}
                    {validation.geometryRegistry.aliasesCollapsed} duplicate alias(es) collapsed,{' '}
                    {validation.geometryRegistry.referencesRepaired} reference(s) repaired{' '}
                    {validation.geometryRegistry.unresolved.length > 0
                      ? `· ${validation.geometryRegistry.unresolved.length} reference(s) UNRESOLVED`
                      : '· every reference resolves to a shipped model'}.
                  </p>
                )}
                {validation.textureAtlas && (
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                    Entity definitions and texture assets kept separate: item atlas {validation.textureAtlas.itemEntries},
                    terrain atlas {validation.textureAtlas.terrainEntries} entr(y/ies) built only from shipped PNGs,{' '}
                    {validation.textureAtlas.phantomsRemoved} phantom entr(y/ies) removed,{' '}
                    {validation.textureAtlas.labelsRemoved} internal label(s) stripped,{' '}
                    {validation.textureAtlas.entityTexturesRepaired} entity skin path(s) resolved independently
                    {validation.textureAtlas.entityTexturesMissing.length > 0
                      ? `· ${validation.textureAtlas.entityTexturesMissing.length} skin(s) UNMATCHED`
                      : ''}.
                  </p>
                )}
              </div>
            )}

            <SchemaGatePanel report={validation.schemaGate} accent={accent} />

            <ConversionManifestPanel manifest={validation.conversionManifest} accent={accent} />
          </>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div>
            <h2 className="text-sm font-bold text-slate-100">Automated Regression Suite</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Fixture mods are converted with the real engines and compared against their source evidence.
            </p>
          </div>
          <button
            type="button"
            onClick={onRunRegression}
            disabled={runningRegression}
            className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-950 px-3 text-[11px] font-semibold text-slate-200 active:scale-[0.98] disabled:opacity-60"
          >
            {runningRegression ? 'Running…' : 'Run suite'}
          </button>
        </div>

        {!regression ? (
          <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
            No regression run yet. The suite also runs automatically after every port so a regression cannot slip in
            unnoticed.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE.passed}`}>
                {regression.passed} passed
              </span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE.partial}`}>
                {regression.partial} partial
              </span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE.failed}`}>
                {regression.failed} failed
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] text-slate-400">
                {regression.total} fixtures
              </span>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {METRIC_LABELS.map((metric) => {
                const value = regression.metrics[metric.id];
                return (
                  <div key={metric.id} className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
                    <span className="block text-[10px] uppercase text-slate-500">{metric.label}</span>
                    <span
                      className={`font-mono text-sm font-extrabold ${
                        value == null ? 'text-slate-600' : value >= 99 ? 'text-emerald-400' : value >= 60 ? 'text-amber-400' : 'text-rose-400'
                      }`}
                    >
                      {value == null ? 'n/a' : `${value}%`}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              {regression.fixtures.map((fixture) => (
                <details
                  key={fixture.id}
                  className="rounded-lg border border-slate-800/70 bg-slate-950/50 p-2"
                >
                  <summary className="flex min-h-[32px] cursor-pointer flex-wrap items-center justify-between gap-1.5 text-[11px]">
                    <span className="font-semibold text-slate-200">{fixture.label}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-500">{fixture.durationMs} ms</span>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[fixture.status]}`}
                      >
                        {fixture.status}
                      </span>
                    </span>
                  </summary>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {fixture.assertions.map((assertion) => (
                      <li
                        key={assertion.label}
                        className="flex flex-wrap items-baseline justify-between gap-1 text-[11px] leading-relaxed"
                      >
                        <span className={assertion.passed ? 'text-slate-300' : 'text-rose-300'}>{assertion.label}</span>
                        <span className="font-mono text-[10px] text-slate-500">
                          {assertion.passed ? assertion.actual : `${assertion.actual} (expected ${assertion.expected})`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {fixture.unavailable.length > 0 && (
                    <p className="mt-1 text-[10px] leading-relaxed text-amber-300/80">
                      Not measurable: {fixture.unavailable.join(' ')}
                    </p>
                  )}
                  {fixture.findings.length > 0 && (
                    <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{fixture.findings.join(' · ')}</p>
                  )}
                </details>
              ))}
            </div>

            <p className="mt-2 rounded-lg border border-amber-900/40 bg-amber-950/20 p-2 text-[10px] leading-relaxed text-amber-200/80">
              Gameplay compatibility: NOT MEASURED. These percentages describe how much source structure survived
              conversion in fixture archives — structural simulation only, never in-game parity.
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{regression.summary}</p>
          </>
        )}
      </section>
    </div>
  );
}