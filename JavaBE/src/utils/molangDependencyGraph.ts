/**
 * Universal Molang dependency graph.
 *
 * A variable is never a standalone fact: it is read by specific animation clips, controller states
 * and client entities, and the engine only reports it as "unknown" while one of those readers is
 * evaluating. Fixing the message without knowing the reader is how a conversion ends up declaring a
 * variable in a document that no clip ever runs, or replacing a real value with a constant.
 *
 * This pass builds the missing edge: variable -> readers -> owner. For every variable name shipped
 * in the archive it records
 *
 *   - which files declare it (a `variable.x = …` assignment),
 *   - which animation / controller definitions read it, and which document activates those,
 *   - whether a destination-equivalent expression can reproduce its meaning (equipment visibility,
 *     shipped-item detection, canonical query catalog), translated into the reader's context,
 *   - and, when nothing can reproduce it, exactly which animations cannot evaluate.
 *
 * It then binds the resolvable names into the script scope that evaluates them (through the
 * scope binder) and reports the rest. No name is ever frozen to a constant, and nothing here knows
 * anything about a specific mod: identity tokens come from the item identifiers the archive really
 * ships.
 */

import { molangContextForFile, translateMolangExpression, type MolangContext } from '@/utils/molangCompatibility';
import {
  bindMolangVariableScopes,
  equipmentVisibilityExpression,
  type ScopeVariableResolution,
} from '@/utils/molangScopeBinder';
import { collectPackItemIdentifiers, reconstructEquipmentExpression, type PackFiles } from '@/utils/variableReconstruction';
import {
  isMolangSafeExpression,
  type SourceVariableEvidence,
  type SourceVariableRecord,
} from '@/utils/sourceVariableEvidence';
import { CANONICAL_JAVA_TO_BEDROCK_VARIABLES } from '@/utils/universalVariableResolver';

export type VariableBindingKind =
  | 'declared_in_scope'
  | 'source_expression'
  | 'equipment_visibility'
  | 'equipment_detection'
  | 'canonical_query'
  | 'unresolved';

export interface VariableDependencyNode {
  variable: string;
  /** Animation / controller identifiers that read it. */
  readByAnimations: string[];
  /** Documents that contain those readers, or read it directly. */
  readIn: string[];
  /** Files that assign it. */
  declaredIn: string[];
  binding: VariableBindingKind;
  /** Destination expression that reproduces the meaning, already translated for the reader. */
  expression: string | null;
  reason: string;
}

export interface MolangDependencyGraphReport {
  documentsScanned: number;
  definitionsIndexed: number;
  activatedDefinitions: number;
  variablesDiscovered: number;
  declaredCount: number;
  reconstructedCount: number;
  /** Variables read by activated content with no provable destination meaning. */
  unresolved: Array<{ variable: string; readByAnimations: string[]; readIn: string[]; reason: string }>;
  nodes: VariableDependencyNode[];
  /** Animations that cannot evaluate because a variable they read is unresolved. */
  animationsAtRisk: Array<{ animation: string; variables: string[] }>;
  scopeDeclarationsAdded: number;
  scopeFilesTouched: number;
  /** Resolver output that the destination context rejects (invalid hand slot, unsupported query). */
  rejectedExpressions: Array<{ file: string; variable: string; expression: string; reason: string }>;
  exportReady: boolean;
  blocking: string[];
  summary: string;
}

type RawDoc = Record<string, any>;

function parseJson(raw: string | Uint8Array | undefined): RawDoc | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as RawDoc) : null;
  } catch {
    return null;
  }
}

function variableReads(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\bvariable\.([a-zA-Z0-9_]+)/g)) found.push(String(match[1]));
  return found;
}

function variableAssignments(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\bvariable\.([a-zA-Z0-9_]+)\s*=(?!=)/g)) found.push(String(match[1]));
  return found;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Scope description of a client entity or attachable — the documents with a script scope. */
function scopeDescription(doc: RawDoc): Record<string, any> | null {
  for (const key of ['minecraft:client_entity', 'minecraft:attachable']) {
    const root = doc[key];
    const description = isRecord(root) ? root.description : null;
    if (isRecord(description)) return description;
  }
  return null;
}

interface DefinitionEntry {
  id: string;
  kind: 'clip' | 'controller';
  path: string;
  body: unknown;
}

/** Every clip and controller the archive defines, indexed by the kind it can be found under. */
function indexDefinitions(files: PackFiles): Map<string, DefinitionEntry> {
  const index = new Map<string, DefinitionEntry>();
  for (const [path, raw] of Object.entries(files)) {
    const lower = path.toLowerCase();
    if (typeof raw !== 'string' || !lower.endsWith('.json')) continue;
    const doc = parseJson(raw);
    if (!doc) continue;
    const isController = lower.endsWith('.animation_controllers.json');
    const isClip = lower.endsWith('.animation.json');
    if (!isController && !isClip) continue;
    const container = isController ? doc.animation_controllers : doc.animations;
    if (!isRecord(container)) continue;
    for (const [id, body] of Object.entries(container)) {
      index.set(id, { id, kind: isController ? 'controller' : 'clip', path, body });
    }
  }
  return index;
}

/** Index the same definitions by the document that carries them, so a file is looked up once. */
function groupDefinitionsByPath(index: Map<string, DefinitionEntry>): Map<string, DefinitionEntry[]> {
  const byPath = new Map<string, DefinitionEntry[]>();
  for (const entry of index.values()) {
    const list = byPath.get(entry.path) ?? [];
    list.push(entry);
    byPath.set(entry.path, list);
  }
  return byPath;
}

/**
 * Definitions each client entity / attachable really activates: the animation aliases it declares,
 * the controllers it names, and the clips those controllers select. A clip no entity activates
 * cannot evaluate anything, so its variables are recorded but never reported as blocking.
 */
function activatedDefinitions(
  files: PackFiles,
  index: Map<string, DefinitionEntry>,
): { activeIds: Set<string>; scopeDocs: string[] } {
  const activeIds = new Set<string>();
  const scopeDocs: string[] = [];
  const controllersToWalk: string[] = [];

  const declare = (target: string): void => {
    const entry = index.get(target);
    if (!entry) return;
    activeIds.add(entry.id);
    if (entry.kind === 'controller') controllersToWalk.push(entry.id);
  };
  const resolveAlias = (alias: string, aliases: Record<string, unknown>): string => {
    const mapped = aliases[alias];
    return typeof mapped === 'string' ? mapped : alias;
  };

  for (const [path, raw] of Object.entries(files)) {
    const lower = path.toLowerCase();
    if (typeof raw !== 'string' || !lower.endsWith('.json')) continue;
    if (!/^(entity|attachables|models)\//.test(lower) && !lower.includes('.entity.')) continue;
    const doc = parseJson(raw);
    if (!doc) continue;
    const description = scopeDescription(doc);
    if (!description) continue;
    scopeDocs.push(path);
    const aliases = isRecord(description.animations) ? description.animations : {};
    for (const value of Object.values(aliases)) {
      if (typeof value === 'string') declare(value);
    }
    const animate = isRecord(description.scripts) && Array.isArray(description.scripts.animate)
      ? description.scripts.animate
      : [];
    for (const entry of animate) {
      const names = typeof entry === 'string' ? [entry] : isRecord(entry) ? Object.keys(entry) : [];
      for (const name of names) declare(resolveAlias(name, aliases));
    }
  }

  // Controllers select clips through the same alias map, so their states are followed one level.
  const seenControllers = new Set<string>();
  for (let cursor = 0; cursor < controllersToWalk.length; cursor += 1) {
    const id = controllersToWalk[cursor];
    if (seenControllers.has(id)) continue;
    seenControllers.add(id);
    const entry = index.get(id);
    if (!entry || !isRecord(entry.body)) continue;
    const states = entry.body.states;
    if (!isRecord(states)) continue;
    for (const state of Object.values(states)) {
      const animations = isRecord(state) && Array.isArray(state.animations) ? state.animations : [];
      for (const selection of animations) {
        const names = typeof selection === 'string'
          ? [selection]
          : isRecord(selection)
            ? Object.keys(selection)
            : [];
        for (const name of names) declare(name);
      }
    }
  }

  return { activeIds, scopeDocs };
}

interface VariableReader {
  /** Spelling the readers use, kept for reporting while the map is keyed case-insensitively. */
  display: string;
  animations: Set<string>;
  readIn: Set<string>;
}

/**
 * Resolves the destination meaning of one variable name, in order of evidence strength:
 * a live armour-slot presence query, a shipped-item equipment test, then the canonical
 * Java-pattern -> Bedrock-query catalog. Anything else stays unresolved.
 */
function resolveVariableMeaning(
  name: string,
  itemIds: string[],
  source?: SourceVariableRecord,
): { kind: VariableBindingKind; expression: string; reason: string } | null {
  const visibility = equipmentVisibilityExpression(name);
  if (visibility) {
    return { kind: 'equipment_visibility', expression: visibility.expression, reason: visibility.reason };
  }
  // The expression the source archive itself assigns is the closest evidence there is: it is the
  // value the original content evaluated. It is only used when it is whole Molang — a Java
  // expression shipped into a client entity is a runtime error, not a recovered value — and it is
  // still translated for the context that will evaluate it below.
  if (source) {
    for (const candidate of source.expressions) {
      if (!isMolangSafeExpression(candidate)) continue;
      return {
        kind: 'source_expression',
        expression: candidate,
        reason:
          `the source archive assigns it in ${source.declaredIn.slice(0, 2).join(', ')}; that expression is carried over ` +
          'verbatim instead of a substitute value',
      };
    }
  }
  const equipment = reconstructEquipmentExpression(name, itemIds);
  if (equipment) {
    return {
      kind: 'equipment_detection',
      expression: equipment.expression,
      reason: `the source flag tests a held item and the archive ships ${equipment.matchedItemIds.join(', ')}; the test is rebuilt from those identifiers in both hand slots`,
    };
  }
  const canonical = CANONICAL_JAVA_TO_BEDROCK_VARIABLES[name]
    ?? CANONICAL_JAVA_TO_BEDROCK_VARIABLES[name.toLowerCase()];
  if (canonical) {
    return {
      kind: 'canonical_query',
      expression: canonical.query,
      reason: `the source name is a known player-state pattern; it maps to ${canonical.query} in the destination query set`,
    };
  }
  return null;
}

/**
 * Execution context a variable is actually evaluated in, taken from the documents that read it.
 * Validating every value against the player context made every mob-only query look unexpressible,
 * which reported a real value as unresolved for content that can evaluate it perfectly well.
 */
function readerContext(paths: string[], packs: PackFiles[]): MolangContext {
  let context: MolangContext = 'animation';
  for (const path of paths) {
    const lower = path.toLowerCase();
    // An attachable is evaluated on the player, so it uses the player query set.
    if (lower.startsWith('attachables/')) return 'player_entity';
    const raw = packs.map((pack) => pack[path]).find((value) => typeof value === 'string');
    const found = molangContextForFile(path, parseJson(typeof raw === 'string' ? raw : undefined));
    if (found === 'player_entity') return 'player_entity';
    if (found === 'mob_entity') context = 'mob_entity';
  }
  return context;
}

export function buildMolangDependencyGraph(input: {
  resourcePackFiles: PackFiles;
  behaviorPackFiles?: PackFiles;
  /** Evidence read from the archive the conversion started from, not from the exported pack. */
  sourceVariables?: SourceVariableEvidence;
  onLog?: (line: string) => void;
}): MolangDependencyGraphReport {
  const files = input.resourcePackFiles;
  const sourceVariables = input.sourceVariables;
  const behaviorFiles = input.behaviorPackFiles ?? {};
  const log = (line: string) => input.onLog?.(line);
  const index = indexDefinitions(files);
  const { activeIds } = activatedDefinitions(files, index);

  // Every variable read, attributed to the definition (and therefore the animation) that reads it.
  const readers = new Map<string, VariableReader>();
  const record = (name: string, animation: string | null, path: string) => {
    // Names are matched case-insensitively. A source archive declaring `variable.Melee_Spear_Equipped`
    // and a converted clip reading `variable.melee_spear_equipped` are ONE variable, and treating
    // them as two is exactly how a declared value gets reported as missing.
    const key = name.toLowerCase();
    const entry = readers.get(key) ?? { display: name, animations: new Set<string>(), readIn: new Set<string>() };
    if (animation) entry.animations.add(animation);
    entry.readIn.add(path);
    readers.set(key, entry);
  };

  const definitionsByPathIndex = groupDefinitionsByPath(index);
  let documentsScanned = 0;
  for (const [path, raw] of Object.entries({ ...files, ...behaviorFiles })) {
    if (typeof raw !== 'string' || !path.toLowerCase().endsWith('.json')) continue;
    documentsScanned += 1;
    if (!raw.includes('variable.')) continue;
    const definition = definitionsByPathIndex.get(path) ?? [];
    if (definition.length > 0) {
      for (const entry of definition) {
        const activated = activeIds.has(entry.id);
        for (const name of variableReads(JSON.stringify(entry.body))) {
          record(name, activated ? entry.id : null, path);
        }
      }
      continue;
    }
    for (const name of variableReads(raw)) record(name, null, path);
  }

  const itemIds = collectPackItemIdentifiers({ ...files, ...behaviorFiles });

  // Resolve every meaning once, then hand the same chain to the scope binder so the value is
  // declared in exactly the scopes that evaluate it and nowhere else.
  const meanings = new Map<string, ReturnType<typeof resolveVariableMeaning>>();
  const resolveVariable = (name: string): ScopeVariableResolution | null => {
    const key = name.toLowerCase();
    const meaning = meanings.has(key)
      ? meanings.get(key) ?? null
      : resolveVariableMeaning(name, itemIds, sourceVariables?.records.get(key));
    meanings.set(key, meaning);
    if (!meaning) return null;
    return { expression: meaning.expression, reason: meaning.reason, kind: meaning.kind };
  };

  const scopeBinding = bindMolangVariableScopes({
    resourcePackFiles: files,
    resolveVariable,
    onLog: log,
  });

  // Re-read declarations: the binder just added the scope-local ones.
  const declaredBy = new Map<string, Set<string>>();
  for (const [path, raw] of Object.entries({ ...files, ...behaviorFiles })) {
    if (typeof raw !== 'string') continue;
    for (const name of variableAssignments(raw)) {
      const key = name.toLowerCase();
      const holders = declaredBy.get(key) ?? new Set<string>();
      holders.add(path);
      declaredBy.set(key, holders);
    }
  }

  const nodes: VariableDependencyNode[] = [];
  const unresolved: MolangDependencyGraphReport['unresolved'] = [];
  for (const [key, reader] of [...readers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const name = reader.display;
    const declaredIn = [...(declaredBy.get(key) ?? [])].sort();
    const meaning = resolveVariable(key);
    const context = readerContext(reader.readIn, [files, behaviorFiles]);
    const translated = meaning ? translateMolangExpression(meaning.expression, context) : null;
    const expression = translated && translated.unresolved.length === 0 && translated.rejected.length === 0
      ? translated.expression.trim()
      : null;

    let binding: VariableBindingKind = 'unresolved';
    let reason = '';
    if (declaredIn.length > 0) {
      binding = 'declared_in_scope';
      reason =
        'a shipped document assigns it inside a script scope, so the value comes from the archive itself';
    } else if (meaning && expression) {
      binding = meaning.kind;
      reason = meaning.reason;
    } else if (meaning && translated) {
      reason = translated.unresolved.length > 0
        ? `its only candidate value (${meaning.expression}) cannot be evaluated in the ${context.replace('_', ' ')} context (${translated.unresolved.map((entry) => entry.query).join(', ')})`
        : translated.rejected.map((entry) => entry.reason).join('; ');
    } else {
      const source = sourceVariables?.records.get(key);
      reason =
        'no scope declares it, the name carries no armour-slot or equipped-item meaning, and it matches no canonical ' +
        'player-state pattern — the original value came from a resource this pack does not ship';
      if (source) {
        reason =
          `the source archive mentions it in ${source.declaredIn.slice(0, 2).join(', ')} but computes the value in code ` +
          'with no Molang equivalent, so it stays reported instead of being replaced with a constant';
      }
    }

    nodes.push({
      variable: `variable.${name}`,
      readByAnimations: [...reader.animations].sort(),
      readIn: [...reader.readIn].sort(),
      declaredIn,
      binding,
      expression: binding === 'declared_in_scope' ? null : expression,
      reason,
    });

    if (binding === 'unresolved' && reader.animations.size > 0) {
      unresolved.push({
        variable: `variable.${name}`,
        readByAnimations: [...reader.animations].sort(),
        readIn: [...reader.readIn].sort(),
        reason,
      });
    }
  }

  const animationsAtRisk = new Map<string, string[]>();
  for (const entry of unresolved) {
    for (const animation of entry.readByAnimations) {
      const list = animationsAtRisk.get(animation) ?? [];
      list.push(entry.variable);
      animationsAtRisk.set(animation, list);
    }
  }

  const declaredCount = nodes.filter((node) => node.binding === 'declared_in_scope').length;
  const reconstructedCount = nodes.filter(
    (node) => node.binding !== 'declared_in_scope' && node.binding !== 'unresolved',
  ).length;

  const blocking: string[] = [];
  if (unresolved.length > 0) {
    blocking.push(
      `${unresolved.length} Molang variable(s) are read by activated animations and declared nowhere: ` +
        `${unresolved.slice(0, 6).map((entry) => `${entry.variable} (${entry.readByAnimations.slice(0, 2).join(', ') || 'entity scope'})`).join('; ')}${
          unresolved.length > 6 ? ' …' : ''
        }. Those clips cannot evaluate until the source value is recovered.`,
    );
  }
  for (const entry of scopeBinding.rejectedExpressions) {
    blocking.push(
      `${entry.variable} in ${entry.file} cannot be expressed in the destination context: ${entry.reason}.`,
    );
  }

  const report: MolangDependencyGraphReport = {
    documentsScanned,
    definitionsIndexed: index.size,
    activatedDefinitions: activeIds.size,
    variablesDiscovered: nodes.length,
    declaredCount,
    reconstructedCount,
    unresolved,
    nodes,
    animationsAtRisk: [...animationsAtRisk.entries()].map(([animation, variables]) => ({
      animation,
      variables: [...new Set(variables)].sort(),
    })),
    scopeDeclarationsAdded: scopeBinding.declarationsAdded.length,
    scopeFilesTouched: scopeBinding.filesTouched,
    rejectedExpressions: scopeBinding.rejectedExpressions,
    exportReady: blocking.length === 0,
    blocking,
    summary: '',
  };

  report.summary =
    `Molang dependency graph: ${report.documentsScanned} document(s) scanned, ${report.definitionsIndexed} definition(s) indexed, ` +
    `${report.activatedDefinitions} activated by a client entity. ${report.variablesDiscovered} variable name(s) discovered — ` +
    `${declaredCount} declared by the archive, ${reconstructedCount} rebuilt from destination evidence, ${unresolved.length} unresolved. ` +
    `${scopeBinding.declarationsAdded.length} scope declaration(s) written into ${scopeBinding.filesTouched} document(s); ` +
    `${report.animationsAtRisk.length} animation(s) depend on a variable that cannot be evaluated; ` +
    `${scopeBinding.rejectedExpressions.length} resolved value(s) rejected by the destination context.`;
  log(`[MOLANG:GRAPH] ${report.summary}`);
  for (const node of nodes.filter((entry) => entry.binding !== 'declared_in_scope' && entry.binding !== 'unresolved').slice(0, 6)) {
    log(
      `[MOLANG:GRAPH:BIND] ${node.variable} (${node.binding}) = ${node.expression} — read by ${node.readByAnimations.slice(0, 3).join(', ') || node.readIn.slice(0, 2).join(', ')}; ${node.reason}.`,
    );
  }
  for (const entry of unresolved.slice(0, 6)) {
    log(`[MOLANG:GRAPH:UNRESOLVED] ${entry.variable} read by ${entry.readByAnimations.slice(0, 3).join(', ') || entry.readIn.slice(0, 2).join(', ')} — ${entry.reason}.`);
  }
  for (const risk of report.animationsAtRisk.slice(0, 6)) {
    log(`[MOLANG:GRAPH:RISK] ${risk.animation} cannot evaluate ${risk.variables.join(', ')}.`);
  }
  return report;
}