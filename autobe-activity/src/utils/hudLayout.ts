import JSZip from 'jszip';
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

const SCREEN_PROFILES = [
  { width: 1024, height: 768 },   // compact 4:3
  { width: 1280, height: 720 },   // compact 16:9
  { width: 1600, height: 900 },   // standard 16:9
  { width: 1920, height: 1200 },  // 16:10
  { width: 2560, height: 1080 },  // ultrawide 21:9
];
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

function buildDefinitionIndex(definitions: any[]): Map<string, Record<string, any>> {
  const index = new Map<string, Record<string, any>>();
  for (const file of definitions) {
    const namespace = typeof file?.namespace === 'string' ? file.namespace : '';
    const visit = (value: any): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          if (namespace && !index.has(namespace + '.' + key)) index.set(namespace + '.' + key, child as Record<string, any>);
          if (!index.has(key)) index.set(key, child as Record<string, any>);
          visit(child);
        }
      }
    };
    visit(file);
  }
  return index;
}
function numericPair(value: any): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2 || !value.slice(0, 2).every((part: any) => typeof part === 'number' && Number.isFinite(part))) return undefined;
  return [value[0], value[1]];
}

function anchorPoint(anchor: HudPosition, screen: { width: number; height: number }): [number, number] {
  const x = anchor.includes('left') ? 0 : anchor.includes('right') ? screen.width : screen.width / 2;
  const y = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? screen.height : screen.height / 2;
  return [x, y];
}

function anchorWithinElement(anchor: HudPosition, width: number, height: number): [number, number] {
  const x = anchor.includes('left') ? 0 : anchor.includes('right') ? width : width / 2;
  const y = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? height : height / 2;
  return [x, y];
}

function rectFor(anchorFrom: HudPosition, anchorTo: HudPosition, offset: [number, number], size: [number, number], screen: { width: number; height: number }): Rect {
  const [px, py] = anchorPoint(anchorFrom, screen);
  const [ax, ay] = anchorWithinElement(anchorTo, size[0], size[1]);
  const left = px + offset[0] - ax;
  const top = py + offset[1] - ay;
  return { left, top, right: left + size[0], bottom: top + size[1] };
}

function intersects(a: Rect, b: Rect): boolean {
  const pad = 8;
  return a.left < b.right - pad && a.right > b.left + pad && a.top < b.bottom - pad && a.bottom > b.top + pad;
}

function inViewport(rect: Rect, screen: { width: number; height: number }): boolean {
  return rect.left >= 0 && rect.top >= 0 && rect.right <= screen.width && rect.bottom <= screen.height;
}

function isFullScreenParent(value: any): boolean {
  const size = value?.size;
  if (!Array.isArray(size) || size.length < 2) return false;
  const full = (part: any) => typeof part === 'string' && /^(?:100%|100%sm)$/i.test(part.trim());
  return full(size[0]) && full(size[1]);
}

function collectCandidates(hud: any, definitions: any[]): HudCandidate[] {
  const result: HudCandidate[] = [];
  const definitionIndex = buildDefinitionIndex(definitions);
  const visit = (value: any, key = ''): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(item => visit(item));
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
            // Child offsets are relative to their parent. Only move controls
            // inserted into a statically full-screen parent; nested panels need
            // their own coordinate system and must not be guessed.
            // The canonical hud_screen.json root_panel inherits the screen-sized
            // hud_content parent in Mojang's UI tree even when it omits size.
            // Other parents must explicitly prove their full-screen dimensions.
            if (key !== 'root_panel' && !isFullScreenParent(value)) continue;
            const target = reference.split('@').pop() || reference;
            const controlName = target.split('.').pop() || target;
            const definition = definitionIndex.get(target) || definitionIndex.get(controlName) || {};
            const effective = { ...definition, ...instance };
            const size = numericPair(effective.size);
            if (!size || size[0] <= 0 || size[1] <= 0 || size[0] > Math.min(...SCREEN_PROFILES.map(screen => screen.width)) * 0.85 || size[1] > Math.min(...SCREEN_PROFILES.map(screen => screen.height)) * 0.85) continue;
            // Animated/dynamic layout values cannot be safely relocated by changing
            // the instance anchor: an animation or expression may overwrite it.
            if (effective.anims || effective.use_anchored_offset || effective.factory || effective.collection_name) continue;
            const anchorFrom = isPosition(effective.anchor_from) ? effective.anchor_from : undefined;
            const anchorTo = isPosition(effective.anchor_to) ? effective.anchor_to : undefined;
            const offset = numericPair(effective.offset);
            // Missing anchors/offsets rely on engine defaults; never guess their
            // coordinate origin because a wrong assumption can move a valid HUD
            // element off-screen or into another add-on's controls.
            if (!anchorFrom || !anchorTo || !offset) continue;
            result.push({ instance, id: reference, size, anchorFrom, anchorTo, offset, definition });
          }
        }
      }
    }
    for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
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
  const occupied: Rect[][] = [];
  const moved: HudPlacementResult['moved'] = [];
  const unresolved: string[] = [];
  if (candidates.length === 0) {
    const hasPatches = (value: any): boolean => {
      if (!value || typeof value !== 'object') return false;
      if (Array.isArray(value)) return value.some(hasPatches);
      if (Array.isArray(value.modifications) && value.modifications.some((patch: any) => patch?.array_name === 'controls')) return true;
      return Object.values(value).some(hasPatches);
    };
    if (hasPatches(output)) unresolved.push('HUD controls were not auto-moved because their parent coordinate space or dimensions could not be proven safe');
  }

  for (const candidate of candidates) {
    const currentRects = SCREEN_PROFILES.map(screen => rectFor(candidate.anchorFrom, candidate.anchorTo, candidate.offset, candidate.size, screen));
    if (currentRects.some((rect, index) => !inViewport(rect, SCREEN_PROFILES[index]))) {
      unresolved.push(candidate.id + ' (original bounds extend outside at least one supported screen profile)');
      continue;
    }
    if (!occupied.some(existing => existing.some((rect, index) => intersects(rect, currentRects[index])))) {
      occupied.push(currentRects);
      continue;
    }
    if (mode === 'preserve') {
      occupied.push(currentRects);
      unresolved.push(candidate.id + ' (overlap preserved by user choice)');
      continue;
    }

    const preferred = mode !== 'auto' ? [mode] : [];
    const choices = [...preferred, ...HUD_POSITIONS.filter(position => position !== candidate.anchorFrom && !preferred.includes(position))];
    let placed: { position: HudPosition; rects: Rect[] } | undefined;
    for (const position of choices) {
      const offset = POSITION_OFFSETS[position];
      const rects = SCREEN_PROFILES.map(screen => rectFor(position, position, offset, candidate.size, screen));
      if (rects.some((rect, index) => !inViewport(rect, SCREEN_PROFILES[index])) ||
          occupied.some(existing => existing.some((rect, index) => intersects(rect, rects[index])))) continue;
      placed = { position, rects };
      break;
    }
    if (!placed) {
      occupied.push(currentRects);
      unresolved.push(candidate.id + ' (no safe free position across supported screen profiles; original layout retained)');
      continue;
    }
    candidate.instance.anchor_from = placed.position;
    candidate.instance.anchor_to = placed.position;
    candidate.instance.offset = POSITION_OFFSETS[placed.position];
    occupied.push(placed.rects);
    moved.push({ control: candidate.id, from: candidate.anchorFrom, to: placed.position });
  }
  return { hud: output, moved, unresolved };
}

/** Apply the resolver to the final merged resource-pack archive. */
export async function resolveHudLayoutInZip(
  zip: JSZip,
  mode: HudPlacementMode,
  diagnostics: string[]
): Promise<void> {
  const hudFile = zip.file('ui/hud_screen.json');
  if (!hudFile) return;
  try {
    const hud = JSON.parse(await hudFile.async('text'));
    const definitions: any[] = [];
    const files = Object.entries(zip.files as Record<string, { dir: boolean; async: (type: 'text') => Promise<string> }>).filter(([path, file]) =>
      !file.dir && /(?:^|\/)ui\/.+\.json$/i.test(path.replace(/\\/g, '/')) && path.toLowerCase() !== 'ui/hud_screen.json'
    );
    for (const [, file] of files) {
      try { definitions.push(JSON.parse(await file.async('text'))); } catch { /* archive validator reports malformed UI JSON */ }
    }
    const result = resolveHudPlacements(hud, definitions, mode);
    if (result.moved.length) {
      zip.file('ui/hud_screen.json', JSON.stringify(result.hud, null, 2));
      diagnostics.push(`INFO HUD_AUTO_PLACEMENT [ui/hud_screen.json]: Relocated ${result.moved.length} overlapping HUD control(s): ${result.moved.map(item => `${item.control} ${item.from} → ${item.to}`).join('; ')}.`);
    }
    if (result.unresolved.length) {
      diagnostics.push(`WARNING HUD_PLACEMENT_REVIEW [ui/hud_screen.json]: AutoBE left ${result.unresolved.length} control(s) unchanged because their layout could not be moved safely: ${result.unresolved.slice(0, 12).join('; ')}.`);
    }
  } catch (error) {
    diagnostics.push(`WARNING HUD_LAYOUT_SCAN_FAILED [ui/hud_screen.json]: Could not analyze HUD layout; original merged HUD was retained (${error instanceof Error ? error.message : String(error)}).`);
  }
}
