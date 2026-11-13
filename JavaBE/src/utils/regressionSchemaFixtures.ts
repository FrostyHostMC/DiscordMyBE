import assetsData from "@/config/assets";
import type { RegressionAssertion, RegressionFixtureResult } from '@/types/remaker';
import type { PackFile } from '@/utils/entityTextureVariants';
import { isTextureExpression, sanitizeRenderControllers } from '@/utils/renderControllerSchema';
import { collectShippedControllerIds, sanitizeClientEntities } from '@/utils/clientEntitySchema';
import { buildArchiveSoundPack, sanitizeSoundDefinitions } from '@/utils/soundConverter';
import { applyCanonicalGeometryRegistry } from '@/utils/geometryRegistry';
import { rebuildTextureAtlases } from '@/utils/textureAtlasBuilder';
import { scanPackForDefects } from '@/utils/validationRules';
import { enforceItemIconsAndBlockGeometry } from '@/utils/itemIconAtlas';
import { runPostProcessPass } from '@/utils/bedrockPostProcess';
import { runBedrockSchemaGate } from '@/utils/bedrockSchemaGate';
import { resolveScriptDependencySet } from '@/utils/scriptDependencySet';
import { generateMissingClientEntities } from '@/utils/clientEntityGenerator';
import { applySpawnEggPolicy } from '@/utils/spawnEggPolicy';
import { classifyItemModels } from '@/utils/itemModelNormalizer';
import { inspectAnimationControllerGraphs, normalizeEmptyControllerArrays } from '@/utils/animationControllerValidation';
import { reconstructAnimationDependencies } from '@/utils/animationDependencyReconstructor';
import { resolveUniversalVariables } from '@/utils/universalVariableResolver';
import { buildAnimationResourceRegistry } from '@/utils/animationResourceRegistry';
import { auditReferenceIntegrity } from '@/utils/referenceIntegrityAuditor';
import { buildPlayerClientEntity } from '@/utils/playerClientEntity';
import { runPortValidation } from '@/utils/packPortValidator';
import type { ExtractedZipEntry } from '@/utils/zip';

/**
 * Conversion-specific regression fixtures for the content-log error classes.
 *
 * Every fixture runs the REAL converter/sanitiser over a deliberately broken pack and
 * asserts the defect class is gone afterwards. Nothing here is asserted from a template:
 * the values come back out of the documents the modules actually wrote, so a regression
 * fails the fixture instead of passing as a structural no-op.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Minimal PNG header (signature + IHDR size fields) accepted by the dimension readers. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) bytes[index] = PNG_SIGNATURE[index];
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}
function ascii(text: string, padTo = 16): Uint8Array {
  const bytes = new Uint8Array(Math.max(padTo, text.length));
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

/** Real container headers, so the sound converter reads the container it really is. */
function wavPayload(): Uint8Array {
  const bytes = ascii('RIFF', 44);
  bytes.set(ascii('WAVE'), 8);
  return bytes;
}
function parse(files: Record<string, PackFile>, path: string): Record<string, any> | null {
  const raw = files[path];
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    return null;
  }
}
function build(id: string, label: string, category: string, checks: RegressionAssertion[], findings: string[], unavailable: string[], started: number): RegressionFixtureResult {
  const failures = checks.filter(check => !check.passed);
  return {
    id,
    label,
    category,
    status: failures.length === 0 ? 'passed' : 'failed',
    metrics: {},
    assertions: checks,
    findings: [...findings, ...failures.map(failure => `${failure.label}: expected ${failure.expected}, got ${failure.actual}`)],
    unavailable,
    durationMs: Math.round(performance.now() - started)
  };
}

/**
 * 1. Render controller textures — one texture, multiple textures, texture variants and a
 * missing texture must all end as a Bedrock texture ARRAY whose expressions resolve against
 * the owning client entity.
 */
export function measureRenderControllerSchema(): RegressionFixtureResult {
  const started = performance.now();
  const controllerPath = 'render_controllers/alpha.render_controllers.json';
  const files: Record<string, PackFile> = {
    [assetsData.IMAGE_FQCN]: pngHeader(64, 64),
    'entity/alpha.entity.json': JSON.stringify({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'regress:alpha',
          textures: {
            default: 'textures/entity/alpha',
            variant: 'textures/entity/alpha'
          },
          geometry: {
            default: 'geometry.regress_alpha',
            variant: 'geometry.regress_alpha'
          },
          materials: {
            default: 'entity_alphatest'
          }
        }
      }
    }),
    [controllerPath]: JSON.stringify({
      format_version: '1.10.0',
      render_controllers: {
        'controller.render.alpha.single': {
          geometry: 'Geometry.default',
          materials: [{
            '*': 'Material.default'
          }],
          textures: 'Texture.default'
        },
        'controller.render.alpha.multi': {
          geometry: 'Geometry.default',
          materials: [{
            '*': 'Material.default'
          }],
          textures: ['Texture.default', 'Texture.variant']
        },
        'controller.render.alpha.missing': {
          geometry: 'Geometry.default',
          materials: [{
            '*': 'Material.default'
          }],
          textures: ['Texture.default', 'Texture.absent']
        },
        'controller.render.alpha.malformed': {
          geometry: 'Geometry.default',
          materials: [{
            '*': 'Material.default'
          }],
          textures: {
            primary: 'Texture.default'
          }
        }
      }
    })
  };
  const result = sanitizeRenderControllers(files);
  const controllers = parse(files, controllerPath)?.render_controllers ?? {};
  const declaredKeys = ['default', 'variant'];
  const texturesOf = (id: string): unknown => controllers?.[id]?.textures;
  const expressionsOf = (id: string): string[] => {
    const value = texturesOf(id);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  };
  const allExpressions = Object.keys(controllers).flatMap(id => expressionsOf(id));
  const unsupported = allExpressions.filter(entry => !isTextureExpression(entry));
  const undeclared = expressionsOf('controller.render.alpha.missing').filter(entry => {
    const key = entry.replace(/^Texture\./, '');
    return !declaredKeys.includes(key);
  });
  const structurallyValid = Object.keys(controllers).every(id => {
    const controller = controllers[id] ?? {};
    return Array.isArray(controller.textures) && controller.textures.length > 0 && typeof controller.geometry === 'string' && Array.isArray(controller.materials) && controller.materials.length > 0;
  });
  const checks: RegressionAssertion[] = [{
    label: 'a scalar textures value becomes a one-entry array',
    expected: '1 array entry',
    actual: `${expressionsOf('controller.render.alpha.single').length} entr(y/ies)`,
    passed: Array.isArray(texturesOf('controller.render.alpha.single')) && expressionsOf('controller.render.alpha.single').length === 1
  }, {
    label: 'multiple textures are preserved as a multi-entry array',
    expected: 'Texture.default + Texture.variant',
    actual: expressionsOf('controller.render.alpha.multi').join(', ') || 'ABSENT',
    passed: expressionsOf('controller.render.alpha.multi').length === 2 && expressionsOf('controller.render.alpha.multi').includes('Texture.variant')
  }, {
    label: 'a texture the client entity never declares is rebound to a declared key',
    expected: '0 undeclared texture expressions',
    actual: `${undeclared.length} undeclared expression(s)`,
    passed: undeclared.length === 0 && result.textureRefsRepaired >= 1
  }, {
    label: 'a malformed textures object becomes an array instead of an object',
    expected: 'array',
    actual: Array.isArray(texturesOf('controller.render.alpha.malformed')) ? 'array' : 'not an array',
    passed: Array.isArray(texturesOf('controller.render.alpha.malformed'))
  }, {
    label: 'every emitted texture expression is a valid Bedrock expression',
    expected: '0 invalid expression(s)',
    actual: `${unsupported.length} invalid expression(s)`,
    passed: unsupported.length === 0 && allExpressions.length >= 5
  }, {
    label: 'every controller keeps a string geometry and a non-empty materials array',
    expected: '4 structurally valid controllers',
    actual: structurallyValid ? 'all valid' : 'at least one malformed',
    passed: structurallyValid && result.controllersNormalised === 4
  }];
  return build('render-controller-textures', 'Render controller textures (single, multiple, variants, missing)', 'Schema', checks, [], ['In-game rendering of the repaired controllers is not measured by this fixture.'], started);
}

/**
 * 2. Optional animation properties — an entity with no animations must omit both
 * `animations` and `scripts.animate`, and an entity with clips plus two controllers must
 * keep exactly the bindings that resolve to a shipped document.
 */
export function measureAnimationPropertyPolicy(): RegressionFixtureResult {
  const started = performance.now();
  const files: Record<string, PackFile> = {
    'animations/beta.animation.json': JSON.stringify({
      format_version: '1.8.0',
      animations: {
        'animation.beta.idle': {
          loop: true,
          animation_length: 1,
          bones: {
            body: {
              rotation: [0, 0, 0]
            }
          }
        }
      }
    }),
    'animation_controllers/beta.animation_controllers.json': JSON.stringify({
      format_version: '1.10.0',
      animation_controllers: {
        'controller.animation.beta.general': {
          initial_state: 'idle',
          states: {
            idle: {
              animations: ['idle'],
              transitions: [{
                move: 'query.modified_move_speed > 0.1'
              }]
            },
            move: {}
          }
        },
        'controller.animation.beta.attack': {
          initial_state: 'idle',
          states: {
            idle: {},
            attack: {}
          }
        }
      }
    }),
    'entity/alpha.entity.json': JSON.stringify({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'regress:alpha',
          textures: {
            default: 'textures/entity/alpha'
          },
          geometry: {
            default: 'geometry.regress_alpha'
          },
          animations: {},
          scripts: {
            animate: []
          }
        }
      }
    }),
    'entity/beta.entity.json': JSON.stringify({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'regress:beta',
          textures: {
            default: 'textures/entity/beta'
          },
          geometry: {
            default: 'geometry.regress_beta'
          },
          animations: {
            idle: 'animation.beta.idle',
            general: 'controller.animation.beta.general',
            attack: 'controller.animation.beta.attack'
          },
          scripts: {
            animate: ['idle', 'general', 'attack']
          }
        }
      }
    }),
    'entity/gamma.entity.json': JSON.stringify({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'regress:gamma',
          textures: {
            default: 'textures/entity/gamma'
          },
          geometry: {
            default: 'geometry.regress_gamma'
          },
          animations: {
            ghost: 'animation.gamma.ghost'
          },
          scripts: {
            animate: ['ghost']
          },
          sound_effects: {
            ambient: 'regress.mob_ambient'
          }
        }
      }
    })
  };
  const result = sanitizeClientEntities(files);
  const descOf = (mob: string): Record<string, any> => parse(files, `entity/${mob}.entity.json`)?.['minecraft:client_entity']?.description ?? {};
  const alpha = descOf('alpha');
  const beta = descOf('beta');
  const gamma = descOf('gamma');
  const betaAnimations = beta.animations && typeof beta.animations === 'object' ? beta.animations : {};
  const betaAnimate = Array.isArray(beta.scripts?.animate) ? beta.scripts.animate : [];
  const controllers = collectShippedControllerIds(files);
  const checks: RegressionAssertion[] = [{
    label: 'an entity with no animations omits the animations node entirely',
    expected: 'no animations property',
    actual: 'animations' in alpha ? 'empty node shipped' : 'omitted',
    passed: !('animations' in alpha)
  }, {
    label: 'an entity with no animations omits scripts.animate and the empty scripts node',
    expected: 'no scripts property',
    actual: 'scripts' in alpha ? 'empty scripts shipped' : 'omitted',
    passed: !('scripts' in alpha)
  }, {
    label: 'an entity whose only clip does not ship preserves the binding and activation for the final gate',
    expected: 'ghost registration and animate entry remain visible',
    actual: `${'ghost' in gamma.animations ? 'preserved' : 'removed'} / ${Array.isArray(gamma.scripts?.animate) && gamma.scripts.animate.includes('ghost') ? 'activation preserved' : 'activation removed'}`,
    passed: gamma.animations?.ghost === 'animation.gamma.ghost' && Array.isArray(gamma.scripts?.animate) && gamma.scripts.animate.includes('ghost') && result.unresolvedAnimationRefs.length === 1
  }, {
    label: 'an entity with a clip and two controllers keeps all three bindings',
    expected: '3 bindings',
    actual: `${Object.keys(betaAnimations).length} binding(s)`,
    passed: Object.keys(betaAnimations).length === 3
  }, {
    label: 'scripts.animate only binds keys that survive in the animations node',
    expected: 'idle, general, attack',
    actual: betaAnimate.join(', ') || 'ABSENT',
    passed: betaAnimate.length === 3 && betaAnimate.every((key: string) => key in betaAnimations)
  }, {
    label: 'both shipped controllers are resolvable, so neither binding is invented',
    expected: '2 shipped controllers',
    actual: `${controllers.size} controller(s)`,
    passed: controllers.size === 2 && controllers.has('controller.animation.beta.general') && controllers.has('controller.animation.beta.attack')
  }, {
    label: 'the sanitiser reports only empty optional nodes while preserving unresolved animation dependencies',
    expected: '1 empty node, 1 empty animate array, 1 unresolved clip preserved',
    actual: `${result.emptyAnimationNodesRemoved} node(s), ${result.emptyAnimateArraysRemoved} array(s), ${result.unresolvedAnimationRefs.length} unresolved`,
    passed: result.emptyAnimationNodesRemoved === 1 && result.emptyAnimateArraysRemoved === 1 && result.danglingAnimationRefsRemoved === 0 && result.unresolvedAnimationRefs.length === 1
  }, {
    label: 'a custom sound event with no shipped definition is dropped instead of left dangling',
    expected: 'no sound_effects on gamma, 1 dangling event removed',
    actual: `${'sound_effects' in gamma ? 'event shipped' : 'dropped'}, ${result.danglingSoundEventsRemoved} removed`,
    passed: !('sound_effects' in gamma) && result.danglingSoundEventsRemoved === 1
  }];
  return build('animation-property-policy', 'Optional animation properties (zero animations, two controllers)', 'Schema', checks, [], ['Clip playback in a live client is not measured by this fixture.'], started);
}

/**
 * 3. Universal sound conversion — real audio keeps its decodable container, a WAV payload
 * named `.ogg` is stored under `.wav`, an undecodable container is reported, and a Java
 * event identifier is never written as a sound path.
 */
export function measureSoundConversion(): RegressionFixtureResult {
  const started = performance.now();
  const built = buildArchiveSoundPack({
    modId: 'mymod',
    entries: [{
      path: assetsData.AUDIO_RWYF,
      data: ascii('OggS', 64)
    }, {
      path: assetsData.AUDIO_OAXL,
      data: wavPayload()
    }, {
      path: assetsData.AUDIO_HEJW,
      data: ascii('ID3', 64)
    }, {
      path: assetsData.AUDIO_QOKI,
      data: new Uint8Array(0)
    }],
    javaEventIds: ['mymod.custom.chime', 'mob.zombie.say']
  });
  const definitions = (built.definitions as {
    sound_definitions?: Record<string, {
      sounds?: unknown[];
    }>;
  } | null)?.sound_definitions ?? {};
  const names = Object.values(definitions).flatMap(definition => (definition.sounds ?? []).map(entry => typeof entry === 'string' ? entry : typeof (entry as {
    name?: unknown;
  })?.name === 'string' ? String((entry as {
    name?: unknown;
  }).name) : '').filter(Boolean));
  const namesWithExtension = names.filter(name => /\.(ogg|wav|mp3|fsb)$/i.test(name));
  const namesThatAreEvents = names.filter(name => !name.includes('/') && name.includes('.'));
  const pack: Record<string, PackFile> = {
    ...built.files
  };
  if (built.definitions) pack['sounds/sound_definitions.json'] = JSON.stringify(built.definitions, null, 2);
  const sanitized = sanitizeSoundDefinitions(pack);
  const checks: RegressionAssertion[] = [{
    label: 'custom audio is stored under the container the file header declares',
    expected: assetsData.AUDIO_DWFM,
    actual: built.shipped.join(', ') || 'ABSENT',
    passed: built.shipped.includes(assetsData.AUDIO_YVYW) && built.shipped.includes(assetsData.AUDIO_YGZQ)
  }, {
    label: 'a WAV payload named .ogg is not registered as an OGG file',
    expected: assetsData.AUDIO_TOWT,
    actual: built.shipped.includes(assetsData.AUDIO_SIEC) ? assetsData.AUDIO_NQCR : assetsData.AUDIO_OKAF,
    passed: !built.shipped.includes(assetsData.AUDIO_SIEC)
  }, {
    label: 'an undecodable container is reported instead of registered',
    expected: 'MP3 + unreadable header reported',
    actual: built.unsupported.join(' | ') || 'nothing reported',
    passed: built.unsupported.some(entry => entry.includes(assetsData.AUDIO_XBKL)) && built.invalidPaths.some(entry => entry.includes(assetsData.AUDIO_CLWM))
  }, {
    label: 'no sound name carries a file extension',
    expected: '0 names with an extension',
    actual: `${namesWithExtension.length} name(s)`,
    passed: namesWithExtension.length === 0 && names.length > 0
  }, {
    label: 'a Java event identifier is never written as a sound path',
    expected: '0 dotted event names, mob.zombie.say reported unsupported',
    actual: `${namesThatAreEvents.length} event-shaped name(s)`,
    passed: namesThatAreEvents.length === 0 && built.unsupported.some(entry => entry.includes('mob.zombie.say'))
  }, {
    label: 'the shipped definitions pass the sound sanitiser unchanged',
    expected: '0 names fixed, 0 definitions removed, 0 missing audio',
    actual: `${sanitized.namesFixed} fixed, ${sanitized.definitionsRemoved} removed, ${sanitized.invalidPaths.length} missing`,
    passed: sanitized.namesFixed === 0 && sanitized.definitionsRemoved === 0 && sanitized.invalidPaths.length === 0 && sanitized.unsupportedEvents.length === 0
  }];
  return build('sound-conversion', 'Universal sound conversion (custom OGG/WAV audio, Java event ids)', 'Schema', checks, ['Audio playback in a live client is not measured by this fixture — only the registered names and their real files.'], [], started);
}

/**
 * 4. Geometry identity registry — duplicate identifiers are separated and every consumer
 * (client entity, render controller) is re-pointed in the same pass, so a rename can never
 * leave a dangling reference behind.
 */
export function measureGeometryIdentitySync(): RegressionFixtureResult {
  const started = performance.now();
  const model = (bone: string, identifier: string) => JSON.stringify({
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: {
        identifier,
        texture_width: 64,
        texture_height: 64
      },
      bones: [{
        name: bone,
        cubes: [{
          origin: [-4, 0, -4],
          size: [8, 8, 8],
          uv: [0, 0]
        }]
      }]
    }]
  });
  const files: Record<string, PackFile> = {
    'models/entity/alpha.geo.json': model('alpha_body', 'geometry.shared'),
    'models/entity/beta.geo.json': model('beta_body', 'geometry.shared'),
    'entity/alpha.entity.json': JSON.stringify({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'regress:alpha',
          textures: {
            default: 'textures/entity/alpha'
          },
          geometry: {
            default: 'geometry.shared'
          },
          materials: {
            default: 'entity_alphatest'
          },
          render_controllers: ['controller.render.alpha.default']
        }
      }
    }),
    'entity/beta.entity.json': JSON.stringify({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'regress:beta',
          textures: {
            default: 'textures/entity/beta'
          },
          geometry: {
            default: 'geometry.does_not_exist'
          },
          materials: {
            default: 'entity_alphatest'
          }
        }
      }
    }),
    'render_controllers/alpha.render_controllers.json': JSON.stringify({
      format_version: '1.10.0',
      render_controllers: {
        'controller.render.alpha.default': {
          geometry: 'Geometry.missingkey',
          materials: [{
            '*': 'Material.default'
          }],
          textures: ['Texture.default']
        }
      }
    })
  };
  const report = applyCanonicalGeometryRegistry({
    modId: 'regress',
    resourcePackFiles: files
  });
  const declared: string[] = [];
  for (const path of ['models/entity/alpha.geo.json', 'models/entity/beta.geo.json']) {
    const identifier = parse(files, path)?.['minecraft:geometry']?.[0]?.description?.identifier;
    if (typeof identifier === 'string') declared.push(identifier);
  }
  const alphaGeometry = parse(files, 'entity/alpha.entity.json')?.['minecraft:client_entity']?.description?.geometry?.default;
  const betaGeometry = parse(files, 'entity/beta.entity.json')?.['minecraft:client_entity']?.description?.geometry?.default;
  const controllerGeometry = parse(files, 'render_controllers/alpha.render_controllers.json')?.render_controllers?.['controller.render.alpha.default']?.geometry;
  const checks: RegressionAssertion[] = [{
    label: 'two files declaring one identifier are given distinct identifiers',
    expected: '2 unique identifiers',
    actual: declared.join(', ') || 'ABSENT',
    passed: declared.length === 2 && new Set(declared).size === 2
  }, {
    label: 'a client entity keeps resolving to the model it declared',
    expected: declared[0] ?? 'ABSENT',
    actual: String(alphaGeometry ?? 'ABSENT'),
    passed: Boolean(alphaGeometry) && alphaGeometry === declared[0]
  }, {
    label: 'a client entity pointing at an unshipped identifier binds its own shipped model',
    expected: declared[1] ?? 'ABSENT',
    actual: String(betaGeometry ?? 'ABSENT'),
    passed: Boolean(betaGeometry) && betaGeometry === declared[1]
  }, {
    label: 'a render controller geometry key the entity does not declare is rebound',
    expected: 'Geometry.default',
    actual: String(controllerGeometry ?? 'ABSENT'),
    passed: controllerGeometry === 'Geometry.default'
  }, {
    label: 'the registry reports no unresolved geometry reference after repair',
    expected: '0 unresolved',
    actual: `${report.unresolved.length} unresolved`,
    passed: report.unresolved.length === 0 && report.referencesRepaired >= 2
  }, {
    label: 'every declared identifier a consumer references exists in the registry',
    expected: 'all references resolvable',
    actual: `${report.geometries} registered variant(s)`,
    passed: report.geometries === 2 && declared.every(identifier => identifier === alphaGeometry || identifier === betaGeometry)
  }];
  return build('geometry-identity-sync', 'Geometry identity registry (duplicate identifiers, dangling references)', 'Geometry', checks, [], ['Model rendering in a live client is not measured by this fixture.'], started);
}

/**
 * 5. Missing entity textures — an absent skin is reported as UNMATCHED and never replaced
 * by an invented path or a fabricated PNG, while a real skin resolves independently of
 * both texture atlases.
 */
export function measureMissingTextureReporting(): RegressionFixtureResult {
  const started = performance.now();
  const clientEntity = (mobId: string, texture: string) => JSON.stringify({
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: `regress:${mobId}`,
        textures: {
          default: texture
        },
        geometry: {
          default: `geometry.regress_${mobId}`
        },
        materials: {
          default: 'entity_alphatest'
        }
      }
    }
  });
  const files: Record<string, PackFile> = {
    [assetsData.IMAGE_APER]: pngHeader(64, 64),
    'entity/real.entity.json': clientEntity('real', 'textures/entity/real'),
    'entity/absent.entity.json': clientEntity('absent', 'textures/entity/absent')
  };
  const report = rebuildTextureAtlases({
    resourcePackFiles: files
  });
  const absentDescription = parse(files, 'entity/absent.entity.json')?.['minecraft:client_entity']?.description;
  const realDescription = parse(files, 'entity/real.entity.json')?.['minecraft:client_entity']?.description;
  const checks: RegressionAssertion[] = [{
    label: 'a client entity whose skin is absent is reported as UNMATCHED',
    expected: '1 unresolved entity texture',
    actual: `${report.entityTexturesMissing.length} reported`,
    passed: report.entityTexturesMissing.length === 1 && (report.entityTexturesMissing[0] ?? '').startsWith('absent:')
  }, {
    label: 'the absent reference is left exactly as the source declared it',
    expected: 'textures/entity/absent',
    actual: String(absentDescription?.textures?.default ?? 'ABSENT'),
    passed: absentDescription?.textures?.default === 'textures/entity/absent'
  }, {
    label: 'no replacement texture is invented for the absent skin',
    expected: assetsData.IMAGE_YIGA,
    actual: assetsData.IMAGE_EOGO in files ? 'fabricated' : 'not fabricated',
    passed: !(assetsData.IMAGE_EOGO in files)
  }, {
    label: 'a real skin resolves independently of the item and terrain atlases',
    expected: 'textures/entity/real',
    actual: String(realDescription?.textures?.default ?? 'ABSENT'),
    passed: realDescription?.textures?.default === 'textures/entity/real'
  }, {
    label: 'no entity definition path leaks into an atlas entry',
    expected: 'no .entity.json reference in the item atlas',
    actual: String(files['textures/item_texture.json'] ?? '').includes('.entity.json') ? 'entity path in atlas' : 'clean',
    passed: !String(files['textures/item_texture.json'] ?? '').includes('.entity.json')
  }];
  return build('missing-entity-textures', 'Missing entity textures (UNMATCHED reporting, no invented art)', 'Textures', checks, [], ['Texture rendering in a live client is not measured by this fixture.'], started);
}

/**
 * 6. Per-face UV objects — the Bedrock per-face cube UV structure
 * (`{ north: { uv, uv_size }, … }`) must be accepted where the target format supports it.
 * Mirrored faces keep their negative size, and a legacy 4-number face rectangle is
 * translated rather than rejected. The validator may never insist on a 2-number array.
 */
export function measurePerFaceUvAcceptance(): RegressionFixtureResult {
  const started = performance.now();
  const perFacePath = 'models/blocks/perface.geo.json';
  const legacyPath = 'models/blocks/legacy.geo.json';
  const files: Record<string, PackFile> = {
    [perFacePath]: JSON.stringify({
      format_version: '1.12.0',
      'minecraft:geometry': [{
        description: {
          identifier: 'geometry.regress_perface',
          texture_width: 64,
          texture_height: 64
        },
        bones: [{
          name: 'block',
          cubes: [{
            origin: [-8, 0, -8],
            size: [16, 16, 16],
            uv: {
              north: {
                uv: [0, 0],
                uv_size: [16, 16]
              },
              south: {
                uv: [16, 0],
                uv_size: [-16, 16]
              },
              east: {
                uv: [32, 0],
                uv_size: [16, 16]
              },
              west: {
                uv: [48, 0],
                uv_size: [-16, -16]
              },
              up: {
                uv: [0, 16],
                uv_size: [16, 16]
              },
              down: {
                uv: [16, 16],
                uv_size: [16, -16]
              }
            }
          }]
        }]
      }]
    }),
    [legacyPath]: JSON.stringify({
      format_version: '1.12.0',
      'minecraft:geometry': [{
        description: {
          identifier: 'geometry.regress_legacy',
          texture_width: 64,
          texture_height: 64
        },
        bones: [{
          name: 'block',
          cubes: [{
            origin: [-8, 0, -8],
            size: [16, 16, 16],
            faces: {
              north: {
                uv: [0, 0, 16, 16]
              },
              south: {
                uv: [16, 16, 0, 0]
              }
            }
          }]
        }]
      }]
    })
  };
  const rp: Record<string, PackFile> = {
    ...files
  };
  rp['texts/languages.json'] = JSON.stringify(['en_US']);
  rp['texts/en_US.lang'] = 'pack.name=Per-face UV fixture';
  const scan = scanPackForDefects({
    modId: 'regress',
    targetVersion: [1, 21, 0],
    playableMode: false,
    resourcePackFiles: rp,
    behaviorPackFiles: {},
    items: []
  });
  const perFaceFindings = scan.findings.filter(finding => finding.file === perFacePath && finding.check === 'uv');
  const perFaceRejections = perFaceFindings.filter(finding => finding.repair.kind === 'none');
  const legacyFindings = scan.findings.filter(finding => finding.file === legacyPath && finding.check === 'uv');
  const legacyRepairs = legacyFindings.filter(finding => finding.repair.kind === 'uv-face');
  const perFaceDoc = parse(files, perFacePath)?.['minecraft:geometry']?.[0]?.bones?.[0]?.cubes?.[0]?.uv as Record<string, {
    uv?: number[];
    uv_size?: number[];
  }> | undefined;
  const checks: RegressionAssertion[] = [{
    label: 'a per-face cube UV object is accepted as a valid Bedrock structure',
    expected: '0 UV defect(s)',
    actual: `${perFaceFindings.length} defect(s)`,
    passed: perFaceFindings.length === 0
  }, {
    label: 'the per-face structure is not rewritten into a 2-number array',
    expected: 'object with north and south faces',
    actual: perFaceDoc && typeof perFaceDoc === 'object' && !Array.isArray(perFaceDoc) ? `object (${Object.keys(perFaceDoc).join(', ')})` : 'not a per-face object',
    passed: Boolean(perFaceDoc) && !Array.isArray(perFaceDoc) && 'north' in (perFaceDoc as Record<string, unknown>)
  }, {
    label: 'the per-face object keeps every declared face',
    expected: '6 faces',
    actual: perFaceDoc ? `${Object.keys(perFaceDoc).length} face(s)` : 'ABSENT',
    passed: Boolean(perFaceDoc) && Object.keys(perFaceDoc ?? {}).length === 6
  }, {
    label: 'mirrored faces keep their negative uv_size without being clamped',
    expected: 'south -16 and west -16,-16 preserved',
    actual: JSON.stringify(perFaceDoc?.south?.uv_size ?? []),
    passed: perFaceDoc?.south?.uv_size?.[0] === -16 && perFaceDoc?.west?.uv_size?.[1] === -16
  }, {
    label: 'no per-face UV is reported with an unrecoverable rejection',
    expected: '0 unrepairable per-face defect(s)',
    actual: `${perFaceRejections.length} unrepairable`,
    passed: perFaceRejections.length === 0
  }, {
    label: 'a legacy 4-number face rectangle is translated into anchor plus signed size',
    expected: '>= 2 uv-face repair(s)',
    actual: `${legacyRepairs.length} repair(s)`,
    passed: legacyRepairs.length >= 2
  }];
  return build('per-face-uv-schema', 'Per-face UV structure (objects, mirroring, legacy rectangles)', 'Geometry', checks, ['The validator must accept the documented per-face structure; this fixture fails if it ever demands a 2-number cube UV array again.'], ['Live-client sampling of the emitted UVs is not measured by this fixture.'], started);
}

/**
 * 7. Event declarations — every trigger must reference an event the entity declares. An
 * undeclared reference is reported as a dead trigger instead of silently shipping.
 */
export function measureEventDeclarationIntegrity(): RegressionFixtureResult {
  const started = performance.now();
  const entityPath = 'entities/alpha.json';
  const bp: Record<string, PackFile> = {
    [entityPath]: JSON.stringify({
      format_version: '1.21.0',
      'minecraft:entity': {
        description: {
          identifier: 'regress:alpha',
          is_spawnable: true,
          is_summonable: true
        },
        components: {
          'minecraft:health': {
            value: 20
          },
          'minecraft:type_family': {
            family: ['regress']
          },
          'minecraft:custom_trigger': {
            on_hit: {
              event: 'regress:declared'
            },
            on_death: {
              event: 'regress:never_declared'
            }
          }
        },
        events: {
          'regress:declared': {}
        }
      }
    }),
    'texts/languages.json': JSON.stringify(['en_US']),
    'texts/en_US.lang': 'pack.name=Event fixture'
  };
  const rp: Record<string, PackFile> = {
    'texts/languages.json': JSON.stringify(['en_US']),
    'texts/en_US.lang': 'pack.name=Event fixture'
  };
  const scan = scanPackForDefects({
    modId: 'regress',
    targetVersion: [1, 21, 0],
    playableMode: false,
    resourcePackFiles: rp,
    behaviorPackFiles: bp,
    items: []
  });
  const eventFindings = scan.findings.filter(finding => finding.check === 'behavior' && finding.detail.includes('never declares'));
  const undeclared = eventFindings.find(finding => finding.detail.includes('regress:never_declared'));
  const declaredReported = eventFindings.some(finding => finding.detail.includes('"regress:declared"'));
  const checks: RegressionAssertion[] = [{
    label: 'a trigger referencing an undeclared event is reported',
    expected: '1 dead trigger',
    actual: `${eventFindings.length} reported`,
    passed: eventFindings.length === 1 && Boolean(undeclared)
  }, {
    label: 'the finding names the entity and the unresolved event',
    expected: 'regress:alpha->regress:never_declared',
    actual: String(undeclared?.subject ?? 'ABSENT'),
    passed: undeclared?.subject === 'regress:alpha->regress:never_declared'
  }, {
    label: 'a trigger referencing a declared event is not reported',
    expected: 'not reported',
    actual: declaredReported ? 'false positive' : 'not reported',
    passed: !declaredReported
  }];
  return build('event-declaration-integrity', 'Event declaration integrity (dead triggers reported)', 'Behaviour', checks, [], ['Trigger evaluation inside a live client is not measured by this fixture.'], started);
}

/**
 * 8. Missing item icons — an item whose icon cannot resolve to a shipped PNG is reported,
 * and no replacement artwork or atlas entry is invented for it.
 */
export function measureMissingItemIconReporting(): RegressionFixtureResult {
  const started = performance.now();
  const itemPath = 'items/rune.json';
  const rp: Record<string, PackFile> = {
    'textures/item_texture.json': JSON.stringify({
      resource_pack_name: 'vanilla',
      texture_name: 'atlas.items',
      texture_data: {}
    })
  };
  const bp: Record<string, PackFile> = {
    [itemPath]: JSON.stringify({
      format_version: '1.21.0',
      'minecraft:item': {
        description: {
          identifier: 'regress:rune',
          menu_category: {
            category: 'equipment'
          }
        },
        components: {
          'minecraft:icon': {
            texture: 'rune'
          }
        }
      }
    })
  };
  const audit = enforceItemIconsAndBlockGeometry({
    modId: 'regress',
    resourcePackFiles: rp,
    behaviorPackFiles: bp
  });
  const atlas = parse(rp, 'textures/item_texture.json')?.texture_data ?? {};
  const shippedTextures = Object.keys(rp).filter(path => path.startsWith('textures/'));
  const checks: RegressionAssertion[] = [{
    label: 'an icon key without a shipped PNG is reported as missing',
    expected: '1 missing icon',
    actual: `${audit.missingIcons.length} reported`,
    passed: audit.missingIcons.length === 1 && (audit.missingIcons[0] ?? '').includes('regress:rune')
  }, {
    label: 'no atlas entry is invented for the missing icon',
    expected: '0 atlas entries',
    actual: `${Object.keys(atlas).length} atlas entr(y/ies)`,
    passed: !('rune' in atlas) && audit.atlasEntriesAdded === 0
  }, {
    label: 'no replacement PNG is fabricated',
    expected: 'only the atlas document is shipped',
    actual: shippedTextures.join(', ') || 'none',
    passed: shippedTextures.length === 1 && !shippedTextures.some(path => path.endsWith('.png'))
  }, {
    label: 'an icon key that resolves to no shipped texture is removed, not shipped dangling',
    expected: 'no minecraft:icon component, 1 removal reported',
    actual: `${'minecraft:icon' in (parse(bp, itemPath)?.['minecraft:item']?.components ?? {}) ? 'dangling reference shipped' : 'removed'}, ${audit.iconsDropped} removal(s)`,
    passed: !('minecraft:icon' in (parse(bp, itemPath)?.['minecraft:item']?.components ?? {})) && audit.iconsDropped === 1
  }];
  return build('missing-item-icons', 'Missing item icons (reported, never invented)', 'Items', checks, [], ['Creative-menu rendering of the item icon is not measured by this fixture.'], started);
}

/**
 * 9. Client-entity reference preservation — bindings that name missing clips/controllers
 * remain intact for the final export gate, where their broken dependency paths are reported.
 */
export function measureClientEntityReferencePruning(): RegressionFixtureResult {
  const started = performance.now();
  const entityPath = 'entity/delta.entity.json';
  const files: Record<string, PackFile> = {
    'animations/delta.animation.json': JSON.stringify({
      format_version: '1.8.0',
      animations: {
        'animation.delta.idle': {
          loop: true,
          animation_length: 1,
          bones: {
            body: {
              rotation: [0, 0, 0]
            }
          }
        }
      }
    }),
    [entityPath]: JSON.stringify({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'regress:delta',
          textures: {
            default: 'textures/entity/delta'
          },
          geometry: {
            default: 'geometry.regress_delta'
          },
          materials: {
            default: 'entity_alphatest'
          },
          animations: {
            idle: 'animation.delta.idle',
            general: 'controller.animation.delta.general',
            attack: 'animation.delta.attack'
          },
          scripts: {
            animate: ['idle', 'general', 'attack']
          }
        }
      }
    })
  };
  const result = sanitizeClientEntities(files);
  const description = parse(files, entityPath)?.['minecraft:client_entity']?.description ?? {};
  const bound = description.animations && typeof description.animations === 'object' ? description.animations : {};
  const animate = Array.isArray(description.scripts?.animate) ? description.scripts.animate : [];
  const shippedClips = Object.keys(JSON.parse(String(files['animations/delta.animation.json']))?.animations ?? {});
  const checks: RegressionAssertion[] = [{
    label: 'a controller binding without a shipped definition is preserved and reported',
    expected: 'general binding remains; unresolved edge reported',
    actual: `${String(bound.general ?? 'ABSENT')} / ${result.unresolvedAnimationRefs.length} unresolved`,
    passed: bound.general === 'controller.animation.delta.general' && result.unresolvedAnimationRefs.some(entry => entry.includes('general'))
  }, {
    label: 'a clip binding without a shipped definition is preserved and reported',
    expected: 'attack binding remains; unresolved edge reported',
    actual: `${String(bound.attack ?? 'ABSENT')} / ${result.unresolvedAnimationRefs.length} unresolved`,
    passed: bound.attack === 'animation.delta.attack' && result.unresolvedAnimationRefs.some(entry => entry.includes('attack'))
  }, {
    label: 'the binding that resolves to a shipped clip remains intact',
    expected: 'idle → animation.delta.idle',
    actual: String(bound.idle ?? 'ABSENT'),
    passed: bound.idle === 'animation.delta.idle' && shippedClips.includes('animation.delta.idle')
  }, {
    label: 'all original scripts.animate entries remain attached to their registered aliases',
    expected: 'idle, general, attack',
    actual: animate.join(', ') || 'ABSENT',
    passed: JSON.stringify(animate) === JSON.stringify(['idle', 'general', 'attack'])
  }, {
    label: 'unresolved dependencies are reported without deleting registrations or source files',
    expected: '2 unresolved, 0 deleted, 0 files rewritten',
    actual: `${result.unresolvedAnimationRefs.length} unresolved, ${result.danglingAnimationRefsRemoved} deleted, ${result.filesTouched} files rewritten`,
    passed: result.unresolvedAnimationRefs.length === 2 && result.danglingAnimationRefsRemoved === 0 && Object.keys(files).length === 2 && result.filesTouched === 0
  }];
  return build('client-entity-reference-preservation', 'Client entity reference preservation (unresolved dependencies stay visible)', 'Animation', checks, [], ['Live playback is not measured by this fixture.'], started);
}

/**
 * 9. Player animation bindings — vanilla player resources and camera-gated clip bindings must
 * survive cleanup even though the converter does not ship the engine's built-in definitions.
 */
export function measurePlayerAnimationBindingPreservation(): RegressionFixtureResult {
  const started = performance.now();
  const entityPath = 'entity/player.entity.json';
  const files: Record<string, PackFile> = {
    'animations/player.animation.json': JSON.stringify({
      format_version: '1.8.0',
      animations: {
        'animation.player.swing': {
          bones: {
            rightArm: {
              rotation: [0, 0, 0]
            }
          }
        }
      }
    }),
    [entityPath]: JSON.stringify({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'minecraft:player',
          animations: {
            root: 'controller.animation.player.root',
            base_pose: 'animation.player.base_pose',
            humanoid_base_pose: 'animation.humanoid.base_pose',
            look_at_target: 'animation.humanoid.look_at_target',
            cape: 'animation.player.cape',
            first_person_base_pose: 'animation.player.first_person_base_pose',
            first_person_attack_controller: 'controller.animation.player.first_person_attack',
            ported_swing: 'animation.player.swing',
            missing: 'animation.player.missing'
          },
          scripts: {
            animate: ['root', 'humanoid_base_pose', {
              first_person_base_pose: 'query.is_first_person'
            }, {
              first_person_attack_controller: 'query.is_first_person'
            }, {
              ported_swing: 'query.is_first_person && query.is_delayed_attacking'
            }, {
              missing: 'query.is_first_person'
            }]
          }
        }
      }
    })
  };
  const result = sanitizeClientEntities(files);
  const description = parse(files, entityPath)?.['minecraft:client_entity']?.description ?? {};
  const animations = description.animations ?? {};
  const animate = Array.isArray(description.scripts?.animate) ? description.scripts.animate : [];
  const conditional = animate.filter((entry: unknown): entry is Record<string, string> => typeof entry === 'object' && entry !== null && !Array.isArray(entry));
  const conditionalNames = conditional.flatMap(entry => Object.keys(entry));
  const checks: RegressionAssertion[] = [{
    label: 'the vanilla player root controller and base pose survive cleanup',
    expected: 'root + player and humanoid base poses retained',
    actual: `${String(animations.root ?? 'ABSENT')} / ${String(animations.base_pose ?? 'ABSENT')} / ${String(animations.humanoid_base_pose ?? 'ABSENT')}`,
    passed: animations.root === 'controller.animation.player.root' && animations.base_pose === 'animation.player.base_pose' && animations.humanoid_base_pose === 'animation.humanoid.base_pose'
  }, {
    label: 'the built-in first-person hand pose and attack controller survive cleanup',
    expected: 'first-person pose + attack controller retained',
    actual: `${String(animations.first_person_base_pose ?? 'ABSENT')} / ${String(animations.first_person_attack_controller ?? 'ABSENT')}`,
    passed: animations.first_person_base_pose === 'animation.player.first_person_base_pose' && animations.first_person_attack_controller === 'controller.animation.player.first_person_attack'
  }, {
    label: 'a source player clip stays bound while an unresolved clip remains visible for the final gate',
    expected: 'source swing retained, missing reference retained',
    actual: `${String(animations.ported_swing ?? 'ABSENT')} / ${'missing' in animations ? 'missing retained' : 'missing removed'}`,
    passed: animations.ported_swing === 'animation.player.swing' && animations.missing === 'animation.player.missing'
  }, {
    label: 'camera-gated animate objects remain intact for both player views',
    expected: '4 conditional player bindings retained including the unresolved edge',
    actual: conditionalNames.join(', ') || 'none',
    passed: conditional.length === 4 && conditionalNames.includes('first_person_base_pose') && conditionalNames.includes('first_person_attack_controller') && conditionalNames.includes('ported_swing') && conditionalNames.includes('missing')
  }, {
    label: 'the unresolved player dependency is reported without deleting its animation or activation',
    expected: '1 unresolved reference, 0 removals',
    actual: `${result.unresolvedAnimationRefs.length} unresolved / ${result.danglingAnimationRefsRemoved} clip removals / ${result.danglingControllersRemoved} activation removals`,
    passed: result.unresolvedAnimationRefs.length === 1 && result.danglingAnimationRefsRemoved === 0 && result.danglingControllersRemoved === 0
  }];
  return build('player-animation-binding-preservation', 'Player animation binding preservation (vanilla view poses and conditional clips)', 'Animation', checks, [], ['The appearance of the player in a live Bedrock client is not measured by this fixture.'], started);
}
export function measurePlayerClipActivationFallback(): RegressionFixtureResult {
  const started = performance.now();
  const firstClip = 'animation.player.source.first_pose';
  const thirdClip = 'animation.player.source.body_pose';
  const wiring = buildPlayerClientEntity({
    portedClips: {
      [firstClip]: {
        animation_length: 1,
        bones: {
          right_arm: {
            rotation: [0, 0, 0]
          }
        }
      },
      [thirdClip]: {
        animation_length: 1,
        bones: {
          body: {
            rotation: [0, 0, 0]
          }
        }
      }
    },
    triggers: [{
      clipId: firstClip,
      shortName: 'ported_first_pose',
      concept: 'pose-overlay',
      javaEvidence: 'no source trigger recovered',
      status: 'unresolved' as const,
      scriptDriven: false,
      perspective: 'first' as const,
      note: 'No trigger was recovered; use the documented perspective-only fallback.'
    }, {
      clipId: thirdClip,
      shortName: 'ported_body_pose',
      concept: 'pose-overlay',
      javaEvidence: 'no source trigger recovered',
      status: 'unresolved' as const,
      scriptDriven: false,
      perspective: 'third' as const,
      note: 'No trigger was recovered; use the documented perspective-only fallback.'
    }],
    controllerIds: []
  });
  const resourcePackFiles: Record<string, PackFile> = {
    'animations/player.animation.json': JSON.stringify({
      format_version: '1.8.0',
      animations: {
        [firstClip]: {
          bones: {
            right_arm: {
              rotation: [0, 0, 0]
            }
          }
        },
        [thirdClip]: {
          bones: {
            body: {
              rotation: [0, 0, 0]
            }
          }
        }
      }
    }),
    ...wiring.files
  };
  const validation = runPortValidation({
    modId: 'regress',
    resourcePackFiles,
    behaviorPackFiles: {}
  });
  const description = parse(resourcePackFiles, 'entity/player.entity.json')?.['minecraft:client_entity']?.description;
  const animate: unknown[] = Array.isArray(description?.scripts?.animate) ? description.scripts.animate : [];
  const conditionFor = (shortName: string): string => {
    const entry = animate.find(value => value !== null && typeof value === 'object' && !Array.isArray(value) && shortName in value);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
    return String((entry as Record<string, unknown>)[shortName] ?? '');
  };
  const firstCondition = conditionFor('ported_first_pose');
  const thirdCondition = conditionFor('ported_body_pose');
  const checks: RegressionAssertion[] = [{
    label: 'conditionless source clips still receive their documented activation fallback',
    expected: '2 activated, perspective-scoped clips',
    actual: `${wiring.report.clipsActivated} activated, ${wiring.report.unconditionalClips.length} continuous`,
    passed: wiring.report.clipsActivated === 2 && wiring.report.unconditionalClips.length === 2
  }, {
    label: 'the fallback keeps first-person and third-person clips in separate views',
    expected: 'first-person and third-person view gates preserved',
    actual: `${firstCondition || 'ABSENT'} / ${thirdCondition || 'ABSENT'}`,
    passed: firstCondition === 'query.is_first_person' && thirdCondition === '!query.is_first_person'
  }, {
    label: 'final-pack validation resolves both clips to an active player path',
    expected: '0 registered player clips without activation',
    actual: `${validation.playerWiring.clipsWithoutActivationPath.length} without activation`,
    passed: validation.playerWiring.clipsWithoutActivationPath.length === 0
  }];
  return build('player-clip-activation-fallback', 'Player animation activation fallback (unresolved triggers, perspective separation)', 'Animation', checks, [], ['Actual playback in a live Bedrock client is not measured by this structural fixture.'], started);
}

/**
 * 10. Content-log conformance — one full generation pass over a pack that reproduces every
 * defect class the Bedrock client logged on a real port: particle documents with no
 * `minecraft:particle_effect`, a texture-set carrying an entity-era `format_version`, a Java
 * block-sound name, a render controller with an `arrays.skins` bucket, a legacy item icon,
 * a phantom item-atlas entry, and an unpublished script-module version.
 */
export function measureContentLogConformance(): RegressionFixtureResult {
  const started = performance.now();
  const rp: Record<string, PackFile> = {
    'particles/sun_particle.particle.json': JSON.stringify({
      format_version: '1.10.0',
      description: {
        identifier: 'regress:sun_particle'
      },
      components: {
        'minecraft:emitter_rate_instant': {
          num_particles: 4
        }
      }
    }),
    'particles/empty.particle.json': JSON.stringify({
      format_version: '1.10.0',
      description: {
        identifier: 'regress:empty'
      }
    }),
    // A Java particle TEXTURE declaration: sprites only, no lifetime/emitter/motion data. It can
    // never become a Bedrock effect and must not be shipped as a broken one.
    'particles/mob_glow.particle.json': JSON.stringify({
      textures: ['minecraft:particle/mob_glow']
    }),
    [assetsData.IMAGE_LDJY]: pngHeader(16, 16),
    'textures/entity/capac.texture_set.json': JSON.stringify({
      format_version: '1.21.0',
      'minecraft:texture_set': {
        color: 'capac',
        metalness_emissive_roughness: 'capac_mer'
      }
    }),
    'blocks.json': JSON.stringify({
      format_version: [1, 1, 0],
      'regress:block_a': {
        sound: 'normal'
      },
      'regress:block_b': {
        sound: 'cloth'
      }
    }),
    'render_controllers/viraicocha.render_controllers.json': JSON.stringify({
      format_version: '1.10.0',
      render_controllers: {
        'controller.render.regress.viraicocha': {
          geometry: 'Geometry.default',
          materials: [{
            '*': 'Material.default'
          }],
          textures: ['Texture.default'],
          arrays: {
            skins: {
              'array.skins': ['texture.default', 'texture.variant_1']
            }
          }
        }
      }
    }),
    'textures/item_texture.json': JSON.stringify({
      resource_pack_name: 'vanilla',
      texture_name: 'atlas.items',
      texture_data: {
        rune: {
          textures: 'textures/items/rune'
        },
        head_clava_spawn_egg: {
          textures: 'textures/items/head_clava_spawn_egg'
        }
      }
    }),
    [assetsData.IMAGE_QDFQ]: pngHeader(16, 16),
    // A block-only sheet: the item below is a block item whose identifier does not match the
    // texture the block renders with, exactly as Java block/stairs/slab items ship.
    [assetsData.IMAGE_KWNL]: pngHeader(16, 16)
  };
  const bp: Record<string, PackFile> = {
    'items/rune.json': JSON.stringify({
      format_version: '1.21.0',
      'minecraft:item': {
        description: {
          identifier: 'regress:rune',
          menu_category: {
            category: 'equipment'
          }
        },
        components: {
          'minecraft:icon': {
            texture: 'rune'
          }
        }
      }
    }),
    'blocks/mudbrick_stairs_inner.json': JSON.stringify({
      format_version: '1.20.80',
      'minecraft:block': {
        description: {
          identifier: 'regress:mudbrick_stairs_inner',
          menu_category: {
            category: 'construction'
          }
        },
        components: {
          'minecraft:material_instances': {
            '*': {
              texture: 'mudbrick',
              render_method: 'opaque'
            }
          }
        }
      }
    }),
    'items/mudbrick_stairs_inner.json': JSON.stringify({
      format_version: '1.21.50',
      'minecraft:item': {
        description: {
          identifier: 'regress:mudbrick_stairs_inner',
          menu_category: {
            category: 'construction'
          }
        },
        components: {
          'minecraft:block_placer': {
            block: 'regress:mudbrick_stairs_inner'
          },
          'minecraft:icon': {
            textures: {
              default: 'mudbrick_stairs_inner'
            }
          }
        }
      }
    }),
    'scripts/main.js': ['import { world } from "@minecraft/server";', 'import { ActionFormData } from "@minecraft/server-ui";', 'export function register() { void world; void ActionFormData; }'].join('\n'),
    'manifest.json': JSON.stringify({
      format_version: 2,
      header: {
        name: 'Conformance fixture',
        uuid: '10000000-0000-4000-8000-000000000010',
        version: [1, 0, 0],
        min_engine_version: [1, 20, 0]
      },
      modules: [{
        type: 'data',
        uuid: '10000000-0000-4000-8000-000000000011',
        version: [1, 0, 0]
      }],
      dependencies: [{
        module_name: '@minecraft/server',
        version: '1.16.0'
      }, {
        module_name: '@minecraft/server-ui',
        version: '1.16.0'
      }, {
        module_name: '@minecraft/server-bindings',
        version: '1.19.0'
      }]
    })
  };

  // The real export order, so a repair that only works in isolation fails this fixture.
  const postProcess = runPostProcessPass({
    modId: 'regress',
    resourcePackFiles: rp,
    behaviorPackFiles: bp
  });
  runBedrockSchemaGate({
    modId: 'regress',
    resourcePackFiles: rp,
    behaviorPackFiles: bp
  });
  const effect = parse(rp, 'particles/sun_particle.particle.json')?.['minecraft:particle_effect'];
  const textureSet = parse(rp, 'textures/entity/capac.texture_set.json');
  const blocks = parse(rp, 'blocks.json') ?? {};
  const controller = parse(rp, 'render_controllers/viraicocha.render_controllers.json')?.render_controllers?.['controller.render.regress.viraicocha'] ?? {};
  const arrays = controller.arrays ?? {};
  const arrayChildKeys = Object.keys(arrays);
  const skins: unknown[] = Array.isArray(arrays?.textures?.['Array.skins']) ? arrays.textures['Array.skins'] : [];
  const itemRoot = parse(bp, 'items/rune.json')?.['minecraft:item'] ?? {};
  const icon = itemRoot?.components?.['minecraft:icon'];
  const atlas = parse(rp, 'textures/item_texture.json')?.texture_data ?? {};
  const dependencies: Array<{
    module_name?: string;
    version?: string;
  }> = parse(bp, 'manifest.json')?.dependencies ?? [];
  const depVersion = (name: string): string => String(dependencies.find(entry => entry.module_name === name)?.version ?? 'ABSENT');
  // Every icon key the exported pack still declares must resolve through the item atlas to a
  // PNG that really ships. This is the invariant the two reported item log classes
  // ("Missing referenced asset" and "requires either an icon atlas or icon texture") break.
  const iconKeyOfItem = (doc: any): string => {
    const icon = doc?.['minecraft:item']?.components?.['minecraft:icon'];
    if (typeof icon === 'string') return icon;
    if (typeof icon?.texture === 'string') return icon.texture;
    return typeof icon?.textures?.default === 'string' ? icon.textures.default : '';
  };
  const danglingIconKeys: string[] = [];
  for (const path of Object.keys(bp).filter(entry => /^items\/[^/]+\.json$/i.test(entry))) {
    const key = iconKeyOfItem(parse(bp, path));
    if (!key) continue;
    const entry = atlas[key] as {
      textures?: unknown;
    } | string | undefined;
    const reference = typeof entry === 'string' ? entry : typeof (entry as {
      textures?: unknown;
    })?.textures === 'string' ? String((entry as {
      textures: string;
    }).textures) : '';
    const bytes = reference ? rp[`${reference.replace(/\.png$/i, '')}.png`] : undefined;
    if (!(bytes instanceof Uint8Array)) danglingIconKeys.push(`${path} -> ${key}`);
  }
  // Direct unit pass: the exact collision the engine reported — a UI module declared ABOVE
  // the @minecraft/server track it extends. With an engine floor that would otherwise allow
  // the UI 2.x major, the resolver must walk the UI module back inside the server's track.
  const trackCollision = resolveScriptDependencySet({
    dependencies: [{
      module_name: '@minecraft/server',
      version: '1.16.0'
    }, {
      module_name: '@minecraft/server-ui',
      version: '2.3.0'
    }],
    importedModules: ['@minecraft/server', '@minecraft/server-ui'],
    minEngineVersion: [1, 21, 0]
  });
  const trackCollisionUi = trackCollision.dependencies.find(dep => dep.module_name === '@minecraft/server-ui')?.version;
  const checks: RegressionAssertion[] = [{
    label: 'a particle document without particle_effect is re-rooted so it loads',
    expected: 'minecraft:particle_effect with identifier and components',
    actual: effect ? `identifier ${String(effect?.description?.identifier ?? 'ABSENT')}` : 'still unrooted',
    passed: Boolean(effect) && typeof effect?.description?.identifier === 'string' && Boolean(effect?.components) && postProcess.particleDocumentsRepaired === 1
  }, {
    label: 'a particle document with no components is dropped and reported, never invented',
    expected: '1 document dropped',
    actual: `${postProcess.particleDocumentsDropped?.length ?? 0} dropped`,
    passed: !('particles/empty.particle.json' in rp) && (postProcess.particleDocumentsDropped?.length ?? 0) === 1
  }, {
    label: 'a texture-set format_version the texture schema cannot read is corrected',
    expected: '1.16.100',
    actual: String(textureSet?.format_version ?? 'ABSENT'),
    passed: textureSet?.format_version === '1.16.100' && postProcess.textureSetVersionsFixed === 1
  }, {
    label: 'a Java block sound name is mapped to a Bedrock block sound',
    expected: 'normal -> stone, cloth unchanged',
    actual: `${String(blocks['regress:block_a']?.sound ?? 'ABSENT')} / ${String(blocks['regress:block_b']?.sound ?? 'ABSENT')}`,
    passed: blocks['regress:block_a']?.sound === 'stone' && blocks['regress:block_b']?.sound === 'cloth' && postProcess.blockSoundTypesFixed === 1
  }, {
    label: 'an arrays bucket the controller schema rejects is moved into a valid category',
    expected: 'textures/Array.skins only',
    actual: arrayChildKeys.join(', ') || 'ABSENT',
    passed: arrayChildKeys.length === 1 && arrayChildKeys[0] === 'textures' && Array.isArray(skins)
  }, {
    label: 'the moved array entries become valid Bedrock texture expressions',
    expected: 'Texture.default + Texture.variant_1',
    actual: skins.join(', ') || 'ABSENT',
    passed: skins.includes('Texture.default') && skins.includes('Texture.variant_1') && skins.every(entry => typeof entry === 'string')
  }, {
    label: 'a UI module major above the @minecraft/server track is walked back so both share one release track',
    expected: '@minecraft/server 1.16.0 with @minecraft/server-ui inside the 1.x track',
    actual: `server-ui ${String(trackCollisionUi ?? 'ABSENT')} / ${trackCollision.fixes.length} fix(es)`,
    passed: trackCollisionUi === '1.3.0' && trackCollision.dependencies.find(dep => dep.module_name === '@minecraft/server')?.version === '1.16.0'
  }, {
    label: 'a legacy item icon is written in the modern schema form',
    expected: '{"textures":{"default":"rune"}}',
    actual: JSON.stringify(icon ?? null),
    passed: JSON.stringify(icon) === JSON.stringify({
      textures: {
        default: 'rune'
      }
    }) && Boolean(atlas.rune)
  }, {
    label: 'an atlas entry pointing at an unshipped texture is pruned, not shipped dangling',
    expected: 'no head_clava_spawn_egg entry',
    actual: 'head_clava_spawn_egg' in atlas ? 'phantom entry shipped' : 'pruned',
    passed: !('head_clava_spawn_egg' in atlas)
  }, {
    label: 'each script module keeps the version ITS OWN list publishes',
    expected: '@minecraft/server 1.16.0, @minecraft/server-ui 1.3.0',
    actual: `${depVersion('@minecraft/server')} / ${depVersion('@minecraft/server-ui')}`,
    passed: depVersion('@minecraft/server') === '1.16.0' && depVersion('@minecraft/server-ui') === '1.3.0'
  }, {
    label: 'a derived script module is aligned to the module it belongs to',
    expected: '@minecraft/server-bindings == @minecraft/server',
    actual: `${depVersion('@minecraft/server-bindings')} vs ${depVersion('@minecraft/server')}`,
    passed: depVersion('@minecraft/server-bindings') === depVersion('@minecraft/server') && depVersion('@minecraft/server') === '1.16.0'
  }, {
    label: 'a Java particle texture declaration never ships as a broken effect',
    expected: 'document removed from particles/, 1 declaration reported, sprite kept',
    actual: `${'particles/mob_glow.particle.json' in rp ? 'still shipped' : 'removed'} / ${postProcess.particleTextureDeclarationsRemoved?.length ?? 0} reported`,
    passed: !('particles/mob_glow.particle.json' in rp) && (postProcess.particleTextureDeclarationsRemoved?.length ?? 0) === 1 && rp[assetsData.IMAGE_LDJY] instanceof Uint8Array
  }, {
    label: 'a block-derived item whose sheet name drifted from its identifier still resolves an icon',
    expected: 'one shipped PNG behind the mudbrick_stairs_inner icon key',
    actual: `${String((atlas.mudbrick_stairs_inner as {
      textures?: unknown;
    } | undefined)?.textures ?? 'NO ATLAS ENTRY')}`,
    passed: Boolean((atlas.mudbrick_stairs_inner as {
      textures?: unknown;
    } | undefined)?.textures)
  }, {
    label: 'no shipped item is left with an icon key the item atlas cannot resolve',
    expected: '0 dangling icon key(s)',
    actual: danglingIconKeys.length === 0 ? 'none' : danglingIconKeys.join(', '),
    passed: danglingIconKeys.length === 0
  }];
  return build('content-log-conformance', 'Content-log conformance (particles, texture sets, block sounds, controller arrays, icons, module versions)', 'Schema', checks, [], ['Loading the repaired pack in a live Bedrock client is not measured by this fixture.'], started);
}

/**
 * 15. Client entity linking — a behaviour entity with no client entity has no visual
 * definition and renders invisible in game. The linker must generate that file from the model
 * and skin the pack really ships, and must never invent one when either is absent.
 */
export function measureClientEntityLinking(): RegressionFixtureResult {
  const started = performance.now();
  const entityDoc = (identifier: string) => JSON.stringify({
    format_version: '1.21.0',
    'minecraft:entity': {
      description: {
        identifier,
        is_spawnable: true,
        is_summonable: true
      },
      components: {
        'minecraft:health': {
          value: 20
        }
      }
    }
  });
  const rp: Record<string, PackFile> = {
    'models/entity/capac.geo.json': JSON.stringify({
      format_version: '1.12.0',
      'minecraft:geometry': [{
        description: {
          identifier: 'geometry.inka_capac',
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
    }),
    [assetsData.IMAGE_RDSE]: pngHeader(64, 64)
  };
  const bp: Record<string, PackFile> = {
    'entities/capac.json': entityDoc('inka:capac'),
    'entities/ghost.json': entityDoc('inka:ghost')
  };
  const report = generateMissingClientEntities({
    modId: 'inka',
    resourcePackFiles: rp,
    behaviorPackFiles: bp
  });
  const description = parse(rp, 'entity/capac.entity.json')?.['minecraft:client_entity']?.description;
  const second = generateMissingClientEntities({
    modId: 'inka',
    resourcePackFiles: rp,
    behaviorPackFiles: bp
  });
  const checks: RegressionAssertion[] = [{
    label: 'a behaviour entity without a client entity gets one generated',
    expected: 'inka:capac bound in entity/capac.entity.json',
    actual: String(description?.identifier ?? 'ABSENT'),
    passed: description?.identifier === 'inka:capac' && report.created === 1
  }, {
    label: 'the generated geometry reference is an identifier a shipped model declares',
    expected: 'geometry.inka_capac',
    actual: String(description?.geometry?.default ?? 'ABSENT'),
    passed: description?.geometry?.default === 'geometry.inka_capac'
  }, {
    label: 'the generated texture reference resolves to a PNG the pack ships',
    expected: 'textures/entity/capac',
    actual: String(description?.textures?.default ?? 'ABSENT'),
    passed: description?.textures?.default === 'textures/entity/capac' && rp[assetsData.IMAGE_RDSE] instanceof Uint8Array
  }, {
    label: 'the material follows the shipped skin header and a vanilla render controller is bound',
    expected: 'entity_alphatest + controller.render.default',
    actual: `${String(description?.materials?.default ?? 'ABSENT')} / ${(description?.render_controllers ?? []).join(', ') || 'ABSENT'}`,
    passed: description?.materials?.default === 'entity_alphatest' && Array.isArray(description?.render_controllers) && description.render_controllers[0] === 'controller.render.default'
  }, {
    label: 'an entity with no model and no skin is reported, never given an invented rig',
    expected: 'inka:ghost unresolved and no file written',
    actual: `${report.unresolved.join(' | ') || 'nothing reported'} / ${'entity/ghost.entity.json' in rp ? 'file written' : 'no file'}`,
    passed: report.unresolved.some(entry => entry.startsWith('inka:ghost')) && !('entity/ghost.entity.json' in rp)
  }, {
    label: 'the linker is idempotent, so a second pass writes nothing new',
    expected: '0 created on the second run',
    actual: `${second.created} created`,
    passed: second.created === 0
  }];
  return build('client-entity-linking', 'Client entity linking (invisible mobs, no invented rigs)', 'Schema', checks, [], ['Rendering the generated client entity in a live client is not measured by this fixture.'], started);
}
export function measureSpawnEggSourceIntegration(): RegressionFixtureResult {
  const started = performance.now();
  const encoder = new TextEncoder();
  const entries: ExtractedZipEntry[] = Array.from({
    length: 401
  }, (_, index) => {
    const data = encoder.encode('class Unrelated {}');
    return {
      path: `source/Unused${index}.java`,
      data,
      isDirectory: false,
      uncompressedSize: data.length
    };
  });
  const registryCode = encoder.encode('new SpawnEggItem(one_mob, 0x123456, 0x654321);');
  entries.push({
    path: 'source/SpawnEggRegistry.java',
    data: registryCode,
    isDirectory: false,
    uncompressedSize: registryCode.length
  });
  const entityDoc = (identifier: string) => JSON.stringify({
    format_version: '1.20.80',
    'minecraft:entity': {
      description: {
        identifier,
        is_spawnable: false,
        is_summonable: false
      }
    }
  });
  const clientDoc = (identifier: string) => JSON.stringify({
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier
      }
    }
  });
  const resourcePackFiles: Record<string, PackFile> = {
    'entity/one_mob.entity.json': clientDoc('sample:one_mob'),
    'entity/no_egg.entity.json': clientDoc('sample:no_egg'),
    [assetsData.IMAGE_FJGP]: pngHeader(16, 16),
    'textures/item_texture.json': JSON.stringify({
      texture_data: {
        one_mob_spawn_egg: {
          textures: 'textures/items/one_mob_spawn_egg'
        }
      }
    })
  };
  const behaviorPackFiles: Record<string, PackFile> = {
    'entities/one_mob.json': entityDoc('sample:one_mob'),
    'entities/no_egg.json': entityDoc('sample:no_egg'),
    'items/one_mob_spawn_egg.json': JSON.stringify({
      'minecraft:item': {
        description: {
          identifier: 'sample:one_mob_spawn_egg'
        },
        components: {
          'minecraft:entity_placer': {
            entity: 'sample:one_mob'
          }
        }
      }
    })
  };
  const report = applySpawnEggPolicy({
    entries,
    resourcePackFiles,
    behaviorPackFiles,
    playableMode: false
  });
  const registeredEntity = parse(behaviorPackFiles, 'entities/one_mob.json')?.['minecraft:entity']?.description;
  const unregisteredEntity = parse(behaviorPackFiles, 'entities/no_egg.json')?.['minecraft:entity']?.description;
  const registeredClient = parse(resourcePackFiles, 'entity/one_mob.entity.json')?.['minecraft:client_entity']?.description;
  const unregisteredClient = parse(resourcePackFiles, 'entity/no_egg.entity.json')?.['minecraft:client_entity']?.description;
  const atlas = parse(resourcePackFiles, 'textures/item_texture.json')?.texture_data ?? {};
  const checks: RegressionAssertion[] = [{
    label: 'a source egg registration after many unrelated classes is still discovered',
    expected: 'one_mob registration with source colors',
    actual: `${report.registrations} registration(s), ${String(registeredClient?.spawn_egg?.base_color ?? 'no base')} / ${String(registeredClient?.spawn_egg?.overlay_color ?? 'no overlay')}`,
    passed: report.registrations === 1 && registeredClient?.spawn_egg?.base_color === '#123456' && registeredClient?.spawn_egg?.overlay_color === '#654321'
  }, {
    label: 'the registered behavior entity is made spawnable without changing unrelated entities',
    expected: 'one_mob true, no_egg false',
    actual: `${String(registeredEntity?.is_spawnable)} / ${String(unregisteredEntity?.is_spawnable)}`,
    passed: registeredEntity?.is_spawnable === true && unregisteredEntity?.is_spawnable === false
  }, {
    label: 'the source egg uses entity colors instead of a duplicate standalone item or egg art',
    expected: 'no entity-placer item, icon texture, or atlas entry',
    actual: `${'items/one_mob_spawn_egg.json' in behaviorPackFiles ? 'item remains' : 'item removed'} / ${assetsData.IMAGE_FJGP in resourcePackFiles ? 'art remains' : 'art removed'} / ${'one_mob_spawn_egg' in atlas ? 'atlas remains' : 'atlas pruned'}`,
    passed: !('items/one_mob_spawn_egg.json' in behaviorPackFiles) && !(assetsData.IMAGE_FJGP in resourcePackFiles) && !('one_mob_spawn_egg' in atlas)
  }];
  return build('spawn-egg-source-integration', 'Spawn egg source registration (mob spawnability, colors, large class lists)', 'Entities', checks, [], ['Live creative-menu visibility is not measured by this structural fixture.'], started);
}

/**
 * 16. Java item-model normalisation — the source model's own `parent` pointer decides whether
 * an item is a flat sprite (registered through item_texture.json) or a cube (rendered through
 * its block sheet), and the sheet it declares is bound before any name-based guess.
 */
export function measureItemModelNormalization(): RegressionFixtureResult {
  const started = performance.now();
  const encoder = new TextEncoder();
  const doc = (value: unknown) => encoder.encode(JSON.stringify(value));
  const entries = [{
    path: 'assets/mymod/models/item/rune_blade.json',
    data: doc({
      parent: 'item/handheld',
      textures: {
        layer0: 'mymod:item/ancient_etching'
      }
    })
  }, {
    path: 'assets/mymod/models/item/gold_face.json',
    data: doc({
      parent: 'mymod:block/gold_face_block'
    })
  }, {
    path: 'assets/mymod/models/block/gold_face_block.json',
    data: doc({
      parent: 'block/cube_all',
      textures: {
        all: 'mymod:block/gold_face'
      }
    })
  }, {
    path: 'assets/mymod/models/item/broken.json',
    data: doc({
      credit: 'declares neither a parent nor a texture'
    })
  }] as ExtractedZipEntry[];
  const models = classifyItemModels(entries);
  const runeBlade = models.get('rune_blade');
  const goldFace = models.get('gold_face');
  const broken = models.get('broken');
  const rp: Record<string, PackFile> = {
    [assetsData.IMAGE_IWBM]: pngHeader(16, 16),
    [assetsData.IMAGE_LZSV]: pngHeader(16, 16)
  };
  const bp: Record<string, PackFile> = {
    'items/rune_blade.json': JSON.stringify({
      format_version: '1.21.30',
      'minecraft:item': {
        description: {
          identifier: 'mymod:rune_blade'
        },
        components: {}
      }
    }),
    'items/gold_face.json': JSON.stringify({
      format_version: '1.21.30',
      'minecraft:item': {
        description: {
          identifier: 'mymod:gold_face'
        },
        components: {}
      }
    }),
    'blocks/gold_face_block.json': JSON.stringify({
      format_version: '1.21.30',
      'minecraft:block': {
        description: {
          identifier: 'mymod:gold_face_block'
        },
        components: {}
      }
    })
  };
  const audit = enforceItemIconsAndBlockGeometry({
    modId: 'mymod',
    resourcePackFiles: rp,
    behaviorPackFiles: bp,
    itemModels: models
  });
  const atlas = (parse(rp, 'textures/item_texture.json')?.texture_data ?? {}) as Record<string, {
    textures?: unknown;
  }>;
  const iconOf = (path: string): string => {
    const icon = parse(bp, path)?.['minecraft:item']?.components?.['minecraft:icon'];
    return typeof icon?.textures?.default === 'string' ? icon.textures.default : '';
  };
  const atlasSheet = (key: string): string => {
    const value = atlas[key]?.textures;
    return typeof value === 'string' ? value : '';
  };
  const iconResolves = (key: string): boolean => {
    const sheet = atlasSheet(key);
    return Boolean(sheet) && rp[`${sheet}.png`] instanceof Uint8Array;
  };
  const checks: RegressionAssertion[] = [{
    label: 'an item/generated parent classifies the item as a flat sprite',
    expected: 'flat',
    actual: String(runeBlade?.kind ?? 'ABSENT'),
    passed: runeBlade?.kind === 'flat'
  }, {
    label: 'a block parent classifies the item as a cube model',
    expected: 'block',
    actual: String(goldFace?.kind ?? 'ABSENT'),
    passed: goldFace?.kind === 'block'
  }, {
    label: 'a model with neither sprite nor parent is reported as unresolved',
    expected: 'unresolved',
    actual: String(broken?.kind ?? 'ABSENT'),
    passed: broken?.kind === 'unresolved'
  }, {
    label: 'the declared layer0 sheet is carried to the sprite tile the model names',
    expected: 'textures/items/ancient_etching',
    actual: String(runeBlade?.sheets?.[0] ?? 'ABSENT'),
    passed: runeBlade?.sheets?.[0] === 'textures/items/ancient_etching'
  }, {
    label: 'a flat item whose own name matches no sheet still gets an icon from its model declaration',
    expected: 'rune_blade icon resolves to a shipped PNG',
    actual: `${iconOf('items/rune_blade.json') || 'NO ICON'} -> ${atlasSheet('rune_blade') || 'NO ATLAS ENTRY'}`,
    passed: iconOf('items/rune_blade.json') === 'rune_blade' && iconResolves('rune_blade')
  }, {
    label: 'a block-backed item binds the block face sheet its model declares',
    expected: 'gold_face icon resolves to a shipped PNG',
    actual: `${iconOf('items/gold_face.json') || 'NO ICON'} -> ${atlasSheet('gold_face') || 'NO ATLAS ENTRY'}`,
    passed: iconOf('items/gold_face.json') === 'gold_face' && iconResolves('gold_face')
  }, {
    label: 'the audit reports the cube model and no missing block for it',
    expected: '1 block-backed item, 0 items without a block',
    actual: `${audit.blockBackedItems} block-backed, ${audit.blockBackedWithoutBlock.length} without a block`,
    passed: audit.blockBackedItems === 1 && audit.blockBackedWithoutBlock.length === 0
  }, {
    label: 'no item is left without a resolvable icon by the model pass',
    expected: '0 items without an icon',
    actual: `${audit.missingIcons.length} reported`,
    passed: audit.missingIcons.length === 0
  }];
  return build('item-model-normalization', 'Java item-model normalisation (flat sprites, block-backed cubes)', 'Schema', checks, [], ['In-game item rendering is not measured by this fixture.'], started);
}
export function measureAnimationControllerReferenceGraph(): RegressionFixtureResult {
  const started = performance.now();
  const controllerId = 'controller.animation.regress.player.states';
  const controllerPath = 'animation_controllers/player.states.animation_controllers.json';
  const files: Record<string, PackFile> = {
    'animations/player.animation.json': JSON.stringify({
      format_version: '1.8.0',
      animations: {
        'animation.regress.player.walk': {
          animation_length: 1,
          bones: {
            body: {
              rotation: [0, 0, 0]
            }
          }
        }
      }
    }),
    [controllerPath]: JSON.stringify({
      format_version: '1.10.0',
      animation_controllers: {
        [controllerId]: {
          initial_state: 'base',
          states: {
            base: {
              transitions: [{
                walking: 'query.modified_move_speed > 0.05'
              }, {
                running: 'query.is_sprinting'
              }]
            },
            walking: {
              animations: ['walk_cycle'],
              transitions: [{
                base: 'query.modified_move_speed <= 0.05'
              }]
            },
            running: {
              animations: ['walk_cycle'],
              transitions: [{
                base: '!query.is_sprinting'
              }]
            }
          }
        }
      }
    }),
    'entity/player.entity.json': JSON.stringify({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'minecraft:player',
          geometry: {
            default: 'geometry.humanoid.custom'
          },
          animations: {
            walk_cycle: 'animation.regress.player.walk',
            player_states: controllerId
          },
          render_controllers: ['controller.render.player.third_person'],
          scripts: {
            animate: ['player_states']
          }
        }
      }
    })
  };
  const audit = auditReferenceIntegrity({
    modId: 'regress',
    resourcePackFiles: files
  });
  const normalization = normalizeEmptyControllerArrays(files);
  const graphIssues = inspectAnimationControllerGraphs(files);
  const dependencies = reconstructAnimationDependencies({
    resourcePackFiles: files
  });
  const registry = buildAnimationResourceRegistry({
    resourcePackFiles: files
  });
  const controllerDoc = parse(files, controllerPath)?.animation_controllers?.[controllerId];
  const orderedTargets = controllerDoc?.states?.base?.transitions?.map((transition: Record<string, string>) => Object.keys(transition)[0]) ?? [];
  const stateAnimations = controllerDoc?.states?.walking?.animations ?? [];
  const invalidFiles: Record<string, PackFile> = {
    ...files,
    'animation_controllers/invalid.animation_controllers.json': JSON.stringify({
      format_version: '1.10.0',
      animation_controllers: {
        'controller.animation.regress.invalid': {
          initial_state: 'base',
          states: {
            base: {
              transitions: [{
                ghost: 'query.is_moving'
              }]
            },
            quiet: {
              transitions: []
            }
          }
        }
      }
    })
  };
  const invalidNormalization = normalizeEmptyControllerArrays(invalidFiles);
  const invalidController = parse(invalidFiles, 'animation_controllers/invalid.animation_controllers.json')?.animation_controllers?.['controller.animation.regress.invalid'];
  const invalidGraphReported = inspectAnimationControllerGraphs(invalidFiles).some(issue => issue.detail.includes('does not exist'));
  const checks: RegressionAssertion[] = [{
    label: 'reference auditing preserves ordered transition arrays instead of deleting numeric array keys',
    expected: 'walking, running in source order',
    actual: orderedTargets.join(', ') || 'ABSENT',
    passed: JSON.stringify(orderedTargets) === JSON.stringify(['walking', 'running'])
  }, {
    label: 'empty optional controller arrays are omitted without touching non-empty transitions',
    expected: '0 empty arrays omitted, transitions preserved',
    actual: `${normalization.emptyTransitionsOmitted} transition array(s), ${normalization.emptyAnimationsOmitted} animation array(s) omitted`,
    passed: normalization.emptyTransitionsOmitted === 0 && normalization.emptyAnimationsOmitted === 0
  }, {
    label: 'valid destinations and state reachability pass final graph validation',
    expected: '0 controller graph issues',
    actual: `${graphIssues.length} issue(s)`,
    passed: graphIssues.length === 0
  }, {
    label: 'controller state animation names resolve through the owning entity alias map',
    expected: 'animation.regress.player.walk registered and controller-activated',
    actual: `${registry.metrics.clipsRegistered} registered, ${registry.metrics.clipsActivatedByController} controller-activated`,
    passed: stateAnimations[0] === 'walk_cycle' && registry.metrics.clipsRegistered === 1 && registry.metrics.clipsActivatedByController === 1
  }, {
    label: 'the dependency audit resolves the alias to its actual clip definition',
    expected: '0 unresolved controller animation references',
    actual: `${dependencies.unresolvedControllerAnimationRefs.length} unresolved`,
    passed: dependencies.unresolvedControllerAnimationRefs.length === 0 && audit.animationRefsUnresolved.length === 0
  }, {
    label: 'a transition to an absent destination is detected rather than repaired or ignored',
    expected: 'missing destination reported',
    actual: invalidGraphReported ? 'reported' : 'not reported',
    passed: invalidGraphReported
  }];
  return build('animation-controller-reference-graph', 'Animation controller graph (transition preservation, aliases, activation)', 'Animation', checks, [], ['Live Minecraft playback is not measured by this structural fixture.'], started);
}
export function measurePlayerMolangVariableInitialization(): RegressionFixtureResult {
  const started = performance.now();
  const controllerId = 'controller.animation.sample.player_rig';
  const files: Record<string, PackFile> = {
    'animations/sample.animation.json': JSON.stringify({
      format_version: '1.8.0',
      animations: {
        'animation.sample.equipment_pose': {
          bones: {
            body: {
              rotation: {
                '0.0': ['variable.helmet_layer_visible', 'variable.chest_layer_visible', 'variable.leg_layer_visible', 'variable.boot_layer_visible']
              }
            }
          }
        }
      }
    }),
    'animation_controllers/sample.animation_controllers.json': JSON.stringify({
      format_version: '1.10.0',
      animation_controllers: {
        'controller.animation.sample.player_rig': {
          initial_state: 'base',
          states: {
            base: {
              animations: ['ported_clip']
            }
          }
        }
      }
    }),
    'entity/player.entity.json': JSON.stringify({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'minecraft:player',
          animations: {
            ported_clip: 'animation.sample.equipment_pose',
            ported_controller: controllerId
          },
          scripts: {
            animate: ['ported_controller']
          }
        }
      }
    })
  };
  const report = resolveUniversalVariables({
    resourcePackFiles: files,
    behaviorPackFiles: {}
  });
  const preAnimation = parse(files, 'entity/player.entity.json')?.['minecraft:client_entity']?.description?.scripts?.pre_animation ?? [];
  const assignments = Array.isArray(preAnimation) ? preAnimation : [];
  const required = ['variable.helmet_layer_visible', 'variable.chest_layer_visible', 'variable.leg_layer_visible', 'variable.boot_layer_visible'];
  // Armour presence has to be a query signature the engine really accepts: `is_item_name_any` needs
  // at least one item name, so "is this slot worn" uses the slot-occupancy form of
  // `get_equipped_item_name(slot, index)`. It stays live — never a constant — and the arity of every
  // emitted item query is asserted below.
  const dynamicEquipmentQuery = (statement: string): boolean =>
    /=\s*\(?\s*query\.(is_item_name_any|get_equipped_item_name)\(/.test(statement);
  const singleArgumentItemQuery = (statement: string): boolean =>
    /query\.is_item_name_any\(\s*'[^']*'\s*(?:,\s*\d+\s*)?\)/.test(statement);
  const initialized = required.filter((name) =>
    assignments.some((statement: string) => statement.startsWith(`${name} =`) && dynamicEquipmentQuery(statement)),
  );
  const playerScoped = required.every(name => report.entries.some(entry => entry.normalizedName === name.slice('variable.'.length) && entry.contexts.includes('player') && entry.resolvedStatus === 'mapped_query'));
  const checks: RegressionAssertion[] = [{
    label: 'player-owned clips are identified by entity registration rather than filenames',
    expected: 'all 4 equipment variables classified in player context',
    actual: `${initialized.length} initialized, ${report.playerWiringRepairs.variablesInitialized.length} reported`,
    passed: initialized.length === 4 && playerScoped
  }, {
    label: 'no emitted item query breaks the argument-count contract',
    expected: 'zero single-argument is_item_name_any calls',
    actual: `${assignments.filter((statement: string) => singleArgumentItemQuery(statement)).length} offending statement(s)`,
    passed: assignments.every((statement: string) => !singleArgumentItemQuery(statement))
  }, {
    label: 'equipment visibility is derived from the matching armor slot query, not a constant',
    expected: '4 dynamic query assignments',
    actual: `${initialized.length} dynamic assignment(s)`,
    passed: initialized.length === 4 && assignments.every((statement: string) => !required.some(name => statement.startsWith(`${name} = 0`)))
  }, {
    label: 'the player entity keeps all four variable initializers after the resolver pass',
    expected: 'helmet, chest, leg and boot visibility variables initialized',
    actual: initialized.join(', ') || 'none',
    passed: initialized.length === 4 && report.flaggedCount === 0
  }];
  return build('player-molang-variable-initialization', 'Player Molang variables (semantic resource ownership, equipment visibility)', 'Animation', checks, [], ['Live Minecraft Molang evaluation is not measured by this structural fixture.'], started);
}