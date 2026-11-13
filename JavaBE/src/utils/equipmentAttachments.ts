import type { AssetIndex } from '@/utils/assetIndex';

/**
 * Equipment attachment mapping.
 *
 * Java armour lives in `textures/models/armor/<material>_layer_1.png` (helmet, chest,
 * boots) and `_layer_2.png` (leggings). Bedrock renders the same sheet through
 * attachables bound to a slot, so the slot is derived from the sheet's own layer and
 * material name — never from a per-mod table.
 */

export type EquipmentSlot = 'slot.armor.head' | 'slot.armor.chest' | 'slot.armor.legs' | 'slot.armor.feet';

export interface EquipmentAttachment {
  material: string;
  slot: EquipmentSlot;
  layer: 1 | 2;
  sourceTexture: string;
  /** Bones an attachable for this slot should render on. */
  attachmentBones: string[];
  evidence: string;
}

export interface EquipmentAttachmentReport {
  materials: string[];
  attachments: EquipmentAttachment[];
  armorSheets: number;
  skipped: string[];
}

export interface AttachmentAnchors {
  head: string | null;
  chest: string | null;
  legs: string | null;
  feet: string | null;
  mainhand: string | null;
  offhand: string | null;
}

const SLOT_BONES: Record<EquipmentSlot, string[]> = {
  'slot.armor.head': ['head', 'hat'],
  'slot.armor.chest': ['body', 'left_arm', 'right_arm'],
  'slot.armor.legs': ['body', 'left_leg', 'right_leg'],
  'slot.armor.feet': ['left_leg', 'right_leg'],
};

const ARMOR_DIR = /(?:^|\/)textures\/models\/armor\//;

function materialOf(stem: string): string {
  return (
    stem
      .replace(/(?:^|_)layer_?\d+/g, '')
      .replace(/(?:^|_)(?:overlay|outer|inner|emissive|glow|old)(?:_|$)/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || ''
  );
}

/** Slots a Java armour layer sheet feeds, restricted further by material keywords. */
function slotsFor(material: string, layer: 1 | 2): EquipmentSlot[] {
  const keywords: Array<[EquipmentSlot, RegExp]> = [
    ['slot.armor.head', /helm|helmet|cap|hood|crown|mask|visor|coif/],
    ['slot.armor.chest', /chest|plate|tunic|robe|cuirass|breast|body|jacket/],
    ['slot.armor.legs', /leg|pant|greave|skirt|trouser/],
    ['slot.armor.feet', /boot|shoe|feet|foot|sabaton/],
  ];
  const named = keywords.filter(([, pattern]) => pattern.test(material)).map(([slot]) => slot);
  if (named.length > 0) return named;
  return layer === 2
    ? ['slot.armor.legs']
    : ['slot.armor.head', 'slot.armor.chest', 'slot.armor.feet'];
}

/**
 * Maps every Java armour sheet in the archive to its Bedrock armour slots. Sheets that
 * cannot be read as armour are listed as skipped rather than invented.
 */
export function resolveEquipmentAttachments(index: AssetIndex | null | undefined): EquipmentAttachmentReport {
  const attachments: EquipmentAttachment[] = [];
  const materials = new Set<string>();
  const skipped: string[] = [];
  if (!index) return { materials: [], attachments, armorSheets: 0, skipped };

  let armorSheets = 0;
  for (const texture of index.textures) {
    const path = texture.path.replace(/\\/g, '/');
    if (!ARMOR_DIR.test(path)) continue;
    armorSheets++;
    const material = materialOf(texture.stem);
    if (!material) {
      skipped.push(`${path} -> no material name in the file name`);
      continue;
    }
    const layerMatch = /layer_?(\d+)/.exec(texture.stem);
    const layer: 1 | 2 = layerMatch && Number(layerMatch[1]) === 2 ? 2 : 1;
    materials.add(material);
    for (const slot of slotsFor(material, layer)) {
      attachments.push({
        material,
        slot,
        layer,
        sourceTexture: path,
        attachmentBones: SLOT_BONES[slot],
        evidence: `Java armour layer ${layer} sheet (${texture.width}x${texture.height}) at ${texture.tail || texture.stem}`,
      });
    }
  }

  return { materials: [...materials], attachments, armorSheets, skipped };
}

/**
 * Finds where equipment can hang on a recovered skeleton: the attachable bone names an
 * entity model exposes for head/chest/legs/feet gear and held items.
 */
export function findAttachmentAnchors(boneNames: string[] = []): AttachmentAnchors {
  const pick = (...patterns: RegExp[]): string | null =>
    boneNames.find((name) => patterns.some((pattern) => pattern.test(name.toLowerCase()))) ?? null;
  const anyLeg = pick(/leg|thigh|foot|feet/);
  return {
    head: pick(/^head$|head|skull/),
    chest: pick(/body|torso|chest|spine/),
    legs: anyLeg,
    feet: pick(/foot|feet|boot|leg/),
    mainhand: pick(/right_arm|rightarm|arm_r|hand_r|right_hand|weapon|tool/),
    offhand: pick(/left_arm|leftarm|arm_l|hand_l|left_hand|shield|offhand/),
  };
}

/** Reads the attachment anchors straight out of a shipped geometry document. */
export function findAttachmentAnchorsFromGeometry(geometryJson: string): AttachmentAnchors {
  const empty: AttachmentAnchors = {
    head: null,
    chest: null,
    legs: null,
    feet: null,
    mainhand: null,
    offhand: null,
  };
  if (!geometryJson) return empty;
  try {
    const parsed = JSON.parse(geometryJson) as {
      'minecraft:geometry'?: Array<{ bones?: Array<{ name?: string }> }>;
    };
    const bones = parsed['minecraft:geometry']?.[0]?.bones ?? [];
    return findAttachmentAnchors(bones.map((bone) => String(bone.name ?? '')).filter(Boolean));
  } catch {
    return empty;
  }
}