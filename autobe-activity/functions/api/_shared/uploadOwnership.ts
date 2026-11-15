export interface PublishedUploadMetadata {
  ownerId?: string;
  kind?: string;
  declaredSize?: string;
}

/** Extract only a public R2 key owned by the authenticated account. */
export function getOwnedPublishedObjectKey(blobUrl: string, userId: string, baseUrl: string): string | null {
  try {
    const trustedOrigin = new URL(baseUrl).origin;
    const url = new URL(blobUrl, trustedOrigin);
    if (url.protocol !== 'https:' || url.origin !== trustedOrigin || !url.pathname.startsWith('/api/files/pub/')) return null;
    const key = url.pathname.slice('/api/files/'.length)
      .split('/').map((part) => decodeURIComponent(part)).join('/');
    if (!key.startsWith(`pub/${userId}/`) || key.includes('..')) return null;
    return key;
  } catch {
    return null;
  }
}

/** Validate immutable R2 metadata and actual object size before use or deletion. */
export function isOwnedPublishedObject(
  metadata: PublishedUploadMetadata | undefined,
  actualSize: number,
  ownerId: string,
): boolean {
  return Boolean(metadata &&
    metadata.ownerId === ownerId &&
    metadata.kind === 'pub' &&
    Number.isSafeInteger(actualSize) &&
    actualSize > 0 &&
    metadata.declaredSize === String(actualSize));
}
