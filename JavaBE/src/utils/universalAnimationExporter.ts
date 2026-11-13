import type { UniversalAnimationIRReport } from '@/utils/universalAnimationIR';
import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import { emitAnimationClip } from '@/utils/animationIREmitter';
import { inferClipTrigger } from '@/utils/animationTriggerInference';
import { safeFileId } from '@/utils/bedrockIds';
import { buildPlayerClientEntity } from '@/utils/playerClientEntity';
import { resolvePlayerBone } from '@/utils/playerBoneAliases';

/**
 * Universal animation writer — definition, registration and activation in one pass.
 *
 * Discovery → interpretation describe every source clip an archive contains. A clip is only
 * playable when four separate things happen: its definition is written, a client entity
 * registers it, `scripts.animate` (or the shipped script) activates it, and the bones it moves
 * exist on the geometry that entity renders. Earlier stages cover the layouts they recognise;
 * anything the interpretation IR knows about and the pack does not carry is written here.
 *
 * The failure this pass exists to prevent is the silent one: a clip whose JSON shipped and whose
 * identifier nothing registers. A clip already present in the pack is therefore still registered
 * (and activated) when no entity owns it, and an owner that is demonstrably the player receives a
 * client entity built from the full vanilla base, because a pack that ships player clips without
 * that file plays nothing at all. An owner with no possible destination is reported with the exact
 * reason instead of being quietly dropped.
 *
 * Nothing mod-specific exists in this file.
 */

export interface UnregisteredClipFinding {
  clipId: string;
  owner: string;
  reason: string;
}

export interface UniversalAnimationExportReport {
  irClips: number;
  alreadyShipped: number;
  emittedClips: string[];
  animationFiles: string[];
  registeredClips: string[];
  activatedClips: string[];
  registeredOnEntities: string[];
  standaloneOwners: string[];
  /** Clips the pack defines but no client entity could own, with the reason. */
  unregisteredClips: UnregisteredClipFinding[];
  /**
   * Clips this pack DEFINES that no client entity registers. A definition nothing selects can never
   * play, so it is named here instead of being left to be discovered in game.
   */
  orphanedShippedClips: Array<{ clipId: string; path: string }>;
  /** Client entity documents generated so a clip set has a rendering owner. */
  clientEntitiesCreated: string[];
  scriptDrivenClips: string[];
  /** Behaviour-script half of activation (playback self-test), merged by the caller. */
  selfTestScript: string;
  skipped: Array<{ clipId: string; reason: string }>;
  approximated: string[];
  duplicateRegistrations: number;
  budgetExhausted: boolean;
  summary: string;
}

const MAX_EMITTED_CLIPS = 400;

interface ClientEntitySlot {
  path: string;
  identifier: string;
  doc: Record<string, any>;
  description: Record<string, any>;
  changed: boolean;
  created: boolean;
}

function reduced(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseJson(raw: string | Uint8Array | undefined): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

/** Every clip the pack already defines, with the bone channels it declares. */
function collectShippedClips(
  files: Record<string, string | Uint8Array>,
): Map<string, { bones: string[]; path: string; body: Record<string, unknown> }> {
  const clips = new Map<string, { bones: string[]; path: string; body: Record<string, unknown> }>();
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.animation.json')) continue;
    const doc = parseJson(files[path]);
    const animations = doc?.animations;
    if (!animations || typeof animations !== 'object') continue;
    for (const [clipId, body] of Object.entries(animations as Record<string, unknown>)) {
      const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const bones = record.bones && typeof record.bones === 'object'
        ? Object.keys(record.bones as Record<string, unknown>)
        : [];
      if (!clips.has(clipId)) clips.set(clipId, { bones, path, body: record });
    }
  }
  return clips;
}

function collectClientEntities(files: Record<string, string | Uint8Array>): ClientEntitySlot[] {
  const slots: ClientEntitySlot[] = [];
  for (const path of Object.keys(files)) {
    if (!/^entity\/[^/]+\.entity\.json$/i.test(path)) continue;
    const doc = parseJson(files[path]);
    const description = doc?.['minecraft:client_entity']?.description;
    if (!doc || !description || typeof description !== 'object') continue;
    slots.push({
      path,
      identifier: typeof description.identifier === 'string' ? description.identifier : path,
      doc,
      description,
      changed: false,
      created: false,
    });
  }
  return slots;
}

/** Clip ids any client entity already registers, so a clip is never registered twice. */
function collectRegisteredClipIds(slots: ClientEntitySlot[]): Set<string> {
  const registered = new Set<string>();
  for (const slot of slots) {
    const animations = slot.description.animations;
    if (!animations || typeof animations !== 'object') continue;
    for (const value of Object.values(animations as Record<string, unknown>)) {
      if (typeof value === 'string') registered.add(value);
    }
  }
  return registered;
}

/**
 * Owner → client entity. Exact identifier first, then a token-containment match that must be
 * unique. A guess would register one creature's motion on another, so ambiguity is refused and
 * reported instead of resolved arbitrarily.
 */
function findEntityFor(slots: ClientEntitySlot[], owner: string): ClientEntitySlot | null {
  const wanted = reduced(owner);
  if (!wanted) return null;
  const exact = slots.filter((slot) => {
    const short = reduced(slot.identifier.split(':').pop() ?? '');
    return short === wanted || reduced(slot.identifier) === wanted;
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const loose = slots.filter((slot) => {
    const short = reduced(slot.identifier.split(':').pop() ?? '');
    if (!short) return false;
    if (short.length >= 5 && wanted.includes(short)) return true;
    if (wanted.length >= 5 && short.includes(wanted)) return true;
    return false;
  });
  return loose.length === 1 ? loose[0] : null;
}

/**
 * Clips the pack defines that no client entity registers. A definition nothing selects can never
 * play, which is the silent half of a failed animation port, so it is counted and named here
 * instead of being left to be discovered in game.
 */
function collectOrphanedShippedClips(
  shippedClips: Map<string, { bones: string[]; path: string }>,
  registered: Set<string>,
): Array<{ clipId: string; path: string }> {
  const orphans: Array<{ clipId: string; path: string }> = [];
  for (const [clipId, entry] of shippedClips) {
    if (registered.has(clipId)) continue;
    // Vanilla player and pose clips are supplied by the engine, so the pack never registers them.
    if (/^(animation|controller)\.(player|humanoid|common|armor_stand)\b/i.test(clipId)) continue;
    orphans.push({ clipId, path: entry.path });
  }
  return orphans;
}

const PLAYER_IDENTIFIER = 'minecraft:player';

function looksLikePlayerOwner(owner: string, bones: string[]): boolean {
  if (reduced(owner).includes('player')) return true;
  if (bones.length === 0) return false;
  // A clip whose every channel addresses a Bedrock player joint can only be a player clip: no
  // other rig declares those names.
  return bones.every((bone) => Boolean(resolvePlayerBone(bone)));
}

/**
 * The player client entity a ported player clip set needs. A pack override replaces the whole
 * vanilla file, so the base is rebuilt from the vanilla definition (materials, texture, geometry,
 * render controllers, root and base poses) and the clips are registered on top by this pass.
 */
function ensurePlayerSlot(
  files: Record<string, string | Uint8Array>,
  slots: ClientEntitySlot[],
  modId: string,
): ClientEntitySlot | null {
  const existing = slots.find((slot) => slot.identifier === PLAYER_IDENTIFIER);
  if (existing) return existing;
  const wiring = buildPlayerClientEntity({
    portedClips: {},
    triggers: [],
    controllerIds: [],
    modId,
  });
  const json = wiring.files['entity/player.entity.json'];
  if (!json) return null;
  files['entity/player.entity.json'] = json;
  const doc = parseJson(json);
  const description = doc?.['minecraft:client_entity']?.description;
  if (!doc || !description) return null;
  const slot: ClientEntitySlot = {
    path: 'entity/player.entity.json',
    identifier: PLAYER_IDENTIFIER,
    doc,
    description,
    changed: true,
    created: true,
  };
  slots.push(slot);
  return slot;
}

/**
 * The condition a clip runs under. The translated source trigger wins when it exists; otherwise
 * perspective decides. A clip with neither is gated off the first-person view rather than left
 * permanently active, because a body clip that runs in every context deforms the hand pose.
 */
function clipCondition(
  perspective: string,
  clipId: string,
  document: Record<string, unknown>,
  sourceCondition?: string,
): string {
  const view = perspective === 'first_person' ? 'query.is_first_person' : '!query.is_first_person';
  const parts: string[] = [view];
  const trigger = (sourceCondition ?? '').trim()
    || (inferClipTrigger(clipId, document as unknown as BedrockAnimationClip)?.condition ?? '').trim();
  if (trigger && !parts.includes(trigger)) parts.push(trigger);
  return parts.join(' && ');
}

function uniqueKey(raw: string, taken: Set<string>): string {
  let base = safeFileId(raw) || 'clip';
  if (!/^[a-z_]/.test(base)) base = `clip_${base}`;
  let candidate = base;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  taken.add(candidate);
  return candidate;
}

function writeClipFile(
  files: Record<string, string | Uint8Array>,
  owner: string,
  clips: Record<string, unknown>,
): string {
  const slug = safeFileId(owner) || 'source';
  const path = `animations/${slug}.ir_ported.animation.json`;
  const existing = parseJson(files[path]);
  const animations = existing?.animations && typeof existing.animations === 'object'
    ? (existing.animations as Record<string, unknown>)
    : {};
  files[path] = JSON.stringify(
    { format_version: '1.8.0', animations: { ...animations, ...clips } },
    null,
    2,
  );
  return path;
}

/**
 * Playback self-test. Registration is not playback, and nothing in the build pipeline can observe
 * a Bedrock client — so the pack ships the means to observe it: one event replays every registered
 * clip on the executing player and reports each failure instead of swallowing it.
 */
function buildSelfTestScript(clipIds: string[], namespace: string): string {
  const entries = clipIds.map((clipId) => `  ${JSON.stringify(clipId)},`).join('\n');
  return `
// Generated by the universal animation writer: playback self-test for the clips this pack
// registers. Registration is not activation and activation is not visible playback, so this
// script makes playback observable in game instead of assumed.
import { system } from '@minecraft/server';

const PORTED_CLIPS = [
${entries}
];

function playClip(entity, clipId) {
  if (!entity) {
    console.warn('[AIPPY-ANIM] no entity for ' + clipId + '; playback skipped.');
    return false;
  }
  if (typeof entity.playAnimation !== 'function') {
    console.warn('[AIPPY-ANIM] ' + clipId + ' cannot be played: playAnimation is unavailable on this script API version.');
    return false;
  }
  try {
    entity.playAnimation(clipId, { blendOutTime: 0.15 });
    console.info('[AIPPY-ANIM] playback started: ' + clipId + ' on ' + entity.typeId);
    return true;
  } catch (error) {
    console.warn('[AIPPY-ANIM] playback FAILED for ' + clipId + ': ' + (error instanceof Error ? error.message : String(error)));
    return false;
  }
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== '${namespace}:animation_test') return;
  const player = event.sourceEntity;
  if (!player) {
    console.warn('[AIPPY-ANIM] /${namespace}:animation_test needs a player source entity.');
    return;
  }
  let played = 0;
  for (const clipId of PORTED_CLIPS) {
    if (playClip(player, clipId)) played += 1;
  }
  player.sendMessage('\\u00a7b[AIPPY] playback test: ' + played + '/' + PORTED_CLIPS.length + ' clip(s) activated. Check the content log for per-clip failures.');
});
`;
}

export function exportUniversalAnimationIR(input: {
  ir?: UniversalAnimationIRReport;
  modId?: string;
  resourcePackFiles: Record<string, string | Uint8Array>;
  behaviorPackFiles?: Record<string, string | Uint8Array>;
  /** Clip id → Molang condition translated from the source triggers (Java evidence). */
  triggerConditions?: Record<string, string>;
  /** Clips the shipped behaviour script fires; they are registered but not gated by Molang. */
  scriptDrivenClips?: string[];
  onLog?: (line: string) => void;
}): UniversalAnimationExportReport {
  const { ir, resourcePackFiles } = input;
  const log = (line: string) => input.onLog?.(line);
  const modId = input.modId ?? 'aippy';
  const triggerConditions = input.triggerConditions ?? {};
  const scriptDriven = new Set(input.scriptDrivenClips ?? []);
  const report: UniversalAnimationExportReport = {
    irClips: 0,
    alreadyShipped: 0,
    emittedClips: [],
    animationFiles: [],
    registeredClips: [],
    activatedClips: [],
    registeredOnEntities: [],
    standaloneOwners: [],
    unregisteredClips: [],
    clientEntitiesCreated: [],
    orphanedShippedClips: [],
    scriptDrivenClips: [],
    selfTestScript: '',
    skipped: [],
    approximated: [],
    duplicateRegistrations: 0,
    budgetExhausted: false,
    summary: '',
  };
  /** Report every definition that no client entity selects — the silent "never plays" defect. */
  const reportOrphans = (
    shippedClips: Map<string, { bones: string[]; path: string }>,
    registeredIds: Set<string>,
  ): void => {
    report.orphanedShippedClips = collectOrphanedShippedClips(shippedClips, registeredIds);
    for (const orphan of report.orphanedShippedClips.slice(0, 8)) {
      log(
        `[ANIM:WRITE:ORPHAN] ${orphan.clipId} (${orphan.path}) is defined by this pack but registered by no client entity, so nothing can select it at runtime.`,
      );
    }
  };
  if (!ir || ir.clipCount === 0) {
    reportOrphans(
      collectShippedClips(resourcePackFiles),
      collectRegisteredClipIds(collectClientEntities(resourcePackFiles)),
    );
    report.summary =
      'Universal animation writer: the interpretation stage produced no clip, so this pass had nothing to write or register.' +
      (report.orphanedShippedClips.length > 0
        ? ` ${report.orphanedShippedClips.length} definition(s) already ship but no client entity registers them, so they can never play.`
        : '');
    log(`[ANIM:WRITE] ${report.summary}`);
    return report;
  }

  let shipped = collectShippedClips(resourcePackFiles);
  const slots = collectClientEntities(resourcePackFiles);
  const alreadyRegistered = collectRegisteredClipIds(slots);
  const treated = new Set<string>();
  const pendingOwners: string[] = [];
  const pending: Record<string, string[]> = {};

  // ── 1. definition: every interpreted clip the pack does not carry is written ──────────────
  for (const clip of Object.values(ir.clips)) {
    report.irClips += 1;
    if (treated.has(clip.id)) continue;
    treated.add(clip.id);
    if (shipped.has(clip.id)) {
      report.alreadyShipped += 1;
    } else {
      if (report.emittedClips.length >= MAX_EMITTED_CLIPS) {
        report.budgetExhausted = true;
        report.skipped.push({ clipId: clip.id, reason: `emission budget of ${MAX_EMITTED_CLIPS} clips reached` });
        continue;
      }
      const emitted = emitAnimationClip(clip);
      if (!emitted) {
        report.skipped.push({ clipId: clip.id, reason: 'the clip declares no Bedrock-readable bone channel' });
        continue;
      }
      const emittedDoc = (emitted.document ?? {}) as Record<string, unknown>;
      report.emittedClips.push(clip.id);
      for (const note of emitted.approximated) report.approximated.push(`${clip.id}: ${note}`);
      for (const note of emitted.dropped) report.approximated.push(`${clip.id}: withheld ${note}`);
      const owner = clip.owner || 'source';
      if (!pending[owner]) {
        pending[owner] = [];
        pendingOwners.push(owner);
      }
      pending[owner].push(clip.id);
      // The freshly emitted body is what registration measures below.
      const emittedBones = emittedDoc.bones && typeof emittedDoc.bones === 'object'
        ? Object.keys(emittedDoc.bones as Record<string, unknown>)
        : [];
      shipped.set(clip.id, {
        bones: emittedBones,
        path: `animations/${safeFileId(owner) || 'source'}.ir_ported.animation.json`,
        body: emittedDoc,
      });
    }
    // A clip that already shipped but that no entity registers is still a clip that never plays,
    // so every interpreted clip is considered for registration, not only the new ones.
    if (alreadyRegistered.has(clip.id)) continue;
    const owner = clip.owner || 'source';
    if (!pending[owner]) {
      pending[owner] = [];
      pendingOwners.push(owner);
    }
    if (!pending[owner].includes(clip.id)) pending[owner].push(clip.id);
  }

  // Owners resolved to a client entity, or reported with the reason they could not be.
  const ownersNeedingWrite = new Map<string, string[]>();
  for (const owner of pendingOwners) {
    const clipIds = pending[owner] ?? [];
    if (clipIds.length === 0) continue;
    ownersNeedingWrite.set(owner, clipIds);
  }

  if (ownersNeedingWrite.size === 0) {
    reportOrphans(shipped, alreadyRegistered);
    report.summary =
      `Universal animation writer: ${report.irClips} interpreted clip(s) are already defined and registered (${report.alreadyShipped} were carried by an earlier stage); no unowned clip remained.`;
    log(`[ANIM:WRITE] ${report.summary}`);
    return report;
  }

  // ── 2. definition files for owners whose clips were emitted here ─────────────────────────
  const emittedByOwner: Record<string, Record<string, unknown>> = {};
  for (const clip of Object.values(ir.clips)) {
    if (!report.emittedClips.includes(clip.id)) continue;
    const owner = clip.owner || 'source';
    const body = shipped.get(clip.id)?.body;
    if (!body) continue;
    if (!emittedByOwner[owner]) emittedByOwner[owner] = {};
    emittedByOwner[owner][clip.id] = body;
  }
  const fileForOwner = new Map<string, string>();
  for (const [owner, clips] of Object.entries(emittedByOwner)) {
    fileForOwner.set(owner, writeClipFile(resourcePackFiles, owner, clips));
    report.animationFiles.push(fileForOwner.get(owner) as string);
  }

  // ── 3. registration + activation on a real rendering owner ───────────────────────────────
  const registeredNow = new Set<string>();
  for (const [owner, clipIds] of ownersNeedingWrite) {
    const ownerBones = clipIds.flatMap((clipId) => shipped.get(clipId)?.bones ?? []);
    let slot = findEntityFor(slots, owner);
    if (!slot && looksLikePlayerOwner(owner, ownerBones)) {
      const playerSlot = ensurePlayerSlot(resourcePackFiles, slots, modId);
      if (playerSlot) {
        slot = playerSlot;
        report.clientEntitiesCreated.push('entity/player.entity.json');
        log(
          '[ANIM:WRITE] A clip set is addressed to the player and no player client entity existed, so one was built from the vanilla base (materials, texture, geometry, render controllers, root and base poses preserved); without it a pack that ships player clips plays nothing.',
        );
      }
    }
    if (!slot) {
      report.standaloneOwners.push(owner);
      for (const clipId of clipIds) {
        report.unregisteredClips.push({
          clipId,
          owner,
          reason: 'no client entity in this pack carries this owner identifier and the clip set is not player-addressed, so nothing can register it; the definition ships and is reported UNREGISTERED rather than deleted',
        });
      }
      log(
        `[ANIM:WRITE] Owner "${owner}" -> ${clipIds.length} clip(s) in ${fileForOwner.get(owner) ?? 'an existing document'}; no client entity carries that identifier or a unique token match and the set is not player-addressed, so it ships UNREGISTERED (no entity is invented for it).`,
      );
      continue;
    }

    if (!slot.description.animations || typeof slot.description.animations !== 'object') {
      slot.description.animations = {};
    }
    if (!slot.description.scripts || typeof slot.description.scripts !== 'object') slot.description.scripts = {};
    const animations = slot.description.animations as Record<string, string>;
    const existingAnimate: unknown[] = Array.isArray(slot.description.scripts.animate)
      ? (slot.description.scripts.animate as unknown[])
      : [];
    const takenKeys = new Set<string>(Object.keys(animations));
    const registeredValues = new Set<string>(Object.values(animations));
    const clipMeta = ir.clips;

    let added = 0;
    let activated = 0;
    for (const clipId of clipIds) {
      if (registeredValues.has(clipId) || alreadyRegistered.has(clipId) || registeredNow.has(clipId)) {
        report.duplicateRegistrations += 1;
        continue;
      }
      const tail = clipId.split(/[.:/]+/).pop() ?? clipId;
      const key = uniqueKey(tail, takenKeys);
      animations[key] = clipId;
      registeredValues.add(clipId);
      registeredNow.add(clipId);
      report.registeredClips.push(clipId);
      added += 1;
      // Script-driven clips are fired by the shipped behaviour script; adding a Molang gate for
      // them would make a one-shot action play permanently. They are reported as script-activated.
      if (scriptDriven.has(clipId)) {
        report.scriptDrivenClips.push(clipId);
        continue;
      }
      const condition = clipCondition(
        clipMeta[clipId]?.perspective ?? 'unspecified',
        clipId,
        shipped.get(clipId)?.body ?? {},
        triggerConditions[clipId],
      );
      existingAnimate.push({ [key]: condition });
      report.activatedClips.push(clipId);
      activated += 1;
    }
    slot.description.scripts.animate = existingAnimate;
    if (added > 0) {
      slot.changed = true;
      report.registeredOnEntities.push(`${slot.identifier} <- ${added} clip(s)`);
      log(
        `[ANIM:WRITE] Client entity "${slot.identifier}" registers ${added} recovered clip(s); ${activated} are activated through scripts.animate with a condition derived from the translated source trigger or, when none was recovered, the clip's own track shape and perspective.`,
      );
    }
  }

  for (const slot of slots) {
    if (!slot.changed) continue;
    resourcePackFiles[slot.path] = JSON.stringify(slot.doc, null, 2);
  }
  shipped = collectShippedClips(resourcePackFiles);
  reportOrphans(shipped, new Set([...alreadyRegistered, ...registeredNow]));

  // ── 4. playback self-test, so "ported" can be observed instead of assumed ─────────────────
  const registeredIds = [...new Set([...report.registeredClips, ...alreadyRegistered])]
    .filter((clipId) => shipped.has(clipId));
  if (registeredIds.length > 0 && input.behaviorPackFiles) {
    const namespace = safeFileId(modId) || 'aippy';
    const existingScript = typeof input.behaviorPackFiles['scripts/main.js'] === 'string'
      ? (input.behaviorPackFiles['scripts/main.js'] as string)
      : '';
    if (!existingScript.includes(`:${'animation_test'}`) && !existingScript.includes(":animation_test")) {
      report.selfTestScript = buildSelfTestScript(registeredIds, namespace);
      input.behaviorPackFiles['scripts/main.js'] = [existingScript, report.selfTestScript]
        .filter(Boolean)
        .join('\n\n');
      log(
        `[ANIM:WRITE] Playback self-test script merged: /${namespace}:animation_test replays ${registeredIds.length} registered clip(s) on the executing player and logs every failure. Playback in-game is NOT verified until that command is run.`,
      );
    }
  }

  report.summary =
    `Universal animation writer: ${report.irClips} interpreted clip(s) → ${report.emittedClips.length} new definition(s) written across ${report.animationFiles.length} document(s), ${report.alreadyShipped} already carried; ` +
    `${report.registeredClips.length} newly registered on ${report.registeredOnEntities.length} client entit(ies) (${report.activatedClips.length} activated here, ${report.scriptDrivenClips.length} fired from the behaviour script), ` +
    `${report.clientEntitiesCreated.length} client entity document(s) created so a clip set has a rendering owner, ` +
    `${report.unregisteredClips.length} clip(s) UNREGISTERED with the reason recorded, ${report.duplicateRegistrations} already-registered clip(s) skipped` +
    `${report.budgetExhausted ? ', emission budget exhausted' : ''}.`;
  log(`[ANIM:WRITE] ${report.summary}`);
  for (const finding of report.unregisteredClips.slice(0, 8)) {
    log(`[ANIM:WRITE:UNREGISTERED] ${finding.clipId} (${finding.owner}) — ${finding.reason}.`);
  }
  return report;
}