/**
 * Starts a browser download for a generated file.
 *
 * Mobile browsers (especially iOS Safari and in-app WebViews) can take a long
 * time to finish writing a Blob download. Revoking the object URL too early
 * aborts the transfer mid-way, producing a truncated/partial archive, so the
 * URL is kept alive for a full minute before cleanup.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Keep the URL alive long enough for slow mobile downloads to complete.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Creates a persistent download link for a blob; caller must call dispose(). */
export function createPersistentDownload(blob: Blob, fileName: string): { url: string; dispose: () => void } {
  const url = URL.createObjectURL(blob);
  return { url, dispose: () => URL.revokeObjectURL(url) };
}