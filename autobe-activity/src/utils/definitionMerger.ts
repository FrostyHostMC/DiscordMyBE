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

function compareFormatVersions(a: unknown, b: unknown): number {
  const parts = (value: unknown) => String(value ?? '0.0.0').split('.').map(part => Number.parseInt(part, 10) || 0);
  const left = parts(a), right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] || 0) - (right[i] || 0);
    if (difference) return difference;
  }
  return 0;
}

function highestFormatVersion(a: any, b: any): unknown {
  return compareFormatVersions(a?.format_version, b?.format_version) >= 0
    ? a?.format_version : b?.format_version;
}

const BLOCK_STRUCTURAL_CONFLICTS = [
  'minecraft:block.description.states',
  'minecraft:block.permutations',
  'minecraft:block.components.minecraft:collision_box',
  'minecraft:block.components.minecraft:selection_box',
  'minecraft:block.components.minecraft:geometry',
  'minecraft:block.components.minecraft:custom_components'
];

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
  const result = mergeAdditions(baseCopy, incomingCopy);
  return { ...result, changed: result.changed || combined.length > baseConditions.length };
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
      // format_version describes the schema version, not a competing gameplay
      // value. Keep the newest declaration while comparing the actual content.
      const incoming = structuredClone(entry.data);
      const currentFormatVersion = merged?.format_version;
      const selectedFormatVersion = highestFormatVersion(merged, incoming);
      if (selectedFormatVersion !== undefined) {
        if (selectedFormatVersion !== currentFormatVersion) {
          merged = structuredClone(merged);
          merged.format_version = selectedFormatVersion;
          changed = true;
        }
        incoming.format_version = selectedFormatVersion;
      }
      const result = entry.kind === 'spawn_rule'
        ? mergeSpawnRuleAdditions(merged, incoming)
        : mergeAdditions(merged, incoming);
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
          if (entry.kind === 'block') {
            const structural = result.conflicts.filter(path => BLOCK_STRUCTURAL_CONFLICTS.some(key => path === key || path.startsWith(key + '.')));
            if (structural.length) diagnostics.push(`WARNING DEFINITION_STRUCTURAL_CONFLICT [${entry.identifier}]: Conflicting block state, permutation, geometry, selection-box, collision-box or custom-component data was not combined. The higher-priority definition in ${first.path} remains active; the complete alternative is preserved at ${backup}. Review this block before release.`);
          }
        } else if (result.changed) {
          diagnostics.push(`INFO DEFINITION_MERGED [${entry.identifier}]: Added non-conflicting fields from ${entry.path} to ${first.path}.`);
        }
      }
      zip.remove(entry.path);
    }
    if (changed) zip.file(first.path, JSON.stringify(merged, null, 2));
  }
}
