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

  // Discover the subpack folders that physically exist in the archive so we can
  // resolve the manifest-declared folder name even when its casing / spacing
  // does not exactly match the zip paths (a very common addon quirk).
  const subpackDirs = new Set<string>();
  for (const path of Object.keys(zip.files)) {
    const m = path.toLowerCase().match(/^subpacks\/([^/]+)\//);
    if (m) subpackDirs.add(m[1]);
  }

  console.log('[SubpackSelection] Requested variant:', folderName);
  console.log('[SubpackSelection] Available subpack folders:', [...subpackDirs]);

  let resolved = folderName.trim();
  const wantedLower = resolved.toLowerCase();
  if (!subpackDirs.has(wantedLower)) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const fuzzy =
      [...subpackDirs].find((d) => norm(d) === norm(folderName)) ||
      [...subpackDirs].find((d) => norm(d).startsWith(norm(folderName)));
    if (fuzzy) {
      resolved = fuzzy;
    } else if (subpackDirs.size > 0) {
      console.warn(
        `[Aippy] Subpack "${folderName}" not found in archive; available: ${[...subpackDirs].join(', ')} — using the first available variant.`
      );
      resolved = [...subpackDirs][0];
    } else {
      console.warn('[Aippy] No subpacks/ folders found in archive; skipping variant extraction.');
    }
  }

  const prefix = `subpacks/${resolved}/`;
  const prefixLower = prefix.toLowerCase();

  console.log('[SubpackSelection] Using prefix:', prefix, 'resolved:', resolved);

  let extractedCount = 0;
  let skippedCount = 0;
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
        // JSZip will overwrite if file exists, which matches AutoBE's behavior
        if (!out.file(outPath)) {
          out.file(outPath, await f.async('uint8array'));
          extractedCount++;
        } else {
          // File already exists at root - AutoBE would overwrite, so we do too
          out.file(outPath, await f.async('uint8array'));
          extractedCount++;
        }
      } else {
        skippedCount++;
      }
      continue;
    }
    out.file(path, await f.async('uint8array'));
  }
  const data = await out.generateAsync({ type: 'uint8array' });
  console.log('[SubpackSelection] Extracted', extractedCount, 'files from subpack, skipped', skippedCount, 'unselected files, output size:', data.length);
  return new Blob([data], { type: 'application/octet-stream' });
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