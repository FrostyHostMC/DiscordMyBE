/**
 * Pre-export port validation.
 *
 * Runs on the final resource/behavior pack, immediately before the archive is written, and
 * fails loudly instead of shipping a pack that Bedrock will reject at import:
 *
 *  1. every JSON file parses;
 *  2. no animation / controller / render controller / geometry identifier is declared in more
 *     than one file (duplicate ids silently shadow each other in Bedrock);
 *  3. every reference a client entity makes — clip, controller, render controller, geometry,
 *     texture — actually resolves to a shipped resource or to a base-game resource;
 *  4. every Molang query is on the allow-list for its context (player vs. mob). Mob-only
 *     queries such as `query.has_target` / `query.target_distance` are rejected in player
 *     animation files;
 *  5. sound paths start with `sounds/`, carry no extension, and the audio file exists;
 *  6. item icons use the current `{ textures: { default } }` form under format_version 1.21.30+;
 *  7. a pack that ships player animation clips also ships the player client entity that
 *     registers them — animations with no entity wiring are a failed port, not a warning.
 *
 * Everything the bedrocks cannot express is listed by `classifySourceFiles` as NOT PORTED.
 */

import { MOB_ONLY_QUERIES, isQuerySupported, molangContextForFile, translateMolangExpression } from '@/utils/molangCompatibility';
import { inspectAnimationControllerGraphs } from '@/utils/animationControllerValidation';
import {
  buildAnimationResourceRegistry,
  assertAnimationResourceRegistryCurrent,
  type AnimationResourceRegistry,
} from '@/utils/animationResourceRegistry';

export type PortCheckId =
  | 'json'
  | 'duplicate-id'
  | 'reference'
  | 'molang'
  | 'sound-path'
  | 'item-icon'
  | 'player-wiring'
  | 'controller-schema';

export interface PortValidationIssue {
  check: PortCheckId;
  severity: 'error' | 'warning';
  file: string;
  subject: string;
  detail: string;
}

export interface NotPortedFeature {
  category: 'mixin' | 'render-pipeline' | 'camera' | 'gui' | 'binary-native' | 'script-runtime';
  sourcePath: string;
  reason: string;
}

export interface PlayerWiringAudit {
  required: boolean;
  entityFile: string;
  present: boolean;
  registeredClips: number;
  missingClips: string[];
  animateEntries: number;
  /** Controller ids the player entity binds through its own animations map. */
  controllersReferenced: string[];
  /** How many of those resolve to a shipped controller document or a base-game controller. */
  controllersResolved: number;
  /** Registered clips with neither an animate entry nor a controller state that plays them. */
  clipsWithoutActivationPath: string[];
}

export interface PortValidationReport {
  filesParsed: number;
  issues: PortValidationIssue[];
  jsonErrors: number;
  duplicateIds: number;
  unresolvedReferences: number;
  molangViolations: number;
  /** Expressions still carrying a query with a known supported equivalent that was not applied. */
  molangRepairable: number;
  soundPathViolations: number;
  itemIconViolations: number;
  controllerSchemaViolations: number;
  playerWiring: PlayerWiringAudit;
  notPorted: NotPortedFeature[];
  errors: number;
  warnings: number;
  passed: boolean;
  summary: string;
}

/** Base-game resources a pack may reference without shipping them. */
const VANILLA_TEXTURES = new Set(['textures/entity/steve', 'textures/entity/alex', 'textures/entity/cape_invisible']);
const VANILLA_GEOMETRY = new Set(['geometry.humanoid.custom', 'geometry.humanoid.customSlim', 'geometry.humanoid', 'geometry.cape']);
const VANILLA_CONTROLLERS = new Set([
  'controller.animation.player.root',
  'controller.animation.player.first_person_attack',
  'controller.animation.humanoid.look_at_target',
]);
const VANILLA_RENDER_CONTROLLERS = new Set([
  'controller.render.player.first_person',
  'controller.render.player.third_person',
  'controller.render.player.third_person_map',
  'controller.render.player.cape',
]);
const VANILLA_ANIMATIONS = new Set([
  'animation.humanoid.base_pose',
  'animation.player.cape',
  'animation.player.first_person.base_pose',
]);

/**
 * The query allow-list is owned by the Molang compatibility analyzer. The repair pass that rewrites
 * an unsupported query and this gate that rejects one must give the same answer, so the registry
 * is imported instead of duplicated — that duplication is how a rewritten expression used to be
 * re-flagged as invalid.
 */
function queryAllowed(query: string, context: 'player' | 'mob'): boolean {
  return isQuerySupported(query, context === 'player' ? 'player_entity' : 'mob_entity');
}

const MAX_ISSUES = 80;
const SOUND_EXTS = ['.ogg', '.wav', '.fsb', '.mp3'];

function parseJson(text: string | Uint8Array | undefined): Record<string, unknown> | null {
  if (typeof text !== 'string') return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Splits the imported archive into data (copied verbatim) and logic (re-implemented or
 * reported). Nothing in the logic half is guessed: it is listed as NOT PORTED with a reason.
 */
export function classifySourceFiles(archivePaths: string[]): {
  dataFiles: number;
  logicFiles: number;
  notPorted: NotPortedFeature[];
} {
  let dataFiles = 0;
  let logicFiles = 0;
  const notPorted: NotPortedFeature[] = [];
  for (const raw of archivePaths) {
    const path = raw.replace(/\\/g, '/');
    const lower = path.toLowerCase();
    if (/\.(json|png|ogg|wav|lang|mcmeta|txt|toml|cfg|properties)$/.test(lower)) {
      dataFiles += 1;
      continue;
    }
    if (lower.endsWith('.class') || lower.endsWith('.jar')) {
      logicFiles += 1;
      if (lower.includes('mixin')) {
        notPorted.push({
          category: 'mixin',
          sourcePath: path,
          reason: 'Bytecode injection has no Bedrock counterpart: the injected method is re-implemented from evidence or reported unsupported.',
        });
      } else if (/(shader|\.glsl|renderpipeline|render_pipeline|rendertype|pipeline|sodium|iris|postprocess|post_process)/.test(lower)) {
        notPorted.push({
          category: 'render-pipeline',
          sourcePath: path,
          reason: 'Java render pipeline / shader hooks cannot be expressed by a Bedrock resource pack.',
        });
      } else if (/(camera|cinematic)/.test(lower)) {
        notPorted.push({
          category: 'camera',
          sourcePath: path,
          reason: 'Java camera hooks are not ported; only Bedrock camera presets/scripts shipped.',
        });
      } else if (/(screen|gui|container|menu|widget)/.test(lower)) {
        notPorted.push({
          category: 'gui',
          sourcePath: path,
          reason: 'Java GUI screens have no Bedrock equivalent; only scripted forms were generated.',
        });
      }
      continue;
    }
    if (/\.(glsl|so|dll|dylib|node)$/.test(lower)) {
      logicFiles += 1;
      notPorted.push({
        category: 'binary-native',
        sourcePath: path,
        reason: 'Native binary component cannot run inside the Bedrock scripting sandbox.',
      });
    }
  }
  return { dataFiles, logicFiles, notPorted: notPorted.slice(0, 60) };
}

function collectIds(
  files: Record<string, string | Uint8Array>,
  predicate: (path: string) => boolean,
  pick: (doc: Record<string, unknown>) => string[],
  registry: Map<string, string[]>,
): void {
  for (const [path, content] of Object.entries(files)) {
    if (!predicate(path)) continue;
    const doc = parseJson(content);
    if (!doc) continue;
    for (const id of pick(doc)) {
      if (!id) continue;
      const owners = registry.get(id) ?? [];
      owners.push(path);
      registry.set(id, owners);
    }
  }
}

function queriesIn(expression: string): string[] {
  const found = expression.match(/query\.[a-z0-9_]+/gi) ?? [];
  return found.map((token) => token.slice('query.'.length).toLowerCase());
}

/**
 * Walks a document and hands every string that mentions a query to `visit`, returning the same node
 * when nothing changed so an untouched document is never rewritten.
 */
function walkMolangStrings(node: unknown, visit: (value: string) => string): unknown {
  if (typeof node === 'string') return /query\.[a-z0-9_]+/i.test(node) ? visit(node) : node;
  if (Array.isArray(node)) return node.map((entry) => walkMolangStrings(entry, visit));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    let changed = false;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const next = walkMolangStrings(value, visit);
      if (next !== value) changed = true;
      out[key] = next;
    }
    return changed ? out : node;
  }
  return node;
}

interface ValidatorOptions {
  modId: string;
  resourcePackFiles: Record<string, string | Uint8Array>;
  behaviorPackFiles: Record<string, string | Uint8Array>;
  archivePaths?: string[];
  registry?: AnimationResourceRegistry;
  expectedPlayerClipIds?: string[];
  onLog?: (line: string) => void;
}

/** Validates the exact pack that is about to be zipped. */
export function runPortValidation(options: ValidatorOptions): PortValidationReport {
  const log = (line: string) => options.onLog?.(line);
  const rp = options.resourcePackFiles;
  const bp = options.behaviorPackFiles;
  const animationRegistry = options.registry ?? buildAnimationResourceRegistry({
    resourcePackFiles: rp,
    behaviorPackFiles: bp,
  });
  assertAnimationResourceRegistryCurrent(animationRegistry, {
    resourcePackFiles: rp,
    behaviorPackFiles: bp,
  });
  const issues: PortValidationIssue[] = [];
  let errorCount = 0;
  let warningCount = 0;
  const add = (issue: PortValidationIssue): void => {
    if (issue.severity === 'error') errorCount += 1;
    else warningCount += 1;
    if (issues.length < MAX_ISSUES) issues.push(issue);
  };

  // 1. JSON parse.
  let filesParsed = 0;
  let jsonErrors = 0;
  for (const pack of [rp, bp]) {
    for (const [path, content] of Object.entries(pack)) {
      if (!path.toLowerCase().endsWith('.json')) continue;
      if (typeof content !== 'string') continue;
      filesParsed += 1;
      try {
        JSON.parse(content);
      } catch {
        jsonErrors += 1;
        add({ check: 'json', severity: 'error', file: path, subject: 'parse', detail: 'File is not valid JSON and would be rejected at import.' });
      }
    }
  }

  // 2. Duplicate identifiers across files.
  const animations = new Map<string, string[]>();
  const controllers = new Map<string, string[]>();
  const renderControllers = new Map<string, string[]>();
  const geometries = new Map<string, string[]>();
  const keysOf = (field: string) => (doc: Record<string, unknown>) => Object.keys((doc[field] as Record<string, unknown>) ?? {});
  collectIds(rp, (p) => p.startsWith('animations/') && p.endsWith('.json'), keysOf('animations'), animations);
  collectIds(rp, (p) => p.includes('animation_controllers') && p.endsWith('.json'), keysOf('animation_controllers'), controllers);
  collectIds(rp, (p) => p.includes('render_controllers') && p.endsWith('.json'), keysOf('render_controllers'), renderControllers);
  collectIds(
    rp,
    (p) => p.startsWith('models/') && p.endsWith('.json'),
    (doc) => ((doc['minecraft:geometry'] as Array<{ description?: { identifier?: string } }>) ?? []).map((geo) => geo?.description?.identifier ?? ''),
    geometries,
  );
  const idRegistries: Array<[Map<string, string[]>, string]> = [
    [animations, 'animation'],
    [controllers, 'animation controller'],
    [renderControllers, 'render controller'],
    [geometries, 'geometry'],
  ];
  for (const [registry, label] of idRegistries) {
    for (const [id, owners] of registry) {
      const distinct = [...new Set(owners)];
      if (distinct.length < 2) continue;
      add({
        check: 'duplicate-id',
        severity: 'error',
        file: distinct[0],
        subject: id,
        detail: `The ${label} id "${id}" is defined in ${distinct.length} files (${distinct.slice(0, 3).join(', ')}); Bedrock keeps only one, so the others are shadowed.`,
      });
    }
  }

  const shippedTextures = new Set(
    Object.keys(rp)
      .filter((p) => p.toLowerCase().endsWith('.png'))
      .map((p) => p.replace(/\.png$/i, '')),
  );
  const resolvesAnimation = (id: string) => animations.has(id) || VANILLA_ANIMATIONS.has(id);
  const resolvesController = (id: string) => controllers.has(id) || VANILLA_CONTROLLERS.has(id);
  const resolvesRenderController = (id: string) => renderControllers.has(id) || VANILLA_RENDER_CONTROLLERS.has(id);
  const resolvesGeometry = (id: string) => geometries.has(id) || VANILLA_GEOMETRY.has(id);
  const resolvesTexture = (path: string) => shippedTextures.has(path) || VANILLA_TEXTURES.has(path);

  // 3./4. Client entity references + context-aware Molang.
  const playerRegistryEntity = animationRegistry.entities.find((entity) => entity.isPlayer);
  const playerClipIds = [...new Set(options.expectedPlayerClipIds ?? (playerRegistryEntity?.registeredClipIds ?? []))];
  const registeredPlayerClips = new Set(playerRegistryEntity?.registeredClipIds ?? []);
  let playerEntity: Record<string, unknown> | null = null;
  let animateEntries = 0;
  const playerAnimateNames = new Set<string>();
  const playerAnimationTargets = new Map<string, string>();
  const playerControllerRefs: string[] = [];

  for (const [path, content] of Object.entries(rp)) {
    if (!path.startsWith('entity/') || !path.endsWith('.entity.json')) continue;
    const doc = parseJson(content);
    const description = (doc?.['minecraft:client_entity'] as Record<string, unknown> | undefined)?.description as Record<string, unknown> | undefined;
    if (!description) continue;
    const isPlayer = description.identifier === 'minecraft:player';
    if (isPlayer) playerEntity = description;
    const localAnimations = (description.animations ?? {}) as Record<string, string>;
    for (const [shortName, clipId] of Object.entries(localAnimations)) {
      if (isPlayer) {
        playerAnimationTargets.set(shortName, clipId);
        if (clipId.startsWith('controller.animation.')) playerControllerRefs.push(clipId);
      }
      if (typeof clipId !== 'string') continue;
      if (clipId.startsWith('controller.animation.')) {
        if (!resolvesController(clipId)) {
          add({ check: 'reference', severity: 'error', file: path, subject: shortName, detail: `Controller "${clipId}" is not defined in the pack and is not a base-game player controller.` });
        }
      } else if (clipId.startsWith('animation.')) {
        if (!resolvesAnimation(clipId)) {
          add({ check: 'reference', severity: 'error', file: path, subject: shortName, detail: `Animation "${clipId}" is not defined in the pack and is not a base-game animation.` });
        }
      } else {
        add({ check: 'reference', severity: 'error', file: path, subject: shortName, detail: `Animation registration "${clipId}" is neither an animation definition nor an animation controller.` });
      }
    }
    const animateList = ((description.scripts as Record<string, unknown> | undefined)?.animate ?? []) as Array<string | Record<string, string>>;
    if (isPlayer) animateEntries = animateList.length;
    for (const entry of animateList) {
      const names = typeof entry === 'string' ? [entry] : Object.keys(entry);
      for (const name of names) {
        if (isPlayer) playerAnimateNames.add(name);
        if (!(name in localAnimations)) {
          add({ check: 'reference', severity: 'error', file: path, subject: name, detail: `scripts.animate references "${name}", which the entity's own animations map does not declare.` });
        }
      }
    }
    for (const value of Object.values((description.geometry ?? {}) as Record<string, string>)) {
      if (typeof value !== 'string') continue;
      if (!resolvesGeometry(value)) {
        add({ check: 'reference', severity: 'error', file: path, subject: value, detail: `Geometry "${value}" is not declared by any shipped model and is not a base-game geometry.` });
      }
    }
    for (const value of (description.render_controllers ?? []) as string[]) {
      if (typeof value !== 'string') continue;
      if (!resolvesRenderController(value)) {
        add({ check: 'reference', severity: 'error', file: path, subject: value, detail: `Render controller "${value}" is not shipped and is not a base-game controller.` });
      }
    }
    for (const value of Object.values((description.textures ?? {}) as Record<string, string>)) {
      if (typeof value !== 'string') continue;
      if (!resolvesTexture(value)) {
        add({ check: 'reference', severity: 'error', file: path, subject: value, detail: `Texture "${value}.png" neither ships in the pack nor resolves to a base-game texture.` });
      }
    }
  }

  // 3a. Controller schema, state graph, activation registration, and entity-scoped clip aliases.
  const controllerGraphIssues = inspectAnimationControllerGraphs(rp);
  for (const issue of controllerGraphIssues) {
    add({
      check: 'controller-schema',
      severity: 'error',
      file: issue.file,
      subject: `${issue.controllerId}${issue.state ? `/${issue.state}` : ''}`,
      detail: issue.detail,
    });
  }
  const controllerContexts = new Map<string, Array<{ file: string; animations: Record<string, unknown> }>>();
  for (const [entityPath, content] of Object.entries(rp)) {
    if (!entityPath.startsWith('entity/') || !entityPath.endsWith('.entity.json')) continue;
    const description = (parseJson(content)?.['minecraft:client_entity'] as Record<string, unknown> | undefined)?.description as Record<string, unknown> | undefined;
    if (!description) continue;
    const animations = description.animations && typeof description.animations === 'object' && !Array.isArray(description.animations)
      ? description.animations as Record<string, unknown>
      : {};
    const animate = (description.scripts as Record<string, unknown> | undefined)?.animate;
    const activeKeys = new Set<string>();
    for (const entry of Array.isArray(animate) ? animate : []) {
      if (typeof entry === 'string') activeKeys.add(entry);
      else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        for (const key of Object.keys(entry as Record<string, unknown>)) activeKeys.add(key);
      }
    }
    for (const [alias, target] of Object.entries(animations)) {
      if (typeof target !== 'string' || !target.startsWith('controller.animation.') || !activeKeys.has(alias)) continue;
      const contexts = controllerContexts.get(target) ?? [];
      contexts.push({ file: entityPath, animations });
      controllerContexts.set(target, contexts);
    }
  }
  for (const [controllerId, files] of controllers) {
    for (const file of new Set(files)) {
      const doc = parseJson(rp[file]);
      const definition = (doc?.animation_controllers as Record<string, unknown> | undefined)?.[controllerId] as Record<string, unknown> | undefined;
      const states = definition?.states && typeof definition.states === 'object'
        ? definition.states as Record<string, unknown>
        : {};
      const owners = controllerContexts.get(controllerId) ?? [];
      if (owners.length === 0) {
        add({ check: 'reference', severity: 'error', file, subject: controllerId, detail: 'Controller is defined but is not registered and activated by any client entity.' });
      }
      for (const [stateName, rawState] of Object.entries(states)) {
        const state = rawState && typeof rawState === 'object' && !Array.isArray(rawState)
          ? rawState as Record<string, unknown>
          : {};
        const entries = Array.isArray(state.animations) ? state.animations : [];
        for (const animationEntry of entries) {
          const names = typeof animationEntry === 'string'
            ? [animationEntry]
            : animationEntry && typeof animationEntry === 'object' && !Array.isArray(animationEntry)
              ? Object.keys(animationEntry as Record<string, unknown>)
              : [];
          for (const reference of names) {
            for (const owner of owners) {
              const target = owner.animations[reference];
              if (typeof target !== 'string') {
                add({ check: 'reference', severity: 'error', file: owner.file, subject: `${controllerId}/${stateName}/${reference}`, detail: 'Controller state animation alias is not registered on the client entity that activates this controller.' });
              } else if (target.startsWith('animation.') && !resolvesAnimation(target)) {
                add({ check: 'reference', severity: 'error', file: owner.file, subject: `${controllerId}/${stateName}/${reference}`, detail: `Animation definition "${target}" is not shipped or supported as a vanilla resource.` });
              } else if (target.startsWith('controller.animation.') && !resolvesController(target)) {
                add({ check: 'reference', severity: 'error', file: owner.file, subject: `${controllerId}/${stateName}/${reference}`, detail: `Nested controller "${target}" is not defined.` });
              } else if (!target.startsWith('animation.') && !target.startsWith('controller.animation.')) {
                add({ check: 'reference', severity: 'error', file: owner.file, subject: `${controllerId}/${stateName}/${reference}`, detail: `Controller state reference "${target}" is neither an animation nor an animation controller identifier.` });
              }
            }
          }
        }
      }
    }
  }

  // 3b. Molang repair coverage on the exact archive. Any expression that still carries a query this
  // context cannot evaluate is reported together with the supported equivalent the analyzer would
  // use. The repair itself runs before this gate, and once more immediately before the audit point,
  // so a query reintroduced afterwards is named here with its replacement instead of passing
  // silently. This pass never mutates the pack: the archive validated is the archive shipped.
  let molangRepairable = 0;
  for (const pack of [rp, bp]) {
    for (const [path, content] of Object.entries(pack)) {
      if (!path.toLowerCase().endsWith('.json')) continue;
      if (!/animation|render_controller|entity\//i.test(path)) continue;
      if (typeof content !== 'string') continue;
      const doc = parseJson(content);
      if (!doc) continue;
      const context =
        molangContextForFile(path, doc) ??
        (path.toLowerCase().includes('player') ? 'player_entity' : 'mob_entity');
      walkMolangStrings(doc, (value) => {
        const translation = translateMolangExpression(value, context);
        if (translation.changes.length === 0) return value;
        molangRepairable += translation.changes.length;
        for (const change of translation.changes) {
          log(
            `[PORT-CHECK:MOLANG] ${path}: "${change.from}" is not valid in the ${context.replace('_', ' ')} context; the supported equivalent (${change.to}) is not applied in this file — ${change.reason}.`,
          );
        }
        return value;
      });
    }
  }

  // 4. Molang allow-list per context.
  const walkExpressions = (node: unknown, context: 'player' | 'mob', file: string): void => {
    if (typeof node === 'string') {
      for (const query of queriesIn(node)) {
        if (queryAllowed(query, context)) continue;
        add({
          check: 'molang',
          severity: 'error',
          file,
          subject: `query.${query}`,
          detail:
            context === 'player'
              ? `"query.${query}" does not exist in the player client-entity context${MOB_ONLY_QUERIES.has(query) ? ' (mob-only query)' : ''}; the expression must be retranslated.`
              : `"query.${query}" is not on the allow-list for the ${context} context.`,
        });
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) walkExpressions(entry, context, file);
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const value of Object.values(node as Record<string, unknown>)) walkExpressions(value, context, file);
    }
  };
  for (const pack of [rp, bp]) {
    for (const [path, content] of Object.entries(pack)) {
      if (!path.toLowerCase().endsWith('.json')) continue;
      if (!/animation|render_controller|entity\//i.test(path)) continue;
      const doc = parseJson(content);
      if (!doc) continue;
      walkExpressions(doc, path.toLowerCase().includes('player') ? 'player' : 'mob', path);
    }
  }

  const playerEntityPath = 'entity/player.entity.json';
  const playerDescription = (parseJson(rp[playerEntityPath])?.['minecraft:client_entity'] as Record<string, unknown> | undefined)?.description as Record<string, unknown> | undefined;
  const playerBindings = playerDescription?.animations && typeof playerDescription.animations === 'object' && !Array.isArray(playerDescription.animations)
    ? Object.values(playerDescription.animations as Record<string, unknown>).filter((value): value is string => typeof value === 'string')
    : [];
  const playerDocumentPaths = new Set<string>([playerEntityPath]);
  for (const binding of playerBindings) {
    const registry = binding.startsWith('animation.') ? animations : binding.startsWith('controller.animation.') ? controllers : null;
    for (const owner of registry?.get(binding) ?? []) playerDocumentPaths.add(owner);
  }
  const playerMolangDocuments = [...playerDocumentPaths]
    .map((path) => [path, rp[path]] as const)
    .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string');
  const playerAssignments = new Set<string>();
  for (const [, content] of [...playerMolangDocuments, ...Object.entries(bp).filter(([path, value]) => path.startsWith('scripts/') && typeof value === 'string') as Array<readonly [string, string]>]) {
    for (const match of content.matchAll(/\bvariable\.([a-zA-Z0-9_]+)\s*=/g)) playerAssignments.add(String(match[1]).toLowerCase());
  }
  const playerVariableReferences = new Map<string, string>();
  for (const [path, content] of playerMolangDocuments) {
    for (const match of content.matchAll(/\bvariable\.([a-zA-Z0-9_]+)\b/g)) {
      const name = String(match[1]).toLowerCase();
      if (!playerAssignments.has(name)) playerVariableReferences.set(name, path);
    }
  }
  for (const [name, file] of playerVariableReferences) {
    add({ check: 'molang', severity: 'error', file, subject: `variable.${name}`, detail: 'Player animation references a variable with no player-scoped assignment or compatible runtime initialization.' });
  }

  // 5. Sound definitions: prefix, extension, and file present.
  let soundViolations = 0;
  const definitions = parseJson(rp['sounds/sound_definitions.json'] as string | undefined);
  const shippedAudio = new Set(
    Object.keys(rp)
      .filter((p) => SOUND_EXTS.some((ext) => p.toLowerCase().endsWith(ext)))
      .map((p) => p.replace(/\.(ogg|wav|fsb|mp3)$/i, '')),
  );
  const soundDefs = (definitions?.sound_definitions ?? definitions ?? {}) as Record<string, { sounds?: Array<string | { name?: string }> }>;
  for (const [name, definition] of Object.entries(soundDefs)) {
    for (const entry of definition?.sounds ?? []) {
      const path = (typeof entry === 'string' ? entry : entry?.name) ?? '';
      if (!path) continue;
      if (path.match(/\.(ogg|wav|fsb|mp3)$/i) || !path.startsWith('sounds/') || !shippedAudio.has(path)) {
        soundViolations += 1;
        add({ check: 'sound-path', severity: 'error', file: 'sounds/sound_definitions.json', subject: name, detail: `Sound "${path}" must be pack-root-relative, extensionless and match a shipped audio file.` });
      }
    }
  }

  // 6. Item icon schema.
  let iconViolations = 0;
  for (const [path, content] of Object.entries(bp)) {
    if (!path.startsWith('items/') || !path.endsWith('.json')) continue;
    const doc = parseJson(content);
    const components = ((doc?.['minecraft:item'] as Record<string, unknown> | undefined)?.components ?? {}) as Record<string, unknown>;
    const icon = components['minecraft:icon'];
    if (icon == null) continue;
    const modern = typeof icon === 'object' && icon !== null && 'textures' in (icon as Record<string, unknown>);
    const version = String(doc?.format_version ?? '1.20.0').split('.').map((n) => parseInt(n, 10));
    const newEnough = (version[0] ?? 1) > 1 || (version[1] ?? 0) > 21 || ((version[1] ?? 0) === 21 && (version[2] ?? 0) >= 30);
    if (!modern || !newEnough) {
      iconViolations += 1;
      add({ check: 'item-icon', severity: 'error', file: path, subject: 'minecraft:icon', detail: 'Item icons must use { "textures": { "default": ... } } under format_version 1.21.30 or newer.' });
    }
  }

  // 7. Player wiring: registration AND activation. A clip that is registered but that nothing
  // plays is exactly the "no error, nothing animates" defect, so it blocks the export instead of
  // being reported as a passing registration count.
  const entityFile = playerRegistryEntity?.path ?? 'entity/player.entity.json';
  const playerActivatedClips = new Set(playerRegistryEntity?.activatedClipIds ?? []);
  const clipsWithoutActivationPath = playerClipIds.filter(
    (clipId) => registeredPlayerClips.has(clipId) && !playerActivatedClips.has(clipId),
  );
  const playerControllerIdsBound = [...new Set(playerControllerRefs)];
  const playerWiring: PlayerWiringAudit = {
    required: playerClipIds.length > 0,
    entityFile,
    present: playerEntity !== null,
    registeredClips: playerClipIds.filter((id) => registeredPlayerClips.has(id)).length,
    missingClips: playerEntity ? playerClipIds.filter((id) => !registeredPlayerClips.has(id)) : [...playerClipIds],
    animateEntries,
    controllersReferenced: playerControllerIdsBound,
    controllersResolved: playerControllerIdsBound.filter((id) => resolvesController(id)).length,
    clipsWithoutActivationPath,
  };
  if (playerWiring.required && !playerWiring.present) {
    add({ check: 'player-wiring', severity: 'error', file: entityFile, subject: 'missing', detail: `${playerClipIds.length} player animation clip(s) ship with no player client entity: nothing references them, so the port cannot play in game.` });
  } else if (playerWiring.present && playerWiring.missingClips.length > 0) {
    for (const clipId of playerWiring.missingClips.slice(0, 20)) {
      add({ check: 'player-wiring', severity: 'error', file: entityFile, subject: clipId, detail: 'Player clip is not registered in the player client entity animations map.' });
    }
  }
  if (playerWiring.present && animateEntries === 0) {
    add({ check: 'player-wiring', severity: 'error', file: entityFile, subject: 'scripts.animate', detail: 'Player client entity has no scripts.animate entries, so no registered clip is ever evaluated.' });
  }
  if (playerWiring.present && clipsWithoutActivationPath.length > 0) {
    for (const clipId of clipsWithoutActivationPath.slice(0, 8)) {
      add({ check: 'player-wiring', severity: 'error', file: entityFile, subject: clipId, detail: 'Player clip is registered but nothing plays it: no scripts.animate entry references it and no controller state plays it, so it is inert in game.' });
    }
  }

  let duplicateIdCount = 0;
  for (const registry of [animations, controllers, renderControllers, geometries]) {
    for (const owners of registry.values()) {
      if (new Set(owners).size > 1) duplicateIdCount += 1;
    }
  }

  const sourceClassification = classifySourceFiles(options.archivePaths ?? []);
  const report: PortValidationReport = {
    filesParsed,
    issues,
    jsonErrors,
    duplicateIds: duplicateIdCount,
    unresolvedReferences: issues.filter((i) => i.check === 'reference').length,
    molangViolations: issues.filter((i) => i.check === 'molang').length,
    molangRepairable,
    soundPathViolations: soundViolations,
    itemIconViolations: iconViolations,
    controllerSchemaViolations: controllerGraphIssues.length,
    playerWiring,
    notPorted: sourceClassification.notPorted,
    errors: errorCount,
    warnings: warningCount,
    passed: errorCount === 0,
    summary: '',
  };
  report.summary = report.passed
    ? `${filesParsed} JSON file(s) parsed; no duplicate identifiers, dangling references, invalid Molang queries, sound path or item-icon defects. Player wiring: ${playerWiring.present ? `entity file present, ${playerWiring.registeredClips}/${playerClipIds.length} player clip(s) registered` : 'not required'}. Structural only — nothing here proves in-game playback.`
    : `${errorCount} blocking defect(s): ${report.duplicateIds} duplicate id(s), ${report.unresolvedReferences} dangling reference(s), ${report.controllerSchemaViolations} controller-schema/graph issue(s), ${report.molangViolations} invalid Molang query/variable issue(s) (${molangRepairable} still carrying a supported equivalent that was not applied), ${soundViolations} sound path(s), ${iconViolations} item icon(s). ${sourceClassification.notPorted.length} Java feature(s) recorded as NOT PORTED.`;
  log(`[PORT-CHECK] ${report.summary}`);
  for (const issue of issues.slice(0, 10)) {
    log(`[PORT-CHECK:${issue.severity.toUpperCase()}] ${issue.file} — ${issue.subject}: ${issue.detail}`);
  }
  if (errorCount + warningCount > issues.length) {
    log(`[PORT-CHECK] ${errorCount + warningCount - issues.length} further issue(s) recorded but not listed.`);
  }
  if (sourceClassification.notPorted.length > 0) {
    log(
      `[PORT-CHECK] Source classification: ${sourceClassification.dataFiles} data file(s) copied verbatim, ${sourceClassification.logicFiles} logic file(s) analysed. NOT PORTED: ${sourceClassification.notPorted.slice(0, 5).map((entry) => `${entry.category} (${entry.sourcePath})`).join(', ')}${sourceClassification.notPorted.length > 5 ? ` +${sourceClassification.notPorted.length - 5} more` : ''}.`,
    );
  }
  if (playerWiring.present) {
    log(
      `[PORT-CHECK] Player client entity: ${playerWiring.registeredClips} clip(s) registered, ${playerWiring.animateEntries} scripts.animate entry/entries, ${playerWiring.controllersResolved}/${playerWiring.controllersReferenced.length} bound controller(s) resolve, ${playerWiring.clipsWithoutActivationPath.length} clip(s) with no activation path. Live playback on the player model is unverified until tested in game.`,
    );
  }
  return report;
}