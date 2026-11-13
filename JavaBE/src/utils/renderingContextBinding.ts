/**
 * Rendering-context binding audit.
 *
 * Bedrock evaluates the same clip in two different places: the third-person body rig and the
 * first-person hand rig. An animation that belongs to one of them is only correct in that one, so a
 * registration that carries no first-person gate and a first-person pose that is not gated are two
 * different defects — and the reverse (a third-person body pose gated to first person only) is a
 * third.
 *
 * This pass reads the shipped player definition, works out which context every entry really reaches
 * from the gate it carries, and compares that against the context the entry's own identity and bone
 * tracks say it belongs to. A first-person-only entry with no gate gets the documented gate so the
 * hand pose is not applied to the body; a body pose that can never play in third person is reported
 * instead of silently rewritten. Nothing is inferred from a mod's filename.
 */

import {
  FIRST_PERSON_GATE,
  PLAYER_BASELINE_ENTRIES,
  findPlayerClientEntityPath,
  isFirstPersonBaselineIdentifier,
  isVanillaPlayerBaselineIdentifier,
} from '@/utils/vanillaPlayerBaseline';

export type RenderContext = 'first_person' | 'third_person' | 'both';
export type GateKind = 'none' | 'first_person' | 'third_person' | 'custom';
export type BindingStatus = 'bound' | 'gated' | 'context_mismatch';

export interface ClipContextBinding {
  alias: string;
  identifier: string;
  kind: 'clip' | 'controller' | 'vanilla';
  /** Context the entry's identity says it belongs to. */
  intended: RenderContext;
  gate: GateKind;
  gateExpression: string | null;
  bones: string[];
  status: BindingStatus;
  note: string;
}

export interface RenderingContextBindingReport {
  entityPath: string | null;
  entitiesScanned: number;
  bindings: ClipContextBinding[];
  firstPersonBindings: number;
  thirdPersonBindings: number;
  sharedBindings: number;
  gatesAdded: string[];
  mismatches: Array<{ alias: string; detail: string }>;
  firstPerson: { basePosePresent: boolean; basePoseResolves: boolean; basePoseGated: boolean; ready: boolean };
  thirdPerson: { basePosePresent: boolean; lookAtTargetPresent: boolean; wronglyGated: string[]; ready: boolean };
  blocking: string[];
  summary: string;
}

type RawDoc = Record<string, any>;

const ARM_TOKENS = new Set(['arm', 'arms', 'hand', 'hands', 'item', 'items', 'sleeve', 'sleeves', 'wrist', 'forearm', 'elbow']);
const BODY_TOKENS = new Set([
  'body', 'torso', 'waist', 'chest', 'hip', 'hips', 'leg', 'legs', 'thigh', 'shin', 'foot', 'feet',
  'head', 'neck', 'root', 'cape', 'skirt', 'spine', 'pelvis', 'tail', 'shoulder', 'back',
]);
const FIRST_PERSON_TOKENS = new Set(['first_person', 'firstperson', 'fp', '1st_person', 'firstpersonview']);
const THIRD_PERSON_TOKENS = new Set(['third_person', 'thirdperson', 'tp', '3rd_person']);

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(raw: string | Uint8Array | undefined): RawDoc | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function tokensOf(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Which rendering context an identifier's own name declares, when it declares one. */
function markerContext(...names: string[]): RenderContext | null {
  for (const name of names) {
    const tokens = tokensOf(name);
    if (tokens.some((token) => FIRST_PERSON_TOKENS.has(token))) return 'first_person';
    if (tokens.some((token) => THIRD_PERSON_TOKENS.has(token))) return 'third_person';
  }
  return null;
}

/** The context an entry really reaches, read from the gate it carries. */
function classifyGate(condition: string | null): GateKind {
  if (!condition) return 'none';
  const compact = condition.replace(/\s+/g, '');
  if (compact === `!${FIRST_PERSON_GATE}` || compact === `!(${FIRST_PERSON_GATE})`) return 'third_person';
  if (/query\.is_first_person==0/.test(compact) || /!query\.is_first_person/.test(compact)) return 'third_person';
  if (compact === FIRST_PERSON_GATE || compact === `(${FIRST_PERSON_GATE})`) return 'first_person';
  if (/query\.is_first_person/.test(compact)) return 'first_person';
  return 'custom';
}

/** Bone names each shipped clip animates, used as evidence of which rig region it drives. */
function indexClipBones(files: Record<string, string | Uint8Array>): Map<string, string[]> {
  const bones = new Map<string, string[]>();
  for (const [path, raw] of Object.entries(files)) {
    const lower = path.toLowerCase();
    if (typeof raw !== 'string' || !lower.endsWith('.animation.json')) continue;
    const doc = parseJson(raw);
    const definitions = doc?.animations;
    if (!isRecord(definitions)) continue;
    for (const [id, body] of Object.entries(definitions)) {
      if (!isRecord(body)) continue;
      const names = new Set<string>();
      const collect = (node: unknown, depth = 0) => {
        if (depth > 6 || !isRecord(node)) return;
        for (const [key, value] of Object.entries(node)) {
          if (key === 'bones' && isRecord(value)) {
            for (const boneName of Object.keys(value)) names.add(boneName.toLowerCase());
          } else if (isRecord(value)) {
            collect(value, depth + 1);
          }
        }
      };
      collect(body);
      if (names.size > 0) bones.set(id, [...names]);
    }
  }
  return bones;
}

function classifyBones(bones: string[]): { arms: boolean; body: boolean } {
  let arms = false;
  let body = false;
  for (const bone of bones) {
    const tokens = tokensOf(bone);
    if (tokens.some((token) => ARM_TOKENS.has(token))) arms = true;
    else if (tokens.some((token) => BODY_TOKENS.has(token))) body = true;
  }
  return { arms, body };
}

export function auditRenderingContextBinding(input: {
  resourcePackFiles: Record<string, string | Uint8Array>;
  onLog?: (line: string) => void;
}): RenderingContextBindingReport {
  const files = input.resourcePackFiles;
  const log = (line: string) => input.onLog?.(line);
  const report: RenderingContextBindingReport = {
    entityPath: null,
    entitiesScanned: 0,
    bindings: [],
    firstPersonBindings: 0,
    thirdPersonBindings: 0,
    sharedBindings: 0,
    gatesAdded: [],
    mismatches: [],
    firstPerson: { basePosePresent: false, basePoseResolves: false, basePoseGated: false, ready: false },
    thirdPerson: { basePosePresent: false, lookAtTargetPresent: false, wronglyGated: [], ready: false },
    blocking: [],
    summary: '',
  };

  // Located by the identifier the document declares: a port may ship the player definition under a
  // generated file name, and a path-only lookup then verifies nothing at all.
  const entityPath = findPlayerClientEntityPath(files);
  const doc = entityPath ? parseJson(files[entityPath]) : null;
  const description = isRecord(doc?.['minecraft:client_entity']?.description)
    ? (doc?.['minecraft:client_entity'].description as Record<string, any>)
    : null;
  if (!entityPath || !doc || !description) {
    report.summary =
      'No player client entity ships, so no first-person or third-person binding exists to verify.';
    log(`[RENDER:CONTEXT] ${report.summary}`);
    return report;
  }

  report.entityPath = entityPath;
  report.entitiesScanned = Object.keys(files).filter(
    (path) => /\.entity\.json$/i.test(path) || path.toLowerCase().startsWith('attachables/'),
  ).length;

  const aliases: Record<string, unknown> = isRecord(description.animations) ? description.animations : {};
  const scripts: Record<string, any> = isRecord(description.scripts) ? description.scripts : {};
  const animate: unknown[] = Array.isArray(scripts.animate) ? scripts.animate : [];
  const clipBones = indexClipBones(files);
  const baselineFirstPerson = PLAYER_BASELINE_ENTRIES.find((entry) =>
    isFirstPersonBaselineIdentifier(entry.identifier),
  );

  const bindings: ClipContextBinding[] = [];
  let mutated = false;

  animate.forEach((entry, position) => {
    const names = typeof entry === 'string' ? [entry] : isRecord(entry) ? Object.keys(entry) : [];
    const condition = isRecord(entry) && names.length > 0 ? entry[names[0]] : null;
    const gateExpression = typeof condition === 'string' ? condition : null;
    for (const alias of names) {
      const identifier = typeof aliases[alias] === 'string' ? (aliases[alias] as string) : alias;
      const gate = classifyGate(gateExpression);
      const kind: ClipContextBinding['kind'] = identifier.startsWith('controller.')
        ? 'controller'
        : isVanillaPlayerBaselineIdentifier(identifier)
          ? 'vanilla'
          : 'clip';
      const bones = clipBones.get(identifier) ?? [];
      const boneShape = classifyBones(bones);
      const declared = markerContext(alias, identifier);
      const intended: RenderContext = declared
        ?? (isFirstPersonBaselineIdentifier(identifier) ? 'first_person' : 'both');

      let status: BindingStatus = 'bound';
      let note =
        intended === 'both'
          ? 'plays in every perspective; the entry carries no perspective-specific intent'
          : `the entry declares the ${intended.replace('_', ' ')} context`;

      if (intended === 'first_person' && gate !== 'first_person' && gate !== 'custom' && names.length === 1) {
        // The entry belongs to the hand rig but reaches the body rig: gating it is the documented
        // destination form, so the reference is corrected instead of reported as broken.
        animate[position] = { [alias]: FIRST_PERSON_GATE };
        mutated = true;
        report.gatesAdded.push(alias);
        status = 'gated';
        note =
          `first-person entry had no perspective gate; it now carries ${FIRST_PERSON_GATE} so the hand pose is ` +
          'not applied to the third-person body';
      } else if (intended === 'first_person' && gate === 'first_person') {
        status = 'gated';
      } else if (intended === 'first_person' && gate === 'third_person') {
        status = 'context_mismatch';
        note = 'a first-person entry is gated to third person only, so the hand pose can never play';
      } else if (intended === 'third_person' && gate === 'first_person') {
        status = 'context_mismatch';
        note = 'a third-person entry is gated to first person only, so the body pose can never play';
      } else if (boneShape.body && !boneShape.arms && gate === 'first_person') {
        status = 'context_mismatch';
        note =
          'the clip only animates body/leg bones but is gated to first person, so the third-person body pose never plays';
      }

      if (status === 'context_mismatch') report.mismatches.push({ alias, detail: note });
      if (intended === 'first_person') report.firstPersonBindings += 1;
      else if (intended === 'third_person') report.thirdPersonBindings += 1;
      else report.sharedBindings += 1;

      bindings.push({
        alias,
        identifier,
        kind,
        intended,
        gate: classifyGate(status === 'gated' ? FIRST_PERSON_GATE : gateExpression),
        gateExpression: status === 'gated' ? FIRST_PERSON_GATE : gateExpression,
        bones: bones.slice(0, 8),
        status,
        note,
      });
    }
  });

  report.bindings = bindings;

  // Baseline verification: first person needs its pose and its gate; third person needs the two
  // poses that build the body and must not see the first-person gate.
  if (baselineFirstPerson) {
    const alias = baselineFirstPerson.alias;
    report.firstPerson.basePosePresent = bindings.some((binding) => binding.alias === alias);
    const bound = bindings.find((binding) => binding.alias === alias);
    report.firstPerson.basePoseResolves = Boolean(bound) && bound?.identifier === baselineFirstPerson.identifier;
    report.firstPerson.basePoseGated = Boolean(bound) && bound?.gate === 'first_person';
    report.firstPerson.ready =
      report.firstPerson.basePosePresent &&
      report.firstPerson.basePoseResolves &&
      report.firstPerson.basePoseGated;
  }
  const thirdPersonAliases = ['base_pose', 'look_at_target'];
  report.thirdPerson.basePosePresent = bindings.some((binding) => binding.alias === thirdPersonAliases[0]);
  report.thirdPerson.lookAtTargetPresent = bindings.some((binding) => binding.alias === thirdPersonAliases[1]);
  report.thirdPerson.wronglyGated = bindings
    .filter((binding) => thirdPersonAliases.includes(binding.alias) && binding.gate === 'first_person')
    .map((binding) => binding.alias);
  report.thirdPerson.ready =
    report.thirdPerson.basePosePresent &&
    report.thirdPerson.lookAtTargetPresent &&
    report.thirdPerson.wronglyGated.length === 0;

  if (!report.firstPerson.ready) {
    report.blocking.push(
      `First-person integration is NOT complete: first_person_base_pose ${
        report.firstPerson.basePoseResolves ? 'resolves' : 'does not resolve'
      }, gate ${report.firstPerson.basePoseGated ? 'present' : 'missing'}.`,
    );
  }
  if (!report.thirdPerson.ready) {
    report.blocking.push(
      `Third-person integration is NOT complete: base_pose ${report.thirdPerson.basePosePresent ? 'present' : 'missing'}, ` +
        `look_at_target ${report.thirdPerson.lookAtTargetPresent ? 'present' : 'missing'}, ` +
        `${report.thirdPerson.wronglyGated.length} body pose(s) gated to first person.`,
    );
  }
  for (const mismatch of report.mismatches) {
    report.blocking.push(`Perspective mismatch on "${mismatch.alias}": ${mismatch.detail}.`);
  }

  if (mutated) {
    scripts.animate = animate;
    description.scripts = scripts;
    const next = JSON.stringify(doc, null, 2);
    if (next !== files[entityPath]) files[entityPath] = next;
  }

  report.summary =
    `${bindings.length} player animation binding(s) across ${report.entitiesScanned} shipped entity/attachable document(s): ` +
    `${report.firstPersonBindings} first-person, ${report.thirdPersonBindings} third-person, ${report.sharedBindings} shared. ` +
    `${report.gatesAdded.length} first-person gate(s) added, ${report.mismatches.length} perspective mismatch(es). ` +
    `First person ${report.firstPerson.ready ? 'verified' : 'NOT verified'}, third person ${report.thirdPerson.ready ? 'verified' : 'NOT verified'}. ` +
    'Static verification of the shipped wiring only; live playback is a separate step.';
  log(`[RENDER:CONTEXT] ${report.summary}`);
  for (const alias of report.gatesAdded.slice(0, 6)) {
    log(`[RENDER:CONTEXT:GATE] ${alias} now carries ${FIRST_PERSON_GATE}.`);
  }
  for (const mismatch of report.mismatches.slice(0, 6)) {
    log(`[RENDER:CONTEXT:MISMATCH] ${mismatch.alias}: ${mismatch.detail}.`);
  }
  for (const finding of report.blocking.slice(0, 6)) log(`[RENDER:CONTEXT:BLOCK] ${finding}`);
  return report;
}