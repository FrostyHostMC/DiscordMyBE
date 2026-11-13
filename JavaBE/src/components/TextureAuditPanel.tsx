import assetsData from "@/config/assets";
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BedrockRemake } from '@/types/remaker';
import { buildTextureAuditGraph, type TextureAuditGraph } from '@/utils/textureAudit';
import { TextureEngineStatusPanel } from '@/components/TextureEngineStatusPanel';
const MODEL_ICON = new Image();
MODEL_ICON.src = assetsData.IMAGE_SHTS;
const TEX_ICON = new Image();
TEX_ICON.src = assetsData.IMAGE_YYYX;
const COLORS = {
  linked: '#10b981',
  orphaned: '#ef4444',
  missing: '#eab308'
} as const;
interface NodeRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
function drawGraph(canvas: HTMLCanvasElement, graph: TextureAuditGraph, rectsRef: React.RefObject<NodeRect[]>, selected: string | null, time: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 240;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const rows = Math.max(graph.models.length, graph.textures.length, 1);
  const rowH = Math.min(28, Math.max(14, (h - 12) / rows));
  const startY = Math.max(6, (h - rowH * rows) / 2);
  const nodeW = Math.floor(w * 0.4);
  const texX = Math.ceil(w * 0.56);
  const rects: NodeRect[] = [];
  const centerY = new Map<string, number>();
  const addCol = (ids: string[], x: number) => {
    ids.forEach((id, i) => {
      const y = startY + i * rowH;
      rects.push({
        id,
        x,
        y,
        w: nodeW,
        h: rowH - 4
      });
      centerY.set(id, y + (rowH - 4) / 2);
    });
  };
  addCol(graph.models.map(m => m.id), 6);
  addCol(graph.textures.map(t => t.id), texX);
  rectsRef.current = rects;
  const highlighted = new Set<string>();
  if (selected) {
    highlighted.add(selected);
    for (const link of graph.links) {
      if (link.model === selected) highlighted.add(link.texture);
      if (link.texture === selected) highlighted.add(link.model);
    }
  }
  const dim = selected ? 0.12 : 0.4;
  ctx.lineWidth = 1;
  for (const link of graph.links) {
    const active = !selected || highlighted.has(link.model) || highlighted.has(link.texture);
    ctx.strokeStyle = COLORS.linked;
    ctx.globalAlpha = active ? 0.85 : dim;
    ctx.beginPath();
    ctx.moveTo(6 + nodeW, centerY.get(link.model) ?? 0);
    ctx.lineTo(texX, centerY.get(link.texture) ?? 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const drawNode = (id: string, x: number, y: number, status: 'linked' | 'orphaned' | 'missing', icon: HTMLImageElement) => {
    const active = !selected || highlighted.has(id);
    const color = COLORS[status];
    const nodeH = rowH - 4;
    ctx.globalAlpha = active ? 1 : dim;
    ctx.fillStyle = `${color}22`;
    ctx.beginPath();
    ctx.roundRect(x, y, nodeW, nodeH, 5);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.stroke();
    if (icon.complete && icon.naturalWidth > 0) ctx.drawImage(icon, x + 4, y + (nodeH - 14) / 2, 14, 14);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '9px ui-monospace, SFMono-Regular, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, id, nodeW - 26), x + 22, y + nodeH / 2);
    if (status === 'orphaned') {
      const phase = (time / 900 % 1 + 1) % 1;
      ctx.globalAlpha = active ? (1 - phase) * 0.7 : dim * (1 - phase);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.roundRect(x - phase * 3, y - phase * 3, nodeW + phase * 6, nodeH + phase * 6, 6);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  for (const m of graph.models) drawNode(m.id, 6, centerY.get(m.id)! - (rowH - 4) / 2, m.status === 'missing' ? 'missing' : 'linked', MODEL_ICON);
  for (const t of graph.textures) drawNode(t.id, texX, centerY.get(t.id)! - (rowH - 4) / 2, t.status === 'orphaned' ? 'orphaned' : 'linked', TEX_ICON);
}
interface TextureAuditPanelProps {
  remake: BedrockRemake | null;
  accent: string;
  onReport: (lines: string[]) => void;
  playSuccess?: () => Promise<void>;
  playWarning?: () => Promise<void>;
}
export function TextureAuditPanel({
  remake,
  accent,
  onReport,
  playSuccess,
  playWarning
}: TextureAuditPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rectsRef = useRef<NodeRect[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const graph = useMemo(() => remake ? buildTextureAuditGraph(remake) : null, [remake]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) return;
    let raf = 0;
    if (graph.orphanCount > 0) {
      const loop = (t: number) => {
        drawGraph(canvas, graph, rectsRef, selected, t);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } else {
      drawGraph(canvas, graph, rectsRef, selected, 0);
    }
    return () => cancelAnimationFrame(raf);
  }, [graph, selected]);
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = rectsRef.current.find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    setSelected(hit && hit.id !== selected ? hit.id : null);
  };
  const runAudit = () => {
    if (!graph) return;
    const lines = [`[AUDIT] Texture Parity Report — mapping coverage ${graph.coverage}%`, `[AUDIT] ${graph.models.length} entity models | ${graph.textures.length} textures | ${graph.linkedCount} linked | ${graph.orphanCount} orphaned | ${graph.missingCount} missing`];
    const engine = remake?.parityHealth?.textureEngine;
    if (engine) {
      lines.push(`[AUDIT] Texture engine: ${engine.summary}.`);
      for (const repair of engine.repairedReferences) lines.push(`[AUDIT][REPAIR] ${repair.detail}`);
      for (const miss of engine.missingReferences) lines.push(`[AUDIT][UNMATCHED] ${miss.detail}`);
      for (const big of engine.oversized) lines.push(`[AUDIT][SIZE] ${big} exceeds the mobile budget — downscale or warn, never stretched silently.`);
    }
    for (const t of graph.textures) {
      if (t.status === 'orphaned') lines.push(`[AUDIT][ORPHAN] "${t.id}.png" has no parent entity model — ghost-asset risk`);
    }
    for (const m of graph.models) {
      if (m.status === 'missing') lines.push(`[AUDIT][MISSING] "${m.id}" has no texture mapping — would render invisible in game`);
    }
    const unmatched = engine?.missingReferences.length ?? 0;
    const clean = graph.orphanCount === 0 && graph.missingCount === 0 && unmatched === 0;
    if (unmatched > 0) {
      lines.push(`[AUDIT] ${unmatched} texture reference(s) could not be matched to a shipped file — the mapping is not complete.`);
    }
    lines.push(clean ? '[AUDIT] Every shipped entity texture resolves to a model and no unmatched reference remains. Structural check only — rendering is not verified in game.' : '[AUDIT] Resolve flagged assets above before .mcaddon export.');
    onReport(lines);
    if (clean) void playSuccess?.();else void playWarning?.();
  };
  if (!remake || !graph) {
    return <p className="text-xs leading-relaxed text-slate-400">
        Generate a port first — the auditor maps every compiled entity model to its texture and flags orphaned assets.
      </p>;
  }
  const selectedModel = graph.models.find(m => m.id === selected);
  const selectedTexture = graph.textures.find(t => t.id === selected);
  return <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-100">Parity Texture Auditor</h2>
        <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
            {graph.linkedCount}/{graph.models.length} linked
          </span>
          <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-red-300">
            {graph.orphanCount} orphaned
          </span>
          <span className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-yellow-300">
            {graph.missingCount} missing
          </span>
        </div>
      </div>

      <TextureEngineStatusPanel report={remake.parityHealth?.textureEngine} accent={accent} />

      <div className="relative">
        <canvas ref={canvasRef} onPointerDown={handlePointerDown} className="h-[240px] w-full touch-manipulation rounded-xl border border-slate-800 bg-slate-950" aria-label="Model-texture dependency graph" />
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col gap-0.5 text-[9px] text-slate-500">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{
            background: COLORS.linked
          }} />Linked</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{
            background: COLORS.orphaned
          }} />Orphaned</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{
            background: COLORS.missing
          }} />Missing</span>
        </div>
      </div>

      {(selectedModel || selectedTexture) && <div className="rounded-lg border p-2.5 text-[11px] leading-relaxed" style={{
      borderColor: `${accent}55`,
      background: `${accent}12`
    }}>
          {selectedModel ? selectedModel.status === 'linked' ? <span className="text-slate-200">
                Model <b>{selectedModel.id}</b> → textures: {selectedModel.textures.join(', ')}
              </span> : <span className="text-yellow-300">
                Model <b>{selectedModel.id}</b> has no texture mapping — it would render invisible.
              </span> : selectedTexture!.status === 'linked' ? <span className="text-slate-200">
              Texture <b>{selectedTexture!.id}.png</b> ← models: {selectedTexture!.models.join(', ')}
            </span> : <span className="text-red-300">
              Texture <b>{selectedTexture!.id}.png</b> is orphaned — no entity model references it.
            </span>}
        </div>}

      <button type="button" onClick={runAudit} className="flex min-h-[48px] w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg transition active:scale-[0.99]" style={{
      background: accent,
      boxShadow: `0 8px 24px -8px ${accent}88`
    }}>
        Run Quick Audit → Factual Report
      </button>

      <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] leading-relaxed">
        {graph.orphanCount === 0 && graph.missingCount === 0 ? <p className="text-emerald-300">✔ All textures mapped. No orphaned assets detected.</p> : graph.textures.filter(t => t.status === 'orphaned').map(t => <p key={t.id} className="text-red-300">ORPHAN textures/entity/{t.id}.png</p>)}
        {graph.models.filter(m => m.status === 'missing').map(m => <p key={m.id} className="text-yellow-300">MISSING textures/entity/{m.id}.png</p>)}
      </div>
    </div>;
}