import type { IRCube } from '@/utils/javaModelIR';
import type { SourceBoneGroup } from '@/utils/universalBoneGraph';
import { boxCube, num, vec2, vec3, writeSourceGeometry, type SourceGeometryWrite } from '@/utils/boxGeometryBuilder';

/**
 * OptiFine CEM (Custom Entity Model) importer.
 *
 * `.jem` (entity) and `.jpm` (player) documents are how a very large share of Java resource
 * packs and many mods ship custom creature shapes. The engine never opened them: every such
 * mob exported with a generic rig, an invisible body or a frozen T-pose. CEM declares a real
 * part tree with `part` roles, per-part translation/rotation and boxes with their own UV
 * origin, which is everything Bedrock geometry needs.
 *
 * `invertAxis` (default `xy`) is honoured per part, so a document authored against vanilla's
 * top-down model space lands upright instead of mirrored. Part roles are carried into the bone
 * names (`left_leg`, `head`, …), so a wrapped CEM animation still finds its bones.
 */

export interface CemConversion extends SourceGeometryWrite {
  notes: string[];
  /** Texture path the document declares, when it names one. */
  texture: string | null;
  /** True for `.jpm` player models. */
  player: boolean;
}

interface RawCemBox {
  coordinates?: unknown;
  origin?: unknown;
  pos?: unknown;
  size?: unknown;
  dimensions?: unknown;
  dim?: unknown;
  uvOrigin?: unknown;
  uv?: unknown;
  inflate?: unknown;
  mirror?: unknown;
}

interface RawCemPart {
  id?: unknown;
  part?: unknown;
  name?: unknown;
  invertAxis?: unknown;
  translate?: unknown;
  position?: unknown;
  offset?: unknown;
  rotate?: unknown;
  rotation?: unknown;
  boxes?: unknown;
  submodels?: unknown;
  children?: unknown;
}

const PART_NAMES =
  /^(head|body|torso|left_arm|right_arm|left_leg|right_leg|left_wing|right_wing|left_foot|right_foot|tail|beak|nose|ear|ears|horn|horns|mane|snout|jaw|cloak|cape|hat|halo|left_foreleg|right_foreleg|left_hindleg|right_hindleg|left_forearm|right_forearm|left_shin|right_shin)$/i;

/** True for an OptiFine CEM document (entity or player model). */
export function looksLikeCemModel(text: string): boolean {
  if (!/"models"\s*:/.test(text)) return false;
  return /"(submodels|invertAxis|textureSize|texture)"\s*:/.test(text);
}

interface CollectedPart {
  name: string;
  parent?: string;
  part: RawCemPart;
}

function partNameOf(part: RawCemPart, fallback: string): string {
  const raw = part.part ?? part.id ?? part.name;
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return fallback;
  // A CEM `part` is a role (`left_leg`), which is exactly the bone name an animation needs.
  return PART_NAMES.test(name) ? name.toLowerCase() : name;
}

function collectParts(parts: unknown, parent: string | undefined, out: CollectedPart[], depth: number): void {
  if (!parts || depth > 12) return;
  if (!Array.isArray(parts)) return;
  for (const entry of parts) {
    if (!entry || typeof entry !== 'object') continue;
    const part = entry as RawCemPart;
    const name = partNameOf(part, `part_${out.length + 1}`);
    out.push({ name, parent, part });
    collectParts(part.submodels ?? part.children, name, out, depth + 1);
  }
}

function axisMask(value: unknown): [number, number, number] {
  const flags = String(value ?? 'xy').toLowerCase();
  return [flags.includes('x') ? -1 : 1, flags.includes('y') ? -1 : 1, flags.includes('z') ? -1 : 1];
}

function buildGroups(parts: CollectedPart[], notes: string[]): {
  groups: SourceBoneGroup[];
  rotations: Record<string, [number, number, number]>;
} {
  const groups: SourceBoneGroup[] = [];
  const rotations: Record<string, [number, number, number]> = {};
  let inverted = 0;
  let missingUv = 0;
  let mirrored = 0;

  for (const { name, parent, part } of parts) {
    const [sx, sy, sz] = axisMask(part.invertAxis);
    if (sx < 0 || sy < 0) inverted += 1;
    const translate = vec3(part.translate ?? part.position ?? part.offset) ?? [0, 0, 0];
    const pivot: [number, number, number] = [translate[0] * sx, translate[1] * sy, translate[2] * sz];

    const rotate = vec3(part.rotate ?? part.rotation);
    if (rotate && (rotate[0] !== 0 || rotate[1] !== 0 || rotate[2] !== 0)) {
      rotations[name] = [rotate[0] * sx, rotate[1] * sy, rotate[2] * sz];
    }

    const cubes: IRCube[] = [];
    const rawBoxes = Array.isArray(part.boxes) ? (part.boxes as RawCemBox[]) : [];
    for (const raw of rawBoxes) {
      if (!raw || typeof raw !== 'object') continue;
      const corner = vec3(raw.coordinates ?? raw.origin ?? raw.pos);
      const size = vec3(raw.size ?? raw.dimensions ?? raw.dim);
      if (!corner || !size) continue;
      const inflate = Math.max(0, num(raw.inflate));
      const width = Math.max(0.1, Math.abs(size[0]));
      const height = Math.max(0.1, Math.abs(size[1]));
      const depth = Math.max(0.1, Math.abs(size[2]));
      const uv = vec2(raw.uvOrigin ?? raw.uv);
      if (!uv) missingUv += 1;
      // An inverted axis means the coordinate names the far corner, so the box grows back
      // toward the origin instead of away from it.
      const x0 = corner[0] * sx;
      const y0 = corner[1] * sy;
      const z0 = corner[2] * sz;
      cubes.push(
        boxCube({
          from: [sx < 0 ? x0 - width - inflate : x0 - inflate, sy < 0 ? y0 - height - inflate : y0 - inflate, sz < 0 ? z0 - depth - inflate : z0 - inflate],
          to: [sx < 0 ? x0 + inflate : x0 + width + inflate, sy < 0 ? y0 + inflate : y0 + height + inflate, sz < 0 ? z0 + inflate : z0 + depth + inflate],
          uvOrigin: uv ?? [0, 0],
        }),
      );
      if (raw.mirror === true) mirrored += 1;
    }

    groups.push({ name, cubes, pivot, parentHint: parent || undefined });
  }

  if (inverted > 0) {
    notes.push(
      `${inverted} part(s) declare an inverted axis mask, which was applied to their boxes, pivots and rotations so the model lands upright (ADAPTED, reported)`,
    );
  }
  if (missingUv > 0) {
    notes.push(
      `${missingUv} box(es) declare no UV origin; faces are expanded from the sheet origin so the part still renders (ADAPTED, reported)`,
    );
  }
  if (mirrored > 0) {
    notes.push(
      `${mirrored} box(es) request a mirrored UV unwrap, which Bedrock geometry has no flag for — the box renders with its authored UV origin`,
    );
  }
  return { groups, rotations };
}

/**
 * Converts an OptiFine CEM document into Bedrock geometry.
 * Returns null only when the document declares no readable box at all.
 */
export function convertCemModel(input: {
  modId: string;
  assetId: string;
  text: string;
  textureWidth?: number;
  textureHeight?: number;
  player?: boolean;
}): CemConversion | null {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(input.text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;

  const parts: CollectedPart[] = [];
  collectParts(doc.models, undefined, parts, 0);
  if (parts.length === 0) return null;
  if (parts.every((entry) => !Array.isArray(entry.part.boxes) || entry.part.boxes.length === 0)) return null;

  const notes: string[] = [];
  const { groups, rotations } = buildGroups(parts, notes);
  const declared = vec2(doc.textureSize ?? doc.texture_size);
  const texture = typeof doc.texture === 'string' ? doc.texture : null;
  if (typeof doc.texture === 'string' && !/\.(png|jpe?g)$/i.test(doc.texture)) {
    notes.push(`document declares texture "${doc.texture}" without an image extension`);
  }

  const written = writeSourceGeometry({
    modId: input.modId,
    assetId: input.assetId,
    textureWidth: Math.round(declared?.[0] ?? input.textureWidth ?? 64) || 64,
    textureHeight: Math.round(declared?.[1] ?? input.textureHeight ?? 64) || 64,
    groups,
    rotations,
  });
  if (!written) return null;

  notes.push('CEM part roles were carried into the bone names, so a wrapped CEM animation still finds its bones');
  return { ...written, notes, texture, player: input.player === true };
}