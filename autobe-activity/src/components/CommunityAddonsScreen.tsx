import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Box, Download, Image as ImageIcon, Loader2, Plus, Search, Upload, X, Trash2 } from 'lucide-react';
import { uploadToCloud } from '@/utils/cloudUpload';
import { getDiscordAuth, getDiscordUser } from '@/utils/discordAuth';

const CATEGORIES = ['Horror', 'Medieval', 'Fantasy', 'Survival', 'Technology', 'Magic', 'PvP', 'Adventure', 'Weapons', 'Mobs', 'Blocks', 'Decorations', 'Utility', 'Other'] as const;
type Category = typeof CATEGORIES[number];
interface CommunityAddon {
  id: string; name: string; description: string; author: string; author_id: string; author_avatar?: string | null;
  version: string; size: number; icon_data_url?: string; created_at: number; downloads: number;
  blob_url: string; file_name: string; category?: Category; content_type?: string; license_id?: string;
}
interface Props { onBack: () => void; currentUserId?: string; onOpenCreator?: (creatorId:string)=>void; }

const authHeaders = () => {
  const auth = getDiscordAuth();
  return auth ? { Authorization: `Bearer ${auth.token}` } : {};
};
const LICENSE_LABELS:Record<string,string>={"LicenseRef-All-Rights-Reserved":"All Rights Reserved","LicenseRef-Custom":"Custom / Other","MIT":"MIT","Apache-2.0":"Apache 2.0","GPL-2.0-only":"GNU GPL 2.0","GPL-3.0-only":"GNU GPL 3.0","BSD-2-Clause":"BSD 2-Clause","BSD-3-Clause":"BSD 3-Clause","MPL-2.0":"Mozilla Public License 2.0","LGPL-2.1-only":"GNU LGPL 2.1","LGPL-3.0-only":"GNU LGPL 3.0","CC0-1.0":"CC0 1.0","CC-BY-4.0":"Creative Commons Attribution 4.0","CC-BY-SA-4.0":"Creative Commons Attribution-ShareAlike 4.0","Unlicense":"The Unlicense"};
const formatSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

export const CommunityAddonsScreen: React.FC<Props> = ({ onBack, currentUserId, onOpenCreator }) => {
  const [addons, setAddons] = useState<CommunityAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const addonFileInput = useRef<HTMLInputElement>(null);
  const coverFileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [selectedCategory, setSelectedCategory] = useState<Category>('Other');
  const [selectedLicense,setSelectedLicense]=useState('LicenseRef-All-Rights-Reserved');
  const [cover, setCover] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState('');
  const [socialFlags,setSocialFlags]=useState<Record<string,{liked?:boolean;favorited?:boolean;following?:boolean}>>({});
  const [reviewRatings,setReviewRatings]=useState<Record<string,number>>({});
  const [reviewTexts,setReviewTexts]=useState<Record<string,string>>({});
  const [socialBusy,setSocialBusy]=useState<string|null>(null);
  const [featuredAddons,setFeaturedAddons]=useState<CommunityAddon[]>([]);
  const [addonLeaders,setAddonLeaders]=useState<Array<{author_id:string;author:string;uploads:number;downloads:number}>>([]);
  const [addonStats,setAddonStats]=useState<Record<string,{likes:number;reviewCount:number;averageRating:number}>>({});
  const [creatorSearch,setCreatorSearch]=useState('');
  const [creatorResults,setCreatorResults]=useState<Array<{author_id:string;author:string;uploads:number;followers:number}>>([]);
  const [creatorSearchLoading,setCreatorSearchLoading]=useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/community-modpacks', { headers: { Authorization: `Bearer ${getDiscordAuth()?.token || ''}` }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load community addons.');
      const addonRows=(data.modpacks || []).filter((item: CommunityAddon) => item.content_type === 'addon');
      setAddons(addonRows);
      const auth=getDiscordAuth();
      if(auth?.token){
        const [states,discovery]=await Promise.all([
          fetch('/api/community-social?action=items',{headers:{Authorization:'Bearer '+auth.token},cache:'no-store'}).then(r=>r.json()),
          fetch('/api/community-social?action=discovery&content_type=addon',{headers:{Authorization:'Bearer '+auth.token},cache:'no-store'}).then(r=>r.json())
        ]);
        const flags=new Map((states.items||[]).map((x:any)=>[x.id,x]));
        setAddonStats(Object.fromEntries((states.items||[]).map((x:any)=>[x.id,{likes:Number(x.likes)||0,reviewCount:Number(x.reviewCount)||0,averageRating:Number(x.averageRating)||0}])));
        setSocialFlags(Object.fromEntries(addonRows.map(item=>{const x:any=flags.get(item.id)||{};return [item.id,{liked:!!x.liked,favorited:!!x.favorited,following:!!x.followingCreator}];})));
        setFeaturedAddons((discovery.featuredUploads||[]).filter((x:CommunityAddon)=>x.content_type==='addon'));
         setAddonLeaders(discovery.leaders||[]);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load community addons.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  useEffect(()=>{const q=creatorSearch.trim();if(q.length<2){setCreatorResults([]);return;}const timer=window.setTimeout(async()=>{const auth=getDiscordAuth();if(!auth?.token)return;setCreatorSearchLoading(true);try{const r=await fetch('/api/community-social?action=creators&q='+encodeURIComponent(q),{headers:{Authorization:`Bearer ${auth.token}`},cache:'no-store'});const d=await r.json();if(r.ok)setCreatorResults(d.creators||[]);}catch(e){console.warn('Creator search failed',e);}finally{setCreatorSearchLoading(false);}},250);return()=>window.clearTimeout(timer);},[creatorSearch]);
  const filtered = useMemo(() => addons.filter(item =>
    (category === 'All' || item.category === category) &&
    [item.name, item.description, item.author, item.category || ''].some(value => value.toLowerCase().includes(search.toLowerCase()))
  ), [addons, category, search]);

  const communityAction = async (addon:CommunityAddon,action:'like'|'favorite'|'follow'|'review') => {
    const auth=getDiscordAuth();if(!auth?.token){setNotice('Reconnect Discord to use Community features.');return;}
    setSocialBusy(addon.id);setNotice('');
    try{
      const body:any={action,itemId:addon.id};
      if(action==='follow')body.creatorId=addon.author_id;
      if(action==='review'){body.rating=reviewRatings[addon.id]||5;body.body=reviewTexts[addon.id]||'';}
      const response=await fetch('/api/community-social',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.token}`},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Community action failed.');
      if(action!=='review')setSocialFlags(current=>({...current,[addon.id]:{...current[addon.id],[action==='like'?'liked':action==='favorite'?'favorited':'following']:!!data.active}}));
      await load();
      if(action==='review')setNotice('Your review was saved.');
    }catch(e){setNotice(e instanceof Error?e.message:'Community action failed.');}
    finally{setSocialBusy(null);}
  };

  const chooseCover = (image?: File) => {
    if (!image) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) {
      setNotice('Choose a PNG, JPG, or WebP cover image.'); return;
    }
    if (image.size > 8 * 1024 * 1024) { setNotice('Cover images must be smaller than 8 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 512 / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) { setNotice('Image processing is unavailable.'); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let result = canvas.toDataURL('image/png');
        if (result.length > 100000) result = canvas.toDataURL('image/jpeg', 0.78);
        if (result.length > 100000) { setNotice('That image is too large after compression.'); return; }
        setCover(result); setNotice('');
      };
      img.onerror = () => setNotice('Could not open that image.');
      img.src = String(reader.result);
    };
    reader.onerror = () => setNotice('Could not read that image.');
    reader.readAsDataURL(image);
  };

  const publish = async () => {
    if (!file) { setNotice('Choose an .mcaddon or .mcpack file first.'); return; }
    if (!name.trim() || !description.trim()) { setNotice('Add a name and description.'); return; }
    const auth = getDiscordAuth();
    const user = getDiscordUser();
    if (!auth || !user) { setNotice('Sign in through Discord again before publishing.'); return; }
    setPublishing(true); setProgress(0); setNotice('');
    try {
      const uploaded = await uploadToCloud(file, file.name, 'pub', setProgress);
      const response = await fetch('/api/community-modpacks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          content_type: 'addon', category: selectedCategory, license_id:selectedLicense, name: name.trim(),
          description: description.trim(), author: user.global_name || user.username,
          author_id: user.id, version: version.trim() || '1.0.0', total_packs: 1,
          size: file.size, blob_url: uploaded.url, file_name: file.name, icon_data_url: cover,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Publishing failed.');
      setShowUpload(false); setFile(null); setName(''); setDescription(''); setVersion('1.0.0'); setCover(null);
      await load();
      setNotice('Your addon is now published in the Community library.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not publish addon.');
    } finally { setPublishing(false); setProgress(0); }
  };

  const deleteAddon = async (addon: CommunityAddon) => {
    if (!currentUserId || addon.author_id !== currentUserId) return;
    if (!window.confirm(`Delete "${addon.name}" from the Community library?`)) return;
    try {
      const response = await fetch(`/api/community-modpacks?id=${encodeURIComponent(addon.id)}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not delete addon.');
      setNotice('Addon removed from the Community library.');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not delete addon.');
    }
  };

  const download = async (addon: CommunityAddon) => {
    try {
      await fetch(`/api/community-modpacks?action=download&id=${encodeURIComponent(addon.id)}`, { method: 'POST', headers: authHeaders() });
    } catch { /* download remains available if analytics fail */ }
    const link = document.createElement('a');
    link.href = addon.blob_url; link.download = addon.file_name; link.rel = 'noopener';
    document.body.appendChild(link); link.click(); link.remove();
  };

  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent text-white">
    <header className="border-b border-[#30263F] bg-[#100D18]/55 px-4 py-4 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="rounded-lg border border-[#30263F] p-2 text-[#AAA3BB]" aria-label="Back"><ArrowLeft size={16}/></button>
          <div className="min-w-0 flex-1"><div className="autobe-animated-banner autobe-animated-banner--addons"><span className="autobe-animated-banner__word">Addons</span></div><p className="mt-1 text-xs text-[#AAA3BB]">{addons.length} individual addons shared by creators</p></div>
        </div>
        <button onClick={() => setShowUpload(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#762BFF] px-3 py-2 text-xs font-bold"><Plus size={15}/> Upload addon</button>
      </div>
      <div className="relative mt-4"><Search size={15} className="absolute left-3 top-2.5 text-[#716885]"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search addons, creators, or themes..." className="w-full rounded-lg border border-[#30263F] bg-[#15111F] py-2 pl-9 pr-3 text-sm outline-none focus:border-[#762BFF]"/></div>
      <div className="relative mt-2 max-w-lg"><input value={creatorSearch} onChange={e=>setCreatorSearch(e.target.value)} placeholder="Find eligible creators…" className="w-full rounded-lg border border-[#30263F] bg-[#15111F] py-2 pl-3 pr-3 text-xs outline-none focus:border-[#762BFF]"/>{creatorSearch.trim().length>=2&&<div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-[#30263F] bg-[#100D18] shadow-xl">{creatorSearchLoading?<p className="p-3 text-xs text-[#AAA3BB]">Searching eligible creators…</p>:creatorResults.length===0?<p className="p-3 text-xs text-[#AAA3BB]">No eligible creators found.</p>:creatorResults.map(c=><button key={c.author_id} onClick={()=>onOpenCreator?.(c.author_id)} className="flex w-full items-center justify-between border-b border-white/5 p-3 text-left text-xs hover:bg-white/5"><span className="font-bold">{c.author}</span><span className="text-[10px] text-[#AAA3BB]">{c.uploads} uploads · {c.followers} followers</span></button>)}</div>}</div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{['All', ...CATEGORIES].map(item=><button key={item} onClick={()=>setCategory(item)} className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${category===item?'border-[#762BFF] bg-[#762BFF] text-white':'border-[#30263F] bg-[#15111F] text-[#AAA3BB]'}`}>{item}</button>)}</div>
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto p-4">
      {notice && <div className={`mb-3 rounded-lg border p-3 text-xs ${notice.includes('required AutoBE Discord role') ? 'border-amber-300/30 bg-amber-300/10 text-amber-100' : 'border-[#762BFF]/40 bg-[#762BFF]/10 text-[#D9C5FF]'}`}>{notice}</div>}
      {!loading&&addonLeaders.length>0&&<section className="mb-4 rounded-xl border border-[#762BFF]/30 bg-[#171027] p-4"><h2 className="mb-3 text-sm font-bold text-white">Top Addon Creators</h2><div className="grid gap-2 sm:grid-cols-3">{addonLeaders.slice(0,3).map((creator,index)=><button key={creator.author_id} onClick={()=>onOpenCreator?.(creator.author_id)} className="rounded-lg border border-white/10 bg-black/20 p-3 text-left"><span className="block text-xs font-bold text-white">#{index+1} {creator.author}</span><span className="mt-1 block text-[10px] text-[#AAA3BB]">{creator.uploads} addons · {creator.downloads} downloads</span></button>)}</div></section>}
       {!loading&&featuredAddons.length>0&&<section className="mb-4 rounded-xl border border-amber-300/20 bg-gradient-to-br from-[#211A12] to-[#100D18] p-4"><h2 className="mb-3 text-sm font-bold text-amber-100">Featured Addons</h2><div className="grid gap-2 sm:grid-cols-2">{featuredAddons.map(item=><button key={item.id} onClick={()=>{setSearch(item.name);setCategory("All");}} className="rounded-lg border border-white/10 bg-black/20 p-3 text-left text-xs font-bold">{item.name}<span className="mt-1 block text-[10px] font-normal text-[#AAA3BB]">by {item.author}</span></button>)}</div></section>}
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#A855F7]"/></div> :
      filtered.length === 0 ? <div className="py-20 text-center"><Box className="mx-auto mb-3 text-[#716885]" size={34}/><p className="font-semibold">{search || category !== 'All' ? 'No addons found' : 'No community addons yet'}</p><p className="mt-1 text-xs text-[#AAA3BB]">Upload the first addon or try another category.</p></div> :
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{filtered.map(addon=><article key={addon.id} className="overflow-hidden rounded-xl border border-[#30263F] bg-[#100D18]">
        <div className="flex h-36 items-center justify-center bg-[#15111F]">{addon.icon_data_url ? <img src={addon.icon_data_url} alt="" className="h-full w-full object-contain bg-black/20"/> : <ImageIcon className="text-[#716885]" size={34}/>}</div>
        <div className="space-y-2 p-3"><div className="flex items-start justify-between gap-2"><h2 className="text-sm font-bold">{addon.name}</h2><span className="rounded-full border border-[#762BFF]/40 px-2 py-0.5 text-[10px] text-[#C4A7FF]">{addon.category || 'Other'}</span></div>
          <p className="line-clamp-3 min-h-12 text-xs text-[#AAA3BB]">{addon.description}</p>
          <div className="flex items-center justify-between text-[10px] text-[#716885]"><span className="flex min-w-0 items-center gap-1.5">{addon.author_avatar ? <img src={`https://cdn.discordapp.com/avatars/${addon.author_id}/${addon.author_avatar}.png?size=64`} alt="" className="h-5 w-5 rounded-full object-cover" loading="lazy" referrerPolicy="no-referrer"/> : null}<span className="truncate">by {addon.author}</span></span><span>v{addon.version} · {formatSize(addon.size)} · {Number(addon.downloads)||0} downloads · {LICENSE_LABELS[addon.license_id||'LicenseRef-All-Rights-Reserved']||addon.license_id}</span></div>
          <div className="flex items-center justify-between text-[10px] text-[#AAA3BB]"><span>♥ {addonStats[addon.id]?.likes||0} likes</span><span>{addonStats[addon.id]?.reviewCount||0} reviews · {(addonStats[addon.id]?.averageRating||0).toFixed(1)} ★</span></div>
          <button onClick={()=>void download(addon)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#762BFF] py-2 text-xs font-bold"><Download size={14}/> Download {addon.file_name.toLowerCase().endsWith('.mcpack') ? 'MCPack' : 'MCAddon'}</button>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={socialBusy===addon.id} onClick={()=>void communityAction(addon,'like')} className="rounded-lg border border-violet-300/20 bg-violet-500/10 py-2 text-[11px] font-bold text-violet-100 disabled:opacity-50">{socialFlags[addon.id]?.liked?'♥ Liked':'♡ Like'}</button>
            <button disabled={socialBusy===addon.id} onClick={()=>void communityAction(addon,'favorite')} className="rounded-lg border border-white/10 py-2 text-[11px] font-bold disabled:opacity-50">{socialFlags[addon.id]?.favorited?'★ Saved':'☆ Save'}</button>
          </div>
          {currentUserId && addon.author_id!==currentUserId && <button disabled={socialBusy===addon.id} onClick={()=>void communityAction(addon,'follow')} className="w-full rounded-lg border border-white/10 py-2 text-[11px] font-bold disabled:opacity-50">{socialFlags[addon.id]?.following?'Following creator':'Follow creator'}</button>}
          <div className="flex gap-2"><select value={reviewRatings[addon.id]||5} onChange={e=>setReviewRatings(v=>({...v,[addon.id]:Number(e.target.value)}))} className="rounded-lg border border-white/10 bg-[#08070D] px-2 text-[10px]">{[5,4,3,2,1].map(n=><option key={n} value={n}>{n} ★</option>)}</select><input value={reviewTexts[addon.id]||''} onChange={e=>setReviewTexts(v=>({...v,[addon.id]:e.target.value}))} maxLength={1000} placeholder="Write a review…" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#08070D] px-2 py-2 text-[10px]"/><button disabled={socialBusy===addon.id} onClick={()=>void communityAction(addon,'review')} className="rounded-lg bg-violet-500/20 px-2 text-[10px] font-bold disabled:opacity-50">Post</button></div>

          {currentUserId && addon.author_id === currentUserId && <button onClick={()=>void deleteAddon(addon)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 py-2 text-xs font-semibold text-red-300"><Trash2 size={13}/> Delete my addon</button>}
        </div>
      </article>)}</div>}
    </main>
    {showUpload && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-2 sm:p-4">
      <div className="flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#403252] bg-[#100D18] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
          <div><h2 className="text-lg font-bold">Publish a Community Addon</h2><p className="mt-1 text-xs text-[#AAA3BB]">Share an installable .mcaddon or .mcpack with the Community.</p></div>
          <button onClick={()=>!publishing&&setShowUpload(false)} aria-label="Close" className="rounded-lg p-2 text-[#AAA3BB] hover:bg-white/10"><X size={20}/></button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <section>
            <div className="mb-2 text-sm font-semibold text-white">Addon file <span className="text-[#AAA3BB] font-normal">(.mcaddon or .mcpack)</span></div>
            <input ref={addonFileInput} type="file" accept="*/*" disabled={publishing} onChange={e=>{const picked=e.target.files?.[0]||null;if(picked&&!/\.(mcaddon|mcpack)$/i.test(picked.name)){setNotice('Choose the original .mcaddon or .mcpack file. ZIP files must be renamed only if they are actually a Bedrock addon package.');setFile(null);}else{setFile(picked);setNotice('');if(picked&&!name)setName(picked.name.replace(/\.(mcaddon|mcpack)$/i,''));}e.currentTarget.value='';}} className="sr-only"/>
            <div className="rounded-xl border border-dashed border-violet-300/40 bg-violet-500/[0.06] p-4 sm:p-5">
              <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
                <div className="rounded-xl bg-violet-400/10 p-3 text-violet-200"><Upload size={24}/></div>
                <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white">{file ? file.name : 'Choose your addon package'}</div><p className="mt-1 text-xs text-[#AAA3BB]">{file ? `${formatSize(file.size)} · Ready to upload` : 'Select an .mcaddon or .mcpack from your device Files.'}</p></div>
                <button type="button" disabled={publishing} onClick={()=>addonFileInput.current?.click()} className="min-h-11 w-full rounded-lg border border-violet-300/30 bg-violet-500/15 px-4 py-3 text-sm font-bold text-violet-100 disabled:opacity-50 sm:w-auto">Browse files</button>
              </div>
              {file && <button type="button" onClick={()=>setFile(null)} className="mt-3 text-xs font-semibold text-rose-300 underline">Remove selected file</button>}
            </div>
          </section>
          <label className="block text-sm font-semibold text-[#C9C1D5]">Addon name<input value={name} onChange={e=>setName(e.target.value)} maxLength={120} placeholder="Name your addon" className="mt-2 min-h-12 w-full rounded-xl border border-[#403252] bg-[#08070D] px-4 py-3 text-base text-white outline-none focus:border-violet-400"/></label>
          <label className="block text-sm font-semibold text-[#C9C1D5]">Description<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={2000} rows={5} placeholder="What does this addon add? Include features, compatibility, and credits." className="mt-2 min-h-36 w-full resize-y rounded-xl border border-[#403252] bg-[#08070D] px-4 py-3 text-base leading-relaxed text-white outline-none focus:border-violet-400"/></label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-[#C9C1D5]">Theme<select value={selectedCategory} onChange={e=>setSelectedCategory(e.target.value as Category)} className="mt-2 min-h-12 w-full rounded-xl border border-[#403252] bg-[#08070D] px-4 py-3 text-base text-white">{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label>
            <label className="block text-sm font-semibold text-[#C9C1D5]">Version<input value={version} onChange={e=>setVersion(e.target.value)} maxLength={40} placeholder="1.0.0" className="mt-2 min-h-12 w-full rounded-xl border border-[#403252] bg-[#08070D] px-4 py-3 text-base text-white outline-none focus:border-violet-400"/></label>
          </div>
          <section>
            <div className="mb-2 text-sm font-semibold text-white">Cover image <span className="font-normal text-[#AAA3BB]">(optional · PNG, JPG, WebP)</span></div>
            <input ref={coverFileInput} type="file" accept="image/png,image/jpeg,image/webp" disabled={publishing} onChange={e=>{chooseCover(e.target.files?.[0]);e.currentTarget.value='';}} className="sr-only"/>
            <div className="flex flex-col gap-3 rounded-xl border border-[#30263F] bg-black/20 p-4 sm:flex-row sm:items-center">
              {cover ? <img src={cover} alt="Addon cover preview" className="h-auto max-h-36 w-full max-w-[240px] rounded-xl border border-white/10 bg-black/30 object-contain"/> : <div className="flex h-28 w-full max-w-[240px] shrink-0 items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.03] text-[#716885]"><ImageIcon size={30}/></div>}
              <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white">{cover ? 'Cover image selected' : 'Add a cover image'}</div><p className="mt-1 text-xs leading-relaxed text-[#AAA3BB]">A clear image helps people recognize your addon. You can publish without one.</p><button type="button" disabled={publishing} onClick={()=>coverFileInput.current?.click()} className="mt-3 min-h-11 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{cover ? 'Change cover image' : 'Choose cover image'}</button>{cover&&<button type="button" onClick={()=>setCover(null)} className="ml-3 text-xs font-semibold text-rose-300 underline">Remove</button>}</div>
            </div>
          </section>
          {publishing && <div className="rounded-xl border border-violet-300/20 bg-violet-500/[0.06] p-3"><div className="mb-2 flex justify-between text-xs text-[#C9C1D5]"><span>Uploading addon package…</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-[#30263F]"><div className="h-full bg-[#A855F7] transition-all" style={{width:`${progress}%`}}/></div><p className="mt-2 text-[11px] text-[#AAA3BB]">Keep AutoBE open until publishing finishes.</p></div>}
          {notice && <div className="rounded-lg border border-violet-300/20 bg-violet-500/10 p-3 text-xs leading-relaxed text-violet-100">{notice}</div>}
        </div>
        <div className="shrink-0 border-t border-white/10 bg-[#100D18] px-5 py-4 sm:px-6">
          <button disabled={publishing||!file} onClick={()=>void publish()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#762BFF] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{publishing?<><Loader2 className="animate-spin" size={17}/> Publishing…</>:<><Upload size={17}/> Publish addon</>}</button>
        </div>
      </div>
    </div>}
  </div>;
};
