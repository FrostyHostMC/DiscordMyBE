import type {
  ComponentProvenance,
  DecompileStats,
  IRNode,
  ItemClassification,
  IRReference,
  IRReferenceStatus,
  SourceDiscoveryReport,
  SourceDocumentRecord,
  SourceDomain,
  UniversalIRReport,
} from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';
import { createItemSemanticContext } from '@/utils/itemSemantics';
import { safeFileId } from '@/utils/bedrockIds';
import { walkJsonStrings } from '@/utils/sourceDiscovery';
import { parseRelaxedJson } from '@/utils/relaxedJson';

/**
 * Universal intermediate representation.
 *
 * Analysis, conversion, validation and packaging are separate stages. This module is the end of
 * the analysis stage: it turns what the archive declares into engine-neutral objects that keep
 * the source identity, the original values, the evidence and the confidence behind each field.
 *
 * A node existing proves the source declared something. It never proves the object was converted,
 * and it never carries a value the mod does not declare.
 */

const MAX_NODES = 480;
const MAX_DOCUMENTS_PARSED = 1200;
const MAX_MOLANG_NODES = 40;
const MAX_REFERENCE_SAMPLES = 40;
const MAX_UNRESOLVED_ASPECTS = 40;
const MAX_CLASS_NODES = 120;

const decoder = new TextDecoder();

export interface UniversalIRInput {
  modId: string;
  entries: ExtractedZipEntry[];
  stats?: DecompileStats;
  discovery: SourceDiscoveryReport;
  documents: SourceDocumentRecord[];
  onLog?: (line: string) => void;
}

function readJson(entry: ExtractedZipEntry | undefined): Record<string, unknown> | null {
  if (!entry?.data || entry.data.length === 0) return null;
  const parsed = parseRelaxedJson(decoder.decode(entry.data));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isMolangExpression = (text: string): boolean =>
  /(query\.|math\.|variable\.|temp\.|context\.)/.test(text) && text.length > 3 && text.length < 180;

/** Builds the analysis record handed to the conversion stage. */
export function buildUniversalIR(input: UniversalIRInput): UniversalIRReport {
  const { stats, discovery, documents } = input;
  const entryByPath = new Map<string, ExtractedZipEntry>();
  for (const entry of input.entries) {
    if (!entry || entry.isDirectory) continue;
    entryByPath.set(entry.path.replace(/\\/g, '/').toLowerCase(), entry);
  }

  const nodes: IRNode[] = [];
  const counts: Partial<Record<SourceDomain, number>> = {};
  let nodeCount = 0;
  let parsedDocuments = 0;

  const add = (node: IRNode) => {
    nodeCount += 1;
    counts[node.domain] = (counts[node.domain] ?? 0) + 1;
    if (nodes.length < MAX_NODES) nodes.push(node);
  };
  const readDocument = (path: string) => {
    if (parsedDocuments >= MAX_DOCUMENTS_PARSED) return null;
    parsedDocuments += 1;
    return readJson(entryByPath.get(path.toLowerCase()));
  };

  // ── Items: identity from the registry, role from the semantic classification engine ────────
  const entityNames = Array.from(new Set([
    ...(stats?.spawnableEntities ?? []),
    ...(stats?.registeredEntities ?? []),
  ]));
  const entityKeys = new Set(entityNames.map((name) => safeFileId(name)).filter(Boolean));
  const semantics = createItemSemanticContext({
    classes: stats?.classes ?? [],
    entries: input.entries,
    entities: entityNames,
  });

  const seenItems = new Set<string>();
  const itemClassifications: Record<string, ItemClassification> = {};
  for (const name of stats?.registeredItems ?? []) {
    const id = safeFileId(name);
    if (!id || seenItems.has(id)) continue;
    seenItems.add(id);
    const classification = semantics.classify({ id, name });
    itemClassifications[id] = classification;
    const entityLink = classification.entityLink ? safeFileId(classification.entityLink) : '';
    const references: IRReference[] = [];
    if (entityLink) {
      references.push({
        target: `entity:${entityLink}`,
        domain: 'entity',
        status: entityKeys.has(entityLink) ? 'resolved' : 'unresolved',
        evidence: 'registry associates this item with an entity',
      });
    }
    const provenance: ComponentProvenance = classification.uncertain
      ? 'ABSENT'
      : classification.behaviourRecovered
        ? 'SOURCE'
        : 'ADAPTED';
    add({
      id: `item:${id}`,
      domain: 'item',
      sourceIds: [name],
      sourcePaths: [],
      values: {
        role: classification.role,
        category: classification.category,
        cooldownTicks: classification.cooldownTicks,
        capabilities: classification.capabilities,
      },
      references,
      confidence: classification.score,
      evidence: classification.evidence.map((record) => `${record.source}: ${record.detail}`),
      provenance,
      transforms: [{
        stage: 'analysis',
        action: 'semantic-classification',
        detail: classification.label,
        provenance,
      }],
      unresolved: classification.uncertain ? ['role: source evidence below the decision threshold'] : [],
    });
  }

  // ── Entities: only entities the mod's own registry/lang actually declares ──────────────────
  for (const name of entityNames) {
    const id = safeFileId(name);
    if (!id || !entityKeys.has(id)) continue;
    add({
      id: `entity:${id}`,
      domain: 'entity',
      sourceIds: [name],
      sourcePaths: [],
      values: { registered: true, spawnable: (stats?.spawnableEntities ?? []).includes(name) },
      references: [],
      confidence: 0.9,
      evidence: ['registry: entity declared by the mod metadata or registry scan'],
      provenance: 'SOURCE',
      transforms: [],
      unresolved: [],
    });
  }

  for (const blockName of stats?.registeredBlocks ?? []) {
    const id = safeFileId(blockName);
    if (!id) continue;
    const sourcePaths = documents
      .filter((doc) => doc.domain === 'block' && doc.logicalId.toLowerCase() === id)
      .map((doc) => doc.path);
    add({
      id: `block:${id}`,
      domain: 'block',
      sourceIds: [blockName],
      sourcePaths,
      values: { stateDocuments: sourcePaths.length },
      references: [],
      confidence: sourcePaths.length > 0 ? 0.9 : 0.7,
      evidence: [sourcePaths.length > 0
        ? `archive: ${sourcePaths.length} blockstate document(s) declare this block`
        : 'registry: block declared by the mod, no blockstate document found'],
      provenance: 'SOURCE',
      transforms: [],
      unresolved: sourcePaths.length > 0 ? [] : ['blockstate/model: no document recovered'],
    });
  }

  // ── Document-backed domains: each document becomes one IR object ─────────────────────────
  const molangSeen = new Set<string>();
  let molangCount = 0;
  const addMolang = (expression: string, sourcePath: string) => {
    const trimmed = expression.trim();
    if (!isMolangExpression(trimmed) || molangSeen.has(trimmed) || molangCount >= MAX_MOLANG_NODES) return;
    molangSeen.add(trimmed);
    molangCount += 1;
    add({
      id: `molang:${molangCount}`,
      domain: 'molang',
      sourceIds: [trimmed],
      sourcePaths: [sourcePath],
      values: { expression: trimmed },
      references: [],
      confidence: 0.85,
      evidence: [`source expression read from ${sourcePath}`],
      provenance: 'SOURCE',
      transforms: [{ stage: 'analysis', action: 'expression-extracted', detail: 'kept verbatim for translation', provenance: 'SOURCE' }],
      unresolved: [],
    });
  };

  for (const document of documents) {
    if (document.domain === 'model') {
      const json = readDocument(document.path);
      const parent = typeof json?.parent === 'string' ? json.parent : '';
      const textureSlots = isRecord(json?.textures) ? Object.keys(json.textures as Record<string, unknown>) : [];
      const elements = Array.isArray(json?.elements) ? json.elements.length : 0;
      add({
        id: `model:${document.namespace || 'unknown'}:${document.logicalId}`,
        domain: 'model',
        sourceIds: [document.logicalId],
        sourcePaths: [document.path],
        values: { parent, textureSlots, elements },
        references: parent
          ? [{ target: parent, domain: 'model', status: 'unresolved', evidence: `parent declared in ${document.path}` }]
          : [],
        confidence: json ? 0.9 : 0.4,
        evidence: [json
          ? `model JSON parsed: ${elements} element(s), ${textureSlots.length} texture slot(s)`
          : 'model document could not be parsed — reported, nothing inferred'],
        provenance: json ? 'SOURCE' : 'ABSENT',
        transforms: [],
        unresolved: json ? [] : ['document: unreadable JSON'],
      });
      continue;
    }

    if (document.domain === 'texture') {
      add({
        id: `texture:${document.namespace || 'unknown'}:${document.logicalId}`,
        domain: 'texture',
        sourceIds: [document.logicalId],
        sourcePaths: [document.path],
        values: { bytes: document.bytes },
        references: [],
        confidence: 0.95,
        evidence: [`image payload present (${document.bytes} bytes)`],
        provenance: 'SOURCE',
        transforms: [],
        unresolved: [],
      });
      continue;
    }

    if (document.domain === 'animation' || document.domain === 'animation-controller') {
      const json = readDocument(document.path);
      const clips = isRecord(json?.animations) ? Object.keys(json.animations as Record<string, unknown>) : [];
      if (json) {
        walkJsonStrings(json, (text) => addMolang(text, document.path));
      }
      add({
        id: `${document.domain}:${document.namespace || 'unknown'}:${document.logicalId}`,
        domain: document.domain,
        sourceIds: [document.logicalId],
        sourcePaths: [document.path],
        values: { clips, clipCount: clips.length },
        references: [],
        confidence: json ? 0.9 : 0.4,
        evidence: [json
          ? `animation document parsed: ${clips.length} clip(s)`
          : 'animation document could not be parsed — reported, nothing inferred'],
        provenance: json ? 'SOURCE' : 'ABSENT',
        transforms: [],
        unresolved: json ? [] : ['document: unreadable JSON'],
      });
      continue;
    }

    if (document.domain === 'particle') {
      const json = readDocument(document.path);
      if (json) walkJsonStrings(json, (text) => addMolang(text, document.path));
      add({
        id: `particle:${document.namespace || 'unknown'}:${document.logicalId}`,
        domain: 'particle',
        sourceIds: [document.logicalId],
        sourcePaths: [document.path],
        values: { parsed: Boolean(json) },
        references: [],
        confidence: json ? 0.85 : 0.3,
        evidence: [json ? 'particle document parsed' : 'particle document could not be parsed'],
        provenance: json ? 'SOURCE' : 'ABSENT',
        transforms: [],
        unresolved: json ? [] : ['document: unreadable JSON'],
      });
      continue;
    }

    if (document.domain === 'sound') {
      add({
        id: `sound:${document.namespace || 'unknown'}:${document.logicalId}`,
        domain: 'sound',
        sourceIds: [document.logicalId],
        sourcePaths: [document.path],
        values: { bytes: document.bytes, eventOrAsset: document.format === 'json' ? 'definition' : 'asset' },
        references: [],
        confidence: 0.85,
        evidence: ['audio payload or sound definition present in the archive'],
        provenance: 'SOURCE',
        transforms: [],
        unresolved: [],
      });
      continue;
    }

    if (document.domain === 'recipe') {
      const json = readDocument(document.path);
      const recipeType = typeof json?.type === 'string' ? json.type : '';
      const references: IRReference[] = [];
      if (json) {
        walkJsonStrings(json, (text) => {
          const value = text.trim();
          if (!value.includes(':') || value.length > 96) return;
          if (references.length >= 12) return;
          if (references.some((entry) => entry.target === value)) return;
          references.push({ target: value, domain: 'item', status: 'unresolved', evidence: `ingredient/result in ${document.path}` });
        });
      }
      add({
        id: `recipe:${document.namespace || 'unknown'}:${document.logicalId}`,
        domain: 'recipe',
        sourceIds: [document.logicalId],
        sourcePaths: [document.path],
        values: { recipeType, parsed: Boolean(json) },
        references,
        confidence: json ? 0.9 : 0.3,
        evidence: [json ? `recipe document parsed (${recipeType || 'type not declared'})` : 'recipe document could not be parsed'],
        provenance: json ? 'SOURCE' : 'ABSENT',
        transforms: [],
        unresolved: json ? [] : ['document: unreadable JSON'],
      });
      continue;
    }

    if (document.domain === 'loot') {
      const json = readDocument(document.path);
      const pools = Array.isArray(json?.pools) ? json.pools.length : 0;
      add({
        id: `loot:${document.namespace || 'unknown'}:${document.logicalId}`,
        domain: 'loot',
        sourceIds: [document.logicalId],
        sourcePaths: [document.path],
        values: { pools },
        references: [],
        confidence: json ? 0.9 : 0.3,
        evidence: [json ? `loot document parsed: ${pools} pool(s)` : 'loot document could not be parsed'],
        provenance: json ? 'SOURCE' : 'ABSENT',
        transforms: [],
        unresolved: json ? [] : ['document: unreadable JSON'],
      });
      continue;
    }

    if (document.domain === 'worldgen') {
      const segments = document.path.toLowerCase().split('/');
      const kindIndex = segments.findIndex((segment) => segment === 'worldgen');
      const kind = kindIndex >= 0 && segments[kindIndex + 1] ? segments[kindIndex + 1] : 'other';
      add({
        id: `worldgen:${document.namespace || 'unknown'}:${kind}:${document.logicalId}`,
        domain: 'worldgen',
        sourceIds: [document.logicalId],
        sourcePaths: [document.path],
        values: { kind, format: document.format },
        references: [],
        confidence: 0.85,
        evidence: [`world-generation document of kind "${kind}"`],
        provenance: 'SOURCE',
        transforms: [],
        unresolved: [],
      });
      continue;
    }

    if (document.domain === 'localization') {
      const entry = entryByPath.get(document.path.toLowerCase());
      let keys = 0;
      if (entry?.data && entry.data.length > 0) {
        const text = decoder.decode(entry.data);
        keys = text.split(/\r?\n/).filter((line) => /^[^#=]+=/.test(line.trim())).length;
      }
      add({
        id: `localization:${document.namespace || 'unknown'}:${document.logicalId}`,
        domain: 'localization',
        sourceIds: [document.logicalId],
        sourcePaths: [document.path],
        values: { keys },
        references: [],
        confidence: 0.9,
        evidence: [`language file carries ${keys} key(s)`],
        provenance: 'SOURCE',
        transforms: [],
        unresolved: [],
      });
      continue;
    }

    if (document.domain === 'tag') {
      const json = readDocument(document.path);
      const values = Array.isArray(json?.values) ? json.values.length : 0;
      add({
        id: `tag:${document.namespace || 'unknown'}:${document.logicalId}`,
        domain: 'tag',
        sourceIds: [document.logicalId],
        sourcePaths: [document.path],
        values: { members: values },
        references: [],
        confidence: json ? 0.85 : 0.3,
        evidence: [json ? `tag document parsed: ${values} member(s)` : 'tag document could not be parsed'],
        provenance: json ? 'SOURCE' : 'ABSENT',
        transforms: [],
        unresolved: json ? [] : ['document: unreadable JSON'],
      });
    }
  }

  // ── Behaviour evidence: classes that declare interaction/registry signals ─────────────────
  for (const summary of (stats?.classes ?? []).slice(0, MAX_CLASS_NODES)) {
    if (summary.role !== 'entity' && summary.role !== 'utility' && summary.role !== 'animation') continue;
    const signals = summary.signals ?? [];
    add({
      id: `behavior:${safeFileId(summary.className) || summary.className}`,
      domain: signals.length > 0 ? 'behavior' : 'interaction',
      sourceIds: [...(summary.registryIds ?? []), summary.className],
      sourcePaths: [],
      values: { superName: summary.superName ?? '', methods: summary.methods.length, signals },
      references: [],
      confidence: signals.length > 0 ? 0.8 : 0.5,
      evidence: signals.length > 0
        ? [`bytecode: ${signals.length} behaviour signal(s) recovered from ${summary.className}`]
        : [`bytecode: ${summary.className} declares no behaviour signal`],
      provenance: signals.length > 0 ? 'SOURCE' : 'ABSENT',
      transforms: [],
      unresolved: signals.length > 0 ? [] : ['behaviour: no logic recovered from the class'],
    });
  }

  for (const dependency of stats?.dependencies ?? []) {
    add({
      id: `dependency:${safeFileId(dependency) || dependency}`,
      domain: 'dependency',
      sourceIds: [dependency],
      sourcePaths: [],
      values: { declared: true },
      references: [],
      confidence: 0.9,
      evidence: ['metadata: declared mod dependency'],
      provenance: 'SOURCE',
      transforms: [],
      unresolved: [],
    });
  }

  // ── Reference resolution against the archive the IR was built from ───────────────────────
  const namespaces = new Set(discovery.namespaces);
  const stems = new Set<string>();
  for (const document of documents) {
    if (document.logicalId) stems.add(document.logicalId.toLowerCase());
  }
  for (const node of nodes) {
    for (const sourceId of node.sourceIds) {
      const key = safeFileId(sourceId);
      if (key) stems.add(key);
    }
  }

  const resolve = (value: string): IRReferenceStatus => {
    const raw = value.trim().replace(/^#/, '').toLowerCase();
    if (!raw) return 'unresolved';
    if (raw.includes(':')) {
      const [namespace, ...rest] = raw.split(':');
      const path = rest.join(':');
      if (namespace === 'minecraft') return 'external';
      const tail = path.split('/').pop() ?? path;
      if (stems.has(path) || stems.has(tail)) return 'resolved';
      return namespaces.has(namespace) ? 'unresolved' : 'external';
    }
    const tail = raw.split('/').pop() ?? raw;
    return stems.has(raw) || stems.has(tail) ? 'resolved' : 'unresolved';
  };

  for (const node of nodes) {
    for (const reference of node.references) reference.status = resolve(reference.target);
  }

  let total = 0;
  let resolved = 0;
  let external = 0;
  let unresolved = 0;
  const samples: IRReference[] = [];
  for (const raw of discovery.references) {
    total += 1;
    const status = resolve(raw.value);
    if (status === 'resolved') resolved += 1;
    else if (status === 'external') external += 1;
    else {
      unresolved += 1;
      if (samples.length < MAX_REFERENCE_SAMPLES) {
        samples.push({
          target: raw.value,
          domain: raw.fromDomain,
          status,
          evidence: raw.fromPath,
        });
      }
    }
  }

  const confidence = { high: 0, medium: 0, low: 0, unknown: 0 };
  let transformationCount = 0;
  const unresolvedAspects: string[] = [];
  for (const node of nodes) {
    if (node.confidence >= 0.8) confidence.high += 1;
    else if (node.confidence >= 0.5) confidence.medium += 1;
    else if (node.confidence > 0) confidence.low += 1;
    else confidence.unknown += 1;
    transformationCount += node.transforms.length;
    for (const aspect of node.unresolved) {
      if (unresolvedAspects.length >= MAX_UNRESOLVED_ASPECTS) break;
      const line = `${node.id} — ${aspect}`;
      if (!unresolvedAspects.includes(line)) unresolvedAspects.push(line);
    }
  }

  const domainCounts = Object.entries(counts)
    .map(([domain, count]) => ({ domain: domain as SourceDomain, count: count ?? 0 }))
    .sort((a, b) => b.count - a.count);

  const summary = `${nodeCount} intermediate object(s) built from ${documents.length} source document(s); ${resolved}/${total} declared reference(s) resolve inside the archive, ${external} point at vanilla/other packs, ${unresolved} are unresolved. Analysis only — a node existing never means a Bedrock file was generated.`;
  input.onLog?.(`[IR] ${summary}`);
  input.onLog?.(
    `[IR] Domains: ${domainCounts.map((entry) => `${entry.domain} ${entry.count}`).join(' | ') || 'none'}`,
  );
  input.onLog?.(
    `[IR] Confidence: ${confidence.high} high, ${confidence.medium} medium, ${confidence.low} low, ${confidence.unknown} unresolved; ${unresolvedAspects.length} unresolved aspect(s) reported.`,
  );

  return {
    modId: input.modId,
    nodes,
    nodeCount,
    counts,
    domainCounts,
    references: { total, resolved, external, unresolved, samples },
    confidence,
    itemClassifications,
    transformationCount,
    unresolvedAspects,
    reportingCapped: nodeCount > nodes.length,
    summary,
  };
}