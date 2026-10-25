const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      ...headers,
    },
  });

export const onRequestPost: PagesFunction = async () => {
  const state = crypto.randomUUID();
  return json({ state }, 200, {
    'set-cookie': `autobe_discord_oauth_state=${encodeURIComponent(state)}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax`,
  });
};
