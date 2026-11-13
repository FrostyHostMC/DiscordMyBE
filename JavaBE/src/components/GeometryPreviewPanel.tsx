import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Boxes, Crosshair, RotateCcw, TriangleAlert } from 'lucide-react';
import type { BoneInjection } from '@/utils/dynamicBoneRetargeter';
import { buildPreviewScene, listGeometryDocuments } from '@/utils/geometryPreviewScene';
import { renderGeometryPreview, type PreviewCamera } from '@/utils/geometryPreviewRender';

interface GeometryPreviewPanelProps {
  resourcePackFiles?: Record<string, string | Uint8Array> | null;
  injectedBones?: BoneInjection[] | null;
  accent: string;
}

const INITIAL_CAMERA: PreviewCamera = { yaw: -28, pitch: 16 };
const MAX_DEBUG_PIVOTS = 120;

/**
 * Model viewport for the exported pack. It reads the exact geometry that ships and overlays
 * reconstructed bone pivots from the retargeter's structural report, not guessed positions.
 */
export function GeometryPreviewPanel({ resourcePackFiles, injectedBones, accent }: GeometryPreviewPanelProps) {
  const documents = useMemo(() => listGeometryDocuments(resourcePackFiles), [resourcePackFiles]);
  const [selectedPath, setSelectedPath] = useState('');
  const [camera, setCamera] = useState<PreviewCamera>(INITIAL_CAMERA);
  const [showReconstructedPivots, setShowReconstructedPivots] = useState(true);
  const [selectedInjectedBone, setSelectedInjectedBone] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const activePath = documents.some((entry) => entry.path === selectedPath)
    ? selectedPath
    : documents[0]?.path ?? '';
  const scene = useMemo(() => {
    const document = documents.find((entry) => entry.path === activePath);
    return document ? buildPreviewScene(document.text, document.path) : null;
  }, [documents, activePath]);
  const reconstructed = useMemo(() => {
    if (!scene) return [];
    const uniqueBones = new Map<string, BoneInjection>();
    for (const injection of injectedBones ?? []) {
      if (injection.geometry === scene.identifier && !uniqueBones.has(injection.bone)) {
        uniqueBones.set(injection.bone, injection);
      }
    }
    return [...uniqueBones.values()].map((injection) => ({
      ...injection,
      node: scene.bones.find((bone) => bone.name === injection.bone) ?? null,
    }));
  }, [injectedBones, scene]);
  const selectedBone = reconstructed.some((entry) => entry.bone === selectedInjectedBone)
    ? selectedInjectedBone
    : reconstructed[0]?.bone ?? '';
  const injectedNames = showReconstructedPivots
    ? reconstructed.filter((entry) => entry.node).slice(0, MAX_DEBUG_PIVOTS).map((entry) => entry.bone)
    : [];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scene) return;
    const paint = () => renderGeometryPreview(canvas, scene, camera, accent, injectedNames, selectedBone);
    paint();
    window.addEventListener('resize', paint);
    return () => window.removeEventListener('resize', paint);
  }, [scene, camera, accent, injectedNames, selectedBone]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    setCamera((previous) => ({
      yaw: previous.yaw + deltaX * 0.6,
      pitch: Math.max(-85, Math.min(85, previous.pitch + deltaY * 0.5)),
    }));
  };
  const handlePointerUp = () => {
    dragRef.current = null;
  };
  const facts = scene
    ? [`${scene.cubes.length} cube(s)`, scene.polygons.length > 0 ? `${scene.polygons.length} polygon(s)` : null, `${scene.bones.length} bone(s)`]
        .filter(Boolean).join(' · ')
    : '';

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/55 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4" style={{ color: accent }} />
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-300">Model viewport</h3>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {reconstructed.length > 0 && (
            <button
              type="button"
              onClick={() => setShowReconstructedPivots((visible) => !visible)}
              aria-pressed={showReconstructedPivots}
              className="flex min-h-[48px] items-center gap-1.5 rounded-lg border border-violet-400/40 px-2.5 text-[11px] font-semibold text-violet-200 active:bg-violet-950/50"
            >
              <Crosshair className="h-3.5 w-3.5" />
              Pivots · {reconstructed.length}
            </button>
          )}
          <button
            type="button"
            onClick={() => setCamera(INITIAL_CAMERA)}
            className="flex min-h-[48px] items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 text-[11px] font-semibold text-slate-300 active:bg-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        </div>
      </div>

      {documents.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          No geometry has been exported yet. Convert a mod and the shipped models appear here,
          drawn from the exact files that go into the add-on.
        </p>
      ) : (
        <>
          <label className="mt-2 flex min-h-[48px] items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3">
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">Model</span>
            <select
              value={activePath}
              onChange={(event) => setSelectedPath(event.target.value)}
              className="min-h-[48px] w-full truncate bg-transparent text-xs font-semibold text-slate-100 outline-none"
            >
              {documents.map((document) => (
                <option key={document.path} value={document.path} className="bg-slate-900">
                  {document.label}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-2 overflow-hidden rounded-xl border border-slate-800 bg-[#09090D]">
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="block h-56 w-full touch-none"
              aria-label="Converted model preview with reconstructed bone pivot markers"
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1">
            <p className="font-mono text-[10px] text-slate-500">{scene?.identifier ?? activePath}</p>
            <p className="text-[10px] text-slate-500">{facts}</p>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">Drag to orbit. Purple markers show reconstructed pivots.</p>

          {reconstructed.length > 0 && (
            <div className="mt-2 rounded-xl border border-violet-400/25 bg-violet-950/10 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[10px] font-bold uppercase tracking-wide text-violet-200">Reconstructed bone pivots</h4>
                <span className="text-[10px] text-slate-400">{reconstructed.filter((entry) => entry.node).length} located</span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                Coordinates are read from the exported geometry. Select a bone to highlight its pivot; the source offset was unavailable when it was created.
              </p>
              <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                {reconstructed.slice(0, 32).map((entry) => {
                  const missing = entry.node === null;
                  return (
                    <button
                      key={`${entry.geometry}-${entry.bone}`}
                      type="button"
                      disabled={missing || !showReconstructedPivots}
                      onClick={() => setSelectedInjectedBone(entry.bone)}
                      aria-pressed={!missing && showReconstructedPivots && selectedBone === entry.bone}
                      title={entry.reason}
                      className="flex min-h-[48px] items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-2 text-left active:bg-slate-900 disabled:opacity-50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-300" />
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-[10px] font-semibold text-slate-200">{entry.bone}</span>
                          <span className="block truncate text-[9px] text-slate-500">under {entry.parent}</span>
                        </span>
                      </span>
                      <span className={`shrink-0 text-right font-mono text-[9px] ${missing ? 'text-rose-300' : 'text-violet-200'}`}>
                        {entry.node ? `pivot ${entry.node.pivot.map((value) => value.toFixed(1)).join(', ')}` : 'not found'}
                      </span>
                    </button>
                  );
                })}
              </div>
              {reconstructed.length > 32 && (
                <p className="pt-1 text-[9px] text-slate-500">Showing 32 of {reconstructed.length} pivots.</p>
              )}
              {reconstructed.some((entry) => !entry.node) && (
                <p className="mt-2 flex gap-1.5 rounded-lg border border-rose-700/40 bg-rose-950/20 p-2 text-[10px] text-rose-200">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  Some reconstructed bones are not present in this exported geometry.
                </p>
              )}
              {showReconstructedPivots && reconstructed.filter((entry) => entry.node).length > MAX_DEBUG_PIVOTS && (
                <p className="pt-1 text-[9px] text-slate-500">Canvas overlay limited to {MAX_DEBUG_PIVOTS} markers for smooth mobile rendering.</p>
              )}
            </div>
          )}

          {(scene?.emptyBones.length ?? 0) > 0 && (
            <p className="mt-2 flex gap-1.5 rounded-lg border border-amber-700/40 bg-amber-950/20 p-2 text-[11px] leading-relaxed text-amber-100">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {scene?.emptyBones.length} bone(s) declare no cube or polygon and render nothing
                (marked with a cross): {scene?.emptyBones.slice(0, 8).join(', ')}
                {(scene?.emptyBones.length ?? 0) > 8 ? ' …' : ''}
              </span>
            </p>
          )}

          {(scene?.orphanBones.length ?? 0) > 0 && (
            <p className="mt-2 rounded-lg border border-amber-700/40 bg-amber-950/20 p-2 text-[11px] leading-relaxed text-amber-100">
              Broken bone chain: {scene?.orphanBones.slice(0, 6).join(', ')}
            </p>
          )}

          {(scene?.notes.length ?? 0) > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {scene?.notes.slice(0, 4).map((note) => (
                <li key={note} className="text-[10px] leading-relaxed text-slate-500">{note}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}