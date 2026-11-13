import { useEffect, useMemo, useRef, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { readPngDimensions, isVerticalAnimationStrip } from '@/utils/pngUtils';
import type { ExtractedZipEntry } from '@/utils/zip';

interface Props {
  entries: ExtractedZipEntry[];
  upscalingEnabled: boolean;
}

interface Candidate {
  path: string;
  data: Uint8Array;
  width: number;
  height: number;
}

const MAX_CANDIDATES = 6;
const THUMB_SIZE = 64;
const LEGACY_TARGET = 64;

function findLegacyTextureCandidates(entries: ExtractedZipEntry[]): Candidate[] {
  const out: Candidate[] = [];
  for (const entry of entries) {
    if (entry.isDirectory || !entry.path.toLowerCase().endsWith('.png')) continue;
    const size = readPngDimensions(entry.data);
    if (!size) continue;
    if (isVerticalAnimationStrip(entry.data)) continue;
    if (Math.min(size.width, size.height) >= LEGACY_TARGET) continue;
    if (size.width < 4 || size.height < 4) continue;
    out.push({ path: entry.path, data: entry.data, width: size.width, height: size.height });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

function decodePng(bytes: Uint8Array): Promise<ImageBitmap | null> {
  return createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/png' }))
    .then((bmp) => bmp)
    .catch(() => null);
}

function drawThumb(canvas: HTMLCanvasElement | null, bmp: ImageBitmap, nearest: boolean) {
  if (!canvas) return;
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
  const scale = Math.min(THUMB_SIZE / bmp.width, THUMB_SIZE / bmp.height);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
  ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, Math.floor((THUMB_SIZE - w) / 2), Math.floor((THUMB_SIZE - h) / 2), w, h);
  void nearest;
}

export function TexturePreviewComparison({ entries, upscalingEnabled }: Props) {
  const candidates = useMemo(() => findLegacyTextureCandidates(entries), [entries]);
  const [selected, setSelected] = useState(0);
  const originalRef = useRef<HTMLCanvasElement>(null);
  const upscaledRef = useRef<HTMLCanvasElement>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setSelected(0);
  }, [candidates]);

  useEffect(() => {
    let cancelled = false;
    const candidate = candidates[selected];
    if (!candidate) return;
    void (async () => {
      const bmp = await decodePng(candidate.data);
      if (cancelled) return;
      if (!bmp) {
        setLoadFailed(true);
        return;
      }
      setLoadFailed(false);
      drawThumb(originalRef.current, bmp, false);
      drawThumb(upscaledRef.current, bmp, true);
      bmp.close();
    })();
    return () => {
      cancelled = true;
    };
  }, [candidates, selected]);

  if (candidates.length === 0) return null;

  const candidate = candidates[selected];
  const upscaleFactor = Math.max(2, Math.floor(LEGACY_TARGET / Math.min(candidate.width, candidate.height)));

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
        <ImageIcon className="h-3.5 w-3.5 text-cyan-400" />
        Legacy texture preview &mdash; original vs. 64&times;64
      </div>
      <div className="flex items-center gap-3">
        <figure className="flex flex-col items-center gap-1">
          <canvas ref={originalRef} className="h-16 w-16 rounded-lg border border-slate-700" style={{ imageRendering: 'pixelated' }} aria-label={`Original texture ${candidate.path}`} />
          <figcaption className="text-[10px] text-slate-400">
            Original {candidate.width}&times;{candidate.height}
          </figcaption>
        </figure>
        <span className="text-slate-500" aria-hidden="true">&rarr;</span>
        <figure className="flex flex-col items-center gap-1">
          <canvas ref={upscaledRef} className="h-16 w-16 rounded-lg border border-cyan-700/60" style={{ imageRendering: 'pixelated' }} aria-label={`Upscaled texture ${candidate.path}`} />
          <figcaption className="text-[10px] text-cyan-300">
            {upscalingEnabled ? `Upscaled ${candidate.width * upscaleFactor}&times;${candidate.height * upscaleFactor}` : 'Upscaling off'}
          </figcaption>
        </figure>
        <div className="ml-auto flex max-w-[45%] flex-col gap-1">
          {candidates.map((c, i) => (
            <button
              key={c.path}
              type="button"
              onClick={() => setSelected(i)}
              className={`max-w-full truncate rounded-md px-2 py-1 text-left text-[10px] transition ${i === selected ? 'bg-cyan-950/60 text-cyan-300' : 'text-slate-400 hover:bg-slate-800'}`}
              title={c.path}
            >
              {c.path.split('/').pop()}
            </button>
          ))}
        </div>
      </div>
      {loadFailed && <p className="mt-2 text-[10px] text-amber-400">Could not decode this texture for preview.</p>}
    </div>
  );
}