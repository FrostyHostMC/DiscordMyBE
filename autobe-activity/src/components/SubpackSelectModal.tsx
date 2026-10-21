import React, { useState } from 'react';
import { Layers, AlertTriangle, X } from 'lucide-react';
import { AddonPack } from '@/types/modpack';

interface SubpackSelectModalProps {
  packs: AddonPack[];
  onConfirm: (selections: Record<string, string>) => void;
  onCancel: () => void;
}

/**
 * Port of AutoBE._show_subpack_selection — one screen to pick a variant for
 * every selected pack that declares subpacks before the merge begins.
 */
export const SubpackSelectModal: React.FC<SubpackSelectModalProps> = ({
  packs,
  onConfirm,
  onCancel
}) => {
  const [selections, setSelections] = useState<Record<string, string>>({});

  const confirm = () => {
    // Validate that all packs have a selection
    const missing = packs.filter(p => !selections[p.id]);
    if (missing.length > 0) {
      alert(`Please select a variant for ${missing.length} pack(s) before continuing.`);
      return;
    }
    onConfirm(selections);
  };

  const allSelected = packs.every(p => selections[p.id]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#100D18] border border-[#762BFF]/60 rounded-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="h-1 bg-[#762BFF] shrink-0" />
        <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Layers className="w-5 h-5 text-[#A855F7] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate">Select Pack Variants</h2>
              <p className="text-[11px] text-[#AAA3BB]">
                Some addons include multiple variants — choose one per pack.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-[#AAA3BB] hover:text-white p-1"
            aria-label="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-3">
          {packs.map((p) => (
            <div
              key={p.id}
              className="rounded-xl bg-[#15111F] border border-[#30263F] p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-white truncate">{p.name}</p>
                {!selections[p.id] && (
                  <span className="text-[10px] text-amber-400 font-medium">Select one</span>
                )}
              </div>
              <div className="space-y-1.5">
                {(p.subpacks || []).map((sp) => {
                  const active = selections[p.id] === sp.folder;
                  return (
                    <button
                      key={sp.folder}
                      type="button"
                      onClick={() => setSelections((prev) => ({ ...prev, [p.id]: sp.folder }))}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs border transition-colors ${
                        active
                          ? 'bg-[#762BFF] border-[#A855F7] text-white font-bold'
                          : 'bg-[#0A0A12] border-[#30263F] text-[#AAA3BB] hover:border-[#762BFF]/60'
                      }`}
                    >
                      {sp.name}
                      <span className="block text-[10px] opacity-70 font-mono">{sp.folder}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex items-start gap-2 text-[10px] text-[#716885] pb-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span>
              Only the chosen variant is packed into the merged output; other variants are
              excluded to avoid duplicate content.
            </span>
          </div>
        </div>

        <div className="flex gap-2.5 px-5 py-4 border-t border-[#30263F] shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl bg-[#15111F] border border-[#30263F] text-xs font-semibold text-[#AAA3BB] hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!allSelected}
            className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-bold active:scale-[0.98] transition-colors ${
              allSelected
                ? 'bg-[#762BFF] text-white hover:bg-[#8A4DFF]'
                : 'bg-[#30263F] text-[#AAA3BB] cursor-not-allowed'
            }`}
          >
            Continue Merge
          </button>
        </div>
      </div>
    </div>
  );
};