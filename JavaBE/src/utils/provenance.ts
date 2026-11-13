import type {
  CategoryCounts,
  ComponentProvenance,
  Provenance,
  ProvenanceEntry,
  ProvenanceReport,
} from '@/types/remaker';

/**
 * Provenance layer.
 *
 * Every generated file/component is tagged SOURCE, ADAPTED, SCAFFOLD or INVENTED.
 * INVENTED defaults (template animation sets, code-drawn skins, fallback recipes) are
 * OFF by default and only ship when the user turns playable mode on. Parity counts
 * include SOURCE and ADAPTED components only — never per mob, always per component.
 */

const PLAYABLE_MODE_KEY = 'aippy.playableMode.v1';

let playableModeCache: boolean | null = null;

/** Playable mode toggle (off by default: INVENTED defaults stay disabled). */
export function isPlayableModeEnabled(): boolean {
  if (playableModeCache !== null) return playableModeCache;
  try {
    playableModeCache = localStorage.getItem(PLAYABLE_MODE_KEY) === 'true';
  } catch {
    playableModeCache = false;
  }
  return playableModeCache;
}

export function setPlayableMode(enabled: boolean): void {
  playableModeCache = enabled;
  try {
    localStorage.setItem(PLAYABLE_MODE_KEY, String(enabled));
  } catch {
    // Storage can be unavailable (private mode); the in-memory value still applies.
  }
}

export const PROVENANCE_ORDER: Provenance[] = ['SOURCE', 'ADAPTED', 'SCAFFOLD', 'INVENTED'];

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  SOURCE: 'Source',
  ADAPTED: 'Adapted',
  SCAFFOLD: 'Scaffold',
  INVENTED: 'Invented',
};

export const PROVENANCE_DESCRIPTION: Record<Provenance, string> = {
  SOURCE: 'Recovered from the imported mod files',
  ADAPTED: 'Converted from mod evidence with inference',
  SCAFFOLD: 'Structure the pack needs to load or render',
  INVENTED: 'Default content that is not in the mod (playable mode only)',
};

export const PROVENANCE_STYLE: Record<Provenance, string> = {
  SOURCE: 'border-emerald-500/30 bg-emerald-950/60 text-emerald-300',
  ADAPTED: 'border-sky-500/30 bg-sky-950/60 text-sky-300',
  SCAFFOLD: 'border-slate-600/50 bg-slate-900 text-slate-300',
  INVENTED: 'border-amber-500/40 bg-amber-950/50 text-amber-300',
};

export function emptyCounts(): CategoryCounts {
  return { ported: 0, approximated: 0, fallback: 0, unresolved: 0, invented: 0 };
}

/** ONLY SOURCE and ADAPTED are parity. SCAFFOLD, INVENTED and ABSENT never are. */
export function isParityComponent(provenance: ComponentProvenance): boolean {
  return provenance === 'SOURCE' || provenance === 'ADAPTED';
}

export function statusFromProvenance(provenance: ComponentProvenance): 'ported' | 'approximated' | 'fallback' {
  if (provenance === 'SOURCE') return 'ported';
  if (provenance === 'ADAPTED') return 'approximated';
  return 'fallback';
}

export function countsFromProvenance(values: ComponentProvenance[]): CategoryCounts {
  const counts = emptyCounts();
  for (const value of values) {
    if (value === 'SOURCE') counts.ported += 1;
    else if (value === 'ADAPTED') counts.approximated += 1;
    else if (value === 'SCAFFOLD') counts.fallback += 1;
    else if (value === 'INVENTED') counts.invented = (counts.invented ?? 0) + 1;
    else counts.unresolved += 1;
  }
  return counts;
}

export function sumCounts(list: Array<CategoryCounts | undefined>): CategoryCounts {
  const total = emptyCounts();
  for (const counts of list) {
    if (!counts) continue;
    total.ported += counts.ported;
    total.approximated += counts.approximated;
    total.fallback += counts.fallback;
    total.unresolved += counts.unresolved;
    total.invented = (total.invented ?? 0) + (counts.invented ?? 0);
  }
  return total;
}

export function buildProvenanceReport(entries: ProvenanceEntry[]): ProvenanceReport {
  const counts: Record<Provenance, number> = { SOURCE: 0, ADAPTED: 0, SCAFFOLD: 0, INVENTED: 0 };
  for (const entry of entries) counts[entry.provenance] += 1;
  return {
    playableMode: isPlayableModeEnabled(),
    entries,
    counts,
    parityCount: counts.SOURCE + counts.ADAPTED,
    excludedCount: counts.SCAFFOLD + counts.INVENTED,
  };
}