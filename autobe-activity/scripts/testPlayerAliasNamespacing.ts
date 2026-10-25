import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { namespaceConflictingPlayerAliases } from '../src/utils/animationIdNamespacing.ts';

function makePlayerPack(animationTarget: string, controllerTarget: string) {
  const zip = new JSZip();
  zip.file('entity/player.entity.json', JSON.stringify({
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: 'minecraft:player',
        animations: { idle: animationTarget },
        animation_controllers: { main: controllerTarget },
        scripts: { animate: ['idle', 'main', { idle: 'query.is_on_ground' }] },
      },
    },
  }));
  return zip;
}

async function main() {
  const seen = new Map<string, { signature: string; owner: string }>();
  const first = makePlayerPack('animation.first.idle', 'controller.animation.first.main');
  assert.equal((await namespaceConflictingPlayerAliases(first, 'a', 'Relic', seen)).length, 0);

  const second = makePlayerPack('animation.second.idle', 'controller.animation.second.main');
  const repairs = await namespaceConflictingPlayerAliases(second, 'b', 'Fiery Combat', seen);
  assert.equal(repairs.length, 2);
  const idle = repairs.find(r => r.originalAlias === 'idle')!.renamedAlias;
  const mainAlias = repairs.find(r => r.originalAlias === 'main')!.renamedAlias;
  const entity = JSON.parse(await (await second.file('entity/player.entity.json')!).async('text'));
  const description = entity['minecraft:client_entity'].description;
  assert.equal(description.animations[idle], 'animation.second.idle');
  assert.equal(description.animation_controllers[mainAlias], 'controller.animation.second.main');
  assert.deepEqual(description.scripts.animate, [idle, mainAlias, { [idle]: 'query.is_on_ground' }]);

  const identical = makePlayerPack('animation.first.idle', 'controller.animation.first.main');
  assert.equal((await namespaceConflictingPlayerAliases(identical, 'c', 'Identical Copy', seen)).length, 0);
  console.log('Player animation alias namespacing tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
