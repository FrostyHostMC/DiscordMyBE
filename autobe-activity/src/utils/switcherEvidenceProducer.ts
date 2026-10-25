import JSZip from 'jszip';
import type { AddonPack } from '@/types/modpack';

export type ProducerConfidence = 'proven' | 'possible' | 'unknown';
export type ProducerChannel = 'position' | 'rotation' | 'scale' | 'unknown';
export type ProducerBlockerCode =
  | 'unresolved_reference'
  | 'source_proof_missing'
  | 'source_proof_malformed'
  | 'overlap_window_unproven'
  | 'channel_unproven'
  | 'scope_unknown'
  | 'analysis_incomplete'
  | 'other';

export interface ProducerSourceProof {
  packId: string;
  packName: string;
  filePath: string;
  reference: string;
  claim: string;
}

export interface ResolvedAnimationReference {
  packId: string;
  packName: string;
  sourceFile: string;
  sourceReference: string;
  reference: string;
  resolvedId: string | null;
  kind: 'animation' | 'controller';
  scope: 'player' | 'mob' | 'unknown';
  confidence: ProducerConfidence;
  blockerCodes: ProducerBlockerCode[];
}

export interface ChannelFact {
  packId: string;
  packName: string;
  filePath: string;
  animationId: string;
  bone: string;
  channel: Exclude<ProducerChannel, 'unknown'>;
  /** Sorted authored keyframe times when statically recoverable; not proof of runtime activation. */
  authoredTimes: string[];
  sourceReference: string;
  scope: 'player' | 'mob' | 'unknown';
}

export interface ProducerEvidenceRecord {
  confidence: ProducerConfidence;
  sourceProof: ProducerSourceProof;
  blockerCodes: ProducerBlockerCode[];
  bone: string | null;
  channel: ProducerChannel;
  animationIds: string[];
  controllerIds: string[];
  packIds: string[];
  /** Static trace only. It deliberately does not claim concurrent runtime activation. */
  overlapEvidence: string;
  proposedOwner: string | null;
  scope: 'player' | 'mob' | 'unknown';
}

export interface SwitcherEvidenceProduction {
  analysisComplete: boolean;
  /** Pass 1 output, sorted and deterministic. */
  references: ResolvedAnimationReference[];
  /** Pass 2 output, sorted and deterministic. */
  channelFacts: ChannelFact[];
  evidence: ProducerEvidenceRecord[];
  diagnostics: string[];
}

interface ParsedJsonFile {
  pack: AddonPack;
  path: string;
  value: any;
}

interface PassOneResult {
  files: ParsedJsonFile[];
  references: ResolvedAnimationReference[];
  channelFacts: ChannelFact[];
  evidence: ProducerEvidenceRecord[];
  diagnostics: string[];
  complete: boolean;
}

const channelNames = ['position', 'rotation', 'scale'] as const;
const relevantPath = (path: string) => {
  const lower = path.toLowerCase();
  return lower.endsWith('.json') && (
    lower.includes('animation') || lower.includes('entities/') ||
    lower.includes('entity/') || lower.includes('geometry') || lower.endsWith('manifest.json')
  );
};
const sortStrings = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
const sortProof = (proof: ProducerSourceProof) =>
  [proof.packId, proof.filePath, proof.reference, proof.claim].join('|');
const sortEvidence = (a: ProducerEvidenceRecord, b: ProducerEvidenceRecord) =>
  [a.confidence, a.packIds.join(','), a.bone ?? '', a.channel, a.animationIds.join(','), sortProof(a.sourceProof)]
    .join('|').localeCompare(
      [b.confidence, b.packIds.join(','), b.bone ?? '', b.channel, b.animationIds.join(','), sortProof(b.sourceProof)].join('|'),
    );

function makeEvidence(args: {
  confidence: ProducerConfidence;
  proof: ProducerSourceProof;
  blockerCodes: ProducerBlockerCode[];
  bone?: string | null;
  channel?: ProducerChannel;
  animationIds?: string[];
  controllerIds?: string[];
  packIds?: string[];
  detail: string;
  scope?: 'player' | 'mob' | 'unknown';
}): ProducerEvidenceRecord {
  return {
    confidence: args.confidence,
    sourceProof: args.proof,
    blockerCodes: sortStrings(args.blockerCodes) as ProducerBlockerCode[],
    bone: args.bone ?? null,
    channel: args.channel ?? 'unknown',
    animationIds: sortStrings(args.animationIds ?? []),
    controllerIds: sortStrings(args.controllerIds ?? []),
    packIds: sortStrings(args.packIds ?? [args.proof.packId]),
    overlapEvidence: args.detail,
    proposedOwner: null,
    scope: args.scope ?? 'unknown',
  };
}

function proof(pack: AddonPack, filePath: string, reference: string, claim: string): ProducerSourceProof {
  return { packId: pack.id, packName: pack.name, filePath, reference, claim };
}

function collectAuthoredTimes(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const times: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (/^(?:\d+(?:\.\d+)?|0\.[0-9]+)$/.test(key)) times.push(key);
      visit(child);
    }
  };
  visit(value);
  return sortStrings(times);
}

function scopeForIdentifier(identifier: unknown): 'player' | 'mob' | 'unknown' {
  if (typeof identifier !== 'string' || !identifier.includes(':')) return 'unknown';
  return identifier === 'minecraft:player' ? 'player' : 'mob';
}

function readAnimationDefinitions(file: ParsedJsonFile): Array<{ id: string; definition: any }> {
  const root = file.value?.animations;
  if (!root || typeof root !== 'object' || Array.isArray(root)) return [];
  return Object.entries(root).map(([id, definition]) => ({ id, definition }));
}

function readControllerDefinitions(file: ParsedJsonFile): Array<{ id: string; definition: any }> {
  const root = file.value?.animation_controllers;
  if (!root || typeof root !== 'object' || Array.isArray(root)) return [];
  return Object.entries(root).map(([id, definition]) => ({ id, definition }));
}

/**
 * PASS 1: enumerate and parse every relevant file, collect all definitions and aliases,
 * then resolve references only after the full pack inventory has been collected.
 * This pass never performs overlap detection.
 */
export async function resolveSwitcherReferences(packs: readonly AddonPack[]): Promise<{
  references: ResolvedAnimationReference[];
  channelFacts: ChannelFact[];
  evidence: ProducerEvidenceRecord[];
  diagnostics: string[];
  analysisComplete: boolean;
  /** Internal-neutral parsed inventory is returned for Pass 2 and tests. */
  parsedFiles: Array<{ packId: string; packName: string; path: string; value: unknown }>;
}> {
  const orderedPacks = [...packs].sort((a, b) => a.id.localeCompare(b.id) || a.name.localeCompare(b.name));
  const files: ParsedJsonFile[] = [];
  const evidence: ProducerEvidenceRecord[] = [];
  const diagnostics: string[] = [];
  let analysisComplete = true;

  for (const pack of orderedPacks) {
    if (!pack.fileBlob) {
      analysisComplete = false;
      diagnostics.push(`Pack ${pack.id} (${pack.name}) has no readable archive blob.`);
      evidence.push(makeEvidence({
        confidence: 'unknown', proof: proof(pack, '(archive)', 'fileBlob', 'The archive bytes were unavailable, so relevant files could not be enumerated.'),
        blockerCodes: ['analysis_incomplete', 'source_proof_missing'], detail: 'Archive enumeration failed; absence of conflicts cannot be inferred.',
      }));
      continue;
    }
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(pack.fileBlob);
    } catch {
      analysisComplete = false;
      diagnostics.push(`Pack ${pack.id} (${pack.name}) could not be opened as a ZIP archive.`);
      evidence.push(makeEvidence({
        confidence: 'unknown', proof: proof(pack, '(archive)', 'JSZip.loadAsync', 'The archive could not be enumerated.'),
        blockerCodes: ['analysis_incomplete', 'source_proof_malformed'], detail: 'Archive parsing failed; no negative finding is safe.',
      }));
      continue;
    }
    const entries = Object.entries(zip.files)
      .filter(([path, entry]) => !entry.dir && relevantPath(path))
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [path, entry] of entries) {
      try {
        const value = JSON.parse(await entry.async('text'));
        files.push({ pack, path: path.replace(/\\/g, '/'), value });
      } catch {
        analysisComplete = false;
        diagnostics.push(`Malformed relevant JSON: ${pack.id}:${path}`);
        evidence.push(makeEvidence({
          confidence: 'unknown',
          proof: proof(pack, path, '$', 'Relevant JSON failed to parse; its definitions and references are unknown.'),
          blockerCodes: ['analysis_incomplete', 'source_proof_malformed'],
          detail: 'Malformed input is an explicit unknown record, never an empty/no-conflict result.',
        }));
      }
    }
  }

  const animationDefinitions = new Map<string, Array<{ file: ParsedJsonFile; definition: any }>>();
  const controllerDefinitions = new Map<string, Array<{ file: ParsedJsonFile; definition: any }>>();
  const animationAliases = new Map<string, Array<{ target: string; file: ParsedJsonFile; scope: 'player' | 'mob' | 'unknown'; alias: string }>>();
  const controllerAliases = new Map<string, Array<{ target: string; file: ParsedJsonFile; scope: 'player' | 'mob' | 'unknown'; alias: string }>>();
  const controllerScopes = new Map<string, Set<'player' | 'mob' | 'unknown'>>();

  for (const file of files) {
    for (const { id, definition } of readAnimationDefinitions(file)) {
      const key = `${file.pack.id}|${id}`;
      const list = animationDefinitions.get(key) ?? [];
      list.push({ file, definition });
      animationDefinitions.set(key, list);
    }
    for (const { id, definition } of readControllerDefinitions(file)) {
      const key = `${file.pack.id}|${id}`;
      const list = controllerDefinitions.get(key) ?? [];
      list.push({ file, definition });
      controllerDefinitions.set(key, list);
    }
    const entities = file.value?.['minecraft:entity'] ? [file.value['minecraft:entity']] : [];
    for (const entity of entities) {
      const scope = scopeForIdentifier(entity?.description?.identifier);
      const rememberControllerScope = (controllerId: string) => {
        const key = `${file.pack.id}|${controllerId}`;
        const scopes = controllerScopes.get(key) ?? new Set<'player' | 'mob' | 'unknown'>();
        scopes.add(scope);
        controllerScopes.set(key, scopes);
      };
      for (const [alias, target] of Object.entries(entity?.description?.animations ?? {})) {
        if (typeof target !== 'string') continue;
        const list = animationAliases.get(`${file.pack.id}|${alias}`) ?? [];
        list.push({ target, file, scope, alias });
        animationAliases.set(`${file.pack.id}|${alias}`, list);
      }
      for (const [alias, target] of Object.entries(entity?.description?.animation_controllers ?? {})) {
        if (typeof target !== 'string') continue;
        const list = controllerAliases.get(`${file.pack.id}|${alias}`) ?? [];
        list.push({ target, file, scope, alias });
        controllerAliases.set(`${file.pack.id}|${alias}`, list);
        rememberControllerScope(target);
        rememberControllerScope(alias);
      }
      for (const item of entity?.description?.scripts?.animate ?? []) {
        const aliases = typeof item === 'string' ? [item] : item && typeof item === 'object' ? Object.keys(item) : [];
        for (const alias of aliases) {
          const target = animationAliases.get(`${file.pack.id}|${alias}`)?.[0]?.target;
          if (typeof target === 'string') continue;
          // Defer the actual resolution receipt until all aliases have been collected.
        }
      }
    }
  }

  const references: ResolvedAnimationReference[] = [];
  const addReference = (
    file: ParsedJsonFile, sourceReference: string, reference: string, kind: 'animation' | 'controller',
    aliases: Map<string, Array<{ target: string; file: ParsedJsonFile; scope: 'player' | 'mob' | 'unknown'; alias: string }>>,
    definitions: Map<string, Array<{ file: ParsedJsonFile; definition: any }>>,
    scope: 'player' | 'mob' | 'unknown',
  ) => {
    const aliasHits = aliases.get(`${file.pack.id}|${reference}`) ?? [];
    const uniqueTargets = sortStrings(aliasHits.map((hit) => hit.target));
    const resolvedId = uniqueTargets.length === 1 ? uniqueTargets[0] : reference;
    const hasDefinition = (definitions.get(`${file.pack.id}|${resolvedId}`) ?? []).length > 0;
    const ambiguous = uniqueTargets.length > 1;
    const found = hasDefinition && !ambiguous;
    const confidence: ProducerConfidence = found && scope !== 'unknown' ? 'possible' : 'unknown';
    const blockerCodes: ProducerBlockerCode[] = [];
    if (!found) blockerCodes.push('unresolved_reference');
    if (scope === 'unknown') blockerCodes.push('scope_unknown');
    references.push({
      packId: file.pack.id, packName: file.pack.name, sourceFile: file.path, sourceReference,
      reference, resolvedId: found ? resolvedId : null, kind, scope, confidence,
      blockerCodes: sortStrings(blockerCodes) as ProducerBlockerCode[],
    });
    if (!found) evidence.push(makeEvidence({
      confidence: 'unknown', proof: proof(file.pack, file.path, sourceReference, ambiguous
        ? `Reference ${reference} maps to multiple targets: ${uniqueTargets.join(', ')}.`
        : `Reference ${reference} could not be resolved to exactly one local ${kind} definition.`),
      blockerCodes: ['unresolved_reference'], animationIds: kind === 'animation' ? [reference] : [],
      controllerIds: kind === 'controller' ? [reference] : [], detail: ambiguous
        ? 'Alias ambiguity prevents a trustworthy overlap claim.'
        : 'Unresolved reference is retained as explicit unknown evidence.',
      scope,
    }));
  };

  // Resolve controller references in every controller state after the complete inventory exists.
  for (const file of files) {
    for (const { id, definition } of readControllerDefinitions(file)) {
      const controllerScopeSet = controllerScopes.get(`${file.pack.id}|${id}`) ?? new Set<'player' | 'mob' | 'unknown'>();
      const controllerScopesSorted = sortStrings(controllerScopeSet);
      const scope: 'player' | 'mob' | 'unknown' = controllerScopesSorted.length === 1 && controllerScopesSorted[0] !== 'unknown'
        ? controllerScopesSorted[0] as 'player' | 'mob'
        : 'unknown';
      const states = definition?.states && typeof definition.states === 'object' ? Object.entries(definition.states) : [];
      for (const [stateName, state] of states) {
        const animationList = Array.isArray((state as any)?.animations) ? (state as any).animations : [];
        for (let index = 0; index < animationList.length; index++) {
          const item = animationList[index];
          const refs = typeof item === 'string' ? [item] : item && typeof item === 'object' ? Object.keys(item) : [];
          for (const reference of refs) addReference(file, `animation_controllers.${id}.states.${stateName}.animations[${index}]`, reference, 'animation', animationAliases, animationDefinitions, scope);
        }
      }
    }
    const entities = file.value?.['minecraft:entity'] ? [file.value['minecraft:entity']] : [];
    for (const entity of entities) {
      const description = entity?.description ?? {};
      const scope = scopeForIdentifier(description.identifier);
      for (const [alias, target] of Object.entries(description.animations ?? {})) {
        if (typeof target === 'string') addReference(file, `minecraft:entity.description.animations.${alias}`, alias, 'animation', animationAliases, animationDefinitions, scope);
      }
      for (const [alias, target] of Object.entries(description.animation_controllers ?? {})) {
        if (typeof target === 'string') addReference(file, `minecraft:entity.description.animation_controllers.${alias}`, alias, 'controller', controllerAliases, controllerDefinitions, scope);
      }
      for (let index = 0; index < (description.scripts?.animate ?? []).length; index++) {
        const item = description.scripts.animate[index];
        const refs = typeof item === 'string' ? [item] : item && typeof item === 'object' ? Object.keys(item) : [];
        for (const reference of refs) {
          if (controllerAliases.has(`${file.pack.id}|${reference}`)) {
            addReference(file, `minecraft:entity.description.scripts.animate[${index}]`, reference, 'controller', controllerAliases, controllerDefinitions, scope);
          } else {
            addReference(file, `minecraft:entity.description.scripts.animate[${index}]`, reference, 'animation', animationAliases, animationDefinitions, scope);
          }
        }
      }
    }
  }

  const channelFacts: ChannelFact[] = [];
  for (const file of files) {
    for (const { id, definition } of readAnimationDefinitions(file)) {
      const bones = definition?.bones;
      if (!bones || typeof bones !== 'object' || Array.isArray(bones)) continue;
      const animationScopes = sortStrings(references
        .filter((reference) => reference.kind === 'animation' && reference.packId === file.pack.id && reference.resolvedId === id)
        .map((reference) => reference.scope));
      const scope: 'player' | 'mob' | 'unknown' = animationScopes.length === 1 && animationScopes[0] !== 'unknown'
        ? animationScopes[0] as 'player' | 'mob'
        : 'unknown';
      for (const [bone, boneDef] of Object.entries(bones)) {
        for (const channel of channelNames) {
          if (!(boneDef as any)?.[channel]) continue;
          channelFacts.push({
            packId: file.pack.id, packName: file.pack.name, filePath: file.path,
            animationId: id, bone, channel,
            authoredTimes: collectAuthoredTimes((boneDef as any)[channel]),
            sourceReference: `animations.${id}.bones.${bone}.${channel}`, scope,
          });
        }
      }
    }
  }

  references.sort((a, b) => [a.packId, a.sourceFile, a.sourceReference, a.reference, a.kind].join('|')
    .localeCompare([b.packId, b.sourceFile, b.sourceReference, b.reference, b.kind].join('|')));
  channelFacts.sort((a, b) => [a.packId, a.filePath, a.animationId, a.bone, a.channel].join('|')
    .localeCompare([b.packId, b.filePath, b.animationId, b.bone, b.channel].join('|')));
  evidence.sort(sortEvidence);
  diagnostics.sort();
  return {
    references, channelFacts, evidence, diagnostics, analysisComplete,
    parsedFiles: files.map(({ pack, path, value }) => ({ packId: pack.id, packName: pack.name, path, value })),
  };
}

/**
 * PASS 2: consume only the completed Pass 1 inventory. Any unresolved/ambiguous
 * reference or parse failure makes related evidence non-proven. This conservative
 * producer never emits 'proven': static channel presence does not establish that
 * Bedrock controllers activate concurrently in the same condition/time window.
 */
export function analyzeSwitcherOverlaps(passOne: Awaited<ReturnType<typeof resolveSwitcherReferences>>): ProducerEvidenceRecord[] {
  const evidence = [...passOne.evidence];
  const facts = passOne.channelFacts;
  const byPackAndAnimation = new Map<string, ResolvedAnimationReference[]>();
  for (const reference of passOne.references) {
    if (reference.kind !== 'animation') continue;
    const key = `${reference.packId}|${reference.resolvedId ?? reference.reference}`;
    const list = byPackAndAnimation.get(key) ?? [];
    list.push(reference);
    byPackAndAnimation.set(key, list);
  }

  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const a = facts[i], b = facts[j];
      if (a.packId === b.packId || a.bone !== b.bone || a.channel !== b.channel) continue;
      const aRefs = byPackAndAnimation.get(`${a.packId}|${a.animationId}`) ?? [];
      const bRefs = byPackAndAnimation.get(`${b.packId}|${b.animationId}`) ?? [];
      const unresolved = [...aRefs, ...bRefs].some((ref) => ref.confidence === 'unknown');
      const scope = a.scope === b.scope ? a.scope : 'unknown';
      const blockerCodes: ProducerBlockerCode[] = ['overlap_window_unproven'];
      if (unresolved) blockerCodes.push('unresolved_reference');
      if (scope === 'unknown') blockerCodes.push('scope_unknown');
      const recordProof = proof(
        { id: a.packId, name: a.packName } as AddonPack,
        a.filePath,
        a.sourceReference,
        `Pack ${a.packId} statically defines ${a.channel} on bone ${a.bone}; matching channel is in ${b.packId} at ${b.filePath} (${b.sourceReference}). Authored keyframes: [${a.authoredTimes.join(', ')}] vs [${b.authoredTimes.join(', ')}].`,
      );
      evidence.push(makeEvidence({
        confidence: unresolved || !passOne.analysisComplete || scope === 'unknown' ? 'unknown' : 'possible',
        proof: recordProof,
        blockerCodes: [...blockerCodes, ...(!passOne.analysisComplete ? ['analysis_incomplete' as const] : [])],
        bone: a.bone, channel: a.channel,
        animationIds: [a.animationId, b.animationId],
        controllerIds: sortStrings([
          ...passOne.references
            .filter((ref) => ref.kind === 'animation' && ref.packId === a.packId && ref.resolvedId === a.animationId)
            .map((ref) => ref.sourceReference.match(/^animation_controllers\.(.+?)\.states\./)?.[1])
            .filter((id): id is string => Boolean(id)),
          ...passOne.references
            .filter((ref) => ref.kind === 'animation' && ref.packId === b.packId && ref.resolvedId === b.animationId)
            .map((ref) => ref.sourceReference.match(/^animation_controllers\.(.+?)\.states\./)?.[1])
            .filter((id): id is string => Boolean(id)),
        ]),
        packIds: [a.packId, b.packId],
        detail: 'Possible static channel overlap only. Runtime activation/condition intersection is not proven; this record cannot unlock Switcher.',
        scope,
      }));
    }
  }
  evidence.sort(sortEvidence);
  return evidence;
}

/** Run Pass 1 to completion before starting Pass 2. Read-only: no archive writes. */
export async function produceSwitcherEvidence(packs: readonly AddonPack[]): Promise<SwitcherEvidenceProduction> {
  const passOne = await resolveSwitcherReferences(packs);
  const passTwoEvidence = analyzeSwitcherOverlaps(passOne);
  return {
    analysisComplete: passOne.analysisComplete,
    references: passOne.references,
    channelFacts: passOne.channelFacts,
    evidence: passTwoEvidence,
    diagnostics: passOne.diagnostics,
  };
}
