/**
 * Destination-platform contract for the vanilla player rig.
 *
 * A resource pack that ships `entity/player.entity.json` REPLACES the whole vanilla file, so
 * every baseline animation, controller and document that file points at has to keep resolving
 * afterwards. This module is the single record of what the destination engine already provides for
 * `minecraft:player` — the equivalent of a table of contents for the engine's own resources.
 *
 * Nothing here is mod-specific: these identifiers are part of Bedrock's contract, exactly like the
 * render controllers and the `geometry.humanoid.*` skeleton. A conversion never invents them; it
 * either preserves the reference or reports that it cannot be resolved.
 */

export type PlayerBaselineKind = 'animation' | 'controller';

export interface PlayerBaselineEntry {
  /** Short alias the vanilla entity declares in its `animations` map. */
  alias: string;
  /** Identifier the alias resolves to in the vanilla resource set. */
  identifier: string;
  kind: PlayerBaselineKind;
  /** Molang gate the vanilla file applies to this entry, or null when it always plays. */
  gate: string | null;
  /** False for compatibility aliases resolved by a controller rather than played directly. */
  animate?: boolean;
}

/** Gate Bedrock uses to keep hand/first-person resources out of the third-person body. */
export const FIRST_PERSON_GATE = 'query.is_first_person';

/**
 * Player-scope variables required by the vanilla player animation contract.
 *
 * These expressions are based on Mojang's published Bedrock player resources. They are
 * restored into the player entity because a custom player.entity.json replaces the vanilla
 * script scope along with its animation map.
 */
/**
 * Variables supplied by the Bedrock engine itself. Mojang's published entity resources
 * read these without declaring them in entity scripts, so the resolver must not synthesize
 * a constant or report them as missing player-scope assignments.
 */
export const ENGINE_PROVIDED_MOLANG_VARIABLES = new Set<string>([
  'gliding_speed_value',
]);

export const PLAYER_SCOPE_VARIABLE_EXPRESSIONS: Record<string, {
  expression: string;
  evidence: string;
  always?: boolean;
  initializeExpression?: string;
}> = {
  tcos0: {
    expression: '(math.cos(query.modified_distance_moved * 38.17) * query.modified_move_speed / variable.gliding_speed_value) * 57.3',
    evidence: 'Mojang bedrock-samples resource_pack/entity/player.entity.json pre_animation expression',
    always: true,
  },
  melee_spear_equipped: {
    expression: "query.equipped_item_any_tag('slot.weapon.mainhand', 'minecraft:is_spear')",
    evidence: 'Mojang Bedrock spear item definitions carry the minecraft:is_spear tag; the documented equipped_item_any_tag query detects every spear material without hardcoding one item id',
    always: true,
  },
  // Serious Player Animations 1.1.1 derives these from per-tick position and body-yaw deltas.
  spa_move_speed: {
    expression: 'math.sqrt(math.pow(query.position_delta(0), 2.0) + math.pow(query.position_delta(2), 2.0))',
    evidence: 'SeriousPlayerAnimationsMixin.animate(): moveSpeed = sqrt(vx*vx + vz*vz), with vx/vz from current minus previous player position',
  },
  spa_moving_backwards: {
    expression: '(variable.spa_move_speed > 0.0) && ((query.position_delta(0) * math.cos((query.body_y_rotation + 90.0) * 0.01745329252) + query.position_delta(2) * math.sin((query.body_y_rotation + 90.0) * 0.01745329252)) < 0.0)',
    evidence: 'SeriousPlayerAnimationsMixin.animate(): movementVector.dot(lookVector) < 0',
  },
  spa_turn_delta: {
    expression: 'query.body_y_rotation - variable.spa_previous_body_yaw',
    evidence: 'SeriousPlayerAnimationsMixin.animate(): turn = bodyYaw - prevbyaw',
  },
  spa_previous_body_yaw: {
    expression: 'query.body_y_rotation',
    initializeExpression: '0.0',
    evidence: 'SeriousPlayerAnimationsMixin initializes prevbyaw to 0 and updates it to bodyYaw after each tick',
  },
};

/**
 * Baseline wiring of `minecraft:player`. `base_pose` builds the rest pose, `look_at_target`
 * rotates the head, the first-person entries only exist in first person, and `root` is the
 * controller every other pose is layered under.
 */
export const PLAYER_BASELINE_ENTRIES: PlayerBaselineEntry[] = [
  // `base_pose` is retained as a compatibility alias for older/generated player
  // controllers, but it resolves to the real vanilla humanoid base-pose animation.
  { alias: 'base_pose', identifier: 'animation.humanoid.base_pose', kind: 'animation', gate: null, animate: false },
  { alias: 'humanoid_base_pose', identifier: 'animation.humanoid.base_pose', kind: 'animation', gate: null },
  // The vanilla player maps look_at_target to a controller, not an animation clip.
  { alias: 'look_at_target', identifier: 'controller.animation.humanoid.look_at_target', kind: 'controller', gate: null },
  { alias: 'cape', identifier: 'animation.player.cape', kind: 'animation', gate: null },
  { alias: 'root', identifier: 'controller.animation.player.root', kind: 'controller', gate: null },
  {
    alias: 'first_person_base_pose',
    identifier: 'animation.player.first_person.base_pose',
    kind: 'animation',
    gate: FIRST_PERSON_GATE,
  },
  {
    alias: 'first_person_attack_controller',
    identifier: 'controller.animation.player.first_person_attack',
    kind: 'controller',
    gate: FIRST_PERSON_GATE,
  },
];

/** Alias -> identifier map every player definition must declare. */
export const VANILLA_PLAYER_ANIMATIONS: Record<string, string> = Object.fromEntries(
  PLAYER_BASELINE_ENTRIES.map((entry) => [entry.alias, entry.identifier]),
);

/** The vanilla player runs its root controller; that controller layers the remaining aliases. */
export const VANILLA_PLAYER_ANIMATE: Array<string | Record<string, string>> = ['root'];

/** Animation identifiers the base game defines for the player/humanoid rig. */
export const VANILLA_PLAYER_ANIMATION_IDS = new Set<string>(
  PLAYER_BASELINE_ENTRIES.filter((entry) => entry.kind === 'animation').map((entry) => entry.identifier),
);

/** Controller identifiers the base game defines for the player rig. */
export const VANILLA_PLAYER_CONTROLLER_IDS = new Set<string>(
  PLAYER_BASELINE_ENTRIES.filter((entry) => entry.kind === 'controller').map((entry) => entry.identifier),
);

/** Render controllers the engine already ships for `minecraft:player`. */
export const VANILLA_PLAYER_RENDER_CONTROLLER_IDS = new Set<string>([
  'controller.render.player.first_person',
  'controller.render.player.third_person',
  'controller.render.player.cape',
  'controller.render.player.armor',
  'controller.render.player.map',
]);

/** Player geometries the engine already provides; a ported skin rig may reuse them. */
export const VANILLA_PLAYER_GEOMETRY_IDS = new Set<string>([
  'geometry.humanoid.custom',
  'geometry.humanoid.customSlim',
  'geometry.cape',
  'geometry.player.armor',
]);

/**
 * Documents the vanilla resource set owns. A conversion that writes to one of these paths
 * silently deletes the engine's own definitions, which is how a pack ends up reporting
 * "missing base_pose / look_at_target / first_person_base_pose" while it ships animation files.
 */
export const VANILLA_PLAYER_DOCUMENT_PATHS = new Set<string>([
  'entity/player.entity.json',
  'animations/player.animation.json',
  'animations/humanoid.animation.json',
  'animation_controllers/player.animation_controllers.json',
  'animation_controllers/humanoid.animation_controllers.json',
  'render_controllers/player.render_controllers.json',
]);

/** Identifiers whose absence breaks first-person rendering outright. */
export const FIRST_PERSON_BASELINE_IDS = new Set<string>(
  PLAYER_BASELINE_ENTRIES.filter((entry) => entry.gate === FIRST_PERSON_GATE).map((entry) => entry.identifier),
);

/**
 * The shipped client-entity document that really defines `minecraft:player`.
 *
 * A port may write the player definition under a generated file name, so locating it by path alone
 * reports "no player client entity ships" while the archive really contains one — and every pass
 * that depends on it (baseline wiring, variable declaration, perspective binding) silently does
 * nothing. The identifier is the contract; the path is only a fallback.
 */
export function findPlayerClientEntityPath(files: Record<string, string | Uint8Array>): string | null {
  let fallback: string | null = null;
  for (const [path, raw] of Object.entries(files)) {
    if (typeof raw !== 'string' || !/\.entity\.json$/i.test(path)) continue;
    if (path.toLowerCase() === 'entity/player.entity.json') fallback = path;
    try {
      const doc = JSON.parse(raw) as Record<string, unknown>;
      const client = doc['minecraft:client_entity'] as Record<string, unknown> | undefined;
      const description = client?.description as Record<string, unknown> | undefined;
      if (description?.identifier === 'minecraft:player') return path;
    } catch {
      // Malformed documents are reported by the pack validation stage.
    }
  }
  return fallback;
}

export function isVanillaPlayerDocumentPath(path: string): boolean {
  return VANILLA_PLAYER_DOCUMENT_PATHS.has(path.toLowerCase());
}

export function isVanillaPlayerBaselineIdentifier(identifier: string): boolean {
  return VANILLA_PLAYER_ANIMATION_IDS.has(identifier) || VANILLA_PLAYER_CONTROLLER_IDS.has(identifier);
}

export function isFirstPersonBaselineIdentifier(identifier: string): boolean {
  return FIRST_PERSON_BASELINE_IDS.has(identifier);
}