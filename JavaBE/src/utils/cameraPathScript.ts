export function buildCameraPathScript(): string {
  return `
const CAMERA_PATH_SAMPLES = 8;
const CAMERA_AXES = ['x', 'y', 'z', 'pitch', 'yaw'];
const CAMERA_DEFAULT_PATH = { interpolation: 'bezier', points: [
  { x: 0, y: 3, z: -5, pitch: 14, yaw: -8, duration: 2.4 },
  { x: 3, y: 3.5, z: -3, pitch: 10, yaw: 28, duration: 3 },
  { x: -2, y: 3, z: 4, pitch: 16, yaw: 150, duration: 3 },
] };
const activeCameraPaths = new Map();
function stopCameraPath(player, clearCamera) {
  const runId = activeCameraPaths.get(player.id);
  if (runId !== undefined) system.clearRun(runId);
  activeCameraPaths.delete(player.id);
  if (clearCamera) void player.runCommandAsync('camera @s clear').catch(() => undefined);
}
function readCameraNumber(value, fallback, min, max) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error('Camera keyframe value is outside its safe range.');
  return number;
}
function parseCameraPath(message) {
  const request = message.trim() ? JSON.parse(message) : CAMERA_DEFAULT_PATH;
  if (!request || !Array.isArray(request.points) || request.points.length < 2 || request.points.length > 8) throw new Error('Provide 2–8 camera keyframes.');
  const mode = String(request.interpolation || 'bezier').toLowerCase();
  const interpolation = mode === 'smooth' ? 'bezier' : mode;
  if (interpolation !== 'linear' && interpolation !== 'bezier') throw new Error('Interpolation must be linear, bezier, or smooth.');
  const points = request.points.map((point) => {
    if (!point || typeof point !== 'object') throw new Error('Camera keyframes must be objects.');
    return {
      x: readCameraNumber(point.x, 0, -128, 128), y: readCameraNumber(point.y, 3, -128, 128),
      z: readCameraNumber(point.z, -4, -128, 128), pitch: readCameraNumber(point.pitch, 12, -90, 90),
      yaw: readCameraNumber(point.yaw, 0, -360, 360), duration: readCameraNumber(point.duration, 2, 0.25, 30),
    };
  });
  return { interpolation, points };
}
function bezierValue(start, end, previous, next, t, axis) {
  const first = start[axis] + (end[axis] - previous[axis]) / 6;
  const second = end[axis] - (next[axis] - start[axis]) / 6;
  const inverse = 1 - t;
  return inverse ** 3 * start[axis] + 3 * inverse ** 2 * t * first + 3 * inverse * t ** 2 * second + t ** 3 * end[axis];
}
function buildCameraTargets(points, interpolation) {
  const targets = [];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index], end = points[index + 1];
    if (interpolation === 'linear') { targets.push({ ...end, duration: end.duration }); continue; }
    const previous = points[Math.max(0, index - 1)], next = points[Math.min(points.length - 1, index + 2)];
    for (let step = 1; step <= CAMERA_PATH_SAMPLES; step++) {
      const t = step / CAMERA_PATH_SAMPLES;
      const target = { duration: end.duration / CAMERA_PATH_SAMPLES };
      for (const axis of CAMERA_AXES) target[axis] = bezierValue(start, end, previous, next, t, axis);
      targets.push(target);
    }
  }
  return targets;
}
function cameraCommand(point, duration, easing) {
  const number = (value) => Number(value).toFixed(2);
  return 'camera @s set minecraft:free ease ' + number(duration) + ' ' + easing +
    ' pos ' + number(point.x) + ' ' + number(point.y) + ' ' + number(point.z) +
    ' rot ' + number(point.pitch) + ' ' + number(point.yaw);
}
function startCameraPath(player, message) {
  const path = parseCameraPath(message);
  stopCameraPath(player, false);
  const origin = player.location, baseYaw = player.getRotation().y;
  const points = path.points.map((point) => ({
    x: origin.x + point.x, y: origin.y + point.y,
    z: origin.z + point.z, pitch: point.pitch,
    yaw: baseYaw + point.yaw, duration: point.duration,
  }));
  for (let index = 1; index < points.length; index++) {
    const priorYaw = points[index - 1].yaw;
    points[index].yaw = priorYaw + ((points[index].yaw - priorYaw + 540) % 360) - 180;
  }
  const targets = buildCameraTargets(points, path.interpolation);
  void player.runCommandAsync(cameraCommand(points[0], 0.75, 'in_out_sine')).catch(() => {
    stopCameraPath(player, false);
    player.onScreenDisplay.setActionBar('§c[Camera] Could not start this path.');
  });
  player.onScreenDisplay.setActionBar('§d[Camera] Playing ' + path.interpolation + ' cutscene.');
  let cursor = 0;
  const advance = () => {
    if (cursor >= targets.length) {
      activeCameraPaths.delete(player.id);
      player.onScreenDisplay.setActionBar('§a[Camera] Cutscene complete.');
      return;
    }
    const target = targets[cursor++];
    void player.runCommandAsync(cameraCommand(target, target.duration, 'linear')).catch(() => {
      stopCameraPath(player, false);
      player.onScreenDisplay.setActionBar('§c[Camera] Path interrupted.');
    });
    activeCameraPaths.set(player.id, system.runTimeout(advance, Math.max(1, Math.round(target.duration * 20))));
  };
  activeCameraPaths.set(player.id, system.runTimeout(advance, 15));
}
`;
}