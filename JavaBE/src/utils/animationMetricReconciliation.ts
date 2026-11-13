import type { AnimationRegistryMetrics } from '@/utils/animationResourceRegistry';

/**
 * Metric ledger: one population, one figure, one provenance.
 *
 * A conversion report used to print "27 converted · 9 registered · 15 activated · 27 registered by
 * the pipeline · 10/27 with activation paths · 127/127 bones resolved · 116 unresolved bones". Every
 * one of those numbers was true about a *different* archive or a *different* population: a writer
 * counting edits, an auditor counting edges, a retarget pass counting renames, a registry counting
 * unique exported ids. Juxtaposed without their scope they read as one contradictory claim.
 *
 * This module ends that: the exported-resource registry defines the figure for each population, and
 * every other producer is recorded as a claim next to it with the archive it describes.
 *
 *   final-export    measured on the exact exported files — a disagreement is a defect, not a scope
 *   pass-local      an action count from one stage, taken before later passes changed the pack
 *   source-evidence what the imported archive contained; never an export total
 *
 * Only `final-export` claims can conflict. A pass-local count is superseded by the final figure and
 * keeps its own meaning, so "0 render controllers generated" next to "2 render controllers declared"
 * reads as what it is: this repair pass created none, the pack ships two.
 */

export type MetricScope = 'final-export' | 'pass-local' | 'source-evidence';

export const METRIC_SCOPE_MEANING: Record<MetricScope, string> = {
  'final-export': 'measured on the exact exported file set; must equal the registry figure',
  'pass-local': 'counted by one stage while it ran; superseded once later passes changed the pack',
  'source-evidence': 'describes the imported source archive, never the Bedrock output',
};

export type MetricKey =
  | 'definitions'
  | 'selectable'
  | 'activationPaths'
  | 'registeredWithoutPath'
  | 'animationControllers'
  | 'renderControllers'
  | 'bonesResolved'
  | 'bonesChecked'
  | 'bonesUnresolved';

export type MetricDisposition = 'matches-final' | 'superseded' | 'conflict' | 'context';

export interface MetricClaimInput {
  metric: MetricKey;
  /** Stage that produced the number, as the report names it. */
  producer: string;
  value: number;
  scope: MetricScope;
  /** What this number counts and why it may differ from the final figure. */
  meaning: string;
}

export interface MetricLedgerClaim extends MetricClaimInput {
  disposition: MetricDisposition;
}

export interface MetricLedgerRow {
  key: MetricKey;
  label: string;
  /** Authoritative figure, read from the one exported-resource registry. Null when unmeasurable. */
  finalValue: number | null;
  finalBasis: string;
  claims: MetricLedgerClaim[];
  status: 'consistent' | 'superseded' | 'conflict' | 'not-measured';
}

export interface MetricFindingTotals {
  producer: string;
  errors: number;
  warnings: number;
}

export interface AnimationMetricLedger {
  rows: MetricLedgerRow[];
  /** Final-scope claims that disagree with the registry. Any entry here blocks a success claim. */
  conflicts: string[];
  superseded: number;
  /** Stage finding totals. Findings are defects, not populations: one defect may be named twice. */
  findings: MetricFindingTotals[];
  blockingFindings: number;
  passed: boolean;
  scopes: string[];
  summary: string;
}

function finalRows(metrics: AnimationRegistryMetrics): Array<{
  key: MetricKey;
  label: string;
  value: number | null;
  basis: string;
}> {
  const boneBasis = 'unique final owner/clip/bone binding measured against the skeleton that owner renders';
  return [
    {
      key: 'definitions',
      label: 'Animation definitions',
      value: metrics.clipsDefined,
      basis: `unique animation identifiers declared by the ${metrics.animationDefinitionFiles} final animation document(s)`,
    },
    {
      key: 'selectable',
      label: 'Selectable clips',
      value: metrics.clipsRegistered,
      basis: `unique final clip ids a client entity can select directly or through a reachable controller state`,
    },
    {
      key: 'activationPaths',
      label: 'Clips with a start path',
      value: metrics.clipsActivated,
      basis: `unique selectable ids reached by an animate entry, an activated controller state or a verified script call (path types overlap)`,
    },
    {
      key: 'registeredWithoutPath',
      label: 'Selectable without a path',
      value: metrics.unactivatedClips.length,
      basis: 'unique selectable ids no activation path reaches and no stage deliberately withheld',
    },
    {
      key: 'animationControllers',
      label: 'Animation controllers',
      value: metrics.controllersDefined,
      basis: `animation-controller definitions in the final pack (${metrics.controllersRegistered} entity-registered, ${metrics.controllersActivated} activated)`,
    },
    {
      key: 'renderControllers',
      label: 'Render controllers',
      value: metrics.renderControllersDeclared,
      basis: `render-controller definitions in the final pack (${metrics.renderControllersReferenced} referenced, ${metrics.renderControllersUnresolved.length} unresolved) — a separate resource type from animation controllers`,
    },
    { key: 'bonesResolved', label: 'Bone bindings resolved', value: metrics.bones.checked > 0 ? metrics.bones.resolved : null, basis: boneBasis },
    { key: 'bonesChecked', label: 'Bone bindings measured', value: metrics.bones.checked > 0 ? metrics.bones.checked : null, basis: boneBasis },
    {
      key: 'bonesUnresolved',
      label: 'Bone bindings unresolved',
      value: metrics.bones.unresolved.length,
      basis: `${boneBasis}; ${metrics.bones.skeletonsUnresolved.length} owner skeleton(s) could not be measured at all`,
    },
  ];
}

function dispositionOf(claim: MetricClaimInput, finalValue: number | null): MetricDisposition {
  if (claim.scope === 'source-evidence') return 'context';
  // Nothing in the final pack was measurable, so no claim can be confirmed against it. The row is
  // reported as not-measured and the claim keeps its context instead of inventing a conflict.
  if (finalValue === null) return 'context';
  if (claim.value === finalValue) return 'matches-final';
  return claim.scope === 'final-export' ? 'conflict' : 'superseded';
}

/**
 * Reconciles every producer's count against the exported-resource registry. The returned rows are
 * the only place a report may read a population figure from.
 */
export function reconcileAnimationMetrics(input: {
  metrics: AnimationRegistryMetrics;
  claims: MetricClaimInput[];
  findings?: MetricFindingTotals[];
}): AnimationMetricLedger {
  const rows: MetricLedgerRow[] = finalRows(input.metrics).map((row): MetricLedgerRow => ({
    key: row.key,
    label: row.label,
    finalValue: row.value,
    finalBasis: row.basis,
    claims: input.claims
      .filter((claim) => claim.metric === row.key)
      .map((claim) => ({ ...claim, disposition: dispositionOf(claim, row.value) })),
    status: 'not-measured',
  }));

  const conflicts: string[] = [];
  let superseded = 0;
  for (const row of rows) {
    const conflicted = row.claims.filter((claim) => claim.disposition === 'conflict');
    const replaced = row.claims.filter((claim) => claim.disposition === 'superseded');
    superseded += replaced.length;
    for (const claim of conflicted) {
      conflicts.push(
        `${row.label}: ${claim.producer} reports ${claim.value} for the final export but the exported-resource registry measures ${row.finalValue ?? 'nothing measurable'} (${row.finalBasis}).`,
      );
    }
    if (row.finalValue === null) row.status = 'not-measured';
    else if (conflicted.length > 0) row.status = 'conflict';
    else if (row.claims.some((claim) => claim.disposition === 'superseded')) row.status = 'superseded';
    else row.status = 'consistent';
  }

  const findings = (input.findings ?? []).filter((finding) => finding.errors + finding.warnings > 0);
  const blockingFindings = findings.filter((finding) => finding.errors > 0).length;
  const passed = conflicts.length === 0 && blockingFindings === 0;
  const summary =
    `Metric ledger: ${rows.length} final population(s) read from the exported-resource registry; ` +
    `${conflicts.length} final-scope disagreement(s), ${superseded} stage-local count(s) superseded by the final figure, ` +
    `${findings.length} stage(s) reporting findings (${blockingFindings} with errors). ` +
    (passed
      ? 'Every exported figure reconciles and no stage reports an error.'
      : 'The port cannot be reported as a unified success until each conflict and each blocking finding is resolved.');

  return {
    rows,
    conflicts,
    superseded,
    findings,
    blockingFindings,
    passed,
    scopes: [
      'Every figure below is read from the same exported-resource registry, built from the exact file maps that are zipped.',
      `final-export — ${METRIC_SCOPE_MEANING['final-export']}.`,
      `pass-local — ${METRIC_SCOPE_MEANING['pass-local']}.`,
      `source-evidence — ${METRIC_SCOPE_MEANING['source-evidence']}.`,
      'Population rows are never added across stages: one definition is one definition, one bone binding is one binding, and a clip counted at two activation types is still one clip.',
      'Findings are defects, not populations. A defect reported by two stages is one defect, so stage error totals are not additive and any non-zero error count blocks a success claim.',
    ],
    summary,
  };
}