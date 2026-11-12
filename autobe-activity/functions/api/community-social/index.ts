import type { Context } from '@cloudflare/workers-types';
import { getOwnedPublishedObjectKey, isOwnedPublishedObject } from '../_shared/uploadOwnership';
interface Env { DB: D1Database; BUCKET: R2Bucket; DISCORD_CLIENT_ID: string; DISCORD_BOT_TOKEN: string; DISCORD_GUILD_ID: string; DISCORD_REQUIRED_ROLE_ID: string }
type Ctx = Context & { env: Env };
const ADMIN_DISCORD_IDS=new Set(['1122949730419347487','900117843272663040']);
const CATEGORIES=['Horror','Medieval','Fantasy','Survival','Technology','Magic','PvP','Adventure','Weapons','Mobs','Blocks','Decorations','Utility','Other'];
const BADGES=['Featured Creator','Community Favorite','Top Creator','Trusted Creator','Early Creator','Addon Specialist','Modpack Builder'];
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
async function who(request:Request,env:Env){
 const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return null;
 try{const r=await fetch('https://discord.com/api/v10/oauth2/@me',{headers:{authorization:`Bearer ${token}`}});if(!r.ok)return null;const d=await r.json() as any;if(d.application?.id!==env.DISCORD_CLIENT_ID||!d.user?.id)return null;return{id:String(d.user.id),name:String(d.user.global_name||d.user.username||'Discord member')};}catch{return null;}
}
async function requiredRoleIsConfigured(env:Env,force=false):Promise<boolean>{
 if(!env.DISCORD_BOT_TOKEN||!env.DISCORD_GUILD_ID||!env.DISCORD_REQUIRED_ROLE_ID)return false;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS community_role_config_validation (id INTEGER PRIMARY KEY CHECK(id=1),guild_id TEXT NOT NULL,role_id TEXT NOT NULL,is_valid INTEGER NOT NULL,checked_at INTEGER NOT NULL)").run();
 const now=Date.now();
 const cached=await env.DB.prepare("SELECT guild_id,role_id,is_valid,checked_at FROM community_role_config_validation WHERE id=1").first<{guild_id:string;role_id:string;is_valid:number;checked_at:number}>();
 if(!force&&cached&&cached.guild_id===env.DISCORD_GUILD_ID&&cached.role_id===env.DISCORD_REQUIRED_ROLE_ID&&now-Number(cached.checked_at)<10000)return cached.is_valid===1;
 try{
  const response=await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/roles`,{headers:{authorization:`Bot ${env.DISCORD_BOT_TOKEN}`}});
  if(!response.ok)return false;
  const roles=await response.json() as Array<{id?:string}>;
  const valid=Array.isArray(roles)&&roles.some(role=>role.id===env.DISCORD_REQUIRED_ROLE_ID);
  await env.DB.prepare("INSERT INTO community_role_config_validation (id,guild_id,role_id,is_valid,checked_at) VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET guild_id=excluded.guild_id,role_id=excluded.role_id,is_valid=excluded.is_valid,checked_at=excluded.checked_at").bind(env.DISCORD_GUILD_ID,env.DISCORD_REQUIRED_ROLE_ID,valid?1:0,now).run();
  return valid;
 }catch{return false;}
}
async function communityRoleStatus(userId:string,env:Env):Promise<'present'|'missing'|'unknown'>{
 if(!env.DISCORD_BOT_TOKEN||!env.DISCORD_GUILD_ID||!env.DISCORD_REQUIRED_ROLE_ID)return 'unknown';
 if(!await requiredRoleIsConfigured(env))return 'unknown';
 try{
  const r=await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/members/${encodeURIComponent(userId)}`,{headers:{authorization:`Bot ${env.DISCORD_BOT_TOKEN}`}});
  if(r.status===404){const error=await r.json().catch(()=>null) as {code?:number}|null;return error?.code===10007&&await requiredRoleIsConfigured(env,true)?'missing':'unknown';}
  if(r.status===429||r.status>=500||!r.ok)return 'unknown';
  const member=await r.json() as {roles?:string[]};
  const hasRole=Array.isArray(member.roles)&&member.roles.includes(env.DISCORD_REQUIRED_ROLE_ID);
  if(!hasRole&&!await requiredRoleIsConfigured(env,true))return 'unknown';
  return hasRole?'present':'missing';
 }catch{return 'unknown';}
}
const ROLE_REQUIRED_MESSAGE='You no longer have the required AutoBE Discord role. Your Community access has been revoked. Rejoin the required role and reopen AutoBE to verify again.';
async function auditRevocation(db:D1Database,row:any,userId:string){
 await db.prepare("INSERT INTO community_cleanup_audit (id,item_id,author_id,action,reason,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),row.id,userId,'deleted','discord_role_removed',Date.now()).run();
}
async function deleteVerifiedUserObjects(env:Env,userId:string){
 for(const kind of ['pub','temp'] as const){
  let cursor:string|undefined;
  do{
   try{
    const page=await env.BUCKET.list({prefix:`${kind}/${userId}/`,limit:1000,...(cursor?{cursor}:{})});
    for(const item of page.objects){
     try{
      const object=await env.BUCKET.head(item.key);
      if(!object)continue;
      const metadata=object.customMetadata;
      if(metadata?.ownerId!==userId||metadata?.kind!==kind||metadata?.declaredSize!==String(object.size)||object.size!==item.size){
       console.error('[CommunitySocial] Retained R2 object with unverified ownership metadata',item.key);
       continue;
      }
      await env.BUCKET.delete(item.key);
     }catch(error){console.error('[CommunitySocial] Could not remove owned R2 object',item.key,error);}
    }
    cursor=page.truncated?page.cursor:undefined;
   }catch(error){console.error('[CommunitySocial] R2 owner-prefix cleanup failed',kind,userId,error);break;}
  }while(cursor);
 }
}
async function revokeVerifiedCreator(userId:string,env:Env,baseUrl:string){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS autobe_upload_sessions (upload_id TEXT PRIMARY KEY,object_key TEXT NOT NULL,user_id TEXT NOT NULL,kind TEXT NOT NULL,declared_size INTEGER NOT NULL,created_at INTEGER NOT NULL)`).run();
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS autobe_upload_parts (upload_id TEXT NOT NULL,part_number INTEGER NOT NULL,etag TEXT NOT NULL,size INTEGER NOT NULL,PRIMARY KEY(upload_id,part_number))`).run();
 const sessions=await env.DB.prepare("SELECT upload_id,object_key FROM autobe_upload_sessions WHERE user_id=?").bind(userId).all<{upload_id:string;object_key:string}>();
 for(const session of sessions.results||[]){
  await env.BUCKET.resumeMultipartUpload(session.object_key,session.upload_id).abort().catch(()=>{});
  await env.DB.batch([
   env.DB.prepare("DELETE FROM autobe_upload_parts WHERE upload_id=?").bind(session.upload_id),
   env.DB.prepare("DELETE FROM autobe_upload_sessions WHERE upload_id=?").bind(session.upload_id)
  ]);
 }
 const rows=await env.DB.prepare("SELECT id,name,author_id,blob_url,size FROM community_modpacks WHERE author_id=? AND lifecycle_state!='deleted'").bind(userId).all<any>();
 for(const row of rows.results||[]){
  const now=Date.now();
  await env.DB.prepare("UPDATE community_modpacks SET is_hidden=1,role_removed_at=COALESCE(role_removed_at,?),role_purge_after=?,lifecycle_state='role_removed' WHERE id=?").bind(now,now,row.id).run();
  try{
   const key=getOwnedPublishedObjectKey(String(row.blob_url||''),userId,baseUrl);
   if(!key)throw new Error('Published object key could not be verified; listing remains hidden.');
   const object=await env.BUCKET.head(key);
   if(object&&!isOwnedPublishedObject(object.customMetadata,object.size,userId))throw new Error('Immutable R2 ownership metadata failed verification; listing remains hidden.');
   if(object&&object.size!==Number(row.size))throw new Error('R2 object size mismatch; listing remains hidden.');
   if(object)await env.BUCKET.delete(key);
   await env.DB.prepare("DELETE FROM community_modpacks WHERE id=?").bind(row.id).run();
   await env.DB.prepare("DELETE FROM community_cleanup_preview WHERE item_id=?").bind(row.id).run();
   await auditRevocation(env.DB,row,userId);
   await notify(env.DB,userId,'0','lifecycle_removed',row.id,`Your upload "${row.name}" and its published file were removed because your required Discord role was taken away. Restore the role and verify again before publishing new content.`);
  }catch(error){
   await env.DB.prepare("INSERT INTO community_cleanup_preview (item_id,author_id,item_name,reason,detected_at,last_updated_at,last_download_at,status) VALUES (?,?,?,?,?,?,?,'blocked') ON CONFLICT(item_id) DO UPDATE SET reason=excluded.reason,detected_at=excluded.detected_at,status='blocked'").bind(row.id,userId,row.name,'discord_role_deletion_blocked',now,null,null).run();
   console.error('[CommunitySocial] Role-loss deletion safely blocked',row.id,error);
  }
 }
 await deleteVerifiedUserObjects(env,userId);
 await env.DB.prepare("UPDATE community_verified_creators SET revoked_at=COALESCE(revoked_at,?),last_seen_at=? WHERE user_id=?").bind(Date.now(),Date.now(),userId).run();
}
async function requireRole(me:{id:string},env:Env,request:Request){
 await init(env.DB);
 const registryHasRows=await env.DB.prepare("SELECT 1 yes FROM community_verified_creators LIMIT 1").first();
 if(!registryHasRows)await env.DB.prepare("INSERT OR IGNORE INTO community_verified_creators (user_id,verified_at,last_seen_at,revoked_at) SELECT author_id,MIN(created_at),MAX(created_at),NULL FROM community_modpacks GROUP BY author_id").run();
 const now=Date.now();
 const status=await communityRoleStatus(me.id,env);
 if(status==='present'){
  await env.DB.prepare("INSERT INTO community_verified_creators (user_id,verified_at,last_seen_at,revoked_at) VALUES (?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,revoked_at=NULL").bind(me.id,now,now).run();
  return null;
 }
 if(status==='missing'){
  const previouslyVerified=await env.DB.prepare("SELECT 1 yes FROM community_verified_creators WHERE user_id=?").bind(me.id).first();
  if(previouslyVerified)await revokeVerifiedCreator(me.id,env,request.url);
  return json({error:ROLE_REQUIRED_MESSAGE,code:'DISCORD_ROLE_REQUIRED',verified:false},403);
 }
 return json({error:'We could not verify your Discord role right now. Please try again shortly.',code:'DISCORD_ROLE_CHECK_UNAVAILABLE'},503);
}
async function eligibleCreator(userId:string,env:Env):Promise<boolean>{
 if(!/^\d{17,20}$/.test(userId))return false;
 const [role,uploads]=await Promise.all([
  communityRoleStatus(userId,env),
  env.DB.prepare("SELECT 1 yes FROM community_modpacks WHERE author_id=? AND COALESCE(is_hidden,0)=0 LIMIT 1").bind(userId).first()
 ]);
 if(role!=='present')return false;
 return role&&!!uploads;
}
async function init(db:D1Database){
 await db.prepare(`CREATE TABLE IF NOT EXISTS community_modpacks (
  id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,author TEXT NOT NULL,author_id TEXT NOT NULL,
  author_avatar TEXT,version TEXT NOT NULL,total_packs INTEGER NOT NULL,size INTEGER NOT NULL,icon_data_url TEXT,
  created_at INTEGER NOT NULL,downloads INTEGER DEFAULT 0,blob_url TEXT NOT NULL,file_name TEXT NOT NULL,included_packs TEXT
 )`).run();
 const statements=[
 "CREATE TABLE IF NOT EXISTS community_creator_profiles (user_id TEXT PRIMARY KEY,bio TEXT NOT NULL DEFAULT '',website TEXT NOT NULL DEFAULT '',youtube TEXT NOT NULL DEFAULT '',twitch TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL)",
 'CREATE TABLE IF NOT EXISTS community_likes (user_id TEXT NOT NULL,item_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,item_id))',
 'CREATE TABLE IF NOT EXISTS community_favorites (user_id TEXT NOT NULL,item_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,item_id))',
 'CREATE TABLE IF NOT EXISTS community_follows (follower_id TEXT NOT NULL,creator_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(follower_id,creator_id))',
 "CREATE TABLE IF NOT EXISTS community_reviews (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,item_id TEXT NOT NULL,rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),body TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(user_id,item_id))",
 "CREATE TABLE IF NOT EXISTS community_collections (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)",
 'CREATE TABLE IF NOT EXISTS community_collection_items (collection_id TEXT NOT NULL,item_id TEXT NOT NULL,added_at INTEGER NOT NULL,PRIMARY KEY(collection_id,item_id))',
 'CREATE TABLE IF NOT EXISTS community_notifications (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL,item_id TEXT,message TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER)',
 'CREATE INDEX IF NOT EXISTS idx_community_notifications_user ON community_notifications(user_id,created_at DESC)',
 'CREATE TABLE IF NOT EXISTS community_badges (user_id TEXT NOT NULL,badge TEXT NOT NULL,awarded_at INTEGER NOT NULL,PRIMARY KEY(user_id,badge))',
 'CREATE TABLE IF NOT EXISTS community_featured_creators (user_id TEXT PRIMARY KEY,featured_at INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS community_verified_creators (user_id TEXT PRIMARY KEY,verified_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,revoked_at INTEGER)'
 ];for(const sql of statements)await db.prepare(sql).run();
 const columns=await db.prepare('PRAGMA table_info(community_modpacks)').all<{name:string}>();
 if(!(columns.results||[]).some(c=>c.name==='featured'))await db.prepare('ALTER TABLE community_modpacks ADD COLUMN featured INTEGER NOT NULL DEFAULT 0').run();
 if(!(columns.results||[]).some(c=>c.name==='is_hidden'))await db.prepare('ALTER TABLE community_modpacks ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0').run();
 const names=new Set((columns.results||[]).map(c=>c.name));
 for(const [name,type] of [['content_type',"TEXT NOT NULL DEFAULT 'modpack'"],['category',"TEXT NOT NULL DEFAULT 'Other'"],['detail_description','TEXT'],['detail_images','TEXT'],['last_updated_at','INTEGER'],['last_download_at','INTEGER'],['role_removed_at','INTEGER'],['role_purge_after','INTEGER'],['inactivity_warning_at','INTEGER'],['inactivity_purge_after','INTEGER'],['lifecycle_state',"TEXT NOT NULL DEFAULT 'active'"]] as Array<[string,string]>)if(!names.has(name))await db.prepare(`ALTER TABLE community_modpacks ADD COLUMN ${name} ${type}`).run();
 await db.prepare('UPDATE community_modpacks SET last_updated_at=created_at WHERE last_updated_at IS NULL').run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS community_cleanup_settings (id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,inactivity_months INTEGER NOT NULL DEFAULT 24,no_download_months INTEGER NOT NULL DEFAULT 12,role_grace_days INTEGER NOT NULL DEFAULT 30,inactivity_grace_days INTEGER NOT NULL DEFAULT 90,unread_extension_days INTEGER NOT NULL DEFAULT 180,updated_at INTEGER NOT NULL)`).run();
 await db.prepare('INSERT OR IGNORE INTO community_cleanup_settings (id,enabled,updated_at) VALUES (1,0,?)').bind(Date.now()).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS community_cleanup_audit (id TEXT PRIMARY KEY,item_id TEXT,author_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,details TEXT)`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS community_cleanup_preview (item_id TEXT PRIMARY KEY,author_id TEXT NOT NULL,item_name TEXT NOT NULL,reason TEXT NOT NULL,detected_at INTEGER NOT NULL,last_updated_at INTEGER,last_download_at INTEGER,status TEXT NOT NULL DEFAULT 'candidate')`).run();
}
async function notify(db:D1Database,to:string,actor:string,kind:string,item:string|null,message:string){if(!to||to===actor)return;await db.prepare('INSERT INTO community_notifications (id,user_id,actor_id,kind,item_id,message,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),to,actor,kind,item,message.slice(0,240),Date.now()).run();}
const owner=(id:string)=>ADMIN_DISCORD_IDS.has(id);
export async function onRequestGet({request,env}:Ctx){
 const me=await who(request,env);if(!me)return json({error:'Sign in through Discord to use Community features.'},401);
 try{const roleFailure=await requireRole(me,env,request);if(roleFailure)return roleFailure;const u=new URL(request.url),action=u.searchParams.get('action')||'me';
 if(action==='creators'){
 const q=(u.searchParams.get('q')||'').trim().slice(0,48);
 if(q.length<2)return json({creators:[]});
 const rows=await env.DB.prepare("SELECT m.author_id,MAX(m.author) author,MAX(m.author_avatar) author_avatar,COUNT(DISTINCT m.id) uploads,COALESCE(SUM(m.downloads),0) downloads,COALESCE((SELECT COUNT(*) FROM community_follows f WHERE f.creator_id=m.author_id),0) followers FROM community_modpacks m WHERE COALESCE(m.is_hidden,0)=0 AND (m.author LIKE ? OR m.author_id=?) GROUP BY m.author_id ORDER BY uploads DESC,downloads DESC LIMIT 100").bind(`%${q}%`,q).all<any>();
 const checked=await Promise.all((rows.results||[]).map(async c=>await eligibleCreator(String(c.author_id),env)?c:null));const creators=checked.filter(Boolean);
 return json({creators:creators.slice(0,20)});
 }
 if(action==='creator'){
 const id=u.searchParams.get('id')||'';if(!/^\d{17,20}$/.test(id))return json({error:'Creator not found.'},404);
 if(!await eligibleCreator(id,env))return json({error:'This creator is not currently discoverable.'},404);
 const [profile,uploads,stats,badges,following]=await Promise.all([
  env.DB.prepare('SELECT bio,website,youtube,twitch FROM community_creator_profiles WHERE user_id=?').bind(id).first(),
  env.DB.prepare('SELECT id,name,description,author,author_id,author_avatar,version,total_packs,size,icon_data_url,created_at,downloads,file_name,content_type,category FROM community_modpacks WHERE author_id=? AND COALESCE(is_hidden,0)=0 ORDER BY created_at DESC LIMIT 100').bind(id).all(),
  env.DB.prepare('SELECT COUNT(*) uploads,COALESCE(SUM(downloads),0) downloads FROM community_modpacks WHERE author_id=? AND COALESCE(is_hidden,0)=0').bind(id).first<any>(),
  env.DB.prepare('SELECT badge,awarded_at FROM community_badges WHERE user_id=? ORDER BY awarded_at DESC').bind(id).all(),
  env.DB.prepare('SELECT 1 yes FROM community_follows WHERE follower_id=? AND creator_id=?').bind(me.id,id).first()
 ]);
 const creator=await env.DB.prepare('SELECT MAX(author) author,MAX(author_avatar) author_avatar FROM community_modpacks WHERE author_id=? AND COALESCE(is_hidden,0)=0').bind(id).first<any>();
 const followerCount=await env.DB.prepare('SELECT COUNT(*) count FROM community_follows WHERE creator_id=?').bind(id).first<any>();
 return json({creator:{id,author:creator?.author||'Creator',author_avatar:creator?.author_avatar||null,...(profile||{bio:'',website:'',youtube:'',twitch:''}),uploads:stats?.uploads||0,downloads:stats?.downloads||0,followers:followerCount?.count||0,following:!!following,badges:badges.results||[]},items:uploads.results||[]});
 }
  if(action==='admin'){if(!owner(me.id))return json({error:'Owner access only.'},403);
 const [uploads,creators,featured,cleanupSettings,cleanupPending,cleanupRecent,cleanupPreview]=await Promise.all([
 env.DB.prepare('SELECT id,name,author,author_id,content_type,category,downloads,featured,is_hidden FROM community_modpacks ORDER BY created_at DESC LIMIT 250').all(),
 env.DB.prepare('SELECT author_id,MAX(author) author,COUNT(*) uploads,COALESCE(SUM(downloads),0) downloads FROM community_modpacks WHERE COALESCE(is_hidden,0)=0 GROUP BY author_id ORDER BY uploads DESC,downloads DESC LIMIT 150').all(),
 env.DB.prepare('SELECT user_id,featured_at FROM community_featured_creators ORDER BY featured_at DESC').all(),
 env.DB.prepare('SELECT * FROM community_cleanup_settings WHERE id=1').first(),
 env.DB.prepare("SELECT id,name,author,author_id,lifecycle_state,role_purge_after,inactivity_purge_after,inactivity_warning_at,last_updated_at,last_download_at FROM community_modpacks WHERE lifecycle_state!='active' OR inactivity_warning_at IS NOT NULL ORDER BY COALESCE(role_purge_after,inactivity_purge_after) ASC LIMIT 100").all(),
 env.DB.prepare("SELECT id,item_id,author_id,action,reason,created_at FROM community_cleanup_audit ORDER BY created_at DESC LIMIT 50").all(),
 env.DB.prepare("SELECT item_id id,author_id,item_name name,reason,detected_at,last_updated_at,last_download_at,status FROM community_cleanup_preview ORDER BY detected_at DESC LIMIT 100").all()]);
 const checked=await Promise.all((creators.results||[]).map(async c=>await eligibleCreator(String(c.author_id),env)?c:null));const eligible=checked.filter(Boolean);return json({uploads:uploads.results||[],creators:eligible,featuredCreators:featured.results||[],categories:CATEGORIES,badges:BADGES,cleanup:{settings:cleanupSettings,pending:cleanupPending.results||[],recent:cleanupRecent.results||[],preview:cleanupPreview.results||[]}});}
 if(action==='items'){const r=await env.DB.prepare(`SELECT m.id,COUNT(DISTINCT l.user_id) likes,COUNT(DISTINCT v.id) reviewCount,COALESCE(AVG(v.rating),0) averageRating,EXISTS(SELECT 1 FROM community_likes x WHERE x.user_id=? AND x.item_id=m.id) liked,EXISTS(SELECT 1 FROM community_favorites x WHERE x.user_id=? AND x.item_id=m.id) favorited,EXISTS(SELECT 1 FROM community_follows x WHERE x.follower_id=? AND x.creator_id=m.author_id) followingCreator FROM community_modpacks m LEFT JOIN community_likes l ON l.item_id=m.id LEFT JOIN community_reviews v ON v.item_id=m.id WHERE m.content_type='addon' AND COALESCE(m.is_hidden,0)=0 GROUP BY m.id ORDER BY m.created_at DESC LIMIT 250`).bind(me.id,me.id,me.id).all();return json({items:r.results||[]});}
 if(action==='discovery'){
 const contentType=u.searchParams.get('content_type')==='addon'?'addon':'modpack';
 const [featuredUploads,featuredCreators,leaders]=await Promise.all([
 env.DB.prepare('SELECT id,name,author,author_id,content_type,category,downloads,featured FROM community_modpacks WHERE featured=1 AND content_type=? AND COALESCE(is_hidden,0)=0 ORDER BY created_at DESC LIMIT 12').bind(contentType).all(),
 env.DB.prepare('SELECT f.user_id,MAX(m.author) author,COUNT(m.id) uploads,COALESCE(SUM(m.downloads),0) downloads FROM community_featured_creators f JOIN community_modpacks m ON m.author_id=f.user_id AND m.content_type=? AND COALESCE(m.is_hidden,0)=0 GROUP BY f.user_id ORDER BY f.featured_at DESC LIMIT 8').bind(contentType).all(),
 env.DB.prepare('SELECT m.author_id,MAX(m.author) author,COUNT(DISTINCT m.id) uploads,COALESCE(SUM(m.downloads),0) downloads,(SELECT COUNT(*) FROM community_likes l JOIN community_modpacks lm ON lm.id=l.item_id WHERE lm.author_id=m.author_id AND lm.content_type=?) likes,(SELECT COUNT(*) FROM community_follows f WHERE f.creator_id=m.author_id) followers FROM community_modpacks m WHERE m.content_type=? AND COALESCE(m.is_hidden,0)=0 GROUP BY m.author_id ORDER BY likes DESC,followers DESC,downloads DESC LIMIT 25').bind(contentType,contentType).all()]);
 const [checkedFeatured,checkedLeaders]=await Promise.all([Promise.all((featuredCreators.results||[]).map(async c=>await eligibleCreator(String(c.user_id),env)?c:null)),Promise.all((leaders.results||[]).map(async c=>await eligibleCreator(String(c.author_id),env)?c:null))]);return json({contentType,featuredUploads:featuredUploads.results||[],featuredCreators:checkedFeatured.filter(Boolean),leaders:checkedLeaders.filter(Boolean).slice(0,10)});}
 if(action==='item'){const id=u.searchParams.get('id');if(!id)return json({error:'Missing upload id.'},400);
 const [likes,favorites,ratings,followers,liked,saved,followed,reviews]=await Promise.all([
 env.DB.prepare('SELECT COUNT(*) count FROM community_likes WHERE item_id=?').bind(id).first<any>(),
 env.DB.prepare('SELECT COUNT(*) count FROM community_favorites WHERE item_id=?').bind(id).first<any>(),
 env.DB.prepare('SELECT COUNT(*) count,AVG(rating) average FROM community_reviews WHERE item_id=?').bind(id).first<any>(),
 env.DB.prepare('SELECT COUNT(*) count FROM community_follows WHERE creator_id=(SELECT author_id FROM community_modpacks WHERE id=?)').bind(id).first<any>(),
 env.DB.prepare('SELECT 1 yes FROM community_likes WHERE user_id=? AND item_id=?').bind(me.id,id).first(),
 env.DB.prepare('SELECT 1 yes FROM community_favorites WHERE user_id=? AND item_id=?').bind(me.id,id).first(),
 env.DB.prepare('SELECT 1 yes FROM community_follows WHERE follower_id=? AND creator_id=(SELECT author_id FROM community_modpacks WHERE id=?)').bind(me.id,id).first(),
 env.DB.prepare('SELECT user_id,rating,body,created_at FROM community_reviews WHERE item_id=? ORDER BY created_at DESC LIMIT 50').bind(id).all()]);
 return json({likes:+(likes?.count||0),favorites:+(favorites?.count||0),reviewCount:+(ratings?.count||0),averageRating:+(ratings?.average||0),followers:+(followers?.count||0),liked:!!liked,favorited:!!saved,followingCreator:!!followed,reviews:reviews.results||[]});}
 if(action==='notifications'){const r=await env.DB.prepare('SELECT * FROM community_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(me.id).all();return json({notifications:r.results||[]});}
 if(action==='favorites'){const r=await env.DB.prepare('SELECT m.id,m.name,m.author,m.author_id,m.content_type,m.category,m.version,m.downloads,m.icon_data_url,f.created_at FROM community_favorites f JOIN community_modpacks m ON m.id=f.item_id WHERE f.user_id=? AND COALESCE(m.is_hidden,0)=0 ORDER BY f.created_at DESC LIMIT 100').bind(me.id).all();return json({favorites:r.results||[]});}
 if(action==='collections'){const r=await env.DB.prepare('SELECT c.*,COUNT(i.item_id) item_count FROM community_collections c LEFT JOIN community_collection_items i ON i.collection_id=c.id WHERE c.user_id=? GROUP BY c.id ORDER BY c.updated_at DESC').bind(me.id).all();return json({collections:r.results||[]});}
 const [profile,followers,following,badges,unread]=await Promise.all([
 env.DB.prepare('SELECT bio,website,youtube,twitch FROM community_creator_profiles WHERE user_id=?').bind(me.id).first(),
 env.DB.prepare('SELECT COUNT(*) count FROM community_follows WHERE creator_id=?').bind(me.id).first<any>(),
 env.DB.prepare('SELECT COUNT(*) count FROM community_follows WHERE follower_id=?').bind(me.id).first<any>(),
 env.DB.prepare('SELECT badge,awarded_at FROM community_badges WHERE user_id=? ORDER BY awarded_at DESC').bind(me.id).all(),
 env.DB.prepare('SELECT COUNT(*) count FROM community_notifications WHERE user_id=? AND read_at IS NULL').bind(me.id).first<any>()]);
 return json({profile:profile||{bio:'',website:'',youtube:'',twitch:''},followers:+(followers?.count||0),following:+(following?.count||0),badges:badges.results||[],unreadNotifications:+(unread?.count||0),isOwner:owner(me.id),isAdmin:owner(me.id),adminRole:me.id==='1122949730419347487'?'Owner':'Admin team'});
 }catch(e){console.error('[CommunitySocial] GET',e);return json({error:'Community data could not be loaded.'},503);}
}
export async function onRequestPost({request,env}:Ctx){
 const me=await who(request,env);if(!me)return json({error:'Sign in through Discord to use Community features.'},401);
 try{const roleFailure=await requireRole(me,env,request);if(roleFailure)return roleFailure;const d=await request.json() as any,a=String(d.action||''),id=String(d.itemId||''),now=Date.now();
 if(a.startsWith('admin_')&&!owner(me.id))return json({error:'Owner access only.'},403);
 if(a==='keep_published'){const item=String(d.uploadId||'');const r=await env.DB.prepare("UPDATE community_modpacks SET last_updated_at=?,inactivity_warning_at=NULL,inactivity_purge_after=NULL,lifecycle_state='active' WHERE id=? AND author_id=? AND COALESCE(role_removed_at,0)=0").bind(now,item,me.id).run();if(!r.meta?.changes)return json({error:'Upload not found or currently hidden due to Discord role status.'},404);await env.DB.prepare("DELETE FROM community_cleanup_preview WHERE item_id=?").bind(item).run();await env.DB.prepare("INSERT INTO community_cleanup_audit (id,item_id,author_id,action,reason,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),item,me.id,'kept_published','creator_confirmed_keep',now).run();return json({success:true});}
 if(a==='admin_cleanup_settings'){if(!owner(me.id))return json({error:'Owner access only.'},403);const enabled=d.enabled===true;const inactivityMonths=Math.max(24,Math.min(60,Number(d.inactivityMonths)||24));const noDownloadMonths=Math.max(12,Math.min(36,Number(d.noDownloadMonths)||12));const roleGraceDays=0,inactivityGraceDays=90,unreadExtensionDays=180;await env.DB.prepare('UPDATE community_cleanup_settings SET enabled=?,inactivity_months=?,no_download_months=?,role_grace_days=?,inactivity_grace_days=?,unread_extension_days=?,updated_at=? WHERE id=1').bind(enabled?1:0,inactivityMonths,noDownloadMonths,roleGraceDays,inactivityGraceDays,unreadExtensionDays,now).run();return json({success:true,enabled});}
 if(a.startsWith('admin_')&&!owner(me.id))return json({error:'Owner access only.'},403);
 if(a==='profile'){const cut=(v:any,n:number)=>String(v||'').trim().slice(0,n);await env.DB.prepare("INSERT INTO community_creator_profiles (user_id,bio,website,youtube,twitch,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio,website=excluded.website,youtube=excluded.youtube,twitch=excluded.twitch,updated_at=excluded.updated_at").bind(me.id,cut(d.bio,500),cut(d.website,200),cut(d.youtube,200),cut(d.twitch,200),now).run();return json({success:true});}
 if(a==='like'||a==='favorite'){if(!id)return json({error:'Missing upload id.'},400);const table=a==='like'?'community_likes':'community_favorites',item=await env.DB.prepare('SELECT author_id,name FROM community_modpacks WHERE id=?').bind(id).first<any>();if(!item)return json({error:'Upload not found.'},404);const old=await env.DB.prepare(`SELECT 1 yes FROM ${table} WHERE user_id=? AND item_id=?`).bind(me.id,id).first();if(old)await env.DB.prepare(`DELETE FROM ${table} WHERE user_id=? AND item_id=?`).bind(me.id,id).run();else{await env.DB.prepare(`INSERT INTO ${table} (user_id,item_id,created_at) VALUES (?,?,?)`).bind(me.id,id,now).run();if(a==='like')await notify(env.DB,item.author_id,me.id,'like',id,`${me.name} liked your upload: ${item.name}`);}return json({success:true,active:!old});}
 if(a==='follow'){const creator=String(d.creatorId||'');if(!/^\d{17,20}$/.test(creator)||creator===me.id)return json({error:'Invalid creator.'},400);if(!await eligibleCreator(creator,env))return json({error:'Creator is not currently eligible for discovery.'},404);const old=await env.DB.prepare('SELECT 1 yes FROM community_follows WHERE follower_id=? AND creator_id=?').bind(me.id,creator).first();if(old)await env.DB.prepare('DELETE FROM community_follows WHERE follower_id=? AND creator_id=?').bind(me.id,creator).run();else{await env.DB.prepare('INSERT INTO community_follows (follower_id,creator_id,created_at) VALUES (?,?,?)').bind(me.id,creator,now).run();await notify(env.DB,creator,me.id,'follow',null,`${me.name} followed you`);}return json({success:true,active:!old});}
 if(a==='review'){if(!id)return json({error:'Missing upload id.'},400);const rating=Number(d.rating),body=String(d.body||'').trim().slice(0,1000),item=await env.DB.prepare('SELECT author_id,name FROM community_modpacks WHERE id=?').bind(id).first<any>();if(!item)return json({error:'Upload not found.'},404);if(!Number.isInteger(rating)||rating<1||rating>5)return json({error:'Rating must be 1–5.'},400);await env.DB.prepare('INSERT INTO community_reviews (id,user_id,item_id,rating,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET rating=excluded.rating,body=excluded.body,updated_at=excluded.updated_at').bind(crypto.randomUUID(),me.id,id,rating,body,now,now).run();await notify(env.DB,item.author_id,me.id,'review',id,`${me.name} reviewed your upload: ${item.name}`);return json({success:true});}
 if(a==='collection_create'){const title=String(d.title||'').trim().slice(0,80);if(!title)return json({error:'Name your collection.'},400);const cid=crypto.randomUUID();await env.DB.prepare("INSERT INTO community_collections (id,user_id,title,description,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(cid,me.id,title,String(d.description||'').slice(0,300),now,now).run();return json({success:true,id:cid});}
 if(a==='collection_add'){const cid=String(d.collectionId||''),owned=await env.DB.prepare('SELECT 1 yes FROM community_collections WHERE id=? AND user_id=?').bind(cid,me.id).first(),exists=await env.DB.prepare('SELECT 1 yes FROM community_modpacks WHERE id=?').bind(id).first();if(!id||!owned||!exists)return json({error:'Collection or upload not found.'},404);await env.DB.prepare('INSERT OR IGNORE INTO community_collection_items (collection_id,item_id,added_at) VALUES (?,?,?)').bind(cid,id,now).run();await env.DB.prepare('UPDATE community_collections SET updated_at=? WHERE id=?').bind(now,cid).run();return json({success:true});}
 if(a==='notifications_read'){await env.DB.prepare('UPDATE community_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(now,me.id).run();return json({success:true});}
 if(a==='admin_cleanup_preview'){if(!owner(me.id))return json({error:'Owner access only.'},403);return json({success:true,previewOnly:true,message:'Preview is generated by the scheduled Worker logs. No uploads are deleted while cleanup is disabled.'});}
 if(a==='admin_feature_upload'){const upload=String(d.uploadId||''),featured=!!d.featured,r=await env.DB.prepare('UPDATE community_modpacks SET featured=? WHERE id=?').bind(featured?1:0,upload).run();if(!r.meta?.changes)return json({error:'Upload not found.'},404);return json({success:true});}
 if(a==='admin_feature_creator'){const creator=String(d.creatorId||'');if(!/^\d{17,20}$/.test(creator)||!await env.DB.prepare('SELECT 1 yes FROM community_modpacks WHERE author_id=? LIMIT 1').bind(creator).first())return json({error:'Creator not found.'},404);if(d.featured)await env.DB.prepare('INSERT OR IGNORE INTO community_featured_creators (user_id,featured_at) VALUES (?,?)').bind(creator,now).run();else await env.DB.prepare('DELETE FROM community_featured_creators WHERE user_id=?').bind(creator).run();return json({success:true});}
 if(a==='admin_badge'){const creator=String(d.creatorId||''),badge=String(d.badge||'');if(!/^\d{17,20}$/.test(creator)||!BADGES.includes(badge))return json({error:'Choose a valid creator and badge.'},400);if(!await env.DB.prepare('SELECT 1 yes FROM community_modpacks WHERE author_id=? LIMIT 1').bind(creator).first())return json({error:'Creator not found.'},404);if(d.enabled===false)await env.DB.prepare('DELETE FROM community_badges WHERE user_id=? AND badge=?').bind(creator,badge).run();else await env.DB.prepare('INSERT OR IGNORE INTO community_badges (user_id,badge,awarded_at) VALUES (?,?,?)').bind(creator,badge,now).run();return json({success:true});}
 if(a==='admin_category'){const upload=String(d.uploadId||''),category=String(d.category||'');if(!CATEGORIES.includes(category))return json({error:'Invalid category.'},400);const r=await env.DB.prepare('UPDATE community_modpacks SET category=? WHERE id=?').bind(category,upload).run();if(!r.meta?.changes)return json({error:'Upload not found.'},404);return json({success:true});}
 if(a==='admin_visibility'){const upload=String(d.uploadId||''),hidden=!!d.hidden,r=await env.DB.prepare('UPDATE community_modpacks SET is_hidden=? WHERE id=?').bind(hidden?1:0,upload).run();if(!r.meta?.changes)return json({error:'Upload not found.'},404);return json({success:true});}
 return json({error:'Unknown Community action.'},400);
 }catch(e){console.error('[CommunitySocial] POST',e);return json({error:'Community action could not be saved.'},503);}
}
