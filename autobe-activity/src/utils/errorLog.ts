/**
 * Safely serializes any thrown/logged value into a readable string.
 * Non-Error objects (DOMException, Event, plain objects, circular refs)
 * otherwise print as "[object Object]" in console logging pipelines.
 */
export function describeError(e: unknown): string {
  console.error('[describeError] Input:', e);

  if (e === null || e === undefined) {
    return 'Unknown error (null/undefined)';
  }

  if (e instanceof Error) {
    const message = e.message || 'No error message';
    const stack = e.stack;
    return stack ? `${message}\n${stack}` : message;
  }

  if (typeof e === 'string') {
    return e || 'Empty error string';
  }

  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ['name', 'message', 'code', 'reason', 'type', 'status']) {
      const v = obj[key];
      if (v !== undefined && typeof v !== 'object') parts.push(`${key}: ${String(v)}`);
    }
    if (parts.length > 0) return `${obj.constructor?.name ?? 'Object'} { ${parts.join(', ')} }`;
    try {
      const json = JSON.stringify(e, getCircularReplacer());
      return json || 'Empty object';
    } catch {
      return Object.prototype.toString.call(e);
    }
  }

  return String(e) || 'Unknown error type';
}

function getCircularReplacer(): (this: unknown, key: string, value: unknown) => unknown {
  const seen = new WeakSet();
  return (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}