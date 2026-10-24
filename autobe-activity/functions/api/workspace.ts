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
    if (!memberResponse.ok) return json({ error: 'Could not verify the required Discord role.' }, 502);
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

function itemValidationError(item: unknown): string | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'item must be an object';
  const value = item as Partial<WorkspaceItem>;
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return 'missing or empty item id';
  if (value.id.length > 200) return 'item id exceeds 200 characters';
  if (value.type !== 'pack' && value.type !== 'project') return 'type must be pack or project';
  if (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)) return 'data must be an object';
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return 'item could not be serialized as JSON';
  }
  if (new TextEncoder().encode(serialized).byteLength > 256 * 1024) return 'item exceeds the 256 KiB metadata limit';
  return null;
}

function validItem(item: unknown): item is WorkspaceItem {
  return itemValidationError(item) === null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await authenticatedUser(request, env);
  if (isResponse(auth)) return auth;
  await ensureTable(env);
  const rows = await env.DB.prepare(
    'SELECT item_type AS type, item_id AS id, payload, updated_at AS updatedAt FROM private_workspace_items WHERE user_id = ? ORDER BY updated_at ASC'
  ).bind(auth.id).all<{ type: ItemType; id: string; payload: string; updatedAt: number }>();
  return json({ items: (rows.results || []).map(row => ({
    type: row.type, id: row.id, data: JSON.parse(row.payload), updatedAt: row.updatedAt,
  })) });
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
  const invalidIndex = body.items.findIndex(item => !validItem(item));
  if (invalidIndex !== -1) {
    const item = body.items[invalidIndex] as Partial<WorkspaceItem> | null;
    const reason = itemValidationError(item);
    return json({
      error: `Workspace item ${invalidIndex + 1} (${item?.type === 'pack' || item?.type === 'project' ? item.type : 'unknown'} ${typeof item?.id === 'string' ? item.id.slice(0, 80) : 'without-id'}) was rejected: ${reason || 'invalid item'}.`,
      invalidIndex,
      reason,
    }, 400);
  }

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
  if (type === 'pack') await env.BUCKET.delete(`private-workspaces/${auth.id}/packs/${encodeURIComponent(id)}`);
  return json({ deleted: true });
};
