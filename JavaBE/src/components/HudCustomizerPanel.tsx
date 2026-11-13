import assetsData from "@/config/assets";
import { useCallback, useMemo, useRef, useState } from 'react';
import { Grid3X3, Hand, Maximize2, Move, RotateCcw, Sliders, ToggleLeft, ToggleRight } from 'lucide-react';
const WEAPON_ICON = assetsData.IMAGE_GHEI;
const HUD_FRAME_ICON = assetsData.IMAGE_KNHI;
interface HudElement {
  id: string;
  label: string;
  hint: string;
  x: number; // percent of preview width
  y: number;
  scale: number; // 0.5 - 2.0
  kind: 'weapon' | 'hud' | 'spell';
}
const DEFAULT_ELEMENTS: HudElement[] = [{
  id: 'weapon_cooldown',
  label: 'Weapon Cooldown',
  hint: 'Cooldown sweep for the equipped weapon',
  x: 8,
  y: 72,
  scale: 1,
  kind: 'weapon'
}, {
  id: 'spell_bar',
  label: 'Spell Cast Bar',
  hint: 'Magic charge / cast progress indicator',
  x: 30,
  y: 84,
  scale: 1,
  kind: 'spell'
}, {
  id: 'equipment_status',
  label: 'Equipment Status',
  hint: 'Mod-specific durability & ability HUD',
  x: 8,
  y: 8,
  scale: 1,
  kind: 'hud'
}, {
  id: 'tooltip_frame',
  label: 'Mod Tooltip Frame',
  hint: 'Custom item tooltip overlay frame',
  x: 58,
  y: 12,
  scale: 1,
  kind: 'hud'
}];
const STORAGE_KEY = 'aippy.hudLayout.v1';
const SNAP = 2; // percent grid

interface Props {
  accent: string;
  hapticsEnabled: boolean;
  onApplied?: (message: string) => void;
}
function loadLayout(): HudElement[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ELEMENTS;
    const parsed = JSON.parse(raw) as Array<Partial<HudElement>>;
    return DEFAULT_ELEMENTS.map((def, i) => ({
      ...def,
      ...parsed[i]
    }));
  } catch {
    return DEFAULT_ELEMENTS;
  }
}
export function HudCustomizerPanel({
  accent,
  hapticsEnabled,
  onApplied
}: Props) {
  const [enabled, setEnabled] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [elements, setElements] = useState<HudElement[]>(loadLayout);
  const [selectedId, setSelectedId] = useState<string>('weapon_cooldown');
  const [dragging, setDragging] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(() => elements.find(el => el.id === selectedId) ?? elements[0], [elements, selectedId]);
  const buzz = useCallback((ms: number) => {
    if (hapticsEnabled && 'vibrate' in navigator) navigator.vibrate(ms);
  }, [hapticsEnabled]);
  const updateElement = useCallback((id: string, patch: Partial<HudElement>) => {
    setElements(prev => {
      const next = prev.map(el => el.id === id ? {
        ...el,
        ...patch
      } : el);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {/* ignore quota */}
      return next;
    });
  }, []);
  const onPointerDown = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedId(id);
    setDragging(true);
    buzz(12);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    let px = (e.clientX - rect.left) / rect.width * 100;
    let py = (e.clientY - rect.top) / rect.height * 100;
    px = Math.min(96, Math.max(0, px));
    py = Math.min(96, Math.max(0, py));
    if (snapToGrid) {
      px = Math.round(px / SNAP) * SNAP;
      py = Math.round(py / SNAP) * SNAP;
    }
    updateElement(selectedId, {
      x: px,
      y: py
    });
  };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    buzz(25);
    onApplied?.(`HUD element "${selected?.label}" repositioned (x:${Math.round(selected?.x ?? 0)}%, y:${Math.round(selected?.y ?? 0)}%) — synced to Bedrock UI export.`);
  };
  const resetLayout = () => {
    setElements(DEFAULT_ELEMENTS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {/* ignore */}
    buzz(30);
    onApplied?.('[HUD] Layout reset to default Bedrock anchor positions.');
  };
  return <div className="rounded-2xl border border-cyan-800/40 bg-slate-900/80 p-4 shadow-lg shadow-cyan-500/5">
      {/* Header + master toggle */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4" style={{
          color: accent
        }} />
          <h2 className="text-sm font-bold text-slate-100">HUD Customization Suite</h2>
        </div>
        <button type="button" onClick={() => {
        setEnabled(v => !v);
        buzz(15);
      }} aria-pressed={enabled} className="flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-950/60 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
          {enabled ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
          {enabled ? 'ENABLED' : 'OFF'}
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-300">
        Reposition and scale mod-specific HUD elements with a real-time interactive preview. The layout is compiled
        into the Bedrock resource pack&apos;s <span className="font-mono text-cyan-300">/ui</span> JSON definitions on export.
      </p>

      {enabled && <>
          {/* Live interactive preview with grid overlay */}
          <div ref={previewRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} className="relative mt-3 h-64 w-full touch-none overflow-hidden rounded-xl border border-slate-700 bg-gradient-to-b from-sky-950/80 via-slate-900 to-emerald-950/40" role="application" aria-label="HUD element preview area — drag elements to reposition">
            {/* Grid overlay */}
            {showGrid && <div className="pointer-events-none absolute inset-0 opacity-30" style={{
          backgroundImage: 'linear-gradient(to right, rgba(56,189,248,0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,189,248,0.25) 1px, transparent 1px)',
          backgroundSize: '8.33% 12.5%'
        }} />}
            {/* Crosshair center marker */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/30" />

            {elements.map(el => <div key={el.id} role="button" tabIndex={0} onPointerDown={e => onPointerDown(e, el.id)} onKeyDown={e => {
          const step = snapToGrid ? SNAP : 1;
          if (e.key === 'ArrowLeft') updateElement(el.id, {
            x: Math.max(0, el.x - step)
          });
          if (e.key === 'ArrowRight') updateElement(el.id, {
            x: Math.min(96, el.x + step)
          });
          if (e.key === 'ArrowUp') updateElement(el.id, {
            y: Math.max(0, el.y - step)
          });
          if (e.key === 'ArrowDown') updateElement(el.id, {
            y: Math.min(96, el.y + step)
          });
        }} className={`absolute flex cursor-grab touch-none select-none items-center gap-1.5 rounded-lg border px-2 py-1.5 backdrop-blur-none transition-shadow ${selectedId === el.id ? 'z-10 border-cyan-400 shadow-lg shadow-cyan-500/20' : 'border-slate-600/80'}`} style={{
          left: `${el.x}%`,
          top: `${el.y}%`,
          transform: `scale(${el.scale})`,
          transformOrigin: 'top left',
          background: selectedId === el.id ? 'rgba(8,47,73,0.9)' : 'rgba(15,23,42,0.85)'
        }}>
                <img src={el.kind === 'weapon' ? WEAPON_ICON : HUD_FRAME_ICON} alt="" className="pointer-events-none h-4 w-4 object-contain" draggable={false} />
                <span className="pointer-events-none whitespace-nowrap text-[9px] font-bold uppercase tracking-wide text-slate-200">
                  {el.label}
                </span>
                {el.kind === 'weapon' && <span className="pointer-events-none h-1.5 w-8 overflow-hidden rounded-full bg-slate-700">
                    <span className="block h-full w-2/3 rounded-full bg-cyan-400" />
                  </span>}
                {el.kind === 'spell' && <span className="pointer-events-none h-1.5 w-8 overflow-hidden rounded-full bg-slate-700">
                    <span className="block h-full w-1/2 rounded-full bg-violet-400" />
                  </span>}
                <Move className="pointer-events-none h-3 w-3 text-slate-500" />
              </div>)}

            {/* Snap-to-grid flash indicator */}
            {dragging && snapToGrid && <span className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-slate-950/80 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-300">
                <Grid3X3 className="mr-0.5 inline h-2.5 w-2.5" /> SNAP
              </span>}
          </div>

          {/* Selected element controls */}
          {selected && <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-200">{selected.label}</span>
                <span className="font-mono text-[10px] text-slate-400">
                  x:{Math.round(selected.x)}% · y:{Math.round(selected.y)}% · {selected.scale.toFixed(2)}x
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-slate-500">{selected.hint}</p>
              <label className="mt-2 flex items-center gap-2 text-[10px] font-semibold uppercase text-slate-400">
                <Maximize2 className="h-3 w-3" /> Scale
                <input type="range" min={0.5} max={2} step={0.05} value={selected.scale} onChange={e => updateElement(selected.id, {
            scale: Number(e.target.value)
          })} onPointerUp={() => buzz(15)} className="h-6 flex-1 accent-cyan-400" aria-label={`${selected.label} scale`} />
                <span className="w-8 text-right font-mono text-cyan-300">{selected.scale.toFixed(2)}</span>
              </label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => {
            setSnapToGrid(v => !v);
            buzz(10);
          }} aria-pressed={snapToGrid} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold ${snapToGrid ? 'border-cyan-500/50 bg-cyan-950/60 text-cyan-300' : 'border-slate-700 bg-slate-900 text-slate-400'}`}>
                  <Grid3X3 className="h-3 w-3" /> Snap to Grid {snapToGrid ? 'ON' : 'OFF'}
                </button>
                <button type="button" onClick={() => {
            setShowGrid(v => !v);
            buzz(10);
          }} aria-pressed={showGrid} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold ${showGrid ? 'border-cyan-500/50 bg-cyan-950/60 text-cyan-300' : 'border-slate-700 bg-slate-900 text-slate-400'}`}>
                  Grid Overlay {showGrid ? 'ON' : 'OFF'}
                </button>
                <button type="button" onClick={resetLayout} className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-400 hover:text-white">
                  <RotateCcw className="h-3 w-3" /> Reset Layout
                </button>
              </div>
              <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
                <Hand className="h-3 w-3" /> Drag any HUD element in the preview above (or use arrow keys) — changes are haptic-confirmed and included in the next .mcaddon export.
              </p>
            </div>}

          {/* Element selector chips */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {elements.map(el => <button key={el.id} type="button" onClick={() => {
          setSelectedId(el.id);
          buzz(10);
        }} className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${selectedId === el.id ? 'border-cyan-500/50 bg-cyan-950/60 text-cyan-300' : 'border-slate-800 bg-slate-900/70 text-slate-400'}`}>
                {el.label}
              </button>)}
          </div>
        </>}
    </div>;
}