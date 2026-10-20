import React from 'react';

interface LegalScreenProps {
  type: 'tos' | 'privacy';
  onBack: () => void;
}

export const LegalScreen: React.FC<LegalScreenProps> = ({ type, onBack }) => {
  const isTos = type === 'tos';

  return (
    <div className="flex flex-col h-full bg-[#07050F] text-white select-none px-5 pt-3 pb-24 overflow-y-auto">
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-purple-950/50 border border-purple-500/30 text-purple-200 active:scale-95"
          aria-label="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-white">
          {isTos ? 'Terms of Service' : 'Privacy Policy'}
        </h1>
      </div>

      <div className="p-4 rounded-2xl bg-[#0D091A] border border-purple-500/20 text-xs text-zinc-300 leading-relaxed space-y-4">
        {isTos ? (
          <>
            <h2 className="text-sm font-bold text-white">1. Agreement to Terms</h2>
            <p>
              AutoBE is a client-side modpack tool developed by StoneByte. By using this application, you agree to comply with all applicable copyright and community guidelines established by Mojang Studios and Microsoft Corporation.
            </p>
            <h2 className="text-sm font-bold text-white">2. Minecraft Trademarks</h2>
            <p>
              Minecraft is a trademark of Mojang Synergies AB. AutoBE and StoneByte are independent fan-made utilities not officially endorsed by, affiliated with, or associated with Mojang or Microsoft.
            </p>
            <h2 className="text-sm font-bold text-white">3. Content Ownership</h2>
            <p>
              You retain all rights to original addon content you import. Respect the licenses and permissions of addon creators when redistributing combined packs.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-sm font-bold text-white">1. Zero Data Collection</h2>
            <p>
              AutoBE operates 100% on-device in your browser. No files, pack contents, metadata, or telemetry are ever uploaded or transmitted to external servers.
            </p>
            <h2 className="text-sm font-bold text-white">2. Local Storage</h2>
            <p>
              Imported packs and preferences are stored exclusively on your device within browser IndexedDB and localStorage. You can clear all cached files at any time through Settings.
            </p>
            <h2 className="text-sm font-bold text-white">3. Third-Party Sharing</h2>
            <p>
              No personal data or usage data is shared with third parties or advertising networks.
            </p>
          </>
        )}
      </div>
    </div>
  );
};