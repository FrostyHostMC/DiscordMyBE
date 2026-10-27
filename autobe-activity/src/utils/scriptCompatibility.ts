/**
 * Repairs a legacy Script API pattern found in some Bedrock add-ons:
 * treating a plain { typeId, amount, components } object as an ItemStack.
 *
 * This is deliberately structural, not pack-name-specific. It only rewrites
 * objects that declare a vanilla item_lock with lock_in_slot and are used as
 * script-created inventory items. Unsupported legacy item components are
 * omitted; the Script API's ItemStack.lockMode is the supported equivalent.
 */
export function repairLegacyItemStackScript(
  source: string,
  diagnostics?: string[],
  sourcePath = 'script'
): string {
  let output = source;
  const report = (message: string) => {
    diagnostics?.push(message);
  };

  // Locate object-literal assignments, then use brace balancing rather than a
  // greedy regex so nested component objects are handled safely.
  const assignment = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = assignment.exec(source)) !== null) {
    const variableName = match[1];
    const openBrace = source.indexOf('{', match.index + match[0].length - 1);
    if (openBrace < 0) continue;

    let depth = 0;
    let quote = '';
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    let endBrace = -1;

    for (let i = openBrace; i < source.length; i++) {
      const ch = source[i];
      const next = source[i + 1];
      if (lineComment) {
        if (ch === '\n') lineComment = false;
        continue;
      }
      if (blockComment) {
        if (ch === '*' && next === '/') { blockComment = false; i++; }
        continue;
      }
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
      if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) { endBrace = i; break; }
      }
    }
    if (endBrace < 0) continue;

    const objectText = source.slice(openBrace, endBrace + 1);
    const typeId = objectText.match(/\btypeId\s*:\s*([^,\n}]+)/);
    const amount = objectText.match(/\bamount\s*:\s*([^,\n}]+)/);
    const hasLegacyLock = /["']minecraft:item_lock["']\s*:\s*\{[\s\S]*?\bmode\s*:\s*["']lock_in_slot["']/i.test(objectText);
    const hasComponents = /\bcomponents\s*:\s*\{/.test(objectText);
    const hasInventoryUse = new RegExp('\\\\b(?:inventory|\\\\w+Inventory|container)\\\\s*\\\\.\\\\s*(?:setItem|addItem)\\\\s*\\\\([^;]{0,500}\\\\b' + variableName + '\\\\b').test(source);
    if (!typeId || !amount || !hasLegacyLock || !hasComponents || !hasInventoryUse) continue;

    const declarationStart = match.index;
    let declarationEnd = endBrace + 1;
    while (/\s/.test(source[declarationEnd] || '') && source[declarationEnd] !== '\n') declarationEnd++;
    if (source[declarationEnd] === ';') declarationEnd++;
    const typeExpression = typeId[1].trim();
    const amountExpression = amount[1].trim();
    replacements.push({
      start: declarationStart,
      end: declarationEnd,
      text: source.slice(declarationStart, openBrace).replace(/\s*$/, ' ') +
        'new ItemStack(' + typeExpression + ', ' + amountExpression + ');\n' +
        '    ' + variableName + '.lockMode = ItemLockMode.slot;'
    });
    assignment.lastIndex = endBrace + 1;
  }

  if (replacements.length === 0) return output;
  for (const replacement of replacements.reverse()) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
  }

  const serverImport = /import\s*\{([^}]+)\}\s*from\s*(["'])@minecraft\/server\2\s*;/;
  const existingImport = output.match(serverImport);
  if (existingImport) {
    const names = existingImport[1].split(',').map((name) => name.trim()).filter(Boolean);
    if (!names.some((name) => /^(?:ItemStack)(?:\s+as\s+\w+)?$/.test(name))) names.push('ItemStack');
    if (!names.some((name) => /^(?:ItemLockMode)(?:\s+as\s+\w+)?$/.test(name))) names.push('ItemLockMode');
    output = output.replace(serverImport, 'import { ' + names.join(', ') + ' } from ' + existingImport[2] + '@minecraft/server' + existingImport[2] + ';');
  } else {
    output = 'import { ItemStack, ItemLockMode } from "@minecraft/server";\n' + output;
  }

  report(
    'Repaired ' + replacements.length + ' legacy item object(s) in ' + sourcePath +
    ' to use the Script API ItemStack and lockMode APIs.'
  );
  return output;
}
