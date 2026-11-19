import type { ExtractedZipEntry } from '@/utils/zip';
import { generateEggColors } from '@/utils/bedrockIds';

/**
 * Spawn egg policy.
 *
 * Bedrock derives a mob's spawn egg from its client entity: `spawn_egg.base_color` and
 * `spawn_egg.overlay_color` belong in `minecraft:client_entity.description`. A standalone
 * item with `minecraft:entity_placer` is a *second*, duplicate egg and hand-drawn egg art is
 * never authentic.
 *
 * The two colours are read from the mod's own Java registration (`new SpawnEggItem(entity,
 * base, overlay, …)` / `ForgeSpawnEggItem`). Bytecode keeps those as integer constants in the
 * class constant pool, which is parsed here. When no registration colour can be recovered the
 * egg colours are reported UNRESOLVED — generated colours are only used with Playable Mode on,
 * where they are INVENTED content.
 */

type PackFiles = Record<string, string | Uint8Array>;

const decoder = new TextDecoder();
// Only matching registration-bearing classes consume this generous safety ceiling.
const MAX_CLASSES = 10_000;

export interface SpawnEggRegistration {
  mobId: string;
  base: string;
  overlay: string;
  source: string;
}

export interface SpawnEggPolicyReport {
  registrations: number;
  coloursApplied: string[];
  coloursInvented: string[];
  coloursUnresolved: string[];
  spawnableEntitiesEnabled: string[];
  standaloneEggItemsRemoved: number;
  eggArtRemoved: number;
  behaviourSpawnEggSynced: number;
  log: string[];
}

function compactKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Attributes one text blob — a registration snippet, a class constant pool, a file path — to
 * exactly one target mob. The longest target identity wins, so a subclass name cannot be donated
 * to its base mob, and a blob that names two different targets at the same depth is treated as
 * ambiguous and contributes nothing rather than guessing.
 */
function matchMob(text: string, mobIds: string[]): string | null {
  if (!text || mobIds.length === 0) return null;
  const haystack = compactKey(text);
  if (haystack.length === 0) return null;
  let best: string | null = null;
  let bestLength = 0;
  let ambiguous = false;
  for (const mobId of mobIds) {
    const needle = compactKey(mobId.split(':').pop() ?? mobId);
    if (needle.length < 3 || !haystack.includes(needle)) continue;
    if (needle.length > bestLength) {
      best = mobId;
      bestLength = needle.length;
      ambiguous = false;
    } else if (needle.length === bestLength && best !== null && best !== mobId) {
      ambiguous = true;
    }
  }
  return ambiguous ? null : best;
}

function hexColour(raw: string): string | null {
  const hex = raw.match(/0x([0-9a-fA-F]{1,6})/);
  if (hex) return `#${hex[1].padStart(6, '0').toUpperCase()}`;
  const dec = raw.match(/\b(\d{4,8})\b/);
  if (!dec) return null;
  const value = Number(dec[1]);
  if (!Number.isFinite(value) || value < 0 || value > 0xffffff) return null;
  return `#${value.toString(16).padStart(6, '0').toUpperCase()}`;
}

/** Colours that a class holds, in constant-pool order (base written before overlay). */
function coloursFromConstants(ints: number[]): { base: string; overlay: string } | null {
  const seen: number[] = [];
  for (const value of ints) {
    if (value < 0x1000 || value > 0xffffff) continue;
    if (seen.includes(value)) continue;
    seen.push(value);
    if (seen.length === 2) break;
  }
  if (seen.length < 2) return null;
  const toHex = (value: number) => `#${value.toString(16).padStart(6, '0').toUpperCase()}`;
  return { base: toHex(seen[0]), overlay: toHex(seen[1]) };
}

/** Minimal class constant-pool reader: UTF-8 strings and integer constants only. */
function readConstantPool(data: Uint8Array): { utf8: string[]; ints: number[] } | null {
  if (data.length < 12) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  try {
    if (view.getUint32(0) !== 0xcafebabe) return null;
    const count = view.getUint16(8);
    let offset = 10;
    const utf8: string[] = [];
    const ints: number[] = [];
    for (let index = 1; index < count; index += 1) {
      const tag = view.getUint8(offset);
      offset += 1;
      if (tag === 1) {
        const length = view.getUint16(offset);
        offset += 2;
        utf8.push(decoder.decode(data.subarray(offset, offset + length)));
        offset += length;
      } else if (tag === 3) {
        ints.push(view.getInt32(offset));
        offset += 4;
      } else if (tag === 5 || tag === 6) {
        offset += 8;
        index += 1;
      } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) {
        offset += 2;
      } else if (tag === 15) {
        offset += 3;
      } else if (tag === 4 || (tag >= 9 && tag <= 12) || tag === 17 || tag === 18) {
        offset += 4;
      } else {
        return { utf8, ints };
      }
    }
    return { utf8, ints };
  } catch {
    return null;
  }
}

function containsAscii(data: Uint8Array, value: string): boolean {
  const first = value.charCodeAt(0);
  for (let start = 0; start <= data.length - value.length; start += 1) {
    if (data[start] !== first) continue;
    let matches = true;
    for (let offset = 1; offset < value.length; offset += 1) {
      if (data[start + offset] !== value.charCodeAt(offset)) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

/**
 * Recovers spawn egg colours from the mod's own registration code. Only a class or source file
 * that really mentions `SpawnEggItem` contributes, and the colours are attributed to one mob
 * only when exactly one target identity is present.
 */
export function scanSpawnEggRegistrations(options: {
  entries: ExtractedZipEntry[];
  mobIds: string[];
}): Map<string, SpawnEggRegistration> {
  const found = new Map<string, SpawnEggRegistration>();
  let scanned = 0;
  for (const entry of options.entries) {
    const path = entry.path.replace(/\\/g, '/');
    const lower = path.toLowerCase();
    if (lower.endsWith('.java')) {
      if (!containsAscii(entry.data, 'SpawnEggItem')) continue;
      if (scanned >= MAX_CLASSES) break;
      scanned += 1;
      const text = decoder.decode(entry.data);
      for (const call of text.matchAll(/(?:Forge)?SpawnEggItem\s*\(([^;]{0,400}?)\)/g)) {
        const args = call[1] ?? '';
        const literals = [...args.matchAll(/0x[0-9a-fA-F]{1,6}|\b\d{4,8}\b/g)].map((m) => m[0]);
        if (literals.length < 2) continue;
        const base = hexColour(literals[0]);
        const overlay = hexColour(literals[1]);
        if (!base || !overlay) continue;
        const mobId = matchMob(args, options.mobIds) ?? matchMob(path, options.mobIds);
        if (!mobId || found.has(mobId)) continue;
        found.set(mobId, { mobId, base, overlay, source: `${path} (Java registration)` });
      }
      continue;
    }
    if (!lower.endsWith('.class') || entry.data.length > 600_000) continue;
    if (!containsAscii(entry.data, 'SpawnEggItem')) continue;
    if (scanned >= MAX_CLASSES) break;
    const pool = readConstantPool(entry.data);
    if (!pool || !pool.utf8.some((value) => value.includes('SpawnEggItem'))) continue;
    scanned += 1;
    const colours = coloursFromConstants(pool.ints);
    if (!colours) continue;
    const identity = [path, ...pool.utf8].join(' ');
    const mobId = matchMob(identity, options.mobIds);
    if (!mobId || found.has(mobId)) continue;
    found.set(mobId, { mobId, base: colours.base, overlay: colours.overlay, source: `${path} (registration constants)` });
  }
  return found;
}

function hasSpawnEggAppearance(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const egg = value as Record<string, unknown>;
  const colourEgg = typeof egg.base_color === 'string' && typeof egg.overlay_color === 'string';
  const textureEgg = typeof egg.texture === 'string' && egg.texture.trim().length > 0 &&
    (egg.texture_index === undefined || (Number.isInteger(egg.texture_index) && Number(egg.texture_index) >= 0));
  return colourEgg || textureEgg;
}

function parseJson(raw: string | Uint8Array | undefined): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    return null;
  }
}

/**
 * Enforces the spawn egg rules on a generated pack: no standalone egg item, no drawn egg art,
 * and registration colours written into each spawned mob's client entity.
 */
export function applySpawnEggPolicy(options: {
  entries: ExtractedZipEntry[];
  resourcePackFiles: PackFiles;
  behaviorPackFiles: PackFiles;
  playableMode: boolean;
  onLog?: (line: string) => void;
}): SpawnEggPolicyReport {
  const { resourcePackFiles: rp, behaviorPackFiles: bp } = options;
  const report: SpawnEggPolicyReport = {
    registrations: 0,
    coloursApplied: [],
    coloursInvented: [],
    coloursUnresolved: [],
    spawnableEntitiesEnabled: [],
    standaloneEggItemsRemoved: 0,
    eggArtRemoved: 0,
    behaviourSpawnEggSynced: 0,
    log: [],
  };
  const log = (line: string) => {
    report.log.push(line);
    options.onLog?.(line);
  };

  // 1. Client entities are the mobs the game can spawn.
  const clientByMob = new Map<
    string,
    { path: string; doc: Record<string, any>; description: Record<string, any> }
  >();
  const mobIds: string[] = [];
  for (const key of Object.keys(rp)) {
    if (!/^entity\/.+\.entity\.json$/i.test(key)) continue;
    const doc = parseJson(rp[key]);
    const description = doc?.['minecraft:client_entity']?.description;
    if (!doc || !description || typeof description.identifier !== 'string') continue;
    const mobId = description.identifier.split(':').pop() ?? '';
    if (!mobId) continue;
    clientByMob.set(mobId, { path: key, doc, description: description as Record<string, any> });
    mobIds.push(mobId);
  }

  const behaviorByMob = new Map<string, {
    path: string;
    doc: Record<string, any>;
    description: Record<string, any>;
  }>();
  for (const [path, raw] of Object.entries(bp)) {
    if (!/^entities\/.+\.json$/i.test(path)) continue;
    const doc = parseJson(raw);
    const description = doc?.['minecraft:entity']?.description;
    const identifier = description?.identifier;
    if (!doc || !description || typeof identifier !== 'string') continue;
    const mobId = identifier.split(':').pop() ?? '';
    if (!mobId) continue;
    behaviorByMob.set(compactKey(mobId), { path, doc, description });
  }

  // 2. Registration evidence from the mod's own code.
  const registrations = scanSpawnEggRegistrations({ entries: options.entries, mobIds });
  report.registrations = registrations.size;
  if (registrations.size > 0) {
    log(
      `[SPAWN-EGG] ${registrations.size} spawn egg registration(s) recovered from the mod's Java code — colours are taken from that registration, never generated.`,
    );
  } else if (mobIds.length > 0) {
    log('[SPAWN-EGG] No spawn egg registration colour was recovered from the mod\'s code; egg colours stay UNRESOLVED rather than generated.');
  }

  // 3. Remove a standalone egg only when the client entity can genuinely provide one.
  // A mere client-entity file is not enough: it needs recovered registration colours,
  // an existing valid spawn_egg declaration, or explicit Playable Mode invention.
  const removedArt = new Set<string>();
  const removedIconKeys = new Set<string>();
  const canGenerateEggForMob = (mobId: string, client: { description: Record<string, any> }): boolean =>
    registrations.has(mobId) || hasSpawnEggAppearance(client.description.spawn_egg) || options.playableMode;

  for (const key of Object.keys(bp)) {
    if (!/^items\\/.+\\.json$/i.test(key)) continue;
    const doc = parseJson(bp[key]);
    const body = doc?.['minecraft:item'];
    const components = body?.components ?? {};
    if (!components['minecraft:entity_placer']) continue;
    const itemId = String(body?.description?.identifier ?? '').split(':').pop() || key.replace(/^items\\/|\\.json$/gi, '');
    const placer = components['minecraft:entity_placer'] as { entity?: unknown } | undefined;
    const placedRaw = typeof placer?.entity === 'string' ? placer.entity : '';
    const placedMob = placedRaw ? compactKey(placedRaw.split(':').pop() ?? placedRaw) : '';
    const target = [...clientByMob.entries()].find(([mob]) => compactKey(mob) === placedMob);
    const autoEggExists = Boolean(target && canGenerateEggForMob(target[0], target[1]));
    if (!autoEggExists) {
      log(
        `[SPAWN-EGG] Kept standalone spawn egg item "${itemId}" — the target has no recovered or declared client-entity egg, so removing it would remove the only spawn item.`,
      );
      continue;
    }
    removedIconKeys.add(itemId);
    delete bp[key];
    report.standaloneEggItemsRemoved += 1;
    log(
      `[SPAWN-EGG] Removed standalone spawn egg item "${itemId}" — the client entity has a valid or recovered egg appearance.`,
    );
  }

  const autoEggTextureStems = new Set<string>(removedIconKeys);
  for (const [mobId, client] of clientByMob) {
    if (canGenerateEggForMob(mobId, client)) autoEggTextureStems.add(`${mobId}_spawn_egg`);
  }
  for (const key of Object.keys(rp)) {
    if (!/^textures\\/.+\\.png$/i.test(key)) continue;
    const stem = key.slice(0, -4).split('/').pop() ?? '';
    if (!autoEggTextureStems.has(stem)) continue;
    delete rp[key];
    removedArt.add(key);
    report.eggArtRemoved += 1;
  }
  const atlasRaw = rp['textures/item_texture.json'];
  const atlas = parseJson(atlasRaw);
  const data = atlas?.texture_data as Record<string, { textures?: string | string[] }> | undefined;
  if (data) {
    let changed = false;
    for (const [name, entry] of Object.entries(data)) {
      if (autoEggTextureStems.has(name) || removedIconKeys.has(name)) {
        delete data[name];
        changed = true;
        continue;
      }
      const list = Array.isArray(entry.textures) ? entry.textures : [entry.textures ?? ''];
      const alive = list.filter((texture) => {
        if (!texture) return false;
        const stem = texture.split('/').pop() ?? '';
        return !autoEggTextureStems.has(stem) && !removedArt.has(`${texture}.png`);
      });
      if (alive.length === list.length) continue;
      changed = true;
      if (alive.length === 0) delete data[name];
      else entry.textures = alive.length === 1 ? alive[0] : alive;
    }
    if (changed) rp['textures/item_texture.json'] = JSON.stringify(atlas, null, 2);
  }
  if (report.eggArtRemoved > 0) {
    log(`[SPAWN-EGG] Removed ${report.eggArtRemoved} duplicate egg texture(s) across texture folders and pruned their atlas entries.`);
  }

  // 4. Keep source registration as the authority. In normal mode, never invent
  // colours or make a mob spawnable when the Java mod did not register an egg.
  for (const mobId of mobIds) {
    const client = clientByMob.get(mobId);
    if (!client) continue;
    const description = client.description;
    const registration = registrations.get(mobId);
    const behavior = behaviorByMob.get(compactKey(mobId));
    const existing = description.spawn_egg;

    if (registration) {
      description.spawn_egg = { base_color: registration.base, overlay_color: registration.overlay };
      report.coloursApplied.push(mobId);
      if (behavior) {
        behavior.description.is_spawnable = true;
        behavior.description.is_summonable = true;
        report.spawnableEntitiesEnabled.push(mobId);
      }
      log(`[SPAWN-EGG] Mob "${mobId}" uses recovered Java registration colours ${registration.base} / ${registration.overlay}.`);
      continue;
    }

    if (hasSpawnEggAppearance(existing)) {
      report.coloursApplied.push(mobId);
      if (behavior) {
        behavior.description.is_spawnable = true;
        behavior.description.is_summonable = true;
        report.spawnableEntitiesEnabled.push(mobId);
      }
      log(`[SPAWN-EGG] Mob "${mobId}" keeps its existing valid client-entity spawn egg declaration.`);
      continue;
    }

    if (options.playableMode) {
      const colours = generateEggColors(mobId);
      description.spawn_egg = { base_color: colours.base, overlay_color: colours.overlay };
      report.coloursInvented.push(mobId);
      if (behavior) {
        behavior.description.is_spawnable = true;
        behavior.description.is_summonable = true;
        report.spawnableEntitiesEnabled.push(mobId);
      }
      log(`[SPAWN-EGG] Mob "${mobId}" receives Playable Mode invented colours ${colours.base} / ${colours.overlay}; these are not source-recovered values.`);
      continue;
    }

    if (existing !== undefined) {
      delete description.spawn_egg;
      log(`[SPAWN-EGG] Removed invalid/incomplete spawn_egg declaration for "${mobId}"; no complete source appearance was recovered.`);
    }
    report.coloursUnresolved.push(mobId);
    log(`[SPAWN-EGG] Mob "${mobId}" has no Java egg registration or valid client-entity egg; no colours or spawnability were invented.`);
  }
  for (const behavior of behaviorByMob.values()) {
    // Spawn-egg appearance belongs only to minecraft:client_entity.description.
    // The behavior entity owns is_spawnable/is_summonable, not a spawn_egg object.
    if (Object.prototype.hasOwnProperty.call(behavior.description, 'spawn_egg')) {
      delete behavior.description.spawn_egg;
    }
    bp[behavior.path] = JSON.stringify(behavior.doc, null, 2);
  }
  for (const client of clientByMob.values()) {
    rp[client.path] = JSON.stringify(client.doc, null, 2);
  }

  for (const behavior of behaviorByMob.values()) {
    bp[behavior.path] = JSON.stringify(behavior.doc, null, 2);
  }
  for (const client of clientByMob.values()) {
    rp[client.path] = JSON.stringify(client.doc, null, 2);
  }

  return report;
}
