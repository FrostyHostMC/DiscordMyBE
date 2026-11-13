import type { PackFile } from '@/utils/entityTextureVariants';
import { readPngHeader } from '@/utils/textureMetadata';
import { resolveEntityMaterial } from '@/utils/entityMaterials';

/**
 * Client entity linker.
 *
 * A mob is only visible when the RESOURCE pack carries
 * `entity/<name>.entity.json` binding that entity to a geometry identifier a shipped model
 * really declares and to a skin PNG the pack really ships. A behavior pack that defines an
 * entity without that counterpart is the "invisible mob" failure: the entity exists, its AI
 * runs, but nothing tells the client which model and sheet to draw.
 *
 * The file generated here is derived only from evidence already in the pack:
 *   • geometry — an identifier parsed out of a shipped `models/**\/*.geo.json`,
 *   • texture  — a PNG shipped under `textures/entity/**`,
 *   • material — chosen from that PNG's own IHDR header (alpha ⇒ cutout material).
 * When no model or no skin ships for the entity, NO file is written and the entity is
 * reported UNRESOLVED — a fabricated rig would hide the missing source asset.
 */

export const CLIENT_ENTITY_LINK_RULE =
  'Every behavior entity must have a client entity file that binds a geometry identifier a shipped model declares and a texture path a shipped PNG resolves to; the file is generated from that evidence or the entity is reported UNRESOLVED.';

const MAX_GENERATED = 120;

export interface ClientEntityGenerationReport {
  behaviorEntities: number;
  created: number;
  /** `entity identifier -> geometry identifier` actually bound. */
  geometryBound: string[];
  /** `entity identifier -> texture path` actually bound. */
  texturesBound: string[];
  /** Entities left without a client entity, with the missing evidence named. */
  unresolved: string[];
}

interface GeometryEntry {
  identifier: string;
  reduced: string;
}

interface SkinEntry {
  /** Full path without the `.png` extension. */
  path: string;
  reduced: string;
  inEntityFolder: boolean;
}

function parseJson(raw: PackFile | undefined): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function reduced(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function safeFileStem(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'entity';
}

/** Loose identity match used for both models and skins (`capac` ↔ `inka_capac`). */
function sameIdentity(candidate: string, wanted: string): boolean {
  if (!candidate || !wanted) return false;
  if (candidate === wanted) return true;
  if (candidate.length < 4 || wanted.length < 4) return false;
  return candidate.endsWith(wanted) || wanted.endsWith(candidate);
}

/** Behavior entities that declare an identifier, with vanilla ones excluded. */
function collectBehaviorEntities(
  bp: Record<string, PackFile>,
): Array<{ identifier: string; short: string }> {
  const entities: Array<{ identifier: string; short: string }> = [];
  const seen = new Set<string>();
  for (const path of Object.keys(bp)) {
    if (!/^entities\/[^/]+\.json$/i.test(path)) continue;
    const doc = parseJson(bp[path]);
    const identifier = doc?.['minecraft:entity']?.description?.identifier;
    if (typeof identifier !== 'string' || !identifier.trim()) continue;
    const clean = identifier.trim();
    if (clean.toLowerCase().startsWith('minecraft:') || seen.has(clean)) continue;
    const short = clean.split(':').pop() ?? '';
    if (!short) continue;
    seen.add(clean);
    entities.push({ identifier: clean, short });
  }
  return entities;
}

function collectClientIdentifiers(rp: Record<string, PackFile>): Set<string> {
  const identifiers = new Set<string>();
  for (const path of Object.keys(rp)) {
    if (!/^entity\/[^/]+\.entity\.json$/i.test(path)) continue;
    const identifier = parseJson(rp[path])?.['minecraft:client_entity']?.description?.identifier;
    if (typeof identifier === 'string' && identifier.trim()) identifiers.add(identifier.trim());
  }
  return identifiers;
}

/** Geometry identifiers declared by shipped geometry documents. */
function collectGeometryIds(rp: Record<string, PackFile>): GeometryEntry[] {
  const entries: GeometryEntry[] = [];
  for (const path of Object.keys(rp)) {
    if (!/^models\/.+\.json$/i.test(path)) continue;
    const doc = parseJson(rp[path]);
    const geometries = doc?.['minecraft:geometry'];
    if (!Array.isArray(geometries)) continue;
    for (const geometry of geometries) {
      const identifier = geometry?.description?.identifier;
      if (typeof identifier !== 'string' || !identifier.trim()) continue;
      entries.push({ identifier: identifier.trim(), reduced: reduced(identifier) });
    }
  }
  return entries;
}

/** Entity skins the pack really ships (binary PNG payloads only). */
function collectEntitySkins(rp: Record<string, PackFile>): SkinEntry[] {
  const skins: SkinEntry[] = [];
  for (const path of Object.keys(rp)) {
    const normalized = path.replace(/\\/g, '/');
    if (!/^textures\/.+\.png$/i.test(normalized)) continue;
    const lower = normalized.toLowerCase();
    const inEntityFolder =
      lower.startsWith('textures/entity/') || lower.startsWith('textures/models/entity/') || lower.startsWith('textures/entities/');
    const bytes = rp[path];
    if (!(bytes instanceof Uint8Array)) continue;
    const stem = lower.split('/').pop() ?? '';
    skins.push({ path: normalized.slice(0, -4), reduced: reduced(stem.replace(/\.png$/, '')), inEntityFolder });
  }
  return skins;
}

function pickGeometry(entries: GeometryEntry[], wanted: string): GeometryEntry | null {
  const exact = entries.find((entry) => entry.reduced === wanted);
  if (exact) return exact;
  return entries.find((entry) => sameIdentity(entry.reduced, wanted)) ?? null;
}

function pickSkin(entries: SkinEntry[], wanted: string): SkinEntry | null {
  const identity = entries.filter((entry) => entry.reduced === wanted);
  const pool = identity.length > 0 ? identity : entries.filter((entry) => sameIdentity(entry.reduced, wanted));
  if (pool.length === 0) return null;
  // The client resolves mob skins from textures/entity first; then the shortest path.
  return [...pool].sort((a, b) => {
    if (a.inEntityFolder !== b.inEntityFolder) return a.inEntityFolder ? -1 : 1;
    return a.path.split('/').length - b.path.split('/').length;
  })[0];
}

/**
 * Generates the missing client entity file for every behavior-defined entity that ships
 * both a model and a skin. Idempotent: an entity that already has a client entity, or a
 * path already occupied by a different file, is never overwritten.
 */
export function generateMissingClientEntities(input: {
  modId: string;
  resourcePackFiles: Record<string, PackFile>;
  behaviorPackFiles: Record<string, PackFile>;
  onLog?: (line: string) => void;
}): ClientEntityGenerationReport {
  const { resourcePackFiles: rp, behaviorPackFiles: bp } = input;
  const log = (line: string) => input.onLog?.(line);
  const report: ClientEntityGenerationReport = {
    behaviorEntities: 0,
    created: 0,
    geometryBound: [],
    texturesBound: [],
    unresolved: [],
  };

  const behavior = collectBehaviorEntities(bp);
  report.behaviorEntities = behavior.length;
  if (behavior.length === 0) return report;

  const clients = collectClientIdentifiers(rp);
  const geometries = collectGeometryIds(rp);
  const skins = collectEntitySkins(rp);

  for (const entity of behavior) {
    if (clients.has(entity.identifier)) continue;
    if (report.created >= MAX_GENERATED) {
      report.unresolved.push(`${entity.identifier} (generation budget of ${MAX_GENERATED} files reached)`);
      continue;
    }
    const wanted = reduced(entity.short);
    const geometry = pickGeometry(geometries, wanted);
    const skin = pickSkin(skins, wanted);

    if (!geometry || !skin) {
      const lacking = [geometry ? null : 'model', skin ? null : 'skin'].filter(Boolean).join(' and ');
      report.unresolved.push(`${entity.identifier} (no shipped ${lacking})`);
      log(
        `[CLIENT-ENTITY:UNRESOLVED] Behavior entity "${entity.identifier}" has behavior but no client entity, and this pack ships no ${lacking} to bind — no file is written and no rig is invented, so the entity is reported instead of shipping a guessed model.`,
      );
      continue;
    }

    const path = `entity/${safeFileStem(entity.short)}.entity.json`;
    if (rp[path] !== undefined) {
      report.unresolved.push(`${entity.identifier} (${path} already occupied by a different definition)`);
      continue;
    }

    const bytes = rp[`${skin.path}.png`];
    const material = resolveEntityMaterial(
      readPngHeader(bytes instanceof Uint8Array ? bytes : null),
      Boolean(rp[`${skin.path}_e.png`]),
    );

    const doc = {
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: entity.identifier,
          materials: { default: material.material },
          textures: { default: skin.path },
          geometry: { default: geometry.identifier },
          render_controllers: ['controller.render.default'],
        },
      },
    };

    rp[path] = JSON.stringify(doc, null, 2);
    clients.add(entity.identifier);
    report.created += 1;
    report.geometryBound.push(`${entity.identifier} -> ${geometry.identifier}`);
    report.texturesBound.push(`${entity.identifier} -> ${skin.path}`);
    log(
      `[CLIENT-ENTITY] Generated ${path} for behavior entity "${entity.identifier}": geometry ${geometry.identifier} (declared by a shipped model), texture ${skin.path}.png (${material.evidence}), render controller controller.render.default. Without this file the mob has behavior but no visual definition and renders invisible.`,
    );
  }

  return report;
}