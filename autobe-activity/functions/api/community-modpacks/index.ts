/**
 * /api/community-modpacks
 *   GET    list all published modpacks (or ?id=... to count a download)
 *   POST   publish a modpack
 *   PATCH  edit your own modpack      (?id=...)
 *   DELETE delete your own modpack    (?id=...)
 *
 * IMPORTANT: every D1 call (.first / .all / .run) returns a Promise and MUST be awaited.
 * Without `await`, .all() gave `undefined` results (so the list was always empty) and
 * writes could be cut off when the response was sent.
 *
 * Who you are comes from your Discord token (verified with Discord), never from the
 * request body or URL, so nobody can edit/delete/publish as someone else.
 */
import type { Context } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
  DISCORD_CLIENT_ID: string;
}

type Ctx = Context & { env: Env };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

async function verifyDiscordUser(request: Request, env: Env): Promise<string | null> {
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    const res = await fetch('https://discord.com/api/v10/oauth2/@me', {
      headers: { authorization: `Bearer ${match[1]}` },
    });
    if (!res.ok) return null;
    const info = (await res.json()) as { application?: { id?: string }; user?: { id?: string } };
    if (!info.user?.id || info.application?.id !== env.DISCORD_CLIENT_ID) return null;
    return info.user.id;
  } catch {
    return null;
  }
}

/** Creates the table if it is missing, so a fresh database "just works". */
async function ensureTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS community_modpacks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      author TEXT NOT NULL,
      author_id TEXT NOT NULL,
      version TEXT NOT NULL,
      total_packs INTEGER NOT NULL,
      size INTEGER NOT NULL,
      icon_data_url TEXT,
      created_at INTEGER NOT NULL,
      downloads INTEGER DEFAULT 0,
      blob_url TEXT NOT NULL,
      file_name TEXT NOT NULL,
      included_packs TEXT
    )`
  ).run();
}

function fail(label: string, error: unknown) {
  console.error(`[Community] ${label}:`, error);
  return json(
    { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
    500
  );
}

export async function onRequestPost(context: Ctx) {
  const { request, env } = context;
  try {
    if (!env.DB) return json({ error: 'Database not configured' }, 500);

    const userId = await verifyDiscordUser(request, env);
    if (!userId) return json({ error: 'Not authenticated with Discord. Close and reopen the Activity, then try again.' }, 401);

    await ensureTable(env);

    const data = (await request.json()) as Record<string, any>;
    console.log('[Community] POST', { name: data.name, author: data.author, userId });

    if (!data.name || !data.description || !data.author || !data.blob_url || !data.file_name) {
      return json({ error: 'Missing required fields' }, 400);
    }

    // Only accept files that were uploaded through our own /api/upload (kind "pub").
    try {
      const blobUrl = new URL(String(data.blob_url));
      if (!blobUrl.pathname.startsWith('/api/files/pub/')) throw new Error('bad path');
    } catch {
      return json({ error: 'Invalid file link. Upload the modpack through the app first.' }, 400);
    }

    const id = crypto.randomUUID();
    const result = await env.DB.prepare(
      'INSERT INTO community_modpacks (id, name, description, author, author_id, version, total_packs, size, icon_data_url, created_at, downloads, blob_url, file_name, included_packs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(
        id,
        String(data.name),
        String(data.description),
        String(data.author),
        userId, // verified Discord id, not whatever the request claims
        String(data.version || '1.0.0'),
        Number(data.total_packs) || 0,
        Number(data.size) || 0,
        data.icon_data_url || null,
        Date.now(),
        0,
        String(data.blob_url),
        String(data.file_name),
        JSON.stringify(data.included_packs || [])
      )
      .run();

    console.log('[Community] Inserted', id, 'success:', result.success);
    return json({ id, success: true }, 201);
  } catch (error) {
    return fail('POST error', error);
  }
}

export async function onRequestGet(context: Ctx) {
  const { env, request } = context;
  try {
    if (!env.DB) return json({ error: 'Database not configured' }, 500);
    await ensureTable(env);

    const modpackId = new URL(request.url).searchParams.get('id');
    if (modpackId) {
      await env.DB.prepare('UPDATE community_modpacks SET downloads = downloads + 1 WHERE id = ?')
        .bind(modpackId)
        .run();
    }

    const { results } = await env.DB.prepare(
      'SELECT * FROM community_modpacks ORDER BY created_at DESC'
    ).all();

    const modpacks = (results || []).map((row: Record<string, unknown>) => {
      let included: unknown = [];
      try {
        included = typeof row.included_packs === 'string' ? JSON.parse(row.included_packs) : row.included_packs || [];
      } catch {
        included = [];
      }
      return { ...row, included_packs: Array.isArray(included) ? included : [] };
    });

    console.log('[Community] GET returned', modpacks.length);
    return json({ modpacks });
  } catch (error) {
    return fail('GET error', error);
  }
}

export async function onRequestDelete(context: Ctx) {
  const { request, env } = context;
  try {
    if (!env.DB) return json({ error: 'Database not configured' }, 500);

    const userId = await verifyDiscordUser(request, env);
    if (!userId) return json({ error: 'Not authenticated with Discord' }, 401);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, 400);

    await ensureTable(env);
    const row = await env.DB.prepare('SELECT author_id FROM community_modpacks WHERE id = ?')
      .bind(id)
      .first<{ author_id: string }>();
    if (!row) return json({ error: 'Modpack not found' }, 404);
    if (row.author_id !== userId) return json({ error: 'You can only delete your own modpacks' }, 403);

    await env.DB.prepare('DELETE FROM community_modpacks WHERE id = ?').bind(id).run();
    return json({ success: true });
  } catch (error) {
    return fail('DELETE error', error);
  }
}

export async function onRequestPatch(context: Ctx) {
  const { request, env } = context;
  try {
    if (!env.DB) return json({ error: 'Database not configured' }, 500);

    const userId = await verifyDiscordUser(request, env);
    if (!userId) return json({ error: 'Not authenticated with Discord' }, 401);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, 400);

    await ensureTable(env);
    const row = await env.DB.prepare('SELECT author_id FROM community_modpacks WHERE id = ?')
      .bind(id)
      .first<{ author_id: string }>();
    if (!row) return json({ error: 'Modpack not found' }, 404);
    if (row.author_id !== userId) return json({ error: 'You can only edit your own modpacks' }, 403);

    const data = (await request.json()) as Record<string, any>;
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const field of ['name', 'description', 'version', 'icon_data_url'] as const) {
      if (data[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(data[field]);
      }
    }
    if (updates.length === 0) return json({ error: 'No fields to update' }, 400);

    values.push(id);
    await env.DB.prepare(`UPDATE community_modpacks SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
    return json({ success: true });
  } catch (error) {
    return fail('PATCH error', error);
  }
}
