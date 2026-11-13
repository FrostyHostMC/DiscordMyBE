import type { RemakeItem } from '@/types/remaker';

type PackFiles = Record<string, string | Uint8Array>;
type JsonDoc = Record<string, any>;

const SCRIPT_PATH = 'scripts/behaviors.js';
const MAIN_SCRIPT_PATH = 'scripts/main.js';
const IMPORT_LINE = "import './behaviors.js';";
const BINDING_MARKER = 'javabe_item_behaviour_bindings';

/** Bedrock projectile entities a detected Java projectile can be mapped onto. */
const BEDROCK_PROJECTILES: Record<string, { entity: string; exact: boolean }> = {
  'minecraft:arrow': { entity: 'minecraft:arrow', exact: true },
  'minecraft:spectral_arrow': { entity: 'minecraft:arrow', exact: false },
  'minecraft:tipped_arrow': { entity: 'minecraft:arrow', exact: false },
  'minecraft:snowball': { entity: 'minecraft:snowball', exact: true },
  'minecraft:egg': { entity: 'minecraft:egg', exact: true },
  'minecraft:ender_pearl': { entity: 'minecraft:ender_pearl', exact: true },
  'minecraft:small_fireball': { entity: 'minecraft:small_fireball', exact: true },
  'minecraft:fireball': { entity: 'minecraft:fireball', exact: true },
  'minecraft:wither_skull': { entity: 'minecraft:wither_skull', exact: true },
  'minecraft:trident': { entity: 'minecraft:thrown_trident', exact: false },
  'minecraft:splash_potion': { entity: 'minecraft:snowball', exact: false },
  'minecraft:lingering_potion': { entity: 'minecraft:snowball', exact: false },
};

export interface EmittedItemComponent {
  item: string;
  file: string;
  component: string;
}

export interface EmittedScriptBinding {
  /** Qualified Bedrock identifier used by the script binding. */
  item: string;
  /** Short item id, so the mapping can be traced back to its shipped definition. */
  itemId: string;
  projectile: string;
  approximated: boolean;
  evidence: string;
  note: string;
}

export interface ItemBehaviorEmission {
  componentFiles: string[];
  scriptFiles: string[];
  components: EmittedItemComponent[];
  bindings: EmittedScriptBinding[];
  skipped: Array<{ item: string; reason: string }>;
}

function readDoc(pack: PackFiles, path: string): JsonDoc | null {
  const raw = pack[path];
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as JsonDoc;
  } catch {
    return null;
  }
}

/**
 * Writes the item components the mod's own evidence supports and that the shipped item
 * definition does not declare yet. Only real Bedrock item components are used, and only
 * values the source supplied (a cooldown tick count, an armour slot) are written.
 */
export function applyItemBehaviorComponents(
  pack: PackFiles,
  items: RemakeItem[],
): { files: string[]; components: EmittedItemComponent[] } {
  const files: string[] = [];
  const components: EmittedItemComponent[] = [];

  for (const item of items) {
    const profile = item.behaviorProfile;
    if (!profile) continue;
    const path = `items/${item.id}.json`;
    const doc = readDoc(pack, path);
    const host = doc?.['minecraft:item'] as { components?: JsonDoc } | undefined;
    if (!doc || !host) continue;
    const target = (host.components = host.components ?? {});
    let changed = false;

    if (profile.cooldownTicks > 0 && !target['minecraft:cooldown']) {
      const ranged = profile.kind === 'projectile' || profile.kind === 'spell';
      target['minecraft:cooldown'] = {
        category: ranged ? 'weapon' : 'item',
        duration: Math.max(0.05, Math.round((profile.cooldownTicks / 20) * 100) / 100),
      };
      components.push({ item: item.id, file: path, component: 'minecraft:cooldown' });
      changed = true;
    }

    if (profile.kind === 'armor' && !target['minecraft:wearable']) {
      const slot = item.slot === 'head'
        ? 'slot.armor.head'
        : item.slot === 'legs'
          ? 'slot.armor.legs'
          : item.slot === 'feet'
            ? 'slot.armor.feet'
            : 'slot.armor.chest';
      target['minecraft:wearable'] = { slot };
      components.push({ item: item.id, file: path, component: 'minecraft:wearable' });
      changed = true;
    }

    if (changed) {
      pack[path] = JSON.stringify(doc, null, 2);
      if (!files.includes(path)) files.push(path);
    }
  }

  return { files, components };
}

function buildScript(bindings: EmittedScriptBinding[]): string {
  const table = bindings
    .map((binding) => `  { item: ${JSON.stringify(binding.item)}, projectile: ${JSON.stringify(binding.projectile)}, fallbackImpulse: 1.5 }`)
    .join(',\n');
  return [
    '// Item behaviour bindings generated from the imported Java mod evidence.',
    "// ADAPTED: the use trigger and the projectile mapping come from the mod's own",
    '// bytecode/data. In-game behaviour has NOT been verified and must be tested in a',
    '// live Bedrock client.',
    "import { world } from '@minecraft/server';",
    '',
    'const ITEM_BINDINGS = [',
    table,
    '];',
    '',
    'world.afterEvents.itemUse.subscribe((event) => {',
    '  const binding = ITEM_BINDINGS.find((entry) => entry.item === event.itemStack?.typeId);',
    '  if (!binding) return;',
    '  const player = event.source;',
    "  if (!player || player.typeId !== 'minecraft:player') return;",
    '  try {',
    '    const direction = player.getViewDirection();',
    '    const head = player.getHeadLocation();',
    '    const origin = {',
    '      x: head.x + direction.x * 0.5,',
    '      y: head.y + direction.y * 0.5,',
    '      z: head.z + direction.z * 0.5,',
    '    };',
    '    const projectile = player.dimension.spawnEntity(binding.projectile, origin);',
    "    const shot = projectile.getComponent('minecraft:projectile');",
    '    if (shot) {',
    '      shot.shoot(direction, { uncertainty: 0 });',
    '    } else {',
    '      // The mapped projectile declares no minecraft:projectile component, so a',
    '      // documented fallback impulse is used instead of inventing launch physics.',
    '      projectile.applyImpulse({',
    '        x: direction.x * binding.fallbackImpulse,',
    '        y: direction.y * binding.fallbackImpulse,',
    '        z: direction.z * binding.fallbackImpulse,',
    '      });',
    '    }',
    '  } catch (error) {',
    "    console.warn('[javabe] item behaviour binding failed for ' + binding.item);",
    '  }',
    '});',
    '',
  ].join('\n');
}

/**
 * Emits the runtime module that actually fires the projectile/spell behaviour detected in the
 * imported Java item, and registers it as an import of the shipped entry script. When no
 * Bedrock projectile corresponds to the source projectile nothing is written — the item is
 * reported instead of being given an invented behaviour.
 */
export function emitItemBehaviorScript(
  pack: PackFiles,
  modId: string,
  items: RemakeItem[],
): ItemBehaviorEmission {
  const bindings: EmittedScriptBinding[] = [];
  const skipped: Array<{ item: string; reason: string }> = [];

  for (const item of items) {
    const profile = item.behaviorProfile;
    if (!profile || (profile.kind !== 'projectile' && profile.kind !== 'spell')) continue;
    const source = String(profile.projectileType ?? '').toLowerCase();
    const mapped = BEDROCK_PROJECTILES[source];
    if (!mapped) {
      skipped.push({
        item: item.id,
        reason: `the detected projectile "${source || 'unknown'}" has no Bedrock projectile entity, so no runtime binding was generated`,
      });
      continue;
    }
    bindings.push({
      item: `${modId}:${item.id}`,
      itemId: item.id,
      projectile: mapped.entity,
      approximated: !mapped.exact,
      evidence: profile.evidence[0] ?? `${profile.confidence} projectile signature`,
      note: mapped.exact
        ? `Use trigger bound to ${mapped.entity} from the item's own projectile evidence.`
        : `Use trigger bound to ${mapped.entity}, a Bedrock substitute for ${source}.`,
    });
  }

  if (bindings.length === 0) {
    return { componentFiles: [], scriptFiles: [], components: [], bindings, skipped };
  }

  const entry = pack[MAIN_SCRIPT_PATH];
  if (typeof entry !== 'string') {
    skipped.push({
      item: '*',
      reason: 'the behaviour pack ships no scripts/main.js entry module, so the trigger bindings could not be registered',
    });
    return { componentFiles: [], scriptFiles: [], components: [], bindings: [], skipped };
  }

  pack[SCRIPT_PATH] = buildScript(bindings);
  if (!entry.includes(IMPORT_LINE)) {
    pack[MAIN_SCRIPT_PATH] = `${entry.trimEnd()}\n\n// ${BINDING_MARKER}\n${IMPORT_LINE}\n`;
  }

  return {
    componentFiles: [],
    scriptFiles: [SCRIPT_PATH, MAIN_SCRIPT_PATH],
    components: [],
    bindings,
    skipped,
  };
}