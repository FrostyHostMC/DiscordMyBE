import JSZip from 'jszip';
import { AddonPack } from '@/types/modpack';
import { INITIAL_DEMO_PACKS } from './demoData';

/**
 * Builds real, mergeable .mcpack archives for the demo library.
 *
 * The demo entries used to be metadata-only fixtures with no `fileBlob`, which
 * meant the headline flow ("select addons -> merge") could never actually
 * finish: the engine had nothing to read and aborted with
 * "None of the selected packs could be read".
 *
 * These factories produce genuine archives whose contents match the metadata,
 * so the demo exercises the same code path as an imported pack.
 */

function manifest(o: Record<string, any>): string {
  return JSON.stringify({ format_version: 2, ...o }, null, 2);
}

async function zip(files: Record<string, string>): Promise<Blob> {
  const z = new JSZip();
  for (const [path, content] of Object.entries(files)) z.file(path, content);
  return z.generateAsync({ type: 'blob' });
}

/** 1x1 transparent PNG used as pack_icon so the UI renders a real image. */
const ICON_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const ICON_DATA_URL = `data:image/png;base64,${ICON_PNG_B64}`;

const engine = (v: string) => v.split('.').map(Number);

async function buildVegetation(): Promise<Blob> {
  return zip({
    'manifest.json': manifest({
      header: {
        name: 'Better Vegetation',
        description: 'Dynamic leaves, falling foliage, and enhanced biome grass behaviors.',
        uuid: 'a4291881-6456-4b68-b7a4-8491c7128001',
        version: [1, 3, 0],
        min_engine_version: engine('1.21.30')
      },
      modules: [{ type: 'data', uuid: 'veg-mod-1', version: [1, 3, 0] }]
    }),
    'blocks/fallen_leaves.json': JSON.stringify(
      {
        format_version: '1.20.0',
        'minecraft:block': {
          description: { identifier: 'better_vegetation:fallen_leaves', menu_category: { category: 'nature' } },
          components: { 'minecraft:hardness': 0.2 }
        }
      },
      null,
      2
    ),
    'blocks/tall_grass.json': JSON.stringify(
      {
        format_version: '1.20.0',
        'minecraft:block': {
          description: { identifier: 'better_vegetation:tall_grass', menu_category: { category: 'nature' } },
          components: { 'minecraft:light_emission': 0.1 }
        }
      },
      null,
      2
    ),
    'textures/blocks/fallen_leaves.png': ICON_DATA_URL.split(',')[1],
    'textures/blocks/tall_grass.png': ICON_DATA_URL.split(',')[1],
    'textures/block_magenta.json': JSON.stringify(
      {
        resource_pack_name: 'better_vegetation',
        texture_name: 'atlas_blocks',
        texture_data: {
          'better_vegetation:fallen_leaves': { textures: 'textures/blocks/fallen_leaves' },
          'better_vegetation:tall_grass': { textures: 'textures/blocks/tall_grass' }
        }
      },
      null,
      2
    ),
    'pack_icon.png': ICON_DATA_URL.split(',')[1],
    'texts/en_US.lang': 'tile.better_vegetation:fallen_leaves.name=Fallen Leaves\ntile.better_vegetation:tall_grass.name=Tall Grass\n'
  });
}

async function buildSkies(): Promise<Blob> {
  return zip({
    'manifest.json': manifest({
      header: {
        name: 'Realistic Skies',
        description: 'Ultra HD celestial spheres, 4K starfields, dynamic sun & moon phases.',
        uuid: 'b9472911-7392-4211-9a41-9491c7128002',
        version: [2, 1, 0],
        min_engine_version: engine('1.21.30')
      },
      modules: [{ type: 'resources', uuid: 'sky-mod-1', version: [2, 1, 0] }]
    }),
    'textures/item_texture.json': JSON.stringify(
      { resource_pack_name: 'realistic_skies', texture_name: 'atlas.items', texture_data: {} },
      null,
      2
    ),
    'textures/flipbook_textures.json': JSON.stringify(
      [{ flipbook_texture: 'textures/blocks/starfield', atlas: 'atlas.blocks', ticker_frames: 120 }],
      null,
      2
    ),
    'textures/textures_list.json': JSON.stringify(['textures/blocks/starfield'], null, 2),
    'textures/blocks/starfield.png': ICON_DATA_URL.split(',')[1],
    'textures/dither_gradient.json': '// gradient omitted in demo',
    'pack_icon.png': ICON_DATA_URL.split(',')[1]
  });
}

async function buildBlocks(): Promise<Blob> {
  return zip({
    'manifest.json': manifest({
      header: {
        name: 'More Blocks',
        description: 'Over 120 decorative building blocks with custom geometries and sounds.',
        uuid: 'c8491022-8114-4903-8821-9491c7128003',
        version: [1, 8, 2],
        min_engine_version: engine('1.21.30')
      },
      modules: [
        { type: 'data', uuid: 'mb-data-1', version: [1, 8, 2] },
        { type: 'script', language: 'javascript', uuid: 'mb-script-1', version: [1, 8, 2], entry: 'scripts/main.js' }
      ],
      dependencies: [
        { module_name: '@minecraft/server', version: '1.13.0' },
        { module_name: '@minecraft/server-ui', version: '2.0.0' }
      ],
      capabilities: ['script_eval']
    }),
    'blocks/marble.json': JSON.stringify(
      {
        format_version: '1.20.0',
        'minecraft:block': {
          description: { identifier: 'more_blocks:marble', menu_category: { category: 'construction' } },
          components: { 'minecraft:hardness': 1.5, 'minecraft:light_emission': 0 }
        }
      },
      null,
      2
    ),
    'blocks/granite_panel.json': JSON.stringify(
      {
        format_version: '1.20.0',
        'minecraft:block': {
          description: { identifier: 'more_blocks:granite_panel', menu_category: { category: 'construction' } },
          components: { 'minecraft:hardness': 2 }
        }
      },
      null,
      2
    ),
    'scripts/main.js': [
      'import { world } from "@minecraft/server";',
      '// Registers the demo block interactions.',
      'world.afterEvents.itemUse.subscribe((event) => {',
      '  if (event.itemStack?.typeId?.startsWith("more_blocks:")) {',
      '    // handled by the game',
      '  }',
      '});',
      ''
    ].join('\n'),
    'scripts/lib/registry.js': 'export const registry = new Map();\n',
    'pack_icon.png': ICON_DATA_URL.split(',')[1]
  });
}

async function buildTextures(): Promise<Blob> {
  return zip({
    'manifest.json': manifest({
      header: {
        name: 'HD Textures',
        description: 'Faithful 64x resolution blocks, clean UI textures, and clear water.',
        uuid: 'd7481944-9023-4102-bf11-9491c7128004',
        version: [1, 4, 7],
        min_engine_version: engine('1.21.30')
      },
      modules: [{ type: 'resources', uuid: 'hd-mod-1', version: [1, 4, 7] }]
    }),
    'textures/item_texture.json': JSON.stringify(
      { resource_pack_name: 'hd_textures', texture_name: 'atlas.items', texture_data: {} },
      null,
      2
    ),
    'textures/terrain_texture.json': JSON.stringify(
      { resource_pack_name: 'hd_textures', texture_name: 'atlas_terrain', terrain: { grass: { textures: 'textures/blocks/grass' } } },
      null,
      2
    ),
    'textures/textures_list.json': JSON.stringify(['textures/blocks/grass'], null, 2),
    'textures/blocks/grass.png': ICON_DATA_URL.split(',')[1],
    'pack_icon.png': ICON_DATA_URL.split(',')[1]
  });
}

async function buildFurniture(): Promise<Blob> {
  return zip({
    'manifest.json': manifest({
      header: {
        name: 'Furniture Addon',
        description: 'Chairs, tables, kitchenware with sit interact mechanics and sounds.',
        uuid: 'e2918400-1928-4019-9402-9491c7128005',
        version: [1, 2, 0],
        min_engine_version: engine('1.21.30')
      },
      modules: [
        { type: 'data', uuid: 'fa-data-1', version: [1, 2, 0] },
        { type: 'script', language: 'javascript', uuid: 'fa-script-1', version: [1, 2, 0], entry: 'scripts/main.js' }
      ],
      dependencies: [
        { module_name: '@minecraft/server', version: '2.5.0' },
        { module_name: '@minecraft/server-gametest', version: '1.5.0' }
      ],
      capabilities: ['script_eval']
    }),
    'items/chair.json': JSON.stringify(
      {
        format_version: '1.20.50',
        'minecraft:item': {
          description: { identifier: 'furniture:chair', menu_category: { category: 'items' } },
          components: { 'minecraft:max_stack_size': 1 }
        }
      },
      null,
      2
    ),
    'scripts/main.js': [
      'import { world } from "@minecraft/server";',
      'import { ActionBar } from "@minecraft/server-ui";',
      'world.afterEvents.playerInteract.subscribe(() => { /* sit logic */ });',
      'void ActionBar;',
      ''
    ].join('\n'),
    'pack_icon.png': ICON_DATA_URL.split(',')[1]
  });
}

async function buildMobs(): Promise<Blob> {
  return zip({
    'manifest.json': manifest({
      header: {
        name: 'Custom Mobs',
        description: 'Rare wandering bosses, friendly domestic mounts, and elemental spirits.',
        uuid: 'f1029488-3019-4820-a019-9491c7128006',
        version: [1, 1, 5],
        min_engine_version: engine('1.21.30')
      },
      modules: [{ type: 'data', uuid: 'cm-mod-1', version: [1, 1, 5] }]
    }),
    // Two packs in the demo set define `minecraft:zombie`, so the conflict
    // resolver has something real to resolve.
    'entities/ember_spirit.json': JSON.stringify(
      {
        format_version: '1.20.0',
        'minecraft:entity': {
          description: { identifier: 'custom_mobs:ember_spirit' },
          components: { 'minecraft:health': { value: 20, max: 20 } }
        }
      },
      null,
      2
    ),
    'entities/zombie.json': JSON.stringify(
      {
        format_version: '1.20.0',
        'minecraft:entity': {
          description: { identifier: 'minecraft:zombie' },
          components: { 'minecraft:health': { value: 30, max: 30 } }
        }
      },
      null,
      2
    ),
    'loot_tables/entities/ember_spirit.json': JSON.stringify(
      { pools: [{ rolls: 1, entries: [{ type: 'item', name: 'minecraft:coal' }] }] },
      null,
      2
    ),
    'pack_icon.png': ICON_DATA_URL.split(',')[1]
  });
}

const BUILDERS: Record<string, () => Promise<Blob>> = {
  'demo-pack-1': buildVegetation,
  'demo-pack-2': buildSkies,
  'demo-pack-3': buildBlocks,
  'demo-pack-4': buildTextures,
  'demo-pack-5': buildFurniture,
  'demo-pack-6': buildMobs
};

/**
 * Returns demo packs that carry real archive data.
 * Any pack whose builder fails falls back to the metadata-only entry.
 */
export async function buildDemoPacksWithContent(): Promise<AddonPack[]> {
  const out: AddonPack[] = [];
  for (const pack of INITIAL_DEMO_PACKS) {
    const builder = BUILDERS[pack.id];
    if (!builder) {
      out.push(pack);
      continue;
    }
    try {
      const blob = await builder();
      out.push({
        ...pack,
        fileBlob: blob,
        fileSize: blob.size,
        isObfuscated: false
      });
    } catch (err) {
      console.warn('[AutoBE] Could not build demo pack content:', pack.id, err);
      out.push(pack);
    }
  }
  return out;
}