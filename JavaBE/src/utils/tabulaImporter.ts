import type { IRCube } from '@/utils/javaModelIR';
import type { SourceBoneGroup } from '@/utils/universalBoneGraph';
import { boxCube, num, vec2, vec3, writeSourceGeometry, type SourceGeometryWrite } from '@/utils/boxGeometryBuilder';

/**
 * Tabula model importer.
 *
 * Tabula is one of the oldest and most widely used Java model editors: its `.tbl` documents
 * (and the `.json` exports mods ship inside their jar) hold a real section hierarchy with real
 * boxes and box UV origins. The previous pipeline classified these files as "recognised but
 * not convertible", so any mod whose creatures were authored in Tabula lost every model — the
 * mobs rendered with a generic rig or not at all.
 *
 * Everything here is read from the document: section names, section pivots, section rotations,
 * the child hierarchy, box sizes and box UV origins. Tabula authors models in a Y-down space,
 * so the Y axis is inverted once for the whole document (reported as ADAPTED, never hidden).
 */

export interface TabulaConversion extends SourceGeometryWrite {
  notes: string[];
  /** True when the document had no section hierarchy and one root bone was used. */
  flat: boolean;
}

interface RawSection {
  name?: unknown;
  id?: unknown;
  identifier?: unknown;
  coordinates?: unknown;
  position?: unknown;
  pos?: unknown;
  translate?: unknown;
  offset?: unknown;
  dimensions?: unknown;
  size?: unknown;
  rotate?: unknown;
  rotation?: unknown;
  boxes?: unknown;
  children?: unknown;
  child?: unknown;
  sections?: unknown;
  textureOffset?: unknown;
  uv?: unknown;
  mirror?: unknown;
}

interface RawBox {
  coordinates?: unknown;
  position?: unknown;
  pos?: unknown;
  offset?: unknown;
  dimensions?: unknown;
  size?: unknown;
  dim?: unknown;
  uv?: unknown;
  textureOffset?: unknown;
  uvOrigin?: unknown;
  texture?: unknown;
  inflate?: unknown;
  expand?: unknown;
  rotate?: unknown;
}

/** True for a document that declares Tabula sections with boxes. */
export function looksLikeTabulaModel(text: string): boolean {
  if (!/"sections"\s*:/.test(text)) return false;
  return /"(boxes|dimensions|coordinates)"\s*:/.test(text);
}

interface CollectedSection {
  name: string;
  parent?: string;
  section: RawSection;
}

const sectionNameOf = (section: RawSection, fallback: string): string => {
  const raw = section.name ?? section.id ?? section.identifier;
  const name = typeof raw === 'string' ? raw.trim() : '';
  return name || fallback;
};

function walkSectionMap(
  map: Record<string, unknown>,
  parent: string | undefined,
  out: CollectedSection[],
  depth: number,
): void {
  if (depth > 12) return;
  for (const [name, raw] of Object.entries(map)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const section = raw as RawSection;
    const partName = sectionNameOf(section, name || `part_${out.length + 1}`);
    out.push({ name: partName, parent, section });
    walkChildren(section.children ?? section.child ?? section.sections, partName, out, depth + 1);
  }
}

function walkChildren(
  children: unknown,
  parent: string,
  out: CollectedSection[],
  depth: number,
): void {
  if (!children || depth > 12) return;
  if (Array.isArray(children)) {
    for (const entry of children) {
      // A bare string is a reference to a sibling section declared in the same map; that
      // relationship is already expressed by the map walk above.
      if (!entry || typeof entry !== 'object') continue;
      const section = entry as RawSection;
      const partName = sectionNameOf(section, `part_${out.length + 1}`);
      out.push({ name: partName, parent, section });
      walkChildren(section.children ?? section.child ?? section.sections, partName, out, depth + 1);
    }
    return;
  }
  if (typeof children === 'object') {
    walkSectionMap(children as Record<string, unknown>, parent, out, depth + 1);
  }
}

function collectSections(root: unknown): CollectedSection[] {
  const out: CollectedSection[] = [];
  if (!root) return out;
  if (Array.isArray(root)) {
    walkChildren(root, '', out, 0);
    return out;
  }
  if (typeof root === 'object') walkSectionMap(root as Record<string, unknown>, undefined, out, 0);
  return out;
}

function buildGroups(sections: CollectedSection[], notes: string[]): {
  groups: SourceBoneGroup[];
  rotations: Record<string, [number, number, number]>;
} {
  const groups: SourceBoneGroup[] = [];
  const rotations: Record<string, [number, number, number]> = {};
  let missingUv = 0;

  for (const { name, parent, section } of sections) {
    const offset = vec3(section.coordinates ?? section.position ?? section.pos ?? section.translate ?? section.offset) ?? [0, 0, 0];
    // Y is inverted so a Tabula document authored top-down renders upright in Bedrock.
    const pivot: [number, number, number] = [offset[0], -offset[1], offset[2]];

    const rotate = vec3(section.rotate ?? section.rotation);
    if (rotate && (rotate[0] !== 0 || rotate[1] !== 0 || rotate[2] !== 0)) {
      rotations[name] = [rotate[0], -rotate[1], rotate[2]];
    }

    const rawBoxes: RawBox[] = Array.isArray(section.boxes)
      ? (section.boxes as RawBox[])
      : [];
    const cubes: IRCube[] = [];
    for (const raw of rawBoxes) {
      if (!raw || typeof raw !== 'object') continue;
      const corner = vec3(raw.coordinates ?? raw.position ?? raw.pos ?? raw.offset);
      const dims = vec3(raw.dimensions ?? raw.size ?? raw.dim);
      if (!corner || !dims) continue;
      const inflate = Math.max(0, num(raw.inflate ?? raw.expand));
      const width = Math.max(0.1, Math.abs(dims[0]));
      const height = Math.max(0.1, Math.abs(dims[1]));
      const depth = Math.max(0.1, Math.abs(dims[2]));
      const uv = vec2(raw.uv ?? raw.textureOffset ?? raw.uvOrigin ?? raw.texture);
      if (!uv) missingUv += 1;
      // Tabula box coordinates are the top corner in a Y-down space: the box extends
      // downwards by its height, which becomes `-y-height .. -y` once Y is flipped.
      cubes.push(
        boxCube({
          from: [corner[0] - inflate, -corner[1] - height - inflate, corner[2] - inflate],
          to: [corner[0] + width + inflate, -corner[1] + inflate, corner[2] + depth + inflate],
          uvOrigin: uv ?? [0, 0],
        }),
      );
    }

    // Older Tabula documents express the section itself as the box.
    if (cubes.length === 0) {
      const dims = vec3(section.dimensions ?? section.size);
      if (dims) {
        const uv = vec2(section.uv ?? section.textureOffset);
        if (!uv) missingUv += 1;
        cubes.push(
          boxCube({
            from: [offset[0], -offset[1] - Math.abs(dims[1]), offset[2]],
            to: [offset[0] + Math.abs(dims[0]), -offset[1], offset[2] + Math.abs(dims[2])],
            uvOrigin: uv ?? [0, 0],
          }),
        );
      }
    }

    groups.push({
      name,
      cubes,
      pivot,
      parentHint: parent || undefined,
    });
  }

  if (missingUv > 0) {
    notes.push(
      `${missingUv} box(es) declare no UV origin; their faces are expanded from the sheet origin so the part still renders (ADAPTED, reported)`,
    );
  }
  return { groups, rotations };
}

/**
 * Converts a Tabula document into Bedrock geometry.
 * Returns null only when the document declares no readable box at all.
 */
export function convertTabulaModel(input: {
  modId: string;
  assetId: string;
  text: string;
  textureWidth?: number;
  textureHeight?: number;
}): TabulaConversion | null {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(input.text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;

  const notes: string[] = [];
  const root = doc.sections ?? doc.parts ?? doc.model ?? doc.root ?? doc.children;
  let sections = collectSections(root);

  if (sections.length === 0) {
    const loose = Array.isArray(doc.boxes) ? (doc.boxes as RawBox[]) : [];
    if (loose.length > 0) {
      sections = [{ name: 'body', section: { boxes: loose } }];
      notes.push('the document declares boxes but no section hierarchy, so every box sits on one "body" bone');
    }
  }
  if (sections.length === 0) return null;

  const { groups, rotations } = buildGroups(sections, notes);
  if (groups.every((group) => group.cubes.length === 0)) return null;

  const declared = vec2(doc.textureSize ?? doc.texture_size);
  const written = writeSourceGeometry({
    modId: input.modId,
    assetId: input.assetId,
    textureWidth: Math.round(declared?.[0] ?? input.textureWidth ?? 64) || 64,
    textureHeight: Math.round(declared?.[1] ?? input.textureHeight ?? 64) || 64,
    groups,
    rotations,
  });
  if (!written) return null;

  notes.push('Tabula authors its models in a Y-down space, so Y was inverted once for the whole document (ADAPTED, reported)');
  return { ...written, notes, flat: sections.length === 1 };
}