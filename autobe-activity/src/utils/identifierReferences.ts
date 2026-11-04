/**
 * Rewrites exact Bedrock identifier tokens while preserving surrounding syntax.
 * Script rewriting is intentionally limited to static quoted literals.
 */

export function rewriteIdentifierTokens(text: string, renameMap?: Map<string, string>): string {
  let output = text;
  const entries = [...(renameMap || new Map<string, string>()).entries()]
    .filter(([oldId, newId]) => !!oldId && oldId !== newId)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [oldId, newId] of entries) {
    const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(`(^|[^A-Za-z0-9_.:-])${escaped}(?![A-Za-z0-9_.:-])`, 'g');
    output = output.replace(expression, (_match, before: string) => before + newId);
  }
  return output;
}

/** Scan JS/TS source and rewrite string literals, excluding comments and dynamic templates. */
export function rewriteStaticScriptIdentifierReferences(
  source: string,
  renameMap?: Map<string, string>
): string {
  if (!renameMap?.size) return source;
  let output = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i + 2);
      const stop = end < 0 ? source.length : end;
      output += source.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      output += source.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch !== "'" && ch !== '"' && ch !== '`') {
      output += ch;
      i++;
      continue;
    }
    const quote = ch;
    const start = i++;
    let value = '';
    let closed = false;
    while (i < source.length) {
      const current = source[i];
      if (current === '\\\\' && i + 1 < source.length) {
        value += current + source[i + 1];
        i += 2;
        continue;
      }
      if (current === quote) {
        i++;
        closed = true;
        break;
      }
      if (quote === '`' && current === '$' && source[i + 1] === '{') {
        // Dynamic template literal: leave the complete literal untouched.
        let depth = 1;
        i += 2;
        while (i < source.length && depth > 0) {
          if (source[i] === '{') depth++;
          else if (source[i] === '}') depth--;
          else if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
            const innerQuote = source[i++];
            while (i < source.length && source[i] !== innerQuote) {
              if (source[i] === '\\\\') i++;
              i++;
            }
          }
          i++;
        }
        while (i < source.length && source[i] !== '`') i++;
        if (i < source.length) i++;
        output += source.slice(start, i);
        closed = true;
        break;
      }
      value += current;
      i++;
    }
    if (!closed) {
      output += source.slice(start);
      break;
    }
    if (quote === '`') output += quote + value + quote;
    else output += quote + rewriteIdentifierTokens(value, renameMap) + quote;
  }
  return output;
}
