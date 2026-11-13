interface Env {
  JAVABE_DISCORD_CLIENT_ID: string;
  JAVABE_DISCORD_CLIENT_SECRET: string;
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
  if (!env.JAVABE_DISCORD_CLIENT_ID || !env.JAVABE_DISCORD_CLIENT_SECRET) {
    return json({ error: 'JavaBE Discord sign-in is not configured on the server.' }, 503);
  }

  let body: { code?: unknown };
  try {
    body = await request.json() as { code?: unknown };
  } catch {
    return json({ error: 'Invalid sign-in request.' }, 400);
  }
  if (typeof body.code !== 'string' || !body.code || body.code.length > 2048) {
    return json({ error: 'Discord did not provide a valid sign-in code.' }, 400);
  }

  // Discord Embedded App SDK authorization uses this documented placeholder URI.
  const form = new URLSearchParams({
    client_id: env.JAVABE_DISCORD_CLIENT_ID,
    client_secret: env.JAVABE_DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code: body.code,
    redirect_uri: 'https://127.0.0.1/',
  });

  let response: Response;
  try {
    response = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
  } catch (error) {
    console.error('[JavaBE] Discord token exchange network error:', error);
    return json({ error: 'Could not reach Discord to complete sign-in. Please retry.' }, 502);
  }

  const result = await response.json().catch(() => ({})) as {
    access_token?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !result.access_token) {
    console.error('[JavaBE] Discord token exchange rejected:', {
      status: response.status,
      error: result.error,
      error_description: result.error_description,
    });
    return json({ error: 'Discord sign-in could not be completed. Check JavaBE OAuth settings and try again.' }, 401);
  }

  return json({ access_token: result.access_token, token_type: result.token_type || 'Bearer' });
};
