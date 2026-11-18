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
  const { injectPlayerRigBones } = await server.ssrLoadModule('/src/utils/playerBoneInjector.ts');
  const result = injectPlayerRigBones({
    candidates: [],
    modId: 'bend_rig_fixture',
    clipBones: ['body', 'rightArm', 'rightArm_bend', 'leftLeg_bend'],
    bendBones: ['body_bend', 'rightArm_bend', 'leftLeg_bend'],
    needsWaistParenting: true,
  });
  const pathName = Object.keys(result.files)[0];
  if (!pathName || !pathName.endsWith('.geo.json') || !result.geometryIdentifier || !result.slimGeometryIdentifier) {
    throw new Error('The player bend rig did not emit both classic and slim geometry identifiers.');
  }
  const document = JSON.parse(result.files[pathName]);
  const geometries = document['minecraft:geometry'];
  if (!Array.isArray(geometries) || geometries.length !== 2) {
    throw new Error('The generated bend geometry must preserve both Mojang player model variants.');
  }

  for (const geometry of geometries) {
    const bones = geometry.bones;
    const find = (name) => bones.find((bone) => bone.name === name);
    for (const name of ['body_bend', 'rightArm_bend', 'leftLeg_bend', 'jacket_bend', 'rightSleeve_bend', 'leftPants_bend']) {
      if (!find(name)) throw new Error('Missing generated bend/overlay joint: ' + name);
    }
    const body = find('body');
    const bodyBend = find('body_bend');
    const arm = find('rightArm');
    const armBend = find('rightArm_bend');
    if (body.cubes[0].size[1] !== 6 || bodyBend.cubes[0].size[1] !== 6 ||
        arm.cubes[0].size[1] !== 6 || armBend.cubes[0].size[1] !== 6) {
      throw new Error('Bendable player cubes were not split into matching upper/lower segments.');
    }
    const expectedArmParentY = geometry.description.identifier.endsWith('customSlim') ? 17.5 : 18;
    const expectedArmChildY = geometry.description.identifier.endsWith('customSlim') ? 11.5 : 12;
    if (body.cubes[0].origin[1] !== 18 || bodyBend.cubes[0].origin[1] !== 12 ||
        arm.cubes[0].origin[1] !== expectedArmParentY || armBend.cubes[0].origin[1] !== expectedArmChildY) {
      throw new Error('Generated bend segments do not use the reference parent/child cube origins.');
    }
    if (!bodyBend.cubes[0].uv.up || !bodyBend.cubes[0].uv.down ||
        find('jacket_bend').cubes[0].uv.up || !find('jacket_bend').cubes[0].uv.down) {
      throw new Error('Bend segment exterior caps or overlay internal caps were not preserved correctly.');
    }
    if (find('head').parent !== 'body_bend' || find('jacket_bend').parent !== 'body_bend' ||
        find('rightSleeve_bend').parent !== 'rightArm_bend' ||
        find('leftLeg').parent !== 'waist' || find('rightLeg').parent !== 'waist') {
      throw new Error('Player descendants or overlay layers were not re-parented with the bend segment.');
    }
    if (!Array.isArray(arm.cubes[0].uv.east.uv_size) || !Array.isArray(armBend.cubes[0].uv.west.uv_size)) {
      throw new Error('Generated bend segment UVs were not preserved as explicit per-face UV data.');
    }
  }

  if (result.unresolvedBones.length !== 0 || result.injectedBones.length < 6) {
    throw new Error('The bend geometry report does not account for all generated joints.');
  }

  const waistOnly = injectPlayerRigBones({
    candidates: [],
    modId: 'waist_parent_fixture',
    clipBones: ['waist', 'leftLeg', 'rightLeg'],
    bendBones: [],
    needsWaistParenting: true,
  });
  const waistPath = Object.keys(waistOnly.files)[0];
  if (!waistPath) throw new Error('The player geometry writer skipped a required waist-to-legs parent reconstruction.');
  const waistDoc = JSON.parse(waistOnly.files[waistPath]);
  for (const geometry of waistDoc['minecraft:geometry']) {
    const find = (name) => geometry.bones.find((bone) => bone.name === name);
    if (find('leftLeg').parent !== 'waist' || find('rightLeg').parent !== 'waist') {
      throw new Error('The no-bend Emotecraft waist geometry did not re-parent both legs.');
    }
  }
  // Custom segmented player rigs are merged into Mojang's skin geometry. Animation track
  // names are retained even when the Blockbench geometry uses different punctuation/casing.
  const customGeometry = {
    'minecraft:geometry': [{
      description: { identifier: 'geometry.fixture.player', texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'body', pivot: [0, 24, 0], cubes: [] },
        { name: 'leftArm', parent: 'body', pivot: [5, 22, 0], cubes: [] },
        { name: 'upperArm', parent: 'leftArm', pivot: [5, 22, 0], cubes: [{ origin: [3, 18, -2], size: [3, 6, 4], uv: [0, 0] }] },
        { name: 'lowerArm', parent: 'upperArm', pivot: [5, 16, 0], cubes: [{ origin: [3, 12, -2], size: [3, 6, 4], uv: [0, 12] }] },
      ],
    }],
  };
  const customRig = injectPlayerRigBones({
    candidates: [{ key: 'models/entity/player_custom.geo.json', json: JSON.stringify(customGeometry) }],
    modId: 'segmented_player_fixture',
    clipBones: ['leftArm', 'upper_arm', 'lower_arm'],
    bendBones: [],
  });
  const customPath = Object.keys(customRig.files)[0];
  if (!customPath || customRig.unresolvedBones.length !== 0 ||
      !customRig.injectedBones.includes('upper_arm') || !customRig.injectedBones.includes('lower_arm')) {
    throw new Error('Custom segmented player joints were not discovered and injected under their exact animation track names.');
  }
  const customDoc = JSON.parse(customRig.files[customPath]);
  for (const geometry of customDoc['minecraft:geometry']) {
    const find = (name) => geometry.bones.find((bone) => bone.name === name);
    if (!find('upper_arm') || !find('lower_arm') || find('upper_arm').parent !== 'leftArm' ||
        find('lower_arm').parent !== 'upper_arm' || find('upper_arm').cubes[0].origin[0] !== 3 ||
        find('lower_arm').cubes[0].size[1] !== 6) {
      throw new Error('The custom player geometry merge lost segmented joint parenting or source cube visuals.');
    }
  }
  const { retargetJavaPlayerHierarchy } = await server.ssrLoadModule('/src/utils/playerHierarchyRetarget.ts');
  const visualClip = { animation_length: 1, bones: {
    upper_arm: { rotation: { '0.5': [25, 0, 0] } },
    lower_arm: { rotation: { '0.5': [35, 0, 0] } },
  } };
  const preserved = retargetJavaPlayerHierarchy({ segmented: visualClip }).clips.segmented;
  if (preserved.bones.upper_arm.rotation['0.5'][0] !== 25 || preserved.bones.lower_arm.rotation['0.5'][0] !== 35) {
    throw new Error('Custom segmented joint animation tracks were not preserved for the injected player geometry.');
  }
  console.log('[PASS] Emotecraft bend tracks generate skin-preserving classic/slim player geometry with split limbs, torso, overlay layers, and retained UVs.');
} finally {
  await server.close();
}
