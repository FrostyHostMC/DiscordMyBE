import type { MobBehaviorProfile } from '@/utils/mobBehaviorProfiles';

/**
 * Evidence-based entity stat resolution.
 *
 * Health, movement speed and the collision box used to be one fixed profile written onto
 * every converted mob (30 HP, one speed, one 0.85x1.9 body), which the hardcoding audit
 * correctly reported. Each value is now resolved from, in order:
 *
 *   1. the mod's own attributes and entity dimensions (recovered from code/data);
 *   2. the cube volume of the geometry this conversion actually ships;
 *   3. the documented Bedrock default — reported per entity, never shared silently.
 *
 * A value that came from (3) is listed in `inferred` so the audit can show it as a
 * fallback for that specific entity instead of a universal profile.
 */

export const MOB_STAT_RULE =
  'Entity health, movement speed and collision box come from the mod own attributes, its entity dimensions or the recovered geometry. A documented Bedrock default is used only when no source evidence exists and is reported per entity.';

/** Documented Bedrock defaults, used only when the mod carries no evidence at all. */
const DEFAULT_HEALTH = 20;
const DEFAULT_MOVEMENT_SPEED = 0.25;

export interface MobBounds {
  width: number;
  height: number;
  depth: number;
}

export interface MobStatResolution {
  health: number;
  /** False when `health` is the documented default rather than a mod value. */
  healthDetected: boolean;
  movement: number;
  movementDetected: boolean;
  /** Null when neither source dimensions nor shipped geometry could supply one. */
  collisionBox: { width: number; height: number } | null;
  /** Components that fell back to a default, phrased for the diagnostic log. */
  inferred: string[];
  /** Components that came from real evidence, phrased for the diagnostic log. */
  evidence: string[];
}

const decoder = new TextDecoder();

function geometryText(json: string | Uint8Array | undefined): string | null {
  if (json == null) return null;
  if (typeof json === 'string') return json;
  try {
    return decoder.decode(json);
  } catch {
    return null;
  }
}

interface CubeLike {
  origin?: unknown;
  size?: unknown;
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.map((entry) => Number(entry)) : [];
}

interface GeometryDocLike {
  'minecraft:geometry'?: Array<{ bones?: Array<{ cubes?: CubeLike[] }> }>;
}

function parseGeometryDoc(text: string): GeometryDocLike | null {
  try {
    return JSON.parse(text) as GeometryDocLike;
  } catch {
    return null;
  }
}

/** Real cube volume of a shipped geometry document, in Bedrock blocks (16 units = 1). */
export function measureGeometryBounds(json: string | Uint8Array | undefined): MobBounds | null {
  const text = geometryText(json);
  if (!text || !text.includes('minecraft:geometry')) return null;
  const doc = parseGeometryDoc(text);
  if (!doc) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const variant of doc['minecraft:geometry'] ?? []) {
    for (const bone of variant.bones ?? []) {
      for (const cube of bone.cubes ?? []) {
        const origin = numbers(cube.origin);
        const size = numbers(cube.size);
        if (origin.length < 3 || size.length < 3) continue;
        const w = Math.abs(size[0]);
        const h = Math.abs(size[1]);
        const d = Math.abs(size[2]);
        if (w + h + d <= 0.1) continue;
        minX = Math.min(minX, origin[0]);
        maxX = Math.max(maxX, origin[0] + w);
        minY = Math.min(minY, origin[1]);
        maxY = Math.max(maxY, origin[1] + h);
        minZ = Math.min(minZ, origin[2]);
        maxZ = Math.max(maxZ, origin[2] + d);
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxY)) return null;
  return {
    width: (maxX - minX) / 16,
    height: (maxY - minY) / 16,
    depth: (maxZ - minZ) / 16,
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value * 100) / 100));

/**
 * Resolves one entity's stats from evidence. Never returns a shared fabricated profile:
 * every defaulted component is named in `inferred`, and a collision box with no evidence
 * at all is omitted so the engine's own 1x1 default applies.
 */
export function resolveMobStatProfile(input: {
  profile?: MobBehaviorProfile;
  geometryJson?: string | Uint8Array;
}): MobStatResolution {
  const { profile } = input;
  const inferred: string[] = [];
  const evidence: string[] = [];

  const healthDetected = Boolean(profile?.healthDetected && profile.health > 0);
  const health = healthDetected ? clamp(profile?.health ?? DEFAULT_HEALTH, 1, 2048) : DEFAULT_HEALTH;
  if (healthDetected) evidence.push(`health ${health} from ${profile?.sourceClasses[0] ?? 'mod code'}`);
  else inferred.push(`health ${DEFAULT_HEALTH} (documented default — no max-health value in the mod)`);

  const movementDetected = Boolean(profile?.movementDetected && profile.movementSpeed > 0);
  const movement = movementDetected
    ? clamp(profile?.movementSpeed ?? DEFAULT_MOVEMENT_SPEED, 0.05, 1)
    : DEFAULT_MOVEMENT_SPEED;
  if (movementDetected) evidence.push(`movement ${movement} from ${profile?.sourceClasses[0] ?? 'mod code'}`);
  else inferred.push(`movement ${DEFAULT_MOVEMENT_SPEED} (documented default — no movement speed in the mod)`);

  const dimensions = profile?.dimensions;
  if (profile?.dimensionsDetected && dimensions && dimensions.width > 0 && dimensions.height > 0) {
    evidence.push(
      `collision_box ${clamp(dimensions.width, 0.05, 3)}x${clamp(dimensions.height, 0.05, 4)} from ${profile.dimensionsEvidence ?? 'entity dimensions'}`,
    );
    return {
      health,
      healthDetected,
      movement,
      movementDetected,
      collisionBox: {
        width: clamp(dimensions.width, 0.05, 3),
        height: clamp(dimensions.height, 0.05, 4),
      },
      inferred,
      evidence,
    };
  }

  const bounds = measureGeometryBounds(input.geometryJson);
  if (bounds && bounds.height > 0.05) {
    const width = clamp(Math.max(bounds.width, bounds.depth), 0.05, 3);
    const height = clamp(bounds.height, 0.05, 4);
    evidence.push(`collision_box ${width}x${height} measured from the shipped geometry`);
    return {
      health,
      healthDetected,
      movement,
      movementDetected,
      collisionBox: { width, height },
      inferred,
      evidence,
    };
  }

  inferred.push(
    'collision_box omitted (no source dimensions and no shipped geometry) — the engine 1x1 default applies',
  );
  return { health, healthDetected, movement, movementDetected, collisionBox: null, inferred, evidence };
}