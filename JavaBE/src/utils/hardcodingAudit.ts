import type {
  HardcodingAuditReport,
  HardcodingFinding,
  HardcodingFindingStatus,
  ProvenanceEntry,
  RemakeItem,
} from '@/types/remaker';
import { isPlayableModeEnabled } from '@/utils/provenance';

type PackFiles = Record<string, string | Uint8Array>;

const textOf = (value: string | Uint8Array | undefined): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return '';
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const parseJson = (value: string | Uint8Array | undefined): Record<string, unknown> | null => {
  const text = textOf(value);
  if (!text) return null;
  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
};

export interface HardcodingAuditInput {
  resourcePackFiles: PackFiles;
  behaviorPackFiles: PackFiles;
  items: RemakeItem[];
  provenanceEntries?: ProvenanceEntry[];
  /** Particle ids that exist as real files in the imported archive (evidence source). */
  sourceParticleIds?: string[];
  onLog?: (line: string) => void;
}

const finding = (
  id: string,
  label: string,
  scope: string,
  previousPattern: string,
  replacedBy: string,
  occurrences: number,
  status: HardcodingFindingStatus,
  evidence: string,
): HardcodingFinding => ({ id, label, scope, previousPattern, replacedBy, occurrences, status, evidence });

const gate = (occurrences: number, playableMode: boolean): HardcodingFindingStatus =>
  occurrences === 0 ? 'removed' : playableMode ? 'gated' : 'unresolved';

/**
 * Hardcoding audit.
 *
 * Runs against the pack that is actually being exported, not against a checklist:
 * every finding is scored from the files that ship. Content that appears identically
 * across unrelated mods (fixed stats, fixed clip sets, keyword-chosen effects) is
 * either removed, or gated as INVENTED behind playable mode — never presented as
 * evidence-backed conversion.
 */
export function buildHardcodingAudit(input: HardcodingAuditInput): HardcodingAuditReport {
  const playableMode = isPlayableModeEnabled();
  const { resourcePackFiles, behaviorPackFiles, items } = input;
  const provenanceEntries = input.provenanceEntries ?? [];
  const invented = provenanceEntries.filter((entry) => entry.provenance === 'INVENTED');
  const statusOf = gate;
  const findings: HardcodingFinding[] = [];
  // Per-mob AI provenance, resolved once: it decides whether a shared stat signature is a
  // fabricated profile or an honest fallback to documented defaults.
  const aiProvenance = new Map<string, string>(
    provenanceEntries
      .filter((entry) => entry.kind === 'ai')
      .map((entry) => [entry.target, entry.provenance] as [string, string]),
  );

  // 1. One fixed stat profile written onto unrelated mobs.
  const statSignatures = new Map<string, string[]>();
  for (const path of Object.keys(behaviorPackFiles).filter((key) => key.startsWith('entities/') && key.endsWith('.json'))) {
    const components = asObject(asObject(parseJson(behaviorPackFiles[path])?.['minecraft:entity']).components);
    const box = asObject(components['minecraft:collision_box']);
    const signature = JSON.stringify([
      asObject(components['minecraft:health']).value ?? null,
      asObject(components['minecraft:movement']).value ?? null,
      box.width ?? null,
      box.height ?? null,
    ]);
    const mobId = path.replace(/^entities\//, '').replace(/\.json$/, '');
    statSignatures.set(signature, [...(statSignatures.get(signature) ?? []), mobId]);
  }
  // A shared signature only proves a fabricated profile when at least one member had
  // attribute evidence available. Mobs with no evidence fall back to the documented Bedrock
  // defaults, which is reported per mob (BIND log) instead of being called a hardcoded
  // profile applied indiscriminately.
  const evidenceBacked = (mobId: string): boolean => {
    const value = aiProvenance.get(mobId);
    return value === 'SOURCE' || value === 'ADAPTED';
  };
  const sharedStatGroups = [...statSignatures.entries()]
    .filter(([, mobs]) => mobs.length >= 2 && mobs.some(evidenceBacked));
  const sharedStatMobs = sharedStatGroups.reduce((total, [, mobs]) => total + mobs.length, 0);
  findings.push(
    finding(
      'fixed-entity-stat-profile',
      'One fixed health / speed / hitbox profile applied to unrelated mobs',
      'entity components',
      'Every converted mob used the same 30-health, fixed-speed, 0.8x1.0 body regardless of its Java source.',
      'Each value is written only from the detected behaviour profile; a shared template body ships only in playable mode and is tagged INVENTED.',
      sharedStatMobs,
      sharedStatGroups.length === 0 ? 'removed' : statusOf(sharedStatMobs, playableMode),
      sharedStatGroups.length === 0
        ? 'No two shipped entities share one fixed stat signature.'
        : `${sharedStatGroups.length} shared signature group(s), e.g. ${sharedStatGroups[0][1].slice(0, 3).join(', ')}.`,
    ),
  );

  // 2. Template gait / attack / hurt / death clip sets.
  const inventedClips = invented.filter((entry) => entry.kind === 'animations').length;
  findings.push(
    finding(
      'template-animation-clip-sets',
      'Fixed five-clip animation set written for every mob',
      'animations',
      'A hardcoded gait / attack / hurt / death clip set was emitted for each entity.',
      'Only keyframes recovered from the mod ship; template clips require playable mode and are tagged INVENTED.',
      inventedClips,
      statusOf(inventedClips, playableMode),
      inventedClips === 0 ? 'No template clip set ships in this port.' : `${inventedClips} INVENTED animation component(s) shipped.`,
    ),
  );

  // 3. Effects chosen by matching item display names.
  const shippedParticleIds = Object.keys(resourcePackFiles)
    .filter((path) => path.startsWith('particles/') && path.endsWith('.json'))
    .map((path) => path.replace(/^particles\//, '').replace(/\.particle\.json$/, ''));
  const sourceParticleIds = input.sourceParticleIds;
  const derivedParticles = sourceParticleIds
    ? shippedParticleIds.filter((id) => !sourceParticleIds.includes(id))
    : [];
  findings.push(
    finding(
      'keyword-chosen-particles',
      'Particle effects selected by item-name keywords',
      'particles',
      'Particle ids were chosen by matching item names against a fixed keyword list (honey, pollen, stinger, crystal ...).',
      'Particles are ported only from particle assets found in the archive. No item-name keyword list remains in the porter; any playable-mode theme particle is namespaced and INVENTED.',
      derivedParticles.length,
      sourceParticleIds === undefined && shippedParticleIds.length > 0
        ? 'unresolved'
        : statusOf(derivedParticles.length, playableMode),
      sourceParticleIds === undefined
        ? 'Archive particle index unavailable, so shipped particles could not be traced to a source file.'
        : derivedParticles.length === 0
          ? `All ${shippedParticleIds.length} shipped particle file(s) resolve to an archived particle asset.`
          : `${derivedParticles.length} particle file(s) have no archived source: ${derivedParticles.slice(0, 5).join(', ')}.`,
    ),
  );

  // 4. Behaviour guessed from a name instead of from registration/class/data.
  const nameInferred = items.filter((item) => item.behaviorProfile?.confidence === 'name-inferred');
  findings.push(
    finding(
      'name-inferred-behaviour',
      'Item behaviour decided by display-name matching',
      'items',
      'Behaviours were assigned by checking whether the item name contained words such as sword or bow.',
      'Behaviour comes from the mod registration, class, model, tags, loot tables and use logic; class association uses the registered id, not the display name.',
      nameInferred.length,
      statusOf(nameInferred.length, playableMode),
      nameInferred.length === 0
        ? 'No item carries a name-inferred behaviour.'
        : `${nameInferred.slice(0, 5).map((item) => item.id).join(', ')} still rely on a name match.`,
    ),
  );

  // 5. Code-drawn skins standing in for rejected or missing art.
  const inventedSkins = invented.filter((entry) => entry.kind === 'texture');
  findings.push(
    finding(
      'code-drawn-skins',
      'Code-drawn skin substituted for missing or rejected art',
      'textures',
      'A generated pixel sheet was bound whenever the resolver failed, hiding the real state of the asset.',
      'Missing or rejected art is marked ABSENT/UNMATCHED; a code-drawn sheet ships only in playable mode and is tagged INVENTED.',
      inventedSkins.length,
      statusOf(inventedSkins.length, playableMode),
      inventedSkins.length === 0
        ? 'No generated skin ships; unresolved art stays ABSENT.'
        : `${inventedSkins.slice(0, 5).map((entry) => entry.target).join(', ')} use an INVENTED sheet.`,
    ),
  );

  // 6. Combat components without any source evidence.
  const unbackedCombat: string[] = [];
  for (const path of Object.keys(behaviorPackFiles).filter((key) => key.startsWith('entities/') && key.endsWith('.json'))) {
    const components = Object.keys(asObject(asObject(parseJson(behaviorPackFiles[path])?.['minecraft:entity']).components));
    const hasCombat = components.some((name) => /behavior\.(melee_attack|ranged_attack|nearest_attackable_target)|^minecraft:attack$|^minecraft:shooter$/.test(name));
    if (!hasCombat) continue;
    const mobId = path.replace(/^entities\//, '').replace(/\.json$/, '');
    const provenance = aiProvenance.get(mobId);
    if (provenance !== 'SOURCE' && provenance !== 'ADAPTED') unbackedCombat.push(mobId);
  }
  findings.push(
    finding(
      'unevidenced-combat-ai',
      'Melee / ranged attack components without mod evidence',
      'ai',
      'Every mob received a melee attack profile with a fixed damage and XP reward.',
      'Attack, damage, XP, targeting and faction components are written only when the mod code or data supplies evidence.',
      unbackedCombat.length,
      statusOf(unbackedCombat.length, playableMode),
      unbackedCombat.length === 0
        ? 'Every shipped combat component traces to detected mod evidence.'
        : `Combat components carried by ${unbackedCombat.slice(0, 5).join(', ')} without evidence.`,
    ),
  );

  // 7. Generic rigged anatomy where a real model was expected.
  const scaffoldModels = provenanceEntries.filter((entry) => entry.kind === 'model' && entry.provenance === 'SCAFFOLD').length;
  findings.push(
    finding(
      'generic-anatomy-rigs',
      'Generic rig used in place of an imported model',
      'models',
      'A fixed biped/quadruped rig was emitted even when the archive held no model.',
      'Recovered models are used verbatim; a rig is SCAFFOLD only when no model exists and is reported as such.',
      scaffoldModels,
      scaffoldModels === 0 ? 'removed' : 'gated',
      scaffoldModels === 0
        ? 'Every entity model traces to an imported geometry.'
        : `${scaffoldModels} entity model(s) are scaffold rigs with no imported geometry.`,
    ),
  );

  // 8. Product identity string (intentional, never mod content).
  const scriptText = textOf(behaviorPackFiles['scripts/main.js']);
  const brandingShips = scriptText.includes('Ported Using Stonebyte-JavaBE');
  findings.push(
    finding(
      'porter-branding-string',
      'Porter name written into the startup script',
      'scripts',
      'The generated startup message contains the porter product name.',
      'Kept on purpose: it identifies the tool, contains no mod-specific content, and is identical for every mod by design.',
      brandingShips ? 1 : 0,
      brandingShips ? 'retained' : 'removed',
      brandingShips ? 'Startup branding is product identity, not converted mod content.' : 'No branding string ships.',
    ),
  );

  const removedCount = findings.filter((item) => item.status === 'removed').length;
  const gatedCount = findings.filter((item) => item.status === 'gated').length;
  const retainedCount = findings.filter((item) => item.status === 'retained').length;
  const unresolvedCount = findings.filter((item) => item.status === 'unresolved').length;
  const summary = `${removedCount} removed, ${gatedCount} gated behind playable mode, ${retainedCount} retained as product identity, ${unresolvedCount} unresolved across ${findings.length} checked pattern(s)`;

  input.onLog?.('[HARDCODING-AUDIT] Per-conversion scan of generated content for mod-agnostic hardcoding:');
  for (const item of findings) {
    input.onLog?.(`[HARDCODING-AUDIT] ${item.status.toUpperCase()} — ${item.label} (${item.scope}, ${item.occurrences} occurrence(s)): ${item.evidence}`);
  }
  input.onLog?.(`[HARDCODING-AUDIT] Result: ${summary}.`);

  return {
    playableMode,
    findings,
    removedCount,
    gatedCount,
    retainedCount,
    unresolvedCount,
    summary,
  };
}