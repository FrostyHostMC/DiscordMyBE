/**
 * Rewrites references to renamed Bedrock identifiers without changing longer
 * identifiers or ordinary JavaScript text.
 */

/** Replace exact identifier tokens in structured text (JSON, Molang, mcfunction). */
export function rewriteIdentifierTokens(text: string, renameMap?: Map<string, string>): string {
  let output = text;
  const entries = [...(renameMap || new Map<string, string>()).entries()]
    .sort((a, b) => b[0].length - a[0].length);
  for (const [oldId, newId] of entries) {
    if (!oldId || oldId === newId) continue;
    const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Bedrock identifiers may be embedded in Molang expressions or command
    // arguments. Keep punctuation around the identifier intact.
    const expression = new RegExp(`(^|[^A-Za-z0-9_.:-])${escaped}(?![A-Za-z0-9_.:-])`, 'g');
    output = output.replace(expression, (_match, before: string) => before + newId);
  }
  return output;
}

/**
 * JavaScript identifiers are rewritten only inside static quoted literals.
 * Dynamic template literals and comments/free text are deliberately untouched.
 */
export function rewriteStaticScriptIdentifierReferences(
  source: string,
  renameMap?: Map<string, string>
): string {
  if (!renameMap?.size) return source;
  return source.replace(/(["'`])((?:\\.|(?!\\1)[^\\\\])*?)\\1/g, (literal, quote: string, value: string) => {
    if (quote === '`' && value.includes('${')) return literal;
    const rewritten = rewriteIdentifierTokens(value, renameMap);
    return rewritten === value ? literal : quote + rewritten + quote;
  });
}
