import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  configFile: path.join(root, 'vite.config.ts'),
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const { analyzeChannel } = await server.ssrLoadModule('/src/utils/animationChannelMath.ts');
  const easeIn = analyzeChannel('rotation', {
    '0': { vector: [0, 0, 0] },
    '1': { vector: [100, 0, 0], easing: 'easeInQuad' },
  });
  if (Math.abs(easeIn.value['0.5'][0] - 25) > 0.0001) {
    throw new Error('GeckoLib easeInQuad was not baked with the expected midpoint.');
  }
  if (easeIn.keyframeCount < 20 || !easeIn.problems.some((p) => p.detail.includes('easeInQuad'))) {
    throw new Error('GeckoLib easing samples or fidelity diagnostics were not recorded.');
  }

  const easeOut = analyzeChannel('rotation', {
    '0': { vector: [0, 0, 0] },
    '1': { vector: [90, 0, 0], easing: 'easeOutSine' },
  });
  const expected = 90 * Math.sin(Math.PI / 4);
  if (Math.abs(easeOut.value['0.5'][0] - expected) > 0.0001) {
    throw new Error('GeckoLib easeOutSine was not evaluated correctly.');
  }

  const step = analyzeChannel('rotation', {
    '0': { vector: [0, 0, 0] },
    '1': { vector: [100, 0, 0], easing: 'step', easing_args: [4] },
  });
  if (Math.abs(step.value['0.5'][0] - 50) > 0.0001) {
    throw new Error('GeckoLib stepped easing argument was not applied.');
  }

  const dynamic = analyzeChannel('rotation', {
    '0': { vector: ['query.anim_time', 0, 0] },
    '1': { vector: [100, 0, 0], easing: 'easeInQuad' },
  });
  if (dynamic.value['0']?.[0] !== 'query.anim_time' ||
      !dynamic.problems.some((p) => p.kind === 'unsupported' && p.detail.includes('dynamic Molang'))) {
    throw new Error('Dynamic Molang easing endpoints were not preserved and reported.');
  }

  const custom = analyzeChannel('rotation', {
    '0': { vector: [0, 0, 0] },
    '1': { vector: [100, 0, 0], easing: 'custom_spring_curve' },
  });
  if (Object.keys(custom.value).length !== 2 ||
      !custom.problems.some((p) => p.kind === 'unsupported' && p.detail.includes('custom_spring_curve'))) {
    throw new Error('Unknown/custom Java easing was silently misrepresented.');
  }

  console.log('[PASS] GeckoLib built-in easing curves are baked; dynamic endpoints and custom easing are preserved/reported instead of falsely mapped.');
} finally {
  await server.close();
}
