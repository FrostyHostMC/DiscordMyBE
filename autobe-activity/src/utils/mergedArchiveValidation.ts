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

  const existsAsImage = (reference: string): boolean => {
    const clean = reference.replace(/^\.?\//, '').replace(/\\/g, '/').toLowerCase();
    if (paths.has(clean)) return true;
    if (IMAGE_EXTENSIONS.some(ext => clean.endsWith(ext))) return false;
    return IMAGE_EXTENSIONS.some(ext => paths.has(clean + ext));
  };

  const visit = (value: any, sourcePath: string, key = '', insideTextureMap = false): void => {
    if (!value || typeof value !== 'object') {
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
      for (const item of value) visit(item, sourcePath, key, insideTextureMap);
      return;
    }
    for (const [childKey, childValue] of Object.entries(value)) visit(childValue, sourcePath, childKey, insideTextureMap || /textures/i.test(childKey));
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
