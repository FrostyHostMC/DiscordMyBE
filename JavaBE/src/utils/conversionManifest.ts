import assetsData from "@/config/assets";
import type { AssetValidationReport, ConversionManifestCounts, ConversionManifestReport, GeneratedFileOrigin, GeneratedFileRecord, HardcodingAuditReport, SourceAssetDisposition, SourceAssetKind, SourceFileRecord } from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';
import type { Pack } from '@/utils/validationRules';

/**
 * Phase 10 — Conversion documentation.
 *
 * Every source file that was consumed is documented with the generated files it produced,
 * and every generated file is documented with the source files it is traceable to. The link
 * is only ever claimed from path evidence in the archive and the shipped pack: a source that
 * produced nothing is reported as NOT CARRIED instead of being quietly omitted, and a
 * generated file with no traceable source says so.
 */

export interface ConversionManifestInput {
  modId: string;
  playableMode: boolean;
  entries: ExtractedZipEntry[];
  resourcePackFiles: Pack;
  behaviorPackFiles: Pack;
  validation?: AssetValidationReport;
  hardcodingAudit?: HardcodingAuditReport;
  onLog?: (line: string) => void;
}
const MAX_DOCUMENTED_SOURCES = 800;
const MAX_DOCUMENTED_OUTPUTS = 600;
export const SOURCE_KIND_LABELS: Record<SourceAssetKind, string> = {
  texture: 'Texture',
  'animated-texture': 'Animated texture metadata',
  model: 'Java model',
  blockstate: 'Blockstate',
  animation: 'Animation',
  'animation-controller': 'Animation controller',
  recipe: 'Recipe',
  'loot-table': 'Loot table',
  'trade-table': 'Trade table',
  sound: 'Sound',
  lang: 'Language file',
  'java-source': 'Java source',
  bytecode: 'Java bytecode',
  metadata: 'Pack metadata',
  other: 'Other'
};
function byteLength(data: string | Uint8Array | undefined): number {
  if (data == null) return 0;
  if (typeof data === 'string') return new TextEncoder().encode(data).length;
  return data.length;
}
function normalise(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function decodeText(data: string | Uint8Array): string {
  return typeof data === 'string' ? data : new TextDecoder().decode(data);
}

/** Clip ids declared by one animation document (Bedrock, GeckoLib and Blockbench shapes). */
function clipIdsInDocument(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const root = parsed as Record<string, unknown>;
  for (const key of ['animations', 'minecraft:animations', 'clips']) {
    const container = root[key];
    if (container && typeof container === 'object' && !Array.isArray(container)) {
      return Object.keys(container as Record<string, unknown>);
    }
  }
  return [];
}

/** Recognises the asset kind from the archive's own folder layout, never from a name guess. */
export function classifySourcePath(path: string): SourceAssetKind {
  const lower = normalise(path);
  if (lower.endsWith('.png.mcmeta')) return 'animated-texture';
  if (lower.endsWith('.png')) return 'texture';
  if (lower.endsWith('.class')) return 'bytecode';
  if (lower.endsWith('.java') || lower.endsWith('.kt')) return 'java-source';
  if (/\.(ogg|wav|mp3)$/.test(lower)) return 'sound';
  if (lower.includes('/blockstates/')) return 'blockstate';
  if (lower.endsWith('.animation.json')) return 'animation';
  if (lower.endsWith('.geo.json') || lower.includes('/geo/')) return 'model';
  if (lower.includes('/animation_controllers/')) return 'animation-controller';
  if (lower.includes('/animations/')) return 'animation';
  if (lower.includes('/models/')) return 'model';
  if (lower.includes('/recipes/')) return 'recipe';
  if (lower.includes('/loot_tables/') || lower.includes('/loot_table/')) return 'loot-table';
  if (lower.includes('/trades/') || lower.includes('/trade_table')) return 'trade-table';
  if (lower.includes('/lang/')) return 'lang';
  if (/\.(json|mcmeta|toml|properties|cfg)$/.test(lower)) return 'metadata';
  return 'other';
}
function stemOf(path: string): string {
  const base = normalise(path).split('/').pop() ?? path;
  return base.replace(/\.(png\.mcmeta|geo\.json|animation\.json|json|png|java|class|ogg|wav|mp3|lang|toml)$/i, '');
}
function afterSegment(path: string, segment: string): string | null {
  const lower = normalise(path);
  const marker = `/${segment}/`;
  const index = lower.indexOf(marker);
  if (index < 0) return null;
  return lower.slice(index + marker.length);
}
interface OutputLookup {
  rpPaths: string[];
  textureByTail: Map<string, string>;
  soundByTail: Map<string, string>;
  modelByStem: Map<string, string[]>;
  animationByStem: Map<string, string[]>;
  /** Clip id → generated animation file (GeckoLib container files hold many entities' clips). */
  animationByClipId: Map<string, string>;
  controllerByStem: Map<string, string[]>;
  blockByStem: Map<string, string[]>;
  recipeByStem: Map<string, string[]>;
  lootByStem: Map<string, string[]>;
  tradeByStem: Map<string, string[]>;
}
function buildLookup(resourcePackFiles: Pack, behaviorPackFiles: Pack): OutputLookup {
  const lookup: OutputLookup = {
    rpPaths: Object.keys(resourcePackFiles),
    textureByTail: new Map(),
    soundByTail: new Map(),
    modelByStem: new Map(),
    animationByStem: new Map(),
    animationByClipId: new Map(),
    controllerByStem: new Map(),
    blockByStem: new Map(),
    recipeByStem: new Map(),
    lootByStem: new Map(),
    tradeByStem: new Map()
  };
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    map.set(key, [...(map.get(key) ?? []), value]);
  };
  for (const path of Object.keys(resourcePackFiles)) {
    const lower = normalise(path);
    if (lower.startsWith('textures/') && lower.endsWith('.png')) {
      lookup.textureByTail.set(lower.slice('textures/'.length), path);
    }
    if (lower.startsWith('sounds/') && /\.(ogg|wav|mp3)$/.test(lower)) {
      lookup.soundByTail.set(lower.slice('sounds/'.length), path);
    }
    if (lower.startsWith('models/')) push(lookup.modelByStem, stemOf(lower), path);
    if (lower.startsWith('animations/')) push(lookup.animationByStem, stemOf(lower), path);
    if (lower.startsWith('animation_controllers/')) push(lookup.controllerByStem, stemOf(lower), path);
  }
  // Clip-level index: a GeckoLib container document (`all_animations.json`) holds the clips of
  // many entities, so a source file is only "not carried" when none of its clips shipped.
  for (const path of Object.keys(resourcePackFiles)) {
    const lower = normalise(path);
    if (!lower.startsWith('animations/') || !lower.endsWith('.json')) continue;
    const raw = resourcePackFiles[path];
    for (const clipId of clipIdsInDocument(decodeText(raw))) {
      if (!lookup.animationByClipId.has(clipId)) lookup.animationByClipId.set(clipId, path);
    }
  }
  for (const path of Object.keys(behaviorPackFiles)) {
    const lower = normalise(path);
    if (lower.startsWith('blocks/')) push(lookup.blockByStem, stemOf(lower), path);
    if (lower.startsWith('recipes/')) push(lookup.recipeByStem, stemOf(lower), path);
    if (lower.startsWith('loot_tables/')) push(lookup.lootByStem, stemOf(lower), path);
    if (lower.startsWith('trading/')) push(lookup.tradeByStem, stemOf(lower), path);
  }
  return lookup;
}
function resolveOutputs(kind: SourceAssetKind, path: string, lookup: OutputLookup, sourceText?: string): string[] {
  switch (kind) {
    case 'texture':
      {
        const tail = afterSegment(path, 'textures');
        const hit = tail ? lookup.textureByTail.get(tail) : undefined;
        return hit ? [hit] : [];
      }
    case 'animated-texture':
      {
        const tail = afterSegment(path, 'textures');
        if (!tail) return [];
        const hit = lookup.textureByTail.get(tail.replace(/\.mcmeta$/, ''));
        return hit ? [hit] : [];
      }
    case 'model':
      return lookup.modelByStem.get(stemOf(path)) ?? [];
    case 'blockstate':
      return lookup.blockByStem.get(stemOf(path)) ?? [];
    case 'animation':
      {
        const byStem = lookup.animationByStem.get(stemOf(path));
        if (byStem && byStem.length > 0) return byStem;
        // GeckoLib container documents (`all_animations.json`) are not named after the entities
        // they animate, so their clips are traced through the clip ids that actually shipped.
        if (!sourceText) return [];
        const byClip = new Set<string>();
        for (const clipId of clipIdsInDocument(sourceText)) {
          const hit = lookup.animationByClipId.get(clipId);
          if (hit) byClip.add(hit);
        }
        return [...byClip];
      }
    case 'animation-controller':
      return lookup.controllerByStem.get(stemOf(path)) ?? [];
    case 'recipe':
      return lookup.recipeByStem.get(stemOf(path)) ?? [];
    case 'loot-table':
      return lookup.lootByStem.get(stemOf(path)) ?? [];
    case 'trade-table':
      return lookup.tradeByStem.get(stemOf(path)) ?? [];
    case 'sound':
      {
        const tail = afterSegment(path, 'sounds');
        const hit = tail ? lookup.soundByTail.get(tail) : undefined;
        return hit ? [hit] : [];
      }
    case 'lang':
      {
        const textFile = lookup.rpPaths.find(entry => normalise(entry).startsWith('texts/'));
        return textFile ? [textFile] : [];
      }
    default:
      return [];
  }
}
function evidenceFor(kind: SourceAssetKind, outputs: string[]): string {
  const first = outputs[0];
  switch (kind) {
    case 'texture':
      return first ? `Shipped as ${first}.` : 'ABSENT — no shipped texture corresponds to this reference.';
    case 'animated-texture':
      return first ? `Frame timing read from this mcmeta and applied to ${first}.` : 'No shipped texture carries this animation metadata.';
    case 'model':
      return first ? `Converted to the Bedrock geometry ${first}.` : 'NOT CARRIED — no generated geometry file corresponds to this model.';
    case 'blockstate':
      return first ? `Converted into the Bedrock block definition ${first}.` : 'NOT CARRIED — no generated block definition corresponds to this blockstate.';
    case 'animation':
      return first ? `Converted to the Bedrock animation ${first}.` : 'NOT CARRIED — no generated animation file corresponds to this clip.';
    case 'animation-controller':
      return first ? `Converted to the Bedrock animation controller ${first}.` : 'NOT CARRIED — no generated animation controller corresponds to this state machine.';
    case 'recipe':
      return first ? `Converted to the Bedrock recipe ${first}.` : 'NOT CARRIED — no generated recipe corresponds to this file.';
    case 'loot-table':
      return first ? `Converted to the Bedrock loot table ${first}.` : 'NOT CARRIED — no generated loot table corresponds to this file.';
    case 'trade-table':
      return first ? `Converted to the Bedrock trade table ${first}.` : 'NOT CARRIED — no generated trade table corresponds to this file.';
    case 'sound':
      return first ? `Shipped as ${first}.` : 'NOT CARRIED — no shipped sound file corresponds to this asset.';
    case 'lang':
      return first ? `Merged into the shipped language file ${first}.` : 'NOT CARRIED — no shipped language file was produced.';
    case 'java-source':
      return 'Read as behaviour evidence; the outcome is recorded in the behaviour translation report, not as a file copy.';
    case 'bytecode':
      return 'Disassembled for behaviour evidence; the outcome is recorded in the behaviour translation report, not as a file copy.';
    case 'metadata':
      return 'Pack metadata read for identification only; it is not shipped as-is.';
    default:
      return 'Not a recognised converted asset kind; recorded for traceability.';
  }
}
const STRUCTURE_PREFIXES = ['texts/', 'scripts/', 'materials/', 'sounds/', 'spawn_rules/', 'render_controllers/', 'animation_controllers/', 'attachables/'];
const STRUCTURE_FILES = new Set(['manifest.json', assetsData.IMAGE_QEIG, 'textures/item_texture.json', 'textures/terrain_texture.json', 'textures/flipbook_textures.json', 'textures/textures_list.json', 'sounds/sound_definitions.json']);
function isStructureFile(path: string): boolean {
  const lower = normalise(path);
  return STRUCTURE_FILES.has(lower) || STRUCTURE_PREFIXES.some(prefix => lower.startsWith(prefix));
}
function dispositionFor(kind: SourceAssetKind, outputs: string[], failedOutputs: Set<string>): SourceAssetDisposition {
  if (kind === 'java-source' || kind === 'bytecode' || kind === 'metadata') return 'analyzed';
  if (outputs.length === 0) return 'not-carried';
  if (outputs.some(path => failedOutputs.has(normalise(path)))) return 'failed';
  if (kind === 'texture' || kind === 'sound' || kind === 'lang') return 'carried';
  return 'converted';
}
const EMPTY_COUNTS = (): ConversionManifestCounts => ({
  total: 0,
  carried: 0,
  converted: 0,
  analyzed: 0,
  notCarried: 0,
  failed: 0
});

/** Builds the Phase 10 documentation record for one conversion. */
export function buildConversionManifest(input: ConversionManifestInput): ConversionManifestReport {
  const lookup = buildLookup(input.resourcePackFiles, input.behaviorPackFiles);
  const failedOutputs = new Set((input.validation?.findings ?? []).filter(finding => finding.conversionFailure && finding.resolution !== 'repaired').map(finding => normalise(finding.file)));
  const sources: SourceFileRecord[] = input.entries.map(entry => {
    const path = entry.path.replace(/\\/g, '/');
    const kind = classifySourcePath(path);
    const sourceText = kind === 'animation' ? decodeText(entry.data) : undefined;
    const outputs = resolveOutputs(kind, path, lookup, sourceText);
    return {
      path,
      kind,
      bytes: entry.data.length,
      disposition: dispositionFor(kind, outputs, failedOutputs),
      outputs,
      evidence: evidenceFor(kind, outputs)
    };
  });
  const sourcePathsByOutput = new Map<string, string[]>();
  for (const source of sources) {
    for (const output of source.outputs) {
      const key = normalise(output);
      sourcePathsByOutput.set(key, [...(sourcePathsByOutput.get(key) ?? []), source.path]);
    }
  }
  const outputs: GeneratedFileRecord[] = [...Object.entries(input.resourcePackFiles).map(([path, data]) => ({
    path,
    data,
    role: 'RP' as const
  })), ...Object.entries(input.behaviorPackFiles).map(([path, data]) => ({
    path,
    data,
    role: 'BP' as const
  }))].map(file => {
    const sourcePaths = sourcePathsByOutput.get(normalise(file.path)) ?? [];
    const origin: GeneratedFileOrigin = sourcePaths.length > 0 ? 'source' : isStructureFile(file.path) ? 'structure' : 'no-direct-source';
    return {
      path: file.path,
      role: file.role,
      bytes: byteLength(file.data),
      origin,
      sourcePaths
    };
  });
  const categoryCounts: Partial<Record<SourceAssetKind, ConversionManifestCounts>> = {};
  for (const source of sources) {
    const counts = categoryCounts[source.kind] ?? EMPTY_COUNTS();
    counts.total += 1;
    if (source.disposition === 'carried') counts.carried += 1;
    if (source.disposition === 'converted') counts.converted += 1;
    if (source.disposition === 'analyzed') counts.analyzed += 1;
    if (source.disposition === 'not-carried') counts.notCarried += 1;
    if (source.disposition === 'failed') counts.failed += 1;
    categoryCounts[source.kind] = counts;
  }
  const tally = (disposition: SourceAssetDisposition) => sources.filter(source => source.disposition === disposition).length;
  const carried = tally('carried');
  const converted = tally('converted');
  const analyzed = tally('analyzed');
  const notCarried = tally('not-carried');
  const failed = tally('failed');
  const structureFiles = outputs.filter(output => output.origin === 'structure').length;
  const noDirectSourceFiles = outputs.filter(output => output.origin === 'no-direct-source').length;
  const failures = (input.validation?.findings ?? []).filter(finding => finding.conversionFailure && finding.resolution !== 'repaired').map(finding => `${finding.role}:${finding.file} — ${finding.detail}`);
  for (const source of sources.filter(entry => entry.disposition === 'failed').slice(0, 20)) {
    failures.push(`SOURCE ${source.path} produced ${source.outputs.join(', ')}, which is reported as a broken conversion.`);
  }
  const documentation: string[] = [];
  documentation.push(`# Conversion documentation — ${input.modId}`);
  documentation.push(`Every source file consumed by the converter and every generated file it produced. Playable Mode: ${input.playableMode ? 'ON (INVENTED defaults permitted)' : 'OFF (no gameplay content invented)'}.`);
  documentation.push('');
  documentation.push(`## Source files consumed (${sources.length})`);
  for (const source of sources.slice(0, MAX_DOCUMENTED_SOURCES)) {
    documentation.push(`- [${SOURCE_KIND_LABELS[source.kind]}] ${source.path} — ${source.disposition.toUpperCase()}${source.outputs.length > 0 ? ` → ${source.outputs.join(', ')}` : ''}. ${source.evidence}`);
  }
  if (sources.length > MAX_DOCUMENTED_SOURCES) {
    documentation.push(`- … ${sources.length - MAX_DOCUMENTED_SOURCES} further source file(s) are recorded in the report data but not listed here.`);
  }
  documentation.push('');
  documentation.push(`## Generated files (${outputs.length})`);
  for (const output of outputs.slice(0, MAX_DOCUMENTED_OUTPUTS)) {
    documentation.push(`- [${output.role}] ${output.path} — ${output.origin}${output.sourcePaths.length > 0 ? ` (source: ${output.sourcePaths.slice(0, 3).join(', ')})` : ''}.`);
  }
  if (outputs.length > MAX_DOCUMENTED_OUTPUTS) {
    documentation.push(`- … ${outputs.length - MAX_DOCUMENTED_OUTPUTS} further generated file(s) are recorded in the report data but not listed here.`);
  }
  documentation.push('');
  documentation.push(`## Conversion failures recorded (${failures.length})`);
  if (failures.length === 0) documentation.push('- None: no conversion failure is open in this export.');
  for (const failure of failures.slice(0, 60)) documentation.push(`- ${failure}`);
  if (failures.length > 60) documentation.push(`- … ${failures.length - 60} further failure record(s).`);
  if (input.hardcodingAudit) {
    documentation.push('');
    documentation.push('## Hardcoding audit');
    documentation.push(`- ${input.hardcodingAudit.summary}.`);
  }
  const summary = `${sources.length} source file(s) documented: ${carried} carried, ${converted} converted, ${analyzed} analysed as evidence, ` + `${notCarried} not carried, ${failed} with a recorded failure. ${outputs.length} generated file(s): ` + `${outputs.length - structureFiles - noDirectSourceFiles} traceable to a source file, ${structureFiles} required pack structure, ` + `${noDirectSourceFiles} with no direct source file.`;
  input.onLog?.(`[DOCS] ${summary} Documentation covers every modified source file; failures are listed, never discarded.`);
  return {
    modId: input.modId,
    playableMode: input.playableMode,
    sources,
    outputs,
    categoryCounts,
    carried,
    converted,
    analyzed,
    notCarried,
    failed,
    structureFiles,
    noDirectSourceFiles,
    failures,
    hardcodingSummary: input.hardcodingAudit?.summary,
    documentation,
    documentationTruncated: sources.length > MAX_DOCUMENTED_SOURCES || outputs.length > MAX_DOCUMENTED_OUTPUTS,
    summary
  };
}

/** Short log lines for the conversion documentation record. */
export function formatConversionManifestLog(report: ConversionManifestReport): string[] {
  const lines = [`[DOCS] ${report.summary}`];
  for (const source of report.sources.filter(entry => entry.disposition === 'not-carried').slice(0, 6)) {
    lines.push(`[DOCS] NOT CARRIED ${source.path} — ${source.evidence}`);
  }
  if (report.notCarried > 6) {
    lines.push(`[DOCS] ${report.notCarried - 6} further source file(s) were not carried into the pack.`);
  }
  return lines;
}