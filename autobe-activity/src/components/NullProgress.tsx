import React from 'react';

interface NullProgressProps {
  progress: number;
  complete?: boolean;
  status?: string;
  description?: string;
  compact?: boolean;
}

export const NullProgress: React.FC<NullProgressProps> = ({
  progress,
  complete = false,
  status = 'Building your modpack...',
  description = 'Your modpack will be available in Projects when complete, or you can save it directly to your device.',
  compact = false
}) => {
  const value = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
  const finished = complete || value >= 100;

  return (
    <section className={`w-full ${compact ? 'py-2' : 'py-5'}`} aria-label={`Modpack progress: ${Math.round(value)} percent`}>
      <style>{`
        @keyframes null-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
        @keyframes null-leg-a { 0%,100% { transform: rotate(18deg) } 50% { transform: rotate(-24deg) } }
        @keyframes null-leg-b { 0%,100% { transform: rotate(-24deg) } 50% { transform: rotate(18deg) } }
        @keyframes null-arm-a { 0%,100% { transform: rotate(-24deg) } 50% { transform: rotate(28deg) } }
        @keyframes null-arm-b { 0%,100% { transform: rotate(28deg) } 50% { transform: rotate(-24deg) } }
        .null-walk { animation: null-bob .42s ease-in-out infinite; filter: drop-shadow(0 0 7px #8b35ff); }
        .null-leg-a { transform-origin: 42px 70px; animation: null-leg-a .42s ease-in-out infinite; }
        .null-leg-b { transform-origin: 42px 70px; animation: null-leg-b .42s ease-in-out infinite; }
        .null-arm-a { transform-origin: 29px 42px; animation: null-arm-a .42s ease-in-out infinite; }
        .null-arm-b { transform-origin: 53px 42px; animation: null-arm-b .42s ease-in-out infinite; }
        .null-point { filter: drop-shadow(0 0 7px #8b35ff); }
        @media (prefers-reduced-motion: reduce) {
          .null-walk,.null-leg-a,.null-leg-b,.null-arm-a,.null-arm-b { animation: none !important; }
        }
      `}</style>
      <div className={`text-center ${compact ? 'mb-1' : 'mb-3'}`}>
        <h2 className={`${compact ? 'text-sm' : 'text-xl sm:text-2xl'} font-black tracking-tight text-white`}>
          {finished ? 'Your modpack is ready!' : status}
        </h2>
        {!compact && <p className="mx-auto mt-1 max-w-md text-xs sm:text-sm leading-relaxed text-[#AAA3BB]">{finished ? 'Find it in Projects, or save it directly to your device.' : description}</p>}
      </div>

      <div className="relative mx-auto w-full max-w-2xl pt-1">
        <div
          className="pointer-events-none absolute z-10 bottom-[13px] transition-[left] duration-300 ease-out"
          style={{ left: `clamp(0px, calc(${value}% - 34px), calc(100% - 68px))` }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 84 104" width={compact ? 54 : 68} height={compact ? 67 : 86} role="img" aria-label="Purple and black Null mascot">
            <defs>
              <linearGradient id="null-purple" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#c084fc" />
                <stop offset=".55" stopColor="#7e22ce" />
                <stop offset="1" stopColor="#3b0764" />
              </linearGradient>
            </defs>
            <g className={finished ? 'null-point' : 'null-walk'}>
              <path d="M22 7 L55 3 L72 18 L68 43 L51 54 L25 48 L12 30 Z" fill="#10091d" stroke="#3b1763" strokeWidth="3"/>
              <path d="M19 12 L31 7 L27 25 L17 30 Z M57 8 L68 18 L61 23 L53 16 Z" fill="url(#null-purple)"/>
              <path d="M31 27 L43 24 L42 35 L30 37 Z M51 24 L63 22 L61 34 L50 35 Z" fill="#e879f9"/>
              <path d="M33 29 L40 27 L39 34 L32 35 Z M53 26 L60 25 L59 32 L52 33 Z" fill="#fff"/>
              <path d="M35 43 L52 40 L55 45 L39 49 Z" fill="#090512" stroke="#54218a" strokeWidth="2"/>
              <path d="M25 50 L51 49 L60 70 L54 79 L27 77 L18 66 Z" fill="#10091d" stroke="#351454" strokeWidth="3"/>
              <path d="M28 53 L37 51 L35 72 L25 69 Z M47 52 L55 57 L51 72 L43 70 Z" fill="url(#null-purple)"/>
              <path d="M38 55 L45 54 L43 65 L36 66 Z" fill="#1e1230"/>
              <g className={finished ? '' : 'null-arm-a'}>
                <path d="M25 53 L17 59 L9 75 L16 81 L29 66 Z" fill="#10091d" stroke="#3b1763" strokeWidth="3"/>
                <path d="M14 72 L21 65 L26 69 L19 78 Z" fill="url(#null-purple)"/>
              </g>
              <g className={finished ? 'null-point' : 'null-arm-b'}>
                {finished ? (
                  <g>
                    <path d="M53 54 L61 49 L72 29 L79 31 L76 42 L66 63 L57 68 Z" fill="#10091d" stroke="#4c1d75" strokeWidth="3"/>
                    <path d="M73 30 L82 27 L81 34 L75 36 Z" fill="url(#null-purple)"/>
                    <path d="M76 30 L83 28" stroke="#e9d5ff" strokeWidth="3" strokeLinecap="round"/>
                  </g>
                ) : <path d="M53 54 L62 59 L73 73 L66 81 L52 68 Z" fill="#10091d" stroke="#3b1763" strokeWidth="3"/>}
              </g>
              <g className={finished ? '' : 'null-leg-a'}>
                <path d="M28 73 L42 75 L37 91 L25 98 L17 92 L23 82 Z" fill="#10091d" stroke="#351454" strokeWidth="3"/>
                <path d="M22 89 L35 84 L33 92 L23 96 Z" fill="url(#null-purple)"/>
              </g>
              <g className={finished ? '' : 'null-leg-b'}>
                <path d="M43 74 L56 72 L61 88 L72 94 L68 101 L51 98 L42 84 Z" fill="#10091d" stroke="#351454" strokeWidth="3"/>
                <path d="M47 83 L59 81 L63 91 L51 90 Z" fill="url(#null-purple)"/>
              </g>
            </g>
          </svg>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(value)}
          className="relative h-5 overflow-hidden rounded-full border border-[#65429a] bg-[#171126] p-1 shadow-[0_0_18px_rgba(139,53,255,0.18)]"
        >
          <div className="h-full rounded-full bg-gradient-to-r from-[#6d28d9] via-[#9333ea] to-[#d8b4fe] shadow-[0_0_12px_rgba(168,85,247,0.65)] transition-[width] duration-300 ease-out" style={{ width: `${value}%` }} />
          <div className="pointer-events-none absolute inset-1 flex justify-between gap-1">
            {Array.from({ length: 12 }, (_, index) => <span key={index} className="h-full w-px bg-[#090611]/45" />)}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-[#AAA3BB]">
          <span>{finished ? 'Complete' : 'Building'}</span>
          <span className="font-bold text-white tabular-nums">{Math.round(value)}%</span>
        </div>
      </div>
    </section>
  );
};
