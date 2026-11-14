import type { DecompileClassSummary } from '@/types/remaker';

export type MobBehaviorConfidence = 'bytecode-signature' | 'data-signature' | 'name-inferred' | 'default';
export type MobAttackKind = 'melee' | 'ranged' | 'spell' | 'none';

export interface MobBehaviorProfile {
  attack: MobAttackKind;
  disposition: 'hostile' | 'neutral' | 'passive';
  trading: boolean;
  damage: number;
  /** False whenever `damage` is not backed by a detected value from the mod. */
  damageDetected: boolean;
  xpReward: number;
  xpDetected: boolean;
  health: number;
  healthDetected: boolean;
  /** Movement speed recovered from the mod's own code (`setMovementSpeed(0.32)`). */
  movementSpeed: number;
  movementDetected: boolean;
  isBoss: boolean;
  /** Flight/levitation behaviour evidence found in the mod's own code. */
  flyingDetected: boolean;
  spawnDetected: boolean;
  spawnEvidence: string | null;
  lootDetected: boolean;
  lootEvidence: string | null;
  /** Entity dimensions recovered from the mod's own code (`setSize(w, h)`, EntityDimensions). */
  dimensions?: { width: number; height: number };
  dimensionsDetected: boolean;
  dimensionsEvidence: string | null;
  projectileType?: 'minecraft:arrow' | 'minecraft:snowball';
  areaOfEffect: boolean;
  homing: boolean;
  charge: boolean;
  summon: boolean;
  statusEffect?: 'poison' | 'slowness' | 'weakness' | 'wither';
  confidence: MobBehaviorConfidence;
  isDefault: boolean;
  sourceClasses: string[];
  evidence: string[];
}

export interface MobEvidenceSources {
  /** Every file path inside the imported archive — used for spawn/loot evidence only. */
  archivePaths?: string[];
}

const NOISE = new Set(['entity', 'mob', 'boss', 'living', 'base', 'abstract', 'client', 'server', 'controller', 'animation']);
const DEFAULT_HEALTH = 20;
/** Documented Bedrock default ground movement speed, used only without source evidence. */
const DEFAULT_MOVEMENT_SPEED = 0.25;
const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .split(/[^a-zA-Z0-9]+/).map((part) => part.toLowerCase())
  .filter((part) => part.length > 2 && !NOISE.has(part));
const stem = (value: string) => value.endsWith('s') && value.length > 4 ? value.slice(0, -1) : value;

function matchScore(mobId: string, className: string): number {
  const mob = compact(mobId);
  const cls = compact(className);
  if (mob.length >= 4 && cls.includes(mob)) return 8;
  const classWords = words(className).map(stem);
  return words(mobId).map(stem).filter((word) => classWords.some((entry) =>
    entry === word || entry.startsWith(word) && word.length > 4 || word.startsWith(entry) && entry.length > 4,
  )).length;
}

/** Reads the first plausible numeric value for a stat out of decompiled text. */
function firstNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = parseFloat(match[1]);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return null;
}

/** Same reader for fractional stats (movement speed), never rounded. */
function firstFloat(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = parseFloat(match[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * Looks for the mob's own data files (loot tables, biome spawn pools). Only an
 * exact identifier match counts — a neighbour's loot table must never be adopted.
 */
function findDataEvidence(mobId: string, archivePaths: string[], kind: 'spawn' | 'loot'): string | null {
  const needle = compact(mobId);
  const tokens = words(mobId).map(stem);
  if (needle.length < 3 && tokens.length === 0) return null;
  for (const raw of archivePaths) {
    const path = raw.replace(/\\/g, '/').toLowerCase();
    const isLoot = /loot_tables?\//.test(path) || /\/loot\//.test(path);
    const isSpawn = /(^|\/)(spawn_rules|spawn|worldgen|biomes?)\//.test(path) || /_spawn\.json$/.test(path);
    if (kind === 'loot' ? !isLoot : !isSpawn) continue;
    const flat = compact(path);
    if (needle.length >= 3 && flat.includes(needle)) return raw;
    if (tokens.length > 0 && tokens.every((token) => flat.includes(token))) return raw;
  }
  return null;
}

function baseProfile(): MobBehaviorProfile {
  return {
    attack: 'none',
    disposition: 'neutral',
    trading: false,
    damage: 0,
    damageDetected: false,
    xpReward: 0,
    xpDetected: false,
    health: DEFAULT_HEALTH,
    healthDetected: false,
    movementSpeed: DEFAULT_MOVEMENT_SPEED,
    movementDetected: false,
    isBoss: false,
    dimensionsDetected: false,
    dimensionsEvidence: null,
    flyingDetected: false,
    spawnDetected: false,
    spawnEvidence: null,
    lootDetected: false,
    lootEvidence: null,
    areaOfEffect: false,
    homing: false,
    charge: false,
    summon: false,
    confidence: 'default',
    isDefault: true,
    sourceClasses: [],
    evidence: [],
  };
}

/** Entity-dimension declarations the mod may carry, most authoritative first. */
const DIMENSION_PATTERNS: RegExp[] = [
  /EntityDimensions\.(?:scalable|fixed)\s*\(\s*(\d+(?:\.\d+)?)[fFdD]?\s*,\s*(\d+(?:\.\d+)?)[fFdD]?/,
  /new\s+EntityDimensions\s*\(\s*(\d+(?:\.\d+)?)[fFdD]?\s*,\s*(\d+(?:\.\d+)?)[fFdD]?/,
  /\bsetSize\s*\(\s*(\d+(?:\.\d+)?)[fFdD]?\s*,\s*(\d+(?:\.\d+)?)[fFdD]?\s*\)/,
  /\bdimensions\s*\(\s*(\d+(?:\.\d+)?)[fFdD]?\s*,\s*(\d+(?:\.\d+)?)[fFdD]?\s*[,)]/,
];

/**
 * Reads the entity's own body size out of the mod's code. The declaration order is
 * deliberate: an explicit `EntityDimensions`/`setSize` call is the author's authority,
 * while a bare `dimensions(w, h)` helper is only accepted when it is the sole source.
 */
function readEntityDimensions(text: string): { width: number; height: number } | null {
  for (const pattern of DIMENSION_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const width = parseFloat(match[1]);
    const height = parseFloat(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    if (width <= 0 || height <= 0 || width > 8 || height > 8) continue;
    return { width, height };
  }
  return null;
}

/**
 * Derives each mob's behaviour from the mod's own bytecode, data files, entity
 * dimensions and tags. Nothing is inferred from the mob's display name: when no
 * evidence exists the mob becomes a neutral wandering entity with no attack, no damage
 * and no XP reward, and the profile is flagged `default` so the audit can report it.
 */
export function inferMobBehaviorProfiles(
  mobIds: string[],
  classes: DecompileClassSummary[] = [],
  sources?: MobEvidenceSources,
): Record<string, MobBehaviorProfile> {
  const archivePaths = sources?.archivePaths ?? [];
  const profiles: Record<string, MobBehaviorProfile> = {};

  for (const mobId of mobIds) {
    const profile = baseProfile();
    // A mob's AI is commonly split across its entity class, nested goal classes,
    // projectile classes and registration helpers. Four name matches often kept only the
    // entity shell and discarded the actual goal/attack evidence. Keep a wider, bounded set,
    // preferring classes that already carry bytecode-derived semantic signals.
    const directMatches = classes.filter((entry) =>
      matchScore(mobId, entry.className) >= 2 ||
      matchScore(mobId, entry.qualifiedClassName ?? '') >= 2,
    );
    const anchorNames = new Set(directMatches.flatMap((entry) =>
      [entry.qualifiedClassName, entry.className].filter((name): name is string => Boolean(name)),
    ));
    const related = classes.map((entry) => {
      const directScore = Math.max(
        matchScore(mobId, entry.className),
        matchScore(mobId, entry.qualifiedClassName ?? ''),
      );
      const qualified = entry.qualifiedClassName ?? '';
      const nestedOwner = [...anchorNames].some((anchor) =>
        qualified.startsWith(anchor + '$') || entry.superName === anchor,
      );
      return {
        entry,
        score: directScore >= 2 ? directScore : nestedOwner ? 2 : 0,
        hasBytecodeEvidence: (entry.signals ?? []).some((signal) => signal.startsWith('bytecode-signature:')),
      };
    })
      .filter((match) => match.score >= 2)
      .sort((a, b) => b.score - a.score || Number(b.hasBytecodeEvidence) - Number(a.hasBytecodeEvidence))
      .slice(0, 64);
    const signals = related.flatMap(({ entry }) => entry.signals ?? [])
      .filter((signal) => signal.startsWith('bytecode-signature:'));
    const text = related.map(({ entry }) => [entry.className, ...entry.methods, ...(entry.signals ?? [])].join(' ')).join(' ');
    const sourceNames = related.map(({ entry }) => entry.className);
    const spawnPath = findDataEvidence(mobId, archivePaths, 'spawn');
    const lootPath = findDataEvidence(mobId, archivePaths, 'loot');
    const codeSpawn = /spawnrestriction|spawneggitem|spawngroup|naturalspawn|spawnplacement|registerSpawn/i.test(text);
    const codeLoot = /loottable|getloottable|drop_table|droptable|dropchance/i.test(text);

    profile.spawnDetected = Boolean(spawnPath || codeSpawn);
    profile.spawnEvidence = spawnPath ?? (codeSpawn ? `spawn signature in ${sourceNames[0] ?? 'mod code'}` : null);
    profile.lootDetected = Boolean(lootPath || codeLoot);
    profile.lootEvidence = lootPath ?? (codeLoot ? `loot-table call in ${sourceNames[0] ?? 'mod code'}` : null);
    profile.sourceClasses = sourceNames;
    profile.flyingDetected = signals.includes('bytecode-signature:flight')
      || /flyingpathnavigation|flygoal|flyingmovecontrol|levitate|floatingpathnavigation/i.test(text);
    profile.isBoss = /bossbar|bosshealth|bossinfo|bossevent/i.test(text);

    const detectedHealth = firstNumber(text, [/(?:maxhealth|max_health|setmaxhealth|getmaxhealth)\D{0,12}(\d+(?:\.\d+)?)/i]);
    const detectedDamage = firstNumber(text, [/(?:attackdamage|attack_damage|getattributedamage|melee_damage)\D{0,12}(\d+(?:\.\d+)?)/i]);
    const detectedXp = firstNumber(text, [/(?:xpreward|expreward|experiencedrop|deathxp)\D{0,12}(\d+(?:\.\d+)?)/i]);
    // Movement speed is fractional, so it is read with the float reader.
    const detectedSpeed = firstFloat(text, [
      /(?:setmovementspeed|movementspeed|movement_speed|setspeed|speed_modifier|movespeed)\D{0,12}(0?\.\d+|\d+(?:\.\d+)?)/i,
    ]);

    const detectedDimensions = related.length > 0 ? readEntityDimensions(text) : null;
    if (detectedDimensions) {
      profile.dimensions = detectedDimensions;
      profile.dimensionsDetected = true;
      profile.dimensionsEvidence = `entity dimensions in ${sourceNames[0] ?? 'mod code'}`;
    }

    if (related.length > 0) {
      const trading = /trade|merchant|villager|offers|recipe/i.test(text);
      const passive = (/animal|ambient|passive|wateranimal|waterambient|tameable/i.test(text) && !/monster|hostile/i.test(text)) || trading;
      const hostile = /monster|hostile|imob|undead|demon|raider|enemy/i.test(text);
      const ranged = signals.includes('bytecode-signature:projectile-launch') || /projectile|shoot|launch|fireball|crossbow|bow|bullet/i.test(text);
      const spell = /spell|magic|arcane|cast|wand|staff/i.test(text);
      const melee = /attack|hurt|damage|strike|slash|melee|hitentity|dohurttarget/i.test(text);
      profile.areaOfEffect = signals.includes('bytecode-signature:area-of-effect');
      profile.homing = signals.includes('bytecode-signature:homing-projectile');
      profile.charge = signals.includes('bytecode-signature:charge-attack');
      profile.summon = signals.includes('bytecode-signature:summon');
      profile.statusEffect = signals.includes('bytecode-signature:status-effect')
        ? /poison/i.test(text) ? 'poison' : /wither/i.test(text) ? 'wither' : /weakness/i.test(text) ? 'weakness' : /slowness/i.test(text) ? 'slowness' : undefined
        : undefined;

      profile.trading = trading;
      profile.attack = passive ? 'none'
        : spell ? 'spell'
          : ranged ? 'ranged'
            : melee || hostile || profile.areaOfEffect || profile.charge ? 'melee' : 'none';
      profile.disposition = passive ? 'passive' : profile.attack === 'none' ? 'neutral' : 'hostile';
      profile.projectileType = spell || /snowball|ice|frost|orb/i.test(text) ? 'minecraft:snowball' : 'minecraft:arrow';
    }

    if (detectedHealth !== null) {
      profile.health = detectedHealth;
      profile.healthDetected = true;
    }
    if (profile.attack !== 'none' && detectedDamage !== null) {
      profile.damage = detectedDamage;
      profile.damageDetected = true;
    }
    if (detectedXp !== null) {
      profile.xpReward = detectedXp;
      profile.xpDetected = true;
    }

    if (detectedSpeed !== null) {
      // Speed is clamped to a range the engine moves at, but the value itself is the
      // mod's own — a slow boss and a fast minion never share one fabricated speed.
      profile.movementSpeed = Math.min(1, Math.max(0.05, detectedSpeed));
      profile.movementDetected = true;
    }

    const hasBehaviorEvidence = profile.attack !== 'none' || profile.trading || profile.disposition !== 'neutral';
    profile.isDefault = !hasBehaviorEvidence && !profile.spawnDetected && !profile.lootDetected && signals.length === 0;
    profile.confidence = profile.isDefault ? 'default'
      : signals.length > 0 ? 'bytecode-signature'
        : related.length > 0 ? 'name-inferred' : 'data-signature';

    profile.evidence = Array.from(new Set([
      ...signals,
      ...sourceNames,
      profile.spawnEvidence ?? '',
      profile.lootEvidence ?? '',
    ].filter(Boolean))).slice(0, 8);
    profiles[mobId] = profile;
  }

  return profiles;
}