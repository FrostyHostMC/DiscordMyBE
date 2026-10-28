import assert from 'node:assert/strict';
import { sanitizeJsonString } from '../src/utils/addonParser.ts';
import { mergeJsonForFile } from '../src/utils/smartJsonMerge.ts';
import { deepMergeUi } from '../src/utils/subpackHudMerge.ts';
import { mergeJsonData } from '../src/utils/behaviorEntityMerge.ts';
import JSZip from 'jszip';
import { mergeDefinitionsByIdentifier } from '../src/utils/definitionMerger.ts';
import { expandBrarchiveFiles } from '../src/utils/brarchive.ts';
import { makePackNs, namespaceScriptText } from '../src/utils/scriptNamespacing.ts';
import { guardUnavailableEventSubscriptions } from '../src/utils/scriptCompatibility.ts';

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

test('player animation/controller files merge named entries instead of last-pack overwrite', () => {
  const merged = mergeJsonForFile('animation_controllers/player.animation_controllers.json', [
    {
      format_version: '1.10.0',
      'controller.animation.player.first_person': { states: { default: { animations: ['base_first_person'] } } }
    },
    {
      format_version: '1.10.0',
      'controller.animation.player.third_person': { states: { default: { animations: ['overlay_third_person'] } } }
    }
  ]);
  assert.ok(merged['controller.animation.player.first_person']);
  assert.ok(merged['controller.animation.player.third_person']);
  assert.deepEqual(
    merged['controller.animation.player.third_person'].states.default.animations,
    ['overlay_third_person']
  );
  JSON.parse(JSON.stringify(merged));
});

console.log('Merge regression tests passed.');


test('duplicate item definitions preserve compatible components from both addons', () => {
  const merged = {
    format_version: '1.20.0',
    'minecraft:item': {
      description: { identifier: 'demo:utility_item' },
      components: {
        'minecraft:icon': { texture: 'utility_item' },
        'minecraft:max_stack_size': 16
      }
    }
  };
  const addonItem = {
    format_version: '1.20.0',
    'minecraft:item': {
      description: { identifier: 'demo:utility_item' },
      components: {
        'minecraft:food': { nutrition: 2, can_always_eat: true },
        'minecraft:max_stack_size': 64
      }
    }
  };
  mergeJsonData(merged, addonItem);
  assert.equal(merged['minecraft:item'].description.identifier, 'demo:utility_item');
  assert.deepEqual(merged['minecraft:item'].components['minecraft:icon'], { texture: 'utility_item' });
  assert.deepEqual(merged['minecraft:item'].components['minecraft:food'], { nutrition: 2, can_always_eat: true });
  assert.equal(merged['minecraft:item'].components['minecraft:max_stack_size'], 64);
  JSON.parse(JSON.stringify(merged));
});

test('same item component can combine non-conflicting component properties', () => {
  const merged = {
    'minecraft:item': {
      description: { identifier: 'demo:book_tool' },
      components: { 'minecraft:food': { nutrition: 2 } }
    }
  };
  mergeJsonData(merged, {
    'minecraft:item': {
      description: { identifier: 'demo:book_tool' },
      components: { 'minecraft:food': { can_always_eat: true } }
    }
  });
  assert.deepEqual(merged['minecraft:item'].components['minecraft:food'], {
    nutrition: 2,
    can_always_eat: true
  });
});


await (async () => {
  // Exercise the same post-accumulation pass used by executeMergePacks.
  const zip = new JSZip();
  zip.file('items/utility_item.json', JSON.stringify({
    format_version: '1.20.0',
    'minecraft:item': {
      description: { identifier: 'demo:utility_item' },
      components: {
        'minecraft:icon': { texture: 'utility_item' },
        'minecraft:max_stack_size': 16
      }
    }
  }));
  zip.file('items/utility_item_extra.json', JSON.stringify({
    format_version: '1.20.0',
    'minecraft:item': {
      description: { identifier: 'demo:utility_item' },
      components: {
        'minecraft:food': { nutrition: 2, can_always_eat: true },
        'minecraft:max_stack_size': 64
      }
    }
  }));
  await mergeDefinitionsByIdentifier(zip);
  const paths = Object.keys(zip.files).filter(p => p.startsWith('items/') && !zip.files[p].dir);
  assert.equal(paths.length, 1);
  const result = JSON.parse(await zip.file(paths[0])!.async('text'));
  assert.equal(result['minecraft:item'].description.identifier, 'demo:utility_item');
  assert.deepEqual(result['minecraft:item'].components['minecraft:icon'], { texture: 'utility_item' });
  assert.deepEqual(result['minecraft:item'].components['minecraft:food'], { nutrition: 2, can_always_eat: true });
  assert.equal(result['minecraft:item'].components['minecraft:max_stack_size'], 64);
  console.log('✓ full ZIP merge combines duplicate item identifiers from separate paths');
})();


await (async () => {
  const zip = new JSZip();
  const files: Array<[string, Uint8Array]> = [
    ['copper_greatsword.json', new TextEncoder().encode('{"minecraft:item":{"description":{"identifier":"fiery_combat:copper_greatsword"}}}')],
    ['wooden_greatsword.json', new TextEncoder().encode('{"minecraft:item":{"description":{"identifier":"fiery_combat:wooden_greatsword"}}}')],
  ];
  const payloadBase = 16 + files.length * 256;
  const payloadLength = files.reduce((total, [, data]) => total + data.length, 0);
  const bytes = new Uint8Array(payloadBase + payloadLength);
  bytes.set([0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, files.length, true);
  view.setUint32(12, 1, true);
  let payloadOffset = 0;
  files.forEach(([name, data], index) => {
    const record = 16 + index * 256;
    const nameBytes = new TextEncoder().encode(name);
    bytes[record] = nameBytes.length;
    bytes.set(nameBytes, record + 1);
    view.setUint32(record + 248, payloadOffset, true);
    view.setUint32(record + 252, data.length, true);
    bytes.set(data, payloadBase + payloadOffset);
    payloadOffset += data.length;
  });
  zip.file('__brarchive/items/fiery/greatsword.brarchive', bytes);
  const count = await expandBrarchiveFiles(zip);
  assert.equal(count, 2);
  assert.equal(zip.file('__brarchive/items/fiery/greatsword.brarchive'), null);
  assert.ok(zip.file('items/fiery/copper_greatsword.json'));
  assert.ok(zip.file('items/fiery/wooden_greatsword.json'));
  console.log('✓ packed .brarchive item definitions are expanded into Bedrock JSON paths');
})();


await (async () => {
  const zip = new JSZip();
  const diagnostics: string[] = [];
  const makeArchive = (entries: Array<[string, Uint8Array]>) => {
    const payloadBase = 16 + entries.length * 256;
    const payloadLength = entries.reduce((total, [, data]) => total + data.length, 0);
    const bytes = new Uint8Array(payloadBase + payloadLength);
    bytes.set([0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, entries.length, true);
    let offset = 0;
    entries.forEach(([name, data], index) => {
      const record = 16 + index * 256;
      const nameBytes = new TextEncoder().encode(name);
      bytes[record] = nameBytes.length;
      bytes.set(nameBytes, record + 1);
      view.setUint32(record + 248, offset, true);
      view.setUint32(record + 252, data.length, true);
      bytes.set(data, payloadBase + offset);
      offset += data.length;
    });
    return bytes;
  };
  const same = new TextEncoder().encode('same');
  const different = new TextEncoder().encode('different');
  zip.file('items/kept.json', same);
  zip.file('__brarchive/items/collision.brarchive', makeArchive([
    ['kept.json', same],
    ['kept.json', different]
  ]));
  const count = await expandBrarchiveFiles(zip, diagnostics);
  assert.equal(count, 1, 'identical payload should be skipped, distinct collision preserved');
  assert.deepEqual(Array.from(await zip.file('items/kept.json')!.async('uint8array')), Array.from(same));
  assert.deepEqual(Array.from(await zip.file('items/kept.autobe-2.json')!.async('uint8array')), Array.from(different));
  assert.ok(diagnostics.some(message => message.includes('Duplicate identical archive entry skipped')));
  assert.ok(diagnostics.some(message => message.includes('References to this duplicate were not automatically rewritten')));
  console.log('✓ .brarchive expansion preserves conflicts, skips identical payloads, and emits diagnostics');
})();


await (async () => {
  const zip = new JSZip();
  const diagnostics: string[] = [];
  const identical = {
    format_version: '1.10.0',
    'minecraft:attachable': {
      description: {
        identifier: 'minecraft:apple',
        geometry: { default: 'geometry.item_sprite' },
        textures: { default: 'textures/items/apple' }
      }
    }
  };
  zip.file('attachables/apple.json', JSON.stringify(identical));
  zip.file('attachables/apple(Copy).json', JSON.stringify(identical));
  zip.file('attachables/stick.json', JSON.stringify({
    ...identical,
    'minecraft:attachable': {
      description: { ...identical['minecraft:attachable'].description, identifier: 'minecraft:stick' }
    }
  }));
  zip.file('attachables/stick(Copy).json', JSON.stringify({
    ...identical,
    'minecraft:attachable': {
      description: {
        ...identical['minecraft:attachable'].description,
        identifier: 'minecraft:stick',
        geometry: { default: 'geometry.custom_item' }
      }
    }
  }));
  await mergeDefinitionsByIdentifier(zip, diagnostics);
  assert.ok(zip.file('attachables/apple.json'));
  assert.equal(zip.file('attachables/apple(Copy).json'), null);
  assert.ok(zip.file('attachables/stick.json'));
  assert.ok(zip.file('attachables/stick(Copy).json'));
  assert.ok(diagnostics.some(message => message.includes('Conflicting attachables share identifier "minecraft:stick"')));
  console.log('✓ identical attachables deduplicate while incompatible visual rigs remain explicit');
})();


await (async () => {
  const zip = new JSZip();
  const diagnostics: string[] = [];
  zip.file('scripts/main.js', [
    'world.afterEvents.cameraChange.subscribe((event) => {});',
    'world.beforeEvents.inventory.drop.subscribe((event) => {});',
    'world.afterEvents.itemUse?.subscribe?.((event) => {});'
  ].join('\n'));

  const changed = await guardUnavailableEventSubscriptions(zip, diagnostics);
  assert.equal(changed, 1);
  const output = await zip.file('scripts/main.js')!.async('text');
  assert.ok(output.includes('world?.afterEvents?.cameraChange?.subscribe?.('));
  assert.ok(output.includes('world?.beforeEvents?.inventory?.drop?.subscribe?.('));
  assert.ok(output.includes('world?.afterEvents?.itemUse?.subscribe?.('));
  assert.equal(diagnostics.length, 1);

  const secondPass = await guardUnavailableEventSubscriptions(zip, diagnostics);
  assert.equal(secondPass, 0, 'event guard pass must be idempotent');
  console.log('✓ unavailable Script API event subscriptions are guarded without add-on-specific rules');
})();


await (async () => {
  const zip = new JSZip();
  const diagnostics: string[] = [];
  zip.file('scripts/legacy-item.js', [
    'const item = {',
    '  typeId: "minecraft:stick",',
    '  amount: 1,',
    '  components: {',
    '    "minecraft:item_lock": { mode: "lock_in_slot" },',
    '    "minecraft:can_destroy": { blocks: [] },',
    '    "minecraft:item_durability": { damage: 0, max_durability: 0 }',
    '  }',
    '};',
    'inventory.setItem(8, item);'
  ].join('\n'));
  const changed = await guardUnavailableEventSubscriptions(zip, diagnostics);
  assert.equal(changed, 1);
  const output = await zip.file('scripts/legacy-item.js')!.async('text');
  assert.ok(output.includes('new AutoBEItemStack("minecraft:stick", 1)'));
  assert.ok(output.includes('ItemLockMode as AutoBEItemLockMode'));
  assert.ok(output.includes('item.lockMode = AutoBEItemLockMode.slot'));
  assert.ok(output.includes('item.setCanDestroy([])'));
  assert.ok(diagnostics.some(message => message.includes('Converted legacy plain-object ItemStack')));

  const unsafe = new JSZip();
  const unsafeDiagnostics: string[] = [];
  unsafe.file('scripts/unsafe-item.js', [
    'const item = { typeId: "custom:item", amount: 1, components: { "minecraft:custom_component": { value: 2 } } };',
    'inventory.setItem(0, item);'
  ].join('\n'));
  await guardUnavailableEventSubscriptions(unsafe, unsafeDiagnostics);
  const preserved = await unsafe.file('scripts/unsafe-item.js')!.async('text');
  assert.ok(preserved.includes('"minecraft:custom_component"'));
  assert.ok(preserved.includes('const item = {'));
  assert.ok(unsafeDiagnostics.some(message => message.includes('was not rewritten')));
  console.log('✓ legacy plain-object ItemStacks are converted only when recognized; unknown components are preserved with diagnostics');
})();
