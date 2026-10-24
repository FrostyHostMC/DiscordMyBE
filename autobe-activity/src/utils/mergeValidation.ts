import JSZip from 'jszip';
import type { MergedOutput } from '@/types/modpack';

export interface MergeValidationCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
}

const isObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function normalizedUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const uuid = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid) ? uuid : null;
}

/**
 * Inspect the actual generated packs before they are offered for download.
 * This is deliberately a diagnostic gate rather than a hard export blocker:
 * some Bedrock packs use engine-provided assets or runtime behavior that a
 * static validator cannot reliably judge.
 */
export async function validateMergedOutputs(outputs: MergedOutput[]): Promise<MergeValidationCheck[]> {
  const checks: MergeValidationCheck[] = [];
  const manifests: Array<{ fileName: string; value: Record<string, any> }> = [];
  const jsonErrors: string[] = [];
  const uuidErrors: string[] = [];
  const missingDependencies: string[] = [];
  const missingTextures: string[] = [];
  let hudModificationCount = 0;

  for (const output of outputs) {
    if (!output.blob) continue;
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(output.blob);
    } catch (error) {
      checks.push({
        name: `Archive integrity: ${output.fileName}`,
        status: 'error',
        detail: `Generated output could not be reopened as a ZIP archive: ${error instanceof Error ? error.message : String(error)}`
      });
      continue;
    }

    const paths = new Set(Object.entries(zip.files).filter(([, file]) => !file.dir).map(([path]) => path.replace(/\\/g, '/').toLowerCase()));

    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir || !path.toLowerCase().endsWith('.json')) continue;
      let parsed: any;
      try {
        const raw = await file.async('text');
        parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
      } catch (error) {
        jsonErrors.push(`${output.fileName}:${path} (${error instanceof Error ? error.message : 'invalid JSON'})`);
        continue;
      }
      if (path.toLowerCase() === 'manifest.json' || path.toLowerCase().endsWith('/manifest.json')) {
        if (isObject(parsed)) manifests.push({ fileName: output.fileName, value: parsed });
      }
      if (path.toLowerCase().endsWith('hud_screen.json') && isObject(parsed)) {
        const walk = (value: any): void => {
          if (!isObject(value)) {
            if (Array.isArray(value)) value.forEach(walk);
            return;
          }
          if (Array.isArray(value.modifications)) hudModificationCount += value.modifications.length;
          for (const child of Object.values(value)) walk(child);
        };
        walk(parsed);
      }
      if (/textures\/(?:item_texture|terrain_texture)\.json$/i.test(path) && isObject(parsed?.texture_data)) {
        for (const [key, entry] of Object.entries(parsed.texture_data)) {
          const visit = (value: any): void => {
            if (typeof value === 'string') {
              const texturePath = value.replace(/^textures\//, '').replace(/\\.(png|tga|jpg|jpeg)$/i, '');
              const candidates = [`textures/${texturePath}.png`, `textures/${texturePath}.tga`, `textures/${texturePath}.jpg`, `textures/${texturePath}.jpeg`];
              if (!candidates.some(candidate => paths.has(candidate))) {
                // Vanilla/engine textures may be referenced without being shipped by the pack.
                if (value.startsWith('textures/')) missingTextures.push(`${output.fileName}:${path} -> ${key}: ${value}`);
              }
            } else if (Array.isArray(value)) value.forEach(visit);
            else if (isObject(value)) Object.values(value).forEach(visit);
          };
          visit(entry);
        }
      }
    }
  }

  if (jsonErrors.length) {
    checks.push({ name: 'Generated JSON syntax', status: 'error', detail: `${jsonErrors.length} invalid JSON file(s): ${jsonErrors.slice(0, 8).join('; ')}${jsonErrors.length > 8 ? '; …' : ''}` });
  } else {
    checks.push({ name: 'Generated JSON syntax', status: 'ok', detail: 'All generated JSON files parsed successfully (UTF-8 BOM tolerated during validation).' });
  }

  const seenUuids = new Map<string, string>();
  for (const { fileName, value } of manifests) {
    const headerUuid = normalizedUuid(value.header?.uuid);
    if (!headerUuid) uuidErrors.push(`${fileName}: invalid or missing header UUID`);
    else if (seenUuids.has(headerUuid)) uuidErrors.push(`${fileName}: header UUID duplicates ${seenUuids.get(headerUuid)}`);
    else seenUuids.set(headerUuid, fileName);
    const moduleUuids = new Set<string>();
    for (const module of Array.isArray(value.modules) ? value.modules : []) {
      const uuid = normalizedUuid(module?.uuid);
      if (!uuid) uuidErrors.push(`${fileName}: module "${module?.type ?? 'unknown'}" has invalid or missing UUID`);
      else if (moduleUuids.has(uuid) || seenUuids.has(uuid)) uuidErrors.push(`${fileName}: duplicate UUID ${uuid}`);
      else { moduleUuids.add(uuid); seenUuids.set(uuid, `${fileName} module`); }
    }
  }
  if (uuidErrors.length) checks.push({ name: 'Manifest UUID integrity', status: 'error', detail: uuidErrors.slice(0, 8).join('; ') });
  else checks.push({ name: 'Manifest UUID integrity', status: 'ok', detail: `${manifests.length} manifest(s) have unique, valid header and module UUIDs.` });

  for (const { fileName, value } of manifests) {
    for (const dependency of Array.isArray(value.dependencies) ? value.dependencies : []) {
      const uuid = normalizedUuid(dependency?.uuid);
      if (uuid && !seenUuids.has(uuid)) missingDependencies.push(`${fileName} depends on missing pack UUID ${uuid}`);
    }
  }
  checks.push(missingDependencies.length
    ? { name: 'Manifest dependencies', status: 'error', detail: missingDependencies.slice(0, 8).join('; ') }
    : { name: 'Manifest dependencies', status: 'ok', detail: 'All UUID-based pack dependencies point to generated pack or module UUIDs.' });

  if (missingTextures.length) {
    checks.push({ name: 'Texture atlas references', status: 'warning', detail: `${missingTextures.length} texture reference(s) were not found in the merged RP; some may be engine-provided: ${missingTextures.slice(0, 6).join('; ')}` });
  } else {
    checks.push({ name: 'Texture atlas references', status: 'ok', detail: 'No missing packaged texture references detected in item/terrain texture atlases.' });
  }

  checks.push({
    name: 'HUD patch inventory',
    status: 'ok',
    detail: hudModificationCount ? `${hudModificationCount} HUD modification patch(es) found across generated outputs. Patch conflicts can be order-dependent and are not fully decidable statically.` : 'No HUD modification patches found in generated JSON.'
  });

  return checks;
}
