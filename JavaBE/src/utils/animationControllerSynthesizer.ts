import type { DecompileClassSummary } from '@/types/remaker';
import { safeFileId } from '@/utils/bedrockIds';

/**
 * Bytecode-to-JSON animation controller synthesis.
 *
 * The decompiler reports which Java classes carry animation-controller or
 * state-machine opcode signatures. Those detected names are the ONLY input: no
 * controller is invented for a class the archive never contained. Every emitted
 * state has a bounded exit so a looping clip can never latch the machine (RG-17),
 * and every trigger reads an engine-written query (RG-16).
 */

export interface ControllerSignals {
  controllerClasses?: string[];
  stateMachineClasses?: string[];
  animationIds?: string[];
  entityClasses?: DecompileClassSummary[];
}

export interface SynthesizedController {
  filePath: string;
  controllerId: string;
  ownerId: string;
  sourceClass: string;
  kind: 'animation-controller' | 'state-machine';
  states: string[];
  json: string;
}

export interface ControllerSynthesis {
  controllers: SynthesizedController[];
  files: Record<string, string>;
  controllerIdsByOwner: Record<string, string[]>;
}

const MAX_SYNTHESIZED = 12;
/** State words a Bedrock controller can hold and play without inventing clips. */
const STATE_WORDS = ['walk', 'run', 'fly', 'swim', 'climb', 'cast', 'shoot', 'charge', 'slam', 'roar',
  'taunt', 'dash', 'phase', 'transform', 'summon', 'death', 'sleep', 'sit', 'stun', 'guard', 'dodge'];
const NOISE = /^(get|set|on|is|the|and|base|main|impl|java|mod|entity|mob|anim|animation|controller|control|state|machine|manager|handler|service|provider|listener|system|util|helper|core|client|server|common|registry|factory|builder|event|events|tick|update|render|model|layers)$/;

const slugOf = (value: string) => safeFileId(value) || 'generated';

function tokensOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 2 && !NOISE.test(token));
}

/** Best naming match between a detected Java class and a ported mob (deterministic). */
function ownerFor(className: string, mobIds: string[]): string | null {
  if (mobIds.length === 0) return null;
  const classKey = className.toLowerCase().replace(/[^a-z0-9]/g, '');
  const tokens = new Set(tokensOf(className));
  let best = '';
  let bestScore = 0;
  let ambiguous = false;
  for (const mobId of mobIds) {
    const mobKey = mobId.toLowerCase().replace(/[^a-z0-9]/g, '');
    const tokenScore = mobId.split('_').filter((part) => part.length > 2 && tokens.has(part)).length;
    const score = mobKey.length >= 4 && classKey.includes(mobKey)
      ? 20 + mobKey.length
      : tokenScore;
    if (score > bestScore) {
      bestScore = score;
      best = mobId;
      ambiguous = false;
    } else if (score > 0 && score === bestScore && best !== mobId) {
      ambiguous = true;
    }
  }
  return bestScore > 0 && !ambiguous ? best : null;
}

function buildStates(ownerId: string, inherited: Array<{ state: string; animation: string }>) {
  const clip = (name: string) => `animation.${ownerId}.${name}`;
  // query.hurt_time counts up forever, so the flinch is a one-shot bounded window.
  const hurtIn = 'query.hurt_time >= 0 && query.hurt_time < 0.35';
  const states: Record<string, unknown> = {
    default: {
      animations: ['idle', clip('idle')],
      transitions: [
        { move: 'query.modified_move_speed > 0.1 || query.is_moving' },
        { attack: 'query.is_delayed_attacking' },
        ...inherited.map((entry, index) => ({
          [entry.state]: `math.mod(query.life_time, ${12 + index * 3}) > ${7 + index * 3}`,
        })),
        { hurt: hurtIn },
      ],
    },
    move: {
      animations: ['walk', clip('walk')],
      transitions: [
        { default: 'query.modified_move_speed <= 0.1 && !query.is_moving' },
        { attack: 'query.is_delayed_attacking' },
        { hurt: hurtIn },
      ],
    },
    attack: {
      animations: ['attack', clip('attack')],
      // Bounded exit, never query.all_animations_finished: the blended clips loop
      // and would freeze the mob mid-pose inside the attack state.
      transitions: [{ default: 'query.anim_time > 0.6' }],
    },
    hurt: {
      animations: ['hurt', clip('hurt')],
      transitions: [{ default: 'query.anim_time > 0.45' }],
    },
  };
  for (const entry of inherited) {
    states[entry.state] = {
      animations: [entry.animation, 'idle', clip('idle')],
      transitions: [
        { default: 'query.anim_time > 1.2' },
        { attack: 'query.is_delayed_attacking' },
        { hurt: hurtIn },
      ],
    };
  }
  return { states, stateNames: Object.keys(states) };
}

export function synthesizeAnimationControllersFromBytecode(
  mobIds: string[],
  signals: ControllerSignals = {},
): ControllerSynthesis {
  const animationIds = signals.animationIds ?? [];
  const sources: Array<{ className: string; kind: SynthesizedController['kind'] }> = [
    ...(signals.controllerClasses ?? []).map((className) => ({ className, kind: 'animation-controller' as const })),
    ...(signals.stateMachineClasses ?? []).map((className) => ({ className, kind: 'state-machine' as const })),
  ];

  const controllers: SynthesizedController[] = [];
  const files: Record<string, string> = {};
  const controllerIdsByOwner: Record<string, string[]> = {};
  const seen = new Set<string>();

  // A controller with no ported mob to drive it would ship as dead JSON referencing
  // animations that are not on any client entity, so nothing is synthesized.
  if (mobIds.length === 0) return { controllers, files, controllerIdsByOwner };

  for (const source of sources) {
    if (controllers.length >= MAX_SYNTHESIZED) break;
    const className = source.className?.trim();
    if (!className) continue;
    const key = `${source.kind}:${className}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ownerId = ownerFor(className, mobIds);
    if (!ownerId) continue;
    const tokens = tokensOf(className);
    const inherited = tokens
      .filter((token, index) => STATE_WORDS.includes(token) && tokens.indexOf(token) === index)
      .slice(0, 3)
      .map((token) => ({
        state: token,
        // Only real animation identifiers already in the pack are referenced.
        animation: animationIds.find((id) => id.toLowerCase().includes(token)) ?? 'idle',
      }));

    const controllerSlug = slugOf(tokens.join('_') || className);
    const controllerId = `controller.animation.${ownerId}.${controllerSlug}`;
    // Two Java classes can tokenize to the same slug; the second document would
    // overwrite the first at the same path, so the id is the dedupe key.
    if (controllers.some((existing) => existing.controllerId === controllerId)) continue;
    const { states, stateNames } = buildStates(ownerId, inherited);
    const filePath = `animation_controllers/${ownerId}.${controllerSlug}.animation_controllers.json`;

    const json = JSON.stringify(
      {
        format_version: '1.10.0',
        animation_controllers: {
          [controllerId]: { initial_state: 'default', states },
        },
      },
      null,
      2,
    );

    controllers.push({
      filePath,
      controllerId,
      ownerId,
      sourceClass: className,
      kind: source.kind,
      states: stateNames,
      json,
    });
    files[filePath] = json;
    const list = controllerIdsByOwner[ownerId] ?? [];
    if (!list.includes(controllerId)) list.push(controllerId);
    controllerIdsByOwner[ownerId] = list;
  }

  return { controllers, files, controllerIdsByOwner };
}