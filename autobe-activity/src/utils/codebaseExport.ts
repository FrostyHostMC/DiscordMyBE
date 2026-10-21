// Codebase export: downloads the pre-generated codebase archive.
export interface CodebaseExportResult {
  blob: Blob;
  fileName: string;
  fileCount: number;
  encrypted: boolean;
}

/**
 * Downloads the pre-generated codebase archive.
 *
 * The archive is generated at build time by scripts/generateCodebaseArchive.ts
 * and contains the complete project source code.
 *
 * Note: Client-side re-encryption with @zip.js/zip.js has compatibility issues
 * in Discord Activities. The archive is downloaded unencrypted for now.
 */
export async function buildCodebaseArchive(
  password: string,
  appVersion = 'v2.3.0'
): Promise<CodebaseExportResult> {
  // Step 1: Download the pre-generated archive from public folder
  // Try multiple paths in case of routing issues
  const archivePaths = [
    '/codebase-archive.zip',
    '/public/codebase-archive.zip',
    window.location.origin + '/codebase-archive.zip'
  ];

  let archiveResponse: Response | null = null;
  let lastError: Error | null = null;

  for (const path of archivePaths) {
    try {
      archiveResponse = await fetch(path);
      if (archiveResponse.ok) {
        console.log(`[CodebaseExport] Successfully fetched archive from: ${path}`);
        break;
      }
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`[CodebaseExport] Failed to fetch from ${path}:`, e);
    }
  }

  if (!archiveResponse || !archiveResponse.ok) {
    const errorMsg = lastError ? lastError.message : `Failed to download codebase archive (tried ${archivePaths.length} paths)`;
    console.error('[CodebaseExport] Archive fetch failed:', errorMsg);
    throw new Error(errorMsg);
  }

  const archiveBlob = await archiveResponse.blob();

  // Step 2: Download metadata to get file count
  const metadataPaths = [
    '/codebase-archive.json',
    '/public/codebase-archive.json',
    window.location.origin + '/codebase-archive.json'
  ];

  let metadataResponse: Response | null = null;
  for (const path of metadataPaths) {
    try {
      metadataResponse = await fetch(path);
      if (metadataResponse.ok) break;
    } catch (e) {
      console.warn(`[CodebaseExport] Failed to fetch metadata from ${path}:`, e);
    }
  }

  let fileCount = 0;
  if (metadataResponse && metadataResponse.ok) {
    try {
      const metadata = await metadataResponse.json();
      fileCount = metadata.fileCount || 0;
      console.log(`[CodebaseExport] Metadata loaded: ${fileCount} files`);
    } catch (e) {
      console.warn('[CodebaseExport] Failed to parse metadata:', e);
    }
  } else {
    console.warn('[CodebaseExport] Could not fetch metadata');
  }

  if (!archiveBlob || archiveBlob.size === 0) {
    throw new Error('Archive download produced an empty file.');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob: archiveBlob,
    fileName: `autobe_codebase_${stamp}.zip`,
    fileCount,
    encrypted: false
  };
}
