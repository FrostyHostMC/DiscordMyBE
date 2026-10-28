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
      if (componentsClose >= 0) {
        topLevelBody = body.slice(0, componentsAt) + body.slice(componentsClose + 1);
      }
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

export async function guardUnavailableEventSubscriptions(zip: JSZip, diagnostics?: string[]): Promise<number> {
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
    let updated = original.replace(
      /(\b[A-Za-z_$][\w$]*)\.(afterEvents|beforeEvents)\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?\.subscribe\s*\(/g,
      (_match, root: string, phase: string, eventGroup: string, eventName?: string) =>
        eventName
          ? root + '.' + phase + '.' + eventGroup + '?.' + eventName + '?.subscribe?.('
          : root + '.' + phase + '.' + eventGroup + '?.subscribe?.(',
    );
    updated = repairRecognizableLegacyItemStacks(updated, path, diagnostics ?? []).source;
    if (updated !== original) {
      zip.file(path, updated);
      changedFiles++;
      report('Applied generic Script API compatibility repairs in ' + path + '.');
    }
  }
  return changedFiles;
}
