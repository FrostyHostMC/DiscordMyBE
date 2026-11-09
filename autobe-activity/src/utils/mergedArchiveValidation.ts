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
            /@minecraft\/server-ui/.test(source)) {
    const serverDependency = dependencies.find((dependency: any) => dependency?.module_name === '@minecraft/server');
    const scriptFiles: Array<{ path: string; file: JSZip.JSZipObject }> = [];
    zip.forEach((path, file) => {
      if (!file.dir && /\.(?:js|mjs|ts)$/i.test(path)) scriptFiles.push({ path, file });
    });
    let usesDdui = false;
    for (const script of scriptFiles) {
      try {
        const source = await script.file.async('text');
        if (/\b(?:CustomForm|MessageBox|ObservableString|ObservableNumber|ObservableBoolean|ObservableUIRawMessage)\b/.test(source) &&
            /@minecraft\/server-ui/.test(source)) {
          usesDdui = true;
          break;
        }
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
            /@minecraft\/server-ui/.test(source)) {
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
  }

  // These legacy screen files can affect older JSON-UI menu implementations,
  // but they are not a supported injection surface for native Ore UI screens.
  // Keep the files; emit an informational warning so users do not mistake a
  // successful JSON merge for native Ore UI compatibility.
  const legacyMenuFiles = new Set([
    'start_screen.json', 'pause_screen.json', 'settings_screen.json',
    'inventory_screen.json', 'crafting_screen.json', 'container_screen.json',
    'world_screen.json', 'create_world_screen.json', 'edit_world_screen.json',
    'play_screen.json', 'marketplace_screen.json'
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
        for (const id of Object.keys(animationControllers)) animationIds.add(id);
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
        if ((key === 'geometry' || parentKey === 'geometry') && /^geometry\./.test(refId) && !geometryIds.has(refId)) {
          add({ severity: 'warning', code: 'MISSING_GEOMETRY_REFERENCE', path: sourcePath, message: '[' + label + '] Geometry identifier "' + refId + '" is referenced in ' + sourcePath + ' but no matching geometry definition was found in this resource pack.' });
        }
        if (parentKey === 'animations' && /^(animation|controller\.animation)\./.test(refId) && !animationIds.has(refId)) {
          add({ severity: 'warning', code: 'MISSING_ANIMATION_REFERENCE', path: sourcePath, message: '[' + label + '] Animation identifier "' + refId + '" is referenced in ' + sourcePath + ' but no matching animation definition was found in this resource pack.' });
        }
        if ((key === 'render_controllers' || parentKey === 'render_controllers') && /^controller\.render\./.test(refId) && !renderControllerIds.has(refId)) {
          add({ severity: 'warning', code: 'MISSING_RENDER_CONTROLLER_REFERENCE', path: sourcePath, message: '[' + label + '] Render controller "' + refId + '" is referenced in ' + sourcePath + ' but no matching render-controller definition was found in this resource pack.' });
        }
      }
      if (typeof value === 'string' && (insideTextureMap || /texture/i.test(key))) {
        const ref = value.trim();
        // Only validate explicit pack-relative paths. Namespaced aliases such
        // as "texture.item_name" and "textures.foo" are not file paths.
        if (/^(\.\.?\/|textures\/)/i.test(ref) && !/[{}$]/.test(ref) && !existsAsImage(ref)) {
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
