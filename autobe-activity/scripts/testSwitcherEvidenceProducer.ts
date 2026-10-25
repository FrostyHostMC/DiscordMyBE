import assert from 'node:assert/strict';
import JSZip from 'jszip';
import type { AddonPack } from '../src/types/modpack.ts';
import { analyzeSwitcherOverlaps, produceSwitcherEvidence, resolveSwitcherReferences } from '../src/utils/switcherEvidenceProducer.ts';

function pack(name: string, files: Record<string, string>): Promise<AddonPack> {
  const zip = new JSZip();
  for (const path of Object.keys(files).sort()) zip.file(path, files[path]);
  return zip.generateAsync({ type: 'blob' }).then((blob) => ({
    id: name,
    name,
    type: 'Resource Pack',
    version: '1.0.0',
    uuid: `synthetic:${name}`,
    fileSize: blob.size,
    dateAdded: 0,
    fileBlob: blob,
  }));
}

function entity(identifier: string, animations: Record<string, string>, controllers: Record<string, string>, animate: unknown[] = []) {
  return JSON.stringify({
    'minecraft:entity': {
      description: {
        identifier,
        animations,
        animation_controllers: controllers,
        scripts: { animate },
      },
    },
  });
}

function animation(id: string, bone: string, channel: string) {
  return JSON.stringify({
    animations: {
      [id]: {
        animation_length: 1,
        bones: { [bone]: { [channel]: { '0.0': [0, 0, 0], '1.0': [1, 1, 1] } } },
      },
    },
  });
}

function controller(id: string, animationRef: string) {
  return JSON.stringify({
    animation_controllers: {
      [id]: { initial_state: 'default', states: { default: { animations: [animationRef] } } },
    },
  });
}

async function main() {
  const a = await pack('pack-a', {
    'entities/player.json': entity('minecraft:player', { walk_alias: 'animation.test:walk' }, { walk_controller: 'controller.test:walk' }, ['walk_controller']),
    'animations/walk.animation.json': animation('animation.test:walk', 'rightArm', 'rotation'),
    'animation_controllers/walk.controller.json': controller('controller.test:walk', 'walk_alias'),
  });
  const b = await pack('pack-b', {
    'entities/player.json': entity('minecraft:player', { wave_alias: 'animation.test:wave' }, { wave_controller: 'controller.test:wave' }, ['wave_controller']),
    'animations/wave.animation.json': animation('animation.test:wave', 'rightArm', 'rotation'),
    'animation_controllers/wave.controller.json': controller('controller.test:wave', 'wave_alias'),
  });

  // Pass 1 resolves aliases only after the full inventory exists; all references are retained.
  const passA = await resolveSwitcherReferences([a, b]);
  assert.equal(passA.analysisComplete, true);
  assert.ok(passA.references.some((r) => r.reference === 'walk_alias' && r.resolvedId === 'animation.test:walk'));
  assert.ok(passA.references.some((r) => r.reference === 'walk_controller' && r.resolvedId === 'controller.test:walk'));
  assert.ok(passA.channelFacts.some((fact) => fact.bone === 'rightArm' && fact.channel === 'rotation'));

  // Pass 2 reports same bone/channel only as possible, never proven without runtime condition proof.
  const passTwo = analyzeSwitcherOverlaps(passA);
  const overlap = passTwo.find((record) => record.bone === 'rightArm' && record.channel === 'rotation');
  assert.ok(overlap);
  assert.equal(overlap.confidence, 'possible');
  assert.ok(overlap.blockerCodes.includes('overlap_window_unproven'));

  // Reversing pack order must preserve each stage, not merely the final report.
  const reversedPass = await resolveSwitcherReferences([b, a]);
  assert.deepEqual(reversedPass.references, passA.references);
  assert.deepEqual(reversedPass.channelFacts, passA.channelFacts);
  assert.deepEqual(reversedPass.evidence, passA.evidence);
  assert.deepEqual(analyzeSwitcherOverlaps(reversedPass), passTwo);
  assert.deepEqual(await produceSwitcherEvidence([a, b]), await produceSwitcherEvidence([b, a]));

  // Unresolved controller/animation references are explicit unknown evidence.
  const unresolved = await pack('unresolved', {
    'entities/entity.json': entity('minecraft:player', {}, { missing_alias: 'controller.missing:one' }, ['missing_alias']),
    'animation_controllers/controller.json': controller('controller.present:one', 'animation.missing:one'),
  });
  const unresolvedResult = await produceSwitcherEvidence([unresolved]);
  assert.equal(unresolvedResult.analysisComplete, true);
  assert.ok(unresolvedResult.references.some((r) => r.confidence === 'unknown' && r.blockerCodes.includes('unresolved_reference')));
  assert.ok(unresolvedResult.evidence.some((r) => r.confidence === 'unknown' && r.blockerCodes.includes('unresolved_reference')));

  // Malformed relevant JSON is a first-class unknown record, never silently treated as no conflict.
  const malformed = await pack('malformed', {
    'animations/broken.animation.json': '{ not valid JSON',
  });
  const malformedResult = await produceSwitcherEvidence([malformed]);
  assert.equal(malformedResult.analysisComplete, false);
  assert.ok(malformedResult.evidence.some((r) =>
    r.confidence === 'unknown' && r.blockerCodes.includes('source_proof_malformed') && r.sourceProof.filePath.includes('broken.animation.json'),
  ));
  assert.deepEqual(await produceSwitcherEvidence([malformed, a]), await produceSwitcherEvidence([a, malformed]));

  // Alias ambiguity is retained as unresolved; it must not be upgraded to a positive resolution.
  const ambiguous = await pack('ambiguous', {
    'entities/one.json': entity('minecraft:player', { shared: 'animation.test:one' }, {}, []),
    'entities/two.json': entity('minecraft:player', { shared: 'animation.test:two' }, {}, []),
    'animations/one.json': animation('animation.test:one', 'body', 'position'),
    'animations/two.json': animation('animation.test:two', 'body', 'position'),
  });
  const ambiguousResult = await produceSwitcherEvidence([ambiguous]);
  assert.ok(ambiguousResult.references.some((r) => r.reference === 'shared' && r.confidence === 'unknown' && r.resolvedId === null));

  console.log('Switcher evidence producer regression tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
