/**
 * Generic Java behaviour signal detectors used by the Behaviour Translation Engine.
 *
 * Every pattern is mechanism-generic: nothing here is keyed on a mod, entity, item, block,
 * texture or file name, so exactly the same rules run on any imported mod.
 */

export type BedrockEntityTrigger =
  | 'minecraft:on_hurt'
  | 'minecraft:on_death'
  | 'minecraft:on_target_acquired';

export interface EntityTriggerSignal {
  /** Real Bedrock entity trigger component that fires a named event. */
  component: BedrockEntityTrigger;
  /** Mechanism label used as evidence text in the report. */
  label: string;
}

interface TriggerPattern {
  component: BedrockEntityTrigger;
  label: string;
  pattern: RegExp;
}

const TRIGGER_PATTERNS: TriggerPattern[] = [
  { component: 'minecraft:on_hurt', label: 'hurt handler', pattern: /\b(?:onhurt|hurtby|ondamage|damagetaken|hurt)\b/i },
  { component: 'minecraft:on_death', label: 'death handler', pattern: /\b(?:ondeathby|ondeath|deathtime|die)\b/i },
  { component: 'minecraft:on_target_acquired', label: 'target-selection handler', pattern: /\b(?:setattacktarget|settarget|getattacktarget|ontargetacquired)\b/i },
];

/** Event handlers detected in a class body, mapped to the Bedrock triggers they correspond to. */
export function detectEntityTriggers(text: string): EntityTriggerSignal[] {
  if (!text) return [];
  return TRIGGER_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map(({ component, label }) => ({ component, label }));
}

export interface BlockInteractionSignals {
  place: boolean;
  destroy: boolean;
  interact: boolean;
  container: boolean;
}

/** Placement, destruction, right-click and container logic detected on a block class. */
export function detectBlockInteraction(text: string): BlockInteractionSignals {
  if (!text) return { place: false, destroy: false, interact: false, container: false };
  return {
    place: /\b(?:onblockplacedby|onplaced|setblockstate|placeblock)\b/i.test(text),
    destroy: /\b(?:playerwilldestroy|onblockdestroyedby|ondestroyedby|dropresources)\b/i.test(text),
    interact: /\b(?:onblockactivated|onplayerinteract|useon|rightclick|blockuse)\b/i.test(text),
    container: /\b(?:container|iinventory|menutype|openmenu|abstractcontainer)\b/i.test(text),
  };
}

/** Status/mob effect application logic (Java MobEffect / status-effect API). */
export function detectEffectLogic(text: string): boolean {
  return /\b(?:applyeffect|addeffect|mobeffect|potioneffect|statuseffect|effectinstance)\b/i.test(text);
}

/** Equipment or armour attachment logic declared by a class. */
export function detectEquipmentLogic(text: string): boolean {
  return /\b(?:setitemslot|equipmentslot|armoritem|setiteminhand|helditem|getequipmentslot)\b/i.test(text);
}

/**
 * Cooldown / use-duration ticks declared by the mod itself.
 * Returns null when the mod declares none, so no cooldown is ever invented.
 */
export function detectCooldownTicks(text: string): number | null {
  const match = text.match(/(?:cooldown|useduration|use_duration)\D{0,12}(\d{1,6})/i);
  if (!match) return null;
  const ticks = Number.parseInt(match[1], 10);
  if (!Number.isFinite(ticks) || ticks < 1 || ticks > 72000) return null;
  return ticks;
}