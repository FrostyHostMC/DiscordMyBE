import type { ExtractedZipEntry } from '@/utils/zip';
import { normalizeAssetIdentifier, normalizeAssetPath } from '@/utils/identifierNormalization';
import { scanClassResources, type ScannedClassResources } from '@/utils/mobClassScanner';
import {
  buildTextureDiscoveryIndex,
  pickFittingTexture,
  resolveDeclaredTexture,
  type TextureDiscoveryIndex,
} from '@/utils/textureDiscovery';

/** How a mob's skin was resolved, so a discovered sheet is never reported as declared. */
export type TextureLinkTier = 'class-resource' | 'archive-evidence' | 'recursive-discovery';

/**
 * One entity's declarative bindings: the model, skin and animation documents its own
 * Java renderer / model classes name. `undefined` means the class said nothing — the
 * caller then falls back to archive evidence and reports the gap.
 */
export interface MobResourceLink {
  mobId: string;
  rendererClass?: string;
  modelClass?: string;
  /** Archive path of the recovered geometry document. */
  model?: string;
  /** Archive path of the recovered skin PNG. */
  texture?: string;
  /** Which tier produced `texture`. */
  textureTier?: TextureLinkTier;
  /** Archive paths of the animation documents bound to this mob. */
  animations: string[];
  /** Human-readable provenance for each binding. */
  evidence: string[];
  /** Components no class resource string resolved for this mob. */
  unresolved: string[];
}

export interface MobLinkingSummary {
  mobs: number;
  renderers: number;
  models: number;
  textures: number;
  discoveredTextures: number;
  animations: number;
  unresolved: string[];
}

const MAX_CLASSES = 500;
const textDecoder = new TextDecoder();

/** Same job as the class scanner, for mods that ship Java sources instead of bytecode. */
function scanJavaSource(path: string, data: Uint8Array): ScannedClassResources {
  const refs: string[] = [];
  const pattern = /["']([a-z0-9_./-]*(?:textures|geo|animations)\/[a-z0-9_./-]+)["']/gi;
  for (const match of textDecoder.decode(data).matchAll(pattern)) {
    const ref = match[1];
    if (ref && !refs.includes(ref)) refs.push(ref);
    if (refs.length >= 24) break;
  }
  return { className: (path.split('/').pop() ?? path).replace(/\.java$/, ''), superName: '', refs };
}

function keysOf(value: string): string[] {
  const clean = normalizeAssetPath(value).replace(/\.geo\.json$/i, '').replace(/\.json$/i, '').replace(/\.png$/i, '');
  const keys = new Set<string>();
  const at = clean.lastIndexOf('textures/');
  const rel = at >= 0 ? clean.slice(at) : clean;
  keys.add(normalizeAssetIdentifier(clean));
  keys.add(normalizeAssetIdentifier(rel));
  if (at >= 0) keys.add(normalizeAssetIdentifier(clean.slice(at + 'textures/'.length)));
  keys.add(normalizeAssetIdentifier(rel.split('/').pop() ?? rel));
  return [...keys].filter(Boolean);
}

function buildIndex(paths: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const path of paths) {
    for (const key of keysOf(path)) {
      if (key.length >= 2 && !index.has(key)) index.set(key, path);
    }
  }
  return index;
}

function resolveRef(index: Map<string, string>, ref: string): string | null {
  for (const key of keysOf(ref)) {
    const hit = index.get(key);
    if (hit) return hit;
  }
  return null;
}

/** Scores a mob key against an archive path (\"foo\" -> `assets/mymod/geo/foo.geo.json`). */
function scoreAgainst(path: string, keys: string[], exactOnly = false): number {
  const norm = normalizeAssetIdentifier(path);
  let best = 0;
  for (const key of keys) {
    if (!key) continue;
    if (norm === key) best = Math.max(best, 100);
    // A short or purely numeric key only ever matches exactly.
    else if (key.length < 3 || exactOnly) continue;
    else if (norm.endsWith(key) || norm.startsWith(key)) best = Math.max(best, 80);
    else if (norm.includes(key)) best = Math.max(best, 60);
  }
  return best;
}

function pickClass(
  classes: ScannedClassResources[],
  keys: string[],
  role: 'renderer' | 'model',
): ScannedClassResources | null {
  let best: ScannedClassResources | null = null;
  let bestScore = 0;
  for (const info of classes) {
    const lower = info.className.toLowerCase();
    if (role === 'renderer' ? !lower.includes('renderer') : !lower.includes('model')) continue;
    const base = normalizeAssetIdentifier(
      info.className.replace(/(?:renderer|model|entity|layer|client)+$/gi, '') || info.className,
    );
    if (base.length < 2) continue;
    let score = 0;
    for (const key of keys) {
      if (base === key) score = Math.max(score, 100);
      else if (base.startsWith(key) || key.startsWith(base)) score = Math.max(score, 80);
      else if (base.includes(key) || key.includes(base)) score = Math.max(score, 55);
    }
    if (score > bestScore) {
      bestScore = score;
      best = info;
    }
  }
  return bestScore >= 55 ? best : null;
}

function pickPath(paths: string[], keys: string[], minScore = 80): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const path of paths) {
    const score = scoreAgainst(path, keys);
    if (score > bestScore) {
      bestScore = score;
      best = path;
    }
  }
  return bestScore >= minScore ? best : null;
}

/** Records a sheet as worn, so two creatures never end up inside one skin. */
function claimSkin(
  claimed: Set<string>,
  sheet: { path: string; tail?: string; stem?: string },
): void {
  claimed.add(sheet.path.toLowerCase());
  if (sheet.tail) claimed.add(sheet.tail.toLowerCase());
  if (sheet.stem) claimed.add(sheet.stem.toLowerCase());
}

/**
 * Mob Linking Protocol — resolves every entity's model, skin and animation files from
 * the resource strings its own renderer/model classes declare. Each resolved value is
 * bound by exact file identity; only a component no class names is left for the archive
 * evidence pass, and it is reported instead of being silently guessed.
 *
 * Texture discovery walks every PNG under any `textures/**` folder (entity/, entities/,
 * mob/, models/, numeric names included), so a mob is never reported ABSENT while an
 * unreferenced sheet that fits its rig exists in the archive.
 */
export function buildMobLinks(options: {
  entries: ExtractedZipEntry[];
  mobIds: string[];
  onLog?: (line: string) => void;
}): Map<string, MobResourceLink> {
  const { entries, mobIds } = options;
  const links = new Map<string, MobResourceLink>();
  if (mobIds.length === 0 || entries.length === 0) return links;

  const modelPaths: string[] = [];
  const animationPaths: string[] = [];
  const classes: ScannedClassResources[] = [];
  let scanned = 0;
  for (const entry of entries) {
    const path = normalizeAssetPath(entry.path);
    if (!path) continue;
    if (path.endsWith('.png')) continue;
    if (path.endsWith('.java')) {
      if (scanned++ < MAX_CLASSES) classes.push(scanJavaSource(path, entry.data));
      continue;
    }
    if (path.endsWith('.class')) {
      if (scanned++ < MAX_CLASSES) {
        const info = scanClassResources(entry.data);
        if (info) classes.push(info);
      }
      continue;
    }
    // Polygon-mesh sources (`poly_mesh` JSON and Wavefront `.obj`) are models too, so a
    // renderer class that names one must resolve to it.
    if (path.endsWith('.obj')) {
      modelPaths.push(path);
      continue;
    }
    if (!path.endsWith('.json')) continue;
    if (/(?:^|\/)animations?\//.test(path) || path.includes('.animation.json')) animationPaths.push(path);
    else if (path.endsWith('.geo.json') || /(?:^|\/)(?:geo|models\/entity)\//.test(path)) modelPaths.push(path);
  }

  const discovery: TextureDiscoveryIndex = buildTextureDiscoveryIndex(entries);
  // Entity sheets claim the index keys first: a mod that ships both
  // `textures/entity/foo.png` and `textures/items/foo.png` must link the sheet.
  const texturePaths = [...discovery.sheets]
    .sort((a, b) => Number(b.entityFolder) - Number(a.entityFolder))
    .map((sheet) => sheet.path);
  const modelIndex = buildIndex(modelPaths);
  const animationIndex = buildIndex(animationPaths);

  const mobKeys = new Map<string, string[]>();
  for (const mobId of mobIds) {
    const keys = [mobId, mobId.replace(/_spawn_egg$/, '')]
      .map(normalizeAssetIdentifier)
      .filter((key) => key.length >= 1);
    mobKeys.set(mobId, keys);
    links.set(mobId, { mobId, animations: [], evidence: [], unresolved: [] });
  }
  const claimedSkins = new Set<string>();

  // Phase 1 — the resource strings the entity's own renderer / model class declares.
  // These are the binding authority, so they resolve before any name heuristic.
  for (const mobId of mobIds) {
    const link = links.get(mobId);
    const keys = mobKeys.get(mobId) ?? [];
    const renderer = keys.length > 0 ? pickClass(classes, keys, 'renderer') : null;
    const modelClass = keys.length > 0 ? pickClass(classes, keys, 'model') : null;
    if (!link) continue;
    if (renderer) link.rendererClass = renderer.className;
    if (modelClass) link.modelClass = modelClass.className;
    const refs = [...(renderer?.refs ?? []), ...(modelClass?.refs ?? [])];
    if (refs.length === 0) continue;
    for (const ref of refs) {
      if (!link.model) {
        const model = resolveRef(modelIndex, ref);
        if (model) link.model = model;
      }
      const animation = resolveRef(animationIndex, ref);
      if (animation && !link.animations.includes(animation)) link.animations.push(animation);
    }
    const declaredSkin = resolveDeclaredTexture(discovery, refs);
    if (declaredSkin) {
      link.texture = declaredSkin.path;
      link.textureTier = 'class-resource';
      claimSkin(claimedSkins, declaredSkin);
    }
    if (link.model) link.evidence.push(`model ${link.model} declared by ${modelClass?.className ?? renderer?.className}`);
    if (link.texture) link.evidence.push(`skin ${link.texture} declared by ${renderer?.className ?? modelClass?.className}`);
    if (link.animations.length > 0) {
      link.evidence.push(
        `${link.animations.length} animation document(s) declared by ${modelClass?.className ?? renderer?.className}`,
      );
    }
  }

  // Phase 2 — archive evidence, only for a component no class resolved, and it is named
  // in the report so a link is never presented as class-declared when it is not.
  for (const mobId of mobIds) {
    const link = links.get(mobId);
    const keys = mobKeys.get(mobId) ?? [];
    if (!link || keys.length === 0) continue;
    if (!link.model) {
      const model = pickPath(modelPaths, keys);
      if (model) {
        link.model = model;
        link.evidence.push(`model ${model} resolved from archive evidence (no class resource string)`);
      }
    }
    if (!link.texture) {
      const texture = pickPath(texturePaths, keys);
      if (texture) {
        link.texture = texture;
        link.textureTier = 'archive-evidence';
        claimSkin(claimedSkins, { path: texture });
        link.evidence.push(`skin ${texture} resolved from archive evidence (no class resource string)`);
      }
    }
    if (link.animations.length === 0) {
      const animation = pickPath(animationPaths, keys);
      if (animation) {
        link.animations.push(animation);
        link.evidence.push(`animation ${animation} resolved from archive evidence (no class resource string)`);
      }
    }
  }

  // Phase 3 — recursive texture discovery. A mob whose skin no class names and no name match
  // resolves takes an unreferenced sheet that fits its rig (copied into textures/entity/ by
  // the pack writer) instead of being reported ABSENT.
  for (const mobId of mobIds) {
    const link = links.get(mobId);
    if (!link || link.texture) continue;
    const found = pickFittingTexture(discovery, { mobId, claimed: claimedSkins });
    if (!found) continue;
    link.texture = found.path;
    link.textureTier = 'recursive-discovery';
    claimSkin(claimedSkins, found);
    link.evidence.push(
      `skin ${found.path} discovered by the recursive textures/** scan (unreferenced ${found.width}x${found.height} sheet, no class or name match)`,
    );
  }

  for (const link of links.values()) {
    if (!link.model) link.unresolved.push('model');
    if (!link.texture) link.unresolved.push('texture');
    if (link.animations.length === 0) link.unresolved.push('animations');
    if (!link.rendererClass && !link.modelClass) link.unresolved.push('renderer/model class');
  }

  return links;
}

export function summarizeMobLinks(links: Map<string, MobResourceLink>): MobLinkingSummary {
  let renderers = 0;
  let models = 0;
  let textures = 0;
  let discoveredTextures = 0;
  let animations = 0;
  const unresolved: string[] = [];
  for (const link of links.values()) {
    if (link.rendererClass) renderers++;
    if (link.model) models++;
    if (link.texture) textures++;
    if (link.textureTier === 'recursive-discovery') discoveredTextures++;
    animations += link.animations.length;
    if (link.unresolved.length > 0) unresolved.push(`${link.mobId} (${link.unresolved.join(', ')})`);
  }
  return { mobs: links.size, renderers, models, textures, discoveredTextures, animations, unresolved };
}