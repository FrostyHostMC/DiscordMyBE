/**
 * GET/HEAD /api/files/<temp|pub>/<userId>/<uuid>/<fileName>
 *
 * Streams a file from R2 with Range support (so large downloads resume) and a
 * Content-Disposition header so browsers save it instead of displaying it.
 * Keys contain a random UUID, so a link only works for whoever was given it.
 */
interface Env {
  BUCKET: R2Bucket;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!env.BUCKET) return new Response('File storage is not configured.', { status: 500 });

  const segments = Array.isArray(params.path) ? params.path : [String(params.path || '')];
  const key = segments.join('/');
  if (!/^(temp|pub)\//.test(key) || key.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  headers.set('accept-ranges', 'bytes');
  headers.set('access-control-allow-origin', '*');
  headers.set('x-content-type-options', 'nosniff');

  if (request.method === 'HEAD') {
    const head = await env.BUCKET.head(key);
    if (!head) return new Response(null, { status: 404 });
    head.writeHttpMetadata(headers as unknown as Headers);
    headers.set('etag', head.httpEtag);
    headers.set('content-length', String(head.size));
    return new Response(null, { status: 200, headers });
  }

  const wantsRange = request.headers.has('range');
  const object = await env.BUCKET.get(key, wantsRange ? { range: request.headers } : undefined);
  if (!object) return new Response('Not found', { status: 404 });

  object.writeHttpMetadata(headers as unknown as Headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', key.startsWith('pub/') ? 'public, max-age=86400' : 'private, max-age=300');

  let status = 200;
  if (wantsRange && object.range) {
    const r = object.range as { offset?: number; length?: number; suffix?: number };
    const start = r.suffix !== undefined ? Math.max(0, object.size - r.suffix) : r.offset ?? 0;
    const end = r.suffix !== undefined ? object.size - 1 : r.length !== undefined ? start + r.length - 1 : object.size - 1;
    headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
    headers.set('content-length', String(end - start + 1));
    status = 206;
  } else {
    headers.set('content-length', String(object.size));
  }

  return new Response((object as R2ObjectBody).body, { status, headers });
};
