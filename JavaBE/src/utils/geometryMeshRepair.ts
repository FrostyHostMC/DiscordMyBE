import { normalisePolyMeshData } from '@/utils/polyMeshConverter';
import { anatomyFamily, anatomyPenalty, describeBoneAnatomy } from '@/utils/boneAnatomy';

/**
 * Geometry / mesh integrity repair.
 *
 * Two in-game failures come from the geometry document itself, not from the entity
 * definition:
 *
 *  • an invisible or half-rendered mob — a bone whose `parent` names a bone that does not
 *    exist, or two bones with the same name, makes Bedrock drop that bone's whole chain, so
 *    legs, head or torso silently stop rendering;
 *  • a part that renders as nothing — a cube that carries no `uv` map samples nothing, and a
 *    cube with a zero-size axis is degenerate.
 *
 * This pass repairs exactly those structural defects in the shipped geometry documents and
 * reports everything it could not express. It never invents a bone, a model or a texture
 * reference: a bone is only re-parented inside the same document, and a cube only receives a
 * UV layout derived from its own size.
 */

type PackFiles = Record<string, string | Uint8Array>;

export interface MeshRepairReport {
  geometryFiles: number;
  variants: number;
  bonesReparented: number;
  duplicateBonesRenamed: number;
  parentCyclesBroken: number;
  pivotsRestored: number;
  cubeUvsRestored: number;
  degenerateCubesFixed: number;
  polyMeshBonesPreserved: number;
  polyMeshUvsDerived: number;
  emptyBonesDropped: number;
  /** Geometry variants that still declare nothing renderable. */
  unresolved: string[];
  log: string[];
}

/** Cheapest anatomically valid candidate (finite cost), or null when none is compatible. */
function pickCheapest(name: string, candidates: string[]): string | null {
  const ranked = candidates
    .map((candidate) => ({ candidate, penalty: anatomyPenalty(name, candidate) }))
    .filter((entry) => Number.isFinite(entry.penalty))
    .sort((a, b) => a.penalty - b.penalty);
  return ranked[0]?.candidate ?? null;
}

const round = (value: number, digits = 3): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numbers3(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const out: number[] = [];
  for (const entry of value.slice(0, 3)) {
    const parsed = finite(entry);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

/** Bedrock box-UV expansion: one `uv` origin becomes six per-face rectangles. */
function expandBoxUv(
  u: number,
  v: number,
  width: number,
  height: number,
  depth: number,
): Record<string, { uv: number[]; uv_size: number[] }> {
  const w = Math.max(0.0001, Math.abs(width));
  const h = Math.max(0.0001, Math.abs(height));
  const d = Math.max(0.0001, Math.abs(depth));
  return {
    north: { uv: [u + d, v + d], uv_size: [w, h] },
    east: { uv: [u, v + d], uv_size: [d, h] },
    south: { uv: [u + d + w + d, v + d], uv_size: [-w, h] },
    west: { uv: [u + d + w, v + d], uv_size: [-d, h] },
    up: { uv: [u + d, v], uv_size: [w, d] },
    down: { uv: [u + d + w, v + d], uv_size: [w, -d] },
  };
}

interface RepairContext {
  report: MeshRepairReport;
  identifier: string;
}

function repairCube(cube: Record<string, unknown>, context: RepairContext): void {
  const origin = numbers3(cube.origin) ?? [0, 0, 0];
  cube.origin = origin.map((value) => round(value));
  const size = numbers3(cube.size);
  if (!size) {
    cube.size = [1, 1, 1];
    context.report.degenerateCubesFixed += 1;
  } else {
    let fixed = false;
    const clean = size.map((value) => {
      if (Math.abs(value) >= 0.01) return round(value);
      fixed = true;
      return 0.05;
    });
    cube.size = clean;
    if (fixed) context.report.degenerateCubesFixed += 1;
  }

  const sizeVec = cube.size as number[];
  const current = cube.uv;
  // A two-number `uv` is a box-UV origin and a populated object is a face map: both are
  // valid Bedrock and are left exactly as authored. Only a cube with no UV data at all is
  // repaired, because that cube samples nothing and renders as a hole in the model.
  if (Array.isArray(current) && current.length >= 2) return;
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    const faces = Object.keys(current as Record<string, unknown>);
    if (faces.length > 0) return;
  }
  cube.uv = expandBoxUv(0, 0, sizeVec[0], sizeVec[1], sizeVec[2]);
  context.report.cubeUvsRestored += 1;
}

function repairPolyMesh(bone: Record<string, unknown>, textureWidth: number, textureHeight: number, context: RepairContext): void {
  const normalised = normalisePolyMeshData(bone.poly_mesh, { textureWidth, textureHeight });
  if (!normalised.polyMesh) {
    delete bone.poly_mesh;
    return;
  }
  bone.poly_mesh = normalised.polyMesh;
  context.report.polyMeshBonesPreserved += 1;
  if (normalised.uvDerived) context.report.polyMeshUvsDerived += 1;
}

/** First bone that can act as a root: no parent, or a conventional root name. */
function pickRootName(names: string[]): string | null {
  const named = names.find((name) => /^(root|origin|all|main|base)$/i.test(name));
  if (named) return named;
  return names[0] ?? null;
}

/**
 * Attach point for a bone whose declared parent does not exist.
 *
 * This used to be decided by substring: `head|ear|eye|…` was tested against the bone name, and
 * "DEF_FOREARM.L" contains "ear", so a forearm was classified as a head part and re-parented to
 * `head` — the reported case where the character's head rotated with its forearm. The decision is
 * now made by the shared anatomical tokenizer, which reads `forearm` as a distal arm joint:
 *
 *   • a deform bone may only attach to a bone of its OWN body region, never to an unrelated limb;
 *   • a held-item / tool socket attaches to the hand of its own side, because that is the joint
 *     whose motion carries the item;
 *   • when the document declares no compatible bone, the body / root is used instead of a limb.
 */
function pickAttachParent(name: string, names: string[]): string | null {
  const candidates = names.filter((candidate) => Boolean(candidate) && candidate !== name);
  if (candidates.length === 0) return null;
  const anatomy = describeBoneAnatomy(name);
  const bodyPool = candidates.filter((candidate) => anatomyFamily(candidate) === 'body');

  if (anatomy.family === 'item') {
    const arms = candidates.filter((candidate) => {
      const arm = describeBoneAnatomy(candidate);
      if (arm.family !== 'arm') return false;
      return anatomy.side === null || arm.side === null || arm.side === anatomy.side;
    });
    const bySegment = (segment: 'tip' | 'distal' | 'whole' | 'proximal') =>
      arms.filter((candidate) => describeBoneAnatomy(candidate).segment === segment);
    const socket =
      bySegment('tip')[0] ?? bySegment('distal')[0] ?? bySegment('whole')[0] ?? bySegment('proximal')[0];
    if (socket) return socket;
    return bodyPool[0] ?? pickRootName(candidates);
  }

  const sameRegion = pickCheapest(
    name,
    candidates.filter((candidate) => anatomyFamily(candidate) === anatomy.family),
  );
  if (sameRegion) return sameRegion;
  // No bone of this body region exists in the document. The body is the only honest anchor: an
  // unrelated limb would apply this bone's motion to the wrong part of the model.
  if (bodyPool.length > 0) return bodyPool[0];
  return pickRootName(candidates);
}

function repairVariant(
  variant: Record<string, unknown>,
  context: RepairContext,
): boolean {
  const description: Record<string, unknown> = variant.description && typeof variant.description === 'object'
    ? (variant.description as Record<string, unknown>)
    : {};
  const textureWidth = Math.max(8, Math.round(finite(description.texture_width) ?? 64));
  const textureHeight = Math.max(8, Math.round(finite(description.texture_height) ?? 64));
  description.texture_width = textureWidth;
  description.texture_height = textureHeight;
  variant.description = description;

  const rawBones = Array.isArray(variant.bones) ? variant.bones : [];
  const bones: Record<string, unknown>[] = [];
  for (const rawBone of rawBones) {
    if (rawBone && typeof rawBone === 'object') bones.push({ ...(rawBone as Record<string, unknown>) });
  }
  if (bones.length === 0) return false;

  // 1. Unique bone names. Two bones with one name make the client drop one of them.
  const rename = new Map<string, string>();
  const used = new Set<string>();
  for (let index = 0; index < bones.length; index += 1) {
    const bone = bones[index];
    const base = typeof bone.name === 'string' && bone.name.trim() ? bone.name.trim() : `bone_${index}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) {
      name = `${base}_${suffix++}`;
      if (name !== base) context.report.duplicateBonesRenamed += 1;
    }
    used.add(name);
    if (!rename.has(base)) rename.set(base, name);
    bone.name = name;
  }
  const names = bones.map((bone) => String(bone.name));

  // 2. Parent references. A parent that is not in this document (or a cycle) removes the
  //    whole chain from the render, which is the reported "legs / head missing" failure.
  const byName = new Map<string, Record<string, unknown>>();
  for (const bone of bones) byName.set(String(bone.name), bone);

  for (const bone of bones) {
    const name = String(bone.name);
    if (typeof bone.parent === 'string' && bone.parent) {
      const mapped = rename.get(bone.parent) ?? bone.parent;
      if (byName.has(mapped) && mapped !== name) {
        bone.parent = mapped;
        continue;
      }
      delete bone.parent;
      const attach = pickAttachParent(name, names);
      if (attach && attach !== name) {
        bone.parent = attach;
        context.report.bonesReparented += 1;
        context.report.log.push(
          `[MESH] ${context.identifier}: bone "${name}" declared parent "${mapped}", which this geometry does not contain — re-parented to "${attach}" so its cubes render instead of being dropped with a missing parent chain.`,
        );
      }
    }
    // 3. Cycle guard: walking up the chain must terminate at a root.
    let cursor: Record<string, unknown> | undefined = bone;
    const seen = new Set<string>([String(bone.name)]);
    let guard = 0;
    while (cursor && typeof cursor.parent === 'string' && guard < 32) {
      const parentName = String(cursor.parent);
      if (seen.has(parentName)) {
        delete cursor.parent;
        const root = pickRootName(names.filter((candidate) => candidate !== name));
        if (root && root !== name) cursor.parent = root;
        context.report.parentCyclesBroken += 1;
        context.report.log.push(
          `[MESH] ${context.identifier}: a parent cycle through bone "${parentName}" was broken — the chain now terminates at "${root ?? 'its root'}", so the limb renders instead of disappearing.`,
        );
        break;
      }
      seen.add(parentName);
      cursor = byName.get(parentName);
      guard += 1;
    }
  }

  // 4. Pivots, cubes and polygon meshes.
  for (const bone of bones) {
    if (!numbers3(bone.pivot)) {
      bone.pivot = [0, 0, 0];
      context.report.pivotsRestored += 1;
    }
    const cubes = Array.isArray(bone.cubes) ? bone.cubes : [];
    for (const rawCube of cubes) {
      if (rawCube && typeof rawCube === 'object') repairCube(rawCube as Record<string, unknown>, context);
    }
    if (bone.poly_mesh && typeof bone.poly_mesh === 'object') {
      repairPolyMesh(bone, textureWidth, textureHeight, context);
    }
  }

  // 5. Bones that carry nothing and parent nothing cannot render; they only add schema
  //    surface. Every bone that owns geometry, a polygon mesh or a child is kept.
  const parented = new Set<string>();
  for (const bone of bones) {
    if (typeof bone.parent === 'string') parented.add(bone.parent);
  }
  const kept = bones.filter((bone) => {
    const name = String(bone.name);
    const cubes = Array.isArray(bone.cubes) ? bone.cubes : [];
    if (cubes.length > 0 || bone.poly_mesh || parented.has(name)) return true;
    context.report.emptyBonesDropped += 1;
    return false;
  });
  if (kept.length === 0) return false;

  variant.bones = kept;
  const renderable = kept.some((bone) => {
    const cubes = Array.isArray(bone.cubes) ? bone.cubes : [];
    return cubes.length > 0 || Boolean(bone.poly_mesh);
  });
  return renderable;
}

/**
 * Repairs every shipped geometry document in place. Idempotent: running it twice changes
 * nothing the second time. Documents it cannot make renderable are reported, never padded
 * with an invented rig.
 */
export function repairGeometryBones(options: {
  resourcePackFiles: PackFiles;
  onLog?: (line: string) => void;
}): MeshRepairReport {
  const report: MeshRepairReport = {
    geometryFiles: 0,
    variants: 0,
    bonesReparented: 0,
    duplicateBonesRenamed: 0,
    parentCyclesBroken: 0,
    pivotsRestored: 0,
    cubeUvsRestored: 0,
    degenerateCubesFixed: 0,
    polyMeshBonesPreserved: 0,
    polyMeshUvsDerived: 0,
    emptyBonesDropped: 0,
    unresolved: [],
    log: [],
  };
  const rp = options.resourcePackFiles;

  for (const path of Object.keys(rp)) {
    if (!/^models\/.+\.json$/i.test(path)) continue;
    const raw = rp[path];
    if (typeof raw !== 'string' || !raw.includes('minecraft:geometry')) continue;
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const variants = doc['minecraft:geometry'];
    if (!Array.isArray(variants)) continue;
    report.geometryFiles += 1;
    let changed = false;

    for (const rawVariant of variants) {
      if (!rawVariant || typeof rawVariant !== 'object') continue;
      const variant = rawVariant as Record<string, unknown>;
      const identifier = String(
        (variant.description as Record<string, unknown> | undefined)?.identifier ?? path,
      );
      const before = JSON.stringify(variant);
      const renderable = repairVariant(variant, { report, identifier });
      if (!renderable) {
        report.unresolved.push(`${identifier}: declares no renderable cubes or polygon mesh`);
      }
      if (JSON.stringify(variant) !== before) changed = true;
      report.variants += 1;
    }

    if (changed) rp[path] = JSON.stringify(doc, null, 2);
  }

  report.log.unshift(
    `[MESH] Geometry integrity: ${report.geometryFiles} model document(s) / ${report.variants} variant(s) audited — ${report.bonesReparented} orphan bone(s) re-parented, ${report.parentCyclesBroken} parent cycle(s) broken, ${report.duplicateBonesRenamed} duplicate bone name(s) renamed, ${report.pivotsRestored} pivot(s) restored, ${report.cubeUvsRestored} cube UV layout(s) re-expanded from the cube's own size, ${report.degenerateCubesFixed} degenerate cube(s) given thickness, ${report.polyMeshBonesPreserved} polygon-mesh bone(s) preserved (${report.polyMeshUvsDerived} with derived UVs), ${report.emptyBonesDropped} empty leaf bone(s) pruned.`,
  );
  if (report.unresolved.length > 0) {
    report.log.push(
      `[MESH:WARN] ${report.unresolved.length} geometry variant(s) still declare nothing renderable and are reported UNRESOLVED: ${report.unresolved.slice(0, 6).join(' | ')}${report.unresolved.length > 6 ? ' …' : ''}`,
    );
  }
  for (const line of report.log) options.onLog?.(line);
  return report;
}