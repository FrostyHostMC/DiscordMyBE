import JSZip from 'jszip';
import { AddonPack } from '@/types/modpack';
import { sanitizeJsonString } from './addonParser';

/**
 * Port of AutoBE._start_process subpack handling:
 * when a pack declares `subpacks`, extract the user-selected variant folder to
 * the archive root, drop all other variants, and strip `subpacks` from the
 * manifest so the modified copy never triggers the dialog again.
 */
export async function applySubpackSelection(blob: Blob, folderName: string): Promise<Blob> {
  const zip = await JSZip.loadAsync(blob);
  const out = new JSZip();

  // The manifest is the source of truth: Bedrock permits a declared
  // subpack to be an empty overlay (all of its content comes from the base
  // pack). JSZip/browser ZIP readers may omit explicit empty-directory
  // entries, so discovering variants only from physical files incorrectly
  // rejects valid choices such as Refine Sounds' "only_sounds".
  const declaredSubpacks: Array<{ folder: string; name: string }> = [];
  const manifestFile = zip.file(/^manifest\\.json$/i)[0];
  if (manifestFile) {
    try {
      const manifest = JSON.parse(sanitizeJsonString(await manifestFile.async('text')));
      for (const subpack of Array.isArray(manifest.subpacks) ? manifest.subpacks : []) {
        const folder = String(subpack?.folder_name || subpack?.folder || '').trim();
        if (folder && !declaredSubpacks.some((entry) => entry.folder.toLowerCase() === folder.toLowerCase())) {
          declaredSubpacks.push({ folder, name: String(subpack?.name || folder) });
        }
      }
    } catch {
      // Keep physical-folder recovery below for malformed third-party manifests.
    }
  }

  const physicalSubpacks = new Set<string>();
  for (const path of Object.keys(zip.files)) {
    const m = path.match(/^subpacks\\/([^/]+)\\//i);
    if (m) physicalSubpacks.add(m[1]);
  }
  const availableFolders = [
    ...declaredSubpacks.map((entry) => entry.folder),
    ...[...physicalSubpacks].filter((folder) =>
      !declaredSubpacks.some((entry) => entry.folder.toLowerCase() === folder.toLowerCase())
    )
  ];

  console.log('[SubpackSelection] Requested variant:', folderName);
  console.log('[SubpackSelection] Manifest-declared variants:', declaredSubpacks);
  console.log('[SubpackSelection] Physical subpack folders:', [...physicalSubpacks]);

  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const requested = folderName.trim();
  const resolvedDeclared = declaredSubpacks.find((entry) => entry.folder.toLowerCase() === requested.toLowerCase());
  const resolvedPhysical = [...physicalSubpacks].find((folder) => folder.toLowerCase() === requested.toLowerCase());
  const resolved = resolvedDeclared?.folder || resolvedPhysical || availableFolders.find((folder) => norm(folder) === norm(requested)) ||
    availableFolders.find((folder) => norm(folder).startsWith(norm(requested)));

  if (!resolved) {
    if (availableFolders.length > 0) {
      throw new Error(`Selected subpack "${folderName}" was not found. Available variants: ${availableFolders.join(', ')}.`);
    }
    throw new Error(`The pack declares subpack "${folderName}", but no valid subpack metadata or folders were found in its archive.`);
  }

  // Prefer the actual archive folder spelling when present. A manifest-only
  // variant is valid too; it simply contributes no overlay files.
  const physicalFolder = [...physicalSubpacks].find((folder) => folder.toLowerCase() === resolved.toLowerCase());
  const selectedFolder = physicalFolder || resolved;

  const prefix = `subpacks/${selectedFolder}/`;
  const prefixLower = prefix.toLowerCase();

  console.log('[SubpackSelection] Using prefix:', prefix, 'resolved:', resolved, 'manifest-declared:', !!resolvedDeclared);

  let extractedCount = 0;
  let skippedCount = 0;
  const selectedVariantPaths = new Set<string>();
  // A selected variant has higher priority than root/base files, regardless
  // of ZIP entry order. Track its output paths so a later base entry cannot
  // overwrite the selected content.
  for (const [path, f] of Object.entries(zip.files)) {
    if (f.dir) continue;
    const lower = path.toLowerCase();
    if (lower === 'manifest.json') {
      try {
        const manifest = JSON.parse(sanitizeJsonString(await f.async('text')));
        delete manifest.subpacks;
        out.file(path, JSON.stringify(manifest, null, 2));
      } catch {
        out.file(path, await f.async('uint8array'));
      }
      continue;
    }
    if (lower.startsWith('subpacks/')) {
      // Only the chosen variant is kept; everything else under subpacks/ is dropped.
      if (prefixLower && lower.startsWith(prefixLower)) {
        const outPath = path.slice(prefix.length);
        selectedVariantPaths.add(outPath.toLowerCase());
        out.file(outPath, await f.async('uint8array'));
        extractedCount++;
      } else {
        skippedCount++;
      }
      continue;
    }
    // A selected variant has priority over root/base files even when the
    // base entry appears later in the ZIP central directory.
    if (selectedVariantPaths.has(lower)) continue;
    out.file(path, await f.async('uint8array'));
  }
  const data = await out.generateAsync({ type: 'uint8array' });
  console.log('[SubpackSelection] Extracted', extractedCount, 'files from subpack, skipped', skippedCount, 'unselected files, output size:', data.length);
  return new Blob([new Uint8Array(data).buffer as ArrayBuffer], { type: 'application/octet-stream' });
}

export async function applySubpackToPack(pack: AddonPack, folderName: string): Promise<AddonPack> {
  if (!pack.fileBlob) return pack;
  const newBlob = await applySubpackSelection(pack.fileBlob, folderName);
  return {
    ...pack,
    fileBlob: newBlob,
    fileSize: newBlob.size,
    subpacks: undefined,
    sourceFileName: `${pack.sourceFileName} (variant: ${folderName})`
  };
}