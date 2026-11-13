/**
 * Bedrock trigger-hook emitters for the Behaviour Translation Engine.
 *
 * Writes only real Bedrock trigger components (`minecraft:on_hurt`, `minecraft:on_death`,
 * `minecraft:on_target_acquired` on entities and `minecraft:on_player_placing`,
 * `minecraft:on_player_destroyed` on blocks) bound to a declared, empty event. The hook is
 * structure only: no gameplay response is generated, because the Java handler bodies have
 * no data-driven Bedrock equivalent. Every emitter is idempotent so the bounded repair loop
 * can re-run this stage safely.
 */

type PackFiles = Record<string, string | Uint8Array>;

interface JsonDoc {
  [key: string]: unknown;
}

interface ComponentHost {
  components: Record<string, unknown>;
  events: Record<string, unknown>;
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

function writeDoc(pack: PackFiles, path: string, doc: JsonDoc): void {
  pack[path] = JSON.stringify(doc, null, 2);
}

function componentHost(doc: JsonDoc, key: 'minecraft:entity' | 'minecraft:block'): ComponentHost | null {
  const host = doc[key] as { components?: Record<string, unknown>; events?: Record<string, unknown> } | undefined;
  if (!host) return null;
  return {
    components: (host.components = host.components ?? {}),
    events: (host.events = host.events ?? {}),
  };
}

/** Adds an entity trigger component bound to an empty event, unless one already exists. */
export function ensureEntityTrigger(pack: PackFiles, path: string, component: string, eventName: string): boolean {
  const doc = readDoc(pack, path);
  if (!doc) return false;
  const host = componentHost(doc, 'minecraft:entity');
  if (!host) return false;
  if (host.components[component]) return false;
  host.components[component] = { event: eventName, target: 'self' };
  if (!host.events[eventName]) host.events[eventName] = { sequence: [] };
  writeDoc(pack, path, doc);
  return true;
}

/** Adds a block placement/destruction trigger component bound to an empty block event. */
export function ensureBlockTrigger(
  pack: PackFiles,
  path: string,
  component: 'minecraft:on_player_placing' | 'minecraft:on_player_destroyed',
  eventName: string,
): boolean {
  const doc = readDoc(pack, path);
  if (!doc) return false;
  const host = componentHost(doc, 'minecraft:block');
  if (!host) return false;
  if (host.components[component]) return false;
  host.components[component] = { event: eventName };
  if (!host.events[eventName]) host.events[eventName] = { sequence: [] };
  writeDoc(pack, path, doc);
  return true;
}