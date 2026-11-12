import type { Context } from '@cloudflare/workers-types';
interface Env { DB: D1Database; DISCORD_CLIENT_ID: string }
type Ctx = Context & { env: Env };
const OWNER_DISCORD_ID='1122949730419347487';
const CATEGORIES=['Horror','Medieval','Fantasy','Survival','Technology','Magic','PvP','Adventure','Weapons','Mobs','Blocks','Decorations','Utility','Other'];
const BADGES=['Featured Creator','Community Favorite','Top Creator','Trusted Creator','Early Creator','Addon Specialist','Modpack Builder'];
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
async function who(request:Request,env:Env){
 const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return null;
 try{const r=await fetch('https://discord.com/api/v10/oauth2/@me',{headers:{authorization:\`Bearer \${token}\`}});if(!r.ok)return null;const d=await r.json() as any;if(d.application?.id!==env.DISCORD_CLIENT_ID||!d.user?.id)return null;return{id:String(d.user.id),name:String(d.user.global_name||d.user.username||'Discord member')};}catch{return null;}
}
async function init(db:D1Database){
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
 'CREATE TABLE IF NOT EXISTS community_featured_creators (user_id TEXT PRIMARY KEY,featured_at INTEGER NOT NULL)'
 ];for(const sql of statements)await db.prepare(sql).run();
 const columns=await db.prepare('PRAGMA table_info(community_modpacks)').all<{name:string}>();
 if(!(columns.results||[]).some(c=>c.name==='featured'))await db.prepare('ALTER TABLE community_modpacks ADD COLUMN featured INTEGER NOT NULL DEFAULT 0').run();
}
async function notify(db:D1Database,to:string,actor:string,kind:string,item:string|null,message:string){if(!to||to===actor)return;await db.prepare('INSERT INTO community_notifications (id,user_id,actor_id,kind,item_id,message,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),to,actor,kind,item,message.slice(0,240),Date.now()).run();}
const owner=(id:string)=>id===OWNER_DISCORD_ID;
export async function onRequestGet({request,env}:Ctx){
 const me=await who(request,env);if(!me)return json({error:'Sign in through Discord to use Community features.'},401);
 try{await init(env.DB);const u=new URL(request.url),action=u.searchParams.get('action')||'me';
 if(action==='admin'){if(!owner(me.id))return json({error:'Owner access only.'},403);
 const [uploads,creators,featured]=await Promise.all([
 env.DB.prepare('SELECT id,name,author,author_id,content_type,category,downloads,featured FROM community_modpacks ORDER BY created_at DESC LIMIT 250').all(),
 env.DB.prepare('SELECT author_id,MAX(author) author,COUNT(*) uploads,COALESCE(SUM(downloads),0) downloads FROM community_modpacks GROUP BY author_id ORDER BY uploads DESC,downloads DESC LIMIT 150').all(),
 env.DB.prepare('SELECT user_id,featured_at FROM community_featured_creators ORDER BY featured_at DESC').all()]);
 return json({uploads:uploads.results||[],creators:creators.results||[],featuredCreators:featured.results||[],categories:CATEGORIES,badges:BADGES});}
 if(action==='discovery'){
 const [featuredUploads,featuredCreators,leaders]=await Promise.all([
 env.DB.prepare('SELECT id,name,author,author_id,content_type,category,downloads,featured FROM community_modpacks WHERE featured=1 ORDER BY created_at DESC LIMIT 12').all(),
 env.DB.prepare('SELECT f.user_id,MAX(m.author) author,COUNT(m.id) uploads,COALESCE(SUM(m.downloads),0) downloads FROM community_featured_creators f LEFT JOIN community_modpacks m ON m.author_id=f.user_id GROUP BY f.user_id ORDER BY f.featured_at DESC LIMIT 12').all(),
 env.DB.prepare('SELECT m.author_id,MAX(m.author) author,COUNT(DISTINCT m.id) uploads,COALESCE(SUM(m.downloads),0) downloads,COUNT(DISTINCT l.user_id) likes,COUNT(DISTINCT f.follower_id) followers FROM community_modpacks m LEFT JOIN community_likes l ON l.item_id=m.id LEFT JOIN community_follows f ON f.creator_id=m.author_id GROUP BY m.author_id ORDER BY likes DESC,followers DESC,downloads DESC LIMIT 10').all()]);
 return json({featuredUploads:featuredUploads.results||[],featuredCreators:featuredCreators.results||[],leaders:leaders.results||[]});}
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
 if(action==='collections'){const r=await env.DB.prepare('SELECT c.*,COUNT(i.item_id) item_count FROM community_collections c LEFT JOIN community_collection_items i ON i.collection_id=c.id WHERE c.user_id=? GROUP BY c.id ORDER BY c.updated_at DESC').bind(me.id).all();return json({collections:r.results||[]});}
 const [profile,followers,following,badges,unread]=await Promise.all([
 env.DB.prepare('SELECT bio,website,youtube,twitch FROM community_creator_profiles WHERE user_id=?').bind(me.id).first(),
 env.DB.prepare('SELECT COUNT(*) count FROM community_follows WHERE creator_id=?').bind(me.id).first<any>(),
 env.DB.prepare('SELECT COUNT(*) count FROM community_follows WHERE follower_id=?').bind(me.id).first<any>(),
 env.DB.prepare('SELECT badge,awarded_at FROM community_badges WHERE user_id=? ORDER BY awarded_at DESC').bind(me.id).all(),
 env.DB.prepare('SELECT COUNT(*) count FROM community_notifications WHERE user_id=? AND read_at IS NULL').bind(me.id).first<any>()]);
 return json({profile:profile||{bio:'',website:'',youtube:'',twitch:''},followers:+(followers?.count||0),following:+(following?.count||0),badges:badges.results||[],unreadNotifications:+(unread?.count||0),isOwner:owner(me.id)});
 }catch(e){console.error('[CommunitySocial] GET',e);return json({error:'Community data could not be loaded.'},503);}
}
export async function onRequestPost({request,env}:Ctx){
 const me=await who(request,env);if(!me)return json({error:'Sign in through Discord to use Community features.'},401);
 try{await init(env.DB);const d=await request.json() as any,a=String(d.action||''),id=String(d.itemId||''),now=Date.now();
 if(a.startsWith('admin_')&&!owner(me.id))return json({error:'Owner access only.'},403);
 if(a==='profile'){const cut=(v:any,n:number)=>String(v||'').trim().slice(0,n);await env.DB.prepare("INSERT INTO community_creator_profiles (user_id,bio,website,youtube,twitch,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio,website=excluded.website,youtube=excluded.youtube,twitch=excluded.twitch,updated_at=excluded.updated_at").bind(me.id,cut(d.bio,500),cut(d.website,200),cut(d.youtube,200),cut(d.twitch,200),now).run();return json({success:true});}
 if(a==='like'||a==='favorite'){if(!id)return json({error:'Missing upload id.'},400);const table=a==='like'?'community_likes':'community_favorites',item=await env.DB.prepare('SELECT author_id,name FROM community_modpacks WHERE id=?').bind(id).first<any>();if(!item)return json({error:'Upload not found.'},404);const old=await env.DB.prepare(\`SELECT 1 yes FROM \${table} WHERE user_id=? AND item_id=?\`).bind(me.id,id).first();if(old)await env.DB.prepare(\`DELETE FROM \${table} WHERE user_id=? AND item_id=?\`).bind(me.id,id).run();else{await env.DB.prepare(\`INSERT INTO \${table} (user_id,item_id,created_at) VALUES (?,?,?)\`).bind(me.id,id,now).run();if(a==='like')await notify(env.DB,item.author_id,me.id,'like',id,\`\${me.name} liked your upload: \${item.name}\`);}return json({success:true,active:!old});}
 if(a==='follow'){const creator=String(d.creatorId||'');if(!/^\d{17,20}$/.test(creator)||creator===me.id)return json({error:'Invalid creator.'},400);if(!await env.DB.prepare('SELECT 1 yes FROM community_modpacks WHERE author_id=? LIMIT 1').bind(creator).first())return json({error:'Creator not found.'},404);const old=await env.DB.prepare('SELECT 1 yes FROM community_follows WHERE follower_id=? AND creator_id=?').bind(me.id,creator).first();if(old)await env.DB.prepare('DELETE FROM community_follows WHERE follower_id=? AND creator_id=?').bind(me.id,creator).run();else{await env.DB.prepare('INSERT INTO community_follows (follower_id,creator_id,created_at) VALUES (?,?,?)').bind(me.id,creator,now).run();await notify(env.DB,creator,me.id,'follow',null,\`\${me.name} followed you\`);}return json({success:true,active:!old});}
 if(a==='review'){if(!id)return json({error:'Missing upload id.'},400);const rating=Number(d.rating),body=String(d.body||'').trim().slice(0,1000),item=await env.DB.prepare('SELECT author_id,name FROM community_modpacks WHERE id=?').bind(id).first<any>();if(!item)return json({error:'Upload not found.'},404);if(!Number.isInteger(rating)||rating<1||rating>5)return json({error:'Rating must be 1–5.'},400);await env.DB.prepare('INSERT INTO community_reviews (id,user_id,item_id,rating,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET rating=excluded.rating,body=excluded.body,updated_at=excluded.updated_at').bind(crypto.randomUUID(),me.id,id,rating,body,now,now).run();await notify(env.DB,item.author_id,me.id,'review',id,\`\${me.name} reviewed your upload: \${item.name}\`);return json({success:true});}
 if(a==='collection_create'){const title=String(d.title||'').trim().slice(0,80);if(!title)return json({error:'Name your collection.'},400);const cid=crypto.randomUUID();await env.DB.prepare("INSERT INTO community_collections (id,user_id,title,description,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(cid,me.id,title,String(d.description||'').slice(0,300),now,now).run();return json({success:true,id:cid});}
 if(a==='collection_add'){const cid=String(d.collectionId||''),owned=await env.DB.prepare('SELECT 1 yes FROM community_collections WHERE id=? AND user_id=?').bind(cid,me.id).first(),exists=await env.DB.prepare('SELECT 1 yes FROM community_modpacks WHERE id=?').bind(id).first();if(!id||!owned||!exists)return json({error:'Collection or upload not found.'},404);await env.DB.prepare('INSERT OR IGNORE INTO community_collection_items (collection_id,item_id,added_at) VALUES (?,?,?)').bind(cid,id,now).run();await env.DB.prepare('UPDATE community_collections SET updated_at=? WHERE id=?').bind(now,cid).run();return json({success:true});}
 if(a==='notifications_read'){await env.DB.prepare('UPDATE community_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(now,me.id).run();return json({success:true});}
 if(a==='admin_feature_upload'){const upload=String(d.uploadId||''),featured=!!d.featured,r=await env.DB.prepare('UPDATE community_modpacks SET featured=? WHERE id=?').bind(featured?1:0,upload).run();if(!r.meta?.changes)return json({error:'Upload not found.'},404);return json({success:true});}
 if(a==='admin_feature_creator'){const creator=String(d.creatorId||'');if(!/^\d{17,20}$/.test(creator)||!await env.DB.prepare('SELECT 1 yes FROM community_modpacks WHERE author_id=? LIMIT 1').bind(creator).first())return json({error:'Creator not found.'},404);if(d.featured)await env.DB.prepare('INSERT OR IGNORE INTO community_featured_creators (user_id,featured_at) VALUES (?,?)').bind(creator,now).run();else await env.DB.prepare('DELETE FROM community_featured_creators WHERE user_id=?').bind(creator).run();return json({success:true});}
 if(a==='admin_badge'){const creator=String(d.creatorId||''),badge=String(d.badge||'');if(!/^\d{17,20}$/.test(creator)||!BADGES.includes(badge))return json({error:'Choose a valid creator and badge.'},400);if(!await env.DB.prepare('SELECT 1 yes FROM community_modpacks WHERE author_id=? LIMIT 1').bind(creator).first())return json({error:'Creator not found.'},404);if(d.enabled===false)await env.DB.prepare('DELETE FROM community_badges WHERE user_id=? AND badge=?').bind(creator,badge).run();else await env.DB.prepare('INSERT OR IGNORE INTO community_badges (user_id,badge,awarded_at) VALUES (?,?,?)').bind(creator,badge,now).run();return json({success:true});}
 if(a==='admin_category'){const upload=String(d.uploadId||''),category=String(d.category||'');if(!CATEGORIES.includes(category))return json({error:'Invalid category.'},400);const r=await env.DB.prepare('UPDATE community_modpacks SET category=? WHERE id=?').bind(category,upload).run();if(!r.meta?.changes)return json({error:'Upload not found.'},404);return json({success:true});}
 return json({error:'Unknown Community action.'},400);
 }catch(e){console.error('[CommunitySocial] POST',e);return json({error:'Community action could not be saved.'},503);}
}
