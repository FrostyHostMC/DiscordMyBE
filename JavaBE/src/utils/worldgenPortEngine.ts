import type {
  ComponentProvenance,
  WorldgenDefinitionOutcome,
  WorldgenOutcomeStatus,
  WorldgenPortReport,
  WorldgenSourceKind,
} from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';
import { safeFileId } from '@/utils/bedrockIds';

type PackFiles = Record<string, string | Uint8Array>;
type JsonDoc = Record<string, any>;

export interface WorldgenPortOptions {
  entries: ExtractedZipEntry[];
  behaviorPackFiles: PackFiles;
  onLog?: (line: string) => void;
}

const norm = (path: string) => path.replace(/\\/g, '/').toLowerCase();

function asRecord(value: unknown): JsonDoc | null {
  return value && typeof value === 'object' ? (value as JsonDoc) : null;
}

/** Recognises a world-generation document purely from its own archive path. */
export function classifyWorldgenPath(path: string): WorldgenSourceKind | null {
  const lower = norm(path);
  if (!lower.endsWith('.json')) return null;
  if (/\/worldgen\/biome\//.test(lower)) return 'biome';
  if (/\/worldgen\/placed_feature\//.test(lower)) return 'placed-feature';
  if (/\/worldgen\/configured_feature\//.test(lower)) return 'configured-feature';
  if (/\/worldgen\/structure\//.test(lower)) return 'structure';
  if (/\/worldgen\/template_pool\//.test(lower)) return 'template-pool';
  if (/\/worldgen\/processor_list\//.test(lower)) return 'processor-list';
  if (/\/worldgen\/noise_settings\//.test(lower)) return 'noise-settings';
  if (/\/worldgen\/configured_carver\//.test(lower)) return 'carver';
  if (/\/(dimension|dimension_type)\//.test(lower)) return 'dimension';
  if (/\/worldgen\//.test(lower)) return 'other';
  return null;
}

/** `data/<ns>/worldgen/<kind>/<name>.json` -> the identifier the mod registered it under. */
function declaredJavaId(path: string): { namespace: string; name: string } | null {
  const match = norm(path).match(/\/(?:data|assets)\/([^/]+)\/(?:worldgen\/)?[^/]+\/([^/]+)\.json$/);
  if (!match) return null;
  return { namespace: match[1], name: match[2] };
}

function normalizeId(value: string): string {
  const clean = value.trim().toLowerCase();
  if (!clean.startsWith('#')) {
    if (clean.length === 0) return '';
    return clean.includes(':') ? clean : `minecraft:${clean}`;
  }
  const tag = clean.slice(1);
  return tag.includes(':') ? tag : `minecraft:${tag}`;
}

const STONE_REPLACEABLES = ['minecraft:stone', 'minecraft:granite', 'minecraft:diorite', 'minecraft:andesite', 'minecraft:tuff'];
const DEEPSLATE_REPLACEABLES = ['minecraft:deepslate', 'minecraft:tuff'];

/** Java ore replace tags -> the Bedrock block list an ore_feature may replace. */
function mayReplaceFor(target: unknown): { blocks: string[]; exact: boolean } | null {
  const record = asRecord(target);
  if (!record) return null;
  const block = String(record.block ?? '').toLowerCase();
  if (block) return { blocks: [block], exact: true };
  const tag = String(record.tag ?? '').toLowerCase();
  if (tag.includes('deepslate_ore_replaceables')) return { blocks: DEEPSLATE_REPLACEABLES, exact: false };
  if (tag.includes('stone_ore_replaceables') || tag.includes('base_stone_overworld')) {
    return { blocks: STONE_REPLACEABLES, exact: false };
  }
  return null;
}

/** Bedrock blocks that really shipped, so a feature never places a block the pack lacks. */
function collectShippedBlocks(pack: PackFiles): Set<string> {
  const identifiers = new Set<string>();
  for (const [path, value] of Object.entries(pack)) {
    if (!path.startsWith('blocks/') || !path.endsWith('.json') || typeof value !== 'string') continue;
    try {
      const parsed = JSON.parse(value) as JsonDoc;
      const identifier = asRecord(asRecord(parsed['minecraft:block'])?.['description'])?.['identifier'];
      if (typeof identifier === 'string') identifiers.add(identifier.toLowerCase());
    } catch {
      // A malformed block definition is reported by the validation stage, not here.
    }
  }
  return identifiers;
}

interface ConvertedFeature {
  json: string;
  approximated: boolean;
  notes: string[];
}

function convertOreFeature(bedrockId: string, doc: JsonDoc, shippedBlocks: Set<string>): { feature?: ConvertedFeature; reason?: string } {
  const config = asRecord(doc.config) ?? {};
  const size = Math.round(Number(config.size));
  const targets = Array.isArray(config.targets) ? config.targets : [];
  if (!Number.isFinite(size) || size <= 0) return { reason: 'the Java ore configuration declares no usable vein size' };
  if (targets.length === 0) return { reason: 'the Java ore configuration declares no replace targets' };
  const replaceRules: JsonDoc[] = [];
  const notes: string[] = [];
  let approximated = false;
  for (const raw of targets) {
    const target = asRecord(raw);
    const placed = String(asRecord(target?.state)?.Name ?? '').toLowerCase();
    if (!placed) return { reason: 'an ore target declares no block state, so nothing could be placed' };
    if (!shippedBlocks.has(placed)) {
      return { reason: `the feature places ${placed}, but no Bedrock block definition with that identifier shipped — no feature file was written` };
    }
    const mayReplace = mayReplaceFor(target?.target);
    if (!mayReplace) {
      return { reason: `the replace target ${JSON.stringify(target?.target ?? {})} has no Bedrock counterpart, so host-block filtering cannot be represented` };
    }
    if (!mayReplace.exact) {
      approximated = true;
      notes.push(`may_replace for ${placed} is expressed as Bedrock block names because Java replace tags have no equivalent.`);
    }
    replaceRules.push({ places_block: placed, may_replace: mayReplace.blocks });
  }
  const json = JSON.stringify(
    {
      format_version: '1.13.0',
      'minecraft:ore_feature': {
        description: { identifier: bedrockId },
        count: size,
        replace_rules: replaceRules,
      },
    },
    null,
    2,
  );
  return { feature: { json, approximated, notes } };
}

interface PlacementFacts {
  iterations: number;
  scatter: boolean;
  surface: boolean;
  minY: number;
  maxY: number;
  notes: string[];
}

function readPlacement(placements: unknown[]): PlacementFacts {
  const facts: PlacementFacts = { iterations: 1, scatter: false, surface: true, minY: -60, maxY: 320, notes: [] };
  for (const raw of placements) {
    const entry = asRecord(raw);
    const type = String(entry?.type ?? '').toLowerCase();
    if (type.endsWith('minecraft:count') || type === 'count') {
      const count = entry?.count;
      if (typeof count === 'number') {
        facts.iterations = Math.max(1, Math.round(count));
      } else {
        const uniform = asRecord(count);
        const min = Number(uniform?.min_inclusive ?? uniform?.min ?? NaN);
        if (Number.isFinite(min) && min > 0) facts.iterations = Math.max(1, Math.round(min));
        facts.notes.push('the Java count provider is a distribution, so the Bedrock rule uses its minimum roll.');
      }
      continue;
    }
    if (type.endsWith('in_square')) {
      facts.scatter = true;
      continue;
    }
    if (type.endsWith('height_range')) {
      const height = asRecord(entry?.height);
      const absoluteOf = (value: unknown): number | null => {
        if (typeof value === 'number') return value;
        const absolute = asRecord(value)?.absolute;
        return typeof absolute === 'number' ? absolute : null;
      };
      const min = absoluteOf(height?.min_inclusive);
      const max = absoluteOf(height?.max_inclusive);
      if (min != null && max != null) {
        facts.surface = false;
        facts.minY = min;
        facts.maxY = max;
      } else {
        facts.surface = true;
        facts.notes.push('the Java height provider is not a constant range, so the rule evaluates the Bedrock heightmap per column.');
      }
    }
  }
  return facts;
}

const VANILLA_BIOME_TAGS: Record<string, string> = {
  plains: 'plains', sunflower_plains: 'plains', forest: 'forest', flower_forest: 'forest', birch_forest: 'forest',
  old_growth_birch_forest: 'forest', dark_forest: 'forest', taiga: 'taiga', old_growth_pine_taiga: 'taiga',
  old_growth_spruce_taiga: 'taiga', snowy_taiga: 'taiga', jungle: 'jungle', sparse_jungle: 'jungle',
  bamboo_jungle: 'jungle', desert: 'desert', savanna: 'savanna', savanna_plateau: 'savanna',
  windswept_savanna: 'savanna', swamp: 'swamp', mangrove_swamp: 'swamp', badlands: 'mesa',
  eroded_badlands: 'mesa', wooded_badlands: 'mesa', snowy_plains: 'frozen', ice_spikes: 'frozen',
  snowy_beach: 'frozen', beach: 'beach', stony_shore: 'beach', mushroom_fields: 'mushroom_island',
  windswept_hills: 'extreme_hills', grove: 'grove', meadow: 'meadow', ocean: 'ocean',
  warm_ocean: 'ocean', lukewarm_ocean: 'ocean', cold_ocean: 'ocean', deep_ocean: 'ocean',
};

interface BiomeRefs {
  tags: Set<string>;
  custom: Set<string>;
  steps: Set<number>;
}

/** Which biomes attach a placed feature, read independently from each biome document. */
function collectBiomeReferences(
  targets: Array<{ path: string; kind: WorldgenSourceKind }>,
  decoded: Map<string, JsonDoc>,
): Map<string, BiomeRefs> {
  const refs = new Map<string, BiomeRefs>();
  for (const { path, kind } of targets) {
    if (kind !== 'biome') continue;
    const doc = decoded.get(path);
    const biomeId = declaredJavaId(path);
    if (!doc || !biomeId) continue;
    const features = Array.isArray(doc.features) ? doc.features : [];
    features.forEach((list, step) => {
      if (!Array.isArray(list)) return;
      for (const item of list) {
        const reference = normalizeId(typeof item === 'string' ? item : String(asRecord(item)?.feature ?? ''));
        if (!reference) continue;
        const bucket = refs.get(reference) ?? { tags: new Set<string>(), custom: new Set<string>(), steps: new Set<number>() };
        bucket.steps.add(step);
        const tag = biomeId.namespace === 'minecraft' ? VANILLA_BIOME_TAGS[biomeId.name] : undefined;
        if (tag) bucket.tags.add(tag);
        else bucket.custom.add(`${biomeId.namespace}:${biomeId.name}`);
        refs.set(reference, bucket);
      }
    });
  }
  return refs;
}

/** Java decoration step -> Bedrock feature-rule placement pass. */
function placementPass(step: number): { pass: string; exact: boolean } {
  if (step === 6) return { pass: 'underground_ores_pass', exact: true };
  if (step === 3 || step === 7) return { pass: 'underground_pass', exact: true };
  if (step === 9) return { pass: 'vegetation_pass', exact: true };
  if (step === 4 || step === 10) return { pass: 'surface_pass', exact: true };
  return { pass: 'surface_pass', exact: false };
}

function buildBiomeFilter(refs: BiomeRefs | undefined): { filter: JsonDoc; exact: boolean } {
  const tags = Array.from(refs?.tags ?? []).sort();
  if (tags.length === 0) {
    return { filter: { test: 'has_biome_tag', operator: '==', value: 'overworld' }, exact: false };
  }
  const filter = tags.length === 1
    ? { test: 'has_biome_tag', operator: '==', value: tags[0] }
    : { any_of: tags.map((tag) => ({ test: 'has_biome_tag', operator: '==', value: tag })) };
  return { filter, exact: (refs?.custom.size ?? 0) === 0 };
}

function unsupportedReason(kind: WorldgenSourceKind): string {
  switch (kind) {
    case 'biome':
      return 'Bedrock biome definitions use a different schema behind an experimental capability; the climate, spawn and feature data was parsed to build feature-rule filters, but no biome file was written.';
    case 'structure':
      return 'Java jigsaw structures depend on template pools, processor lists and structure sets with no data-driven Bedrock counterpart, so no structure was generated.';
    case 'template-pool':
    case 'processor-list':
      return 'Template pools and processor lists exist only to assemble Java structures; nothing in Bedrock consumes them.';
    case 'noise-settings':
      return 'Java noise settings define terrain shape; Bedrock terrain generation is not data-driven.';
    case 'carver':
      return 'Java carvers are not data-driven in Bedrock, so no carver was generated.';
    case 'dimension':
      return 'Custom dimensions require experimental Bedrock APIs plus scripting; no dimension file was generated.';
    default:
      return 'Unrecognised world-generation document — no Bedrock output was generated for it.';
  }
}

/**
 * World-generation compatibility stage.
 *
 * Every biome, feature, structure, pool, carver and dimension document is parsed on its own
 * and classified. Only representations Bedrock really supports are written (`features/` for
 * ore configured features, `feature_rules/` for placed features that resolve to a feature the
 * pack actually ships). Everything else is reported per definition as unsupported or
 * unresolved — world generation is never called ported when no file exists.
 */
export function portWorldGeneration(options: WorldgenPortOptions): WorldgenPortReport {
  const { entries, behaviorPackFiles, onLog } = options;
  const definitions: WorldgenDefinitionOutcome[] = [];
  const filesWritten: string[] = [];
  const decoded = new Map<string, JsonDoc>();
  const targets: Array<{ path: string; kind: WorldgenSourceKind }> = [];

  for (const entry of entries) {
    const kind = classifyWorldgenPath(entry.path);
    if (!kind) continue;
    targets.push({ path: entry.path, kind });
    try {
      const parsed = asRecord(JSON.parse(new TextDecoder().decode(entry.data)));
      if (parsed) decoded.set(entry.path, parsed);
    } catch {
      // Reported as unresolved below.
    }
  }

  const push = (
    sourcePath: string,
    kind: WorldgenSourceKind,
    status: WorldgenOutcomeStatus,
    outputs: string[],
    reason: string,
  ) => {
    const provenance: ComponentProvenance = status === 'converted' || status === 'approximated' ? 'ADAPTED' : 'ABSENT';
    definitions.push({ sourcePath, kind, status, provenance, outputs, reason });
  };

  if (targets.length === 0) {
    return {
      definitions,
      filesWritten,
      converted: 0,
      approximated: 0,
      unsupported: 0,
      unresolved: 0,
      biomeDefinitions: 0,
      summary: 'No Java world-generation document was found in the archive, so no biome, feature, feature rule or structure output was generated.',
    };
  }

  const shippedBlocks = collectShippedBlocks(behaviorPackFiles);
  const biomeRefs = collectBiomeReferences(targets, decoded);
  const featureOutputs = new Map<string, { identifier: string; path: string }>();

  // 1. Configured features -> Bedrock feature documents.
  for (const { path, kind } of targets) {
    if (kind !== 'configured-feature') continue;
    const doc = decoded.get(path);
    const javaId = declaredJavaId(path);
    if (!doc || !javaId) {
      push(path, kind, 'unresolved', [], 'The configured-feature document could not be parsed as JSON.');
      continue;
    }
    const type = String(doc.type ?? '').toLowerCase();
    if (type !== 'minecraft:ore') {
      push(path, kind, 'unsupported', [], `Configured feature type "${type || 'unknown'}" has no generated Bedrock feature equivalent in this pipeline.`);
      continue;
    }
    const identifier = `${safeFileId(javaId.namespace)}_${safeFileId(javaId.name)}_ore`;
    const converted = convertOreFeature(identifier, doc, shippedBlocks);
    if (!converted.feature) {
      push(path, kind, 'unresolved', [], converted.reason ?? 'The ore feature could not be converted.');
      continue;
    }
    const outputPath = `features/${identifier}.json`;
    behaviorPackFiles[outputPath] = converted.feature.json;
    filesWritten.push(outputPath);
    featureOutputs.set(`${javaId.namespace}:${javaId.name}`, { identifier, path: outputPath });
    push(
      path,
      kind,
      converted.feature.approximated ? 'approximated' : 'converted',
      [outputPath],
      `minecraft:ore_feature written for ${identifier}.${converted.feature.notes.length > 0 ? ` ${converted.feature.notes.join(' ')}` : ''}`,
    );
  }

  // 2. Placed features -> Bedrock feature rules, only for features the pack really ships.
  for (const { path, kind } of targets) {
    if (kind !== 'placed-feature') continue;
    const doc = decoded.get(path);
    const javaId = declaredJavaId(path);
    if (!doc || !javaId) {
      push(path, kind, 'unresolved', [], 'The placed-feature document could not be parsed as JSON.');
      continue;
    }
    const reference = normalizeId(String(doc.feature ?? ''));
    const owner = featureOutputs.get(reference);
    if (!owner) {
      push(
        path,
        kind,
        'unresolved',
        [],
        `The placed feature references ${reference || 'no configured feature'} but no Bedrock feature document was generated for it, so no feature rule was written.`,
      );
      continue;
    }
    const placements = Array.isArray(doc.placement) ? doc.placement : [];
    const facts = readPlacement(placements);
    const refs = biomeRefs.get(`${javaId.namespace}:${javaId.name}`);
    const step = refs && refs.steps.size === 1 ? Array.from(refs.steps)[0] : 4;
    const pass = placementPass(step);
    const biomeFilter = buildBiomeFilter(refs);
    const identifier = `${safeFileId(javaId.namespace)}_${safeFileId(javaId.name)}_rule`;
    const outputPath = `feature_rules/${identifier}.json`;
    const extent = facts.scatter ? 15 : 0;
    behaviorPackFiles[outputPath] = JSON.stringify(
      {
        format_version: '1.13.0',
        'minecraft:feature_rules': {
          description: { identifier, places_feature: owner.identifier },
          conditions: {
            placement_pass: pass.pass,
            'minecraft:biome_filter': biomeFilter.filter,
          },
          distribution: {
            iterations: facts.iterations,
            coordinate_eval_order: 'xzy',
            x: { distribution: 'uniform', extent: [0, extent] },
            y: facts.surface ? 'query.heightmap(variable.worldx, variable.worldz)' : { distribution: 'uniform', extent: [facts.minY, facts.maxY] },
            z: { distribution: 'uniform', extent: [0, extent] },
          },
        },
      },
      null,
      2,
    );
    filesWritten.push(outputPath);
    const exact = facts.notes.length === 0 && pass.exact && biomeFilter.exact;
    const notes = [
      `Placed onto ${owner.identifier} in the ${pass.pass} pass.`,
      ...facts.notes,
      pass.exact ? '' : `The Java decoration step ${step} has no exact Bedrock pass, so surface_pass was used.`,
      biomeFilter.exact ? '' : 'The biome filter is expressed with Bedrock biome tags, so custom or unmapped Java biomes are not reproduced.',
    ].filter((line) => line.length > 0);
    push(path, kind, exact ? 'converted' : 'approximated', [outputPath], notes.join(' '));
  }

  // 3. Everything else is reported per definition, never batched into one blanket claim.
  let biomeDefinitions = 0;
  for (const { path, kind } of targets) {
    if (kind === 'configured-feature' || kind === 'placed-feature') continue;
    if (kind === 'biome') biomeDefinitions += 1;
    push(path, kind, 'unsupported', [], unsupportedReason(kind));
  }

  const converted = definitions.filter((entry) => entry.status === 'converted').length;
  const approximated = definitions.filter((entry) => entry.status === 'approximated').length;
  const unsupported = definitions.filter((entry) => entry.status === 'unsupported').length;
  const unresolved = definitions.filter((entry) => entry.status === 'unresolved').length;
  const summary = `${definitions.length} world-generation document(s) parsed independently: ${converted} converted, ${approximated} approximated, ${unsupported} unsupported, ${unresolved} unresolved; ${filesWritten.length} Bedrock feature/feature-rule file(s) written. ${biomeDefinitions} biome definition(s) analysed for placement data.`;

  onLog?.(`[WORLDGEN] ${summary}`);
  for (const definition of definitions) {
    if (definition.status === 'unsupported' || definition.status === 'unresolved') {
      onLog?.(`[WORLDGEN:${definition.status.toUpperCase()}] ${definition.sourcePath} — ${definition.reason}`);
    }
  }

  return { definitions, filesWritten, converted, approximated, unsupported, unresolved, biomeDefinitions, summary };
}