import type JSZip from 'jszip';

/** Merge only additions to JSON objects. Arrays and existing values are atomic:
 * differing values may encode order, conditions or behavior and are not guessed. */
export function mergeAdditions(base: any, incoming: any): { value: any; changed: boolean; conflicts: string[] } {
  const conflicts: string[] = [];
  let changed = false;
  const same = (a: any, b: any): boolean => {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
    if (isObject(a) && isObject(b)) {
      const ak = Object.keys(a), bk = Object.keys(b);
      return ak.length === bk.length && ak.every(key => Object.prototype.hasOwnProperty.call(b, key) && same(a[key], b[key]));
    }
    return false;
  };
  const visit = (a: any, b: any, path: string): any => {
    if (same(a, b)) return structuredClone(a);
    if (isObject(a) && isObject(b)) {
      const out = structuredClone(a);
      for (const [key, value] of Object.entries(b)) {
        const child = path ? `${path}.${key}` : key;
        if (!Object.prototype.hasOwnProperty.call(a, key)) { out[key] = structuredClone(value); changed = true; }
        else out[key] = visit(a[key], value, child);
      }
      return out;
    }
    conflicts.push(path || '(root)');
    return structuredClone(a);
  };
  const value = visit(base, incoming, '');
  return { value, changed, conflicts };
}

function isObject(value: any): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Keep a conflicting original out of Minecraft's active definition folders. */
export function preserveConflict(zip: JSZip, path: string, data: Uint8Array, source: string): string {
  const label = source.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'addon';
  const safePath = path.replace(/\\/g, '/').split('/').filter(part => part && part !== '.' && part !== '..').join('/');
  const base = `_autobe_conflicts/${label}/${safePath}.backup`;
  let result = base, index = 2;
  while (zip.file(result)) result = `${base}.${index++}`;
  zip.file(result, data);
  return result;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
