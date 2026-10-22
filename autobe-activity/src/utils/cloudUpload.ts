// Uploads a Blob to our own Cloudflare R2 bucket (via /api/upload) in small
// parts, so 300 MB+ modpacks work and no Discord attachment limit applies.
import { getDiscordAuth } from '@/utils/discordAuth';

const PART_SIZE = 8 * 1024 * 1024; // R2 requires >= 5 MB for every part except the last
const CONCURRENCY = 3;
const RETRIES = 3;

export type UploadKind = 'temp' | 'pub';

export class NotSignedInError extends Error {
  constructor() {
    super('Your Discord session was not found. Close and reopen the Activity, then try again.');
  }
}

async function api<T>(query: string, init: RequestInit, token: string): Promise<T> {
  const res = await fetch(`/api/upload?${query}`, {
    ...init,
    cache: 'no-store',
    headers: { ...(init.headers || {}), authorization: `Bearer ${token}` },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Upload server error (HTTP ${res.status}).`);
  return data;
}

export async function uploadToCloud(
  blob: Blob,
  fileName: string,
  kind: UploadKind,
  onProgress?: (percent: number) => void
): Promise<{ url: string; key: string }> {
  const auth = getDiscordAuth();
  if (!auth) throw new NotSignedInError();
  const { token } = auth;

  const { key, uploadId } = await api<{ key: string; uploadId: string }>(
    'action=create',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName, kind, size: blob.size }),
    },
    token
  );

  const totalParts = Math.max(1, Math.ceil(blob.size / PART_SIZE));
  const parts: Array<{ partNumber: number; etag: string }> = new Array(totalParts);
  let nextPart = 0;
  let doneBytes = 0;

  const uploadPart = async (index: number) => {
    const start = index * PART_SIZE;
    const chunk = blob.slice(start, Math.min(start + PART_SIZE, blob.size));
    let lastError: unknown;
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
        const q = `action=part&key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${index + 1}`;
        const result = await api<{ partNumber: number; etag: string }>(
          q,
          { method: 'PUT', body: chunk, headers: { 'content-type': 'application/octet-stream' } },
          token
        );
        parts[index] = { partNumber: result.partNumber, etag: result.etag };
        doneBytes += chunk.size;
        onProgress?.(Math.min(99, Math.round((doneBytes / blob.size) * 100)));
        return;
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Upload part failed.');
  };

  try {
    const worker = async () => {
      while (true) {
        const i = nextPart++;
        if (i >= totalParts) return;
        await uploadPart(i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, totalParts) }, worker));

    const done = await api<{ key: string; url: string }>(
      'action=complete',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, uploadId, parts }),
      },
      token
    );
    onProgress?.(100);
    return done;
  } catch (err) {
    // Best-effort cleanup so half-finished uploads don't linger in the bucket.
    api(
      'action=abort',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, uploadId }),
      },
      token
    ).catch(() => {});
    throw err;
  }
}
