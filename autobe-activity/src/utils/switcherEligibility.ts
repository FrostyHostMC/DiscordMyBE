import type { AnimationConflictFinding } from './mergeEngine';

export type SwitcherDecision = 'not-needed' | 'needs-review' | 'eligible' | 'ineligible';

export interface SwitcherEligibilityInput {
  findings: readonly AnimationConflictFinding[];
  /** False when any relevant pack/file could not be analyzed completely. */
  analysisComplete: boolean;
  /** True only after every conflicting target is proven safe to isolate. */
  targetIsolationVerified: boolean;
  /** True only after the gate/selector mechanism is verified for the target Bedrock version. */
  runtimeMechanismSupported: boolean;
}

export interface SwitcherEligibilityResult {
  decision: SwitcherDecision;
  eligible: boolean;
  reasons: string[];
}

/**
 * Conservative, pure decision layer for the future Compatibility Mode/Switcher.
 * This function never edits archives or generates controllers. The current
 * analyzer cannot prove isolation feasibility, so missing evidence is not approval.
 */
export function assessSwitcherEligibility(
  input: SwitcherEligibilityInput,
): SwitcherEligibilityResult {
  const reasons: string[] = [];
  const critical = input.findings.filter((finding) => finding.severity === 'critical');

  if (!input.analysisComplete || input.findings.some((finding) => finding.kind === 'parse-warning')) {
    return {
      decision: 'ineligible',
      eligible: false,
      reasons: ['Analysis is incomplete or contains an animation JSON parse warning.'],
    };
  }

  if (critical.length === 0) {
    return {
      decision: 'not-needed',
      eligible: false,
      reasons: ['No critical animation conflict was reported; keep the standard merge path.'],
    };
  }

  if (critical.some((finding) => finding.scope === 'unknown')) {
    reasons.push('At least one critical conflict has unknown scope.');
  }

  if (reasons.length > 0) {
    return { decision: 'ineligible', eligible: false, reasons };
  }

  if (!input.targetIsolationVerified) {
    reasons.push('The conflicting animation/controller targets have not been proven safe to isolate.');
  }

  if (!input.runtimeMechanismSupported) {
    reasons.push('The selector/gatekeeper runtime mechanism has not been verified for the target Bedrock version.');
  }

  if (reasons.length > 0) {
    return { decision: 'needs-review', eligible: false, reasons };
  }

  return {
    decision: 'eligible',
    eligible: true,
    reasons: ['Known-scope critical conflict; target isolation and runtime support were explicitly verified.'],
  };
}
