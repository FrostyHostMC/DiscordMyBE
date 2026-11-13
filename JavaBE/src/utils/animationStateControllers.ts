/**
 * Animation-controller synthesis for states a Molang guard cannot separate.
 *
 * Two clips that drive the same bones under the same condition cannot both run: the engine blends
 * two poses of one joint set and the model deforms. The old resolver answered that by dropping one
 * activation, which produced the exact symptom this pass exists to remove — 17 of 27 registered
 * clips with no activation path at all.
 *
 * A Bedrock animation controller is the destination-native way to express that relationship: its
 * states are mutually exclusive by construction, transitions decide which one owns the pose, and
 * every clip stays a declared, selectable state instead of a definition nothing can reach.
 *
 * The machine is derived only from what the pack already carries — the clips' own tracks, their
 * source-translated conditions, and their lengths. Nothing is hardcoded per mod, per bone and per
 * clip name:
 *
 *   • states are ordered by the priority the state resolver measured (one-shot action > sprint /
 *     sneak / swim > movement > idle > overlay);
 *   • a state is reachable when its own condition holds and every higher-priority state's condition
 *     does not — mutual exclusivity without deleting a single clip;
 *   • clips that share an identical condition (genuine variants of one state, where the source
 *     carries no distinguishing signal) still stay reachable: they alternate by the current
 *     state's own `query.anim_time` against the clip's declared length. That is reported as an
 *     approximation, never presented as faithful.
 */

export interface StateMachineState {
  /** Key the entity uses for this clip in its `animations` map. */
  key: string;
  clipId: string;
  /** Molang condition translated from the source trigger; empty when none was recovered. */
  condition: string;
  priority: number;
  concept: string;
  /** Declared clip length in seconds (0 when the source did not state one). */
  length: number;
}

export interface StateControllerOutcome {
  controllerId: string;
  filePath: string;
  states: string[];
  clipIds: string[];
  /** Clips reachable only through the documented variant alternation. */
  staggered: string[];
  /** Clips the machine cannot select at all, with the reason. */
  unreachable: Array<{ clipId: string; reason: string }>;
  transitions: number;
}

type FileMap = Record<string, string | Uint8Array>;

const ALWAYS = 'query.anim_time >= 0';

function parseJson(raw: string | Uint8Array | undefined): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function safeId(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, '.')
    .replace(/^[.]+|[.]+$/g, '')
    .replace(/\.{2,}/g, '.') || 'aippy';
}

function uniqueKey(raw: string, taken: Set<string>): string {
  const base = safeId(raw).replace(/\./g, '_') || 'state';
  let candidate = base;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  taken.add(candidate);
  return candidate;
}

function normalizeCondition(condition: string): string {
  const trimmed = (condition ?? '').replace(/\s+/g, '').toLowerCase();
  return trimmed || ALWAYS;
}

function clipLength(document: Record<string, any> | undefined): number {
  const declared = Number(document?.animation_length ?? 0);
  if (Number.isFinite(declared) && declared > 0) return declared;
  // A looped clip without a declared length still needs a period the alternation can advance by.
  return 1;
}

export function synthesizeStateController(input: {
  resourcePackFiles: FileMap;
  entityDoc: Record<string, any>;
  description: Record<string, any>;
  entityIdentifier: string;
  modId: string;
  states: StateMachineState[];
  /** Clip bodies, so a state without a declared length can still be staggered. */
  clipDocs?: Record<string, Record<string, any>>;
  onLog?: (line: string) => void;
}): StateControllerOutcome | null {
  const log = (line: string) => input.onLog?.(line);
  const states = input.states.filter((state) => Boolean(state.clipId));
  if (states.length < 2) return null;

  const ordered = [...states].sort((a, b) => b.priority - a.priority || a.clipId.localeCompare(b.clipId));
  const takenKeys = new Set<string>(Object.keys(input.description.animations ?? {}));
  const stateNameOf = new Map<string, string>();
  for (const state of ordered) {
    stateNameOf.set(state.clipId, uniqueKey(state.clipId.split(/[.:/]+/).pop() ?? state.clipId, takenKeys));
  }

  // Groups of clips whose conditions are indistinguishable: the machine alternates them instead of
  // holding one permanently off.
  const groups = new Map<string, StateMachineState[]>();
  for (const state of ordered) {
    const key = normalizeCondition(state.condition);
    const list = groups.get(key) ?? [];
    list.push(state);
    groups.set(key, list);
  }

  const isAlwaysActive = (condition: string): boolean => (condition ?? '').trim() === '';
  const gateOf = (target: StateMachineState): string | null => {
    const own = (target.condition ?? '').trim() || ALWAYS;
    const parts: string[] = [`(${own})`];
    for (const higher of ordered) {
      if (higher === target) continue;
      if (higher.priority <= target.priority) continue;
      const higherCondition = normalizeCondition(higher.condition);
      const sameGroup = higherCondition === normalizeCondition(target.condition);
      if (sameGroup) continue;
      // A permanently-active higher state can only be left by a variant of itself.
      if (isAlwaysActive(higher.condition)) return null;
      parts.push(`!(${(higher.condition ?? '').trim() || ALWAYS})`);
    }
    return parts.join(' && ');
  };

  const staggered: string[] = [];
  const unreachable: Array<{ clipId: string; reason: string }> = [];
  const transitionsByState = new Map<string, Array<Record<string, string>>>();

  for (const state of ordered) {
    const name = stateNameOf.get(state.clipId) as string;
    const group = groups.get(normalizeCondition(state.condition)) ?? [state];
    const outgoing: Array<Record<string, string>> = [];
    for (const other of ordered) {
      if (other === state) continue;
      const otherName = stateNameOf.get(other.clipId) as string;
      if (group.includes(other)) {
        // Variants of one state: alternate on this state's own elapsed time so both play.
        const period = Math.max(0.05, clipLength(input.clipDocs?.[state.clipId]));
        outgoing.push({ [otherName]: `query.anim_time >= ${period.toFixed(2)}` });
        if (!staggered.includes(other.clipId)) staggered.push(other.clipId);
        continue;
      }
      const gate = gateOf(other);
      if (!gate) continue;
      outgoing.push({ [otherName]: gate });
    }
    transitionsByState.set(name, outgoing);
  }

  // A state nothing transitions into can never be selected, so it is reported rather than shipped
  // as if it were playable.
  const reachableNames = new Set<string>([stateNameOf.get(ordered[0].clipId) as string]);
  for (const [, outgoing] of transitionsByState) {
    for (const transition of outgoing) for (const target of Object.keys(transition)) reachableNames.add(target);
  }
  for (const state of ordered) {
    const name = stateNameOf.get(state.clipId) as string;
    if (reachableNames.has(name)) continue;
    unreachable.push({
      clipId: state.clipId,
      reason: 'every higher-priority state is permanently active, so the machine has no condition that can select this state',
    });
  }

  const entityShort = safeId(input.entityIdentifier.split(':').pop() ?? input.entityIdentifier).replace(/\./g, '_');
  const namespace = safeId(input.modId);
  const controllerId = `controller.animation.${namespace}.${entityShort}.states`;
  const filePath = `animation_controllers/${entityShort}.states.animation_controllers.json`;

  const machine: Record<string, unknown> = {
    initial_state: stateNameOf.get(ordered[0].clipId) as string,
    states: Object.fromEntries(
      ordered.map((state) => {
        const name = stateNameOf.get(state.clipId) as string;
        const outgoing = transitionsByState.get(name) ?? [];
        return [
          name,
          {
            animations: [state.key],
            ...(outgoing.length > 0 ? { transitions: outgoing } : {}),
          },
        ];
      }),
    ),
  };

  const existing = parseJson(input.resourcePackFiles[filePath]);
  if (existing) {
    const root = existing.animation_controllers && typeof existing.animation_controllers === 'object'
      ? (existing.animation_controllers as Record<string, unknown>)
      : {};
    root[controllerId] = machine;
    existing.animation_controllers = root;
    input.resourcePackFiles[filePath] = JSON.stringify(existing, null, 2);
  } else {
    input.resourcePackFiles[filePath] = JSON.stringify(
      { format_version: '1.10.0', animation_controllers: { [controllerId]: machine } },
      null,
      2,
    );
  }

  const description = input.description;
  if (!description.animations || typeof description.animations !== 'object') description.animations = {};
  if (!description.scripts || typeof description.scripts !== 'object') description.scripts = {};
  const animations = description.animations as Record<string, string>;
  const animate: unknown[] = Array.isArray(description.scripts.animate)
    ? (description.scripts.animate as unknown[])
    : [];
  const controllerKey = uniqueKey(`${entityShort}_states`, new Set(Object.keys(animations)));
  animations[controllerKey] = controllerId;
  // The controller itself is always active; its states decide which clip owns the pose, which is
  // what keeps the clips mutually exclusive without removing any of them.
  if (!animate.some((entry) => entry === controllerKey)) animate.push(controllerKey);
  description.scripts.animate = animate;

  log(
    `[ANIM:CTRL] ${input.entityIdentifier}: ${ordered.length} clip(s) that could not be separated by a Molang guard now share animation controller "${controllerId}" — each clip is a state, transitions order them by priority, so all of them stay selectable${staggered.length > 0 ? `; ${staggered.length} variant(s) alternate on state-local time and are reported as an approximation` : ''}.`,
  );
  for (const entry of unreachable) {
    log(`[ANIM:CTRL:UNREACHABLE] ${input.entityIdentifier}: ${entry.clipId} — ${entry.reason}.`);
  }

  return {
    controllerId,
    filePath,
    states: ordered.map((state) => stateNameOf.get(state.clipId) as string),
    clipIds: ordered.map((state) => state.clipId),
    staggered,
    unreachable,
    transitions: [...transitionsByState.values()].reduce((total, list) => total + list.length, 0),
  };
}