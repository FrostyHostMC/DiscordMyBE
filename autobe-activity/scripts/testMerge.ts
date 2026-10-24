import assert from 'node:assert/strict';
import { sanitizeJsonString } from '../src/utils/addonParser.ts';
import { mergeJsonForFile } from '../src/utils/smartJsonMerge.ts';
import { deepMergeUi } from '../src/utils/subpackHudMerge.ts';

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

test('subpack HUD visibility conditions are both retained', () => {
  const result = deepMergeUi(
    { panel: { visible: 'query.is_first_person', controls: [{ base: {} }] } },
    { panel: { visible: 'query.is_alive', controls: [{ overlay: {} }] } },
  );
  assert.equal(result.panel.visible, '(query.is_first_person) && (query.is_alive)');
  assert.deepEqual(result.panel.controls, [{ overlay: {} }]);
});

console.log('Merge regression tests passed.');
