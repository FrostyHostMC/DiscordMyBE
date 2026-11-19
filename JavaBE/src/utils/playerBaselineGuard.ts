import {
  PLAYER_BASELINE_ENTRIES,
  VANILLA_PLAYER_ANIMATION_IDS,
  VANILLA_PLAYER_CONTROLLER_IDS,
  VANILLA_PLAYER_ANIMATE,
  VANILLA_PLAYER_INITIALIZE,
  VANILLA_PLAYER_PRE_ANIMATION,
  VANILLA_PLAYER_VARIABLES,
  VANILLA_PLAYER_RENDER_CONTROLLERS,
  VANILLA_PLAYER_RENDER_CONTROLLER_IDS,
} from '@/utils/vanillaPlayerBaseline';

/**
 * Final guarantee pass over every document that defines `minecraft:player`.
 *
 * A resource pack may ship more than one client entity whose description declares
 * `minecraft:player` — a generated document, a relocated copy, a merged template. The engine keeps
 * one of them, and a definition that lost the vanilla alias map plays like a player whose animation
 * resources do not exist: "can't find animation base_pose / look_at_target /
 * first_person_base_pose" on every load, even though the pack's own clips are registered.
 *
 * This pass is not a repair of a named defect; it is the invariant. Every player definition that
 * ships declares the full engine-provided alias map, but only the vanilla root controller is started
 * directly. That controller owns the first-/third-person state graph and layers the other aliases;
 * starting every alias independently would double-play poses and bypass the vanilla state gates.
 */

export interface PlayerBaselineGuardReport {
  /** Every shipped document whose description declares `minecraft:player`. */
  documents: string[];
  aliasesRestored: number;
  animateEntriesRestored: number;
  renderControllersRestored: number;
  /** Animate entries that still address no alias and no shipped definition, reported per document. */
  danglingEntries: Array<{ document: string; alias: string }>;
  summary: string;
}

type Json = Record<string, any>;

function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectGenericFallbackRenderControllerIds(files: Record<string, string | Uint8Array>): Set<string> {
  const ids = new Set<string>();
  for (const [path, raw] of Object.entries(files)) {
    if (!path.startsWith('render_controllers/') || !path.endsWith('.json') || typeof raw !== 'string') continue;
    const doc = parseJson(raw);
    const controllers = isRecord(doc?.render_controllers) ? doc.render_controllers : {};
    for (const [id, rawController] of Object.entries(controllers)) {
      if (!isRecord(rawController)) continue;
      const materials = rawController.materials;
      const textures = rawController.textures;
      const defaultMaterial = Array.isArray(materials) && materials.length === 1
        && isRecord(materials[0]) && materials[0]['*'] === 'Material.default';
      const defaultTexture = textures === 'Texture.default'
        || (Array.isArray(textures) && textures.length === 1 && textures[0] === 'Texture.default');
      const onlyGenericBindings = rawController.geometry === 'Geometry.default'
        && defaultMaterial && defaultTexture
        && !rawController.arrays && !rawController.part_visibility
        && !rawController.color && !rawController.is_hurt_color && !rawController.on_fire_color;
      if (onlyGenericBindings && id.startsWith('controller.render.')) ids.add(id);
    }
  }
  return ids;
}


/** Merge the vanilla player script contract without dropping mod-owned script entries. */
function mergeBaselineScriptEntries(existing: unknown, baseline: string[]): { entries: string[]; changed: boolean } {
  const entries = Array.isArray(existing)
    ? existing.filter((entry): entry is string => typeof entry === 'string')
    : typeof existing === 'string' ? [existing] : [];
  let changed = false;
  const baselineNames = new Set<string>();
  for (const statement of baseline) {
    for (const match of statement.matchAll(/\\b(?:variable|v|temp|t)\\.([a-zA-Z0-9_]+)\\s*=(?!=)/g)) {
      baselineNames.add(String(match[1]));
    }
  }
  // Replace old vanilla assignments by variable name so an older partial baseline cannot
  // override the current Mojang expression later in the same pre_animation pass.
  const filtered = entries.filter((entry) => {
    const assigned = [...entry.matchAll(/\\b(?:variable|v)\\.([a-zA-Z0-9_]+)\\s*=(?!=)/g)].map((match) => String(match[1]));
    const isSuperseded = assigned.some((name) => baselineNames.has(name));
    if (isSuperseded) changed = true;
    return !isSuperseded;
  });
  const merged = [...filtered];
  for (const statement of baseline) {
    if (!merged.includes(statement)) {
      merged.push(statement);
      changed = true;
    }
  }
  return { entries: merged, changed };
}

function parseJson(raw: string | Uint8Array | undefined): Json | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Identifiers the shipped archive defines, so an alias can be told apart from a dangling name. */
function indexDefinitions(files: Record<string, string | Uint8Array>): Set<string> {
  const defined = new Set<string>();
  for (const [path, raw] of Object.entries(files)) {
    const lower = path.toLowerCase();
    if (typeof raw !== 'string' || !lower.endsWith('.json')) continue;
    const doc = parseJson(raw);
    if (!doc) continue;
    for (const container of ['animations', 'animation_controllers']) {
      const block = doc[container];
      if (isRecord(block)) for (const id of Object.keys(block)) defined.add(id);
    }
  }
  for (const id of VANILLA_PLAYER_ANIMATION_IDS) defined.add(id);
  for (const id of VANILLA_PLAYER_CONTROLLER_IDS) defined.add(id);
  return defined;
}

export function guaranteePlayerBaselineWiring(input: {
  resourcePackFiles: Record<string, string | Uint8Array>;
  onLog?: (line: string) => void;
}): PlayerBaselineGuardReport {
  const log = (line: string) => input.onLog?.(line);
  const files = input.resourcePackFiles;
  const report: PlayerBaselineGuardReport = {
    documents: [],
    aliasesRestored: 0,
    animateEntriesRestored: 0,
    renderControllersRestored: 0,
    danglingEntries: [],
    summary: '',
  };
  const defined = indexDefinitions(files);
  const genericFallbackRenderControllerIds = collectGenericFallbackRenderControllerIds(files);

  for (const [path, raw] of Object.entries(files)) {
    if (typeof raw !== 'string' || !/\.entity\.json$/i.test(path)) continue;
    const doc = parseJson(raw);
    const client = doc?.['minecraft:client_entity'];
    const description = isRecord(client) ? client.description : undefined;
    if (!isRecord(description) || description.identifier !== 'minecraft:player') continue;
    report.documents.push(path);

    const animations: Record<string, unknown> = isRecord(description.animations)
      ? { ...description.animations }
      : {};
    const scripts: Record<string, unknown> = isRecord(description.scripts) ? { ...description.scripts } : {};
    const initializeMerge = mergeBaselineScriptEntries(scripts.initialize, VANILLA_PLAYER_INITIALIZE);
    const preAnimationMerge = mergeBaselineScriptEntries(scripts.pre_animation, VANILLA_PLAYER_PRE_ANIMATION);
    const existingVariables = isRecord(scripts.variables) ? scripts.variables : {};
    const variables = { ...existingVariables, ...VANILLA_PLAYER_VARIABLES };
    const variablesChanged = JSON.stringify(existingVariables) !== JSON.stringify(variables);
    const animate: unknown[] = Array.isArray(scripts.animate)
      ? scripts.animate.filter((entry) => !(typeof entry === 'string'
        ? entry === 'base_controller'
        : isRecord(entry) && 'base_controller' in entry))
      : [];
    // Mojang's current player controller set does not define controller.animation.player.base.
    // Do not activate the stale base_controller alias copied in older player.entity baselines.
    const existingRenderControllers: unknown[] = Array.isArray(description.render_controllers)
      ? [...description.render_controllers]
      : [];
    const existingRenderControllerIds = new Set(existingRenderControllers.flatMap((entry) =>
      typeof entry === 'string' ? [entry] : isRecord(entry) ? Object.keys(entry) : [],
    ));
    const retainedCustomRenderControllers = existingRenderControllers.filter((entry) => {
      const ids = typeof entry === 'string' ? [entry] : isRecord(entry) ? Object.keys(entry) : [];
      return ids.some((id) => !VANILLA_PLAYER_RENDER_CONTROLLER_IDS.has(id)
        && !genericFallbackRenderControllerIds.has(id));
    });
    const nextRenderControllers = [...VANILLA_PLAYER_RENDER_CONTROLLERS, ...retainedCustomRenderControllers];
    const renderControllersChanged = JSON.stringify(existingRenderControllers) !== JSON.stringify(nextRenderControllers);
    if (renderControllersChanged) {
      report.renderControllersRestored += [...VANILLA_PLAYER_RENDER_CONTROLLER_IDS]
        .filter((id) => !existingRenderControllerIds.has(id)).length
        + [...existingRenderControllerIds].filter((id) => genericFallbackRenderControllerIds.has(id)).length;
    }
    let changed = !isRecord(description.animations) || renderControllersChanged
      || initializeMerge.changed || preAnimationMerge.changed || variablesChanged;
    scripts.initialize = initializeMerge.entries;
    scripts.pre_animation = preAnimationMerge.entries;
    scripts.variables = variables;

    for (const entry of PLAYER_BASELINE_ENTRIES) {
      if (animations[entry.alias] !== entry.identifier) {
        animations[entry.alias] = entry.identifier;
        report.aliasesRestored += 1;
        changed = true;
      }
      const shouldAnimateDirectly = VANILLA_PLAYER_ANIMATE.some((item) =>
        typeof item === 'string' ? item === entry.alias : isRecord(item) && entry.alias in item,
      );
      const bound = animate.some((item) =>
        typeof item === 'string' ? item === entry.alias : isRecord(item) && entry.alias in item,
      );
      if (shouldAnimateDirectly && !bound) {
        animate.push(entry.alias);
        report.animateEntriesRestored += 1;
        changed = true;
      }
    }

    for (const item of animate) {
      const names = typeof item === 'string' ? [item] : isRecord(item) ? Object.keys(item) : [];
      for (const alias of names) {
        if (typeof animations[alias] === 'string') continue;
        if (defined.has(alias)) {
          animations[alias] = alias;
          report.aliasesRestored += 1;
          changed = true;
          continue;
        }
        report.danglingEntries.push({ document: path, alias });
      }
    }

    if (!changed) continue;
    description.animations = animations;
    description.render_controllers = nextRenderControllers;
    scripts.animate = animate;
    description.scripts = scripts;
    files[path] = JSON.stringify(doc, null, 2);
  }

  report.summary =
    report.documents.length === 0
      ? 'No document in the exported pack declares minecraft:player, so no baseline player wiring exists to guarantee. Nothing was invented in its place.'
      : `${report.documents.length} player client-entity document(s) carried the engine baseline: ` +
        `${report.aliasesRestored} alias(es) restored, ${report.animateEntriesRestored} scripts.animate entry/ies restored, ` +
        `${report.renderControllersRestored} vanilla render-controller binding(s) restored or generic fallback(s) removed, ` +
        `${report.danglingEntries.length} activation entry/ies still address no definition (reported, not replaced).`;
  log(`[PLAYER:GUARD] ${report.summary}`);
  if (report.documents.length > 1) {
    log(
      `[PLAYER:GUARD:DUPLICATE] ${report.documents.length} shipped documents declare minecraft:player (${report.documents.join(', ')}). ` +
        'Duplicate client-entity definitions are ambiguous for the engine, so every one of them is wired to the same baseline rather than leaving the selected definition dependent on load order.',
    );
  }
  for (const entry of report.danglingEntries.slice(0, 6)) {
    log(
      `[PLAYER:GUARD:DANGLING] ${entry.document}: scripts.animate "${entry.alias}" names no declared alias and no shipped definition; it activates nothing.`,
    );
  }
  return report;
}