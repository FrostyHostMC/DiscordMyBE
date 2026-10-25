import assert from 'node:assert/strict';
import { assessSwitcherEligibility, type BoneChannelOverlap, type ControllerInliningEvidence, type SwitcherEligibilityInput } from '../src/utils/switcherEligibility.ts';
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

const overlap: BoneChannelOverlap = {
  bone: 'rightArm',
  channel: 'rotation',
  animationIds: ['animation.synthetic:a', 'animation.synthetic:b'],
  controllerIds: ['controller.synthetic:a', 'controller.synthetic:b'],
  packIds: ['synthetic-a', 'synthetic-b'],
  overlapEvidence: 'Both rotation channels are active under the same proven condition window.',
  proposedOwner: 'controller.synthetic:a',
};

function controller(id: string, scope: 'player' | 'mob' | 'unknown' = 'player'): ControllerInliningEvidence {
  return {
    controllerId: id,
    scope,
    inboundReferences: ['entity description.scripts.animate'],
    allInboundReferencesRewritable: true,
    entityAnimateEntryPaths: ['minecraft:player.description.scripts.animate[0]'],
    stateMap: { default: `${id.replaceAll(':', '_')}_default` },
    renamedTransitionTargets: { default: `${id.replaceAll(':', '_')}_default` },
    stateGraphRewriteComplete: true,
  };
}

function input(overrides: Partial<SwitcherEligibilityInput> = {}): SwitcherEligibilityInput {
  return {
    findings: [finding()],
    analysisComplete: true,
    overlapAnalysisComplete: true,
    overlapGroups: [overlap],
    controllerEvidence: [controller('controller.synthetic:a'), controller('controller.synthetic:b')],
    dependencyHits: [],
    geometryMismatches: [],
    minEngineVersion: '1.20.0',
    mechanismMinimumVersion: '1.19.60',
    runtimeMechanismSupported: true,
    ...overrides,
  };
}

function main() {
  // No actual bone/channel overlap: use standard merge, don't over-trigger Switcher.
  assert.equal(assessSwitcherEligibility(input({ overlapGroups: [] })).decision, 'not-needed');

  // Positive eligibility requires complete, known-scope inlining and dependency evidence.
  const eligible = assessSwitcherEligibility(input());
  assert.equal(eligible.decision, 'eligible');
  assert.equal(eligible.eligible, true);
  assert.deepEqual(eligible.conflictingAnimationIds, ['animation.synthetic:a', 'animation.synthetic:b']);
  assert.ok(eligible.inliningMap['controller.synthetic:a']);
  assert.equal(eligible.requiresUserConfirmation, true);

  // Unproven: missing/parse-failed analysis must never produce a partial plan.
  assert.equal(assessSwitcherEligibility(input({ analysisComplete: false })).decision, 'unproven');
  assert.equal(assessSwitcherEligibility(input({ overlapAnalysisComplete: false })).decision, 'unproven');

  // Unproven: player/mob ambiguity must stay unknown, independent of evidence ordering.
  const ambiguousA = controller('controller.synthetic:shared', 'unknown');
  const ambiguousB = controller('controller.synthetic:other');
  const orderOne = assessSwitcherEligibility(input({ controllerEvidence: [ambiguousA, ambiguousB] }));
  const orderTwo = assessSwitcherEligibility(input({ controllerEvidence: [ambiguousB, ambiguousA] }));
  assert.equal(orderOne.decision, 'unproven');
  assert.deepEqual(orderOne, orderTwo);

  // Entry-point proof: any unrewritable inbound path blocks the plan.
  assert.equal(assessSwitcherEligibility(input({
    controllerEvidence: [controller('controller.synthetic:a'), {
      ...controller('controller.synthetic:b'),
      allInboundReferencesRewritable: false,
      inboundReferences: ['entity animate', 'unrewritable external reference'],
    }],
  })).decision, 'ineligible');

  // Structural state graph must include state, transition, on_entry and on_exit rewrites.
  assert.equal(assessSwitcherEligibility(input({
    controllerEvidence: [controller('controller.synthetic:a'), {
      ...controller('controller.synthetic:b'),
      stateGraphRewriteComplete: false,
    }],
  })).decision, 'unproven');

  // Dependency scan blocks timeline side effects, commands, scripts, and external refs.
  for (const category of ['sound_effects', 'particle_effects', 'run_command', 'emit_particle', 'play_sound', 'molang', 'script', 'external_reference'] as const) {
    const result = assessSwitcherEligibility(input({
      dependencyHits: [{ category, source: 'synthetic source', detail: 'Synthetic dependency hit.' }],
    }));
    assert.notEqual(result.decision, 'eligible', `${category} must block eligibility`);
    assert.ok(result.blockedBy.some((reason) => reason.includes(category)));
  }

  // Geometry mismatch can't be repaired by gating.
  const geometry = assessSwitcherEligibility(input({ geometryMismatches: ['rightArm absent from target geometry'] }));
  assert.equal(geometry.decision, 'ineligible');
  assert.ok(geometry.blockedBy.some((reason) => reason.includes('Gating cannot create a missing bone')));

  // Version gate rejects a pack that declares an engine older than the mechanism needs.
  const version = assessSwitcherEligibility(input({ minEngineVersion: '1.18.0', mechanismMinimumVersion: '1.19.60' }));
  assert.equal(version.decision, 'ineligible');
  assert.ok(version.blockedBy.some((reason) => reason.includes('below the mechanism requirement')));

  console.log('Switcher eligibility dry-run tests passed.');
}

main();
