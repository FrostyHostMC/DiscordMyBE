import assetsData from "@/config/assets";
import React from 'react';
interface SplashScreenProps {
  progress: number;
  onFinished: () => void;
}
export const SplashScreen: React.FC<SplashScreenProps> = ({
  progress,
  onFinished
}) => {
  return <div className="relative w-full h-full flex flex-col items-center justify-between p-6 overflow-hidden bg-[#07050F] select-none">
      {/* Background with nebula asset */}
      <div className="absolute inset-0 bg-cover bg-center opacity-40 mix-blend-screen pointer-events-none" style={{
      backgroundImage: `url('https://cdn.aippy.ai/asset/ded715de6f58468487e7243e4e5b7060.jpg?x-oss-process=image/format,webp')`
    }} />
      {/* Neon purple glow radial gradients */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-72 h-72 bg-purple-600/20 rounded-full blur-[90px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-64 h-64 bg-fuchsia-600/15 rounded-full blur-[80px] pointer-events-none" />

      {/* Top spacing */}
      <div className="pt-6" />

      {/* Center Hero */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-xs">
        {/* StoneByte Brand Logo */}
        <div className="relative mb-6">
          <div className="w-40 h-40 rounded-3xl overflow-hidden shadow-[0_0_35px_rgba(168,85,247,0.45)] border border-purple-500/30 p-2 bg-[#0C081A]/80 backdrop-blur-md">
            <img src={assetsData.IMAGE_DNFM} alt="StoneByte Logo" className="w-full h-full object-contain animate-pulse" />
          </div>
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-purple-900/90 border border-purple-400/40 rounded-full text-[10px] font-semibold tracking-wider text-purple-200 uppercase whitespace-nowrap shadow-sm">
            Make Modding Simple
          </div>
        </div>

        {/* Title */}
        <div className="flex items-center gap-1.5 justify-center mb-1">
          <span className="text-3xl font-black tracking-tight text-white font-mono">
            Auto<span className="text-purple-400">BE</span>
          </span>
        </div>
        <div className="text-xs font-semibold tracking-wider text-purple-300 uppercase mb-3">
          Mobile Modpack Tool
        </div>

        <p className="text-sm text-zinc-300/90 leading-relaxed font-normal px-2">
          Combine your addons. Build bigger. All on your Android device.
        </p>
      </div>

      {/* Bottom Loading Progress */}
      <div className="relative z-10 w-full max-w-xs mb-8 flex flex-col items-center">
        <div className="w-full h-2 bg-purple-950/60 rounded-full border border-purple-500/25 overflow-hidden p-0.5 shadow-[0_0_12px_rgba(147,51,234,0.3)]">
          <div className="h-full bg-gradient-to-r from-purple-500 via-fuchsia-400 to-purple-300 rounded-full transition-all duration-300" style={{
          width: `${Math.min(100, progress)}%`
        }} />
        </div>
        <div className="flex items-center justify-between w-full mt-2 text-xs text-purple-300/80 font-mono">
          <span>Loading...</span>
          <span>{Math.round(progress)}%</span>
        </div>

        {progress >= 100 && <button type="button" onClick={onFinished} className="mt-4 w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 active:scale-98 rounded-xl font-bold text-white shadow-[0_0_20px_rgba(147,51,234,0.5)] border border-purple-400/40 text-sm transition-transform">
            Enter AutoBE
          </button>}
      </div>
    </div>;
};