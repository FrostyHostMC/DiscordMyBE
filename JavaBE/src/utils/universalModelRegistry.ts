import type { ExtractedZipEntry } from '@/utils/zip';

/**
 * Universal model source registry.
 *
 * A conversion can only claim "this mod ships no model" when every modelling format the
 * archive could contain has actually been inspected. That was not true before: `.bbmodel`,
 * Tabula `.tbl` and Bedrock-format JSON sitting outside `models/` were never classified, so
 * an archive full of models could be reported as having none and every mob fell back to a
 * generic rig.
 *
 * This registry classifies every candidate document once, reports what the engine can read
 * today and what it cannot, and never silently drops an unrecognised model file.
 */

const decoder = new TextDecoder();

export type ModelSourceFormat =
  | 'geckolib-geo'
  | 'bedrock-geometry'
  | 'java-element-model'
  | 'item-sprite-model'
  | 'poly-mesh'
  | 'wavefront-obj'
  | 'blockbench-model'
  | 'tabula-model'
  | 'optifine-cem'
  | 'unreadable-json';

export interface ModelSourceRecord {
  path: string;
  format: ModelSourceFormat;
  /** True when the engine converts this document into Bedrock geometry. */
  supported: boolean;
  evidence: string;
}

export interface ModelSourceRegistryReport {
  files: number;
  byFormat: Record<ModelSourceFormat, number>;
  supported: number;
  /** Documents the engine recognises but cannot convert, with the reason. */
  unsupported: Array<{ path: string; format: ModelSourceFormat; reason: string }>;
  records: ModelSourceRecord[];
  log: string[];
}

const MODEL_PATH =
  /(?:^|\/)(?:models|geo|geometry|model|entity|entities|render|bbmodels|blockbench)\//;

function emptyCounts(): Record<ModelSourceFormat, number> {
  return {
    'geckolib-geo': 0,
    'bedrock-geometry': 0,
    'java-element-model': 0,
    'item-sprite-model': 0,
    'poly-mesh': 0,
    'wavefront-obj': 0,
    'blockbench-model': 0,
    'tabula-model': 0,
    'optifine-cem': 0,
    'unreadable-json': 0,
  };
}

/** Classifies one archive entry, or returns null when it is not a model source. */
export function classifyModelEntry(entry: ExtractedZipEntry): ModelSourceRecord | null {
  const path = entry.path.replace(/\\/g, '/');
  const lower = path.toLowerCase();

  if (lower.endsWith('.obj')) {
    return { path, format: 'wavefront-obj', supported: true, evidence: 'Wavefront OBJ mesh' };
  }
  if (lower.endsWith('.bbmodel')) {
    return { path, format: 'blockbench-model', supported: true, evidence: 'Blockbench project document' };
  }
  if (lower.endsWith('.jem') || lower.endsWith('.jpm')) {
    return {
      path,
      format: 'optifine-cem',
      supported: true,
      evidence: lower.endsWith('.jpm') ? 'OptiFine CEM player model' : 'OptiFine CEM entity model',
    };
  }
  if (lower.endsWith('.tbl') || lower.endsWith('.tbl.json')) {
    return { path, format: 'tabula-model', supported: true, evidence: 'Tabula model document' };
  }
  if (!lower.endsWith('.json')) return null;
  if (lower.includes('/sounds/') || lower.includes('sounds.json')) return null;
  if (lower.includes('/lang/')) return null;
  if (lower.includes('/recipes/') || lower.includes('/loot_tables/') || lower.includes('/advancements/')) return null;
  if (lower.includes('/blockstates/') || lower.includes('/tags/')) return null;

  let text = '';
  if (entry.data.length < 6_000_000) {
    try {
      text = decoder.decode(entry.data);
    } catch {
      text = '';
    }
  }
  if (!text) {
    if (MODEL_PATH.test(lower)) {
      return { path, format: 'unreadable-json', supported: false, evidence: 'model document that could not be decoded' };
    }
    return null;
  }

  if (lower.endsWith('.geo.json')) {
    return { path, format: 'geckolib-geo', supported: true, evidence: 'GeckoLib geometry document' };
  }
  if (text.includes('"poly_mesh"')) {
    return { path, format: 'poly-mesh', supported: true, evidence: 'polygon mesh data' };
  }
  if (text.includes('minecraft:geometry')) {
    return { path, format: 'bedrock-geometry', supported: true, evidence: 'Bedrock-format geometry' };
  }
  if (text.includes('"outliner"') && text.includes('"elements"')) {
    return { path, format: 'blockbench-model', supported: true, evidence: 'Blockbench project document (no extension)' };
  }
  if (/"models"\s*:/.test(text) && /"(submodels|invertAxis|textureSize)"\s*:/.test(text)) {
    return { path, format: 'optifine-cem', supported: true, evidence: 'OptiFine CEM model document' };
  }
  if (text.includes('"elements"')) {
    // A Java element model with real cubes: converted with per-face UVs and a bone layout.
    const isItem = /(?:^|\/)models\/item\//.test(lower);
    return {
      path,
      format: 'java-element-model',
      supported: true,
      evidence: isItem ? 'Java item model with elements' : 'Java element model',
    };
  }
  if (MODEL_PATH.test(lower) && (text.includes('"parent"') || text.includes('"textures"'))) {
    return { path, format: 'item-sprite-model', supported: true, evidence: 'flat sprite model (no elements of its own)' };
  }
  if ((text.includes('"sections"') && text.includes('"boxes"')) || (text.includes('"sections"') && text.includes('"coordinates"'))) {
    return { path, format: 'tabula-model', supported: true, evidence: 'Tabula section/box model' };
  }
  if (MODEL_PATH.test(lower)) {
    return { path, format: 'unreadable-json', supported: false, evidence: 'model folder document with no recognisable geometry' };
  }
  return null;
}

/**
 * Scans the whole archive for modelling documents. The report is the evidence behind every
 * "no model in this mod" claim the pipeline makes.
 */
export function scanModelSources(entries: ExtractedZipEntry[]): ModelSourceRegistryReport {
  const byFormat = emptyCounts();
  const records: ModelSourceRecord[] = [];
  const unsupported: ModelSourceRegistryReport['unsupported'] = [];

  for (const entry of entries ?? []) {
    const record = classifyModelEntry(entry);
    if (!record) continue;
    byFormat[record.format] += 1;
    records.push(record);
    if (!record.supported) {
      unsupported.push({
        path: record.path,
        format: record.format,
        reason:
          record.format === 'unreadable-json'
            ? 'the document could not be read as a model, so nothing was substituted for it.'
            : 'the document is recognised as a model but no converter could express it, so nothing was substituted for it.',
      });
    }
  }

  const supported = records.filter((record) => record.supported).length;
  const formatList = Object.entries(byFormat)
    .filter(([, count]) => count > 0)
    .map(([format, count]) => `${format}=${count}`)
    .join(', ');

  const log: string[] = [
    `[MODEL:INVENTORY] Model source registry: ${records.length} modelling document(s) classified — ${formatList || 'none found'}; ${supported} convertible, ${unsupported.length} recognised but not convertible.`,
  ];
  if (unsupported.length > 0) {
    log.push(
      `[MODEL:WARN] ${unsupported.length} modelling document(s) are reported as NOT CONVERTIBLE instead of being ignored: ${unsupported
        .slice(0, 6)
        .map((entry) => `${entry.path} (${entry.format})`)
        .join(' | ')}${unsupported.length > 6 ? ' …' : ''}`,
    );
  }

  return { files: records.length, byFormat, supported, unsupported, records, log };
}