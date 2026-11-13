import { useEffect, useRef, useState } from 'react';
import { MonitorSmartphone, Eye } from 'lucide-react';

/**
 * bedrockHudPreviewOverlay — simulated Bedrock viewport rendering the current
 * HUD layout (aippy.hudLayout.v1) in real time so users can visualize placement
 * before export. Preview simulation only — not verified in-game rendering.
 */

const STORAGE_KEY = 'aippy.hudLayout.v1';

interface LayoutEntry {
  id?: string;
  label?: string;
  x?: number;
  y?: number;
  scale?: number;
  kind?: 'weapon' | 'hud' | 'spell';
}

interface Box {
  id: string;
  label: string;
  x: number;
  y: number;
  scale: number;
  kind: string;
  w: number;
  h: number;
}

const FALLBACK: LayoutEntry[] = [
  { id: 'weapon_cooldown', label: 'Weapon Cooldown', x: 8, y: 72, scale: 1, kind: 'weapon' },
  { id: 'spell_bar', label: 'Spell Cast Bar', x: 30, y: 84, scale: 1, kind: 'spell' },
  { id: 'equipment_status', label: 'Equipment Status', x: 8, y: 8, scale: 1, kind: 'hud' },
  { id: 'tooltip_frame', label: 'Mod Tooltip Frame', x: 58, y: 12, scale: 1, kind: 'hud' }
];

function readLayout(): Box[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: LayoutEntry[] = raw ? JSON.parse(raw) : FALLBACK;
    return FALLBACK.map((def, i) => {
      const e = parsed[i] ?? def;
      const kind = e.kind ?? def.kind ?? 'hud';
      return {
        id: e.id ?? def.id ?? `el_${i}`,
        label: e.label ?? def.label ?? 'HUD Element',
        x: e.x ?? def.x ?? 0,
        y: e.y ?? def.y ?? 0,
        scale: e.scale ?? 1,
        kind,
        w: 16 * (e.scale ?? 1),
        h: 7 * (e.scale ?? 1)
      };
    });
  } catch {
    return FALLBACK.map((def, i) => ({ ...def, id: def.id ?? `el_${i}`, scale: 1, w: 16, h: 7 }));
  }
}

const KIND_COLORS: Record<string, string> = {
  weapon: '#22d3ee',
  spell: '#a78bfa',
  hud: '#34d399'
};

export function BedrockHudPreviewOverlay({ accent }: { accent: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(true);
  const [stamp, setStamp] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let t = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      t += 1;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // Simulated first-person sky + ground viewport
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#0c2a4a');
      sky.addColorStop(0.55, '#123b5e');
      sky.addColorStop(0.56, '#2f4a33');
      sky.addColorStop(1, '#1b2e1d');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Ground block texture hint
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let gy = H * 0.56 + 8; gy < H; gy += 18 * dpr) {
        for (let gx = ((gy / (18 * dpr) | 0) % 2) * 9 * dpr; gx < W; gx += 18 * dpr) {
          ctx.fillRect(gx, gy, 9 * dpr, 9 * dpr);
        }
      }
      // Sun
      ctx.fillStyle = 'rgba(250, 240, 180, 0.7)';
      ctx.beginPath();
      ctx.arc(W * 0.78, H * 0.2, 9 * dpr, 0, Math.PI * 2);
      ctx.fill();

      const layout = readLayout();
      // Live coordinate stamp (only update DOM state at low frequency)
      if (t % 20 === 0) {
        const s = layout[0];
        setStamp(`x:${Math.round(s.x)}% y:${Math.round(s.y)}%`);
      }

      // Crosshair
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 5 * dpr, H / 2);
      ctx.lineTo(W / 2 + 5 * dpr, H / 2);
      ctx.moveTo(W / 2, H / 2 - 5 * dpr);
      ctx.lineTo(W / 2, H / 2 + 5 * dpr);
      ctx.stroke();

      // Hotbar (vanilla Bedrock baseline)
      const hbW = 36 * dpr;
      const hbX = W / 2 - hbW / 2;
      const hbY = H - 14 * dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 9; i++) {
        ctx.strokeRect(hbX + i * (hbW / 9), hbY, hbW / 9, 10 * dpr);
      }

      // HUD layout elements from the customizer
      for (const el of layout) {
        const px = (el.x / 100) * W;
        const py = (el.y / 100) * H;
        const pw = (el.w / 100) * W;
        const ph = (el.h / 100) * H;
        const color = KIND_COLORS[el.kind] ?? accent;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
        ctx.strokeStyle = color;
        ctx.lineWidth = (el.id === 'weapon_cooldown' ? 1.6 : 1) * dpr;
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeRect(px, py, pw, ph);

        // kind-specific inner fill bar
        ctx.fillStyle = color;
        const frac = el.kind === 'spell' ? 0.5 + 0.1 * Math.sin(t * 0.05) : el.kind === 'weapon' ? 0.66 : 0.8;
        ctx.fillRect(px + 2 * dpr, py + ph - 4 * dpr, (pw - 4 * dpr) * frac, 2 * dpr);

        // Label + coordinates
        ctx.fillStyle = 'rgba(226, 232, 240, 0.95)';
        ctx.font = `${7 * dpr}px ui-monospace, monospace`;
        ctx.fillText(el.label.toUpperCase().slice(0, 18), px + 2 * dpr, py + ph / 2 - 1 * dpr);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
        ctx.fillText(`x:${Math.round(el.x)} y:${Math.round(el.y)} s${el.scale.toFixed(2)}`, px + 2 * dpr, py + ph - 5.5 * dpr);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [visible, accent]);

  return <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4" style={{ color: accent }} />
          <h2 className="text-sm font-bold text-slate-100">Bedrock HUD Preview</h2>
        </div>
        <button type="button" onClick={() => setVisible(v => !v)} aria-pressed={visible}
          className="flex items-center gap-1 rounded-full border border-slate-600/50 bg-slate-800/70 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
          <Eye className="h-3 w-3" /> {visible ? 'HIDE' : 'SHOW'}
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-300">
        Simulated Bedrock viewport showing your current HUD layout in real time. Move elements in the
        HUD Customization Suite below and watch them update here before export.
      </p>
      {visible && <div className="mt-3 overflow-hidden rounded-xl border border-slate-700">
          <canvas ref={canvasRef} className="block h-52 w-full" aria-label="Simulated Bedrock HUD preview viewport" />
          <div className="flex items-center justify-between bg-slate-950/80 px-2.5 py-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
              Preview simulation — not verified in-game rendering
            </span>
            <span className="font-mono text-[9px] text-slate-400">{stamp}</span>
          </div>
        </div>}
    </div>;
}