interface Env { DISCORD_CLIENT_ID: string; DISCORD_CLIENT_SECRET: string; }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return json({ error: 'Discord OAuth is not configured.' }, 500);
  let body: { code?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }
  if (typeof body.code !== 'string' || !body.code || body.code.length > 2048) return json({ error: 'Missing authorization code.' }, 400);
  const form = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: body.code, redirect_uri: 'https://127.0.0.1' });
  const response = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  const result = await response.json() as { access_token?: string; token_type?: string };
  if (!response.ok || !result.access_token) return json({ error: 'Discord authorization could not be completed.' }, 401);
  return json({ access_token: result.access_token, token_type: result.token_type || 'Bearer' });
};
