import assetsData from "@/config/assets";
import React from 'react';
interface HeaderProps {
  onOpenSettings?: () => void;
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}
export const AppHeader: React.FC<HeaderProps> = ({
  onOpenSettings,
  title,
  showBack,
  onBack,
  rightAction
}) => {
  return <header className="relative z-10 flex items-center justify-between px-5 pt-3 pb-3 border-b border-purple-500/15 bg-[#0B0716]/80 backdrop-blur-md">
      {showBack ? <button type="button" onClick={onBack} className="flex items-center justify-center w-10 h-10 rounded-full bg-purple-950/40 border border-purple-500/20 text-purple-200 active:scale-95 transition-transform" aria-label="Go Back">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button> : <div className="flex items-center gap-2">
          {/* StoneByte Logo Icon */}
          <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center p-0.5 shadow-[0_0_12px_rgba(168,85,247,0.4)]">
            <img src={assetsData.IMAGE_DNFM} alt="StoneByte Logo" className="w-full h-full object-contain" />
          </div>
          <span className="font-extrabold tracking-wider text-base text-white font-mono">
            STONE<span className="text-purple-400">BYTE</span>
          </span>
        </div>}

      {title && <h1 className="text-base font-bold text-white tracking-wide truncate max-w-[180px] text-center">
          {title}
        </h1>}

      <div className="flex items-center gap-2">
        {rightAction ? rightAction : onOpenSettings ? <button type="button" onClick={onOpenSettings} className="flex items-center justify-center w-10 h-10 rounded-full bg-purple-950/40 border border-purple-500/20 text-purple-300 active:rotate-45 transition-transform" aria-label="Settings">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button> : <div className="w-10" />}
      </div>
    </header>;
};