import type {
  DecompileStats,
  ModLoaderId,
  SourceDiscoveryReport,
  SourceDocumentRecord,
  SourceDomain,
  SourceLoaderEvidence,
  SourceRawReference,
} from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';

/**
 * Universal source discovery.
 *
 * This stage only reads the archive. It answers three questions without assuming anything about
 * the mod it was given: which loader ecosystems are present, which documents exist and what each
 * one declares, and which identifiers those documents reference. Nothing is converted here, so a
 * later failure can be traced back to real evidence instead of a name-based guess.
 */

const decoder = new TextDecoder();
const MAX_REPORTED_DOCUMENTS = 140;
const MAX_REPORTED_REFERENCES = 240;
const MAX_JSON_DOCUMENTS_SCANNED = 900;
const MAX_REFERENCES_PER_DOCUMENT = 12;

/** Loader metadata files. Detection is file evidence, never a content assumption. */
const LOADER_MARKERS: Array<{ loader: ModLoaderId; pattern: RegExp; label: string }> = [
  { loader: 'neoforge', pattern: /^meta-inf\/neoforge\.mods\.toml$/, label: 'META-INF/neoforge.mods.toml' },
  { loader: 'forge', pattern: /^meta-inf\/mods\.toml$/, label: 'META-INF/mods.toml' },
  { loader: 'fabric', pattern: /^fabric\.mod\.json$/, label: 'fabric.mod.json' },
  { loader: 'quilt', pattern: /^quilt\.mod\.json$/, label: 'quilt.mod.json' },
  { loader: 'legacy-forge', pattern: /^mcmod\.info$/, label: 'mcmod.info' },
  { loader: 'rift', pattern: /^riftmod\.json$/, label: 'riftmod.json' },
];

/** Package evidence, used when a loader ships no metadata file of its own. */
const LOADER_PACKAGES: Array<{ loader: ModLoaderId; pattern: RegExp }> = [
  { loader: 'neoforge', pattern: /^net\/neoforged\// },
  { loader: 'forge', pattern: /^net\/minecraftforge\// },
  { loader: 'fabric', pattern: /^net\/fabricmc\// },
  { loader: 'quilt', pattern: /^org\/quiltmc\// },
];

/** Ordered: more specific folders win (controllers before animations, blockstates before models). */
const DOMAIN_RULES: Array<{ domain: SourceDomain; pattern: RegExp }> = [
  { domain: 'recipe', pattern: /\/(recipes?)\// },
  { domain: 'loot', pattern: /\/(loot_tables?|loot)\// },
  { domain: 'worldgen', pattern: /\/(worldgen|dimension|dimensions|biomes?)\// },
  { domain: 'tag', pattern: /\/tags\/[a-z0-9_.-]+\// },
  { domain: 'localization', pattern: /\/lang\// },
  { domain: 'block', pattern: /\/blockstates\// },
  { domain: 'animation-controller', pattern: /\/(animation_controllers?|controllers?)\// },
  { domain: 'animation', pattern: /\/(animations?|player_animations?)\// },
  { domain: 'particle', pattern: /\/(particles?)\// },
  { domain: 'model', pattern: /\/(models|geo|geometries)\// },
  { domain: 'sound', pattern: /\/(sounds?|audio)\// },
  { domain: 'texture', pattern: /\/textures?\// },
  { domain: 'behavior', pattern: /\.(class|java)$/ },
  { domain: 'molang', pattern: /\.(molang|expression)$/ },
];

const NAMESPACED_ID = /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/i;

function documentFormat(path: string): SourceDocumentRecord['format'] | null {
  if (path.endsWith('.class')) return 'class';
  if (/\.(png|jpe?g|tga|ogg|wav|mp3|nbt)$/.test(path)) return 'binary';
  if (/\.(json5?|mcmeta)$/.test(path)) return 'json';
  if (/\.(java|lang|properties|toml|info|txt|mcfunction|molang)$/.test(path)) return 'text';
  return null;
}

function domainForPath(path: string): SourceDomain {
  for (const rule of DOMAIN_RULES) {
    if (rule.pattern.test(path)) return rule.domain;
  }
  return 'unknown';
}

function namespaceForPath(path: string): string {
  const match = path.match(/^(?:assets|data)\/([a-z0-9_.-]+)\//);
  return match ? match[1] : '';
}

/** File identity without format suffixes: `capac_house.json` -> `capac_house`, `x.geo.json` -> `x`. */
function logicalIdForPath(path: string): string {
  const file = path.split('/').pop() ?? path;
  let id = file;
  for (let pass = 0; pass < 3; pass++) {
    const next = id.replace(
      /\.(geo|animation|particle|entity|item|block|model|mcmeta|json5|json|class|java|png|tga|ogg|wav|mp3|lang|properties|toml|info|txt)$/i,
      '',
    );
    if (next === id) break;
    id = next;
  }
  return id || file;
}

/** Indexes every readable source document in the archive. Uncapped: the caller decides on limits. */
export function indexSourceDocuments(entries: ExtractedZipEntry[]): SourceDocumentRecord[] {
  const documents: SourceDocumentRecord[] = [];
  for (const entry of entries) {
    if (!entry || entry.isDirectory || !entry.path) continue;
    const path = entry.path.replace(/\\/g, '/');
    const lower = path.toLowerCase();
    const format = documentFormat(lower);
    if (!format) continue;
    documents.push({
      path,
      domain: domainForPath(lower),
      namespace: namespaceForPath(lower),
      logicalId: logicalIdForPath(lower),
      format,
      bytes: entry.data?.length ?? entry.uncompressedSize ?? 0,
    });
  }
  return documents;
}

/** Visits every string value inside a parsed JSON document. Used for reference extraction. */
export function walkJsonStrings(value: unknown, visit: (text: string) => void, depth = 0): void {
  if (depth > 20) return;
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkJsonStrings(item, visit, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      walkJsonStrings(item, visit, depth + 1);
    }
  }
}

function detectLoaders(entries: ExtractedZipEntry[]): SourceLoaderEvidence[] {
  const found = new Map<ModLoaderId, string[]>();
  for (const entry of entries) {
    if (!entry || entry.isDirectory) continue;
    const lower = entry.path.replace(/\\/g, '/').toLowerCase();
    for (const marker of LOADER_MARKERS) {
      if (!marker.pattern.test(lower)) continue;
      const list = found.get(marker.loader) ?? [];
      if (!list.includes(marker.label)) list.push(marker.label);
      found.set(marker.loader, list);
    }
    for (const pkg of LOADER_PACKAGES) {
      if (!pkg.pattern.test(lower)) continue;
      const list = found.get(pkg.loader) ?? [];
      const label = `class package ${lower.split('/').slice(0, 2).join('/')}`;
      if (!list.includes(label)) list.push(label);
      found.set(pkg.loader, list);
    }
  }
  return [...found.entries()].map(([loader, evidence]) => ({ loader, evidence }));
}

/** Collects references a set of documents declares, without deciding whether they resolve. */
function collectReferences(
  documents: SourceDocumentRecord[],
  entryByPath: Map<string, ExtractedZipEntry>,
  unparsed: string[],
): SourceRawReference[] {
  const references: SourceRawReference[] = [];
  const seen = new Set<string>();
  let scanned = 0;

  for (const document of documents) {
    if (document.format !== 'json') continue;
    const referencedDomain =
      document.domain === 'recipe'
      || document.domain === 'loot'
      || document.domain === 'tag'
      || document.domain === 'model'
      || document.domain === 'block'
      || document.domain === 'localization'
      || document.domain === 'worldgen'
      || document.domain === 'particle';
    if (!referencedDomain) continue;
    if (scanned >= MAX_JSON_DOCUMENTS_SCANNED || references.length >= MAX_REPORTED_REFERENCES * 2) break;
    scanned += 1;

    const entry = entryByPath.get(document.path.toLowerCase());
    if (!entry?.data || entry.data.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoder.decode(entry.data)) as unknown;
    } catch {
      if (unparsed.length < 40) unparsed.push(document.path);
      continue;
    }

    let found = 0;
    walkJsonStrings(parsed, (text) => {
      if (found >= MAX_REFERENCES_PER_DOCUMENT) return;
      const candidate = text.trim();
      if (!candidate || candidate.length > 96) return;
      const isTag = candidate.startsWith('#');
      if (!NAMESPACED_ID.test(candidate) && !isTag) return;
      const value = candidate.replace(/^#/, '');
      const signature = `${document.path}|${value}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      found += 1;
      references.push({
        fromPath: document.path,
        fromDomain: document.domain,
        value,
        kind: isTag ? 'tag' : value.includes('/') ? 'file-reference' : 'namespaced-id',
      });
    });
  }
  return references;
}

export interface SourceDiscoveryInput {
  entries: ExtractedZipEntry[];
  documents: SourceDocumentRecord[];
  stats?: DecompileStats;
  onLog?: (line: string) => void;
}

/**
 * Runs the discovery stage and returns its evidence record. Documents and references are capped
 * for reporting, while `documentCount` / `documentCounts` always describe the whole archive.
 */
export function runSourceDiscovery(input: SourceDiscoveryInput): SourceDiscoveryReport {
  const { entries, documents, stats, onLog } = input;
  const loaders = detectLoaders(entries);

  const namespaces = new Set<string>();
  const documentCounts: Partial<Record<SourceDomain, number>> = {};
  for (const document of documents) {
    if (document.namespace) namespaces.add(document.namespace);
    documentCounts[document.domain] = (documentCounts[document.domain] ?? 0) + 1;
  }

  const entryByPath = new Map<string, ExtractedZipEntry>();
  for (const entry of entries) {
    if (!entry || entry.isDirectory) continue;
    entryByPath.set(entry.path.replace(/\\/g, '/').toLowerCase(), entry);
  }

  const unparsedDocuments: string[] = [];
  const references = collectReferences(documents, entryByPath, unparsedDocuments);

  const loaderLabel = loaders.length > 0
    ? loaders.map((loader) => loader.loader).join(' + ')
    : 'no loader metadata (generic archive layout)';
  const summary = `${documents.length} source document(s) across ${Object.keys(documentCounts).length} domain(s) in ${namespaces.size} namespace(s); loader adapter(s): ${loaderLabel}; ${references.length} declared reference(s) indexed${unparsedDocuments.length > 0 ? `; ${unparsedDocuments.length} unreadable document(s) reported` : ''}.`;

  onLog?.(`[DISCOVERY] ${summary}`);
  if (loaders.length > 0) {
    for (const loader of loaders) {
      onLog?.(`[DISCOVERY] ${loader.loader} adapter engaged from ${loader.evidence.length} evidence file(s): ${loader.evidence.slice(0, 4).join(', ')}`);
    }
  }
  if (unparsedDocuments.length > 0) {
    onLog?.(`[DISCOVERY] ${unparsedDocuments.length} document(s) could not be parsed and are reported as UNREADABLE instead of being guessed at.`);
  }

  return {
    loaders,
    namespaces: [...namespaces],
    declaredDependencies: stats?.dependencies ?? [],
    documents: documents.slice(0, MAX_REPORTED_DOCUMENTS),
    documentCount: documents.length,
    documentCounts,
    references: references.slice(0, MAX_REPORTED_REFERENCES),
    referenceCount: references.length,
    unparsedDocuments,
    reportingCapped: documents.length > MAX_REPORTED_DOCUMENTS || references.length > MAX_REPORTED_REFERENCES,
    summary,
  };
}