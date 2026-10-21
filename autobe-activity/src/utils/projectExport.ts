// Project export: bundles all stored packs, modpacks, and metadata into a zip archive.
import JSZip from 'jszip';
import { AddonPack, MergedModpack } from '@/types/modpack';
import { getAllPacksFromDB, getAllModpacksFromDB } from '@/utils/storage';
import { describeError } from '@/utils/errorLog';

export interface ExportResult {
  blob: Blob;
  fileName: string;
  packCount: number;
  modpackCount: number;
  warnings: string[];
}

interface ExportManifest {
  app: string;
  version: string;
  exportedAt: string;
  packCount: number;
  modpackCount: number;
  packs: Array<{ id: string; name: string; type: string; version: string; uuid: string; folder: string }>;
  modpacks: Array<{ id: string; name: string; version: string; createdAt: number; folder: string }>;
}

/** Strips characters unsafe for archive entry names. */
function safeFolderName(name: string, fallback: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

async function addPackToZip(zip: JSZip, pack: AddonPack, folder: string, warnings: string[]): Promise<void> {
  const entry = zip.folder(folder);
  if (!entry) return;
  entry.file('pack.json', JSON.stringify({ ...pack, fileBlob: undefined }, null, 2));
  if (pack.iconDataUrl) {
    entry.file('icon.source.txt', 'iconDataUrl embedded in pack.json');
  }
  if (pack.fileBlob instanceof Blob) {
    try {
      entry.file('source.mcpack', pack.fileBlob);
    } catch (e) {
      warnings.push(`Pack "${pack.name}": could not read source archive (${describeError(e)}).`);
    }
  } else {
    warnings.push(`Pack "${pack.name}": raw source archive was not retained, exporting metadata only.`);
  }
}

async function addModpackToZip(zip: JSZip, modpack: MergedModpack, folder: string, warnings: string[]): Promise<void> {
  const entry = zip.folder(folder);
  if (!entry) return;
  entry.file('modpack.json', JSON.stringify({ ...modpack, outputBlob: undefined, outputs: modpack.outputs?.map((o) => ({ ...o, blob: undefined })) }, null, 2));
  if (modpack.outputBlob instanceof Blob) {
    try {
      entry.file(modpack.outputFileName || 'output.mcaddon', modpack.outputBlob);
    } catch (e) {
      warnings.push(`Modpack "${modpack.name}": could not read output blob (${describeError(e)}).`);
    }
  }
  const outputs = modpack.outputs ?? [];
  outputs.forEach((out, i) => {
    if (out.blob instanceof Blob) {
      entry?.file(`outputs/${String(i).padStart(2, '0')}_${out.fileName || out.label}`, out.blob);
    }
  });
}

/**
 * Serializes the full project (all packs + modpacks + manifest) into a zip.
 * Throws when the archive cannot be generated or fails the integrity check.
 */
export async function buildProjectArchive(
  appVersion = 'v2.3.0'
): Promise<ExportResult> {
  const [packs, modpacks] = await Promise.all([getAllPacksFromDB(), getAllModpacksFromDB()]);

  const zip = new JSZip();
  const warnings: string[] = [];
  const usedNames = new Set<string>();
  const uniqueFolder = (name: string, prefix: string, idx: number): string => {
    let folder = safeFolderName(name, `${prefix}_${idx}`);
    if (usedNames.has(folder)) folder = `${prefix}_${idx}_${folder}`;
    usedNames.add(folder);
    return folder;
  };

  const packIndex: ExportManifest['packs'] = [];
  for (let i = 0; i < packs.length; i++) {
    const pack = packs[i];
    const folder = uniqueFolder(pack.name, 'pack', i);
    packIndex.push({ id: pack.id, name: pack.name, type: pack.type, version: pack.version, uuid: pack.uuid, folder: `packs/${folder}` });
    await addPackToZip(zip.folder('packs')!, pack, folder, warnings);
  }

  const modpackIndex: ExportManifest['modpacks'] = [];
  for (let i = 0; i < modpacks.length; i++) {
    const modpack = modpacks[i];
    const folder = uniqueFolder(modpack.name, 'modpack', i);
    modpackIndex.push({ id: modpack.id, name: modpack.name, version: modpack.version, createdAt: modpack.createdAt, folder: `modpacks/${folder}` });
    await addModpackToZip(zip.folder('modpacks')!, modpack, folder, warnings);
  }

  const manifest: ExportManifest = {
    app: 'AutoBE Studio',
    version: appVersion,
    exportedAt: new Date().toISOString(),
    packCount: packs.length,
    modpackCount: modpacks.length,
    packs: packIndex,
    modpacks: modpackIndex
  };
  zip.file('project.json', JSON.stringify(manifest, null, 2));
  zip.file('README.txt', [
    'AutoBE Studio - Project Export',
    '==============================',
    `Exported: ${manifest.exportedAt}`,
    `Packs: ${manifest.packCount} (in packs/)`,
    `Modpacks: ${manifest.modpackCount} (in modpacks/)`,
    '',
    'project.json describes the archive layout and each entry.',
    'Each pack folder contains pack.json metadata and, when retained, the original source.mcpack.'
  ].join('\n'));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  if (!blob || blob.size === 0) {
    throw new Error('Archive generation produced an empty file.');
  }

  // Integrity check: confirm every index entry resolves to a real archive file.
  for (const p of packIndex) {
    if (!zip.file(`${p.folder}/pack.json`)) {
      throw new Error(`Integrity check failed: missing entry for pack "${p.name}".`);
    }
  }
  for (const m of modpackIndex) {
    if (!zip.file(`${m.folder}/modpack.json`)) {
      throw new Error(`Integrity check failed: missing entry for modpack "${m.name}".`);
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob,
    fileName: `autobe_project_export_${stamp}.zip`,
    packCount: packs.length,
    modpackCount: modpacks.length,
    warnings
  };
}