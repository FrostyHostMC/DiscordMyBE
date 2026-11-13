import type { ExtractedZipEntry } from '@/utils/zip';
import { safeFileId } from '@/utils/bedrockIds';
import type { AssetIndex, JavaElement, JavaModel } from '@/utils/assetIndex';
import { normKey, resolveModelTexture } from '@/utils/assetIndex';
import { normalizeAssetIdentifier, normalizeAssetPath } from '@/utils/identifierNormalization';
import {
  convertJavaModelDocument,
  convertJavaEntityModelToBedrockGeometry,
} from '@/utils/javaModelConverter';
import { summarizeBlockStateCoverage } from '@/utils/blockstateModelResolver';
import { buildModelDependencyReport } from '@/utils/modelDependencyTracker';
import {
  findAttachmentAnchorsFromGeometry,
  resolveEquipmentAttachments,
} from '@/utils/equipmentAttachments';
import { pow2Sheet, roundUv } from '@/utils/uvMapping';
import { canonicalGeometryId } from '@/utils/geometryRegistry';
import { convertObjToPolyMesh, convertPolyMeshDocument, looksLikePolyMeshDocument } from '@/utils/polyMeshConverter';
import { convertBbModel, looksLikeBbModel } from '@/utils/bbmodelImporter';
import { convertTabulaModel, looksLikeTabulaModel } from '@/utils/tabulaImporter';
import { convertCemModel, looksLikeCemModel } from '@/utils/optifineCemImporter';
import { scanModelSources, type ModelSourceRegistryReport } from '@/utils/universalModelRegistry';
import type { MobResourceLink } from '@/utils/mobLinking';

export interface ModelPortStats {
  modModelsParsed: number;
  geckolibModelsFound: number;
  javaEntityModelsConverted: number;
  polyMeshModelsConverted: number;
  /** Blockbench `.bbmodel` documents converted into Bedrock geometry. */
  blockbenchModelsConverted: number;
  /** Tabula `.tbl` / Tabula JSON documents converted into Bedrock geometry. */
  tabulaModelsConverted: number;
  /** OptiFine CEM `.jem` / `.jpm` documents converted into Bedrock geometry. */
  cemModelsConverted: number;
  elementsConvertedCount: number;
  riggedMobGeometriesGenerated: number;
  flat2DItemsCount: number;
  approximateFallbackCount: number;
  modelDependencyIssues: number;
  orphanTextures: number;
  equipmentAttachments: number;
  /** Modelling documents the universal source registry classified. */
  modelSourcesDiscovered: number;
  /** Mobs bound to geometry recovered from the archive (never a rig template). */
  authenticMobModels: number;
  /** Source part names carried verbatim into a shipped skeleton. */
  skeletonPartsPreserved: number;
  /** Bones re-parented from the source's own bounds/name evidence. */
  skeletonPartsReparented: number;
  /** Documents that needed a synthetic single root because they declared several. */
  skeletonRootsAdded: number;
  /** Mobs that still ship on a generated rig because no source model exists at all. */
  mobsWithoutAuthenticModel: string[];
}

export interface ExtractedGeometry {
  id: string;
  json: string;
  /** `poly_mesh` is a real polygon model: it renders from polygons, not cubes. */
  source: 'geckolib' | 'java_elements' | 'poly_mesh' | 'blockbench' | 'tabula' | 'optifine_cem' | 'rigged_template' | 'approximate';
  bonesCount: number;
  cubesCount: number;
  /** Polygon count of a `poly_mesh` model (0 for cube geometry). */
  polyCount?: number;
  isFlat2D?: boolean;
}

/**
 * Bedrock registers geometry identifiers globally inside a resource pack: when two
 * files declare the same identifier one of them is dropped. Every rig template used
 * to also publish a shared `geometry.default` alias, so mobs silently resolved to a
 * rig from a different file (or rendered nothing at all).
 */
export function sanitizeGeometryJson(json: string): string {
  if (!json || !json.includes('minecraft:geometry')) return json;
  try {
    const parsed = JSON.parse(json) as {
      'minecraft:geometry'?: Array<{ description?: { identifier?: string } }>;
    };
    const list = parsed['minecraft:geometry'];
    if (!Array.isArray(list) || list.length <= 1) return json;
    const identifiers = new Set<string>();
    const kept = list.filter((entry) => {
      const identifier = entry?.description?.identifier;
      if (!identifier || identifier === 'geometry.default' || identifiers.has(identifier)) return false;
      identifiers.add(identifier);
      return true;
    });
    parsed['minecraft:geometry'] = kept.length > 0 ? kept : [list[0]];
    return JSON.stringify(parsed, null, 2);
  } catch {
    return json;
  }
}

interface MultipartGeometrySource {
  key: string;
  geo: ExtractedGeometry;
}

function isMultipartPartKey(norm: string, mobNorm: string): boolean {
  if (mobNorm.length < 3 || !norm.startsWith(mobNorm) || norm === mobNorm) return false;
  const suffix = norm.slice(mobNorm.length);
  return /^(head|body|torso|chest|spine|arm|arms|leg|legs|wing|wings|tail|tails|foot|feet|hand|hands|jaw|jaws|neck|horn|horns|shell|limb|limbs|part|parts|bone|bones|segment|segments|base|main|root|layer|layers|overlay|overlays|armor|outer|inner|glow|emissive|eyes?|teeth|cape|cloth|skirt|weapon|shield|hat|helmet|crown|mane|hair|carapace|saddle)(left|right|front|back|\d+)*$/.test(suffix);
}

function mergeMultipartGeometry(
  primary: ExtractedGeometry,
  parts: MultipartGeometrySource[],
): ExtractedGeometry {
  try {
    const parsed = JSON.parse(primary.json) as { 'minecraft:geometry'?: Array<Record<string, any>> };
    const variants = parsed['minecraft:geometry'] ?? [];
    if (variants.length === 0 || parts.length === 0) return primary;
    const partDocs = parts
      .filter((part) => part.geo.json && part.geo.json !== primary.json)
      .map((part) => ({ key: part.key, parsed: JSON.parse(part.geo.json) }))
      .filter((part) => Array.isArray(part.parsed['minecraft:geometry']));
    const sourceKeys = new Set<string>();
    const uniqueDocs = partDocs.filter((part) => {
      const first = part.parsed['minecraft:geometry'][0];
      const signature = JSON.stringify(first?.bones ?? []);
      if (sourceKeys.has(signature)) return false;
      sourceKeys.add(signature);
      return true;
    });

    for (const variant of variants) {
      const bones = Array.isArray(variant.bones) ? [...variant.bones] : [];
      const usedNames = new Set<string>(bones.map((bone: any) => String(bone.name ?? '')));

      // Identify primary root and body bones for parenting orphan sub-parts
      const primaryBodyBone =
        bones.find((b: any) => /^(body|torso|chest|waist|hip)$/i.test(String(b.name ?? '')) )?.name ??
        bones.find((b: any) => /^(root|all|main)$/i.test(String(b.name ?? '')) )?.name ??
        bones[0]?.name ??
        'body';
      const primaryHeadBone =
        bones.find((b: any) => /^(head|skull|neck)$/i.test(String(b.name ?? '')) )?.name ?? primaryBodyBone;

      for (const part of uniqueDocs) {
        const sourceBones = part.parsed['minecraft:geometry'][0]?.bones ?? [];
        const renames = new Map<string, string>();
        for (const bone of sourceBones) {
          const baseName = String(bone.name ?? 'part');
          let name = baseName;
          if (usedNames.has(name)) name = `${part.key}_${baseName}`;
          let suffix = 2;
          while (usedNames.has(name)) name = `${part.key}_${baseName}_${suffix++}`;
          usedNames.add(name);
          renames.set(baseName, name);
        }
        for (const bone of sourceBones) {
          const copy = { ...bone, name: renames.get(String(bone.name ?? 'part')) };
          const resolvedParent = typeof copy.parent === 'string' ? (renames.get(copy.parent) ?? copy.parent) : undefined;
          if (resolvedParent && usedNames.has(resolvedParent)) {
            copy.parent = resolvedParent;
          } else {
            // Auto-link sub-part to primary model's hierarchy so it never floats detached at [0,0,0]
            const boneLow = String(copy.name ?? '').toLowerCase();
            if (/head|skull|jaw|horn|neck|face|eye|helmet|crown/.test(boneLow)) {
              copy.parent = primaryHeadBone;
            } else {
              copy.parent = primaryBodyBone;
            }
          }
          bones.push(copy);
        }
      }
      variant.bones = bones;
    }

    const addedBones = uniqueDocs.reduce(
      (count, part) => count + (part.parsed['minecraft:geometry'][0]?.bones?.length ?? 0),
      0,
    );
    const addedCubes = uniqueDocs.reduce(
      (count, part) => count + (part.parsed['minecraft:geometry'][0]?.bones ?? [])
        .reduce((total: number, bone: any) => total + (bone.cubes?.length ?? 0), 0),
      0,
    );
    return {
      ...primary,
      json: JSON.stringify(parsed, null, 2),
      bonesCount: primary.bonesCount + addedBones,
      cubesCount: primary.cubesCount + addedCubes,
    };
  } catch {
    return primary;
  }
}

const decoder = new TextDecoder();

/** Scales a UV size without ever collapsing it to zero (that samples one pixel). */
function scaledSize(value: number, scale: number): number {
  const raw = Number(value) || 0;
  const out = roundUv(raw * scale);
  if (Math.abs(out) > 0.0001) return out;
  const unit = Math.max(0.0001, roundUv(scale));
  return raw < 0 ? -unit : unit;
}

interface GeometryCubeLike {
  uv?: unknown;
  size?: number[];
  mirror?: boolean;
}

/** Expands a Bedrock box UV origin into explicit per-face UV rectangles. */
function expandBoxUv(
  u: number,
  v: number,
  width: number,
  height: number,
  depth: number,
  mirror = false,
): Record<string, { uv: number[]; uv_size: number[] }> {
  const w = Math.max(0.0001, Math.abs(width));
  const h = Math.max(0.0001, Math.abs(height));
  const d = Math.max(0.0001, Math.abs(depth));
  if (mirror) {
    return {
      north: { uv: [u + d, v + d], uv_size: [w, h] },
      east: { uv: [u + d + w, v + d], uv_size: [d, h] },
      south: { uv: [u + d + w + d, v + d], uv_size: [-w, h] },
      west: { uv: [u, v + d], uv_size: [-d, h] },
      up: { uv: [u + d + w, v], uv_size: [-w, d] },
      down: { uv: [u + d, v], uv_size: [-w, -d] },
    };
  }
  return {
    north: { uv: [u + d, v + d], uv_size: [w, h] },
    east: { uv: [u, v + d], uv_size: [d, h] },
    south: { uv: [u + d + w + d, v + d], uv_size: [-w, h] },
    west: { uv: [u + d + w, v + d], uv_size: [-d, h] },
    up: { uv: [u + d, v], uv_size: [w, d] },
    down: { uv: [u + d + w, v + d], uv_size: [w, -d] },
  };
}

/**
 * Re-bases a geometry onto the real pixel size of the texture that will be bound
 * to it. Box UVs are expanded into explicit per-face UV rectangles so a 128x128
 * or 256x256 mod skin maps 1:1 instead of sampling the wrong quarter of the sheet.
 */
export function rebaseGeometryTexture(
  geo: ExtractedGeometry,
  textureWidth: number,
  textureHeight: number,
): ExtractedGeometry {
  if (!geo.json || !textureWidth || !textureHeight) return geo;
  try {
    const parsed = JSON.parse(geo.json) as {
      'minecraft:geometry'?: Array<{
        description?: Record<string, unknown>;
        bones?: Array<{ mirror?: boolean; cubes?: GeometryCubeLike[] }>;
      }>;
    };
    const variants = parsed['minecraft:geometry'] ?? [];
    let changed = false;

    for (const variant of variants) {
      const desc = variant.description ?? {};
      const rawW = Number(desc.texture_width) || 0;
      const rawH = Number(desc.texture_height) || 0;
      // GeckoLib models may declare 0 and keep UVs in absolute pixel space — for those
      // only the declared sheet size changes, the UV rectangles are already accurate.
      const absoluteUv = rawW <= 0 || rawH <= 0;
      const declaredW = rawW > 0 ? rawW : textureWidth;
      const declaredH = rawH > 0 ? rawH : textureHeight;
      if (declaredW === textureWidth && declaredH === textureHeight) continue;
      let maxU = textureWidth;
      let maxV = textureHeight;
      const scaleU = absoluteUv ? 1 : textureWidth / declaredW;
      const scaleV = absoluteUv ? 1 : textureHeight / declaredH;

      for (const bone of variant.bones ?? []) {
        const boneMirror = bone.mirror === true;
        for (const cube of bone.cubes ?? []) {
          const rawUv = cube.uv;
          const isMirror = cube.mirror === true || boneMirror;
          let uvSource: Record<string, { uv: number[]; uv_size: number[] }> | null = null;
          if (Array.isArray(rawUv) && rawUv.length === 2) {
            const size = cube.size ?? [0, 0, 0];
            uvSource = expandBoxUv(
              Number(rawUv[0]) || 0,
              Number(rawUv[1]) || 0,
              Number(size[0]) || 1,
              Number(size[1]) || 1,
              Number(size[2]) || 1,
              isMirror,
            );
          } else if (rawUv && typeof rawUv === 'object') {
            uvSource = rawUv as Record<string, { uv: number[]; uv_size: number[] }>;
          }
          if (!uvSource) continue;
          const scaled: Record<string, { uv: number[]; uv_size: number[] }> = {};
          for (const [face, spec] of Object.entries(uvSource)) {
            if (!spec || !Array.isArray(spec.uv) || !Array.isArray(spec.uv_size)) continue;
            const anchorU = roundUv((Number(spec.uv[0]) || 0) * scaleU);
            const anchorV = roundUv((Number(spec.uv[1]) || 0) * scaleV);
            const sizeU = scaledSize(spec.uv_size[0], scaleU);
            const sizeV = scaledSize(spec.uv_size[1], scaleV);
            maxU = Math.max(maxU, anchorU, anchorU + Math.abs(sizeU));
            maxV = Math.max(maxV, anchorV, anchorV + Math.abs(sizeV));
            scaled[face] = {
              // The anchor is scaled, never rounded, wrapped or clamped: every one of those
              // rewrites the sampled region, and wrapping relocates the face to the opposite
              // side of the atlas — the exact class of bug this engine exists to prevent.
              uv: [anchorU, anchorV],
              uv_size: [sizeU, sizeV],
            };
          }
          cube.uv = scaled;
        }
      }

      // The declaration must cover every rectangle that survives. Raising the sheet keeps
      // the sampling ratio 1:1 and moves nothing; a smaller declaration would make every
      // face past the edge sample clamped edge pixels.
      desc.texture_width = pow2Sheet(Math.max(textureWidth, maxU));
      desc.texture_height = pow2Sheet(Math.max(textureHeight, maxV));
      variant.description = desc;
      changed = true;
    }

    if (!changed) return geo;
    return { ...geo, json: JSON.stringify(parsed, null, 2) };
  } catch {
    return geo;
  }
}

/**
 * Words that describe a body type instead of one creature. Sharing only a generic word
 * is never enough to hand a mob another creature's mesh.
 */
const GENERIC_BODY_TOKENS = new Set([
  'soldier',
  'skeleton',
  'knight',
  'demon',
  'base',
  'texture',
  'model',
  'entity',
  'mob',
  'body',
  'armor',
  'default',
  'humanoid',
  'generic',
  'variant',
]);

/**
 * Universal Model Port Engine
 * Recovers authentic 3D geometry from Java block/item JSON models and GeckoLib .geo.json files.
 * Generates anatomy-accurate multi-bone rigged mob geometries for Bedrock entities.
 */
export function extractAndPortModels(
  modId: string,
  entries?: ExtractedZipEntry[],
  mobIds: string[] = [],
  onLog?: (line: string) => void,
  assetIndex?: AssetIndex | null,
  mobLinks?: Map<string, MobResourceLink>,
): {
  itemGeometries: Map<string, ExtractedGeometry>;
  entityGeometries: Map<string, ExtractedGeometry>;
  stats: ModelPortStats;
  /** Every modelling document the archive ships, classified by format. */
  registry: ModelSourceRegistryReport | null;
} {
  const log = (msg: string) => onLog?.(msg);
  const itemGeometries = new Map<string, ExtractedGeometry>();
  const entityGeometries = new Map<string, ExtractedGeometry>();
  // Every recovered geometry, keyed by the archive path it came from, so a mob can be
  // bound to the exact document its own renderer/model class named.
  const recoveredByPath = new Map<string, ExtractedGeometry>();

  const stats: ModelPortStats = {
    modModelsParsed: 0,
    geckolibModelsFound: 0,
    javaEntityModelsConverted: 0,
    polyMeshModelsConverted: 0,
    blockbenchModelsConverted: 0,
    tabulaModelsConverted: 0,
    cemModelsConverted: 0,
    elementsConvertedCount: 0,
    riggedMobGeometriesGenerated: 0,
    flat2DItemsCount: 0,
    approximateFallbackCount: 0,
    modelDependencyIssues: 0,
    orphanTextures: 0,
    equipmentAttachments: 0,
    modelSourcesDiscovered: 0,
    authenticMobModels: 0,
    skeletonPartsPreserved: 0,
    skeletonPartsReparented: 0,
    skeletonRootsAdded: 0,
    mobsWithoutAuthenticModel: [],
  };

  if (!entries || entries.length === 0) {
    // Generate rigged mob geometries even without archive
    for (const mobId of mobIds) {
      const geo = generateRiggedMobGeometry(modId, mobId);
      entityGeometries.set(mobId, geo);
      stats.riggedMobGeometriesGenerated++;
      stats.mobsWithoutAuthenticModel.push(mobId);
    }
    return { itemGeometries, entityGeometries, stats, registry: null };
  }

  // 0. Universal model source inventory. Every modelling format the archive could hold is
  // classified once, so "this mod ships no model" is only ever reported after `.bbmodel`,
  // polygon meshes, Bedrock JSON outside `models/`, Tabula documents and unreadable model
  // files have all been looked at.
  const registry = scanModelSources(entries);
  stats.modelSourcesDiscovered = registry.files;
  for (const line of registry.log) log(line);

  // 1. Scan for GeckoLib .geo.json or Bedrock geometry files. The model-source registry
  // already proved which archive documents really are Bedrock geometry, so a model that sits
  // outside the conventional `geo/`, `geometry/` or `models/entity/` folders is recovered too
  // instead of being reported as missing.
  const registryGeometryPaths = new Set(
    registry.records
      .filter((record) => record.format === 'bedrock-geometry' || record.format === 'geckolib-geo')
      .map((record) => record.path.replace(/\\/g, '/').toLowerCase()),
  );
  for (const entry of entries) {
    const cleanPath = entry.path.replace(/\\/g, '/').toLowerCase();
    const isGeoPath =
      cleanPath.endsWith('.geo.json') ||
      registryGeometryPaths.has(cleanPath) ||
      ((cleanPath.includes('/geo/') || cleanPath.includes('/geometry/') || cleanPath.includes('models/entity/')) && cleanPath.endsWith('.json'));

    if (isGeoPath) {
      try {
        const text = decoder.decode(entry.data);
        if (!text.includes('minecraft:geometry')) continue;
        const parsed = JSON.parse(text);
        const geos = parsed['minecraft:geometry'] || [];
        if (Array.isArray(geos) && geos.length > 0) {
          const fileName = entry.path.split('/').pop()?.replace(/\.(geo\.)?json$/i, '') || '';
          const mobMatch = safeFileId(fileName);
          const baseGeoId = canonicalGeometryId(modId, mobMatch);
          const variants = geos.map((geo: any, index: number) => {
            const description = { ...(geo.description ?? {}) };
            description.identifier = index === 0
              ? baseGeoId
              : `${baseGeoId}_variant_${index + 1}`;
            description.visible_bounds_width = description.visible_bounds_width || 3.0;
            description.visible_bounds_height = description.visible_bounds_height || 3.0;
            description.visible_bounds_offset = description.visible_bounds_offset || [0, 1.0, 0];
            return { ...geo, description };
          });
          parsed['minecraft:geometry'] = variants;
          const bonesCount = variants.reduce(
            (count: number, geo: any) => count + (geo.bones?.length ?? 0),
            0,
          );
          const cubesCount = variants.reduce(
            (count: number, geo: any) => count + (geo.bones ?? [])
              .reduce((total: number, bone: any) => total + (bone.cubes?.length ?? 0), 0),
            0,
          );
          const geoData: ExtractedGeometry = {
            id: baseGeoId,
            json: JSON.stringify(parsed, null, 2),
            source: 'geckolib',
            bonesCount,
            cubesCount,
          };

          recoveredByPath.set(cleanPath, geoData);
          if (mobMatch) {
            const previous = entityGeometries.get(mobMatch);
            if (!previous || (previous.cubesCount ?? 0) <= cubesCount) entityGeometries.set(mobMatch, geoData);
            stats.geckolibModelsFound++;
            log(`[MODEL] Recovered GeckoLib geometry: "${fileName}" (${variants.length} model variant(s), ${bonesCount} bones, ${cubesCount} cubes)`);
          }
        }
      } catch {}
    }
  }

  // 1b. Polygon-mesh models. A mod that ships Bedrock-style `poly_mesh` documents or
  // Wavefront `.obj` files has models that contain no cubes at all, so a cube-only writer
  // produced no geometry for them: the entity stayed invisible and none of its parts
  // rendered. Bedrock renders polygon meshes natively, so they are converted and registered
  // under the same recovery map as every other authentic model.
  const sheetSizeFor = (key: string): { width: number; height: number } => {
    const norm = normalizeAssetIdentifier(key);
    const sheets = assetIndex?.entities ?? [];
    const hit =
      sheets.find((sheet) => sheet.norm === norm) ??
      sheets.find((sheet) => norm.length >= 3 && sheet.norm.includes(norm));
    return { width: hit?.width ?? 64, height: hit?.height ?? 64 };
  };
  for (const entry of entries) {
    const cleanPath = normalizeAssetPath(entry.path);
    const isObj = cleanPath.endsWith('.obj');
    const isPolyJson =
      cleanPath.endsWith('.json') && /(?:^|\/)(?:models|geo|geometry)\//.test(cleanPath);
    if (!isObj && !isPolyJson) continue;
    const fileName = cleanPath.split('/').pop()?.replace(/\.(geo\.)?(json|obj)$/i, '') ?? '';
    const meshKey = safeFileId(fileName);
    if (!meshKey) continue;
    let text = '';
    try {
      text = decoder.decode(entry.data);
    } catch {
      continue;
    }
    if (!isObj && !looksLikePolyMeshDocument(text)) continue;
    const sheet = sheetSizeFor(meshKey);
    const converted = isObj
      ? convertObjToPolyMesh({ modId, assetId: meshKey, text, textureWidth: sheet.width, textureHeight: sheet.height })
      : convertPolyMeshDocument({ modId, assetId: meshKey, text, textureWidth: sheet.width, textureHeight: sheet.height });
    if (!converted) {
      log(
        `[MESH:WARN] Polygon mesh "${fileName}" has no expressible polygon data — reported as UNRESOLVED instead of being replaced by a box rig.`,
      );
      continue;
    }
    const geoData: ExtractedGeometry = {
      id: converted.id,
      json: converted.json,
      source: 'poly_mesh',
      bonesCount: converted.bones,
      cubesCount: 0,
      polyCount: converted.polys,
    };
    // A document already recovered as a cube model (a GeckoLib file that mixes cubes and
    // polygons) is not replaced: the class that names this path keeps the geometry that
    // really renders its cubes.
    if (!recoveredByPath.has(cleanPath)) recoveredByPath.set(cleanPath, geoData);
    const previous = entityGeometries.get(meshKey);
    // The polygon conversion only takes over when nothing renderable was registered yet.
    const previousRenders = Boolean(previous && (previous.cubesCount > 0 || (previous.polyCount ?? 0) > 0) && previous.source !== 'rigged_template');
    if (!previousRenders) entityGeometries.set(meshKey, geoData);
    stats.polyMeshModelsConverted += 1;
    log(
      `[MESH] Converted polygon-mesh model "${fileName}" -> ${converted.bones} bone(s), ${converted.polys} polygon(s), sheet ${sheet.width}x${sheet.height}${converted.uvDerived ? ' (UVs derived from its own vertex positions — ADAPTED)' : ''}.`,
    );
    for (const note of converted.notes.slice(0, 2)) log(`[MESH] ${fileName}: ${note}`);
  }

  // 1c. Blockbench authoring documents. A `.bbmodel` (or a Blockbench JSON that lost its
  // extension) carries the real cube list, the real outliner hierarchy and the real
  // keyframes in a shape no other branch reads. Nothing else in the archive can replace it,
  // because it *is* the source model — the previous pipeline never opened these files, which
  // is why those mobs shipped with a generic rig or no model at all.
  for (const entry of entries) {
    const cleanPath = normalizeAssetPath(entry.path);
    const lower = cleanPath.toLowerCase();
    const isBbFile = lower.endsWith('.bbmodel');
    const isBbJson =
      lower.endsWith('.json') &&
      /(?:^|\/)(?:models|geo|geometry|bbmodels|blockbench|armor)\//.test(lower) &&
      !lower.endsWith('.geo.json');
    if (!isBbFile && !isBbJson) continue;
    let text = '';
    try {
      text = decoder.decode(entry.data);
    } catch {
      continue;
    }
    if (!looksLikeBbModel(text)) continue;
    const fileName = cleanPath.split('/').pop()?.replace(/\.(bbmodel|json)$/i, '') ?? '';
    const meshKey = safeFileId(fileName);
    if (!meshKey) continue;
    const sheet = sheetSizeFor(meshKey);
    const converted = convertBbModel({
      modId,
      assetId: meshKey,
      text,
      textureWidth: sheet.width,
      textureHeight: sheet.height,
    });
    if (!converted) {
      log(
        `[MESH:WARN] Blockbench document "${fileName}" declares no readable cube — reported as UNRESOLVED instead of being replaced by a box rig.`,
      );
      continue;
    }
    const geoData: ExtractedGeometry = {
      id: converted.id,
      json: converted.json,
      source: 'blockbench',
      bonesCount: converted.bones,
      cubesCount: converted.cubes,
    };
    if (!recoveredByPath.has(cleanPath)) recoveredByPath.set(cleanPath, geoData);
    const previous = entityGeometries.get(meshKey);
    const previousRenders = Boolean(
      previous &&
        previous.source !== 'rigged_template' &&
        (previous.cubesCount > 0 || (previous.polyCount ?? 0) > 0),
    );
    if (!previousRenders) entityGeometries.set(meshKey, geoData);
    stats.blockbenchModelsConverted += 1;
    stats.skeletonPartsPreserved += converted.boneNames.length;
    log(
      `[MESH] Converted Blockbench model "${fileName}" -> ${converted.bones} bone(s), ${converted.cubes} cube(s), ${converted.boneNames.length} source part name(s) preserved${converted.quadruped ? ' (quadruped limb layout)' : ''}.`,
    );
    for (const note of converted.notes.slice(0, 2)) log(`[MESH] ${fileName}: ${note}`);
  }

  // 1d. Tabula documents. A `.tbl` (or the Tabula `.json` export mods ship inside their jar)
  // carries a real section hierarchy with real boxes and box UV origins. Nothing else in the
  // archive can stand in for it, and the previous pipeline classified these files as
  // "recognised but not convertible", so every creature authored in Tabula lost its model.
  for (const entry of entries) {
    const cleanPath = normalizeAssetPath(entry.path);
    const lower = cleanPath.toLowerCase();
    const isTabulaFile = lower.endsWith('.tbl') || lower.endsWith('.tbl.json');
    if (!isTabulaFile && !lower.endsWith('.json')) continue;
    if (lower.endsWith('.geo.json') || lower.endsWith('.bbmodel')) continue;
    if (lower.includes('/lang/') || lower.includes('/sounds/') || lower.includes('/blockstates/')) continue;
    let text = '';
    try {
      text = decoder.decode(entry.data);
    } catch {
      continue;
    }
    if (!looksLikeTabulaModel(text)) continue;
    const fileName = (cleanPath.split('/').pop() ?? '')
      .replace(/\.tbl$/i, '')
      .replace(/\.json$/i, '')
      .replace(/\.tbl$/i, '');
    const meshKey = safeFileId(fileName);
    if (!meshKey) continue;
    const sheet = sheetSizeFor(meshKey);
    const converted = convertTabulaModel({
      modId,
      assetId: meshKey,
      text,
      textureWidth: sheet.width,
      textureHeight: sheet.height,
    });
    if (!converted) {
      log(
        `[MESH:WARN] Tabula document "${fileName}" declares no readable box — reported as UNRESOLVED instead of being replaced by a box rig.`,
      );
      continue;
    }
    const geoData: ExtractedGeometry = {
      id: converted.id,
      json: converted.json,
      source: 'tabula',
      bonesCount: converted.bones,
      cubesCount: converted.cubes,
    };
    if (!recoveredByPath.has(cleanPath)) recoveredByPath.set(cleanPath, geoData);
    const previous = entityGeometries.get(meshKey);
    const previousRenders = Boolean(
      previous &&
        previous.source !== 'rigged_template' &&
        (previous.cubesCount > 0 || (previous.polyCount ?? 0) > 0),
    );
    if (!previousRenders) entityGeometries.set(meshKey, geoData);
    stats.tabulaModelsConverted += 1;
    stats.skeletonPartsPreserved += converted.preserved;
    log(
      `[MESH] Converted Tabula model "${fileName}" -> ${converted.bones} bone(s), ${converted.cubes} cube(s), ${converted.parts.length} source section name(s) preserved${converted.quadruped ? ' (quadruped limb layout)' : ''}.`,
    );
    for (const note of converted.notes.slice(0, 2)) log(`[MESH] ${fileName}: ${note}`);
  }

  // 1e. OptiFine CEM documents (`.jem` entity models, `.jpm` player models). These are how a
  // very large share of Java resource packs and mods ship custom creature shapes, and the
  // engine never opened them: those mobs exported with a generic rig or no model at all. Each
  // CEM part role becomes a bone, so a wrapped clip still finds `left_leg`, `head`, …
  for (const entry of entries) {
    const cleanPath = normalizeAssetPath(entry.path);
    const lower = cleanPath.toLowerCase();
    const isCemFile = lower.endsWith('.jem') || lower.endsWith('.jpm');
    if (!isCemFile && !lower.endsWith('.json')) continue;
    if (lower.endsWith('.geo.json') || lower.endsWith('.bbmodel')) continue;
    if (lower.includes('/lang/') || lower.includes('/sounds/') || lower.includes('/blockstates/')) continue;
    let text = '';
    try {
      text = decoder.decode(entry.data);
    } catch {
      continue;
    }
    if (!looksLikeCemModel(text)) continue;
    const fileName = (cleanPath.split('/').pop() ?? '').replace(/\.(jem|jpm|json)$/i, '');
    const meshKey = safeFileId(fileName);
    if (!meshKey) continue;
    const sheet = sheetSizeFor(meshKey);
    const converted = convertCemModel({
      modId,
      assetId: meshKey,
      text,
      textureWidth: sheet.width,
      textureHeight: sheet.height,
      player: lower.endsWith('.jpm'),
    });
    if (!converted) {
      log(
        `[MESH:WARN] OptiFine CEM document "${fileName}" declares no readable box — reported as UNRESOLVED instead of being replaced by a box rig.`,
      );
      continue;
    }
    const geoData: ExtractedGeometry = {
      id: converted.id,
      json: converted.json,
      source: 'optifine_cem',
      bonesCount: converted.bones,
      cubesCount: converted.cubes,
    };
    if (!recoveredByPath.has(cleanPath)) recoveredByPath.set(cleanPath, geoData);
    const previous = entityGeometries.get(meshKey);
    const previousRenders = Boolean(
      previous &&
        previous.source !== 'rigged_template' &&
        (previous.cubesCount > 0 || (previous.polyCount ?? 0) > 0),
    );
    if (!previousRenders) entityGeometries.set(meshKey, geoData);
    stats.cemModelsConverted += 1;
    stats.skeletonPartsPreserved += converted.preserved;
    log(
      `[MESH] Converted OptiFine ${converted.player ? 'player' : 'entity'} CEM model "${fileName}" -> ${converted.bones} bone(s), ${converted.cubes} cube(s), ${converted.parts.length} part role(s) carried into bone names${converted.texture ? `; document texture "${converted.texture}"` : ''}.`,
    );
    for (const note of converted.notes.slice(0, 2)) log(`[MESH] ${fileName}: ${note}`);
  }

  // 2. Scan for Java Block and Item JSON models with elements
  for (const entry of entries) {
    const cleanPath = normalizeAssetPath(entry.path);
    const isModel = (/(?:^|\/)models\/item\//.test(cleanPath) || /(?:^|\/)models\/block\//.test(cleanPath)) && cleanPath.endsWith('.json');
    if (!isModel) continue;

    stats.modModelsParsed++;
    try {
      const text = decoder.decode(entry.data);
      const parsed = JSON.parse(text);
      const fileName = cleanPath.split('/').pop()?.replace(/\.json$/i, '') || '';
      const itemId = safeFileId(fileName);

      // Authentic Java element model -> Bedrock geometry with real per-face UVs
      const javaModel: JavaModel = {
        stem: itemId,
        norm: normalizeAssetIdentifier(itemId),
        bucket: 'item',
        path: itemId,
        parent: typeof parsed.parent === 'string' ? parsed.parent : undefined,
        chain: [],
        textures: (parsed.textures && typeof parsed.textures === 'object' ? parsed.textures : {}) as Record<string, string>,
        elements: Array.isArray(parsed.elements) ? (parsed.elements as JavaElement[]) : null,
      };

      // Resolve the model through the archive index first so inherited textures and
      // display data are available to the conversion below.
      const indexedModel = assetIndex
        ? assetIndex.itemModelByNorm.get(itemId) ??
          assetIndex.blockModelByNorm.get(itemId) ??
          assetIndex.itemModelByNorm.get(normKey(fileName)) ??
          assetIndex.blockModelByNorm.get(normKey(fileName))
        : null;

      let texW = 16;
      let texH = 16;
      if (assetIndex) {
        const linked = resolveModelTexture(indexedModel ?? javaModel, assetIndex, ['layer0', 'layer1', 'texture', 'all', 'particle', '0']);
        if (linked) {
          texW = linked.width || 16;
          texH = linked.height || 16;
        }
      }

      const converted = convertJavaModelDocument({
        modId,
        assetId: itemId,
        model: indexedModel ?? javaModel,
        index: assetIndex ?? null,
        textureWidth: texW,
        textureHeight: texH,
      });
      if (converted) {
        itemGeometries.set(itemId, {
          id: converted.geometry.id,
          json: converted.geometry.json,
          source: 'java_elements',
          bonesCount: converted.geometry.bones,
          cubesCount: converted.geometry.cubes,
        });
        stats.elementsConvertedCount++;
        const inherited = converted.ir.parentChain.filter((ref) => !/^(builtin\/|minecraft:)/i.test(ref));
        log(
          `[MODEL] Converted authentic Java model "${itemId}" (${converted.ir.cubeCount} source elements -> ${converted.geometry.cubes} cubes, ${inherited.length} inherited parent(s), per-face UV ${texW}x${texH})`,
        );
        for (const diagnostic of converted.ir.diagnostics.slice(0, 4)) {
          log(`[MODEL:${diagnostic.severity === 'warning' ? 'WARN' : 'INFO'}] ${itemId}: ${diagnostic.detail}`);
        }
        const uv = converted.geometry.uv;
        log(
          `[MODEL:UV] ${itemId}: ${uv.faces} face(s) mapped onto a ${uv.sheet.width}x${uv.sheet.height} sheet (${uv.inRange} in range, ${uv.wrapped} crossing the edge, ${uv.outsideSheet} wrapped from outside the sheet, 0 clamped).`,
        );
        for (const note of uv.notes.slice(0, 2)) log(`[MODEL:UV] ${itemId}: ${note}`);
        continue;
      }

      // Java model without elements = flat sprite drawn straight from its texture
      if (javaModel.parent || Object.keys(javaModel.textures).length > 0) {
        itemGeometries.set(itemId, {
          id: canonicalGeometryId(modId, itemId),
          json: '',
          source: 'java_elements',
          bonesCount: 0,
          cubesCount: 0,
          isFlat2D: true,
        });
        stats.flat2DItemsCount++;
      }
    } catch {}
  }

  // 2a. Blockstate resolution report. Variant and multipart model references are
  // resolved against the archive index, so a dangling blockstate reference is reported
  // as UNRESOLVED instead of silently collapsing the block into a plain cube.
  if (assetIndex && assetIndex.blockstates.length > 0) {
    const coverage = summarizeBlockStateCoverage(assetIndex);
    log(
      `[MODEL] Blockstates: ${coverage.blocks} state file(s), ${coverage.variants} variant(s), ${coverage.multipartParts} multipart part(s), ${coverage.unresolvedReferences.length} unresolved model reference(s); state properties: ${coverage.propertyStates.slice(0, 8).join(', ') || 'none declared'}.`,
    );
    for (const missingRef of coverage.unresolvedReferences.slice(0, 6)) {
      log(
        `[MODEL:WARN] Blockstate references a model that is not in the archive: ${missingRef} — that variant stays UNRESOLVED.`,
      );
    }
  }

  // 2a-bis. Model dependency graph. Every parent model, texture variable, blockstate link
  // and item override is tracked, so a dangling reference is reported instead of being
  // silently replaced by a default shape.
  if (assetIndex) {
    const deps = buildModelDependencyReport(assetIndex);
    stats.modelDependencyIssues = deps.issues;
    stats.orphanTextures = deps.orphanTextureCount;
    log(
      `[MODEL] Dependency graph: ${deps.models} model(s), ${deps.blockstates} blockstate(s), ${deps.edges} edge(s), ${deps.textureVariables} texture variable(s), ${deps.overrides} item override(s), inheritance depth ${deps.maxDepth}, ${deps.builtinParents.length} engine-builtin parent(s).`,
    );
    const problems = [
      ...deps.missingParents.map((entry) => `missing parent ${entry}`),
      ...deps.missingModels.map((entry) => `missing blockstate model ${entry}`),
      ...deps.missingTextures.map((entry) => `unmatched texture ${entry}`),
      ...deps.unresolvedOverrides.map((entry) => `missing override model ${entry}`),
      ...deps.cycles.map((entry) => `parent cycle ${entry}`),
    ];
    for (const problem of problems.slice(0, 8)) {
      log(`[MODEL:WARN] ${problem} — reported as UNRESOLVED, nothing substituted.`);
    }
    if (problems.length > 8) {
      log(`[MODEL:WARN] ${problems.length - 8} further model dependency issue(s) not listed.`);
    }
    if (deps.orphanTextureCount > 0) {
      const preview = deps.orphanTextures.slice(0, 10).join(', ');
      log(
        `[MODEL:WARN] ${deps.orphanTextureCount} texture(s) are referenced by no model: ${preview}${deps.orphanTextureCount > 10 ? ', …' : ''} — flagged as orphaned.`,
      );
    }
    if (deps.orphanBlockModels.length > 0) {
      log(
        `[MODEL:WARN] ${deps.orphanBlockModels.length} block model(s) are referenced by no blockstate: ${deps.orphanBlockModels.slice(0, 8).join(', ')}.`,
      );
    }
  }

  // 2a-ter. Equipment attachment points recovered from the mod's own armour sheets.
  const equipment = resolveEquipmentAttachments(assetIndex ?? null);
  stats.equipmentAttachments = equipment.attachments.length;
  if (equipment.attachments.length > 0) {
    const slots = [...new Set(equipment.attachments.map((entry) => entry.slot))];
    log(
      `[MODEL] Equipment attachments: ${equipment.attachments.length} slot binding(s) from ${equipment.armorSheets} armour sheet(s) across ${equipment.materials.length} material(s) (${slots.join(', ')}).`,
    );
  }
  for (const skipped of equipment.skipped.slice(0, 4)) {
    log(`[MODEL:WARN] Armour sheet skipped: ${skipped}`);
  }

  // 2b. Scan authentic Java ENTITY models (assets/<mod>/models/entity/*.json).
  // These are vanilla-format element models rather than GeckoLib files. They were
  // previously dropped entirely, which is exactly why so many mobs fell back to a
  // generic biped rig and looked nothing like the original in game.
  const findEntitySkin = (key: string): { width: number; height: number } | null => {
    if (!assetIndex || assetIndex.entities.length === 0) return null;
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!norm) return null;
    let best: { width: number; height: number } | null = null;
    let bestScore = 0;
    for (const tex of assetIndex.entities) {
      if (tex.width < 8 || tex.height < 8) continue;
      let score = 0;
      if (tex.norm === norm) score = 100;
      else if (tex.norm.startsWith(norm) || norm.startsWith(tex.norm)) score = 70;
      else if (tex.norm.includes(norm) || norm.includes(tex.norm)) score = 50;
      if (score > bestScore) {
        bestScore = score;
        best = { width: tex.width, height: tex.height };
      }
    }
    return bestScore >= 50 ? best : null;
  };

  for (const entry of entries) {
    const cleanPath = entry.path.replace(/\\/g, '/').toLowerCase();
    if (!/(?:^|\/)models\/entity\//.test(cleanPath) || !cleanPath.endsWith('.json')) continue;
    if (cleanPath.endsWith('.geo.json')) continue;
    // Armour/player layers are element models too, but they are never mob bodies.
    if (cleanPath.includes('/models/entity/armor/') || cleanPath.includes('/models/entity/player')) continue;
    const relativePath = cleanPath.startsWith('models/entity/')
      ? cleanPath.slice('models/entity/'.length)
      : cleanPath.slice(cleanPath.indexOf('/models/entity/') + '/models/entity/'.length);
    const pathParts = relativePath.split('/').filter(Boolean);
    const fileName = pathParts[pathParts.length - 1]?.replace(/\.json$/i, '') || '';
    const parentEntity = pathParts.length > 1 ? pathParts[0] : '';
    const mobKey = safeFileId(parentEntity ? `${parentEntity}_${fileName}` : fileName);
    if (!mobKey) continue;
    try {
      const text = decoder.decode(entry.data);
      if (text.includes('minecraft:geometry')) continue;
      const parsed = JSON.parse(text) as {
        texture_size?: number[];
        elements?: JavaElement[];
        parent?: string;
        textures?: Record<string, string>;
        display?: Record<string, Record<string, unknown>>;
      };
      const elements = Array.isArray(parsed.elements) ? parsed.elements : null;
      if (!elements || elements.length === 0) continue;

      let texW = Number(parsed.texture_size?.[0]) || 0;
      let texH = Number(parsed.texture_size?.[1]) || 0;
      if (!texW || !texH) {
        const skin = findEntitySkin(mobKey);
        texW = skin?.width ?? 64;
        texH = skin?.height ?? 64;
      }

      // The parsed document is passed through so texture variables, display transforms
      // and parent references survive into the intermediate representation.
      const entityModel: JavaModel = {
        stem: mobKey,
        norm: mobKey.replace(/[^a-z0-9]/g, ''),
        bucket: 'block',
        path: cleanPath,
        parent: parsed.parent,
        chain: parsed.parent ? [parsed.parent] : [],
        textures: parsed.textures && typeof parsed.textures === 'object' ? parsed.textures : {},
        elements,
        display: parsed.display,
      };

      const converted = convertJavaEntityModelToBedrockGeometry(
        modId,
        mobKey,
        elements,
        texW,
        texH,
        entityModel,
        assetIndex ?? null,
      );
      if (!converted) continue;
      const geoData: ExtractedGeometry = {
        id: converted.id,
        json: converted.json,
        source: 'java_elements',
        bonesCount: converted.bones,
        cubesCount: converted.cubes,
      };
      recoveredByPath.set(cleanPath, geoData);
      const previous = entityGeometries.get(mobKey);
      if (!previous || (previous.source !== 'geckolib' && (previous.cubesCount ?? 0) <= converted.cubes)) {
        entityGeometries.set(mobKey, geoData);
      }
      if (converted.skeleton) {
        stats.skeletonPartsPreserved += converted.skeleton.preserved;
        stats.skeletonPartsReparented += converted.skeleton.reparented;
        if (converted.skeleton.syntheticRoot) stats.skeletonRootsAdded += 1;
      }
      stats.javaEntityModelsConverted++;
      log(
        `[MODEL] Converted authentic Java entity model "${mobKey}" (${converted.cubes} cubes across ${converted.bones} bone(s), ${converted.quadruped ? 'quadruped' : 'biped / non-quadruped'} bone layout, sheet ${texW}x${texH})`,
      );
      for (const diagnostic of converted.ir.diagnostics.slice(0, 3)) {
        log(
          `[MODEL:${diagnostic.severity === 'error' ? 'ERROR' : diagnostic.severity === 'warning' ? 'WARN' : 'INFO'}] ${mobKey}: ${diagnostic.detail}`,
        );
      }
      log(
        `[MODEL:UV] ${mobKey}: ${converted.uv.faces} face(s) mapped onto a ${converted.uv.sheet.width}x${converted.uv.sheet.height} sheet (${converted.uv.inRange} in range, ${converted.uv.wrapped} crossing the edge, ${converted.uv.outsideSheet} wrapped from outside, 0 clamped).`,
      );
    } catch {
      // Malformed model JSON — other models still resolve.
    }
  }

  const geoByNorm = new Map<string, ExtractedGeometry>();
  for (const [key, geo] of entityGeometries) {
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!norm) continue;
    const previous = geoByNorm.get(norm);
    // A recovered file always outranks a rig template, and a richer rig outranks a
    // poorer one, so a mob never inherits the wrong model through key drift.
    if (!previous || (previous.source === 'rigged_template' && geo.source !== 'rigged_template')) {
      geoByNorm.set(norm, geo);
    }
  }

  // Geometries already bound to a mob identifier in this pass, so the archive-wide
  // recovery tier below never hands the same mesh to two unrelated entities.
  const boundGeometries = new Set<ExtractedGeometry>();

  for (const mobId of mobIds) {
    const mobNorm = mobId.toLowerCase().replace(/[^a-z0-9]/g, '');
    const multipartParts = [...geoByNorm.entries()]
      .filter(([norm, geo]) => geo.source !== 'rigged_template' && isMultipartPartKey(norm, mobNorm))
      .map(([key, geo]) => ({ key, geo }));

    // Link-first resolution: the mob's own renderer/model class named this exact
    // document, so it is bound verbatim before any file-name matching runs.
    let matched: ExtractedGeometry | null = null;
    const linkedModel = mobLinks?.get(mobId)?.model;
    if (linkedModel) {
      const linked = recoveredByPath.get(linkedModel);
      if (linked) {
        matched = linked;
        log(
          `[LINK] Mob "${mobId}" -> model "${linkedModel}" (resource string declared by its own renderer/model class).`,
        );
      }
    }

    // A model split into named files such as `<mob>_body.geo.json` and
    // `<mob>_head.geo.json` is assembled into one rig instead of dropping its parts.
    if (!matched) matched = geoByNorm.get(mobNorm) ?? null;
    if (!matched && multipartParts.length > 0) {
      const primaryPart = multipartParts.find(({ key }) =>
        /(?:body|torso|main|base|root)$/.test(key.slice(mobNorm.length)),
      ) ?? [...multipartParts].sort((a, b) => b.geo.cubesCount - a.geo.cubesCount)[0];
      matched = primaryPart.geo;
    }
    if (!matched && mobNorm.length >= 5) {
      const candidates = [...geoByNorm.entries()].filter(
        ([norm]) => norm.length >= 5 && (norm.startsWith(mobNorm) || mobNorm.startsWith(norm)),
      );
      if (candidates.length === 1) matched = candidates[0][1];
    }
    if (!matched && mobNorm.length >= 6) {
      const candidates = [...geoByNorm.entries()].filter(
        ([norm]) => norm.length >= 6 && (norm.includes(mobNorm) || mobNorm.includes(norm)),
      );
      if (candidates.length === 1) matched = candidates[0][1];
    }

    if (!matched && mobNorm.length >= 3) {
      // Sibling / variant body type: `sewer_rat` uses `rat`, `man_serpent` uses `serpent_soldier`,
      // `mushroom_child` uses `mushroom_parent`, and `undead_soldier` uses `skeletonsoldier`/`undead`.
      // Linking the authentic model that shares creature tokens preserves the authentic silhouette
      // instead of dropping it onto an erroneous humanoid fallback in game.
      const tokens = mobId
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3 && !GENERIC_BODY_TOKENS.has(token));
      if (tokens.length > 0) {
        const candidates = [...geoByNorm.entries()].filter(
          ([norm, geo]) => geo.source !== 'rigged_template' && tokens.some((token) => norm.includes(token) || token.includes(norm)),
        );
        if (candidates.length > 0) {
          // Sort by richest model (highest cube/bone count)
          candidates.sort((a, b) => (b[1].cubesCount ?? 0) - (a[1].cubesCount ?? 0));
          matched = candidates[0][1];
        }
      }
    }

    if (matched) {
      stats.authenticMobModels += 1;
      const additionalParts = multipartParts.filter((part) => part.geo !== matched);
      const assembled = additionalParts.length > 0
        ? mergeMultipartGeometry(matched, additionalParts)
        : matched;
      boundGeometries.add(assembled);
      entityGeometries.set(mobId, assembled);
      const kind = assembled.source === 'geckolib'
        ? 'GeckoLib'
        : assembled.source === 'poly_mesh'
          ? 'polygon-mesh'
          : assembled.source === 'blockbench'
            ? 'Blockbench'
            : assembled.source === 'tabula'
              ? 'Tabula'
              : assembled.source === 'optifine_cem'
                ? 'OptiFine CEM'
                : 'Java entity';
      // Equipment attachment points come from the recovered skeleton itself, so held
      // items and armour render on real bones instead of the mob's origin.
      const anchors = findAttachmentAnchorsFromGeometry(assembled.json);
      const anchorList = Object.entries(anchors)
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([slot, bone]) => `${slot}:${bone}`)
        .join(', ');
      log(
        `[MODEL] Linked authentic ${kind} model to mob "${mobId}" (${assembled.bonesCount} bones, ${assembled.cubesCount} cubes${(assembled.polyCount ?? 0) > 0 ? `, ${assembled.polyCount} polygons` : ''}${additionalParts.length ? `, ${additionalParts.length + 1} assembled parts` : ''}; attachment anchors ${anchorList || 'none recovered'})`,
      );
      continue;
    }

    // A model recovered ANYWHERE in the archive outranks a generic rig: a template is
    // never substituted while real geometry shipped. The best unbound recovered model is
    // reused, preferring one that shares the mob's own name tokens, and the reuse is
    // reported as an approximation instead of being presented as an exact link.
    const recoveredPool = [...geoByNorm.values()].filter((geo) => geo.source !== 'rigged_template');
    const tokens = mobId.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
    const scoreRecovered = (geo: ExtractedGeometry): number => {
      const norm = geo.id.toLowerCase().replace(/[^a-z0-9]/g, '');
      const tokenHit = tokens.some((token) => norm.includes(token)) ? 1 : 0;
      return tokenHit * 1000 + (geo.cubesCount ?? 0);
    };
    const preferred = recoveredPool
      .filter((geo) => !boundGeometries.has(geo))
      .sort((a, b) => scoreRecovered(b) - scoreRecovered(a))[0];

    if (preferred) {
      boundGeometries.add(preferred);
      entityGeometries.set(mobId, preferred);
      stats.approximateFallbackCount++;
      log(
        `[MODEL] Mob "${mobId}" -> reused recovered model "${preferred.id}" (${preferred.cubesCount} cubes) — a real model ships in the archive, so no rig template was generated.`,
      );
      continue;
    }

    const geo = generateRiggedMobGeometry(modId, mobId);
    entityGeometries.set(mobId, geo);
    stats.riggedMobGeometriesGenerated++;
    stats.mobsWithoutAuthenticModel.push(mobId);
    log(
      `[MODEL] Mob "${mobId}" -> generic rigged fallback (${geo.bonesCount} bones) — the archive holds no GeckoLib .geo.json or Java entity model at all.`,
    );
  }

  return { itemGeometries, entityGeometries, stats, registry };
}

/**
 * Builds authentic multi-bone rigged geometry for mobs when raw GeckoLib files are absent.
 * Provides proper bones: body, head, left_wing, right_wing, legs, stinger for bees;
 * body and inner_cube for slimes; head, body, arms, legs for bipeds.
 */
export function generateRiggedMobGeometry(modId: string, mobId: string): ExtractedGeometry {
  const lower = mobId.toLowerCase();
  const geoId = canonicalGeometryId(modId, mobId);

  // 1. Vehicles / Aircraft / Helicopters / Drones / Tanks
  if (lower.includes('copter') || lower.includes('helicopter') || lower.includes('plane') || lower.includes('drone') || lower.includes('aircraft') || lower.includes('tank') || lower.includes('vehicle')) {
    const vehicleBones = [
      { name: 'root', pivot: [0, 0, 0] },
      {
        name: 'body',
        parent: 'root',
        pivot: [0, 8, 0],
        cubes: [
          // Main fuselage / cabin
          { origin: [-6, 6, -10], size: [12, 10, 18], uv: [0, 0] },
          // Front glass cockpit
          { origin: [-5, 7, -15], size: [10, 8, 5], uv: [0, 28] },
          // Tail boom
          { origin: [-2, 10, 8], size: [4, 4, 14], uv: [30, 28] },
          // Tail vertical stabilizer
          { origin: [-0.5, 12, 18], size: [1, 8, 4], uv: [42, 0] },
        ],
      },
      {
        name: 'top_rotor',
        parent: 'body',
        pivot: [0, 17, -2],
        cubes: [
          // Rotor mast
          { origin: [-1, 16, -3], size: [2, 2, 2], uv: [52, 0] },
          // Spinning main rotor blades
          { origin: [-16, 17, -3], size: [32, 1, 3], uv: [0, 43] },
        ],
      },
      {
        name: 'landing_skids',
        parent: 'root',
        pivot: [0, 0, 0],
        cubes: [
          // Left skid
          { origin: [-6, 0, -11], size: [2, 1, 18], uv: [0, 47] },
          // Right skid
          { origin: [4, 0, -11], size: [2, 1, 18], uv: [0, 47] },
          // Skid struts
          { origin: [-6, 1, -6], size: [1, 5, 2], uv: [40, 47] },
          { origin: [5, 1, -6], size: [1, 5, 2], uv: [40, 47] },
          { origin: [-6, 1, 4], size: [1, 5, 2], uv: [40, 47] },
          { origin: [5, 1, 4], size: [1, 5, 2], uv: [40, 47] },
        ],
      },
    ];

    const geometry = {
      format_version: '1.12.0',
      'minecraft:geometry': [
        {
          description: {
            identifier: geoId,
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 3.5,
            visible_bounds_height: 2.5,
            visible_bounds_offset: [0, 1.0, 0],
          },
          bones: vehicleBones,
        },
        {
          description: {
            identifier: `geometry.${mobId}`,
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 3.5,
            visible_bounds_height: 2.5,
            visible_bounds_offset: [0, 1.0, 0],
          },
          bones: vehicleBones,
        },
        {
          description: {
            identifier: 'geometry.default',
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 3.5,
            visible_bounds_height: 2.5,
            visible_bounds_offset: [0, 1.0, 0],
          },
          bones: vehicleBones,
        },
      ],
    };

    return {
      id: geoId,
      json: JSON.stringify(geometry, null, 2),
      source: 'rigged_template',
      bonesCount: 3,
      cubesCount: 12,
    };
  }

  // 1b. Flying Bee / Wasp / Queen / Sentry Watcher
  if (lower.includes('bee') || lower.includes('fly') || lower.includes('wasp') || lower.includes('watcher') || lower.includes('queen') || lower.includes('wing') || lower.includes('bat') || lower.includes('dragon')) {
    const isQueen = lower.includes('queen');
    const scale = isQueen ? 1.6 : 1.0;

    const bones = [
      {
        name: 'root',
        pivot: [0, 6, 0],
      },
      {
        name: 'body',
        parent: 'root',
        pivot: [0, 6, 0],
        cubes: [
          { origin: [-5 * scale, 3 * scale, -6 * scale], size: [10 * scale, 8 * scale, 12 * scale], uv: [0, 0] },
        ],
      },
      {
        name: 'head',
        parent: 'body',
        pivot: [0, 7 * scale, -6 * scale],
        cubes: [
          { origin: [-4 * scale, 4 * scale, -10 * scale], size: [8 * scale, 6 * scale, 4 * scale], uv: [0, 20] },
          { origin: [-3 * scale, 10 * scale, -9 * scale], size: [1, 3, 1], uv: [24, 20] },
          { origin: [2 * scale, 10 * scale, -9 * scale], size: [1, 3, 1], uv: [24, 20] },
        ],
      },
      {
        name: 'left_wing',
        parent: 'body',
        pivot: [-3 * scale, 11 * scale, -2 * scale],
        cubes: [
          { origin: [-11 * scale, 11 * scale, -3 * scale], size: [8 * scale, 0.4, 6 * scale], uv: [0, 32] },
        ],
      },
      {
        name: 'right_wing',
        parent: 'body',
        pivot: [3 * scale, 11 * scale, -2 * scale],
        cubes: [
          { origin: [3 * scale, 11 * scale, -3 * scale], size: [8 * scale, 0.4, 6 * scale], uv: [0, 32] },
        ],
      },
      {
        name: 'stinger',
        parent: 'body',
        pivot: [0, 6 * scale, 6 * scale],
        cubes: [
          { origin: [-0.5 * scale, 5.5 * scale, 6 * scale], size: [1 * scale, 1 * scale, 4 * scale], uv: [28, 20] },
        ],
      },
      {
        name: 'legs',
        parent: 'body',
        pivot: [0, 3 * scale, 0],
        cubes: [
          { origin: [-3 * scale, 0, -3 * scale], size: [1, 3, 1], uv: [32, 0] },
          { origin: [2 * scale, 0, -3 * scale], size: [1, 3, 1], uv: [32, 0] },
          { origin: [-3 * scale, 0, 2 * scale], size: [1, 3, 1], uv: [32, 0] },
          { origin: [2 * scale, 0, 2 * scale], size: [1, 3, 1], uv: [32, 0] },
        ],
      },
    ];

    const geometry = {
      format_version: '1.12.0',
      'minecraft:geometry': [
        {
          description: {
            identifier: geoId,
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: isQueen ? 3.5 : 2.0,
            visible_bounds_height: isQueen ? 3.0 : 1.8,
            visible_bounds_offset: [0, isQueen ? 1.0 : 0.6, 0],
          },
          bones,
        },
        {
          description: {
            identifier: `geometry.${mobId}`,
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: isQueen ? 3.5 : 2.0,
            visible_bounds_height: isQueen ? 3.0 : 1.8,
            visible_bounds_offset: [0, isQueen ? 1.0 : 0.6, 0],
          },
          bones,
        },
        {
          description: {
            identifier: 'geometry.default',
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: isQueen ? 3.5 : 2.0,
            visible_bounds_height: isQueen ? 3.0 : 1.8,
            visible_bounds_offset: [0, isQueen ? 1.0 : 0.6, 0],
          },
          bones,
        },
      ],
    };

    return {
      id: geoId,
      json: JSON.stringify(geometry, null, 2),
      source: 'rigged_template',
      bonesCount: 7,
      cubesCount: 11,
    };
  }

  // 2. Honey Slime
  if (lower.includes('slime') || lower.includes('cube') || lower.includes('blob')) {
    const slimeBones = [
      {
        name: 'root',
        pivot: [0, 0, 0],
      },
      {
        name: 'body',
        parent: 'root',
        pivot: [0, 0, 0],
        cubes: [
          { origin: [-6, 0, -6], size: [12, 12, 12], uv: [0, 0] },
        ],
      },
      {
        name: 'inner_cube',
        parent: 'body',
        pivot: [0, 2, 0],
        cubes: [
          { origin: [-4, 2, -4], size: [8, 8, 8], uv: [0, 16] },
          { origin: [-3.5, 7, -4.5], size: [2, 2, 1], uv: [32, 0] },
          { origin: [1.5, 7, -4.5], size: [2, 2, 1], uv: [32, 0] },
          { origin: [-1, 3, -4.5], size: [2, 1, 1], uv: [32, 4] },
        ],
      },
    ];

    const geometry = {
      format_version: '1.12.0',
      'minecraft:geometry': [
        {
          description: {
            identifier: geoId,
            texture_width: 64,
            texture_height: 32,
            visible_bounds_width: 2.0,
            visible_bounds_height: 2.0,
            visible_bounds_offset: [0, 0.75, 0],
          },
          bones: slimeBones,
        },
        {
          description: {
            identifier: `geometry.${mobId}`,
            texture_width: 64,
            texture_height: 32,
            visible_bounds_width: 2.0,
            visible_bounds_height: 2.0,
            visible_bounds_offset: [0, 0.75, 0],
          },
          bones: slimeBones,
        },
        {
          description: {
            identifier: 'geometry.default',
            texture_width: 64,
            texture_height: 32,
            visible_bounds_width: 2.0,
            visible_bounds_height: 2.0,
            visible_bounds_offset: [0, 0.75, 0],
          },
          bones: slimeBones,
        },
      ],
    };

    return {
      id: geoId,
      json: JSON.stringify(geometry, null, 2),
      source: 'rigged_template',
      bonesCount: 3,
      cubesCount: 5,
    };
  }

  // 2b. Quadrupeds & Beasts (Hounds, Wolves, Barghests, Aspids, Bears)
  if (
    /(^|_)(dog|wolf|hound|barghest|horse|cow|bear|beast|aspid|arisaur|crawler|rat|rodent|lizard|serpent|snake|crab|spider|hog|boar|mouflon|sheep|cat|fox)(_|$)/.test(
      lower,
    )
  ) {
    const beastBones = [
      { name: 'root', pivot: [0, 0, 0] },
      {
        name: 'body',
        parent: 'root',
        pivot: [0, 8, 0],
        cubes: [{ origin: [-5, 6, -7], size: [10, 8, 14], uv: [0, 0] }],
      },
      {
        name: 'head',
        parent: 'body',
        pivot: [0, 11, -7],
        cubes: [
          { origin: [-3.5, 9, -13], size: [7, 6, 6], uv: [0, 22] },
          { origin: [-2, 8, -16], size: [4, 3, 4], uv: [26, 22] },
        ],
      },
      {
        name: 'leg0',
        parent: 'root',
        pivot: [-3.5, 6, -5],
        cubes: [{ origin: [-5, 0, -6.5], size: [3, 7, 3], uv: [34, 0] }],
      },
      {
        name: 'leg1',
        parent: 'root',
        pivot: [3.5, 6, -5],
        cubes: [{ origin: [2, 0, -6.5], size: [3, 7, 3], uv: [34, 0] }],
      },
      {
        name: 'leg2',
        parent: 'root',
        pivot: [-3.5, 6, 5],
        cubes: [{ origin: [-5, 0, 3.5], size: [3, 7, 3], uv: [34, 10] }],
      },
      {
        name: 'leg3',
        parent: 'root',
        pivot: [3.5, 6, 5],
        cubes: [{ origin: [2, 0, 3.5], size: [3, 7, 3], uv: [34, 10] }],
      },
      {
        name: 'tail',
        parent: 'body',
        pivot: [0, 11, 7],
        cubes: [{ origin: [-1, 9, 7], size: [2, 2, 7], uv: [42, 22] }],
      },
    ];

    const geometry = {
      format_version: '1.12.0',
      'minecraft:geometry': [
        {
          description: {
            identifier: geoId,
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 2.5,
            visible_bounds_height: 2.0,
            visible_bounds_offset: [0, 0.8, 0],
          },
          bones: beastBones,
        },
        {
          description: {
            identifier: `geometry.${mobId}`,
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 2.5,
            visible_bounds_height: 2.0,
            visible_bounds_offset: [0, 0.8, 0],
          },
          bones: beastBones,
        },
        {
          description: {
            identifier: 'geometry.default',
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 2.5,
            visible_bounds_height: 2.0,
            visible_bounds_offset: [0, 0.8, 0],
          },
          bones: beastBones,
        },
      ],
    };

    return {
      id: geoId,
      json: JSON.stringify(geometry, null, 2),
      source: 'rigged_template',
      bonesCount: 7,
      cubesCount: 8,
    };
  }

  // 2c. Objects, Pedestals, Plushes, Stations
  if (lower.includes('plush') || lower.includes('pedestal') || lower.includes('station') || lower.includes('machine') || lower.includes('infuser') || lower.includes('portal') || lower.includes('chest') || lower.includes('mimic') || lower.includes('coffer')) {
    const objectBones = [
      { name: 'root', pivot: [0, 0, 0] },
      {
        name: 'base',
        parent: 'root',
        pivot: [0, 0, 0],
        cubes: [{ origin: [-6, 0, -6], size: [12, 3, 12], uv: [0, 0] }],
      },
      {
        name: 'body',
        parent: 'base',
        pivot: [0, 3, 0],
        cubes: [{ origin: [-5, 3, -5], size: [10, 10, 10], uv: [0, 15] }],
      },
      {
        name: 'head',
        parent: 'body',
        pivot: [0, 13, 0],
        cubes: [{ origin: [-4, 13, -4], size: [8, 8, 8], uv: [0, 35] }],
      },
    ];

    const geometry = {
      format_version: '1.12.0',
      'minecraft:geometry': [
        {
          description: {
            identifier: geoId,
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 2.0,
            visible_bounds_height: 2.0,
            visible_bounds_offset: [0, 0.75, 0],
          },
          bones: objectBones,
        },
        {
          description: {
            identifier: `geometry.${mobId}`,
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 2.0,
            visible_bounds_height: 2.0,
            visible_bounds_offset: [0, 0.75, 0],
          },
          bones: objectBones,
        },
        {
          description: {
            identifier: 'geometry.default',
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 2.0,
            visible_bounds_height: 2.0,
            visible_bounds_offset: [0, 0.75, 0],
          },
          bones: objectBones,
        },
      ],
    };

    return {
      id: geoId,
      json: JSON.stringify(geometry, null, 2),
      source: 'rigged_template',
      bonesCount: 3,
      cubesCount: 3,
    };
  }

  // 3. Biped (e.g. Rootmin, humanoids)
  const bipedBones = [
    { name: 'root', pivot: [0, 0, 0] },
    {
      name: 'body',
      parent: 'root',
      pivot: [0, 12, 0],
      cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }],
    },
    {
      name: 'head',
      parent: 'body',
      pivot: [0, 24, 0],
      cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }],
    },
    {
      name: 'left_arm',
      parent: 'body',
      pivot: [-5, 22, 0],
      cubes: [{ origin: [-8, 12, -2], size: [4, 12, 4], uv: [32, 48] }],
    },
    {
      name: 'right_arm',
      parent: 'body',
      pivot: [5, 22, 0],
      cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [40, 16] }],
    },
    {
      name: 'left_leg',
      parent: 'root',
      pivot: [-2, 12, 0],
      cubes: [{ origin: [-4, 0, -2], size: [4, 12, 4], uv: [16, 48] }],
    },
    {
      name: 'right_leg',
      parent: 'root',
      pivot: [2, 12, 0],
      cubes: [{ origin: [0, 0, -2], size: [4, 12, 4], uv: [0, 16] }],
    },
  ];

  const geometry = {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: geoId,
          texture_width: 64,
          texture_height: 64,
          visible_bounds_width: 2.0,
          visible_bounds_height: 2.5,
          visible_bounds_offset: [0, 1.0, 0],
        },
        bones: bipedBones,
      },
        {
          description: {
            identifier: `geometry.${mobId}`,
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 2.0,
            visible_bounds_height: 2.5,
            visible_bounds_offset: [0, 1.0, 0],
          },
          bones: bipedBones,
        },
        {
          description: {
            identifier: 'geometry.default',
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 2.0,
            visible_bounds_height: 2.5,
            visible_bounds_offset: [0, 1.0, 0],
          },
          bones: bipedBones,
        },
    ],
  };

  return {
    id: geoId,
    json: JSON.stringify(geometry, null, 2),
    source: 'rigged_template',
    bonesCount: 7,
    cubesCount: 6,
  };
}