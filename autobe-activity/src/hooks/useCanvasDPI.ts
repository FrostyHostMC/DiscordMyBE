import { useRef, useEffect, useCallback } from 'react';

export interface UseCanvasDPIOptions {
  width: number;
  height: number;
  autoScale?: boolean;
  devicePixelRatio?: number;
  contextType?: '2d' | 'webgl' | 'webgl2';
  webGLOptions?: WebGLContextAttributes;
}

export interface UseCanvasDPIReturn {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  devicePixelRatio: number;
  actualWidth: number;
  actualHeight: number;
  updateCanvasSize: () => void;
  getContext2D: () => CanvasRenderingContext2D | null;
  getContextWebGL: () => WebGLRenderingContext | null;
  getContextWebGL2: () => WebGL2RenderingContext | null;
}

/** Canvas with automatic HiDPI scaling. Used internally by useGameLoop. */
export function useCanvasDPI(options: UseCanvasDPIOptions): UseCanvasDPIReturn {
  const { 
    width, 
    height, 
    autoScale = true, 
    devicePixelRatio: customDPR,
    contextType = '2d',
    webGLOptions = {}
  } = options;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const MAX_DPR = 2;
  const devicePixelRatio = customDPR ?? Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const actualWidth = Math.round(width * devicePixelRatio);
  const actualHeight = Math.round(height * devicePixelRatio);

  const applySize = useCallback((canvas: HTMLCanvasElement) => {
    if (autoScale && devicePixelRatio !== 1) {
      canvas.width = actualWidth;
      canvas.height = actualHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (contextType === '2d') {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(devicePixelRatio, devicePixelRatio);
        }
      }
    } else {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    sizedCanvasRef.current = canvas;
  }, [width, height, autoScale, devicePixelRatio, actualWidth, actualHeight, contextType]);

  const updateCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    applySize(canvas);
  }, [applySize]);

  const getContext2D = useCallback((): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    if (sizedCanvasRef.current !== canvas) {
      applySize(canvas);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (autoScale && devicePixelRatio !== 1) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(devicePixelRatio, devicePixelRatio);
    }

    return ctx;
  }, [autoScale, devicePixelRatio, applySize]);

  const getContextWebGL = useCallback((): WebGLRenderingContext | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    return canvas.getContext('webgl', webGLOptions);
  }, [webGLOptions]);

  const getContextWebGL2 = useCallback((): WebGL2RenderingContext | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    return canvas.getContext('webgl2', webGLOptions);
  }, [webGLOptions]);

  useEffect(() => {
    updateCanvasSize();
  }, [updateCanvasSize]);

  useEffect(() => {
    const handleResize = () => {
      updateCanvasSize();
    };
    window.addEventListener('resize', handleResize);
    const mediaQuery = window.matchMedia('(resolution: 1dppx)');
    mediaQuery.addEventListener('change', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      mediaQuery.removeEventListener('change', handleResize);
    };
  }, [updateCanvasSize]);

  return {
    canvasRef,
    devicePixelRatio,
    actualWidth,
    actualHeight,
    updateCanvasSize,
    getContext2D,
    getContextWebGL,
    getContextWebGL2,
  };
}