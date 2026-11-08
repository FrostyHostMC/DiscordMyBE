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
const result = await executeMergePacks(packs, { modpackName: 'Integration test', conflicts: await detectConflicts(packs) });
const bp = await JSZip.loadAsync(result.outputs!.find(output => output.type === 'behavior_script')!.blob!);
const rp = await JSZip.loadAsync(result.outputs!.find(output => output.type === 'resource')!.blob!);
const scripts = Object.keys(bp.files).filter(path => path.endsWith('/scripts/main.js'));
assert.equal(scripts.length, 2, 'same-named packs must have separate script trees');
assert.deepEqual((await Promise.all(scripts.map(path => bp.file(path)!.async('text')))).sort(), [scriptA, 'world?.afterEvents?.playerSpawn?.subscribe?.(event => console.log("handbook"));'].sort());
assert.ok(bp.file(scripts.find(path => path.includes('_1/'))!.replace('main.js', 'helper.js')));
assert.match(await bp.file('scripts/Stonebyte.js')!.async('text'), /import ['"]\.\//);
assert.ok(bp.file('cameras/presets/test.json'));
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
const reparsed = await parseAddonArchive(await ensureCombinedBlob(result), 'merged.mcaddon');
assert.deepEqual(reparsed.errors, []);
assert.equal(reparsed.packs.length, 2, 'a combined output must reimport as its BP and RP');
console.log('✓ real merge preserves scripts, player view, camera paths, material entries, atlas references and reimport');

const beta = await makePack('Behavior Pack', 'Beta', { 'scripts/main.js': '// beta' }, '2.9.0-beta');
const plan = buildMergePlan([bpA, beta]);
assert.equal(plan.scriptGroups.length, 2);
assert.notEqual(plan.scriptGroups[0].fileName, plan.scriptGroups[1].fileName);
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
const unsupported = await makePack('Behavior Pack', 'Bad archive', { '__brarchive/items/bad.brarchive': new Uint8Array([1, 2, 3]) });
await assert.rejects(detectConflicts([unsupported]), /Unsupported \.brarchive format/);
console.log('✓ missing scripts and unsupported optimized archives stop the merge');
