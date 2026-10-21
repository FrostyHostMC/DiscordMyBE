// Codebase export: downloads the pre-generated codebase archive and encrypts it with the user's password.
import { ZipReader, BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';

export interface CodebaseExportResult {
  blob: Blob;
  fileName: string;
  fileCount: number;
  encrypted: boolean;
}

/**
 * Downloads the pre-generated codebase archive,
 * then re-encrypts it with the user's password using AES-256 encryption.
 *
 * The archive is generated at build time by scripts/generateCodebaseArchive.ts
 * and contains the complete project source code.
 *
 * In development mode, the archive is fetched from /public/codebase-archive.zip.
 * In production, it's fetched from /codebase-archive.zip (served from dist/).
 */
export async function buildCodebaseArchive(
  password: string,
  appVersion = 'v2.3.0'
): Promise<CodebaseExportResult> {
  // Step 1: Download the pre-generated archive from public folder
  const archiveResponse = await fetch('/codebase-archive.zip');
  if (!archiveResponse.ok) {
    throw new Error(`Failed to download codebase archive: ${archiveResponse.status}`);
  }

  const archiveBlob = await archiveResponse.blob();

  // Step 2: Download metadata to get file count
  const metadataResponse = await fetch('/codebase-archive.json');
  if (!metadataResponse.ok) {
    throw new Error(`Failed to download codebase metadata: ${metadataResponse.status}`);
  }
  let fileCount = 0;
  if (metadataResponse.ok) {
    const metadata = await metadataResponse.json();
    fileCount = metadata.fileCount || 0;
  }

  // Step 3: Read the unencrypted archive
  const zipReader = new ZipReader(new BlobReader(archiveBlob));
  const entries = await zipReader.getEntries();

  // Step 4: Create a new encrypted archive
  const encryptedZipWriter = new ZipWriter({
    password,
    encryptionMethod: 'AES' // Use AES-256 encryption
  });

  // Step 5: Copy all entries from the unencrypted archive to the encrypted one
  for (const entry of entries) {
    if (!entry.directory) {
      const data = await entry.getData(new BlobWriter());
      await encryptedZipWriter.add(entry.filename, new BlobWriter(), {
        data: new Blob([data])
      });
    } else {
      // Add directory entries
      await encryptedZipWriter.add(entry.filename, new BlobWriter(), {
        data: new Blob([])
      });
    }
  }

  // Step 6: Close the zip reader
  await zipReader.close();

  // Step 7: Generate the encrypted blob
  const encryptedBlob = await encryptedZipWriter.close();

  if (!encryptedBlob || encryptedBlob.size === 0) {
    throw new Error('Encrypted archive generation produced an empty file.');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob: encryptedBlob,
    fileName: `autobe_codebase_${stamp}.zip`,
    fileCount,
    encrypted: true
  };
}
