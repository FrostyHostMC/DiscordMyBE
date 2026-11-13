import { verifiedVersions } from '@/utils/scriptModuleVersions';

/**
 * One coherent `@minecraft/*` dependency set for an entire behaviour pack.
 *
 * Every defect this module removes was logged by a real Bedrock client:
 *
 *  - `requested invalid version [1.16.0] of [@minecraft/server-ui]. Available versions: ...` —
 *    one module's version list was written onto a sibling module. Each `@minecraft/*` module
 *    publishes its OWN list, so a version is only ever written for the module that lists it.
 *  - `promoted [@minecraft/server-bindings] from [1.16.0] to [1.19.0] requested by
 *    [@minecraft/server - 1.16.0]` — `server-bindings` is DERIVED from the `@minecraft/server`
 *    declaration, not resolved from its own list. The pair therefore mirrors one version.
 *  - a module that only exists from a newer engine upwards must not be written onto a pack whose
 *    `min_engine_version` floor is older, or the whole script context fails to be created.
 *
 * The resolver never upgrades blindly: an already-published version is kept, a requested major is
 * honoured when that major exists, and a module with no verified list is reported for manual
 * review instead of being guessed at or silently deleted.
 */

export interface ScriptDependencyEntry {
  module_name?: string;
  version?: string;
  uuid?: string;
}

export interface ScriptDependencySet {
  dependencies: ScriptDependencyEntry[];
  /** Applied changes, phrased for the diagnostic log. */
  fixes: string[];
  /** Defects that must stay visible instead of being guessed away. */
  reports: string[];
  /** Modules declared because a shipped script imports them. */
  declared: string[];
  /** Declared-but-unused optional modules removed from the manifest. */
  removed: string[];
  changed: boolean;
}

/** Modules the engine derives itself: their version mirrors the module they belong to. */
const COUPLED_MODULES: Record<string, string> = {
  '@minecraft/server-bindings': '@minecraft/server',
};

/**
 * Modules whose MAJOR RELEASE TRACK must not sit above the module they extend. The Bedrock
 * loader resolves `@minecraft/server-ui` 2.x against an internal `@minecraft/server` 2.x
 * binding set; when the manifest also declares `@minecraft/server` 1.x the two tracks collide
 * and the whole script context fails to create. A pack may only declare a child module major
 * the parent module's own major can carry — so a child declared above its parent is walked
 * back inside the parent's track, and a child with no version in that track is reported as a
 * build-time conflict instead of shipping a context that can never initialize.
 */
const MAJOR_TRACK_COUPLING: Record<string, string> = {
  '@minecraft/server-ui': '@minecraft/server',
  '@minecraft/server-bindings': '@minecraft/server',
};

/** Module majors that only exist from a minimum target engine upwards. */
const MODULE_ENGINE_FLOORS: Record<string, Array<{ major: number; engine: [number, number, number] }>> = {
  '@minecraft/server-ui': [{ major: 2, engine: [1, 21, 0] }],
};

/** Dependencies this resolver never deletes, whatever else is true of them. */
const NEVER_REMOVED = new Set(['@minecraft/server']);

const MODULE_ORDER = [
  '@minecraft/server',
  '@minecraft/server-ui',
  '@minecraft/server-gametest',
  '@minecraft/server-admin',
  '@minecraft/server-net',
];

const compareVersions = (a: string, b: string): number => {
  const pa = a.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const majorOf = (version: string): number => parseInt(version.split('.')[0] ?? '', 10) || 0;

const atLeast = (version: number[], floor: number[]): boolean => {
  for (let i = 0; i < 3; i += 1) {
    const diff = (version[i] ?? 0) - (floor[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
};

/** False when this module major needs a newer engine than the pack declares as its floor. */
const engineAllows = (moduleName: string, version: string, minEngineVersion: number[]): boolean =>
  (MODULE_ENGINE_FLOORS[moduleName] ?? []).every(
    (floor) => majorOf(version) < floor.major || atLeast(minEngineVersion, floor.engine),
  );

/** The module whose published list contains `version` — used to name a borrowed version. */
export function moduleOwningVersion(version: string, moduleName: string): string | null {
  for (const candidate of MODULE_ORDER) {
    if (candidate !== moduleName && verifiedVersions(candidate).includes(version)) return candidate;
  }
  return null;
}

/** Version a module may declare on a pack with this engine floor, or null when unverified. */
export function pickCompatibleVersion(
  moduleName: string,
  requested: string | undefined,
  minEngineVersion: number[],
): string | null {
  const list = verifiedVersions(moduleName);
  if (list.length === 0) return null;
  const wanted = (requested ?? '').trim();
  if (wanted && list.includes(wanted) && engineAllows(moduleName, wanted, minEngineVersion)) return wanted;
  const stable = list.filter((version) => !version.includes('-'));
  const pool = (stable.length > 0 ? stable : list).filter((version) =>
    engineAllows(moduleName, version, minEngineVersion),
  );
  if (pool.length === 0) return null;
  if (!wanted) {
    // No requested version: pick the oldest supported major's highest release. That is the most
    // broadly compatible choice — declaring a newer major the mod never asked for would be a
    // blind upgrade, and the shipped scripts only use APIs the oldest major already has.
    // A 0.x prerelease line is only used when the module publishes nothing else: downgrading a
    // pack onto an unfinished API line would break the scripts it ships.
    const production = pool.filter((version) => majorOf(version) >= 1);
    const usable = production.length > 0 ? production : pool;
    const lowestMajor = Math.min(...usable.map((version) => majorOf(version)));
    const oldest = usable.filter((version) => majorOf(version) === lowestMajor).sort(compareVersions);
    return oldest[oldest.length - 1];
  }
  const sameMajor = pool.filter((version) => majorOf(version) === majorOf(wanted));
  const candidates = sameMajor.length > 0 ? sameMajor : pool;
  return [...candidates].sort(compareVersions)[candidates.length - 1];
}

export function resolveScriptDependencySet(input: {
  dependencies: ScriptDependencyEntry[];
  importedModules: string[];
  minEngineVersion?: number[];
  removableModules?: string[];
}): ScriptDependencySet {
  const minEngine = input.minEngineVersion ?? [1, 20, 0];
  const imported = new Set(input.importedModules);
  const removable = new Set(input.removableModules ?? []);
  const dependencies: ScriptDependencyEntry[] = input.dependencies.map((dep) => ({ ...dep }));
  const fixes: string[] = [];
  const reports: string[] = [];
  const declared: string[] = [];
  const removed: string[] = [];
  let changed = false;
  const findDep = (moduleName: string) => dependencies.find((dep) => dep.module_name === moduleName);

  // 1. Pin every declared module to a version THAT module publishes, for this engine floor.
  for (const dep of dependencies) {
    const moduleName = dep.module_name;
    if (!moduleName || !moduleName.startsWith('@minecraft/')) continue;
    if (COUPLED_MODULES[moduleName]) continue;
    const requested = typeof dep.version === 'string' ? dep.version : undefined;
    const resolved = pickCompatibleVersion(moduleName, requested, minEngine);
    if (!resolved) {
      reports.push(
        `"${moduleName}" declares "${requested ?? 'no version'}", which this engine has no verified list for at min_engine_version ${minEngine.join('.')} — left untouched for manual review rather than guessed.`,
      );
      continue;
    }
    if (resolved === requested) continue;
    const owner = requested ? moduleOwningVersion(requested, moduleName) : null;
    fixes.push(
      owner
        ? `"${moduleName}" declared ${requested}, which is a ${owner} version — set to ${resolved}, a version ${moduleName} actually publishes.`
        : `"${moduleName}" declared ${requested ?? 'no version'}, which ${moduleName} does not publish for this engine floor — set to ${resolved}.`,
    );
    dep.version = resolved;
    changed = true;
  }

  // 1.5 No child module may declare a major release track ABOVE the parent module it
  // extends: the loader resolves the pair against mismatched binding sets and the script
  // context fails to create. The child is walked back inside the parent's track; when the
  // parent's track has no verified child version at all, the conflict is surfaced as a
  // build-time error instead of shipping a pack that can never initialize.
  for (const [child, parent] of Object.entries(MAJOR_TRACK_COUPLING)) {
    const childDep = findDep(child);
    const parentDep = findDep(parent);
    if (!childDep || !parentDep) continue;
    const childVersion = typeof childDep.version === 'string' ? childDep.version : '';
    const parentVersion = typeof parentDep.version === 'string' ? parentDep.version : '';
    if (!childVersion || !parentVersion) continue;
    if (majorOf(childVersion) <= majorOf(parentVersion)) continue;
    const aligned = verifiedVersions(child)
      .filter((version) => majorOf(version) === majorOf(parentVersion) && engineAllows(child, version, minEngine))
      .sort(compareVersions);
    const target = aligned.length > 0 ? aligned[aligned.length - 1] : null;
    if (!target) {
      reports.push(
        `"${child}" ${childVersion} sits above the "${parent}" ${parentVersion} major track it extends — the engine resolves the pair against mismatched binding sets and the script context fails to create. No "${child}" version is verified inside ${parent} ${majorOf(parentVersion)}.x, so this is a BUILD-TIME CONFLICT: both declarations are left untouched for manual review rather than guessed.`,
      );
      continue;
    }
    fixes.push(
      `"${child}" declared ${childVersion}, above the "${parent}" ${parentVersion} track it extends — walked back to ${target} so both modules share one release track.`,
    );
    childDep.version = target;
    changed = true;
  }

  // 2. Derived modules mirror the module they belong to.
  for (const [moduleName, parent] of Object.entries(COUPLED_MODULES)) {
    const dep = findDep(moduleName);
    if (!dep) continue;
    const parentDep = findDep(parent);
    if (!parentDep || typeof parentDep.version !== 'string') {
      reports.push(
        `"${moduleName}" is declared but "${parent}" is not — the engine derives "${moduleName}" from "${parent}", so this pair is inconsistent and needs a manual decision.`,
      );
      continue;
    }
    if (dep.version === parentDep.version) continue;
    fixes.push(
      `"${moduleName}" declared ${String(dep.version ?? 'no version')} while "${parent}" declares ${parentDep.version} — aligned to ${parentDep.version}, the version the engine derives it from.`,
    );
    dep.version = parentDep.version;
    changed = true;
  }

  // 3. Modules shipped scripts import must be declared — at a version the module publishes.
  for (const moduleName of imported) {
    if (findDep(moduleName) || COUPLED_MODULES[moduleName]) continue;
    const resolved = pickCompatibleVersion(moduleName, undefined, minEngine);
    if (!resolved) {
      reports.push(
        `shipped scripts import "${moduleName}" but no version is verified for it — the dependency is NOT declared and the script is NOT removed: the module stays visible as unsupported instead of being faked into working.`,
      );
      continue;
    }
    dependencies.push({ module_name: moduleName, version: resolved });
    declared.push(moduleName);
    changed = true;
  }

  // 4. Declared-but-unused optional modules are removed; core modules never are.
  for (let i = dependencies.length - 1; i >= 0; i -= 1) {
    const moduleName = dependencies[i].module_name;
    if (!moduleName || !removable.has(moduleName) || imported.has(moduleName)) continue;
    if (NEVER_REMOVED.has(moduleName) || Object.values(COUPLED_MODULES).includes(moduleName)) continue;
    dependencies.splice(i, 1);
    removed.push(moduleName);
    changed = true;
  }

  return { dependencies, fixes, reports, declared, removed, changed };
}