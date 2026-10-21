// Pack customization: rewrite manifest name/description/author and pack_icon
// inside already-merged .mcaddon / .mcpack blobs (port of legacy
// AutoBE `_update_mcpack_metadata` + `_show_customize_merged_pack_dialog`).
import JSZip from 'jszip';

export interface PackCustomization {
  name: string;
  description: string;
  author: string;
  iconFile?: File | null;
}

interface ManifestLike {
  header?: Record<string, unknown>;
  modules?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

function applyManifestEdits(
  manifest: ManifestLike,
  custom: PackCustomization
): ManifestLike {
  const header = { ...(manifest.header || {}) };
  header.name = custom.name;
  header.description = custom.description;
  manifest.header = header;

  const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
  if (modules.length > 0 && modules[0]) {
    modules[0] = { ...modules[0], description: custom.description };
  }
  manifest.modules = modules;

  if (custom.author && custom.author.trim()) {
    const meta = { ...(manifest.metadata || {}) };
    meta.authors = [custom.author.trim()];
    manifest.metadata = meta;
  }
  return manifest;
}

async function rewriteSingleMcpack(
  packBlob: Blob,
  custom: PackCustomization,
  iconData: Uint8Array | null
): Promise<Blob> {
  const zip = await JSZip.loadAsync(packBlob);

  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (entry.dir) continue;
    const lower = path.toLowerCase();
    const fileName = lower.split('/').pop() || '';

    if (fileName === 'manifest.json') {
      try {
        const text = await entry.async('string');
        const parsed = JSON.parse(text) as ManifestLike;
        const edited = applyManifestEdits(parsed, custom);
        zip.file(path, JSON.stringify(edited, null, 2));
      } catch {
        // Non-JSON or protected manifest — leave untouched (legacy behaviour).
      }
      continue;
    }

    // Remove old pack icons when a custom icon is provided.
    if (iconData && /^pack_icon\.(png|jpg|jpeg)$/i.test(fileName)) {
      zip.remove(path);
    }
  }

  // Inject the custom icon next to each manifest (matching legacy behaviour).
  if (iconData) {
    const manifestDirs = new Set<string>();
    for (const path of Object.keys(zip.files)) {
      if (path.toLowerCase().endsWith('manifest.json')) {
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
        manifestDirs.add(dir);
      }
    }
    for (const dir of manifestDirs) {
      zip.file(`${dir}pack_icon.png`, iconData);
    }
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

async function readIconBytes(custom: PackCustomization): Promise<Uint8Array | null> {
  if (!custom.iconFile) return null;
  const buf = await custom.iconFile.arrayBuffer();
  return new Uint8Array(buf);
}

/** Rewrite every embedded .mcpack inside a combined .mcaddon blob. */
export async function customizeMergedPackBlob(
  mcaddonBlob: Blob,
  custom: PackCustomization
): Promise<Blob> {
  const iconData = await readIconBytes(custom);
  const outer = await JSZip.loadAsync(mcaddonBlob);

  for (const path of Object.keys(outer.files)) {
    const entry = outer.files[path];
    if (entry.dir) continue;
    if (!path.toLowerCase().endsWith('.mcpack')) continue;
    const innerBlob = await entry.async('blob');
    const rewritten = await rewriteSingleMcpack(innerBlob, custom, iconData);
    outer.file(path, rewritten);
  }

  // Keep the merge manifest's modpack name in sync.
  const manifestPath = Object.keys(outer.files).find(
    (p) => p.toLowerCase().endsWith('_autobe_merge_manifest.json') && !outer.files[p].dir
  );
  if (manifestPath) {
    try {
      const meta = JSON.parse(await outer.files[manifestPath].async('string'));
      meta.modpackName = custom.name;
      outer.file(manifestPath, JSON.stringify(meta, null, 2));
    } catch {
      // Keep original manifest if unparsable.
    }
  }

  return outer.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** Rewrite a standalone .mcpack blob (used for individual output packages). */
export async function customizeSingleMcpackBlob(
  packBlob: Blob,
  custom: PackCustomization
): Promise<Blob> {
  const iconData = await readIconBytes(custom);
  return rewriteSingleMcpack(packBlob, custom, iconData);
}