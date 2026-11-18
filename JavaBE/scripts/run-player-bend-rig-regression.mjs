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
  console.log('[PASS] Emotecraft bend tracks generate skin-preserving classic/slim player geometry with split limbs, torso, overlay layers, and retained UVs.');
} finally {
  await server.close();
}
