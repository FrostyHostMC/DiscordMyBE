import type { PreviewBone, PreviewScene, Vec3 } from '@/utils/geometryPreviewScene';

/**
 * Diagnostic geometry viewport.
 *
 * Draws the shipped geometry with the Canvas 2D API — no WebGL context, no extra dependency —
 * so the exact cubes, polygon meshes and bone pivots that will be exported can be inspected on
 * a phone. Faces are painted far-to-near with flat shading, and bones that declare nothing
 * renderable get a marker at their pivot, because a part that renders nothing is the defect
 * this viewport exists to surface.
 */

export interface PreviewCamera {
  yaw: number;
  pitch: number;
}

const DEG = Math.PI / 180;
const LIGHT: Vec3 = [-0.42, 0.82, 0.52];
const CORNERS: Vec3[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const FACES: Array<[number[], Vec3]> = [
  [[0, 1, 2, 3], [0, 0, -1]],
  [[5, 4, 7, 6], [0, 0, 1]],
  [[4, 0, 3, 7], [-1, 0, 0]],
  [[1, 5, 6, 2], [1, 0, 0]],
  [[3, 2, 6, 7], [0, 1, 0]],
  [[4, 5, 1, 0], [0, -1, 0]],
];

const rotate = (point: Vec3, rotation: Vec3): Vec3 => {
  const [x, y, z] = point;
  const cx = Math.cos(rotation[0] * DEG);
  const sx = Math.sin(rotation[0] * DEG);
  const cy = Math.cos(rotation[1] * DEG);
  const sy = Math.sin(rotation[1] * DEG);
  const cz = Math.cos(rotation[2] * DEG);
  const sz = Math.sin(rotation[2] * DEG);
  const y1 = y * cx - z * sx;
  const z1 = y * sx + z * cx;
  const x2 = x * cy + z1 * sy;
  const z2 = -x * sy + z1 * cy;
  return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2];
};

/** Applies a point's own bone rotation, then every ancestor rotation around their pivots. */
const chain = (bones: Map<string, PreviewBone>, name: string, point: Vec3): Vec3 => {
  let out: Vec3 = point;
  let bone = bones.get(name);
  const seen = new Set<string>();
  while (bone && !seen.has(bone.name)) {
    seen.add(bone.name);
    const local = rotate(
      [out[0] - bone.pivot[0], out[1] - bone.pivot[1], out[2] - bone.pivot[2]],
      bone.rotation,
    );
    out = [local[0] + bone.pivot[0], local[1] + bone.pivot[1], local[2] + bone.pivot[2]];
    bone = bone.parent ? bones.get(bone.parent) : undefined;
  }
  return out;
};

const toRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((char) => char + char).join('') : clean;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(value) || full.length < 6) return [182, 156, 255];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

interface Surface {
  points: Vec3[];
  normal: Vec3;
}

export function renderGeometryPreview(
  canvas: HTMLCanvasElement,
  scene: PreviewScene,
  camera: PreviewCamera,
  accent: string,
  injectedPivots: string[] = [],
  selectedInjectedPivot = '',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const [ar, ag, ab] = toRgb(accent);

  const bones = new Map(scene.bones.map((bone) => [bone.name, bone]));
  const surfaces: Surface[] = [];
  for (const cube of scene.cubes) {
    const corners = CORNERS.map((unit) =>
      chain(bones, cube.bone, [
        cube.origin[0] + unit[0] * cube.size[0],
        cube.origin[1] + unit[1] * cube.size[1],
        cube.origin[2] + unit[2] * cube.size[2],
      ] as Vec3),
    );
    for (const [indices, normal] of FACES) {
      surfaces.push({ points: indices.map((index) => corners[index]), normal });
    }
  }
  for (const polygon of scene.polygons) {
    const points = polygon.points.map((point) => chain(bones, polygon.bone, point));
    if (points.length < 3) continue;
    const [a, b, c] = points;
    const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    surfaces.push({
      points,
      normal: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
    });
  }

  const markers = scene.emptyBones.map((name) => chain(bones, name, bones.get(name)?.pivot ?? [0, 0, 0]));
  const injectedNames = new Set(injectedPivots);
  const injectedMarkers = scene.bones
    .filter((bone) => injectedNames.has(bone.name))
    .map((bone) => ({ name: bone.name, point: chain(bones, bone.name, bone.pivot) }));

  const all: Vec3[] = [...markers, ...injectedMarkers.map((marker) => marker.point)];
  for (const surface of surfaces) all.push(...surface.points);
  if (all.length === 0) {
    ctx.fillStyle = 'rgba(148,163,184,0.8)';
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No renderable geometry declared', width / 2, height / 2);
    return;
  }

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of all) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const view = (point: Vec3): Vec3 => {
    const local: Vec3 = [point[0] - center[0], point[1] - center[1], point[2] - center[2]];
    const yawed = rotate(local, [0, camera.yaw, 0]);
    const pitched = rotate(yawed, [camera.pitch, 0, 0]);
    return [pitched[0], -pitched[1], pitched[2]];
  };

  const projected = all.map(view);
  let radius = 1;
  for (const point of projected) {
    radius = Math.max(radius, Math.abs(point[0]), Math.abs(point[1]));
  }
  const scale = (Math.min(width, height) / 2 - 18) / radius;
  const toScreen = (point: Vec3): [number, number] => [
    width / 2 + point[0] * scale,
    height / 2 + point[1] * scale,
  ];

  const lightLength = Math.hypot(LIGHT[0], LIGHT[1], LIGHT[2]) || 1;
  const drawable = surfaces.map((surface) => {
    const viewed = surface.points.map(view);
    const screen = viewed.map(toScreen);
    const depth = viewed.reduce((total, point) => total + point[2], 0) / viewed.length;
    const normalLength =
      Math.hypot(surface.normal[0], surface.normal[1], surface.normal[2]) || 1;
    const diffuse = Math.max(
      0,
      (surface.normal[0] * LIGHT[0] + surface.normal[1] * LIGHT[1] + surface.normal[2] * LIGHT[2]) /
        (normalLength * lightLength),
    );
    return { screen, depth, shade: 0.4 + 0.6 * diffuse };
  });
  drawable.sort((a, b) => a.depth - b.depth);

  ctx.lineWidth = 0.75;
  for (const face of drawable) {
    const [first, ...rest] = face.screen;
    if (!first) continue;
    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    for (const point of rest) ctx.lineTo(point[0], point[1]);
    ctx.closePath();
    ctx.fillStyle = `rgb(${Math.round(ar * face.shade)},${Math.round(ag * face.shade)},${Math.round(ab * face.shade)})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(9,9,13,0.55)';
    ctx.stroke();
  }

  ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.95)`;
  ctx.lineWidth = 1.4;
  for (const marker of markers) {
    const [x, y] = toScreen(view(marker));
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x + 4, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
  }

  for (const marker of injectedMarkers) {
    const [x, y] = toScreen(view(marker.point));
    const selected = marker.name === selectedInjectedPivot;
    ctx.beginPath();
    ctx.arc(x, y, selected ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = selected ? '#F8F6FF' : '#B69CFF';
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.strokeStyle = '#5B3BA8';
    ctx.stroke();
    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(182,156,255,0.8)';
      ctx.stroke();
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#F8F6FF';
      ctx.fillText(marker.name, x + 10, y - 6);
    }
  }
}