interface Env {
  JAVABE_DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_ID?: string;
  JAVABE_DISCORD_CLIENT_SECRET?: string;
  JAVABE_DISCORD_BOT_TOKEN?: string;
  JAVABE_DISCORD_GUILD_ID?: string;
  JAVABE_DISCORD_REQUIRED_ROLE_ID?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const checks = {
    clientId: Boolean((env.JAVABE_DISCORD_CLIENT_ID || env.DISCORD_CLIENT_ID)?.trim()),
    clientSecret: Boolean(env.JAVABE_DISCORD_CLIENT_SECRET?.trim()),
    botToken: Boolean(env.JAVABE_DISCORD_BOT_TOKEN?.trim()),
    guildId: Boolean(env.JAVABE_DISCORD_GUILD_ID?.trim()),
    requiredRoleId: Boolean(env.JAVABE_DISCORD_REQUIRED_ROLE_ID?.trim()),
  };
  const configured = Object.values(checks).every(Boolean);
  const availableConfigKeys = Object.keys(env).filter((key) =>
    /DISCORD|JAVABE/i.test(key)
  ).sort();
  return new Response(JSON.stringify({
    service: 'JavaBE',
    status: configured ? 'configured' : 'missing_configuration',
    checks,
    availableConfigKeys,
  }), {
    status: configured ? 200 : 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
};
