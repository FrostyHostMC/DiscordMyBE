import type { EntityReferenceIssue, EntityReferenceReport } from '@/types/remaker';
import type { PackFile } from '@/utils/entityTextureVariants';
import { BEDROCK_ENTITY_MATERIALS } from '@/utils/entityMaterials';
import { isKnownVanillaPlayerAnimationReference } from '@/utils/clientEntitySchema';
import {
  buildAnimationResourceRegistry,
  assertAnimationResourceRegistryCurrent,
  type AnimationResourceRegistry,
} from '@/utils/animationResourceRegistry';

/**
 * Reference validation for shipped client entities.
 *
 * Bedrock silently drops a client entity whose geometry identifier, texture, material, render
 * controller or animation id does not resolve — the mob either vanishes or stands in a T-pose,
 * with nothing in the log. Every reference is checked against the files that actually ship.
 * Bone totals and bone findings are copied from the shared exported-resource registry, so this
 * validator cannot recalculate a different population or skeleton match.
 */

type Pack = Record<string, PackFile>;
const text = (value: PackFile | undefined): string | null =>
  typeof value === 'string' ? value : null;

/** Engine-provided resources a client entity may reference without the pack declaring them. */
const VANILLA_GEOMETRY = /^geometry\.(humanoid|cape|armor_stand|player|default)\b/i;
const VANILLA_RENDER_CONTROLLER = /^controller\.render\.(player|armor_stand|default|common)\b/i;
const ENGINE_CLIP = { test: isKnownVanillaPlayerAnimationReference };
const VANILLA_TEXTURE = /^(textures\/entity\/(steve|alex|cape_invisible))$/i;

function parseJson(raw: PackFile | undefined): Record<string, any> | null {
  const doc = text(raw);
  if (!doc) return null;
  try {
    const parsed = JSON.parse(doc) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}









export function validateEntityReferences(
  files: Pack,
  registry?: AnimationResourceRegistry,
): EntityReferenceReport {
  const exportedRegistry = registry ?? buildAnimationResourceRegistry({ resourcePackFiles: files });
  assertAnimationResourceRegistryCurrent(exportedRegistry, { resourcePackFiles: files });
  const geometries = new Map(
    [...exportedRegistry.geometries.entries()].map(([identifier, bones]) => [identifier, new Set(bones)]),
  );
  const clips = new Map(
    [...exportedRegistry.clips.entries()].map(([clipId, clip]) => [clipId, clip.bones]),
  );
  const controllers = new Set(exportedRegistry.controllers.keys());
  const renderControllers = new Set(exportedRegistry.renderControllers.keys());
  const textures = new Set(
    Object.keys(files)
      .filter((path) => path.startsWith('textures/') && path.endsWith('.png'))
      .map((path) => path.slice(0, -4)),
  );
  const clientFiles = Object.keys(files).filter((path) =>
    /^entity\/[^/]+\.entity\.json$/i.test(path),
  );

  const issues: EntityReferenceIssue[] = [];
  let clipsChecked = 0;
  let mobs = 0;

  for (const path of clientFiles) {
    const mobId = path.slice('entity/'.length, -'.entity.json'.length);
    const desc = parseJson(files[path])?.['minecraft:client_entity']?.description;
    if (!desc || typeof desc !== 'object') continue;
    mobs += 1;
    // ── geometry ───────────────────────────────────────────────────────────
    for (const identifier of Object.values(desc.geometry ?? {})) {
      if (typeof identifier !== 'string' || VANILLA_GEOMETRY.test(identifier)) continue;
      if (geometries.has(identifier)) continue;
      issues.push({
        mobId,
        kind: 'geometry',
        subject: identifier,
        detail: 'geometry identifier is not declared by any shipped model file',
        severity: 'error',
      });
    }

    // ── textures / materials ───────────────────────────────────────────────
    for (const ref of Object.values(desc.textures ?? {})) {
      if (typeof ref !== 'string' || ref.startsWith('Texture.')) continue;
      const candidate = ref.endsWith('.png') ? ref.slice(0, -4) : ref;
      if (VANILLA_TEXTURE.test(candidate)) continue;
      if (!textures.has(candidate) && !textures.has(`textures/${candidate}`)) {
        issues.push({
          mobId,
          kind: 'texture',
          subject: ref,
          detail: 'texture path does not resolve to a PNG in this pack — asset is ABSENT, nothing was substituted',
          severity: 'error',
        });
      }
    }
    for (const material of Object.values(desc.materials ?? {})) {
      if (typeof material !== 'string') continue;
      if (!BEDROCK_ENTITY_MATERIALS.has(material)) {
        issues.push({
          mobId,
          kind: 'material',
          subject: material,
          detail: 'material name is not a Bedrock entity material',
          severity: 'error',
        });
      }
    }

    // ── render controllers ─────────────────────────────────────────────────
    for (const controller of Array.isArray(desc.render_controllers) ? desc.render_controllers : []) {
      if (typeof controller !== 'string') continue;
      if (renderControllers.has(controller) || VANILLA_RENDER_CONTROLLER.test(controller)) continue;
      issues.push({
        mobId,
        kind: 'render_controller',
        subject: controller,
        detail: 'render controller is not defined in any shipped render_controllers file',
        severity: 'error',
      });
    }

    // ── animation and controller identifiers ───────────────────────────────
    for (const [key, value] of Object.entries(desc.animations ?? {})) {
      if (typeof value !== 'string' || key.startsWith('__')) continue;
      if (value.startsWith('controller.')) {
        if (!controllers.has(value) && !ENGINE_CLIP.test(value)) {
          issues.push({
            mobId,
            kind: 'controller',
            subject: `${key} → ${value}`,
            detail: 'animation controller id is not defined in any shipped animation_controllers file',
            severity: 'error',
          });
        }
        continue;
      }
      clipsChecked += 1;
      if (!clips.has(value) && !ENGINE_CLIP.test(value)) {
        issues.push({
          mobId,
          kind: 'animation',
          subject: `${key} → ${value}`,
          detail: 'animation clip id is not defined in any shipped animations file',
          severity: 'error',
        });
      }
    }
  }

  for (const unresolved of exportedRegistry.metrics.bones.unresolved) {
    const ownerEntity = exportedRegistry.entities.find((entity) => unresolved.startsWith(`${entity.identifier} (${entity.path}):`));
    const owner = ownerEntity?.identifier ?? 'unknown entity';
    const ownerPath = ownerEntity?.path;
    issues.push({
      mobId: ownerPath?.slice('entity/'.length, -'.entity.json'.length) ?? owner,
      kind: 'bone',
      subject: unresolved,
      detail: 'This final owner/clip/bone binding does not resolve against the skeleton the exported entity renders.',
      severity: 'warning',
    });
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  return {
    mobs,
    clipsChecked,
    boneTracksChecked: exportedRegistry.metrics.bones.checked,
    boneTracksResolved: exportedRegistry.metrics.bones.resolved,
    boneTracksUnresolved: exportedRegistry.metrics.bones.unresolved.length,
    issues,
    errorCount,
    warningCount: issues.length - errorCount,
  };
}