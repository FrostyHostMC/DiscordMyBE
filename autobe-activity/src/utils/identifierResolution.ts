// Ported from AutoBE.py IdentifierManager (Part 2/19) — conflict resolution,
// BP/RP half matching, user resolution, identifier mappings and reference updates.
// All remote/token/HWID/activation logic stripped. Pure local logic only.

import type { PackIdentifiers } from '@/utils/identifierManager';

/** Strip AutoBE internal suffixes so BP/RP halves of the same addon compare equal. */
export function packBaseName(packPath: string): string {
  let name = packPath.split('/').pop() ?? packPath;
  name = name.replace(/\.(mcpack|mcaddon)$/i, '');
  name = name.replace(/_modified$/i, ''); // subpack-extracted temp copy
  name = name.replace(/_\d+$/, ''); // _N split suffix
  // Strip common BP/RP half suffixes so paired addon halves resolve together
  name = name.replace(/[-_\s]*(bp|rp|behaviors?|resources?|behavior[-_]?pack|resource[-_]?pack)$/i, '');
  return name.toLowerCase();
}

/** Namespaces never renamed or flagged — vanilla modifications deep-merge instead. */
const SKIP_NAMESPACES = new Set(['minecraft', 'loot_tables']);

/**
 * Manages identifier conflicts across packs:
 * conflict detection, BP/RP half filtering, per-conflict user resolution
 * ("keep one pack" vs "keep all") and reference updating.
 */
export class IdentifierManager {
  private packIdentifiers = new Map<string, PackIdentifiers>();
  private conflictMap = new Map<string, Set<string>>(); // identifier -> pack paths
  private userResolution = new Map<string, string | null>();
  private identifierMapping = new Map<string, string>(); // `${packPath}\u0000${id}` -> new id
  private packNamespaces = new Map<string, string>();

  /**
   * Aggregate identifiers across all packs and detect conflicts.
   * Minecraft/loot_tables namespaces are skipped entirely (deep-merged, never renamed).
   */
  detectConflicts(allPackIdentifiers: Record<string, PackIdentifiers>): void {
    this.packIdentifiers = new Map(Object.entries(allPackIdentifiers));
    this.conflictMap.clear();
    for (const [packPath, identifiers] of this.packIdentifiers.entries()) {
      for (const idSet of Object.values(identifiers)) {
        for (const identifier of idSet) {
          const ns = identifier.includes(':') ? identifier.split(':')[0] : '';
          if (SKIP_NAMESPACES.has(ns)) continue;
          const owners = this.conflictMap.get(identifier) ?? new Set<string>();
          owners.add(packPath);
          this.conflictMap.set(identifier, owners);
        }
      }
    }
    // Generate a unique namespace prefix per pack (reserved for future rename modes)
    for (const packPath of this.packIdentifiers.keys()) {
      const base = packPath.split('/').pop() ?? packPath;
      const clean = base.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20);
      this.packNamespaces.set(packPath, `${clean}_merge`);
    }
  }

  /** All real conflicts. BP/RP halves of the same addon are excluded (false conflicts). */
  getConflictList(): Array<{ identifier: string; packPaths: string[] }> {
    const result: Array<{ identifier: string; packPaths: string[] }> = [];
    for (const [identifier, packs] of this.conflictMap.entries()) {
      if (packs.size <= 1) continue;
      const baseNames = new Set([...packs].map(packBaseName));
      if (baseNames.size === 1) continue; // halves of the same addon
      result.push({ identifier, packPaths: [...packs] });
    }
    return result;
  }

  /** User choice for a conflicted identifier: pack path to keep, or null to keep all. */
  setUserResolution(identifier: string, packPathOrNone: string | null): void {
    this.userResolution.set(identifier, packPathOrNone);
  }

  /** Whether this pack's definition of the identifier should enter the merge. */
  shouldIncludeDefinition(packPath: string, identifier: string): boolean {
    if (!this.userResolution.has(identifier)) return true;
    const keep = this.userResolution.get(identifier);
    if (keep === null || keep === undefined) return true;
    return packPath === keep;
  }

  /**
   * Generate identifier mappings. "Keep all" (default) creates no rename —
   * definitions deep-merge under the original identifier so every reference stays valid.
   * Only "Keep one pack" produces mapping entries (other packs are filtered).
   */
  generateIdentifierMappings(): void {
    this.identifierMapping.clear();
    for (const [identifier, packs] of this.conflictMap.entries()) {
      if (packs.size <= 1) continue;
      const keepPack = this.userResolution.get(identifier);
      if (keepPack != null) {
        for (const packPath of packs) {
          this.identifierMapping.set(`${packPath}\u0000${identifier}`, identifier);
        }
      }
    }
  }

  getNewIdentifier(packPath: string, oldIdentifier: string): string {
    return this.identifierMapping.get(`${packPath}\u0000${oldIdentifier}`) ?? oldIdentifier;
  }

  shouldRenameIdentifier(identifier: string): boolean {
    return (this.conflictMap.get(identifier)?.size ?? 0) > 1;
  }

  /** Recursively update identifier fields and references in parsed JSON data. */
  updateJsonIdentifiers(jsonData: unknown, packPath: string): unknown {
    if (Array.isArray(jsonData)) {
      return jsonData.map((item) => this.updateJsonIdentifiers(item, packPath));
    }
    if (jsonData && typeof jsonData === 'object') {
      const updated: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(jsonData)) {
        if (key === 'identifier' && typeof value === 'string') {
          updated[key] = this.getNewIdentifier(packPath, value);
        } else if (
          ['entity', 'item', 'block', 'loot_table', 'recipe'].includes(key) &&
          typeof value === 'string'
        ) {
          updated[key] = this.getNewIdentifier(packPath, value);
        } else {
          updated[key] = this.updateJsonIdentifiers(value, packPath);
        }
      }
      return updated;
    }
    if (typeof jsonData === 'string' && jsonData.includes(':') && !jsonData.startsWith('http')) {
      return this.getNewIdentifier(packPath, jsonData);
    }
    return jsonData;
  }

  /** Update identifier references in text content (scripts, lang files). */
  updateTextIdentifiers(text: string, packPath: string): string {
    const pattern = /\b([a-zA-Z0-9_]+:[a-zA-Z0-9_./]+)\b/g;
    return text.replace(pattern, (oldId) => this.getNewIdentifier(packPath, oldId));
  }
}