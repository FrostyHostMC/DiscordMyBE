import type { AnimationResourceRegistry } from '@/utils/animationResourceRegistry';

type FileMap = Record<string, string | Uint8Array>;
type StringSnapshot = Map<string, string>;

interface RegistrySnapshot {
  resourceJson: StringSnapshot;
  behaviorScripts: StringSnapshot;
}

const snapshots = new WeakMap<AnimationResourceRegistry, RegistrySnapshot>();
const isJsonPath = (path: string): boolean => path.toLowerCase().endsWith('.json');
const isBehaviorScriptPath = (path: string): boolean => path.startsWith('scripts/');

function snapshotFiles(files: FileMap, include: (path: string) => boolean): StringSnapshot {
  const snapshot: StringSnapshot = new Map();
  for (const [path, content] of Object.entries(files)) {
    if (include(path) && typeof content === 'string') snapshot.set(path, content);
  }
  return snapshot;
}

function matchesSnapshot(
  files: FileMap,
  include: (path: string) => boolean,
  snapshot: StringSnapshot,
): boolean {
  let currentCount = 0;
  for (const [path, content] of Object.entries(files)) {
    if (!include(path) || typeof content !== 'string') continue;
    currentCount += 1;
    if (snapshot.get(path) !== content) return false;
  }
  return currentCount === snapshot.size;
}

/** Captures the exact JSON and script text used to derive an exported animation registry. */
export function snapshotAnimationResourceRegistry(
  registry: AnimationResourceRegistry,
  input: { resourcePackFiles: FileMap; behaviorPackFiles?: FileMap },
): void {
  snapshots.set(registry, {
    resourceJson: snapshotFiles(input.resourcePackFiles, isJsonPath),
    behaviorScripts: snapshotFiles(input.behaviorPackFiles ?? {}, isBehaviorScriptPath),
  });
}

/** Rejects success metrics if their shared registry no longer matches the files being checked. */
export function assertAnimationResourceRegistryCurrent(
  registry: AnimationResourceRegistry,
  input: { resourcePackFiles: FileMap; behaviorPackFiles?: FileMap },
): void {
  const snapshot = snapshots.get(registry);
  if (!snapshot) {
    throw new Error('[Aippy] Animation metrics have no final resource snapshot; rebuild the registry from the export files.');
  }
  const resourceCurrent = matchesSnapshot(input.resourcePackFiles, isJsonPath, snapshot.resourceJson);
  const behaviorCurrent = input.behaviorPackFiles === undefined ||
    matchesSnapshot(input.behaviorPackFiles, isBehaviorScriptPath, snapshot.behaviorScripts);
  if (!resourceCurrent || !behaviorCurrent) {
    throw new Error('[Aippy] Animation metrics are stale: the exported JSON or behavior scripts changed after the registry was measured. Rebuild the registry before reporting success.');
  }
}