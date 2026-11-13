import type {
  AssetValidationReport,
  PackSchemaReport,
  RemakeItem,
  ValidationCheckId,
  ValidationCheckSummary,
  ValidationFinding,
  ValidationRepairPass,
} from '@/types/remaker';
import { CHECK_LABELS, CHECK_ORDER, scanPackForDefects, type Pack, type RawFinding } from '@/utils/validationRules';
import { applyValidationRepair } from '@/utils/validationRepair';
import { validatePackSchema } from '@/utils/bedrockPackSchema';
import {
  MAX_FINDINGS_PER_ROOT_CAUSE,
  MAX_REPAIR_ATTEMPTS_PER_ROOT_CAUSE,
  analyzeRootCauses,
  rootCauseSignature,
  topRootCauses,
} from '@/utils/rootCauseAnalyzer';

/**
 * Phase 8 + FIX 7 — universal validation, repair and root-cause pipeline.
 *
 * Every generated asset is checked, and the checks are ordered the way a pack actually fails:
 * the manifest schema and dependency wiring first, because every dependent document fails
 * with them. Findings are then collapsed into root causes, so 100,000 repeated instances are
 * reported as a handful of real defects instead of a wall of identical rows. Repairs stay
 * bounded: a defect that has no safe repair, or whose root-cause budget is spent, is reported
 * as UNRESOLVED with its file path and never silently dropped.
 */

export interface AssetValidationInput {
  modId: string;
  targetVersion?: unknown;
  playableMode: boolean;
  /** True when an upstream conversion stage failed, so dependent checks are FAILED, not clean. */
  stageFailed?: boolean;
  resourcePackFiles: Pack;
  behaviorPackFiles: Pack;
  items: RemakeItem[];
  onLog?: (line: string) => void;
}

export interface AssetValidationOutput {
  report: AssetValidationReport;
  resourcePackFiles: Pack;
  behaviorPackFiles: Pack;
}

const MAX_REPAIR_PASSES = 2;
const MAX_REPORTED_ROOT_CAUSES = 40;
const MAX_REPORTED_REPAIRS = 400;
const MAX_LOGGED_FINDINGS = 8;

type ScanContext = Parameters<typeof scanPackForDefects>[0];

interface ScanBundle {
  findings: RawFinding[];
  checked: Record<ValidationCheckId, number>;
  schema: PackSchemaReport;
}

function findingKey(raw: RawFinding): string {
  return `${raw.check}|${raw.role}|${raw.file}|${raw.subject}`;
}

function toFinding(
  raw: RawFinding,
  resolution: ValidationFinding['resolution'],
  repair?: ValidationFinding['repair'],
  repairAvailable?: boolean,
): ValidationFinding {
  return {
    id: findingKey(raw),
    check: raw.check,
    severity: raw.severity,
    role: raw.role,
    file: raw.file,
    subject: raw.subject,
    detail: raw.detail,
    bedrockRule: raw.rule,
    resolution,
    repair,
    repairAvailable,
    conversionFailure: Boolean(raw.conversionFailure),
  };
}

/** Real Bedrock pack schema first, then every generated document. */
function scanPack(context: ScanContext): ScanBundle {
  const structural = scanPackForDefects(context);
  const schema = validatePackSchema({
    resourcePackFiles: context.resourcePackFiles,
    behaviorPackFiles: context.behaviorPackFiles,
    modId: context.modId,
  });
  return {
    findings: [...schema.findings, ...structural.findings],
    checked: { ...structural.checked, schema: structural.checked.schema + schema.requirements },
    schema: schema.report,
  };
}

export function runAssetValidationPipeline(input: AssetValidationInput): AssetValidationOutput {
  const log = (line: string) => input.onLog?.(line);
  const resourcePackFiles: Pack = { ...input.resourcePackFiles };
  const behaviorPackFiles: Pack = { ...input.behaviorPackFiles };
  const context: ScanContext = {
    modId: input.modId,
    targetVersion: input.targetVersion,
    playableMode: input.playableMode,
    resourcePackFiles,
    behaviorPackFiles,
    items: input.items,
  };

  log('[VALIDATE] Validation pipeline engaged — Bedrock pack schema first, then every generated document...');

  let bundle = scanPack(context);
  const initialDefects = bundle.findings.length;
  const repairPasses: ValidationRepairPass[] = [];
  const repairedById = new Map<string, ValidationFinding>();
  const failedAttempts = new Set<string>();
  const repairBudget = new Map<string, number>();
  const deferredByRootCause = new Map<string, number>();

  for (let pass = 1; pass <= MAX_REPAIR_PASSES; pass += 1) {
    if (bundle.findings.length === 0) break;
    const before = bundle.findings.length;
    let applied = 0;
    deferredByRootCause.clear();
    for (const raw of bundle.findings) {
      if (raw.repair.kind === 'none') continue;
      const signature = rootCauseSignature(toFinding(raw, 'unresolved'));
      const attemptKey = `${signature}|${raw.file}|${raw.subject}`;
      if (failedAttempts.has(attemptKey)) continue;
      const used = repairBudget.get(signature) ?? 0;
      if (used >= MAX_REPAIR_ATTEMPTS_PER_ROOT_CAUSE) {
        deferredByRootCause.set(signature, (deferredByRootCause.get(signature) ?? 0) + 1);
        continue;
      }
      repairBudget.set(signature, used + 1);
      const outcome = applyValidationRepair(raw, resourcePackFiles, behaviorPackFiles);
      if (!outcome.applied) {
        failedAttempts.add(attemptKey);
        continue;
      }
      applied += 1;
      repairedById.set(findingKey(raw), toFinding(raw, 'repaired', {
        action: outcome.action,
        provenance: outcome.provenance,
        detail: raw.detail,
      }));
      log(`[VALIDATE:FIX] ${raw.check} ${raw.role}:${raw.file} — ${outcome.action}.`);
    }
    bundle = scanPack(context);
    const after = bundle.findings.length;
    const stopped = applied === 0 || after >= before;
    repairPasses.push({
      pass,
      before,
      after,
      applied,
      stopped,
      note:
        applied === 0
          ? 'No remaining defect has a safe automatic repair; the open defects are reported UNRESOLVED.'
          : stopped
            ? 'This pass did not reduce the defect count, so the bounded repair loop stopped; the remainder is UNRESOLVED.'
            : 'Repairs applied and the pack was re-scanned.',
    });
    log(
      `[VALIDATE] Pass ${pass}: ${before} defect(s) detected, ${applied} repair(s) applied, ${after} remaining${stopped ? ' — bounded repair loop stopped' : ''}.`,
    );
    if (stopped) break;
  }

  const openFindings: ValidationFinding[] = bundle.findings.map((raw) =>
    toFinding(raw, raw.check === 'unsupported' ? 'unsupported' : 'unresolved', undefined, raw.repair.kind !== 'none'),
  );
  const openKeys = new Set(openFindings.map((finding) => finding.id));
  const repairedFindings = [...repairedById.values()].filter((finding) => !openKeys.has(finding.id));
  const groups = analyzeRootCauses(openFindings, deferredByRootCause);

  // Reporting cap: per-instance rows are bounded so a systemic defect cannot bury the report.
  // Every count below stays exact — only the row list is trimmed.
  const perRootCause = new Map<string, number>();
  const reportedOpen: ValidationFinding[] = [];
  for (const finding of openFindings) {
    const signature = rootCauseSignature(finding);
    const seen = perRootCause.get(signature) ?? 0;
    if (seen >= MAX_FINDINGS_PER_ROOT_CAUSE) continue;
    perRootCause.set(signature, seen + 1);
    reportedOpen.push(finding);
  }

  const checks: ValidationCheckSummary[] = CHECK_ORDER.map((check: ValidationCheckId) => {
    const checked = bundle.checked[check] ?? 0;
    const checkOpen = openFindings.filter((finding) => finding.check === check);
    const repaired = repairedFindings.filter((finding) => finding.check === check).length;
    return {
      check,
      label: CHECK_LABELS[check],
      checked,
      clean: Math.max(0, checked - checkOpen.length),
      repaired,
      unresolved: checkOpen.filter((finding) => finding.resolution === 'unresolved').length,
      unsupported: checkOpen.filter((finding) => finding.resolution === 'unsupported').length,
    };
  }).filter((summary) => summary.checked > 0 || summary.repaired > 0 || summary.unresolved + summary.unsupported > 0);

  const totalChecks = checks.reduce((total, check) => total + check.checked, 0);
  const errorFindings = openFindings.filter((finding) => finding.severity === 'error');
  const warningFindings = openFindings.filter((finding) => finding.severity === 'warning');
  const conversionFailures = openFindings
    .filter((finding) => finding.conversionFailure)
    .map((finding) => `${finding.role}:${finding.file} — ${finding.detail}`);
  const unresolvedCount = openFindings.filter((finding) => finding.resolution === 'unresolved').length;
  const unsupportedCount = openFindings.filter((finding) => finding.resolution === 'unsupported').length;
  const repairedCount = repairedFindings.length;
  const systemicGroups = groups.filter((group) => group.systemic);
  const deferredRepairCount = [...deferredByRootCause.values()].reduce((total, value) => total + value, 0);
  const blockingGroups = groups.filter((group) => group.severity === 'error');
  const verifiedSystems = checks
    .filter((check) => check.unresolved === 0 && check.unsupported === 0)
    .map((check) => check.label);

  const summary = input.stageFailed
    ? `Validation ran against a pack produced by a FAILED conversion stage: ${groups.length} root cause(s) behind ${openFindings.length} open defect(s), ${repairedCount} repair(s) applied, ${unresolvedCount} requirement(s) unresolved. Dependent counts are FAILED, not clean.`
    : `${openFindings.length} open defect(s) collapse into ${groups.length} root cause(s) — ${systemicGroups.length} systemic, ${blockingGroups.length} blocking. ${repairedCount} repair(s) applied${deferredRepairCount > 0 ? `, ${deferredRepairCount} instance(s) deferred by the per-root-cause repair budget` : ''}. Pack schema: ${bundle.schema.passed ? 'valid' : `${bundle.schema.defects} defect(s)`}. Structural validation only — gameplay compatibility in a live Bedrock client is NOT measured.`;

  const report: AssetValidationReport = {
    targetVersion: typeof input.targetVersion === 'string' ? input.targetVersion : 'declared in manifest',
    playableMode: input.playableMode,
    stageFailed: Boolean(input.stageFailed),
    filesChecked: Object.keys(resourcePackFiles).length + Object.keys(behaviorPackFiles).length,
    resourceFiles: Object.keys(resourcePackFiles).length,
    behaviorFiles: Object.keys(behaviorPackFiles).length,
    totalChecks,
    initialDefects,
    cleanChecks: Math.max(0, totalChecks - openFindings.length),
    repairedCount,
    unresolvedCount,
    unsupportedCount,
    errorCount: errorFindings.length,
    warningCount: warningFindings.length,
    findings: [...repairedFindings.slice(0, MAX_REPORTED_REPAIRS), ...reportedOpen],
    checks,
    repairPasses,
    conversionFailures,
    verifiedSystems,
    untested: [
      'Live in-game rendering of every entity, item and block',
      'Real multiplayer / Realms behaviour of the shipped scripts',
      'Geyser protocol translation of the extra compatibility output',
    ],
    summary,
    rootCauses: topRootCauses(groups, MAX_REPORTED_ROOT_CAUSES),
    rootCauseCount: groups.length,
    systemicRootCauseCount: systemicGroups.length,
    openFindingCount: openFindings.length,
    deferredRepairCount,
    reportingCapped: reportedOpen.length < openFindings.length || repairedFindings.length > MAX_REPORTED_REPAIRS,
    schema: bundle.schema,
    gameplayVerified: false,
  };

  return { report, resourcePackFiles, behaviorPackFiles };
}

/** Human-readable log lines for the validation report. */
export function formatValidationLog(report: AssetValidationReport): string[] {
  const lines: string[] = [];
  lines.push(
    `[VALIDATE] ${report.totalChecks} check(s) over ${report.filesChecked} file(s) — ${report.repairedCount} repaired, ${report.errorCount} open defect(s), ${report.warningCount} warning(s), ${report.unsupportedCount} unsupported.`,
  );
  lines.push(
    `[VALIDATE] Pack schema: ${report.schema.passed ? 'VALID' : `${report.schema.defects} defect(s)`} across ${report.schema.manifestsChecked} manifest(s) (${report.schema.requirements} requirement(s), ${report.schema.resourceModules} resource module(s), ${report.schema.behaviorModules} behaviour module(s), ${report.schema.dependencies} dependency entr(y/ies)).`,
  );
  for (const check of report.checks) {
    lines.push(
      `[VALIDATE] ${check.label}: ${check.clean}/${check.checked} clean${check.repaired ? `, ${check.repaired} repaired` : ''}${check.unresolved ? `, ${check.unresolved} unresolved` : ''}${check.unsupported ? `, ${check.unsupported} unsupported` : ''}.`,
    );
  }
  lines.push(
    `[VALIDATE] Root causes: ${report.rootCauseCount} behind ${report.openFindingCount} open instance(s), ${report.systemicRootCauseCount} systemic — grouped so one generator fix is visible instead of ${report.openFindingCount} identical rows.`,
  );
  for (const cause of report.rootCauses.slice(0, 6)) {
    lines.push(
      `[VALIDATE:CAUSE] impact ${cause.impactScore} · ${cause.severity.toUpperCase()} · ${cause.count}x ${cause.check} across ${cause.fileCount} file(s) — ${cause.title}`,
    );
  }
  if (report.rootCauseCount > 6) {
    lines.push(`[VALIDATE:CAUSE] ${report.rootCauseCount - 6} further root cause(s) are listed in the validation report.`);
  }
  for (const finding of report.findings.filter((entry) => entry.resolution !== 'repaired').slice(0, MAX_LOGGED_FINDINGS)) {
    lines.push(`[VALIDATE] ${finding.severity.toUpperCase()} ${finding.role}:${finding.file} — ${finding.detail}`);
  }
  if (report.openFindingCount > MAX_LOGGED_FINDINGS) {
    lines.push(`[VALIDATE] ${report.openFindingCount - MAX_LOGGED_FINDINGS} further unresolved requirement(s) are grouped in the report.`);
  }
  if (report.reportingCapped) {
    lines.push('[VALIDATE] Individual rows are capped per root cause; the counts above are exact.');
  }
  for (const failure of report.conversionFailures.slice(0, 5)) {
    lines.push(`[VALIDATE] CONVERSION FAILED (kept, not discarded) ${failure}`);
  }
  lines.push(
    '[VALIDATE] Structural validation only — no check here proves in-game gameplay compatibility.',
  );
  return lines;
}