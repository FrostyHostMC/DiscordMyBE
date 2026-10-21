interface Env {
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
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
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return json({ error: 'Discord OAuth is not configured on the server.' }, 500);
  }

  let body: { code?: unknown };
  try {
    body = await request.json() as { code?: unknown };
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (typeof body.code !== 'string' || body.code.length === 0 || body.code.length > 2048) {
    return json({ error: 'Missing or invalid Discord authorization code.' }, 400);
  }

  // Discord's Embedded App SDK documentation specifies this placeholder redirect URI.
  // It must also exist under this application's OAuth2 > Redirects in the Developer Portal.
  const form = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code: body.code,
    redirect_uri: 'https://127.0.0.1',
  });

  let response: Response;
  try {
    response = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
  } catch (error) {
    console.error('[AutoBE] Discord token endpoint network error:', error);
    return json({ error: 'Could not reach Discord to complete sign-in. Please retry.' }, 502);
  }

  const result = await response.json().catch(() => ({})) as {
    access_token?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !result.access_token) {
    // Keep the secret and authorization code out of logs and client responses.
    console.error('[AutoBE] Discord token exchange rejected:', {
      status: response.status,
      error: result.error,
      error_description: result.error_description,
    });
    return json({
      error: `Discord rejected the sign-in code (HTTP ${response.status}). Check the Client ID/Secret and OAuth2 redirect URI in Discord Developer Portal.`,
    }, 401);
  }

  return json({
    access_token: result.access_token,
    token_type: result.token_type || 'Bearer',
  });
};