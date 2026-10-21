import React, { useState, useEffect } from 'react';
import { FileCode2, History, CheckCircle2, Info, AlertTriangle, Trash2, ArrowUpRight, XCircle } from 'lucide-react';
import { MergedModpack } from '@/types/modpack';
import { mergeLogger, MergeLogEntry } from '@/utils/mergeLogger';

interface LogsScreenProps {
  modpacks: MergedModpack[];
  onSelectModpack: (mp: MergedModpack) => void;
  onClearLogs?: () => void;
}

export const LogsScreen: React.FC<LogsScreenProps> = ({ modpacks, onSelectModpack }) => {
  const [filter, setFilter] = useState<'all' | 'merges' | 'errors'>('all');
  const [logs, setLogs] = useState<MergeLogEntry[]>([]);

  useEffect(() => {
    // Subscribe to merge logger updates
    const unsubscribe = mergeLogger.subscribe((log) => {
      setLogs(mergeLogger.getLogs());
    });

    // Load initial logs
    setLogs(mergeLogger.getLogs());

    return unsubscribe;
  }, []);

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    if (filter === 'errors') return log.type === 'error';
    if (filter === 'merges') return log.type === 'success' || log.type === 'error';
    return true;
  });

  const getLogIcon = (type: MergeLogEntry['type']) => {
    switch (type) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-400" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      default: return <Info className="w-4 h-4 text-blue-400" />;
    }
  };

  const getLogColor = (type: MergeLogEntry['type']) => {
    switch (type) {
      case 'success': return 'border-emerald-500/30 bg-emerald-950/20';
      case 'error': return 'border-red-500/30 bg-red-950/20';
      case 'warning': return 'border-amber-500/30 bg-amber-950/20';
      default: return 'border-blue-500/30 bg-blue-950/20';
    }
  };

  const handleClearLogs = () => {
    mergeLogger.clear();
    setLogs([]);
  };

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

        <div className="flex items-center gap-2">
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
              onClick={() => setFilter('errors')}
              className={`px-2.5 py-1 rounded-md font-semibold ${
                filter === 'errors' ? 'bg-[#762BFF] text-white' : 'text-[#AAA3BB] hover:text-white'
              }`}
            >
              Errors
            </button>
          </div>
          {logs.length > 0 && (
            <button
              type="button"
              onClick={handleClearLogs}
              className="p-2 rounded-lg bg-[#15111F] hover:bg-[#201A2E] border border-[#30263F] text-[#AAA3BB] hover:text-white"
              title="Clear logs"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-xs text-[#AAA3BB]">
            {filter === 'errors' ? 'No errors logged yet.' : 'No merge events logged yet. Completed merges will record build logs here.'}
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              className={`p-3.5 rounded-xl border ${getLogColor(log.type)} flex flex-col gap-2 text-xs`}
            >
              <div className="flex items-start gap-3">
                {getLogIcon(log.type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-white">{log.message}</span>
                    <span className="text-[10px] font-mono text-[#716885]">
                      {formatTime(log.timestamp)}
                    </span>
                  </div>
                  {log.details && (
                    <p className="text-[11px] text-[#AAA3BB] mt-1 break-all font-mono">
                      {log.details}
                    </p>
                  )}
                  {log.packCount !== undefined && (
                    <p className="text-[10px] text-[#AAA3BB] mt-1">
                      {log.packCount} pack{log.packCount !== 1 ? 's' : ''} merged
                    </p>
                  )}
                  {log.packNames && log.packNames.length > 0 && (
                    <p className="text-[10px] text-[#AAA3BB] mt-0.5 truncate">
                      {log.packNames.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Also show completed modpacks */}
      {filter !== 'errors' && modpacks.length > 0 && (
        <>
          <div className="mt-6 pt-4 border-t border-[#30263F]/70">
            <h2 className="text-sm font-bold text-white mb-3">Completed Merges</h2>
            <div className="space-y-2.5">
              {modpacks.map((mp) => (
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
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};