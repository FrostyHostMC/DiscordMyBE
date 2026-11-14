interface Env {
  BUCKET: R2Bucket;
  JAVABE_DISCORD_CLIENT_ID: string;
  JAVABE_DISCORD_BOT_TOKEN: string;
  JAVABE_DISCORD_GUILD_ID: string;
  JAVABE_DISCORD_REQUIRED_ROLE_ID: string;
  JAVABE_DISCORD_CLIENT_SECRET: string;
}

const PART_BYTES = 8 * 1024 * 1024;
const MAX_BYTES = 500 * 1024 * 1024;
const MAX_PARTS = 64;
const TEMP_TTL_MS = 2 * 60 * 60 * 1000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function safeName(value: string): string {
  return (value.replace(/[^\w.\- ()]/g, '_').replace(/_{2,}/g, '_').trim() || 'javabe-addon.mcaddon').slice(-100);
}

async function signature(env: Env, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.JAVABE_DISCORD_CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign','verify']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signed))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function authenticate(request: Request, env: Env): Promise<string | null> {
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const response = await fetch('https://discord.com/api/v10/oauth2/@me', { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const oauth = await response.json() as { application?: { id?: string }; user?: { id?: string } };
  if (oauth.application?.id !== env.JAVABE_DISCORD_CLIENT_ID || !oauth.user?.id) return null;
  const memberResponse = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(env.JAVABE_DISCORD_GUILD_ID)}/members/${encodeURIComponent(oauth.user.id)}`, {
    headers: { authorization: `Bot ${env.JAVABE_DISCORD_BOT_TOKEN}` },
  });
  if (!memberResponse.ok) throw new Error(memberResponse.status === 404 ? 'Your JavaBE access role is missing.' : 'Discord role verification is temporarily unavailable.');
  const member = await memberResponse.json() as { roles?: string[] };
  return member.roles?.includes(env.JAVABE_DISCORD_REQUIRED_ROLE_ID) ? oauth.user.id : null;
}

async function readJson<T>(request: Request, limit = 16 * 1024): Promise<T | null> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > limit) return null;
  try { return await request.json() as T; } catch { return null; }
}

async function cleanupExpired(env: Env): Promise<void> {
  const now = Date.now();
  let cursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    const listed = await env.BUCKET.list({ prefix: 'javabe-temp/', cursor, limit: 1000, include: ['customMetadata'] });
    const expired = listed.objects.filter(object => Number(object.customMetadata?.expiresAt || 0) <= now).map(object => object.key);
    if (expired.length) await env.BUCKET.delete(expired);
    if (!listed.truncated || !listed.cursor) break;
    cursor = listed.cursor;
  }
}

async function streamAndDelete(object: R2ObjectBody, key: string, bucket: R2Bucket): Promise<ReadableStream<Uint8Array>> {
  const reader = object.body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          await bucket.delete(key);
        } else controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
        await bucket.delete(key).catch(() => {});
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
      await bucket.delete(key).catch(() => {});
    },
  });
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.BUCKET || !env.JAVABE_DISCORD_CLIENT_SECRET) return json({ error: 'Temporary download delivery is not configured.' }, 503);
  const url = new URL(request.url);
  try {
    if (request.method === 'POST' && url.searchParams.get('action') === 'create') {
      const userId = await authenticate(request, env);
      if (!userId) return json({ error: 'Your JavaBE Discord session or access role could not be verified.' }, 403);
      await cleanupExpired(env);
      const body = await readJson<{ fileName?: string; size?: number }>(request);
      const size = Number(body?.size || 0);
      if (!body || !Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES) return json({ error: 'The generated add-on must be between 1 byte and 500 MB.' }, 413);
      const fileName = safeName(body.fileName || 'javabe-addon.mcaddon');
      const id = crypto.randomUUID();
      const expiresAt = Date.now() + TEMP_TTL_MS;
      const key = `javabe-temp/${userId}/${id}/${fileName}`;
      const upload = await env.BUCKET.createMultipartUpload(key, {
        customMetadata: { ownerId: userId, expiresAt: String(expiresAt), fileName },
        httpMetadata: { contentType: 'application/octet-stream', contentDisposition: `attachment; filename="${fileName}"` },
      });
      const uploadToken = await signature(env, `${key}|${upload.uploadId}|${size}`);
      return json({ key, uploadId: upload.uploadId, uploadToken, size, expiresAt });
    }

    if (request.method === 'PUT' && url.searchParams.get('action') === 'part') {
      const key = url.searchParams.get('key') || '';
      const uploadId = url.searchParams.get('uploadId') || '';
      const size = Number(url.searchParams.get('size'));
      const partNumber = Number(url.searchParams.get('partNumber'));
      const token = request.headers.get('x-upload-token') || '';
      if (!key.startsWith('javabe-temp/') || key.includes('..') || !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS ||
          token !== await signature(env, `${key}|${uploadId}|${size}`)) return json({ error: 'Temporary upload authorization was rejected.' }, 401);
      const expected = Math.min(PART_BYTES, size - (partNumber - 1) * PART_BYTES);
      if (expected <= 0 || Number(request.headers.get('content-length') || 0) > PART_BYTES) return json({ error: 'Invalid upload part size.' }, 413);
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength !== expected) return json({ error: 'Upload part did not match the expected size.' }, 400);
      const part = await env.BUCKET.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, bytes);
      return json({ partNumber: part.partNumber, etag: part.etag });
    }

    if (request.method === 'POST' && url.searchParams.get('action') === 'complete') {
      const body = await readJson<{ key?: string; uploadId?: string; uploadToken?: string; size?: number; parts?: Array<{ partNumber: number; etag: string }> }>(request, 64 * 1024);
      if (!body?.key?.startsWith('javabe-temp/') || !body.uploadId || !body.parts?.length || body.parts.length > MAX_PARTS ||
          body.uploadToken !== await signature(env, `${body.key}|${body.uploadId}|${body.size}`)) return json({ error: 'Temporary upload completion was rejected.' }, 401);
      const ordered = [...body.parts].sort((a,b) => a.partNumber - b.partNumber);
      if (ordered.some((part,index) => part.partNumber !== index + 1 || typeof part.etag !== 'string' || !part.etag)) return json({ error: 'Upload parts are incomplete or invalid.' }, 400);
      await env.BUCKET.resumeMultipartUpload(body.key, body.uploadId).complete(ordered);
      const object = await env.BUCKET.head(body.key);
      if (!object || object.size !== body.size || Number(object.customMetadata?.expiresAt || 0) <= Date.now()) {
        await env.BUCKET.delete(body.key);
        return json({ error: 'The generated add-on failed its upload integrity check.' }, 400);
      }
      const expiresAt = Number(object.customMetadata?.expiresAt || 0);
      const downloadSig = await signature(env, `${body.key}|${expiresAt}`);
      return json({ url: `${url.origin}/api/download?key=${encodeURIComponent(body.key)}&expires=${expiresAt}&sig=${downloadSig}`, expiresAt });
    }

    if (request.method === 'POST' && url.searchParams.get('action') === 'abort') {
      const body = await readJson<{ key?: string; uploadId?: string; uploadToken?: string; size?: number }>(request, 4096);
      if (body?.key?.startsWith('javabe-temp/') && body.uploadId &&
          body.uploadToken === await signature(env, `${body.key}|${body.uploadId}|${body.size}`)) {
        // If completion already succeeded but opening the external link failed, delete
        // the finished temporary object too; otherwise abort the unfinished multipart upload.
        const finished = await env.BUCKET.head(body.key);
        if (finished) await env.BUCKET.delete(body.key);
        else await env.BUCKET.resumeMultipartUpload(body.key, body.uploadId).abort().catch(() => {});
      }
      return json({ ok: true });
    }

    if (request.method === 'GET') {
      const key = url.searchParams.get('key') || '';
      const expires = Number(url.searchParams.get('expires'));
      const sig = url.searchParams.get('sig') || '';
      if (!key.startsWith('javabe-temp/') || key.includes('..') || expires <= Date.now() ||
          sig !== await signature(env, `${key}|${expires}`)) return json({ error: 'This temporary download link has expired or is invalid.' }, 403);
      const object = await env.BUCKET.get(key);
      if (!object || Number(object.customMetadata?.expiresAt || 0) !== expires) return json({ error: 'This temporary add-on is no longer available. Generate it again in JavaBE.' }, 404);
      return new Response(await streamAndDelete(object, key, env.BUCKET), {
        headers: {
          'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
          'content-disposition': object.httpMetadata?.contentDisposition || 'attachment; filename="javabe-addon.mcaddon"',
          'content-length': String(object.size),
          'cache-control': 'private, no-store, max-age=0',
          'x-content-type-options': 'nosniff',
        },
      });
    }
    return json({ error: 'Unknown temporary download action.' }, 400);
  } catch (error) {
    console.error('[JavaBE] Temporary download error:', error);
    return json({ error: error instanceof Error ? error.message : 'Temporary download failed.' }, 500);
  }
};
