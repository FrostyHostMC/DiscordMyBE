import React from 'react';
import { ArrowLeft, ShieldCheck, FileText } from 'lucide-react';

interface LegalScreenProps {
  type: 'tos' | 'privacy';
  onBack: () => void;
}

export const LegalScreen: React.FC<LegalScreenProps> = ({ type, onBack }) => {
  const isTos = type === 'tos';

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none px-4 sm:px-6 pt-4 pb-24 overflow-y-auto max-w-xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-5 pb-3 border-b border-[#30263F]/70">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#15111F] border border-[#30263F] text-[#AAA3BB] hover:text-white active:scale-95 transition-all"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-base font-bold text-white">
            {isTos ? 'Terms of Service' : 'Privacy Policy'}
          </h1>
          <p className="text-xs text-[#AAA3BB]">AutoBE Studio Guidelines</p>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] text-xs text-[#AAA3BB] leading-relaxed space-y-4">
        {isTos ? (
          <>
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <FileText className="w-4 h-4 text-[#A855F7]" />
              <span>1. Agreement to Terms</span>
            </div>
            <p>
              AutoBE is a client-side modpack tool developed by StoneByte. By using this application, you agree to comply with all applicable copyright and community guidelines established by Mojang Studios and Microsoft Corporation.
            </p>
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <FileText className="w-4 h-4 text-[#A855F7]" />
              <span>2. Minecraft Trademarks</span>
            </div>
            <p>
              Minecraft is a trademark of Mojang Synergies AB. AutoBE and StoneByte are independent utilities not officially endorsed by, affiliated with, or associated with Mojang or Microsoft.
            </p>
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <FileText className="w-4 h-4 text-[#A855F7]" />
              <span>3. Content Ownership</span>
            </div>
            <p>
              You retain all rights to original addon content you import. Respect the licenses and permissions of addon creators when redistributing combined packs.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <ShieldCheck className="w-4 h-4 text-[#A855F7]" />
              <span>1. Zero Data Collection</span>
            </div>
            <p>
              AutoBE operates 100% on-device in your browser sandbox. No files, pack contents, metadata, or telemetry are ever uploaded or transmitted to external servers.
            </p>
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <ShieldCheck className="w-4 h-4 text-[#A855F7]" />
              <span>2. Local Storage</span>
            </div>
            <p>
              Imported packs and preferences are stored exclusively on your device within browser IndexedDB and localStorage. You can clear all cached files at any time through Settings.
            </p>
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <ShieldCheck className="w-4 h-4 text-[#A855F7]" />
              <span>3. Third-Party Sharing</span>
            </div>
            <p>
              No personal data or usage metrics are shared with third parties or advertising networks.
            </p>
          </>
        )}
      </div>
    </div>
  );
};