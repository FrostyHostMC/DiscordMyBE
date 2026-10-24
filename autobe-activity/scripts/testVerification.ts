import assert from 'node:assert/strict';
import { mergeJsonForFile } from '../src/utils/smartJsonMerge.ts';
import { deepMergeUi } from '../src/utils/subpackHudMerge.ts';

function assertJsonSerializable(value: unknown, label: string) {
  const serialized = JSON.stringify(value);
  assert.notEqual(serialized, undefined, `${label} must serialize to JSON`);
  assert.doesNotThrow(() => JSON.parse(serialized as string), `${label} must round-trip through JSON`);
}

const hud = mergeJsonForFile('ui/hud_screen.json', [
  {
    namespace: {
      hud_content: {
        modifications: [
          { array_name: 'controls', operation: 'insert_front', value: { hud_text: { type: 'label', text: 'base' } } },
        ],
      },
    },
  },
  {
    namespace: {
      hud_content: {
        modifications: [
          { array_name: 'controls', operation: 'insert_front', value: { hud_text_2: { type: 'label', text: 'overlay' } } },
        ],
      },
    },
  },
]);

assertJsonSerializable(hud, 'merged HUD');
assert.equal(hud.namespace.hud_content.modifications.length, 2);

const subpack = deepMergeUi(
  structuredClone(hud),
  { namespace: { hud_content: { modifications: [{ array_name: 'controls', operation: 'insert_front', value: { subpack_label: { type: 'label', text: 'subpack' } } }] } } },
);
assertJsonSerializable(subpack, 'merged subpack HUD');
assert.equal(subpack.namespace.hud_content.modifications.length, 3);

console.log('Output verification tests passed.');
