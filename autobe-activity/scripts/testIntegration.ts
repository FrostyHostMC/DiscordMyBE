import assert from 'node:assert/strict';
import JSZip from 'jszip';

// The browser build of JSZip can read Blob directly; Node's build needs bytes.
const load = JSZip.loadAsync;
JSZip.loadAsync = (async (input: any, ...args: any[]) =>
  load.call(JSZip, input instanceof Blob ? await input.arrayBuffer() : input, ...args)) as any;
const instanceLoad = JSZip.prototype.loadAsync;
JSZip.prototype.loadAsync = (async function (this: JSZip, input: any, ...args: any[]) {
  return instanceLoad.call(this, input instanceof Blob ? await input.arrayBuffer() : input, ...args);
}) as any;
(globalThis as any).window = globalThis;

const { parseAddonArchive, detectConflicts, sanitizeJsonString } = await import('../src/utils/addonParser.ts');
const { executeMergePacks, ensureCombinedBlob, buildMergePlan } = await import('../src/utils/mergeEngine.ts');
const { applySubpackSelection } = await import('../src/utils/subpackProcessor.ts');
const { guardUnavailableEventSubscriptions } = await import('../src/utils/scriptCompatibility.ts');

let nextId = 0;
async function makePack(type: 'Behavior Pack' | 'Resource Pack', name: string, files: Record<string, string | Uint8Array>, scriptVersion?: string) {
  const id = ++nextId;
  const zip = new JSZip();
  const modules: any[] = [{ type: type === 'Behavior Pack' ? 'data' : 'resources', uuid: `00000000-0000-4000-8000-${String(id + 100).padStart(12, '0')}`, version: [1, 0, 0] }];
  if (scriptVersion) modules.push({ type: 'script', language: 'javascript', entry: 'scripts/main.js', uuid: `00000000-0000-4000-8000-${String(id + 200).padStart(12, '0')}`, version: [1, 0, 0] });
  zip.file('manifest.json', JSON.stringify({
    format_version: 2,
    header: { name, uuid: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, version: [1, 0, 0], min_engine_version: [1, 21, 0] },
    modules,
    dependencies: scriptVersion ? [{ module_name: '@minecraft/server', version: scriptVersion }] : []
  }));
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  const parsed = await parseAddonArchive(new Blob([await zip.generateAsync({ type: 'uint8array' }) as any]), `${name}.mcpack`);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.packs.length, 1);
  return parsed.packs[0];
}

function archiveEntries(entries: Array<{ name: string; content: string }>): Uint8Array {
  const encoded = entries.map(entry => ({ name: new TextEncoder().encode(entry.name), data: new TextEncoder().encode(entry.content) }));
  const payloadBase = 16 + encoded.length * 256;
  const payloadSize = encoded.reduce((total, entry) => total + entry.data.length, 0);
  const result = new Uint8Array(payloadBase + payloadSize);
  result.set([0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26]);
  const view = new DataView(result.buffer);
  view.setUint32(8, encoded.length, true);
  view.setUint32(12, 1, true);
  let payloadOffset = 0;
  encoded.forEach((entry, index) => {
    if (entry.name.length < 1 || entry.name.length > 247) throw new Error('Invalid fixture archive name');
    const recordOffset = 16 + index * 256;
    result[recordOffset] = entry.name.length;
    result.set(entry.name, recordOffset + 1);
    view.setUint32(recordOffset + 248, payloadOffset, true);
    view.setUint32(recordOffset + 252, entry.data.length, true);
    result.set(entry.data, payloadBase + payloadOffset);
    payloadOffset += entry.data.length;
  });
  return result;
}

function archive(name: string, content: string): Uint8Array {
  return archiveEntries([{ name, content }]);
}

// Manifest names that are localization keys should display their translated pack name.
const localizedPack = await makePack('Resource Pack', 'pack.name', {
  'texts/languages.json': JSON.stringify(['en_US']),
  'texts/en_US.lang': 'pack.name=Localized Furniture\npack.description=Furniture description\n'
});
assert.equal(localizedPack.name, 'Localized Furniture', 'pack.name should resolve from the source pack language file');

// Regression: language registries and translation keys must survive shared BP merging.
const languagePackA = await makePack('Behavior Pack', 'Language A', {
  'texts/languages.json': JSON.stringify(['en_US']),
  'texts/en_US.lang': 'pack.name=Pack A\npack.description=Description A\ndemo:item.a=Alpha\n'
});
const languagePackB = await makePack('Behavior Pack', 'Language B', {
  'texts/languages.json': JSON.stringify(['en_US', 'zh_CN', 'es_ES']),
  'texts/en_US.lang': 'pack.name=Pack B\npack.description=Description B\ndemo:item.b=Bravo\n'
});
const languageMerge = await executeMergePacks([languagePackA, languagePackB], {
  modpackName: 'Language merge regression',
  conflicts: await detectConflicts([languagePackA, languagePackB])
});
const languageOutput = await JSZip.loadAsync(languageMerge.outputs!.find(output => output.type === 'behavior_data')!.blob!);
const mergedLanguages = JSON.parse(await languageOutput.file('texts/languages.json')!.async('text'));
assert.deepEqual(mergedLanguages, ['en_US', 'zh_CN', 'es_ES'], 'all supported language codes must be unioned');
const mergedTranslations = await languageOutput.file('texts/en_US.lang')!.async('text');
assert.ok(mergedTranslations.includes('demo:item.a=Alpha'));
assert.ok(mergedTranslations.includes('demo:item.b=Bravo'));
assert.ok(mergedTranslations.includes('pack.name=Pack A'), 'priority winner pack metadata must remain stable');
assert.ok(!mergedTranslations.includes('pack.name=Pack B'), 'conflicting pack metadata must not overwrite priority winner');
console.log('✓ language codes and unique translation keys survive BP merge while pack metadata priority remains stable');

const localeJsonA = await makePack('Behavior Pack', 'Locale JSON A', {
  'texts/en_US.json': JSON.stringify({ menu: { title: 'First', shared: 'Priority value' } })
});
const localeJsonB = await makePack('Behavior Pack', 'Locale JSON B', {
  'texts/en_US.json': JSON.stringify({ menu: { subtitle: 'Second add-on', shared: 'Conflicting value' } })
});
const localeJsonMerge = await executeMergePacks([localeJsonA, localeJsonB], {
  modpackName: 'Locale JSON conflict regression',
  conflicts: await detectConflicts([localeJsonA, localeJsonB])
});
const localeJsonOutput = await JSZip.loadAsync(localeJsonMerge.outputs!.find(output => output.type === 'behavior_data')!.blob!);
const localeJsonActive = JSON.parse(await localeJsonOutput.file('texts/en_US.json')!.async('text'));
assert.equal(localeJsonActive.menu.title, 'First');
assert.equal(localeJsonActive.menu.subtitle, 'Second add-on', 'non-conflicting locale JSON keys should be merged');
assert.equal(localeJsonActive.menu.shared, 'Priority value', 'conflicting locale JSON values should retain the active priority');
assert.ok(Object.keys(localeJsonOutput.files).some(path => path.startsWith('_autobe_conflicts/') && path.endsWith('/texts/en_US.json.backup')),
  'the complete conflicting locale JSON should be recoverable from the conflict backup');
console.log('✓ locale JSON merges unique keys and preserves conflicting values in a recoverable backup');


const player = '{"minecraft:client_entity":{"description":{"identifier":"minecraft:player","animations":{"base_walk":"animation.base.walk"},"scripts":{"initialize":["variable.is_first_person = query.is_first_person;"],"animate":["base_walk"]}}}}';
const playerOverlay = '{"minecraft:client_entity":{"description":{"identifier":"minecraft:player","animations":{"addon_emote":"animation.addon.emote"},"scripts":{"animate":["addon_emote"]}}}}';
const scriptA = 'import "./helper.js"; world.setDynamicProperty("score", 1);';
const scriptB = 'world.afterEvents.playerSpawn.subscribe(event => console.log("handbook"));';
const bpA = await makePack('Behavior Pack', 'Same name', { 'scripts/main.js': scriptA, 'scripts/helper.js': 'export const ok = true;', 'cameras/test.json': '{"original":true}', '__brarchive/cameras/presets.brarchive': archiveEntries([{ name: 'test.json', content: '{"packed":true}' }, { name: 'index.json', content: '{"asset":"cameras/test.json"}' }]) }, '2.7.0');
const bpB = await makePack('Behavior Pack', 'Same name', { 'scripts/main.js': scriptB }, '2.10.0');
const rpA = await makePack('Resource Pack', 'First RP', {
  'entity/player.entity.json': player,
  'materials/entity.material': '{"materials":{"first":{}}}',
  'textures/custom/gem.png': new Uint8Array([1]),
  'textures/item_texture.json': '{"texture_data":{"first":{"textures":"textures/custom/gem"}}}'
});
const rpB = await makePack('Resource Pack', 'Second RP', {
  'entity/player.entity.json': playerOverlay,
  'materials/entity.material': '{"materials":{"second":{}}}',
  'textures/custom/gem.png': new Uint8Array([2]),
  'textures/item_texture.json': '{"texture_data":{"second":{"textures":"textures/custom/gem"}}}'
});
const packs = [bpA, bpB, rpA, rpB];
const result = await executeMergePacks(packs, {
  modpackName: 'Integration test',
  conflicts: await detectConflicts(packs),
  subpackSelections: [{ pack: 'Subpack fixture', variant: 'high_resolution' }]
});
const bp = await JSZip.loadAsync(result.outputs!.find(output => output.type === 'behavior_script')!.blob!);
const rp = await JSZip.loadAsync(result.outputs!.find(output => output.type === 'resource')!.blob!);
const scripts = Object.keys(bp.files).filter(path => path.endsWith('/scripts/main.js'));
assert.equal(scripts.length, 2, 'same-named packs must have separate script trees');
assert.deepEqual((await Promise.all(scripts.map(path => bp.file(path)!.async('text')))).sort(), [scriptA, scriptB].sort());
assert.ok(bp.file(scripts.find(path => path.includes('_1/'))!.replace('main.js', 'helper.js')));
assert.match(await bp.file('scripts/Stonebyte.js')!.async('text'), /import ['"]\.\//);
assert.ok(bp.file('cameras/test.json'), 'packed camera presets should expand beside the archive container folder');
assert.ok(bp.file('cameras/test.autobe-2.json'), 'a conflicting packed entry must be retained under a unique path');
assert.equal(JSON.parse(await bp.file('cameras/index.json')!.async('text')).asset, 'cameras/test.autobe-2.json', 'archive-local references must follow the renamed duplicate');
const mergedPlayer = JSON.parse(await rp.file('entity/player.entity.json')!.async('text'));
const playerDescription = mergedPlayer['minecraft:client_entity'].description;
assert.equal(playerDescription.animations.base_walk, 'animation.base.walk');
assert.equal(playerDescription.animations.addon_emote, 'animation.addon.emote');
assert.ok(playerDescription.scripts.animate.includes('base_walk'));
assert.ok(playerDescription.scripts.animate.includes('addon_emote'));
const materials = JSON.parse(sanitizeJsonString(await rp.file('materials/entity.material')!.async('text')));
assert.deepEqual(Object.keys(materials.materials).sort(), ['first', 'second']);
const atlas = JSON.parse(await rp.file('textures/item_texture.json')!.async('text'));
assert.notEqual(atlas.texture_data.first.textures, atlas.texture_data.second.textures);
assert.ok(rp.file(`${atlas.texture_data.second.textures}.png`));
const manifest = JSON.parse(await bp.file('manifest.json')!.async('text'));
assert.equal(manifest.dependencies.find((item: any) => item.module_name === '@minecraft/server').version, '2.10.0');
assert.ok(result.combinedExtras?.reportJson?.includes('Subpack fixture -> high_resolution'), 'the merge report must record the subpack variant actually supplied by the caller');
const reparsed = await parseAddonArchive(await ensureCombinedBlob(result), 'merged.mcaddon');
assert.deepEqual(reparsed.errors, []);
assert.equal(reparsed.packs.length, 2, 'a combined output must reimport as its BP and RP, not mistake AutoBE report JSON for a pack manifest');
assert.deepEqual(reparsed.packs.map(pack => pack.type).sort(), ['Behavior Pack', 'Resource Pack']);
assert.ok(reparsed.packs.some(pack => pack.name.includes('[RP]')));
assert.ok(reparsed.packs.some(pack => pack.name.includes('Behavior')));
console.log('✓ real merge preserves scripts, player view, camera paths, material entries, atlas references and reimport');

// Split Script API outputs must still behave as one installable modpack.
// Activating the designated main BP should pull in the data-only BP as a
// manifest dependency, so its blocks/items are not left inactive.
const dataOnlyPack = await makePack('Behavior Pack', 'Data Definitions', {
  'blocks/demo_block.json': JSON.stringify({
    format_version: '1.21.0',
    'minecraft:block': { description: { identifier: 'demo:from_data_pack' }, components: { 'minecraft:destructible_by_mining': { seconds_to_destroy: 1 } } }
  })
});
const splitOutput = await executeMergePacks([dataOnlyPack, bpA], { modpackName: 'Split Output Activation' });
const dataOutput = splitOutput.outputs!.find(output => output.type === 'behavior_data')!;
const scriptOutput = splitOutput.outputs!.find(output => output.type === 'behavior_script')!;
const dataOutputZip = await JSZip.loadAsync(dataOutput.blob!);
const scriptOutputZip = await JSZip.loadAsync(scriptOutput.blob!);
const dataManifest = JSON.parse(await dataOutputZip.file('manifest.json')!.async('text'));
const scriptManifest = JSON.parse(await scriptOutputZip.file('manifest.json')!.async('text'));
assert.ok(scriptManifest.dependencies.some((dependency: any) =>
  dependency.uuid === dataManifest.header.uuid && JSON.stringify(dependency.version) === JSON.stringify(dataManifest.header.version)
), 'the main behavior output must depend on every other generated behavior output');
assert.match(scriptOutput.label, /Main \(activate this one\)/);
assert.ok(dataOutputZip.file('blocks/demo_block.json'), 'data-only definitions must remain in the dependency pack');
assert.ok(splitOutput.combinedExtras?.diagnosticsText?.includes('BEHAVIOR_ACTIVATION_ROOT'));
console.log('✓ main behavior output activates all split behavior packs through manifest dependencies');

// Real production-path regression: independent UI files and HUD patches from
// separate packs must both survive the resource-pack merge.
const uiPackA = await makePack('Resource Pack', 'HUD Coordinates', {
  'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/coordinates.json', 'custom_screens/shared_menu.json'] }),
  'custom_screens/shared_menu.json': JSON.stringify({ namespace: 'shared', first_panel: { type: 'panel', controls: [{ first_button: { type: 'button' } }] } }),
  'ui/coordinates.json': JSON.stringify({ coordinates_panel: { type: 'panel', size: [240, 60], anchor_from: 'top_left', anchor_to: 'top_left', offset: [14, 14], controls: [{ 'coords@hud.coords': {} }], bindings: [{ binding_name: '#position' }] } }),
  'ui/hud_screen.json': JSON.stringify({ root_panel: { size: ['100%', '100%'], modifications: [{ array_name: 'controls', operation: 'insert_front', value: [{ 'coordinates@hud.coordinates_panel': {} }] }] } })
});
const uiPackB = await makePack('Resource Pack', 'HUD Weapon', {
  'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/weapon.json', 'custom_screens/shared_menu.json'] }),
  'custom_screens/shared_menu.json': JSON.stringify({ namespace: 'shared', second_panel: { type: 'panel', controls: [{ second_button: { type: 'button' } }] } }),
  'ui/weapon.json': JSON.stringify({ weapon_panel: { type: 'panel', size: [240, 60], anchor_from: 'top_left', anchor_to: 'top_left', offset: [14, 14], controls: [{ 'ammo@hud.ammo': {} }], bindings: [{ binding_name: '#ammo' }] } }),
  'ui/hud_screen.json': JSON.stringify({ root_panel: { size: ['100%', '100%'], modifications: [{ array_name: 'controls', operation: 'insert_front', value: [{ 'weapon@hud.weapon_panel': {} }] }] } })
});
const uiMerged = await executeMergePacks([uiPackA, uiPackB], { modpackName: 'UI Compatibility' });
const uiRp = await JSZip.loadAsync(uiMerged.outputs!.find(output => output.type === 'resource')!.blob!);
const uiDefs = JSON.parse(await uiRp.file('ui/_ui_defs.json')!.async('text'));
assert.deepEqual(uiDefs.ui_defs.sort(), ['custom_screens/shared_menu.json', 'ui/coordinates.json', 'ui/weapon.json']);
const hud = JSON.parse(await uiRp.file('ui/hud_screen.json')!.async('text'));
assert.equal(hud.root_panel.modifications.length, 2);
const relocated = hud.root_panel.modifications.flatMap((patch: any) => patch.value || []).find((entry: any) => entry['weapon@hud.weapon_panel']);
assert.ok(relocated, 'weapon HUD control should remain registered');
assert.ok(relocated['weapon@hud.weapon_panel'].anchor_from, 'overlapping measurable HUD control should receive a new anchor');
assert.ok(uiMerged.combinedExtras?.diagnosticsText?.includes('HUD_AUTO_PLACEMENT'), 'merge report should record the automatic HUD placement');
const registeredCustomUi = JSON.parse(await uiRp.file('custom_screens/shared_menu.json')!.async('text'));
assert.ok(registeredCustomUi.first_panel);
assert.ok(registeredCustomUi.second_panel,
  'a registered custom UI file outside ui/ must merge from every provider, not first-file-win');
const coordsUi = JSON.parse(await uiRp.file('ui/coordinates.json')!.async('text'));
const weaponUi = JSON.parse(await uiRp.file('ui/weapon.json')!.async('text'));
assert.equal(coordsUi.coordinates_panel.controls.length, 1);
assert.equal(weaponUi.weapon_panel.controls.length, 1);
assert.ok(!uiMerged.combinedExtras?.diagnosticsText?.includes('MISSING_UI_DEFINITION_FILE'));
console.log('✓ independent HUD additions, UI definitions and custom UI files survive the complete resource-pack merge');

// Conflict-screen Keep A / Keep B must select the winning definition rather
// than allowing the later generic merge to combine the discarded definition.
const keepA = await makePack('Behavior Pack', 'Keep A', {
  'entities/shared.json': JSON.stringify({ 'minecraft:entity': { description: { identifier: 'demo:shared' }, components: { 'minecraft:health': { value: 10, max: 10 } } } })
});
const keepB = await makePack('Behavior Pack', 'Keep B', {
  'entities/shared.json': JSON.stringify({ 'minecraft:entity': { description: { identifier: 'demo:shared' }, components: { 'minecraft:health': { value: 20, max: 20 } } } })
});
const choices = await detectConflicts([keepA, keepB]);
const definitionChoice = choices.find(conflict => conflict.identifier === 'demo:shared');
assert.ok(definitionChoice, 'preflight must detect duplicate custom entity identifiers');
definitionChoice!.resolution = 'keep_b';
const chosenMerge = await executeMergePacks([keepA, keepB], { modpackName: 'Keep B Test', conflicts: choices });
const chosenBehavior = await JSZip.loadAsync(chosenMerge.outputs!.find(output => output.type === 'behavior_data')!.blob!);
const chosenEntity = JSON.parse(await chosenBehavior.file('entities/shared.json')!.async('text'));
assert.equal(chosenEntity['minecraft:entity'].components['minecraft:health'].max, 20);
assert.ok(!chosenMerge.combinedExtras?.diagnosticsText?.includes('FEATURE_REGISTRY_RENAMED'), 'explicit Keep B must not be silently converted into prefix-and-keep-both');
console.log('✓ explicit Keep B choice survives the complete behavior-pack merge');

const beta = await makePack('Behavior Pack', 'Beta', { 'scripts/main.js': '// beta' }, '2.9.0-beta');
const plan = buildMergePlan([bpA, beta]);
assert.equal(plan.scriptGroups.length, 2);
assert.notEqual(plan.scriptGroups[0].beta, plan.scriptGroups[1].beta);
assert.notEqual(
  `behavior_pack_v${plan.scriptGroups[0].major}${plan.scriptGroups[0].beta ? '_preview' : ''}.mcpack`,
  `behavior_pack_v${plan.scriptGroups[1].major}${plan.scriptGroups[1].beta ? '_preview' : ''}.mcpack`
);
console.log('✓ stable and beta Script API tracks stay in separate outputs');

const itemA = '{"minecraft:item":{"description":{"identifier":"demo:shared"},"components":{"minecraft:max_stack_size":16}}}';
const itemB = '{"minecraft:item":{"description":{"identifier":"demo:shared"},"components":{"minecraft:max_stack_size":64}}}';
const conflictA = await makePack('Behavior Pack', 'A', { '__brarchive/items/weapons.brarchive': archive('item.json', itemA) });
const conflictB = await makePack('Behavior Pack', 'B', { 'items/other.json': itemB });
const conflicts = await detectConflicts([conflictA, conflictB]);
assert.equal(conflicts.length, 1, 'preflight must inspect packed definitions');
conflicts[0].resolution = 'keep_b';
const chosen = await executeMergePacks([conflictA, conflictB], { modpackName: 'Conflict', conflicts });
const choiceZip = await JSZip.loadAsync(chosen.outputs![0].blob!);
assert.equal(choiceZip.file('items/weapons/item.json'), null);
assert.ok(choiceZip.file('items/other.json'));
console.log('✓ packed conflicts are detected and the selected definition wins');

const variant = new JSZip();
variant.file('subpacks/variant/ui/sample.json', 'selected');
variant.file('ui/sample.json', 'base'); // base after variant in ZIP order
variant.file('manifest.json', '{"subpacks":[{"folder":"variant"}]}');
const overlay = await applySubpackSelection(new Blob([await variant.generateAsync({ type: 'uint8array' }) as any]), 'variant');
assert.equal(await (await JSZip.loadAsync(overlay)).file('ui/sample.json')!.async('text'), 'selected');
console.log('✓ selected subpack overrides the base regardless of archive order');

// Manifest-declared empty variants are valid Bedrock subpacks. They may have
// no files or directory entry in the ZIP; selecting one must still succeed,
// strip the subpack metadata, and avoid leaking files from another variant.
const emptyVariant = new JSZip();
emptyVariant.file('manifest.json', JSON.stringify({
  format_version: 2,
  header: { name: 'Refine Sounds', description: 'Test', uuid: '11111111-1111-4111-8111-111111111111', version: [1, 0, 0] },
  modules: [{ type: 'resources', uuid: '22222222-2222-4222-8222-222222222222', version: [1, 0, 0] }],
  subpacks: [{ folder_name: 'only_sounds', name: 'Only Sounds' }, { folder_name: 'with_particles', name: 'With Particles' }]
}));
emptyVariant.file('subpacks/with_particles/particles/spark.json', '{"particle_effect":{}}');
emptyVariant.file('sounds/sound_definitions.json', '{"sound_definitions":{}}');
const emptyVariantOutput = await applySubpackSelection(
  new Blob([await emptyVariant.generateAsync({ type: 'uint8array' }) as any]),
  'only_sounds'
);
const emptyVariantZip = await JSZip.loadAsync(emptyVariantOutput);
const emptyVariantManifest = JSON.parse(await emptyVariantZip.file('manifest.json')!.async('text'));
assert.equal(emptyVariantManifest.subpacks, undefined, 'selected empty variant must be finalized like any other selection');
assert.ok(emptyVariantZip.file('sounds/sound_definitions.json'), 'base sounds must remain available to the empty overlay');
assert.equal(emptyVariantZip.file('particles/spark.json'), null, 'files from unselected variants must not leak into the selected output');
console.log('✓ manifest-declared empty subpacks can be selected without a physical folder');


const missing = await makePack('Behavior Pack', 'Missing entry', {}, '2.0.0');
const missingResult = await executeMergePacks([missing], { modpackName: 'Missing' });
assert.ok(missingResult.outputs?.some(output => output.type === 'behavior_data'), 'a stale script declaration without JavaScript must preserve data as a data-only pack');
assert.ok(missingResult.combinedExtras?.diagnosticsText?.includes('SCRIPT_ENTRY_MISSING'), 'the missing entry must be reported clearly');
const invalidJsonPack = await makePack('Behavior Pack', 'Broken JSON', {
  'items/broken.json': '{"minecraft:item": '
});
await assert.rejects(
  () => executeMergePacks([invalidJsonPack], { modpackName: 'Invalid JSON' }),
  /INVALID_JSON.*broken\.json/,
  'a merge must stop instead of shipping a pack with malformed item definitions'
);
console.log('✓ malformed merged JSON blocks output generation instead of shipping missing content');

const unsupported = await makePack('Behavior Pack', 'Bad archive', { '__brarchive/items/bad.brarchive': new Uint8Array([1, 2, 3]) });
await assert.rejects(detectConflicts([unsupported]), /Unsupported \.brarchive format/);
console.log('✓ missing scripts and unsupported optimized archives stop the merge');

async function assertRegistryConflict(type: string, path: string, root: string, identifier: string, valueKey: string) {
  const first = await makePack('Behavior Pack', `First ${type}`, {
    [path]: JSON.stringify({ [root]: { description: { identifier }, components: { [valueKey]: { value: 1 } } } })
  });
  const second = await makePack('Behavior Pack', `Second ${type}`, {
    [path]: JSON.stringify({ [root]: { description: { identifier }, components: { [valueKey]: { value: 2 } } } })
  });
  const found = await detectConflicts([first, second]);
  const conflict = found.find(conflict => conflict.type === type && conflict.identifier === identifier);
  assert.ok(conflict, `preflight must detect duplicate ${type} identifier ${identifier}`);
  assert.equal(conflict.resolution, type === 'spawn_rule' ? 'keep_a' : 'prefix_all',
    `preflight must choose a preservation-safe default for ${type}`);
}
await assertRegistryConflict('attachable', 'attachables/tool.json', 'minecraft:attachable', 'demo:tool', 'minecraft:render');
await assertRegistryConflict('spawn_rule', 'spawn_rules/mob.json', 'minecraft:spawn_rules', 'demo:mob', 'minecraft:spawns_on_block_filter');
await assertRegistryConflict('recipe', 'recipes/potion.json', 'minecraft:recipe_brewing_mix', 'demo:potion_mix', 'input');
const lootA = await makePack('Behavior Pack', 'Loot A', {
  'loot_tables/blocks/meteorite.json': JSON.stringify({ pools: [{ rolls: 1, entries: [{ type: 'item', name: 'demo:ore_a' }] }] })
});
const lootB = await makePack('Behavior Pack', 'Loot B', {
  'loot_tables/blocks/meteorite.json': JSON.stringify({ pools: [{ rolls: 1, entries: [{ type: 'item', name: 'demo:ore_b' }] }] })
});
const lootConflicts = await detectConflicts([lootA, lootB]);
const lootConflict = lootConflicts.find(conflict => conflict.type === 'loot_table' && conflict.identifier === 'blocks/meteorite');
assert.ok(lootConflict, 'preflight must detect nested loot-table path conflicts');
assert.equal(lootConflict.resolution, 'keep_a', 'path-bound loot tables must require a deliberate winner instead of unsafe prefixing');
console.log('✓ preflight detects attachable, spawn-rule, brewing-recipe and nested loot-table conflicts');

const atlasFirst = await makePack('Resource Pack', 'First Atlas', {
  'textures/item_texture.json': JSON.stringify({ texture_data: { 'demo:shared_icon': { textures: 'textures/items/shared_icon' } } }),
  'textures/terrain_texture.json': JSON.stringify({ texture_data: { 'demo:shared_terrain': { textures: 'textures/blocks/shared_block' } } }),
  'textures/items/shared_icon.png': new Uint8Array([1]),
  'textures/blocks/shared_block.png': new Uint8Array([2])
});
const atlasSecond = await makePack('Resource Pack', 'Second Atlas', {
  'textures/item_texture.json': JSON.stringify({ texture_data: { 'demo:shared_icon': { textures: 'textures/items/shared_icon' } } }),
  'textures/terrain_texture.json': JSON.stringify({ texture_data: { 'demo:shared_terrain': { textures: 'textures/blocks/shared_block' } } }),
  'textures/items/shared_icon.png': new Uint8Array([3]),
  'textures/blocks/shared_block.png': new Uint8Array([4]),
  'blocks.json': JSON.stringify({ 'demo:atlas_block': { textures: 'demo:shared_terrain' } })
});
const atlasBehavior = await makePack('Behavior Pack', 'Second Atlas Behavior', {
  'items/atlas_item.json': JSON.stringify({
    'minecraft:item': {
      description: { identifier: 'demo:atlas_item' },
      components: { 'minecraft:icon': { texture: 'demo:shared_icon' } }
    }
  }),
  'blocks/atlas_block.json': JSON.stringify({
    'minecraft:block': {
      description: { identifier: 'demo:atlas_block' },
      components: { 'minecraft:material_instances': { '*': { texture: 'demo:shared_terrain' } } }
    }
  })
});
// The source archives are the same .mcaddon; this fixture intentionally
// omits an explicit BP -> RP dependency, as some valid add-ons do.
atlasBehavior.sourceFileName = atlasSecond.sourceFileName;
const atlasMerged = await executeMergePacks([atlasFirst, atlasSecond, atlasBehavior], { modpackName: 'Texture Alias Preservation' });
const atlasRp = await JSZip.loadAsync(atlasMerged.outputs!.find(output => output.type === 'resource')!.blob!);
const atlasBp = await JSZip.loadAsync(atlasMerged.outputs!.find(output => output.type === 'behavior_data')!.blob!);
const itemAtlas = JSON.parse(await atlasRp.file('textures/item_texture.json')!.async('text'));
const terrainAtlas = JSON.parse(await atlasRp.file('textures/terrain_texture.json')!.async('text'));
const renamedItemAlias = Object.keys(itemAtlas.texture_data).find(key => key.startsWith('demo:shared_icon__second_atlas'));
const renamedTerrainAlias = Object.keys(terrainAtlas.texture_data).find(key => key.startsWith('demo:shared_terrain__second_atlas'));
assert.ok(renamedItemAlias, 'a colliding item texture alias must be preserved under a unique name');
assert.ok(renamedTerrainAlias, 'a colliding terrain texture alias must be preserved under a unique name');
assert.equal(Object.keys(atlasRp.files).filter(path => path.startsWith('textures/items/') && path.endsWith('.png')).length, 2,
  'both different binary images using the same original path must survive under distinct output paths');
assert.equal(Object.keys(atlasRp.files).filter(path => path.startsWith('textures/blocks/') && path.endsWith('.png')).length, 2,
  'both different block textures using the same original path must survive under distinct output paths');
const atlasItem = JSON.parse(await atlasBp.file('items/atlas_item.json')!.async('text'));
assert.equal(atlasItem['minecraft:item'].components['minecraft:icon'].texture, renamedItemAlias,
  'the paired behavior-pack item icon must be rewritten to the renamed resource alias');
const atlasBlock = JSON.parse(await atlasBp.file('blocks/atlas_block.json')!.async('text'));
assert.equal(atlasBlock['minecraft:block'].components['minecraft:material_instances']['*'].texture, renamedTerrainAlias,
  'the paired behavior-pack block material must be rewritten to the renamed terrain alias');
const legacyBlocks = JSON.parse(await atlasRp.file('blocks.json')!.async('text'));
assert.equal(legacyBlocks['demo:atlas_block'].textures, renamedTerrainAlias,
  'the resource pack legacy blocks.json mapping must follow the renamed terrain alias');
console.log('✓ colliding item/terrain atlas aliases survive and paired BP/RP references are repaired');

const scriptRepairFixture = new JSZip();
const originalScript = [
  '// world?.beforeEvents?.entityHurt?.subscribe(event => {',
  '  try {',
  '    const value = event.damage;',
  '  } catch (error) {}',
  '}, { entityFilter: { type: "demo:mob" } });',
  'world.beforeEvents.entityHurt.subscribe(event => {',
  '  event.cancel = false;',
  '});'
].join('\\n');
scriptRepairFixture.file('scripts/libs/boss_attack_utils.js', originalScript);
const scriptRepairDiagnostics: string[] = [];
const changedScriptCount = await guardUnavailableEventSubscriptions(scriptRepairFixture, scriptRepairDiagnostics);
assert.equal(changedScriptCount, 0, 'untrusted third-party JavaScript must not be regex-rewritten');
assert.equal(await scriptRepairFixture.file('scripts/libs/boss_attack_utils.js')!.async('text'), originalScript,
  'comments and callback bodies must remain byte-for-byte unchanged');
assert.ok(scriptRepairDiagnostics.some(message => message.includes('Skipped automatic JavaScript source rewrites')),
  'the report must disclose that automatic script rewriting was skipped');
console.log('✓ arbitrary add-on JavaScript and event-like comments are preserved without regex rewriting');



const brokenReferences = await makePack('Behavior Pack', 'Broken references', {
  'items/missing_spawn_egg.json': JSON.stringify({
    'minecraft:item': {
      description: { identifier: 'demo:missing_spawn_egg' },
      components: {
        'minecraft:icon': { texture: 'demo:missing_icon' },
        'minecraft:entity_placer': { entity: 'demo:missing_mob' }
      }
    }
  }),
  'recipes/missing_recipe.json': JSON.stringify({
    'minecraft:recipe_shaped': {
      description: { identifier: 'demo:missing_recipe' },
      tags: ['crafting_table'],
      pattern: ['A'],
      key: { A: { item: 'demo:missing_ingredient' } },
      result: { item: 'demo:missing_result' }
    }
  })
});
const referenceCheck = await executeMergePacks([brokenReferences], { modpackName: 'Cross Pack Reference Validation' });
assert.ok(referenceCheck.combinedExtras?.diagnosticsText?.includes('MISSING_SPAWN_EGG_ENTITY'),
  'cross-pack validation must catch spawn eggs whose entity definition is missing');
assert.ok(referenceCheck.combinedExtras?.diagnosticsText?.includes('MISSING_CUSTOM_ITEM_ICON_ALIAS'),
  'cross-pack validation must catch namespaced item icon aliases missing from the RP');
assert.ok(referenceCheck.combinedExtras?.diagnosticsText?.includes('MISSING_RECIPE_CONTENT_REFERENCE'),
  'cross-pack validation must catch recipes referencing missing custom items');
console.log('✓ cross-pack validation catches missing spawn-egg entities, item icons and recipe ingredients');

const pairABehavior = await makePack('Behavior Pack', 'Pair A Behavior Pack', {
  'entities/mob.json': JSON.stringify({
    'minecraft:entity': { description: { identifier: 'demo:paired_mob' }, components: { 'minecraft:health': { max: 20 } } }
  })
});
const pairAResource = await makePack('Resource Pack', 'Pair A Resource Pack', {
  'entity/mob.json': JSON.stringify({
    'minecraft:client_entity': { description: { identifier: 'demo:paired_mob' }, components: { 'minecraft:geometry': { default: 'geometry.pair_a' } } }
  })
});
const pairBBehavior = await makePack('Behavior Pack', 'Pair B Behavior Pack', {
  'entities/mob.json': JSON.stringify({
    'minecraft:entity': { description: { identifier: 'demo:paired_mob' }, components: { 'minecraft:health': { max: 40 } } }
  })
});
const pairBResource = await makePack('Resource Pack', 'Pair B Resource Pack', {
  'entity/mob.json': JSON.stringify({
    'minecraft:client_entity': { description: { identifier: 'demo:paired_mob' }, components: { 'minecraft:geometry': { default: 'geometry.pair_b' } } }
  })
});
pairABehavior.sourceFileName = pairAResource.sourceFileName = 'PairA.mcaddon';
pairBBehavior.sourceFileName = pairBResource.sourceFileName = 'PairB.mcaddon';
const pairedPacks = [pairABehavior, pairAResource, pairBBehavior, pairBResource];
const pairedConflicts = await detectConflicts(pairedPacks);
assert.ok(pairedConflicts.some(conflict => conflict.type === 'entity' && conflict.packB.id === pairBBehavior.id));
assert.ok(pairedConflicts.some(conflict => conflict.type === 'entity' && conflict.packB.id === pairBResource.id));
const pairedMerge = await executeMergePacks(pairedPacks, { modpackName: 'Paired Entity Identifier Preservation', conflicts: pairedConflicts });
const pairedBp = await JSZip.loadAsync(pairedMerge.outputs!.find(output => output.type === 'behavior_data')!.blob!);
const pairedRp = await JSZip.loadAsync(pairedMerge.outputs!.find(output => output.type === 'resource')!.blob!);
const behaviorEntityIds: string[] = [];
for (const [path, file] of Object.entries(pairedBp.files)) {
  if (!file.dir && path.startsWith('entities/') && path.endsWith('.json')) {
    const data = JSON.parse(await file.async('text'));
    if (data['minecraft:entity']?.description?.identifier) behaviorEntityIds.push(data['minecraft:entity'].description.identifier);
  }
}
const clientEntityIds: string[] = [];
for (const [path, file] of Object.entries(pairedRp.files)) {
  if (!file.dir && path.startsWith('entity/') && path.endsWith('.json')) {
    const data = JSON.parse(await file.async('text'));
    if (data['minecraft:client_entity']?.description?.identifier) clientEntityIds.push(data['minecraft:client_entity'].description.identifier);
  }
}
const renamedBehaviorId = behaviorEntityIds.find(id => id !== 'demo:paired_mob');
const renamedClientId = clientEntityIds.find(id => id !== 'demo:paired_mob');
assert.ok(renamedBehaviorId, 'the second behavior entity should be safely namespaced');
assert.equal(renamedClientId, renamedBehaviorId,
  'the paired resource client_entity must receive the exact same rewritten identifier as its behavior entity');
console.log('✓ paired behavior/resource entity identifiers remain synchronized when duplicate entities are prefixed');
