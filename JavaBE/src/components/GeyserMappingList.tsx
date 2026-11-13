import { useState } from 'react';
import { Boxes, Layers } from 'lucide-react';
import type { GeyserBlockMapping, GeyserItemMapping } from '@/types/remaker';

interface Props {
  items: GeyserItemMapping[];
  blocks: GeyserBlockMapping[];
}

const STATUS_STYLE: Record<string, string> = {
  generated: 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300',
  approximated: 'border-amber-700/60 bg-amber-950/40 text-amber-300',
  unsupported: 'border-rose-800/60 bg-rose-950/40 text-rose-300',
  'unknown-compatibility': 'border-slate-700 bg-slate-950/60 text-slate-300',
};

const MAX_ROWS = 14;

export function GeyserMappingList({ items, blocks }: Props) {
  const [tab, setTab] = useState<'items' | 'blocks'>('items');
  const rows: Array<GeyserItemMapping | GeyserBlockMapping> = tab === 'items' ? items : blocks;
  const shown = rows.slice(0, MAX_ROWS);

  return (
    <section aria-label="Geyser custom mappings" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => setTab('items')}
          aria-pressed={tab === 'items'}
          className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border px-2 text-[11px] font-bold active:scale-[0.99] ${tab === 'items' ? 'border-sky-600 bg-sky-950/60 text-sky-200' : 'border-slate-800 bg-slate-950/50 text-slate-400'}`}
        >
          <Boxes className="h-3.5 w-3.5" /> Items {items.length}
        </button>
        <button
          type="button"
          onClick={() => setTab('blocks')}
          aria-pressed={tab === 'blocks'}
          className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border px-2 text-[11px] font-bold active:scale-[0.99] ${tab === 'blocks' ? 'border-sky-600 bg-sky-950/60 text-sky-200' : 'border-slate-800 bg-slate-950/50 text-slate-400'}`}
        >
          <Layers className="h-3.5 w-3.5" /> Blocks {blocks.length}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
          No {tab} mapping was generated — the port shipped no matching content, or it was withheld.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((row) => (
            <article key={`${tab}-${row.javaIdentifier}`} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-xs font-bold text-slate-100">{row.name}</h3>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-cyan-300">{row.javaIdentifier}</p>
                </div>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_STYLE[row.status] ?? STATUS_STYLE.unsupported}`}>
                  {row.status === 'unknown-compatibility' ? 'unverified' : row.status}
                </span>
              </div>
              <p className="mt-1.5 truncate font-mono text-[10px] text-slate-400">→ {row.bedrockIdentifier}</p>
              {'stateCount' in row && row.stateCount > 0 && (
                <p className="mt-1 text-[10px] text-slate-500">{row.stateCount} block state/permutation entr{row.stateCount === 1 ? 'y' : 'ies'}</p>
              )}
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">{row.note}</p>
              <p className="mt-1 truncate font-mono text-[10px] text-slate-500">evidence: {row.evidence.join(' · ')}</p>
            </article>
          ))}
          {rows.length > MAX_ROWS && (
            <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-[10px] text-slate-400">
              {rows.length - MAX_ROWS} further mapping(s) are included in the exported files.
            </p>
          )}
        </div>
      )}
    </section>
  );
}