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
  confidence: 'proven',
  sourceProof: {
    filePath: 'animations/synthetic.animation.json',
    reference: 'animations.synthetic:rotation.rightArm',
    claim: 'Source animation defines the rightArm rotation channel and its active interval.',
  },
  blockerCodes: [],
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

  // Evidence contract: possible-only evidence cannot ever qualify for Switcher.
  const possible = assessSwitcherEligibility(input({
    overlapGroups: [{ ...overlap, confidence: 'possible', blockerCodes: ['overlap_window_unproven'] }],
  }));
  assert.equal(possible.decision, 'unproven');
  assert.equal(possible.eligible, false);
  assert.ok(possible.blockedBy.some((reason) => reason.includes('overlap_window_unproven')));

  // Evidence contract: unknown/unresolved references are first-class blockers.
  const unresolved = assessSwitcherEligibility(input({
    overlapGroups: [{ ...overlap, confidence: 'unknown', blockerCodes: ['unresolved_reference'] }],
  }));
  assert.equal(unresolved.decision, 'unproven');
  assert.ok(unresolved.blockedBy.some((reason) => reason.includes('unresolved_reference')));

  // Evidence contract: missing or malformed proof is rejected, not downgraded to a warning.
  const missingProof = assessSwitcherEligibility(input({
    overlapGroups: [{ ...overlap, sourceProof: { filePath: '', reference: '', claim: '' } }],
  }));
  assert.equal(missingProof.decision, 'unproven');
  assert.equal(missingProof.eligible, false);
  assert.ok(missingProof.blockedBy.some((reason) => reason.includes('malformed')));

  const missingBlocker = assessSwitcherEligibility(input({
    overlapGroups: [{ ...overlap, confidence: 'possible', blockerCodes: [] }],
  }));
  assert.equal(missingBlocker.decision, 'unproven');
  assert.ok(missingBlocker.blockedBy.some((reason) => reason.includes('no blocker code')));

  // Determinism: changing scan/input order must not change the serialized report.
  const reversedGroups = assessSwitcherEligibility(input({
    overlapGroups: [
      { ...overlap, bone: 'leftArm', animationIds: ['animation.synthetic:c', 'animation.synthetic:d'], controllerIds: ['controller.synthetic:c', 'controller.synthetic:d'], packIds: ['synthetic-c', 'synthetic-d'], proposedOwner: 'controller.synthetic:c', sourceProof: { filePath: 'animations/left.json', reference: 'animations.synthetic:leftArm', claim: 'Left arm rotation interval.' } },
      overlap,
    ],
    controllerEvidence: [controller('controller.synthetic:b'), controller('controller.synthetic:a')],
  }));
  const forwardGroups = assessSwitcherEligibility(input({
    overlapGroups: [
      overlap,
      { ...overlap, bone: 'leftArm', animationIds: ['animation.synthetic:c', 'animation.synthetic:d'], controllerIds: ['controller.synthetic:c', 'controller.synthetic:d'], packIds: ['synthetic-c', 'synthetic-d'], proposedOwner: 'controller.synthetic:c', sourceProof: { filePath: 'animations/left.json', reference: 'animations.synthetic:leftArm', claim: 'Left arm rotation interval.' } },
    ],
    controllerEvidence: [controller('controller.synthetic:a'), controller('controller.synthetic:b')],
  }));
  assert.deepEqual(reversedGroups, forwardGroups);

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
