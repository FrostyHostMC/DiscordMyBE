/**
 * Private per-Discord-account workspace API.
 *
 * GET    /api/workspace                 list this account's saved metadata
 * PUT    /api/workspace                 upsert one or more items (never replaces the whole workspace)
 * DELETE /api/workspace?type=pack&id=... delete one metadata item and its private R2 object
 * GET/PUT/DELETE /api/workspace/files/:id access a pack file in the authenticated account's namespace
 *
 * The owner ID is always obtained from Discord, never from a request parameter/body.
 * Community data uses separate tables/keys and is not touched here.
 */
interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  DISCORD_CLIENT_ID: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_GUILD_ID: string;
  DISCORD_REQUIRED_ROLE_ID: string;
}

type ItemType = 'pack' | 'project';

interface WorkspaceItem {
  id: string;
  type: ItemType;
  data: Record<string, unknown>;
  updatedAt?: number;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'vary': 'Authorization',
  },
});

async function authenticatedUser(request: Request, env: Env): Promise<{ id: string } | Response> {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !env.DISCORD_REQUIRED_ROLE_ID) {
    return json({ error: 'Private workspace access is not configured.' }, 503);
  }
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: 'Discord authentication is required.' }, 401);

  try {
    const meResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bearer ${match[1]}` },
    });
    if (meResponse.status === 401) return json({ error: 'Discord session expired. Reopen AutoBE.' }, 401);
    if (!meResponse.ok) return json({ error: 'Discord account verification failed.' }, 502);
    const me = await meResponse.json() as { id?: string };
    if (!me.id) return json({ error: 'Discord could not verify your account.' }, 401);

    const memberResponse = await fetch(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/members/${encodeURIComponent(me.id)}`,
      { headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } },
    );
    if (memberResponse.status === 404) return json({ error: 'Join the AutoBE server and get the required role.' }, 403);
    if (memberResponse.status === 401) return json({ error: 'AutoBE cloud backup is not configured correctly: the Discord bot token is invalid or expired.' }, 503);
    if (memberResponse.status === 403) return json({ error: 'AutoBE cloud backup cannot check roles: the Discord bot needs permission to view server members.' }, 503);
    if (!memberResponse.ok) {
      console.error('[Workspace] Discord member lookup failed with status:', memberResponse.status);
      return json({ error: 'Discord role verification is temporarily unavailable. Your local workspace is unchanged; cloud backup was not completed.' }, 502);
    }
    const member = await memberResponse.json() as { roles?: string[] };
    if (!Array.isArray(member.roles) || !member.roles.includes(env.DISCORD_REQUIRED_ROLE_ID)) {
      return json({ error: 'You need the required AutoBE role to access your private workspace.' }, 403);
    }
    return { id: me.id };
  } catch (error) {
    console.error('[Workspace] Discord verification failed:', error);
    return json({ error: 'Could not verify your Discord account. Please retry.' }, 502);
  }
}

async function ensureTable(env: Env): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS private_workspace_items (
    user_id TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK(item_type IN ('pack', 'project')),
    item_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, item_type, item_id)
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_private_workspace_user_updated ON private_workspace_items(user_id, updated_at DESC)').run();
}

function isResponse(value: { id: string } | Response): value is Response {
  return value instanceof Response;
}

const PRIVATE_WORKSPACE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

async function deleteR2Prefix(env: Env, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix, limit: 1000, cursor });
    if (page.objects.length) await env.BUCKET.delete(page.objects.map(object => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/**
 * Expire old private workspaces for every account, not just the account making
 * this request. Public/community objects live under other prefixes and are never touched.
 * R2 lifecycle rules provide the unattended binary-file expiry; this removes matching
 * D1 metadata and any remaining per-user objects on the next workspace API request.
 */
async function pruneExpiredWorkspaceItems(env: Env): Promise<void> {
  const cutoff = Date.now() - PRIVATE_WORKSPACE_RETENTION_MS;
  const expired = await env.DB.prepare(
    'SELECT user_id AS userId, item_type AS type, item_id AS id FROM private_workspace_items WHERE updated_at < ?'
  ).bind(cutoff).all<{ userId: string; type: ItemType; id: string }>();

  for (const item of expired.results || []) {
    await env.DB.prepare('DELETE FROM private_workspace_items WHERE user_id = ? AND item_type = ? AND item_id = ? AND updated_at < ?')
      .bind(item.userId, item.type, item.id, cutoff).run();
    if (item.type === 'pack') {
      await env.BUCKET.delete(`private-workspaces/${item.userId}/packs/${encodeURIComponent(item.id)}`);
    } else {
      await deleteR2Prefix(env, `private-workspaces/${item.userId}/projects/${encodeURIComponent(item.id)}/`);
    }
  }

  // Remove seven-day-old orphan files too, but retain every file namespace belonging
  // to an active metadata row. Community uploads use different prefixes and are excluded.
  const active = await env.DB.prepare(
    'SELECT user_id AS userId, item_type AS type, item_id AS id FROM private_workspace_items'
  ).all<{ userId: string; type: ItemType; id: string }>();
  const activePrefixes = (active.results || []).map(item => item.type === 'pack'
    ? `private-workspaces/${item.userId}/packs/${encodeURIComponent(item.id)}`
    : `private-workspaces/${item.userId}/projects/${encodeURIComponent(item.id)}/`);

  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: 'private-workspaces/', limit: 1000, cursor });
    const staleKeys = page.objects
      .filter(object => object.uploaded && object.uploaded.getTime() < cutoff
        && !activePrefixes.some(prefix => object.key.startsWith(prefix)))
      .map(object => object.key);
    if (staleKeys.length) await env.BUCKET.delete(staleKeys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

function validItem(item: unknown): item is WorkspaceItem {
  if (!item || typeof item !== 'object') return false;
  const value = item as Partial<WorkspaceItem>;
  return typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200
    && (value.type === 'pack' || value.type === 'project')
    && !!value.data && typeof value.data === 'object' && !Array.isArray(value.data)
    && JSON.stringify(value).length <= 256 * 1024;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await authenticatedUser(request, env);
  if (isResponse(auth)) return auth;
  await ensureTable(env);
  await pruneExpiredWorkspaceItems(env);
  const rows = await env.DB.prepare(
    'SELECT item_type AS type, item_id AS id, payload, updated_at AS updatedAt FROM private_workspace_items WHERE user_id = ? ORDER BY updated_at ASC'
  ).bind(auth.id).all<{ type: ItemType; id: string; payload: string; updatedAt: number }>();
  return json({ items: (rows.results || []).map(row => ({
    type: row.type, id: row.id, data: JSON.parse(row.payload), updatedAt: row.updatedAt,
  })) });
};

/** Mark this Discord account active without re-uploading every binary file. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await authenticatedUser(request, env);
  if (isResponse(auth)) return auth;
  await ensureTable(env);
  const now = Date.now();
  await env.DB.prepare('UPDATE private_workspace_items SET updated_at = ? WHERE user_id = ?')
    .bind(now, auth.id).run();
  return json({ touched: true, updatedAt: now });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await authenticatedUser(request, env);
  if (isResponse(auth)) return auth;
  let body: { items?: unknown };
  try {
    body = await request.json() as { items?: unknown };
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
    return json({ error: 'Send between 1 and 100 workspace items per request.' }, 400);
  }
  if (!body.items.every(validItem)) return json({ error: 'One or more workspace items are invalid or too large.' }, 400);

  await ensureTable(env);
  const now = Date.now();
  const statements = body.items.map(item => env.DB.prepare(`
    INSERT INTO private_workspace_items (user_id, item_type, item_id, payload, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET
      payload = excluded.payload, updated_at = excluded.updated_at
  `).bind(auth.id, item.type, item.id, JSON.stringify(item.data), now));
  await env.DB.batch(statements);
  return json({ saved: body.items.length, updatedAt: now });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await authenticatedUser(request, env);
  if (isResponse(auth)) return auth;
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const id = url.searchParams.get('id');
  if ((type !== 'pack' && type !== 'project') || !id || id.length > 200) {
    return json({ error: 'Provide a valid type=pack|project and id.' }, 400);
  }
  await ensureTable(env);
  await env.DB.prepare('DELETE FROM private_workspace_items WHERE user_id = ? AND item_type = ? AND item_id = ?')
    .bind(auth.id, type, id).run();
  if (type === 'pack') {
    await env.BUCKET.delete(`private-workspaces/${auth.id}/packs/${encodeURIComponent(id)}`);
  } else {
    const prefix = `private-workspaces/${auth.id}/projects/${encodeURIComponent(id)}/`;
    let cursor: string | undefined;
    do {
      const page = await env.BUCKET.list({ prefix, limit: 1000, cursor });
      if (page.objects.length) await env.BUCKET.delete(page.objects.map((object) => object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return json({ deleted: true });
};
