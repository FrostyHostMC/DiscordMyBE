/**
 * Private pack-file endpoint: /api/workspace/files/:id
 * All operations authenticate the Discord user and re-check the required role.
 */
interface Env {
  BUCKET: R2Bucket;
  DISCORD_CLIENT_ID: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_GUILD_ID: string;
  DISCORD_REQUIRED_ROLE_ID: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0', 'vary': 'Authorization' },
});

async function authorize(request: Request, env: Env): Promise<string | Response> {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !env.DISCORD_REQUIRED_ROLE_ID) {
    return json({ error: 'Private workspace access is not configured.' }, 503);
  }
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: 'Discord authentication is required.' }, 401);
  try {
    const meRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { authorization: `Bearer ${token}` } });
    if (meRes.status === 401) return json({ error: 'Discord session expired. Reopen AutoBE.' }, 401);
    if (!meRes.ok) return json({ error: 'Discord account verification failed.' }, 502);
    const me = await meRes.json() as { id?: string };
    if (!me.id) return json({ error: 'Discord could not verify your account.' }, 401);
    const memberRes = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/members/${encodeURIComponent(me.id)}`, {
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    if (memberRes.status === 404) return json({ error: 'Join the AutoBE server and get the required role.' }, 403);
    if (!memberRes.ok) return json({ error: 'Could not verify the required Discord role.' }, 502);
    const member = await memberRes.json() as { roles?: string[] };
    if (!member.roles?.includes(env.DISCORD_REQUIRED_ROLE_ID)) return json({ error: 'You need the required AutoBE role.' }, 403);
    return me.id;
  } catch {
    return json({ error: 'Could not verify your Discord account. Please retry.' }, 502);
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = await authorize(request, env);
  if (userId instanceof Response) return userId;
  const id = String(params.id || '');
  if (!id || id.length > 200) return json({ error: 'Invalid file id.' }, 400);
  const object = await env.BUCKET.get(`private-workspaces/${userId}/packs/${encodeURIComponent(id)}`);
  if (!object) return json({ error: 'Pack file not found.' }, 404);
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
      'content-length': String(object.size),
      'cache-control': 'no-store, max-age=0',
      'content-disposition': 'attachment',
    },
  });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = await authorize(request, env);
  if (userId instanceof Response) return userId;
  const id = String(params.id || '');
  const length = Number(request.headers.get('content-length') || 0);
  if (!id || id.length > 200) return json({ error: 'Invalid file id.' }, 400);
  if (!request.body) return json({ error: 'Pack file body is required.' }, 400);
  if (length > 100 * 1024 * 1024) return json({ error: 'Pack files may not exceed 100 MB.' }, 413);
  await env.BUCKET.put(`private-workspaces/${userId}/packs/${encodeURIComponent(id)}`, request.body, {
    httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' },
  });
  return json({ saved: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = await authorize(request, env);
  if (userId instanceof Response) return userId;
  const id = String(params.id || '');
  if (!id || id.length > 200) return json({ error: 'Invalid file id.' }, 400);
  await env.BUCKET.delete(`private-workspaces/${userId}/packs/${encodeURIComponent(id)}`);
  return json({ deleted: true });
};
