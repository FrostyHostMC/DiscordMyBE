import JSZip from 'jszip';
import { sanitizeJsonString } from './addonParser';
import { mergeAdditions, preserveConflict } from './conservativeMerge';

/** Definitions with the same identifier must not be blindly overwritten.
 * Only merge unambiguous additions; leave differing existing values for review. */
type Kind = 'entity' | 'item' | 'block' | 'attachable' | 'spawn_rule';
const ROOTS: Record<Kind, string> = {
  entity: 'minecraft:entity', item: 'minecraft:item', block: 'minecraft:block', attachable: 'minecraft:attachable', spawn_rule: 'minecraft:spawn_rules'
};
function classify(path: string): { kind: Kind; client: boolean } | null {
  const lower = path.toLowerCase();
  if (lower.startsWith('entity/')) return { kind: 'entity', client: true };
  if (lower.startsWith('entities/')) return { kind: 'entity', client: false };
  if (lower.startsWith('attachables/')) return { kind: 'attachable', client: false };
  if (lower.startsWith('spawn_rules/')) return { kind: 'spawn_rule', client: false };
  if (lower.startsWith('items/')) return { kind: 'item', client: false };
  if (lower.startsWith('blocks/')) return { kind: 'block', client: false };
  return null;
}

function mergeSpawnRuleAdditions(base: any, incoming: any): { value: any; changed: boolean; conflicts: string[] } {
  const root = 'minecraft:spawn_rules';
  const baseCopy = structuredClone(base);
  const incomingCopy = structuredClone(incoming);
  const baseConditions = Array.isArray(baseCopy?.[root]?.conditions) ? baseCopy[root].conditions : [];
  const incomingConditions = Array.isArray(incomingCopy?.[root]?.conditions) ? incomingCopy[root].conditions : [];
  const combined = [...baseConditions];
  const seen = new Set(combined.map(condition => JSON.stringify(condition)));
  for (const condition of incomingConditions) {
    const fingerprint = JSON.stringify(condition);
    if (!seen.has(fingerprint)) { combined.push(condition); seen.add(fingerprint); }
  }
  if (baseCopy?.[root]) baseCopy[root].conditions = combined;
  if (incomingCopy?.[root]) incomingCopy[root].conditions = combined;
  return mergeAdditions(baseCopy, incomingCopy);
}

export async function mergeDefinitionsByIdentifier(zip: JSZip, diagnostics: string[] = [], packType?: 'resource' | 'behavior'): Promise<void> {
  type Entry = { path: string; data: any; bytes: Uint8Array; kind: Kind; identifier: string };
  const byId = new Map<string, Entry[]>();
  // Sequential reads preserve source insertion/priority order.
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir || !path.toLowerCase().endsWith('.json')) continue;
    const cls = classify(path);
    if (!cls) continue;
    // Client and behavior entities belong to separate pack folders.
    if (cls.kind === 'entity' && packType && cls.client !== (packType === 'resource')) continue;
    try {
      const bytes = await file.async('uint8array');
      const data = JSON.parse(sanitizeJsonString(new TextDecoder().decode(bytes)));
      const root = cls.client ? 'minecraft:client_entity' : ROOTS[cls.kind];
      const id = data?.[root]?.description?.identifier;
      if (typeof id !== 'string') continue;
      const key = `${root}:${id}`;
      const entries = byId.get(key) || [];
      entries.push({ path, data, bytes, kind: cls.kind, identifier: id });
      byId.set(key, entries);
    } catch { /* Keep unreadable files untouched; validation reports them. */ }
  }
  for (const entries of byId.values()) {
    if (entries.length < 2) continue;
    const first = entries[0];
    let merged = first.data;
    let changed = false;
    for (const entry of entries.slice(1)) {
      const result = entry.kind === 'spawn_rule'
        ? mergeSpawnRuleAdditions(merged, entry.data)
        : mergeAdditions(merged, entry.data);
      // Different attachable rigs must never be combined just because their
      // individual fields happen to be disjoint.
      // Attachable definitions describe one complete visual rig. Combining
      // disjoint fields from two rigs can create invalid geometry/texture wiring,
      // so keep that category atomic. For item/block/entity definitions, retain
      // safe additions even when one or more individual values disagree.
      const atomicRigConflict = entry.kind === 'attachable' && (result.changed || result.conflicts.length > 0);
      if (atomicRigConflict) {
        const backup = preserveConflict(zip, entry.path, entry.bytes, 'definitions');
        diagnostics.push(`WARNING DEFINITION_CONFLICT [${entry.identifier}]: ${entry.path} contains an incompatible attachable rig relative to ${first.path}. Kept the first rig active and saved the complete alternative as ${backup}; manual review is required.`);
      } else {
        merged = result.value;
        changed ||= result.changed;
        if (result.conflicts.length > 0) {
          const backup = preserveConflict(zip, entry.path, entry.bytes, 'definitions');
          diagnostics.push(`WARNING DEFINITION_PARTIAL_CONFLICT [${entry.identifier}]: Kept compatible additions from ${entry.path} in ${first.path}; retained the first value at ${result.conflicts.slice(0, 5).join(', ')} and saved the complete incoming definition as ${backup} for review.`);
        } else if (result.changed) {
          diagnostics.push(`INFO DEFINITION_MERGED [${entry.identifier}]: Added non-conflicting fields from ${entry.path} to ${first.path}.`);
        }
      }
      zip.remove(entry.path);
    }
    if (changed) zip.file(first.path, JSON.stringify(merged, null, 2));
  }
}
