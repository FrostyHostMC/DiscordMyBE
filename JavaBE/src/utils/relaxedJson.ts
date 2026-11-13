/** Parses strict JSON plus the comments and trailing commas common in Java animation assets. */
export function parseRelaxedJson(text: string): unknown | null {
  if (text.length > 6_000_000) return null;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let cleaned = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inString) {
      cleaned += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      cleaned += char;
      continue;
    }
    if (char === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index += 1;
      if (source[index] === '\r' && source[index + 1] === '\n') index += 1;
      if (index < source.length) cleaned += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      const close = source.indexOf('*/', index + 2);
      if (close < 0) return null;
      for (let cursor = index; cursor < close + 2; cursor += 1) {
        if (source[cursor] === '\n') cleaned += '\n';
      }
      index = close + 1;
      continue;
    }
    if (char === ',') {
      let lookahead = index + 1;
      while (/\s/.test(source[lookahead] ?? '')) lookahead += 1;
      if (source[lookahead] === '}' || source[lookahead] === ']') continue;
    }
    cleaned += char;
  }

  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    return null;
  }
}