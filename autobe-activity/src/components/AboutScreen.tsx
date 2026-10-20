import assetsData from "@/config/assets";
import React from 'react';
interface AboutScreenProps {
  onBack: () => void;
}
export const AboutScreen: React.FC<AboutScreenProps> = ({
  onBack
}) => {
  return <div className="flex flex-col h-full bg-[#07050F] text-white select-none px-6 pt-5 pb-10 justify-between">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="flex items-center justify-center w-9 h-9 rounded-full bg-purple-950/50 border border-purple-500/30 text-purple-200 active:scale-95" aria-label="Back">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs font-mono text-zinc-500">AutoBE v1.0.0</span>
      </div>

      {/* Hero Center */}
      <div className="flex flex-col items-center text-center my-auto">
        {/* Brand Logo */}
        <div className="w-32 h-32 rounded-3xl overflow-hidden shadow-[0_0_35px_rgba(168,85,247,0.5)] border border-purple-500/40 p-2 bg-[#0C081A]/90 backdrop-blur-md mb-4 animate-pulse">
          <img src={assetsData.IMAGE_DNFM} alt="StoneByte Logo" className="w-full h-full object-contain" />
        </div>

        <h1 className="text-2xl font-black text-white font-mono tracking-tight">
          STONE<span className="text-purple-400">BYTE</span>
        </h1>
        <div className="text-xs font-semibold tracking-wider text-purple-300 uppercase mt-0.5">
          AutoBE – Mobile Modpack Tool
        </div>

        <p className="text-xs text-purple-200/90 font-medium mt-3">
          More Packs. Less Conflicts.
        </p>
        <p className="text-xs text-zinc-400 mt-0.5">
          Built for the bedrock community.
        </p>

        {/* Feature Badges */}
        <div className="w-full mt-6 space-y-2.5">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-[#0D091A] border border-purple-500/20 text-left">
            <div className="w-9 h-9 rounded-xl bg-purple-950/60 border border-purple-500/30 flex items-center justify-center text-lg">
              📱
            </div>
            <div>
              <div className="text-xs font-bold text-white">Android & Mobile Native</div>
              <div className="text-[11px] text-zinc-400">100% on-device zip & json engine</div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-2xl bg-[#0D091A] border border-purple-500/20 text-left">
            <div className="w-9 h-9 rounded-xl bg-purple-950/60 border border-purple-500/30 flex items-center justify-center text-lg">
              ⚡
            </div>
            <div>
              <div className="text-xs font-bold text-white">Built by StoneByte</div>
              <div className="text-[11px] text-zinc-400">Dedicated to Bedrock modding freedom</div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-2xl bg-[#0D091A] border border-purple-500/20 text-left">
            <div className="w-9 h-9 rounded-xl bg-purple-950/60 border border-purple-500/30 flex items-center justify-center text-lg">
              💬
            </div>
            <div>
              <div className="text-xs font-bold text-white">Community Support</div>
              <div className="text-[11px] text-zinc-400">Offline-capable PWA tool</div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer credits */}
      <div className="text-center text-[10px] text-zinc-500 font-mono">
        <div>StoneByte © 2026</div>
        <div>Version 1.0.0 (Early Access)</div>
      </div>
    </div>;
};