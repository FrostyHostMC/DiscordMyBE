interface Env {
  JAVABE_DISCORD_CLIENT_ID: string;
  JAVABE_DISCORD_BOT_TOKEN: string;
  JAVABE_DISCORD_GUILD_ID: string;
  JAVABE_DISCORD_REQUIRED_ROLE_ID: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
  },
});

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.JAVABE_DISCORD_CLIENT_ID || !env.JAVABE_DISCORD_BOT_TOKEN ||
      !env.JAVABE_DISCORD_GUILD_ID || !env.JAVABE_DISCORD_REQUIRED_ROLE_ID) {
    return json({ error: 'JavaBE role access is not configured on the server.' }, 503);
  }

  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ allowed: false, reason: 'Connect your Discord account to continue.' }, 401);

  let meResponse: Response;
  try {
    meResponse = await fetch('https://discord.com/api/v10/oauth2/@me', {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (error) {
    console.error('[JavaBE] Discord identity lookup failed:', error);
    return json({ error: 'Could not reach Discord to verify your account. Please retry.' }, 502);
  }
  if (meResponse.status === 401) {
    return json({ allowed: false, reason: 'Your Discord session expired. Reopen JavaBE.' }, 401);
  }
  if (!meResponse.ok) {
    console.error('[JavaBE] Discord identity lookup rejected:', meResponse.status);
    return json({ error: 'Discord account verification failed. Please retry.' }, 502);
  }

  const oauth = await meResponse.json() as {
    application?: { id?: string };
    user?: { id?: string; username?: string; global_name?: string | null; avatar?: string | null };
  };
  if (oauth.application?.id !== env.JAVABE_DISCORD_CLIENT_ID || !oauth.user?.id) {
    return json({ allowed: false, reason: 'This Discord session was not issued to JavaBE. Reopen the Activity.' }, 401);
  }

  let memberResponse: Response;
  try {
    memberResponse = await fetch(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(env.JAVABE_DISCORD_GUILD_ID)}/members/${encodeURIComponent(oauth.user.id)}`,
      { headers: { authorization: `Bot ${env.JAVABE_DISCORD_BOT_TOKEN}` } },
    );
  } catch (error) {
    console.error('[JavaBE] Discord server membership lookup failed:', error);
    return json({ error: 'Could not reach Discord to verify server access. Please retry.' }, 502);
  }

  if (memberResponse.status === 404) {
    return json({ allowed: false, reason: 'Join the Byte Prison / AutoBE Discord server and get the JavaBE access role.' }, 403);
  }
  if (memberResponse.status === 401 || memberResponse.status === 403) {
    console.error('[JavaBE] Discord bot authorization failed:', memberResponse.status);
    return json({ error: 'JavaBE cannot verify roles. Check that its Discord bot is in the server and can view members.' }, 503);
  }
  if (memberResponse.status === 429) {
    return json({ error: 'Discord is temporarily rate-limiting role checks. Wait a moment and retry.' }, 503);
  }
  if (!memberResponse.ok) {
    console.error('[JavaBE] Discord member lookup failed:', memberResponse.status);
    return json({ error: 'Could not verify your Discord server membership. Please retry.' }, 502);
  }

  const member = await memberResponse.json() as { roles?: string[] };
  if (!Array.isArray(member.roles) || !member.roles.includes(env.JAVABE_DISCORD_REQUIRED_ROLE_ID)) {
    return json({ allowed: false, reason: 'You need the JavaBE access role to open this Activity.' }, 403);
  }

  return json({
    allowed: true,
    user: {
      id: oauth.user.id,
      username: oauth.user.username || 'Discord user',
      global_name: oauth.user.global_name ?? null,
      avatar: oauth.user.avatar ?? null,
    },
  });
};
