import type { RootCauseGroup, ValidationCheckId, ValidationFinding } from '@/types/remaker';

/**
 * FIX 7 — root-cause analysis for the validation engine.
 *
 * The first real conversion produced 101,827 individual defects. Almost none of them were
 * independent problems: one broken generator path repeats the same mistake in every file it
 * writes, so listing instances separately hides the defect and invites a thousand identical
 * repairs. This module collapses findings into root causes, ranks them by impact (dependency
 * and schema failures first, because everything downstream fails with them) and states how
 * much repair work one root cause is allowed to consume.
 */

const IMPACT_WEIGHT: Record<ValidationCheckId, number> = {
  schema: 10,
  dependency: 10,
  json: 9,
  reference: 8,
  identifier: 8,
  texture: 7,
  geometry: 7,
  'render-controller': 6,
  animation: 6,
  script: 6,
  uv: 5,
  material: 5,
  behavior: 5,
  'format-version': 4,
  unsupported: 2,
};

/**
 * Per-root-cause repair budget for one validation run. A systemic defect is repaired
 * instance by instance only up to this bound; the remainder is reported as deferred
 * instead of generating thousands of identical attempts in a single pass.
 */
export const MAX_REPAIR_ATTEMPTS_PER_ROOT_CAUSE = 400;

/** Individual finding rows reported per root cause. The count itself is never capped. */
export const MAX_FINDINGS_PER_ROOT_CAUSE = 25;

const RECOMMENDATIONS: Record<ValidationCheckId, string> = {
  schema:
    'Fix the writer that emits this manifest/document shape. A schema defect is produced by generation, not repaired field by field.',
  dependency:
    'Route every manifest through one dependency resolver so pack UUIDs, module UUIDs and dependency entries are emitted together.',
  json: 'Fix the serialiser that produced the document — one malformed file makes the whole pack fail to load.',
  reference: 'Fix the resolver that wrote this path; a reference is only correct when it points at a file that actually shipped.',
  identifier: 'Generate identifiers once through the canonical registry instead of per file.',
  texture: 'Fix the texture writer/decoder path and keep the source bytes when a step fails.',
  geometry: 'Fix the model converter that produced this geometry, not the individual cubes.',
  uv: 'Fix the UV conversion once (source sheet + coordinate convention) instead of nudging faces.',
  animation: 'Fix the animation translator that produced this channel or clip so every clip is emitted correctly.',
  'render-controller':
    'Generate render controllers from the canonical identifier registry and only reference shipped geometry and textures.',
  material: 'Derive materials from the shipped material set when the client entity is written.',
  behavior: 'Derive behaviour components from source evidence in one place instead of per entity file.',
  script: 'Ship the script entry the manifest declares, or stop declaring it.',
  'format-version': 'Emit the format version from one version-aware constant per document kind.',
  unsupported: 'Record this as unsupported functionality for manual review; there is no honest automatic repair.',
};

/** Collapses identifiers, file names and numbers so equal defects share one signature. */
function normalise(text: string): string {
  return text
    .replace(/"[^"]*"/g, '"*"')
    .replace(/'[^']*'/g, "'*'")
    .replace(/-?\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Stable identity of the defect behind a finding, with its variables removed. */
export function rootCauseSignature(finding: ValidationFinding): string {
  return `${finding.check}|${normalise(finding.bedrockRule)}|${normalise(finding.detail)}`;
}

function titleOf(detail: string): string {
  const head = detail.split(/[.;]/)[0].trim();
  return head.length > 96 ? `${head.slice(0, 93)}…` : head;
}

/**
 * Groups findings into root causes. `deferred` maps a signature to the instances the repair
 * budget skipped, so a group can report repair work that never ran.
 */
export function analyzeRootCauses(
  findings: ValidationFinding[],
  deferred?: Map<string, number>,
): RootCauseGroup[] {
  const buckets = new Map<string, RootCauseGroup>();
  const fileSets = new Map<string, Set<string>>();

  for (const finding of findings) {
    const id = rootCauseSignature(finding);
    let group = buckets.get(id);
    if (!group) {
      group = {
        id,
        check: finding.check,
        severity: finding.severity,
        title: titleOf(finding.detail),
        rootCause: '',
        count: 0,
        fileCount: 0,
        files: [],
        systemic: false,
        conversionFailures: 0,
        repairable: 0,
        deferred: 0,
        impactScore: 0,
        recommendation: RECOMMENDATIONS[finding.check],
      };
      buckets.set(id, group);
      fileSets.set(id, new Set<string>());
    }
    group.count += 1;
    if (finding.severity === 'error') group.severity = 'error';
    if (finding.conversionFailure) group.conversionFailures += 1;
    if (finding.repair || finding.repairAvailable) group.repairable += 1;
    const files = fileSets.get(id);
    if (files && !files.has(finding.file)) {
      files.add(finding.file);
      if (group.files.length < 6) group.files.push(finding.file);
    }
  }

  const groups: RootCauseGroup[] = [];
  for (const [id, group] of buckets) {
    group.fileCount = fileSets.get(id)?.size ?? 1;
    group.deferred = deferred?.get(id) ?? 0;
    group.systemic = group.count >= 3 || group.fileCount >= 3;
    group.rootCause = `${group.title} — ${group.count} instance(s) across ${group.fileCount} file(s)${
      group.systemic ? ', repeated by one shared generator path' : ''
    }${group.conversionFailures > 0 ? `, ${group.conversionFailures} from failed conversions` : ''}.`;
    const spread = group.fileCount >= 3 ? 1.5 : 1;
    const fromConversion = group.conversionFailures > 0 ? 1.5 : 1;
    group.impactScore = Math.round(
      group.count * IMPACT_WEIGHT[group.check] * (group.severity === 'error' ? 2 : 1) * spread * fromConversion,
    );
    groups.push(group);
  }
  return groups.sort((a, b) => b.impactScore - a.impactScore || b.count - a.count);
}

/** Highest-impact root causes first, trimmed for the report surface. */
export function topRootCauses(groups: RootCauseGroup[], limit = 40): RootCauseGroup[] {
  return groups.slice(0, Math.max(1, limit));
}