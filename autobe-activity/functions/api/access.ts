interface Env { DISCORD_BOT_TOKEN: string; DISCORD_GUILD_ID: string; DISCORD_REQUIRED_ROLE_ID: string; }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !env.DISCORD_REQUIRED_ROLE_ID) return json({ error: 'Role verification is not configured.' }, 500);
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ allowed: false, reason: 'Discord authentication is required.' }, 401);
  const meResponse = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${match[1]}` } });
  if (!meResponse.ok) return json({ allowed: false, reason: 'Your Discord session expired. Reopen the Activity.' }, 401);
  const me = await meResponse.json() as { id?: string };
  if (!me.id) return json({ allowed: false, reason: 'Discord could not verify your account.' }, 401);
  const memberResponse = await fetch(`https://discord.com/api/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/members/${encodeURIComponent(me.id)}`, { headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
  if (memberResponse.status === 404) return json({ allowed: false, reason: 'Join the AutoBE Discord server and get the Auto Byte role.' }, 403);
  if (!memberResponse.ok) return json({ error: 'Could not verify server membership. Please try again later.' }, 502);
  const member = await memberResponse.json() as { roles?: string[] };
  if (!Array.isArray(member.roles) || !member.roles.includes(env.DISCORD_REQUIRED_ROLE_ID)) return json({ allowed: false, reason: 'You need the Auto Byte role to use AutoBE.' }, 403);
  return json({ allowed: true });
};
