import React, { useState, useEffect } from 'react';
import {
  Globe,
  Download,
  ArrowLeft,
  Clock,
  Box,
  User,
  Loader2,
  ExternalLink
} from 'lucide-react';
import { CommunityModpack } from '@/types/modpack';

interface CommunityModpacksScreenProps {
  onBack: () => void;
  onDownload: (modpack: CommunityModpack) => void;
}

export const CommunityModpacksScreen: React.FC<CommunityModpacksScreenProps> = ({
  onBack,
  onDownload
}) => {
  const [modpacks, setModpacks] = useState<CommunityModpack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCommunityModpacks();
  }, []);

  const fetchCommunityModpacks = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/community-modpacks');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch community modpacks');
      }

      setModpacks(data.modpacks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load community modpacks');
    } finally {
      setLoading(false);
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
            </div>
          ))
        )}
      </div>
    </div>
  );
};
