import React, { useState, useRef } from 'react';
import {
  Wrench,
  ScrollText,
  Palette,
  UploadCloud,
  Check,
  ChevronUp,
  ChevronDown,
  Info,
  Trash2,
  SlidersHorizontal,
  Search,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  FolderOpen
} from 'lucide-react';
import { AddonPack, MergeSessionConfig } from '@/types/modpack';
import { PackInspectorModal } from './PackInspectorModal';
import { parseAddonArchive } from '@/utils/addonParser';

interface MergeWorkspaceProps {
  installedPacks: AddonPack[];
  selectedPackIds: string[];
  onTogglePack: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onStartMergeFlow: (config: MergeSessionConfig) => void;
  onImportPacks: (newPacks: AddonPack[]) => void;
  onDeletePack: (id: string) => void;
  onNavigateTab: (tab: any) => void;
}

export const MergeWorkspace: React.FC<MergeWorkspaceProps> = ({
  installedPacks,
  selectedPackIds,
  onTogglePack,
  onSelectAll,
  onClearSelection,
  onStartMergeFlow,
  onImportPacks,
  onDeletePack,
  onNavigateTab
}) => {
  // Tabs & Filters
  const [activeTab, setActiveTab] = useState<'both' | 'bp' | 'rp'>('both');
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectingPack, setInspectingPack] = useState<AddonPack | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  // Ordered pack list for merge precedence
  const [packOrder, setPackOrder] = useState<string[]>(() => installedPacks.map((p) => p.id));

  // Sync pack order when installedPacks changes
  React.useEffect(() => {
    const t = setTimeout(() => {
      setPackOrder((prev) => {
        const existing = new Set(prev);
        const incoming = installedPacks.map((p) => p.id);
        const preserved = prev.filter((id) => incoming.includes(id));
        const newlyAdded = incoming.filter((id) => !existing.has(id));
        return [...preserved, ...newlyAdded];
      });
    }, 0);
    return () => clearTimeout(t);
  }, [installedPacks]);

  // Project configuration
  const [config, setConfig] = useState<MergeSessionConfig>({
    name: `AutoBE_Bedrock_Modpack_${new Date().toLocaleDateString().replace(/\//g, '-')}`,
    description: 'Consolidated Bedrock Addon Pack merged with AutoBE Studio.',
    version: '1.0.0',
    targetEngine: '1.20.0',
    autoPrefix: true,
    generateAddon: true,
    generateSeparatePacks: true
  });

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Sort installedPacks by packOrder
  const orderedPacks = React.useMemo(() => {
    const map = new Map(installedPacks.map((p) => [p.id, p]));
    const result: AddonPack[] = [];
    for (const id of packOrder) {
      const p = map.get(id);
      if (p) result.push(p);
    }
    // Any remaining
    for (const p of installedPacks) {
      if (!packOrder.includes(p.id)) result.push(p);
    }
    return result;
  }, [installedPacks, packOrder]);

  const behaviorPacks = orderedPacks.filter((p) => p.type === 'Behavior Pack');
  const resourcePacks = orderedPacks.filter((p) => p.type === 'Resource Pack');

  const selectedBP = behaviorPacks.filter((p) => selectedPackIds.includes(p.id));
  const selectedRP = resourcePacks.filter((p) => selectedPackIds.includes(p.id));

  const handleMoveOrder = (index: number, direction: 'up' | 'down', list: AddonPack[]) => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const itemA = list[index].id;
    const itemB = list[targetIdx].id;

    setPackOrder((prev) => {
      const next = [...prev];
      const posA = next.indexOf(itemA);
      const posB = next.indexOf(itemB);
      if (posA !== -1 && posB !== -1) {
        next[posA] = itemB;
        next[posB] = itemA;
      }
      return next;
    });
  };

  const handleFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsImporting(true);
    setImportStatus(`Analyzing ${files.length} file(s)...`);
    const allParsed: AddonPack[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setImportStatus(`Parsing ${file.name}...`);
      try {
        const res = await parseAddonArchive(file, file.name);
        allParsed.push(...res.packs);
      } catch (err: any) {
        console.error('Import error:', err);
      }
    }

    if (allParsed.length > 0) {
      onImportPacks(allParsed);
      setImportStatus(`Imported ${allParsed.length} pack(s) successfully!`);
    } else {
      setImportStatus('No valid Bedrock addon manifests found.');
    }
    setIsImporting(false);
    setTimeout(() => setImportStatus(null), 3500);
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  // Render pack row
  const renderPackRow = (pack: AddonPack, index: number, list: AddonPack[]) => {
    const isSelected = selectedPackIds.includes(pack.id);
    const isBp = pack.type === 'Behavior Pack';

    return (
      <div
        key={pack.id}
        className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
          isSelected
            ? 'bg-[#15111F] border-[#762BFF]/60 shadow-[0_0_15px_rgba(118,43,255,0.15)]'
            : 'bg-[#100D18] border-[#30263F]/70 hover:border-[#30263F]'
        }`}
      >
        {/* Left: Checkbox + Icon + Info */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Custom Checkbox */}
          <button
            type="button"
            onClick={() => onTogglePack(pack.id)}
            className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all shrink-0 ${
              isSelected
                ? 'bg-[#762BFF] border-[#A855F7] shadow-[0_0_8px_rgba(118,43,255,0.6)] text-white'
                : 'border-[#30263F] bg-[#08070D] hover:border-[#762BFF]/60'
            }`}
            aria-label={`Select ${pack.name}`}
          >
            {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
          </button>

          {/* Pack Icon */}
          <div className="w-9 h-9 rounded-lg overflow-hidden bg-[#08070D] border border-[#30263F] flex items-center justify-center shrink-0">
            {pack.iconDataUrl ? (
              <img src={pack.iconDataUrl} alt="" className="w-full h-full object-cover" />
            ) : isBp ? (
              <ScrollText className="w-4 h-4 text-[#A855F7]" />
            ) : (
              <Palette className="w-4 h-4 text-[#762BFF]" />
            )}
          </div>

          {/* Details */}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-white truncate max-w-[140px] sm:max-w-[220px]">
                {pack.name}
              </span>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase font-mono ${
                  isBp
                    ? 'bg-amber-950/40 border-amber-500/30 text-amber-300'
                    : 'bg-indigo-950/40 border-indigo-500/30 text-indigo-300'
                }`}
              >
                {isBp ? 'BP' : 'RP'}
              </span>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-[#AAA3BB] mt-0.5 font-mono">
              <span>{pack.version}</span>
              <span>•</span>
              <span>{formatSize(pack.fileSize)}</span>
              {pack.hasScripts && (
                <>
                  <span>•</span>
                  <span className="text-red-400 font-semibold">Scripts</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Order controls + Inspect + Delete */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex flex-col">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => handleMoveOrder(index, 'up', list)}
              className="p-1 rounded text-[#AAA3BB] hover:text-white disabled:opacity-20 hover:bg-[#201A2E]"
              title="Move up precedence"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={index === list.length - 1}
              onClick={() => handleMoveOrder(index, 'down', list)}
              className="p-1 rounded text-[#AAA3BB] hover:text-white disabled:opacity-20 hover:bg-[#201A2E]"
              title="Move down precedence"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setInspectingPack(pack)}
            className="p-1.5 rounded-lg text-[#AAA3BB] hover:text-white hover:bg-[#201A2E] transition-colors"
            title="Inspect pack details"
          >
            <Info className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onDeletePack(pack.id)}
            className="p-1.5 rounded-lg text-[#AAA3BB] hover:text-red-400 hover:bg-[#201A2E] transition-colors"
            title="Remove from library"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  const filteredBP = behaviorPacks.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredRP = resourcePacks.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-hidden">
      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".mcpack,.mcaddon,.zip"
        onChange={handleFilesChosen}
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is standard in Chromium
        webkitdirectory="true"
        directory="true"
        onChange={handleFilesChosen}
        className="hidden"
      />

      {/* Workspace Header */}
      <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-[#30263F]/70 bg-[#100D18]">
        {/* Pipeline Stage Indicator */}
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#30263F]/50">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-[#A855F7] tracking-wider uppercase font-mono">
              PIPELINE
            </span>
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#AAA3BB]">
              <span className="text-white font-semibold">1. Import</span>
              <ArrowRight className="w-3 h-3 text-[#30263F]" />
              <span className="text-[#A855F7] font-semibold">2. Organize</span>
              <ArrowRight className="w-3 h-3 text-[#30263F]" />
              <span>3. Analyze</span>
              <ArrowRight className="w-3 h-3 text-[#30263F]" />
              <span>4. Merge</span>
              <ArrowRight className="w-3 h-3 text-[#30263F]" />
              <span>5. Export</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Ready
            </span>
            <button
              type="button"
              onClick={() => setShowConfig(!showConfig)}
              className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                showConfig
                  ? 'bg-[#762BFF] text-white border-[#A855F7]'
                  : 'bg-[#15111F] text-[#AAA3BB] border-[#30263F] hover:text-white'
              }`}
              title="Merge Configuration"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Config</span>
            </button>
          </div>
        </div>

        {/* Project Name and Quick Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Wrench className="w-4 h-4 text-[#A855F7] shrink-0" />
            <input
              type="text"
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              className="bg-transparent border-b border-transparent hover:border-[#30263F] focus:border-[#762BFF] text-sm sm:text-base font-bold text-white outline-none w-full max-w-sm truncate px-1 py-0.5"
              placeholder="Modpack Name..."
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigateTab('conflicts_tool')}
              className="px-3 py-1.5 rounded-lg bg-[#15111F] hover:bg-[#201A2E] border border-[#30263F] text-xs font-semibold text-[#AAA3BB] hover:text-white active:scale-95 transition-all"
            >
              Analyze
            </button>

            <button
              type="button"
              disabled={selectedPackIds.length === 0}
              onClick={() => onStartMergeFlow(config)}
              className="px-4 py-1.5 rounded-lg bg-[#762BFF] hover:bg-[#853CFF] disabled:opacity-40 text-xs font-bold text-white transition-all shadow-[0_0_15px_rgba(118,43,255,0.4)] active:scale-95 flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Merge ({selectedPackIds.length})</span>
            </button>
          </div>
        </div>

        {/* Status notice */}
        {importStatus && (
          <div className="mt-2.5 px-3 py-2 rounded-xl bg-[#15111F] border border-[#762BFF]/40 text-xs text-purple-200 flex items-center gap-2">
            {isImporting && (
              <div className="w-3.5 h-3.5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            )}
            <span>{importStatus}</span>
          </div>
        )}

        {/* Collapsible Merge Configuration */}
        {showConfig && (
          <div className="mt-3 p-3.5 rounded-xl bg-[#15111F] border border-[#30263F] grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs animate-in fade-in duration-150">
            <div>
              <label className="text-[10px] font-bold text-[#AAA3BB] uppercase block mb-1">
                Description
              </label>
              <input
                type="text"
                value={config.description}
                onChange={(e) => setConfig({ ...config, description: e.target.value })}
                className="w-full bg-[#100D18] border border-[#30263F] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#762BFF]"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#AAA3BB] uppercase block mb-1">
                Target Bedrock Engine
              </label>
              <select
                value={config.targetEngine}
                onChange={(e) => setConfig({ ...config, targetEngine: e.target.value })}
                className="w-full bg-[#100D18] border border-[#30263F] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#762BFF]"
              >
                <option value="1.20.0">Minecraft Bedrock 1.20+</option>
                <option value="1.21.0">Minecraft Bedrock 1.21+</option>
                <option value="1.21.50">Minecraft Bedrock 1.21.50 (Latest)</option>
              </select>
            </div>

            <div className="flex items-center justify-between sm:col-span-2 pt-1 border-t border-[#30263F]/50">
              <span className="text-[11px] text-[#AAA3BB]">
                Automatic Identifier Conflict Resolution (Auto-Prefix)
              </span>
              <input
                type="checkbox"
                checked={config.autoPrefix}
                onChange={(e) => setConfig({ ...config, autoPrefix: e.target.checked })}
                className="rounded accent-[#762BFF]"
              />
            </div>
          </div>
        )}
      </div>

      {/* Filter and Selection Strip */}
      <div className="px-4 sm:px-6 py-2.5 bg-[#100D18]/60 border-b border-[#30263F]/50 flex flex-wrap items-center justify-between gap-2">
        {/* Pack Type Tabs */}
        <div className="flex p-0.5 bg-[#15111F] rounded-lg border border-[#30263F]">
          <button
            type="button"
            onClick={() => setActiveTab('both')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'both' ? 'bg-[#762BFF] text-white' : 'text-[#AAA3BB] hover:text-white'
            }`}
          >
            All ({installedPacks.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bp')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'bp' ? 'bg-[#762BFF] text-white' : 'text-[#AAA3BB] hover:text-white'
            }`}
          >
            BP ({selectedBP.length}/{behaviorPacks.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rp')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'rp' ? 'bg-[#762BFF] text-white' : 'text-[#AAA3BB] hover:text-white'
            }`}
          >
            RP ({selectedRP.length}/{resourcePacks.length})
          </button>
        </div>

        {/* Search Input + Select All */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#AAA3BB] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search packs..."
              className="bg-[#15111F] border border-[#30263F] rounded-lg pl-8 pr-2.5 py-1 text-xs text-white placeholder-[#716885] outline-none focus:border-[#762BFF] w-32 sm:w-44"
            />
          </div>

          <button
            type="button"
            onClick={
              selectedPackIds.length === installedPacks.length && installedPacks.length > 0
                ? onClearSelection
                : onSelectAll
            }
            className="text-xs font-semibold text-[#A855F7] hover:text-[#C9A9FF] px-2 py-1"
          >
            {selectedPackIds.length === installedPacks.length && installedPacks.length > 0
              ? 'Deselect All'
              : 'Select All'}
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#15111F] hover:bg-[#201A2E] border border-[#30263F] text-xs font-bold text-white transition-all active:scale-95"
            title="Import Addon Archives (.mcpack, .mcaddon, .zip)"
          >
            <UploadCloud className="w-3.5 h-3.5 text-[#A855F7]" />
            <span className="hidden xs:inline">Import</span>
          </button>
        </div>
      </div>

      {/* Main Content Area: Responsive Dual Columns or Tabbed Lists */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24">
        {installedPacks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center max-w-sm mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-[#15111F] border border-[#30263F] flex items-center justify-center mb-4">
              <UploadCloud className="w-7 h-7 text-[#A855F7]" />
            </div>
            <h3 className="text-base font-bold text-white">No Addons in Workspace</h3>
            <p className="text-xs text-[#AAA3BB] mt-1.5 leading-relaxed">
              Import behavior and resource packs (.mcpack, .mcaddon, .zip) to organize and consolidate them.
            </p>
            <div className="flex gap-2.5 mt-5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-[#762BFF] hover:bg-[#853CFF] text-white text-xs font-bold shadow-[0_0_15px_rgba(118,43,255,0.4)] active:scale-95 transition-all"
              >
                Choose Files
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-[#15111F] hover:bg-[#201A2E] text-white border border-[#30263F] text-xs font-semibold active:scale-95 transition-all"
              >
                Choose Folder
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Behavior Packs Column */}
            {(activeTab === 'both' || activeTab === 'bp') && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between pb-1.5 border-b border-[#30263F]/50">
                  <div className="flex items-center gap-2">
                    <ScrollText className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Behavior Packs
                    </span>
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-amber-950/40 border border-amber-500/30 text-amber-300">
                      {selectedBP.length} / {behaviorPacks.length}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#AAA3BB] font-mono">Limit: 100</span>
                </div>

                <div className="space-y-2">
                  {filteredBP.length === 0 ? (
                    <div className="p-6 rounded-xl bg-[#100D18] border border-[#30263F]/60 text-center text-xs text-[#AAA3BB]">
                      No behavior packs match your filter.
                    </div>
                  ) : (
                    filteredBP.map((p, idx) => renderPackRow(p, idx, behaviorPacks))
                  )}
                </div>
              </div>
            )}

            {/* Resource Packs Column */}
            {(activeTab === 'both' || activeTab === 'rp') && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between pb-1.5 border-b border-[#30263F]/50">
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Resource Packs
                    </span>
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-indigo-950/40 border border-indigo-500/30 text-indigo-300">
                      {selectedRP.length} / {resourcePacks.length}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#AAA3BB] font-mono">Limit: 100</span>
                </div>

                <div className="space-y-2">
                  {filteredRP.length === 0 ? (
                    <div className="p-6 rounded-xl bg-[#100D18] border border-[#30263F]/60 text-center text-xs text-[#AAA3BB]">
                      No resource packs match your filter.
                    </div>
                  ) : (
                    filteredRP.map((p, idx) => renderPackRow(p, idx, resourcePacks))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating Bottom Bar for Small Displays */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 p-3 bg-[#100D18]/95 backdrop-blur-md border-t border-[#30263F] z-20 flex items-center justify-between gap-3">
        <div className="text-xs">
          <span className="text-[#AAA3BB]">Selected: </span>
          <span className="font-bold text-white font-mono">{selectedPackIds.length} packs</span>
        </div>
        <button
          type="button"
          disabled={selectedPackIds.length === 0}
          onClick={() => onStartMergeFlow(config)}
          className="flex-1 max-w-[200px] py-2.5 rounded-xl bg-[#762BFF] hover:bg-[#853CFF] disabled:opacity-40 text-xs font-bold text-white transition-all shadow-[0_0_15px_rgba(118,43,255,0.4)] active:scale-95 flex items-center justify-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Start Merge</span>
        </button>
      </div>

      {/* Inspector Modal */}
      {inspectingPack && (
        <PackInspectorModal pack={inspectingPack} onClose={() => setInspectingPack(null)} />
      )}
    </div>
  );
};