import type { BehaviorDomain, BehaviorTranslationReport } from '@/types/remaker';

const STATUS_ORDER: Record<string, number> = {
  unsupported: 0,
  unresolved: 1,
  fallback: 2,
  approximated: 3,
  ported: 4,
};

const STATUS_STYLE: Record<string, string> = {
  ported: 'border-emerald-500/30 bg-emerald-950/50 text-emerald-300',
  approximated: 'border-sky-500/30 bg-sky-950/50 text-sky-300',
  fallback: 'border-amber-500/30 bg-amber-950/40 text-amber-300',
  unresolved: 'border-rose-500/30 bg-rose-950/40 text-rose-300',
  unsupported: 'border-fuchsia-500/30 bg-fuchsia-950/40 text-fuchsia-300',
};

const DOMAIN_LABEL: Partial<Record<BehaviorDomain, string>> = {
  'entity-ai': 'Entity AI',
  movement: 'Movement',
  combat: 'Combat',
  'health-attributes': 'Health & attributes',
  'entity-events': 'Entity events',
  'block-interaction': 'Block interaction',
  'item-interaction': 'Item interaction',
  'custom-items': 'Custom items',
  'custom-blocks': 'Custom blocks',
  recipes: 'Recipes',
  'loot-tables': 'Loot tables',
  'villager-trades': 'Villager trades',
  spawning: 'Spawning',
  projectiles: 'Projectiles',
  effects: 'Effects',
  particles: 'Particles',
  sounds: 'Sounds',
  equipment: 'Equipment',
  'timers-cooldowns': 'Timers & cooldowns',
  inventory: 'Inventory',
  worldgen: 'World generation',
};

interface Props {
  report?: BehaviorTranslationReport;
  accent: string;
}

/** Behaviour Mapping console: every reconstructed domain with its real evidence. */
export function BehaviorTranslationPanel({ report, accent }: Props) {
  if (!report) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-400">
        Run a conversion to reconstruct entity AI, movement, combat, loot, trades, timers and item/block behaviour from the
        mod's own bytecode and data files.
      </div>
    );
  }

  const domains = Object.entries(report.domainCounts ?? {}) as Array<[BehaviorDomain, NonNullable<BehaviorTranslationReport['totals']>]>;
  const totals = report.totals;
  // Open issues first: an entity row is never allowed to hide an unresolved or
  // unsupported mechanic that still needs manual work.
  const visibleFindings = [...report.findings]
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 5) - (STATUS_ORDER[b.status] ?? 5))
    .slice(0, 24);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-100">Behaviour Translation Engine</h2>
          <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ borderColor: `${accent}66`, color: accent }}>
            {report.entitiesAnalyzed} entities · {report.itemsAnalyzed} items
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{report.summary}</p>

        <div className="mt-2.5 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          <Stat label="Ported" value={totals.ported} tone="text-emerald-400" />
          <Stat label="Approximated" value={totals.approximated} tone="text-sky-400" />
          <Stat label="Fallback" value={totals.fallback} tone="text-amber-400" />
          <Stat label="Unresolved" value={totals.unresolved} tone="text-rose-400" />
          <Stat label="Unsupported" value={report.unsupported.length} tone="text-fuchsia-400" />
          <Stat label="Files emitted" value={report.emittedFileCount} tone="text-slate-200" />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          Counts are per domain and per component. Only SOURCE and ADAPTED findings count toward parity; fallback, unresolved
          and unsupported work is excluded. Structural reconstruction is not proof of in-game behaviour.
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          {report.stageFailed
            ? 'Blocked: an upstream pipeline stage failed, so no behaviour is reported as converted.'
            : `${report.emittedFileCount} behaviour file(s) emitted · ${report.unverifiedClaims} mapping(s) downgraded because no shipped file backs the claim.`}
        </p>
        {report.filesWritten.length > 0 && (
          <p className="mt-1 break-words font-mono text-[10px] leading-relaxed text-slate-500">
            → {report.filesWritten.slice(0, 6).join(' · ')}
            {report.filesWritten.length > 6 ? ` +${report.filesWritten.length - 6}` : ''}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Domain matrix</h3>
        <div className="mt-2 flex flex-col gap-1">
          {domains.length === 0 && <p className="text-[11px] text-slate-500">No behaviour domains were analysed.</p>}
          {domains.map(([domain, counts]) => (
            <div key={domain} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/70 bg-slate-900/50 px-2 py-1.5 text-[11px]">
              <span className="truncate text-slate-300">{DOMAIN_LABEL[domain] ?? domain}</span>
              <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
                <span className="text-emerald-400">{counts.ported}</span>
                <span className="text-sky-400">{counts.approximated}</span>
                <span className="text-amber-400">{counts.fallback}</span>
                <span className="text-rose-400">{counts.unresolved}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {report.unsupported.length > 0 && (
        <div className="rounded-xl border border-fuchsia-900/40 bg-fuchsia-950/20 p-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-fuchsia-300">Unsupported mechanics</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {report.unsupported.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-fuchsia-900/40 bg-slate-950/40 p-2 text-[11px] leading-relaxed">
                <span className="font-semibold text-fuchsia-200">{DOMAIN_LABEL[entry.domain] ?? entry.domain}</span>
                <span className="text-slate-500"> · {entry.target}</span>
                <p className="mt-0.5 text-slate-300">{entry.reason}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Evidence: {entry.sourceEvidence} — {entry.alternative}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">World generation</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{report.worldgen.summary}</p>
        {report.worldgen.definitions.length > 0 ? (
          <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
            {report.worldgen.definitions.slice(0, 12).map((definition) => (
              <li key={definition.sourcePath} className="flex items-start justify-between gap-2 rounded-lg border border-slate-800/70 bg-slate-900/50 px-2 py-1.5 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-slate-300">
                  {definition.sourcePath.split('/').pop()} · {definition.kind}
                </span>
                <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_STYLE[definition.status === 'converted' ? 'ported' : definition.status] ?? STATUS_STYLE.unresolved}`}>
                  {definition.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">No biome, feature or structure document was found in the archive.</p>
        )}
        {report.worldgen.definitions.length > 12 && (
          <p className="mt-1.5 text-[10px] text-slate-500">{report.worldgen.definitions.length - 12} further document(s) not listed.</p>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Mappings</h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {visibleFindings.map((finding) => (
            <li key={finding.id} className="rounded-lg border border-slate-800/70 bg-slate-900/50 p-2 text-[11px] leading-relaxed">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-slate-200">{finding.target}</span>
                <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_STYLE[finding.status] ?? STATUS_STYLE.unresolved}`}>
                  {finding.status}
                </span>
              </div>
              <p className="mt-0.5 text-slate-400">{finding.note}</p>
              {finding.verified && finding.outputFiles.length > 0 && (
                <p className="mt-0.5 break-words font-mono text-[10px] text-emerald-500/80">verified → {finding.outputFiles.slice(0, 2).join(' · ')}</p>
              )}
              {finding.bedrockOutput.length > 0 && (
                <p className="mt-0.5 font-mono text-[10px] text-slate-500">→ {finding.bedrockOutput.join(' · ')}</p>
              )}
            </li>
          ))}
        </ul>
        {report.findings.length > 24 && (
          <p className="mt-2 text-[10px] text-slate-500">{report.findings.length - 24} further mapping(s) not listed.</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-800/80 bg-slate-900/70 p-2">
      <span className="block text-[9px] uppercase text-slate-500">{label}</span>
      <span className={`font-mono text-sm font-extrabold ${tone}`}>{value}</span>
    </div>
  );
}