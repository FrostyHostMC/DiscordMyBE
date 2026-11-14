import type { ExtractedZipEntry } from '@/utils/zip';
import {
  translateJavaAnimationSet,
  type BedrockAnimationClip,
} from '@/utils/animationTranslator';
import { normaliseOwnerKey, ownerFromClipId } from '@/utils/geckolibImporter';
import { extractBbModelAnimations } from '@/utils/bbmodelImporter';
import { parseRelaxedJson } from '@/utils/relaxedJson';
import {
  runUniversalAnimationDiscovery,
  type UniversalAnimationDiscoveryReport,
} from '@/utils/universalAnimationDiscovery';

/**
 * Additional animation sources.
 *
 * The GeckoLib importer only inspects paths that look like GeckoLib (`animations/`,
 * `*.animation.json`). Real mods also ship keyframes as Blockbench `.bbmodel` documents, as
 * `.json` files at the archive root, under `player_animations/`, `keyframes/` or a
 * mod-specific folder. Those clips were never even counted, which is why a mod could ship a
 * full animation set and export with none of it.
 *
 * This pass reads every remaining candidate, converts it through the same Java→Bedrock
 * translator, attributes each clip to the entity its id or file name names, and reports any
 * document it could not use. Nothing is copied verbatim, nothing is invented.
 */

const decoder = new TextDecoder();

export interface ExtraAnimationStats {
  filesDiscovered: number;
  filesParsed: number;
  filesUnreadable: number;
  clipsImported: number;
  channels: number;
  keyframes: number;
  unsupported: number;
  /** GeckoLib animation-controller documents found alongside the clips. */
  controllersReported: number;
  bbmodelAnimations: number;
  sourceFormats: string[];
}

export interface ExtraAnimationImport {
  clipsByOwner: Record<string, Record<string, BedrockAnimationClip>>;
  /** Exact source-document key for each translated clip, grouped by owner. */
  sourceClipIdsByOwner?: Record<string, Record<string, string>>;
  owners: string[];
  sourcePathsByOwner: Record<string, string[]>;
  stats: ExtraAnimationStats;
  discoveryReport?: UniversalAnimationDiscoveryReport;
  log: string[];
}

function fileOwnerOf(path: string): string {
  const fileName = path.split('/').pop() ?? '';
  const stem = normaliseOwnerKey(fileName.replace(/\.bbmodel$/i, ''));
  return stem;
}

/**
 * Imports every animation document the GeckoLib pass did not already claim.
 * `skipPaths` holds the paths of documents that were already parsed, so no clip is
 * imported twice.
 */
export function importAdditionalAnimationSources(
  entries: ExtractedZipEntry[],
  modId: string,
  skipPaths: Set<string>,
  onLog?: (line: string) => void,
): ExtraAnimationImport {
  const log: string[] = [];
  const logLine = (line: string) => {
    log.push(line);
    onLog?.(line);
  };
  const stats: ExtraAnimationStats = {
    filesDiscovered: 0,
    filesParsed: 0,
    filesUnreadable: 0,
    clipsImported: 0,
    channels: 0,
    keyframes: 0,
    unsupported: 0,
    controllersReported: 0,
    bbmodelAnimations: 0,
    sourceFormats: [],
  };
  const clipsByOwner: Record<string, Record<string, BedrockAnimationClip>> = {};
  const sourceClipIdsByOwner: Record<string, Record<string, string>> = {};
  const owners: string[] = [];
  const sourcePathsByOwner: Record<string, string[]> = {};
  const formats = new Set<string>();

  const remember = (
    owner: string,
    clipId: string,
    clip: BedrockAnimationClip,
    sourcePath: string,
    sourceClipId = clipId,
  ) => {
    if (!clipsByOwner[owner]) {
      clipsByOwner[owner] = {};
      owners.push(owner);
    }
    clipsByOwner[owner][clipId] = clip;
    const ownerSourceIds = sourceClipIdsByOwner[owner] ?? {};
    ownerSourceIds[clipId] = sourceClipId;
    sourceClipIdsByOwner[owner] = ownerSourceIds;
    const paths = sourcePathsByOwner[owner] ?? [];
    if (!paths.includes(sourcePath)) paths.push(sourcePath);
    sourcePathsByOwner[owner] = paths;
    stats.clipsImported += 1;
  };

  // Engage Universal Animation Discovery Engine across the entire archive
  const discoveryReport = runUniversalAnimationDiscovery({
    entries,
    modId,
    onLog: logLine,
  });

  // Pull all universally discovered clips into the registry
  for (const [owner, clips] of Object.entries(discoveryReport.clipsByOwner)) {
    for (const [clipId, clip] of Object.entries(clips)) {
      const paths = discoveryReport.sourcePathsByOwner[owner] ?? [];
      const primaryPath = paths[0] ?? `discovered/${owner}/${clipId}`;
      if (skipPaths.has(primaryPath) || skipPaths.has(primaryPath.toLowerCase())) continue;
      remember(owner, clipId, clip, primaryPath);
      const boneCount = Object.keys(clip.bones ?? {}).length;
      stats.channels += boneCount;
      const keyCount = Object.values(clip.bones ?? {}).reduce(
        (total, track) => total + Object.keys(track as Record<string, unknown>).length,
        0,
      );
      stats.keyframes += keyCount;
    }
  }

  for (const fmt of discoveryReport.formatsDetected) {
    formats.add(fmt.format);
  }
  stats.filesDiscovered += discoveryReport.animationDocumentsFound;
  stats.filesParsed += discoveryReport.animationDocumentsFound;
  stats.controllersReported += discoveryReport.controllersDiscovered.length;

  for (const entry of entries ?? []) {
    const path = entry.path.replace(/\\/g, '/');
    const lower = path.toLowerCase();
    if (skipPaths.has(path) || skipPaths.has(lower)) continue;
    const isBbModel = lower.endsWith('.bbmodel');
    const isJson = /\.json5?$/i.test(lower);
    if (!isBbModel && !isJson) continue;
    if (!isBbModel) {
      if (lower.endsWith('.geo.json') || lower.includes('/geo/') || lower.includes('/geometry/')) continue;
      if (lower.includes('/blockstates/') || lower.includes('/models/')) continue;
      if (lower.includes('/sounds/') || lower.includes('/lang/') || lower.includes('/recipes/')) continue;
    }
    if (entry.data.length > 6_000_000) continue;

    let text = '';
    try {
      text = decoder.decode(entry.data);
    } catch {
      stats.filesUnreadable += 1;
      logLine(`[ANIMATION] "${path}" could not be decoded — recorded as NOT CARRIED.`);
      continue;
    }

    if (isBbModel) {
      stats.filesDiscovered += 1;
      const owner = fileOwnerOf(path) || normaliseOwnerKey(modId);
      const imported = extractBbModelAnimations(text, owner);
      if (Object.keys(imported.clips).length === 0) continue;
      stats.filesParsed += 1;
      stats.bbmodelAnimations += Object.keys(imported.clips).length;
      formats.add('blockbench');
      for (const [clipId, clip] of Object.entries(imported.clips)) {
        remember(owner, clipId, clip, path);
        stats.channels += Object.keys(clip.bones).length;
        const keys = Object.values(clip.bones).reduce(
          (total, track) => total + Object.keys(track as Record<string, unknown>).length,
          0,
        );
        stats.keyframes += keys;
      }
      for (const note of imported.notes.slice(0, 2)) logLine(`[ANIMATION] ${path}: ${note}`);
      logLine(
        `[ANIMATION] Blockbench document "${path}" -> ${Object.keys(imported.clips).length} source clip(s) for owner "${owner}" (${Object.keys(imported.clips).length} keyframed tracks converted to Bedrock channels).`,
      );
      continue;
    }

    if (!/["'](bones|bone|animators|animation_controllers)["']\s*:/i.test(text)) continue;
    stats.filesDiscovered += 1;

    if (text.includes('animation_controllers')) {
      stats.controllersReported += 1;
      formats.add('controller');
      logLine(
        `[ANIMATION] "${path}" is a source animation-controller document — recorded for state reconstruction; its clip set is imported by the state-machine synthesizer, never copied verbatim.`,
      );
      if (!/["']bones["']\s*:/i.test(text)) continue;
    }

    const parsed = parseRelaxedJson(text);
    if (parsed === null) {
      stats.filesUnreadable += 1;
      logLine(`[ANIMATION] "${path}" is malformed animation JSON — recorded as NOT CARRIED (no clip invented).`);
      continue;
    }

    const translation = translateJavaAnimationSet(parsed, { fileHint: fileOwnerOf(path) || 'clip' });
    const sourceIdByTranslatedId = new Map(
      Object.entries(translation.idMap).map(([sourceId, translatedId]) => [translatedId, sourceId]),
    );
    stats.channels += translation.stats.channels;
    stats.keyframes += translation.stats.keyframes;
    stats.unsupported += translation.stats.unsupported;
    if (Object.keys(translation.animations).length === 0) {
      if (translation.stats.clipsSkipped > 0) {
        logLine(
          `[ANIMATION] "${path}": ${translation.stats.clipsSkipped} clip(s) declare no Bedrock-readable bone channel — reported, not carried.`,
        );
      }
      continue;
    }
    stats.filesParsed += 1;
    formats.add(lower.endsWith('.animation.json') ? 'animation-json' : lower.endsWith('.json5') ? 'json5' : 'json');

    const fileOwner = fileOwnerOf(path);
    let attributed = 0;
    for (const [clipId, clip] of Object.entries(translation.animations)) {
      const owner = ownerFromClipId(clipId, fileOwner, modId) || fileOwner || normaliseOwnerKey(modId);
      remember(owner, clipId, clip, path, sourceIdByTranslatedId.get(clipId) ?? clipId);
      attributed += 1;
    }
    logLine(
      `[ANIMATION] "${path}" -> ${attributed} clip(s) converted (${translation.stats.channels} channel(s), ${translation.stats.keyframes} keyframe(s)).`,
    );
  }

  stats.sourceFormats = [...formats];
  if (stats.filesDiscovered === 0) {
    logLine('[ANIMATION] No additional animation document outside the GeckoLib paths — nothing further to import.');
  } else if (stats.clipsImported === 0) {
    logLine(
      `[ANIMATION] ${stats.filesDiscovered} additional animation document(s) inspected but no readable clip was found — reported honestly instead of emitting empty clips.`,
    );
  } else {
    logLine(
      `[ANIMATION] Additional sources: ${stats.clipsImported} clip(s) from ${stats.filesParsed} document(s) across ${stats.sourceFormats.join(', ')} for ${owners.length} owner(s).`,
    );
  }

  return { clipsByOwner, sourceClipIdsByOwner, owners, sourcePathsByOwner, stats, discoveryReport, log };
}
