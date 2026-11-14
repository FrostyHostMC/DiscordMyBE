/**
 * Scope-aware Molang variable binding.
 *
 * A Molang variable is not declared once for a whole pack: it is declared inside the script scope
 * that evaluates it. `entity/player.entity.json`, a generated `attachables/*.json`, and every mob
 * client entity each evaluate their OWN `scripts.pre_animation`, so a variable one of them declares
 * is "unknown" in every other document that reads it.
 *
 * That is exactly the reported `variable.helmet_layer_visible` / `chest_layer_visible` /
 * `leg_layer_visible` / `boot_layer_visible` failure: the source archive declared these flags in
 * the vanilla player entity that a pack override replaces. Their actual vanilla meanings are not
 * generic armour-slot occupancy: Mojang derives the helmet layer from `!query.has_head_gear` and
 * keeps chest, leg and boot layers at `1.0`. Those source-backed expressions are restored exactly;
 * arbitrary armour-slot presence remains unresolved when the destination exposes no valid query.
 *
 * This pass walks every shipped document, records what each execution scope really reads — directly
 * and through the animation clips / controllers it references — and what it declares. A read with no
 * declaration in its own scope is satisfied in that scope from an evidence-backed destination
 * expression. Anything it cannot express is reported, never guessed.
 */

import { molangContextForFile, translateMolangExpression } from '@/utils/molangCompatibility';

import { slotOccupancyExpression } from '@/utils/molangSlotQueries';

export type ScopeFileMap = Record<string, string | Uint8Array>;

export interface EquipmentVisibilityResolution {
  variable: string;
  slot: string;
  expression: string;
  reason: string;
}

/**
 * A destination expression that reproduces what a source variable meant. Injectable so the caller
 * can chain resolvers (equipment visibility, shipped-item detection, canonical query catalog)
 * without this module having to know them.
 */
export interface ScopeVariableResolution {
  expression: string;
  reason: string;
  /** Which resolver produced it; echoed into the report for traceability. */
  kind?: string;
}

/** Armour-part vocabulary: bare words a source archive uses for each armour slot. */
const ARMOR_SLOT_BY_TOKEN: Record<string, string> = {
  head: 'slot.armor.head',
  helmet: 'slot.armor.head',
  hat: 'slot.armor.head',
  hood: 'slot.armor.head',
  crown: 'slot.armor.head',
  mask: 'slot.armor.head',
  cap: 'slot.armor.head',
  chest: 'slot.armor.chest',
  chestplate: 'slot.armor.chest',
  breastplate: 'slot.armor.chest',
  torso: 'slot.armor.chest',
  body: 'slot.armor.chest',
  tunic: 'slot.armor.chest',
  robe: 'slot.armor.chest',
  legs: 'slot.armor.legs',
  leg: 'slot.armor.legs',
  legging: 'slot.armor.legs',
  leggings: 'slot.armor.legs',
  pants: 'slot.armor.legs',
  trousers: 'slot.armor.legs',
  greave: 'slot.armor.legs',
  greaves: 'slot.armor.legs',
  feet: 'slot.armor.feet',
  foot: 'slot.armor.feet',
  boots: 'slot.armor.feet',
  boot: 'slot.armor.feet',
  shoe: 'slot.armor.feet',
  shoes: 'slot.armor.feet',
  sabaton: 'slot.armor.feet',
};

/** Tokens that mean "this thing is present / shown on the entity". */
const VISIBILITY_TOKENS = new Set([
  'visible',
  'visibility',
  'shown',
  'show',
  'equipped',
  'equip',
  'worn',
  'wear',
  'wearing',
  'layer',
]);

/** Names carrying these tokens describe the inverted condition, so they are never auto-derived. */
const NEGATION_TOKENS = new Set(['hidden', 'hide', 'invisible', 'unequipped', 'unequip', 'not', 'off']);

const VANILLA_ARMOR_LAYER_VARIABLES = [
  'helmet_layer_visible',
  'chest_layer_visible',
  'leg_layer_visible',
  'boot_layer_visible',
];

function splitTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Rebuilds an equipment-visibility flag from the armour slot it describes. The boolean meaning the
 * source expresses ("is armour worn in this slot") is preserved by the documented slot-presence
 * form of `query.is_item_name_any`; the value stays live, so hiding and re-equipping armour keeps
 * changing the layer instead of latching one constant.
 */
const VANILLA_ARMOR_LAYER_EXPRESSIONS: Record<string, { slot: string; expression: string; reason: string }> = {
  helmet_layer_visible: {
    slot: 'slot.armor.head',
    expression: '!query.has_head_gear',
    reason: 'Mojang vanilla player.entity.json defines helmet_layer_visible as the inverse of query.has_head_gear',
  },
  chest_layer_visible: {
    slot: 'slot.armor.chest',
    expression: '1.0',
    reason: 'Mojang vanilla player.entity.json keeps chest_layer_visible at 1.0',
  },
  leg_layer_visible: {
    slot: 'slot.armor.legs',
    expression: '1.0',
    reason: 'Mojang vanilla player.entity.json keeps leg_layer_visible at 1.0',
  },
  boot_layer_visible: {
    slot: 'slot.armor.feet',
    expression: '1.0',
    reason: 'Mojang vanilla player.entity.json keeps boot_layer_visible at 1.0',
  },
};

export function equipmentVisibilityExpression(variableName: string): EquipmentVisibilityResolution | null {
  const vanilla = VANILLA_ARMOR_LAYER_EXPRESSIONS[variableName];
  if (vanilla) return { variable: variableName, ...vanilla };
  const tokens = splitTokens(variableName);
  if (tokens.length === 0) return null;
  if (tokens.some((token) => NEGATION_TOKENS.has(token))) return null;
  if (!tokens.some((token) => VISIBILITY_TOKENS.has(token))) return null;
  const slotToken = tokens.find((token) => ARMOR_SLOT_BY_TOKEN[token]);
  if (!slotToken) return null;
  const slot = ARMOR_SLOT_BY_TOKEN[slotToken];
  // The presence form has to be a signature the engine accepts: `query.is_item_name_any` needs at
  // least one item name, so an "is this slot occupied" flag is evaluated with the slot-occupancy
  // query instead of a call that throws on every frame.
  const occupancy = slotOccupancyExpression(slot);
  if (!occupancy) return null;
  return {
    variable: variableName,
    slot,
    expression: occupancy.expression,
    reason:
      `the flag names the ${slotToken} armour layer and means "that layer is worn"; the destination evaluates it live on ` +
      `${slot} — ${occupancy.reason}`,
  };
}

export interface ScopeDeclaration {
  file: string;
  variable: string;
  statement: string;
  expression: string;
  reason: string;
  /** Where the read that needed the declaration came from. */
  trigger: string;
}

export interface MolangScopeBindingReport {
  documentsScanned: number;
  variablesRead: number;
  declarationsAdded: ScopeDeclaration[];
  filesTouched: number;
  unsupported: Array<{ variable: string; files: string[]; reason: string }>;
  /** Expressions a resolver produced in a form the destination context rejects. */
  rejectedExpressions: Array<{ file: string; variable: string; expression: string; reason: string }>;
  summary: string;
}

function parseJson(raw: string | Uint8Array | undefined): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function variableReads(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\bvariable\.([a-zA-Z0-9_]+)/g)) found.push(String(match[1]));
  return found;
}

/** Any `variable.x = ...` inside a document declares the name for that document's scope. */
function variableAssignments(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\bvariable\.([a-zA-Z0-9_]+)\s*=(?!=)/g)) found.push(String(match[1]));
  return found;
}

/** The description block of a client entity or attachable, the only documents with a script scope. */
function scopeDescription(doc: Record<string, any>): Record<string, any> | null {
  for (const key of ['minecraft:client_entity', 'minecraft:attachable']) {
    const root = doc[key];
    const description = root && typeof root === 'object' ? (root as Record<string, any>).description : null;
    if (description && typeof description === 'object' && !Array.isArray(description)) {
      return description as Record<string, any>;
    }
  }
  return null;
}

export function bindMolangVariableScopes(input: {
  resourcePackFiles: ScopeFileMap;
  /**
   * Extra resolvers tried before the built-in equipment-visibility rule. Returning null means "this
   * pass cannot prove a meaning for that name", which is reported rather than guessed.
   */
  resolveVariable?: (name: string) => ScopeVariableResolution | null;
  onLog?: (line: string) => void;
}): MolangScopeBindingReport {
  const files = input.resourcePackFiles;
  const log = (line: string) => input.onLog?.(line);
  const report: MolangScopeBindingReport = {
    documentsScanned: 0,
    variablesRead: 0,
    declarationsAdded: [],
    filesTouched: 0,
    unsupported: [],
    rejectedExpressions: [],
    summary: '',
  };

  const docs = new Map<string, Record<string, any>>();
  const readsByFile = new Map<string, Set<string>>();
  const declaredByFile = new Map<string, Set<string>>();
  const readsByDefinition = new Map<string, Set<string>>();
  const filesByVariable = new Map<string, Set<string>>();

  for (const [path, raw] of Object.entries(files)) {
    if (typeof raw !== 'string' || !path.toLowerCase().endsWith('.json')) continue;
    const doc = parseJson(raw);
    if (!doc) continue;
    docs.set(path, doc);
    const reads = new Set(variableReads(raw));
    readsByFile.set(path, reads);
    declaredByFile.set(path, new Set(variableAssignments(raw)));
    for (const name of reads) {
      const holders = filesByVariable.get(name) ?? new Set<string>();
      holders.add(path);
      filesByVariable.set(name, holders);
    }
    const lower = path.toLowerCase();
    const container = lower.endsWith('.animation_controllers.json')
      ? doc.animation_controllers
      : lower.endsWith('.animation.json')
        ? doc.animations
        : null;
    if (container && typeof container === 'object') {
      for (const [id, body] of Object.entries(container as Record<string, unknown>)) {
        readsByDefinition.set(id, new Set(variableReads(JSON.stringify(body))));
      }
    }
  }
  report.documentsScanned = docs.size;
  report.variablesRead = filesByVariable.size;

  for (const [path, doc] of docs) {
    const description = scopeDescription(doc);
    if (!description) continue;
    const reads = new Set(readsByFile.get(path) ?? []);
    const animations = description.animations;
    if (animations && typeof animations === 'object' && !Array.isArray(animations)) {
      for (const value of Object.values(animations as Record<string, unknown>)) {
        if (typeof value !== 'string') continue;
        for (const name of readsByDefinition.get(value) ?? []) reads.add(name);
      }
    }
    const declared = declaredByFile.get(path) ?? new Set<string>();
    const missing = [...reads].filter((name) => !declared.has(name)).sort();
    if (missing.length === 0) continue;

    // The strictest context that can evaluate this document. An attachable has no client-entity
    // document behind it, so the player context (the narrower query set) is assumed, which means a
    // declaration is only emitted in a form the destination really accepts.
    const context = molangContextForFile(path, doc) ?? 'player_entity';
    const statements: string[] = [];
    for (const name of missing) {
      const resolution = input.resolveVariable?.(name) ?? equipmentVisibilityExpression(name);
      if (!resolution) {
        report.unsupported.push({
          variable: `variable.${name}`,
          files: [...(filesByVariable.get(name) ?? [])].slice(0, 4),
          reason:
            'read in this script scope and declared in none, and the name carries no destination-equivalent meaning this ' +
            'pass can prove, so no value is invented for it',
        });
        continue;
      }
      // A resolver may return a source-shaped expression (for example a catalog query the player
      // context does not expose). It is translated here so the declaration itself is valid in the
      // scope that will evaluate it, and a value that cannot be expressed is reported, never shipped.
      const translated = translateMolangExpression(resolution.expression, context);
      if (translated.unresolved.length > 0 || translated.rejected.length > 0) {
        report.rejectedExpressions.push({
          file: path,
          variable: `variable.${name}`,
          expression: translationSource(resolution.expression, translated.expression),
          reason:
            translated.unresolved.length > 0
              ? `the resolved value cannot be evaluated in the ${context.replace('_', ' ')} context (${translated.unresolved.map((entry) => entry.query).join(', ')})`
              : translated.rejected.map((entry) => entry.reason).join('; '),
        });
        continue;
      }
      const expression = translated.expression.trim();
      const statement = `variable.${name} = ${expression};`;
      statements.push(statement);
      report.declarationsAdded.push({
        file: path,
        variable: `variable.${name}`,
        statement,
        expression,
        reason: translationSource(resolution.reason, resolution.kind ? `${resolution.kind} resolver` : ''),
        trigger:
          readsByFile.get(path)?.has(name) === true
            ? 'read directly by this document'
            : 'read by an animation or controller this document activates',
      });
    }
    if (statements.length === 0) continue;

    const scripts = description.scripts && typeof description.scripts === 'object' && !Array.isArray(description.scripts)
      ? (description.scripts as Record<string, any>)
      : {};
    const existing: string[] = Array.isArray(scripts.pre_animation)
      ? scripts.pre_animation.filter((entry: unknown): entry is string => typeof entry === 'string')
      : typeof scripts.pre_animation === 'string'
        ? [scripts.pre_animation]
        : [];
    const seen = new Set(existing.map((entry) => entry.replace(/\s+/g, '')));
    for (const statement of statements) {
      const key = statement.replace(/\s+/g, '');
      if (seen.has(key)) continue;
      existing.push(statement);
      seen.add(key);
    }
    scripts.pre_animation = existing;
    description.scripts = scripts;
    files[path] = JSON.stringify(doc, null, 2);
    report.filesTouched += 1;
  }

  report.summary =
    `${report.documentsScanned} document(s) scanned; ${report.variablesRead} Molang variable name(s) read across the pack. ` +
    `${report.declarationsAdded.length} declaration(s) added in ${report.filesTouched} script scope(s) that read a variable they ` +
    `never declared; ${report.unsupported.length} read in a scope with no provable destination equivalent.`;
  log(`[MOLANG:SCOPE] ${report.summary}`);
  for (const entry of report.declarationsAdded.slice(0, 8)) {
    log(`[MOLANG:SCOPE:BIND] ${entry.file}: ${entry.statement} — ${entry.trigger}; ${entry.reason}.`);
  }
  for (const entry of report.unsupported.slice(0, 8)) {
    log(`[MOLANG:SCOPE:UNRESOLVED] ${entry.variable} (${entry.files.join(', ')}) — ${entry.reason}.`);
  }
  for (const entry of report.rejectedExpressions.slice(0, 8)) {
    log(`[MOLANG:SCOPE:REJECT] ${entry.file}: ${entry.variable} = ${entry.expression} — ${entry.reason}.`);
  }
  return report;
}

/** Keeps the resolver note and the destination expression in one readable sentence. */
function translationSource(reason: string, suffix: string): string {
  return suffix ? `${reason} [${suffix}]` : reason;
}

/** Declarations for the four armour-layer visibility flags every humanoid armour set uses. */
export const ARMOR_LAYER_VISIBILITY_MAP: Record<string, { query: string; defaultVal: number }> = (() => {
  const map: Record<string, { query: string; defaultVal: number }> = {};
  for (const name of VANILLA_ARMOR_LAYER_VARIABLES) {
    const resolution = equipmentVisibilityExpression(name);
    if (resolution) map[name] = { query: resolution.expression, defaultVal: resolution.expression === '1.0' ? 1 : 0 };
  }
  return map;
})();