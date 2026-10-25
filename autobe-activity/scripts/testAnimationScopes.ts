import assert from 'node:assert/strict';
import JSZip from 'jszip';
import type { AddonPack } from '../src/types/modpack.ts';
import { analyzeAnimationConflicts } from '../src/utils/mergeEngine.ts';

function entityJson(identifier: string) {
  return JSON.stringify({
    'minecraft:entity': {
      description: {
        identifier,
        animation_controllers: {
          'controller.alias': 'controller.shared'
        }
      }
    }
  });
}

async function syntheticPack(
  name: string,
  entities: Array<{ path: string; identifier: string }>,
): Promise<AddonPack> {
  const zip = new JSZip();
  for (const entity of entities) zip.file(entity.path, entityJson(entity.identifier));
  zip.file('animation_controllers/shared.json', JSON.stringify({
    animation_controllers: {
      'controller.shared': {
        states: {
          default: { animations: ['animation.shared.walk'] }
        }
      }
    }
  }));
  zip.file('animations/shared.json', JSON.stringify({
    animations: {
      'animation.shared.walk': {
        bones: { torso: { rotation: [0, 0, 0] } }
      }
    }
  }));
  return {
    id: name,
    name,
    type: 'Resource Pack',
    version: '1.0.0',
    uuid: `00000000-0000-4000-8000-${name.padEnd(12, '0').slice(0, 12)}`,
    fileSize: 0,
    dateAdded: 0,
    fileBlob: await zip.generateAsync({ type: 'blob' }),
  };
}

async function test(name: string, run: () => Promise<void>) {
  await run();
  console.log(`✓ ${name}`);
}

await test('player-only and mob-only references retain their scope', async () => {
  const playerA = await syntheticPack('player-pack-a', [
    { path: 'entities/player.json', identifier: 'minecraft:player' },
  ]);
  const playerB = await syntheticPack('player-pack-b', [
    { path: 'entities/player.json', identifier: 'minecraft:player' },
  ]);
  const mobA = await syntheticPack('mob-pack-a', [
    { path: 'entities/wolf.json', identifier: 'minecraft:wolf' },
  ]);
  const mobB = await syntheticPack('mob-pack-b', [
    { path: 'entities/cat.json', identifier: 'minecraft:cat' },
  ]);
  const findings = await analyzeAnimationConflicts([playerA, playerB, mobA, mobB]);
  assert.ok(findings.some(f => f.kind === 'bone-overlap' && f.scope === 'player'),
    'player-only references should be classified as player');
  assert.ok(findings.some(f => f.kind === 'bone-overlap' && f.scope === 'mob'),
    'mob-only references should be classified as mob');
  assert.ok(findings.some(f => f.kind === 'bone-overlap' && f.scope === 'unknown'),
    'cross-scope overlap should be reported as unknown');
});

await test('a player/mob/player reference stays ambiguous after the third definition', async () => {
  const ambiguous = await syntheticPack('ambiguous-pack', [
    { path: 'entities/player-first.json', identifier: 'minecraft:player' },
    { path: 'entities/wolf.json', identifier: 'minecraft:wolf' },
    { path: 'entities/player-last.json', identifier: 'minecraft:player' },
  ]);
  const mob = await syntheticPack('mob-pack', [
    { path: 'entities/cat.json', identifier: 'minecraft:cat' },
  ]);
  const findings = await analyzeAnimationConflicts([ambiguous, mob]);
  assert.ok(findings.length > 0, 'synthetic shared-controller/bone overlap should be detected');
  assert.ok(findings.every(f => f.scope === 'unknown'),
    'a reference used by both player and mob must remain unknown even if player appears later');
});

await test('reversing entity file order does not change ambiguity results', async () => {
  const first = await syntheticPack('ambiguous-a', [
    { path: 'entities/player-first.json', identifier: 'minecraft:player' },
    { path: 'entities/wolf.json', identifier: 'minecraft:wolf' },
    { path: 'entities/player-last.json', identifier: 'minecraft:player' },
  ]);
  const reversed = await syntheticPack('ambiguous-b', [
    { path: 'entities/player-last.json', identifier: 'minecraft:player' },
    { path: 'entities/wolf.json', identifier: 'minecraft:wolf' },
    { path: 'entities/player-first.json', identifier: 'minecraft:player' },
  ]);
  const mob = await syntheticPack('other-mob', [
    { path: 'entities/cat.json', identifier: 'minecraft:cat' },
  ]);
  const [forward, backward] = await Promise.all([
    analyzeAnimationConflicts([first, mob]),
    analyzeAnimationConflicts([reversed, mob]),
  ]);
  const scopes = (items: typeof forward) => items.map(f => ({
    kind: f.kind,
    scope: f.scope,
    detail: f.detail.replace(/ambiguous-[ab]/g, 'ambiguous-pack'),
  }));
  assert.deepEqual(scopes(forward), scopes(backward));
});

console.log('Animation scope regression tests passed.');
