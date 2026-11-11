import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Box, Download, Image as ImageIcon, Loader2, Plus, Search, Upload, X, Trash2 } from 'lucide-react';
import { uploadToCloud } from '@/utils/cloudUpload';
import { getDiscordAuth, getDiscordUser } from '@/utils/discordAuth';

const CATEGORIES = ['Horror', 'Medieval', 'Fantasy', 'Survival', 'Technology', 'Magic', 'PvP', 'Adventure', 'Weapons', 'Mobs', 'Blocks', 'Decorations', 'Utility', 'Other'] as const;
type Category = typeof CATEGORIES[number];
interface CommunityAddon {
  id: string; name: string; description: string; author: string; author_id: string;
  version: string; size: number; icon_data_url?: string; created_at: number; downloads: number;
  blob_url: string; file_name: string; category?: Category; content_type?: string;
}
interface Props { onBack: () => void; currentUserId?: string; }

const authHeaders = () => {
  const auth = getDiscordAuth();
  return auth ? { Authorization: `Bearer ${auth.token}` } : {};
};
const formatSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

export const CommunityAddonsScreen: React.FC<Props> = ({ onBack, currentUserId }) => {
  const [addons, setAddons] = useState<CommunityAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [selectedCategory, setSelectedCategory] = useState<Category>('Other');
  const [cover, setCover] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/community-modpacks', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load community addons.');
      setAddons((data.modpacks || []).filter((item: CommunityAddon) => item.content_type === 'addon'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load community addons.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => addons.filter(item =>
    (category === 'All' || item.category === category) &&
    [item.name, item.description, item.author, item.category || ''].some(value => value.toLowerCase().includes(search.toLowerCase()))
  ), [addons, category, search]);

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
          content_type: 'addon', category: selectedCategory, name: name.trim(),
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

  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#08070D] text-white">
    <header className="border-b border-[#30263F] bg-[#100D18] px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="rounded-lg border border-[#30263F] p-2 text-[#AAA3BB]" aria-label="Back"><ArrowLeft size={16}/></button>
          <div><h1 className="text-lg font-bold">Community Addons</h1><p className="text-xs text-[#AAA3BB]">{addons.length} individual addons shared by creators</p></div>
        </div>
        <button onClick={() => setShowUpload(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#762BFF] px-3 py-2 text-xs font-bold"><Plus size={15}/> Upload addon</button>
      </div>
      <div className="relative mt-4"><Search size={15} className="absolute left-3 top-2.5 text-[#716885]"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search addons, creators, or themes..." className="w-full rounded-lg border border-[#30263F] bg-[#15111F] py-2 pl-9 pr-3 text-sm outline-none focus:border-[#762BFF]"/></div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{['All', ...CATEGORIES].map(item=><button key={item} onClick={()=>setCategory(item)} className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${category===item?'border-[#762BFF] bg-[#762BFF] text-white':'border-[#30263F] bg-[#15111F] text-[#AAA3BB]'}`}>{item}</button>)}</div>
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto p-4">
      {notice && <div className="mb-3 rounded-lg border border-[#762BFF]/40 bg-[#762BFF]/10 p-3 text-xs text-[#D9C5FF]">{notice}</div>}
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#A855F7]"/></div> :
      filtered.length === 0 ? <div className="py-20 text-center"><Box className="mx-auto mb-3 text-[#716885]" size={34}/><p className="font-semibold">{search || category !== 'All' ? 'No addons found' : 'No community addons yet'}</p><p className="mt-1 text-xs text-[#AAA3BB]">Upload the first addon or try another category.</p></div> :
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{filtered.map(addon=><article key={addon.id} className="overflow-hidden rounded-xl border border-[#30263F] bg-[#100D18]">
        <div className="flex h-36 items-center justify-center bg-[#15111F]">{addon.icon_data_url ? <img src={addon.icon_data_url} alt="" className="h-full w-full object-cover"/> : <ImageIcon className="text-[#716885]" size={34}/>}</div>
        <div className="space-y-2 p-3"><div className="flex items-start justify-between gap-2"><h2 className="text-sm font-bold">{addon.name}</h2><span className="rounded-full border border-[#762BFF]/40 px-2 py-0.5 text-[10px] text-[#C4A7FF]">{addon.category || 'Other'}</span></div>
          <p className="line-clamp-3 min-h-12 text-xs text-[#AAA3BB]">{addon.description}</p>
          <div className="flex justify-between text-[10px] text-[#716885]"><span>by {addon.author}</span><span>v{addon.version} · {formatSize(addon.size)}</span></div>
          <button onClick={()=>void download(addon)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#762BFF] py-2 text-xs font-bold"><Download size={14}/> Download {addon.file_name.toLowerCase().endsWith('.mcpack') ? 'MCPack' : 'MCAddon'}</button>
          {currentUserId && addon.author_id === currentUserId && <button onClick={()=>void deleteAddon(addon)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 py-2 text-xs font-semibold text-red-300"><Trash2 size={13}/> Delete my addon</button>}
        </div>
      </article>)}</div>}
    </main>
    {showUpload && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3"><div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#30263F] bg-[#100D18] p-5">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-bold">Publish a Community Addon</h2><button onClick={()=>!publishing&&setShowUpload(false)} aria-label="Close"><X size={18}/></button></div>
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-[#AAA3BB]">Addon file (.mcaddon or .mcpack)<input type="file" accept=".mcaddon,.mcpack,application/zip" onChange={e=>{const picked=e.target.files?.[0]||null;if(picked&&!/\.(mcaddon|mcpack)$/i.test(picked.name)){setNotice('Only .mcaddon and .mcpack files are supported.');setFile(null);}else{setFile(picked);if(picked&&!name)setName(picked.name.replace(/\.(mcaddon|mcpack)$/i,''));}}} className="mt-1 block w-full text-xs"/></label>
        <label className="block text-xs font-semibold text-[#AAA3BB]">Addon name<input value={name} onChange={e=>setName(e.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-[#30263F] bg-[#08070D] p-2 text-sm text-white"/></label>
        <label className="block text-xs font-semibold text-[#AAA3BB]">Description<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={2000} rows={4} placeholder="What does this addon add? Include features, compatibility, and credits." className="mt-1 w-full rounded-lg border border-[#30263F] bg-[#08070D] p-2 text-sm text-white"/></label>
        <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-semibold text-[#AAA3BB]">Theme<select value={selectedCategory} onChange={e=>setSelectedCategory(e.target.value as Category)} className="mt-1 w-full rounded-lg border border-[#30263F] bg-[#08070D] p-2 text-sm">{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label><label className="block text-xs font-semibold text-[#AAA3BB]">Version<input value={version} onChange={e=>setVersion(e.target.value)} maxLength={40} className="mt-1 w-full rounded-lg border border-[#30263F] bg-[#08070D] p-2 text-sm"/></label></div>
        <label className="block text-xs font-semibold text-[#AAA3BB]">Cover image (PNG, JPG, WebP)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>chooseCover(e.target.files?.[0])} className="mt-1 block w-full text-xs"/></label>
        {cover && <img src={cover} alt="Addon cover preview" className="h-24 w-24 rounded-lg border border-[#30263F] object-cover"/>}
        {file && <p className="text-xs text-[#AAA3BB]">Selected: {file.name} · {formatSize(file.size)}</p>}
        {publishing && <div><div className="mb-1 flex justify-between text-xs text-[#AAA3BB]"><span>Uploading addon…</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-[#30263F]"><div className="h-full bg-[#A855F7]" style={{width:`${progress}%`}}/></div></div>}
        <button disabled={publishing||!file} onClick={()=>void publish()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#762BFF] py-3 text-sm font-bold disabled:opacity-50">{publishing?<><Loader2 className="animate-spin" size={16}/> Publishing…</>:<><Upload size={16}/> Publish addon</>}</button>
      </div>
    </div></div>}
  </div>;
};
