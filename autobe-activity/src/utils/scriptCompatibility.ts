import type JSZip from 'jszip';

function matchingBrace(source: string, openAt: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = openAt; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch.charCodeAt(0) === 96) { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

function repairRecognizableLegacyItemStacks(source: string, path: string, diagnostics: string[]): { source: string; changed: boolean } {
  const declaration = /\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = declaration.exec(source))) {
    const openAt = source.indexOf('{', match.index);
    const closeAt = matchingBrace(source, openAt);
    if (closeAt < 0) continue;
    const variable = match[2];
    const body = source.slice(openAt + 1, closeAt);
    const typeId = body.match(/\btypeId\s*:\s*([^,\n]+)\s*,?/);
    const amount = body.match(/\bamount\s*:\s*(\d+)\s*,?/);
    const hasComponents = /\bcomponents\s*:\s*\{/.test(body);
    let topLevelBody = body;
    const componentsAt = body.search(/\bcomponents\s*:\s*\{/);
    if (componentsAt >= 0) {
      const componentsOpen = body.indexOf('{', componentsAt);
      const componentsClose = matchingBrace(body, componentsOpen);
      if (componentsClose >= 0) topLevelBody = body.slice(0, componentsAt) + body.slice(componentsClose + 1);
    }
    const topLevelProperties = [...topLevelBody
      .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""')
      .matchAll(/\b([A-Za-z_$][\w$]*)\s*:/g)]
      .map((entry) => entry[1])
      .filter((key) => key !== 'typeId' && key !== 'amount');
    const passedToInventory = new RegExp('\\.setItem\\s*\\([^,]+,\\s*' + variable + '\\s*\\)').test(source);
    const passedToSpawn = new RegExp('\\.spawnItem\\s*\\(\\s*' + variable + '\\s*,').test(source);
    if (!typeId || !amount || (!passedToInventory && !passedToSpawn)) {
      declaration.lastIndex = closeAt + 1;
      continue;
    }

    const keys = [...body.matchAll(/["'](minecraft:[A-Za-z0-9_]+)["']\s*:/g)].map((entry) => entry[1]);
    const allowed = new Set(['minecraft:item_lock', 'minecraft:can_destroy', 'minecraft:item_durability']);
    const unknown = [...new Set(keys)].filter((key) => !allowed.has(key));
    const lock = body.match(/["']minecraft:item_lock["']\s*:\s*\{\s*mode\s*:\s*["'](lock_in_slot|lock_in_inventory|none)["']\s*\}/);
    const emptyCanDestroy = /["']minecraft:can_destroy["']\s*:\s*\{\s*blocks\s*:\s*\[\s*\]\s*\}/s.test(body);
    const zeroDurability = /["']minecraft:item_durability["']\s*:\s*\{\s*damage\s*:\s*0\s*,\s*max_durability\s*:\s*0\s*\}/s.test(body);
    const hasLock = keys.includes('minecraft:item_lock');
    const hasCanDestroy = keys.includes('minecraft:can_destroy');
    const hasDurability = keys.includes('minecraft:item_durability');

    if (topLevelProperties.length > 0 || (!hasComponents && !/^\s*typeId\s*:\s*[^,]+,\s*amount\s*:\s*\d+\s*,?\s*$/.test(body)) || unknown.length || (hasLock && !lock) || (hasCanDestroy && !emptyCanDestroy) || (hasDurability && !zeroDurability)) {
      diagnostics.push('Possible legacy plain-object ItemStack in ' + path + ' (' + variable + ') was not rewritten because its component data is not fully recognized. It may fail at runtime; inspect this script and the Script API version.');
      declaration.lastIndex = closeAt + 1;
      continue;
    }

    const mode = lock?.[1] === 'lock_in_slot' ? 'slot' : lock?.[1] === 'lock_in_inventory' ? 'inventory' : 'none';
    const replacement = match[1] + ' ' + variable + ' = new AutoBEItemStack(' + typeId[1].trim() + ', ' + amount[1] + ');' +
      (lock ? '\n' + variable + '.lockMode = AutoBEItemLockMode.' + mode + ';' : '') +
      (hasCanDestroy ? '\n' + variable + '.setCanDestroy([]);' : '');
    edits.push({ start: match.index, end: closeAt + 1, replacement });
    diagnostics.push(
      'Converted legacy plain-object ItemStack ' + variable + ' in ' + path +
      (hasCanDestroy || hasDurability
        ? '. Empty can_destroy and zero durability data were normalized to default/no-op behavior; custom or non-empty payloads are never auto-converted.'
        : ' to the Script API ItemStack constructor.')
    );
    declaration.lastIndex = closeAt + 1;
  }

  if (!edits.length) return { source, changed: false };
  let updated = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    updated = updated.slice(0, edit.start) + edit.replacement + updated.slice(edit.end);
  }
  const needsLockMode = edits.some((edit) => edit.replacement.includes('AutoBEItemLockMode.'));
  if (!updated.includes('ItemStack as AutoBEItemStack')) {
    updated = 'import { ItemStack as AutoBEItemStack' +
      (needsLockMode ? ', ItemLockMode as AutoBEItemLockMode' : '') +
      ' } from "@minecraft/server";\n' + updated;
  } else if (needsLockMode && !updated.includes('ItemLockMode as AutoBEItemLockMode')) {
    updated = 'import { ItemLockMode as AutoBEItemLockMode } from "@minecraft/server";\n' + updated;
  }
  return { source: updated, changed: true };
}

/**
 * Guard statically-addressed Bedrock event signals without depending on an
 * allow-list of event names. Optional chaining is applied to every member in
 * the world/system event path and to subscribe itself, so an absent API in an
 * older target runtime does not abort the entire script module at load time.
 *
 * Computed event access (for example world.afterEvents[eventName]) cannot be
 * safely rewritten without evaluating the expression, so it is left intact and
 * surfaced as a diagnostic instead of guessed at.
 */
function guardEventSubscriptions(source: string, path: string, diagnostics: string[]): { source: string; changed: boolean } {
  const computedAccess = /\b(?:world|system)\s*(?:\.\s*(?:afterEvents|beforeEvents)|\?\.\s*(?:afterEvents|beforeEvents))\s*\[/;
  if (computedAccess.test(source)) {
    diagnostics.push('Computed Script API event access in ' + path + ' was not auto-rewritten. Verify the event exists before subscribing; AutoBE will not guess dynamic event names.');
  }

  const pattern = /\b([A-Za-z_$][\w$]*)((?:\s*(?:\?\.|\.)\s*[A-Za-z_$][\w$]*)+)\s*(?:\?\.|\.)\s*subscribe\s*(?:\?\.)?\s*\(/g;
  let changed = false;
  const updated = source.replace(pattern, (match: string, root: string, chain: string) => {
    if (!/(?:\.|\?\.)\s*(?:afterEvents|beforeEvents)(?:\.|\?\.)/.test(chain)) return match;
    changed = true;
    const safeChain = chain.replace(/\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g, (_part: string, name: string) => '?.' + name);
    return root + '?.' + safeChain.replace(/^\?\./, '') + '?.subscribe?.(';
  });
  if (changed) diagnostics.push('Guarded statically-addressed Script API event subscriptions in ' + path + ' without an event-name allow-list.');
  return { source: updated, changed };
}

/**
 * Do not rewrite arbitrary add-on JavaScript with regular expressions.
 *
 * A previous event-subscription guard matched text inside comments and could
 * comment out the opening of a callback while leaving its body active. That
 * produced invalid scripts in generated packs (for example, an orphaned
 * closing `});` in boss_attack_utils.js).
 *
 * Keep every source script byte-for-byte intact until an AST-based transform
 * can prove that edits preserve syntax and comment boundaries. Compatibility
 * issues are reported by archive/runtime validation instead of mutating code.
 */
export async function guardUnavailableEventSubscriptions(zip: JSZip, diagnostics?: string[]): Promise<number> {
  let scriptCount = 0;
  zip.forEach((path, file) => {
    if (!file.dir && /\\.(?:[cm]?js)$/i.test(path)) scriptCount++;
  });
  const message = 'Skipped automatic JavaScript source rewrites for ' + scriptCount +
    ' script file(s). AutoBE preserves original script bytes because regex-based event and ItemStack repairs can corrupt comments or syntax; compatibility changes require a syntax-validated AST transform.';
  if (diagnostics) diagnostics.push(message);
  else console.warn('[AutoBE] ' + message);
  return 0;
}
