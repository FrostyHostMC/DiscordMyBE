export const HUD_POSITIONS = [
  'top_left', 'top_middle', 'top_right',
  'left_middle', 'center', 'right_middle',
  'bottom_left', 'bottom_middle', 'bottom_right',
] as const;

export type HudPosition = typeof HUD_POSITIONS[number];
export type HudPlacementMode = 'auto' | 'preserve' | HudPosition;

type Rect = { left: number; top: number; right: number; bottom: number };
type HudCandidate = {
  instance: Record<string, any>;
  id: string;
  size: [number, number];
  anchorFrom: HudPosition;
  anchorTo: HudPosition;
  offset: [number, number];
  definition: Record<string, any>;
};

const SCREEN = { width: 1920, height: 1080 };
const MARGIN = 14;
const POSITION_OFFSETS: Record<HudPosition, [number, number]> = {
  top_left: [MARGIN, MARGIN],
  top_middle: [0, MARGIN],
  top_right: [-MARGIN, MARGIN],
  left_middle: [MARGIN, 0],
  center: [0, 0],
  right_middle: [-MARGIN, 0],
  bottom_left: [MARGIN, -MARGIN],
  bottom_middle: [0, -MARGIN],
  bottom_right: [-MARGIN, -MARGIN],
};

export interface HudPlacementResult {
  hud: any;
  moved: Array<{ control: string; from: HudPosition; to: HudPosition }>;
  unresolved: string[];
}

function isPosition(value: unknown): value is HudPosition {
  return typeof value === 'string' && (HUD_POSITIONS as readonly string[]).includes(value);
}

function findDefinition(value: any, name: string, seen = new Set<any>()): Record<string, any> | undefined {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  if (!Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === name && child && typeof child === 'object' && !Array.isArray(child)) return child as Record<string, any>;
    }
    for (const child of Object.values(value)) {
      const found = findDefinition(child, name, seen);
      if (found) return found;
    }
  } else {
    for (const child of value) {
      const found = findDefinition(child, name, seen);
      if (found) return found;
    }
  }
  return undefined;
}

function numericPair(value: any): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2 || !value.slice(0, 2).every((part: any) => typeof part === 'number' && Number.isFinite(part))) return undefined;
  return [value[0], value[1]];
}

function anchorPoint(anchor: HudPosition): [number, number] {
  const x = anchor.endsWith('left') ? 0 : anchor.endsWith('right') ? SCREEN.width : SCREEN.width / 2;
  const y = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? SCREEN.height : SCREEN.height / 2;
  return [x, y];
}

function anchorWithinElement(anchor: HudPosition, width: number, height: number): [number, number] {
  const x = anchor.endsWith('left') ? 0 : anchor.endsWith('right') ? width : width / 2;
  const y = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? height : height / 2;
  return [x, y];
}

function rectFor(anchorFrom: HudPosition, anchorTo: HudPosition, offset: [number, number], size: [number, number]): Rect {
  const [px, py] = anchorPoint(anchorFrom);
  const [ax, ay] = anchorWithinElement(anchorTo, size[0], size[1]);
  const left = px + offset[0] - ax;
  const top = py + offset[1] - ay;
  return { left, top, right: left + size[0], bottom: top + size[1] };
}

function intersects(a: Rect, b: Rect): boolean {
  const pad = 8;
  return a.left < b.right - pad && a.right > b.left + pad && a.top < b.bottom - pad && a.bottom > b.top + pad;
}

function inViewport(rect: Rect): boolean {
  return rect.left >= 0 && rect.top >= 0 && rect.right <= SCREEN.width && rect.bottom <= SCREEN.height;
}

function collectCandidates(hud: any, definitions: any[]): HudCandidate[] {
  const result: HudCandidate[] = [];
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (Array.isArray(value.modifications)) {
      for (const patch of value.modifications) {
        if (!patch || patch.array_name !== 'controls' || !Array.isArray(patch.value)) continue;
        for (const controlEntry of patch.value) {
          if (!controlEntry || typeof controlEntry !== 'object' || Array.isArray(controlEntry)) continue;
          for (const [reference, rawInstance] of Object.entries(controlEntry)) {
            if (!reference.includes('@') || !rawInstance || typeof rawInstance !== 'object' || Array.isArray(rawInstance)) continue;
            const instance = rawInstance as Record<string, any>;
            const target = reference.split('@').pop() || reference;
            const controlName = target.split('.').pop() || target;
            const definition = definitions.map(file => findDefinition(file, controlName)).find(Boolean) || {};
            const effective = { ...definition, ...instance };
            const size = numericPair(effective.size);
            if (!size || size[0] <= 0 || size[1] <= 0 || size[0] > SCREEN.width * 0.85 || size[1] > SCREEN.height * 0.85) continue;
            // Animated/dynamic layout values cannot be safely relocated by changing
            // the instance anchor: an animation or expression may overwrite it.
            if (effective.anims || effective.use_anchored_offset || effective.factory || effective.collection_name) continue;
            const anchorFrom = isPosition(effective.anchor_from) ? effective.anchor_from : 'center';
            const anchorTo = isPosition(effective.anchor_to) ? effective.anchor_to : 'center';
            const offset = numericPair(effective.offset) || [0, 0];
            result.push({ instance, id: reference, size, anchorFrom, anchorTo, offset, definition });
          }
        }
      }
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(hud);
  return result;
}

/**
 * Resolve only independently inserted HUD controls whose dimensions and
 * positioning are statically measurable. Unknown/dynamic controls are left
 * byte-for-byte alone; guessing their layout is more dangerous than reporting it.
 */
export function resolveHudPlacements(
  hud: any,
  definitions: any[],
  mode: HudPlacementMode = 'auto'
): HudPlacementResult {
  const output = structuredClone(hud);
  const candidates = collectCandidates(output, definitions);
  const occupied: Rect[] = [];
  const moved: HudPlacementResult['moved'] = [];
  const unresolved: string[] = [];

  for (const candidate of candidates) {
    const current = rectFor(candidate.anchorFrom, candidate.anchorTo, candidate.offset, candidate.size);
    if (!inViewport(current)) {
      unresolved.push(candidate.id + ' (original bounds extend outside the screen)');
      continue;
    }
    if (!occupied.some(rect => intersects(rect, current))) {
      occupied.push(current);
      continue;
    }
    if (mode === 'preserve') {
      occupied.push(current);
      unresolved.push(candidate.id + ' (overlap preserved by user choice)');
      continue;
    }

    const preferred = mode !== 'auto' ? [mode] : [];
    const choices = [...preferred, ...HUD_POSITIONS.filter(position => position !== candidate.anchorFrom && !preferred.includes(position))];
    let placed: { position: HudPosition; rect: Rect } | undefined;
    for (const position of choices) {
      const offset = POSITION_OFFSETS[position];
      const rect = rectFor(position, position, offset, candidate.size);
      if (!inViewport(rect) || occupied.some(existing => intersects(existing, rect))) continue;
      placed = { position, rect };
      break;
    }
    if (!placed) {
      occupied.push(current);
      unresolved.push(candidate.id + ' (no safe free position; original layout retained)');
      continue;
    }
    candidate.instance.anchor_from = placed.position;
    candidate.instance.anchor_to = placed.position;
    candidate.instance.offset = POSITION_OFFSETS[placed.position];
    occupied.push(placed.rect);
    moved.push({ control: candidate.id, from: candidate.anchorFrom, to: placed.position });
  }
  return { hud: output, moved, unresolved };
}
