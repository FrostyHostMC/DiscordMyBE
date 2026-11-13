import { isPlainObject } from '@/utils/animationChannelMath';
import { anatomyFamily, anatomyPenalty, describeBoneAnatomy } from '@/utils/boneAnatomy';
import type { BoneFamily } from '@/utils/boneAnatomy';

export type { BoneFamily } from '@/utils/boneAnatomy';

/**
 * Universal bone retargeting.
 *
 * A source clip names bones the way its own author did (`LeftArm`, `arm_left`, `left_arm_upper`,
 * `leg0`, `bipedHead`), while the shipped Bedrock geometry names the same parts its own way.
 * Binding by string equality therefore dropped most source tracks, which in game reads as a
 * mob that plays nothing or animates only its torso.
 *
 * This module resolves a source bone onto a shipped bone using the strongest evidence
 * available, in order: identical name, canonical form, limb family + side, ordinal index
 * within a family, then unique token overlap. A track is only renamed when exactly one
 * shipped bone qualifies — an ambiguous match is reported, never guessed, because driving the
 * wrong limb is worse than leaving a track unmapped.
 */

export type BoneMatchKind = 'exact' | 'canonical' | 'synonym' | 'ordinal' | 'token' | 'none';

export interface BoneMatch {
  bone: string | null;
  kind: BoneMatchKind;
}

export interface BoneMapping {
  source: string;
  bone: string | null;
  kind: BoneMatchKind;
}

export interface BoneIndex {
  exact: Set<string>;
  canonical: Map<string, string>;
  family: Map<string, string[]>;
  names: string[];
}

/**
 * Body region of a bone. Delegated to the anatomy tokenizer: a substring rule classified
 * `forearm` as a head bone (it contains "ear") and drove the head from a forearm track.
 */
export function boneFamily(name: string): BoneFamily {
  return anatomyFamily(name);
}

export function canonicalBoneKey(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function boneSide(name: string): 'left' | 'right' | null {
  const lower = (name || '').toLowerCase();
  if (/(?:^|[^a-z])(?:l|left)(?:[^a-z]|$)/.test(lower) || lower.startsWith('left')) return 'left';
  if (/(?:^|[^a-z])(?:r|right)(?:[^a-z]|$)/.test(lower) || lower.startsWith('right')) return 'right';
  return null;
}

/** Trailing index of a source bone (`leg0`, `arm_2`, `wing 3`) — the ordinal hint. */
export function boneOrdinal(name: string): number | null {
  const match = /(\d+)\s*$/.exec((name || '').trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildBoneIndex(boneNames: string[]): BoneIndex {
  const exact = new Set(boneNames);
  const canonical = new Map<string, string>();
  const family = new Map<string, string[]>();
  for (const name of boneNames) {
    const key = canonicalBoneKey(name);
    if (key && !canonical.has(key)) canonical.set(key, name);
    const bucket = family.get(boneFamily(name)) ?? [];
    bucket.push(name);
    family.set(boneFamily(name), bucket);
  }
  for (const bucket of family.values()) bucket.sort();
  return { exact, canonical, family, names: [...boneNames] };
}

/** Resolves one source bone onto the shipped skeleton. */
export function matchBoneName(source: string, index: BoneIndex): BoneMatch {
  const raw = (source || '').trim();
  if (!raw) return { bone: null, kind: 'none' };
  if (index.exact.has(raw)) return { bone: raw, kind: 'exact' };

  const key = canonicalBoneKey(raw);
  if (key) {
    const canonical = index.canonical.get(key);
    if (canonical) return { bone: canonical, kind: 'canonical' };
  }

  // Family + side, decided by ANATOMY rather than string distance: `DEF_FOREARM.L` may only reach
  // an arm joint, `DEF_TOOL.R` only a held-item joint. A candidate from another body region is
  // never a candidate, so an unrelated limb can never receive this track's motion.
  const anatomy = describeBoneAnatomy(raw);
  const family = anatomy.family;
  const side = anatomy.side;
  const siblings = index.family.get(family) ?? [];
  if (family !== 'other' && siblings.length > 0) {
    const sameSide = side ? siblings.filter((bone) => boneSide(bone) === side) : [];
    const pool = side ? sameSide : siblings;
    if (!side && siblings.length === 1) return { bone: siblings[0], kind: 'synonym' };

    // Ordinal: `leg0` on a four-legged rig resolves by index inside the family.
    const ordinal = boneOrdinal(raw);
    if (ordinal !== null && pool.length > 0) {
      const picked = pool[ordinal % pool.length];
      if (picked) return { bone: picked, kind: 'ordinal' };
    }

    const ranked = pool
      .map((bone) => ({ bone, penalty: anatomyPenalty(raw, bone) }))
      .filter((entry) => Number.isFinite(entry.penalty))
      .sort((a, b) => a.penalty - b.penalty);
    if (ranked.length === 1) return { bone: ranked[0].bone, kind: 'synonym' };
    if (ranked.length > 1) {
      // Only a strict winner is accepted: an exact joint beats the outer-layer variant, and an
      // unresolved minute is preferred over driving the wrong limb.
      if (ranked[0].penalty < ranked[1].penalty) return { bone: ranked[0].bone, kind: 'synonym' };
      return { bone: null, kind: 'none' };
    }
  }

  // Unique token overlap: `biped_head_upper` -> `head`, only when exactly one bone matches —
  // and only inside the same body region (or when the source name carries no region at all).
  const tokens = raw.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  if (tokens.length > 0) {
    const candidates = index.names.filter((bone) => {
      if (family !== 'other' && anatomyFamily(bone) !== family) return false;
      const lower = bone.toLowerCase();
      return tokens.some((token) => lower.includes(token));
    });
    if (candidates.length === 1) return { bone: candidates[0], kind: 'token' };
  }

  return { bone: null, kind: 'none' };
}

/**
 * Re-binds every bone track of every clip onto the shipped skeleton.
 * Tracks that cannot be resolved are kept under their source name and reported, so the
 * mismatch stays visible instead of silently deleting motion.
 */
export function retargetClips(
  animations: Record<string, unknown>,
  boneNames: string[],
): { animations: Record<string, unknown>; remapped: number; unmapped: string[]; mappings: BoneMapping[] } {
  if (boneNames.length === 0) return { animations, remapped: 0, unmapped: [], mappings: [] };
  const index = buildBoneIndex(boneNames);
  const mappings: BoneMapping[] = [];
  const unmapped = new Set<string>();
  const out: Record<string, unknown> = {};
  let remapped = 0;

  for (const [clipId, clip] of Object.entries(animations)) {
    if (!isPlainObject(clip) || !isPlainObject(clip.bones)) {
      out[clipId] = clip;
      continue;
    }
    const bones: Record<string, unknown> = {};
    for (const [sourceName, track] of Object.entries(clip.bones as Record<string, unknown>)) {
      const match = matchBoneName(sourceName, index);
      if (!match.bone) {
        bones[sourceName] = track;
        unmapped.add(sourceName);
        mappings.push({ source: sourceName, bone: null, kind: 'none' });
        continue;
      }
      const target = match.bone;
      if (target !== sourceName) remapped += 1;
      if (match.kind !== 'exact') mappings.push({ source: sourceName, bone: target, kind: match.kind });
      // Two source tracks that resolve onto one shipped bone are merged instead of the
      // second one overwriting the first: losing a channel is a silent regression.
      const existing = bones[target];
      if (isPlainObject(existing) && isPlainObject(track)) {
        bones[target] = { ...(existing as Record<string, unknown>), ...(track as Record<string, unknown>) };
      } else {
        bones[target] = track;
      }
    }
    out[clipId] = { ...clip, bones };
  }

  return { animations: out, remapped, unmapped: [...unmapped], mappings };
}