/**
 * Shipped Bedrock geometry → diagnostic preview scene.
 *
 * The preview never invents structure: it reads the exact JSON that is about to be zipped
 * (cubes, bones, pivots, rotations and `poly_mesh` polygons) so an operator can see whether a
 * converted model still has legs, a head and a torso before testing it in game. Bones that
 * declare nothing renderable and bones whose declared parent is missing are listed instead of
 * being drawn as if the model were complete.
 */

export type Vec3 = [number, number, number];

export interface PreviewBone {
  name: string;
  parent?: string;
  pivot: Vec3;
  rotation: Vec3;
}

export interface PreviewCube {
  bone: string;
  origin: Vec3;
  size: Vec3;
}

export interface PreviewPolygon {
  bone: string;
  points: Vec3[];
}

export interface PreviewScene {
  path: string;
  identifier: string;
  bones: PreviewBone[];
  cubes: PreviewCube[];
  polygons: PreviewPolygon[];
  /** Bones whose own subtree declares neither a cube nor a polygon — they render nothing. */
  emptyBones: string[];
  /** Bones whose declared parent is absent from the document (broken chain). */
  orphanBones: string[];
  notes: string[];
}

export interface GeometryDocument {
  path: string;
  label: string;
  identifier: string;
  text: string;
}

const MAX_CUBES = 900;
const MAX_POLYGONS = 4000;
const MIN_AXIS = 0.1;
const decoder = new TextDecoder();

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const vec3 = (value: unknown): Vec3 =>
  Array.isArray(value) && value.length >= 3 ? [num(value[0]), num(value[1]), num(value[2])] : [0, 0, 0];

const decode = (raw: string | Uint8Array): string => {
  if (typeof raw === 'string') return raw;
  try {
    return decoder.decode(raw);
  } catch {
    return '';
  }
};

const identifierOf = (text: string): string => {
  try {
    const list = JSON.parse(text)?.['minecraft:geometry'];
    return Array.isArray(list) ? String(list[0]?.description?.identifier ?? '') : '';
  } catch {
    return '';
  }
};

/** Every geometry document the exported resource pack really ships. */
export function listGeometryDocuments(
  files?: Record<string, string | Uint8Array> | null,
): GeometryDocument[] {
  if (!files) return [];
  const out: GeometryDocument[] = [];
  for (const path of Object.keys(files)) {
    const lower = path.toLowerCase();
    if (!lower.startsWith('models/') || !lower.endsWith('.json')) continue;
    const text = decode(files[path]);
    if (!text.includes('minecraft:geometry')) continue;
    const identifier = identifierOf(text);
    if (!identifier) continue;
    out.push({
      path,
      label: path.replace(/^models\//i, '').replace(/\.(geo\.)?json$/i, ''),
      identifier,
      text,
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Reads one geometry document into a drawable scene. Returns null when nothing is declared. */
export function buildPreviewScene(text: string, path: string): PreviewScene | null {
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(doc?.['minecraft:geometry']) ? doc['minecraft:geometry'] : [];
  const variant =
    list.find((entry: any) => Array.isArray(entry?.bones) && entry.bones.length > 0) ?? list[0];
  if (!variant) return null;

  const bones: PreviewBone[] = [];
  const cubes: PreviewCube[] = [];
  const polygons: PreviewPolygon[] = [];
  const notes: string[] = [];
  const names = new Set<string>();
  const filled = new Set<string>();
  const sourceBones: any[] = Array.isArray(variant.bones) ? variant.bones : [];
  let clippedCubes = 0;
  let clippedPolys = 0;
  let flatCubes = 0;
  let declaredPolys = 0;

  for (const raw of sourceBones) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name ?? '');
    if (!name) continue;
    bones.push({
      name,
      parent: typeof raw.parent === 'string' && raw.parent ? raw.parent : undefined,
      pivot: vec3(raw.pivot),
      rotation: vec3(raw.rotation),
    });
    names.add(name);

    for (const cube of Array.isArray(raw.cubes) ? raw.cubes : []) {
      if (cubes.length >= MAX_CUBES) {
        clippedCubes += 1;
        continue;
      }
      const origin = vec3(cube?.origin);
      const rawSize = vec3(cube?.size);
      if (Math.abs(rawSize[0]) < MIN_AXIS || Math.abs(rawSize[1]) < MIN_AXIS || Math.abs(rawSize[2]) < MIN_AXIS) {
        flatCubes += 1;
      }
      cubes.push({
        bone: name,
        origin,
        size: [
          Math.abs(rawSize[0]) || MIN_AXIS,
          Math.abs(rawSize[1]) || MIN_AXIS,
          Math.abs(rawSize[2]) || MIN_AXIS,
        ],
      });
      filled.add(name);
    }

    const mesh = raw.poly_mesh;
    const positions = Array.isArray(mesh?.positions) ? mesh.positions.map(vec3) : [];
    const declared = Array.isArray(mesh?.polys) ? mesh.polys : [];
    declaredPolys += declared.length;
    for (const poly of declared) {
      if (polygons.length >= MAX_POLYGONS) {
        clippedPolys += 1;
        continue;
      }
      const indices = Array.isArray(poly)
        ? poly
        : [poly?.a, poly?.b, poly?.c, poly?.d].filter((value) => value != null);
      const points = indices
        .map((index: unknown) => positions[num(index)])
        .filter((point: Vec3 | undefined): point is Vec3 => Array.isArray(point));
      if (points.length < 3) continue;
      polygons.push({ bone: name, points });
      filled.add(name);
    }
  }

  if (bones.length === 0) return null;

  // Propagate "declares something" up the chain: a parent bone is only reported as empty when
  // no descendant renders either.
  const byName = new Map(bones.map((bone) => [bone.name, bone]));
  const subtreeFilled = new Set<string>();
  for (const bone of bones) {
    if (!filled.has(bone.name)) continue;
    let current: PreviewBone | undefined = bone;
    const seen = new Set<string>();
    while (current && !seen.has(current.name)) {
      seen.add(current.name);
      subtreeFilled.add(current.name);
      current = current.parent ? byName.get(current.parent) : undefined;
    }
  }
  const emptyBones = bones.filter((bone) => !subtreeFilled.has(bone.name)).map((bone) => bone.name);
  const orphanBones = bones
    .filter((bone) => bone.parent && !names.has(bone.parent))
    .map((bone) => `${bone.name} → ${bone.parent}`);

  if (sourceBones.length !== bones.length) {
    notes.push(`${sourceBones.length - bones.length} unnamed bone(s) skipped`);
  }
  if (clippedCubes > 0) notes.push(`${clippedCubes} cube(s) beyond the ${MAX_CUBES}-cube preview cap`);
  if (clippedPolys > 0) notes.push(`${clippedPolys} polygon(s) beyond the ${MAX_POLYGONS}-polygon preview cap`);
  if (flatCubes > 0) notes.push(`${flatCubes} cube(s) had a zero-size axis (clamped to ${MIN_AXIS} for drawing)`);
  if (declaredPolys > polygons.length) {
    notes.push(`polygon mesh: ${declaredPolys} declared polygon(s), ${polygons.length} drawn`);
  }

  return {
    path,
    identifier: String(variant.description?.identifier ?? path),
    bones,
    cubes,
    polygons,
    emptyBones,
    orphanBones,
    notes,
  };
}