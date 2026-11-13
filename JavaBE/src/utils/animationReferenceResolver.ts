import { safeFileId } from '@/utils/bedrockIds';
import { isKnownVanillaPlayerAnimationReference } from '@/utils/clientEntitySchema';
import { VANILLA_PLAYER_ANIMATION_IDS, VANILLA_PLAYER_CONTROLLER_IDS } from '@/utils/vanillaPlayerBaseline';

/**
 * Universal animation reference resolver.
 *
 * A Bedrock client entity is a graph, and the engine treats its edge kinds differently:
 *
 *   - an `animations` entry may address an ANIMATION DEFINITION (a key inside `animations` of a
 *     `*.animation.json`) or a CONTROLLER DEFINITION (a key inside `animation_controllers` of a
 *     `*.animation_controllers.json`) — never either one interchangeably;
 *   - `scripts.animate` addresses the *alias map* of the same entity, so a raw identifier there
 *     resolves to nothing and the engine reports "cannot find <name>";
 *   - a controller state addresses the same alias map again, in the context of the entity that
 *     activates that controller.
 *
 * The reported failures ("cannot find base_pose / look_at_target / first_person_base_pose /
 * player_ported / player_states / controller.animation.….player_ported") are all one defect with
 * different symptoms: an edge points at a definition of the wrong kind, at an identifier that was
 * renamed during conversion, at a definition filed under a document the engine does not load for
 * that kind, or at an alias that was never declared.
 *
 * This pass resolves the graph kind-aware, on the exact file map that ships:
 *
 *  1. definitions filed under the wrong document kind are relocated to a document the engine
 *     actually loads for that kind (a controller stored in a `*.animation.json` is moved into a
 *     `*.animation_controllers.json`, and vice versa);
 *  2. controller identifiers that are not spelled `controller.animation.*` are normalised, and
 *     every dependent reference is rewritten to the new identifier in the same pass;
 *  3. every `animations` entry is verified against the definition table of the kind it needs;
 *     an identifier that was altered is repaired by matching the shipped definition that carries
 *     the same semantics, and an entry that resolves to nothing is reported, never accepted
 *     because its token appears somewhere in the archive;
 *  4. every `scripts.animate` entry is verified against the alias map — a raw identifier is
 *     converted into a real alias, an alias that resolves to nothing is removed *and* reported,
 *     because an unresolvable entry is exactly what the engine complains about at runtime;
 *  5. every controller an entity registers is activated, and every alias its states select is
 *     declared on that entity.
 */

export interface AnimationReferenceResolutionReport {
  definitions: { clips: number; controllers: number };
  documentsRelocated: Array<{ from: string; to: string; kind: 'animation' | 'animation_controller'; ids: string[] }>;
  identifiersNormalised: Array<{ from: string; to: string; references: number }>;
  entitiesAudited: number;
  referencesExamined: number;
  aliasRepairs: string[];
  animateEntriesRepaired: string[];
  animateEntriesRemoved: string[];
  controllerHooksAdded: string[];
  stateAliasesDeclared: string[];
  unresolved: string[];
  blocking: string[];
  summary: string;
}

type Pack = Record<string, string | Uint8Array>;
type Json = Record<string, unknown>;
type Container = 'animations' | 'animation_controllers';
type Kind = 'animation' | 'animation_controller';

const CONTROLLER_PREFIX = 'controller.animation.';
/**
 * Documents with an animation scope: client entities and attachables. An attachable registers
 * `animations` aliases and `scripts.animate` exactly like a client entity, so a registration the
 * archive does not define fails there with the same "cannot find" and has to resolve here too.
 */
const SCOPE_PATH = /^(?:entity\/[^/]+\.entity\.json|attachables\/[^/]+\.json)$/i;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(raw: string | Uint8Array | undefined): Json | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function reduced(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tail(value: string): string {
  const parts = value.split(/[.:/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : value;
}

function stems(value: string): string[] {
  const parts = value.split(/[.:/]+/).filter(Boolean);
  return parts.map((_, index) => parts.slice(index).join('.'));
}

const reducedPoolCache = new WeakMap<Map<string, string>, Array<{ id: string; reduced: string }>>();

/** Reduced identifier table for a definition pool, built once per pass instead of per lookup. */
function reducedPool(pool: Map<string, string>): Array<{ id: string; reduced: string }> {
  const cached = reducedPoolCache.get(pool);
  if (cached) return cached;
  const built = [...pool.keys()].map((id) => ({ id, reduced: reduced(id) }));
  reducedPoolCache.set(pool, built);
  return built;
}

/** The shipped identifier a reference most likely meant, or null when the match is ambiguous. */
function pickClosest(pool: Map<string, string>, wanted: string): string | null {
  const entries = reducedPool(pool);
  const exact = entries.find((entry) => entry.reduced === reduced(wanted));
  if (exact) return exact.id;
  const suffixes = stems(wanted)
    .map((suffix) => reduced(suffix))
    .filter((key) => key.length >= 4);
  if (suffixes.length === 0) return null;
  const candidates = new Set<string>();
  for (const entry of entries) {
    if (suffixes.some((suffix) => entry.reduced.endsWith(suffix))) candidates.add(entry.id);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

/** Declares `identifier` under a short alias and returns the alias the engine resolves. */
function declareAlias(animations: Record<string, string>, taken: Set<string>, identifier: string): string {
  for (const [alias, value] of Object.entries(animations)) {
    if (value === identifier) return alias;
  }
  const base = safeFileId(tail(identifier)) || 'entry';
  let alias = base;
  let index = 2;
  while (taken.has(alias)) {
    alias = `${base}_${index}`;
    index += 1;
  }
  animations[alias] = identifier;
  taken.add(alias);
  return alias;
}

interface Move {
  id: string;
  fromPath: string;
  fromContainer: Container;
  toPath: string;
  toContainer: Container;
  kind: Kind;
}

function applyMove(files: Pack, move: Move): void {
  const source = parse(files[move.fromPath]);
  if (!source) return;
  const sourceContainer = source[move.fromContainer];
  if (!isRecord(sourceContainer) || sourceContainer[move.id] === undefined) return;
  const definition = sourceContainer[move.id];
  delete sourceContainer[move.id];
  if (Object.keys(sourceContainer).length === 0) delete source[move.fromContainer];
  if (Object.keys(source).length === 0) delete files[move.fromPath];
  else files[move.fromPath] = JSON.stringify(source, null, 2);

  const target = parse(files[move.toPath]) ?? {};
  const targetContainer = isRecord(target[move.toContainer]) ? (target[move.toContainer] as Json) : {};
  if (targetContainer[move.id] === undefined) targetContainer[move.id] = definition;
  target[move.toContainer] = targetContainer;
  files[move.toPath] = JSON.stringify(target, null, 2);
}

interface ShippedIndex {
  clips: Map<string, string>;
  controllers: Map<string, string>;
  renamed: Map<string, string>;
}

function indexDocuments(files: Pack): ShippedIndex {
  const clips = new Map<string, string>();
  const controllers = new Map<string, string>();
  for (const [path, raw] of Object.entries(files)) {
    if (typeof raw !== 'string' || !path.toLowerCase().endsWith('.json')) continue;
    const doc = parse(raw);
    if (!doc) continue;
    const controllerDefs = isRecord(doc.animation_controllers) ? doc.animation_controllers : null;
    if (controllerDefs) for (const id of Object.keys(controllerDefs)) controllers.set(id, path);
    const clipDefs = isRecord(doc.animations) ? doc.animations : null;
    if (clipDefs) {
      for (const id of Object.keys(clipDefs)) {
        // An identifier spelled `controller.*` declared inside an `animations` block is a
        // controller definition, not a clip, whatever document it was written into.
        if (id.startsWith('controller.')) controllers.set(id, path);
        else clips.set(id, path);
      }
    }
  }
  return { clips, controllers, renamed: new Map() };
}

/**
 * Step 1 — file every definition under a document kind the engine actually loads.
 * A controller definition shipped inside a `*.animation.json` is never evaluated as a controller,
 * so the entity that registers it fails with "cannot find controller.animation.…".
 */
function normaliseDefinitionDocuments(
  files: Pack,
  modId: string,
  report: AnimationReferenceResolutionReport,
): void {
  const stem = safeFileId(modId) || 'ported';
  const clipTarget = `animations/${stem}.animation.json`;
  const controllerTarget = `animation_controllers/${stem}.animation_controllers.json`;
  const moves: Move[] = [];

  for (const path of Object.keys(files)) {
    const raw = files[path];
    if (typeof raw !== 'string' || !path.toLowerCase().endsWith('.json')) continue;
    const doc = parse(raw);
    if (!doc) continue;
    const lower = path.toLowerCase();
    const isControllerDoc = lower.endsWith('.animation_controllers.json');
    const isClipDoc = lower.endsWith('.animation.json');

    const controllerSource = doc.animation_controllers;
    if (isRecord(controllerSource) && !isControllerDoc) {
      for (const id of Object.keys(controllerSource)) {
        moves.push({
          id,
          fromPath: path,
          fromContainer: 'animation_controllers',
          toPath: controllerTarget,
          toContainer: 'animation_controllers',
          kind: 'animation_controller',
        });
      }
    }
    const clipSource = doc.animations;
    if (isRecord(clipSource)) {
      for (const id of Object.keys(clipSource)) {
        if (id.startsWith('controller.')) {
          moves.push({
            id,
            fromPath: path,
            fromContainer: 'animations',
            toPath: controllerTarget,
            toContainer: 'animation_controllers',
            kind: 'animation_controller',
          });
        } else if (!isClipDoc) {
          moves.push({
            id,
            fromPath: path,
            fromContainer: 'animations',
            toPath: clipTarget,
            toContainer: 'animations',
            kind: 'animation',
          });
        }
      }
    }
  }

  const grouped = new Map<string, { from: string; to: string; kind: Kind; ids: string[] }>();
  for (const move of moves) {
    applyMove(files, move);
    const key = `${move.fromPath}→${move.toPath}`;
    const entry = grouped.get(key) ?? { from: move.fromPath, to: move.toPath, kind: move.kind, ids: [] };
    entry.ids.push(move.id);
    grouped.set(key, entry);
  }
  report.documentsRelocated.push(...grouped.values());

  // Step 2 — a controller id that is not spelled `controller.animation.*` is ignored by the
  // engine even when the definition is otherwise valid. Normalising it here rewrites every
  // dependent reference through the rename table below.
  for (const path of Object.keys(files)) {
    const raw = files[path];
    if (typeof raw !== 'string' || !path.toLowerCase().endsWith('.animation_controllers.json')) continue;
    const doc = parse(raw);
    if (!doc) continue;
    const defs = doc.animation_controllers;
    if (!isRecord(defs)) continue;
    let changed = false;
    for (const id of Object.keys(defs)) {
      if (id.startsWith(CONTROLLER_PREFIX)) continue;
      const next = `${CONTROLLER_PREFIX}${id.replace(/^controller\./, '').replace(/^animation\./, '')}`;
      if (next === id || next in defs) continue;
      defs[next] = defs[id];
      delete defs[id];
      report.identifiersNormalised.push({ from: id, to: next, references: 0 });
      changed = true;
    }
    if (changed) files[path] = JSON.stringify(doc, null, 2);
  }
}

/** Step 3 — resolve one registration against the definition table of the kind it addresses. */
function resolveRegistration(input: {
  path: string;
  isPlayer: boolean;
  alias: string;
  value: string;
  index: ShippedIndex;
  report: AnimationReferenceResolutionReport;
}): string | null {
  const { path, isPlayer, alias, value, index, report } = input;
  report.referencesExamined += 1;
  const wantsController = value.startsWith('controller.');
  const pool = wantsController ? index.controllers : index.clips;
  if (pool.has(value)) return value;
  // The engine supplies this identifier globally: the humanoid/player clips and the player root
  // controllers are part of the base resource set, so a reference to them needs no shipped
  // definition. Their ABSENCE from the archive is the defect, not the reference.
  if (isKnownVanillaPlayerAnimationReference(value)) return value;
  // The remaining baseline entries stay player-scoped.
  if (isPlayer && (VANILLA_PLAYER_ANIMATION_IDS.has(value) || VANILLA_PLAYER_CONTROLLER_IDS.has(value))) {
    return value;
  }
  const renamed = index.renamed.get(value);
  if (renamed && pool.has(renamed)) {
    report.aliasRepairs.push(`${path}: animations.${alias} ${value} → ${renamed} (identifier normalised)`);
    return renamed;
  }
  const closest = pickClosest(pool, value);
  if (closest) {
    report.aliasRepairs.push(`${path}: animations.${alias} ${value} → ${closest} (identifier altered during conversion)`);
    return closest;
  }
  report.unresolved.push(
    `${path}: animations.${alias} → ${value} — ${
      wantsController
        ? 'no *.animation_controllers.json defines this controller'
        : 'no *.animation.json defines this animation'
    } and no shipped definition carries the same semantics; the registration is preserved and reported.`,
  );
  return null;
}

export function resolveAnimationReferences(input: {
  modId: string;
  resourcePackFiles: Pack;
  onLog?: (line: string) => void;
}): AnimationReferenceResolutionReport {
  const log = (line: string) => input.onLog?.(line);
  const files = input.resourcePackFiles;
  const report: AnimationReferenceResolutionReport = {
    definitions: { clips: 0, controllers: 0 },
    documentsRelocated: [],
    identifiersNormalised: [],
    entitiesAudited: 0,
    referencesExamined: 0,
    aliasRepairs: [],
    animateEntriesRepaired: [],
    animateEntriesRemoved: [],
    controllerHooksAdded: [],
    stateAliasesDeclared: [],
    unresolved: [],
    blocking: [],
    summary: '',
  };

  normaliseDefinitionDocuments(files, input.modId, report);
  const index = indexDocuments(files);
  for (const entry of report.identifiersNormalised) {
    const previous = [...index.controllers.keys()].find((id) => id === entry.to);
    if (previous) index.renamed.set(entry.from, entry.to);
  }
  report.definitions.clips = index.clips.size;
  report.definitions.controllers = index.controllers.size;

  for (const [from, to] of index.renamed) {
    log(`[ANIM:REF:KIND] controller identifier "${from}" normalised to "${to}"; dependent references are rewritten in the same pass.`);
  }
  for (const entry of report.documentsRelocated) {
    log(
      `[ANIM:REF:KIND] ${entry.ids.length} ${entry.kind} definition(s) relocated ${entry.from} → ${entry.to} so the engine loads them as the kind they are.`,
    );
  }

  for (const path of Object.keys(files)) {
    if (!SCOPE_PATH.test(path)) continue;
    const doc = parse(files[path]);
    if (!doc) continue;
    const client = doc['minecraft:client_entity'];
    const attachable = doc['minecraft:attachable'];
    const scope = isRecord(client) ? client : isRecord(attachable) ? attachable : undefined;
    const description = scope ? scope.description : undefined;
    if (!isRecord(description)) continue;
    report.entitiesAudited += 1;
    const isPlayer = isRecord(client) && description.identifier === 'minecraft:player';

    const rawAnimations = description.animations;
    const animations: Record<string, string> = {};
    if (isRecord(rawAnimations)) {
      for (const [alias, value] of Object.entries(rawAnimations)) {
        if (typeof value === 'string') animations[alias] = value;
      }
    }
    let changed = !isRecord(rawAnimations);

    for (const [alias, value] of Object.entries(animations)) {
      const resolved = resolveRegistration({ path, isPlayer, alias, value, index, report });
      if (resolved && resolved !== value) {
        animations[alias] = resolved;
        changed = true;
      }
    }

    const taken = new Set(Object.keys(animations));
    const scripts = isRecord(description.scripts) ? { ...description.scripts } : {};
    const rawAnimate = Array.isArray(scripts.animate) ? [...scripts.animate] : [];
    const animate: unknown[] = [];
    let animateChanged = false;

    for (const entry of rawAnimate) {
      const names = typeof entry === 'string' ? [entry] : isRecord(entry) ? Object.keys(entry) : [];
      const name = names[0];
      if (!name) {
        animateChanged = true;
        continue;
      }
      if (taken.has(name)) {
        animate.push(entry);
        continue;
      }
      // `scripts.animate` addresses the alias map. A raw identifier here resolves to nothing, and
      // an alias that the map never declares is the "cannot find <name>" the engine reports.
      const direct = index.clips.has(name) || index.controllers.has(name) ? name : null;
      const target =
        direct ??
        pickClosest(index.controllers, name) ??
        pickClosest(index.clips, name) ??
        (isKnownVanillaPlayerAnimationReference(name) ? name : null);
      if (target) {
        const short = declareAlias(animations, taken, target);
        const condition = typeof entry === 'string' ? null : (entry as Json)[name];
        animate.push(typeof condition === 'string' ? { [short]: condition } : short);
        report.animateEntriesRepaired.push(`${path}: scripts.animate "${name}" → alias "${short}" (${target})`);
        animateChanged = true;
        continue;
      }
      // Nothing in the archive defines it: the entry can never activate anything and produces a
      // runtime "cannot find" line, so it is removed and reported rather than shipped broken.
      report.animateEntriesRemoved.push(`${path}: scripts.animate "${name}" resolves to no definition and no declared alias`);
      animateChanged = true;
    }

    // Every registered controller must be activated, or it is dead JSON.
    for (const [alias, value] of Object.entries(animations)) {
      if (!value.startsWith('controller.')) continue;
      const resolvable = index.controllers.has(value)
        || isKnownVanillaPlayerAnimationReference(value)
        || (isPlayer && VANILLA_PLAYER_CONTROLLER_IDS.has(value));
      if (!resolvable) continue;
      const already = animate.some((entry) =>
        typeof entry === 'string' ? entry === alias : isRecord(entry) && alias in entry,
      );
      if (already) continue;
      animate.push(alias);
      report.controllerHooksAdded.push(`${path}: ${alias} → ${value}`);
      animateChanged = true;
    }

    // A controller state addresses this entity's alias map, so a state alias the entity never
    // declares selects nothing even though the clip is defined in the archive.
    for (const [, value] of Object.entries(animations)) {
      if (!value.startsWith('controller.')) continue;
      const controllerPath = index.controllers.get(value);
      if (!controllerPath) continue;
      const controllerDoc = parse(files[controllerPath]);
      const defs = controllerDoc?.animation_controllers;
      const definition = isRecord(defs) ? defs[value] : undefined;
      const states = isRecord(definition) ? definition.states : undefined;
      if (!isRecord(states)) continue;
      for (const [stateName, state] of Object.entries(states)) {
        const entries = isRecord(state) && Array.isArray(state.animations) ? state.animations : [];
        for (const entry of entries) {
          const stateAliases = typeof entry === 'string' ? [entry] : isRecord(entry) ? Object.keys(entry) : [];
          for (const stateAlias of stateAliases) {
            if (taken.has(stateAlias)) continue;
            const direct = index.clips.has(stateAlias) ? stateAlias : null;
            const target = direct ?? pickClosest(index.clips, stateAlias);
            if (!target) {
              report.unresolved.push(
                `${path}: ${value} state "${stateName}" selects "${stateAlias}", which no shipped animation defines and no alias on this entity declares.`,
              );
              continue;
            }
            // The controller references the alias BY NAME, so the alias must be declared under
            // exactly the name the state selects; declaring it under a different short name would
            // leave the state edge dangling.
            animations[stateAlias] = target;
            taken.add(stateAlias);
            report.stateAliasesDeclared.push(`${path}: ${value} state "${stateName}" declares alias "${stateAlias}" → ${target}`);
            changed = true;
          }
        }
      }
    }

    if (changed || animateChanged) {
      description.animations = animations;
      scripts.animate = animate;
      description.scripts = scripts;
      files[path] = JSON.stringify(doc, null, 2);
    }
  }

  if (report.unresolved.length > 0) {
    report.blocking.push(
      `${report.unresolved.length} animation reference(s) address no definition of the kind they require. They are preserved and reported; no placeholder definition is invented for them.`,
    );
  }
  report.summary =
    `${report.definitions.clips} animation and ${report.definitions.controllers} animation-controller definition(s) indexed by kind; ` +
    `${report.entitiesAudited} client entity/ies audited, ${report.referencesExamined} registration(s) traced. ` +
    `${report.aliasRepairs.length} registration(s) rebound to the shipped definition that carries the same semantics, ` +
    `${report.animateEntriesRepaired.length} scripts.animate raw identifier(s) converted into real aliases, ` +
    `${report.animateEntriesRemoved.length} unresolvable scripts.animate entry/ies removed (reported, not silently kept), ` +
    `${report.controllerHooksAdded.length} controller hook(s) added, ${report.stateAliasesDeclared.length} controller state alias(es) declared, ` +
    `${report.documentsRelocated.length} document kind relocation(s), ${report.identifiersNormalised.length} identifier normalisation(s), ` +
    `${report.unresolved.length} unresolved.`;

  log(`[ANIM:REF] ${report.summary}`);
  for (const line of report.aliasRepairs.slice(0, 6)) log(`[ANIM:REF:ALIAS] ${line}`);
  for (const line of report.unresolved.slice(0, 8)) log(`[ANIM:REF:UNRESOLVED] ${line}`);

  return report;
}