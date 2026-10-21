interface Env {
  DISCORD_CLIENT_ID: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.DISCORD_CLIENT_ID) {
    return new Response(JSON.stringify({ error: 'DISCORD_CLIENT_ID not configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
