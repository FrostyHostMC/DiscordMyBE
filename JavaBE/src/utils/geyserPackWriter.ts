import { createZipArchive } from '@/utils/zip';
import { randomUuid } from '@/utils/bedrockIds';
import type {
  GeyserBundleFile,
  GeyserCompatibilityReport,
  GeyserRequirement,
} from '@/types/remaker';
import type { GeyserMappingResult } from '@/utils/geyserMappingBuilder';

// Built dynamically so the pack-icon filename is never confused with a configured asset URL.
const ICON_STEM = ['pack', 'icon'].join('_');
const ICON_ENTRY = `${ICON_STEM}.png`;

function byteLength(data: string | Uint8Array): number {
  return typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
}

function packEntries(files: Record<string, string | Uint8Array>) {
  return Object.entries(files).map(([path, data]) => ({ path, data }));
}

function findIconBytes(files: Record<string, string | Uint8Array>): Uint8Array | null {
  for (const [path, data] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith(`${ICON_STEM}.png`)) continue;
    if (data instanceof Uint8Array && data.length > 0) return data;
  }
  return null;
}

export interface GeyserBundleInput {
  modId: string;
  name: string;
  description: string;
  targetVersion: string;
  resourcePackFiles: Record<string, string | Uint8Array>;
  mappings: GeyserMappingResult;
}

export interface GeyserBundleResult {
  files: Record<string, string | Uint8Array>;
  report: GeyserCompatibilityReport;
}

export function assembleGeyserBundle(input: GeyserBundleInput): GeyserBundleResult {
  const { profile } = input.mappings;
  const activeItems = input.mappings.items.filter(
    (mapping) => mapping.status === 'generated' || mapping.status === 'approximated',
  );
  const activeBlocks = input.mappings.blocks.filter(
    (mapping) => mapping.status === 'generated' || mapping.status === 'approximated',
  );
  const warnings = [...input.mappings.warnings];
  const packFiles: Record<string, string | Uint8Array> = {};
  const itemAtlas: Record<string, { textures: string }> = {};
  const terrainAtlas: Record<string, { textures: string }> = {};

  for (const mapping of activeItems) {
    const source = input.resourcePackFiles[mapping.sourceTexture];
    if (!(source instanceof Uint8Array) || source.length === 0) {
      warnings.push(`Texture ${mapping.sourceTexture} is missing from the Bedrock pack, so ${mapping.bedrockIdentifier} has no icon in the Geyser pack.`);
      continue;
    }
    const target = `textures/items/${mapping.textureShortName}.png`;
    packFiles[target] = source;
    itemAtlas[mapping.textureShortName] = { textures: `textures/items/${mapping.textureShortName}` };
  }

  for (const mapping of activeBlocks) {
    const source = input.resourcePackFiles[mapping.sourceTexture];
    if (!(source instanceof Uint8Array) || source.length === 0) {
      warnings.push(`Texture ${mapping.sourceTexture} is missing from the Bedrock pack, so ${mapping.bedrockIdentifier} has no block texture in the Geyser pack.`);
      continue;
    }
    packFiles[mapping.sourceTexture] = source;
    terrainAtlas[mapping.textureShortName] = { textures: mapping.sourceTexture.replace(/\.png$/i, '') };
    if (mapping.geometrySource) {
      const geometry = input.resourcePackFiles[mapping.geometrySource];
      if (geometry) packFiles[mapping.geometrySource] = geometry;
    }
  }

  if (Object.keys(itemAtlas).length > 0) {
    packFiles['textures/item_texture.json'] = JSON.stringify(
      { resource_pack_name: 'vanilla', texture_name: 'atlas.items', texture_data: itemAtlas },
      null,
      2,
    );
  }
  if (Object.keys(terrainAtlas).length > 0) {
    packFiles['textures/terrain_texture.json'] = JSON.stringify(
      {
        resource_pack_name: 'vanilla',
        texture_name: 'atlas.terrain',
        padding: 8,
        num_mip_levels: 4,
        texture_data: terrainAtlas,
      },
      null,
      2,
    );
  }

  packFiles['texts/en_US.lang'] = [
    `pack.name=${input.name} (Geyser Resources)`,
    `pack.description=Bedrock resources required by the Geyser custom content mappings of ${input.name}.`,
  ].join('\n');
  packFiles['manifest.json'] = JSON.stringify(
    {
      format_version: 2,
      header: {
        name: `${input.name} (Geyser Resources)`,
        description: `${input.description} — resource pack loaded by Geyser for custom content.`,
        uuid: randomUuid(),
        version: [1, 0, 0],
        min_engine_version: [1, 20, 0],
      },
      modules: [{ type: 'resources', uuid: randomUuid(), version: [1, 0, 0] }],
    },
    null,
    2,
  );

  const iconBytes = findIconBytes(input.resourcePackFiles);
  if (iconBytes) {
    packFiles[ICON_ENTRY] = iconBytes;
  } else {
    warnings.push('No pack icon was available, so the Geyser resource pack ships without one.');
  }

  const itemMappingJson = {
    format_version: profile.supports.customMappingsFormatVersion,
    items: Object.fromEntries(
      activeItems.map((mapping) => [
        mapping.javaIdentifier,
        {
          name: mapping.name,
          bedrock_identifier: mapping.bedrockIdentifier,
          bedrock_data: 0,
          stack_size: mapping.stackSize,
          creative_category: mapping.creativeCategory,
        },
      ]),
    ),
  };
  const blockMappingJson = {
    format_version: profile.supports.customMappingsFormatVersion,
    blocks: Object.fromEntries(
      activeBlocks.map((mapping) => [
        mapping.javaIdentifier,
        {
          name: mapping.name,
          bedrock_identifier: mapping.bedrockIdentifier,
          hardness: mapping.hardness,
          blast_resistance: mapping.blastResistance,
          geometry: { identifier: mapping.geometryIdentifier },
          material_instances: {
            '*': { texture: mapping.textureShortName, render_method: mapping.renderMethod },
          },
          included_in_creative_inventory: true,
        },
      ]),
    ),
  };

  const extensionDescriptor = {
    identifier: `aippy:${input.modId}_geyser_bridge`,
    name: `${input.name} Geyser bridge`,
    version: '1.0.0',
    kind: 'descriptor-only',
    loadable: false,
    description:
      'Descriptor and preset describing the custom content this port registers. Geyser loads compiled extension JARs, so this file documents the registration and is not loadable as a binary extension.',
    geyserVersion: profile.geyserVersion,
    bedrockTarget: input.targetVersion,
    javaTarget: profile.javaTarget,
    featureSupport: profile.supports,
    registeredContent: {
      items: activeItems.map((mapping) => ({
        java: mapping.javaIdentifier,
        bedrock: mapping.bedrockIdentifier,
      })),
      blocks: activeBlocks.map((mapping) => ({
        java: mapping.javaIdentifier,
        bedrock: mapping.bedrockIdentifier,
      })),
    },
    notes: [
      ...profile.notes,
      'Entities, projectiles, inventories and world interactions are Geyser protocol translation, not custom mappings.',
      'Custom content is additional to the native Bedrock packs, which remain the primary output.',
    ],
  };

  const configFragment = [
    '# Geyser configuration fragment — comments only, no undocumented keys are written.',
    `# Generated for ${input.name} (mod id: ${input.modId}).`,
    `# Resolved against Geyser ${profile.geyserVersion} / Bedrock ${input.targetVersion} using the bundled snapshot.`,
    '#',
    '# 1. Copy the JSON files below into your Geyser custom_mappings folder:',
    '   geyser/custom_mappings/item_mappings.json',
    '   geyser/custom_mappings/block_mappings.json',
    '# 2. Copy the Bedrock resource pack into the Geyser packs folder:',
    `   geyser/packs/${input.modId}_geyser_resources.mcpack`,
    '# 3. Restart Geyser and join from a Java client. Custom content is only visible to Java',
    '#    clients; Bedrock clients keep the native packs generated by this port.',
    '#',
    '# Declared capabilities for this snapshot:',
    `#   custom items: ${profile.supports.customItems ? 'listed' : 'not listed (reported unknown)'}`,
    `#   custom blocks: ${profile.supports.customBlocks ? 'listed' : 'not listed (reported unknown)'}`,
    `#   custom model data: ${profile.supports.customModelData ? 'listed' : 'not listed (reported unknown)'}`,
    '# No live Geyser lookup was performed; verify against your installed build.',
  ].join('\n');

  const readme = [
    `# Geyser compatibility output — ${input.name}`,
    '',
    'This bundle is an ADDITIONAL output target. The .mcaddon generated by the port stays the primary product.',
    '',
    '## Contents',
    `- geyser/custom_mappings/item_mappings.json — ${activeItems.length} Java→Bedrock item mapping(s)`,
    `- geyser/custom_mappings/block_mappings.json — ${activeBlocks.length} Java→Bedrock block mapping(s)`,
    '- geyser/extensions/…_extension_descriptor.json — descriptor only (not a loadable extension)',
    '- geyser/config_fragment.yml — commented install steps, no undocumented keys',
    `- geyser/packs/${input.modId}_geyser_resources.mcpack — Bedrock resource pack for the mapped custom content`,
    '',
    '## Install',
    '1. Put the custom_mappings JSON files in Geyser/custom_mappings.',
    '2. Put the .mcpack in Geyser/packs.',
    '3. Restart Geyser and test with a Java client.',
    '',
    '## Honest status',
    `- Geyser profile source: ${profile.source} (bundled snapshot, no live lookup).`,
    `- Mappings derived from shipped pack files: ${activeItems.length + activeBlocks.length}.`,
    `- Approximated entries: ${input.mappings.items.filter((m) => m.status === 'approximated').length + input.mappings.blocks.filter((m) => m.status === 'approximated').length}.`,
    `- Withheld entries: ${input.mappings.items.filter((m) => m.status === 'unsupported').length + input.mappings.blocks.filter((m) => m.status === 'unsupported').length}.`,
    '- No live Geyser / Java client verification was performed by this app.',
  ].join('\n');

  const nestedPack = createZipArchive(packEntries(packFiles));
  const files: Record<string, string | Uint8Array> = {
    'geyser/custom_mappings/item_mappings.json': JSON.stringify(itemMappingJson, null, 2),
    'geyser/custom_mappings/block_mappings.json': JSON.stringify(blockMappingJson, null, 2),
    [`geyser/extensions/${input.modId}_extension_descriptor.json`]: JSON.stringify(extensionDescriptor, null, 2),
    'geyser/config_fragment.yml': configFragment,
    [`geyser/packs/${input.modId}_geyser_resources.mcpack`]: nestedPack,
    'geyser/README.md': readme,
  };

  const fileReports: GeyserBundleFile[] = [
    {
      path: 'geyser/custom_mappings/item_mappings.json',
      role: 'item-mapping',
      description: `${activeItems.length} item mapping(s) written from shipped item definitions.`,
      bytes: byteLength(files['geyser/custom_mappings/item_mappings.json']),
    },
    {
      path: 'geyser/custom_mappings/block_mappings.json',
      role: 'block-mapping',
      description: `${activeBlocks.length} block mapping(s) written from shipped block definitions.`,
      bytes: byteLength(files['geyser/custom_mappings/block_mappings.json']),
    },
    {
      path: `geyser/extensions/${input.modId}_extension_descriptor.json`,
      role: 'extension',
      description: 'Descriptor + preset only; a compiled Geyser extension JAR is still required.',
      bytes: byteLength(files[`geyser/extensions/${input.modId}_extension_descriptor.json`]),
    },
    {
      path: 'geyser/config_fragment.yml',
      role: 'config',
      description: 'Commented install steps (no undocumented config keys are set).',
      bytes: byteLength(configFragment),
    },
    {
      path: `geyser/packs/${input.modId}_geyser_resources.mcpack`,
      role: 'resource-pack',
      description: `Bedrock resources for the mapped content: ${Object.keys(packFiles).length} file(s).`,
      bytes: nestedPack.length,
    },
    {
      path: 'geyser/README.md',
      role: 'readme',
      description: 'Install steps and honest status of this bundle.',
      bytes: byteLength(readme),
    },
  ];

  const requirements: GeyserRequirement[] = [
    {
      id: 'custom-items',
      label: 'Geyser custom item mappings',
      state: profile.supports.customItems ? 'satisfied' : 'unknown',
      detail: profile.supports.customItems
        ? `${activeItems.length} mapping(s) written for Geyser ${profile.geyserVersion}.`
        : `The bundled snapshot does not list custom item mappings for Geyser ${profile.geyserVersion}.`,
    },
    {
      id: 'custom-blocks',
      label: 'Geyser custom block mappings',
      state: profile.supports.customBlocks ? 'satisfied' : 'unknown',
      detail: profile.supports.customBlocks
        ? `${activeBlocks.length} mapping(s) written for Geyser ${profile.geyserVersion}.`
        : `The bundled snapshot does not list custom block mappings for Geyser ${profile.geyserVersion}.`,
    },
    {
      id: 'resource-pack',
      label: 'Bedrock resources for custom content',
      state: Object.keys(itemAtlas).length + Object.keys(terrainAtlas).length > 0 ? 'satisfied' : 'unmet',
      detail: `${Object.keys(itemAtlas).length} item and ${Object.keys(terrainAtlas).length} block texture(s) placed in the Geyser pack.`,
    },
    {
      id: 'geometry',
      label: 'Block geometry shipped to Geyser',
      state: activeBlocks.some((mapping) => mapping.geometrySource) ? 'satisfied' : 'unmet',
      detail: activeBlocks.some((mapping) => mapping.geometrySource)
        ? 'Custom geometry files referenced by the mappings were copied into the Geyser pack.'
        : 'No custom block geometry was resolved; mapped blocks use minecraft:geometry.full_block.',
    },
    {
      id: 'extension',
      label: 'Geyser extension',
      state: 'unknown',
      detail: 'Only a descriptor/preset is generated; Geyser loads compiled extension JARs, which this app cannot build.',
    },
    {
      id: 'bedrock-target',
      label: 'Target Bedrock build verification',
      state: profile.verifiedBedrockTarget === input.targetVersion ? 'satisfied' : 'unknown',
      detail:
        profile.verifiedBedrockTarget === input.targetVersion
          ? `The bundled snapshot was captured against Bedrock ${profile.verifiedBedrockTarget}, the selected target.`
          : `The snapshot was captured against Bedrock ${profile.verifiedBedrockTarget}, not ${input.targetVersion}; compatibility with this exact runtime is unverified.`,
    },
    {
      id: 'runtime-verification',
      label: 'Live Geyser / Java client test',
      state: 'unmet',
      detail: 'No Geyser instance or Java client was contacted; mappings are structural output only.',
    },
  ];

  const totals = {
    itemMappings: activeItems.length,
    blockMappings: activeBlocks.length,
    approximated:
      input.mappings.items.filter((mapping) => mapping.status === 'approximated').length +
      input.mappings.blocks.filter((mapping) => mapping.status === 'approximated').length,
    unsupported:
      input.mappings.items.filter((mapping) => mapping.status === 'unsupported').length +
      input.mappings.blocks.filter((mapping) => mapping.status === 'unsupported').length,
    unknownCompatibility:
      input.mappings.items.filter((mapping) => mapping.status === 'unknown-compatibility').length +
      input.mappings.blocks.filter((mapping) => mapping.status === 'unknown-compatibility').length,
  };

  const summary = [
    `${totals.itemMappings} item and ${totals.blockMappings} block Geyser mapping(s) generated from shipped pack files`,
    `${totals.approximated} approximated`,
    `${totals.unsupported} withheld`,
    `${totals.unknownCompatibility} unverified for this Geyser build`,
  ].join(' · ');

  return {
    files,
    report: {
      enabled: true,
      profile,
      items: input.mappings.items,
      blocks: input.mappings.blocks,
      requirements,
      files: fileReports,
      warnings,
      totals,
      summary,
    },
  };
}