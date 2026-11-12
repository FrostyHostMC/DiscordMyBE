export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  DISCORD_BOT_TOKEN: string;
  DISCORD_GUILD_ID: string;
  DISCORD_REQUIRED_ROLE_ID: string;
  MAINTENANCE_KEY?: string;
}

const DAY = 86_400_000;
const OWNER_ID = "1122949730419347487";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

async function ensureSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS community_modpacks (
    id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,author TEXT NOT NULL,author_id TEXT NOT NULL,
    author_avatar TEXT,version TEXT NOT NULL,total_packs INTEGER NOT NULL,size INTEGER NOT NULL,icon_data_url TEXT,
    created_at INTEGER NOT NULL,downloads INTEGER DEFAULT 0,blob_url TEXT NOT NULL,file_name TEXT NOT NULL,included_packs TEXT
  )`).run();
  const columns = await db.prepare("PRAGMA table_info(community_modpacks)").all<{ name: string }>();
  const names = new Set((columns.results || []).map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["last_updated_at", "INTEGER"],
    ["last_download_at", "INTEGER"],
    ["is_hidden", "INTEGER NOT NULL DEFAULT 0"],
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
  await db.prepare(`CREATE TABLE IF NOT EXISTS autobe_upload_sessions (upload_id TEXT PRIMARY KEY,object_key TEXT NOT NULL,user_id TEXT NOT NULL,kind TEXT NOT NULL,declared_size INTEGER NOT NULL,created_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS autobe_upload_parts (upload_id TEXT NOT NULL,part_number INTEGER NOT NULL,etag TEXT NOT NULL,size INTEGER NOT NULL,PRIMARY KEY(upload_id,part_number))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS community_cleanup_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
    inactivity_months INTEGER NOT NULL DEFAULT 24, no_download_months INTEGER NOT NULL DEFAULT 12,
    role_grace_days INTEGER NOT NULL DEFAULT 0, inactivity_grace_days INTEGER NOT NULL DEFAULT 90,
    unread_extension_days INTEGER NOT NULL DEFAULT 180, updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare("INSERT OR IGNORE INTO community_cleanup_settings (id,enabled,updated_at) VALUES (1,0,?)").bind(Date.now()).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS community_cleanup_audit (
    id TEXT PRIMARY KEY, item_id TEXT, author_id TEXT NOT NULL, action TEXT NOT NULL,
    reason TEXT NOT NULL, created_at INTEGER NOT NULL, details TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS community_verified_creators (
    user_id TEXT PRIMARY KEY, verified_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked_at INTEGER
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS community_role_config_validation (
    id INTEGER PRIMARY KEY CHECK(id=1), guild_id TEXT NOT NULL, role_id TEXT NOT NULL,
    is_valid INTEGER NOT NULL, checked_at INTEGER NOT NULL
  )`).run();
  const registryHasRows = await db.prepare("SELECT 1 yes FROM community_verified_creators LIMIT 1").first();
  if (!registryHasRows) {
    await db.prepare("INSERT OR IGNORE INTO community_verified_creators (user_id,verified_at,last_seen_at,revoked_at) SELECT author_id,MIN(created_at),MAX(created_at),NULL FROM community_modpacks GROUP BY author_id").run();
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS community_cleanup_preview (
    item_id TEXT PRIMARY KEY, author_id TEXT NOT NULL, item_name TEXT NOT NULL,
    reason TEXT NOT NULL, detected_at INTEGER NOT NULL, last_updated_at INTEGER,
    last_download_at INTEGER, status TEXT NOT NULL DEFAULT 'candidate'
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_community_modpacks_lifecycle ON community_modpacks(lifecycle_state,role_purge_after,inactivity_purge_after)").run();
}

async function validateRoleConfig(env:Env,force=false):Promise<boolean>{
  if(!env.DISCORD_BOT_TOKEN||!env.DISCORD_GUILD_ID||!env.DISCORD_REQUIRED_ROLE_ID)return false;
  const now=Date.now();
  const cached=await env.DB.prepare("SELECT guild_id,role_id,is_valid,checked_at FROM community_role_config_validation WHERE id=1").first<{guild_id:string;role_id:string;is_valid:number;checked_at:number}>();
  if(!force&&cached&&cached.guild_id===env.DISCORD_GUILD_ID&&cached.role_id===env.DISCORD_REQUIRED_ROLE_ID&&now-Number(cached.checked_at)<5*60*1000)return cached.is_valid===1;
  try{
    const response=await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/roles`,{headers:{authorization:`Bot ${env.DISCORD_BOT_TOKEN}`}});
    if(!response.ok)return false;
    const roles=await response.json() as Array<{id?:string}>;
    const valid=Array.isArray(roles)&&roles.some(role=>role.id===env.DISCORD_REQUIRED_ROLE_ID);
    await env.DB.prepare("INSERT INTO community_role_config_validation (id,guild_id,role_id,is_valid,checked_at) VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET guild_id=excluded.guild_id,role_id=excluded.role_id,is_valid=excluded.is_valid,checked_at=excluded.checked_at").bind(env.DISCORD_GUILD_ID,env.DISCORD_REQUIRED_ROLE_ID,valid?1:0,now).run();
    return valid;
  }catch{return false;}
}

async function discordRole(env: Env, userId: string): Promise<"present" | "missing" | "unknown"> {
  if(!await validateRoleConfig(env))return 'unknown';
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`, {
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    if (response.status === 404) {
      const error = await response.json().catch(() => null) as { code?: number } | null;
      // Discord code 10007 is specifically "Unknown Member". Unknown Guild,
      // unknown route, and other 404s must never be treated as role loss.
      return error?.code === 10007 && await validateRoleConfig(env,true) ? "missing" : "unknown";
    }
    if (response.status === 429 || response.status >= 500) return "unknown";
    if (!response.ok) {
      console.error("[Lifecycle] Discord role lookup failed", response.status);
      return "unknown";
    }
    const member = await response.json() as { roles?: string[] };
    const hasRole = member.roles?.includes(env.DISCORD_REQUIRED_ROLE_ID) || false;
    if (!hasRole && !await validateRoleConfig(env,true)) return "unknown";
    return hasRole ? "present" : "missing";
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
  if (!object) return; // The listing can be removed; its object is already absent.
  if (object.customMetadata?.ownerId !== row.author_id ||
      object.customMetadata?.kind !== "pub" ||
      object.customMetadata?.declaredSize !== String(object.size) ||
      object.size !== Number(row.size)) {
    throw new Error("R2 ownership metadata or file size did not match; object was retained.");
  }
  await env.BUCKET.delete(key);
}

async function deleteCreatorObjects(env:Env,userId:string){
  for (const kind of ["pub","temp"] as const) {
    let cursor:string|undefined;
    do {
      try {
        const page=await env.BUCKET.list({prefix:`${kind}/${userId}/`,limit:1000,...(cursor?{cursor}:{})});
        for (const item of page.objects) {
          try {
            const object=await env.BUCKET.head(item.key);
            if (!object) continue;
            const metadata=object.customMetadata;
            if (metadata?.ownerId!==userId || metadata?.kind!==kind ||
                metadata?.declaredSize!==String(object.size) || object.size!==item.size) {
              console.error("[Lifecycle] Retained R2 object with unverified owner metadata",item.key);
              continue;
            }
            await env.BUCKET.delete(item.key);
          } catch (error) {
            console.error("[Lifecycle] Could not remove owned R2 object",item.key,error);
          }
        }
        cursor=page.truncated?page.cursor:undefined;
      } catch (error) {
        console.error("[Lifecycle] R2 owner-prefix cleanup failed",kind,userId,error);
        break;
      }
    } while (cursor);
  }
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
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS community_cleanup_scan_state (
    id INTEGER PRIMARY KEY CHECK(id=1), cursor_user_id TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
  )`).run();
  await env.DB.prepare("INSERT OR IGNORE INTO community_cleanup_scan_state (id,cursor_user_id,updated_at) VALUES (1,'',?)").bind(now).run();
  const scanState = await env.DB.prepare("SELECT cursor_user_id FROM community_cleanup_scan_state WHERE id=1").first<{cursor_user_id:string}>();
  const cursor = scanState?.cursor_user_id || '';
  const page = await env.DB.prepare("SELECT user_id author_id FROM community_verified_creators WHERE user_id>? ORDER BY user_id LIMIT 201")
    .bind(cursor).all<{ author_id: string }>();
  const hasMore = (page.results || []).length > 200;
  const creators = (page.results || []).slice(0, 200);
  const summary = { permanentDeletionEnabled: !!settings?.enabled, checkedCreators: 0, roleLossCandidates: 0, hidden: 0, restored: 0, inactivityCandidates: 0, warned: 0, deleted: 0, errors: 0, moreCreatorsQueued: hasMore };
  if (!await validateRoleConfig(env, true)) {
    summary.errors++;
    console.error("[Lifecycle] Required Discord role could not be validated; no creator cleanup was performed.");
    return summary;
  }

  for (const creator of creators) {
    const userId = String(creator.author_id);
    if (!/^\d{17,20}$/.test(userId)) {
      await env.DB.prepare("UPDATE community_cleanup_scan_state SET cursor_user_id=?,updated_at=? WHERE id=1").bind(userId, now).run();
      continue;
    }
    summary.checkedCreators++;
    const role = await discordRole(env, userId);
    if (role === "unknown") {
      summary.errors++;
      await env.DB.prepare("UPDATE community_cleanup_scan_state SET cursor_user_id=?,updated_at=? WHERE id=1").bind(userId, now).run();
      continue;
    }
    if (role === "present") {
      await env.DB.prepare("INSERT INTO community_verified_creators (user_id,verified_at,last_seen_at,revoked_at) VALUES (?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,revoked_at=NULL")
        .bind(userId, now, now).run();
    }
    const uploads = await env.DB.prepare("SELECT * FROM community_modpacks WHERE author_id=? AND lifecycle_state!='deleted'").bind(userId).all<any>();
    if (role === "missing") {
      const previouslyVerified = await env.DB.prepare("SELECT 1 yes FROM community_verified_creators WHERE user_id=?").bind(userId).first();
      if (!previouslyVerified) {
        await env.DB.prepare("UPDATE community_cleanup_scan_state SET cursor_user_id=?,updated_at=? WHERE id=1").bind(userId, now).run();
        continue;
      }
      await env.DB.prepare("UPDATE community_verified_creators SET revoked_at=COALESCE(revoked_at,?),last_seen_at=? WHERE user_id=?")
        .bind(now, now, userId).run();
      const sessions = await env.DB.prepare("SELECT upload_id,object_key FROM autobe_upload_sessions WHERE user_id=?").bind(userId).all<{upload_id:string;object_key:string}>();
      for (const session of sessions.results || []) {
        await env.BUCKET.resumeMultipartUpload(session.object_key,session.upload_id).abort().catch(() => {});
        await env.DB.batch([
          env.DB.prepare("DELETE FROM autobe_upload_parts WHERE upload_id=?").bind(session.upload_id),
          env.DB.prepare("DELETE FROM autobe_upload_sessions WHERE upload_id=?").bind(session.upload_id),
        ]);
      }
      summary.roleLossCandidates += uploads.results?.length || 0;
      for (const row of uploads.results || []) {
        // Losing the required role is an immediate revocation, not an inactivity
        // grace period. Hide first, then delete the exact verified R2 object and
        // its listing. Failed ownership checks keep the listing hidden and retry.
        await env.DB.prepare("UPDATE community_modpacks SET is_hidden=1,role_removed_at=COALESCE(role_removed_at,?),role_purge_after=?,lifecycle_state='role_removed' WHERE id=?")
          .bind(now, now, row.id).run();
        try {
          await deleteOwnedObject(env, row);
          await env.DB.prepare("DELETE FROM community_modpacks WHERE id=?").bind(row.id).run();
          await env.DB.prepare("DELETE FROM community_cleanup_preview WHERE item_id=?").bind(row.id).run();
          await audit(env.DB, row, "deleted", "discord_role_removed");
          await notify(env.DB, userId, "lifecycle_removed", row.id, `Your upload "${row.name}" and its published file were removed because your required Discord role was taken away. Restore the role and verify again before publishing new content.`);
          summary.deleted++;
        } catch (error) {
          summary.errors++;
          await env.DB.prepare("INSERT INTO community_cleanup_preview (item_id,author_id,item_name,reason,detected_at,last_updated_at,last_download_at,status) VALUES (?,?,?,?,?,?,?,'blocked') ON CONFLICT(item_id) DO UPDATE SET reason=excluded.reason,detected_at=excluded.detected_at,status='blocked'")
            .bind(row.id, userId, row.name, "discord_role_deletion_blocked", now, row.last_updated_at, row.last_download_at).run();
          console.error("[Lifecycle] Safe deletion blocked; listing remains hidden", row.id, error);
        }
      }
      await deleteCreatorObjects(env,userId);
      await env.DB.prepare("UPDATE community_cleanup_scan_state SET cursor_user_id=?,updated_at=? WHERE id=1").bind(userId, now).run();
      continue;
    }

    for (const row of uploads.results || []) {
      await env.DB.prepare("DELETE FROM community_cleanup_preview WHERE item_id=? AND reason='discord_role_missing'").bind(row.id).run();
      if (row.role_removed_at) {
        // Once role revocation has started, deleted content is never silently
        // republished if the role is later re-added. The creator must re-verify
        // and upload again.
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
    await env.DB.prepare("UPDATE community_cleanup_scan_state SET cursor_user_id=?,updated_at=? WHERE id=1")
      .bind(userId, now).run();
  }
  if (!hasMore) await env.DB.prepare("UPDATE community_cleanup_scan_state SET cursor_user_id='',updated_at=? WHERE id=1").bind(now).run();
  console.log("[Lifecycle] Scheduled scan", JSON.stringify(summary));
  return summary;
}

async function secureSecretEquals(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(leftHash);
  const right = new Uint8Array(rightHash);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runLifecycle(env));
  },
  async fetch(request: Request, env: Env) {
    const providedKey = request.headers.get("x-autobe-maintenance-key") || "";
    if (request.method !== "POST" || !env.MAINTENANCE_KEY || !await secureSecretEquals(providedKey, env.MAINTENANCE_KEY)) {
      return json({ error: "Not found" }, 404);
    }
    try { return json(await runLifecycle(env)); }
    catch (error) { console.error("[Lifecycle] Scan failed", error); return json({ error: "Lifecycle scan failed safely." }, 500); }
  },
} satisfies ExportedHandler<Env>;
