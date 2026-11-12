import React from 'react';

export type AutoBEArtKind = 'home' | 'merge' | 'community' | 'addons' | 'packs' | 'settings';

const palettes: Record<AutoBEArtKind, { a: string; b: string; glow: string }> = {
  home: { a: '#a78bfa', b: '#6d28d9', glow: '#c4b5fd' },
  merge: { a: '#c084fc', b: '#6d28d9', glow: '#a78bfa' },
  community: { a: '#67e8f9', b: '#2563eb', glow: '#a5f3fc' },
  addons: { a: '#fbbf24', b: '#b45309', glow: '#fde68a' },
  packs: { a: '#fb923c', b: '#9a3412', glow: '#fed7aa' },
  settings: { a: '#c4b5fd', b: '#6d28d9', glow: '#ddd6fe' },
};

export const AutoBEFeatureArt: React.FC<{ kind: AutoBEArtKind; size?: number; className?: string }> = ({ kind, size = 76, className = '' }) => {
  const p = palettes[kind];
  const id = `autobe-${kind}-${size}`;
  return (
    <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 96 96" fill="none" role="img">
      <defs>
        <linearGradient id={id} x1="15" y1="8" x2="78" y2="88" gradientUnits="userSpaceOnUse"><stop stopColor={p.a}/><stop offset="1" stopColor={p.b}/></linearGradient>
        <radialGradient id={id + '-glow'} cx="0" cy="0" r="1" gradientTransform="matrix(0 44 -44 0 48 43)" gradientUnits="userSpaceOnUse"><stop stopColor={p.glow} stopOpacity=".34"/><stop offset="1" stopColor={p.glow} stopOpacity="0"/></radialGradient>
        <filter id={id + '-shadow'} x="3" y="3" width="90" height="92" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="5"/></filter>
      </defs>
      <circle cx="48" cy="46" r="44" fill={`url(#${id}-glow)`}/>
      <ellipse cx="49" cy="79" rx="28" ry="7" fill="#05030B" fillOpacity=".5" filter={`url(#${id}-shadow)`}/>
      {kind === 'merge' && <>
        <path d="M17 33 48 16l31 17-31 18-31-18Z" fill={`url(#${id})`} stroke={p.glow} strokeOpacity=".75" strokeWidth="2"/>
        <path d="M17 33v30l31 18V51L17 33Z" fill={p.b}/><path d="M79 33v30L48 81V51l31-18Z" fill={p.a}/>
        <path d="m48 16 0 35M17 33l31 18 31-18" stroke="#fff" strokeOpacity=".55" strokeWidth="2"/>
        <path d="m38 42 8-5 8 5v10l-8 5-8-5V42Z" fill="#fff" fillOpacity=".9"/><path d="m46 37 8 5-8 5-8-5 8-5Z" fill="#fff"/>
        <path d="m46 47 8-5v10l-8 5V47Z" fill={p.glow}/>
      </>}
      {kind === 'community' && <>
        <path d="M12 59 48 39l36 20-36 21-36-21Z" fill="#1e3a8a" stroke={p.glow} strokeOpacity=".5"/>
        <path d="M22 53V35l15-9 15 9v18L37 62 22 53Z" fill={`url(#${id})`} stroke="#dbeafe" strokeOpacity=".6"/>
        <path d="M37 26v36M22 35l15 9 15-9" stroke="#fff" strokeOpacity=".55" strokeWidth="1.5"/>
        <path d="M52 48V30l13-8 13 8v18l-13 8-13-8Z" fill="#2563eb" stroke="#bfdbfe" strokeOpacity=".65"/>
        <path d="M65 22v34M52 30l13 8 13-8" stroke="#fff" strokeOpacity=".55" strokeWidth="1.5"/>
        <path d="M28 32h4m-4 6h4m29-5h8" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
      </>}
      {kind === 'addons' && <>
        <path d="m18 40 30-17 30 17-30 18-30-18Z" fill="#92400e" stroke={p.glow} strokeWidth="2"/>
        <path d="M18 40v27l30 17V58L18 40Z" fill="#b45309"/><path d="M78 40v27L48 84V58l30-18Z" fill="#78350f"/>
        <path d="m30 40 18-10 18 10-18 11-18-11Z" fill="#fcd34d"/><path d="M30 40v16l18 11V51L30 40Z" fill="#d97706"/><path d="M66 40v16L48 67V51l18-11Z" fill="#92400e"/>
        <path d="m41 25 7-9 7 9-7 5-7-5Z" fill={p.glow}/><path d="M48 30v-8" stroke="#fff" strokeWidth="2"/>
      </>}
      {kind === 'packs' && <>
        <path d="m14 44 34-20 34 20-34 20-34-20Z" fill="#7c2d12" stroke={p.glow} strokeWidth="2"/>
        <path d="M14 44v25l34 20V64L14 44Z" fill="#c2410c"/><path d="M82 44v25L48 89V64l34-20Z" fill="#9a3412"/>
        <path d="m28 43 20-12 20 12-20 12-20-12Z" fill="#fdba74"/><path d="M42 39h12v15H42z" fill="#7c2d12"/><path d="M48 31v8" stroke="#fff" strokeOpacity=".8" strokeWidth="2"/>
        <path d="m34 23 14-8 14 8-14 8-14-8Z" fill="#fb923c" stroke="#ffedd5" strokeOpacity=".8"/>
      </>}
      {kind === 'settings' && <>
        <path d="m48 13 8 4 2 8 7 3 8-2 6 8-4 7 1 8 6 6-4 10-8 1-6 6-1 8-10 3-5-7-8-2-7 5-8-6 1-8-4-7-8-2-1-10 7-5 2-8-4-7 6-8 8 3 7-4 3-8Z" fill={`url(#${id})`} stroke={p.glow} strokeWidth="2"/>
        <circle cx="48" cy="48" r="16" fill="#21133e" stroke="#fff" strokeOpacity=".75" strokeWidth="3"/><circle cx="48" cy="48" r="7" fill={p.glow}/>
      </>}
      {kind === 'home' && <>
        <path d="m12 46 36-30 36 30-8 9-28-23-28 23-8-9Z" fill={`url(#${id})`} stroke={p.glow} strokeWidth="2"/>
        <path d="M22 47 48 26l26 21v31H22V47Z" fill={p.b}/><path d="M22 47 48 26v52H22V47Z" fill={p.a} fillOpacity=".55"/>
        <path d="M41 55h14v23H41z" fill="#21133e" stroke={p.glow} strokeWidth="2"/><path d="M29 48h8v8h-8zm30 0h8v8h-8z" fill="#cffafe"/>
      </>}
    </svg>
  );
};

export const AutoBEWordmark: React.FC = () => (
  <div className="flex min-w-0 items-center gap-3">
    <img src="/assets/AutoBE%20Main%20Icon.gif" alt="" className="h-11 w-11 shrink-0 rounded-xl object-contain" />
    <div className="min-w-0">
      <div className="text-xl font-black tracking-tight text-white sm:text-2xl">Auto<span className="text-violet-300">BE</span></div>
      <div className="mt-0.5 text-[9px] font-semibold tracking-[.16em] text-violet-100/75 sm:text-[10px]">MERGE · CREATE · SHARE</div>
    </div>
  </div>
);
