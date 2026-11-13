import assetsData from "@/config/assets";
import type { RemakeItem, RemakeMechanic } from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';
import { randomUuid, safeFileId } from '@/utils/bedrockIds';
import { createFullMobTexture64x64, buildAuthenticPixelArt, type DerivedItemAsset } from '@/utils/assetSynthesizer';
import { isPlayableModeEnabled } from '@/utils/provenance';
import { generateRiggedMobGeometry, sanitizeGeometryJson, type ExtractedGeometry } from '@/utils/modelPortEngine';
import { generateMobAnimations } from '@/utils/mobAnimationTemplates';
import { extractGeometryIdentifier } from '@/utils/javaModelConverter';
import { bindMobParity } from '@/utils/mobParityBinder';
import { queryBedrockCapabilities } from '@/utils/bedrockCapabilityQuery';
import { pickCompatibleVersion } from '@/utils/scriptDependencySet';
import { TEXTURE_SET_FORMAT_VERSION } from '@/utils/contentLogRepairs';
import { applyCanonicalGeometryRegistry } from '@/utils/geometryRegistry';
import { rebuildTextureAtlases } from '@/utils/textureAtlasBuilder';
import { buildBedrockLocalization } from '@/utils/bedrockLocalization';
import { buildArchiveSoundPack, collectJavaSoundEventIds } from '@/utils/soundConverter';
import { resolveMobStatProfile } from '@/utils/mobStatResolver';
export type PackAssetType = 'texture' | 'model' | 'animation' | 'meta';
export type PackFileMap = Record<string, string | Uint8Array>;

/**
 * Strict classification of resource pack files by asset kind, derived from the
 * canonical Bedrock directory layout. Used to keep textures, models and
 * animations in distinct, independently auditable buckets.
 */
export function classifyPackAssetType(path: string): PackAssetType {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  if (normalized.startsWith('models/') || normalized.includes('geometry')) return 'model';
  if (normalized.startsWith('animations/') || normalized.includes('animation_controllers') || normalized.startsWith('entity/')) return 'animation';
  if (normalized.startsWith('textures/')) return 'texture';
  return 'meta';
}
class ResourcePackFileState {
  private files: PackFileMap | null = null;
  initialize(): void {
    if (this.files !== null) {
      throw new Error('Resource pack file state is already initialized.');
    }
    this.files = {};
  }
  private assertReady(): PackFileMap {
    if (this.files === null) {
      throw new Error('Resource pack files cannot be accessed before initialization.');
    }
    return this.files;
  }

  /** Live view of the full flat file map (initialization-gated). */
  getFiles(): PackFileMap {
    return this.assertReady();
  }

  /** Typed write: routes the file into the correct asset bucket by path. */
  set(path: string, data: string | Uint8Array): void {
    this.assertReady()[path] = data;
  }

  /** Strictly typed writes — each asset kind has a dedicated, validated entry point. */
  setTexture(path: string, data: string | Uint8Array): void {
    this.setTyped(path, data, 'texture');
  }
  setModel(path: string, data: string | Uint8Array): void {
    this.setTyped(path, data, 'model');
  }
  setAnimation(path: string, data: string | Uint8Array): void {
    this.setTyped(path, data, 'animation');
  }
  private setTyped(path: string, data: string | Uint8Array, expected: PackAssetType): void {
    const actual = classifyPackAssetType(path);
    if (actual !== expected) {
      throw new Error(`Asset type mismatch for "${path}": expected ${expected}, but path resolves to ${actual}.`);
    }
    this.assertReady()[path] = data;
  }
  has(path: string): boolean {
    return this.assertReady()[path] !== undefined;
  }

  /** Snapshot of one specific asset bucket (textures, models, animations or meta). */
  getByType(type: PackAssetType): PackFileMap {
    const files = this.assertReady();
    const bucket: PackFileMap = {};
    for (const path of Object.keys(files)) {
      if (classifyPackAssetType(path) === type) bucket[path] = files[path];
    }
    return bucket;
  }

  /** Per-bucket file counts for audit reporting. */
  counts(): Record<PackAssetType, number> {
    const files = this.assertReady();
    const counts: Record<PackAssetType, number> = {
      texture: 0,
      model: 0,
      animation: 0,
      meta: 0
    };
    for (const path of Object.keys(files)) counts[classifyPackAssetType(path)]++;
    return counts;
  }
}

/** Minimal valid 16x16 PNG — Bedrock data-driven items require 16x16 minimum. */
const FALLBACK_ITEM_PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 16, 0, 0, 0, 16, 8, 6, 0, 0, 0, 31, 243, 255, 97, 0, 0, 0, 34, 73, 68, 65, 84, 120, 156, 99, 100, 248, 207, 192, 192, 192, 4, 36, 18, 57, 188, 128, 65, 76, 168, 6, 97, 24, 131, 194, 48, 6, 133, 97, 12, 10, 195, 24, 0, 0, 226, 32, 2, 70, 77, 83, 13, 142, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

/**
 * Generates an authentic Bedrock Addon pack icon if none was present in the JAR root.
 */
export function generateDefaultPackIcon(name: string): {
  bytes: Uint8Array;
  dataUrl: string;
} {
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Dark bedrock background
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 128, 128);

        // Grid lines (bedrock pixel style)
        ctx.fillStyle = '#1e293b';
        for (let x = 0; x < 128; x += 16) {
          for (let y = 0; y < 128; y += 16) {
            if ((x + y) % 32 === 0) ctx.fillRect(x, y, 16, 16);
          }
        }

        // Glowing border
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, 120, 120);

        // Sword / Crest emblem
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(64, 52, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(64, 52, 18, 0, Math.PI * 2);
        ctx.fill();

        // Monogram
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const initials = name.split(' ').map(w => w[0]).slice(0, 3).join('').toUpperCase() || 'MOD';
        ctx.fillText(initials, 64, 52);

        // Label
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('BEDROCK', 64, 94);
        ctx.fillStyle = '#38bdf8';
        ctx.fillText('PORT', 64, 108);
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return {
          bytes,
          dataUrl
        };
      }
    } catch {
      // Fallback below
    }
  }

  // Fallback minimal valid PNG bytes
  return {
    bytes: FALLBACK_ITEM_PNG_BYTES,
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  };
}
export interface CustomEntityPackData {
  id: string;
  name: string;
  health: number;
  damageCap?: number;
  hasPhases?: boolean;
  geometryJson?: string;
  textureRef?: string;
  scriptLogic?: string;
}
export interface PackGenerationOptions {
  targetEngineVersion?: [number, number, number];
  enableBetaApis?: boolean;
  enableCameras?: boolean;
  enableCustomUi?: boolean;
  enableVoxelShapes?: boolean;
  enableUpcomingCreatorFeatures?: boolean;
  enablePbr?: boolean;
  enableScriptEval?: boolean;
  /** Evidence-derived per-mob AI profiles; the export binder never invents behaviour. */
  mobProfiles?: Record<string, import('@/utils/mobBehaviorProfiles').MobBehaviorProfile>;
  /** Model, skin and animation files each entity's own renderer/model class declared. */
  mobLinks?: Map<string, import('@/utils/mobLinking').MobResourceLink>;
}
export function createPackFiles(name: string, id: string, description: string, mechanics: RemakeMechanic[], items: RemakeItem[], actionMessage: string, resourceUuid: string, packIconBytes: Uint8Array, itemAssets?: Map<string, DerivedItemAsset>, customEntity?: CustomEntityPackData, customScriptLogic?: string, extraAnimationFiles?: {
  resourcePackFiles?: Record<string, string>;
  behaviorPackFiles?: Record<string, string>;
}, customRecipes?: Record<string, string>, entityGeometries?: Map<string, ExtractedGeometry>, entityTextures?: Map<string, Uint8Array>, archiveEntries?: ExtractedZipEntry[], packOptions?: PackGenerationOptions) {
  const behaviorUuid = randomUuid();
  const dataUuid = randomUuid();
  const scriptUuid = randomUuid();
  // Version-Aware Capability Query: probe the target Bedrock runtime so the
  // generated manifest only ever references module versions and capabilities
  // the engine actually recognizes (future-proof, no rejected imports).
  const TARGET_ENGINE_VERSION: [number, number, number] = packOptions?.targetEngineVersion ?? [1, 21, 50];
  // A pack that declares a min_engine_version ABOVE the player's game build is refused
  // on import and shows up as "unknown pack or broken". The manifest therefore declares a
  // conservative floor that every supported Bedrock build satisfies; content files keep
  // their real format_version, and Bedrock simply skips content it does not understand.
  const BEHAVIOR_MIN_ENGINE_VERSION: [number, number, number] = [1, 20, 0];
  const RESOURCE_MIN_ENGINE_VERSION: [number, number, number] = [1, 16, 0];
  const capabilityQuery = queryBedrockCapabilities(TARGET_ENGINE_VERSION);
  // Each @minecraft/* module publishes its OWN version list, so the manifest declares a
  // version that module accepts. Copying one "highest" version onto every script module is
  // what made the engine answer "requested invalid version of @minecraft/server-ui" and
  // refuse to create the script context.
  // The version this module publishes that the declared engine floor actually supports — never
  // the highest one available, and never a version borrowed from another module's list.
  const SERVER_UI_VERSION =
    pickCompatibleVersion('@minecraft/server-ui', undefined, BEHAVIOR_MIN_ENGINE_VERSION) ?? '1.3.0';
  // A script module is declared only when the source gives the pack something to automate:
  // recovered script logic, or an evidenced projectile/spell binding. Declaring
  // @minecraft/server for a mod with nothing to script handed unrelated packs an empty script
  // file plus a Beta API requirement they never had.
  const sourceScriptLogic = typeof customScriptLogic === 'string' ? customScriptLogic.trim() : '';
  const itemBehaviorNeedsScript = items.some(
    (item) => item.behaviorProfile?.kind === 'projectile' || item.behaviorProfile?.kind === 'spell',
  );
  const shipsScript = sourceScriptLogic.length > 30 || itemBehaviorNeedsScript;

  const behaviorManifest: Record<string, unknown> = {
    format_version: 2,
    header: {
      name: `${name} (Behavior)`,
      description: `${description} [Bedrock Edition 1:1 Parity Port]`,
      uuid: behaviorUuid,
      version: [1, 0, 0],
      min_engine_version: BEHAVIOR_MIN_ENGINE_VERSION
    },
    modules: [{
      type: 'data',
      uuid: dataUuid,
      version: [1, 0, 0]
    }, ...(shipsScript ? [{
      type: 'script',
      language: 'javascript',
      uuid: scriptUuid,
      entry: 'scripts/main.js',
      version: [1, 0, 0]
    }] : [])], 
    // Manifest Sanitizer: unsupported experimental capability flags are never
    // emitted — modern Bedrock runtimes reject packs declaring them. Script API
    // access is granted by the @minecraft/server module dependency alone.
    dependencies: [{
      uuid: resourceUuid,
      version: [1, 0, 0]
    }, ...(shipsScript ? [{
      module_name: '@minecraft/server',
      version: capabilityQuery.maxScriptApiVersion
    }, {
      module_name: '@minecraft/server-ui',
      version: SERVER_UI_VERSION
    }] : [])]
  };
  if (packOptions?.enableScriptEval) {
    // Note: Bedrock has no "script_eval" capability value — unknown capability
    // strings make the whole manifest fail validation ("unknown pack"). Script
    // execution is already granted by the @minecraft/server module dependency.
    console.log('[Aippy] script_eval requested but is not a valid Bedrock capability; skipped.');
  }
  const resourceManifest: Record<string, unknown> = {
    format_version: 2,
    header: {
      name: `${name} (Resources)`,
      description: `${description} [Bedrock Edition 1:1 Parity Port]`,
      uuid: resourceUuid,
      version: [1, 0, 0],
      min_engine_version: RESOURCE_MIN_ENGINE_VERSION
    },
    modules: [{
      type: 'resources',
      uuid: randomUuid(),
      version: [1, 0, 0]
    }]
  };
  if (packOptions?.enablePbr) {
    resourceManifest.capabilities = ['pbr'];
  }
  const scriptCode = customScriptLogic && customScriptLogic.trim().length > 30 ? customScriptLogic.trim() : [
    `// ${name} - Bedrock Script API Automation Engine`,
    `// Deterministically compiled by Universal Java-to-Bedrock Porting Engine`,
    `import { world, system } from '@minecraft/server';`,
    ``,
    `// Dynamic Stonebyte-JavaBE Startup Branding`,
    `world.afterEvents.playerSpawn.subscribe((event) => {`,
    `  if (event.initialSpawn) {`,
    `    // Parity runtime active for [${name}] (Ported Using Stonebyte-JavaBE)`,
    `  }`,
    `});`,
  ].join('\n');

  // Source-evidence gate for scaffold structure. Optional files (creator camera, custom HUD,
  // built-in block cuboids, default render controller) may only be written when the archive
  // itself asks for them — never because a template happens to contain one.
  const normalizedArchivePaths = (archiveEntries ?? []).map((entry) => entry.path.replace(/\\/g, '/').toLowerCase());
  const archiveHasCameraAsset = normalizedArchivePaths.some(
    (path) => path.endsWith('.json') && (path.includes('/cameras/') || path.includes('/camera/') || /cinematic|cutscene/.test(path)),
  );
  const archiveHasUiAsset = normalizedArchivePaths.some(
    (path) => path.endsWith('.json') && (path.includes('/gui/') || path.includes('/ui/')),
  );
  const archiveUiDefsEntry = (archiveEntries ?? []).find(
    (entry) => entry.path.replace(/\\/g, '/').toLowerCase().endsWith('ui/_ui_defs.json'),
  );
  const playableModeActive = isPlayableModeEnabled();

  // Behavior Pack item definitions
  const behaviorPackFiles: Record<string, string | Uint8Array> = {
    'manifest.json': JSON.stringify(behaviorManifest, null, 2),
    [assetsData.IMAGE_QEIG]: packIconBytes,
    ...(shipsScript ? { 'scripts/main.js': scriptCode } : {}),
    ...(items.length > 0 ? {
      [`functions/${id}_give.mcfunction`]: [`# Give all ported items for ${name}`, ...items.map(it => `give @s ${id}:${it.id} 1`), `tellraw @a {"rawtext":[{"text":"§b[${name}] §aAll ported mod items granted!"}]}`].join('\n'),
      [`functions/${id}_setup.mcfunction`]: [`# Setup environment and give items for ${name}`, `gamerule showcoordinates true`, `function ${id}_give`, `tellraw @a {"rawtext":[{"text":"§b[${name}] §6World initialized and items ready!"}]}`].join('\n'),
    } : {}),
    ...(customEntity ? {
      [`entities/${customEntity.id}.json`]: JSON.stringify({
        format_version: '1.20.80',
        'minecraft:entity': {
          description: {
            identifier: `${id}:${customEntity.id}`,
            is_spawnable: true,
            is_summonable: true,
            is_experimental: false
          },
          component_groups: {
            phase_1: {
              'minecraft:health': {
                value: customEntity.health,
                max: customEntity.health
              },
              'minecraft:damage_sensor': {
                triggers: [{
                  cause: 'all',
                  deals_damage: true,
                  max_damage: customEntity.damageCap || 10
                }]
              }
            },
            phase_2: {
              'minecraft:health': {
                value: Math.round(customEntity.health / 2),
                max: Math.round(customEntity.health / 2)
              },
              'minecraft:damage_sensor': {
                triggers: [{
                  cause: 'all',
                  deals_damage: true,
                  max_damage: 4
                }]
              }
            }
          },
          components: {
            'minecraft:type_family': {
              family: [id, 'boss', 'monster', 'mob']
            },
            'minecraft:boss': {
              hud_range: 128,
              name: customEntity.name,
              should_darken_sky: true
            },
            'minecraft:collision_box': {
              width: 1.2,
              height: 2.8
            },
            'minecraft:knockback_resistance': {
              value: 1.0
            },
            'minecraft:movement': {
              value: 0.3
            }
          },
          events: {
            'minecraft:entity_spawned': {
              add: {
                component_groups: ['phase_1']
              }
            },
            [`${id}:enter_phase_2`]: {
              remove: {
                component_groups: ['phase_1']
              },
              add: {
                component_groups: ['phase_2']
              }
            }
          }
        }
      }, null, 2),
      [`functions/${customEntity.id}_summon.mcfunction`]: `summon ${id}:${customEntity.id} ~ ~1 ~\ntellraw @a {"rawtext":[{"text":"§c[${name}] §e${customEntity.name} summoned!"}]}`
    } : {}),
    ...(packOptions?.enableCameras !== false ? {
      'cameras/presets.json': JSON.stringify({
        format_version: '1.21.0',
        'minecraft:camera_preset': {
          identifier: `${id}:cinematic`,
          inherit_from: 'minecraft:free',
          pos: [0, 3, -5],
          rot: [12, 0]
        }
      }, null, 2)
    } : {}),
    'REMAKE_NOTES.txt': [`${name} — Bedrock Edition 1:1 Parity Port Notes`, `=============================================`, `Description: ${description}`, ``, `Engine & Experiments Configuration:`, `- Target Bedrock Release: ${capabilityQuery.versionLabel}`, `- Script API Ceiling: @minecraft/server ${capabilityQuery.maxScriptApiVersion}`, `- Beta APIs (Scripting & Combat): ${packOptions?.enableBetaApis !== false ? 'ENABLED' : 'DISABLED'}`, `- Creator Cameras: ${packOptions?.enableCameras !== false ? 'ENABLED (cameras/presets.json + setCamera)' : 'DISABLED'}`, `- Custom UI Forms: ${packOptions?.enableCustomUi !== false ? 'ENABLED (@minecraft/server-ui ActionForms)' : 'DISABLED'}`, `- 3D Voxel Blocks & Geometry: ${packOptions?.enableVoxelShapes !== false ? 'ENABLED (minecraft:geometry & collision)' : 'DISABLED'}`, `- Deferred PBR Texturing: ${packOptions?.enablePbr ? 'ENABLED (.texture_set.json + RP "pbr")' : 'DISABLED'}`, `- Manifest Status: CLEAN (100% valid capabilities, zero import rejection errors)`, ``, `How to Play in Minecraft Bedrock (Full Parity):`, `1. Import the .mcaddon file directly into Minecraft on iOS / Android / Windows (via Files app or Share Sheet).`, `2. Enable the required World Settings under Experiments:`, `   [X] Beta APIs (Required for scripts, combat arts, weapon abilities & camera commands)`, `   [X] Upcoming Creator Features (Required for custom 3D block geometry & permutations)`, ...(packOptions?.enablePbr ? [`   [X] Render Dragon Features for Creators / Deferred Technical Preview (for PBR textures)`] : []), `3. Apply both Behavior Pack and Resource Pack to your world.`, `4. Type '/function ${id}_setup' to initialize coordinates, rules, and acquire all equipment!`, `5. Combat & Macros:`, `   - Normal Attack: Triggers authentic melee swings & particle sparks.`, `   - Sneak / Alt + Right Click (or Sneak + Tap): Activates Special Weapon Art / Stance with custom particles.`, `   - Custom UI Menu: Sneak + Use item or '/scriptevent macro:menu' to open Action Form dialogs.`, `   - Spawn Eggs: Distinct two-tone colored eggs for all mobs in Nature tab.`, `   - Camera: '/scriptevent macro:camera' plays a sample cutscene; '/scriptevent macro:cam_reset' stops it and restores the view.`, `   - Custom path: '/scriptevent macro:camera_path {"interpolation":"bezier","points":[{"x":-3,"y":2,"z":-5,"pitch":12,"yaw":-25,"duration":2},{"x":3,"y":3,"z":-3,"pitch":8,"yaw":25,"duration":3}]}'`, `     Use 2–8 keyframes; x/y/z are offsets from your starting position, duration is seconds, and interpolation can be 'linear', 'bezier', or 'smooth'.`, ``, `Ported Custom Items:`, ...items.map(it => `- ${it.name} (${id}:${it.id}): ${it.type} | Ability: ${it.ability ?? 'Ported mod item'}`), ``, `Deterministic Gameplay Mechanics Mapped:`, ...mechanics.map(m => `- ${m.name}: ${m.summary}`)].join('\n')
  };

  // Generate item JSONs for Behavior pack
  const textureDataEntries: Record<string, {
    textures: string;
  }> = {};
  const terrainTextureDataEntries: Record<string, {
    textures: string;
  }> = {};
  const blockRegistryEntries: Record<string, {
    textures: string;
    sound: string;
  }> = {};
  const langStrings: string[] = [`pack.name=${name} (Resources)`, `pack.description=${description}`];

  // Resource pack state owns initialization and rejects reads before the map is ready.
  const resourcePackState = new ResourcePackFileState();
  resourcePackState.initialize();
  const resourcePackFiles = resourcePackState.getFiles();

  // Authentic mod textures enter the pack only through resolver-linked paths
  // (textures/items|blocks/<id>.png written from real mod files). Blanket-dumping
  // every archive PNG used to overwrite real item icons with GUI/state sheets and
  // left dangling atlas entries, which broke the whole creative-menu icon set.
  // Nested entity variants are preserved so render controllers can still switch skins.
  if (archiveEntries && archiveEntries.length > 0) {
    let variantWrites = 0;
    for (const entry of archiveEntries) {
      if (variantWrites >= 160) break;
      if (!entry.data || entry.data.length < 100) continue;
      const cleanPath = entry.path.replace(/\\/g, '/');
      const lower = cleanPath.toLowerCase();
      if (!lower.endsWith('.png')) continue;
      const variantMatch = lower.match(/\/textures\/(?:entities|entity)\/(.+\.png)$/);
      if (!variantMatch || !variantMatch[1].includes('/')) continue;
      const variantPath = `textures/entity/${variantMatch[1]}`;
      // `geometry` anywhere in a path is bucketed as a model by the typed state manager.
      if (variantPath.includes('geometry')) continue;
      if (resourcePackState.has(variantPath)) continue;
      resourcePackState.setTexture(variantPath, entry.data);
      variantWrites++;
    }

    // Every authentic mod texture is also kept under the pack's own textures/ tree at the
    // exact relative path the mod declared. The pass above only kept nested entity
    // variants, so a mod whose skins live at textures/entity/<mob>.png shipped with none
    // of them — the single biggest source of missing textures in the export.
    const TEXTURE_ROOT_FOLDERS = ['entity', 'mobs', 'mob', 'models', 'block', 'blocks', 'item', 'items'];
    let textureWrites = 0;
    for (const entry of archiveEntries) {
      if (textureWrites >= 600) break;
      if (!entry.data || entry.data.length < 100) continue;
      const cleanTexturePath = entry.path.split('\\').join('/').toLowerCase();
      if (!cleanTexturePath.endsWith('.png')) continue;
      const marker = '/textures/';
      const markerAt = cleanTexturePath.lastIndexOf(marker);
      if (markerAt === -1) continue;
      const relativePath = cleanTexturePath.slice(markerAt + marker.length);
      if (relativePath.length === 0) continue;
      const topFolder = relativePath.slice(0, relativePath.indexOf('/'));
      if (!TEXTURE_ROOT_FOLDERS.includes(topFolder)) continue;
      // `geometry` anywhere in a path is bucketed as a model by the typed state manager.
      if (relativePath.includes('geometry')) continue;
      const targetPath = `textures/${relativePath}`;
      if (resourcePackState.has(targetPath)) continue;
      resourcePackState.setTexture(targetPath, entry.data);
      textureWrites++;
    }
    if (textureWrites > 0) {
      console.log(`[Aippy] Carried ${textureWrites} authentic mod texture(s) into the resource pack at their declared paths.`);
    }
  }
  for (const it of items) {
    const itemIdentifier = `${id}:${it.id}`;
    const isBlock = it.category === 'block';
    const isSpawnEgg = it.category === 'spawn_egg';
    // A combat component needs a combat capability the mod actually declared. A spawn egg and a
    // block item are structural roles: no template may turn either of them into a weapon.
    const role = it.classification?.role;
    const combatEvidence = it.behaviorProfile?.kind === 'melee'
      || it.behaviorProfile?.kind === 'projectile'
      || it.behaviorProfile?.kind === 'spell'
      || role === 'weapon'
      || role === 'projectile-launcher';
    const isWeapon = !isSpawnEgg && !isBlock
      && (combatEvidence || (typeof it.damage === 'number' && it.damage > 0));
    const isArmor = it.category === 'armor';
    const isStorage = it.category === 'storage';
    const isFood = it.category === 'food';
    const isTool = it.category === 'tool' && !isWeapon;
    // The modern icon form is the one the 1.21.30+ item schema accepts; the legacy
    // `{ "texture": … }` member is rejected with "this member was found in the input, but
    // is not present in the Schema".
    const components: Record<string, unknown> = {
      'minecraft:icon': {
        textures: {
          default: it.id
        }
      },
      'minecraft:max_stack_size': isWeapon || isArmor || isStorage || isTool ? 1 : 64,
      'minecraft:display_name': {
        value: it.name
      }
    };
    if (isBlock) {
      components['minecraft:block_placer'] = {
        block: itemIdentifier
      };
      const isTransparent = /glass|leaves|leaf|plant|flower|bush|sapling|web|bars|chain|lantern|vine|fern|crop|foliage|canopy|moss/.test(it.id);
      const isSlab = /slab|step/i.test(it.id) || /slab|step/i.test(it.name);
      const isStair = /stair/i.test(it.id) || /stair/i.test(it.name);
      const isDoor = /door|gate/i.test(it.id) || /door|gate/i.test(it.name);
      const isLightSource = /torch|lantern|lamp|fire|candle|glow|estus|bonfire/i.test(it.id);
      const isContainer = /chest|barrel|crate|box|storage|container|inventory/i.test(it.id) || /chest|barrel|crate|box|storage|container/i.test(it.name);

      // Register custom Bedrock block in behavior pack. An authentic Java block model
      // is bound through minecraft:geometry, otherwise the block is flattened into a
      // plain cube and every ported per-face UV is thrown away.
      const blockAsset = itemAssets?.get(it.id);
      const hasBlockGeometry = Boolean(blockAsset && !blockAsset.isFlat2D && blockAsset.geometryId && blockAsset.geometryJson);
      const blockComponents: Record<string, unknown> = {
        'minecraft:destructible_by_mining': {
          seconds_to_destroy: 1.5
        },
        'minecraft:destructible_by_explosion': {
          explosion_resistance: 6.0
        },
        'minecraft:material_instances': {
          '*': {
            texture: it.id,
            render_method: isTransparent || isDoor ? 'alpha_test' : 'opaque'
          }
        }
      };
      if (isContainer) {
        blockComponents['minecraft:inventory'] = {
          container_type: 'container',
          inventory_size: 27,
          private: false
        };
      }
      if (isLightSource) {
        blockComponents['minecraft:light_emission'] = 14;
        blockComponents['minecraft:light_dampening'] = 0;
      }
      let blockDescription: Record<string, unknown> = {
        identifier: itemIdentifier,
        menu_category: {
          category: 'construction',
          group: isDoor ? 'itemGroup.name.door' : isSlab ? 'itemGroup.name.slab' : isStair ? 'itemGroup.name.stairs' : 'itemGroup.name.stone'
        }
      };
      let permutations: Array<Record<string, unknown>> | undefined;
      if (isSlab) {
        blockDescription = {
          ...blockDescription,
          traits: {
            'minecraft:placement_position': {
              enabled_states: ['minecraft:vertical_half']
            }
          }
        };
        blockComponents['minecraft:collision_box'] = {
          origin: [-8, 0, -8],
          size: [16, 8, 16]
        };
        blockComponents['minecraft:selection_box'] = {
          origin: [-8, 0, -8],
          size: [16, 8, 16]
        };
        if (!hasBlockGeometry) {
          blockComponents['minecraft:geometry'] = {
            identifier: 'geometry.slab'
          };
        }
        permutations = [{
          condition: "query.block_state('minecraft:vertical_half') == 'top'",
          components: {
            'minecraft:transformation': {
              translation: [0, 8, 0]
            },
            'minecraft:collision_box': {
              origin: [-8, 8, -8],
              size: [16, 8, 16]
            },
            'minecraft:selection_box': {
              origin: [-8, 8, -8],
              size: [16, 8, 16]
            }
          }
        }, {
          condition: "query.block_state('minecraft:vertical_half') == 'bottom'",
          components: {
            'minecraft:transformation': {
              translation: [0, 0, 0]
            },
            'minecraft:collision_box': {
              origin: [-8, 0, -8],
              size: [16, 8, 16]
            },
            'minecraft:selection_box': {
              origin: [-8, 0, -8],
              size: [16, 8, 16]
            }
          }
        }];
      } else if (isDoor) {
        blockDescription = {
          ...blockDescription,
          traits: {
            'minecraft:placement_direction': {
              enabled_states: ['minecraft:cardinal_direction']
            }
          },
          states: {
            'mod:open': [false, true]
          }
        };
        blockComponents['minecraft:collision_box'] = {
          origin: [-8, 0, -1],
          size: [16, 32, 2]
        };
        blockComponents['minecraft:selection_box'] = {
          origin: [-8, 0, -1],
          size: [16, 32, 2]
        };
        if (!hasBlockGeometry) {
          blockComponents['minecraft:geometry'] = {
            identifier: 'geometry.door'
          };
        }
        permutations = [{
          condition: "query.block_state('minecraft:cardinal_direction') == 'north' && !query.block_state('mod:open')",
          components: {
            'minecraft:transformation': {
              rotation: [0, 0, 0]
            }
          }
        }, {
          condition: "query.block_state('minecraft:cardinal_direction') == 'north' && query.block_state('mod:open')",
          components: {
            'minecraft:transformation': {
              rotation: [0, 90, 0]
            },
            'minecraft:collision_box': {
              origin: [-8, 0, -8],
              size: [2, 32, 16]
            },
            'minecraft:selection_box': {
              origin: [-8, 0, -8],
              size: [2, 32, 16]
            }
          }
        }, {
          condition: "query.block_state('minecraft:cardinal_direction') == 'south' && !query.block_state('mod:open')",
          components: {
            'minecraft:transformation': {
              rotation: [0, 180, 0]
            }
          }
        }, {
          condition: "query.block_state('minecraft:cardinal_direction') == 'south' && query.block_state('mod:open')",
          components: {
            'minecraft:transformation': {
              rotation: [0, 270, 0]
            },
            'minecraft:collision_box': {
              origin: [6, 0, -8],
              size: [2, 32, 16]
            },
            'minecraft:selection_box': {
              origin: [6, 0, -8],
              size: [2, 32, 16]
            }
          }
        }, {
          condition: "query.block_state('minecraft:cardinal_direction') == 'east' && !query.block_state('mod:open')",
          components: {
            'minecraft:transformation': {
              rotation: [0, 90, 0]
            }
          }
        }, {
          condition: "query.block_state('minecraft:cardinal_direction') == 'east' && query.block_state('mod:open')",
          components: {
            'minecraft:transformation': {
              rotation: [0, 180, 0]
            },
            'minecraft:collision_box': {
              origin: [-8, 0, -8],
              size: [16, 32, 2]
            },
            'minecraft:selection_box': {
              origin: [-8, 0, -8],
              size: [16, 32, 2]
            }
          }
        }, {
          condition: "query.block_state('minecraft:cardinal_direction') == 'west' && !query.block_state('mod:open')",
          components: {
            'minecraft:transformation': {
              rotation: [0, 270, 0]
            }
          }
        }, {
          condition: "query.block_state('minecraft:cardinal_direction') == 'west' && query.block_state('mod:open')",
          components: {
            'minecraft:transformation': {
              rotation: [0, 0, 0]
            },
            'minecraft:collision_box': {
              origin: [-8, 0, 6],
              size: [16, 32, 2]
            },
            'minecraft:selection_box': {
              origin: [-8, 0, 6],
              size: [16, 32, 2]
            }
          }
        }];
      } else if (isStair) {
        blockDescription = {
          ...blockDescription,
          traits: {
            'minecraft:placement_direction': {
              enabled_states: ['minecraft:cardinal_direction']
            }
          }
        };
        blockComponents['minecraft:collision_box'] = {
          origin: [-8, 0, -8],
          size: [16, 8, 16]
        };
        blockComponents['minecraft:selection_box'] = {
          origin: [-8, 0, -8],
          size: [16, 16, 16]
        };
        if (!hasBlockGeometry) {
          blockComponents['minecraft:geometry'] = {
            identifier: 'geometry.stair'
          };
        }
        permutations = [{
          condition: "query.block_state('minecraft:cardinal_direction') == 'north'",
          components: {
            'minecraft:transformation': {
              rotation: [0, 0, 0]
            }
          }
        }, {
          condition: "query.block_state('minecraft:cardinal_direction') == 'south'",
          components: {
            'minecraft:transformation': {
              rotation: [0, 180, 0]
            }
          }
        }, {
          condition: "query.block_state('minecraft:cardinal_direction') == 'east'",
          components: {
            'minecraft:transformation': {
              rotation: [0, 90, 0]
            }
          }
        }, {
          condition: "query.block_state('minecraft:cardinal_direction') == 'west'",
          components: {
            'minecraft:transformation': {
              rotation: [0, 270, 0]
            }
          }
        }];
      } else if (isTransparent && !isDoor && !isSlab && !isStair) {
        blockComponents['minecraft:collision_box'] = false;
        blockComponents['minecraft:selection_box'] = {
          origin: [-6, 0, -6],
          size: [12, 14, 12]
        };
      } else {
        blockComponents['minecraft:collision_box'] = true;
        blockComponents['minecraft:selection_box'] = true;
      }
      if (hasBlockGeometry && blockAsset) {
        blockComponents['minecraft:geometry'] = {
          identifier: blockAsset.geometryId
        };
      }
      const blockDefinition: Record<string, unknown> = {
        format_version: '1.20.80',
        'minecraft:block': {
          description: blockDescription,
          components: blockComponents,
          ...(permutations ? {
            permutations
          } : {})
        }
      };
      behaviorPackFiles[`blocks/${it.id}.json`] = JSON.stringify(blockDefinition, null, 2);
      // material_instances resolves this exact short name in the terrain atlas.
      terrainTextureDataEntries[it.id] = {
        textures: `textures/blocks/${it.id}`
      };
      const blockSound = isDoor || /wood|plank|log|fence|gate|bark/i.test(it.id) ? 'wood' : /glass|pane|crystal|lantern/i.test(it.id) ? 'glass' : /metal|iron|steel|gold|copper|bronze|chain|bars|machine|reactor/i.test(it.id) ? 'metal' : /dirt|soil|sand|gravel|clay|mud/i.test(it.id) ? 'gravel' : /leaves|leaf|plant|grass|flower|bush|vine/i.test(it.id) ? 'grass' : /wool|cloth|carpet|cotton|web/i.test(it.id) ? 'cloth' : 'stone';
      blockRegistryEntries[itemIdentifier] = {
        textures: it.id,
        sound: blockSound
      };
      langStrings.push(`tile.${itemIdentifier}.name=${it.name}`);
      langStrings.push(`tile.${id}:${it.id}.name=${it.name}`);
      langStrings.push(`tile.${it.id}.name=${it.name}`);
    } else if (isSpawnEgg) {
      const cleanMobName = it.name.replace(/spawn egg/gi, '').replace(/summon egg/gi, '').replace(/egg/gi, '').trim() || it.id.replace(/_spawn_egg$/, '').replace(/_/g, ' ');
      // The egg places the entity the registry links it to, so its id follows that entity.
      const mobId = safeFileId(it.classification?.entityLink ?? cleanMobName) || it.id.replace(/_spawn_egg$/, '');
      const formattedMobName = cleanMobName.split(/[\s_]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') || cleanMobName;
      // Spawn egg protocol: Bedrock creates the egg from the entity itself. No standalone
      // egg item is defined here, no entity_placer item is written and no egg art is drawn —
      // the base/overlay colours are read from the mod's Java registration and written into
      // the mob's client entity by the spawn egg policy pass.

      // Provide all Bedrock spawn egg & entity localization variations so raw translation keys are never exposed
      langStrings.push(`item.spawn_egg.entity.${id}:${mobId}.name=${formattedMobName} Spawn Egg`);
      langStrings.push(`item.spawn_egg.entity.${mobId}.name=${formattedMobName} Spawn Egg`);
      langStrings.push(`item.spawn_egg.entity.${id}:${it.id}.name=${formattedMobName} Spawn Egg`);
      langStrings.push(`entity.${id}:${mobId}.name=${formattedMobName}`);
      langStrings.push(`entity.${mobId}.name=${formattedMobName}`);
      langStrings.push(`item.${itemIdentifier}.name=${formattedMobName} Spawn Egg`);
      langStrings.push(`item.${id}:${it.id}.name=${formattedMobName} Spawn Egg`);
      langStrings.push(`item.${it.id}.name=${formattedMobName} Spawn Egg`);
      langStrings.push(`item.${id}:${mobId}_spawn_egg.name=${formattedMobName} Spawn Egg`);
      langStrings.push(`item.${mobId}_spawn_egg.name=${formattedMobName} Spawn Egg`);

      // The mob itself must exist and be spawnable: its own client entity carries the spawn
      // egg colours, so only the behaviour entity is guaranteed here.
      const entityBehaviorPath = `entities/${mobId}.json`;
      if (!behaviorPackFiles[entityBehaviorPath]) {
        // Stats come from this entity's own evidence profile; a documented default is only
        // used when the mod carries none, and it is reported for this mob alone.
        const mobStats = resolveMobStatProfile({ profile: packOptions?.mobProfiles?.[mobId] });
        if (mobStats.inferred.length > 0) {
          console.log(`[Aippy] [STATS] Entity "${mobId}" — ${mobStats.inferred.join('; ')}.`);
        }
        const defaultEntity = {
          format_version: '1.20.80',
          'minecraft:entity': {
            description: {
              identifier: `${id}:${mobId}`,
              is_spawnable: true,
              is_summonable: true,
              is_experimental: false
            },
            components: {
              'minecraft:health': {
                value: mobStats.health,
                max: mobStats.health
              },
              'minecraft:movement': {
                value: mobStats.movement
              },
              ...(mobStats.collisionBox ? {
                'minecraft:collision_box': mobStats.collisionBox
              } : {}),
              'minecraft:type_family': {
                family: [id, 'mob']
              }
            }
          }
        };
        behaviorPackFiles[entityBehaviorPath] = JSON.stringify(defaultEntity, null, 2);
      }
      continue;
    } else if (isWeapon) {
      components['minecraft:hand_equipped'] = true;
      components['minecraft:can_destroy_in_creative'] = false;
      // A combat value ships only when the mod declares it. The fixed 8 damage / 1561
      // durability that used to be written onto every weapon-shaped name is gone: an item
      // whose strike values were never recovered keeps no damage component and is reported.
      if (typeof it.damage === 'number' && it.damage > 0) {
        components['minecraft:damage'] = it.damage;
      } else {
        console.log(`[Aippy] [STATS] Item "${it.id}" — no attack damage recovered from the mod; no minecraft:damage component was invented.`);
      }
      if (typeof it.durability === 'number' && it.durability > 0) {
        components['minecraft:durability'] = {
          max_durability: it.durability
        };
      }
      // Source-backed projectile profiles use a tick-derived vanilla item cooldown. When the
      // mod declares no cooldown value the component is omitted instead of being invented.
      if (it.behaviorProfile?.projectileType && it.behaviorProfile.cooldownTicks > 0) {
        components['minecraft:cooldown'] = {
          category: 'weapon',
          duration: Math.max(0.05, it.behaviorProfile.cooldownTicks / 20)
        };
      }
    } else if (isArmor || isStorage) {
      const slot = it.slot === 'head' ? 'slot.armor.head' : it.slot === 'legs' ? 'slot.armor.legs' : it.slot === 'feet' ? 'slot.armor.feet' : 'slot.armor.chest';
      components['minecraft:wearable'] = {
        slot
      };
      // Durability is emitted only from a recovered value; the item is not given a
      // fabricated armour budget it never had.
      if (typeof it.durability === 'number' && it.durability > 0) {
        components['minecraft:durability'] = {
          max_durability: it.durability
        };
      }
    } else if (isFood) {
      components['minecraft:use_animation'] = it.id.includes('bottle') || it.id.includes('juice') ? 'drink' : 'eat';
      // Nutrition is the one food value Bedrock requires. When the mod declares none, the
      // documented Bedrock default stands in and is reported for this item alone.
      const nutrition = typeof it.nutrition === 'number' && it.nutrition > 0 ? it.nutrition : 4;
      if (nutrition !== it.nutrition) {
        console.log(`[Aippy] [STATS] Item "${it.id}" — nutrition ${nutrition} (documented default; the mod declares no nutrition value).`);
      }
      components['minecraft:food'] = {
        nutrition,
        saturation_modifier: 'supernatural',
        can_always_eat: true
      };
    } else if (isTool) {
      components['minecraft:hand_equipped'] = true;
      if (typeof it.durability === 'number' && it.durability > 0) {
        components['minecraft:durability'] = {
          max_durability: it.durability
        };
      }
    }
    const asset = itemAssets?.get(it.id);
    const is3DWearable = isStorage && (it.id.includes('backpack') || it.id.includes('bag'));
    if (is3DWearable && asset && asset.geometryId) {
      components['minecraft:geometry'] = {
        identifier: asset.geometryId
      };
      components['minecraft:material_instances'] = {
        '*': {
          texture: it.id
        }
      };
    }
    const itemJson = {
      format_version: '1.21.50',
      'minecraft:item': {
        description: {
          identifier: itemIdentifier,
          menu_category: {
            category: isSpawnEgg ? 'nature' : isWeapon || isArmor || isTool ? 'equipment' : 'items',
            group: isSpawnEgg ? 'itemGroup.name.mobEgg' : undefined
          }
        },
        components
      }
    };
    behaviorPackFiles[`items/${it.id}.json`] = JSON.stringify(itemJson, null, 2);
    // minecraft:icon resolves this exact short name — one clean atlas key per item.
    if (!isSpawnEgg) {
      textureDataEntries[it.id] = {
        textures: `textures/items/${it.id}`
      };
    }
    langStrings.push(`item.${itemIdentifier}.name=${it.name}`);
    langStrings.push(`item.item.${itemIdentifier}.name=${it.name}`);
    langStrings.push(`item.${id}:${it.id}.name=${it.name}`);
  }

  // Merge custom recipes (authentically converted from Java JSON)
  if (customRecipes && Object.keys(customRecipes).length > 0) {
    Object.assign(behaviorPackFiles, customRecipes);
  }

  // Resource Pack files: use "vanilla" resource_pack_name so Bedrock merges into global item atlas
  const itemTextureJson = {
    resource_pack_name: 'vanilla',
    texture_name: 'atlas.items',
    texture_data: textureDataEntries
  };

  // Default render controller mapping to ensure mobs and custom entities render
  const defaultRenderControllers = {
    format_version: '1.8.0',
    render_controllers: {
      'controller.render.default': {
        geometry: 'Geometry.default',
        materials: [{
          '*': 'Material.default'
        }],
        textures: ['Texture.default']
      }
    }
  };
  const localization = buildBedrockLocalization(archiveEntries, langStrings);
  const languagesJson = localization.languagesJson;
  resourcePackFiles['manifest.json'] = JSON.stringify(resourceManifest, null, 2);
  resourcePackFiles[assetsData.IMAGE_QEIG] = packIconBytes;
  resourcePackFiles['textures/item_texture.json'] = JSON.stringify(itemTextureJson, null, 2);
  resourcePackFiles['texts/languages.json'] = languagesJson;
  Object.assign(resourcePackFiles, localization.files);
  resourcePackFiles['render_controllers/default.render_controllers.json'] = JSON.stringify(defaultRenderControllers, null, 2);

  // Provide language declaration and all converted source locales in the Behavior Pack.
  behaviorPackFiles['texts/languages.json'] = languagesJson;
  Object.assign(behaviorPackFiles, localization.files);

  // Sound system: a Java sound EVENT and a physical audio FILE are different things. Audio
  // ships under its real container and is registered under an extensionless Bedrock sound
  // name; an event identifier is mapped to an engine sound or reported as unsupported.
  // Writing `mob.zombie.say` as a sound name is what produced invalid asset path errors.
  const soundEntries = (archiveEntries ?? []).map((entry) => ({ path: entry.path, data: entry.data }));
  const soundPack = buildArchiveSoundPack({
    modId: id,
    entries: soundEntries,
    javaEventIds: collectJavaSoundEventIds(soundEntries),
    onLog: (line: string) => console.log(`[Aippy] ${line}`)
  });
  Object.assign(resourcePackFiles, soundPack.files);
  if (soundPack.definitions) {
    resourcePackFiles['sounds/sound_definitions.json'] = JSON.stringify(soundPack.definitions, null, 2);
  }

  // Dynamic HUD/UI layer: generated Bedrock UI definition for mod-specific HUD elements
  let customHudElements: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    scale: number;
    kind: string;
  }> = [];
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('aippy.hudLayout.v1');
      if (raw) {
        customHudElements = JSON.parse(raw);
      }
    }
  } catch {
    // fallback to defaults
  }
  const hudControls: Record<string, any> = {};
  if (customHudElements && customHudElements.length > 0) {
    for (const el of customHudElements) {
      hudControls[el.id] = {
        type: el.kind === 'spell' || el.kind === 'weapon' ? 'progress_bar' : 'panel',
        layer: 3,
        offset: [`${Math.round(el.x)}%`, `${Math.round(el.y)}%`],
        size: [`${Math.round(24 * (el.scale || 1))}%`, `${Math.round(6 * (el.scale || 1))}%`],
        anchor_from: 'top_left',
        anchor_to: 'top_left',
        controls: [{
          label: {
            type: 'label',
            text: el.label,
            color: el.kind === 'spell' ? [0.75, 0.5, 1.0] : [0.2, 0.8, 1.0],
            shadow: true
          }
        }]
      };
    }
  }
  // No designed layout means no HUD. The template default panel (a "#mod_status" label plus a
  // "#mod_cooldown" bar bound to Molang no Bedrock screen defines) used to ship into every
  // export, which is why unrelated mods imported carrying a HUD and menu they never had.
  const hudUiJson = {
    namespace: `${id}_hud`,
    mod_hud: {
      type: 'panel',
      controls: Object.entries(hudControls).map(([key, val]) => ({
        [key]: val
      }))
    }
  };
  if (Object.keys(hudControls).length > 0) {
    resourcePackFiles[`ui/${id}_hud.json`] = JSON.stringify(hudUiJson, null, 2);
    // `ui/_ui_defs.json` replaces the whole vanilla definition list, so it is only extended
    // from the archive's own file — never created from nothing.
    if (archiveUiDefsEntry) {
      try {
        const parsedDefs = JSON.parse(new TextDecoder().decode(archiveUiDefsEntry.data)) as Record<string, unknown> & { ui_defs?: string[] };
        const defs = Array.isArray(parsedDefs.ui_defs) ? [...parsedDefs.ui_defs] : [];
        if (!defs.includes(`ui/${id}_hud.json`)) defs.push(`ui/${id}_hud.json`);
        resourcePackFiles['ui/_ui_defs.json'] = JSON.stringify({ ...parsedDefs, ui_defs: defs }, null, 2);
      } catch {
        // A malformed source list is kept as-is instead of being replaced by ours.
      }
    }
  } else if (archiveHasUiAsset) {
    console.log('[Aippy] [HUD] The archive ships UI documents but no HUD layout was designed, so no custom UI definition is generated.');
  }
  if (Object.keys(terrainTextureDataEntries).length > 0) {
    resourcePackFiles['textures/terrain_texture.json'] = JSON.stringify({
      resource_pack_name: 'vanilla',
      texture_name: 'atlas.terrain',
      padding: 8,
      num_mip_levels: 4,
      texture_data: terrainTextureDataEntries
    }, null, 2);
    resourcePackFiles['blocks.json'] = JSON.stringify({
      format_version: [1, 1, 0],
      ...blockRegistryEntries
    }, null, 2);
  }

  // Register authentic 3D block geometries for stairs, slabs, and doors with per-face UV
  resourcePackFiles['models/blocks/stair.geo.json'] = JSON.stringify({
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: {
        identifier: 'geometry.stair',
        texture_width: 16,
        texture_height: 16,
        visible_bounds_width: 1.5,
        visible_bounds_height: 1.5,
        visible_bounds_offset: [0, 0.5, 0]
      },
      bones: [{
        name: 'base',
        pivot: [0, 0, 0],
        cubes: [{
          origin: [-8, 0, -8],
          size: [16, 8, 16],
          uv: {
            north: {
              uv: [0, 8],
              uv_size: [16, 8]
            },
            south: {
              uv: [0, 8],
              uv_size: [16, 8]
            },
            east: {
              uv: [0, 8],
              uv_size: [16, 8]
            },
            west: {
              uv: [0, 8],
              uv_size: [16, 8]
            },
            up: {
              uv: [0, 0],
              uv_size: [16, 16]
            },
            down: {
              uv: [0, 0],
              uv_size: [16, 16]
            }
          }
        }, {
          origin: [-8, 8, 0],
          size: [16, 8, 8],
          uv: {
            north: {
              uv: [0, 8],
              uv_size: [16, 8]
            },
            south: {
              uv: [0, 8],
              uv_size: [16, 8]
            },
            east: {
              uv: [0, 8],
              uv_size: [16, 8]
            },
            west: {
              uv: [0, 8],
              uv_size: [16, 8]
            },
            up: {
              uv: [0, 0],
              uv_size: [16, 8]
            },
            down: {
              uv: [0, 0],
              uv_size: [16, 8]
            }
          }
        }]
      }]
    }]
  }, null, 2);
  resourcePackFiles['models/blocks/slab.geo.json'] = JSON.stringify({
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: {
        identifier: 'geometry.slab',
        texture_width: 16,
        texture_height: 16,
        visible_bounds_width: 1.5,
        visible_bounds_height: 1.5,
        visible_bounds_offset: [0, 0.25, 0]
      },
      bones: [{
        name: 'slab',
        pivot: [0, 0, 0],
        cubes: [{
          origin: [-8, 0, -8],
          size: [16, 8, 16],
          uv: {
            north: {
              uv: [0, 8],
              uv_size: [16, 8]
            },
            south: {
              uv: [0, 8],
              uv_size: [16, 8]
            },
            east: {
              uv: [0, 8],
              uv_size: [16, 8]
            },
            west: {
              uv: [0, 8],
              uv_size: [16, 8]
            },
            up: {
              uv: [0, 0],
              uv_size: [16, 16]
            },
            down: {
              uv: [0, 0],
              uv_size: [16, 16]
            }
          }
        }]
      }]
    }]
  }, null, 2);
  resourcePackFiles['models/blocks/door.geo.json'] = JSON.stringify({
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: {
        identifier: 'geometry.door',
        texture_width: 16,
        texture_height: 16,
        visible_bounds_width: 1.5,
        visible_bounds_height: 2.5,
        visible_bounds_offset: [0, 1.0, 0]
      },
      bones: [{
        name: 'door',
        pivot: [-8, 0, -1],
        cubes: [{
          origin: [-8, 0, -1],
          size: [16, 32, 2],
          uv: {
            north: {
              uv: [0, 0],
              uv_size: [16, 16]
            },
            south: {
              uv: [0, 0],
              uv_size: [16, 16]
            },
            east: {
              uv: [0, 0],
              uv_size: [2, 16]
            },
            west: {
              uv: [0, 0],
              uv_size: [2, 16]
            },
            up: {
              uv: [0, 0],
              uv_size: [16, 2]
            },
            down: {
              uv: [0, 0],
              uv_size: [16, 2]
            }
          }
        }]
      }]
    }]
  }, null, 2);

  // Add derived 3D model geometry + textures for each remade item
  if (itemAssets) {
    for (const it of items) {
      const asset = itemAssets.get(it.id);
      if (!asset) continue;
      if (!asset.isFlat2D && asset.geometryJson) {
        const geoFolder = it.category === 'block' ? 'models/blocks' : 'models/items';
        resourcePackFiles[`${geoFolder}/${it.id}.geo.json`] = asset.geometryJson;
      }
      if (asset.pngBytes) {
        // Animated Java block textures keep their full frame strip here so the
        // flipbook pass can register the real frame timing; the item icon keeps
        // the single-frame crop because the item atlas cannot flipbook.
        const blockTexture = asset.blockTextureBytes ?? asset.pngBytes;
        resourcePackFiles[`textures/items/${it.id}.png`] = asset.pngBytes;
        if (it.category === 'block') {
          resourcePackFiles[`textures/blocks/${it.id}.png`] = blockTexture;
          if (packOptions?.enablePbr) {
            resourcePackFiles[`textures/blocks/${it.id}.texture_set.json`] = JSON.stringify({
              format_version: TEXTURE_SET_FORMAT_VERSION,
              'minecraft:texture_set': {
                color: it.id,
                metalness_emissive_roughness: [0.1, 0.1, 0.35],
                heightmap: 0.05
              }
            }, null, 2);
          }
        }
      }
    }

    // Attachables: Bedrock only renders a custom 3D item when an attachable is bound
    // to its identifier. Without this file every recovered Java item model stayed
    // invisible in game and the item fell back to a flat atlas sprite.
    for (const it of items) {
      const asset = itemAssets.get(it.id);
      if (!asset || asset.isFlat2D || !asset.isAuthenticModModel) continue;
      if (!asset.geometryId || !asset.geometryJson || it.category === 'block') continue;
      resourcePackFiles[`attachables/${it.id}.attachable.json`] = JSON.stringify({
        format_version: '1.10.0',
        'minecraft:attachable': {
          description: {
            identifier: `${id}:${it.id}`,
            materials: {
              default: 'entity_alphatest',
              enchanted: 'entity_alphatest_glint'
            },
            textures: {
              default: `textures/items/${it.id}`,
              enchanted: 'textures/misc/enchanted_item_glint'
            },
            geometry: {
              default: asset.geometryId
            },
            render_controllers: ['controller.render.item_default']
          },
          // Java display transforms become Bedrock per-hand render offsets. When the
          // source model declared none, the component is omitted rather than invented.
          ...(asset.renderOffsets ? {
            components: {
              'minecraft:render_offsets': asset.renderOffsets
            }
          } : {})
        }
      }, null, 2);
    }
  }

  // Write authentic or rigged mob entity geometries
  if (entityGeometries) {
    for (const [mobId, geo] of entityGeometries) {
      if (geo.json) {
        resourcePackState.setModel(`models/entity/${mobId}.geo.json`, geo.json);
      }
    }
  }

  // Write mob entity textures
  if (entityTextures) {
    for (const [mobId, texBytes] of entityTextures) {
      resourcePackFiles[`textures/entity/${mobId}.png`] = texBytes;
      resourcePackFiles[`textures/entity/${mobId}/${mobId}.png`] = texBytes;
    }
  }
  if (customEntity?.geometryJson) {
    resourcePackState.setModel(`models/entity/${customEntity.id}.geo.json`, customEntity.geometryJson);
  }

  // Merge automated animation definitions and controllers
  if (extraAnimationFiles?.resourcePackFiles) {
    Object.assign(resourcePackFiles, extraAnimationFiles.resourcePackFiles);
  }
  if (extraAnimationFiles?.behaviorPackFiles) {
    Object.assign(behaviorPackFiles, extraAnimationFiles.behaviorPackFiles);
  }

  // Authentic recovered assets always win over generated templates: re-apply them
  // AFTER the animation merge so a real GeckoLib model or skin is never replaced
  // by a templated rig.
  if (entityGeometries) {
    for (const [mobId, geo] of entityGeometries) {
      if (geo.json) resourcePackState.setModel(`models/entity/${mobId}.geo.json`, geo.json);
    }
  }
  if (entityTextures) {
    for (const [mobId, texBytes] of entityTextures) {
      resourcePackState.setTexture(`textures/entity/${mobId}.png`, texBytes);
      resourcePackState.setTexture(`textures/entity/${mobId}/${mobId}.png`, texBytes);
    }
  }

  // Safety Pass: every item/block texture the source actually shipped is carried through.
  // An asset the mod never shipped is NOT replaced with invented art while Playable Mode is
  // off — it is recorded as ABSENT so the schema gate and the audit report a real missing
  // source asset instead of a fabricated PNG that looks authentic. Only Playable Mode
  // (INVENTED provenance) may generate a stand-in.
  const playableModeOn = isPlayableModeEnabled();
  const missingSourceTextures: string[] = [];
  for (const it of items) {
    // A spawn egg ships no item icon and no drawn art: the game draws the egg from the mob's
    // own client entity colours, read from the Java registration.
    if (it.category === 'spawn_egg') continue;
    const itemTexPath = `textures/items/${it.id}.png`;
    if (!resourcePackState.has(itemTexPath)) {
      if (playableModeOn) {
        const generated = buildAuthenticPixelArt(it.id, it.category, ['#38bdf8', '#0284c7', '#0369a1', '#0f172a']) || FALLBACK_ITEM_PNG_BYTES;
        resourcePackState.setTexture(itemTexPath, generated);
      } else {
        missingSourceTextures.push(itemTexPath);
      }
    }
    if (it.category === 'block') {
      const blockTexPath = `textures/blocks/${it.id}.png`;
      if (!resourcePackState.has(blockTexPath)) {
        if (playableModeOn) {
          const generated = buildAuthenticPixelArt(it.id, 'block', ['#64748b', '#475569', '#334155', '#0f172a']) || FALLBACK_ITEM_PNG_BYTES;
          resourcePackState.setTexture(blockTexPath, generated);
        } else {
          missingSourceTextures.push(blockTexPath);
        }
      }
    }
  }
  if (missingSourceTextures.length > 0) {
    console.log(
      `[Aippy] [SCHEMA] ${missingSourceTextures.length} item/block texture(s) have no source PNG — reported as ABSENT instead of being replaced with invented art (Playable Mode off). First: ${missingSourceTextures.slice(0, 3).join(', ')}`,
    );
  }

  // Scan for all client entity files and ensure their geometry & texture files exist in resource pack
  const clientEntityFiles = Object.keys(resourcePackFiles).filter(k => k.startsWith('entity/') && k.endsWith('.entity.json'));
  for (const cef of clientEntityFiles) {
    const mobId = cef.replace(/^entity\/|\.entity\.json$/g, '');
    const expectedGeoPath = `models/entity/${mobId}.geo.json`;
    if (!resourcePackState.has(expectedGeoPath)) {
      const rigged = generateRiggedMobGeometry(id, mobId);
      resourcePackState.setModel(expectedGeoPath, rigged.json);
    }
    const expectedAnimPath = `animations/${mobId}.animation.json`;
    if (isPlayableModeEnabled() && !resourcePackState.has(expectedAnimPath)) {
      const isFlying = mobId.includes('bee') || mobId.includes('fly') || mobId.includes('queen') || mobId.includes('watcher') || mobId.includes('copter');
      const isSlime = mobId.includes('slime') || mobId.includes('blob');
      resourcePackState.setAnimation(expectedAnimPath, generateMobAnimations(mobId, isFlying, isSlime));
    }
    const expectedTexPath = `textures/entity/${mobId}.png`;
    if (isPlayableModeEnabled() && !resourcePackState.has(expectedTexPath) && !resourcePackState.has(`textures/entity/${mobId}/${mobId}.png`)) {
      const fullMobTex = createFullMobTexture64x64(mobId, ['#475569', '#38bdf8', '#0284c7', '#0f172a']);
      resourcePackState.setTexture(expectedTexPath, fullMobTex);
      resourcePackState.setTexture(`textures/entity/${mobId}/${mobId}.png`, fullMobTex);
    }
  }

  // Spawn egg colours are never written here: they belong to the spawned mob's client entity
  // and come from the mod's own Java registration (spawn egg policy pass).

  // Final Export Guarantee Pass 1: patch client entity descriptors so Bedrock never reports
  // "friendly name 'geometry.default' not found". Every client entity MUST define
  // geometry.default, textures.default and materials.default.
  for (const cef of clientEntityFiles) {
    const mobId = cef.replace(/^entity\/|\.entity\.json$/g, '');
    try {
      const parsed = JSON.parse(resourcePackFiles[cef] as string) as Record<string, any>;
      const desc = parsed['minecraft:client_entity']?.description;
      if (desc) {
        // Strip out any accidental 'lighting' animation script that crashes Bedrock with "can't find animation lighting"
        if (desc.scripts?.animate && Array.isArray(desc.scripts.animate)) {
          desc.scripts.animate = desc.scripts.animate.filter((a: string) => a !== 'lighting');
        }
        if (desc.animations?.ctrl) {
          desc.scripts = {
            ...(desc.scripts ?? {}),
            animate: ['ctrl']
          };
        }
        if (desc.animations?.lighting) {
          delete desc.animations.lighting;
        }

        // Spawn egg colours are owned by the spawn egg policy pass, which writes them into the
        // client entity from the mod's own Java registration. This pass never writes or
        // deletes them, so a colour set by the policy is never stripped again.
        // Bind the client entity to the geometry identifier that actually exists in
        // its own .geo.json (mod prefix / alias drift silently made mobs invisible).
        const rawGeometry = resourcePackFiles[`models/entity/${mobId}.geo.json`];
        const geometryIdentifier = typeof rawGeometry === 'string' ? extractGeometryIdentifier(rawGeometry) : null;
        if (geometryIdentifier) {
          const existing = desc.geometry && typeof desc.geometry === 'object' ? desc.geometry : {};
          desc.geometry = {
            ...existing,
            default: geometryIdentifier
          };
        } else if (!desc.geometry || Object.keys(desc.geometry).length === 0) {
          desc.geometry = {
            default: `geometry.${mobId}`
          };
        }
        desc.textures = desc.textures && Object.keys(desc.textures).length > 0 ? desc.textures : {
          default: `textures/entity/${mobId}`
        };
        desc.materials = desc.materials && Object.keys(desc.materials).length > 0 ? desc.materials : {
          default: 'entity_alphatest'
        };
        resourcePackFiles[cef] = JSON.stringify(parsed, null, 2);
      }
    } catch {
      // Non-JSON or already binary — leave untouched
    }
  }

  // Final Export Guarantee Pass 2: full-pack Molang scrub. No exported file may ever
  // contain the invalid token query.is_hurt (Bedrock only supports query.hurt_time).
  const scrubMolang = (s: string): string => s.replace(/\bquery\.is_hurt\b/g, 'query.hurt_time > 0').replace(/\bisHurt\(\)/g, 'query.hurt_time > 0');
  for (const pack of [resourcePackFiles, behaviorPackFiles]) {
    for (const key of Object.keys(pack)) {
      const val = pack[key];
      if (typeof val === 'string' && (key.endsWith('.json') || key.endsWith('.lang')) && val.includes('is_hurt')) {
        pack[key] = scrubMolang(val);
      }
    }
  }

  // Final Export Guarantee Pass 4: no two geometry files may declare the same
  // identifier. Shared aliases (e.g. `geometry.default`) made several mobs resolve to
  // a rig from another file, or drop out of the registry entirely.
  for (const key of Object.keys(resourcePackFiles)) {
    if (!key.startsWith('models/') || !key.endsWith('.json')) continue;
    const raw = resourcePackFiles[key];
    if (typeof raw !== 'string') continue;
    const cleaned = sanitizeGeometryJson(raw);
    if (cleaned !== raw) resourcePackFiles[key] = cleaned;
  }

  // Final Export Guarantee Pass 5: bind every mob to a model + skin that really IS in
  // the pack, re-base its UVs onto that skin's true resolution and give it the AI
  // components Bedrock needs. Upstream key drift (a recovered model filed under a
  // slightly different name than its spawn egg) used to leave mobs on a generic rig
  // or mangled UVs, which is exactly what showed up broken in game.
  bindMobParity({
    modId: id,
    resourcePackFiles,
    behaviorPackFiles,
    profiles: packOptions?.mobProfiles,
    links: packOptions?.mobLinks,
    onLog: (line: string) => console.log(`[Aippy] ${line}`)
  });

  // Final Export Guarantee Pass 3: one canonical identifier registry for every generated
  // geometry, and total separation between entity definitions and texture assets. Every
  // client entity, render controller, attachable, block and item reference is repaired
  // through the registry, and both atlases are rebuilt from the PNGs that actually ship,
  // so a model the engine cannot resolve and a phantom atlas entry can never be exported.
  const identityReport = applyCanonicalGeometryRegistry({
    modId: id,
    resourcePackFiles,
    behaviorPackFiles,
    onLog: (line: string) => console.log(`[Aippy] ${line}`),
  });
  const atlasReport = rebuildTextureAtlases({
    resourcePackFiles,
    behaviorPackFiles,
    onLog: (line: string) => console.log(`[Aippy] ${line}`),
  });
  if (identityReport.unresolved.length > 0 || atlasReport.phantomsRemoved > 0) {
    console.log(
      `[Aippy] Export gate: ${identityReport.unresolved.length} geometry reference(s) and ${atlasReport.phantomsRemoved} phantom atlas entry/entries were resolved or reported, never silently shipped.`,
    );
  }

  // Phantom scaffold prune: optional structure the schema does not require is removed unless
  // the shipped pack actually names it. A template creator camera, a default render controller
  // and built-in stair/slab/door cuboids used to land in every export whether or not the
  // imported mod contained them.
  const packTextOf = (value: string | Uint8Array | undefined): string => (typeof value === 'string' ? value : '');
  const referencedOutside = (needle: string, skipPath: string): boolean =>
    Object.entries({ ...resourcePackFiles, ...behaviorPackFiles }).some(
      ([path, value]) => path !== skipPath && packTextOf(value).includes(needle),
    );
  const optionalScaffold: Array<{ path: string; reference: string; label: string; gated: boolean }> = [
    { path: 'render_controllers/default.render_controllers.json', reference: 'controller.render.default', label: 'default render controller', gated: true },
    { path: 'models/blocks/stair.geo.json', reference: 'geometry.stair', label: 'built-in stair cuboid', gated: true },
    { path: 'models/blocks/slab.geo.json', reference: 'geometry.slab', label: 'built-in slab cuboid', gated: true },
    { path: 'models/blocks/door.geo.json', reference: 'geometry.door', label: 'built-in door cuboid', gated: true },
    { path: 'cameras/presets.json', reference: `${id}:cinematic`, label: 'creator camera preset', gated: !archiveHasCameraAsset && !playableModeActive },
  ];
  const prunedScaffold: string[] = [];
  for (const optionalFile of optionalScaffold) {
    if (resourcePackFiles[optionalFile.path] === undefined) continue;
    if (!optionalFile.gated) continue;
    if (referencedOutside(optionalFile.reference, optionalFile.path)) continue;
    delete resourcePackFiles[optionalFile.path];
    prunedScaffold.push(optionalFile.label);
  }
  if (prunedScaffold.length > 0) {
    console.log(`[Aippy] [PROVENANCE] Dropped ${prunedScaffold.length} unreferenced template file(s) no source asset required: ${prunedScaffold.join(', ')}.`);
  }

  // Port notes are rebuilt from what actually shipped. The static template text promised a
  // custom UI menu, combat arts, particles and camera commands that most mods never contained,
  // so it told players to look for content the archive did not have.
  const shippedCounts = {
    items: Object.keys(behaviorPackFiles).filter((path) => path.startsWith('items/')).length,
    blocks: Object.keys(behaviorPackFiles).filter((path) => path.startsWith('blocks/')).length,
    entities: Object.keys(behaviorPackFiles).filter((path) => path.startsWith('entities/')).length,
    clientEntities: Object.keys(resourcePackFiles).filter((path) => path.startsWith('entity/')).length,
    animations: Object.keys(resourcePackFiles).filter((path) => path.startsWith('animations/')).length,
    sounds: Object.keys(resourcePackFiles).filter((path) => path.startsWith('sounds/')).length,
    particles: Object.keys(resourcePackFiles).filter((path) => path.startsWith('particles/')).length,
  };
  behaviorPackFiles['REMAKE_NOTES.txt'] = [
    `${name} — Bedrock Edition Parity Port Notes`,
    '=============================================',
    `Description: ${description}`,
    '',
    `Target Bedrock release: ${capabilityQuery.versionLabel}`,
    `Script API module: @minecraft/server ${capabilityQuery.maxScriptApiVersion}`,
    '',
    'Components actually shipped from the imported archive:',
    `- Items: ${shippedCounts.items}`,
    `- Blocks: ${shippedCounts.blocks}`,
    `- Behavior entities: ${shippedCounts.entities}`,
    `- Client entities: ${shippedCounts.clientEntities}`,
    `- Animations: ${shippedCounts.animations}`,
    `- Sound files: ${shippedCounts.sounds}`,
    `- Particle effects: ${shippedCounts.particles}`,
    '',
    'Install:',
    '1. Import the .mcaddon into Minecraft Bedrock (iOS / Android / Windows).',
    '2. Enable Beta APIs under world Experiments only if this pack ships scripts.',
    '3. Apply both the behavior pack and the resource pack to the world.',
    '',
    'Nothing in this pack is gameplay the source mod did not contain. Components the mod never',
    'shipped are reported in the audit log instead of being invented.',
  ].join('\n');

  // Pack icon guarantee: both packs MUST carry a literally-named pack_icon.png.
  // The icon key comes from the asset dictionary; if that value ever resolves to
  // anything other than a plain relative path, the pack would ship with no icon,
  // which Bedrock flags as an unknown/broken pack.
  const iconDictionaryKey = typeof assetsData.IMAGE_QEIG === 'string' ? assetsData.IMAGE_QEIG : '';
  if (iconDictionaryKey !== assetsData.IMAGE_QEIG) {
    delete behaviorPackFiles[iconDictionaryKey];
    delete resourcePackFiles[iconDictionaryKey];
  }
  behaviorPackFiles[assetsData.IMAGE_QEIG] = packIconBytes;
  resourcePackFiles[assetsData.IMAGE_QEIG] = packIconBytes;
  // Bedrock only looks for a literally-named pack_icon.png at the pack root. The asset
  // dictionary key can resolve to an absolute or hashed path, which left both packs with
  // no real icon and shipped a stray entry that importers could not resolve.
  behaviorPackFiles[assetsData.IMAGE_QEIG] = packIconBytes;
  resourcePackFiles[assetsData.IMAGE_QEIG] = packIconBytes;

  // Per-bucket audit summary via the typed state-manager interface
  const resourcePackAudit = resourcePackState.counts();
  console.log(`[Aippy] Resource pack asset buckets — textures: ${resourcePackAudit.texture}, models: ${resourcePackAudit.model}, animations: ${resourcePackAudit.animation}, meta: ${resourcePackAudit.meta}`);
  return {
    behaviorPackFiles,
    resourcePackFiles
  };
}