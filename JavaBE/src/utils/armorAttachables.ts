import type { AssetIndex } from '@/utils/assetIndex';
import type { RemakeItem } from '@/types/remaker';
import { resolveEquipmentAttachments, type EquipmentSlot } from '@/utils/equipmentAttachments';
import type { PackFile } from '@/utils/entityTextureVariants';

/**
 * Armour rendering compatibility.
 *
 * A Java armour sheet (`textures/models/armor/<material>_layer_1.png`) only renders on a
 * Bedrock player/mob when the wearable item has an attachable bound to its identifier
 * plus the layer sheet shipped at the same path. Without both, custom armour is invisible
 * even though the item, its slot and its durability are correct.
 */

const ARMOR_SHEET = /(?:^|\/)textures\/models\/armor\/([a-z0-9_.\-]+)\.png$/;

const SLOT_GEOMETRY: Record<EquipmentSlot, string> = {
  'slot.armor.head': 'geometry.humanoid.armor.helmet',
  'slot.armor.chest': 'geometry.humanoid.armor.chestplate',
  'slot.armor.legs': 'geometry.humanoid.armor.leggings',
  'slot.armor.feet': 'geometry.humanoid.armor.boots',
};

/** Java layer 1 carries helmet/chest/boots art, layer 2 carries leggings. */
const SLOT_LAYER: Record<EquipmentSlot, 1 | 2> = {
  'slot.armor.head': 1,
  'slot.armor.chest': 1,
  'slot.armor.legs': 2,
  'slot.armor.feet': 1,
};

const SLOT_PATTERNS: Array<[EquipmentSlot, RegExp]> = [
  ['slot.armor.head', /helm|helmet|cap|hood|crown|mask|visor|coif|hat/],
  ['slot.armor.chest', /chest|plate|tunic|robe|cuirass|breastplate|body|jacket/],
  ['slot.armor.legs', /leggings|greaves|greave|pants|trouser|skirt|legs/],
  ['slot.armor.feet', /boots|boot|shoes|shoe|sabaton|feet/],
];

function slotOf(item: RemakeItem): EquipmentSlot | null {
  if (item.slot === 'head') return 'slot.armor.head';
  if (item.slot === 'chest') return 'slot.armor.chest';
  if (item.slot === 'legs') return 'slot.armor.legs';
  if (item.slot === 'feet') return 'slot.armor.feet';
  const id = item.id.toLowerCase();
  for (const [slot, pattern] of SLOT_PATTERNS) if (pattern.test(id)) return slot;
  return null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export interface ArmorAttachableResult {
  attachables: number;
  armorSheets: number;
  skipped: string[];
}

export function shipArmorAttachables(options: {
  modId: string;
  items: RemakeItem[];
  assetIndex: AssetIndex | null;
  resourcePackFiles: Record<string, PackFile>;
  onLog?: (line: string) => void;
}): ArmorAttachableResult {
  const { modId, items, assetIndex, resourcePackFiles: files } = options;
  const log = (line: string) => options.onLog?.(line);
  const skipped: string[] = [];
  let armorSheets = 0;

  // 1. Ship every armour layer sheet at the path Bedrock's armor renderer reads.
  if (assetIndex) {
    for (const texture of assetIndex.textures) {
      const match = ARMOR_SHEET.exec(texture.path.replace(/\\/g, '/'));
      if (!match) continue;
      const destination = `textures/models/armor/${match[1]}.png`;
      if (files[destination]) continue;
      files[destination] = texture.data;
      armorSheets += 1;
    }
  }
  if (armorSheets > 0) {
    log(`[ARMOR] Shipped ${armorSheets} authentic Java armour layer sheet(s) at textures/models/armor/.`);
  }

  // 2. Bind one attachable per wearable item to a layer sheet that really shipped.
  const report = resolveEquipmentAttachments(assetIndex);
  const materials = report.materials;
  let attachables = 0;

  for (const item of items) {
    const slot = slotOf(item);
    if (!slot) continue;
    // A slot is only trusted when the mod classified the item as wearable, otherwise a
    // bottle "cap" would be bound to a helmet attachable.
    if (item.category !== 'armor' && !item.slot) continue;
    const attachablePath = `attachables/${item.id}.attachable.json`;
    if (files[attachablePath]) {
      skipped.push(`${item.id}: a 3-D item attachable already ships for this identifier`);
      continue;
    }
    const layer = SLOT_LAYER[slot];
    const itemKey = normalize(item.id);
    const material =
      materials.find((name) => itemKey.includes(normalize(name))) ??
      (materials.length === 1 ? materials[0] : null);
    if (!material) {
      skipped.push(
        `${item.id}: no armour sheet material could be matched (${materials.length} sheet material(s) detected)`,
      );
      continue;
    }
    const layerPath = `textures/models/armor/${material}_layer_${layer}`;
    if (!files[`${layerPath}.png`]) {
      skipped.push(`${item.id}: armour layer sheet ${layerPath}.png is not in the pack`);
      continue;
    }
    files[attachablePath] = JSON.stringify(
      {
        format_version: '1.10.0',
        'minecraft:attachable': {
          description: {
            identifier: `${modId}:${item.id}`,
            materials: { default: 'armor', enchanted: 'armor_enchanted' },
            textures: {
              default: layerPath,
              enchanted: 'textures/misc/enchanted_item_glint',
            },
            geometry: { default: SLOT_GEOMETRY[slot] },
            render_controllers: ['controller.render.armor'],
          },
        },
      },
      null,
      2,
    );
    attachables += 1;
    log(
      `[ARMOR] "${item.id}" -> attachable bound to ${layerPath}.png on ${slot} (${SLOT_GEOMETRY[slot]}).`,
    );
  }

  for (const reason of skipped.slice(0, 4)) log(`[ARMOR:WARN] ${reason}`);

  return { attachables, armorSheets, skipped };
}