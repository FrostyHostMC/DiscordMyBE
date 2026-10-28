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

  const identifiers = new Map<string, string[]>();
  const identifierRoots = ['minecraft:item', 'minecraft:entity', 'minecraft:block', 'minecraft:client_entity', 'minecraft:attachable'];
  for (const entry of jsonEntries) {
    for (const root of identifierRoots) {
      const identifier = entry.data?.[root]?.description?.identifier;
      if (typeof identifier !== 'string' || !identifier.trim()) continue;
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

  const isResourcePack = /resource pack/i.test(label);
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
