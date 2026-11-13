/**
 * Canonical geometry identifier registry.
 *
 * Bedrock registers `geometry.<id>` globally inside a resource pack: two files that
 * declare the same identifier silently drop one model, and a client entity naming an
 * identifier that no file declares renders nothing at all. This module owns identifier
 * generation, normalises every shipped model file, collapses duplicate aliases, and then
 * repairs every geometry reference — client entities, render controllers, attachables,
 * block and item definitions — through the same registry instead of patching consumers
 * one at a time.
 */

type PackFiles = Record<string, string | Uint8Array>;

const decoder = new TextDecoder();
const MODEL_PATH = /^models\/.+\.json$/i;
/** Aliases several files used to publish at once; they can never be unique. */
const GENERIC_ALIAS = /^(geometry\.)?(default|model|models|entity|mob|main|root|body|humanoid)$/i;
const PLACEHOLDER = /^(Geometry|Material|Texture|Array)\./;
/** Identifiers the Bedrock engine owns: they always resolve and are never renamed. */
const VANILLA_GEOMETRY =
  /^(geometry\.(humanoid|player|item|armor|shield|trident|elytra|minecart|boat|arrow|cape)(\.[a-z0-9_]+)*|geometry\.(pig|chicken|cow|sheep|horse|wolf|cat|villager|llama|iron_golem|snow_golem|bat|ghast|slime|magma_cube|blaze|guardian|elder_guardian|phantom|shulker|ender_dragon|wither|enderman|spider|silverfish|endermite|polar_bear|panda|fox|bee|hoglin|piglin|strider|zoglin|allay|frog|warden|camel|sniffer|breeze|armadillo))$/i;

function decode(data: string | Uint8Array | undefined): string | null {
  if (data == null) return null;
  if (typeof data === 'string') return data;
  try {
    return decoder.decode(data);
  } catch {
    return null;
  }
}

function sanitizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normaliseId(raw: string): string {
  // Reference drift such as `geometry.obsidrath_obsidrath` against a shipped
  // `geometry.obsidrath_obsidrath_obsidrath` must still compare equal, so a repeated token
  // collapses before the comparison. Distinct assets keep their distinct tokens.
  const tokens = raw
    .replace(/^geometry\./i, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const collapsed: string[] = [];
  for (const token of tokens) {
    if (collapsed[collapsed.length - 1] === token) continue;
    collapsed.push(token);
  }
  return collapsed.join('_');
}

/**
 * The single identifier generator. It strips a repeated namespace prefix/suffix
 * (`mod_mod_foo`, `foo_mod`), removes redundant `geo`/`model` words, collapses repeated
 * tokens and re-applies exactly one `<namespace>_` prefix, so the same asset always
 * produces the same identifier no matter which engine generated it first.
 */
export function canonicalGeometryId(modId: string, raw: string): string {
  const mod = sanitizeToken(modId) || 'mod';
  let body = sanitizeToken(raw.replace(/^geometry\./i, '').replace(/\.(geo\.)?json$/i, ''));
  const stripPrefix = () => {
    while (body.startsWith(`${mod}_`)) body = body.slice(mod.length + 1);
  };
  stripPrefix();
  while (body.endsWith(`_${mod}`)) body = body.slice(0, -(mod.length + 1));
  body = body.replace(/^(geo|geometry|model|models)_/, '').replace(/_(geo|geometry|model|models)$/, '');
  body = body.replace(/(^|_)([a-z0-9]+)(_\2)+(?=_|$)/g, '$1$2');
  stripPrefix();
  return `geometry.${mod}_${body || 'model'}`;
}

/** Primary identifier declared by a geometry document, if any. */
export function primaryGeometryIdentifier(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as {
      'minecraft:geometry'?: Array<{ description?: { identifier?: string } }>;
    };
    return parsed['minecraft:geometry']?.[0]?.description?.identifier ?? null;
  } catch {
    return null;
  }
}

export interface GeometryRegistryReport {
  geometryFiles: number;
  geometries: number;
  aliasesCollapsed: number;
  identifiersNormalised: number;
  referencesRepaired: number;
  unresolved: string[];
  /** Client entities whose geometry resolves to no geometry file that actually ships. */
  clientEntityFailures: string[];
  /** False when at least one client entity cannot resolve — the export must fail. */
  passed: boolean;
  log: string[];
}

/**
 * Rewrites every shipped geometry file to a unique canonical identifier, then repairs
 * every reference through the resulting registry. Idempotent: running it twice changes
 * nothing the second time.
 */
export function applyCanonicalGeometryRegistry(options: {
  modId: string;
  resourcePackFiles: PackFiles;
  behaviorPackFiles?: PackFiles;
  onLog?: (line: string) => void;
}): GeometryRegistryReport {
  const { modId } = options;
  const rp = options.resourcePackFiles;
  const bp = options.behaviorPackFiles ?? {};
  const report: GeometryRegistryReport = {
    geometryFiles: 0,
    geometries: 0,
    aliasesCollapsed: 0,
    identifiersNormalised: 0,
    referencesRepaired: 0,
    unresolved: [],
    clientEntityFailures: [],
    passed: true,
    log: [],
  };

  const used = new Set<string>();
  const idByNorm = new Map<string, string[]>();
  const declaredToIds = new Map<string, string[]>();
  const primaryByPath = new Map<string, string>();
  const remember = (id: string) => {
    used.add(id);
    const norm = normaliseId(id);
    const bucket = idByNorm.get(norm) ?? [];
    if (!bucket.includes(id)) bucket.push(id);
    idByNorm.set(norm, bucket);
  };
  const registerAlias = (alias: string, id: string) => {
    const bucket = declaredToIds.get(alias) ?? [];
    if (!bucket.includes(id)) bucket.push(id);
    declaredToIds.set(alias, bucket);
  };

  // 1. Assign one canonical identifier per geometry variant.
  const modelPaths = Object.keys(rp)
    .filter((path) => MODEL_PATH.test(path) && path.toLowerCase().endsWith('.json'))
    .sort();
  for (const path of modelPaths) {
    const text = decode(rp[path]);
    if (!text || !text.includes('minecraft:geometry')) continue;
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(text) as Record<string, unknown>;
    } catch {
      continue;
    }
    const list = doc['minecraft:geometry'];
    if (!Array.isArray(list) || list.length === 0) continue;
    report.geometryFiles += 1;

    const stemSeed = path.replace(/^models\//i, '').replace(/\.(geo\.)?json$/i, '').split('/').join('_');
    const kept: unknown[] = [];
    const seenInFile = new Set<string>();
    let firstIdentifier = '';
    list.forEach((rawVariant, index) => {
      if (!rawVariant || typeof rawVariant !== 'object') return;
      const variant = rawVariant as Record<string, unknown>;
      const description = (variant.description && typeof variant.description === 'object'
        ? variant.description
        : {}) as Record<string, unknown>;
      const declared = typeof description.identifier === 'string' ? description.identifier : '';
      if (declared && GENERIC_ALIAS.test(declared)) {
        // A shared alias can never belong to one model — it is dropped, not registered.
        report.aliasesCollapsed += 1;
        return;
      }
      const base = canonicalGeometryId(modId, declared || stemSeed);
      if (seenInFile.has(base)) {
        // Second declaration of the same geometry inside one file is a pure alias.
        report.aliasesCollapsed += 1;
        if (declared) registerAlias(declared, firstIdentifier || base);
        return;
      }
      seenInFile.add(base);
      let identifier = base;
      let suffix = 2;
      while (used.has(identifier)) identifier = `${base}_${suffix++}`;
      remember(identifier);
      if (declared && declared !== identifier) {
        report.identifiersNormalised += 1;
        registerAlias(declared, identifier);
      }
      registerAlias(identifier, identifier);
      description.identifier = identifier;
      variant.description = description;
      if (index === 0 || !primaryByPath.has(path)) primaryByPath.set(path, identifier);
      if (!firstIdentifier) firstIdentifier = identifier;
      kept.push(variant);
      report.geometries += 1;
    });

    if (kept.length === 0) {
      delete rp[path];
      continue;
    }
    doc['minecraft:geometry'] = kept;
    rp[path] = JSON.stringify(doc, null, 2);
  }

  // 2. Resolve any reference through the registry: exact, canonical form, alias, then
  //    a normalised comparison. Nothing is invented when no model exists.
  const resolveReference = (raw: string, contextModelPath?: string): string | null => {
    const clean = raw.trim();
    if (!clean || PLACEHOLDER.test(clean) || /^minecraft:/i.test(clean)) return null;
    if (used.has(clean)) return clean;
    // Identifiers the engine owns always resolve and are never renamed or rebound.
    if (VANILLA_GEOMETRY.test(clean)) return clean;
    const canonical = canonicalGeometryId(modId, clean);
    if (used.has(canonical)) return canonical;
    const mapped = declaredToIds.get(clean);
    if (mapped && mapped.length > 0) {
      const preferred = contextModelPath ? primaryByPath.get(contextModelPath) : undefined;
      if (preferred && mapped.includes(preferred)) return preferred;
      return mapped[0];
    }
    const candidates = idByNorm.get(normaliseId(clean)) ?? [];
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      const preferred = contextModelPath ? primaryByPath.get(contextModelPath) : undefined;
      return preferred && candidates.includes(preferred) ? preferred : candidates[0];
    }
    return null;
  };

  const modelPathFor = (value: string): string => {
    const lower = value.replace(/\\/g, '/').toLowerCase();
    if (lower.startsWith('entity/') && lower.endsWith('.entity.json')) {
      return `models/entity/${lower.slice('entity/'.length, -'.entity.json'.length)}.geo.json`;
    }
    if (lower.startsWith('attachables/')) {
      const stem = lower.slice('attachables/'.length).replace(/\.attachable\.json$/i, '');
      return `models/items/${stem}.geo.json`;
    }
    return '';
  };

  // 3. Client entities: bind every geometry key to an identifier that really ships, and
  //    fall back to the entity's own model when the declared alias is gone.
  for (const path of Object.keys(rp)) {
    const lower = path.toLowerCase();
    const isClient = /^entity\/.+\.entity\.json$/.test(lower);
    const isAttachable = /^attachables\/.+\.json$/.test(lower);
    if (!isClient && !isAttachable) continue;
    const text = decode(rp[path]);
    if (!text) continue;
    let doc: Record<string, any>;
    try {
      doc = JSON.parse(text) as Record<string, any>;
    } catch {
      continue;
    }
    const description = isClient
      ? doc?.['minecraft:client_entity']?.description
      : doc?.['minecraft:attachable']?.description;
    if (!description || typeof description !== 'object') continue;
    const context = modelPathFor(path);
    const own = context ? primaryByPath.get(context) ?? null : null;
    let changed = false;

    const bindOwnModel = (map: Record<string, unknown>, key: string, declaredValue: string) => {
      if (!own || !isClient) {
        report.unresolved.push(`${path}: geometry.${key} → ${declaredValue}`);
        if (isClient) {
          report.clientEntityFailures.push(
            `${path}: geometry key "${key}" -> "${declaredValue}" resolves to no shipped model`,
          );
        }
        return;
      }
      const alreadyBound = Object.entries(map).some(([other, value]) => other !== key && value === own);
      if (alreadyBound) {
        // The variant has no shipped model and the fallback is already bound: drop the
        // duplicate key instead of exporting a reference to a model that does not exist.
        delete map[key];
        report.referencesRepaired += 1;
        changed = true;
        report.log.push(
          `[IDENTITY] ${path}: geometry "${declaredValue}" under key "${key}" is declared by no shipped model; the duplicate binding was removed and ${own} stays bound.`,
        );
        return;
      }
      map[key] = own;
      report.referencesRepaired += 1;
      changed = true;
      report.log.push(
        `[IDENTITY] ${path}: geometry "${declaredValue}" is declared by no shipped model — bound to its own model ${own}.`,
      );
    };

    const current = description.geometry;
    if (typeof current === 'string') {
      // Only a client entity may be rebound to its own model; an attachable that uses an
      // engine geometry keeps it.
      const resolved = resolveReference(current, context) ?? (isClient ? own : null);
      if (resolved && resolved !== current) {
        description.geometry = { default: resolved };
        report.referencesRepaired += 1;
        changed = true;
      } else if (!resolved) {
        report.unresolved.push(`${path}: geometry → ${current}`);
        if (isClient) report.clientEntityFailures.push(`${path}: geometry -> "${current}" resolves to no shipped model`);
      }
    } else if (current && typeof current === 'object') {
      const map = current as Record<string, unknown>;
      for (const key of Object.keys(map)) {
        const value = map[key];
        if (typeof value !== 'string') continue;
        const resolved = resolveReference(value, context);
        if (resolved) {
          if (resolved !== value) {
            map[key] = resolved;
            report.referencesRepaired += 1;
            changed = true;
          }
          continue;
        }
        bindOwnModel(map, key, value);
      }
      if (Object.keys(map).length === 0 && own && isClient) {
        map.default = own;
        report.referencesRepaired += 1;
        changed = true;
      }
    } else if (own && isClient) {
      description.geometry = { default: own };
      report.referencesRepaired += 1;
      changed = true;
    }
    if (changed) rp[path] = JSON.stringify(doc, null, 2);
  }

  // 4. Render controllers declare the geometry they render. Two very different reference
  //    forms live here and they must never be confused:
  //      geometry.<id>  — a real model identifier, repaired through the registry;
  //      Geometry.<key> — a reference to the client entity's own geometry map, which is
  //                       valid Bedrock and is only wrong when the entity it renders
  //                       declares no such key (rewriting it to an identifier would render
  //                       nothing, which is exactly the bug this pass replaces).
  const controllerConsumers = new Map<string, string[]>();
  const geometryKeysByConsumer = new Map<string, Set<string>>();
  for (const path of Object.keys(rp)) {
    const lower = path.toLowerCase();
    const isClient = /^entity\/.+\.entity\.json$/.test(lower);
    const isAttachable = /^attachables\/.+\.json$/.test(lower);
    if (!isClient && !isAttachable) continue;
    const text = decode(rp[path]);
    if (!text) continue;
    let doc: Record<string, any>;
    try {
      doc = JSON.parse(text) as Record<string, any>;
    } catch {
      continue;
    }
    const description = isClient
      ? doc?.['minecraft:client_entity']?.description
      : doc?.['minecraft:attachable']?.description;
    if (!description || typeof description !== 'object') continue;
    const keys = new Set<string>();
    const geometry = description.geometry;
    if (geometry && typeof geometry === 'object' && !Array.isArray(geometry)) {
      for (const key of Object.keys(geometry)) keys.add(key);
    } else if (typeof geometry === 'string') {
      keys.add('default');
    }
    geometryKeysByConsumer.set(path, keys);
    const listed = description.render_controllers;
    const controllerIds = Array.isArray(listed) ? listed : Object.values(listed ?? {});
    for (const entry of controllerIds) {
      const id = typeof entry === 'string' ? entry : '';
      if (!id) continue;
      const bucket = controllerConsumers.get(id) ?? [];
      if (!bucket.includes(path)) bucket.push(path);
      controllerConsumers.set(id, bucket);
    }
  }

  for (const path of Object.keys(rp)) {
    if (!/^render_controllers\/.+\.json$/i.test(path)) continue;
    const text = decode(rp[path]);
    if (!text || !/geometry/i.test(text)) continue;
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(text) as Record<string, unknown>;
    } catch {
      continue;
    }
    const controllers =
      (doc.render_controllers ?? doc['minecraft:render_controllers']) as Record<string, unknown> | undefined;
    if (!controllers || typeof controllers !== 'object' || Array.isArray(controllers)) continue;
    let changed = false;

    for (const [controllerId, controllerBody] of Object.entries(controllers)) {
      const consumers = controllerConsumers.get(controllerId) ?? [];
      const mapKeyRefs: Array<{ key: string; field: string; node: Record<string, unknown> }> = [];

      const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach((entry, index) => {
            if (typeof entry === 'string') {
              // A client-map key is validated against its consumers below, never rewritten.
              if (/^Geometry\./i.test(entry)) return;
              if (/^geometry\./i.test(entry)) {
                const resolved = resolveReference(entry);
                if (resolved && resolved !== entry) {
                  node[index] = resolved;
                  report.referencesRepaired += 1;
                  changed = true;
                } else if (!resolved) {
                  report.unresolved.push(`${path}: ${entry}`);
                }
              }
              return;
            }
            visit(entry);
          });
          return;
        }
        const record = node as Record<string, unknown>;
        for (const [field, value] of Object.entries(record)) {
          if (typeof value === 'string') {
            if (/^Geometry\./i.test(value)) {
              mapKeyRefs.push({ key: value.replace(/^Geometry\./i, '').trim(), field, node: record });
              continue;
            }
            if (/^geometry\./i.test(value)) {
              const resolved = resolveReference(value);
              if (resolved && resolved !== value) {
                record[field] = resolved;
                report.referencesRepaired += 1;
                changed = true;
              } else if (!resolved) {
                report.unresolved.push(`${path}: ${value}`);
              }
            }
            continue;
          }
          visit(value);
        }
      };
      visit(controllerBody);

      for (const ref of mapKeyRefs) {
        const declared = consumers.some((consumer) => geometryKeysByConsumer.get(consumer)?.has(ref.key));
        if (declared) continue;
        const fallback = consumers.find((consumer) => geometryKeysByConsumer.get(consumer)?.has('default'));
        if (fallback) {
          ref.node[ref.field] = 'Geometry.default';
          report.referencesRepaired += 1;
          changed = true;
          report.log.push(
            `[IDENTITY] ${path}: "${controllerId}" selects Geometry.${ref.key}, but ${fallback} declares no geometry."${ref.key}" — the selection was rebound to Geometry.default, which it does declare.`,
          );
          continue;
        }
        report.unresolved.push(`${path}: ${controllerId} → Geometry.${ref.key}`);
      }
    }
    if (changed) rp[path] = JSON.stringify(doc, null, 2);
  }

  // 5. Behaviour-pack consumers: block geometry components and item geometry components.
  for (const path of Object.keys(bp)) {
    const lower = path.toLowerCase();
    if (!/^(blocks|items)\/.+\.json$/.test(lower)) continue;
    const text = decode(bp[path]);
    if (!text || !text.includes('minecraft:geometry')) continue;
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(text) as Record<string, unknown>;
    } catch {
      continue;
    }
    let changed = false;
    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'minecraft:geometry' && value && typeof value === 'object' && !Array.isArray(value)) {
          const component = value as Record<string, unknown>;
          const identifier = typeof component.identifier === 'string' ? component.identifier : '';
          const resolved = identifier ? resolveReference(identifier) : null;
          if (resolved && resolved !== identifier) {
            component.identifier = resolved;
            report.referencesRepaired += 1;
            changed = true;
          } else if (identifier && !resolved) {
            report.unresolved.push(`${path}: ${identifier}`);
          }
          continue;
        }
        visit(value);
      }
    };
    visit(doc);
    if (changed) bp[path] = JSON.stringify(doc, null, 2);
  }

  // 6. Final verification: after every repair, no shipped document may still point at a
  //    geometry identifier that no shipped model declares. Engine-owned identifiers and
  //    client-map keys (`Geometry.<key>`) resolve inside the engine and are exempt.
  const verifyReference = (owner: string, value: string): void => {
    const clean = value.trim();
    if (!clean || !/^geometry\./.test(clean)) return;
    if (used.has(clean) || VANILLA_GEOMETRY.test(clean)) return;
    if (used.has(canonicalGeometryId(modId, clean))) return;
    const entry = `${owner}: ${clean}`;
    if (!report.unresolved.includes(entry)) report.unresolved.push(entry);
  };
  for (const path of Object.keys(rp)) {
    if (!/^(entity\/|attachables\/|render_controllers\/|models\/)/i.test(path)) continue;
    const text = decode(rp[path]);
    if (!text || !/geometry\./.test(text)) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(text) as unknown;
    } catch {
      continue;
    }
    const walk = (node: unknown): void => {
      if (typeof node === 'string') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [, value] of Object.entries(node as Record<string, unknown>)) {
        if (typeof value === 'string') verifyReference(path, value);
        else walk(value);
      }
    };
    walk(doc);
  }

  // 7. The registry is the single authority. A client entity that still resolves to no
  // shipped model fails the build: a model the engine cannot resolve renders nothing, which
  // is exactly the defect this registry exists to prevent.
  report.passed = report.clientEntityFailures.length === 0;
  if (!report.passed) {
    report.log.push(
      `[IDENTITY:FAIL] ${report.clientEntityFailures.length} client entity geometry reference(s) resolve to no shipped model — every client entity must resolve through the single registry, so the build FAILS instead of shipping a model that renders nothing: ${report.clientEntityFailures.slice(0, 6).join(' | ')}${report.clientEntityFailures.length > 6 ? ' …' : ''}`,
    );
  }

  report.log.unshift(
    `[IDENTITY] Canonical geometry registry: ${report.geometryFiles} model file(s) / ${report.geometries} geometry variant(s) registered, ${report.identifiersNormalised} identifier(s) normalised, ${report.aliasesCollapsed} duplicate alias(es) collapsed, ${report.referencesRepaired} reference(s) repaired.`,
  );
  if (report.unresolved.length > 0) {
    report.log.push(
      `[IDENTITY:WARN] ${report.unresolved.length} geometry reference(s) resolve to no shipped model and were left UNRESOLVED: ${report.unresolved.slice(0, 6).join(' | ')}${report.unresolved.length > 6 ? ' …' : ''}`,
    );
  }
  for (const line of report.log) options.onLog?.(line);
  return report;
}