import assert from 'node:assert/strict';
import { assessSwitcherEligibility } from '../src/utils/switcherEligibility.ts';
import type { AnimationConflictFinding } from '../src/utils/mergeEngine.ts';

function finding(overrides: Partial<AnimationConflictFinding> = {}): AnimationConflictFinding {
  return {
    severity: 'critical',
    kind: 'bone-overlap',
    scope: 'player',
    packs: ['synthetic-a', 'synthetic-b'],
    file: 'animation_controllers/synthetic.json',
    detail: 'Synthetic overlapping animation target.',
    ...overrides,
  };
}

function main() {
  const noConflict = assessSwitcherEligibility({
    findings: [],
    analysisComplete: true,
    targetIsolationVerified: false,
    runtimeMechanismSupported: false,
  });
  assert.equal(noConflict.decision, 'not-needed');

  const unknownScope = assessSwitcherEligibility({
    findings: [finding({ scope: 'unknown' })],
    analysisComplete: true,
    targetIsolationVerified: true,
    runtimeMechanismSupported: true,
  });
  assert.equal(unknownScope.decision, 'ineligible');
  assert.equal(unknownScope.eligible, false);

  const incompleteAnalysis = assessSwitcherEligibility({
    findings: [finding(), finding({ severity: 'warning', kind: 'parse-warning', scope: 'unknown' })],
    analysisComplete: false,
    targetIsolationVerified: true,
    runtimeMechanismSupported: true,
  });
  assert.equal(incompleteAnalysis.decision, 'ineligible');

  const missingIsolationProof = assessSwitcherEligibility({
    findings: [finding()],
    analysisComplete: true,
    targetIsolationVerified: false,
    runtimeMechanismSupported: true,
  });
  assert.equal(missingIsolationProof.decision, 'needs-review');
  assert.equal(missingIsolationProof.eligible, false);

  const eligible = assessSwitcherEligibility({
    findings: [finding()],
    analysisComplete: true,
    targetIsolationVerified: true,
    runtimeMechanismSupported: true,
  });
  assert.equal(eligible.decision, 'eligible');
  assert.equal(eligible.eligible, true);

  console.log('Switcher eligibility tests passed.');
}

main();
