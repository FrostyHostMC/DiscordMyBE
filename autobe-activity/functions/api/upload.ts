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
  DISCORD_CLIENT_ID: string;
  PUBLIC_BASE_URL?: string;
}

const MAX_BYTES = 600 * 1024 * 1024;
const MAX_PARTS = 200;

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

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.BUCKET) {
    return json({ error: 'File storage (R2 bucket binding "BUCKET") is not configured on the server.' }, 500);
  }

  const userId = await authenticate(request, env);
  if (!userId) return json({ error: 'Not signed in with Discord. Close and reopen the Activity.' }, 401);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    if (action === 'create' && request.method === 'POST') {
      const body = (await request.json()) as { fileName?: string; kind?: string; size?: number };
      const kind = body.kind === 'pub' ? 'pub' : 'temp';
      const size = Number(body.size) || 0;
      if (size <= 0 || size > MAX_BYTES) {
        return json({ error: `File must be between 1 byte and ${Math.round(MAX_BYTES / 1048576)} MB.` }, 413);
      }
      const fileName = safeName(String(body.fileName || 'file.bin'));
      const key = `${kind}/${userId}/${crypto.randomUUID()}/${fileName}`;
      const upload = await env.BUCKET.createMultipartUpload(key, {
        httpMetadata: {
          contentType: 'application/octet-stream',
          contentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
        },
      });
      return json({ key, uploadId: upload.uploadId });
    }

    // All remaining actions operate on a key this user created.
    const ownsKey = (key: string | null): key is string => {
      if (!key) return false;
      const [kind, owner] = key.split('/');
      return (kind === 'temp' || kind === 'pub') && owner === userId;
    };

    if (action === 'part' && request.method === 'PUT') {
      const key = url.searchParams.get('key');
      const uploadId = url.searchParams.get('uploadId');
      const partNumber = Number(url.searchParams.get('partNumber'));
      if (!ownsKey(key) || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
        return json({ error: 'Bad upload part request.' }, 400);
      }
      const data = await request.arrayBuffer();
      if (data.byteLength === 0) return json({ error: 'Empty part.' }, 400);
      const part = await env.BUCKET.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, data);
      return json({ partNumber: part.partNumber, etag: part.etag });
    }

    if (action === 'complete' && request.method === 'POST') {
      const body = (await request.json()) as {
        key?: string;
        uploadId?: string;
        parts?: Array<{ partNumber: number; etag: string }>;
      };
      if (!ownsKey(body.key ?? null) || !body.uploadId || !Array.isArray(body.parts) || body.parts.length === 0) {
        return json({ error: 'Bad complete request.' }, 400);
      }
      const parts = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
      await env.BUCKET.resumeMultipartUpload(body.key!, body.uploadId).complete(parts);
      const base = (env.PUBLIC_BASE_URL || url.origin).replace(/\/+$/, '');
      return json({ key: body.key, url: `${base}/api/files/${encodeKey(body.key!)}` });
    }

    if (action === 'abort' && request.method === 'POST') {
      const body = (await request.json()) as { key?: string; uploadId?: string };
      if (ownsKey(body.key ?? null) && body.uploadId) {
        await env.BUCKET.resumeMultipartUpload(body.key!, body.uploadId).abort().catch(() => {});
      }
      return json({ ok: true });
    }

    return json({ error: 'Unknown upload action.' }, 400);
  } catch (error) {
    console.error('[AutoBE] Upload error:', error);
    return json({ error: `Upload failed on the server: ${error instanceof Error ? error.message : String(error)}` }, 500);
  }
};
