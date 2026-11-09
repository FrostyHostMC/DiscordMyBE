import assert from 'node:assert/strict';
import { sanitizeJsonString, detectConflicts, parseAddonArchive, collectRegisteredUiPathsFromZip } from '../src/utils/addonParser.ts';
import { applySubpackSelection } from '../src/utils/subpackProcessor.ts';
import { mergeJsonForFile, isUiMergeStrategyFile, isAnimationRegistryStrategyFile, isCraftingItemCatalogStrategyFile } from '../src/utils/smartJsonMerge.ts';
import { deepMergeUi } from '../src/utils/subpackHudMerge.ts';
import { mergeJsonData } from '../src/utils/behaviorEntityMerge.ts';
import JSZip from 'jszip';
import { mergeDefinitionsByIdentifier } from '../src/utils/definitionMerger.ts';
import { applyFeatureRegistry } from '../src/utils/featureRegistry.ts';
import { expandBrarchiveFiles } from '../src/utils/brarchive.ts';
import { makePackNs, namespaceScriptText, scriptModuleOutputPath } from '../src/utils/scriptNamespacing.ts';
import { guardUnavailableEventSubscriptions } from '../src/utils/scriptCompatibility.ts';
import { resolveTargetEngineVersion } from '../src/utils/targetEngine.ts';
import { selectMergeOutputs } from '../src/utils/outputOptions.ts';
import { rewriteIdentifierTokens, rewriteStaticScriptIdentifierReferences } from '../src/utils/identifierReferences.ts';
import { validateMergedArchive } from '../src/utils/mergedArchiveValidation.ts';
import { resolveHudPlacements, HUD_POSITIONS } from '../src/utils/hudLayout.ts';
import { planBinaryAssetCollisions, rewriteAssetReferences, isVanillaOverridePath, applyVanillaAssetResolutions } from '../src/utils/assetCollision.ts';

function test(name: string, run: () => void) {
  run();
  console.log(`✓ ${name}`);
}

await (async () => {
  const source = new JSZip();
  source.file('manifest.json', JSON.stringify({
    format_version: 2,
    header: { name: 'Subpack UI Fixture', uuid: '11111111-1111-4111-8111-111111111111', version: [1, 0, 0], min_engine_version: [1, 26, 0] },
    modules: [{ type: 'resources', uuid: '22222222-2222-4222-8222-222222222222', version: [1, 0, 0] }],
    subpacks: [
      { folder_name: 'fallenmarble', name: 'Fallen Marble UI', memory_tier: 0 },
      { folder_name: 'normal', name: 'Normal UI', memory_tier: 1 }
    ]
  }));
  source.file('ui/_ui_defs.json', JSON.stringify({ ui_defs: ['ui/custom_screen.json'] }));
  source.file('ui/custom_screen.json', JSON.stringify({ namespace: 'fixture', screen: { type: 'panel' } }));
  source.file('textures/ui/base.png', new Uint8Array([1]));
  source.file('subpacks/fallenmarble/textures/ui/frame.png', new Uint8Array([2]));
  source.file('subpacks/normal/textures/ui/frame.png', new Uint8Array([3]));
  const sourceBlob = await source.generateAsync({ type: 'blob' });
  const parsed = await parseAddonArchive(sourceBlob, 'subpack-ui.mcpack');
  assert.equal(parsed.packs.length, 1);
  assert.deepEqual(parsed.packs[0].subpacks?.map(item => item.folder), ['fallenmarble', 'normal'],
    'standard folder_name entries must be recognized so the user can choose a variant');
  const selected = await applySubpackSelection(parsed.packs[0].fileBlob!, 'fallenmarble');
  const selectedZip = await JSZip.loadAsync(selected);
  assert.ok(selectedZip.file('textures/ui/frame.png'), 'selected variant UI assets must be flattened to the pack root');
  assert.equal((await selectedZip.file('textures/ui/frame.png')!.async('uint8array'))[0], 2);
  assert.equal((await selectedZip.file('textures/ui/base.png')!.async('uint8array'))[0], 1);
  assert.equal(selectedZip.file('subpacks/normal/textures/ui/frame.png'), null, 'unselected variant must not leak into output');
  const manifest = JSON.parse(await selectedZip.file('manifest.json')!.async('text'));
  assert.equal(manifest.subpacks, undefined, 'selected output must not prompt again');
  await assert.rejects(
    () => applySubpackSelection(parsed.packs[0].fileBlob!, 'missing_variant'),
    /Selected subpack "missing_variant" was not found/,
    'a missing requested variant must fail instead of silently substituting a different UI pack'
  );
  console.log('✓ standard Bedrock folder_name subpacks are detected and selected UI assets are retained');
})();

await (async () => {
  const registryZip = new JSZip();
  registryZip.file('ui/_ui_defs.json', JSON.stringify({
    ui_defs: ['custom_screens/menu.json', 'ui/common_controls.json', './ui/relative_screen.json']
  }));
  const registered = await collectRegisteredUiPathsFromZip(registryZip);
  assert.ok(registered.has('custom_screens/menu.json'),
    'custom UI definitions outside the ui/ folder must be discovered');
  assert.ok(registered.has('ui/common_controls.json'));
  assert.ok(registered.has('ui/relative_screen.json'));

  const merged = mergeJsonForFile('custom_screens/menu.json', [
    { namespace: 'fixture', first_panel: { type: 'panel', controls: [{ first_button: { type: 'button' } }] } },
    { namespace: 'fixture', second_panel: { type: 'panel', controls: [{ second_button: { type: 'button' } }] } }
  ], [], true);
  assert.ok(merged.first_panel);
  assert.ok(merged.second_panel,
    'registered custom UI files must use the UI merger even when they live outside ui/');
  console.log('✓ registered UI files outside ui/ are discovered and merged with UI-aware semantics');
})();

test('multiple chest-screen UI add-ons retain each registered container screen modification', () => {
  const merged = mergeJsonForFile('ui/chest_screen.json', [
    { namespace: 'chest', small_chest_screen: {
      '$temp_container_title|default': '$container_title',
      modifications: [{ array_name: 'variables', operation: 'insert_back', value: [
        { requires: "($temp_container_title = 'fixture:first')", '$screen_content': 'first.panel' }
      ] }]
    } },
    { namespace: 'chest', small_chest_screen: {
      '$temp_container_title|default': '$container_title',
      modifications: [{ array_name: 'variables', operation: 'insert_back', value: [
        { requires: "($temp_container_title = 'fixture:second')", '$screen_content': 'second.panel' }
      ] }]
    } }
  ]);
  const modifications = merged.small_chest_screen.modifications;
  assert.equal(modifications.length, 2);
  const conditions = modifications.flatMap((entry: any) => entry.value.map((item: any) => item.requires));
  assert.ok(conditions.includes("($temp_container_title = 'fixture:first')"));
  assert.ok(conditions.includes("($temp_container_title = 'fixture:second')"));
});

test('shared animation registries and item catalogs are recognized for strategy merging', () => {
  assert.equal(isAnimationRegistryStrategyFile('render_controllers/translucence.json'), true);
  assert.equal(isAnimationRegistryStrategyFile('animations/mobs/dragon.animation.json'), true);
  assert.equal(isAnimationRegistryStrategyFile('animation_controllers/mobs/dragon.controller.json'), true);
  assert.equal(isAnimationRegistryStrategyFile('entities/dragon.json'), false);
  assert.equal(isCraftingItemCatalogStrategyFile('item_catalog/crafting_item_catalog.json'), true);
  assert.equal(isCraftingItemCatalogStrategyFile('crafting_item_catalog.json'), true);
  assert.equal(isCraftingItemCatalogStrategyFile('items/crafting_item_catalog.json'), false);
});

test('crafting item catalog merges categories and unique creative groups from every pack', () => {
  const merged = mergeJsonForFile('item_catalog/crafting_item_catalog.json', [
    { 'minecraft:crafting_items_catalog': { categories: [
      { category_name: 'equipment', groups: [{ group_identifier: { icon: 'demo:first' }, items: ['demo:first'] }] }
    ] } },
    { 'minecraft:crafting_items_catalog': { categories: [
      { category_name: 'equipment', groups: [{ group_identifier: { icon: 'demo:second' }, items: ['demo:second'] }] },
      { category_name: 'building', groups: [{ group_identifier: { icon: 'demo:block' }, items: ['demo:block'] }] }
    ] } }
  ]);
  const categories = merged['minecraft:crafting_items_catalog'].categories;
  assert.equal(categories.length, 2);
  assert.deepEqual(categories[0].groups.map((group: any) => group.group_identifier.icon), ['demo:first', 'demo:second']);
  assert.deepEqual(categories[1].groups.map((group: any) => group.group_identifier.icon), ['demo:block']);
});

test('shared render-controller registry retains distinct controllers from colliding files', () => {
  const merged = mergeJsonForFile('render_controllers/translucence.json', [
    { format_version: '1.8.0', 'controller.render.first_addon': { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] } },
    { format_version: '1.8.0', 'controller.render.second_addon': { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] } }
  ]);
  assert.ok(merged['controller.render.first_addon']);
  assert.ok(merged['controller.render.second_addon']);
});

test('HUD placement resolver relocates overlapping measurable controls to distinct safe anchors', () => {
  const hud = {
    root: {
      size: ['100%', '100%'],
      modifications: [{
        array_name: 'controls',
        operation: 'insert_front',
        value: [
          { 'coords@hud.coords': {} },
          { 'ammo@hud.ammo': {} },
          { 'boss@hud.boss': {} },
        ],
      }],
    },
  };
  const definitions = [{
    coords: { type: 'panel', size: [240, 60], anchor_from: 'top_left', anchor_to: 'top_left', offset: [14, 14] },
    ammo: { type: 'panel', size: [240, 60], anchor_from: 'top_left', anchor_to: 'top_left', offset: [14, 14] },
    boss: { type: 'panel', size: [240, 60], anchor_from: 'top_left', anchor_to: 'top_left', offset: [14, 14] },
  }];
  const result = resolveHudPlacements(hud, definitions, 'auto');
  assert.equal(result.moved.length, 2);
  assert.equal(result.unresolved.length, 0);
  assert.equal(new Set(result.moved.map(item => item.to)).size, 2);
  assert.deepEqual(HUD_POSITIONS.length, 9);
  assert.equal(hud.root.modifications[0].value[1]['ammo@hud.ammo'].anchor_from, undefined, 'source input must not be mutated');
});

test('HUD placement treats existing root controls as fixed occupied space', () => {
  const hud = { root_panel: {
    controls: [{ 'vanilla@hud.vanilla': {} }],
    modifications: [{ array_name: 'controls', operation: 'insert_front', value: [{ 'addon@hud.addon': {} }] }],
  } };
  const definitions = [{
    vanilla: { size: [220, 64], anchor_from: 'top_left', anchor_to: 'top_left', offset: [12, 12] },
    addon: { size: [220, 64], anchor_from: 'top_left', anchor_to: 'top_left', offset: [12, 12] },
  }];
  const result = resolveHudPlacements(hud, definitions, 'auto');
  assert.equal(result.moved.length, 1);
  assert.notEqual(result.moved[0].to, 'top_left', 'new add-on HUD must move away from an existing root control');
  assert.equal(result.hud.root_panel.controls[0]['vanilla@hud.vanilla'].anchor_from, undefined, 'existing HUD control must not be mutated');
});

test('HUD placement ignores removal and replacement patches', () => {
  const hud = { root: { size: ['100%', '100%'], modifications: [
    { array_name: 'controls', operation: 'remove', value: [{ 'remove@hud.remove': {} }] },
    { array_name: 'controls', operation: 'replace', value: [{ 'replace@hud.replace': {} }] },
    { array_name: 'controls', operation: 'insert_back', value: [{ 'insert@hud.insert': {} }] },
  ] } };
  const definitions = [{
    remove: { size: [100, 40], anchor_from: 'top_left', anchor_to: 'top_left', offset: [8, 8] },
    replace: { size: [100, 40], anchor_from: 'top_left', anchor_to: 'top_left', offset: [8, 8] },
    insert: { size: [100, 40], anchor_from: 'top_left', anchor_to: 'top_left', offset: [8, 8] },
  }];
  const result = resolveHudPlacements(hud, definitions, 'auto');
  assert.equal(result.moved.length, 0);
  assert.deepEqual(result.hud, hud);
});

test('HUD placement resolver recognizes the canonical inherited root_panel coordinate space', () => {
  const hud = { root_panel: { modifications: [{ array_name: 'controls', operation: 'insert_front', value: [
    { 'first@hud.first': {} }, { 'second@hud.second': {} },
  ] }] } };
  const definitions = [{
    first: { size: [180, 48], anchor_from: 'top_left', anchor_to: 'top_left', offset: [8, 8] },
    second: { size: [180, 48], anchor_from: 'top_left', anchor_to: 'top_left', offset: [8, 8] },
  }];
  const result = resolveHudPlacements(hud, definitions, 'auto');
  assert.equal(result.moved.length, 1, 'root_panel inherits the full-screen HUD coordinate space');
  assert.equal(result.unresolved.length, 0);
});

test('HUD placement resolver uses all nine positions and leaves excess collisions intact', () => {
  const controls: any[] = [];
  const definitions: any = {};
  for (let index = 0; index < 10; index++) {
    const name = 'panel_' + index;
    controls.push({ [name + '@hud.' + name]: {} });
    definitions[name] = { type: 'panel', size: [240, 60], anchor_from: 'top_left', anchor_to: 'top_left', offset: [14, 14] };
  }
  const hud = { root: { size: ['100%', '100%'], modifications: [{ array_name: 'controls', operation: 'insert_front', value: controls }] } };
  const result = resolveHudPlacements(hud, [definitions], 'auto');
  assert.equal(result.moved.length, 8);
  assert.equal(result.unresolved.length, 1, 'the tenth overlapping panel must not be forced into an occupied position');
  assert.equal(new Set(result.moved.map(item => item.to)).size, 8);
  assert.ok(HUD_POSITIONS.every(position => position === 'top_left' || result.moved.some(item => item.to === position)));
});

test('HUD placement resolver leaves dynamic or unknown-size controls unchanged', () => {
  const hud = { root: { modifications: [{ array_name: 'controls', operation: 'insert_front', value: [
    { 'dynamic@hud.dynamic': { anims: ['@hud.move'], offset: ['$dynamic_x', 0] } },
  ] }] } };
  const result = resolveHudPlacements(hud, [{ dynamic: { type: 'panel', size: [100, 40], anchor_from: 'top_left', anchor_to: 'top_left' } }], 'auto');
  assert.equal(result.moved.length, 0);
  assert.deepEqual(result.hud, hud);
});

test('HUD placement preserve mode does not rewrite overlapping controls', () => {
  const hud = { root: { size: ['100%', '100%'], modifications: [{ array_name: 'controls', operation: 'insert_front', value: [
    { 'one@hud.one': {} }, { 'two@hud.two': {} },
  ] }] } };
  const definitions = [{ one: { size: [100, 50], anchor_from: 'center', anchor_to: 'center' }, two: { size: [100, 50], anchor_from: 'center', anchor_to: 'center' } }];
  const result = resolveHudPlacements(hud, definitions, 'preserve');
  assert.equal(result.moved.length, 0);
  assert.equal(result.unresolved.length, 1);
  assert.deepEqual(result.hud, hud);
});

test('selected Bedrock target is written as the minimum when source packs support it', () => {
  const diagnostics: string[] = [];
  assert.equal(resolveTargetEngineVersion('1.21.50', ['1.20.0', '1.21.0'], diagnostics, 'Behavior'), '1.21.50');
  assert.deepEqual(diagnostics, []);
});

test('source pack minimum raises an older selected target instead of falsely downgrading compatibility', () => {
  const diagnostics: string[] = [];
  assert.equal(resolveTargetEngineVersion('1.20.0', ['1.20.0', '1.21.50'], diagnostics, 'Resource Pack'), '1.21.50');
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /TARGET_ENGINE_RAISED/);
});

test('invalid or missing Bedrock target safely falls back to 1.20.0', () => {
  const diagnostics: string[] = [];
  assert.equal(resolveTargetEngineVersion('latest', [], diagnostics, 'Behavior'), '1.20.0');
  assert.equal(resolveTargetEngineVersion(undefined, [], diagnostics, 'Behavior'), '1.20.0');
});

test('script modules are isolated per addon without breaking their relative directory tree', () => {
  assert.equal(scriptModuleOutputPath('addon_a', 'scripts/main.js'), 'scripts/addon_a/_pack/scripts/main.js');
  assert.equal(scriptModuleOutputPath('addon_a', './scripts/lib/helper.js'), 'scripts/addon_a/_pack/scripts/lib/helper.js');
  assert.equal(scriptModuleOutputPath('addon_b', 'main.js'), 'scripts/addon_b/_pack/main.js');
  assert.equal(scriptModuleOutputPath('addon_b', 'scripts\\\\lib\\\\helper.js'), 'scripts/addon_b/_pack/scripts/lib/helper.js');
});

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

test('all UI JSON files preserve independent controls and bindings', () => {
  const merged = mergeJsonForFile('ui/common.json', [
    { panel: { controls: [{ 'left@hud.left': {} }], bindings: [{ binding_name: '#left' }] } },
    { panel: { controls: [{ 'right@hud.right': {} }], bindings: [{ binding_name: '#right' }] } },
  ]);
  assert.deepEqual(merged.panel.controls, [{ 'left@hud.left': {} }, { 'right@hud.right': {} }]);
  assert.deepEqual(merged.panel.bindings, [{ binding_name: '#left' }, { binding_name: '#right' }]);
  const collision = mergeJsonForFile('ui/common.json', [
    { panel: { type: 'panel', texture: 'textures/ui/first', controls: [{ 'same@hud.control': { offset: [0, 0] } }] } },
    { panel: { type: 'image', texture: 'textures/ui/second', controls: [{ 'same@hud.control': { size: [20, 20] } }] } },
  ]);
  assert.equal(collision.panel.type, 'panel', 'later conflicting UI scalar must not replace the active definition');
  assert.equal(collision.panel.texture, 'textures/ui/first');
  assert.deepEqual(collision.panel.controls[0]['same@hud.control'], { offset: [0, 0], size: [20, 20] });

  const structuralConflicts: string[] = [];
  const structural = mergeJsonForFile('ui/common.json', [
    { panel: { controls: [{ 'shared@hud.control': { type: 'panel', controls: [{ 'first@hud.first': {} }] } }] } },
    { panel: { controls: [{ 'shared@hud.control': { type: 'image', texture: 'textures/ui/second' } }] } },
  ], structuralConflicts);
  assert.deepEqual(
    structural.panel.controls[0]['shared@hud.control'],
    { type: 'panel', controls: [{ 'first@hud.first': {} }] },
    'different control types must not be blended into a hybrid definition'
  );
  assert.ok(structuralConflicts.some(path => path.includes('structural collision')));
  const uiConflicts: string[] = [];
  const conflicted = mergeJsonForFile('ui/common.json', [
    { panel: { texture: 'textures/ui/first' } },
    { panel: { texture: 'textures/ui/second' } },
  ], uiConflicts);
  assert.equal(conflicted.panel.texture, 'textures/ui/first');
  assert.ok(uiConflicts.some(path => path.includes('texture')));
  const bindingConflicts: string[] = [];
  const bindingMerge = mergeJsonForFile('ui/common.json', [
    { panel: { bindings: [{ binding_name: '#health', binding_name_override: '#value', source_property_name: 'health' }] } },
    { panel: { bindings: [{ binding_name: '#health', binding_name_override: '#value', source_property_name: 'armor' }] } },
  ], bindingConflicts);
  assert.equal(bindingMerge.panel.bindings.length, 1, 'conflicting binding identity must not be duplicated');
  assert.ok(bindingConflicts.some(path => path.includes('bindings')));

  const hudConflicts: string[] = [];
  mergeJsonForFile('ui/hud_screen.json', [
    { screen: { scale: 1, modifications: [{ array_name: 'controls', operation: 'insert_front', value: 'a' }] } },
    { screen: { scale: 2, modifications: [{ array_name: 'controls', operation: 'insert_front', value: 'b' }] } },
  ], hudConflicts);
  assert.ok(hudConflicts.some(path => path.includes('scale')), 'HUD scalar collisions must be reported');

});

test('subpack UI paths are routed through the UI-specific strategy', () => {
  assert.equal(isUiMergeStrategyFile('subpacks/compact/ui/hud_screen.json'), true);
  assert.equal(isUiMergeStrategyFile('subpacks/compact/ui/common.json'), true);
});

test('HUD and UI definition strategy merge preserves independent registrations', () => {
  const hud = mergeJsonForFile('ui/hud_screen.json', [
    { screen: { modifications: [{ array_name: 'controls', operation: 'insert_front', value: [{ 'first@hud.first': {} }] }] } },
    { screen: { modifications: [{ array_name: 'controls', operation: 'insert_front', value: [{ 'second@hud.second': {} }] }] } },
  ]);
  assert.equal(hud.screen.modifications.length, 2);
  const defs = mergeJsonForFile('ui/_ui_defs.json', [
    { ui_defs: ['ui/first.json'] },
    { ui_defs: ['ui/second.json', 'ui/first.json'] },
  ]);
  assert.deepEqual(defs.ui_defs, ['ui/first.json', 'ui/second.json']);
});

test('conflicting HUD visibility predicates are preserved and reported, not ANDed into invisible HUDs', () => {
  const conflicts: string[] = [];
  const merged = mergeJsonForFile('ui/hud_screen.json', [
    { screen: { panel: { visible: 'query.is_first_person', text: 'base label' } } },
    { screen: { panel: { visible: 'query.is_alive', text: 'overlay label' } } },
  ], conflicts);
  assert.equal(merged.screen.panel.visible, 'query.is_first_person');
  assert.equal(merged.screen.panel.text, 'base label');
  assert.ok(conflicts.some(path => path.endsWith('.visible')));
});

test('subpack HUD merge preserves controls and bindings from both packs', () => {
  const result = deepMergeUi(
    { panel: { visible: 'query.is_first_person', controls: [{ base: {} }], bindings: [{ binding_name: '#base' }] } },
    { panel: { visible: 'query.is_alive', controls: [{ overlay: {} }], bindings: [{ binding_name: '#overlay' }] } },
  );
  assert.equal(result.panel.visible, 'query.is_first_person', 'conflicting subpack visibility must not hide the root HUD');
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

test('render-controller deltas preserve independent fields without mixing conflicting texture arrays', () => {
  const merged = mergeJsonForFile('render_controllers/player.render_controllers.json', [
    {
      format_version: '1.8.0',
      'controller.render.sword': {
        geometry: 'geometry.blue_sword',
        textures: ['texture.blue_sword'],
        materials: ['material.default']
      }
    },
    {
      format_version: '1.8.0',
      'controller.render.sword': {
        geometry: 'geometry.red_sword',
        textures: ['texture.red_sword'],
        materials: ['material.emissive']
      },
      'controller.render.other_sword': { textures: ['texture.other_sword'] }
    }
  ]);
  assert.deepEqual(merged['controller.render.sword'].textures, ['texture.blue_sword']);
  assert.equal(merged['controller.render.sword'].geometry, 'geometry.blue_sword');
  assert.deepEqual(merged['controller.render.sword'].materials, ['material.default']);
  assert.deepEqual(merged['controller.render.other_sword'].textures, ['texture.other_sword']);
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
  const original = JSON.stringify({
    format_version: '1.20.0',
    'minecraft:item': {
      description: { identifier: 'demo:utility_item' },
      components: {
        'minecraft:icon': { texture: 'utility_item' },
        'minecraft:max_stack_size': 16
      }
    }
  });
  const alternative = JSON.stringify({
    format_version: '1.20.0',
    'minecraft:item': {
      description: { identifier: 'demo:utility_item' },
      components: {
        'minecraft:food': { nutrition: 2, can_always_eat: true },
        'minecraft:max_stack_size': 64
      }
    }
  });
  zip.file('items/utility_item.json', original);
  zip.file('items/utility_item_extra.json', alternative);
  const diagnostics: string[] = [];
  await mergeDefinitionsByIdentifier(zip, diagnostics);
  const paths = Object.keys(zip.files).filter(p => p.startsWith('items/') && !zip.files[p].dir);
  assert.equal(paths.length, 1);
  const active = await zip.file(paths[0])!.async('text');
  const result = JSON.parse(active);
  assert.equal(result['minecraft:item'].description.identifier, 'demo:utility_item');
  assert.deepEqual(result['minecraft:item'].components['minecraft:icon'], { texture: 'utility_item' });
  assert.deepEqual(result['minecraft:item'].components['minecraft:food'], { nutrition: 2, can_always_eat: true },
    'non-conflicting components must survive even when another field conflicts');
  assert.equal(result['minecraft:item'].components['minecraft:max_stack_size'], 16,
    'the conflicting scalar keeps the priority winner');
  const backup = Object.keys(zip.files).find(p => p.startsWith('_autobe_conflicts/') && p.includes('utility_item_extra.json'));
  assert.ok(backup, 'the alternative must be saved for review');
  assert.equal(await zip.file(backup)!.async('text'), alternative, 'the backup must retain the full alternative');
  assert.ok(diagnostics.some(message => message.includes('DEFINITION_PARTIAL_CONFLICT')));
  console.log('✓ conflicting item definitions keep safe additions and preserve the full alternative for review');
})();


await (async () => {
  const zip = new JSZip();
  const diagnostics: string[] = [];
  zip.file('items/utility_item.json', JSON.stringify({
    'minecraft:item': { description: { identifier: 'demo:utility_item' }, components: { 'minecraft:icon': { texture: 'utility_item' } } }
  }));
  zip.file('items/utility_item_extra.json', JSON.stringify({
    'minecraft:item': { description: { identifier: 'demo:utility_item' }, components: { 'minecraft:food': { nutrition: 2, can_always_eat: true } } }
  }));
  await mergeDefinitionsByIdentifier(zip, diagnostics);
  const result = JSON.parse(await zip.file('items/utility_item.json')!.async('text'));
  assert.deepEqual(result['minecraft:item'].components['minecraft:icon'], { texture: 'utility_item' });
  assert.deepEqual(result['minecraft:item'].components['minecraft:food'], { nutrition: 2, can_always_eat: true });
  assert.equal(zip.file('items/utility_item_extra.json'), null);
  assert.ok(!diagnostics.some(message => message.includes('DEFINITION_CONFLICT')));
  assert.ok(!Object.keys(zip.files).some(p => p.startsWith('_autobe_conflicts/') && !zip.files[p].dir));
  console.log('✓ compatible duplicate item definitions combine non-conflicting components');
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
  const alternative = JSON.stringify({
    ...identical,
    'minecraft:attachable': {
      description: {
        ...identical['minecraft:attachable'].description,
        identifier: 'minecraft:stick',
        geometry: { default: 'geometry.custom_item' }
      }
    }
  });
  zip.file('attachables/stick(Copy).json', alternative);
  await mergeDefinitionsByIdentifier(zip, diagnostics);
  assert.ok(zip.file('attachables/apple.json'));
  assert.equal(zip.file('attachables/apple(Copy).json'), null);
  assert.ok(zip.file('attachables/stick.json'));
  assert.equal(zip.file('attachables/stick(Copy).json'), null);
  const backup = Object.keys(zip.files).find(p => p.startsWith('_autobe_conflicts/') && p.includes('stick(Copy).json'));
  assert.ok(backup, 'the incompatible attachable must be saved for review');
  assert.equal(await zip.file(backup)!.async('text'), alternative, 'the attachable backup must remain intact');
  assert.ok(diagnostics.some(message => message.includes('DEFINITION_CONFLICT')));
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
  assert.equal(diagnostics.filter(message => message.includes('Guarded statically-addressed')).length, 1);

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


await (async () => {
  const zip = new JSZip();
  zip.file('entity/example.entity.json', JSON.stringify({
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: 'test:example',
        textures: { default: 'textures/entity/missing_texture' },
        geometry: { default: 'geometry.missing' },
        animations: { idle: 'animation.missing' },
        render_controllers: ['controller.render.missing']
      }
    }
  }));
  zip.file('items/broken.json', '{ invalid json');
  zip.file('items/first.json', JSON.stringify({ 'minecraft:item': { description: { identifier: 'test:duplicate' } } }));
  zip.file('items/second.json', JSON.stringify({ 'minecraft:item': { description: { identifier: 'test:duplicate' } } }));
  zip.file('textures/entity/present.png', new Uint8Array([1, 2, 3]));
  const issues = await validateMergedArchive(zip, 'Test Resource Pack');
  assert.ok(issues.some(issue => issue.code === 'INVALID_JSON' && issue.path === 'items/broken.json'));
  assert.ok(issues.some(issue => issue.code === 'DUPLICATE_IDENTIFIER' && issue.message.includes('test:duplicate')));
  assert.ok(issues.some(issue => issue.code === 'MISSING_TEXTURE_FILE' && issue.message.includes('textures/entity/missing_texture')));
  assert.ok(issues.some(issue => issue.code === 'MISSING_GEOMETRY_REFERENCE' && issue.message.includes('geometry.missing')));
  assert.ok(issues.some(issue => issue.code === 'MISSING_ANIMATION_REFERENCE' && issue.message.includes('animation.missing')));
  assert.ok(issues.some(issue => issue.code === 'MISSING_RENDER_CONTROLLER_REFERENCE' && issue.message.includes('controller.render.missing')));
  assert.ok(!issues.some(issue => issue.code === 'MISSING_TEXTURE_FILE' && issue.message.includes('textures/entity/present')));
  zip.file('ui/_ui_defs.json', JSON.stringify({ ui_defs: ['ui/working.json', 'ui/missing.json'] }));
  zip.file('ui/working.json', JSON.stringify({}));
  zip.file('ui/settings_screen.json', JSON.stringify({ legacy_menu: {} }));
  const uiIssues = await validateMergedArchive(zip, 'Test Resource Pack');
  assert.ok(uiIssues.some(issue => issue.code === 'MISSING_UI_DEFINITION_FILE' && issue.message.includes('ui/missing.json')));
  assert.ok(!uiIssues.some(issue => issue.code === 'MISSING_UI_DEFINITION_FILE' && issue.message.includes('ui/working.json')));
  assert.ok(uiIssues.some(issue => issue.code === 'LEGACY_UI_ORE_UI_LIMIT' && issue.path === 'ui/settings_screen.json'));
  console.log('✓ merged archive validation reports malformed JSON, unresolved assets, missing UI registrations and Ore UI legacy-menu limits');
})();

await (async () => {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ dependencies: [{ module_name: '@minecraft/server', version: '1.21.0' }] }));
  zip.file('scripts/menu.js', 'import { CustomForm, ObservableString } from "@minecraft/server-ui";');
  const issues = await validateMergedArchive(zip, 'Test Behavior Pack');
  assert.ok(issues.some(issue => issue.code === 'DDUI_API_DEPENDENCY_MISSING'));
  assert.ok(issues.some(issue => issue.code === 'DDUI_SERVER_PEER_DEPENDENCY'));
  zip.file('manifest.json', JSON.stringify({ dependencies: [
    { module_name: '@minecraft/server', version: '2.0.0' },
    { module_name: '@minecraft/server-ui', version: '2.1.0' },
  ] }));
  const supported = await validateMergedArchive(zip, 'Test Behavior Pack');
  assert.ok(!supported.some(issue => issue.code === 'DDUI_API_DEPENDENCY_MISSING'));
  assert.ok(!supported.some(issue => issue.code === 'DDUI_SERVER_PEER_DEPENDENCY'));
  zip.file('scripts/menu.js', 'import { CustomForm } from "@minecraft/server-ui"; form.multiButtonRow();');
  const previewMissing = await validateMergedArchive(zip, 'Test Behavior Pack');
  assert.ok(previewMissing.some(issue => issue.code === 'DDUI_PREVIEW_UI_VERSION'));
  zip.file('manifest.json', JSON.stringify({ dependencies: [
    { module_name: '@minecraft/server', version: '2.13.0-beta.1.26.70-preview.21' },
    { module_name: '@minecraft/server-ui', version: '2.4.0-rc.1.26.70-preview.21' },
  ] }));
  const previewSupported = await validateMergedArchive(zip, 'Test Behavior Pack');
  assert.ok(!previewSupported.some(issue => issue.code === 'DDUI_PREVIEW_UI_VERSION'));
  console.log('✓ DDUI stable and preview-only method usage is checked against matching server-ui/server versions');
})();



await (async () => {
  const source = new JSZip();
  const target = new JSZip();
  source.file('textures/my_addon/shared.png', new Uint8Array([9, 8, 7]));
  target.file('textures/my_addon/shared.png', new Uint8Array([1, 2, 3]));
  const diagnostics: string[] = [];
  const pathMap = await planBinaryAssetCollisions(source, target, 'Second Pack', undefined, diagnostics);
  assert.equal(pathMap.get('textures/my_addon/shared.png'), 'textures/my_addon/shared__second_pack.png');
  assert.equal(diagnostics.length, 1);
  const rewritten = rewriteAssetReferences('{"textures":{"default":"textures/my_addon/shared"}}', pathMap);
  assert.ok(rewritten.includes('textures/my_addon/shared__second_pack'));
  const identicalSource = new JSZip();
  const identicalTarget = new JSZip();
  identicalSource.file('textures/entity/same.png', new Uint8Array([4, 5, 6]));
  identicalTarget.file('textures/entity/same.png', new Uint8Array([4, 5, 6]));
  const identicalMap = await planBinaryAssetCollisions(identicalSource, identicalTarget, 'Third Pack', undefined, []);
  assert.equal(identicalMap.size, 0, 'identical assets should not be renamed');
  assert.equal(isVanillaOverridePath('textures/items/diamond_sword.png'), true, 'vanilla-facing item textures must not be renamed');
  assert.equal(isVanillaOverridePath('textures/entity/custom_beast.png'), true, 'entity texture overrides should be treated conservatively as vanilla-facing');
  assert.equal(isVanillaOverridePath('textures/my_addon/custom_icon.png'), false, 'custom namespace-like asset paths can use collision renaming');
  console.log('✓ colliding binary assets get deterministic paths, references are repaired, identical assets are reused');
})();

await (async () => {
  const { applyFeatureRegistry } = await import('../src/utils/featureRegistry.ts');
  const first = new JSZip();
  first.file('items/ak47.json', JSON.stringify({ 'minecraft:item': { description: { identifier: 'guns:ak47' }, components: {} } }));
  first.file('recipes/ak47.json', JSON.stringify({ 'minecraft:recipe_shaped': { description: { identifier: 'guns:ak47_recipe' }, key: { A: { item: 'guns:ak47' } }, result: { item: 'guns:ak47', count: 1 } } }));
  const second = new JSZip();
  second.file('items/ak47.json', JSON.stringify({ 'minecraft:item': { description: { identifier: 'guns:ak47' }, components: {} } }));
  second.file('recipes/ak47.json', JSON.stringify({ 'minecraft:recipe_shaped': { description: { identifier: 'guns:ak47_recipe2' }, key: { A: { item: 'guns:ak47' } }, result: { item: 'guns:ak47', count: 1 }, metadata: { name: 'guns:ak47' } } }));
  second.file('loot_tables/test.json', JSON.stringify({ pools: [{ entries: [{ type: 'item', name: 'guns:ak47' }] }] }));
  const diagnostics: string[] = [];
  const changed = await applyFeatureRegistry(second, first, 'Second Guns Pack', diagnostics);
  assert.equal(changed, 3);
  const item = JSON.parse(await second.file('items/ak47.json')!.async('text'));
  const recipe = JSON.parse(await second.file('recipes/ak47.json')!.async('text'));
  const newId = item['minecraft:item'].description.identifier;
  assert.equal(newId, 'guns_autobe_2:ak47');
  assert.equal(recipe['minecraft:recipe_shaped'].key.A.item, newId);
  assert.equal(recipe['minecraft:recipe_shaped'].result.item, newId);
  assert.equal(recipe['minecraft:recipe_shaped'].metadata.name, 'guns:ak47', 'unrelated name fields must not be rewritten');
  const loot = JSON.parse(await second.file('loot_tables/test.json')!.async('text'));
  assert.equal(loot.pools[0].entries[0].name, newId, 'loot-table item references should be repaired');
  assert.ok(diagnostics.some(message => message.includes('FEATURE_REGISTRY_RENAMED')));
  console.log('✓ feature registry renames colliding custom identifiers and repairs source-owned recipe references');
})();

await (async () => {
  const first = new JSZip();
  first.file('items/shared.json', JSON.stringify({ 'minecraft:item': { description: { identifier: 'demo:shared' }, components: {} } }));
  const second = new JSZip();
  second.file('items/shared.json', JSON.stringify({ 'minecraft:item': { description: { identifier: 'demo:shared' }, components: {} } }));
  const diagnostics: string[] = [];
  const changed = await applyFeatureRegistry(second, first, 'Second Pack', diagnostics, undefined, false);
  assert.equal(changed, 0, 'production registry fallback must not invent a rename when the conflict UI supplied none');
  const unchanged = JSON.parse(await second.file('items/shared.json')!.async('text'));
  assert.equal(unchanged['minecraft:item'].description.identifier, 'demo:shared');
  assert.ok(diagnostics.some(message => message.includes('FEATURE_REGISTRY_CHOICE_REQUIRED')));

  const explicit = new Map([['demo:shared', 'demo_second:shared']]);
  const explicitDiagnostics: string[] = [];
  const explicitChanged = await applyFeatureRegistry(second, first, 'Second Pack', explicitDiagnostics, explicit, false);
  assert.equal(explicitChanged, 1);
  const renamed = JSON.parse(await second.file('items/shared.json')!.async('text'));
  assert.equal(renamed['minecraft:item'].description.identifier, 'demo_second:shared');
  console.log('✓ feature registry respects explicit rename choices and never silently overrides Keep A / Keep B');
})();

await (async () => {
  const packA = new JSZip();
  packA.file('textures/items/diamond_sword.png', new Uint8Array([1, 2, 3]));
  const packB = new JSZip();
  packB.file('textures/items/diamond_sword.png', new Uint8Array([3, 2, 1]));
  const conflicts = await detectConflicts([
    { id: 'pack-a', name: 'Blue Sword', type: 'Resource Pack', fileBlob: await packA.generateAsync({ type: 'blob' }) } as any,
    { id: 'pack-b', name: 'Red Sword', type: 'Resource Pack', fileBlob: await packB.generateAsync({ type: 'blob' }) } as any
  ]);
  const assetConflict = conflicts.find(conflict => conflict.type === 'vanilla_asset');
  assert.ok(assetConflict, 'different bytes at the same vanilla asset path should require a choice');
  assert.equal(assetConflict?.identifier, 'textures/items/diamond_sword.png');
  assert.equal(assetConflict?.packA.name, 'Blue Sword');
  assert.equal(assetConflict?.packB.name, 'Red Sword');
  assert.equal(assetConflict?.resolution, 'keep_a');
  console.log('✓ preflight finds conflicting vanilla asset overrides and identifies both add-ons');
})();

await (async () => {
  const target = new JSZip();
  target.file('textures/items/diamond_sword.png', new Uint8Array([1, 2, 3]));
  const winnerZip = new JSZip();
  winnerZip.file('textures/items/diamond_sword.png', new Uint8Array([9, 8, 7]));
  const winnerBlob = await winnerZip.generateAsync({ type: 'blob' });
  const diagnostics: string[] = [];
  await applyVanillaAssetResolutions(
    target,
    [{ id: 'pack-b', name: 'Red Sword', type: 'Resource Pack', fileBlob: winnerBlob } as any],
    [{
      id: 'asset-conflict',
      type: 'vanilla_asset',
      identifier: 'textures/items/diamond_sword.png',
      packA: { id: 'pack-a', name: 'Blue Sword' },
      packB: { id: 'pack-b', name: 'Red Sword' },
      resolution: 'keep_b'
    }] as any,
    'Resource Pack',
    diagnostics
  );
  const chosen = await target.file('textures/items/diamond_sword.png')!.async('uint8array');
  assert.deepEqual([...chosen], [9, 8, 7], 'keep_b must replace the actual final asset bytes');
  assert.ok(diagnostics.some(message => message.includes('VANILLA_OVERRIDE_CHOICE')));
  console.log('✓ vanilla override choice changes the actual final asset bytes');
})();

await (async () => {
  const target = new JSZip();
  target.file('textures/items/diamond_sword.png', new Uint8Array([9, 8, 7]));
  const blueZip = new JSZip();
  blueZip.file('textures/items/diamond_sword.png', new Uint8Array([1, 2, 3]));
  const redZip = new JSZip();
  redZip.file('textures/items/diamond_sword.png', new Uint8Array([9, 8, 7]));
  const diagnostics: string[] = [];
  await applyVanillaAssetResolutions(
    target,
    [
      { id: 'pack-a', name: 'Blue Sword', type: 'Resource Pack', fileBlob: await blueZip.generateAsync({ type: 'blob' }) } as any,
      { id: 'pack-b', name: 'Red Sword', type: 'Resource Pack', fileBlob: await redZip.generateAsync({ type: 'blob' }) } as any
    ],
    [{
      id: 'asset-conflict-a', type: 'vanilla_asset', identifier: 'textures/items/diamond_sword.png',
      packA: { id: 'pack-a', name: 'Blue Sword' }, packB: { id: 'pack-b', name: 'Red Sword' }, resolution: 'keep_a'
    }] as any,
    'Resource Pack',
    diagnostics
  );
  const chosen = await target.file('textures/items/diamond_sword.png')!.async('uint8array');
  assert.deepEqual([...chosen], [1, 2, 3], 'keep_a must replace the actual final asset bytes');
  assert.ok(diagnostics.some(message => message.includes('VANILLA_OVERRIDE_CHOICE')));
  console.log('✓ keep Pack A also changes the actual final asset bytes');
})();


test('combined-only mode keeps internal bundle parts without exposing separate downloads', () => {
  const parts = [{ id: 'part-1', fileName: 'resource_pack.mcpack' }] as any;
  const selected = selectMergeOutputs(parts, true, false);
  assert.deepEqual(selected.outputs, []);
  assert.equal(selected.bundleParts, parts);
});

test('separate-only mode exposes .mcpack outputs without retaining a bundle copy', () => {
  const parts = [{ id: 'part-1', fileName: 'resource_pack.mcpack' }] as any;
  const selected = selectMergeOutputs(parts, false, true);
  assert.equal(selected.outputs, parts);
  assert.equal(selected.bundleParts, undefined);
});

test('combined and separate mode exposes individual outputs and uses them as bundle parts', () => {
  const parts = [{ id: 'part-1', fileName: 'resource_pack.mcpack' }] as any;
  const selected = selectMergeOutputs(parts, true, true);
  assert.equal(selected.outputs, parts);
  assert.equal(selected.bundleParts, undefined);
});

test('disabled output modes produce no artifacts', () => {
  const selected = selectMergeOutputs([], false, false);
  assert.deepEqual(selected.outputs, []);
  assert.equal(selected.bundleParts, undefined);
});


test('identifier token rewriting updates embedded Molang references without changing longer IDs', () => {
  const map = new Map([['guns:ak47', 'guns_autobe_2:ak47']]);
  const source = "query.is_item_name_any('slot.weapon.mainhand', 0, 'guns:ak47') && 'guns:ak470'";
  const output = rewriteIdentifierTokens(source, map);
  assert.ok(output.includes("'guns_autobe_2:ak47'"));
  assert.ok(output.includes("'guns:ak470'"));
});

test('script identifier rewriting changes static strings but leaves comments and dynamic templates alone', () => {
  const map = new Map([['guns:ak47', 'guns_autobe_2:ak47']]);
  const source = [
    "const itemId = 'guns:ak47';",
    'const alsoItemId = "guns:ak47";',
    "`const dynamic = ${itemId} guns:ak47`;",
    "// guns:ak47 should remain in this comment",
    "/* guns:ak47 should remain here too */"
  ].join('\n');
  const output = rewriteStaticScriptIdentifierReferences(source, map);
  assert.ok(output.includes("'guns_autobe_2:ak47'"));
  assert.ok(output.includes('"guns_autobe_2:ak47"'));
  assert.ok(output.includes('${itemId} guns:ak47'));
  assert.ok(output.includes('// guns:ak47 should remain in this comment'));
  assert.ok(output.includes('/* guns:ak47 should remain here too */'));
});

await (async () => {
  const { applyFeatureRegistry } = await import('../src/utils/featureRegistry.ts');
  const first = new JSZip();
  first.file('items/weapon.json', JSON.stringify({
    'minecraft:item': { description: { identifier: 'arsenal:weapon' }, components: {} }
  }));
  const incoming = new JSZip();
  incoming.file('items/weapon.json', JSON.stringify({
    'minecraft:item': { description: { identifier: 'arsenal:weapon' }, components: {} }
  }));
  incoming.file('recipes/weapon.json', JSON.stringify({
    'minecraft:recipe_shaped': {
      description: { identifier: 'arsenal:weapon_recipe' },
      key: { A: { item: 'arsenal:weapon' } },
      result: { item: 'arsenal:weapon' }
    }
  }));
  incoming.file('loot_tables/weapon.json', JSON.stringify({
    pools: [{ entries: [{ type: 'item', name: 'arsenal:weapon' }] }]
  }));
  incoming.file('attachables/weapon.json', JSON.stringify({
    'minecraft:attachable': {
      description: { identifier: 'arsenal:weapon_attachable' },
      scripts: { pre_animation: ["query.is_item_name_any('slot.weapon.mainhand', 0, 'arsenal:weapon')"] }
    }
  }));
  incoming.file('scripts/weapon.js', [
    "const weaponId = 'arsenal:weapon';",
    "`const dynamicId = ${weaponId} arsenal:weapon`;",
    "// arsenal:weapon comment should not be rewritten"
  ].join('\n'));
  incoming.file('functions/give_weapon.mcfunction', 'give @s arsenal:weapon 1');
  incoming.file('animation_controllers/weapon.animation_controllers.json', JSON.stringify({
    animation_controllers: {
      'controller.animation.weapon': {
        states: {
          default: {
            transitions: [{
              equipped: "query.is_item_name_any('slot.weapon.mainhand', 0, 'arsenal:weapon')"
            }]
          }
        }
      }
    }
  }));
  const diagnostics: string[] = [];
  const changed = await applyFeatureRegistry(incoming, first, 'Incoming Arsenal', diagnostics);
  assert.equal(changed, 7);
  const expected = 'arsenal_autobe_2:weapon';
  const item = JSON.parse(await incoming.file('items/weapon.json')!.async('text'));
  assert.equal(item['minecraft:item'].description.identifier, expected);
  const recipe = JSON.parse(await incoming.file('recipes/weapon.json')!.async('text'));
  assert.equal(recipe['minecraft:recipe_shaped'].key.A.item, expected);
  assert.equal(recipe['minecraft:recipe_shaped'].result.item, expected);
  const loot = JSON.parse(await incoming.file('loot_tables/weapon.json')!.async('text'));
  assert.equal(loot.pools[0].entries[0].name, expected);
  const attachable = JSON.parse(await incoming.file('attachables/weapon.json')!.async('text'));
  assert.ok(attachable['minecraft:attachable'].scripts.pre_animation[0].includes(expected));
  const script = await incoming.file('scripts/weapon.js')!.async('text');
  assert.ok(script.includes("'arsenal_autobe_2:weapon'"));
  assert.ok(script.includes('${weaponId} arsenal:weapon'), 'dynamic template literals are intentionally left for diagnostics/manual review');
  assert.ok(script.includes('// arsenal:weapon comment should not be rewritten'));
  const command = await incoming.file('functions/give_weapon.mcfunction')!.async('text');
  assert.ok(command.includes(expected));
  const controller = JSON.parse(await incoming.file('animation_controllers/weapon.animation_controllers.json')!.async('text'));
  assert.ok(controller.animation_controllers['controller.animation.weapon'].states.default.transitions[0].equipped.includes(expected));
  assert.ok(diagnostics.some(message => message.includes('FEATURE_REGISTRY_RENAMED')));
  assert.ok(diagnostics.some(message => message.includes('DYNAMIC_SCRIPT_IDENTIFIER_REFERENCE')));
  console.log('✓ feature registry repairs item, recipe, loot-table and attachable Molang references together');
})();
