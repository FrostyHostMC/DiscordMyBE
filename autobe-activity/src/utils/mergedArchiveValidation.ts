import JSZip from 'jszip';
import { sanitizeJsonString } from './addonParser';

export interface PackValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

const IMAGE_EXTENSIONS = ['.png', '.tga', '.jpg', '.jpeg'];

/**
 * Verified base-game resources exposed by Mojang's current Bedrock samples.
 * These are dependencies supplied by Minecraft itself, not files that every
 * add-on must bundle. Keep this list explicit: never trust an entire namespace.
 */
const VANILLA_GEOMETRY_IDS = new Set(['geometry.humanoid.custom', 'geometry.cape']);
const VANILLA_TEXTURE_PATHS = new Set(['textures/entity/steve', 'textures/entity/cape_invisible']);
const VANILLA_ANIMATION_IDS = new Set([
  'animation.humanoid.base_pose', 'animation.humanoid.look_at_target.default',
  'animation.humanoid.look_at_target.gliding', 'animation.humanoid.look_at_target.swimming',
  'animation.humanoid.brandish_spear', 'animation.humanoid.charging',
  'animation.humanoid.damage_nearby_mobs', 'animation.humanoid.bow_and_arrow',
  'animation.humanoid.fishing_rod', 'animation.humanoid.holding_spyglass',
  'animation.humanoid.tooting_goat_horn', 'animation.humanoid.holding_brush',
  'animation.humanoid.brushing', 'animation.humanoid.melee_spear_use',
  'animation.skeleton.attack', 'animation.player.look_at_target.ui',
  'animation.player.look_at_target.inverted', 'animation.player.cape',
  'animation.player.move.arms', 'animation.player.move.legs', 'animation.player.swim',
  'animation.player.swim.legs', 'animation.player.riding.arms', 'animation.player.riding.legs',
  'animation.player.holding', 'animation.player.attack.positions', 'animation.player.attack.rotations',
  'animation.player.sneaking', 'animation.player.bob', 'animation.player.sleeping',
  'animation.player.first_person.base_pose', 'animation.player.first_person.empty_hand',
  'animation.player.first_person.swap_item', 'animation.player.first_person.attack_rotation',
  'animation.player.first_person.attack_rotation_item', 'animation.player.first_person.vr_attack_rotation',
  'animation.player.first_person.walk', 'animation.player.first_person.map_hold',
  'animation.player.first_person.map_hold_attack', 'animation.player.first_person.map_hold_off_hand',
  'animation.player.first_person.map_hold_main_hand', 'animation.player.first_person.crossbow_equipped',
  'animation.player.first_person.crossbow_hold', 'animation.player.first_person.breathing_bob',
  'animation.player.first_person.shield_block', 'animation.player.first_person.melee_spear_use',
  'animation.player.first_person.melee_spear_hold', 'animation.player.first_person.melee_spear_attack',
  'animation.player.crossbow_equipped', 'animation.player.bow_equipped', 'animation.player.crossbow_hold',
  'animation.player.shield_block_main_hand', 'animation.player.shield_block_off_hand',
  'animation.player.crawl', 'animation.player.crawl.legs', 'animation.player.swim.no_right_arm',
  'animation.player.crawl.no_right_arm', 'animation.player.riding.root',
  'animation.player.holding_heavy_core', 'animation.player.melee_spear_attack'
]);
const VANILLA_ANIMATION_CONTROLLER_IDS = new Set([
  'controller.animation.player.root', 'controller.animation.player.base',
  'controller.animation.player.hudplayer', 'controller.animation.player.first_person_attack',
  'controller.animation.player.first_person_map', 'controller.animation.player.crossbow',
  'controller.animation.player.melee_spear', 'controller.animation.player.first_person_melee_spear',
  'controller.animation.persona.blink', 'controller.animation.humanoid.look_at_target'
]);
const VANILLA_RENDER_CONTROLLER_IDS = new Set([
  'controller.render.player.first_person', 'controller.render.player.third_person',
  'controller.render.player.first_person_spectator', 'controller.render.player.third_person_spectator',
  'controller.render.player.map'
]);


/**
 * Validate the actual merged archive, not just the source inputs. This pass is
 * intentionally conservative: it reports broken syntax and explicit file-path
 * references without guessing at Bedrock identifier semantics.
 */
export async function validateMergedArchive(zip: JSZip, label: string): Promise<PackValidationIssue[]> {
  const issues: PackValidationIssue[] = [];
  const paths = new Set<string>();
  const jsonEntries: Array<{ path: string; data: any }> = [];

  zip.forEach((path, file) => {
    if (!file.dir) paths.add(path.replace(/\\/g, '/').toLowerCase());
  });

  const add = (issue: PackValidationIssue) => issues.push(issue);
  const jsonFiles: Array<{ path: string; file: JSZip.JSZipObject }> = [];
  zip.forEach((path, file) => {
    if (!file.dir && path.toLowerCase().endsWith('.json')) jsonFiles.push({ path, file });
  });

  for (const entry of jsonFiles) {
    try {
      const text = await entry.file.async('text');
      jsonEntries.push({ path: entry.path, data: JSON.parse(sanitizeJsonString(text)) });
    } catch (error) {
      add({
        severity: 'error',
        code: 'INVALID_JSON',
        path: entry.path,
        message: `[${label}] Invalid JSON in ${entry.path}: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  const isResourcePack = /resource pack/i.test(label);
  const isBehaviorPack = /behavior/i.test(label);

  if (isBehaviorPack) {
    const manifestEntry = jsonEntries.find(entry => entry.path.replace(/\\/g, '/').toLowerCase().endsWith('manifest.json'));
    const dependencies = Array.isArray(manifestEntry?.data?.dependencies) ? manifestEntry.data.dependencies : [];
    const uiDependency = dependencies.find((dependency: any) => dependency?.module_name === '@minecraft/server-ui');
    const serverDependency = dependencies.find((dependency: any) => dependency?.module_name === '@minecraft/server');
    const scriptFiles: Array<{ path: string; file: JSZip.JSZipObject }> = [];
    zip.forEach((path, file) => {
      if (!file.dir && /\.(?:js|mjs|ts)$/i.test(path)) scriptFiles.push({ path, file });
    });
    let usesDdui = false;
    let usesPreviewDdui = false;
    for (const script of scriptFiles) {
      try {
        const source = await script.file.async('text');
        if (/\b(?:CustomForm|MessageBox|ObservableString|ObservableNumber|ObservableBoolean|ObservableUIRawMessage)\b/.test(source) &&
            /@minecraft\/server-ui/.test(source)) usesDdui = true;
        if (/@minecraft\/server-ui/.test(source) && /\.multiButtonRow\s*\(|\.button3WithOptions\s*\(/.test(source)) usesPreviewDdui = true;
      } catch { /* archive read failures are reported by other validation passes */ }
    }
    const versionAtLeast = (value: unknown, minimum: [number, number, number]) => {
      if (typeof value !== 'string') return false;
      const parsed = value.split('.').slice(0, 3).map(part => Number.parseInt(part, 10));
      if (parsed.length !== 3 || parsed.some(part => !Number.isFinite(part))) return false;
      for (let i = 0; i < 3; i++) {
        if (parsed[i] > minimum[i]) return true;
        if (parsed[i] < minimum[i]) return false;
      }
      return true;
    };
    if (usesDdui && !versionAtLeast(uiDependency?.version, [2, 1, 0])) {
      add({
        severity: 'warning',
        code: 'DDUI_API_DEPENDENCY_MISSING',
        path: manifestEntry?.path || 'manifest.json',
        message: '[' + label + '] Scripts reference DDUI classes, but @minecraft/server-ui is missing or older than 2.1.0. DDUI became stable in @minecraft/server-ui 2.1.0; preserve the source dependency or update it only when the selected Minecraft target supports it.'
      });
    }
    if (usesDdui && !versionAtLeast(serverDependency?.version, [2, 0, 0])) {
      add({
        severity: 'warning',
        code: 'DDUI_SERVER_PEER_DEPENDENCY',
        path: manifestEntry?.path || 'manifest.json',
        message: '[' + label + '] DDUI requires the @minecraft/server 2.0.0 peer dependency. AutoBE will not silently upgrade this pack because API compatibility must match the selected Bedrock target.'
      });
    }
    if (usesPreviewDdui && !versionAtLeast(uiDependency?.version, [2, 4, 0])) {
      add({
        severity: 'warning',
        code: 'DDUI_PREVIEW_UI_VERSION',
        path: manifestEntry?.path || 'manifest.json',
        message: '[' + label + '] Scripts use preview DDUI methods such as multiButtonRow or button3WithOptions, but @minecraft/server-ui is older than 2.4.0-rc. These methods are preview-only in current documentation; AutoBE preserves the declared dependency instead of upgrading it.'
      });
    }
  }

  // These legacy screen files can affect older JSON-UI menu implementations,
  // but they are not a supported injection surface for native Ore UI screens.
  // Keep the files; emit an informational warning so users do not mistake a
  // successful JSON merge for native Ore UI compatibility.
  const legacyMenuFiles = new Set([
    'start_screen.json', 'pause_screen.json', 'settings_screen.json',
    'inventory_screen.json', 'crafting_screen.json', 'container_screen.json',
    'world_screen.json', 'create_world_screen.json', 'edit_world_screen.json',
    'play_screen.json', 'marketplace_screen.json', 'main_menu_screen.json',
    'world_selection_screen.json', 'disconnected_screen.json', 'achievements_screen.json',
    'sleep_screen.json', 'death_screen.json', 'permissions_screen.json'
  ]);
  if (isResourcePack) {
    for (const entry of jsonEntries) {
      const normalized = entry.path.replace(/\\\\/g, '/').toLowerCase();
      const fileName = normalized.substring(normalized.lastIndexOf('/') + 1);
      if (!(normalized.startsWith('ui/') || normalized.includes('/ui/')) || !legacyMenuFiles.has(fileName)) continue;
      add({
        severity: 'warning',
        code: 'LEGACY_UI_ORE_UI_LIMIT',
        path: entry.path,
        message: '[' + label + '] This add-on customizes a legacy JSON UI menu file. If the corresponding native screen uses Ore UI in the installed Minecraft version, resource packs cannot inject into or replace that screen. The file is preserved for game versions that still load the legacy screen.'
      });
    }
  }

  // _ui_defs.json is the loader registry for custom JSON-UI screens/common
  // files. A syntactically valid merge can still render nothing when one of
  // these registered paths was overwritten, dropped, or never copied.
  if (isResourcePack) {
    for (const entry of jsonEntries) {
      if (!entry.path.replace(/\\/g, '/').toLowerCase().endsWith('ui/_ui_defs.json')) continue;
      const definitions = entry.data?.ui_defs;
      if (!Array.isArray(definitions)) {
        add({ severity: 'warning', code: 'INVALID_UI_DEFS', path: entry.path, message: '[' + label + '] ui/_ui_defs.json does not contain a ui_defs array; custom UI files may not be loaded.' });
        continue;
      }
      for (const definition of definitions) {
        if (typeof definition !== 'string' || !definition.trim()) {
          add({ severity: 'warning', code: 'INVALID_UI_DEF_ENTRY', path: entry.path, message: '[' + label + '] ui_defs contains an empty or non-string UI file entry.' });
          continue;
        }
        const normalized = definition.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
        if (!paths.has(normalized)) {
          add({ severity: 'warning', code: 'MISSING_UI_DEFINITION_FILE', path: entry.path, message: '[' + label + '] UI file "' + definition + '" is registered in ui_defs but is missing from the merged resource pack.' });
        }
      }
    }
  }
  const identifiers = new Map<string, string[]>();
  const identifierRoots = ['minecraft:item', 'minecraft:entity', 'minecraft:block', 'minecraft:client_entity', 'minecraft:attachable'];
  for (const entry of jsonEntries) {
    for (const root of identifierRoots) {
      const identifier = entry.data?.[root]?.description?.identifier;
      if (typeof identifier !== 'string' || !identifier.trim()) continue;
      // A behavior player and its client player are complementary. Only an
      // entity definition in the matching pack's entity folder participates.
      if (identifier === 'minecraft:player' && (root === 'minecraft:entity' || root === 'minecraft:client_entity')) {
        const path = entry.path.toLowerCase().replace(/\\/g, '/');
        if (root === 'minecraft:client_entity' && (!path.startsWith('entity/') || isBehaviorPack)) continue;
        if (root === 'minecraft:entity' && (!path.startsWith('entities/') || isResourcePack)) continue;
      }
      const key = root + ':' + identifier;
      const files = identifiers.get(key) || [];
      files.push(entry.path);
      identifiers.set(key, files);
    }
  }
  for (const [key, files] of identifiers) {
    if (files.length > 1) {
      add({
        severity: 'warning',
        code: 'DUPLICATE_IDENTIFIER',
        path: files.join(', '),
        message: '[' + label + '] Identifier "' + key.slice(key.indexOf(':') + 1) + '" is still defined by multiple files: ' + files.join(', ') + '. Minecraft may use only one definition or the content may conflict.'
      });
    }
  }

  const existsAsImage = (reference: string): boolean => {
    const clean = reference.replace(/^\.?\//, '').replace(/\\/g, '/').toLowerCase();
    if (paths.has(clean)) return true;
    if (IMAGE_EXTENSIONS.some(ext => clean.endsWith(ext))) return false;
    return IMAGE_EXTENSIONS.some(ext => paths.has(clean + ext));
  };

  const geometryIds = new Set<string>();
  const animationIds = new Set<string>();
  const animationControllerIds = new Set<string>();
  const renderControllerIds = new Set<string>();
  if (isResourcePack) {
    for (const entry of jsonEntries) {
      const geometry = entry.data?.['minecraft:geometry'];
      const geometryList = Array.isArray(geometry) ? geometry : geometry ? [geometry] : [];
      for (const item of geometryList) {
        const id = item?.description?.identifier;
        if (typeof id === 'string') geometryIds.add(id);
      }
      const animations = entry.data?.animations;
      if (animations && typeof animations === 'object' && !Array.isArray(animations)) {
        for (const id of Object.keys(animations)) animationIds.add(id);
      }
      const animationControllers = entry.data?.animation_controllers;
      if (animationControllers && typeof animationControllers === 'object' && !Array.isArray(animationControllers)) {
        for (const id of Object.keys(animationControllers)) animationControllerIds.add(id);
      }
      const controllers = entry.data?.render_controllers;
      if (controllers && typeof controllers === 'object' && !Array.isArray(controllers)) {
        for (const id of Object.keys(controllers)) renderControllerIds.add(id);
      }
    }
  }

  const visit = (value: any, sourcePath: string, key = '', insideTextureMap = false, parentKey = ''): void => {
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string' && isResourcePack) {
        const refId = value.trim();
        if ((key === 'geometry' || parentKey === 'geometry') && /^geometry\./.test(refId) &&
            !geometryIds.has(refId) && !VANILLA_GEOMETRY_IDS.has(refId)) {
          add({ severity: 'warning', code: 'MISSING_GEOMETRY_REFERENCE', path: sourcePath, message: '[' + label + '] Geometry identifier "' + refId + '" is referenced in ' + sourcePath + ' but no matching custom or verified base-game geometry was found.' });
        }
        if (parentKey === 'animations' && /^animation\./.test(refId) &&
            !animationIds.has(refId) && !VANILLA_ANIMATION_IDS.has(refId)) {
          add({ severity: 'warning', code: 'MISSING_ANIMATION_REFERENCE', path: sourcePath, message: '[' + label + '] Animation identifier "' + refId + '" is referenced in ' + sourcePath + ' but no matching custom or verified base-game animation was found.' });
        }
        if ((parentKey === 'animations' || key === 'animation_controllers' || parentKey === 'animation_controllers') &&
            /^controller\.animation\./.test(refId) &&
            !animationControllerIds.has(refId) && !VANILLA_ANIMATION_CONTROLLER_IDS.has(refId)) {
          add({ severity: 'warning', code: 'MISSING_ANIMATION_CONTROLLER_REFERENCE', path: sourcePath, message: '[' + label + '] Animation controller "' + refId + '" is referenced in ' + sourcePath + ' but no matching custom or verified base-game controller was found.' });
        }
        if ((key === 'render_controllers' || parentKey === 'render_controllers') && /^controller\.render\./.test(refId) &&
            !renderControllerIds.has(refId) && !VANILLA_RENDER_CONTROLLER_IDS.has(refId)) {
          add({ severity: 'warning', code: 'MISSING_RENDER_CONTROLLER_REFERENCE', path: sourcePath, message: '[' + label + '] Render controller "' + refId + '" is referenced in ' + sourcePath + ' but no matching custom or verified base-game render controller was found.' });
        }
      }
      if (typeof value === 'string' && (insideTextureMap || /texture/i.test(key))) {
        const ref = value.trim();
        // Only validate explicit pack-relative paths. Namespaced aliases such
        // as "texture.item_name" and "textures.foo" are not file paths.
        if (/^(\.\.?\/|textures\/)/i.test(ref) && !/[{}$]/.test(ref) && !VANILLA_TEXTURE_PATHS.has(ref.replace(/^\.\//, '').replace(/\\/g, '/').toLowerCase()) && !existsAsImage(ref)) {
          add({
            severity: 'warning',
            code: 'MISSING_TEXTURE_FILE',
            path: sourcePath,
            message: `[${label}] Texture path "${ref}" referenced in ${sourcePath} does not resolve to an image file.`
          });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, sourcePath, key, insideTextureMap, parentKey);
      return;
    }
    for (const [childKey, childValue] of Object.entries(value)) visit(childValue, sourcePath, childKey, insideTextureMap || /textures/i.test(childKey), key);
  };

  for (const entry of jsonEntries) visit(entry.data, entry.path);

  // Deduplicate repeated findings from the same reference/path.
  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = issue.code + '|' + issue.path + '|' + issue.message;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
