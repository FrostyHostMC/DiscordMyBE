import { AddonPack, MergedModpack } from '@/types/modpack';

// High quality SVG icon generators for bedrock packs
export function createPackIconSvg(type: 'Behavior' | 'Resource', symbol: string, bgColor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="14" fill="${bgColor}"/>
    <circle cx="32" cy="32" r="24" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
    <text x="32" y="38" font-family="system-ui, sans-serif" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle">${symbol}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Demo library.
 *
 * `scriptApiVersion` MUST hold the bare numeric version (e.g. "1.13.0"); the
 * previous demo data stored the human-readable label "@minecraft/server 1.13.0",
 * which the merge engine could not parse, so every scripted demo pack was
 * classified as "unknown version" and left out of the merge.
 */
export const INITIAL_DEMO_PACKS: AddonPack[] = [
  {
    id: 'demo-pack-1',
    name: 'Better Vegetation',
    type: 'Behavior Pack',
    version: 'v1.3.0',
    versionArray: [1, 3, 0],
    uuid: 'a4291881-6456-4b68-b7a4-8491c7128001',
    description: 'Dynamic leaves, falling foliage, and enhanced biome grass behaviors.',
    minEngineVersion: '1.21.30',
    fileSize: 14_200_000,
    dateAdded: Date.now() - 3600_000 * 48,
    hasScripts: false,
    hasExperimental: false,
    iconDataUrl: createPackIconSvg('Behavior', '🌿', '#15803d'),
    sourceFileName: 'BetterVegetation_v1.3.0.mcpack'
  },
  {
    id: 'demo-pack-2',
    name: 'Realistic Skies',
    type: 'Resource Pack',
    version: 'v2.1.0',
    versionArray: [2, 1, 0],
    uuid: 'b9472911-7392-4211-9a41-9491c7128002',
    description: 'Ultra HD celestial spheres, 4K starfields, dynamic sun & moon phases.',
    minEngineVersion: '1.21.30',
    fileSize: 68_400_000,
    dateAdded: Date.now() - 3600_000 * 24,
    hasScripts: false,
    hasExperimental: false,
    iconDataUrl: createPackIconSvg('Resource', '🌌', '#1e3a8a'),
    sourceFileName: 'RealisticSkies_v2.1.0.mcpack'
  },
  {
    id: 'demo-pack-3',
    name: 'More Blocks',
    type: 'Behavior Pack',
    version: 'v1.8.2',
    versionArray: [1, 8, 2],
    uuid: 'c8491022-8114-4903-8821-9491c7128003',
    description: 'Over 120 decorative building blocks with custom geometries and sounds.',
    minEngineVersion: '1.21.30',
    fileSize: 32_100_000,
    dateAdded: Date.now() - 3600_000 * 12,
    hasScripts: true,
    hasExperimental: true,
    scriptApiVersion: '1.13.0',
    scriptVersion: '@minecraft/server 1.13.0',
    capabilities: ['script_eval'],
    iconDataUrl: createPackIconSvg('Behavior', '🧱', '#b45309'),
    sourceFileName: 'MoreBlocks_BP_v1.8.2.mcaddon'
  },
  {
    id: 'demo-pack-4',
    name: 'HD Textures',
    type: 'Resource Pack',
    version: 'v1.4.7',
    versionArray: [1, 4, 7],
    uuid: 'd7481944-9023-4102-bf11-9491c7128004',
    description: 'Faithful 64x resolution blocks, clean UI textures, and clear water.',
    minEngineVersion: '1.21.30',
    fileSize: 27_900_000,
    dateAdded: Date.now() - 3600_000 * 6,
    hasScripts: false,
    hasExperimental: false,
    iconDataUrl: createPackIconSvg('Resource', '✨', '#6d28d9'),
    sourceFileName: 'HD_Textures_64x.mcpack'
  },
  {
    id: 'demo-pack-5',
    name: 'Furniture Addon',
    type: 'Behavior Pack',
    version: 'v1.2.0',
    versionArray: [1, 2, 0],
    uuid: 'e2918400-1928-4019-9402-9491c7128005',
    description: 'Chairs, tables, kitchenware with sit interact mechanics and sounds.',
    minEngineVersion: '1.21.30',
    fileSize: 18_500_000,
    dateAdded: Date.now() - 3600_000 * 2,
    hasScripts: true,
    hasExperimental: true,
    scriptApiVersion: '2.5.0',
    scriptVersion: '@minecraft/server 2.5.0',
    capabilities: ['script_eval'],
    iconDataUrl: createPackIconSvg('Behavior', '🛋️', '#78350f'),
    sourceFileName: 'FurnitureAddon.mcaddon'
  },
  {
    id: 'demo-pack-6',
    name: 'Custom Mobs',
    type: 'Behavior Pack',
    version: 'v1.1.5',
    versionArray: [1, 1, 5],
    uuid: 'f1029488-3019-4820-a019-9491c7128006',
    description: 'Rare wandering bosses, friendly domestic mounts, and elemental spirits.',
    minEngineVersion: '1.21.30',
    fileSize: 24_200_000,
    dateAdded: Date.now() - 3600_000,
    hasScripts: false,
    hasExperimental: false,
    iconDataUrl: createPackIconSvg('Behavior', '🐉', '#047857'),
    sourceFileName: 'CustomMobs_v1.1.5.mcpack'
  }
];

export const INITIAL_DEMO_MODPACKS: MergedModpack[] = [
  {
    id: 'demo-modpack-1',
    name: 'StoneByte Enhanced',
    totalPacks: 4,
    size: 142_600_000,
    version: '1.0.0',
    createdAt: Date.now() - 3600_000 * 5,
    description:
      'All-in-one survival expansion containing Better Vegetation, Realistic Skies, More Blocks, and HD Textures.',
    outputFileName: 'StoneByte_Enhanced.mcaddon',
    // Demo entry has no real output blob, so the UI must not offer a download.
    includedPacks: [
      { name: 'Better Vegetation', type: 'Behavior Pack', version: 'v1.3.0', iconDataUrl: createPackIconSvg('Behavior', '🌿', '#15803d') },
      { name: 'Realistic Skies', type: 'Resource Pack', version: 'v2.1.0', iconDataUrl: createPackIconSvg('Resource', '🌌', '#1e3a8a') },
      { name: 'More Blocks', type: 'Behavior Pack', version: 'v1.8.2', iconDataUrl: createPackIconSvg('Behavior', '🧱', '#b45309') },
      { name: 'HD Textures', type: 'Resource Pack', version: 'v1.4.7', iconDataUrl: createPackIconSvg('Resource', '✨', '#6d28d9') }
    ]
  }
];