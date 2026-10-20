import React from 'react';
import { TabType } from '@/types/modpack';

interface HomeScreenProps {
  onStartCreate: () => void;
  onNavigateTab: (tab: TabType) => void;
  onOpenAbout: () => void;
  modpackCount: number;
  libraryCount: number;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onStartCreate,
  onNavigateTab,
  onOpenAbout,
  modpackCount,
  libraryCount
}) => {
  return (
    <div className="flex flex-col gap-5 px-5 pt-4 pb-24">
      {/* Brand Hero Greeting */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-1.5 font-mono">
              Auto<span className="text-purple-400">BE</span>
            </h1>
            <p className="text-xs text-purple-300 font-medium">Mobile Modpack Tool</p>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-purple-950/70 text-purple-300 border border-purple-500/30">
            v1.0.0 EA
          </span>
        </div>
        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
          Merge your behavior packs and resource packs into one clean, working modpack. No PC needed.
        </p>
      </div>

      {/* Primary Action Button: "Create New Modpack" */}
      <button
        type="button"
        onClick={onStartCreate}
        className="group relative flex items-center justify-between w-full p-4 rounded-2xl bg-gradient-to-r from-purple-700 via-purple-600 to-indigo-600 border border-purple-400/40 shadow-[0_0_24px_rgba(147,51,234,0.45)] text-left active:scale-[0.98] transition-all"
      >
        <div className="flex items-center gap-3.5">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/15 text-white backdrop-blur-sm border border-white/20 shadow-inner">
            <svg className="w-6 h-6 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div>
            <div className="text-base font-extrabold text-white tracking-wide">
              Create New Modpack
            </div>
            <div className="text-xs text-purple-200/90 font-medium">
              Start merging your addons
            </div>
          </div>
        </div>
        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white group-hover:translate-x-0.5 transition-transform">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>

      {/* Navigation Rows (Cards with 1px purple border) */}
      <div className="flex flex-col gap-2.5">
        {/* My Modpacks Row */}
        <button
          type="button"
          onClick={() => onNavigateTab('mypacks')}
          className="flex items-center justify-between p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 hover:border-purple-500/40 active:scale-[0.99] transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-purple-950/60 border border-purple-500/30 text-purple-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div className="text-left">
              <div className="text-sm font-bold text-white">My Modpacks</div>
              <div className="text-xs text-zinc-400">
                View and manage your packs ({modpackCount})
              </div>
            </div>
          </div>
          <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Addons Library Row */}
        <button
          type="button"
          onClick={() => onNavigateTab('library')}
          className="flex items-center justify-between p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 hover:border-purple-500/40 active:scale-[0.99] transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-purple-950/60 border border-purple-500/30 text-purple-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="text-left">
              <div className="text-sm font-bold text-white">Addons Library</div>
              <div className="text-xs text-zinc-400">
                Browse installed addons ({libraryCount})
              </div>
            </div>
          </div>
          <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Settings Row */}
        <button
          type="button"
          onClick={() => onNavigateTab('settings')}
          className="flex items-center justify-between p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 hover:border-purple-500/40 active:scale-[0.99] transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-purple-950/60 border border-purple-500/30 text-purple-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="text-left">
              <div className="text-sm font-bold text-white">Settings</div>
              <div className="text-xs text-zinc-400">
                App preferences & info
              </div>
            </div>
          </div>
          <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Promo Card: "More Packs. Less Conflicts." */}
      <button
        type="button"
        onClick={onOpenAbout}
        className="relative overflow-hidden flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-[#170E33] to-[#120B24] border border-purple-500/30 shadow-[0_0_20px_rgba(124,58,237,0.15)] active:scale-[0.99] transition-transform text-left"
      >
        <div className="z-10 flex flex-col">
          <span className="text-sm font-bold text-white">More Packs.</span>
          <span className="text-sm font-bold text-purple-300">Less Conflicts.</span>
          <span className="text-[11px] text-zinc-400 mt-1">StoneByte Bedrock Engine</span>
        </div>

        {/* 3D Glowing Cube Preview */}
        <div className="z-10 flex items-center gap-3">
          <div className="relative w-12 h-12 rounded-xl bg-purple-950/80 border border-purple-400/40 flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.5)]">
            <span className="text-xl">📦</span>
          </div>
          <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>

        {/* Ambient glow */}
        <div className="absolute right-0 top-0 bottom-0 w-32 bg-purple-600/15 blur-xl pointer-events-none" />
      </button>
    </div>
  );
};