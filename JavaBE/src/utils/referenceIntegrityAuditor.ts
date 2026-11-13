import { buildRenderControllerDocument } from '@/utils/renderControllerSchema';
import { isKnownVanillaPlayerAnimationReference } from '@/utils/clientEntitySchema';
import type { AnimationResourceRegistry } from '@/utils/animationResourceRegistry';

/**
 * Reference integrity auditor.
 *
 * A Bedrock addon is a graph: a client entity binds geometry, texture and material keys; its
 * render controllers resolve those keys through expressions such as `Geometry.default`; the
 * animation identifiers it registers must exist in some `*.animation.json`; the animation
 * controllers it names must exist in some `*.animation_controllers.json`. A single broken edge
 * does not raise an error at runtime — the entity simply renders with the wrong mesh, with no
 * mesh, or with an animation that never starts.
 *
 * This pass walks that graph on the exact pack that exports, repairs what can be repaired
 * without inventing artwork or behaviour (rebinding to a declared geometry, generating the
 * schema-required render controller for an entity that has none, activating a controller the
 * entity declares), and reports what is left. Missing animation registrations and transitions
 * remain untouched; they are reported for the final export gate instead of being guessed away.
 */

export interface IntegrityFinding {
  severity: 'error' | 'warning' | 'info';
  rule: string;
  subject: string;
  detail: string;
  repaired: boolean;
}

export interface ReferenceIntegrityReport {
  geometriesDeclared: number;
  renderControllersDeclared: number;
  controllersDeclared: number;
  entitiesAudited: number;
  geometryRefsRepaired: string[];
  geometryRefsUnresolved: string[];
  renderControllerRefsRepaired: string[];
  renderControllerRefsUnresolved: string[];
  renderControllersGenerated: string[];
  controllerRefsRemoved: string[];
  animationControllerHooksActivated: string[];
  controllerStateRepairs: string[];
  renderControllerRepairs: string[];
  animationRefsUnresolved: string[];
  firstPersonRenderers: string[];
  /** Registered clips that no final exported activation path reaches; preserved and reported. */
  unactivatedClipRefs: string[];
  /** Unique final registered clip ids that have a final activation path. */
  clipsActivated: string[];
  /**
   * Registered clips whose activation path is an animation controller state. They are NOT
   * unactivated: the controller the entity activates selects them, which is the destination-native
   * mechanism for mutually exclusive poses.
   */
  controllerDrivenClips: string[];
  /** Every render-controller id an entity references. */
  renderControllersReferenced: number;
  /** Render controllers the engine supplies (vanilla player rig), so the pack need not define them. */
  renderControllersEngineProvided: string[];
  /** Declared geometry rebound to the entity that owns it instead of shipping unused. */
  geometryOwnershipRepaired: string[];
  /** Shipped geometry no client entity binds, so it can never render. */
  orphanGeometries: string[];
  findings: IntegrityFinding[];
  summary: string;
}

type FileMap = Record<string, string | Uint8Array>;

const VANILLA_GEOMETRY = /^geometry\.(humanoid|cape|armor_stand|player)\b/i;
const VANILLA_RENDER_CONTROLLER = /^controller\.render\.(player|armor_stand)\b/i;
const ENGINE_CLIP = { test: isKnownVanillaPlayerAnimationReference };

function parseJson(raw: string | Uint8Array | undefined): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function reduced(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function safeStem(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'entity';
}

function collectGeometryIds(files: FileMap): Set<string> {
  const ids = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.json')) continue;
    const doc = parseJson(files[path]);
    const raw = doc?.['minecraft:geometry'] ?? doc?.geometry;
    const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
    for (const entry of list) {
      const identifier = (entry as Record<string, any>)?.description?.identifier;
      if (typeof identifier === 'string' && identifier.trim()) ids.add(identifier.trim());
    }
  }
  return ids;
}

function collectRenderControllers(files: FileMap): Map<string, { path: string; id: string }> {
  const out = new Map<string, { path: string; id: string }>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith('render_controllers/') || !path.endsWith('.json')) continue;
    const doc = parseJson(files[path]);
    const root = doc?.render_controllers ?? doc?.['minecraft:render_controllers'];
    if (!root || typeof root !== 'object') continue;
    for (const controllerId of Object.keys(root as Record<string, unknown>)) {
      out.set(controllerId, { path, id: controllerId });
    }
  }
  return out;
}

function collectAnimationControllers(files: FileMap): Map<string, string[]> {
  const controllers = new Map<string, string[]>();
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.animation_controllers.json')) continue;
    const doc = parseJson(files[path]);
    const root = doc?.animation_controllers;
    if (!root || typeof root !== 'object') continue;
    for (const [controllerId, body] of Object.entries(root as Record<string, any>)) {
      const clips: string[] = [];
      const states = body && typeof body === 'object' ? (body as Record<string, any>).states : null;
      if (states && typeof states === 'object') {
        for (const state of Object.values(states as Record<string, any>)) {
          const list = state && typeof state === 'object' ? (state as Record<string, any>).animations : null;
          if (!Array.isArray(list)) continue;
          for (const entry of list) {
            if (typeof entry === 'string') clips.push(entry);
            else if (entry && typeof entry === 'object') clips.push(...Object.keys(entry));
          }
        }
      }
      controllers.set(controllerId, [...new Set(clips)]);
    }
  }
  return controllers;
}

function pickClosest(candidates: Set<string>, wanted: string): string | null {
  const target = reduced(wanted.split(':').pop() ?? wanted);
  if (!target) return null;
  const exact = [...candidates].find((candidate) => reduced(candidate) === reduced(wanted));
  if (exact) return exact;
  const suffixed = [...candidates].filter((candidate) => {
    const key = reduced(candidate.split(':').pop() ?? candidate);
    return key.length >= 4 && (key.endsWith(target) || target.endsWith(key));
  });
  return suffixed.length === 1 ? suffixed[0] : null;
}

export function auditReferenceIntegrity(input: {
  modId: string;
  resourcePackFiles: FileMap;
  behaviorPackFiles?: FileMap;
  /** Clips a later stage deliberately deactivated (state conflicts); never re-activated here. */
  deactivatedClips?: string[];
  onLog?: (line: string) => void;
}): ReferenceIntegrityReport {
  const log = (line: string) => input.onLog?.(line);
  const files = input.resourcePackFiles;
  const findings: IntegrityFinding[] = [];
  const finding = (entry: Omit<IntegrityFinding, 'repaired'> & { repaired?: boolean }) => {
    findings.push({ ...entry, repaired: entry.repaired ?? false });
    input.onLog?.(`[ANIM:REF:${entry.severity.toUpperCase()}] ${entry.subject} — ${entry.detail}`);
  };
  const report: ReferenceIntegrityReport = {
    geometriesDeclared: 0,
    renderControllersDeclared: 0,
    controllersDeclared: 0,
    entitiesAudited: 0,
    geometryRefsRepaired: [],
    geometryRefsUnresolved: [],
    renderControllerRefsRepaired: [],
    renderControllerRefsUnresolved: [],
    renderControllersGenerated: [],
    controllerRefsRemoved: [],
    animationControllerHooksActivated: [],
    controllerStateRepairs: [],
    renderControllerRepairs: [],
    animationRefsUnresolved: [],
    firstPersonRenderers: [],
    unactivatedClipRefs: [],
    clipsActivated: [],
    controllerDrivenClips: [],
    renderControllersReferenced: 0,
    renderControllersEngineProvided: [],
    geometryOwnershipRepaired: [],
    orphanGeometries: [],
    findings: [],
    summary: '',
  };

  const geometries = collectGeometryIds(files);
  const renderControllers = collectRenderControllers(files);
  const animationControllers = collectAnimationControllers(files);
  const clipIds = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.animation.json')) continue;
    const doc = parseJson(files[path]);
    const animations = doc?.animations;
    if (!animations || typeof animations !== 'object') continue;
    for (const clipId of Object.keys(animations as Record<string, unknown>)) clipIds.add(clipId);
  }
  report.geometriesDeclared = geometries.size;
  report.renderControllersDeclared = renderControllers.size;
  report.controllersDeclared = animationControllers.size;

  const dirtyRenderControllers = new Set<string>();
  const referencedRenderControllers = new Set<string>();
  const deactivated = new Set(input.deactivatedClips ?? []);
  const entityDocs: Array<{
    identifier: string;
    description: Record<string, any>;
    doc: Record<string, any>;
  }> = [];

  for (const path of Object.keys(files)) {
    if (!/^entity\/[^/]+\.entity\.json$/i.test(path)) continue;
    const doc = parseJson(files[path]);
    const description = doc?.['minecraft:client_entity']?.description;
    if (!doc || !description || typeof description !== 'object') continue;
    report.entitiesAudited += 1;
    entityDocs.push({
      path,
      identifier: typeof description.identifier === 'string' ? description.identifier : path,
      description,
      doc,
    });
    const isPlayer = description.identifier === 'minecraft:player';
    const entityShort = safeStem(String(description.identifier ?? path).split(':').pop() ?? 'entity');
    let changed = false;

    // ── geometry bindings ──────────────────────────────────────────────────
    const geometryMap: Record<string, string> = {};
    if (description.geometry && typeof description.geometry === 'object') {
      for (const [key, value] of Object.entries(description.geometry as Record<string, unknown>)) {
        if (typeof value === 'string') geometryMap[key] = value;
      }
    }
    for (const [key, id] of Object.entries(geometryMap)) {
      if (geometries.has(id) || VANILLA_GEOMETRY.test(id)) continue;
      const replacement = pickClosest(geometries, id) ?? (isPlayer ? 'geometry.humanoid.custom' : null);
      if (replacement) {
        geometryMap[key] = replacement;
        changed = true;
        report.geometryRefsRepaired.push(`${path}: ${key} ${id} → ${replacement}`);
        finding({
          severity: 'warning',
          rule: 'geometry-reference-repaired',
          subject: `${path} (${key})`,
          detail: `Bound geometry "${id}" is declared by no shipped document, so the entity would draw nothing; rebound to "${replacement}", which the pack really declares.`,
          repaired: true,
        });
      } else {
        report.geometryRefsUnresolved.push(`${path}: ${key} → ${id}`);
        finding({
          severity: 'error',
          rule: 'geometry-reference-unresolved',
          subject: `${path} (${key})`,
          detail: `Bound geometry "${id}" is declared by no shipped document and no declared geometry matches it, so the entity has no mesh to draw. Nothing is invented.`,
          repaired: false,
        });
      }
    }
    if (Object.keys(geometryMap).length > 0 && changed) description.geometry = geometryMap;
    if (Object.keys(geometryMap).length === 0) {
      // No geometry key at all: a render controller then has nothing to resolve, so the entity
      // is invisible. Reported, never filled in with a guessed rig.
      report.geometryRefsUnresolved.push(`${path}: no geometry binding`);
      finding({
        severity: 'error',
        rule: 'geometry-binding-missing',
        subject: path,
        detail: 'The client entity binds no geometry key, so any render controller it names has nothing to draw. No rig is invented for it.',
        repaired: false,
      });
    }

    // ── render controllers ────────────────────────────────────────────────
    const renderList: string[] = Array.isArray(description.render_controllers)
      ? (description.render_controllers as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];
    const rebuiltRender: string[] = [];
    for (const controllerId of renderList) {
      if (renderControllers.has(controllerId) || VANILLA_RENDER_CONTROLLER.test(controllerId)) {
        rebuiltRender.push(controllerId);
        continue;
      }
      const replacement = pickClosest(new Set(renderControllers.keys()), controllerId);
      if (replacement) {
        rebuiltRender.push(replacement);
        changed = true;
        report.renderControllerRefsRepaired.push(`${path}: ${controllerId} → ${replacement}`);
        finding({
          severity: 'warning',
          rule: 'render-controller-repaired',
          subject: path,
          detail: `Render controller "${controllerId}" is not defined in this pack; rebound to "${replacement}".`,
          repaired: true,
        });
        continue;
      }
      // Nothing defines a controller for this entity: the client schema requires one, and an
      // entity without it draws nothing at all. A minimal controller bound to the entity's own
      // declared keys is scaffolding, not invented content.
      const generatedId = `controller.render.${safeStem(input.modId)}.${entityShort}`;
      const generatedPath = `render_controllers/${entityShort}.render_controllers.json`;
      const textureKeys = description.textures && typeof description.textures === 'object'
        ? Object.keys(description.textures as Record<string, unknown>)
        : [];
      const materialKeys = description.materials && typeof description.materials === 'object'
        ? Object.keys(description.materials as Record<string, unknown>)
        : ['default'];
      const json = buildRenderControllerDocument({
        controllerId: generatedId,
        geometry: 'Geometry.default',
        textures: [`Texture.${textureKeys.includes('default') ? 'default' : textureKeys[0] || 'default'}`],
        material: `Material.${materialKeys.includes('default') ? 'default' : materialKeys[0] || 'default'}`,
      });
      const existing = parseJson(files[generatedPath]);
      if (existing) {
        const root = existing.render_controllers ?? existing['minecraft:render_controllers'];
        if (root && typeof root === 'object') {
          Object.assign(root as Record<string, unknown>, (JSON.parse(json) as Record<string, any>).render_controllers);
          files[generatedPath] = JSON.stringify(existing, null, 2);
        } else {
          files[generatedPath] = json;
        }
      } else {
        files[generatedPath] = json;
      }
      renderControllers.set(generatedId, { path: generatedPath, id: generatedId });
      rebuiltRender.push(generatedId);
      changed = true;
      report.renderControllersGenerated.push(`${path} → ${generatedId}`);
      finding({
        severity: 'warning',
        rule: 'render-controller-generated',
        subject: path,
        detail: `No shipped document defines "${controllerId}". A schema-required controller was generated for this entity and bound to its own geometry/texture/material keys, so it renders instead of failing validation with an invalid render controller.`,
        repaired: true,
      });
    }
    if (renderList.length === 0 && Object.keys(geometryMap).length > 0) {
      const generatedId = `controller.render.${safeStem(input.modId)}.${entityShort}`;
      const generatedPath = `render_controllers/${entityShort}.render_controllers.json`;
      const declaredTextures = description.textures && typeof description.textures === 'object'
        ? Object.keys(description.textures as Record<string, unknown>)
        : [];
      const declaredMaterials = description.materials && typeof description.materials === 'object'
        ? Object.keys(description.materials as Record<string, unknown>)
        : ['default'];
      files[generatedPath] = buildRenderControllerDocument({
        controllerId: generatedId,
        geometry: 'Geometry.default',
        textures: [`Texture.${declaredTextures.includes('default') ? 'default' : declaredTextures[0] || 'default'}`],
        material: `Material.${declaredMaterials.includes('default') ? 'default' : declaredMaterials[0] || 'default'}`,
      });
      renderControllers.set(generatedId, { path: generatedPath, id: generatedId });
      rebuiltRender.push(generatedId);
      changed = true;
      report.renderControllersGenerated.push(`${path} → ${generatedId}`);
      finding({
        severity: 'warning',
        rule: 'render-controller-generated',
        subject: path,
        detail: 'The client entity declared no render controller at all, so it could never draw; a minimal controller bound to its declared keys was generated.',
        repaired: true,
      });
    }
    // Render controllers are counted by scope: referenced, defined in this pack, engine-provided.
    // "2 declared, 0 generated" was two different populations printed side by side.
    for (const controllerId of rebuiltRender) {
      if (!controllerId.startsWith('controller.render.')) continue;
      referencedRenderControllers.add(controllerId);
      if (renderControllers.has(controllerId)) continue;
      if (report.renderControllersEngineProvided.includes(controllerId)) continue;
      if (VANILLA_RENDER_CONTROLLER.test(controllerId)) report.renderControllersEngineProvided.push(controllerId);
    }
    if (changed) description.render_controllers = rebuiltRender;

    // ── render controller expressions vs declared keys ────────────────────
    for (const controllerId of rebuiltRender) {
      const record = renderControllers.get(controllerId);
      const controllerDoc = record ? parseJson(files[record.path]) : null;
      const root = controllerDoc?.render_controllers ?? controllerDoc?.['minecraft:render_controllers'];
      const definition = root && typeof root === 'object' ? (root as Record<string, any>)[controllerId] : null;
      if (!record || !definition || typeof definition !== 'object') continue;
      let touched = false;

      const geometryExpression = definition.geometry;
      if (typeof geometryExpression === 'string') {
        const key = /^Geometry\.([A-Za-z0-9_.-]+)$/.exec(geometryExpression.trim());
        if (key && !(key[1] in geometryMap)) {
          definition.geometry = 'Geometry.default';
          touched = true;
          report.renderControllerRepairs.push(`${controllerId}: Geometry.${key[1]} → Geometry.default`);
        } else if (/^geometry\./i.test(geometryExpression.trim()) && !geometries.has(geometryExpression.trim())) {
          const replacement = pickClosest(geometries, geometryExpression.trim());
          definition.geometry = replacement ?? 'Geometry.default';
          touched = true;
          report.renderControllerRepairs.push(`${controllerId}: ${geometryExpression} → ${definition.geometry}`);
        }
      }

      const textureKeys = description.textures && typeof description.textures === 'object'
        ? Object.keys(description.textures as Record<string, unknown>)
        : [];
      if (textureKeys.length > 0 && Array.isArray(definition.textures)) {
        const preferred = textureKeys.includes('default') ? 'default' : textureKeys[0];
        definition.textures = (definition.textures as unknown[]).map((entry) => {
          if (typeof entry !== 'string') return `Texture.${preferred}`;
          const match = /^Texture\.([A-Za-z0-9_.-]+)$/.exec(entry.trim());
          if (!match || textureKeys.includes(match[1])) return entry;
          touched = true;
          report.renderControllerRepairs.push(`${controllerId}: Texture.${match[1]} → Texture.${preferred}`);
          return `Texture.${preferred}`;
        });
      }

      const materialKeys = description.materials && typeof description.materials === 'object'
        ? Object.keys(description.materials as Record<string, unknown>)
        : [];
      if (materialKeys.length > 0 && Array.isArray(definition.materials)) {
        const preferred = materialKeys.includes('default') ? 'default' : materialKeys[0];
        definition.materials = (definition.materials as unknown[]).map((group) => {
          if (!group || typeof group !== 'object') return group;
          const mapped: Record<string, unknown> = {};
          for (const [part, value] of Object.entries(group as Record<string, unknown>)) {
            if (typeof value !== 'string') {
              mapped[part] = value;
              continue;
            }
            const match = /^Material\.([A-Za-z0-9_.-]+)$/.exec(value.trim());
            if (!match || materialKeys.includes(match[1]) || /^(alpha_test|blend|opaque)/i.test(value)) {
              mapped[part] = value;
              continue;
            }
            mapped[part] = `Material.${preferred}`;
            touched = true;
            report.renderControllerRepairs.push(`${controllerId}: Material.${match[1]} → Material.${preferred}`);
          }
          return mapped;
        });
      }

      if (touched) dirtyRenderControllers.add(record.path);
    }

    // ── animation controllers ────────────────────────────────────────────
    const animations = description.animations;
    if (animations && typeof animations === 'object') {
      const animate: unknown[] = Array.isArray(description.scripts?.animate) ? [...(description.scripts.animate as unknown[])] : [];
      const activeKeys = new Set<string>();
      for (const entry of animate) {
        if (typeof entry === 'string') activeKeys.add(entry);
        else if (entry && typeof entry === 'object') for (const key of Object.keys(entry as Record<string, unknown>)) activeKeys.add(key);
      }
      let animateTouched = false;
      for (const [key, value] of Object.entries(animations as Record<string, unknown>)) {
        if (typeof value !== 'string') continue;
        if (value.startsWith('controller.animation.') || value.startsWith('controller.')) {
          if (!value.startsWith('controller.animation.')) continue;
          if (!animationControllers.has(value) && !ENGINE_CLIP.test(value)) {
            report.animationRefsUnresolved.push(`${path}: ${key} → ${value}`);
            finding({
              severity: 'error',
              rule: 'controller-reference-unresolved',
              subject: `${path} (${key})`,
              detail: `Animation controller "${value}" is defined by no shipped document; its registration is preserved and the final validator will block export until its dependency is resolved.`,
              repaired: false,
            });
            continue;
          }
          if (!activeKeys.has(key)) {
            animate.push(key);
            activeKeys.add(key);
            animateTouched = true;
            report.animationControllerHooksActivated.push(`${path}: ${key} (${value})`);
            finding({
              severity: 'warning',
              rule: 'controller-not-activated',
              subject: `${path} (${key})`,
              detail: `Animation controller "${value}" is declared and defined but no scripts.animate entry activates it, so it never runs; the activation entry was added.`,
              repaired: true,
            });
          }
          continue;
        }
        if (!value.startsWith('animation.')) continue;
        if (ENGINE_CLIP.test(value) || clipIds.has(value)) continue;
        report.animationRefsUnresolved.push(`${path}: ${key} → ${value}`);
      }
      // A clip a state of an ACTIVATED controller selects already has an activation path: the
      // controller the entity activates decides which state owns the pose. Counting those clips as
      // unactivated measured the wrong mechanism and is what produced "17 of 27 have no path"
      // next to "27 are registered by a client entity".
      const controllerDriven = new Set<string>();
      for (const [key, value] of Object.entries(animations as Record<string, unknown>)) {
        if (typeof value !== 'string' || !value.startsWith('controller.animation.')) continue;
        if (!activeKeys.has(key)) continue;
        if (!animationControllers.has(value) && !ENGINE_CLIP.test(value)) continue;
        const stateReferences = animationControllers.get(value) ?? [];
        const resolvedStateClips: string[] = [];
        for (const stateReference of stateReferences) {
          const selectedClip = (animations as Record<string, unknown>)[stateReference];
          if (typeof selectedClip === 'string' && selectedClip.startsWith('animation.')) {
            controllerDriven.add(selectedClip);
            resolvedStateClips.push(selectedClip);
          } else if (stateReference.startsWith('animation.') && typeof selectedClip === 'string') {
            report.animationRefsUnresolved.push(`${path}: ${value} state alias ${stateReference} does not resolve to an animation definition`);
          } else {
            report.animationRefsUnresolved.push(`${path}: ${value} state alias "${stateReference}" is not registered on this entity`);
          }
        }
        if (resolvedStateClips.length > 0) {
          report.controllerDrivenClips.push(`${path}: ${key} → ${value} (${resolvedStateClips.length} resolved state clip(s))`);
        }
      }
      // ── registered clips with no source activation path ─────────────────
      // Keep the definition and alias untouched. Without a recovered condition, adding a bare
      // animate entry would silently make a pose permanent and can suppress vanilla movement.
      for (const [key, value] of Object.entries(animations as Record<string, unknown>)) {
        if (typeof value !== 'string' || !value.startsWith('animation.')) continue;
        if (activeKeys.has(key) || ENGINE_CLIP.test(value) || !clipIds.has(value)) continue;
        if (deactivated.has(value) || controllerDriven.has(value)) continue;
        report.unactivatedClipRefs.push(`${path}: ${key} (${value})`);
      }
      if (animateTouched) {
        description.scripts = { ...(description.scripts ?? {}), animate };
        changed = true;
      }
    }

    // ── first-person runtime ─────────────────────────────────────────────
    if (isPlayer) {
      const animate: unknown[] = Array.isArray(description.scripts?.animate) ? (description.scripts.animate as unknown[]) : [];
      const firstPersonStates = animate.filter(
        (entry) => entry && typeof entry === 'object' && Object.values(entry as Record<string, unknown>).some(
          (condition) => typeof condition === 'string' && condition.includes('query.is_first_person'),
        ),
      ).length;
      const renderNow: string[] = Array.isArray(description.render_controllers)
        ? (description.render_controllers as unknown[]).filter((value): value is string => typeof value === 'string')
        : [];
      if (firstPersonStates > 0) {
        const required = ['controller.render.player.first_person', 'controller.render.player.third_person'];
        const missing = required.filter((id) => !renderNow.includes(id));
        if (missing.length > 0) {
          description.render_controllers = [...renderNow, ...missing];
          changed = true;
          report.renderControllerRepairs.push(`${path}: +${missing.join(', ')}`);
          finding({
            severity: 'warning',
            rule: 'first-person-renderer-added',
            subject: path,
            detail: `${firstPersonStates} clip(s) are gated on query.is_first_person, but the player entity bound no first-person render controller, so the first-person pass draws nothing; the vanilla first- and third-person controllers were added so arm and held-item positioning can render.`,
            repaired: true,
          });
        }
        report.firstPersonRenderers.push(`${path}: ${firstPersonStates} first-person state(s), renderers ${(description.render_controllers as string[]).join(', ')}`);
      }
    }

    if (changed) files[path] = JSON.stringify(doc, null, 2);
  }

  for (const path of dirtyRenderControllers) {
    const doc = parseJson(files[path]);
    if (doc) files[path] = JSON.stringify(doc, null, 2);
  }

  // ── geometry ownership ─────────────────────────────────────────────────
  const boundGeometry = new Set<string>();
  for (const entity of entityDocs) {
    const map = entity.description.geometry;
    if (!map || typeof map !== 'object') continue;
    for (const value of Object.values(map as Record<string, unknown>)) {
      if (typeof value === 'string') boundGeometry.add(value);
    }
  }
  for (const geometryId of geometries) {
    if (boundGeometry.has(geometryId)) continue;
    if (VANILLA_GEOMETRY.test(geometryId)) continue;
    const identity = reduced(geometryId.replace(/^geometry\./i, '').split(':').pop() ?? geometryId);
    const candidates = entityDocs.filter((entity) => {
      const entityIdentity = reduced(entity.identifier.split(':').pop() ?? entity.identifier);
      if (!identity || !entityIdentity) return false;
      return entityIdentity === identity || entityIdentity.includes(identity) || identity.includes(entityIdentity);
    });
    if (candidates.length === 1) {
      const entity = candidates[0];
      const map = entity.description.geometry && typeof entity.description.geometry === 'object'
        ? { ...(entity.description.geometry as Record<string, unknown>) }
        : {};
      const bindsOwn = Object.values(map).some((value) => typeof value === 'string' && geometries.has(value));
      if (bindsOwn) {
        report.orphanGeometries.push(`${entity.path}: ${geometryId} (entity already binds its own geometry)`);
        finding({
          severity: 'warning',
          rule: 'geometry-unused',
          subject: geometryId,
          detail: `This geometry ships but no client entity binds it, and ${entity.path} already binds its own model, so it stays unused. Nothing was rebound over a working binding.`,
          repaired: false,
        });
        continue;
      }
      map.default = geometryId;
      entity.description.geometry = map;
      files[entity.path] = JSON.stringify(entity.doc, null, 2);
      report.geometryOwnershipRepaired.push(`${entity.path}: binds ${geometryId}`);
      finding({
        severity: 'warning',
        rule: 'geometry-ownership-repaired',
        subject: entity.path,
        detail: `This entity bound no geometry of its own, so the shipped model "${geometryId}" was bound to it; the model now has a rendering owner instead of shipping unused.`,
        repaired: true,
      });
      continue;
    }
    report.orphanGeometries.push(geometryId);
    finding({
      severity: 'warning',
      rule: 'geometry-unused',
      subject: geometryId,
      detail: 'This geometry is declared by a shipped document but no client entity binds it and no entity identifier identifies it unambiguously, so the model can never render. No entity was invented to own it.',
      repaired: false,
    });
  }

  // ── controller state graph: preserve every edge and report defects without mutating source data ──
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.animation_controllers.json')) continue;
    const doc = parseJson(files[path]);
    const root = doc?.animation_controllers;
    if (!root || typeof root !== 'object') continue;
    for (const [controllerId, body] of Object.entries(root as Record<string, any>)) {
      const states = body && typeof body === 'object' ? body.states : null;
      if (!states || typeof states !== 'object') {
        report.controllerStateRepairs.push(`${controllerId}: missing states block (preserved)`);
        continue;
      }
      const stateNames = new Set(Object.keys(states as Record<string, unknown>));
      for (const [stateName, state] of Object.entries(states as Record<string, any>)) {
        if (!state || typeof state !== 'object') continue;
        if (Array.isArray(state.animations)) {
          for (const entry of state.animations) {
            const id = typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? Object.keys(entry)[0] : '';
            if (!id || !id.startsWith('animation.') || ENGINE_CLIP.test(id) || clipIds.has(id)) continue;
            report.controllerStateRepairs.push(`${controllerId}/${stateName}: unresolved animation "${id}" preserved`);
          }
        }
        if (state.transitions === undefined) continue;
        if (!Array.isArray(state.transitions)) {
          report.controllerStateRepairs.push(`${controllerId}/${stateName}: transitions is not an array (preserved)`);
          continue;
        }
        for (const transition of state.transitions) {
          if (!transition || typeof transition !== 'object' || Array.isArray(transition)) continue;
          for (const target of Object.keys(transition as Record<string, unknown>)) {
            if (stateNames.has(target)) continue;
            report.controllerStateRepairs.push(`${controllerId}/${stateName}: transition to missing state "${target}" preserved`);
          }
        }
      }
    }
  }

  for (const repair of report.controllerStateRepairs.slice(0, 8)) log(`[ANIM:REF] controller state finding — ${repair}`);
  for (const repair of report.renderControllerRepairs.slice(0, 8)) log(`[ANIM:REF] render controller repair — ${repair}`);

  report.renderControllersReferenced = referencedRenderControllers.size;
  report.findings = findings;
  const unresolved =
    report.geometryRefsUnresolved.length +
    report.renderControllerRefsUnresolved.length +
    report.animationRefsUnresolved.length;
  report.summary =
    `Reference repair pass: ${report.entitiesAudited} client entit(ies) inspected; ${report.geometryRefsRepaired.length} geometry binding(s) repaired, ` +
    `${report.renderControllersGenerated.length} render controller(s) generated by this pass, ${report.renderControllerRefsRepaired.length} stale render reference(s) rebound, ` +
    `${report.animationControllerHooksActivated.length} animation-controller hook(s) added, ${report.renderControllerRepairs.length} render expressions re-keyed, ` +
    `${report.controllerStateRepairs.length} controller state issue(s) preserved, ${unresolved} pass-local reference issue(s). ` +
    `Final clip activation and bone totals are reported only after the exported-resource registry is built.`;
  log(`[ANIM:REF:REPAIR-PASS] ${report.summary}`);
  return report;
}

export function reconcileReferenceIntegrityMetrics(
  report: ReferenceIntegrityReport,
  registry: AnimationResourceRegistry,
): ReferenceIntegrityReport {
  const metrics = registry.metrics;
  const reconciled: ReferenceIntegrityReport = {
    ...report,
    geometriesDeclared: registry.geometries.size,
    renderControllersDeclared: metrics.renderControllersDeclared,
    controllersDeclared: metrics.controllersDefined,
    entitiesAudited: registry.entities.length,
    findings: [
      ...report.findings.filter((finding) => finding.rule !== 'clip-registered-not-activated'),
      ...metrics.unactivatedClips.map((clipId) => ({
        severity: 'warning' as const,
        rule: 'clip-registered-not-activated',
        subject: clipId,
        detail: 'This unique clip ID is selectable in the final pack but no direct, reachable-controller or verified script start path reaches it.',
        repaired: false,
      })),
    ],
    renderControllerRefsUnresolved: [...metrics.renderControllersUnresolved],
    animationRefsUnresolved: [...metrics.unresolvedIdentifiers],
    unactivatedClipRefs: [...metrics.unactivatedClips],
    clipsActivated: [...metrics.activatedClipIds],
    renderControllersReferenced: metrics.renderControllersReferenced,
    renderControllersEngineProvided: [...metrics.renderControllersEngineProvided],
  };
  const unresolved =
    reconciled.geometryRefsUnresolved.length +
    reconciled.renderControllerRefsUnresolved.length +
    reconciled.animationRefsUnresolved.length +
    reconciled.unactivatedClipRefs.length;
  reconciled.summary =
    `Final reference integrity: ${metrics.clipsActivated}/${metrics.clipsRegistered} unique registered clip id(s) have an activation path; ` +
    `${metrics.bones.resolved}/${metrics.bones.checked} final owner/clip/bone bindings resolve (${metrics.bones.unresolved.length} unresolved). ` +
    `${metrics.controllersDefined} animation-controller definitions (${metrics.controllersRegistered} entity-registered, ${metrics.controllersActivated} active); ` +
    `${metrics.renderControllersDeclared} render-controller definitions shipped (${metrics.renderControllersReferenced} referenced, ${metrics.renderControllersUnresolved.length} unresolved); ` +
    `${registry.geometries.size} geometry definitions and ${registry.entities.length} client entities in the final pack. ` +
    `Reference repair actions: ${report.geometryRefsRepaired.length} geometry rebind(s), ${report.renderControllersGenerated.length} render controller(s) generated by this repair pass, ` +
    `${report.animationControllerHooksActivated.length} animation-controller hook(s) added by this pass. ${unresolved} unresolved final reference/activation item(s).`;
  return reconciled;
}
