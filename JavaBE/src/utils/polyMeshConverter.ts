import { canonicalGeometryId } from '@/utils/geometryRegistry';

/**
 * Polygon-mesh (`poly_mesh`) conversion.
 *
 * A cube/box writer can only express axis-aligned boxes. Java mods that ship polygon
 * meshes — Bedrock-style `poly_mesh` documents or Wavefront `.obj` files loaded by a
 * model library — previously produced zero cubes, so the entity converter reported "no
 * geometry", the mob stayed invisible and its parts never rendered. Bedrock does support
 * polygon meshes natively at bone level, so the mesh is carried across verbatim instead of
 * being dropped or replaced by a box rig.
 *
 * Everything here is derived from the source document: positions, polygons, per-polygon
 * UVs, normals, bone names and bone parents. UVs are only derived when the source carries
 * none, and that is reported as ADAPTED rather than presented as source data.
 */

export interface PolyMeshConversion {
  id: string;
  json: string;
  bones: number;
  polys: number;
  /** True when the source carried no usable UVs and a planar projection was derived (ADAPTED). */
  uvDerived: boolean;
  notes: string[];
}

type Vec3 = [number, number, number];

interface EmittedPoly {
  /** Position indices of this polygon. */
  verts: number[];
  /** Vertex slots inside the source polygon, used to line up its UV list. */
  slots: number[];
  source: number;
}

interface Bounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

const MAX_POSITIONS = 6000;
const MAX_POLYS = 10000;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function vec3Of(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = finite(value[0]);
  const y = finite(value[1]);
  const z = finite(value[2]);
  if (x === null || y === null || z === null) return null;
  return [x, y, z];
}

function vec2Of(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const u = finite(value[0]);
  const v = finite(value[1]);
  if (u === null || v === null) return null;
  return [u, v];
}

const round = (value: number, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function sheetSize(value: unknown, fallback: number): number {
  const parsed = finite(value);
  if (parsed === null) return fallback;
  const rounded = Math.round(parsed);
  return rounded >= 8 && rounded <= 2048 ? rounded : fallback;
}

/** True for a JSON payload that declares a polygon mesh anywhere in the document. */
export function looksLikePolyMeshDocument(text: string): boolean {
  return /"poly_mesh"\s*:/.test(text);
}

/** True for Wavefront OBJ text that actually carries faces. */
export function isWavefrontObjText(text: string): boolean {
  return /^\s*v\s+[-0-9.]/m.test(text) && /^\s*f\s+\S+/m.test(text);
}

function boundsOf(positions: Vec3[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const [x, y, z] of positions) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** Indices of one source polygon, clamped to the positions that really exist. */
function polyIndicesOf(entry: unknown, positionCount: number): number[] {
  let raw: unknown[] = [];
  if (Array.isArray(entry)) raw = entry;
  else if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    raw = ['a', 'b', 'c', 'd'].map((key) => record[key]);
  }
  const indices: number[] = [];
  for (const value of raw) {
    const index = finite(value);
    if (index === null) continue;
    const clean = Math.round(index);
    if (clean < 0 || clean >= positionCount) continue;
    indices.push(clean);
  }
  return indices;
}

/**
 * Normalises one `poly_mesh` block into the schema Bedrock reads: integer position
 * indices, `tri_type` polygons, `normalized_uvs` UVs (one pair per polygon vertex) and
 * optional per-position normals. UVs are derived only when the source has none.
 */
export function normalisePolyMeshData(
  raw: unknown,
  options: { textureWidth: number; textureHeight: number; notes?: string[] },
): { polyMesh: Record<string, unknown> | null; polys: number; uvDerived: boolean } {
  const notes = options.notes;
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!record) return { polyMesh: null, polys: 0, uvDerived: false };

  const positions: Vec3[] = [];
  const rawPositions = Array.isArray(record.positions) ? record.positions : [];
  for (const entry of rawPositions) {
    const vector = vec3Of(entry);
    if (!vector) continue;
    positions.push([round(vector[0]), round(vector[1]), round(vector[2])]);
    if (positions.length >= MAX_POSITIONS) break;
  }
  if (positions.length < 3) return { polyMesh: null, polys: 0, uvDerived: false };

  const emitted: EmittedPoly[] = [];
  const rawPolys = Array.isArray(record.polys) ? record.polys : [];
  for (let source = 0; source < rawPolys.length; source += 1) {
    if (emitted.length >= MAX_POLYS) break;
    const indices = polyIndicesOf(rawPolys[source], positions.length);
    if (indices.length < 3) continue;
    if (indices.length === 4) {
      emitted.push({ verts: indices, slots: [0, 1, 2, 3], source });
      continue;
    }
    // Anything larger than a quad is fanned into triangles; Bedrock has no n-gon polygon.
    for (let i = 1; i + 1 < indices.length && emitted.length < MAX_POLYS; i += 1) {
      emitted.push({ verts: [indices[0], indices[i], indices[i + 1]], slots: [0, i, i + 1], source });
    }
  }
  if (emitted.length === 0) return { polyMesh: null, polys: 0, uvDerived: false };

  const bounds = boundsOf(positions);
  const spanX = bounds.maxX - bounds.minX || 1;
  const spanY = bounds.maxY - bounds.minY || 1;
  const rawUvs = Array.isArray(record.uvs) ? record.uvs : null;
  let maxUv = 0;
  if (rawUvs) {
    for (const entry of rawUvs) {
      if (!Array.isArray(entry)) continue;
      for (const pair of entry) {
        const uv = vec2Of(pair);
        if (!uv) continue;
        maxUv = Math.max(maxUv, Math.abs(uv[0]), Math.abs(uv[1]));
      }
    }
  }
  // UVs authored in texture pixels are normalised; UVs already in 0..1 are kept as-is.
  const scaleU = maxUv > 1.05 ? 1 / Math.max(1, options.textureWidth) : 1;
  const scaleV = maxUv > 1.05 ? 1 / Math.max(1, options.textureHeight) : 1;

  const uvs: number[][][] = [];
  let uvDerived = false;
  for (const poly of emitted) {
    const sourceList = rawUvs && Array.isArray(rawUvs[poly.source]) ? (rawUvs[poly.source] as unknown[]) : [];
    const mapped: number[][] = [];
    let complete = sourceList.length > 0;
    for (const slot of poly.slots) {
      const uv = complete ? vec2Of(sourceList[slot]) : null;
      if (!uv) {
        complete = false;
        break;
      }
      mapped.push([round(uv[0] * scaleU), round(uv[1] * scaleV)]);
    }
    if (!complete) {
      uvDerived = true;
      mapped.length = 0;
      for (const index of poly.verts) {
        const [x, y] = positions[index];
        mapped.push([round(clamp01((x - bounds.minX) / spanX)), round(clamp01(1 - (y - bounds.minY) / spanY))]);
      }
    }
    uvs.push(mapped);
  }

  const polys = emitted.map((poly) => {
    if (poly.verts.length === 4) {
      return { tri_type: 'quad', a: poly.verts[0], b: poly.verts[1], c: poly.verts[2], d: poly.verts[3] };
    }
    return { tri_type: 'tri', a: poly.verts[0], b: poly.verts[1], c: poly.verts[2] };
  });

  const polyMesh: Record<string, unknown> = { normalized_uvs: true, positions, uvs, polys };
  const rawNormals = Array.isArray(record.normals) ? record.normals : [];
  const normals: Vec3[] = [];
  for (const entry of rawNormals) {
    const vector = vec3Of(entry);
    if (vector) normals.push([round(vector[0]), round(vector[1]), round(vector[2])]);
  }
  if (normals.length === positions.length) polyMesh.normals = normals;

  if (uvDerived) {
    notes?.push(
      'polygon mesh carried no usable UV list, so a planar projection from its own vertex coordinates was bound (ADAPTED, reported instead of presented as source UV data)',
    );
  }
  return { polyMesh, polys: polys.length, uvDerived };
}

function visibleBounds(bones: Record<string, unknown>[]): { width: number; height: number; offset: [number, number, number] } {
  const all: Vec3[] = [];
  for (const bone of bones) {
    const mesh = bone.poly_mesh as Record<string, unknown> | undefined;
    if (!mesh || !Array.isArray(mesh.positions)) continue;
    for (const entry of mesh.positions) {
      const vector = vec3Of(entry);
      if (vector) all.push(vector);
    }
  }
  if (all.length === 0) return { width: 1, height: 1, offset: [0, 0.5, 0] };
  const bounds = boundsOf(all);
  const width = Math.max(1, round(Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 16) * 1.4);
  const height = Math.max(1, round((bounds.maxY - bounds.minY) / 16) + 0.4);
  return { width, height, offset: [0, round((bounds.minY + bounds.maxY) / 32), 0] };
}

/**
 * Converts a Bedrock-style `poly_mesh` geometry document (bone-level or variant-level
 * meshes, optionally mixed with cube bones) into a schema-clean geometry document that
 * keeps every polygon.
 */
export function convertPolyMeshDocument(input: {
  modId: string;
  assetId: string;
  text: string;
  textureWidth?: number;
  textureHeight?: number;
}): PolyMeshConversion | null {
  let doc: unknown;
  try {
    doc = JSON.parse(input.text) as unknown;
  } catch {
    return null;
  }
  const root = doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : null;
  if (!root) return null;
  const list = Array.isArray(root['minecraft:geometry']) ? (root['minecraft:geometry'] as unknown[]) : [];
  const variants: unknown[] =
    list.length > 0 ? list : [{ description: {}, bones: [], poly_mesh: root.poly_mesh }];
  const identifier = canonicalGeometryId(input.modId, input.assetId);
  const notes: string[] = [];
  const written: Record<string, unknown>[] = [];
  let boneTotal = 0;
  let polyTotal = 0;
  let uvDerived = false;

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index] && typeof variants[index] === 'object'
      ? (variants[index] as Record<string, unknown>)
      : null;
    if (!variant) continue;
    const description: Record<string, unknown> = variant.description && typeof variant.description === 'object'
      ? { ...(variant.description as Record<string, unknown>) }
      : {};
    const textureWidth = sheetSize(description.texture_width ?? input.textureWidth, 64);
    const textureHeight = sheetSize(description.texture_height ?? input.textureHeight, 64);

    const outBones: Record<string, unknown>[] = [];
    const sourceBones = Array.isArray(variant.bones) ? variant.bones : [];
    for (const rawBone of sourceBones) {
      const bone = rawBone && typeof rawBone === 'object' ? { ...(rawBone as Record<string, unknown>) } : null;
      if (!bone) continue;
      const mesh = bone.poly_mesh;
      if (mesh && typeof mesh === 'object') {
        const normalised = normalisePolyMeshData(mesh, { textureWidth, textureHeight, notes });
        if (!normalised.polyMesh) continue;
        bone.poly_mesh = normalised.polyMesh;
        polyTotal += normalised.polys;
        uvDerived = uvDerived || normalised.uvDerived;
      }
      const cubes = Array.isArray(bone.cubes) ? bone.cubes : [];
      if (cubes.length === 0 && !bone.poly_mesh) {
        // Parent-only bones are kept: dropping one breaks the chain of its children.
        if (typeof bone.parent !== 'string') continue;
      }
      outBones.push(bone);
    }

    if (outBones.length === 0 && variant.poly_mesh) {
      const normalised = normalisePolyMeshData(variant.poly_mesh, { textureWidth, textureHeight, notes });
      if (normalised.polyMesh) {
        outBones.push({ name: 'root', pivot: [0, 0, 0], poly_mesh: normalised.polyMesh });
        polyTotal += normalised.polys;
        uvDerived = uvDerived || normalised.uvDerived;
      }
    }
    if (outBones.length === 0) continue;

    const bounds = visibleBounds(outBones);
    description.identifier = index === 0 ? identifier : `${identifier}_variant_${index + 1}`;
    description.texture_width = textureWidth;
    description.texture_height = textureHeight;
    description.visible_bounds_width = finite(description.visible_bounds_width) ?? bounds.width;
    description.visible_bounds_height = finite(description.visible_bounds_height) ?? bounds.height;
    description.visible_bounds_offset = Array.isArray(description.visible_bounds_offset)
      ? description.visible_bounds_offset
      : bounds.offset;
    boneTotal += outBones.length;
    written.push({ description, bones: outBones });
  }

  if (written.length === 0) return null;
  return {
    id: String((written[0].description as Record<string, unknown>).identifier ?? identifier),
    json: JSON.stringify({ format_version: '1.16.0', 'minecraft:geometry': written }, null, 2),
    bones: boneTotal,
    polys: polyTotal,
    uvDerived,
    notes,
  };
}

interface ObjRef {
  v: number;
  vt: number | null;
}

function parseObjRef(token: string): ObjRef | null {
  const parts = token.split('/');
  const v = finite(parts[0]);
  if (v === null) return null;
  const index = Math.round(v);
  // OBJ indices are 1-based; a negative index counts back from the end.
  const vtRaw = parts.length > 1 ? finite(parts[1]) : null;
  const vt = vtRaw === null ? null : Math.round(vtRaw);
  return { v: index, vt };
}

function objIndex(raw: number, total: number): number | null {
  if (raw > 0) {
    const index = raw - 1;
    return index < total ? index : null;
  }
  if (raw < 0) {
    const index = total + raw;
    return index >= 0 ? index : null;
  }
  return null;
}

/**
 * Converts a Wavefront `.obj` model into a Bedrock polygon-mesh geometry, one bone per
 * OBJ object/group. Units authored in blocks (small float coordinates) are scaled to the
 * 16-unit model space Bedrock uses; faces are triangulated and VT coordinates are mapped
 * from OBJ's bottom-left origin to Bedrock's top-left origin.
 */
export function convertObjToPolyMesh(input: {
  modId: string;
  assetId: string;
  text: string;
  textureWidth?: number;
  textureHeight?: number;
}): PolyMeshConversion | null {
  const textureWidth = sheetSize(input.textureWidth, 64);
  const textureHeight = sheetSize(input.textureHeight, 64);
  const notes: string[] = [];
  const vertices: Vec3[] = [];
  const textureCoords: Array<[number, number]> = [];
  const groups = new Map<string, ObjRef[][]>();
  let currentGroup = 'root';

  for (const rawLine of input.text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const tag = parts[0].toLowerCase();
    if (tag === 'v' && parts.length >= 4) {
      const vector = vec3Of([finite(parts[1]), finite(parts[2]), finite(parts[3])]);
      if (vector) vertices.push(vector);
      if (vertices.length >= MAX_POSITIONS) break;
      continue;
    }
    if (tag === 'vt' && parts.length >= 3) {
      const u = finite(parts[1]);
      const v = finite(parts[2]);
      if (u !== null && v !== null) textureCoords.push([u, v]);
      continue;
    }
    if (tag === 'o' || tag === 'g') {
      const name = parts.slice(1).join('_').replace(/[^A-Za-z0-9_]+/g, '_');
      if (name) currentGroup = name;
      continue;
    }
    if (tag !== 'f' || parts.length < 4) continue;
    const refs: ObjRef[] = [];
    for (const token of parts.slice(1)) {
      const ref = parseObjRef(token);
      if (ref) refs.push(ref);
    }
    if (refs.length < 3) continue;
    const bucket = groups.get(currentGroup) ?? [];
    bucket.push(refs);
    groups.set(currentGroup, bucket);
  }

  if (vertices.length === 0 || groups.size === 0) return null;

  const bounds = boundsOf(vertices);
  const maxAbs = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX), Math.abs(bounds.minY), Math.abs(bounds.maxY), Math.abs(bounds.minZ), Math.abs(bounds.maxZ));
  // Block-sized source files (≤4 units) are authored in metres; larger ones already use
  // the 16-unit model space.
  const unitScale = maxAbs <= 4 ? 16 : 1;
  if (unitScale === 16) {
    notes.push('OBJ coordinates were authored in blocks and scaled ×16 into Bedrock model units (ADAPTED, reported)');
  }

  const bones: Record<string, unknown>[] = [];
  let polyTotal = 0;
  let uvDerived = false;

  for (const [name, faces] of groups) {
    const local = new Map<number, number>();
    const positions: Vec3[] = [];
    const uvs: number[][][] = [];
    const polys: Record<string, unknown>[] = [];

    const positionIndex = (globalIndex: number): number | null => {
      const resolved = objIndex(globalIndex, vertices.length);
      if (resolved === null) return null;
      const existing = local.get(resolved);
      if (existing !== undefined) return existing;
      const source = vertices[resolved];
      positions.push([round(source[0] * unitScale), round(source[1] * unitScale), round(source[2] * unitScale)]);
      const index = positions.length - 1;
      local.set(resolved, index);
      return index;
    };

    for (const face of faces) {
      if (polys.length >= MAX_POLYS) break;
      for (let i = 1; i + 1 < face.length && polys.length < MAX_POLYS; i += 1) {
        const triangle = [face[0], face[i], face[i + 1]];
        const indices: number[] = [];
        const uvList: number[][] = [];
        let complete = true;
        for (const ref of triangle) {
          const index = positionIndex(ref.v);
          if (index === null) {
            complete = false;
            break;
          }
          indices.push(index);
          const uv = ref.vt === null ? null : textureCoords[objIndex(ref.vt, textureCoords.length) ?? -1];
          if (!uv) {
            complete = false;
            break;
          }
          // OBJ samples from the bottom-left; Bedrock samples from the top-left.
          uvList.push([round(uv[0]), round(1 - uv[1])]);
        }
        if (!complete || indices.length < 3) {
          if (indices.length >= 3) {
            uvDerived = true;
            const localBounds = boundsOf(positions);
            const spanX = localBounds.maxX - localBounds.minX || 1;
            const spanY = localBounds.maxY - localBounds.minY || 1;
            uvList.length = 0;
            for (const index of indices) {
              const [x, y] = positions[index];
              uvList.push([
                round(clamp01((x - localBounds.minX) / spanX)),
                round(clamp01(1 - (y - localBounds.minY) / spanY)),
              ]);
            }
          } else {
            continue;
          }
        }
        uvs.push(uvList);
        polys.push({ tri_type: 'tri', a: indices[0], b: indices[1], c: indices[2] });
      }
    }

    if (polys.length === 0) continue;
    polyTotal += polys.length;
    bones.push({
      name: name.toLowerCase().replace(/[^a-z0-9_]+/g, '_') || 'root',
      pivot: [0, 0, 0],
      poly_mesh: { normalized_uvs: true, positions, uvs, polys },
    });
  }

  if (bones.length === 0) return null;
  const identifier = canonicalGeometryId(input.modId, input.assetId);
  const size = visibleBounds(bones);
  const document = {
    format_version: '1.16.0',
    'minecraft:geometry': [
      {
        description: {
          identifier,
          texture_width: textureWidth,
          texture_height: textureHeight,
          visible_bounds_width: size.width,
          visible_bounds_height: size.height,
          visible_bounds_offset: size.offset,
        },
        bones,
      },
    ],
  };
  return {
    id: identifier,
    json: JSON.stringify(document, null, 2),
    bones: bones.length,
    polys: polyTotal,
    uvDerived,
    notes,
  };
}