import assetsData from "@/config/assets";
import type { RegressionAssertion, RegressionFixtureResult, RegressionMetricId, RegressionSuiteReport, RemakeItem } from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';
import { buildAssetIndex, resolveModelTexture, type AssetIndex } from '@/utils/assetIndex';
import { runUniversalTextureEngine, findAnimatedTextureRecord } from '@/utils/universalTextureEngine';
import { convertJavaEntityModelToBedrockGeometry, convertJavaModelDocument, extractBoneNames } from '@/utils/javaModelConverter';
import { summarizeBlockStateCoverage } from '@/utils/blockstateModelResolver';
import { buildGeckolibController, importGeckolibAnimations } from '@/utils/geckolibImporter';
import { buildModelDependencyReport } from '@/utils/modelDependencyTracker';
import { extractAndPortRecipes } from '@/utils/recipePortEngine';
import { translateLootTable, translateTradeTable } from '@/utils/behaviorPackEmitters';
import { detectBlockInteraction, detectCooldownTicks, detectEffectLogic, detectEntityTriggers } from '@/utils/behaviorSignalDetectors';
import { resolveEquipmentAttachments } from '@/utils/equipmentAttachments';
import { runAssetValidationPipeline } from '@/utils/assetValidationPipeline';
import type { Pack } from '@/utils/validationRules';
import { REGRESSION_FIXTURES, type RegressionFixture } from '@/utils/regressionFixtures';
import { compareGeometryUv, translateFaceUv, verifySheetCoverage } from '@/utils/uvMapping';
import { findDuplicateIdentifierGroups, normalizeAssetIdentifier, normalizeAssetPath } from '@/utils/identifierNormalization';
import { countSchemaErrors, runBedrockSchemaGate } from '@/utils/bedrockSchemaGate';
import { measureAnimationPropertyPolicy, measureClientEntityReferencePruning, measureContentLogConformance, measureEventDeclarationIntegrity, measureGeometryIdentitySync, measureMissingItemIconReporting, measureMissingTextureReporting, measurePerFaceUvAcceptance, measureRenderControllerSchema, measureSoundConversion, measureClientEntityLinking, measureItemModelNormalization, measurePlayerAnimationBindingPreservation, measurePlayerClipActivationFallback, measureAnimationControllerReferenceGraph, measurePlayerMolangVariableInitialization, measureSpawnEggSourceIntegration } from '@/utils/regressionSchemaFixtures';

import { inferMobBehaviorProfiles } from '@/utils/mobBehaviorProfiles';

import { retargetBones } from '@/utils/dynamicBoneRetargeter';

/**
 * Phase 9 — Automated regression suite.
 *
 * Runs the real converters over the fixture archives and measures what actually survived:
 * textures keep their dimensions, geometry keeps its element count and valid volume/UVs,
 * animation timing survives, recipes/loot/trades convert, dependency chains resolve, and
 * the assembled pack passes structural loading checks. Nothing here is asserted from a
 * template — every number comes from a converter's own output.
 */

export interface RegressionRunOptions {
  modId?: string;
  playableMode?: boolean;
  onLog?: (line: string) => void;
}
interface TextureMeasurement {
  tail: string;
  width: number;
  height: number;
}
const decoder = new TextDecoder();
const DEFAULT_MOD_ID = 'regress';
function textAt(entries: ExtractedZipEntry[], path: string): string | null {
  const entry = entries.find(item => item.path.replace(/\\/g, '/').toLowerCase() === path.toLowerCase());
  if (!entry) return null;
  try {
    return decoder.decode(entry.data);
  } catch {
    return null;
  }
}
function jsonAt(entries: ExtractedZipEntry[], path: string): Record<string, unknown> | null {
  const raw = textAt(entries, path);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
function countCubes(geometryJson: string): {
  cubes: number;
  valid: number;
} {
  try {
    const parsed = JSON.parse(geometryJson) as {
      'minecraft:geometry'?: Array<{
        bones?: Array<{
          cubes?: Array<{
            size?: number[];
            uv?: unknown;
            faces?: Record<string, {
              uv?: number[];
            }>;
          }>;
        }>;
      }>;
    };
    const cubes = (parsed['minecraft:geometry'] ?? []).flatMap(geo => (geo.bones ?? []).flatMap(bone => bone.cubes ?? []));
    const valid = cubes.filter(cube => {
      const size = cube.size ?? [];
      const positiveSize = size.length === 3 && size.every(entry => Number.isFinite(entry) && entry > 0);
      const faceUvs = Object.values(cube.faces ?? {});
      const validUv = faceUvs.every(face => !face?.uv || face.uv.every(value => Number.isFinite(value) && value >= 0));
      return positiveSize && validUv;
    }).length;
    return {
      cubes: cubes.length,
      valid
    };
  } catch {
    return {
      cubes: 0,
      valid: 0
    };
  }
}
function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(numerator / denominator * 100)));
}
function measureIdentifierNormalization(): RegressionFixtureResult {
  const started = performance.now();
  const namespaced = normalizeAssetIdentifier('mod:rune_blade');
  const duplicateGroups = findDuplicateIdentifierGroups(['mod:rune_blade', 'rune_blade']);
  const checks: RegressionAssertion[] = [{
    label: 'namespaced identifiers normalize without namespace drift',
    expected: 'runeblade',
    actual: namespaced,
    passed: namespaced === 'runeblade'
  }, {
    label: 'uppercase identifiers normalize consistently',
    expected: namespaced,
    actual: normalizeAssetIdentifier('MOD:RUNE_BLADE'),
    passed: normalizeAssetIdentifier('MOD:RUNE_BLADE') === namespaced
  }, {
    label: 'nested asset paths preserve path segments',
    expected: assetsData.IMAGE_EFUU,
    actual: normalizeAssetPath(' MOD:item\\tools\\RuneBlade.PNG '),
    passed: normalizeAssetPath(' MOD:item\\tools\\RuneBlade.PNG ') === assetsData.IMAGE_EFUU
  }, {
    label: 'missing namespaces resolve to the same canonical identifier',
    expected: namespaced,
    actual: normalizeAssetIdentifier('rune_blade'),
    passed: normalizeAssetIdentifier('rune_blade') === namespaced
  }, {
    label: 'duplicate canonical identifiers are grouped, not discarded',
    expected: 'one group containing both source identifiers',
    actual: JSON.stringify(duplicateGroups),
    passed: duplicateGroups.length === 1 && duplicateGroups[0].length === 2
  }];
  const failures = checks.filter(check => !check.passed);
  return {
    id: 'identifier-normalization',
    label: 'Shared item identifier and path normalization',
    category: 'Items',
    status: failures.length === 0 ? 'passed' : 'failed',
    metrics: {},
    assertions: checks,
    findings: failures.map(failure => `${failure.label}: expected ${failure.expected}, got ${failure.actual}`),
    unavailable: [],
    durationMs: Math.round(performance.now() - started)
  };
}
/**
 * Numerical UV conversion tests.
 *
 * These assert the engine's own contract instead of a fixture pack: a source rectangle is
 * never rounded, clamped or relocated, mirroring survives through the signed size, and a
 * sheet smaller than the emitted rectangles is reported as a declaration defect.
 */
function measureUvConversion(): RegressionFixtureResult {
  const started = performance.now();
  const pixelSheet = {
    width: 64,
    height: 64,
    scaleU: 1,
    scaleV: 1
  };
  const mirrored = translateFaceUv({
    faceName: 'north',
    rect: [8, 8, 0, 0],
    sheet: pixelSheet
  });
  const mirroredSouth = translateFaceUv({
    faceName: 'south',
    rect: [8, 0, 0, 8],
    sheet: pixelSheet
  });
  const fractional = translateFaceUv({
    faceName: 'north',
    rect: [0.5, 0.25, 4.75, 3.25],
    sheet: pixelSheet
  });
  const offSheet = translateFaceUv({
    faceName: 'north',
    rect: [100, 100, 108, 108],
    sheet: pixelSheet
  });
  const coverage = verifySheetCoverage([{
    pointer: 'cube.faces.north.uv',
    origin: [100, 100],
    span: [8, 8]
  }], {
    width: 64,
    height: 64
  });
  const checks: RegressionAssertion[] = [{
    label: 'a mirrored Java rectangle keeps its mirroring through the signed size',
    expected: 'uv_size -8x-8',
    actual: mirrored.uv_size.join('x'),
    passed: mirrored.uv_size[0] === -8 && mirrored.uv_size[1] === -8
  }, {
    label: 'the south face keeps the engine’s own reversal on top of the source mirroring',
    expected: 'uv_size 8x8 anchored at the far edge',
    actual: `${mirroredSouth.uv_size.join('x')} at ${mirroredSouth.uv.join(',')}`,
    passed: mirroredSouth.uv_size[0] === 8 && mirroredSouth.uv_size[1] === 8 && mirroredSouth.uv[0] === 0
  }, {
    label: 'fractional source coordinates are preserved exactly',
    expected: '0.5,0.25 with 4.25x3',
    actual: `${fractional.uv.join(',')} with ${fractional.uv_size.join('x')}`,
    passed: fractional.uv[0] === 0.5 && fractional.uv[1] === 0.25 && fractional.uv_size[0] === 4.25 && fractional.uv_size[1] === 3
  }, {
    label: 'an off-sheet rectangle is preserved, never clamped or wrapped',
    expected: '[100, 100] reported outside-sheet',
    actual: `[${offSheet.uv.join(', ')}] ${offSheet.status}`,
    passed: offSheet.uv[0] === 100 && offSheet.uv[1] === 100 && offSheet.status === 'outside-sheet'
  }, {
    label: 'a sheet smaller than the emitted rectangles is reported with the covering size',
    expected: 'sheet-too-small 128x128',
    actual: `${coverage.status} ${coverage.neededWidth}x${coverage.neededHeight}`,
    passed: coverage.status === 'sheet-too-small' && coverage.neededWidth === 128 && coverage.neededHeight === 128
  }];
  const failures = checks.filter(check => !check.passed);
  return {
    id: 'uv-conversion',
    label: 'Precision UV conversion (mirroring, precision, sheet coverage)',
    category: 'Geometry',
    status: failures.length === 0 ? 'passed' : 'failed',
    metrics: {
      uvAccuracy: failures.length === 0 ? 100 : 0
    },
    assertions: checks,
    findings: failures.map(failure => `${failure.label}: expected ${failure.expected}, got ${failure.actual}`),
    unavailable: [],
    durationMs: Math.round(performance.now() - started)
  };
}

/** Minimal PNG header (signature + IHDR size fields) the dimension reader accepts. */
function fixturePngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < signature.length; index += 1) bytes[index] = signature[index];
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

/**
 * Bedrock client-schema gate tests.
 *
 * Runs the real gate over a deliberately broken pack and asserts that each content-log
 * error class is gone afterwards. The fixture covers a scalar render controller texture,
 * an entity with zero animations, a Java event id used as a sound path, a sound name that
 * keeps its extension, a dangling geometry reference, an item without an icon and a legacy
 * blocks.json override on a block that renders through minecraft:geometry.
 */
function measureSchemaGate(): RegressionFixtureResult {
  const started = performance.now();
  const rp: Pack = {};
  const bp: Pack = {};
  rp[assetsData.IMAGE_FQCN] = fixturePngHeader(64, 64);
  rp[assetsData.IMAGE_QDFQ] = fixturePngHeader(16, 16);
  rp['models/entity/alpha.geo.json'] = JSON.stringify({
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: {
        identifier: 'geometry.alpha',
        texture_width: 64,
        texture_height: 64
      },
      bones: [{
        name: 'body',
        cubes: [{
          origin: [-4, 0, -4],
          size: [8, 8, 8],
          uv: [0, 0]
        }]
      }]
    }]
  });
  rp['models/blocks/rune_block.geo.json'] = JSON.stringify({
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: {
        identifier: 'geometry.rune_block',
        texture_width: 16,
        texture_height: 16
      },
      bones: [{
        name: 'block',
        cubes: [{
          origin: [-8, 0, -8],
          size: [16, 16, 16],
          uv: [0, 0]
        }]
      }]
    }]
  });
  rp['entity/alpha.entity.json'] = JSON.stringify({
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: 'regress:alpha',
        textures: {
          default: 'textures/entity/alpha'
        },
        geometry: {
          default: 'geometry.not_shipped'
        },
        materials: {
          default: 'entity_alphatest'
        },
        render_controllers: ['controller.render.regress.alpha'],
        animations: {},
        scripts: {
          animate: []
        },
        sound_effects: {
          ambient: 'regress.mob_ambient'
        }
      }
    }
  });
  rp['render_controllers/alpha.render_controllers.json'] = JSON.stringify({
    format_version: '1.10.0',
    render_controllers: {
      'controller.render.regress.alpha': {
        geometry: 'Geometry.default',
        materials: [{
          '*': 'Material.default'
        }],
        textures: 'Texture.default'
      }
    }
  });
  rp['sounds/sound_definitions.json'] = JSON.stringify({
    format_version: '1.14.0',
    sound_definitions: {
      'regress.mob_ambient': {
        category: 'neutral',
        sounds: ['mob.zombie.say']
      },
      'regress.hurt': {
        category: 'neutral',
        sounds: [assetsData.AUDIO_GFVJ]
      }
    }
  });
  rp['textures/item_texture.json'] = JSON.stringify({
    resource_pack_name: 'vanilla',
    texture_name: 'atlas.items',
    texture_data: {}
  });
  rp['blocks.json'] = JSON.stringify({
    format_version: [1, 1, 0],
    'regress:rune_block': {
      textures: 'rune_block'
    }
  });
  bp['items/rune.json'] = JSON.stringify({
    format_version: '1.21.0',
    'minecraft:item': {
      description: {
        identifier: 'regress:rune',
        menu_category: {
          category: 'equipment'
        }
      },
      components: {}
    }
  });
  bp['blocks/rune_block.json'] = JSON.stringify({
    format_version: '1.21.0',
    'minecraft:block': {
      description: {
        identifier: 'regress:rune_block'
      },
      components: {
        'minecraft:geometry': {
          identifier: 'geometry.rune_block'
        }
      }
    }
  });
  const before = countSchemaErrors({
    resourcePackFiles: rp,
    behaviorPackFiles: bp
  });
  const report = runBedrockSchemaGate({
    modId: 'regress',
    resourcePackFiles: rp,
    behaviorPackFiles: bp
  });
  const after = countSchemaErrors({
    resourcePackFiles: rp,
    behaviorPackFiles: bp
  });
  const controllerJson = String(rp['render_controllers/alpha.render_controllers.json']);
  const clientJson = String(rp['entity/alpha.entity.json']);
  const soundJson = String(rp['sounds/sound_definitions.json']);
  const blocksJson = String(rp['blocks.json']);
  const itemJson = String(bp['items/rune.json']);
  let geometryDefault = '';
  let iconTexture = '';
  let atlasRune = '';
  try {
    geometryDefault = String(JSON.parse(clientJson)?.['minecraft:client_entity']?.description?.geometry?.default ?? '');
    iconTexture = String(JSON.parse(itemJson)?.['minecraft:item']?.components?.['minecraft:icon']?.textures?.default ?? '');
    atlasRune = String(JSON.parse(String(rp['textures/item_texture.json']))?.texture_data?.rune?.textures ?? '');
  } catch {
    // A parse failure is reported by the assertions below as an empty value.
  }
  const checks: RegressionAssertion[] = [{
    label: 'a scalar render controller textures value is detected',
    expected: '1 defect',
    actual: `${before.renderControllerTextures}`,
    passed: before.renderControllerTextures === 1
  }, {
    label: 'render controller textures are always an array after the gate',
    expected: '0 defects and an array value',
    actual: `${after.renderControllerTextures}, ${controllerJson.includes('"textures": [') ? 'array' : 'not an array'}`,
    passed: after.renderControllerTextures === 0 && controllerJson.includes('"textures": [')
  }, {
    label: 'empty animations node and empty animate array are omitted',
    expected: '0 defects, both properties removed',
    actual: `${after.emptyAnimationProperties} defect(s)`,
    passed: after.emptyAnimationProperties === 0 && !clientJson.includes('"animations"') && !clientJson.includes('"animate"')
  }, {
    label: 'a Java event identifier is never written as a sound path',
    expected: 'no dotted event identifier in sound definitions',
    actual: soundJson.includes('mob.zombie.say') ? 'event id shipped as a path' : 'mapped or dropped',
    passed: !soundJson.includes('mob.zombie.say')
  }, {
    label: 'sound names carry no file extension and resolve to shipped audio',
    expected: '0 defects',
    actual: `${after.soundAssetPaths}`,
    passed: after.soundAssetPaths === 0
  }, {
    label: 'a dangling geometry reference is rebound to the shipped identifier',
    expected: 'geometry.alpha',
    actual: geometryDefault || 'ABSENT',
    passed: geometryDefault === 'geometry.alpha' && after.danglingGeometryRefs === 0
  }, {
    label: 'an item without an icon declaration gets a shipped atlas entry',
    expected: 'icon rune → textures/items/rune',
    actual: `${iconTexture || 'ABSENT'} → ${atlasRune || 'ABSENT'}`,
    passed: iconTexture === 'rune' && atlasRune === 'textures/items/rune'
  }, {
    label: 'a legacy blocks.json override is removed for a geometry block',
    expected: 'no regress:rune_block entry',
    actual: blocksJson.includes('regress:rune_block') ? 'override still present' : 'removed',
    passed: !blocksJson.includes('regress:rune_block') && after.blockGeometryOverrides === 0
  }, {
    label: 'the gate reports the defect count drop it really achieved',
    expected: `${report.errorsBefore} → ${report.errorsAfter}`,
    actual: `${before.renderControllerTextures + before.emptyAnimationProperties + before.blockGeometryOverrides} defect class(es) cleared`,
    passed: report.errorsBefore > report.errorsAfter && report.checks.length === 8
  }];
  const failures = checks.filter(check => !check.passed);
  return {
    id: 'bedrock-schema-gate',
    label: 'Bedrock client-schema gate (render controller textures, animation nodes, sound paths, icons, block overrides)',
    category: 'Schema',
    status: failures.length === 0 ? 'passed' : 'failed',
    metrics: {},
    assertions: checks,
    findings: failures.map(failure => `${failure.label}: expected ${failure.expected}, got ${failure.actual}`),
    unavailable: ['In-game rendering of the repaired pack is not measured by this fixture.'],
    durationMs: Math.round(performance.now() - started)
  };
}
function buildBundle(index: AssetIndex, entries: ExtractedZipEntry[], geometryFiles: Record<string, string>, recipes: Record<string, string>, itemIds: string[], animationFiles: Record<string, string>, controllerFiles: Record<string, string>, modId: string): {
  resourcePackFiles: Pack;
  behaviorPackFiles: Pack;
} {
  const resourcePackFiles: Pack = {};
  const behaviorPackFiles: Pack = {};
  const resourceUuid = '10000000-0000-4000-8000-000000000001';
  const behaviorUuid = '10000000-0000-4000-8000-000000000002';
  const resourceModuleUuid = '10000000-0000-4000-8000-000000000003';
  const behaviorModuleUuid = '10000000-0000-4000-8000-000000000004';
  resourcePackFiles['manifest.json'] = JSON.stringify({
    format_version: 2,
    header: {
      name: 'Regression fixtures (resources)',
      description: 'Pack assembled by the automated regression suite.',
      uuid: resourceUuid,
      version: [1, 0, 0],
      min_engine_version: [1, 21, 0]
    },
    modules: [{
      type: 'resources',
      uuid: resourceModuleUuid,
      version: [1, 0, 0]
    }]
  }, null, 2);
  behaviorPackFiles['manifest.json'] = JSON.stringify({
    format_version: 2,
    header: {
      name: 'Regression fixtures (behaviour)',
      description: 'Pack assembled by the automated regression suite.',
      uuid: behaviorUuid,
      version: [1, 0, 0],
      min_engine_version: [1, 21, 0]
    },
    modules: [{
      type: 'data',
      uuid: behaviorModuleUuid,
      version: [1, 0, 0]
    }],
    dependencies: [{
      uuid: resourceUuid,
      version: [1, 0, 0]
    }]
  }, null, 2);
  const textureData: Record<string, {
    textures: string;
  }> = {};
  for (const texture of index.textures) {
    const tail = texture.tail || texture.stem;
    resourcePackFiles[`textures/${tail}.png`] = texture.data;
    textureData[texture.stem] = {
      textures: `textures/${tail}`
    };
  }
  resourcePackFiles['textures/item_texture.json'] = JSON.stringify({
    resource_pack_name: 'vanilla',
    texture_name: 'atlas.items',
    texture_data: textureData
  }, null, 2);
  for (const [path, json] of Object.entries(geometryFiles)) resourcePackFiles[path] = json;
  // Converted animation clips and generated controllers belong to the pack under test, so a
  // broken clip or a controller pointing at a missing clip fails this fixture.
  for (const [path, json] of Object.entries(animationFiles)) resourcePackFiles[path] = json;
  for (const [path, json] of Object.entries(controllerFiles)) resourcePackFiles[path] = json;
  // A pack with no language declaration is refused by the engine, so the fixture bundle ships
  // the same texts a real export does instead of being exempt from that check.
  for (const packFiles of [resourcePackFiles, behaviorPackFiles]) {
    packFiles['texts/languages.json'] = JSON.stringify(['en_US'], null, 2);
    packFiles['texts/en_US.lang'] = 'pack.name=Regression fixtures\npack.description=Assembled by the automated regression suite.';
  }
  for (const itemId of itemIds) {
    behaviorPackFiles[`items/${itemId}.json`] = JSON.stringify({
      format_version: '1.21.0',
      'minecraft:item': {
        description: {
          identifier: `${modId}:${itemId}`,
          menu_category: {
            category: 'equipment'
          }
        },
        components: {
          'minecraft:icon': {
            texture: itemId
          }
        }
      }
    }, null, 2);
  }
  for (const [path, content] of Object.entries(recipes)) behaviorPackFiles[path] = content;
  if (entries.length === 0) behaviorPackFiles['_fixture_marker.json'] = JSON.stringify({
    format_version: '2',
    note: 'empty'
  });
  return {
    resourcePackFiles,
    behaviorPackFiles
  };
}
async function measureFixture(fixture: RegressionFixture, modId: string, playableMode: boolean): Promise<RegressionFixtureResult> {
  const started = performance.now();
  const entries = fixture.build();
  const expect = fixture.expect;
  const assertions: RegressionAssertion[] = [];
  const findings: string[] = [];
  const unavailable: string[] = [];
  const metrics: Partial<Record<RegressionMetricId, number>> = {};
  const missingPng = entries.filter(entry => entry.path.endsWith('.png') && entry.data.length === 0);
  if (missingPng.length > 0) {
    unavailable.push('PNG decoding is unavailable in this environment, so texture bytes could not be generated for this fixture.');
  }
  const index = buildAssetIndex(entries);
  const textures: TextureMeasurement[] = index.textures.map(texture => ({
    tail: texture.tail || texture.stem,
    width: texture.width,
    height: texture.height
  }));

  // Source assets that must survive conversion, and how many actually did.
  let assetTotal = 0;
  let assetKept = 0;
  const record = (label: string, ok: boolean, expected: string, actual: string) => {
    assertions.push({
      label,
      expected,
      actual,
      passed: ok
    });
  };

  // Texture accuracy — dimensions must survive decoding untouched.
  if (expect.textures && expect.textures.length > 0) {
    for (const expected of expect.textures) {
      const found = textures.find(texture => texture.tail === expected.tail);
      record(`texture ${expected.tail}`, Boolean(found && found.width === expected.width && found.height === expected.height), `${expected.width}x${expected.height}`, found ? `${found.width}x${found.height}` : 'ABSENT');
    }
    const matched = expect.textures.filter(expected => {
      const found = textures.find(texture => texture.tail === expected.tail);
      return Boolean(found && found.width === expected.width && found.height === expected.height);
    }).length;
    const accuracy = percent(matched, expect.textures.length);
    if (accuracy != null) metrics.textureAccuracy = accuracy;
    assetTotal += expect.textures.length;
    assetKept += matched;
  }

  // Geometry accuracy — model conversion through the intermediate representation.
  const geometryFiles: Record<string, string> = {};
  const animationFiles: Record<string, string> = {};
  const controllerFiles: Record<string, string> = {};
  let geometryPreserved = 0;
  let geometryExpected = 0;
  let flatSpriteModels = 0;
  // Source-versus-output UV comparison: every source face is re-derived and compared
  // with the pair that was actually written, so a clamped rectangle fails the metric.
  let uvFaces = 0;
  let uvMatched = 0;
  const uvNotes: string[] = [];
  const countModels = (expect.itemModels ?? 0) + (expect.blockModels ?? 0);
  if (countModels > 0) {
    const models = [...index.itemModels, ...index.blockModels];
    assetTotal += models.length;
    for (const model of models) {
      if (!model.elements || model.elements.length === 0) {
        // A model without its own elements (item/generated, item/handheld) has no cube
        // geometry on Bedrock: it becomes a flat sprite, so no geometry is expected.
        flatSpriteModels += 1;
        assetKept += 1;
        continue;
      }
      geometryExpected += 1;
      const texture = resolveModelTexture(model, index);
      const converted = convertJavaModelDocument({
        modId,
        assetId: model.stem,
        model,
        index,
        textureWidth: texture?.width ?? 16,
        textureHeight: texture?.height ?? 16,
        space: 'block'
      });
      if (!converted) {
        findings.push(`Model ${model.path} produced no Bedrock geometry.`);
        continue;
      }
      const cubeStats = countCubes(converted.geometry.json);
      if (cubeStats.cubes > 0 && cubeStats.valid === cubeStats.cubes) {
        geometryPreserved += 1;
        assetKept += 1;
      } else {
        findings.push(`Model ${model.path} converted with ${cubeStats.cubes - cubeStats.valid} invalid cube(s).`);
      }
      const uvCheck = compareGeometryUv(converted.ir, converted.geometry.json, converted.geometry.uv.sheet);
      uvFaces += uvCheck.faces;
      uvMatched += uvCheck.matched;
      for (const mismatch of uvCheck.mismatches.slice(0, 2)) {
        findings.push(`Model ${model.path} face ${mismatch.face}: ${mismatch.reason}`);
      }
      if (uvCheck.note) uvNotes.push(`${model.stem}: ${uvCheck.note}`);
      const path = `models/${model.bucket === 'block' ? 'blocks' : 'items'}/${model.stem}.geo.json`;
      geometryFiles[path] = converted.geometry.json;
    }
    const accuracy = percent(geometryPreserved, Math.max(1, geometryExpected));
    if (accuracy != null && geometryExpected > 0) metrics.geometryAccuracy = accuracy;
    record('java models converted with valid geometry', geometryExpected === 0 || geometryPreserved === geometryExpected, `${geometryExpected} valid`, `${geometryPreserved} valid`);
    if (uvFaces > 0) {
      metrics.uvAccuracy = percent(uvMatched, uvFaces) ?? 0;
      record('source UVs preserved', uvMatched === uvFaces, `${uvFaces} source face(s)`, `${uvMatched}/${uvFaces} matched`);
    }
    for (const note of uvNotes.slice(0, 2)) findings.push(note);
    if (expect.elements != null) {
      const cubes = Object.values(geometryFiles).reduce((total, json) => total + countCubes(json).valid, 0);
      record('source elements survive as cubes', cubes >= expect.elements, `${expect.elements} element(s)`, `${cubes} cube(s)`);
    }
  }
  if (expect.blockstateVariants != null || expect.blockstateMultipart != null) {
    const coverage = summarizeBlockStateCoverage(index);
    record('blockstate variants resolve', coverage.variants === (expect.blockstateVariants ?? 0) && coverage.unresolvedReferences.length === 0, `${expect.blockstateVariants ?? 0} variant(s), 0 unresolved`, `${coverage.variants} variant(s), ${coverage.unresolvedReferences.length} unresolved`);
    record('multipart parts resolve', coverage.multipartParts === (expect.blockstateMultipart ?? coverage.multipartParts), `${expect.blockstateMultipart ?? coverage.multipartParts} part(s)`, `${coverage.multipartParts} part(s)`);
  }

  // Entity geometry conversion through the multi-bone rig path.
  if (expect.entityModels && expect.entityModels.length > 0) {
    for (const expected of expect.entityModels) {
      const doc = jsonAt(entries, expected.path);
      const elements = Array.isArray(doc?.elements) ? doc?.elements as never[] : [];
      if (!doc || elements.length === 0) {
        record(`entity model ${expected.path}`, false, 'elements present', 'no elements');
        findings.push(`${expected.path} declares no elements, so no geometry could be produced.`);
        continue;
      }
      const converted = convertJavaEntityModelToBedrockGeometry(modId, expected.path.split('/').pop()?.replace(/\.json$/i, '') ?? 'entity', elements, expected.textureWidth, expected.textureHeight, null, index);
      assetTotal += 1;
      if (!converted) {
        record(`entity model ${expected.path}`, false, 'converted geometry', 'conversion returned nothing');
        findings.push(`${expected.path} produced no Bedrock entity geometry.`);
        continue;
      }
      assetKept += 1;
      const cubeStats = countCubes(converted.json);
      geometryFiles[`models/entity/${expected.path.split('/').pop()?.replace(/\.json$/i, '') ?? 'entity'}.geo.json`] = converted.json;
      record(`entity model ${expected.path}`, cubeStats.valid === cubeStats.cubes && cubeStats.cubes >= elements.length, `${elements.length} cube(s) with valid volume/UVs`, `${cubeStats.cubes} cube(s), ${cubeStats.valid} valid`);
      if (expected.minBones != null) {
        record(`bone hierarchy ${expected.path}`, converted.bones >= expected.minBones, `>= ${expected.minBones} bone(s)`, `${converted.bones} bone(s)`);
      }
      if (expected.skinRef) {
        const hasSkin = textures.some(texture => texture.tail === expected.skinRef);
        record(`skin reference ${expected.skinRef}`, hasSkin, 'declared skin shipped', hasSkin ? 'shipped' : 'ABSENT');
      }
      if (expect.clips != null) {
        const animationPath = entries.find(entry => entry.path.toLowerCase().includes('/animations/'))?.path;
        const animationDoc = animationPath ? jsonAt(entries, animationPath) : null;
        const clips = Object.keys(animationDoc?.animations as Record<string, unknown> ?? {});
        const bones = new Set(extractBoneNames(converted.json));
        const tracks = clips.flatMap(clip => {
          const clipDoc = (animationDoc?.animations as Record<string, Record<string, unknown>>)?.[clip];
          return Object.keys(clipDoc?.bones as Record<string, unknown> ?? {});
        });
        const resolvedTracks = tracks.filter(bone => bones.has(bone)).length;
        record('animation clips discovered', clips.length === expect.clips, `${expect.clips} clip(s)`, `${clips.length} clip(s)`);
        record('animation bone tracks resolve', tracks.length > 0 && resolvedTracks === tracks.length, `${tracks.length} resolvable track(s)`, `${resolvedTracks}/${tracks.length} resolved`);
        if (tracks.length > 0) metrics.animationAccuracy = percent(resolvedTracks, tracks.length) ?? 0;
      }
    }
  }

  // Conversion-specific: GeckoLib clips must be discovered, attributed to their source entity
  // and translated into Bedrock documents, and the generated controllers may only reference
  // clips that shipped. The real importer runs here, so a conversion regression fails this
  // fixture instead of passing as a structural no-op.
  if (expect.geckolib) {
    const imported = importGeckolibAnimations(entries, modId);
    record('GeckoLib dependency detected', imported.dependency.detected, 'detected', imported.dependency.detected ? 'detected' : 'NOT detected');
    record('animation clips imported', imported.stats.clipsImported >= expect.geckolib.clips, `>= ${expect.geckolib.clips} clip(s)`, `${imported.stats.clipsImported} clip(s)`);
    record('clips attributed to a source entity', imported.stats.clipsAttributed >= expect.geckolib.attributed, `>= ${expect.geckolib.attributed} attributed`, `${imported.stats.clipsAttributed} attributed, ${imported.stats.clipsUnattributed} unattributed`);
    for (const owner of imported.owners) {
      const controller = buildGeckolibController(owner, Object.keys(imported.clipsByOwner[owner] ?? {}));
      if (controller) controllerFiles[`animation_controllers/${owner}.animation_controllers.json`] = controller;
    }
    for (const file of imported.files) {
      if (file.json) animationFiles[`animations/${file.fileName}`] = file.json;
    }
    record('controllers generated for imported owners', Object.keys(controllerFiles).length >= expect.geckolib.controllers, `>= ${expect.geckolib.controllers} controller(s)`, `${Object.keys(controllerFiles).length} controller(s)`);
    if (imported.stats.unsupported > 0) {
      findings.push(`${imported.stats.unsupported} GeckoLib expression(s) have no Bedrock equivalent and are reported for manual review.`);
    }
    metrics.animationAccuracy = percent(imported.stats.clipsAttributed, Math.max(1, imported.stats.clipsImported)) ?? 0;
  }

  // Animated texture timing.
  if (expect.animatedTextures && expect.animatedTextures.length > 0) {
    const engine = await runUniversalTextureEngine(entries, index);
    for (const expected of expect.animatedTextures) {
      const recordEntry = findAnimatedTextureRecord(engine, expected.tail);
      record(`animation timing ${expected.tail}`, Boolean(recordEntry && recordEntry.frameCount === expected.frames && recordEntry.ticksPerFrame === expected.ticksPerFrame), `${expected.frames} frame(s) @ ${expected.ticksPerFrame} tick(s)`, recordEntry ? `${recordEntry.frameCount} frame(s) @ ${recordEntry.ticksPerFrame} tick(s)` : 'not decoded as animated');
    }
  }

  // Armour sheets -> Bedrock slots.
  if (expect.armorSheets != null) {
    const equipment = resolveEquipmentAttachments(index);
    record('armour sheets mapped to slots', equipment.armorSheets === expect.armorSheets && equipment.attachments.length > 0, `${expect.armorSheets} sheet(s) with slot mappings`, `${equipment.armorSheets} sheet(s), ${equipment.attachments.length} slot mapping(s)`);
    assetTotal += expect.armorSheets;
    assetKept += equipment.armorSheets === expect.armorSheets ? expect.armorSheets : 0;
  }

  // Behaviour preservation: recipes, trades, loot, AI signals.
  const items: RemakeItem[] = (expect.itemIds ?? []).map(id => ({
    id,
    name: id.replace(/_/g, ' '),
    type: 'java:item'
  }));
  let behaviourEarned = 0;
  let behaviourExpected = 0;
  if (expect.recipes != null) {
    const recipeResult = extractAndPortRecipes(modId, items, entries);
    behaviourExpected += expect.recipes;
    behaviourEarned += Math.min(expect.recipes, recipeResult.stats.recipesConverted);
    record('recipes converted', recipeResult.stats.recipesConverted === expect.recipes, `${expect.recipes} converted`, `${recipeResult.stats.recipesConverted} converted (${recipeResult.stats.deduplicatedCount} deduplicated)`);
    assetTotal += expect.recipes;
    assetKept += Math.min(expect.recipes, recipeResult.stats.recipesConverted);
  }
  if (expect.tradeTables && expect.tradeTables.length > 0) {
    for (const path of expect.tradeTables) {
      const raw = textAt(entries, path);
      const converted = raw ? translateTradeTable(raw) : null;
      behaviourExpected += 1;
      if (converted) behaviourEarned += 1;
      assetTotal += 1;
      if (converted) assetKept += 1;
      record(`trade table ${path}`, Boolean(converted), 'Bedrock economy table', converted ? 'converted' : 'not converted');
    }
  }
  if (expect.lootTables && expect.lootTables.length > 0) {
    for (const path of expect.lootTables) {
      const raw = textAt(entries, path);
      const converted = raw ? translateLootTable(raw) : null;
      behaviourExpected += 1;
      if (converted) behaviourEarned += 1;
      assetTotal += 1;
      if (converted) assetKept += 1;
      record(`loot table ${path}`, Boolean(converted), 'Bedrock loot pools', converted ? `converted${converted.droppedFunctions.length > 0 ? `, unsupported functions: ${converted.droppedFunctions.join(', ')}` : ''}` : 'not converted');
    }
  }
  const sourceText = entries.filter(entry => /\.(java|kt|txt)$/i.test(entry.path)).map(entry => {
    try {
      return decoder.decode(entry.data);
    } catch {
      return '';
    }
  }).join('\n');
  if (expect.triggers != null) {
    const triggers = detectEntityTriggers(sourceText).length + (detectBlockInteraction(sourceText).interact ? 1 : 0) + (detectEffectLogic(sourceText) ? 1 : 0);
    behaviourExpected += expect.triggers;
    behaviourEarned += Math.min(expect.triggers, triggers);
    record('behaviour handlers detected', triggers >= expect.triggers, `>= ${expect.triggers} handler(s)`, `${triggers} handler(s)`);
  }
  if (expect.cooldownTicks != null) {
    const ticks = detectCooldownTicks(sourceText);
    behaviourExpected += 1;
    if (ticks === expect.cooldownTicks) behaviourEarned += 1;
    record('cooldown ticks recovered', ticks === expect.cooldownTicks, `${expect.cooldownTicks} ticks`, ticks == null ? 'none detected' : `${ticks} ticks`);
  }
  if (behaviourExpected > 0) {
    const accuracy = percent(behaviourEarned, behaviourExpected);
    if (accuracy != null) metrics.behaviorPreservation = accuracy;
  }

  // Dependency completeness.
  if (expect.parentEdges != null || expect.missingParents != null) {
    const dependencies = buildModelDependencyReport(index);
    const expectedEdges = expect.parentEdges ?? dependencies.edges;
    const resolved = dependencies.edges - dependencies.missingParents.length - dependencies.missingModels.length - dependencies.missingTextures.length - dependencies.unresolvedOverrides.length;
    const completeness = percent(Math.max(0, resolved), Math.max(1, expectedEdges));
    if (completeness != null) metrics.dependencyCompleteness = completeness;
    record('parent/override references tracked', dependencies.edges >= expectedEdges, `>= ${expectedEdges} edge(s)`, `${dependencies.edges} edge(s)`);
    record('unresolved parents reported', dependencies.missingParents.length === (expect.missingParents ?? 0), `${expect.missingParents ?? 0} missing parent(s)`, `${dependencies.missingParents.length} missing parent(s)`);
    void resolved;
  }

  // Asset preservation roll-up — every declared source asset that survived.
  if (expect.itemModels != null) {
    record('item models preserved', geometryPreserved + flatSpriteModels >= (expect.itemModels ?? 0), `${expect.itemModels}`, `${geometryPreserved + flatSpriteModels} (${flatSpriteModels} flat sprite)`);
  }
  if (expect.blockModels != null) {
    const convertedBlocks = Object.keys(geometryFiles).filter(path => path.startsWith('models/blocks/')).length;
    record('block models preserved', convertedBlocks >= (expect.blockModels ?? 0), `${expect.blockModels}`, `${convertedBlocks}`);
  }
  if (assetTotal > 0) {
    const preservation = percent(assetKept, assetTotal);
    if (preservation != null) metrics.assetPreservation = preservation;
  }

  // Pack loading success — the assembled pack is run through the validation pipeline.
  const recipesForBundle = extractAndPortRecipes(modId, items, entries).behaviorPackRecipes;
  const bundle = buildBundle(index, entries, geometryFiles, recipesForBundle, expect.itemIds ?? [], animationFiles, controllerFiles, modId);
  const validation = runAssetValidationPipeline({
    modId,
    playableMode,
    resourcePackFiles: bundle.resourcePackFiles,
    behaviorPackFiles: bundle.behaviorPackFiles,
    items
  });
  const loadingErrors = validation.report.findings.filter(finding => finding.severity === 'error' && finding.resolution !== 'repaired');
  const blockingRootCauses = validation.report.rootCauses.filter(cause => cause.severity === 'error');
  metrics.packLoadingSuccess = loadingErrors.length === 0 ? 100 : Math.max(0, 100 - loadingErrors.length * 20);
  record('pack loads without blocking defects', loadingErrors.length === 0, '0 blocking defect(s)', `${loadingErrors.length} blocking defect(s)`);
  record('manifest passes the Bedrock pack schema', validation.report.schema.passed, '0 schema defect(s)', `${validation.report.schema.defects} schema defect(s)`);
  record('no blocking conversion root cause', blockingRootCauses.length === 0, '0 root cause(s)', `${blockingRootCauses.length} root cause(s) behind ${validation.report.openFindingCount} instance(s)`);
  for (const error of loadingErrors.slice(0, 4)) {
    findings.push(`${error.role}:${error.file} — ${error.detail}`);
  }
  const applicable = Object.values(metrics).filter((value): value is number => typeof value === 'number');
  const allPassed = assertions.every(assertion => assertion.passed);
  const average = applicable.length > 0 ? applicable.reduce((total, value) => total + value, 0) / applicable.length : 0;
  // A fixture only passes when its converted pack is schema-valid and no blocking root cause
  // is left open: a structurally tidy but broken conversion cannot report success.
  const conversionClean = allPassed && validation.report.schema.passed && blockingRootCauses.length === 0;
  const status: RegressionFixtureResult['status'] = conversionClean && average >= 99.5 ? 'passed' : average >= 60 ? 'partial' : 'failed';
  if (expect.notes) findings.unshift(expect.notes);
  if (missingPng.length > 0) {
    findings.push(`${missingPng.length} fixture texture file(s) could not be encoded (no canvas available).`);
  }
  if (index.textures.length === 0 && (expect.textures?.length ?? 0) > 0) {
    findings.push('No texture was decoded from the fixture archive; texture assertions are based on zero decoded files.');
  }
  return {
    id: fixture.id,
    label: fixture.label,
    category: fixture.category,
    status,
    metrics,
    assertions,
    findings,
    unavailable,
    durationMs: Math.round(performance.now() - started),
    blockingDefects: loadingErrors.length
  };
}

function measureAutomaticBoneReconstruction(): RegressionFixtureResult {
  const started = performance.now();
  const files: Record<string, string | Uint8Array> = {
    'models/entity/walker.geo.json': JSON.stringify({
      format_version: '1.12.0',
      'minecraft:geometry': [{
        description: {
          identifier: 'geometry.walker',
          texture_width: 64,
          texture_height: 64,
        },
        bones: [{
          name: 'body',
          pivot: [0, 24, 0],
          cubes: [{ origin: [-4, 0, -2], size: [8, 12, 4], uv: [0, 0] }],
        }, {
          name: 'head',
          parent: 'body',
          pivot: [0, 24, 0],
          cubes: [{ origin: [-4, 12, -4], size: [8, 8, 8], uv: [0, 16] }],
        }],
      }],
    }),
    'entity/walker.entity.json': JSON.stringify({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'regress:walker',
          geometry: { default: 'geometry.walker' },
          animations: { walk: 'animation.walker.walk' },
        },
      },
    }),
    'animations/walker.animation.json': JSON.stringify({
      format_version: '1.8.0',
      animations: {
        'animation.walker.walk': {
          bones: {
            torso: { rotation: [0, 0, 18] },
            left_forearm: { rotation: [0, 0, 12] },
          },
        },
      },
    }),
  };
  const report = retargetBones({ resourcePackFiles: files });
  const geometry = JSON.parse(String(files['models/entity/walker.geo.json'])) as {
    'minecraft:geometry'?: Array<{
      bones?: Array<{ name: string; parent?: string; pivot?: number[] }>;
    }>;
  };
  const clipDocument = JSON.parse(String(files['animations/walker.animation.json'])) as {
    animations?: Record<string, { bones?: Record<string, unknown> }>;
  };
  const geometryBones = geometry['minecraft:geometry']?.[0]?.bones ?? [];
  const bodyPivot = geometryBones.find((bone) => bone.name === 'body')?.pivot ?? [];
  const torso = geometryBones.find((bone) => bone.name === 'torso');
  const tracks = clipDocument.animations?.['animation.walker.walk']?.bones ?? {};
  const checks: RegressionAssertion[] = [{
    label: 'a missing semantically matched torso is rebuilt as its own geometry node',
    expected: 'torso node parented under body, track stays on torso',
    actual: `${torso?.parent ?? 'no injected node'} / ${Object.keys(tracks).join(', ')}`,
    passed: Boolean(torso) && torso.parent === 'body' && Object.hasOwn(tracks, 'torso'),
  }, {
    label: 'a compatible source joint is no longer composed onto its ancestor',
    expected: '0 collapsed tracks',
    actual: `${report.bonesCollapsed.length} collapsed`,
    passed: report.bonesCollapsed.length === 0,
  }, {
    label: 'a forearm with no matching arm bone is never mapped to the head or body',
    expected: 'forearm track reported unresolved and preserved',
    actual: `${Object.keys(tracks).join(', ')}; ${report.unmapped.join(', ')}`,
    passed:
      Object.hasOwn(tracks, 'left_forearm') &&
      !Object.hasOwn(tracks, 'head') &&
      !Object.hasOwn(tracks, 'body') &&
      report.unmapped.some((entry) => entry.endsWith('left_forearm')),
  }, {
    label: 'the generated joint uses the nearest compatible pivot rather than an arbitrary origin',
    expected: JSON.stringify(bodyPivot),
    actual: JSON.stringify(torso?.pivot ?? []),
    passed: Boolean(torso) && JSON.stringify(torso.pivot ?? []) === JSON.stringify(bodyPivot),
  }];
  const failures = checks.filter((check) => !check.passed);
  return {
    id: 'automatic-bone-reconstruction',
    label: 'Automatic bone reconstruction and cross-region retarget guard',
    category: 'Animation',
    status: failures.length === 0 ? 'passed' : 'failed',
    metrics: {},
    assertions: checks,
    findings: failures.map((failure) => `${failure.label}: expected ${failure.expected}, got ${failure.actual}`),
    unavailable: ['Source pivot recovery beyond the converted geometry and live Bedrock playback are not measured.'],
    durationMs: Math.round(performance.now() - started),
  };
}

/** Regression: nested Java AI goals must remain associated with their owning mob. */
function measureNestedMobBehaviorEvidence(): RegressionFixtureResult {
  const started = performance.now();
  const owner = 'com.example.entity.StormWarden';
  const goal = 'com.example.entity.StormWarden$RangedAttackGoal';
  const profile = inferMobBehaviorProfiles(['storm_warden'], [
    {
      className: 'StormWarden',
      qualifiedClassName: owner,
      role: 'entity',
      methods: ['registerGoals', 'getMaxHealth'],
      signals: ['bytecode-signature:hostile'],
    },
    {
      className: 'RangedAttackGoal',
      qualifiedClassName: goal,
      superName: owner,
      role: 'combat',
      methods: ['canUse', 'start', 'tick', 'launchProjectile'],
      signals: ['bytecode-signature:projectile-launch'],
    },
  ])['storm_warden'];
  const checks: RegressionAssertion[] = [
    {
      label: 'nested goal class is attributed to its owning entity',
      expected: goal,
      actual: profile?.sourceClasses.includes(goal) ? goal : 'missing',
      passed: Boolean(profile?.sourceClasses.includes(goal)),
    },
    {
      label: 'projectile behavior from nested goal influences mob profile',
      expected: 'ranged',
      actual: profile?.attack ?? 'missing',
      passed: profile?.attack === 'ranged',
    },
    {
      label: 'bytecode evidence raises behavior confidence',
      expected: 'bytecode-signature',
      actual: profile?.confidence ?? 'missing',
      passed: profile?.confidence === 'bytecode-signature',
    },
  ];
  const failures = checks.filter((check) => !check.passed);
  return {
    id: 'nested-mob-behavior-evidence',
    label: 'Nested mob AI goal ownership and behavior evidence',
    category: 'Behavior',
    status: failures.length === 0 ? 'passed' : 'failed',
    metrics: { behaviorPreservation: failures.length === 0 ? 100 : 0 },
    assertions: checks,
    findings: failures.map((failure) => `${failure.label}: expected ${failure.expected}, got ${failure.actual}`),
    unavailable: [],
    durationMs: Math.round(performance.now() - started),
  };
}

/** Runs the whole regression suite. Never throws: a broken fixture is reported as failed. */
export async function runRegressionSuite(options: RegressionRunOptions = {}): Promise<RegressionSuiteReport> {
  const modId = options.modId ?? DEFAULT_MOD_ID;
  const playableMode = options.playableMode ?? false;
  const log = (line: string) => options.onLog?.(line);
  log('[REGRESSION] Automated regression suite engaged — comparing source evidence with converted output...');
  const fixtures: RegressionFixtureResult[] = await Promise.all(REGRESSION_FIXTURES.map(async (fixture) => {
    try {
      const result = await measureFixture(fixture, modId, playableMode);
      log(`[REGRESSION] ${result.status.toUpperCase()} ${fixture.label} (${result.durationMs} ms).`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[REGRESSION] ERROR ${fixture.label}: ${message}`);
      return {
        id: fixture.id,
        label: fixture.label,
        category: fixture.category,
        status: 'failed' as const,
        metrics: {},
        assertions: [{
          label: 'fixture executed',
          expected: 'no exception',
          actual: message,
          passed: false
        }],
        findings: [`The fixture threw while running: ${message}`],
        unavailable: ['Fixture could not be executed, so none of its metrics were measured.'],
        durationMs: 0
      };
    }
  }));
  // Conversion-specific fixture measurements run through the real modules, never a template.
  const extraFixtures = [
    measureIdentifierNormalization(),
    measureUvConversion(),
    measureSchemaGate(),
    measureRenderControllerSchema(),
    measureAnimationPropertyPolicy(),
    measureSoundConversion(),
    measureGeometryIdentitySync(),
    measureMissingTextureReporting(),
    measurePerFaceUvAcceptance(),
    measureEventDeclarationIntegrity(),
    measureMissingItemIconReporting(),
    measureClientEntityReferencePruning(),
    measurePlayerAnimationBindingPreservation(),
    measurePlayerClipActivationFallback(),
    measureAnimationControllerReferenceGraph(),
    measurePlayerMolangVariableInitialization(),
    measureAutomaticBoneReconstruction(),
    measureContentLogConformance(),
    measureClientEntityLinking(),
    measureSpawnEggSourceIntegration(),
    measureItemModelNormalization(),
    measureNestedMobBehaviorEvidence(),
  ];
  fixtures.push(...extraFixtures);
  for (const extra of extraFixtures) {
    log(`[REGRESSION] ${extra.status.toUpperCase()} ${extra.label} (${extra.durationMs} ms).`);
  }
  const metricIds: RegressionMetricId[] = ['assetPreservation', 'geometryAccuracy', 'uvAccuracy', 'textureAccuracy', 'animationAccuracy', 'behaviorPreservation', 'dependencyCompleteness', 'packLoadingSuccess'];
  const metrics: Partial<Record<RegressionMetricId, number>> = {};
  for (const metricId of metricIds) {
    const values = fixtures.map(fixture => fixture.metrics[metricId]).filter((value): value is number => typeof value === 'number');
    if (values.length === 0) continue;
    metrics[metricId] = Math.round(values.reduce((total, value) => total + value, 0) / values.length);
  }
  const passed = fixtures.filter(fixture => fixture.status === 'passed').length;
  const partial = fixtures.filter(fixture => fixture.status === 'partial').length;
  const failed = fixtures.filter(fixture => fixture.status === 'failed').length;
  const blockingDefects = fixtures.reduce((total, fixture) => total + (fixture.blockingDefects ?? 0), 0);
  const summary = `Regression suite: ${passed}/${fixtures.length} fixture(s) fully passed, ${partial} partial, ${failed} failed; ${blockingDefects} blocking defect(s) remain in the fixture packs. Asset preservation ${metrics.assetPreservation ?? 0}%, geometry ${metrics.geometryAccuracy ?? 0}%, UVs ${metrics.uvAccuracy ?? 0}%, textures ${metrics.textureAccuracy ?? 0}%, behaviour ${metrics.behaviorPreservation ?? 0}%, dependencies ${metrics.dependencyCompleteness ?? 0}%, pack loading ${metrics.packLoadingSuccess ?? 0}%. Validation layers are reported separately: (1) JSON syntax, (2) Bedrock schema, (3) reference integrity, (4) asset preservation, (5) behaviour reconstruction — all five are structural simulation. (6) Actual in-game testing was NOT performed, so none of these figures is a parity or gameplay-compatibility result.`;
  log(`[REGRESSION] ${summary}`);
  return {
    total: fixtures.length,
    passed,
    partial,
    failed,
    metrics,
    fixtures,
    summary,
    simulated: true,
    gameplayCompatibility: 'not-measured'
  };
}