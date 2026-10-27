import type JSZip from 'jszip';

/**
 * Guard Script API event subscriptions that may not exist in the runtime
 * targeted by a source add-on. A missing event otherwise throws while the
 * module is being evaluated, preventing later handlers in that script from
 * registering (including spawn-time item grants).
 *
 * This is intentionally API-based and add-on-agnostic: it never checks pack
 * names or item identifiers. It only makes the subscription a no-op when the
 * event/group is unavailable.
 */
export async function guardUnavailableEventSubscriptions(
  zip: JSZip,
  diagnostics?: string[],
): Promise<number> {
  const report = (message: string) => {
    if (diagnostics) diagnostics.push(message);
    else console.warn('[AutoBE] ' + message);
  };

  const targets: string[] = [];
  zip.forEach((path, file) => {
    if (!file.dir && path.toLowerCase().endsWith('.js')) targets.push(path);
  });

  let changedFiles = 0;
  for (const path of targets) {
    const file = zip.file(path);
    if (!file) continue;
    const original = await file.async('text');

    // Handles both world.afterEvents.someEvent.subscribe(...) and nested
    // event groups such as world.beforeEvents.inventory.drop.subscribe(...).
    // Existing optional-chain forms are not matched, so repeated passes are
    // idempotent.
    const updated = original.replace(
      /(\b[A-Za-z_$][\w$]*)\.(afterEvents|beforeEvents)\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?\.subscribe\s*\(/g,
      (_match, root: string, phase: string, eventGroup: string, eventName?: string) =>
        eventName
          ? root + '.' + phase + '.' + eventGroup + '?.' + eventName + '?.subscribe?.('
          : root + '.' + phase + '.' + eventGroup + '?.subscribe?.(',
    );

    if (updated !== original) {
      zip.file(path, updated);
      changedFiles++;
      report(
        'Guarded potentially unavailable Script API event subscription(s) in ' +
          path +
          '. The subscription will be skipped if its event is not exposed by the runtime.',
      );
    }
  }
  return changedFiles;
}
