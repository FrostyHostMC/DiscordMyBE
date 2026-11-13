import { readPngDimensions, type PngSize } from '@/utils/pngUtils';
import { rebaseGeometryTexture } from '@/utils/modelPortEngine';
import type { MobBehaviorProfile } from '@/utils/mobBehaviorProfiles';
import { canonicalGeometryId } from '@/utils/geometryRegistry';
import type { MobResourceLink } from '@/utils/mobLinking';

type FileMap = Record<string, string | Uint8Array>;

interface CubeLike {
  origin?: number[];
  size?: number[];
}

interface GeometryVariant {
  description?: Record<string, unknown>;
  bones?: Array<{ name?: string; cubes?: CubeLike[] }>;
}

interface GeometryDoc {
  format_version?: string;
  'minecraft:geometry'?: GeometryVariant[];
}

interface Bounds {
  width: number;
  height: number;
  depth: number;
  minY: number;
  maxY: number;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function asText(value: string | Uint8Array | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function readClipIds(raw: string | Uint8Array | undefined): string[] {
  const text = asText(raw);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { animations?: Record<string, unknown> };
    return Object.keys(parsed.animations ?? {});
  } catch {
    return [];
  }
}

function parseGeometry(raw: string | Uint8Array | undefined): GeometryDoc | null {
  const text = asText(raw);
  if (!text || !text.includes('minecraft:geometry')) return null;
  try {
    const parsed = JSON.parse(text) as GeometryDoc;
    return Array.isArray(parsed['minecraft:geometry']) ? parsed : null;
  } catch {
    return null;
  }
}

/** Cubes with real volume — a geometry made only of flat planes renders invisible. */
function solidCubeCount(doc: GeometryDoc): number {
  let count = 0;
  for (const bone of doc['minecraft:geometry']?.[0]?.bones ?? []) {
    for (const cube of bone.cubes ?? []) {
      const size = cube.size ?? [];
      const volume =
        Math.abs(Number(size[0]) || 0) + Math.abs(Number(size[1]) || 0) + Math.abs(Number(size[2]) || 0);
      if (volume > 0.1) count++;
    }
  }
  return count;
}

function geometryBounds(doc: GeometryDoc): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const bone of doc['minecraft:geometry']?.[0]?.bones ?? []) {
    for (const cube of bone.cubes ?? []) {
      const origin = cube.origin ?? [];
      const size = cube.size ?? [];
      if (origin.length < 3 || size.length < 3) continue;
      const x = Number(origin[0]) || 0;
      const y = Number(origin[1]) || 0;
      const z = Number(origin[2]) || 0;
      const w = Math.abs(Number(size[0]) || 0);
      const h = Math.abs(Number(size[1]) || 0);
      const d = Math.abs(Number(size[2]) || 0);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + w);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + h);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z + d);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxY)) return null;
  return {
    width: (maxX - minX) / 16,
    height: (maxY - minY) / 16,
    depth: (maxZ - minZ) / 16,
    minY,
    maxY,
  };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Publishes exactly ONE geometry variant per file (Bedrock registers identifiers
 * globally, so duplicated aliases silently drop models), fits the visible bounds
 * to the real cube volume and re-bases every UV onto the pixel size of the skin
 * that is actually shipped in the pack.
 */
function shapeGeometry(doc: GeometryDoc, identifier: string, texSize: PngSize | null): string | null {
  const variant = doc['minecraft:geometry']?.[0];
  if (!variant) return null;
  const bones = variant.bones ?? [];
  const description: Record<string, unknown> = { ...(variant.description ?? {}), identifier };
  const single: GeometryDoc = {
    format_version: doc.format_version ?? '1.12.0',
    'minecraft:geometry': [{ description, bones }],
  };
  const bounds = geometryBounds(single);
  if (bounds) {
    description.visible_bounds_width = Math.max(1, round1(Math.max(bounds.width, bounds.depth) * 1.4));
    description.visible_bounds_height = Math.max(1, round1(bounds.height + 0.4));
    description.visible_bounds_offset = [0, round1((bounds.minY + bounds.maxY) / 32), 0];
  }

  let json = JSON.stringify(single, null, 2);
  if (texSize) {
    json = rebaseGeometryTexture(
      { id: identifier, json, source: 'geckolib', bonesCount: bones.length, cubesCount: solidCubeCount(single) },
      texSize.width,
      texSize.height,
    ).json;
  }
  return json;
}

/** Finds a recovered model whose file name drifted away from the mob identifier. */
function findGeometryPath(mobId: string, geoFiles: string[], files: FileMap): string | null {
  const target = norm(mobId);
  if (!target) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const path of geoFiles) {
    const base = norm(path.replace(/^models\/entity\//, '').replace(/\.geo\.json$/, ''));
    if (!base) continue;
    let score = 0;
    if (base === target) score = 100;
    else if (base.startsWith(target) || target.startsWith(base)) score = 80 - Math.min(Math.abs(base.length - target.length), 40);
    else if (base.includes(target) || target.includes(base)) score = 45;
    if (score <= bestScore) continue;
    const doc = parseGeometry(files[path]);
    if (!doc || solidCubeCount(doc) === 0) continue;
    best = path;
    bestScore = score;
  }
  return best;
}

function pickTextureBase(files: FileMap, mobId: string): string | null {
  for (const base of [`textures/entity/${mobId}`, `textures/entity/${mobId}/${mobId}`]) {
    if (files[`${base}.png`]) return base;
  }
  return null;
}

/**
 * Skin the mob's own renderer class declared, when that sheet really shipped into the
 * pack. Null means no class-declared sheet exists, so archive evidence decides instead.
 */
function linkedTextureBase(files: FileMap, link: MobResourceLink | undefined, mobId: string): string | null {
  const candidates: string[] = [];
  if (link?.texture) {
    const at = link.texture.lastIndexOf('textures/');
    if (at >= 0) candidates.push(link.texture.slice(at).replace(/\.png$/i, ''));
    candidates.push(link.texture.replace(/\.png$/i, ''));
  }
  candidates.push(`textures/entity/${mobId}`);
  for (const base of candidates) {
    if (files[`${base}.png`]) return base;
  }
  return null;
}

/** Sound events the shipped sound definitions really declare. */
function readSoundEventIds(json: unknown): Set<string> {
  const text = asText(json);
  if (!text) return new Set();
  try {
    const parsed = JSON.parse(text) as { sound_definitions?: Record<string, unknown> };
    return new Set(Object.keys(parsed.sound_definitions ?? {}));
  } catch {
    return new Set();
  }
}

/** Adds the AI components Bedrock needs, otherwise a spawned mob never moves or fights. */
function enrichBehavior(
  files: FileMap,
  path: string,
  modId: string,
  mobId: string,
  bounds: Bounds | null,
  profiles?: Record<string, MobBehaviorProfile>,
): string[] {
  const text = asText(files[path]);
  if (!text) return;
  let parsed: Record<string, any> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  const entity = parsed?.['minecraft:entity'];
  if (!entity) return;
  entity.description = entity.description ?? {};
  if (!entity.description.identifier) entity.description.identifier = `${modId}:${mobId}`;
  entity.description.is_spawnable = true;
  entity.description.is_summonable = true;
  const components = (entity.components = entity.components ?? {});
  const profile = profiles?.[mobId];

  const inferred: string[] = [];
  if (profile?.healthDetected) {
    components['minecraft:health'] = { value: profile.health, max: profile.health };
  }
  if (profile?.movementDetected) {
    components['minecraft:movement'] = { value: profile.movementSpeed };
  }

  if (profile && profile.attack !== 'none' && !profile.isDefault) {
    if (!components['minecraft:behavior.hurt_by_target']) {
      components['minecraft:behavior.hurt_by_target'] = { priority: 1, alert_same_type: true };
    }
    if (!components['minecraft:behavior.nearest_attackable_target']) {
      components['minecraft:behavior.nearest_attackable_target'] = {
        priority: 2,
        must_see: true,
        must_see_forget_duration: 3.0,
        entity_types: [{ filters: { test: 'is_family', subject: 'other', value: 'player' }, max_dist: 16 }],
      };
    }
    const ranged = Boolean(components['minecraft:shooter']) || profile.attack === 'ranged' || profile.attack === 'spell';
    if (ranged) {
      if (!components['minecraft:shooter']) {
        components['minecraft:shooter'] = { def: profile.projectileType ?? 'minecraft:arrow', aux_val: 0 };
      }
      if (!components['minecraft:behavior.ranged_attack']) {
        components['minecraft:behavior.ranged_attack'] = {
          priority: 3,
          attack_interval_min: 2,
          attack_interval_max: 3,
          attack_radius: 16,
        };
      }
    } else if (!components['minecraft:behavior.melee_attack']) {
      components['minecraft:behavior.melee_attack'] = { priority: 3, speed_multiplier: 1.25, track_target: true };
    }
    // Damage is written only when the mod's own code carried a value.
    if (profile.damageDetected) components['minecraft:attack'] = { damage: profile.damage };
    if (profile.isBoss && !components['minecraft:boss']) {
      const label = mobId.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      components['minecraft:boss'] = { name: label, hud_range: 128, should_darken_sky: true };
      components['minecraft:knockback_resistance'] = { value: 0.7 };
    }
  }


  if (bounds) {
    components['minecraft:collision_box'] = {
      width: Math.min(3, Math.max(0.4, round1(Math.max(bounds.width, bounds.depth)))),
      height: Math.min(4, Math.max(0.4, round1(bounds.height))),
    };
  }
  files[path] = JSON.stringify(parsed, null, 2);
  return inferred;
}

/**
 * Final export parity binder: guarantees every ported mob ships a renderable
 * geometry with a unique identifier, a skin that exists on disk, UVs re-based to
 * that skin's real resolution and the AI components needed to actually behave.
 */
export function bindMobParity(options: {
  modId: string;
  resourcePackFiles: FileMap;
  behaviorPackFiles: FileMap;
  profiles?: Record<string, MobBehaviorProfile>;
  /** Per-entity links read from the mod's own renderer/model classes. */
  links?: Map<string, MobResourceLink>;
  onLog?: (line: string) => void;
}): { mobs: number; rigged: number; rebased: number } {
  const { modId, resourcePackFiles: rp, behaviorPackFiles: bp, profiles, links, onLog } = options;
  const clientFiles = Object.keys(rp).filter((k) => /^entity\/[^/]+\.entity\.json$/.test(k));
  const geoFiles = Object.keys(rp).filter((k) => /^models\/entity\/.+\.geo\.json$/.test(k));
  const shippedSoundEvents = readSoundEventIds(rp['sounds/sound_definitions.json']);
  // Solid geometry that really shipped, richest first, so an entity with no file named
  // after it still receives a recovered model instead of a generated rig template.
  const geometryPool = geoFiles
    .map((path) => ({ path, doc: parseGeometry(rp[path]) }))
    .filter((entry): entry is { path: string; doc: GeometryDoc } => Boolean(entry.doc) && solidCubeCount(entry.doc) > 0)
    .sort((a, b) => solidCubeCount(b.doc) - solidCubeCount(a.doc));
  const boundGeometryPaths = new Set<string>();
  // Clip identifiers of every shipped animation document, keyed by file name.
  const animationDocs = Object.keys(rp)
    .filter((k) => /^animations\/.+\.json$/.test(k))
    .map((path) => ({ base: (path.split('/').pop() ?? '').toLowerCase(), clips: readClipIds(rp[path]) }));
  let mobs = 0;
  let rigged = 0;
  let rebased = 0;
  let entitiesWithoutSourceAi = 0;

  for (const clientPath of clientFiles) {
    const mobId = clientPath.slice('entity/'.length, -'.entity.json'.length);
    const clientText = asText(rp[clientPath]);
    if (!clientText) continue;
    let client: Record<string, any> = {};
    try {
      client = JSON.parse(clientText);
    } catch {
      continue;
    }
    const desc = client?.['minecraft:client_entity']?.description;
    if (!desc || typeof desc !== 'object') continue;

    // Link-first binding: the skin and the mesh this entity's own renderer/model
    // classes declared are the ones that ship for it.
    const link = links?.get(mobId);
    const texBase = linkedTextureBase(rp, link, mobId) ?? pickTextureBase(rp, mobId);
    const texSize = texBase ? readPngDimensions(rp[`${texBase}.png`] as Uint8Array) : null;

    const geoPath = `models/entity/${mobId}.geo.json`;
    let geometryOrigin = geoPath;
    let doc = parseGeometry(rp[geoPath]);
    if (!doc || solidCubeCount(doc) === 0) {
      const matchPath = findGeometryPath(mobId, geoFiles, rp);
      const matched = matchPath ? parseGeometry(rp[matchPath]) : null;
      doc = matched && solidCubeCount(matched) > 0 ? matched : null;
      if (matchPath) geometryOrigin = matchPath;
    }
    const identifier = canonicalGeometryId(modId, mobId || 'mob');
    const geometryJson = doc && solidCubeCount(doc) > 0 ? shapeGeometry(doc, identifier, texSize) : null;
    if (!geometryJson) {
      onLog?.(`[BIND] Mob "${mobId}" remains unbound — no source geometry exists; no replacement rig was generated.`);
      continue;
    }
    rp[geoPath] = geometryJson;
    boundGeometryPaths.add(geometryOrigin);
    if (texSize) rebased++;

    const bound = shapeGeometryBounds(geometryJson);
    desc.geometry = {
      ...(desc.geometry && typeof desc.geometry === 'object' ? desc.geometry : {}),
      default: identifier,
    };
    if (texBase) {
      desc.textures = {
        ...(desc.textures && typeof desc.textures === 'object' ? desc.textures : {}),
        default: texBase,
      };
    }
    const materials = desc.materials && typeof desc.materials === 'object' ? desc.materials : {};
    if (!materials.default) materials.default = 'entity_alphatest';
    desc.materials = materials;
    const controllers = Array.isArray(desc.render_controllers) ? desc.render_controllers : [];
    if (!controllers.includes('controller.render.default')) {
      desc.render_controllers = ['controller.render.default', ...controllers];
    }

    // Guarantee full animation and sound hooks so mobs never stand in T-pose or without audio
    const isMobFlying = Boolean(
      bp[`entities/${mobId}.json`] &&
      asText(bp[`entities/${mobId}.json`])?.includes('minecraft:movement.fly'),
    );
    const existingAnims = desc.animations && typeof desc.animations === 'object' ? desc.animations : {};
    desc.animations = {
      idle: `animation.${mobId}.idle`,
      walk: `animation.${mobId}.walk`,
      attack: `animation.${mobId}.attack`,
      hurt: `animation.${mobId}.hurt`,
      death: `animation.${mobId}.death`,
      ctrl: `controller.animation.${mobId}.general`,
      [`animation.${mobId}.idle`]: `animation.${mobId}.idle`,
      [`animation.${mobId}.walk`]: `animation.${mobId}.walk`,
      [`animation.${mobId}.attack`]: `animation.${mobId}.attack`,
      [`animation.${mobId}.hurt`]: `animation.${mobId}.hurt`,
      [`animation.${mobId}.death`]: `animation.${mobId}.death`,
      [`controller.animation.${mobId}.general`]: `controller.animation.${mobId}.general`,
      ...(isMobFlying
        ? {
            fly: `animation.${mobId}.fly`,
            [`animation.${mobId}.fly`]: `animation.${mobId}.fly`,
          }
        : {}),
      ...existingAnims,
    };
    if (!isMobFlying) {
      delete desc.animations.fly;
      delete desc.animations[`animation.${mobId}.fly`];
    }
    // Sound events are bound only when the pack really declares them. The sound converter
    // registers an event from real audio, so an event that does not ship is a dangling
    // reference and is never written speculatively.
    if (!desc.sound_effects || typeof desc.sound_effects !== 'object') {
      const candidates: Record<string, string> = {
        ambient: `${modId}.mob_ambient`,
        hurt: `${modId}.mob_hurt`,
        death: `${modId}.mob_death`,
        attack: `${modId}.weapon_swing`,
      };
      const boundEvents = Object.fromEntries(
        Object.entries(candidates).filter(([, event]) => shippedSoundEvents.has(event)),
      );
      if (Object.keys(boundEvents).length > 0) desc.sound_effects = boundEvents;
    }

    // Only reference clips and controllers that really ship in the pack. The five
    // template ids used to be written for every mob even when playable mode withheld
    // them, leaving dangling animation references in game.
    const shippedClips = new Set(readClipIds(rp[`animations/${mobId}.animation.json`]));
    // Animation documents named by the mob's own class, or filed under its name, are the
    // only extra clips that may be bound. Every other clip stays unbound.
    const linkedAnimationFiles = new Set(
      (link?.animations ?? []).map((path) => (path.split('/').pop() ?? '').toLowerCase()),
    );
    for (const document of animationDocs) {
      if (!document.base.includes(mobId) && !linkedAnimationFiles.has(document.base)) continue;
      for (const clip of document.clips) shippedClips.add(clip);
    }
    const hasGeneralController = Boolean(rp[`animation_controllers/${mobId}.animation_controllers.json`]);
    const boundAnims: Record<string, string> = {};
    for (const [key, value] of Object.entries(desc.animations as Record<string, string>)) {
      if (typeof value !== 'string') continue;
      if (value.startsWith('controller.')) {
        if (hasGeneralController || value !== `controller.animation.${mobId}.general`) boundAnims[key] = value;
        continue;
      }
      if (shippedClips.has(value)) boundAnims[key] = value;
    }
    const priorAnimate = Array.isArray(desc.scripts?.animate) ? desc.scripts.animate : [];
    const otherAnimate = priorAnimate.filter((a: string) => a !== 'ctrl' && a !== 'lighting');
    if (hasGeneralController) {
      boundAnims.ctrl = `controller.animation.${mobId}.general`;
      boundAnims[`controller.animation.${mobId}.general`] = `controller.animation.${mobId}.general`;
    }
    // `animations` and `scripts.animate` are OPTIONAL. When nothing shipped, the properties
    // are omitted entirely instead of being written as an empty object/array, which the
    // client schema rejects, and no clip that failed to ship is ever bound.
    if (Object.keys(boundAnims).length > 0) {
      desc.animations = boundAnims;
      // Every controller the entity declares must also be activated. A controller that is
      // registered in `animations` but never listed in `scripts.animate` is dead JSON: the mob
      // ships the state machine and never runs it, which produces no error in game.
      const controllerKeys = Object.entries(boundAnims)
        .filter(([key, value]) => value.startsWith('controller.animation.') && !key.includes('.'))
        .map(([key]) => key);
      const animate = [
        ...(hasGeneralController ? ['ctrl'] : []),
        ...otherAnimate,
        ...controllerKeys,
      ].filter((key: string, index: number, list: string[]) => key in boundAnims && list.indexOf(key) === index);
      const scripts = desc.scripts && typeof desc.scripts === 'object' ? desc.scripts : {};
      if (animate.length > 0) scripts.animate = animate;
      else delete scripts.animate;
      if (Object.keys(scripts).length > 0) desc.scripts = scripts;
      else delete desc.scripts;
    } else {
      delete desc.animations;
      if (desc.scripts && typeof desc.scripts === 'object') {
        delete desc.scripts.animate;
        if (Object.keys(desc.scripts).length === 0) delete desc.scripts;
      }
    }

    rp[clientPath] = JSON.stringify(client, null, 2);

    enrichBehavior(bp, `entities/${mobId}.json`, modId, mobId, bound, profiles);
    const profile = profiles?.[mobId];
    if (!profile || profile.isDefault) entitiesWithoutSourceAi++;
    mobs++;
  }

  if (mobs > 0) {
    onLog?.(
      `[BIND] Mob parity binder: ${mobs} source-backed entities audited (${rebased} UV sheets re-based, ${entitiesWithoutSourceAi} kept without invented AI, ${rigged} fallback rigs).`,
    );
  }
  return { mobs, rigged, rebased };
}

/** Collision-box source: the true cube volume of the geometry now shipped. */
function shapeGeometryBounds(json: string): Bounds | null {
  try {
    return geometryBounds(JSON.parse(json) as GeometryDoc);
  } catch {
    return null;
  }
}