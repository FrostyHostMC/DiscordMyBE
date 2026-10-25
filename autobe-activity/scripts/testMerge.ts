import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractBrarchives } from '../src/utils/brarchive.ts';
import { sanitizeJsonString } from '../src/utils/addonParser.ts';
import { mergeJsonForFile } from '../src/utils/smartJsonMerge.ts';
import { deepMergeUi } from '../src/utils/subpackHudMerge.ts';
import { applyPlayerEntityFixes, findUninitializedAnimVars } from '../src/utils/playerEntityFix.ts';

function test(name: string, run: () => void) {
  run();
  console.log(`✓ ${name}`);
}

test('JSONC comments are stripped without changing strings', () => {
  const input = `{
    // comment
    "url": "https://example.com/a//b",
    "text": "say \\"hello\\" /* literal */",
    /* block
       comment */
    "enabled": true
  }`;
  const parsed = JSON.parse(sanitizeJsonString(input));
  assert.equal(parsed.url, 'https://example.com/a//b');
  assert.equal(parsed.text, 'say "hello" /* literal */');
  assert.equal(parsed.enabled, true);
});

test('JSONC trailing commas and UTF-8 BOM are accepted', () => {
  const input = '\uFEFF{"items":[1,2,],"child":{"ok":true,},}';
  assert.deepEqual(JSON.parse(sanitizeJsonString(input)), { items: [1, 2], child: { ok: true } });
});

test('brarchive extraction restores files and removes private containers', async () => {
  const zip = new JSZip();
  const magic = new Uint8Array([0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26]);
  const name = new TextEncoder().encode('item.json');
  const payload = new TextEncoder().encode('{"minecraft:item":{}}');
  const bytes = new Uint8Array(16 + 256 + payload.length);
  bytes.set(magic, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 1, true);
  view.setUint32(12, 1, true);
  bytes[16] = name.length;
  bytes.set(name, 17);
  view.setUint32(16 + 252, payload.length, true);
  bytes.set(payload, 16 + 256);
  zip.file('__brarchive/items/example.brarchive', bytes);
  const result = await extractBrarchives(zip);
  assert.equal(result.archivesFound, 1);
  assert.equal(result.filesExtracted, 1);
  assert.deepEqual(result.invalidArchives, []);
  assert.equal(zip.file('__brarchive/items/example.brarchive'), null);
  assert.equal(await zip.file('items/example/item.json')?.async('text'), '{"minecraft:item":{}}');
});

test('animation JSON merges named definitions without blending conflicting state machines', () => {
  const merged = mergeJsonForFile('animations/custom_pack.animation.json', [
    { format_version: '1.8.0', animations: {
      'animation.player.attack': { loop: true, bones: { right_arm: { rotation: [1, 2, 3] } } },
      'animation.player.idle': { loop: true },
    } },
    { format_version: '1.8.0', animations: {
      'animation.player.attack': { loop: false, bones: { left_arm: { rotation: [4, 5, 6] } }, animation_length: 2 },
      'animation.player.run': { loop: true },
    } },
  ]);
  assert.deepEqual(merged.animations['animation.player.attack'], {
    loop: true, bones: { right_arm: { rotation: [1, 2, 3] } },
  });
  assert.deepEqual(merged.animations['animation.player.idle'], { loop: true });
  assert.deepEqual(merged.animations['animation.player.run'], { loop: true });
});

test('animation controller JSON preserves whole conflicting controller definitions', () => {
  const merged = mergeJsonForFile('animation_controllers/custom.controller.json', [
    { format_version: '1.10.0', animation_controllers: {
      'controller.animation.player.main': { states: { default: { animations: ['animation.player.idle'], transitions: [{ done: 'attack' }] } } },
    } },
    { format_version: '1.10.0', animation_controllers: {
      'controller.animation.player.main': { states: { default: { animations: ['animation.player.run'], transitions: [{ done: 'run' }] } } },
      'controller.animation.player.extra': { states: { default: { animations: ['animation.player.extra'] } } },
    } },
  ]);
  assert.deepEqual(merged.animation_controllers['controller.animation.player.main'], {
    states: { default: { animations: ['animation.player.idle'], transitions: [{ done: 'attack' }] } },
  });
  assert.ok(merged.animation_controllers['controller.animation.player.extra']);
});

test('HUD merge preserves ordered patches and removes only exact duplicates', () => {
  const merged = mergeJsonForFile('ui/hud_screen.json', [
    { screen: { modifications: [{ array_name: 'controls', operation: 'insert_front', value: 'a' }] } },
    { screen: { modifications: [{ array_name: 'controls', operation: 'insert_front', value: 'b' }] } },
    { screen: { modifications: [{ array_name: 'controls', operation: 'insert_front', value: 'a' }] } },
  ]);
  const patches = merged.screen.modifications;
  assert.equal(patches.length, 2);
  assert.equal(patches[0].value, 'a');
  assert.equal(patches[1].value, 'b');
  JSON.parse(JSON.stringify(merged));
});

test('HUD visibility strings merge as conditions instead of being treated as objects', () => {
  const merged = mergeJsonForFile('ui/hud_screen.json', [
    { screen: { panel: { visible: 'query.is_first_person', text: 'base label' } } },
    { screen: { panel: { visible: 'query.is_alive', text: 'overlay label' } } },
  ]);
  assert.equal(merged.screen.panel.visible, '(query.is_first_person) && (query.is_alive)');
  assert.equal(merged.screen.panel.text, 'base label');
});

test('subpack HUD merge preserves controls and bindings from both packs', () => {
  const result = deepMergeUi(
    { panel: { visible: 'query.is_first_person', controls: [{ base: {} }], bindings: [{ binding_name: '#base' }] } },
    { panel: { visible: 'query.is_alive', controls: [{ overlay: {} }], bindings: [{ binding_name: '#overlay' }] } },
  );
  assert.equal(result.panel.visible, '(query.is_first_person) && (query.is_alive)');
  assert.deepEqual(result.panel.controls, [{ base: {} }, { overlay: {} }]);
  assert.deepEqual(result.panel.bindings, [{ binding_name: '#base' }, { binding_name: '#overlay' }]);
});

test('missing animation aliases are preserved and not silently redirected to walking', () => {
  const entity = {
    'minecraft:client_entity': {
      description: {
        identifier: 'minecraft:player',
        animations: { move: 'animation.player.move' },
        scripts: { animate: ['relic_first_person_conflict'] },
      },
    },
  };
  applyPlayerEntityFixes(entity);
  const description = entity['minecraft:client_entity'].description;
  assert.equal((description.animations as Record<string, string>).relic_first_person_conflict, undefined);
  assert.deepEqual(description.scripts.animate, ['relic_first_person_conflict']);
});

test('unknown Molang variables are diagnosed, not assigned guessed zero values', () => {
  const entity = {
    'minecraft:client_entity': {
      description: {
        scripts: { initialize: [], pre_animation: [] },
      },
    },
  };
  const missing = findUninitializedAnimVars(entity, new Set(['is_holding_left', 'relic_custom_state']));
  assert.deepEqual(missing, ['is_holding_left', 'relic_custom_state']);
  assert.deepEqual(entity['minecraft:client_entity'].description.scripts.initialize, []);
  assert.deepEqual(entity['minecraft:client_entity'].description.scripts.pre_animation, []);
});

console.log('Merge regression tests passed.');
