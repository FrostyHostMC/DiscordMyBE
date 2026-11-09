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

function archive(name: string, content: string): Uint8Array {
  const bytes = new TextEncoder().encode(content);
  const result = new Uint8Array(16 + 256 + bytes.length);
  result.set([0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26]);
  const view = new DataView(result.buffer);
  view.setUint32(8, 1, true);
  view.setUint32(12, 1, true);
  const encodedName = new TextEncoder().encode(name);
  result[16] = encodedName.length;
  result.set(encodedName, 17);
  view.setUint32(16 + 252, bytes.length, true);
  result.set(bytes, 16 + 256);
  return result;
}

const player = '{"minecraft:client_entity":{"description":{"identifier":"minecraft:player","animations":{"base_walk":"animation.base.walk"},"scripts":{"initialize":["variable.is_first_person = query.is_first_person;"],"animate":["base_walk"]}}}}';
const playerOverlay = '{"minecraft:client_entity":{"description":{"identifier":"minecraft:player","animations":{"addon_emote":"animation.addon.emote"},"scripts":{"animate":["addon_emote"]}}}}';
const scriptA = 'import "./helper.js"; world.setDynamicProperty("score", 1);';
const scriptB = 'world.afterEvents.playerSpawn.subscribe(event => console.log("handbook"));';
const bpA = await makePack('Behavior Pack', 'Same name', { 'scripts/main.js': scriptA, 'scripts/helper.js': 'export const ok = true;', '__brarchive/cameras/presets.brarchive': archive('test.json', '{"preset":true}') }, '2.7.0');
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
assert.deepEqual((await Promise.all(scripts.map(path => bp.file(path)!.async('text')))).sort(), [scriptA, 'world?.afterEvents?.playerSpawn?.subscribe?.(event => console.log("handbook"));'].sort());
assert.ok(bp.file(scripts.find(path => path.includes('_1/'))!.replace('main.js', 'helper.js')));
assert.match(await bp.file('scripts/Stonebyte.js')!.async('text'), /import ['"]\.\//);
assert.ok(bp.file('cameras/test.json'), 'packed camera presets should expand beside the archive container folder');
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
assert.ok(result.combinedExtras?.diagnosticsText?.includes('Subpack fixture -> high_resolution'), 'the merge report must record the subpack variant actually supplied by the caller');
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

const itemA = '{"minecraft:item":{"description":{"identifier":"demo:shared"},"components":{"a":{}}}}';
const itemB = '{"minecraft:item":{"description":{"identifier":"demo:shared"},"components":{"b":{}}}}';
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

const missing = await makePack('Behavior Pack', 'Missing entry', {}, '2.0.0');
const missingResult = await executeMergePacks([missing], { modpackName: 'Missing' });
assert.ok(missingResult.outputs?.some(output => output.type === 'behavior_data'), 'a stale script declaration without JavaScript must preserve data as a data-only pack');
assert.ok(missingResult.combinedExtras?.diagnosticsText?.includes('SCRIPT_ENTRY_MISSING'), 'the missing entry must be reported clearly');
const invalidJsonPack = await makePack('Behavior Pack', 'Broken JSON', {
  'items/broken.json': '{"minecraft:item": '
});
await assert.rejects(
  () => executeMergePacks([invalidJsonPack], { modpackName: 'Invalid JSON' }),
  /INVALID_JSON.*items\\/broken\\.json/,
  'a merge must stop instead of shipping a pack with malformed item definitions'
);
console.log('✓ malformed merged JSON blocks output generation instead of shipping missing content');

const unsupported = await makePack('Behavior Pack', 'Bad archive', { '__brarchive/items/bad.brarchive': new Uint8Array([1, 2, 3]) });
await assert.rejects(detectConflicts([unsupported]), /Unsupported \.brarchive format/);
console.log('✓ missing scripts and unsupported optimized archives stop the merge');
