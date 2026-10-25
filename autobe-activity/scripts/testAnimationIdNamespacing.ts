import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { namespaceConflictingAnimationIds } from '../src/utils/animationIdNamespacing.ts';

async function makePack(animation: any, controller: any, entity: any) {
  const zip = new JSZip();
  zip.file('animations/player.animation.json', JSON.stringify({ animations: { 'animation.player.idle': animation } }));
  zip.file('animation_controllers/player.controller.json', JSON.stringify({
    animation_controllers: { 'controller.animation.player.main': controller },
  }));
  zip.file('entity/player.entity.json', JSON.stringify({
    'minecraft:client_entity': { description: {
      identifier: 'minecraft:player',
      animations: { idle_alias: 'animation.player.idle' },
      animation_controllers: { main_alias: 'controller.animation.player.main' },
      scripts: { animate: ['idle_alias', 'main_alias'] },
      textures: entity,
    } },
  }));
  return zip;
}

async function main() {
  const seen = new Map<string, { signature: string; owner: string }>();
  const first = await makePack({ loop: true, bones: { body: { rotation: [0, 0, 0] } } }, {
    states: { default: { animations: ['animation.player.idle'] } },
  }, { default: 'textures/first' });
  const firstRepairs = await namespaceConflictingAnimationIds(first, 'pack-a', 'Pack A', seen);
  assert.equal(firstRepairs.length, 0);

  const second = await makePack({ loop: false, bones: { body: { rotation: [0, 45, 0] } } }, {
    states: { default: { animations: ['animation.player.idle'] } },
  }, { default: 'textures/second' });
  const repairs = await namespaceConflictingAnimationIds(second, 'pack-b', 'Pack B', seen);
  assert.equal(repairs.length, 2);
  assert.ok(repairs.some(r => r.originalId === 'animation.player.idle'));
  assert.ok(repairs.some(r => r.originalId === 'controller.animation.player.main'));

  const anim = JSON.parse((await second.file('animations/player.animation.json')!.async('text')));
  const ctrl = JSON.parse((await second.file('animation_controllers/player.controller.json')!.async('text')));
  const entity = JSON.parse((await second.file('entity/player.entity.json')!.async('text')));
  const newAnimation = repairs.find(r => r.originalId === 'animation.player.idle')!.renamedId;
  const newController = repairs.find(r => r.originalId === 'controller.animation.player.main')!.renamedId;
  assert.ok(anim.animations[newAnimation]);
  assert.deepEqual(ctrl.animation_controllers[newController].states.default.animations, [newAnimation]);
  assert.equal(entity['minecraft:client_entity'].description.animations.idle_alias, newAnimation);
  assert.equal(entity['minecraft:client_entity'].description.animation_controllers.main_alias, newController);
  assert.deepEqual(entity['minecraft:client_entity'].description.scripts.animate, ['idle_alias', 'main_alias']);

  console.log('Animation ID collision repair tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
