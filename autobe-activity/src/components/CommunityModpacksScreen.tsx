import React, { useState, useEffect } from 'react';
import {
  Globe,
  Download,
  ArrowLeft,
  Clock,
  Box,
  User,
  Loader2,
  ExternalLink,
  Trash2,
  Edit,
  X,
  Search,
  ArrowUpRight,
  Info,
  RefreshCw,
  Image as ImageIcon,
  Eye,
  Trophy
} from 'lucide-react';
import { CommunityModpack } from '@/types/modpack';
import { getDiscordAuth } from '@/utils/discordAuth';
import { cleanDiscordDisplayName } from '@/utils/displayName';

const authHeaders = (): Record<string, string> => {
  const auth = getDiscordAuth();
  return auth ? { Authorization: `Bearer ${auth.token}` } : {};
};

interface CommunityModpacksScreenProps {
  onBack: () => void;
  onDownload: (modpack: CommunityModpack) => void;
  currentUserId?: string; // Discord user ID of the current user
}

export const CommunityModpacksScreen: React.FC<CommunityModpacksScreenProps> = ({
  onBack,
  onDownload,
  currentUserId
}) => {
  const [modpacks, setModpacks] = useState<CommunityModpack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingModpack, setEditingModpack] = useState<CommunityModpack | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', detail_description: '', version: '' });
  const [editGalleryImages, setEditGalleryImages] = useState<string[]>([]);
  const [editIcon, setEditIcon] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedModpack, setSelectedModpack] = useState<CommunityModpack | null>(null);
  const [usage, setUsage] = useState<{
    publishedModpacks: number;
    estimatedPublishedGiB: number;
    percentOfR2FreeStorage: number;
    uploadStartsInLast24Hours: number;
    warning: string;
  } | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    void fetchCommunityModpacks();
  }, []);

  const fetchCommunityModpacks = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await fetch('/api/community-modpacks', { cache: 'no-store' });
      const data = await response.json();

      console.log('Community modpacks response:', data);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch community modpacks');
      }

      setModpacks((data.modpacks || []).filter((item: CommunityModpack) => item.content_type !== 'addon'));
      setError(null);
    } catch (err) {
      console.error('Failed to fetch community modpacks:', err);
      setError(err instanceof Error ? err.message : 'Failed to load community modpacks');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadUsage = async () => {
    setUsageLoading(true);
    try {
      const response = await fetch('/api/admin/usage', { headers: authHeaders(), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load Cloudflare usage');
      setUsage(data);
      setNotice(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not load Cloudflare usage');
    } finally {
      setUsageLoading(false);
    }
  };

  const handleDelete = async (modpack: CommunityModpack) => {
    if (!currentUserId) return;

    try {
      const response = await fetch(`/api/community-modpacks?id=${encodeURIComponent(modpack.id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete modpack');
      }

      // Refresh the list
      await fetchCommunityModpacks();
    } catch (err) {
      console.error('Failed to delete modpack:', err);
      setNotice(err instanceof Error ? err.message : 'Failed to delete modpack');
    }
  };

  const handleEdit = (modpack: CommunityModpack) => {
    setEditingModpack(modpack);
    setEditForm({
      name: modpack.name,
      description: modpack.description,
      detail_description: modpack.detail_description || '',
      version: modpack.version
    });
    setEditIcon(modpack.icon_data_url || null);
    setEditGalleryImages(Array.isArray(modpack.detail_images) ? modpack.detail_images.slice(0, 3) : []);
  };

  const refreshDetails = async () => {
    if (!selectedModpack) return;
    setDetailsLoading(true);
    try {
      const response = await fetch('/api/community-modpacks', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to refresh modpack');
      const latest = (data.modpacks || []).find((item: CommunityModpack) => item.id === selectedModpack.id);
      if (!latest) {
        setSelectedModpack(null);
        setNotice('This modpack is no longer available.');
      } else {
        setModpacks((data.modpacks || []).filter((item: CommunityModpack) => item.content_type !== 'addon'));
        setSelectedModpack(latest);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not refresh modpack details');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleIconFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNotice('Choose an image file.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setNotice('Could not read that image.');
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => setNotice('That image could not be opened.');
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const max = 256;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setNotice('Image processing is unavailable in this browser.');
          return;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        let quality = 0.82;
        let result = canvas.toDataURL('image/jpeg', quality);
        while (result.length > 95000 && quality > 0.3) {
          quality -= 0.1;
          result = canvas.toDataURL('image/jpeg', quality);
        }
        if (result.length > 100000) {
          setNotice('That image is too large after compression. Try a simpler image.');
          return;
        }
        setEditIcon(result);
        setNotice(null);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleGalleryFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNotice('Choose an image file.');
      return;
    }
    if (editGalleryImages.length >= 3) {
      setNotice('You can add up to 3 gallery images.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setNotice('Could not read that image.');
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => setNotice('That image could not be opened.');
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const max = 1280;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setNotice('Image processing is unavailable in this browser.');
          return;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        let quality = 0.78;
        let result = canvas.toDataURL('image/jpeg', quality);
        while (result.length > 90000 && quality > 0.28) {
          quality -= 0.1;
          result = canvas.toDataURL('image/jpeg', quality);
        }
        if (result.length > 95000) {
          setNotice('That image is too large after compression. Try a simpler image.');
          return;
        }
        setEditGalleryImages((current) => current.length < 3 ? [...current, result] : current);
        setNotice(null);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveEdit = async () => {
    if (!editingModpack || !currentUserId) return;
    setSavingEdit(true);

    try {
      const response = await fetch(`/api/community-modpacks?id=${encodeURIComponent(editingModpack.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ...editForm, icon_data_url: editIcon, detail_images: editGalleryImages }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update modpack');
      }

      // Refresh the list
      await fetchCommunityModpacks();
      const updated = { ...editingModpack, ...editForm, icon_data_url: editIcon || undefined, detail_images: editGalleryImages };
      setSelectedModpack((current) => current?.id === updated.id ? updated : current);
      setEditingModpack(null);
    } catch (err) {
      console.error('Failed to update modpack:', err);
      setNotice(err instanceof Error ? err.message : 'Failed to update modpack');
    } finally {
      setSavingEdit(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

  const filtered = modpacks.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.description.toLowerCase().includes(search.toLowerCase()) ||
    m.author.toLowerCase().includes(search.toLowerCase())
  );

  // Rank community creators from the live published-pack list. Creator identity
  // uses Discord author_id when available, so similarly named users aren't merged.
  const topCreators = Array.from(
    modpacks.reduce((creators, modpack) => {
      const key = modpack.author_id || modpack.author;
      const current = creators.get(key) || {
        id: key,
        name: cleanDiscordDisplayName(modpack.author) || 'Community creator',
        modpackCount: 0,
        downloads: 0
      };
      current.modpackCount += 1;
      current.downloads += Number.isFinite(modpack.downloads) ? modpack.downloads : 0;
      creators.set(key, current);
      return creators;
    }, new Map<string, { id: string; name: string; modpackCount: number; downloads: number }>())
      .values()
  )
    .sort((a, b) => b.modpackCount - a.modpackCount || b.downloads - a.downloads || a.name.localeCompare(b.name))
    .slice(0, 3);

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-[#30263F]/70 bg-[#100D18]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#15111F] border border-[#30263F] text-[#AAA3BB] hover:text-white active:scale-95 transition-all"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-white">Community Modpacks</h1>
              <p className="text-xs text-[#AAA3BB] mt-0.5">
                {modpacks.length} shared modpack{modpacks.length === 1 ? '' : 's'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void fetchCommunityModpacks()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#15111F] border border-[#30263F] text-xs text-[#AAA3BB] hover:text-white disabled:opacity-50"
              aria-label="Refresh community modpacks"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void loadUsage()}
              disabled={usageLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#15111F] border border-[#30263F] text-xs text-[#AAA3BB] hover:text-white disabled:opacity-50"
            >
              <Info className="w-3.5 h-3.5" />
              {usageLoading ? 'Checking…' : 'Storage usage'}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mt-3 pt-3 border-t border-[#30263F]/50">
          <div className="relative max-w-sm">
            <Search className="w-3.5 h-3.5 text-[#AAA3BB] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, description, or author..."
              className="bg-[#15111F] border border-[#30263F] rounded-lg pl-8 pr-2.5 py-1 text-xs text-white placeholder-[#716885] outline-none focus:border-[#762BFF] w-full"
            />
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24 space-y-3 max-w-4xl mx-auto w-full">
        {!loading && !error && topCreators.length > 0 && (
          <section className="rounded-xl border border-[#762BFF]/30 bg-gradient-to-br from-[#171027] to-[#100D18] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-[#C4A7FF]" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-bold text-white">Top Creators</h2>
                <p className="text-[10px] text-[#AAA3BB]">Community members ranked by published modpacks</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {topCreators.map((creator, index) => (
                <div key={creator.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-[#30263F] bg-[#0D0B19]/80 p-3">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-black ${index === 0 ? 'bg-[#762BFF]/25 text-[#D9C5FF]' : 'bg-[#201A2E] text-[#AAA3BB]'}`}>
                    #{index + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-white">{creator.name}</p>
                    <p className="text-[10px] text-[#AAA3BB]">
                      {creator.modpackCount} modpack{creator.modpackCount === 1 ? '' : 's'} · {creator.downloads} downloads
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {usage && (
          <div className="p-3 rounded-lg border border-[#30263F] bg-[#100D18] text-xs text-[#AAA3BB] space-y-1">
            <p className="font-bold text-white">Cloudflare usage estimate</p>
            <p>Published packs: {usage.publishedModpacks}</p>
            <p>Published archive storage estimate: {usage.estimatedPublishedGiB} GiB / 10 GB free R2 allowance ({usage.percentOfR2FreeStorage}%)</p>
            <p>Upload starts in last 24 hours: {usage.uploadStartsInLast24Hours}</p>
            <p className="text-[10px] text-amber-300">{usage.warning}</p>
          </div>
        )}
        {notice && (
          <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-xs text-red-300 break-words" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Loader2 className="w-8 h-8 text-[#762BFF] animate-spin mb-3" />
            <p className="text-sm text-[#AAA3BB]">Loading community modpacks...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Globe className="w-12 h-12 text-[#30263F] mb-3" />
            <p className="text-sm font-semibold text-white">Failed to load</p>
            <p className="text-xs text-[#AAA3BB] mt-1 max-w-xs">{error}</p>
            <button
              type="button"
              onClick={() => void fetchCommunityModpacks()}
              className="mt-4 px-4 py-2 bg-[#762BFF] hover:bg-[#853CFF] rounded-lg font-bold text-xs text-white active:scale-95 transition-all"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-xs text-[#AAA3BB]">
            <Globe className="w-10 h-10 text-[#30263F] mx-auto mb-3" />
            <p className="font-semibold text-white text-sm">No Modpacks Found</p>
            <p className="text-[#716885] text-xs mt-1 max-w-xs mx-auto">
              {search ? 'Try a different search term' : 'Be the first to publish a modpack for the community!'}
            </p>
          </div>
        ) : (
          filtered.map((modpack) => {
            const includedPacks = Array.isArray(modpack.included_packs) ? modpack.included_packs : [];

            return (
              <div
                key={modpack.id}
                className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] hover:border-[#762BFF]/50 transition-all flex flex-col gap-3 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-lg bg-[#15111F] border border-[#30263F] flex items-center justify-center shrink-0 overflow-hidden">
                      {modpack.icon_data_url ? (
                        <img src={modpack.icon_data_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Box className="w-5 h-5 text-[#A855F7]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <button type="button" onClick={() => setSelectedModpack(modpack)} className="text-left text-sm font-bold text-white group-hover:text-[#A855F7] transition-colors truncate max-w-full">
                        {modpack.name}
                      </button>
                      <div className="flex items-center gap-2 text-[11px] text-[#AAA3BB] font-mono mt-0.5">
                        <span className="text-emerald-400">{modpack.total_packs} packs</span>
                        <span>•</span>
                        <span>{formatSize(modpack.size)}</span>
                        <span>•</span>
                        <span>{formatDate(modpack.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1 text-[10px] text-[#AAA3BB]">
                      <Download className="w-3 h-3" />
                      <span>{modpack.downloads}</span>
                    </div>
                    {currentUserId && modpack.author_id === currentUserId && (
                      <button
                        type="button"
                        onClick={() => handleEdit(modpack)}
                        className="p-1.5 rounded-lg text-[#AAA3BB] hover:text-[#762BFF] hover:bg-[#15111F] transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                    )}
                    {currentUserId && modpack.author_id === currentUserId && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirmDeleteId === modpack.id) {
                            setConfirmDeleteId(null);
                            handleDelete(modpack);
                          } else {
                            setConfirmDeleteId(modpack.id);
                            setTimeout(() => setConfirmDeleteId((c) => (c === modpack.id ? null : c)), 4000);
                          }
                        }}
                        className={`p-1.5 rounded-lg hover:bg-[#15111F] transition-colors flex items-center gap-1 text-xs ${confirmDeleteId === modpack.id ? 'text-red-400' : 'text-[#AAA3BB] hover:text-red-400'}`}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                        {confirmDeleteId === modpack.id && <span>Tap again</span>}
                      </button>
                    )}
                  </div>
                </div>

                {/* Description preview; full text is available on the details page. */}
                <p className="text-xs text-[#AAA3BB] line-clamp-3">{modpack.description}</p>
                <button type="button" onClick={() => setSelectedModpack(modpack)} className="self-start inline-flex items-center gap-1.5 text-xs font-semibold text-[#C4A7FF] hover:text-white">
                  <Eye className="w-3.5 h-3.5" /> View details
                </button>

                {/* Author info */}
                <div className="flex items-center gap-2 text-[10px] text-[#716885]">
                  <User className="w-3 h-3" />
                  <span>by {cleanDiscordDisplayName(modpack.author)}</span>
                  <span>•</span>
                  <span className="font-mono">{modpack.version}</span>
                </div>

                {/* Included packs preview */}
                {includedPacks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 min-w-0 pt-1 border-t border-[#30263F]/40">
                    {includedPacks.slice(0, 4).map((p: any, idx: number) => (
                      <span
                        key={idx}
                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#15111F] border border-[#30263F] text-[#AAA3BB] truncate max-w-[130px]"
                      >
                        {p.name || p}
                      </span>
                    ))}
                    {includedPacks.length > 4 && (
                      <span className="text-[10px] text-[#716885] px-1 py-0.5">
                        +{includedPacks.length - 4} more
                      </span>
                    )}
                  </div>
                )}

                {/* Download Button */}
                <button
                  type="button"
                  onClick={() => onDownload(modpack)}
                  className="w-full px-4 py-2 rounded-lg bg-[#762BFF] hover:bg-[#853CFF] font-bold text-xs text-white flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  <Download className="w-4 h-4" />
                  Download Modpack
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Modpack details page */}
      {selectedModpack && !editingModpack && (
        <div className="fixed inset-0 z-40 bg-[#08070D] text-white overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-[#30263F] bg-[#100D18]">
            <button type="button" onClick={() => setSelectedModpack(null)} className="inline-flex items-center gap-2 text-sm text-[#AAA3BB] hover:text-white">
              <ArrowLeft className="w-4 h-4" /> Community
            </button>
            <button type="button" onClick={() => void refreshDetails()} disabled={detailsLoading} className="inline-flex items-center gap-2 rounded-lg border border-[#30263F] px-3 py-2 text-xs hover:text-white disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${detailsLoading ? 'animate-spin' : ''}`} /> Refresh details
            </button>
          </div>
          <div className="max-w-3xl mx-auto p-4 sm:p-8 space-y-5 pb-24">
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div className="w-28 h-28 sm:w-36 sm:h-36 shrink-0 rounded-2xl overflow-hidden border border-[#30263F] bg-[#15111F] flex items-center justify-center">
                {selectedModpack.icon_data_url ? <img src={selectedModpack.icon_data_url} alt="" className="w-full h-full object-cover" /> : <Box className="w-12 h-12 text-[#A855F7]" />}
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <h1 className="text-2xl font-bold break-words">{selectedModpack.name}</h1>
                <p className="text-sm text-[#AAA3BB]">by {cleanDiscordDisplayName(selectedModpack.author)}</p>
                <div className="flex flex-wrap gap-2 text-xs text-[#AAA3BB]">
                  <span className="rounded-full border border-[#30263F] px-3 py-1">Version {selectedModpack.version}</span>
                  <span className="rounded-full border border-[#30263F] px-3 py-1">{selectedModpack.total_packs} packs</span>
                  <span className="rounded-full border border-[#30263F] px-3 py-1">{formatSize(selectedModpack.size)}</span>
                  <span className="rounded-full border border-[#30263F] px-3 py-1">{selectedModpack.downloads} downloads</span>
                </div>
                {currentUserId && selectedModpack.author_id === currentUserId && (
                  <button type="button" onClick={() => handleEdit(selectedModpack)} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[#762BFF] px-4 py-2 text-sm font-bold hover:bg-[#853CFF]">
                    <Edit className="w-4 h-4" /> Edit my modpack
                  </button>
                )}
              </div>
            </div>
            <section className="rounded-xl border border-[#30263F] bg-[#100D18] p-4 sm:p-5 space-y-2">
              <h2 className="text-sm font-bold">About this modpack</h2>
              <p className="text-sm text-[#D5CEE3] whitespace-pre-wrap break-words">{selectedModpack.description || 'No description provided.'}</p>
            </section>
            <section className="rounded-xl border border-[#30263F] bg-[#100D18] p-4 sm:p-5 space-y-3">
              {selectedModpack.detail_description && (
                <section className="rounded-xl border border-[#30263F] bg-[#100D18] p-4 sm:p-5 space-y-2">
                  <h2 className="text-sm font-bold">More details</h2>
                  <p className="text-sm text-[#D5CEE3] whitespace-pre-wrap break-words">{selectedModpack.detail_description}</p>
                </section>
              )}
              {Array.isArray(selectedModpack.detail_images) && selectedModpack.detail_images.length > 0 && (
                <section className="rounded-xl border border-[#30263F] bg-[#100D18] p-4 sm:p-5 space-y-3">
                  <h2 className="text-sm font-bold">Gallery</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedModpack.detail_images.slice(0, 3).map((image, index) => (
                      <img key={index} src={image} alt={`Gallery image ${index + 1} for ${selectedModpack.name}`} loading="lazy" className="w-full max-h-96 object-contain rounded-lg border border-[#30263F] bg-[#08070D]" />
                    ))}
                  </div>
                </section>
              )}
              <h2 className="text-sm font-bold">Included packs</h2>
              {selectedModpack.included_packs?.length ? (
                <div className="space-y-2">
                  {selectedModpack.included_packs.map((pack: any, index: number) => (
                    <div key={index} className="flex items-center gap-3 rounded-lg bg-[#15111F] p-3">
                      {pack.icon_data_url ? <img src={pack.icon_data_url} alt="" className="w-9 h-9 rounded object-cover" /> : <Box className="w-5 h-5 text-[#A855F7]" />}
                      <div className="min-w-0"><p className="text-sm font-semibold break-words">{pack.name || String(pack)}</p>{pack.type && <p className="text-xs text-[#AAA3BB]">{pack.type}{pack.version ? ` · v${pack.version}` : ''}</p>}</div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-[#AAA3BB]">Pack-by-pack details were not saved for this listing. The downloadable merged archive is still available.</p>}
            </section>
            <button type="button" onClick={() => onDownload(selectedModpack)} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#762BFF] px-4 py-3 text-sm font-bold hover:bg-[#853CFF]">
              <Download className="w-4 h-4" /> Download modpack
            </button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingModpack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-[#100D18] border border-[#30263F] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Edit Modpack</h2>
              <button
                type="button"
                onClick={() => setEditingModpack(null)}
                className="text-[#AAA3BB] hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#AAA3BB] mb-1.5">Cover image</label>
                <div className="flex items-center gap-3">
                  <div className="w-20 h-20 rounded-lg overflow-hidden border border-[#30263F] bg-[#08070D] flex items-center justify-center">
                    {editIcon ? <img src={editIcon} alt="Modpack cover preview" className="w-full h-full object-cover" /> : <ImageIcon className="w-7 h-7 text-[#716885]" />}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input type="file" accept="image/*" onChange={(e) => handleIconFile(e.target.files?.[0])} className="block w-full text-xs text-[#AAA3BB] file:mr-3 file:rounded-lg file:border-0 file:bg-[#762BFF] file:px-3 file:py-2 file:text-white" />
                    {editIcon && <button type="button" onClick={() => setEditIcon(null)} className="text-xs text-red-300 hover:text-red-200">Remove cover image</button>}
                    <p className="text-[10px] text-[#716885]">Images are resized and compressed before saving.</p>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#AAA3BB] mb-1.5">Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#08070D] border border-[#30263F] text-white text-sm focus:border-[#762BFF] focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#AAA3BB] mb-1.5">Description</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={6}
                  className="w-full px-3 py-2 rounded-lg bg-[#08070D] border border-[#30263F] text-white text-sm focus:border-[#762BFF] focus:outline-none transition-colors resize-y"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#AAA3BB] mb-1.5">Detailed description (optional)</label>
                <textarea
                  value={editForm.detail_description}
                  maxLength={4000}
                  onChange={(e) => setEditForm({ ...editForm, detail_description: e.target.value.slice(0, 4000) })}
                  rows={5}
                  placeholder="Add extra information, features, installation notes, or credits..."
                  className="w-full px-3 py-2 rounded-lg bg-[#08070D] border border-[#30263F] text-white text-sm focus:border-[#762BFF] focus:outline-none transition-colors resize-y"
                />
                <p className="text-[10px] text-[#716885] text-right">{editForm.detail_description.length}/4000 characters</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#AAA3BB] mb-1.5">Gallery images (up to 3)</label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {editGalleryImages.map((image, index) => (
                    <div key={index} className="relative aspect-square rounded-lg overflow-hidden border border-[#30263F] bg-[#08070D]">
                      <img src={image} alt={`Gallery preview ${index + 1}`} className="w-full h-full object-cover" />
                      <button type="button" onClick={() => setEditGalleryImages((current) => current.filter((_, i) => i !== index))} className="absolute top-1 right-1 rounded-full bg-black/80 p-1 text-white" aria-label={`Remove gallery image ${index + 1}`}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                {editGalleryImages.length < 3 && (
                  <input type="file" accept="image/*" onChange={(e) => { handleGalleryFile(e.target.files?.[0]); e.currentTarget.value = ''; }} className="block w-full text-xs text-[#AAA3BB] file:mr-3 file:rounded-lg file:border-0 file:bg-[#762BFF] file:px-3 file:py-2 file:text-white" />
                )}
                <p className="text-[10px] text-[#716885]">Images are resized and compressed before saving.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#AAA3BB] mb-1.5">Version</label>
                <input
                  type="text"
                  value={editForm.version}
                  onChange={(e) => setEditForm({ ...editForm, version: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#08070D] border border-[#30263F] text-white text-sm focus:border-[#762BFF] focus:outline-none transition-colors"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingModpack(null)}
                  className="flex-1 px-4 py-2 rounded-lg bg-[#1C1730] border border-[#30263F] text-white text-sm font-semibold hover:border-[#762BFF] transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  className="flex-1 px-4 py-2 rounded-lg bg-[#762BFF] hover:bg-[#853CFF] text-white text-sm font-semibold transition-all disabled:opacity-50"
                >
                  {savingEdit ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
