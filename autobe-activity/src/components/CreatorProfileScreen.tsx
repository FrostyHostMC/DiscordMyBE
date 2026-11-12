import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Box, Download, Package, RefreshCw, Sparkles } from 'lucide-react';
import type { DiscordUserInfo } from '@/utils/discordAuth';
import { getDiscordAuth } from '@/utils/discordAuth';
import type { CommunityModpack } from '@/types/modpack';

type Props = { onBack: () => void; user: DiscordUserInfo | null };

export const CreatorProfileScreen: React.FC<Props> = ({ onBack, user }) => {
  const [items, setItems] = useState<CommunityModpack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'all' | 'addon' | 'modpack'>('all');
  const [profile, setProfile] = useState({ bio: '', website: '', youtube: '', twitch: '' });
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [badges, setBadges] = useState<Array<{ badge: string }>>([]);
  const [notifications, setNotifications] = useState<Array<{ id: string; message: string; created_at: number; read_at: number | null }>>([]);
  const [collections, setCollections] = useState<Array<{ id: string; title: string; item_count: number }>>([]);
  const [newCollection, setNewCollection] = useState('');
  const [saving, setSaving] = useState(false);
  const [socialError, setSocialError] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [adminData, setAdminData] = useState<{uploads:any[];creators:any[];featuredCreators:any[];categories:string[];badges:string[]}>({uploads:[],creators:[],featuredCreators:[],categories:[],badges:[]});
  const [adminCreatorId, setAdminCreatorId] = useState('');
  const [adminBadge, setAdminBadge] = useState('Featured Creator');
  const [adminUploadId, setAdminUploadId] = useState('');
  const [adminCategory, setAdminCategory] = useState('Other');
  const [adminBusy, setAdminBusy] = useState(false);
  const auth = getDiscordAuth();
  const social = async (action: string, payload: Record<string, unknown> = {}) => {
    if (!auth?.token) throw new Error('Reconnect Discord to manage your creator profile.');
    const response = await fetch('/api/community-social', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ action, ...payload }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Community request failed.');
    return result;
  };
  const loadSocial = async () => {
    if (!auth?.token) return;
    const headers = { Authorization: `Bearer ${auth.token}` };
    const [me, notes, lists] = await Promise.all([
      fetch('/api/community-social', { headers, cache: 'no-store' }).then(r => r.json()),
      fetch('/api/community-social?action=notifications', { headers, cache: 'no-store' }).then(r => r.json()),
      fetch('/api/community-social?action=collections', { headers, cache: 'no-store' }).then(r => r.json()),
    ]);
    setProfile(me.profile || { bio: '', website: '', youtube: '', twitch: '' });
    setFollowers(me.followers || 0); setFollowing(me.following || 0); setBadges(me.badges || []);
    setNotifications(notes.notifications || []); setCollections(lists.collections || []);
    setIsOwner(!!me.isOwner);
    if (me.isOwner) {
      const response = await fetch('/api/community-social?action=admin', { headers, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Owner controls could not be loaded.');
      setAdminData(data);
    }
  };

  const load = async () => {
    if (!user?.id) { setError('Your Discord profile is not available. Reopen AutoBE through Discord.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/community-modpacks', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load your published content.');
      setItems((data.modpacks || []).filter((item: CommunityModpack) => item.author_id === user.id));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load your profile.'); }
    finally { setLoading(false); }
    try { await loadSocial(); } catch (err) { setSocialError(err instanceof Error ? err.message : 'Could not load creator tools.'); }
  };
  useEffect(() => { void load(); }, [user?.id]);

  const adminAction = async (action:string, payload:Record<string,unknown>) => {
    setAdminBusy(true); setSocialError('');
    try {
      await social(action,payload);
      const headers={Authorization:'Bearer '+(auth?.token || '')};
      const response=await fetch('/api/community-social?action=admin',{headers,cache:'no-store'});
      const data=await response.json(); if(!response.ok)throw new Error(data.error||'Could not refresh owner controls.');
      setAdminData(data);
    } catch(e) { setSocialError(e instanceof Error?e.message:'Admin action failed.'); }
    finally { setAdminBusy(false); }
  };
  const visible = useMemo(() => items.filter(item => kind === 'all' || (kind === 'addon' ? item.content_type === 'addon' : item.content_type !== 'addon')), [items, kind]);
  const downloads = items.reduce((sum, item) => sum + (Number(item.downloads) || 0), 0);
  const avatar = user?.id && user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256` : '';

  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#090713] text-white">
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-violet-300/10 bg-[#0D0A18]/95 px-4 py-3 backdrop-blur-xl sm:px-6">
      <button onClick={onBack} className="rounded-xl border border-white/10 p-2 text-violet-100 hover:bg-white/5" aria-label="Back to AutoBE"><ArrowLeft className="h-5 w-5"/></button>
      <div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-300/70">Creator space</div><h1 className="truncate text-lg font-black">My profile</h1></div>
      <button onClick={() => void load()} className="ml-auto rounded-xl border border-white/10 p-2 text-violet-200 hover:bg-white/5" aria-label="Refresh profile"><RefreshCw className="h-4 w-4"/></button>
    </header>
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <section className="relative overflow-hidden rounded-3xl border border-violet-300/15 bg-gradient-to-br from-[#241447] via-[#17102A] to-[#100D1A] p-5 sm:p-8">
        <div className="pointer-events-none absolute -right-12 -top-16 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl"/>
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border-2 border-violet-200/40 bg-violet-500/20 shadow-xl">{avatar ? <img src={avatar} alt="" className="h-full w-full object-cover"/> : <div className="grid h-full place-items-center text-3xl font-black">{(user?.global_name || user?.username || 'A').slice(0,1).toUpperCase()}</div>}</div>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-violet-200/70"><Sparkles className="h-3.5 w-3.5"/> AutoBE creator</div><h2 className="mt-1 truncate text-2xl font-black sm:text-3xl">{user?.global_name || user?.username || 'Discord member'}</h2><p className="mt-1 text-sm text-[#B9ADC9]">@{user?.username || 'discord-user'}</p><p className="mt-3 max-w-xl text-xs leading-relaxed text-[#C9BED8]">Your published addons and modpacks, collected in one place and linked to your verified Discord account.</p></div>
        </div>
        <div className="relative mt-6 grid grid-cols-3 gap-2 sm:max-w-xl">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><Package className="h-4 w-4 text-violet-200"/><div className="mt-2 text-xl font-black tabular-nums">{items.length}</div><div className="text-[10px] text-[#A99FBE]">Published</div></div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><Box className="h-4 w-4 text-violet-200"/><div className="mt-2 text-xl font-black tabular-nums">{items.filter(x => x.content_type === 'addon').length}</div><div className="text-[10px] text-[#A99FBE]">Addons</div></div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><Download className="h-4 w-4 text-violet-200"/><div className="mt-2 text-xl font-black tabular-nums">{downloads.toLocaleString()}</div><div className="text-[10px] text-[#A99FBE]">Downloads</div></div>
        </div>
      </section>
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-violet-300/15 bg-[#120E1E] p-4 sm:p-5">
          <div className="text-[10px] font-extrabold uppercase tracking-[.18em] text-violet-200/60">Creator details</div>
          <h3 className="mt-1 text-lg font-black">Your creator profile</h3>
          <label className="mt-4 block text-xs font-semibold text-[#B9ADC9]">Bio</label>
          <textarea value={profile.bio} maxLength={500} onChange={e => setProfile(p => ({...p,bio:e.target.value}))} rows={3} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none focus:border-violet-400" placeholder="Tell the Community what you create."/>
          {(['website','youtube','twitch'] as const).map(field => <label key={field} className="mt-3 block text-xs font-semibold capitalize text-[#B9ADC9]">{field}<input value={profile[field]} onChange={e => setProfile(p => ({...p,[field]:e.target.value}))} maxLength={200} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none focus:border-violet-400" placeholder={field === 'website' ? 'https://' : 'Channel URL'}/></label>)}
          <button disabled={saving} onClick={async()=>{setSaving(true);setSocialError('');try{await social('profile',profile);}catch(e){setSocialError(e instanceof Error?e.message:'Save failed.');}finally{setSaving(false);}}} className="mt-4 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{saving?'Saving…':'Save profile'}</button>
          <div className="mt-3 flex gap-4 text-xs text-[#A99FBE]"><span>{followers} followers</span><span>Following {following}</span></div>
          {badges.length>0 && <div className="mt-3 flex flex-wrap gap-2">{badges.map(b=><span key={b.badge} className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[10px] font-bold text-amber-200">{b.badge}</span>)}</div>}
        </div>
        <div className="rounded-2xl border border-violet-300/15 bg-[#120E1E] p-4 sm:p-5">
          <div className="text-[10px] font-extrabold uppercase tracking-[.18em] text-violet-200/60">Your community</div><h3 className="mt-1 text-lg font-black">Collections & notifications</h3>
          <div className="mt-3 flex gap-2"><input value={newCollection} onChange={e=>setNewCollection(e.target.value)} maxLength={80} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" placeholder="New collection name"/><button onClick={async()=>{try{await social('collection_create',{title:newCollection});setNewCollection('');await loadSocial();}catch(e){setSocialError(e instanceof Error?e.message:'Could not create collection.');}}} className="rounded-xl border border-violet-300/20 bg-violet-500/15 px-3 text-xs font-bold text-violet-100">Create</button></div>
          <div className="mt-3 space-y-2">{collections.map(c=><div key={c.id} className="flex justify-between rounded-xl bg-black/20 px-3 py-2 text-xs"><span className="font-semibold">{c.title}</span><span className="text-[#A99FBE]">{c.item_count} items</span></div>)}{collections.length===0&&<p className="text-xs text-[#8F85A1]">Your collections will appear here.</p>}</div>
          <div className="mt-4 border-t border-white/10 pt-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold">Recent notifications</span><button onClick={async()=>{try{await social('notifications_read');await loadSocial();}catch(e){setSocialError(e instanceof Error?e.message:'Could not update notifications.');}}} className="text-[10px] font-bold text-violet-200">Mark all read</button></div>
          <div className="max-h-36 space-y-2 overflow-y-auto">{notifications.slice(0,8).map(n=><div key={n.id} className={`rounded-lg px-3 py-2 text-xs ${n.read_at?'bg-black/10 text-[#8F85A1]':'bg-violet-500/10 text-violet-100'}`}>{n.message}</div>)}{notifications.length===0&&<p className="text-xs text-[#8F85A1]">No activity yet.</p>}</div></div>
        </div>
      </section>
      {socialError && <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/5 p-3 text-xs text-rose-200">{socialError}</p>}
      {isOwner && <section className="mt-6 rounded-3xl border border-amber-300/20 bg-gradient-to-br from-[#241B12] to-[#120E1E] p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] font-extrabold uppercase tracking-[.18em] text-amber-200/70">Owner access · private</div><h3 className="mt-1 text-xl font-black">Community administration</h3><p className="mt-1 text-xs text-[#B9ADC9]">Only the authorized Discord account can load or use these controls.</p></div><span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-[10px] font-bold text-amber-200">OWNER</span></div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><h4 className="text-sm font-bold">Feature a creator</h4><select value={adminCreatorId} onChange={e=>setAdminCreatorId(e.target.value)} className="mt-3 w-full rounded-xl border border-white/10 bg-[#0D0A18] p-3 text-xs"><option value="">Choose a creator</option>{adminData.creators.map(c=><option key={c.author_id} value={c.author_id}>{c.author} · {c.uploads} uploads</option>)}</select><div className="mt-2 flex gap-2"><button disabled={!adminCreatorId||adminBusy} onClick={()=>void adminAction('admin_feature_creator',{creatorId:adminCreatorId,featured:true})} className="rounded-lg bg-amber-400/15 px-3 py-2 text-xs font-bold text-amber-100 disabled:opacity-40">Feature</button><button disabled={!adminCreatorId||adminBusy} onClick={()=>void adminAction('admin_feature_creator',{creatorId:adminCreatorId,featured:false})} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold disabled:opacity-40">Unfeature</button></div></div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><h4 className="text-sm font-bold">Award creator badge</h4><select value={adminCreatorId} onChange={e=>setAdminCreatorId(e.target.value)} className="mt-3 w-full rounded-xl border border-white/10 bg-[#0D0A18] p-3 text-xs"><option value="">Choose a creator</option>{adminData.creators.map(c=><option key={c.author_id} value={c.author_id}>{c.author}</option>)}</select><select value={adminBadge} onChange={e=>setAdminBadge(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0D0A18] p-3 text-xs">{adminData.badges.map(b=><option key={b}>{b}</option>)}</select><button disabled={!adminCreatorId||adminBusy} onClick={()=>void adminAction('admin_badge',{creatorId:adminCreatorId,badge:adminBadge,enabled:true})} className="mt-2 rounded-lg bg-amber-400/15 px-3 py-2 text-xs font-bold text-amber-100 disabled:opacity-40">Award badge</button></div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 lg:col-span-2"><h4 className="text-sm font-bold">Manage Community uploads</h4><select value={adminUploadId} onChange={e=>{setAdminUploadId(e.target.value);const item=adminData.uploads.find(x=>x.id===e.target.value);if(item?.category)setAdminCategory(item.category);}} className="mt-3 w-full rounded-xl border border-white/10 bg-[#0D0A18] p-3 text-xs"><option value="">Choose an upload</option>{adminData.uploads.map(x=><option key={x.id} value={x.id}>{x.name} · {x.author}</option>)}</select><div className="mt-3 flex flex-wrap gap-2"><button disabled={!adminUploadId||adminBusy} onClick={()=>void adminAction('admin_feature_upload',{uploadId:adminUploadId,featured:true})} className="rounded-lg bg-amber-400/15 px-3 py-2 text-xs font-bold text-amber-100 disabled:opacity-40">Feature upload</button><button disabled={!adminUploadId||adminBusy} onClick={()=>void adminAction('admin_feature_upload',{uploadId:adminUploadId,featured:false})} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold disabled:opacity-40">Unfeature</button><select value={adminCategory} onChange={e=>setAdminCategory(e.target.value)} className="rounded-lg border border-white/10 bg-[#0D0A18] px-3 py-2 text-xs">{adminData.categories.map(c=><option key={c}>{c}</option>)}</select><button disabled={!adminUploadId||adminBusy} onClick={()=>void adminAction('admin_category',{uploadId:adminUploadId,category:adminCategory})} className="rounded-lg bg-violet-500/20 px-3 py-2 text-xs font-bold text-violet-100 disabled:opacity-40">Save category</button></div></div>
        </div>
      </section>}
      <section className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-[10px] font-extrabold uppercase tracking-[.18em] text-violet-200/55">Your community uploads</div><h3 className="mt-1 text-xl font-black">Published content</h3></div><div className="flex rounded-xl border border-white/10 bg-[#120E1E] p-1">{(['all','addon','modpack'] as const).map(value => <button key={value} onClick={() => setKind(value)} className={`rounded-lg px-3 py-2 text-xs font-bold capitalize transition ${kind === value ? 'bg-violet-500/25 text-white' : 'text-[#A99FBE] hover:text-white'}`}>{value === 'all' ? 'All' : value === 'addon' ? 'Addons' : 'Modpacks'}</button>)}</div></div>
        {loading ? <div className="py-16 text-center text-sm text-[#A99FBE]">Loading your published content…</div> : error ? <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-500/5 p-4 text-sm text-rose-200">{error}</div> : visible.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-violet-300/20 bg-white/[.02] px-5 py-12 text-center"><Package className="mx-auto h-8 w-8 text-violet-300/60"/><h4 className="mt-3 font-bold">Nothing published here yet</h4><p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[#A99FBE]">When you publish an addon or modpack in the Community, it will automatically appear on this page.</p></div> : <div className="mt-5 grid gap-3 sm:grid-cols-2">{visible.map(item => <article key={item.id} className="overflow-hidden rounded-2xl border border-violet-300/12 bg-[#120E1E]"><div className="flex gap-3 p-4"><div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-violet-500/10">{item.icon_data_url ? <img src={item.icon_data_url} alt="" className="h-full w-full object-cover"/> : <Package className="h-7 w-7 text-violet-200/70"/>}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="rounded-full bg-violet-500/15 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-violet-200">{item.content_type === 'addon' ? 'Addon' : 'Modpack'}</span><span className="text-[10px] text-[#8F85A1]">v{item.version}</span></div><h4 className="mt-2 truncate text-sm font-extrabold">{item.name}</h4><p className="mt-1 line-clamp-2 text-xs text-[#A99FBE]">{item.description}</p><div className="mt-2 text-[10px] text-[#8F85A1]">{(Number(item.downloads) || 0).toLocaleString()} downloads · {new Date(item.created_at).toLocaleDateString()}</div></div></div></article>)}</div>}
      </section>
    </div>
  </div>;
};
