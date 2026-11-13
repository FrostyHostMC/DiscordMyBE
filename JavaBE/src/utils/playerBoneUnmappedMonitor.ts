import {
  derivePlayerBoneFromTokens,
  getPlayerBoneAliasStats,
  hasCustomBoneTokens,
  registerLearnedBoneAlias,
  type PlayerSkeletonBone,
} from '@/utils/playerBoneAliases';

/**
 * Unmapped-bone monitor for the player animation bridge.
 *
 * Every bone track the bridge cannot resolve is recorded here with the scope that reported it.
 * A repeated name is where a missing convention shows up, so each new name is run back through
 * the structural resolver: when the name yields a side + part pair, that convention is added to
 * the shared alias table (flagged approximated and re-applied to the same clip set); when it
 * does not, the name stays unmapped together with the reason, and no alias is invented for it.
 */

export interface UnmappedBoneSuggestion {
  name: string;
  bone: PlayerSkeletonBone | null;
  reason: string;
  /** True when this report extended the alias table. */
  learned: boolean;
}

export interface UnmappedBoneReportEntry {
  name: string;
  count: number;
  scopes: string[];
  bone: PlayerSkeletonBone | null;
  reason: string;
  learned: boolean;
}

const MAX_TRACKED_NAMES = 200;
const MAX_SCOPES_PER_NAME = 8;

interface TrackedBone {
  name: string;
  count: number;
  scopes: Set<string>;
  bone: PlayerSkeletonBone | null;
  reason: string;
  learned: boolean;
}

const tracked = new Map<string, TrackedBone>();

/**
 * Records the unmapped bones of one conversion pass. Returns only the names seen for the first
 * time, so a bridge can report each convention once instead of on every clip.
 */
export function recordUnmappedPlayerBones(
  names: string[],
  scope: string,
): UnmappedBoneSuggestion[] {
  const fresh: UnmappedBoneSuggestion[] = [];
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!key) continue;
    let entry = tracked.get(key);
    if (!entry) {
      if (tracked.size >= MAX_TRACKED_NAMES) {
        // Cap reached: the name is still unmapped, but the monitor stops growing.
        continue;
      }
      const derived = derivePlayerBoneFromTokens(name);
      // A custom sub-bone keeps its own name. Learning it as an alias would collapse it onto the
      // whole limb and rotate that limb twice — the reported "stretched character" symptom.
      const custom = hasCustomBoneTokens(name);
      const learned = derived.bone && !custom ? registerLearnedBoneAlias(name, derived.bone) : false;
      entry = {
        name,
        count: 0,
        scopes: new Set<string>(),
        bone: custom ? null : derived.bone,
        reason: custom
          ? `${derived.bone ? `tokens point at ${derived.bone}, but ` : ''}the name carries tokens beyond a side/part pair, so it is a custom sub-bone that must be injected into the rig instead of folded onto a limb`
          : derived.reason,
        learned,
      };
      tracked.set(key, entry);
      fresh.push({ name, bone: derived.bone, reason: derived.reason, learned });
    }
    entry.count += 1;
    if (entry.scopes.size < MAX_SCOPES_PER_NAME) entry.scopes.add(scope);
  }
  return fresh;
}

export function getUnmappedBoneReport(): UnmappedBoneReportEntry[] {
  return [...tracked.values()]
    .map((entry) => ({
      name: entry.name,
      count: entry.count,
      scopes: [...entry.scopes],
      bone: entry.bone,
      reason: entry.reason,
      learned: entry.learned,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Human-readable monitor report lines for the diagnostic log. */
export function formatUnmappedBoneMonitorReport(): string[] {
  const report = getUnmappedBoneReport();
  const stats = getPlayerBoneAliasStats();
  const lines: string[] = [];
  if (report.length === 0) {
    lines.push('[BONE-ALIAS] Monitor: no unmapped player bone reference was reported.');
  } else {
    const learned = report.filter((entry) => entry.learned);
    const open = report.filter((entry) => !entry.learned);
    lines.push(
      `[BONE-ALIAS] Monitor: ${report.length} distinct unmapped bone name(s) tracked; ${learned.length} convention(s) added to the alias table, ${open.length} left unresolved.`,
    );
    for (const entry of learned.slice(0, 4)) {
      lines.push(
        `[BONE-ALIAS] Learned "${entry.name}" = "${entry.bone}" (${entry.count} track(s); ${entry.reason}).`,
      );
    }
    for (const entry of open.slice(0, 4)) {
      lines.push(
        `[BONE-ALIAS] Unresolved "${entry.name}" (${entry.count} track(s)) — ${entry.reason}; no alias invented.`,
      );
    }
  }
  lines.push(
    `[BONE-ALIAS] Alias table: ${stats.total} mapping(s) (${stats.canonical} canonical / ${stats.alias} irregular alias / ${stats.learned} learned this session).`,
  );
  return lines;
}

export function resetUnmappedBoneMonitor(): void {
  tracked.clear();
}