import assetsData from "@/config/assets";
import type { ExtractedZipEntry } from '@/utils/zip';

/**
 * Phase 9 — Regression fixtures.
 *
 * Each fixture is a miniature Java mod archive that exercises one conversion path. The
 * suite runs the real converters over these archives and compares the converted output
 * with the source evidence declared here, so a regression is measured instead of asserted.
 */

const encoder = new TextEncoder();
export function fixtureJson(path: string, value: unknown): ExtractedZipEntry {
  return {
    path,
    data: encoder.encode(JSON.stringify(value, null, 2))
  };
}
export function fixtureText(path: string, value: string): ExtractedZipEntry {
  return {
    path,
    data: encoder.encode(value)
  };
}
const pngCache = new Map<string, Uint8Array>();

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function writeUint32BE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = concatBytes([typeBytes, data]);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32BE(chunk, 8 + data.length, crc32(crcInput));
  return chunk;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) | a) >>> 0);
}

function deflateStored(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let offset = 0;
  while (offset < bytes.length) {
    const length = Math.min(65535, bytes.length - offset);
    const final = offset + length >= bytes.length;
    const inverse = (~length) & 0xffff;
    parts.push(new Uint8Array([
      final ? 1 : 0,
      length & 0xff,
      (length >>> 8) & 0xff,
      inverse & 0xff,
      (inverse >>> 8) & 0xff,
    ]));
    parts.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  const checksum = adler32(bytes);
  const trailer = new Uint8Array(4);
  writeUint32BE(trailer, 0, checksum);
  parts.push(trailer);
  return concatBytes(parts);
}

function encodeFixturePng(width: number, height: number, colour: string): Uint8Array {
  const match = /^#?([0-9a-f]{6})$/i.exec(colour.trim());
  const hex = match?.[1] ?? '808080';
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const rowBytes = width * 4 + 1;
  const raw = new Uint8Array(rowBytes * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset++] = 0; // PNG filter: None
    for (let x = 0; x < width; x += 1) {
      raw[offset++] = red;
      raw[offset++] = green;
      raw[offset++] = blue;
      raw[offset++] = 255;
    }
  }

  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return concatBytes([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateStored(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * Deterministic, fully valid PNG fixture. This is pure TypeScript and works in both
 * browsers and Node-based CI; it never depends on document, canvas, or browser codecs.
 */
export function fixturePng(path: string, width: number, height: number, color: string): ExtractedZipEntry {
  const key = `${width}x${height}:${color}`;
  let bytes = pngCache.get(key);
  if (!bytes) {
    bytes = encodeFixturePng(width, height, color);
    pngCache.set(key, bytes);
  }
  return { path, data: bytes };
}
export interface EntityModelExpectation {
  path: string;
  textureWidth: number;
  textureHeight: number;
  /** Minimum distinct bones the converted geometry must expose. */
  minBones?: number;
  /** Java skin reference the entity model declares. */
  skinRef?: string;
}
export interface FixtureExpectation {
  textures?: Array<{
    tail: string;
    width: number;
    height: number;
  }>;
  animatedTextures?: Array<{
    tail: string;
    frames: number;
    ticksPerFrame: number;
  }>;
  itemModels?: number;
  blockModels?: number;
  blockstateVariants?: number;
  blockstateMultipart?: number;
  elements?: number;
  entityModels?: EntityModelExpectation[];
  clips?: number;
  armorSheets?: number;
  recipes?: number;
  lootTables?: string[];
  tradeTables?: string[];
  triggers?: number;
  cooldownTicks?: number;
  parentEdges?: number;
  missingParents?: number;
  /** Item identifiers the source declares, used to build the loading-check bundle. */
  itemIds?: string[];
  /** GeckoLib conversion expectations, measured by running the real importer. */
  geckolib?: {
    clips: number;
    attributed: number;
    controllers: number;
  };
  notes?: string;
}
export interface RegressionFixture {
  id: string;
  label: string;
  category: string;
  build: () => ExtractedZipEntry[];
  expect: FixtureExpectation;
}
const element = (name: string, from: number[], to: number[], uv: number[]): Record<string, unknown> => ({
  name,
  from,
  to,
  faces: {
    north: {
      uv
    },
    south: {
      uv
    },
    east: {
      uv
    },
    west: {
      uv
    },
    up: {
      uv
    },
    down: {
      uv
    }
  }
});
export const REGRESSION_FIXTURES: RegressionFixture[] = [{
  id: 'simple-item-model',
  label: 'Simple Java item model',
  category: 'Items',
  notes: 'Generated parent chain (item/generated) with one layer texture.',
  build: () => [fixtureJson('assets/regress/models/item/gem_shard.json', {
    parent: 'item/generated',
    textures: {
      layer0: 'regress:item/gem_shard'
    }
  }), fixturePng(assetsData.IMAGE_ZYOY, 16, 16, '#7dd3fc'), fixtureText('assets/regress/lang/en_us.json', '{"item.regress.gem_shard":"Gem Shard"}')],
  expect: {
    textures: [{
      tail: 'item/gem_shard',
      width: 16,
      height: 16
    }],
    itemModels: 1,
    itemIds: ['gem_shard']
  }
}, {
  id: 'complex-item-model',
  label: 'Complex item model with overrides',
  category: 'Items',
  notes: 'Handheld parent, display transforms, uvlock, texture alias and a pulling override model.',
  build: () => [fixtureJson('assets/regress/models/item/rune_blade.json', {
    parent: 'item/handheld',
    textures: {
      layer0: 'regress:item/rune_blade',
      particle: '#layer0'
    },
    display: {
      thirdperson_righthand: {
        rotation: [0, -90, 25],
        translation: [1.13, 3.2, 1.13],
        scale: [0.68, 0.68, 0.68]
      },
      firstperson_righthand: {
        rotation: [0, -90, 25],
        translation: [1.13, 3.2, 1.13],
        scale: [0.68, 0.68, 0.68]
      }
    },
    uvlock: true,
    overrides: [{
      predicate: {
        pulling: 1
      },
      model: 'regress:item/rune_blade_pulling'
    }]
  }), fixtureJson('assets/regress/models/item/rune_blade_pulling.json', {
    parent: 'item/handheld',
    textures: {
      layer0: 'regress:item/rune_blade'
    },
    elements: [element('blade', [7, 0, 7], [9, 16, 9], [0, 0, 2, 16])]
  }), fixturePng(assetsData.IMAGE_BBRW, 16, 16, '#a855f7')],
  expect: {
    textures: [{
      tail: 'item/rune_blade',
      width: 16,
      height: 16
    }],
    itemModels: 2,
    elements: 1,
    parentEdges: 2,
    itemIds: ['rune_blade']
  }
}, {
  id: 'custom-block',
  label: 'Custom block with state variants',
  category: 'Blocks',
  notes: 'blockstates with lit=true/false variants sharing one cube_all parent.',
  build: () => [fixtureJson('assets/regress/blockstates/gem_lamp.json', {
    variants: {
      'lit=true': {
        model: 'regress:block/gem_lamp_on'
      },
      'lit=false': {
        model: 'regress:block/gem_lamp'
      }
    }
  }), fixtureJson('assets/regress/models/block/gem_lamp.json', {
    parent: 'block/cube_all',
    textures: {
      all: 'regress:block/gem_lamp'
    }
  }), fixtureJson('assets/regress/models/block/gem_lamp_on.json', {
    parent: 'block/cube_all',
    textures: {
      all: 'regress:block/gem_lamp_on'
    }
  }), fixturePng(assetsData.IMAGE_NYZS, 16, 16, '#facc15'), fixturePng(assetsData.IMAGE_PLFC, 16, 16, '#fde68a')],
  expect: {
    textures: [{
      tail: 'block/gem_lamp',
      width: 16,
      height: 16
    }, {
      tail: 'block/gem_lamp_on',
      width: 16,
      height: 16
    }],
    blockModels: 2,
    blockstateVariants: 2,
    parentEdges: 2
  }
}, {
  id: 'multipart-block',
  label: 'Multipart block model',
  category: 'Blocks',
  notes: 'multipart apply/when parts referencing two models.',
  build: () => [fixtureJson('assets/regress/blockstates/rune_gate.json', {
    multipart: [{
      apply: {
        model: 'regress:block/rune_gate_post'
      }
    }, {
      when: {
        north: 'true'
      },
      apply: {
        model: 'regress:block/rune_gate_side'
      }
    }, {
      when: {
        south: 'true'
      },
      apply: {
        model: 'regress:block/rune_gate_side'
      }
    }]
  }), fixtureJson('assets/regress/models/block/rune_gate_post.json', {
    parent: 'block/cube_all',
    textures: {
      all: 'regress:block/rune_gate'
    }
  }), fixtureJson('assets/regress/models/block/rune_gate_side.json', {
    parent: 'block/cube_all',
    textures: {
      all: 'regress:block/rune_gate'
    }
  }), fixturePng(assetsData.IMAGE_AMTV, 16, 16, '#0ea5e9')],
  expect: {
    textures: [{
      tail: 'block/rune_gate',
      width: 16,
      height: 16
    }],
    blockModels: 2,
    blockstateMultipart: 3
  }
}, {
  id: 'animated-texture',
  label: 'Animated texture with mcmeta timing',
  category: 'Textures',
  notes: 'Four-frame vertical strip with frametime 3 and interpolate.',
  build: () => [fixturePng(assetsData.IMAGE_QFUA, 16, 64, '#f97316'), fixtureJson('assets/regress/textures/block/forge_front.png.mcmeta', {
    animation: {
      frametime: 3,
      interpolate: true,
      frames: [0, 1, 2, 3]
    }
  }), fixtureJson('assets/regress/models/block/forge.json', {
    parent: 'block/cube_all',
    textures: {
      all: 'regress:block/forge_front'
    }
  })],
  expect: {
    textures: [{
      tail: 'block/forge_front',
      width: 16,
      height: 64
    }],
    animatedTextures: [{
      tail: 'block/forge_front',
      frames: 4,
      ticksPerFrame: 3
    }],
    blockModels: 1
  }
}, {
  id: 'custom-entity',
  label: 'Custom entity with a Java skin reference',
  category: 'Entities',
  notes: 'models/entity declares textures.0 so the skin binds by reference, not by file name.',
  build: () => [fixtureJson('assets/regress/models/entity/stone_sentinel.json', {
    textures: {
      0: 'regress:entity/stone_sentinel',
      particle: '#0'
    },
    elements: [element('head', [-4, 24, -4], [4, 32, 4], [0, 0, 8, 8]), element('body', [-6, 8, -3], [6, 24, 3], [16, 16, 28, 32]), element('leg0', [-5, 0, -2], [-1, 8, 2], [0, 16, 4, 24]), element('leg1', [1, 0, -2], [5, 8, 2], [8, 16, 12, 24])]
  }), fixturePng(assetsData.IMAGE_DYBX, 64, 64, '#94a3b8')],
  expect: {
    textures: [{
      tail: 'entity/stone_sentinel',
      width: 64,
      height: 64
    }],
    entityModels: [{
      path: 'assets/regress/models/entity/stone_sentinel.json',
      textureWidth: 64,
      textureHeight: 64,
      minBones: 2,
      skinRef: 'entity/stone_sentinel'
    }],
    elements: 4
  }
}, {
  id: 'complex-entity-geometry',
  label: 'Complex multi-part entity geometry',
  category: 'Entities',
  notes: 'Eight named parts that must survive as separate bones with a 128x128 sheet.',
  build: () => [fixtureJson('assets/regress/models/entity/iron_colossus.json', {
    textures: {
      0: 'regress:entity/iron_colossus'
    },
    elements: [element('head', [-6, 40, -6], [6, 52, 6], [0, 0, 12, 12]), element('body', [-10, 16, -6], [10, 40, 6], [20, 16, 40, 40]), element('left_arm', [-14, 16, -4], [-10, 38, 4], [40, 16, 48, 38]), element('right_arm', [10, 16, -4], [14, 38, 4], [48, 16, 56, 38]), element('left_leg', [-8, 0, -4], [-2, 16, 4], [0, 40, 6, 56]), element('right_leg', [2, 0, -4], [8, 16, 4], [8, 40, 14, 56]), element('cape', [-8, 24, 6], [8, 40, 8], [56, 16, 72, 32]), element('crest', [-2, 52, -2], [2, 56, 2], [16, 0, 20, 4])]
  }), fixturePng(assetsData.IMAGE_COPN, 128, 128, '#64748b')],
  expect: {
    textures: [{
      tail: 'entity/iron_colossus',
      width: 128,
      height: 128
    }],
    entityModels: [{
      path: 'assets/regress/models/entity/iron_colossus.json',
      textureWidth: 128,
      textureHeight: 128,
      minBones: 4
    }],
    elements: 8
  }
}, {
  id: 'animated-entity',
  label: 'Animated entity clip binding',
  category: 'Animations',
  notes: 'Entity model plus a Bedrock-shaped animation whose bone tracks must resolve.',
  build: () => [fixtureJson('assets/regress/models/entity/hover_mite.json', {
    textures: {
      0: 'regress:entity/hover_mite'
    },
    elements: [element('head', [-3, 6, -3], [3, 12, 3], [0, 0, 6, 6]), element('body', [-4, 2, -4], [4, 6, 4], [12, 0, 20, 4]), element('leg0', [-4, 0, -3], [-2, 2, -1], [0, 6, 2, 8]), element('leg1', [2, 0, 1], [4, 2, 3], [2, 6, 4, 8])]
  }), fixtureJson('assets/regress/animations/hover_mite.animation.json', {
    format_version: '1.8.0',
    animations: {
      'animation.hover_mite.idle': {
        loop: true,
        animation_length: 1.5,
        bones: {
          head: {
            rotation: ['math.sin(query.anim_time * 90) * 4', 0, 0]
          },
          body: {
            position: [0, 'math.sin(query.anim_time * 90) * 0.5', 0]
          }
        }
      }
    }
  }), fixturePng(assetsData.IMAGE_HUGP, 32, 32, '#22d3ee')],
  expect: {
    entityModels: [{
      path: 'assets/regress/models/entity/hover_mite.json',
      textureWidth: 32,
      textureHeight: 32,
      minBones: 2
    }],
    clips: 1,
    elements: 4
  }
}, {
  id: 'custom-armor',
  label: 'Custom armour sheets',
  category: 'Equipment',
  notes: 'Two Java armour layers that must map to Bedrock armour slots.',
  build: () => [fixturePng(assetsData.IMAGE_FQNQ, 64, 32, '#334155'), fixturePng(assetsData.IMAGE_KLMF, 64, 32, '#475569'), fixtureJson('assets/regress/models/item/warden_helmet.json', {
    parent: 'item/generated',
    textures: {
      layer0: 'regress:item/warden_helmet'
    }
  }), fixturePng(assetsData.IMAGE_GZRP, 16, 16, '#1e293b')],
  expect: {
    armorSheets: 2,
    itemModels: 1,
    textures: [{
      tail: 'item/warden_helmet',
      width: 16,
      height: 16
    }],
    itemIds: ['warden_helmet']
  }
}, {
  id: 'custom-weapons',
  label: 'Custom weapon behaviour evidence',
  category: 'Behaviour',
  notes: 'Java class declares a cooldown and effect logic; evidence must be recovered, not invented.',
  build: () => [fixtureJson('assets/regress/models/item/rune_spear.json', {
    parent: 'item/handheld',
    textures: {
      layer0: 'regress:item/rune_spear'
    }
  }), fixturePng(assetsData.IMAGE_YYPJ, 16, 16, '#f43f5e'), fixtureText('assets/regress/com/regress/RuneSpearItem.java', ['public class RuneSpearItem extends SwordItem {', '  public int getUseDuration(ItemStack stack) { return cooldown 40; }', '  public InteractionResultHolder use(Level level, Player player, InteractionHand hand) {', '    player.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SPEED, 120, 1));', '    return InteractionResultHolder.success(player.getItemInHand(hand));', '  }', '}'].join('\n'))],
  expect: {
    textures: [{
      tail: 'item/rune_spear',
      width: 16,
      height: 16
    }],
    itemModels: 1,
    cooldownTicks: 40,
    triggers: 1,
    itemIds: ['rune_spear']
  }
}, {
  id: 'custom-recipes',
  label: 'Custom crafting recipes',
  category: 'Recipes',
  notes: 'Shaped, shapeless and an unsupported smelting recipe in one archive.',
  build: () => [fixtureJson('data/regress/recipes/rune_blade.json', {
    type: 'minecraft:crafting_shaped',
    pattern: [' R ', ' R ', ' S '],
    key: {
      R: {
        item: 'regress:rune_ingot'
      },
      S: {
        item: 'minecraft:stick'
      }
    },
    result: {
      item: 'regress:rune_blade',
      count: 1
    }
  }), fixtureJson('data/regress/recipes/rune_dust.json', {
    type: 'minecraft:crafting_shapeless',
    ingredients: [{
      item: 'regress:rune_ore'
    }],
    result: {
      item: 'regress:rune_dust',
      count: 2
    }
  }), fixtureJson('data/regress/recipes/rune_smelt.json', {
    type: 'minecraft:smelting',
    ingredient: {
      item: 'regress:rune_ore'
    },
    result: 'regress:rune_ingot'
  })],
  expect: {
    recipes: 2
  }
}, {
  id: 'villager-trades',
  label: 'Villager trade table',
  category: 'Behaviour',
  notes: 'Java trade document must convert to a Bedrock economy table.',
  build: () => [fixtureJson('data/regress/trades/archivist.json', {
    trades: [{
      wants: [{
        item: 'minecraft:emerald',
        quantity: 2
      }],
      gives: [{
        item: 'regress:rune_ingot',
        quantity: 1
      }]
    }, {
      wants: [{
        item: 'regress:rune_dust',
        quantity: 4
      }],
      gives: [{
        item: 'minecraft:emerald',
        quantity: 1
      }],
      max_uses: 12
    }]
  })],
  expect: {
    tradeTables: ['data/regress/trades/archivist.json']
  }
}, {
  id: 'custom-ai',
  label: 'Custom AI entity class',
  category: 'Behaviour',
  notes: 'Hurt, death and target-selection handlers must be detected from source text.',
  build: () => [fixtureText('assets/regress/com/regress/SentinelEntity.java', ['public class SentinelEntity extends Monster {', '  protected void registerGoals() {', '    this.goalSelector.addGoal(1, new MeleeAttackGoal(this, 1.2D, true));', '    this.targetSelector.addGoal(2, new HurtByTargetGoal(this));', '  }', '  public boolean hurt(DamageSource source, float amount) { return super.hurt(source, amount); }', '  protected void dropCustomDeathLoot(DamageSource source, int looting, boolean hit) { }', '  public void die(DamageSource source) { super.die(source); }', '  protected void setAttackTarget(LivingEntity entity) { super.setAttackTarget(entity); }', '}'].join('\n'))],
  expect: {
    triggers: 3
  }
}, {
  id: 'multi-mod-dependencies',
  label: 'Multi-mod dependency chain',
  category: 'Dependencies',
  notes: 'One parent resolves inside the archive, one belongs to another mod and must report missing.',
  build: () => [fixtureJson('assets/regress/models/item/pipe.json', {
    parent: 'regress:block/pipe_top',
    textures: {
      all: 'regress:block/pipe'
    }
  }), fixtureJson('assets/regress/models/block/pipe_top.json', {
    parent: 'othermod:block/pipe_base',
    textures: {
      all: 'regress:block/pipe'
    }
  }), fixturePng(assetsData.IMAGE_OUDO, 16, 16, '#64748b')],
  expect: {
    itemModels: 1,
    blockModels: 1,
    parentEdges: 2,
    missingParents: 1,
    textures: [{
      tail: 'block/pipe',
      width: 16,
      height: 16
    }]
  }
}, {
  id: 'loot-tables',
  label: 'Entity loot table',
  category: 'Behaviour',
  notes: 'Supported and unsupported loot functions must be separated, never dropped silently.',
  build: () => [fixtureJson('data/regress/loot_tables/entities/stone_sentinel.json', {
    pools: [{
      rolls: {
        min: 1,
        max: 2
      },
      entries: [{
        type: 'minecraft:item',
        name: 'regress:rune_dust',
        weight: 3,
        functions: [{
          function: 'minecraft:set_count',
          count: 2
        }, {
          function: 'minecraft:set_nbt',
          tag: '{rune:1}'
        }]
      }]
    }]
  })],
  expect: {
    lootTables: ['data/regress/loot_tables/entities/stone_sentinel.json']
  }
}, {
  id: 'precision-uv-mapping',
  label: 'Precision UV mapping (mirrored, wrapped, pixel-space)',
  category: 'Geometry',
  notes: 'Mirrored, negative-anchor and past-the-edge UV rectangles must keep their exact source region instead of being clamped; the sheet must come from the pixel space the UVs are authored in.',
  build: () => [fixtureJson('assets/regress/models/block/uv_relay.json', {
    textures: {
      all: 'regress:block/uv_relay'
    },
    elements: [{
      name: 'relay',
      from: [2, 0, 2],
      to: [14, 12, 14],
      faces: {
        north: {
          uv: [-8, 0, 8, 16]
        },
        south: {
          uv: [16, 0, 0, 16]
        },
        east: {
          uv: [4, 4, 68, 60]
        },
        west: {
          uv: [0, 0, 16, 16]
        },
        up: {
          uv: [48, 0, 64, 16]
        },
        down: {
          uv: [0, 48, 16, 64]
        }
      }
    }]
  }), fixturePng(assetsData.IMAGE_WAUV, 64, 64, '#22d3ee')],
  expect: {
    textures: [{
      tail: 'block/uv_relay',
      width: 64,
      height: 64
    }],
    blockModels: 1,
    elements: 1
  }
}, {
  id: 'geckolib-clip-import',
  label: 'GeckoLib clip import + controller synthesis',
  category: 'Animations',
  notes: 'One shared GeckoLib container holds clips for two entities: attribution must come from the clip ids, and every generated controller may only reference clips that shipped.',
  build: () => [fixtureJson('assets/regress/geo/ember_wisp.geo.json', {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: {
        identifier: 'geometry.ember_wisp',
        texture_width: 32,
        texture_height: 32
      },
      bones: [{
        name: 'head',
        cubes: []
      }, {
        name: 'body',
        cubes: []
      }]
    }]
  }), fixtureJson('assets/regress/animations/all_animations.json', {
    format_version: '1.8.0',
    animations: {
      'animation.ember_wisp.idle': {
        loop: true,
        animation_length: 2,
        bones: {
          head: {
            rotation: {
              '0.0': [0, 0, 0],
              '1.0': [0, 20, 0]
            }
          },
          body: {
            position: {
              '0.0': [0, 0, 0],
              '1.0': [0, 'math.sin(query.anim_time * 90) * 0.5', 0]
            }
          }
        }
      },
      'animation.ember_wisp.walk': {
        loop: true,
        animation_length: 1,
        bones: {
          body: {
            rotation: {
              '0.0': [0, 0, 0],
              '0.5': [0, 15, 0]
            }
          }
        }
      },
      'animation.ember_wisp.attack': {
        animation_length: 0.6,
        bones: {
          head: {
            rotation: {
              '0.0': [0, 0, 0],
              '0.3': [10, 0, 0]
            }
          }
        }
      },
      'animation.ash_hound.idle': {
        loop: true,
        animation_length: 2,
        bones: {
          head: {
            rotation: {
              '0.0': [0, 0, 0],
              '1.0': [0, 10, 0]
            }
          }
        }
      }
    }
  }), fixturePng(assetsData.IMAGE_HUGP, 32, 32, '#f97316')],
  expect: {
    geckolib: {
      clips: 4,
      attributed: 4,
      controllers: 2
    },
    textures: [{
      tail: 'entity/hover_mite',
      width: 32,
      height: 32
    }]
  }
}];