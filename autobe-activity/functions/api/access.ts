interface Env {
  DISCORD_BOT_TOKEN: string;
  DISCORD_GUILD_ID: string;
  DISCORD_REQUIRED_ROLE_ID: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !env.DISCORD_REQUIRED_ROLE_ID) {
    return json({ error: 'Role verification is not configured on the server.' }, 500);
  }

  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return json({ allowed: false, reason: 'Discord authentication is required.' }, 401);
  }

  // Validate the user's OAuth token with Discord; never trust a user ID supplied by the browser.
  let meResponse: Response;
  try {
    meResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bearer ${match[1]}` },
    });
  } catch (error) {
    console.error('[AutoBE] Discord user lookup network error:', error);
    return json({ error: 'Could not reach Discord to verify your account. Please retry.' }, 502);
  }

  if (meResponse.status === 401) {
    return json({ allowed: false, reason: 'Your Discord session expired. Reopen the Activity.' }, 401);
  }
  if (!meResponse.ok) {
    console.error('[AutoBE] Discord user lookup failed:', meResponse.status);
    return json({ error: `Discord account verification failed (HTTP ${meResponse.status}).` }, 502);
  }

  const me = await meResponse.json() as { id?: string };
  if (!me.id) {
    return json({ allowed: false, reason: 'Discord could not verify your account.' }, 401);
  }

  // This endpoint uses the bot token only on the server. The bot must be in the target guild.
  let memberResponse: Response;
  try {
    memberResponse = await fetch(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/members/${encodeURIComponent(me.id)}`,
      { headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } },
    );
  } catch (error) {
    console.error('[AutoBE] Discord member lookup network error:', error);
    return json({ error: 'Could not reach Discord to verify the Auto Byte role. Please retry.' }, 502);
  }

  if (memberResponse.status === 404) {
    return json({
      allowed: false,
      reason: 'Join the AutoBE Discord server and get the Auto Byte role.',
    }, 403);
  }

  if (!memberResponse.ok) {
    console.error('[AutoBE] Discord member lookup failed:', memberResponse.status);
    if (memberResponse.status === 401 || memberResponse.status === 403) {
      return json({
        error: 'Discord rejected the bot credentials or permissions. Check DISCORD_BOT_TOKEN and ensure the bot is in the target server.',
      }, 502);
    }
    return json({ error: `Could not verify server membership (HTTP ${memberResponse.status}).` }, 502);
  }

  const member = await memberResponse.json() as { roles?: string[] };
  if (!Array.isArray(member.roles) || !member.roles.includes(env.DISCORD_REQUIRED_ROLE_ID)) {
    return json({
      allowed: false,
      reason: 'You need the Auto Byte role to use AutoBE.',
    }, 403);
  }

  return json({ allowed: true });
};
