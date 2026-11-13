import type { PackFile } from '@/utils/entityTextureVariants';

/**
 * Generalized Java → Bedrock particle conversion.
 *
 * The Bedrock client loads a `particles/*.json` document only when it declares
 * `minecraft:particle_effect`; every other shape logs
 * `no particle_effect field was given` and the effect never loads. Java mods ship TWO different
 * document shapes in that folder, and they must not be treated the same way:
 *
 *  1. A Java particle EFFECT — `description` (+ optional `basic_render_parameters`) and
 *     `components` at the document root. It is re-rooted: description and components are carried
 *     over unchanged, the identifier is only filled in when the source does not declare one, and
 *     no component is invented.
 *  2. A Java particle TEXTURE DECLARATION — `{"textures": ["minecraft:particle/foo"]}`. It states
 *     which sprite a Java particle class draws with and carries no lifetime, emitter, motion or
 *     appearance data at all, so no Bedrock effect can be derived from it. Writing it into
 *     `particles/` is what produces the client error, and synthesising a placeholder effect to
 *     silence the log would be invented content. The document is removed from `particles/`, its
 *     sprite stays in the pack and becomes the render texture of any real effect that names it.
 *
 * `basic_render_parameters.texture` is only ever bound to a texture this pack actually ships,
 * preferring the declaration above and falling back to the conventional sprite path. When no
 * shipped sprite can be evidenced the render parameters are not fabricated: the effect keeps
 * loading and the unresolved texture is reported.
 */

export const PARTICLE_EFFECT_KEY = 'minecraft:particle_effect';
/** The only particle format version the Bedrock client reads. */
const PARTICLE_FORMAT_VERSION = '1.10.0';
const TEXTURE_EXTS = ['.png', '.tga'];

export type JavaParticleKind = 'bedrock-effect' | 'java-effect' | 'java-texture-declaration' | 'unconvertible';

export interface ParticleConversionReport {
  /** Documents re-emitted as a loadable `minecraft:particle_effect`. */
  converted: string[];
  /** Java sprite declarations removed from particles/ (not effects, never invented). */
  textureDeclarations: string[];
  /** Effects whose render texture was bound to a sprite this pack ships. */
  texturesBound: string[];
  /** Effects whose declared render texture is absent (reported, not substituted). */
  unresolvedTextures: string[];
  /** Documents dropped because nothing expressible was in them. */
  dropped: string[];
  /** Effects that were already valid and needed no change. */
  keptEffects: number;
}

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseParticleObject(raw: PackFile | undefined): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function particleStem(path: string): string {
  const tail = path.split('/').pop() ?? path;
  return tail.replace(/\.particle\.json$/i, '').replace(/\.json$/i, '');
}

export function classifyParticleDocument(doc: Record<string, any>): JavaParticleKind {
  if (isRecord(doc[PARTICLE_EFFECT_KEY] ?? doc.particle_effect)) return 'bedrock-effect';
  if (isRecord(doc.description) || isRecord(doc.components) || isRecord(doc.particle_components)) {
    return 'java-effect';
  }
  if (Array.isArray(doc.textures) || typeof doc.texture === 'string') return 'java-texture-declaration';
  return 'unconvertible';
}

/** Java particle texture reference → the pack-relative path Bedrock resolves (no extension). */
export function normalizeParticleTexture(reference: string): string | null {
  const clean = reference.trim().replace(/^minecraft:/i, '').replace(/\\/g, '/').replace(/\.(png|tga)$/i, '');
  if (!clean) return null;
  if (clean.startsWith('textures/')) return clean;
  return clean.includes('/') ? `textures/${clean}` : `textures/particle/${clean}`;
}

export function declaredParticleTextures(doc: Record<string, any>): string[] {
  const found: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value !== 'string') return;
    const normalized = normalizeParticleTexture(value);
    if (normalized && !found.includes(normalized)) found.push(normalized);
  };
  if (Array.isArray(doc.textures)) doc.textures.forEach(collect);
  collect(doc.texture);
  return found;
}

/**
 * Converts every `particles/*.json` document in the pack. Only shapes that carry real effect data
 * become a `minecraft:particle_effect`; sprite declarations and data-less documents are reported.
 */
export function convertParticleDocuments(
  files: Record<string, PackFile>,
  modId: string,
  log: (line: string) => void,
): ParticleConversionReport {
  const report: ParticleConversionReport = {
    converted: [],
    textureDeclarations: [],
    texturesBound: [],
    unresolvedTextures: [],
    dropped: [],
    keptEffects: 0,
  };
  const paths = Object.keys(files)
    .filter((path) => path.toLowerCase().startsWith('particles/') && path.toLowerCase().endsWith('.json'))
    .sort();
  if (paths.length === 0) return report;

  const ships = (path: string) => TEXTURE_EXTS.some((ext) => files[`${path}${ext}`] != null);

  // Pass 1 — the pack's own declarations are the only evidence for which sprite an effect draws
  // with, so they are harvested before any document is rewritten.
  const declared = new Map<string, string[]>();
  for (const path of paths) {
    const doc = parseParticleObject(files[path]);
    if (!doc) continue;
    const textures = declaredParticleTextures(doc);
    if (textures.length > 0) declared.set(particleStem(path), textures);
  }

  const bindTexture = (stem: string, explicit?: unknown): { texture?: string; unresolved?: string } => {
    const normalizedExplicit = typeof explicit === 'string' ? normalizeParticleTexture(explicit) : null;
    if (normalizedExplicit) {
      return ships(normalizedExplicit) ? { texture: normalizedExplicit } : { unresolved: normalizedExplicit };
    }
    for (const candidate of declared.get(stem) ?? []) {
      if (ships(candidate)) return { texture: candidate };
    }
    const conventional = `textures/particle/${stem}`;
    if (ships(conventional)) return { texture: conventional };
    return { unresolved: (declared.get(stem) ?? [])[0] ?? conventional };
  };

  for (const path of paths) {
    const stem = particleStem(path);
    const doc = parseParticleObject(files[path]);
    if (!doc) {
      delete files[path];
      report.dropped.push(path);
      log(`[CONFORM:UNRESOLVED] Dropped ${path}: it is not a JSON object, so no particle effect can be registered from it.`);
      continue;
    }
    const kind = classifyParticleDocument(doc);

    if (kind === 'java-texture-declaration') {
      const textures = declaredParticleTextures(doc);
      delete files[path];
      report.textureDeclarations.push(path);
      log(
        `[CONFORM] Removed ${path} from particles/: it is a Java particle TEXTURE declaration (${textures.join(', ') || 'no sprite named'}) with no ${PARTICLE_EFFECT_KEY} data — lifetime, emitter, motion and appearance are all absent, so it cannot become a Bedrock effect. The document's only content is its sprite, which stays in the pack; no placeholder effect was generated.`,
      );
      continue;
    }
    if (kind === 'unconvertible') {
      delete files[path];
      report.dropped.push(path);
      log(`[CONFORM:UNRESOLVED] Dropped ${path}: the source declares no ${PARTICLE_EFFECT_KEY}, no description/components and no texture list, so nothing can be converted from it.`);
      continue;
    }

    const rawEffect = isRecord(doc[PARTICLE_EFFECT_KEY] ?? doc.particle_effect)
      ? ((doc[PARTICLE_EFFECT_KEY] ?? doc.particle_effect) as Record<string, any>)
      : null;
    const description: Record<string, any> = isRecord(rawEffect?.description)
      ? { ...(rawEffect?.description as Record<string, any>) }
      : isRecord(doc.description)
        ? { ...(doc.description as Record<string, any>) }
        : {};
    const components = isRecord(rawEffect?.components)
      ? (rawEffect?.components as Record<string, any>)
      : isRecord(doc.components)
        ? (doc.components as Record<string, any>)
        : isRecord(doc.particle_components)
          ? (doc.particle_components as Record<string, any>)
          : null;
    if (!components || Object.keys(components).length === 0) {
      delete files[path];
      report.dropped.push(path);
      log(`[CONFORM:UNRESOLVED] Dropped ${path}: it declares no particle components, so it can never emit — reported instead of shipping an empty placeholder effect.`);
      continue;
    }

    const identifier = typeof description.identifier === 'string' && description.identifier
      ? description.identifier
      : `${modId}:${stem}`;
    const render = isRecord(description.basic_render_parameters)
      ? { ...(description.basic_render_parameters as Record<string, any>) }
      : {};
    const bound = bindTexture(stem, render.texture);
    if (bound.texture) {
      render.texture = bound.texture;
      if (!render.material) render.material = 'particles_alpha';
      description.basic_render_parameters = render;
      report.texturesBound.push(`${path} -> ${bound.texture}`);
    } else {
      // No shipped sprite: the texture is not invented, so the render parameters are omitted.
      delete description.basic_render_parameters;
      report.unresolvedTextures.push(`${path} -> ${bound.unresolved ?? `textures/particle/${stem}`}`);
    }
    description.identifier = identifier;

    const serialized = JSON.stringify(
      {
        format_version: PARTICLE_FORMAT_VERSION,
        [PARTICLE_EFFECT_KEY]: { description, components },
      },
      null,
      2,
    );
    if (kind === 'java-effect') {
      files[path] = serialized;
      report.converted.push(path);
      log(
        `[CONFORM] ${path}: the Java description/components were re-rooted under ${PARTICLE_EFFECT_KEY} (identifier ${identifier}) so the effect loads instead of failing with "no particle_effect field was given".`,
      );
      continue;
    }
    report.keptEffects += 1;
    if (serialized === files[path]) continue;
    files[path] = serialized;
    report.converted.push(path);
    log(`[CONFORM] ${path}: filled the missing ${PARTICLE_EFFECT_KEY} description fields so the effect loads.`);
  }

  if (report.textureDeclarations.length > 0) {
    log(
      `[CONFORM] ${report.textureDeclarations.length} Java particle texture declaration(s) were kept out of particles/ (they declare sprites, not effects); ${report.unresolvedTextures.length} effect(s) still name a sprite this pack does not ship.`,
    );
  }
  return report;
}