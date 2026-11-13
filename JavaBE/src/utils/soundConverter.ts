import type { PackFile } from '@/utils/entityTextureVariants';

/**
 * Universal Java → Bedrock sound converter.
 *
 * Two different things used to be written into `sounds/sound_definitions.json`: real audio
 * files, and Java sound *event identifiers* such as `mob.zombie.say`. Bedrock resolves a
 * `sounds` entry as an extensionless sound NAME inside the pack's `sounds/` folder, so an
 * event identifier produces an invalid asset path, and a name that keeps its `.ogg`
 * extension produces a second one. This module keeps the two concepts apart and validates
 * every entry against a real container header before it is registered.
 */

export type AudioContainer = 'ogg' | 'wav' | 'mp3';

export const SOUND_RULE =
  'A Bedrock sound_definitions entry references an extensionless sound NAME resolved inside sounds/. A Java sound EVENT identifier (mob.zombie.say) is not a file path and must be mapped to an engine sound or reported as unsupported.';

/** Bedrock reads the container from the file, so the definition carries no extension. */
export function detectAudioContainer(data: Uint8Array | undefined): AudioContainer | null {
  if (!data || data.length < 12) return null;
  const tag = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (tag === 'OggS') return 'ogg';
  if (tag === 'RIFF' && String.fromCharCode(data[8], data[9], data[10], data[11]) === 'WAVE') return 'wav';
  if (tag.startsWith('ID3')) return 'mp3';
  if (data[0] === 0xff && (data[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
}

/** Containers the Bedrock sound engine can decode from a resource pack. */
const PLAYABLE_CONTAINERS: AudioContainer[] = ['ogg', 'wav'];

const BEDROCK_SOUND_CATEGORIES = new Set([
  'ambient',
  'block',
  'hostile',
  'music',
  'neutral',
  'player',
  'record',
  'ui',
  'weather',
]);

/**
 * Java vanilla sound events that resolve to an engine sound name. Only entries listed
 * here are treated as supported; anything else is reported, never guessed.
 */
export const JAVA_EVENT_TO_BEDROCK_SOUND: Record<string, string> = {
  'entity.zombie.ambient': 'mob/zombie/say',
  'entity.zombie.hurt': 'mob/zombie/hurt',
  'entity.zombie.death': 'mob/zombie/death',
  'entity.irongolem.hit': 'mob/irongolem/hit',
  'entity.irongolem.death': 'mob/irongolem/death',
  'entity.irongolem.step': 'mob/irongolem/walk',
  'entity.player.hurt': 'damage/hit',
  'entity.player.hurt_drown': 'damage/hit',
  'entity.player.attack.sweep': 'random/sweep',
  'entity.player.levelup': 'random/levelup',
  'entity.arrow.shoot': 'random/bow',
  'entity.item.pickup': 'random/pop',
  'entity.generic.explode': 'random/explode_1',
  'entity.generic.eat': 'random/eat',
  'block.stone.break': 'dig/stone',
  'random.levelup': 'random/levelup',
  'random.orb': 'random/orb',
  'random.pop': 'random/pop',
  'ambient.weather.thunder': 'ambient/weather/thunder',
  'ambient.weather.rain': 'ambient/weather/rain',
  'ui.button.click': 'random/click',
};

/** Resolves a Java sound event id (dotted, optionally namespaced) to an engine sound name. */
export function resolveJavaSoundEvent(eventId: string): string | null {
  const clean = eventId.trim().replace(/^minecraft:/i, '').toLowerCase();
  if (!clean) return null;
  const direct = JAVA_EVENT_TO_BEDROCK_SOUND[clean];
  if (direct) return direct;
  // `mob.zombie.say` and `mob/zombie/say` name the same engine sound.
  const dotted = clean.replace(/\//g, '.');
  return JAVA_EVENT_TO_BEDROCK_SOUND[dotted] ?? null;
}

/** True when a definition entry is a Java event identifier rather than a sound name. */
export function isJavaEventIdentifier(name: string): boolean {
  return !name.includes('/') && /\.[a-z0-9_]+$/i.test(name) && !/\.(ogg|wav|mp3|fsb)$/i.test(name);
}

export interface SoundArchiveEntry {
  path: string;
  data: Uint8Array;
}

const decoder = new TextDecoder();

/**
 * Collects the sound EVENT identifiers declared by the mod's own `sounds.json` files.
 * A `sounds.json` key is an event id; the entries under it are audio references. Both are
 * candidates, because a Java mod may point an event at a vanilla sound instead of a file.
 */
export function collectJavaSoundEventIds(entries: SoundArchiveEntry[]): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    const path = entry.path.replace(/\\/g, '/').toLowerCase();
    if (!/\/sounds\.json$/.test(path)) continue;
    if (!path.includes('/assets/')) continue;
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(decoder.decode(entry.data)) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!doc || typeof doc !== 'object') continue;
    for (const [eventId, value] of Object.entries(doc)) {
      ids.add(eventId);
      const list = value && typeof value === 'object' ? (value as { sounds?: unknown[] }).sounds : null;
      for (const item of Array.isArray(list) ? list : []) {
        const name = typeof item === 'string' ? item : (item as { name?: unknown })?.name;
        if (typeof name === 'string' && name.length > 0) ids.add(name);
      }
    }
  }
  return [...ids];
}

export interface BuiltSoundPack {
  /** Files to write into the resource pack, keyed by pack path. */
  files: Record<string, Uint8Array>;
  definitions: Record<string, unknown> | null;
  shipped: string[];
  unsupported: string[];
  invalidPaths: string[];
  notes: string[];
}

interface SoundEventDefinition {
  category?: string;
  sounds: unknown[];
}

const STANDARD_EVENT_MATCHERS: Array<{ event: string; pattern: RegExp; category: string }> = [
  { event: 'mob_ambient', pattern: /ambient|idle|say|voice|growl|chirp/i, category: 'neutral' },
  { event: 'mob_fly', pattern: /fly|flying|flap|wing/i, category: 'neutral' },
  { event: 'mob_hurt', pattern: /hurt|hit|damage|pain/i, category: 'hostile' },
  { event: 'mob_death', pattern: /death|die|dead/i, category: 'hostile' },
  { event: 'weapon_swing', pattern: /swing|attack|slash|swoosh/i, category: 'player' },
  { event: 'magic_cast', pattern: /cast|spell|magic|arcane/i, category: 'player' },
];

/**
 * Converts the archive's audio files into Bedrock sound definitions.
 *
 * - The real container is read from the file header, not from the file name, so a WAV
 *   payload named `.ogg` is stored under its decodable extension.
 * - The definition carries an extensionless `<modId>/<stem>` name.
 * - A Java event identifier is mapped through the table above or reported unsupported.
 */
export function buildArchiveSoundPack(input: {
  modId: string;
  entries: SoundArchiveEntry[];
  javaEventIds?: string[];
  onLog?: (line: string) => void;
}): BuiltSoundPack {
  const { modId, entries } = input;
  const files: Record<string, Uint8Array> = {};
  const definitions: Record<string, SoundEventDefinition> = {};
  const shipped: string[] = [];
  const unsupported: string[] = [];
  const invalidPaths: string[] = [];
  const notes: string[] = [];
  const stems: Array<{ stem: string; name: string }> = [];

  for (const entry of entries) {
    const cleanPath = entry.path.replace(/\\/g, '/');
    const lower = cleanPath.toLowerCase();
    if (!/\.(ogg|wav|mp3|fsb)$/.test(lower)) continue;
    const container = detectAudioContainer(entry.data);
    const fileStem = cleanPath.split('/').pop()?.replace(/\.(ogg|wav|mp3|fsb)$/i, '') ?? '';
    const soundSafeName = fileStem.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!soundSafeName) {
      invalidPaths.push(`${cleanPath} (no usable sound name)`);
      continue;
    }
    if (!container) {
      invalidPaths.push(`${cleanPath} (no readable OG G/WAV/MP3 container header)`);
      continue;
    }
    if (!PLAYABLE_CONTAINERS.includes(container)) {
      // Bedrock cannot decode MP3 from a pack, and no transcoder ships here: the file is
      // reported instead of being registered as a silent, unplayable asset.
      unsupported.push(`${cleanPath} (${container.toUpperCase()} container is not decodable by Bedrock)`);
      continue;
    }
    const packPath = `sounds/${modId}/${soundSafeName}.${container}`;
    files[packPath] = entry.data;
    shipped.push(packPath);
    const name = `${modId}/${soundSafeName}`;
    definitions[`${modId}.${soundSafeName}`] = { category: 'neutral', sounds: [name] };
    stems.push({ stem: soundSafeName, name });
  }

  // Standard entity/weapon events the client entity binds, created only from real audio.
  for (const matcher of STANDARD_EVENT_MATCHERS) {
    const match = stems.find((entry) => matcher.pattern.test(entry.stem));
    if (!match) continue;
    definitions[`${modId}.${matcher.event}`] = {
      category: BEDROCK_SOUND_CATEGORIES.has(matcher.category) ? matcher.category : 'neutral',
      sounds: [match.name],
    };
  }

  // Java sound events: an event backed by the mod's own audio binds to that file; an engine
  // event binds to a documented Bedrock sound; anything else is reported, never guessed.
  for (const eventId of input.javaEventIds ?? []) {
    const key = `${modId}.${eventId.replace(/^minecraft:/i, '').replace(/[^a-z0-9.]+/gi, '_')}`;
    if (definitions[key]) continue;
    const lower = eventId.toLowerCase().replace(/^minecraft:/, '');
    const own = stems.find((entry) =>
      lower.endsWith(entry.stem) || lower.endsWith(entry.stem.replace(/_/g, '.')),
    );
    if (own) {
      definitions[key] = { category: 'neutral', sounds: [own.name] };
      continue;
    }
    const resolved = resolveJavaSoundEvent(eventId);
    if (!resolved) {
      unsupported.push(`${eventId} (no equivalent Bedrock sound event)`);
      continue;
    }
    definitions[key] = { category: 'neutral', sounds: [resolved] };
  }

  if (shipped.length > 0) {
    input.onLog?.(
      `[SOUND] ${shipped.length} audio file(s) registered with extensionless Bedrock sound names (real container read from the file header).`,
    );
  } else {
    notes.push('No decodable audio file in the archive — no custom sound event was defined.');
  }
  for (const invalid of invalidPaths.slice(0, 4)) {
    input.onLog?.(`[SOUND:WARN] Skipped ${invalid}.`);
  }
  for (const event of unsupported.slice(0, 4)) {
    input.onLog?.(`[SOUND:UNSUPPORTED] ${event}.`);
  }

  return {
    files,
    definitions: Object.keys(definitions).length > 0
      ? { format_version: '1.14.0', sound_definitions: definitions }
      : null,
    shipped,
    unsupported,
    invalidPaths,
    notes,
  };
}

export interface SoundSanitizeResult {
  namesFixed: number;
  definitionsRemoved: number;
  unsupportedEvents: string[];
  invalidPaths: string[];
  touched: boolean;
}

function shippedSoundName(files: Record<string, PackFile>, name: string): boolean {
  return PLAYABLE_CONTAINERS.some((container) => Boolean(files[`sounds/${name}.${container}`]));
}

/**
 * Validates the sound definitions that are about to ship: strips file extensions, refuses
 * Java event identifiers used as paths, and drops a reference whose audio file is absent.
 */
export function sanitizeSoundDefinitions(
  files: Record<string, PackFile>,
  options?: { onLog?: (line: string) => void },
): SoundSanitizeResult {
  const result: SoundSanitizeResult = {
    namesFixed: 0,
    definitionsRemoved: 0,
    unsupportedEvents: [],
    invalidPaths: [],
    touched: false,
  };
  const raw = files['sounds/sound_definitions.json'];
  if (typeof raw !== 'string') return result;
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    result.invalidPaths.push('sounds/sound_definitions.json (unreadable JSON)');
    return result;
  }
  const definitions = doc.sound_definitions as Record<string, SoundEventDefinition> | undefined;
  if (!definitions || typeof definitions !== 'object') return result;

  for (const [eventId, definition] of Object.entries(definitions)) {
    if (!definition || typeof definition !== 'object' || !Array.isArray(definition.sounds)) {
      delete definitions[eventId];
      result.definitionsRemoved += 1;
      continue;
    }
    const kept: unknown[] = [];
    for (const entry of definition.sounds) {
      const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
      const rawName = record ? String(record.name ?? '') : String(entry ?? '');
      if (!rawName) continue;
      let name = rawName;
      if (/\.(ogg|wav|mp3|fsb)$/i.test(name)) {
        name = name.replace(/\.(ogg|wav|mp3|fsb)$/i, '');
        result.namesFixed += 1;
      }
      if (isJavaEventIdentifier(name)) {
        const resolved = resolveJavaSoundEvent(name);
        if (!resolved) {
          result.unsupportedEvents.push(`${eventId} → ${name}`);
          continue;
        }
        name = resolved;
        result.namesFixed += 1;
      }
      // A name this pack must provide has to resolve to a real audio file.
      const localNamespace = eventId.split('.')[0];
      if (name.startsWith(`${localNamespace}/`) && !shippedSoundName(files, name)) {
        result.invalidPaths.push(`${eventId} → ${name} (file not shipped)`);
        continue;
      }
      kept.push(record ? { ...record, name } : name);
    }
    if (kept.length === 0) {
      delete definitions[eventId];
      result.definitionsRemoved += 1;
    } else {
      definition.sounds = kept;
      if (!definition.category || !BEDROCK_SOUND_CATEGORIES.has(definition.category)) {
        definition.category = 'neutral';
      }
    }
  }

  files['sounds/sound_definitions.json'] = JSON.stringify(doc, null, 2);
  result.touched =
    result.namesFixed > 0 || result.definitionsRemoved > 0 || result.invalidPaths.length > 0;
  if (result.namesFixed > 0 || result.definitionsRemoved > 0) {
    options?.onLog?.(
      `[SCHEMA] sound_definitions.json: ${result.namesFixed} sound name(s) normalised to extensionless names, ${result.definitionsRemoved} empty/unusable definition(s) removed, ${result.invalidPaths.length} reference(s) without audio.`,
    );
  }
  return result;
}