import JSZip from 'jszip';
import { sanitizeJsonString } from './addonParser';
import { mergeBehaviorEntity, mergeJsonData } from './behaviorEntityMerge';

/**
 * Port of AutoBE Part 16 identifier-based definition merging (_process_packs):
 * entities/items/blocks that share the same identifier but arrive from
 * different packs (or at different file paths) are deep-merged into a single
 * definition so Bedrock sees one authoritative copy instead of last-wins.
 */

type Kind = 'entity' | 'item' | 'block';

const KIND_ROOT_KEYS: Record<Kind, string> = {
  entity: 'minecraft:entity',
  item: 'minecraft:item',
  block: 'minecraft:block'
};

/** Client-entity files live under entity/ with the client_entity root key. */
function classify(path: string): { kind: Kind; client: boolean } | null {
  const lower = path.toLowerCase();
  if (lower.includes('entities/player.json') || lower === 'entity/player.json' || lower === 'entity/player.entity.json') return null;
  if (lower.includes('entity/') && !lower.includes('entities/')) {
    return lower.includes('animation') || lower.includes('render_controller') ? null : { kind: 'entity', client: true };
  }
  if (lower.includes('entities/')) return { kind: 'entity', client: false };
  if (lower.includes('items/')) return { kind: 'item', client: false };
  if (lower.includes('blocks/')) return { kind: 'block', client: false };
  return null;
}

function extractIdentifier(kind: Kind, data: any, client: boolean): string | null {
  const rootKey = client ? 'minecraft:client_entity' : KIND_ROOT_KEYS[kind];
  const id = data?.[rootKey]?.description?.identifier;
  return typeof id === 'string' && id !== 'minecraft:player' ? id : null;
}

/**
 * Merge duplicate-identifier entity/item/block definitions within a built
 * output zip. Multiple files for one identifier are combined and only the
 * first file's path keeps the merged content.
 */
export async function mergeDefinitionsByIdentifier(zip: JSZip): Promise<void> {
  interface Entry {
    path: string;
    kind: Kind;
    client: boolean;
    data: any;
  }
  const byId = new Map<string, Entry[]>();
  const all: Entry[] = [];

  const loads: Promise<void>[] = [];
  zip.forEach((path, f) => {
    if (f.dir || !path.toLowerCase().endsWith('.json')) return;
    const cls = classify(path);
    if (!cls) return;
    loads.push(
      f
        .async('text')
        .then((txt) => {
          const data = JSON.parse(sanitizeJsonString(txt));
          const id = extractIdentifier(cls.kind, data, cls.client);
          if (!id) return;
          const entry: Entry = { path, kind: cls.kind, client: cls.client, data };
          all.push(entry);
          const arr = byId.get(id) ?? [];
          arr.push(entry);
          byId.set(id, arr);
        })
        .catch(() => undefined)
    );
  });
  await Promise.all(loads);

  for (const [, entries] of byId) {
    if (entries.length < 2) continue;
    const rootKey = entries[0].client ? 'minecraft:client_entity' : KIND_ROOT_KEYS[entries[0].kind];
    let merged: any;
    if (entries[0].kind === 'entity' && !entries[0].client) {
      // Port of AutoBE Part 17 _merge_behavior_entity: conflicting root
      // components are routed into per-pack component groups activated via
      // minecraft:entity_spawned so no addon's values are silently dropped.
      merged = mergeBehaviorEntity(
        entries.map((e) => ({ packName: e.path.replace(/\.json$/i, ''), data: e.data }))
      );
    } else {
      // Use smart merge (mergeJsonData) for client entities, items, blocks
      // This properly handles texture arrays with union-deduplication
      merged = structuredClone(entries[0].data);
      for (let i = 1; i < entries.length; i++) {
        mergeJsonData(merged, entries[i].data);
      }
    }
    // Keep the original identifier on the merged definition
    if (merged?.[rootKey]?.description) {
      const keepId = extractIdentifier(entries[0].kind, entries[0].data, entries[0].client);
      if (keepId) merged[rootKey].description.identifier = keepId;
    }
    // Sanitize geometry/textures/materials for client entities to prevent Molang errors
    if (entries[0].client && entries[0].kind === 'entity') {
      const desc = merged?.[rootKey]?.description;
      if (desc && typeof desc === 'object') {
        for (const aliasKey of ['geometry', 'textures', 'materials', 'animations']) {
          if (aliasKey in desc && typeof desc[aliasKey] === 'object') {
            desc[aliasKey] = Object.fromEntries(
              Object.entries(desc[aliasKey]).filter(([k, v]) => k && v && String(k).trim() && String(v).trim())
            );
          }
        }
      }
    }
    const keepPath = entries[0].path;
    const client = entries[0].client;
    for (const e of entries.slice(1)) {
      if (client && e.path === 'entity/player.entity.json') continue;
      zip.remove(e.path);
    }
    zip.file(keepPath, JSON.stringify(merged, null, 2));
  }
}