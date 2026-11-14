import { safeFileId } from '@/utils/bedrockIds';
import { translateMolangExpression } from '@/utils/molangCompatibility';
import {
  FIRST_PERSON_GATE,
  PLAYER_BASELINE_ENTRIES,
  VANILLA_PLAYER_ANIMATE,
  VANILLA_PLAYER_ANIMATIONS,
  VANILLA_PLAYER_ANIMATION_IDS,
  VANILLA_PLAYER_CONTROLLER_IDS,
  VANILLA_PLAYER_VARIABLE_EXPRESSIONS,
  findPlayerClientEntityPath,
  isVanillaPlayerBaselineIdentifier,
  isVanillaPlayerDocumentPath,
} from '@/utils/vanillaPlayerBaseline';
import { collectPackItemIdentifiers, reconstructEquipmentExpression, type PackFiles } from '@/utils/variableReconstruction';
import { equipmentVisibilityExpression } from '@/utils/molangScopeBinder';

/**
 * Baseline player dependency resolver.
 *
 * The reported failures this stage exists for are all the same defect with different symptoms:
 * a reference from `entity/player.entity.json` into the player rig that nothing in the exported
 * archive can satisfy.
 *
 *   - `base_pose` / `look_at_target` / `first_person_base_pose` are reported missing because the
 *     pack occupies a document the vanilla resource set owns (`animations/player.animation.json`,
 *     `animations/humanoid.animation.json`), which deletes the engine's own definitions;
 *   - an alias in `scripts.animate` that the `animations` map never declares resolves to nothing;
 *   - an identifier that was altered during conversion ships next to a definition that exists
 *     under a slightly different name;
 *   - `variable.tcos0` / `variable.melee_spear_equipped` are read by shipped clips and declared
 *     nowhere, because the vanilla `player.entity.json` pre_animation block that declares them was
 *     replaced by this pack.
 *
 * For each of those this pass either repairs the reference from evidence, restores the vanilla
 * baseline wiring, or reports the exact limitation. It never invents a placeholder animation, and
 * it never replaces a variable with a constant to make a log quiet.
 */

export type PlayerDependencyKind =
  | 'shipped_definition'
  | 'vanilla_engine_definition'
  | 'repaired_identifier'
  | 'missing_definition';

export interface PlayerAnimationDependency {
  identifier: string;
  /** Where the player definition references it. */
  referencedBy: 'animations_map' | 'scripts_animate' | 'controller_state';
  detail: string;
  kind: PlayerDependencyKind;
  /** Identifier that actually resolves, when the reference was repaired. */
  resolvedIdentifier: string | null;
  evidence: string;
}

export interface PlayerVariableDependency {
  variable: string;
  declaredIn: string[];
  /** Files/contexts that read it. */
  referencedIn: string[];
  reconstructedExpression: string | null;
  reason: string;
}

export interface PlayerDependencyResolverReport {
  documentsPreserved: Array<{ from: string; to: string; reason: string }>;
  baselineWiringAdded: string[];
  playerEntityFound: boolean;
  playerEntityFile: string | null;
  dependenciesExamined: number;
  shippedDefinition: number;
  vanillaEngineDefinition: number;
  identifiersRepaired: Array<{ from: string; to: string; resolved: string; files: string[] }>;
  /** Dangling `scripts.animate` entries dropped because nothing can ever resolve them. */
  animateEntriesRemoved: string[];
  missingDefinitions: PlayerAnimationDependency[];
  variables: {
    referenced: number;
    declared: number;
    reconstructed: number;
    injected: string[];
    /** Variables no archive scope declared and no evidence backed, initialised so they evaluate. */
    initialisedWithoutRecovery: string[];
    unresolved: PlayerVariableDependency[];
  };
  firstPerson: {
    basePosePresent: boolean;
    basePoseResolves: boolean;
    basePoseGated: boolean;
    attackControllerGated: boolean;
    ready: boolean;
  };
  blocking: string[];
  /** True only when the shipped JSON wiring is sound. Never a claim about live playback. */
  staticValidationPassed: boolean;
  notes: string[];
  summary: string;
}

const ANIMATION_ID = /\banimation\.[a-z0-9_.-]+/i;
const CONTROLLER_ID = /\bcontroller\.animation\.[a-z0-9_.-]+/i;
const VARIABLE_READ = /\bvariable\.([a-zA-Z0-9_]+)/g;
const VARIABLE_ASSIGN = /\bvariable\.([a-zA-Z0-9_]+)\s*=(?!=)/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(raw: string | Uint8Array | undefined): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normaliseToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function lastSegment(identifier: string): string {
  const parts = identifier.split(/[.:/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : identifier;
}

/**
 * Step 1 — resource assembly.
 *
 * A generated document sitting on a path the vanilla resource set owns replaces the engine's
 * definitions. Documents that do not define a baseline identifier are relocated under the mod's own
 * name instead: identifiers are global, so nothing inside the file changes and the engine keeps its
 * base poses.
 */
function preserveVanillaDocuments(
  files: PackFiles,
  modId: string,
  notes: string[],
): Array<{ from: string; to: string; reason: string }> {
  const preserved: Array<{ from: string; to: string; reason: string }> = [];
  const used = new Set(Object.keys(files).map((path) => path.toLowerCase()));
  const prefix = safeFileId(modId) || 'ported';

  for (const path of Object.keys(files)) {
    const lower = path.toLowerCase();
    if (!isVanillaPlayerDocumentPath(lower)) continue;
    if (lower === 'entity/player.entity.json') continue;
    const raw = files[path];
    if (typeof raw !== 'string') continue;
    // Even when this document defines one vanilla identifier, leaving it on a vanilla-owned
    // path replaces the engine's entire document and hides every other built-in definition in
    // that document (for example base_pose, look_at_target or first_person_base_pose). Move the
    // whole document intact to a mod-owned path. Its animation/controller identifiers remain
    // unchanged and globally resolvable, while the engine's complete vanilla document survives.
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    let target = `${dir}${prefix}_${name}`;
    let index = 2;
    while (used.has(target.toLowerCase())) {
      target = `${dir}${prefix}_${index}_${name}`;
      index += 1;
    }
    files[target] = raw;
    delete files[path];
    used.add(target.toLowerCase());
    used.delete(lower);
    preserved.push({
      from: path,
      to: target,
      reason:
        'this path belongs to the vanilla resource set; keeping the generated document there would delete the engine definitions the player rig still references',
    });
  }
  return preserved;
}

interface ShippedResources {
  clips: Map<string, string>;
  controllers: Map<string, string>;
}

function collectShippedResources(files: PackFiles): ShippedResources {
  const clips = new Map<string, string>();
  const controllers = new Map<string, string>();
  for (const [path, raw] of Object.entries(files)) {
    const lower = path.toLowerCase();
    if (typeof raw !== 'string' || !lower.endsWith('.json')) continue;
    if (lower.endsWith('.animation_controllers.json')) {
      const doc = parseJson(raw);
      const defs = doc?.animation_controllers;
      if (isRecord(defs)) for (const id of Object.keys(defs)) controllers.set(id, path);
    } else if (lower.endsWith('.animation.json')) {
      const doc = parseJson(raw);
      const defs = doc?.animations;
      if (isRecord(defs)) for (const id of Object.keys(defs)) clips.set(id, path);
    }
  }
  return { clips, controllers };
}

/** Finds the shipped identifier a dangling reference most likely meant, or null when ambiguous. */
function findAlteredIdentifier(identifier: string, shipped: Iterable<string>): string | null {
  const wanted = normaliseToken(identifier);
  const wantedTail = normaliseToken(lastSegment(identifier));
  const exact: string[] = [];
  const tail: string[] = [];
  for (const candidate of shipped) {
    const token = normaliseToken(candidate);
    if (token === wanted) exact.push(candidate);
    else if (token.endsWith(wantedTail) || wantedTail.endsWith(normaliseToken(lastSegment(candidate)))) {
      tail.push(candidate);
    }
  }
  const pool = exact.length > 0 ? exact : tail;
  return pool.length === 1 ? pool[0] : null;
}

function collectStrings(node: unknown, out: string[], depth = 0): void {
  if (depth > 12) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const entry of node) collectStrings(entry, out, depth + 1);
    return;
  }
  if (isRecord(node)) {
    for (const value of Object.values(node)) collectStrings(value, out, depth + 1);
  }
}

/** Number of `variable.x` reads per variable name across the supplied documents. */
function countReads(documents: string[]): Map<string, number> {
  const found = new Map<string, number>();
  for (const raw of documents) {
    for (const match of raw.matchAll(VARIABLE_READ)) {
      const name = String(match[1]);
      found.set(name, (found.get(name) ?? 0) + 1);
    }
  }
  return found;
}

export function resolvePlayerDependencies(input: {
  modId: string;
  resourcePackFiles: PackFiles;
  behaviorPackFiles?: PackFiles;
  onLog?: (line: string) => void;
}): PlayerDependencyResolverReport {
  const log = (line: string) => input.onLog?.(line);
  const files = input.resourcePackFiles;
  const notes: string[] = [];

  const report: PlayerDependencyResolverReport = {
    documentsPreserved: [],
    baselineWiringAdded: [],
    playerEntityFound: false,
    playerEntityFile: null,
    dependenciesExamined: 0,
    shippedDefinition: 0,
    vanillaEngineDefinition: 0,
    identifiersRepaired: [],
    animateEntriesRemoved: [],
    missingDefinitions: [],
    variables: {
      referenced: 0,
      declared: 0,
      reconstructed: 0,
      injected: [],
      initialisedWithoutRecovery: [],
      unresolved: [],
    },
    firstPerson: {
      basePosePresent: false,
      basePoseResolves: false,
      basePoseGated: false,
      attackControllerGated: false,
      ready: false,
    },
    blocking: [],
    staticValidationPassed: false,
    notes,
    summary: '',
  };

  // 1. Never delete the engine's own player resources while assembling the archive.
  report.documentsPreserved = preserveVanillaDocuments(files, input.modId, notes);
  for (const entry of report.documentsPreserved) {
    log(`[PLAYER:BASELINE:PRESERVE] ${entry.from} → ${entry.to} — ${entry.reason}.`);
  }

  const shipped = collectShippedResources(files);
  // The player definition is located by the identifier it declares, not by a file name: a port may
  // ship it under a generated name, and a path-only lookup then reports "no player client entity"
  // while the archive really contains one — which is how baseline wiring went missing.
  const entityPath = findPlayerClientEntityPath(files);
  const entityRaw = entityPath ? files[entityPath] : undefined;
  const doc = parseJson(entityRaw);
  const clientEntity = doc?.['minecraft:client_entity'];
  const description = isRecord(clientEntity) ? clientEntity.description : undefined;
  if (!entityPath || !isRecord(description)) {
    report.summary =
      'No player client entity ships, so no player animation dependency exists to resolve. Nothing is invented in its place.';
    log(`[PLAYER:BASELINE] ${report.summary}`);
    return report;
  }
  report.playerEntityFound = true;
  report.playerEntityFile = entityPath;
  log(
    `[PLAYER:BASELINE:FILE] player client entity resolved at ${entityPath} (identifier minecraft:player); every baseline, variable and perspective check below is applied to this document.`,
  );

  // 2. Restore the baseline wiring the vanilla player definition guarantees.
  const animations: Record<string, unknown> = isRecord(description.animations) ? { ...description.animations } : {};
  const scripts: Record<string, unknown> = isRecord(description.scripts) ? { ...description.scripts } : {};
  const animate: unknown[] = Array.isArray(scripts.animate) ? [...scripts.animate] : [];

  for (const entry of PLAYER_BASELINE_ENTRIES) {
    if (typeof animations[entry.alias] !== 'string') {
      animations[entry.alias] = entry.identifier;
      report.baselineWiringAdded.push(entry.alias);
    }
    const shouldAnimateDirectly = VANILLA_PLAYER_ANIMATE.some((item) =>
      typeof item === 'string' ? item === entry.alias : isRecord(item) && entry.alias in item,
    );
    const bound = animate.some((item) =>
      typeof item === 'string' ? item === entry.alias : isRecord(item) && entry.alias in item,
    );
    if (shouldAnimateDirectly && !bound) {
      animate.push(entry.alias);
      report.baselineWiringAdded.push(`${entry.alias}:animate`);
    }
  }
  if (report.baselineWiringAdded.length > 0) {
    log(
      `[PLAYER:BASELINE:WIRE] Restored ${report.baselineWiringAdded.length} baseline player wiring entr(ies): ` +
        `${report.baselineWiringAdded.slice(0, 8).join(', ')}. These identifier(s) are provided by the engine, so the reference is preserved instead of replaced.`,
    );
  }

  // 3. Resolve every animation reference the player definition makes.
  const governingControllers = new Set<string>();
  for (const value of Object.values(animations)) {
    if (typeof value === 'string' && value.startsWith('controller.animation.')) governingControllers.add(value);
  }
  const controllerPaths = [...governingControllers]
    .map((id) => shipped.controllers.get(id))
    .filter((path): path is string => Boolean(path));

  const resolved: PlayerAnimationDependency[] = [];
  const registerDependency = (dependency: PlayerAnimationDependency) => {
    report.dependenciesExamined += 1;
    if (dependency.kind === 'shipped_definition') report.shippedDefinition += 1;
    if (dependency.kind === 'vanilla_engine_definition') report.vanillaEngineDefinition += 1;
    if (dependency.kind === 'repaired_identifier') {
      report.shippedDefinition += 1;
    }
    if (dependency.kind === 'missing_definition') report.missingDefinitions.push(dependency);
    resolved.push(dependency);
  };

  // A reference only resolves when a definition of the KIND it addresses exists: an entry that
  // names a controller needs a `*.animation_controllers.json` definition, an entry that names a
  // clip needs a `*.animation.json` one. Treating both tables as one pool is what let a controller
  // reference look satisfied while the engine reported "cannot find controller.animation.…".
  for (const [alias, value] of Object.entries(animations)) {
    if (typeof value !== 'string' || !value) continue;
    const wantsController = value.startsWith('controller.');
    const kindPath = wantsController ? shipped.controllers.get(value) : shipped.clips.get(value);
    const otherKindPath = wantsController ? shipped.clips.get(value) : shipped.controllers.get(value);
    if (kindPath) {
      registerDependency({
        identifier: value,
        referencedBy: 'animations_map',
        detail: `alias "${alias}"`,
        kind: 'shipped_definition',
        resolvedIdentifier: value,
        evidence: `defined in ${kindPath}`,
      });
      continue;
    }
    if (otherKindPath) {
      // The identifier exists, but in a document the engine does not load for this kind. It is not
      // counted as resolved; the kind-aware reference resolver relocates the definition and
      // rewrites the registration, and this finding records why.
      log(
        `[PLAYER:BASELINE:KIND] alias "${alias}" names ${value}, which is filed in ${otherKindPath} as a ${wantsController ? 'clip' : 'controller'}; the registration is repaired by the document-kind pass rather than accepted as resolved.`,
      );
    }
    if (isVanillaPlayerBaselineIdentifier(value)) {
      registerDependency({
        identifier: value,
        referencedBy: 'animations_map',
        detail: `alias "${alias}"`,
        kind: 'vanilla_engine_definition',
        resolvedIdentifier: value,
        evidence: 'provided by the vanilla player resource set, which this pack no longer overrides',
      });
      continue;
    }
    const candidate = findAlteredIdentifier(value, [...shipped.clips.keys(), ...shipped.controllers.keys()]);
    if (candidate) {
      animations[alias] = candidate;
      report.identifiersRepaired.push({
        from: value,
        to: alias,
        resolved: candidate,
        files: [entityPath],
      });
      registerDependency({
        identifier: value,
        referencedBy: 'animations_map',
        detail: `alias "${alias}" rewritten to ${candidate}`,
        kind: 'repaired_identifier',
        resolvedIdentifier: candidate,
        evidence: 'identifier was altered during conversion; a single shipped definition carries the original semantics',
      });
      continue;
    }
    registerDependency({
      identifier: value,
      referencedBy: 'animations_map',
      detail: `alias "${alias}"`,
      kind: 'missing_definition',
      resolvedIdentifier: null,
      evidence: 'no shipped document and no vanilla player resource defines it; nothing is substituted',
    });
  }

  // `scripts.animate` addresses the animations map, so an alias it never declares resolves to
  // nothing even when a real definition exists for it.
  const animateAliases = new Set<string>();
  for (const entry of animate) {
    if (typeof entry === 'string') animateAliases.add(entry);
    else if (isRecord(entry)) for (const key of Object.keys(entry)) animateAliases.add(key);
  }
  const droppedAnimateAliases = new Set<string>();
  const aliasRename = new Map<string, string>();
  for (const alias of animateAliases) {
    if (typeof animations[alias] === 'string') continue;
    // `scripts.animate` addresses the alias map, so an entry may also be a raw identifier that was
    // never mapped. That is a resolvable reference, not a missing definition.
    const declaredDirectly = shipped.clips.get(alias) ?? shipped.controllers.get(alias);
    if (declaredDirectly) {
      const preferred = alias.split(/[.:/]+/).filter(Boolean).pop() ?? alias;
      let short = safeFileId(preferred) || 'entry';
      let index = 2;
      while (typeof animations[short] === 'string' && animations[short] !== alias) {
        short = `${safeFileId(preferred) || 'entry'}_${index}`;
        index += 1;
      }
      animations[short] = alias;
      report.identifiersRepaired.push({ from: alias, to: short, resolved: alias, files: [entityPath] });
      log(
        `[PLAYER:BASELINE:REPAIR] scripts.animate carried the raw identifier "${alias}", which activates nothing; it now resolves through alias "${short}" (defined in ${declaredDirectly}).`,
      );
      aliasRename.set(alias, short);
      continue;
    }
    const candidate = findAlteredIdentifier(alias, [
      ...shipped.clips.keys(),
      ...shipped.controllers.keys(),
      ...VANILLA_PLAYER_ANIMATION_IDS,
      ...VANILLA_PLAYER_CONTROLLER_IDS,
    ]);
    if (candidate) {
      animations[alias] = candidate;
      report.identifiersRepaired.push({ from: alias, to: alias, resolved: candidate, files: [entityPath] });
      log(`[PLAYER:BASELINE:REPAIR] scripts.animate alias "${alias}" now resolves to ${candidate}.`);
      continue;
    }
    // Nothing in the archive can satisfy it: keeping the entry ships a reference the engine
    // reports as "cannot find" on every load. It is removed and named, never dropped silently.
    droppedAnimateAliases.add(alias);
    report.animateEntriesRemoved.push(`${alias} (referenced by scripts.animate, defined nowhere)`);
    registerDependency({
      identifier: alias,
      referencedBy: 'scripts_animate',
      detail: 'alias is not declared in the animations map',
      kind: 'missing_definition',
      resolvedIdentifier: null,
      evidence: 'scripts.animate can only activate an alias the entity declares; the entry is removed and reported instead of shipping a reference that resolves to nothing',
    });
  }
  if (droppedAnimateAliases.size > 0) {
    for (let position = animate.length - 1; position >= 0; position -= 1) {
      const entry = animate[position];
      const names = typeof entry === 'string' ? [entry] : isRecord(entry) ? Object.keys(entry) : [];
      if (names.some((name) => droppedAnimateAliases.has(name))) animate.splice(position, 1);
    }
    log(
      `[PLAYER:BASELINE:REPAIR] Removed ${droppedAnimateAliases.size} unresolvable scripts.animate entr(ies): ${[...droppedAnimateAliases].slice(0, 6).join(', ')}. They can activate nothing and only produce runtime "cannot find" errors.`,
    );
  }
  if (aliasRename.size > 0) {
    for (let position = 0; position < animate.length; position += 1) {
      const entry = animate[position];
      if (typeof entry === 'string' && aliasRename.has(entry)) {
        animate[position] = aliasRename.get(entry) as string;
      } else if (isRecord(entry)) {
        const renamed: Record<string, unknown> = {};
        for (const [name, condition] of Object.entries(entry)) {
          renamed[aliasRename.get(name) ?? name] = condition;
        }
        animate[position] = renamed;
      }
    }
  }

  // Controller states address the same alias map; a state selecting an unknown alias never plays.
  for (const path of controllerPaths) {
    const controllerDoc = parseJson(files[path]);
    const defs = controllerDoc?.animation_controllers;
    if (!isRecord(defs)) continue;
    for (const [controllerId, body] of Object.entries(defs)) {
      if (!governingControllers.has(controllerId) || !isRecord(body)) continue;
      const states = body.states;
      if (!isRecord(states)) continue;
      for (const [stateName, state] of Object.entries(states)) {
        const entries = isRecord(state) && Array.isArray(state.animations) ? state.animations : [];
        for (const entry of entries) {
          const names = typeof entry === 'string' ? [entry] : isRecord(entry) ? Object.keys(entry) : [];
          for (const name of names) {
            if (typeof animations[name] === 'string') continue;
            registerDependency({
              identifier: name,
              referencedBy: 'controller_state',
              detail: `${controllerId} state "${stateName}"`,
              kind: 'missing_definition',
              resolvedIdentifier: null,
              evidence: 'controller state selects an alias the player entity never declares',
            });
          }
        }
      }
    }
  }

  // 4. Variable dependencies: what the player-scoped documents read vs what anything declares.
  const playerDocuments: string[] = [];
  if (typeof entityRaw === 'string') playerDocuments.push(entityRaw);
  for (const value of Object.values(animations)) {
    if (typeof value !== 'string') continue;
    const documentPath = shipped.clips.get(value) ?? shipped.controllers.get(value);
    if (!documentPath) continue;
    const rawDocument = files[documentPath];
    if (typeof rawDocument === 'string') playerDocuments.push(rawDocument);
  }
  const readVars = countReads(playerDocuments);
  // A custom player entity also replaces vanilla script scope. Restore these two vanilla player
  // variables even when their only consumers live in engine-owned controllers that are not
  // physically present in the imported archive.
  for (const name of Object.keys(VANILLA_PLAYER_VARIABLE_EXPRESSIONS)) {
    if (!readVars.has(name)) readVars.set(name, 0);
  }
  const itemIds = collectPackItemIdentifiers({ ...files, ...(input.behaviorPackFiles ?? {}) });
  const preAnimation: string[] = Array.isArray(scripts.pre_animation)
    ? scripts.pre_animation.filter((entry): entry is string => typeof entry === 'string')
    : typeof scripts.pre_animation === 'string'
      ? [scripts.pre_animation]
      : [];

  // A Molang variable exists only inside the script scope that declares it. An assignment shipped
  // somewhere else in the archive — another entity, an attachable, a clip document — leaves the
  // player reading an unknown variable, which is the reported `variable.melee_spear_equipped` /
  // `variable.tcos0` failure: the archive assigned them, in a scope the player never evaluates.
  // Only this entity's own script statements count as a declaration here.
  const declaredInPlayerScope = new Set<string>();
  for (const match of JSON.stringify([preAnimation, animate]).matchAll(VARIABLE_ASSIGN)) {
    declaredInPlayerScope.add(String(match[1]));
  }
  /** A whole `variable.x = <expr>` the archive already contains, reused as the declaration. */
  const shippedAssignment = (name: string): string | null => {
    const pattern = new RegExp(`variable\\.${name}\\s*=\\s*([^;"\n]+)`);
    // Source-side assignments may live in the behavior pack (for example in an item/entity
    // definition) rather than the resource pack. Search both packs before declaring the value lost.
    const sourceFiles = { ...files, ...(input.behaviorPackFiles ?? {}) };
    for (const raw of Object.values(sourceFiles)) {
      if (typeof raw !== 'string') continue;
      const match = pattern.exec(raw);
      if (!match) continue;
      const rhs = String(match[1]).trim();
      if (!rhs || /variable\.[a-zA-Z0-9_]+/.test(rhs)) continue;
      return rhs;
    }
    return null;
  };

  report.variables.referenced = readVars.size;
  for (const [name, referenceCount] of readVars) {
    if (declaredInPlayerScope.has(name)) {
      report.variables.declared += 1;
      continue;
    }
    // 1. Equipment visibility: the armour-layer flag has a known destination form.
    const visibility = equipmentVisibilityExpression(name);
    let statement: string | null = null;
    let evidence = '';
    if (visibility) {
      statement = `variable.${name} = ${visibility.expression};`;
      evidence = visibility.reason;
    }
    // 2. Restore known vanilla player-scope expressions from the destination's own resource
    // contract before looking for mod-specific assignments. These are live expressions, not
    // constant defaults, and are needed because this pack replaces the vanilla player entity.
    if (!statement) {
      const baseline = VANILLA_PLAYER_VARIABLE_EXPRESSIONS[name];
      if (baseline) {
        const translation = translateMolangExpression(`variable.${name} = ${baseline.expression}`, 'player_entity');
        if (translation.unresolved.length === 0 && translation.rejected.length === 0) {
          statement = `${translation.expression.trim().replace(/;$/, '')};`;
          evidence = baseline.evidence;
        }
      }
    }
    // 3. A declaration the archive already ships is re-bound into the scope that evaluates it.
    if (!statement) {
      const relocated = shippedAssignment(name);
      if (relocated) {
        const translation = translateMolangExpression(`variable.${name} = ${relocated}`, 'player_entity');
        if (translation.unresolved.length === 0 && translation.rejected.length === 0) {
          statement = `${translation.expression.trim().replace(/;$/, '')};`;
          evidence =
            'the archive already assigns this value, and the statement is re-bound into the player scope that reads it';
        }
      }
    }
    // 4. Equipped-item detection rebuilt from the items the pack really registers.
    if (!statement) {
      const reconstruction = reconstructEquipmentExpression(name, itemIds);
      if (reconstruction) {
        const translation = translateMolangExpression(`variable.${name} = ${reconstruction.expression}`, 'player_entity');
        if (translation.unresolved.length === 0 && translation.rejected.length === 0) {
          statement = `${translation.expression.trim().replace(/;$/, '')};`;
          evidence = reconstruction.reason;
        }
      }
    }
    // 5. If the source value cannot be recovered, do NOT initialize it to zero. A zero
    // assignment silences the engine warning while silently disabling the source behaviour.
    // Keep the unresolved edge explicit so the port cannot be mistaken for a faithful conversion.
    const withoutRecovery = !statement;
    if (withoutRecovery) {
      report.variables.unresolved.push({
        variable: name,
        declaredIn: [],
        referencedIn: [`${referenceCount} reference(s) in player-scoped documents`],
        reconstructedExpression: null,
        reason:
          'read by player-scoped content but no player-scope assignment, source-pack assignment, or evidence-backed Bedrock equivalent was found; no constant is substituted because that would change the animation behaviour',
      });
      log(
        `[PLAYER:VARIABLE:LIMIT] variable.${name} (${referenceCount} read(s)) — no recoverable source expression or destination equivalent was found; it remains unresolved rather than being incorrectly forced to 0.`,
      );
      continue;
    }
    if (preAnimation.some((entry) => new RegExp(`\\bvariable\\.${name}\\s*=`).test(entry))) continue;
    preAnimation.push(statement as string);
    report.variables.reconstructed += 1;
    report.variables.injected.push(statement as string);
    log(`[PLAYER:VARIABLE:BIND] ${statement} — ${evidence}.`);
  }
  if (report.variables.unresolved.length > 0) {
    report.blocking.push(
      `${report.variables.unresolved.length} Molang variable(s) are read by player-scoped content with no recoverable source value: ` +
        `${report.variables.unresolved.slice(0, 6).map((entry) => `variable.${entry.variable}`).join(', ')}${
          report.variables.unresolved.length > 6 ? ' …' : ''
        }. Each unresolved dependency remains unmodified and is reported as NOT REPRODUCED rather than claimed as converted.`,
    );
  }

  // 5. First-person verification: functional only when the pose resolves AND is gated.
  const firstPersonBasePoseAlias = PLAYER_BASELINE_ENTRIES.find(
    (entry) => entry.identifier === 'animation.player.first_person_base_pose',
  )?.alias;
  const firstPersonAttackAlias = PLAYER_BASELINE_ENTRIES.find(
    (entry) => entry.identifier === 'controller.animation.player.first_person_attack',
  )?.alias;
  // Vanilla's player entity runs only the root controller from scripts.animate. The root
  // controller itself gates first-person aliases by state; they must not be started directly.
  const rootControllerBound = animate.some((entry) =>
    typeof entry === 'string' ? entry === 'root' : isRecord(entry) && 'root' in entry,
  );
  report.firstPerson.basePosePresent =
    Boolean(firstPersonBasePoseAlias) && typeof animations[firstPersonBasePoseAlias as string] === 'string';
  report.firstPerson.basePoseResolves =
    report.firstPerson.basePosePresent &&
    isVanillaPlayerBaselineIdentifier(String(animations[firstPersonBasePoseAlias as string]));
  report.firstPerson.basePoseGated = rootControllerBound;
  report.firstPerson.attackControllerGated = rootControllerBound;
  report.firstPerson.ready =
    report.firstPerson.basePoseResolves && report.firstPerson.basePoseGated && report.firstPerson.attackControllerGated;
  if (!report.firstPerson.ready) {
    report.blocking.push(
      `First-person integration is NOT complete: first_person_base_pose ${report.firstPerson.basePoseResolves ? 'resolves' : 'does not resolve'}, ` +
        `gate ${report.firstPerson.basePoseGated ? 'present' : 'missing'}, attack controller gate ${report.firstPerson.attackControllerGated ? 'present' : 'missing'}.`,
    );
  }

  if (report.missingDefinitions.length > 0) {
    report.blocking.push(
      `${report.missingDefinitions.length} player animation reference(s) resolve to no definition. They are preserved in the ` +
        'archive and reported; no placeholder animation is generated for them.',
    );
  }

  // 6. Write the resolved definition back only when something really changed.
  description.animations = animations;
  scripts.pre_animation = preAnimation.filter((entry) => entry.trim().length > 0);
  scripts.animate = animate;
  description.scripts = scripts;
  const nextJson = JSON.stringify(doc, null, 2);
  if (nextJson !== entityRaw) files[entityPath] = nextJson;

  report.staticValidationPassed = report.blocking.length === 0;
  report.summary =
    `Baseline player dependency resolution on the exported pack: ${report.dependenciesExamined} player animation reference(s) traced — ` +
    `${report.shippedDefinition} resolve to a shipped definition, ${report.vanillaEngineDefinition} to the vanilla player resource set, ` +
    `${report.identifiersRepaired.length} altered identifier(s) repaired, ${report.missingDefinitions.length} unresolved. ` +
    `${report.documentsPreserved.length} generated document(s) relocated off vanilla resource paths so the engine definitions survive. ` +
    `Variables: ${report.variables.referenced} referenced or required by the vanilla player contract, ${report.variables.declared} already declared there, ` +
    `${report.variables.reconstructed} declared by this pass (${report.variables.initialisedWithoutRecovery.length} of them initialised ` +
    'because no archive scope could supply the value, reported as NOT REPRODUCED). ' +
    `First person: ${report.firstPerson.ready ? 'wiring complete' : 'NOT complete'}. ` +
    (report.staticValidationPassed
      ? 'Static configuration resolves; live playback in a Bedrock client is a separate, unverified step.'
      : `${report.blocking.length} blocking finding(s) recorded.`);

  log(`[PLAYER:BASELINE] ${report.summary}`);
  for (const finding of report.blocking.slice(0, 8)) log(`[PLAYER:BASELINE:BLOCK] ${finding}`);
  for (const entry of report.missingDefinitions.slice(0, 6)) {
    log(`[PLAYER:BASELINE:MISSING] ${entry.identifier} (${entry.referencedBy}, ${entry.detail}) — ${entry.evidence}.`);
  }
  for (const entry of report.variables.unresolved.slice(0, 6)) {
    log(`[PLAYER:BASELINE:VARIABLE] variable.${entry.variable} — ${entry.reason}`);
  }

  return report;
}

/** Exported for the panels: the identifier list the baseline guarantees at runtime. */
export const PLAYER_BASELINE_IDENTIFIERS: string[] = PLAYER_BASELINE_ENTRIES.map((entry) => entry.identifier);

/** Exported for regression fixtures: the animate entries the baseline requires. */
export const PLAYER_BASELINE_ANIMATE: Array<string | Record<string, string>> = VANILLA_PLAYER_ANIMATE;

/** Exported for regression fixtures: the alias map the baseline requires. */
export const PLAYER_BASELINE_ANIMATIONS: Record<string, string> = VANILLA_PLAYER_ANIMATIONS;

/** True when an identifier is a vanilla player animation or controller. */
export const isBaselinePlayerIdentifier = isVanillaPlayerBaselineIdentifier;