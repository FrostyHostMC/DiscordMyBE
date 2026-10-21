/** 9-param drawImage wrapper — caller controls display size. */
export function drawImageSafe(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const sw = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const sh = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  if (sw > 0 && sh > 0) {
    ctx.drawImage(img, 0, 0, sw, sh, dx, dy, dw, dh);
  }
}

/** Draw image centered at (cx, cy) in a square bounding box. */
export function drawImageCentered(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  cx: number,
  cy: number,
  size: number,
) {
  drawImageSafe(ctx, img, cx - size / 2, cy - size / 2, size, size);
}

/** Draw image centered at (cx, cy) within boxW×boxH, preserving aspect ratio (object-contain). Use for all game elements. */
export function drawImageContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  cx: number,
  cy: number,
  boxW: number,
  boxH: number,
) {
  const sw = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const sh = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  if (sw <= 0 || sh <= 0) return;
  const scale = Math.min(boxW / sw, boxH / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(img, 0, 0, sw, sh, cx - dw / 2, cy - dh / 2, dw, dh);
}

/** Full-canvas object-cover background. Called internally by useGameLoop — pass bg as 4th arg instead. */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
) {
  const sw = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const sh = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  if (sw <= 0 || sh <= 0) return;

  const scale = Math.max(canvasWidth / sw, canvasHeight / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(img, 0, 0, sw, sh, (canvasWidth - w) / 2, (canvasHeight - h) / 2, w, h);
}
