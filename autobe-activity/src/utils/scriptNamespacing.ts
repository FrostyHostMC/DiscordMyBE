/**
 * Port of AutoBE Part 18 _make_pack_ns / _namespace_script_properties:
 * after merging, all scripts share one behavior-pack UUID, so dynamic
 * property keys and scoreboard objective names that were previously
 * isolated per-pack UUID would collide. Every bare key is prefixed with a
 * short per-pack namespace token so each pack's data stays isolated while
 * remaining internally self-consistent.
 *
 * Transforms (per-pack, consistent):
 *   setDynamicProperty("score", v)  ->  setDynamicProperty("ns:score", v)
 *   getDynamicProperty("score")     ->  getDynamicProperty("ns:score")
 *   addObjective("kills", ...)      ->  addObjective("ns_kills", ...)
 *   getObjective("kills")           ->  getObjective("ns_kills")
 * Keys that already contain ':' or look pre-namespaced are left alone.
 */

/** Derive a short stable namespace token from a pack name. */
export function makePackNs(name: string): string {
  const clean = (name || '')
    .replace(/\.(mcpack|mcaddon)$/i, '')
    .replace(/_modified$/i, '')
    .replace(/_\d+$/, '');
  const ns = clean.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return ns || 'pack';
}

/** Apply the dynamic-property / scoreboard-objective prefixing to one script. */
export function namespaceScriptText(content: string, ns: string): string {
  let out = content;

  // --- Dynamic properties: prefix bare keys (no colon) ---
  out = out.replace(
    /((?:set|get)DynamicProperty\s*\(\s*["'])([^"':\n]+)(["'])/g,
    (full, p1: string, key: string, p3: string) =>
      key.includes(':') ? full : `${p1}${ns}:${key}${p3}`
  );

  // --- Scoreboard objectives: prefix names (Bedrock max 16 chars total) ---
  const shortNs = ns.slice(0, 4); // 4 chars + '_' + 11 chars = 16
  out = out.replace(
    /((?:add|get|remove)Objective\s*\(\s*)(["'])([^"']{1,16})\2/g,
    (full, method: string, q: string, name: string) => {
      // Skip if already looks prefixed (contains an early underscore)
      const underIdx = name.indexOf('_');
      if (underIdx !== -1 && underIdx <= 5) return full;
      const newName = (shortNs + '_' + name).slice(0, 16);
      return `${method}${q}${newName}${q}`;
    }
  );

  return out;
}

/**
 * Async: reads and rewrites each script entry under `dirPath` with the given
 * pack namespace. Only files whose content actually changes are rewritten.
 */
export async function namespaceScriptDirAsync(
  zip: import('jszip').default,
  dirPath: string,
  ns: string
): Promise<number> {
  const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
  const targets: string[] = [];
  zip.forEach((path, f) => {
    if (!f.dir && path.startsWith(prefix) && path.toLowerCase().endsWith('.js')) {
      targets.push(path);
    }
  });
  let changed = 0;
  for (const path of targets) {
    const file = zip.file(path);
    if (!file) continue;
    try {
      const content = await file.async('text');
      const updated = namespaceScriptText(content, ns);
      if (updated !== content) {
        zip.file(path, updated);
        changed++;
      }
    } catch {
      // non-text entry — leave untouched
    }
  }
  return changed;
}