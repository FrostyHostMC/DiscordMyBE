import { authorizeWorkspaceRequest, type WorkspaceDiscordEnv } from '../../_shared/discordWorkspaceAuth';

/**
 * Private per-Discord-account file storage.
 * kind=pack (default): source addon archive.
 * kind=output&key=<output id>: generated project output.
 * kind=combined&key=combined: combined .mcaddon archive.
 * All keys are scoped to the authenticated Discord account and role-checked.
 */
interface Env extends WorkspaceDiscordEnv {
  BUCKET: R2Bucket;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0', 'vary': 'Authorization' },
});
function objectKey(userId: string, id: string, url: URL): string | Response {
  if (!id || id.length > 200) return json({ error: 'Invalid file id.' }, 400);
  const kind = url.searchParams.get('kind') || 'pack';
  if (kind === 'pack') return `private-workspaces/${userId}/packs/${encodeURIComponent(id)}`;
  if (kind !== 'output' && kind !== 'combined') return json({ error: 'Invalid file kind.' }, 400);
  const key = url.searchParams.get('key') || '';
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(key)) return json({ error: 'Invalid project file key.' }, 400);
  if (kind === 'combined' && key !== 'combined') return json({ error: 'Invalid combined file key.' }, 400);
  return `private-workspaces/${userId}/projects/${encodeURIComponent(id)}/${kind}/${encodeURIComponent(key)}`;
}
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = await authorizeWorkspaceRequest(request, env);
  if (userId instanceof Response) return userId;
  const key = objectKey(userId, String(params.id || ''), new URL(request.url));
  if (key instanceof Response) return key;
  const object = await env.BUCKET.get(key);
  if (!object) return json({ error: 'Workspace file not found.' }, 404);
  return new Response(object.body, { headers: {
    'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
    'content-length': String(object.size), 'cache-control': 'no-store, max-age=0',
    'content-disposition': 'attachment', 'vary': 'Authorization',
  } });
};
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = await authorizeWorkspaceRequest(request, env);
  if (userId instanceof Response) return userId;
  const key = objectKey(userId, String(params.id || ''), new URL(request.url));
  if (key instanceof Response) return key;
  const length = Number(request.headers.get('content-length') || 0);
  if (!request.body) return json({ error: 'File body is required.' }, 400);
  if (length > 100 * 1024 * 1024) return json({ error: 'Workspace files may not exceed 100 MB.' }, 413);
  await env.BUCKET.put(key, request.body, { httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' } });
  return json({ saved: true });
};
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = await authorizeWorkspaceRequest(request, env);
  if (userId instanceof Response) return userId;
  const key = objectKey(userId, String(params.id || ''), new URL(request.url));
  if (key instanceof Response) return key;
  await env.BUCKET.delete(key);
  return json({ deleted: true });
};
