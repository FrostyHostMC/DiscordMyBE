import assert from 'node:assert/strict';
import JSZip from 'jszip';
import type { AddonPack } from '../src/types/modpack.ts';

// The merge engine also imports browser asset configuration. Stub the tiny
// browser hook before dynamically importing it so this logic test can run in Node.
(globalThis as any).window = { getReplacedAssets: () => undefined };
const { analyzeAnimationConflicts } = await import('../src/utils/mergeEngine.ts');

type EntityScope = 'player' | 'mob';

function entityDefinition(scope: EntityScope, controller: string, index: number) {
  return {
    'minecraft:entity': {
      description: {
        identifier: scope === 'player' ? 'minecraft:player' : `example:mob_${index}`,
        animation_controllers: { [`alias.test_${index}`]: controller },
      },
    },
  };
}

async function syntheticPack(
  name: string,
  entities: Array<{ scope: EntityScope; controller: string; index: number }>,
  animation: string,
  controller: string,
  bones: string[] = ['body'],
): Promise<AddonPack> {
  const zip = new JSZip();
  for (const entity of entities) {
    // Insertion order is intentional: the ambiguity regression reproduces a
    // player -> mob -> player sequence that used to incorrectly restore scope.
    zip.file(`entities/entity_${entity.index}.json`, JSON.stringify(
      entityDefinition(entity.scope, entity.controller, entity.index),
    ));
  }
  zip.file('animations/definitions.json', JSON.stringify({
    animations: {
      [animation]: {
        bones: Object.fromEntries(bones.map((bone) => [bone, { rotation: [0, 0, 0] }])),
      },
    },
  }));
  zip.file('animation_controllers/controllers.json', JSON.stringify({
    animation_controllers: {
      [controller]: { states: { default: { animations: [animation] } } },
    },
  }));
  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    id: name,
    name,
    type: 'Resource Pack',
    version: '1.0.0',
    uuid: `synthetic:${name}`,
    fileSize: blob.size,
    dateAdded: 0,
    fileBlob: blob,
  };
}

async function findOverlapScope(
  first: AddonPack,
  second: AddonPack,
): Promise<string[]> {
  const findings = await analyzeAnimationConflicts([first, second]);
  const overlap = findings.find((finding) => finding.kind === 'bone-overlap');
  assert.ok(overlap, 'synthetic packs should produce a shared-bone overlap finding');
  return findings
    .filter((finding) => finding.kind === 'bone-overlap')
    .map((finding) => finding.scope);
}

async function main() {
  const controller = 'controller.test:shared';

  // The controller target (not merely the alias) must inherit entity scope.
  const playerA = await syntheticPack('player-a', [
    { scope: 'player', controller, index: 1 },
  ], 'animation.test:a', controller);
  const playerB = await syntheticPack('player-b', [
    { scope: 'player', controller, index: 2 },
  ], 'animation.test:b', controller);
  assert.deepEqual(await findOverlapScope(playerA, playerB), ['player']);

  const mobA = await syntheticPack('mob-a', [
    { scope: 'mob', controller, index: 3 },
  ], 'animation.test:c', controller);
  const mobB = await syntheticPack('mob-b', [
    { scope: 'mob', controller, index: 4 },
  ], 'animation.test:d', controller);
  assert.deepEqual(await findOverlapScope(mobA, mobB), ['mob']);

  // Different known scopes should never be falsely presented as one scope.
  assert.deepEqual(await findOverlapScope(playerA, mobA), ['unknown']);

  // Regression: once a controller reference is used by both player and mob
  // definitions, a later player definition must not make it player-only again.
  const ambiguousOrderOne = await syntheticPack('ambiguous-order-one', [
    { scope: 'player', controller, index: 10 },
    { scope: 'mob', controller, index: 11 },
    { scope: 'player', controller, index: 12 },
  ], 'animation.test:e', controller);
  const ambiguousOrderTwo = await syntheticPack('ambiguous-order-two', [
    { scope: 'player', controller, index: 20 },
    { scope: 'player', controller, index: 21 },
    { scope: 'mob', controller, index: 22 },
  ], 'animation.test:f', controller);
  assert.deepEqual(await findOverlapScope(ambiguousOrderOne, playerB), ['unknown']);
  assert.deepEqual(await findOverlapScope(ambiguousOrderTwo, playerB), ['unknown']);

  console.log('Animation conflict regression tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
