import React, { useState } from 'react';
import { FileCode2, History, CheckCircle2, Info, AlertTriangle, Trash2, ArrowUpRight } from 'lucide-react';
import { MergedModpack } from '@/types/modpack';

interface LogsScreenProps {
  modpacks: MergedModpack[];
  onSelectModpack: (mp: MergedModpack) => void;
  onClearLogs?: () => void;
}

export const LogsScreen: React.FC<LogsScreenProps> = ({ modpacks, onSelectModpack }) => {
  const [filter, setFilter] = useState<'all' | 'merges' | 'system'>('all');

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-y-auto p-4 sm:p-6 pb-24 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#30263F]/70">
        <div>
          <div className="flex items-center gap-2">
            <FileCode2 className="w-5 h-5 text-[#A855F7]" />
            <h1 className="text-base sm:text-lg font-bold text-white">Event Logs & Merge History</h1>
          </div>
          <p className="text-xs text-[#AAA3BB] mt-0.5">
            Real execution telemetry, pack builds, and operation logs
          </p>
        </div>

        <div className="flex p-0.5 bg-[#15111F] rounded-lg border border-[#30263F] text-xs">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 rounded-md font-semibold ${
              filter === 'all' ? 'bg-[#762BFF] text-white' : 'text-[#AAA3BB] hover:text-white'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilter('merges')}
            className={`px-2.5 py-1 rounded-md font-semibold ${
              filter === 'merges' ? 'bg-[#762BFF] text-white' : 'text-[#AAA3BB] hover:text-white'
            }`}
          >
            Builds
          </button>
        </div>
      </div>

      <div className="space-y-2.5">
        {modpacks.length === 0 ? (
          <div className="p-12 text-center text-xs text-[#AAA3BB]">
            No merge events logged yet. Completed merges will record build logs here.
          </div>
        ) : (
          modpacks.map((mp) => (
            <div
              key={mp.id}
              className="p-3.5 rounded-xl bg-[#100D18] border border-[#30263F] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="flex items-start gap-3 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-white truncate">{mp.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-950/40 border border-emerald-500/30 text-emerald-300">
                      SUCCESS
                    </span>
                  </div>
                  <p className="text-[11px] text-[#AAA3BB] mt-0.5">
                    Consolidated {mp.totalPacks} packs into {mp.outputFileName}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
                <span className="text-[10px] font-mono text-[#716885]">
                  {formatDate(mp.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectModpack(mp)}
                  className="px-2.5 py-1 rounded-lg bg-[#15111F] hover:bg-[#201A2E] border border-[#30263F] text-xs font-semibold text-white flex items-center gap-1"
                >
                  <span>Inspect</span>
                  <ArrowUpRight className="w-3 h-3 text-[#AAA3BB]" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};