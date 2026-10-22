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
  X
} from 'lucide-react';
import { CommunityModpack } from '@/types/modpack';

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
  const [editForm, setEditForm] = useState({ name: '', description: '', version: '' });

  useEffect(() => {
    fetchCommunityModpacks();
  }, []);

  const fetchCommunityModpacks = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/community-modpacks');
      const data = await response.json();

      console.log('Community modpacks response:', data);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch community modpacks');
      }

      setModpacks(data.modpacks || []);
    } catch (err) {
      console.error('Failed to fetch community modpacks:', err);
      setError(err instanceof Error ? err.message : 'Failed to load community modpacks');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (modpack: CommunityModpack) => {
    if (!currentUserId) return;
    if (!confirm(`Are you sure you want to delete "${modpack.name}"?`)) return;

    try {
      const response = await fetch(`/api/community-modpacks?id=${modpack.id}&author_id=${currentUserId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete modpack');
      }

      // Refresh the list
      await fetchCommunityModpacks();
    } catch (err) {
      console.error('Failed to delete modpack:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete modpack');
    }
  };

  const handleEdit = (modpack: CommunityModpack) => {
    setEditingModpack(modpack);
    setEditForm({
      name: modpack.name,
      description: modpack.description,
      version: modpack.version
    });
  };

  const handleSaveEdit = async () => {
    if (!editingModpack || !currentUserId) return;

    try {
      const response = await fetch(`/api/community-modpacks?id=${editingModpack.id}&author_id=${currentUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update modpack');
      }

      // Refresh the list
      await fetchCommunityModpacks();
      setEditingModpack(null);
    } catch (err) {
      console.error('Failed to update modpack:', err);
      alert(err instanceof Error ? err.message : 'Failed to update modpack');
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-[#30263F]/70 bg-[#100D18]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#15111F] border border-[#30263F] text-[#AAA3BB] hover:text-white active:scale-95 transition-all"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-sm sm:text-base font-bold text-white tracking-wide">
            Community Modpacks
          </h1>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 pb-28 max-w-3xl mx-auto w-full">
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
              onClick={fetchCommunityModpacks}
              className="mt-4 px-4 py-2 bg-[#762BFF] hover:bg-[#853CFF] rounded-lg font-bold text-xs text-white active:scale-95 transition-all"
            >
              Retry
            </button>
          </div>
        ) : modpacks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Globe className="w-12 h-12 text-[#30263F] mb-3" />
            <p className="text-sm font-semibold text-white">No community modpacks yet</p>
            <p className="text-xs text-[#AAA3BB] mt-1 max-w-xs">
              Be the first to publish a modpack for the community!
            </p>
          </div>
        ) : (
          modpacks.map((modpack) => (
            <div
              key={modpack.id}
              className="p-4 rounded-xl border border-[#30263F] bg-[#100D18] hover:border-[#762BFF]/40 transition-all"
            >
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className="w-14 h-14 rounded-lg overflow-hidden bg-[#08070D] border border-[#30263F] flex items-center justify-center shrink-0">
                  {modpack.icon_data_url ? (
                    <img src={modpack.icon_data_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Box className="w-6 h-6 text-[#762BFF]" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">{modpack.name}</h3>
                  <p className="text-xs text-[#AAA3BB] mt-1 line-clamp-2">{modpack.description}</p>

                  <div className="flex items-center gap-3 mt-2 text-[10px] text-[#AAA3BB]">
                    <div className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      <span className="font-semibold">{modpack.author}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{formatDate(modpack.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Download className="w-3 h-3" />
                      <span>{modpack.downloads} downloads</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-2 text-[10px] text-[#AAA3BB]">
                    <span className="font-mono">{modpack.version}</span>
                    <span>•</span>
                    <span>{modpack.total_packs} packs</span>
                    <span>•</span>
                    <span>{formatSize(modpack.size)}</span>
                  </div>
                </div>
              </div>

              {/* Download Button */}
              <button
                type="button"
                onClick={() => onDownload(modpack)}
                className="mt-3 w-full px-4 py-2 rounded-lg bg-[#762BFF] hover:bg-[#853CFF] font-bold text-xs text-white flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                <Download className="w-4 h-4" />
                Download Modpack
              </button>

              {/* Owner Actions */}
              {currentUserId && modpack.author_id === currentUserId && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(modpack)}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#1C1730] border border-[#30263F] hover:border-[#762BFF] text-[10px] text-[#AAA3BB] flex items-center justify-center gap-1 transition-all"
                  >
                    <Edit className="w-3 h-3" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(modpack)}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#1C1730] border border-[#30263F] hover:border-[#EF4444] text-[10px] text-[#AAA3BB] hover:text-[#EF4444] flex items-center justify-center gap-1 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Edit Modal */}
      {editingModpack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="w-full max-w-md bg-[#100D18] border border-[#30263F] rounded-xl p-6">
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
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-[#08070D] border border-[#30263F] text-white text-sm focus:border-[#762BFF] focus:outline-none transition-colors resize-none"
                />
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
                  className="flex-1 px-4 py-2 rounded-lg bg-[#762BFF] hover:bg-[#853CFF] text-white text-sm font-semibold transition-all"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
