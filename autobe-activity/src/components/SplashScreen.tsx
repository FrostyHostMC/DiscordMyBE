import React from 'react';
import { FolderPlus, Folder, LayoutGrid, HelpCircle, ChevronRight } from 'lucide-react';
import assetsData from '@/config/assets';

interface SplashScreenProps {
  onFinished: () => void;
  onCreateNew?: () => void;
  onBrowseTemplates?: () => void;
  onViewDocumentation?: () => void;
}

const LOGO = assetsData.IMAGE_DNFM;

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onFinished,
  onCreateNew,
  onBrowseTemplates,
  onViewDocumentation
}) => {
  return (
    <div className="relative w-full h-full overflow-y-auto bg-[#070710] select-none">
      {/* Subtle ambient purple decoration */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 40% at 50% 0%, rgba(118,43,255,0.18), transparent 70%), radial-gradient(50% 35% at 50% 45%, rgba(118,43,255,0.12), transparent 70%)'
        }}
      />

      <div className="relative flex min-h-full flex-col px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* A. Branding header */}
        <div className="flex flex-col items-center">
          <img
            src={LOGO}
            alt="AutoBE logo"
            draggable={false}
            className="h-16 w-16 object-contain rounded-2xl"
            style={{ filter: 'drop-shadow(0 0 18px rgba(118,43,255,0.45))' }}
          />
          <h1 className="mt-3 text-3xl font-black tracking-tight text-white">
            Auto<span className="text-[#762BFF]">BE</span>
          </h1>
          <p className="mt-1 text-sm text-[#A78BDB]">Build. Create. Automate.</p>
        </div>

        {/* B. Welcome section */}
        <div className="mt-6 text-center">
          <h2 className="text-2xl font-extrabold text-white">Welcome to AutoBE</h2>
          <p className="mx-auto mt-2 max-w-[34ch] text-sm leading-relaxed text-[#A78BDB]">
            Turn your ideas into Minecraft worlds with the power of automation and AI.
          </p>
        </div>

        {/* D. Primary actions */}
        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={onCreateNew ?? onFinished}
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#762BFF] to-[#A855F7] px-5 py-4 text-base font-bold text-white shadow-[0_8px_30px_rgba(118,43,255,0.45)] transition-transform duration-150 active:scale-[0.98] hover:brightness-110"
          >
            <FolderPlus className="h-5 w-5" aria-hidden="true" />
            Create New Project
            <ChevronRight className="h-5 w-5 opacity-80" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onFinished}
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-[#762BFF]/60 bg-[#0D0B19] px-5 py-4 text-base font-bold text-white transition-colors duration-150 active:scale-[0.98] hover:bg-[#12102A]"
          >
            <Folder className="h-5 w-5 text-[#A855F7]" aria-hidden="true" />
            Open Existing Project
            <ChevronRight className="h-5 w-5 opacity-50" aria-hidden="true" />
          </button>
        </div>

        {/* E. Quick access */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onBrowseTemplates ?? onFinished}
            className="rounded-2xl border border-[#762BFF]/30 bg-[#0D0B19] p-4 text-left transition-colors duration-150 active:scale-[0.98] hover:border-[#762BFF]/60"
          >
            <LayoutGrid className="h-6 w-6 text-[#A855F7]" aria-hidden="true" />
            <div className="mt-2 text-sm font-bold text-white">Templates</div>
            <div className="mt-0.5 text-xs leading-snug text-[#A78BDB]">
              Get started with pre-built templates.
            </div>
          </button>

          <button
            type="button"
            onClick={onViewDocumentation ?? onFinished}
            className="rounded-2xl border border-[#762BFF]/30 bg-[#0D0B19] p-4 text-left transition-colors duration-150 active:scale-[0.98] hover:border-[#762BFF]/60"
          >
            <HelpCircle className="h-6 w-6 text-[#A855F7]" aria-hidden="true" />
            <div className="mt-2 text-sm font-bold text-white">Help</div>
            <div className="mt-0.5 text-xs leading-snug text-[#A78BDB]">
              Documentation and support.
            </div>
          </button>
        </div>

        {/* F. Footer */}
        <div className="mt-auto pt-8 text-center">
          <p className="text-xs text-[#6B5E96]">Minecraft Development, Made Simple</p>
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;