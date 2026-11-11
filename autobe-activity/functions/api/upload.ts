/**
 * /api/upload — chunked uploads into Cloudflare R2.
 *
 * Pages Functions cap a single request body at ~100 MB, but merged modpacks
 * can be 300 MB+, so the browser uploads in small parts using R2 multipart:
 *
 *   POST /api/upload?action=create    {fileName, kind, size}      -> {key, uploadId}
 *   PUT  /api/upload?action=part&key=..&uploadId=..&partNumber=N  -> {partNumber, etag}   (raw bytes)
 *   POST /api/upload?action=complete  {key, uploadId, parts}      -> {key, url}
 *   POST /api/upload?action=abort     {key, uploadId}             -> {ok}
 *
 * kind = "temp" (personal download hand-off, expire via lifecycle rule)
 *      | "pub"  (published community modpack, kept)
 *
 * Every call needs `Authorization: Bearer <Discord OAuth token>` issued to THIS
 * Discord application.
 */
interface Env {
  BUCKET: R2Bucket;
  DB: D1Database;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  PUBLIC_BASE_URL?: string;
}

const MAX_BYTES = 500 * 1024 * 1024; // Keep uploads bounded for the small free storage allowance.
const MAX_PUBLISHED_BYTES = 7_000_000_000; // Leave headroom below the nominal 10 GB R2 free allowance.
const MAX_PARTS = 200;
const MAX_PART_BYTES = 10 * 1024 * 1024;
const PUB_UPLOADS_PER_DAY = 3;
const TEMP_UPLOADS_PER_DAY = 20;

async function ensureCommunityTable(env: Env): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS community_modpacks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    author TEXT NOT NULL,
    author_id TEXT NOT NULL,
    version TEXT NOT NULL,
    total_packs INTEGER NOT NULL,
    size INTEGER NOT NULL,
    icon_data_url TEXT,
    created_at INTEGER NOT NULL,
    downloads INTEGER DEFAULT 0,
    blob_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    included_packs TEXT
  )`).run();
}

async function consumeDailyQuota(env: Env, userId: string, kind: string): Promise<number> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS autobe_rate_limits (
    scope TEXT NOT NULL,
    user_id TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    request_count INTEGER NOT NULL,
    PRIMARY KEY (scope, user_id)
  )`).run();
  const now = Date.now();
  const windowStart = now - 24 * 60 * 60 * 1000;
  const row = await env.DB.prepare(`
    INSERT INTO autobe_rate_limits (scope, user_id, window_start, request_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(scope, user_id) DO UPDATE SET
      window_start = CASE WHEN autobe_rate_limits.window_start <= ? THEN ? ELSE autobe_rate_limits.window_start END,
      request_count = CASE WHEN autobe_rate_limits.window_start <= ? THEN 1 ELSE autobe_rate_limits.request_count + 1 END
    RETURNING request_count
  `).bind(`upload:${kind}`, userId, now, windowStart, now, windowStart).first<{ request_count: number }>();
  return Number(row?.request_count || 0);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function authenticate(request: Request, env: Env): Promise<string | null> {
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    const res = await fetch('https://discord.com/api/v10/oauth2/@me', {
      headers: { authorization: `Bearer ${match[1]}` },
    });
    if (!res.ok) return null;
    const info = (await res.json()) as { application?: { id?: string }; user?: { id?: string } };
    if (!info.user?.id || info.application?.id !== env.DISCORD_CLIENT_ID) return null;
    return info.user.id;
  } catch {
    return null;
  }
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ()]/g, '_').replace(/_{2,}/g, '_').trim();
  return (cleaned || 'file.bin').slice(-100);
}

// A 300 MB upload is ~40 requests. Asking Discord to validate the user's token on every one gets
// rate-limited, so Discord is asked ONCE (on "create") and the server then hands back a signed
// upload token (HMAC over key + uploadId) that the remaining requests present instead.
async function sign(env: Env, key: string, uploadId: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(`autobe-upload:${env.DISCORD_CLIENT_SECRET}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(`${key}|${uploadId}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readBodyWithinLimit(request: Request, maxBytes: number): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.BUCKET) {
    return json({ error: 'File storage (R2 bucket binding "BUCKET") is not configured on the server.' }, 500);
  }

  if (!env.DISCORD_CLIENT_SECRET) {
    return json({ error: 'Server is missing DISCORD_CLIENT_SECRET.' }, 500);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    if (action === 'create' && request.method === 'POST') {
      const userId = await authenticate(request, env);
      if (!userId) return json({ error: 'Not signed in with Discord. Close and reopen the Activity.' }, 401);
      const body = (await request.json()) as { fileName?: string; kind?: string; size?: number };
      if (!env.DB) return json({ error: 'Publishing is temporarily unavailable because the rate-limit database is not configured.' }, 503);
      const kind = body.kind === 'pub' ? 'pub' : 'temp';
      const size = Number(body.size) || 0;
      if (size <= 0 || size > MAX_BYTES) {
        return json({ error: `File must be between 1 byte and ${Math.round(MAX_BYTES / 1048576)} MB (free-tier safety limit).` }, 413);
      }
      if (kind === 'pub') {
        try {
          await ensureCommunityTable(env);
          const usage = await env.DB.prepare(
            'SELECT COALESCE(SUM(size), 0) AS published_bytes FROM community_modpacks'
          ).first<{ published_bytes: number }>();
          const publishedBytes = Number(usage?.published_bytes || 0);
          if (publishedBytes + size > MAX_PUBLISHED_BYTES) {
            return json({
              error: 'Community storage is approaching its free-tier safety limit. New publishing is paused to protect existing downloads. Please remove old community packs or try later.',
              code: 'STORAGE_SAFETY_LIMIT',
              publishedBytes,
              safetyLimitBytes: MAX_PUBLISHED_BYTES,
            }, 507);
          }
        } catch (error) {
          console.error('[AutoBE] Storage safety check failed:', error);
          return json({
            error: 'Publishing is temporarily paused because the storage safety check could not run. Please try again later.',
            code: 'STORAGE_CHECK_UNAVAILABLE',
          }, 503);
        }
      }
      const dailyCount = await consumeDailyQuota(env, userId, kind);
      const dailyLimit = kind === 'pub' ? PUB_UPLOADS_PER_DAY : TEMP_UPLOADS_PER_DAY;
      if (dailyCount > dailyLimit) {
        return json({
          error: kind === 'pub'
            ? 'Publishing limit reached: you can publish up to 3 modpacks per 24 hours. Try again later.'
            : 'Upload limit reached: you can create up to 20 temporary downloads per 24 hours. Try again later.',
          code: 'RATE_LIMITED',
          retryAfterSeconds: 86400,
        }, 429);
      }
      const fileName = safeName(String(body.fileName || 'file.bin'));
      const key = `${kind}/${userId}/${crypto.randomUUID()}/${fileName}`;
      const upload = await env.BUCKET.createMultipartUpload(key, {
        customMetadata: { ownerId: userId, kind, declaredSize: String(size) },
        httpMetadata: {
          contentType: 'application/octet-stream',
          contentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
        },
      });
      return json({ key, uploadId: upload.uploadId, uploadToken: await sign(env, key, upload.uploadId) });
    }

    // All remaining actions must present the signed token issued by "create" for this exact upload.
    const presented = request.headers.get('x-upload-token') || '';
    const isAuthorized = async (key: string | null | undefined, uploadId: string | null | undefined) => {
      if (!key || !uploadId || !/^(temp|pub)\//.test(key) || key.includes('..')) return false;
      return presented.length > 0 && presented === (await sign(env, key, uploadId));
    };

    if (action === 'part' && request.method === 'PUT') {
      const key = url.searchParams.get('key');
      const uploadId = url.searchParams.get('uploadId');
      const partNumber = Number(url.searchParams.get('partNumber'));
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
        return json({ error: 'Bad upload part request.' }, 400);
      }
      if (!(await isAuthorized(key, uploadId))) return json({ error: 'Upload token rejected.' }, 401);
      const declaredPartLength = Number(request.headers.get('content-length') || 0);
      if (declaredPartLength > MAX_PART_BYTES) return json({ error: 'Upload part exceeds the 10 MB part limit.' }, 413);
      const data = await readBodyWithinLimit(request, MAX_PART_BYTES);
      if (data === null) return json({ error: 'Upload part exceeds the 10 MB part limit.' }, 413);
      if (data.byteLength === 0) return json({ error: 'Empty part.' }, 400);
      const part = await env.BUCKET.resumeMultipartUpload(key!, uploadId!).uploadPart(partNumber, data);
      return json({ partNumber: part.partNumber, etag: part.etag });
    }

    if (action === 'complete' && request.method === 'POST') {
      const body = (await request.json()) as {
        key?: string;
        uploadId?: string;
        parts?: Array<{ partNumber: number; etag: string }>;
      };
      if (!Array.isArray(body.parts) || body.parts.length === 0 || body.parts.length > MAX_PARTS) {
        return json({ error: 'Bad complete request.' }, 400);
      }
      if (!(await isAuthorized(body.key, body.uploadId))) return json({ error: 'Upload token rejected.' }, 401);
      const seenParts = new Set<number>();
      for (const part of body.parts) {
        if (!Number.isInteger(part?.partNumber) || part.partNumber < 1 || part.partNumber > MAX_PARTS ||
            typeof part.etag !== 'string' || part.etag.length === 0 || part.etag.length > 256 || seenParts.has(part.partNumber)) {
          return json({ error: 'Invalid or duplicate upload part metadata.' }, 400);
        }
        seenParts.add(part.partNumber);
      }
      const parts = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
      await env.BUCKET.resumeMultipartUpload(body.key!, body.uploadId!).complete(parts);
      const completed = await env.BUCKET.head(body.key!);
      if (!completed || completed.customMetadata?.declaredSize !== String(completed.size) ||
          completed.customMetadata?.kind !== body.key!.split('/')[0] ||
          !body.key!.startsWith(String(completed.customMetadata?.kind) + '/' + String(completed.customMetadata?.ownerId) + '/')) {
        await env.BUCKET.delete(body.key!).catch(() => {});
        return json({ error: 'Completed upload failed its ownership or size integrity check.' }, 400);
      }
      // Tolerate stray spaces, slashes or a trailing dot in PUBLIC_BASE_URL (a trailing dot in a
      // hostname breaks the HTTPS connection: "couldn't establish a secure connection").
      const base = (env.PUBLIC_BASE_URL || url.origin).trim().replace(/[\s./]+$/, '');
      return json({ key: body.key, url: `${base}/api/files/${encodeKey(body.key!)}` });
    }

    if (action === 'abort' && request.method === 'POST') {
      const body = (await request.json()) as { key?: string; uploadId?: string };
      if (await isAuthorized(body.key, body.uploadId)) {
        await env.BUCKET.resumeMultipartUpload(body.key!, body.uploadId!).abort().catch(() => {});
      }
      return json({ ok: true });
    }

    return json({ error: 'Unknown upload action.' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[AutoBE] Upload error:', message);
    if (/quota|storage.*(limit|full)|too many requests|rate limit/i.test(message)) {
      return json({
        error: 'Cloud storage is temporarily at a limit. No publish was completed; please try again later.',
        code: 'CLOUD_LIMIT_REACHED',
      }, 503);
    }
    return json({
      error: 'The upload could not be completed. Check your connection and try again. If this keeps happening, the free Cloudflare service may be temporarily unavailable.',
      code: 'UPLOAD_FAILED',
    }, 500);
  }
};
