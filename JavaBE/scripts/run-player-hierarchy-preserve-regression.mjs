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
  const { retargetJavaPlayerHierarchy } = await server.ssrLoadModule('/src/utils/playerHierarchyRetarget.ts');
  const expression = {
    'animation.fixture.expression': {
      bones: {
        body: { rotation: { '0': [0, 0, 0], '1': [0, 30, 0] } },
        head: { rotation: { '0': 'query.head_yaw', '1': 'query.head_yaw' } },
        rightArm: { rotation: { '0': [0, 0, 0], '1': [45, 0, 0] } },
      },
    },
  };
  const expressionHead = JSON.parse(JSON.stringify(expression['animation.fixture.expression'].bones.head.rotation));
  const expressionArm = JSON.parse(JSON.stringify(expression['animation.fixture.expression'].bones.rightArm.rotation));
  const expressionResult = retargetJavaPlayerHierarchy(expression);
  const expressionClip = expressionResult.clips['animation.fixture.expression'];
  if (JSON.stringify(expressionClip.bones.head.rotation) !== JSON.stringify(expressionHead)) {
    throw new Error('Dynamic Molang head track was modified or lost during player hierarchy retargeting.');
  }
  if (expressionResult.transformed < 1 ||
      JSON.stringify(expressionClip.bones.rightArm.rotation) === JSON.stringify(expressionArm)) {
    throw new Error('An independent numeric arm branch was unnecessarily blocked by a dynamic sibling.');
  }

  const discontinuity = {
    'animation.fixture.prepost': {
      bones: {
        body: { rotation: { '0': [0, 0, 0], '1': [0, 30, 0] } },
        head: { rotation: { '0': [0, 0, 0], '1': { pre: [0, 0, 0], post: [90, 0, 0], lerp_mode: 'linear' } } },
        rightArm: { rotation: { '0': [0, 0, 0], '1': [45, 0, 0] } },
      },
    },
  };
  const originalHead = JSON.parse(JSON.stringify(discontinuity['animation.fixture.prepost'].bones.head.rotation));
  const discontinuityResult = retargetJavaPlayerHierarchy(discontinuity);
  const discontinuityClip = discontinuityResult.clips['animation.fixture.prepost'];
  if (JSON.stringify(discontinuityClip.bones.head.rotation) !== JSON.stringify(originalHead)) {
    throw new Error('A pre/post discontinuity was flattened or overwritten during hierarchy retargeting.');
  }
  const originalArm = JSON.parse(JSON.stringify(discontinuity['animation.fixture.prepost'].bones.rightArm.rotation));
  if (discontinuityResult.transformed < 1 ||
      JSON.stringify(discontinuityClip.bones.rightArm.rotation) === JSON.stringify(originalArm)) {
    throw new Error('A safe sibling arm branch was not retargeted when another branch used pre/post data.');
  }
  if (JSON.stringify(discontinuity['animation.fixture.prepost'].bones.rightArm.rotation) !== JSON.stringify(originalArm)) {
    throw new Error('Player hierarchy retargeting mutated the caller\'s original source clip.');
  }

  const dynamicParent = {
    'animation.fixture.dynamic_parent': {
      bones: {
        body: { rotation: { '0': 'query.body_pitch', '1': 'query.body_pitch' } },
        head: { rotation: { '0': [0, 0, 0], '1': [20, 0, 0] } },
        rightArm: { rotation: { '0': [0, 0, 0], '1': [45, 0, 0] } },
      },
    },
  };
  const parentHead = JSON.parse(JSON.stringify(dynamicParent['animation.fixture.dynamic_parent'].bones.head.rotation));
  const parentResult = retargetJavaPlayerHierarchy(dynamicParent);
  if (JSON.stringify(parentResult.clips['animation.fixture.dynamic_parent'].bones.head.rotation) !== JSON.stringify(parentHead)) {
    throw new Error('A child of a dynamic parent was retargeted against an invented bind-pose parent.');
  }

  console.log('[PASS] Player hierarchy retargeting preserves dynamic/pre-post branches while continuing safe sibling branches.');
} finally {
  await server.close();
}
