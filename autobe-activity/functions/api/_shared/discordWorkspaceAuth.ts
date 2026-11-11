/**
 * Shared Discord authorization for private workspace endpoints.
 *
 * Successful membership checks are cached briefly per access-token fingerprint.
 * This prevents each file + metadata request in a multi-pack import from
 * independently calling Discord's member endpoint and tripping rate limits.
 * Raw access tokens are never used as cache keys or stored in this module.
 */
export interface WorkspaceDiscordEnv {
  DISCORD_CLIENT_ID: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_GUILD_ID: string;
  DISCORD_REQUIRED_ROLE_ID: string;
}
type VerifiedUser = { id: string };
type AuthResult = VerifiedUser | Response;
const CACHE_TTL_MS = 45_000;
const verified = new Map<string, { user: VerifiedUser; expiresAt: number }>();
const pending = new Map<string, Promise<AuthResult>>();

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'vary': 'Authorization',
      ...headers,
    },
  });
}
async function fingerprint(token: string, env: WorkspaceDiscordEnv): Promise<string> {
  const source = new TextEncoder().encode([
    token, env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID, env.DISCORD_REQUIRED_ROLE_ID,
  ].join(':'));
  const digest = await crypto.subtle.digest('SHA-256', source);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function retryAfter(response: Response): Record<string, string> {
  const value = response.headers.get('retry-after');
  return value ? { 'retry-after': value } : {};
}
async function verify(token: string, env: WorkspaceDiscordEnv): Promise<AuthResult> {
  const meResponse = await fetch('https://discord.com/api/v10/oauth2/@me', {
    headers: { authorization: `Bearer ${token}` },
  });
  if (meResponse.status === 401) return json({ error: 'Discord session expired. Reopen AutoBE.' }, 401);
  if (meResponse.status === 429) return json({ error: 'Discord is rate-limiting workspace verification. Wait briefly and retry; your local packs are safe.' }, 503, retryAfter(meResponse));
  if (!meResponse.ok) {
    console.error('[Workspace auth] Discord user lookup failed:', meResponse.status);
    return json({ error: `Discord account verification failed (HTTP ${meResponse.status}). Retry shortly; your local packs are safe.` }, 502);
  }
  const oauth = await meResponse.json() as { application?: { id?: string }; user?: { id?: string } };
  if (oauth.application?.id !== env.DISCORD_CLIENT_ID) return json({ error: 'This Discord session was not issued to AutoBE.' }, 401);
  const me = oauth.user;
  if (!me.id) return json({ error: 'Discord could not verify your account.' }, 401);

  const memberResponse = await fetch(
    `https://discord.com/api/v10/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/members/${encodeURIComponent(me.id)}`,
    { headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } },
  );
  if (memberResponse.status === 404) return json({ error: 'Join the AutoBE server and get the required role.' }, 403);
  if (memberResponse.status === 401) return json({ error: 'AutoBE cloud backup is not configured correctly: the Discord bot token is invalid or expired.' }, 503);
  if (memberResponse.status === 403) return json({ error: 'AutoBE cloud backup cannot check roles: the Discord bot needs permission to view server members.' }, 503);
  if (memberResponse.status === 429) return json({ error: 'Discord is rate-limiting role verification. Wait briefly and retry; your local packs are safe.' }, 503, retryAfter(memberResponse));
  if (!memberResponse.ok) {
    console.error('[Workspace auth] Discord member lookup failed:', memberResponse.status);
    return json({ error: `Discord role verification failed (HTTP ${memberResponse.status}). Retry shortly; your local packs are safe.` }, 502);
  }
  const member = await memberResponse.json() as { roles?: string[] };
  if (!Array.isArray(member.roles) || !member.roles.includes(env.DISCORD_REQUIRED_ROLE_ID)) {
    return json({ error: 'You need the required AutoBE role to access your private workspace.' }, 403);
  }
  return { id: me.id };
}

export async function authorizeWorkspaceRequest(request: Request, env: WorkspaceDiscordEnv): Promise<AuthResult> {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !env.DISCORD_REQUIRED_ROLE_ID) {
    return json({ error: 'Private workspace access is not configured.' }, 503);
  }
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: 'Discord authentication is required.' }, 401);
  try {
    const key = await fingerprint(token, env);
    const cached = verified.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.user;
    if (cached) verified.delete(key);

    const existing = pending.get(key);
    if (existing) return existing;

    const task = verify(token, env).then(result => {
      if (!(result instanceof Response)) {
        verified.set(key, { user: result, expiresAt: Date.now() + CACHE_TTL_MS });
        if (verified.size > 500) {
          const now = Date.now();
          for (const [cacheKey, value] of verified) if (value.expiresAt <= now) verified.delete(cacheKey);
          while (verified.size > 500) verified.delete(verified.keys().next().value!);
        }
      }
      return result;
    }).catch(error => {
      console.error('[Workspace auth] Discord verification request failed:', error);
      return json({ error: 'Could not verify your Discord account right now. Retry shortly; your local packs are safe.' }, 502);
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  } catch (error) {
    console.error('[Workspace auth] Could not prepare verification:', error);
    return json({ error: 'Could not verify your Discord account right now. Retry shortly; your local packs are safe.' }, 502);
  }
}
