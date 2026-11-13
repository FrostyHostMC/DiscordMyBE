import { lookupTextureByRef, normKey, type AssetIndex, type JavaModel } from '@/utils/assetIndex';

/**
 * Model dependency tracker.
 *
 * Records every reference a Java model makes — parent models, texture variables, item
 * overrides — plus every blockstate-to-model link, so a dangling reference is reported
 * instead of being silently replaced by a default shape. Nothing is guessed: a reference
 * is only marked resolved when the target actually exists in the archive.
 */

export type ModelDependencyKind = 'parent' | 'texture' | 'blockstate' | 'override';

export interface ModelDependencyEdge {
  from: string;
  to: string;
  kind: ModelDependencyKind;
  resolved: boolean;
}

export interface ModelDependencyReport {
  models: number;
  blockstates: number;
  edges: number;
  textureVariables: number;
  overrides: number;
  maxDepth: number;
  builtinParents: string[];
  missingParents: string[];
  missingModels: string[];
  missingTextures: string[];
  unresolvedOverrides: string[];
  orphanTextures: string[];
  orphanTextureCount: number;
  orphanBlockModels: string[];
  cycles: string[];
  issues: number;
}

/** Engine/vendor namespaces: their parents ship inside the game, not the archive. */
const ENGINE_NAMESPACES = new Set(['minecraft', 'forge', 'neoforge', 'c']);
const ENGINE_PARENT =
  /^(?:builtin|item|block)\/(?:generated|handheld|block|cube|cube_all|cube_bottom_top|cube_column|cube_top|cross|tinted_cross|crop|template_|orientable|leaves|slab|slab_top|stairs|inner_stairs|outer_stairs|fence|fence_inventory|fence_post|fence_side|wall_inventory|wall_post|wall_side|wall_side_tall|door|trapdoor|pane|button|pressure_plate|carpet)/;

function splitRef(ref: string): { namespace: string; path: string } {
  const match = /^([a-z0-9_.-]+):(.*)$/i.exec(ref.trim());
  if (match) return { namespace: match[1].toLowerCase(), path: match[2].toLowerCase() };
  return { namespace: '', path: ref.trim().toLowerCase() };
}

function resolveTextureChain(textures: Record<string, string>, key: string): string | null {
  let ref: string | undefined = textures[key];
  let guard = 0;
  while (typeof ref === 'string' && ref.startsWith('#') && guard++ < 8) ref = textures[ref.slice(1)];
  return typeof ref === 'string' && !ref.startsWith('#') ? ref : null;
}

/** Builds the full model dependency graph and its issue list for one archive. */
export function buildModelDependencyReport(index: AssetIndex): ModelDependencyReport {
  const models = [...index.itemModels, ...index.blockModels];
  const byPath = new Map<string, JavaModel>();
  const byStem = new Map<string, JavaModel>();
  for (const model of models) {
    byPath.set(normKey(model.path), model);
    if (!byStem.has(model.norm)) byStem.set(model.norm, model);
  }
  const findModel = (ref: string): JavaModel | null => {
    const { path } = splitRef(ref);
    return byPath.get(normKey(path)) ?? byStem.get(normKey(path.split('/').pop() ?? path)) ?? null;
  };

  const edges: ModelDependencyEdge[] = [];
  const builtinParents: string[] = [];
  const missingParents: string[] = [];
  const missingModels: string[] = [];
  const missingTextures: string[] = [];
  const unresolvedOverrides: string[] = [];
  const cycles: string[] = [];
  const referencedTails = new Set<string>();
  const referencedModels = new Set<string>();
  let textureVariables = 0;
  let overrides = 0;
  let maxDepth = 0;

  for (const model of models) {
    if (model.parent) {
      const resolved = findModel(model.parent);
      const { namespace, path } = splitRef(model.parent);
      edges.push({ from: model.path, to: model.parent, kind: 'parent', resolved: Boolean(resolved) });
      if (resolved) referencedModels.add(resolved.path);
      else if (namespace === '' || ENGINE_NAMESPACES.has(namespace) || ENGINE_PARENT.test(path)) {
        builtinParents.push(`${model.path} -> ${model.parent}`);
      } else {
        missingParents.push(`${model.path} -> ${model.parent}`);
      }
    }

    for (const key of Object.keys(model.textures ?? {})) {
      textureVariables++;
      const ref = resolveTextureChain(model.textures, key);
      if (!ref) {
        missingTextures.push(`${model.path}:${key} -> alias chain never reaches a texture`);
        continue;
      }
      const texture = lookupTextureByRef(index, ref);
      edges.push({ from: `${model.path}:${key}`, to: ref, kind: 'texture', resolved: Boolean(texture) });
      if (texture) referencedTails.add(texture.tail || texture.stem);
      else missingTextures.push(`${model.path}:${key} -> ${ref}`);
    }

    for (const override of model.overrides ?? []) {
      const ref = typeof override.model === 'string' ? override.model : '';
      if (!ref) continue;
      overrides++;
      const resolved = findModel(ref);
      edges.push({ from: `${model.path}:override`, to: ref, kind: 'override', resolved: Boolean(resolved) });
      if (resolved) referencedModels.add(resolved.path);
      else unresolvedOverrides.push(`${model.path} -> ${ref}`);
    }
  }

  for (const model of models) {
    const seen = new Set<string>([model.path]);
    let current: JavaModel = model;
    let depth = 0;
    while (current.parent && depth < 24) {
      const next: JavaModel | null = findModel(current.parent);
      if (!next) break;
      if (seen.has(next.path)) {
        cycles.push([...seen, next.path].join(' -> '));
        break;
      }
      seen.add(next.path);
      referencedModels.add(next.path);
      current = next;
      depth++;
    }
    maxDepth = Math.max(maxDepth, depth);
  }

  for (const block of index.blockstates) {
    const refs = [
      ...Object.values(block.variants).map((variant) => variant.model),
      ...block.multipart.map((part) => part.apply.model),
    ];
    for (const ref of refs) {
      const resolved = findModel(ref);
      edges.push({ from: block.path, to: ref, kind: 'blockstate', resolved: Boolean(resolved) });
      if (resolved) referencedModels.add(resolved.path);
      else missingModels.push(`${block.stem} -> ${ref}`);
    }
  }

  const orphanTextures: string[] = [];
  let orphanTextureCount = 0;
  for (const texture of [...index.blocks, ...index.items]) {
    const tail = texture.tail || texture.stem;
    if (referencedTails.has(tail) || referencedTails.has(texture.stem)) continue;
    orphanTextureCount++;
    if (orphanTextures.length < 80) orphanTextures.push(tail || texture.stem);
  }

  const orphanBlockModels = index.blockModels
    .filter((model) => !referencedModels.has(model.path))
    .map((model) => model.path)
    .slice(0, 80);

  const issues =
    missingParents.length +
    missingModels.length +
    missingTextures.length +
    unresolvedOverrides.length +
    cycles.length;

  return {
    models: models.length,
    blockstates: index.blockstates.length,
    edges: edges.length,
    textureVariables,
    overrides,
    maxDepth,
    builtinParents,
    missingParents,
    missingModels,
    missingTextures,
    unresolvedOverrides,
    orphanTextures,
    orphanTextureCount,
    orphanBlockModels,
    cycles,
    issues,
  };
}