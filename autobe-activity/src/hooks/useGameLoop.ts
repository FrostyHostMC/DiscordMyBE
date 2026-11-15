import { useRef, useEffect, useCallback } from 'react';
import { useCanvasDPI } from '@/hooks/useCanvasDPI';
import { drawBackground } from '@/utils/drawHelpers';

export interface GameLoopContext {
  /** Logical width (>= 400). Use for positioning — never hardcode 400. */
  width: number;
  /** Logical height (>= 600). Use for positioning — never hardcode 600. */
  height: number;
  /** Seconds since last frame (capped at 0.05s). Multiply all motion by this. */
  deltaTime: number;
  /** Total elapsed seconds since loop started. */
  elapsed: number;
}

export interface UseGameLoopOptions {
  width: number;
  height: number;
  maxFPS?: number;
  /** Design-space width. Defaults to 400. Set 0 to disable design scaling. */
  designWidth?: number;
  /** Design-space height. Defaults to 600 when designWidth is active. */
  designHeight?: number;
}

export interface UseGameLoopReturn {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  /** Logical width (>= 400). Use for game-state init outside the loop. */
  logicalWidth: number;
  /** Logical height (>= 600). Use for game-state init outside the loop. */
  logicalHeight: number;
  /** Maps pointer clientX/Y to logical coords. Use instead of manual `e.clientX - rect.left`. */
  getLogicalCoords: (e: { clientX: number; clientY: number }) => { x: number; y: number } | null;
}

/**
 * Game loop with rAF, delta-time, HiDPI, and design-resolution scaling.
 * scale = min(w/designWidth, h/designHeight) — expand mode, no black bars.
 * @param backgroundImage Auto-rendered full-canvas background (object-cover)
 *   before each draw call. Do NOT draw backgrounds inside the draw callback.
 */
export function useGameLoop(
  options: UseGameLoopOptions,
  update: (ctx: GameLoopContext) => void,
  draw: (canvasCtx: CanvasRenderingContext2D, ctx: GameLoopContext) => void,
  backgroundImage?: HTMLImageElement | string | null,
): UseGameLoopReturn {
  const { width, height, maxFPS = 60, designWidth = 400 } = options;
  const { canvasRef, getContext2D } = useCanvasDPI({ width, height });

  const useDesignScale = designWidth > 0 && width > 0;
  const designHeight = options.designHeight ?? (useDesignScale ? 600 : undefined);
  const scaleW = useDesignScale ? width / designWidth : 1;
  const scaleH = (designHeight != null && designHeight > 0 && height > 0) ? height / designHeight : Infinity;
  const scale = Math.min(scaleW, scaleH);
  const logicalWidth = useDesignScale ? width / scale : width;
  const logicalHeight = useDesignScale ? height / scale : height;

  const updateRef = useRef(update);
  const drawRef = useRef(draw);
  const bgRef = useRef<HTMLImageElement | string | null>(backgroundImage ?? null);
  useEffect(() => { updateRef.current = update; }, [update]);
  useEffect(() => { drawRef.current = draw; }, [draw]);
  useEffect(() => { bgRef.current = backgroundImage ?? null; }, [backgroundImage]);

  useEffect(() => {
    if (width <= 0 || height <= 0) return;

    const minInterval = 1000 / maxFPS;
    let lastFrame = performance.now();
    let elapsed = 0;
    let rafId = 0;

    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);

      const rawDelta = now - lastFrame;
      if (rawDelta < minInterval) return;
      lastFrame = now;

      const dt = Math.min(rawDelta / 1000, 0.05);
      elapsed += dt;

      const ctx: GameLoopContext = {
        width: logicalWidth,
        height: logicalHeight,
        deltaTime: dt,
        elapsed,
      };

      updateRef.current(ctx);

      const canvasCtx = getContext2D();
      if (canvasCtx) {
        canvasCtx.clearRect(0, 0, width, height);
        if (bgRef.current) {
          if (bgRef.current instanceof HTMLImageElement) {
            drawBackground(canvasCtx, bgRef.current, width, height);
          } else if (typeof bgRef.current === 'string') {
            canvasCtx.fillStyle = bgRef.current;
            canvasCtx.fillRect(0, 0, width, height);
          }
        }

        if (useDesignScale) {
          canvasCtx.save();
          canvasCtx.scale(scale, scale);
        }
        drawRef.current(canvasCtx, ctx);
        if (useDesignScale) {
          canvasCtx.restore();
        }
      }
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [width, height, maxFPS, getContext2D, designWidth, designHeight]);

  const getLogicalCoords = useCallback((e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    if (!useDesignScale) return { x: cssX, y: cssY };
    // rect.width accounts for parent CSS transforms (e.g. transform: scale())
    const renderScale = rect.width / logicalWidth;
    return { x: cssX / renderScale, y: cssY / renderScale };
  }, [canvasRef, useDesignScale, logicalWidth]);

  return { canvasRef, logicalWidth, logicalHeight, getLogicalCoords };
}
