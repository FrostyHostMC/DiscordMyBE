/**
 * Source-archive variable evidence.
 *
 * A converted animation reads `variable.<name>`, and the shipped pack is then expected to declare
 * it. When the declaration lived in a source document the export replaced (a player definition
 * overridden by the pack, an animation JSON that was not copied, a Molang file), the name arrives
 * in Bedrock with no value behind it and the engine reports it as unknown. Reviewing only the
 * generated pack cannot recover that value — the evidence is still in the archive the conversion
 * started from.
 *
 * This module reads the archive once and records, for every Molang variable name it can see:
 * the expression the source really assigns, the documents that mention it, and whether the value
 * is produced by Molang at all. Java-side assignments (a `MolangVariableMap.put("name", …)`) are
 * recorded as evidence with NO expression, because a Java expression cannot be shipped as Molang —
 * reporting that honestly is the only correct outcome for those.
 */

import type { ExtractedZipEntry } from '@/utils/zip';

export type SourceVariableOrigin = 'molang_assignment' | 'script_map' | 'referenced_only';

export interface SourceVariableRecord {
  name: string;
  /** Expressions the source archive assigns, verbatim. Empty when the source computes them in code. */
  expressions: string[];
  /** Archive paths that mention the name. */
  declaredIn: string[];
  origin: SourceVariableOrigin;
}

export interface SourceVariableEvidence {
  records: Map<string, SourceVariableRecord>;
  documentsScanned: number;
  withExpression: number;
  codeDriven: number;
  summary: string;
}

const decoder = new TextDecoder();
const TEXT_PATH = /\.(json5?|mcmeta|molang|animation|geo|java|js|ts|txt|properties)$/i;
const MAX_BYTES = 2 * 1024 * 1024;
/** Whole-pass budget: a modpack archive must not be decoded twice just to look for names. */
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;
const MAX_RECORDS = 600;
const MAX_FILES_PER_RECORD = 6;
const MAX_EXPRESSION_LENGTH = 160;

const ASSIGNMENT = /\bvariable\.([A-Za-z0-9_]+)\s*=(?!=)\s*([^;\n\r"]{1,160})/g;
const REFERENCE = /\bvariable\.([A-Za-z0-9_]+)/g;
const SCRIPT_MAP_PUT = /\.put\(\s*["']([A-Za-z0-9_]+)["']\s*,/g;

/**
 * Chunks a carried-over expression may consist of. Only queries and math are allowed: a source
 * expression that reads another `variable.` cannot be declared safely, because the scope binder
 * would have to guarantee that other variable is already evaluated — and a wrong order reports the
 * same "unknown variable" the pass is trying to remove.
 */
const SAFE_CHUNK = /^(?:(?:query|math)\.[A-Za-z0-9_.]+|true|false|[0-9.]+)$/;
const WORD_CHUNK = /[A-Za-z_][A-Za-z0-9_.]*|[0-9.]+/g;

/**
 * True when an expression can be shipped as Molang. Source archives also contain Java, and a Java
 * expression written into a client entity is a runtime error rather than a recovered value, so only
 * pure Molang is accepted.
 */
export function isMolangSafeExpression(expression: string): boolean {
  const stripped = expression.replace(/'[^']*'|"[^"]*"/g, ' ').trim();
  if (!stripped || stripped.length > MAX_EXPRESSION_LENGTH) return false;
  if (/[;{}[\]$#@]/.test(stripped)) return false;
  const words = stripped.match(WORD_CHUNK);
  if (!words) return false;
  return words.every((word) => SAFE_CHUNK.test(word));
}

export function collectSourceVariableEvidence(entries: ExtractedZipEntry[]): SourceVariableEvidence {
  const records = new Map<string, SourceVariableRecord>();
  let documentsScanned = 0;
  let bytesRead = 0;

  const touch = (rawName: string, path: string, expression: string | null, origin: SourceVariableOrigin): void => {
    const name = rawName.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!records.has(key) && records.size >= MAX_RECORDS) return;
    const record = records.get(key) ?? { name, expressions: [], declaredIn: [], origin: 'referenced_only' };
    if (!record.declaredIn.includes(path) && record.declaredIn.length < MAX_FILES_PER_RECORD) {
      record.declaredIn.push(path);
    }
    if (expression) {
      // Short-form queries (`q.anim_time`) are normalised so the expression is validated and later
      // translated in its canonical spelling.
      const value = expression
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\bq\./g, 'query.');
      if (value && !record.expressions.includes(value)) record.expressions.push(value);
      record.origin = 'molang_assignment';
    } else if (origin === 'script_map' && record.origin === 'referenced_only') {
      record.origin = 'script_map';
    } else if (origin === 'molang_assignment' && record.origin === 'referenced_only') {
      record.origin = 'molang_assignment';
    }
    records.set(key, record);
  };

  for (const entry of entries) {
    if (!entry || entry.isDirectory || !entry.path) continue;
    const path = entry.path.replace(/\\/g, '/');
    if (!TEXT_PATH.test(path)) continue;
    if (!entry.data || entry.data.length === 0 || entry.data.length > MAX_BYTES) continue;
    if (bytesRead + entry.data.length > MAX_TOTAL_BYTES) continue;
    bytesRead += entry.data.length;
    let text: string;
    try {
      text = decoder.decode(entry.data);
    } catch {
      continue;
    }
    const mentionsMolang = /molang/i.test(text);
    if (!text.includes('variable.') && !mentionsMolang) continue;
    documentsScanned += 1;

    if (/\.(java|js|ts)$/i.test(path)) {
      // Code-side assignment: the name is real evidence, the value is not a Molang expression.
      if (mentionsMolang) {
        for (const match of text.matchAll(SCRIPT_MAP_PUT)) touch(match[1], path, null, 'script_map');
      }
    } else {
      for (const match of text.matchAll(ASSIGNMENT)) touch(match[1], path, match[2], 'molang_assignment');
    }
    for (const match of text.matchAll(REFERENCE)) touch(match[1], path, null, 'referenced_only');
  }

  let withExpression = 0;
  let codeDriven = 0;
  for (const record of records.values()) {
    if (record.expressions.length > 0) withExpression += 1;
    else if (record.origin === 'script_map') codeDriven += 1;
  }

  const summary =
    `${documentsScanned} source document(s) scanned for Molang evidence: ${records.size} variable name(s) found — ` +
    `${withExpression} with an expression the archive actually assigns, ${codeDriven} produced by code with no Molang ` +
    'equivalent, the rest referenced only. Only whole Molang expressions are eligible to be carried over.';

  return { records, documentsScanned, withExpression, codeDriven, summary };
}