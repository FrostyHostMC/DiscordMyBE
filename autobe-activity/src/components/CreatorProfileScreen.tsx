import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Box, Download, Package, RefreshCw, Sparkles } from 'lucide-react';
import type { DiscordUserInfo } from '@/utils/discordAuth';
import type { CommunityModpack } from '@/types/modpack';

type Props = { onBack: () => void; user: DiscordUserInfo | null };

export const CreatorProfileScreen: React.FC<Props> = ({ onBack, user }) => {
  const [items, setItems] = useState<CommunityModpack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'all' | 'addon' | 'modpack'>('all');

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
  };
  useEffect(() => { void load(); }, [user?.id]);

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
      <section className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-[10px] font-extrabold uppercase tracking-[.18em] text-violet-200/55">Your community uploads</div><h3 className="mt-1 text-xl font-black">Published content</h3></div><div className="flex rounded-xl border border-white/10 bg-[#120E1E] p-1">{(['all','addon','modpack'] as const).map(value => <button key={value} onClick={() => setKind(value)} className={`rounded-lg px-3 py-2 text-xs font-bold capitalize transition ${kind === value ? 'bg-violet-500/25 text-white' : 'text-[#A99FBE] hover:text-white'}`}>{value === 'all' ? 'All' : value === 'addon' ? 'Addons' : 'Modpacks'}</button>)}</div></div>
        {loading ? <div className="py-16 text-center text-sm text-[#A99FBE]">Loading your published content…</div> : error ? <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-500/5 p-4 text-sm text-rose-200">{error}</div> : visible.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-violet-300/20 bg-white/[.02] px-5 py-12 text-center"><Package className="mx-auto h-8 w-8 text-violet-300/60"/><h4 className="mt-3 font-bold">Nothing published here yet</h4><p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[#A99FBE]">When you publish an addon or modpack in the Community, it will automatically appear on this page.</p></div> : <div className="mt-5 grid gap-3 sm:grid-cols-2">{visible.map(item => <article key={item.id} className="overflow-hidden rounded-2xl border border-violet-300/12 bg-[#120E1E]"><div className="flex gap-3 p-4"><div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-violet-500/10">{item.icon_data_url ? <img src={item.icon_data_url} alt="" className="h-full w-full object-cover"/> : <Package className="h-7 w-7 text-violet-200/70"/>}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="rounded-full bg-violet-500/15 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-violet-200">{item.content_type === 'addon' ? 'Addon' : 'Modpack'}</span><span className="text-[10px] text-[#8F85A1]">v{item.version}</span></div><h4 className="mt-2 truncate text-sm font-extrabold">{item.name}</h4><p className="mt-1 line-clamp-2 text-xs text-[#A99FBE]">{item.description}</p><div className="mt-2 text-[10px] text-[#8F85A1]">{(Number(item.downloads) || 0).toLocaleString()} downloads · {new Date(item.created_at).toLocaleDateString()}</div></div></div></article>)}</div>}
      </section>
    </div>
  </div>;
};
