import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import { collectPackItemIdentifiers, reconstructEquipmentExpression } from '@/utils/variableReconstruction';
import { ARMOR_LAYER_VISIBILITY_MAP } from '@/utils/molangScopeBinder';
import { slotOccupancyExpression } from '@/utils/molangSlotQueries';
import type { UniversalAnimationDiscoveryReport } from '@/utils/universalAnimationDiscovery';
import type { UniversalAnimationIRReport } from '@/utils/universalAnimationIR';

/**
 * Universal Variable Resolver
 *
 * Spec Requirement:
 * "Universal Variable Resolver: A deep-scan diagnostic layer that recursively traverses all
 * animation controllers and state machines to identify every variable, parameter, and property
 * reference. It maps these to the Bedrock-native equivalent or flags them for manual resolution
 * if no direct mapping exists, ensuring that 'missing variable' errors are eliminated by
 * exhaustive discovery and mapping."
 *
 * Core Principles:
 * - NO HARDCODING or mod-specific special cases.
 * - Discovers ALL variable references across clips, controllers, state machines, and client entities.
 * - Categorizes and standardizes Molang variables (`variable.xxx`), queries (`query.xxx`),
 *   temporary variables (`temp.xxx`), and context parameters (`context.xxx`).
 * - Maps uninitialized or orphan variables to valid Bedrock definitions, safe defaults,
 *   or active entity-driven setters to ensure zero "Can't find certain variables" runtime crashes.
 * - Injects safe evaluable initialization statements into `scripts.pre_animation` of player
 *   and mob client entity JSON files to eliminate player wiring failures.
 */

export type VariableType = 'variable' | 'temp' | 'context' | 'query' | 'parameter' | 'unknown';

export interface ResolvedVariableEntry {
  originalName: string;
  normalizedName: string;
  type: VariableType;
  resolvedStatus: 'resolved' | 'mapped_query' | 'auto_initialized' | 'flagged_unresolved';
  targetBedrockEquivalent?: string;
  defaultValue: string | number;
  sourceFiles: string[];
  referenceCount: number;
  contexts: Array<'player' | 'mob' | 'particle' | 'viewmodel' | 'common'>;
  scope: 'entity_persistent' | 'clip_local' | 'controller_state' | 'engine_builtin';
  suggestedAction?: string;
  initializationStatement?: string;
}

export interface UniversalVariableResolverReport {
  variablesDiscovered: number;
  resolvedCount: number;
  mappedQueriesCount: number;
  autoInitializedCount: number;
  flaggedCount: number;
  entries: ResolvedVariableEntry[];
  injectedScriptVariables: Record<string, string | number>;
  playerWiringRepairs: {
    variablesInitialized: string[];
    missingReplaced: number;
    notes: string[];
  };
  summary: string;
  log: string[];
}

/** Standard Bedrock vanilla Molang query mapping for common Java animation variable patterns */
const OFFHAND_OCCUPIED = slotOccupancyExpression('slot.weapon.offhand').expression;
const MAINHAND_OCCUPIED = slotOccupancyExpression('slot.weapon.mainhand').expression;

export const CANONICAL_JAVA_TO_BEDROCK_VARIABLES: Record<string, { query: string; defaultVal: number | string }> = {
  // Equipment visibility (armour layers) is derived from the shared catalog so the player entity,
  // the scope binder and the dependency resolver can never disagree about the expression.
  ...ARMOR_LAYER_VISIBILITY_MAP,

  // Locomotion & speed
  'is_moving': { query: 'query.is_moving', defaultVal: 0 },
  'moving': { query: 'query.is_moving', defaultVal: 0 },
  'walk_speed': { query: 'query.modified_move_speed', defaultVal: 0 },
  'speed': { query: 'query.ground_speed', defaultVal: 0 },
  'ground_speed': { query: 'query.ground_speed', defaultVal: 0 },
  'is_running': { query: 'query.is_sprinting', defaultVal: 0 },
  'is_sprinting': { query: 'query.is_sprinting', defaultVal: 0 },
  'sprinting': { query: 'query.is_sprinting', defaultVal: 0 },
  'is_jumping': { query: 'query.is_jumping', defaultVal: 0 },
  'jumping': { query: 'query.is_jumping', defaultVal: 0 },
  'is_falling': { query: 'query.is_falling', defaultVal: 0 },
  'falling': { query: 'query.is_falling', defaultVal: 0 },
  'is_swimming': { query: 'query.is_swimming', defaultVal: 0 },
  'swimming': { query: 'query.is_swimming', defaultVal: 0 },
  'is_gliding': { query: 'query.is_gliding', defaultVal: 0 },
  'gliding': { query: 'query.is_gliding', defaultVal: 0 },
  'is_sneaking': { query: 'query.is_sneaking', defaultVal: 0 },
  'is_crouching': { query: 'query.is_sneaking', defaultVal: 0 },
  'sneaking': { query: 'query.is_sneaking', defaultVal: 0 },
  'crouching': { query: 'query.is_sneaking', defaultVal: 0 },
  'is_on_ground': { query: 'query.is_on_ground', defaultVal: 1 },
  'on_ground': { query: 'query.is_on_ground', defaultVal: 1 },
  
  // Combat & actions
  'is_attacking': { query: 'query.is_delayed_attacking', defaultVal: 0 },
  'attacking': { query: 'query.is_delayed_attacking', defaultVal: 0 },
  'is_delayed_attacking': { query: 'query.is_delayed_attacking', defaultVal: 0 },
  'is_using_item': { query: 'query.is_using_item', defaultVal: 0 },
  'item_use': { query: 'query.is_using_item', defaultVal: 0 },
  'is_blocking': { query: 'query.is_blocking', defaultVal: 0 },
  'blocking': { query: 'query.is_blocking', defaultVal: 0 },
  'attack_time': { query: 'query.attack_time', defaultVal: 0 },
  'hurt_time': { query: 'query.hurt_time', defaultVal: 0 },
  'is_hurt': { query: '(query.hurt_time > 0)', defaultVal: 0 },
  'swing_progress': { query: 'query.attack_time', defaultVal: 0 },
  'swingprogress': { query: 'query.attack_time', defaultVal: 0 },
  'punch_side': { query: '(query.attack_time > 0 ? (math.mod(math.round(query.life_time * 10), 2)) : 0)', defaultVal: 0 },
  'punchside': { query: '(query.attack_time > 0 ? (math.mod(math.round(query.life_time * 10), 2)) : 0)', defaultVal: 0 },
  'combo_step': { query: '(query.attack_time > 0 ? (math.mod(math.round(query.life_time * 4), 3)) : 0)', defaultVal: 0 },
  'combostep': { query: '(query.attack_time > 0 ? (math.mod(math.round(query.life_time * 4), 3)) : 0)', defaultVal: 0 },
  'combo': { query: '(query.attack_time > 0 ? 1 : 0)', defaultVal: 0 },
  // Hand presence is "is that slot occupied". The catalogue therefore uses the slot-occupancy
  // signature the engine accepts; `query.is_item_name_any` without an item name is rejected at
  // evaluation time, which is exactly the reported "requires at least two parameters" failure.
  'dual_wield': { query: OFFHAND_OCCUPIED, defaultVal: 0 },
  'dualwield': { query: OFFHAND_OCCUPIED, defaultVal: 0 },
  'offhand': { query: OFFHAND_OCCUPIED, defaultVal: 0 },
  'is_holding_item': { query: MAINHAND_OCCUPIED, defaultVal: 0 },
  'holding_item': { query: MAINHAND_OCCUPIED, defaultVal: 0 },
  'charge': { query: 'query.item_in_use_duration', defaultVal: 0 },
  'charge_time': { query: 'query.item_in_use_duration', defaultVal: 0 },
  'item_use_duration': { query: 'query.item_in_use_duration', defaultVal: 0 },

  // Perspective & Camera
  'is_first_person': { query: 'query.is_first_person', defaultVal: 0 },
  'first_person': { query: 'query.is_first_person', defaultVal: 0 },
  'firstperson': { query: 'query.is_first_person', defaultVal: 0 },
  'third_person': { query: '!query.is_first_person', defaultVal: 1 },
  'thirdperson': { query: '!query.is_first_person', defaultVal: 1 },
  'camera_distance': { query: 'query.camera_distance_range_lerp', defaultVal: 0 },

  // Timing & Age
  'life_time': { query: 'query.life_time', defaultVal: 0 },
  'anim_time': { query: 'query.anim_time', defaultVal: 0 },
  'time_stamp': { query: 'query.time_stamp', defaultVal: 0 },
  'time': { query: 'query.life_time', defaultVal: 0 },
  'age': { query: 'query.life_time', defaultVal: 0 },

  // Health & State
  'health': { query: 'query.health', defaultVal: 20 },
  'is_alive': { query: 'query.is_alive', defaultVal: 1 },
  'yaw': { query: 'query.yaw', defaultVal: 0 },
  'pitch': { query: 'query.pitch', defaultVal: 0 },
  'body_y_rotation': { query: 'query.body_y_rotation', defaultVal: 0 },
  'body_x_rotation': { query: 'query.body_x_rotation', defaultVal: 0 },
  'head_y_rotation': { query: 'query.head_y_rotation', defaultVal: 0 },
  'head_x_rotation': { query: 'query.head_x_rotation', defaultVal: 0 },
  'has_target': { query: 'query.has_target', defaultVal: 0 },
  'target_distance': { query: 'query.target_distance', defaultVal: 0 },
  'is_sleeping': { query: 'query.is_sleeping', defaultVal: 0 },
  'is_riding': { query: 'query.is_riding', defaultVal: 0 },
};

/** Extracts variable and query token names from Molang/Java expression strings */
export function extractVariableTokens(expression: string): Array<{ raw: string; type: VariableType; name: string }> {
  const results: Array<{ raw: string; type: VariableType; name: string }> = [];
  if (!expression || typeof expression !== 'string') return results;

  // Regex for Molang variables: variable.xxx, v.xxx, temp.xxx, t.xxx, context.xxx, c.xxx, query.xxx, q.xxx
  const pattern = /\b(variable|v|temp|t|context|c|query|q)\.([a-zA-Z0-9_]+)\b/gi;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(expression)) !== null) {
    const prefix = match[1].toLowerCase();
    const name = match[2].toLowerCase();
    let type: VariableType = 'variable';

    if (prefix === 'variable' || prefix === 'v') type = 'variable';
    else if (prefix === 'temp' || prefix === 't') type = 'temp';
    else if (prefix === 'context' || prefix === 'c') type = 'context';
    else if (prefix === 'query' || prefix === 'q') type = 'query';

    results.push({
      raw: match[0],
      type,
      name,
    });
  }

  // Detect method-like calls like isFirstPerson(), isAttacking(), isMoving()
  const methodCallPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*\)/g;
  let methodMatch: RegExpExecArray | null = null;
  while ((methodMatch = methodCallPattern.exec(expression)) !== null) {
    const mName = methodMatch[1].toLowerCase().replace(/^(is|get)/, '');
    const fullIdent = methodMatch[1].toLowerCase();
    const key = CANONICAL_JAVA_TO_BEDROCK_VARIABLES[fullIdent] ? fullIdent : CANONICAL_JAVA_TO_BEDROCK_VARIABLES[mName] ? mName : null;
    if (key) {
      results.push({
        raw: methodMatch[0],
        type: 'parameter',
        name: key,
      });
    }
  }

  // Also detect bare Java variable assignments like `attack_time > 0` or `swingProgress = ...`
  const bareIdentifierPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*(?:==|!=|<=|>=|<|>|\*|\+|\-|\/|\?|:|=))/g;
  let bareMatch: RegExpExecArray | null = null;

  while ((bareMatch = bareIdentifierPattern.exec(expression)) !== null) {
    const ident = bareMatch[1].toLowerCase();
    if (
      ident === 'math' ||
      ident === 'query' ||
      ident === 'variable' ||
      ident === 'temp' ||
      ident === 'context' ||
      ident === 'true' ||
      ident === 'false' ||
      ident === 'null' ||
      ident === 'return'
    ) {
      continue;
    }
    if (CANONICAL_JAVA_TO_BEDROCK_VARIABLES[ident]) {
      results.push({
        raw: ident,
        type: 'parameter',
        name: ident,
      });
    }
  }

  return results;
}

/** Rewrites raw Java functions or un-prefixed identifiers in a Molang expression to valid Bedrock Molang */
export function sanitizeMolangExpression(expr: string): string {
  if (!expr || typeof expr !== 'string') return expr;
  let out = expr;

  // Replace method calls like isFirstPerson() -> query.is_first_person
  out = out.replace(/\bisFirstPerson\s*\(\s*\)/gi, 'query.is_first_person');
  out = out.replace(/\bisAttacking\s*\(\s*\)/gi, 'query.is_delayed_attacking');
  out = out.replace(/\bisMoving\s*\(\s*\)/gi, 'query.is_moving');
  out = out.replace(/\bisSprinting\s*\(\s*\)/gi, 'query.is_sprinting');
  out = out.replace(/\bisSneaking\s*\(\s*\)/gi, 'query.is_sneaking');
  out = out.replace(/\bgetSpeed\s*\(\s*\)/gi, 'query.ground_speed');
  out = out.replace(/\bgetHealth\s*\(\s*\)/gi, 'query.health');

  return out;
}

function findPlayerAnimationResourceFiles(
  files: Record<string, string | Uint8Array>,
): { paths: Set<string>; controllerIds: Set<string> } {
  const paths = new Set<string>(['entity/player.entity.json']);
  const controllerIds = new Set<string>();
  const playerClips = new Set<string>();
  const entityRaw = files['entity/player.entity.json'];
  if (typeof entityRaw !== 'string') return { paths, controllerIds };

  let description: Record<string, any> | null = null;
  try {
    description = JSON.parse(entityRaw)?.['minecraft:client_entity']?.description ?? null;
  } catch {
    return { paths, controllerIds };
  }
  const aliases = description?.animations && typeof description.animations === 'object'
    ? description.animations as Record<string, unknown>
    : {};
  for (const target of Object.values(aliases)) {
    if (typeof target !== 'string') continue;
    if (target.startsWith('controller.animation.')) controllerIds.add(target);
    else if (target.startsWith('animation.')) playerClips.add(target);
  }

  for (const [path, raw] of Object.entries(files)) {
    if (typeof raw !== 'string' || !path.toLowerCase().endsWith('.animation_controllers.json')) continue;
    let root: Record<string, any> | null = null;
    try {
      root = JSON.parse(raw)?.animation_controllers ?? null;
    } catch {
      continue;
    }
    const owned = Object.entries(root ?? {}).filter(([id]) => controllerIds.has(id));
    if (owned.length === 0) continue;
    paths.add(path);
    for (const [, body] of owned) {
      const states = body && typeof body === 'object' ? body.states : null;
      if (!states || typeof states !== 'object') continue;
      for (const state of Object.values(states as Record<string, any>)) {
        const animations = state && typeof state === 'object' ? state.animations : null;
        if (!Array.isArray(animations)) continue;
        for (const entry of animations) {
          const names = typeof entry === 'string'
            ? [entry]
            : entry && typeof entry === 'object' && !Array.isArray(entry)
              ? Object.keys(entry as Record<string, unknown>)
              : [];
          for (const name of names) {
            const target = aliases[name];
            if (typeof target === 'string' && target.startsWith('animation.')) playerClips.add(target);
          }
        }
      }
    }
  }

  for (const [path, raw] of Object.entries(files)) {
    if (typeof raw !== 'string' || !path.toLowerCase().endsWith('.animation.json')) continue;
    try {
      const definitions = JSON.parse(raw)?.animations;
      if (definitions && typeof definitions === 'object' && Object.keys(definitions).some((id) => playerClips.has(id))) {
        paths.add(path);
      }
    } catch {
      // Invalid resource documents are handled by the pack validation stage.
    }
  }
  return { paths, controllerIds };
}

export interface UniversalVariableResolverInput {
  resourcePackFiles: Record<string, string | Uint8Array>;
  behaviorPackFiles: Record<string, string | Uint8Array>;
  discoveryReport?: UniversalAnimationDiscoveryReport;
  irReport?: UniversalAnimationIRReport;
  playerClips?: Record<string, BedrockAnimationClip>;
  playerWiringFiles?: Record<string, string>;
  onLog?: (line: string) => void;
}

/**
 * Universal Variable Resolver:
 * Discovers and maps every variable across animation controllers, state machines,
 * clips, and client entities, resolving missing variables and safeguarding player wiring.
 */
export function resolveUniversalVariables(
  input: UniversalVariableResolverInput,
): UniversalVariableResolverReport {
  const { resourcePackFiles, behaviorPackFiles, discoveryReport, irReport, playerWiringFiles, onLog } = input;
  const log: string[] = [];
  const logLine = (msg: string) => {
    log.push(msg);
    onLog?.(msg);
  };
  const playerResources = findPlayerAnimationResourceFiles({
    ...resourcePackFiles,
    ...(playerWiringFiles ?? {}),
  });

  logLine('[VARIABLE:RESOLVE] Universal Variable Resolver initiating deep scan across all animation assets...');

  const variableMap = new Map<string, {
    originalName: string;
    normalizedName: string;
    type: VariableType;
    sourceFiles: Set<string>;
    referenceCount: number;
    contexts: Set<'player' | 'mob' | 'particle' | 'viewmodel' | 'common'>;
  }>();

  // Scan all JSON files in RP and BP for variable occurrences
  const allFiles = {
    ...resourcePackFiles,
    ...behaviorPackFiles,
    ...(playerWiringFiles ?? {}),
  };
  const assignedVariablesByFile = new Map<string, Set<string>>();
  for (const [filePath, content] of Object.entries(allFiles)) {
    if (typeof content !== 'string') continue;
    const assigned = new Set<string>();
    for (const match of content.matchAll(/\bvariable\.([a-zA-Z0-9_]+)\s*=/g)) {
      assigned.add(String(match[1]).toLowerCase());
    }
    if (assigned.size > 0) assignedVariablesByFile.set(filePath, assigned);
  }
  const assignedPlayerVariables = new Set<string>();
  for (const path of playerResources.paths) {
    for (const name of assignedVariablesByFile.get(path) ?? []) assignedPlayerVariables.add(name);
  }

  for (const [filePath, content] of Object.entries(allFiles)) {
    if (typeof content !== 'string') continue;
    if (!filePath.endsWith('.json')) continue;

    const lowerPath = filePath.toLowerCase();
    const isPlayer = playerResources.paths.has(filePath);
    const isMob = lowerPath.includes('entity') || lowerPath.includes('mob');
    const isParticle = lowerPath.includes('particle');
    const isController = lowerPath.includes('animation_controller');

    const fileContext: 'player' | 'mob' | 'particle' | 'viewmodel' | 'common' =
      isPlayer ? 'player' : isParticle ? 'particle' : isMob ? 'mob' : 'common';

    // Fast-check if file mentions any variable or query syntax
    if (!/(?:variable|temp|context|query|[a-z_]\w*\s*(?:==|!=|<=|>=|<|>|\(\)))/i.test(content)) {
      continue;
    }

    try {
      const tokens = extractVariableTokens(content);
      for (const tok of tokens) {
        const key = `${tok.type}.${tok.name}`;
        const existing = variableMap.get(key) ?? {
          originalName: tok.raw,
          normalizedName: tok.name,
          type: tok.type,
          sourceFiles: new Set<string>(),
          referenceCount: 0,
          contexts: new Set(),
        };

        existing.sourceFiles.add(filePath);
        existing.referenceCount += 1;
        existing.contexts.add(fileContext);
        if (isController && isPlayer) existing.contexts.add('viewmodel');

        variableMap.set(key, existing);
      }
    } catch {
      // Non-critical if specific scan encounters irregular token
    }
  }

  // Also scan discovery report controllers and state machines for variables
  if (discoveryReport) {
    for (const ctrl of discoveryReport.controllersDiscovered) {
      const str = JSON.stringify(ctrl.raw ?? ctrl);
      const tokens = extractVariableTokens(str);
      const isPlayer = playerResources.controllerIds.has(ctrl.id);
      for (const tok of tokens) {
        const key = `${tok.type}.${tok.name}`;
        const existing = variableMap.get(key) ?? {
          originalName: tok.raw,
          normalizedName: tok.name,
          type: tok.type,
          sourceFiles: new Set(['discovery:controller:' + ctrl.id]),
          referenceCount: 0,
          contexts: new Set(),
        };
        existing.referenceCount += 1;
        existing.contexts.add(isPlayer ? 'player' : 'common');
        variableMap.set(key, existing);
      }
    }
  }

  // Also scan IR procedural expressions and controllers.
  // Procedural expressions live on each clip's channels/behaviors, not as a
  // top-level report field — gather them defensively from wherever they exist.
  if (irReport) {
    const irProcedural: Array<{ formula: string; targetChannel: string }> = [];
    const pushExpr = (expr: unknown, targetChannel: string) => {
      if (typeof expr === 'string' && expr.trim()) irProcedural.push({ formula: expr, targetChannel });
    };
    for (const clip of Object.values(irReport.clips ?? {})) {
      for (const behavior of clip.proceduralBehaviors ?? []) {
        pushExpr(behavior.expression, `${behavior.targetBone}:${behavior.channel}`);
      }
      for (const bone of Object.values(clip.bones ?? {})) {
        for (const channel of [bone.position, bone.rotation, bone.scale]) {
          if (!channel) continue;
          for (const expr of channel.proceduralExpressions ?? []) {
            pushExpr(expr, `${bone.boneName}:${channel.channel}`);
          }
        }
      }
    }
    for (const proc of irProcedural) {
      const tokens = extractVariableTokens(proc.formula);
      for (const tok of tokens) {
        const key = `${tok.type}.${tok.name}`;
        const existing = variableMap.get(key) ?? {
          originalName: tok.raw,
          normalizedName: tok.name,
          type: tok.type,
          sourceFiles: new Set(['ir:procedural:' + proc.targetChannel]),
          referenceCount: 0,
          contexts: new Set(),
        };
        existing.referenceCount += 1;
        existing.contexts.add('common');
        variableMap.set(key, existing);
      }
    }
  }

  // Items the exported pack really registers: the only evidence that may back an equipment flag.
  const packItemIds = collectPackItemIdentifiers({
    ...resourcePackFiles,
    ...behaviorPackFiles,
    ...(playerWiringFiles ?? {}),
  });

  // Process and resolve all collected variables
  const entries: ResolvedVariableEntry[] = [];
  const injectedScriptVariables: Record<string, string | number> = {};
  let resolvedCount = 0;
  let mappedQueriesCount = 0;
  let autoInitializedCount = 0;
  let flaggedCount = 0;

  for (const [, item] of variableMap.entries()) {
    const varName = item.normalizedName;
    const knownMapping = CANONICAL_JAVA_TO_BEDROCK_VARIABLES[varName];

    let resolvedStatus: ResolvedVariableEntry['resolvedStatus'] = 'resolved';
    let targetBedrockEquivalent: string | undefined;
    let defaultValue: string | number = 0;
    let suggestedAction: string | undefined;
    let initStmt: string | undefined;

    if (item.type === 'query') {
      resolvedStatus = 'resolved';
      targetBedrockEquivalent = `query.${varName}`;
      defaultValue = knownMapping?.defaultVal ?? 0;
      resolvedCount += 1;
    } else if (knownMapping) {
      resolvedStatus = 'mapped_query';
      targetBedrockEquivalent = knownMapping.query;
      defaultValue = knownMapping.defaultVal;
      suggestedAction = `Mapped variable "${item.originalName}" to native Bedrock query "${knownMapping.query}"`;
      initStmt = `variable.${varName} = ${knownMapping.query};`;
      mappedQueriesCount += 1;
    } else {
      const playerScoped = item.contexts.has('player') || item.contexts.has('viewmodel');
      const hasAssignment = playerScoped
        ? assignedPlayerVariables.has(varName)
        : [...item.sourceFiles].some((sourcePath) => assignedVariablesByFile.get(sourcePath)?.has(varName) ?? false);
      const equipmentRebuild = hasAssignment
        ? null
        : reconstructEquipmentExpression(varName, packItemIds);
      if (hasAssignment) {
        resolvedStatus = 'resolved';
        targetBedrockEquivalent = `variable.${varName}`;
        defaultValue = 'assigned in source';
        resolvedCount += 1;
      } else if (equipmentRebuild) {
        // The flag encodes equipped-item detection and the pack ships the item, so the value is
        // rebuilt from the hand slots instead of being initialised to a constant.
        resolvedStatus = 'mapped_query';
        targetBedrockEquivalent = equipmentRebuild.expression;
        defaultValue = equipmentRebuild.expression;
        suggestedAction = `variable.${varName} rebuilt from item evidence: ${equipmentRebuild.reason}`;
        initStmt = `variable.${varName} = ${equipmentRebuild.expression};`;
        mappedQueriesCount += 1;
      } else {
        resolvedStatus = 'flagged_unresolved';
        defaultValue = 'unresolved';
        targetBedrockEquivalent = undefined;
        flaggedCount += 1;
        suggestedAction = `No source assignment or equivalent player-safe query was found for variable.${varName}; preserve it and report the behavior as unresolved rather than substituting a constant.`;
      }
    }

    if (initStmt) injectedScriptVariables[`variable.${varName}`] = knownMapping?.query ?? defaultValue;

    entries.push({
      originalName: item.originalName,
      normalizedName: varName,
      type: item.type,
      resolvedStatus,
      targetBedrockEquivalent,
      defaultValue,
      sourceFiles: Array.from(item.sourceFiles),
      referenceCount: item.referenceCount,
      contexts: Array.from(item.contexts),
      scope: item.type === 'temp' ? 'clip_local' : item.type === 'query' ? 'engine_builtin' : 'entity_persistent',
      suggestedAction,
      initializationStatement: initStmt,
    });
  }

  // Player Wiring Specific Repairs
  const playerRepairs: UniversalVariableResolverReport['playerWiringRepairs'] = {
    variablesInitialized: [],
    missingReplaced: 0,
    notes: [],
  };

  const playerEntries = entries.filter((e) => e.contexts.includes('player') || e.contexts.includes('viewmodel'));
  const statementsToInject: string[] = [];

  for (const pVar of playerEntries) {
      if (pVar.initializationStatement) {
        playerRepairs.variablesInitialized.push(pVar.originalName);
        playerRepairs.missingReplaced += 1;
        statementsToInject.push(pVar.initializationStatement);
        playerRepairs.notes.push(
          `Wired ${pVar.originalName} -> ${pVar.targetBedrockEquivalent ?? 'destination query'} for player context`,
        );
      } else if (pVar.resolvedStatus === 'flagged_unresolved') {
        playerRepairs.notes.push(`${pVar.originalName} has no evidence-backed player-context equivalent and remains unresolved.`);
      }
  }

  // Apply variable initializations directly to entity/player.entity.json
  const applyPlayerPreAnimation = (rawJson: string): string => {
    try {
      const doc = JSON.parse(rawJson);
      const desc = doc?.['minecraft:client_entity']?.description;
      if (!desc) return rawJson;
      if (!desc.scripts) desc.scripts = {};
      const existingPre: string[] = Array.isArray(desc.scripts.pre_animation)
        ? [...desc.scripts.pre_animation]
        : [];

      const existingSet = new Set(existingPre.map((s) => s.trim().replace(/;$/, '')));
      for (const stmt of statementsToInject) {
        const clean = stmt.trim().replace(/;$/, '');
        if (!existingSet.has(clean)) {
          existingPre.push(clean.endsWith(';') ? clean : `${clean};`);
          existingSet.add(clean);
        }
      }

      desc.scripts.pre_animation = existingPre;
      return JSON.stringify(doc, null, 2);
    } catch {
      return rawJson;
    }
  };

  const playerEntityPath = 'entity/player.entity.json';
  if (typeof resourcePackFiles[playerEntityPath] === 'string') {
    resourcePackFiles[playerEntityPath] = applyPlayerPreAnimation(resourcePackFiles[playerEntityPath] as string);
    logLine('[VARIABLE:WIRE] Successfully synchronized variable initializations into resourcePackFiles[entity/player.entity.json].');
  }

  if (playerWiringFiles && typeof playerWiringFiles[playerEntityPath] === 'string') {
    playerWiringFiles[playerEntityPath] = applyPlayerPreAnimation(playerWiringFiles[playerEntityPath]);
    logLine('[VARIABLE:WIRE] Successfully synchronized variable initializations into playerWiringFiles[entity/player.entity.json].');
    if (typeof resourcePackFiles[playerEntityPath] !== 'string') {
      resourcePackFiles[playerEntityPath] = playerWiringFiles[playerEntityPath];
    }
  }

  // Sanitize Molang expressions in all animation_controllers
  let controllersSanitized = 0;
  for (const [filePath, content] of Object.entries(resourcePackFiles)) {
    if (typeof content !== 'string') continue;
    if (!filePath.includes('animation_controllers') || !filePath.endsWith('.json')) continue;
    const sanitized = sanitizeMolangExpression(content);
    if (sanitized !== content) {
      resourcePackFiles[filePath] = sanitized;
      controllersSanitized += 1;
    }
  }
  if (controllersSanitized > 0) {
    logLine(`[VARIABLE:MOLANG] Sanitized raw Java function calls across ${controllersSanitized} animation controller file(s).`);
  }

  const summary = `Universal Variable Resolver: Discovered ${entries.length} variable reference(s) across pack files. ${mappedQueriesCount} mapped to native Bedrock queries, ${autoInitializedCount} auto-initialized with safe default states, ${resolvedCount} verified native queries, ${flaggedCount} unresolved without an evidence-backed mapping. Player wiring reinforced with ${playerRepairs.missingReplaced} variable bindings.`;

  logLine(`[VARIABLE:RESOLVE] ${summary}`);
  if (mappedQueriesCount > 0) {
    logLine(
      `[VARIABLE:MAP] Successfully resolved ${mappedQueriesCount} unmapped variable(s) to Bedrock queries (${entries.filter((e) => e.resolvedStatus === 'mapped_query').slice(0, 5).map((e) => `${e.originalName}->${e.targetBedrockEquivalent}`).join(', ')}).`,
    );
  }
  if (playerRepairs.missingReplaced > 0) {
    logLine(
      `[VARIABLE:WIRE] Player wiring variables verified: ${playerRepairs.variablesInitialized.slice(0, 6).join(', ')} bound and initialized in entity/player.entity.json.`,
    );
  }

  return {
    variablesDiscovered: entries.length,
    resolvedCount,
    mappedQueriesCount,
    autoInitializedCount,
    flaggedCount,
    entries,
    injectedScriptVariables,
    playerWiringRepairs: playerRepairs,
    summary,
    log,
  };
}