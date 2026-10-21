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
  const prefix = `subpacks/${folderName}/`;
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
      if (lower.startsWith(prefix)) {
        out.file(path.slice(prefix.length), await f.async('uint8array'));
      }
      continue;
    }
    out.file(path, await f.async('uint8array'));
  }
  const data = await out.generateAsync({ type: 'uint8array' });
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