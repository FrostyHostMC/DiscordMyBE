import type { PackFile } from '@/utils/entityTextureVariants';
import { readPngDimensions } from '@/utils/pngUtils';
import { sanitizeRenderControllers, RENDER_CONTROLLER_RULE } from '@/utils/renderControllerSchema';
import {
  sanitizeClientEntities,
  CLIENT_ENTITY_ANIMATION_RULE,
} from '@/utils/clientEntitySchema';
import { sanitizeSoundDefinitions, SOUND_RULE } from '@/utils/soundConverter';
import { enforceItemIconsAndBlockGeometry, ITEM_ICON_RULE } from '@/utils/itemIconAtlas';
import { inspectAnimationControllerGraphs, normalizeEmptyControllerArrays } from '@/utils/animationControllerValidation';
import { isKnownVanillaPlayerAnimationReference } from '@/utils/clientEntitySchema';

/**
 * Bedrock schema gate.
 *
 * Runs on the exact pack that gets written, immediately before the identifier registry and
 * the atlases are finalised. Every check below corresponds to an error class from the
 * content log; each one is counted before and after the repairs, so the export carries a
 * real before/after report instead of a claim that nothing was wrong.
 */

export interface SchemaGateCheck {
  id: string;
  label: string;
  rule: string;
  errorsBefore: number;
  errorsAfter: number;
  status: 'clean' | 'repaired' | 'unresolved';
  detail: string;
}

export interface BedrockSchemaGateReport {
  checks: SchemaGateCheck[];
  errorsBefore: number;
  errorsAfter: number;
  renderControllersNormalised: number;
  textureExpressionsRepaired: number;
  emptyAnimationNodesRemoved: number;
  emptyAnimateArraysRemoved: number;
  danglingAnimationRefsRemoved: number;
  controllerArraysNormalized: number;
  controllerGraphIssues: string[];
  soundNamesFixed: number;
  unsupportedSoundEvents: string[];
  geometryReferencesRepaired: number;
  danglingGeometryReferences: string[];
  entityTexturesMissing: string[];
  itemIconsRepaired: number;
  itemIconsMissing: string[];
  blockOverridesRemoved: number;
  unresolvedChecks: number;
  notes: string[];
  passed: boolean;
  summary: string;
}

interface PackBundle {
  resourcePackFiles: Record<string, PackFile>;
  behaviorPackFiles: Record<string, PackFile>;
}

function parseJson(value: PackFile | undefined): Record<string, any> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

/** Every geometry identifier declared by a shipped model file. */
function declaredGeometryIds(rp: Record<string, PackFile>): Set<string> {
  const ids = new Set<string>();
  for (const path of Object.keys(rp)) {
    if (!path.startsWith('models/') || !path.endsWith('.json')) continue;
    const doc = parseJson(rp[path]);
    const list = doc?.['minecraft:geometry'];
    if (!Array.isArray(list)) continue;
    for (const geometry of list) {
      const identifier = geometry?.description?.identifier;
      if (typeof identifier === 'string' && identifier) ids.add(identifier);
    }
  }
  return ids;
}

function ownFileIdentifier(rp: Record<string, PackFile>, mobId: string): string | null {
  const doc = parseJson(rp[`models/entity/${mobId}.geo.json`]);
  const identifier = doc?.['minecraft:geometry']?.[0]?.description?.identifier;
  return typeof identifier === 'string' && identifier ? identifier : null;
}

/** Counts the open, content-log relevant defects in the pack as it stands. */
export function countSchemaErrors(bundle: PackBundle): Record<string, number> {
  const { resourcePackFiles: rp, behaviorPackFiles: bp } = bundle;
  const counts = {
    renderControllerTextures: 0,
    emptyAnimationProperties: 0,
    animationControllerGraph: 0,
    danglingAnimationRefs: 0,
    soundAssetPaths: 0,
    danglingGeometryRefs: 0,
    missingEntityTextures: 0,
    missingItemIcons: 0,
    blockGeometryOverrides: 0,
  };

  for (const path of Object.keys(rp)) {
    if (path.startsWith('render_controllers/') && path.endsWith('.json')) {
      const doc = parseJson(rp[path]);
      const controllers = doc?.render_controllers ?? doc?.['minecraft:render_controllers'];
      for (const controller of Object.values(controllers ?? {}) as Array<Record<string, unknown>>) {
        const textures = controller?.textures;
        if (typeof textures === 'string') counts.renderControllerTextures += 1;
        else if (!Array.isArray(textures) || textures.length === 0) counts.renderControllerTextures += 1;
        const arrays = controller?.arrays;
        if (!arrays || typeof arrays !== 'object') continue;
        // Only textures / geometries / materials may hold `Array.<name>` entries; a bucket
        // named after the array invalidates the whole controller.
        for (const childKey of Object.keys(arrays as Record<string, unknown>)) {
          if (childKey === 'textures' || childKey === 'geometries' || childKey === 'materials') continue;
          counts.renderControllerTextures += 1;
        }
      }
    }
  }

  const clipIds = new Set<string>();
  const controllerIds = new Set<string>();
  for (const path of Object.keys(rp)) {
    if (path.startsWith('animations/') && path.endsWith('.json')) {
      const doc = parseJson(rp[path]);
      for (const id of Object.keys(doc?.animations ?? {})) clipIds.add(id);
    }
    if (path.startsWith('animation_controllers/') && path.endsWith('.json')) {
      const doc = parseJson(rp[path]);
      for (const id of Object.keys(doc?.animation_controllers ?? {})) controllerIds.add(id);
    }
  }
  counts.animationControllerGraph = inspectAnimationControllerGraphs(rp).length;
  const geometryIds = declaredGeometryIds(rp);

  for (const path of Object.keys(rp).filter((entry) => entry.startsWith('entity/') && entry.endsWith('.entity.json') && !entry.slice('entity/'.length).includes('/'))) {
    const mobId = path.slice('entity/'.length, -'.entity.json'.length);
    const desc = parseJson(rp[path])?.['minecraft:client_entity']?.description;
    if (!desc) continue;
    const animations = desc.animations;
    if (animations != null) {
      const entries = typeof animations === 'object' && !Array.isArray(animations)
        ? Object.entries(animations as Record<string, unknown>)
        : [];
      if (entries.length === 0) counts.emptyAnimationProperties += 1;
      for (const [, value] of entries) {
        if (typeof value !== 'string') continue;
        const isPlayer = desc.identifier === 'minecraft:player';
        if (!clipIds.has(value) && !controllerIds.has(value) && !(isPlayer && isKnownVanillaPlayerAnimationReference(value))) counts.danglingAnimationRefs += 1;
      }
    }
    const animate = desc.scripts?.animate;
    if (Array.isArray(animate) && animate.length === 0) counts.emptyAnimationProperties += 1;
    if (Array.isArray(animate)) {
      const bound = animations && typeof animations === 'object' ? Object.keys(animations) : [];
      for (const entry of animate) {
        if (typeof entry !== 'string') continue;
        if (!bound.includes(entry) && !controllerIds.has(entry)) counts.danglingAnimationRefs += 1;
      }
    }
    const textures = desc.textures && typeof desc.textures === 'object' ? desc.textures : {};
    for (const value of Object.values(textures)) {
      if (typeof value !== 'string') continue;
      const bytes = rp[`${value}.png`];
      if (!(bytes instanceof Uint8Array) || readPngDimensions(bytes) == null) {
        counts.missingEntityTextures += 1;
      }
    }
    const geometries = desc.geometry && typeof desc.geometry === 'object' ? desc.geometry : {};
    for (const value of Object.values(geometries)) {
      const reference = typeof value === 'string' ? value : null;
      if (!reference || geometryIds.has(reference)) continue;
      const own = ownFileIdentifier(rp, mobId);
      counts.danglingGeometryRefs += 1;
      void own;
    }
  }

  const soundDoc = parseJson(rp['sounds/sound_definitions.json']);
  for (const definition of Object.values(soundDoc?.sound_definitions ?? {}) as Array<Record<string, any>>) {
    for (const entry of Array.isArray(definition?.sounds) ? definition.sounds : []) {
      const name = typeof entry === 'string' ? entry : String(entry?.name ?? '');
      if (!name) continue;
      if (/\.(ogg|wav|mp3|fsb)$/i.test(name)) counts.soundAssetPaths += 1;
      else if (!name.includes('/') && /\.[a-z0-9_]+$/i.test(name)) counts.soundAssetPaths += 1;
    }
  }

  const atlas = parseJson(rp['textures/item_texture.json']);
  const textureData = atlas?.texture_data ?? {};
  for (const path of Object.keys(bp).filter((entry) => /^items\/[^/]+\.json$/.test(entry))) {
    const components = parseJson(bp[path])?.['minecraft:item']?.components ?? {};
    const icon = components['minecraft:icon'];
    const key = typeof icon === 'string'
      ? icon
      : typeof icon?.texture === 'string'
        ? icon.texture
        : typeof icon?.textures?.default === 'string'
          ? icon.textures.default
          : null;
    if (!key) {
      counts.missingItemIcons += 1;
      continue;
    }
    const entry = textureData[key];
    const reference = typeof entry === 'string' ? entry : typeof entry?.textures === 'string' ? entry.textures : null;
    const bytes = reference ? rp[`${reference.replace(/\.png$/i, '')}.png`] : undefined;
    if (!(bytes instanceof Uint8Array) || readPngDimensions(bytes) == null) counts.missingItemIcons += 1;
  }

  const blocksDoc = parseJson(rp['blocks.json']) ?? {};
  for (const path of Object.keys(bp).filter((entry) => /^blocks\/[^/]+\.json$/.test(entry))) {
    const blockRoot = parseJson(bp[path])?.['minecraft:block'];
    if (!blockRoot?.components?.['minecraft:geometry']) continue;
    const identifier = blockRoot?.description?.identifier;
    if (typeof identifier !== 'string') continue;
    const shortId = identifier.split(':').pop() ?? identifier;
    if (identifier in blocksDoc || shortId in blocksDoc) counts.blockGeometryOverrides += 1;
  }

  return counts;
}

/**
 * Repairs every defect class above and returns the before/after report. Nothing is
 * invented: a missing source texture, geometry or icon stays reported as unresolved.
 */
export function runBedrockSchemaGate(input: {
  modId: string;
  resourcePackFiles: Record<string, PackFile>;
  behaviorPackFiles: Record<string, PackFile>;
  onLog?: (line: string) => void;
}): BedrockSchemaGateReport {
  const log = (line: string) => input.onLog?.(line);
  const bundle: PackBundle = {
    resourcePackFiles: input.resourcePackFiles,
    behaviorPackFiles: input.behaviorPackFiles,
  };
  const before = countSchemaErrors(bundle);
  const controllerArraysNormalized = normalizeEmptyControllerArrays(bundle.resourcePackFiles);

  log('[SCHEMA] Bedrock schema gate engaged — render controllers, animation bindings, controller graphs, sound paths, geometry/texture references, item icons, block overrides.');

  const controllers = sanitizeRenderControllers(bundle.resourcePackFiles, { onLog: log });
  const entities = sanitizeClientEntities(bundle.resourcePackFiles, { onLog: log });
  const sounds = sanitizeSoundDefinitions(bundle.resourcePackFiles, { onLog: log });
  const icons = enforceItemIconsAndBlockGeometry({
    modId: input.modId,
    resourcePackFiles: bundle.resourcePackFiles,
    behaviorPackFiles: bundle.behaviorPackFiles,
    onLog: log,
  });

  // Geometry identifier sync: a client entity may only reference a declared identifier.
  const geometryIds = declaredGeometryIds(bundle.resourcePackFiles);
  let geometryRepaired = 0;
  const dangling: string[] = [];
  for (const path of Object.keys(bundle.resourcePackFiles).filter((entry) =>
    /^entity\/[^/]+\.entity\.json$/.test(entry),
  )) {
    const mobId = path.slice('entity/'.length, -'.entity.json'.length);
    const doc = parseJson(bundle.resourcePackFiles[path]);
    const desc = doc?.['minecraft:client_entity']?.description;
    if (!desc?.geometry || typeof desc.geometry !== 'object') continue;
    let changed = false;
    for (const [key, value] of Object.entries(desc.geometry as Record<string, unknown>)) {
      if (typeof value !== 'string' || geometryIds.has(value)) continue;
      const own = ownFileIdentifier(bundle.resourcePackFiles, mobId);
      if (own) {
        desc.geometry[key] = own;
        geometryRepaired += 1;
        changed = true;
      } else {
        dangling.push(`${mobId}.geometry.${key} → ${value}`);
      }
    }
    if (changed) bundle.resourcePackFiles[path] = JSON.stringify(doc, null, 2);
  }
  if (geometryRepaired > 0) {
    log(`[SCHEMA] ${geometryRepaired} client-entity geometry reference(s) re-bound to the identifier its own shipped model declares.`);
  }
  for (const entry of dangling.slice(0, 5)) log(`[SCHEMA:UNRESOLVED] No shipped geometry declares ${entry}.`);

  // Texture reference integrity: every entity texture must resolve to a real PNG payload.
  const entityTexturesMissing: string[] = [];
  for (const path of Object.keys(bundle.resourcePackFiles).filter((entry) =>
    /^entity\/[^/]+\.entity\.json$/.test(entry),
  )) {
    const desc = parseJson(bundle.resourcePackFiles[path])?.['minecraft:client_entity']?.description;
    const textures = desc?.textures && typeof desc.textures === 'object' ? desc.textures : {};
    for (const [key, value] of Object.entries(textures)) {
      if (typeof value !== 'string') continue;
      const bytes = bundle.resourcePackFiles[`${value}.png`];
      if (bytes instanceof Uint8Array && readPngDimensions(bytes) != null) continue;
      entityTexturesMissing.push(`${path} textures.${key} → ${value}.png`);
    }
  }
  if (entityTexturesMissing.length > 0) {
    log(`[SCHEMA] ${entityTexturesMissing.length} entity texture reference(s) have no shipped PNG — reported as missing source assets, never replaced with invented art.`);
  }

  const controllerGraphIssues = inspectAnimationControllerGraphs(bundle.resourcePackFiles);
  const after = countSchemaErrors(bundle);

  const check = (
    id: string,
    label: string,
    rule: string,
    detail: string,
  ): SchemaGateCheck => {
    const errorsBefore = before[id] ?? 0;
    const errorsAfter = after[id] ?? 0;
    return {
      id,
      label,
      rule,
      errorsBefore,
      errorsAfter,
      status: errorsAfter === 0 ? (errorsBefore === 0 ? 'clean' : 'repaired') : 'unresolved',
      detail,
    };
  };

  const checks: SchemaGateCheck[] = [
    check(
      'renderControllerTextures',
      'Render controller texture schema',
      RENDER_CONTROLLER_RULE,
      `${controllers.controllersNormalised} render controller(s) validated; ${controllers.scalarTexturesFixed} scalar textures value(s) converted to arrays, ${controllers.textureRefsRepaired} expression(s) rebound to a declared texture.`,
    ),
    check(
      'emptyAnimationProperties',
      'Optional animation properties',
      CLIENT_ENTITY_ANIMATION_RULE,
      `${entities.entities} client entity definition(s) checked; ${entities.emptyAnimationNodesRemoved} empty animations node(s) and ${entities.emptyAnimateArraysRemoved} empty animate array(s) omitted.`,
    ),
    check(
      'animationControllerGraph',
      'Animation-controller state graph',
      'Controller states must use schema-valid optional arrays, existing transition destinations, non-empty Molang conditions, and reachable states. Source transition order and conditions are preserved.',
      `${controllerArraysNormalized.emptyTransitionsOmitted} empty transitions array(s) and ${controllerArraysNormalized.emptyAnimationsOmitted} empty animations array(s) omitted; ${controllerGraphIssues.length} invalid graph issue(s) remain.`,
    ),
    check(
      'danglingAnimationRefs',
      'Clip and controller bindings resolve',
      CLIENT_ENTITY_ANIMATION_RULE,
      `${entities.danglingAnimationRefsRemoved} unresolvable clip binding(s) and ${entities.danglingControllersRemoved} controller binding(s) dropped.`,
    ),
    check(
      'soundAssetPaths',
      'Sound definition asset paths',
      SOUND_RULE,
      `${sounds.namesFixed} sound name(s) normalised, ${sounds.definitionsRemoved} unusable definition(s) removed, ${sounds.unsupportedEvents.length} Java event(s) without an equivalent.`,
    ),
    check(
      'danglingGeometryRefs',
      'Geometry identifier references',
      'Every client entity geometry reference must match an identifier a shipped model declares. A repair renames a reference only from the identifier its own model file declares, never by inventing one.',
      `${geometryRepaired} reference(s) re-bound, ${dangling.length} unresolved.`,
    ),
    check(
      'missingEntityTextures',
      'Entity texture references resolve to real PNG data',
      'A client entity texture path must resolve to a shipped PNG with a valid header.',
      `${entityTexturesMissing.length} reference(s) without a shipped PNG (missing source asset, not replaced).`,
    ),
    check(
      'missingItemIcons',
      'Item icon declarations and atlas entries',
      ITEM_ICON_RULE,
      `${icons.iconsRepaired} icon(s) repaired, ${icons.atlasEntriesAdded} atlas entry(ies) added, ${icons.texturesCarried} sheet(s) carried into textures/items, ${icons.iconsDropped} unresolvable icon reference(s) removed, ${icons.missingIcons.length} item(s) with no source icon.`,
    ),
    check(
      'blockGeometryOverrides',
      'Custom block geometry vs legacy overrides',
      ITEM_ICON_RULE,
      `${icons.blockOverridesRemoved} legacy blocks.json override(s) removed for blocks that render through minecraft:geometry.`,
    ),
  ];

  const errorsBefore = checks.reduce((total, entry) => total + entry.errorsBefore, 0);
  const errorsAfter = checks.reduce((total, entry) => total + entry.errorsAfter, 0);
  const unresolvedChecks = checks.filter((entry) => entry.status === 'unresolved').length;

  for (const entry of checks) {
    log(
      `[SCHEMA] ${entry.status.toUpperCase()} — ${entry.label}: ${entry.errorsBefore} → ${entry.errorsAfter} open defect(s). ${entry.detail}`,
    );
  }

  const notes: string[] = [];
  // Every collection below is defensively defaulted: one summary that reads a repair
  // result the run could not fill in must never abort the export.
  const unsupportedSounds = sounds.unsupportedEvents ?? [];
  const invalidSoundPaths = sounds.invalidPaths ?? [];
  const missingIcons = icons.missingIcons ?? [];
  const missingTextures = entityTexturesMissing ?? [];
  const danglingRefs = dangling ?? [];
  if (unsupportedSounds.length > 0) {
    notes.push(...unsupportedSounds.slice(0, 6).map((entry) => `UNSUPPORTED sound: ${entry}`));
  }
  if (invalidSoundPaths.length > 0) {
    notes.push(...invalidSoundPaths.slice(0, 4).map((entry) => `INVALID sound path: ${entry}`));
  }
  notes.push(...missingIcons.slice(0, 6).map((entry) => `MISSING icon: ${entry}`));
  notes.push(...missingTextures.slice(0, 6).map((entry) => `MISSING texture: ${entry}`));
  notes.push(...danglingRefs.slice(0, 6).map((entry) => `DANGLING geometry: ${entry}`));
  notes.push(...controllerGraphIssues.slice(0, 8).map((issue) => `INVALID controller graph: ${issue.file} ${issue.controllerId}${issue.state ? `/${issue.state}` : ''}: ${issue.detail}`));
  if (entities.danglingSoundEventsRemoved > 0) {
    notes.push(`${entities.danglingSoundEventsRemoved} client entity sound event binding(s) did not resolve and were dropped.`);
  }
  notes.push('Schema and reference validation only — no check in this gate runs inside a live Bedrock client.');

  const summary =
    `Bedrock schema gate: ${checks.length} check(s), ${errorsBefore} → ${errorsAfter} open defect(s), ` +
    `${errorsBefore - errorsAfter} repaired, ${unresolvedChecks} check(s) still unresolved. ` +
    'Gameplay compatibility is not measured by this gate.';
  log(`[SCHEMA] ${summary}`);

  return {
    checks,
    errorsBefore,
    errorsAfter,
    renderControllersNormalised: controllers.controllersNormalised,
    textureExpressionsRepaired: controllers.textureRefsRepaired,
    emptyAnimationNodesRemoved: entities.emptyAnimationNodesRemoved,
    emptyAnimateArraysRemoved: entities.emptyAnimateArraysRemoved,
    controllerArraysNormalized: controllerArraysNormalized.filesTouched,
    controllerGraphIssues: controllerGraphIssues.map((issue) => `${issue.file} ${issue.controllerId}${issue.state ? `/${issue.state}` : ''}: ${issue.detail}`),
    soundNamesFixed: sounds.namesFixed,
    unsupportedSoundEvents: sounds.unsupportedEvents,
    geometryReferencesRepaired: geometryRepaired,
    danglingGeometryReferences: dangling,
    entityTexturesMissing,
    itemIconsRepaired: icons.iconsRepaired,
    itemIconsMissing: icons.missingIcons,
    blockOverridesRemoved: icons.blockOverridesRemoved,
    unresolvedChecks,
    notes,
    passed: errorsAfter === 0,
    summary,
  };
}