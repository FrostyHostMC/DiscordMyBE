/**
 * MCPACKER utilities - Ported from AutoBE.py
 * Handles recursive extraction, folder-to-mcpack conversion, and pack validation
 */
import JSZip from 'jszip';

export interface PackInfo {
  name: string;
  path: string;
  isValid: boolean;
  hasManifest: boolean;
  hasIcon: boolean;
}

export interface ExtractionResult {
  packs: PackInfo[];
  totalFiles: number;
  errors: string[];
}

/**
 * Check if a folder is a valid Minecraft Bedrock pack
 * Must have manifest.json and pack_icon (png/jpg) at root
 */
export function isPackFolder(files: Map<string, Uint8Array>): boolean {
  const hasManifest = Array.from(files.keys()).some(f => 
    f.toLowerCase() === 'manifest.json' || f.toLowerCase().endsWith('/manifest.json')
  );
  
  const hasIcon = Array.from(files.keys()).some(f => 
    f.toLowerCase().match(/pack_icon\.(png|jpg|jpeg)$/)
  );
  
  return hasManifest && hasIcon;
}

/**
 * Recursively extract nested mcpack/mcaddon/zip files
 * Returns all valid pack folders found
 */
export async function recursiveExtractPack(
  archive: File,
  maxDepth: number = 10
): Promise<ExtractionResult> {
  const results: ExtractionResult = {
    packs: [],
    totalFiles: 0,
    errors: []
  };

  const zip = await JSZip.loadAsync(archive);
  const files = new Map<string, Uint8Array>();

  // Extract all files
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (path.includes('__MACOSX')) continue;
    
    try {
      const content = await entry.async('uint8array');
      files.set(path, content);
      results.totalFiles++;
    } catch (e) {
      results.errors.push(`Failed to extract ${path}: ${e}`);
    }
  }

  // Check if root is a valid pack
  if (isPackFolder(files)) {
    results.packs.push({
      name: archive.name.replace(/\.(mcpack|mcaddon|zip)$/i, ''),
      path: 'root',
      isValid: true,
      hasManifest: true,
      hasIcon: true
    });
    return results;
  }

  // Check for nested archives
  for (const [path, content] of files.entries()) {
    const lowerPath = path.toLowerCase();
    if (lowerPath.endsWith('.mcpack') || lowerPath.endsWith('.mcaddon') || lowerPath.endsWith('.zip')) {
      try {
        const nestedArchive = new File([content], path.split('/').pop() || 'archive.zip');
        const nestedResults = await recursiveExtractPack(nestedArchive, maxDepth - 1);
        results.packs.push(...nestedResults.packs);
        results.totalFiles += nestedResults.totalFiles;
        results.errors.push(...nestedResults.errors);
      } catch (e) {
        results.errors.push(`Failed to extract nested archive ${path}: ${e}`);
      }
    }
  }

  // Check for folder structures that might be packs
  const folders = new Map<string, Map<string, Uint8Array>>();
  for (const [path, content] of files.entries()) {
    const parts = path.split('/');
    if (parts.length > 1) {
      const folder = parts[0];
      if (!folders.has(folder)) {
        folders.set(folder, new Map());
      }
      folders.get(folder)!.set(path.substring(folder.length + 1), content);
    }
  }

  for (const [folderName, folderFiles] of folders.entries()) {
    if (isPackFolder(folderFiles)) {
      results.packs.push({
        name: folderName,
        path: folderName,
        isValid: true,
        hasManifest: true,
        hasIcon: true
      });
    }
  }

  return results;
}

/**
 * Convert a folder of files to a .mcpack archive
 */
export async function folderToMcpack(
  files: File[],
  folderName: string
): Promise<Blob> {
  const zip = new JSZip();
  
  for (const file of files) {
    const relativePath = file.webkitRelativePath 
      ? file.webkitRelativePath.split('/').slice(1).join('/')
      : file.name;
    
    const content = await file.arrayBuffer();
    zip.file(relativePath, content);
  }
  
  return await zip.generateAsync({ type: 'blob' });
}

/**
 * Safe file name sanitization
 */
export function safeFileName(value: string): string {
  const FORBIDDEN = '<>:"/\\|?*';
  return Array.from(value, (ch) => 
    (ch.charCodeAt(0) <= 0x1f || FORBIDDEN.includes(ch)) ? '_' : ch
  ).join('').replace(/[. ]+$/g, '').trim() || 'Addon';
}

/**
 * Safe archive path validation
 */
export function safeArchivePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null;
  const parts = normalized.split('/').filter((part) => part && part !== '.');
  return parts.length > 0 && !parts.includes('..') ? parts.join('/') : null;
}
