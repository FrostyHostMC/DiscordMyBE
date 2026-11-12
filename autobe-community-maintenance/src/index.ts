export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  DISCORD_BOT_TOKEN: string;
  DISCORD_GUILD_ID: string;
  DISCORD_REQUIRED_ROLE_ID: string;
}

const DAY = 86_400_000;
const OWNER_ID = "1122949730419347487";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

async function ensureSchema(db: D1Database) {
  const columns = await db.prepare("PRAGMA table_info(community_modpacks)").all<{ name: string }>();
  const names = new Set((columns.results || []).map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["last_updated_at", "INTEGER"],
    ["last_download_at", "INTEGER"],
    ["role_removed_at", "INTEGER"],
    ["role_purge_after", "INTEGER"],
    ["inactivity_warning_at", "INTEGER"],
    ["inactivity_purge_after", "INTEGER"],
    ["lifecycle_state", "TEXT NOT NULL DEFAULT 'active'"],
  ];
  for (const [name, type] of additions) {
    if (!names.has(name)) await db.prepare(`ALTER TABLE community_modpacks ADD COLUMN ${name} ${type}`).run();
  }
  await db.prepare("UPDATE community_modpacks SET last_updated_at=created_at WHERE last_updated_at IS NULL").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS community_cleanup_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
    inactivity_months INTEGER NOT NULL DEFAULT 24, no_download_months INTEGER NOT NULL DEFAULT 12,
    role_grace_days INTEGER NOT NULL DEFAULT 30, inactivity_grace_days INTEGER NOT NULL DEFAULT 90,
    unread_extension_days INTEGER NOT NULL DEFAULT 180, updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare("INSERT OR IGNORE INTO community_cleanup_settings (id,enabled,updated_at) VALUES (1,0,?)").bind(Date.now()).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS community_cleanup_audit (
    id TEXT PRIMARY KEY, item_id TEXT, author_id TEXT NOT NULL, action TEXT NOT NULL,
    reason TEXT NOT NULL, created_at INTEGER NOT NULL, details TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS community_cleanup_preview (
    item_id TEXT PRIMARY KEY, author_id TEXT NOT NULL, item_name TEXT NOT NULL,
    reason TEXT NOT NULL, detected_at INTEGER NOT NULL, last_updated_at INTEGER,
    last_download_at INTEGER, status TEXT NOT NULL DEFAULT 'candidate'
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_community_modpacks_lifecycle ON community_modpacks(lifecycle_state,role_purge_after,inactivity_purge_after)").run();
}

async function discordRole(env: Env, userId: string): Promise<"present" | "missing" | "unknown"> {
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`, {
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    if (response.status === 404) return "missing";
    if (response.status === 429 || response.status >= 500) return "unknown";
    if (!response.ok) {
      console.error("[Lifecycle] Discord role lookup failed", response.status);
      return "unknown";
    }
    const member = await response.json() as { roles?: string[] };
    return member.roles?.includes(env.DISCORD_REQUIRED_ROLE_ID) ? "present" : "missing";
  } catch (error) {
    console.error("[Lifecycle] Discord request failed", error);
    return "unknown";
  }
}

function publishedObjectKey(blobUrl: string, ownerId: string): string | null {
  try {
    const url = new URL(blobUrl);
    if (url.protocol !== "https:" || !url.pathname.startsWith("/api/files/pub/")) return null;
    const key = url.pathname.slice("/api/files/".length).split("/").map(decodeURIComponent).join("/");
    return key.startsWith(`pub/${ownerId}/`) && !key.includes("..") ? key : null;
  } catch { return null; }
}

async function deleteOwnedObject(env: Env, row: { blob_url: string; author_id: string; size: number }) {
  const key = publishedObjectKey(row.blob_url, row.author_id);
  if (!key) throw new Error("The upload URL is not a verifiable public object key.");
  const object = await env.BUCKET.head(key);
  if (!object || object.customMetadata?.ownerId !== row.author_id ||
      object.customMetadata?.kind !== "pub" ||
      object.customMetadata?.declaredSize !== String(object.size) ||
      object.size !== Number(row.size)) {
    throw new Error("R2 ownership metadata or file size did not match; object was retained.");
  }
  await env.BUCKET.delete(key);
}

async function audit(db: D1Database, row: any, action: string, reason: string, details?: unknown) {
  await db.prepare("INSERT INTO community_cleanup_audit (id,item_id,author_id,action,reason,created_at,details) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), row.id, row.author_id, action, reason, Date.now(), details ? JSON.stringify(details).slice(0, 1000) : null).run();
}

async function notify(db: D1Database, userId: string, kind: string, itemId: string, message: string) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS community_notifications (
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL,
    item_id TEXT,message TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER
  )`).run();
  await db.prepare("INSERT INTO community_notifications (id,user_id,actor_id,kind,item_id,message,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), userId, "0", kind, itemId, message.slice(0, 240), Date.now()).run();
}

async function runLifecycle(env: Env) {
  await ensureSchema(env.DB);
  const settings = await env.DB.prepare("SELECT * FROM community_cleanup_settings WHERE id=1").first<any>();
  const now = Date.now();
  const users = await env.DB.prepare("SELECT DISTINCT author_id FROM community_modpacks WHERE lifecycle_state!='deleted'").all<{ author_id: string }>();
  const summary = { permanentDeletionEnabled: !!settings?.enabled, checkedCreators: 0, roleLossCandidates: 0, hidden: 0, restored: 0, inactivityCandidates: 0, warned: 0, deleted: 0, errors: 0 };

  for (const creator of users.results || []) {
    const userId = String(creator.author_id);
    if (!/^\d{17,20}$/.test(userId)) continue;
    summary.checkedCreators++;
    const role = await discordRole(env, userId);
    if (role === "unknown") { summary.errors++; continue; }
    const uploads = await env.DB.prepare("SELECT * FROM community_modpacks WHERE author_id=? AND lifecycle_state!='deleted'").bind(userId).all<any>();
    if (role === "missing") {
      summary.roleLossCandidates += uploads.results?.length || 0;
      for (const row of uploads.results || []) {
        await env.DB.prepare("INSERT INTO community_cleanup_preview (item_id,author_id,item_name,reason,detected_at,last_updated_at,last_download_at,status) VALUES (?,?,?,?,?,?,?,'candidate') ON CONFLICT(item_id) DO UPDATE SET reason=excluded.reason,detected_at=excluded.detected_at,last_updated_at=excluded.last_updated_at,last_download_at=excluded.last_download_at,status='candidate'")
          .bind(row.id, userId, row.name, "discord_role_missing", now, row.last_updated_at, row.last_download_at).run();

        if (!row.role_removed_at) {
          await env.DB.prepare("UPDATE community_modpacks SET is_hidden=1,role_removed_at=?,role_purge_after=?,lifecycle_state='role_grace' WHERE id=?")
            .bind(now, now + Number(settings.role_grace_days || 30) * DAY, row.id).run();
          await notify(env.DB, userId, "lifecycle_role_removed", row.id, `Your upload "${row.name}" has been hidden because your required Community Discord role is no longer active. Restore the role within 30 days to keep it published.`);
          await audit(env.DB, row, "hidden", "discord_role_removed");
          summary.hidden++;
        } else if (Number(row.role_purge_after || 0) <= now) {
          try {
            await deleteOwnedObject(env, row);
            await env.DB.prepare("DELETE FROM community_modpacks WHERE id=?").bind(row.id).run();
            await env.DB.prepare("DELETE FROM community_cleanup_preview WHERE item_id=?").bind(row.id).run();
            await audit(env.DB, row, "deleted", "discord_role_grace_expired");
            await notify(env.DB, userId, "lifecycle_removed", row.id, `Your upload "${row.name}" was removed after the 30-day Discord role restoration period expired.`);
            summary.deleted++;
          } catch (error) { summary.errors++; console.error("[Lifecycle] Safe deletion blocked", row.id, error); }
        }
      }
      continue;
    }

    for (const row of uploads.results || []) {
      await env.DB.prepare("DELETE FROM community_cleanup_preview WHERE item_id=? AND reason='discord_role_missing'").bind(row.id).run();
      if (row.role_removed_at) {
        await env.DB.prepare("UPDATE community_modpacks SET is_hidden=0,role_removed_at=NULL,role_purge_after=NULL,lifecycle_state='active' WHERE id=?").bind(row.id).run();
        await notify(env.DB, userId, "lifecycle_role_restored", row.id, `Your upload "${row.name}" is visible in Community again because your Discord role was restored.`);
        await env.DB.prepare("DELETE FROM community_cleanup_preview WHERE item_id=?").bind(row.id).run();
        await audit(env.DB, row, "restored", "discord_role_restored");
        summary.restored++;
        continue;
      }
      const updated = Number(row.last_updated_at || row.created_at || now);
      const lastDownload = Number(row.last_download_at || 0);
      const oldEnough = now - updated >= Number(settings?.inactivity_months || 24) * 30.4375 * DAY;
      const quietEnough = !lastDownload || now - lastDownload >= Number(settings?.no_download_months || 12) * 30.4375 * DAY;
      if (oldEnough && quietEnough) {
        await env.DB.prepare("INSERT INTO community_cleanup_preview (item_id,author_id,item_name,reason,detected_at,last_updated_at,last_download_at,status) VALUES (?,?,?,?,?,?,?,'candidate') ON CONFLICT(item_id) DO UPDATE SET reason=excluded.reason,detected_at=excluded.detected_at,last_updated_at=excluded.last_updated_at,last_download_at=excluded.last_download_at,status='candidate'")
          .bind(row.id, userId, row.name, "long_term_inactivity", now, updated, lastDownload || null).run();
      } else {
        await env.DB.prepare("DELETE FROM community_cleanup_preview WHERE item_id=?").bind(row.id).run();
      }
      if (oldEnough && quietEnough && !row.inactivity_warning_at) {
        summary.inactivityCandidates++;
        if (settings?.enabled) {
          await env.DB.prepare("UPDATE community_modpacks SET inactivity_warning_at=?,inactivity_purge_after=?,lifecycle_state='inactivity_warning' WHERE id=?")
            .bind(now, now + Number(settings.inactivity_grace_days || 90) * DAY, row.id).run();
          await notify(env.DB, userId, "lifecycle_inactivity_warning", row.id, `Your upload "${row.name}" has been inactive for a long time and is scheduled for review. Select Keep Published in My Profile within 90 days to retain it.`);
          await audit(env.DB, row, "warned", "long_term_inactivity");
          summary.warned++;
        }
      } else if (row.inactivity_warning_at && Number(row.inactivity_purge_after || 0) <= now) {
        const unread = await env.DB.prepare("SELECT 1 yes FROM community_notifications WHERE user_id=? AND item_id=? AND kind='lifecycle_inactivity_warning' AND read_at IS NULL LIMIT 1")
          .bind(userId, row.id).first();
        const maximumAt = Number(row.inactivity_warning_at) + Number(settings?.unread_extension_days || 180) * DAY;
        if (unread && now < maximumAt) {
          if (settings?.enabled) await env.DB.prepare("UPDATE community_modpacks SET inactivity_purge_after=? WHERE id=?").bind(maximumAt, row.id).run();
          continue;
        }
        summary.inactivityCandidates++;
        if (settings?.enabled) {
          try {
            await deleteOwnedObject(env, row);
            await env.DB.prepare("DELETE FROM community_modpacks WHERE id=?").bind(row.id).run();
            await env.DB.prepare("DELETE FROM community_cleanup_preview WHERE item_id=?").bind(row.id).run();
            await audit(env.DB, row, "deleted", "long_term_inactivity");
            await notify(env.DB, userId, "lifecycle_removed", row.id, `Your upload "${row.name}" was removed after the long-term inactivity grace period.`);
            summary.deleted++;
          } catch (error) { summary.errors++; console.error("[Lifecycle] Safe deletion blocked", row.id, error); }
        }
      }
    }
  }
  console.log("[Lifecycle] Daily scan", JSON.stringify(summary));
  return summary;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runLifecycle(env));
  },
  async fetch(request: Request, env: Env) {
    if (request.method !== "POST" || request.headers.get("x-autobe-maintenance-key") !== env.MAINTENANCE_KEY) {
      return json({ error: "Not found" }, 404);
    }
    try { return json(await runLifecycle(env)); }
    catch (error) { console.error("[Lifecycle] Scan failed", error); return json({ error: "Lifecycle scan failed safely." }, 500); }
  },
} satisfies ExportedHandler<Env>;
