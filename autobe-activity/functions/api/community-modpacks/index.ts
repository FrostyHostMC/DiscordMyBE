/**
 * /api/community-modpacks
 *   GET    list all published modpacks
 *   POST   publish a modpack (or ?action=download&id=... to count a download)
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
import { getOwnedPublishedObjectKey, isOwnedPublishedObject } from '../_shared/uploadOwnership';

interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  DISCORD_CLIENT_ID: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_GUILD_ID: string;
  DISCORD_REQUIRED_ROLE_ID: string;
  PUBLIC_BASE_URL?: string;
}

type Ctx = Context & { env: Env };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

async function verifyCommunityRole(userId: string, env: Env): Promise<'present'|'missing'|'unknown'> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !env.DISCORD_REQUIRED_ROLE_ID) return 'unknown';
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/members/${encodeURIComponent(userId)}`, { headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
    if (response.status === 404) {
      const error = await response.json().catch(() => null) as { code?: number } | null;
      return error?.code === 10007 ? 'missing' : 'unknown';
    }
    if (response.status === 429 || response.status >= 500 || !response.ok) return 'unknown';
    const member = await response.json() as { roles?: string[] };
    return Array.isArray(member.roles) && member.roles.includes(env.DISCORD_REQUIRED_ROLE_ID) ? 'present' : 'missing';
  } catch { return 'unknown'; }
}
const ROLE_REQUIRED_MESSAGE = 'You no longer have the required AutoBE Discord role. Your Community access has been revoked. Rejoin the required role and reopen AutoBE to verify again.';
async function requireCommunityRole(userId: string, env: Env): Promise<Response | null> {
  const status = await verifyCommunityRole(userId, env);
  if (status === 'missing') return json({ error: ROLE_REQUIRED_MESSAGE, code: 'DISCORD_ROLE_REQUIRED', verified: false }, 403);
  if (status === 'unknown') return json({ error: 'We could not verify your Discord role right now. Please try again shortly.', code: 'DISCORD_ROLE_CHECK_UNAVAILABLE' }, 503);
  const now = Date.now();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS community_verified_creators (user_id TEXT PRIMARY KEY,verified_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,revoked_at INTEGER)").run();
  const registryHasRows = await env.DB.prepare("SELECT 1 yes FROM community_verified_creators LIMIT 1").first();
  if (!registryHasRows) await env.DB.prepare("INSERT OR IGNORE INTO community_verified_creators (user_id,verified_at,last_seen_at,revoked_at) SELECT author_id,MIN(created_at),MAX(created_at),NULL FROM community_modpacks GROUP BY author_id").run();
  await env.DB.prepare("INSERT INTO community_verified_creators (user_id,verified_at,last_seen_at,revoked_at) VALUES (?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,revoked_at=NULL").bind(userId,now,now).run();
  return null;
}

async function consumePublishQuota(env: Env, userId: string): Promise<number> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS autobe_rate_limits (
    scope TEXT NOT NULL,
    user_id TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    request_count INTEGER NOT NULL,
    PRIMARY KEY (scope, user_id)
  )`).run();
  const now = Date.now();
  const windowStart = now - 24 * 60 * 60 * 1000;
  const row = await env.DB.prepare(`
    INSERT INTO autobe_rate_limits (scope, user_id, window_start, request_count)
    VALUES ('publish', ?, ?, 1)
    ON CONFLICT(scope, user_id) DO UPDATE SET
      window_start = CASE WHEN autobe_rate_limits.window_start <= ? THEN ? ELSE autobe_rate_limits.window_start END,
      request_count = CASE WHEN autobe_rate_limits.window_start <= ? THEN 1 ELSE autobe_rate_limits.request_count + 1 END
    RETURNING request_count
  `).bind(userId, now, windowStart, now, windowStart).first<{ request_count: number }>();
  return Number(row?.request_count || 0);
}

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
      author_avatar TEXT,
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

  // Migrate databases created before detailed descriptions and gallery images existed.
  const columns = await env.DB.prepare('PRAGMA table_info(community_modpacks)').all<{ name: string }>();
  const names = new Set((columns.results || []).map((column) => column.name));
  if (!names.has('author_avatar')) {
    await env.DB.prepare('ALTER TABLE community_modpacks ADD COLUMN author_avatar TEXT').run();
  }
  if (!names.has('detail_description')) {
    await env.DB.prepare('ALTER TABLE community_modpacks ADD COLUMN detail_description TEXT').run();
  }
  if (!names.has('detail_images')) {
    await env.DB.prepare('ALTER TABLE community_modpacks ADD COLUMN detail_images TEXT').run();
  }
  if (!names.has('content_type')) {
    await env.DB.prepare("ALTER TABLE community_modpacks ADD COLUMN content_type TEXT NOT NULL DEFAULT 'modpack'").run();
  }
  if (!names.has('category')) {
    await env.DB.prepare("ALTER TABLE community_modpacks ADD COLUMN category TEXT NOT NULL DEFAULT 'Other'").run();
  }
  if (!names.has('is_hidden')) {
    await env.DB.prepare('ALTER TABLE community_modpacks ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!names.has('featured')) {
    await env.DB.prepare('ALTER TABLE community_modpacks ADD COLUMN featured INTEGER NOT NULL DEFAULT 0').run();
  }
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS community_cleanup_preview (item_id TEXT PRIMARY KEY,author_id TEXT NOT NULL,item_name TEXT NOT NULL,reason TEXT NOT NULL,detected_at INTEGER NOT NULL,last_updated_at INTEGER,last_download_at INTEGER,status TEXT NOT NULL DEFAULT 'candidate')`).run();
  const lifecycleColumns: Array<[string, string]> = [
    ['last_updated_at', 'INTEGER'], ['last_download_at', 'INTEGER'],
    ['role_removed_at', 'INTEGER'], ['role_purge_after', 'INTEGER'],
    ['inactivity_warning_at', 'INTEGER'], ['inactivity_purge_after', 'INTEGER'],
    ['lifecycle_state', "TEXT NOT NULL DEFAULT 'active'"],
  ];
  for (const [column, type] of lifecycleColumns) {
    if (!names.has(column)) await env.DB.prepare(`ALTER TABLE community_modpacks ADD COLUMN ${column} ${type}`).run();
  }
  await env.DB.prepare('UPDATE community_modpacks SET last_updated_at=created_at WHERE last_updated_at IS NULL').run();
}

function fail(label: string, error: unknown) {
  console.error(`[Community] ${label}:`, error);
  return json({ error: 'Internal server error' }, 500);
}

export async function onRequestPost(context: Ctx) {
  const { request, env } = context;
  try {
    if (!env.DB) return json({ error: 'Database not configured' }, 500);

    const userId = await verifyDiscordUser(request, env);
    if (!userId) return json({ error: 'Not authenticated with Discord. Close and reopen the Activity, then try again.' }, 401);
    const roleFailure = await requireCommunityRole(userId, env);
    if (roleFailure) return roleFailure;
    const bearer = (request.headers.get('authorization') || '').match(/^Bearer\\s+(.+)$/i)?.[1];
    let authorAvatar: string | null = null;
    let authorDisplayName: string | null = null;
    if (bearer) {
      const profileResponse = await fetch('https://discord.com/api/v10/oauth2/@me', { headers: { authorization: `Bearer ${bearer}` } });
      if (profileResponse.ok) {
        const profile = await profileResponse.json() as { application?: { id?: string }; user?: { id?: string; username?: string; global_name?: string | null; avatar?: string | null } };
        if (profile.application?.id === env.DISCORD_CLIENT_ID && profile.user?.id === userId) {
          authorAvatar = profile.user.avatar ?? null;
          authorDisplayName = profile.user.global_name || profile.user.username || null;
        }
      }
    }

    await ensureTable(env);

    if (new URL(request.url).searchParams.get('action') === 'download') {
      const id = new URL(request.url).searchParams.get('id');
      if (!id) return json({ error: 'Missing modpack id' }, 400);
      const updated = await env.DB.prepare('UPDATE community_modpacks SET downloads = downloads + 1, last_download_at = ? WHERE id = ?').bind(Date.now(), id).run();
      if (!updated.meta?.changes) return json({ error: 'Modpack not found' }, 404);
      const row = await env.DB.prepare('SELECT downloads FROM community_modpacks WHERE id = ?').bind(id).first<{ downloads: number }>();
      return json({ success: true, downloads: Number(row?.downloads) || 0 });
    }

    const data = (await request.json()) as Record<string, any>;
    console.log('[Community] POST', { name: data.name, author: data.author, userId });

    if (!data.name || !data.description || !data.author || !data.blob_url || !data.file_name) {
      return json({ error: 'Missing required fields' }, 400);
    }
    const contentType = data.content_type === 'addon' ? 'addon' : 'modpack';
    const allowedCategories = ['Horror', 'Medieval', 'Fantasy', 'Survival', 'Technology', 'Magic', 'PvP', 'Adventure', 'Weapons', 'Mobs', 'Blocks', 'Decorations', 'Utility', 'Other'];
    const category = allowedCategories.includes(String(data.category)) ? String(data.category) : 'Other';
    const safeInputFileName = String(data.file_name).split(/[\\/]/).pop() || '';
    if (contentType === 'addon' && !/\.(mcaddon|mcpack)$/i.test(safeInputFileName)) {
      return json({ error: 'Community addons must be uploaded as .mcaddon or .mcpack files.' }, 400);
    }

    // A published listing must point to a completed R2 object uploaded by this
    // exact Discord account. A path prefix alone is not proof of ownership.
    const objectKey = getOwnedPublishedObjectKey(
      String(data.blob_url), userId, request.url,
    );
    if (!objectKey) {
      return json({ error: 'Invalid or unowned file link. Upload the modpack through your own account first.' }, 400);
    }
    const uploadedObject = await env.BUCKET.head(objectKey);
    if (!uploadedObject ||
        !isOwnedPublishedObject(uploadedObject.customMetadata, uploadedObject.size, userId) ||
        Number(data.size) !== uploadedObject.size) {
      return json({ error: 'The uploaded file could not be verified as your completed upload. Please upload it again.' }, 400);
    }

    const publishCount = await consumePublishQuota(env, userId);
    if (publishCount > 3) {
      return json({
        error: 'Publishing limit reached: each account can publish up to 3 modpacks per 24 hours. Try again later.',
        code: 'RATE_LIMITED',
        retryAfterSeconds: 86400,
      }, 429);
    }

    // Store bounded, display-only included-pack summaries. Never persist arbitrary
    // project objects or embedded image data; the actual .mcaddon lives in R2.
    const safeIncludedPacks = Array.isArray(data.included_packs)
      ? data.included_packs.slice(0, 50).map((pack: unknown) => {
          if (typeof pack === 'string') return pack.slice(0, 120);
          if (!pack || typeof pack !== 'object') return null;
          const item = pack as Record<string, unknown>;
          return {
            name: String(item.name || 'Unnamed pack').slice(0, 100),
            type: String(item.type || '').slice(0, 30),
            version: String(item.version || '').slice(0, 30),
          };
        }).filter(Boolean)
      : [];
    const safeIncludedPacksJson = JSON.stringify(safeIncludedPacks);
    const safeName = String(data.name).slice(0, 120);
    const safeDescription = String(data.description).slice(0, 2000);
    const safeAuthor = String(authorDisplayName || data.author).slice(0, 100);
    const safeVersion = String(data.version || '1.0.0').slice(0, 40);
    const safeFileName = String(data.file_name).split('/').pop()?.split('\\').pop()?.slice(0, 255) || 'modpack.mcaddon';
    const safeIcon = typeof data.icon_data_url === 'string' && data.icon_data_url.length <= 100_000
      ? data.icon_data_url
      : null;
    console.log('[Community] Publish metadata lengths', {
      name: safeName.length,
      description: safeDescription.length,
      author: safeAuthor.length,
      version: safeVersion.length,
      fileName: safeFileName.length,
      icon: safeIcon?.length || 0,
      includedPacksReceived: Array.isArray(data.included_packs) ? data.included_packs.length : 0,
      includedPacksStored: safeIncludedPacks.length,
    });

    const id = crypto.randomUUID();
    const result = await env.DB.prepare(
      'INSERT INTO community_modpacks (id, name, description, author, author_id, author_avatar, version, total_packs, size, icon_data_url, created_at, downloads, blob_url, file_name, included_packs, content_type, category, last_updated_at, lifecycle_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(
        id,
        safeName,
        safeDescription,
        safeAuthor,
        userId, // verified Discord id, not whatever the request claims
        authorAvatar,
        safeVersion,
        Number(data.total_packs) || 0,
        Number(data.size) || 0,
        // D1 has a per-value size limit; never persist oversized embedded images.
        safeIcon,
        Date.now(),
        0,
        String(data.blob_url),
        safeFileName,
        safeIncludedPacksJson,
        contentType,
        category,
        Date.now(),
        'active'
      )
      .run();

    console.log('[Community] Inserted', id, 'success:', result.success);
    // Notify every creator follower about the new public upload.
    try {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS community_notifications (
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL,
        item_id TEXT,message TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER
      )`).run();
      const followers = await env.DB.prepare('SELECT follower_id FROM community_follows WHERE creator_id = ?').bind(userId).all<{follower_id:string}>();
      const batch = (followers.results || []).filter(row => row.follower_id !== userId).slice(0,500).map(row =>
        env.DB.prepare('INSERT INTO community_notifications (id,user_id,actor_id,kind,item_id,message,created_at) VALUES (?,?,?,?,?,?,?)')
          .bind(crypto.randomUUID(),row.follower_id,userId,'new_upload',id,`${safeAuthor} published a new ${contentType}: ${safeName}`.slice(0,240),Date.now())
      );
      if (batch.length) await env.DB.batch(batch);
    } catch (notificationError) {
      console.warn('[Community] New-upload notifications could not be created:', notificationError);
    }
    return json({ id, success: true }, 201);
  } catch (error) {
    return fail('POST error', error);
  }
}

export async function onRequestGet(context: Ctx) {
  const { env, request } = context;
  try {
    if (!env.DB) return json({ error: 'Database not configured' }, 500);
    const userId = await verifyDiscordUser(request, env);
    if (!userId) return json({ error: 'Sign in through Discord to use Community features.', code: 'DISCORD_AUTH_REQUIRED' }, 401);
    const roleFailure = await requireCommunityRole(userId, env);
    if (roleFailure) return roleFailure;
    await ensureTable(env);

    const { results } = await env.DB.prepare(
      'SELECT * FROM community_modpacks WHERE COALESCE(is_hidden, 0) = 0 ORDER BY featured DESC, created_at DESC'
    ).all();

    const modpacks = (results || []).map((row: Record<string, unknown>) => {
      let included: unknown = [];
      try {
        included = typeof row.included_packs === 'string' ? JSON.parse(row.included_packs) : row.included_packs || [];
      } catch {
        included = [];
      }
      let detailImages: unknown = [];
      try {
        detailImages = typeof row.detail_images === 'string' ? JSON.parse(row.detail_images) : [];
      } catch {
        detailImages = [];
      }
      return {
        ...row,
        included_packs: Array.isArray(included) ? included : [],
        detail_description: typeof row.detail_description === 'string' ? row.detail_description.slice(0, 4000) : '',
        detail_images: Array.isArray(detailImages)
          ? detailImages.filter((image): image is string => typeof image === 'string').slice(0, 3)
          : [],
      };
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
    const roleFailure = await requireCommunityRole(userId, env);
    if (roleFailure) return roleFailure;

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, 400);

    await ensureTable(env);
    const row = await env.DB.prepare('SELECT author_id, blob_url, size FROM community_modpacks WHERE id = ?')
      .bind(id)
      .first<{ author_id: string; blob_url: string; size: number }>();
    if (!row) return json({ error: 'Modpack not found' }, 404);
    if (row.author_id !== userId) return json({ error: 'You can only delete your own modpacks' }, 403);

    // Delete only an object whose immutable upload metadata matches this listing's
    // verified author. Never trust a mutable database URL as deletion authority.
    if (env.BUCKET && row.blob_url) {
      const key = getOwnedPublishedObjectKey(row.blob_url, userId, request.url);
      if (key) {
        const object = await env.BUCKET.head(key);
        // Older listings may point to pre-hardening objects without ownership
        // metadata. Let the author remove the listing, but never delete an object
        // unless its immutable R2 metadata proves ownership.
        if (object && isOwnedPublishedObject(object.customMetadata, object.size, userId) && object.size === Number(row.size)) {
          await env.BUCKET.delete(key);
        }
      }
    }
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
    const roleFailure = await requireCommunityRole(userId, env);
    if (roleFailure) return roleFailure;

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
    for (const field of ['name', 'description', 'version', 'icon_data_url', 'detail_description', 'detail_images'] as const) {
      if (data[field] === undefined) continue;
      let value: unknown = data[field];
      if (field === 'name') value = String(value).slice(0, 120);
      if (field === 'description') value = String(value).slice(0, 2000);
      if (field === 'version') value = String(value).slice(0, 40);
      if (field === 'icon_data_url') {
        value = typeof value === 'string' && value.length <= 100_000 ? value : null;
      }
      if (field === 'detail_description') {
        value = typeof value === 'string' ? value.slice(0, 4000) : '';
      }
      if (field === 'detail_images') {
        if (!Array.isArray(value) || value.length > 3) {
          return json({ error: 'Gallery images must contain no more than 3 images.' }, 400);
        }
        const images = value.map((image) => {
          if (typeof image !== 'string' || image.length > 95_000 || !/^data:image\/(jpeg|png|webp|gif);base64,/i.test(image)) {
            throw new Error('Each gallery image must be a supported image under the size limit.');
          }
          return image;
        });
        value = JSON.stringify(images);
      }
      updates.push(`${field} = ?`);
      values.push(value);
    }
    if (updates.length === 0) return json({ error: 'No fields to update' }, 400);

    updates.push('last_updated_at = ?', 'inactivity_warning_at = NULL', 'inactivity_purge_after = NULL', "lifecycle_state = 'active'");
    values.push(Date.now());
    values.push(id);
    await env.DB.prepare('DELETE FROM community_cleanup_preview WHERE item_id = ?').bind(id).run();
    await env.DB.prepare(`UPDATE community_modpacks SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
    return json({ success: true });
  } catch (error) {
    return fail('PATCH error', error);
  }
}
