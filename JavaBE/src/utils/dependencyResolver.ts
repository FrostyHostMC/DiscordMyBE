import type { DecompileStats } from '@/types/remaker';

export type DependencyMatchKind = 'builtin' | 'matched' | 'unresolved';

export interface DependencyResolution {
  /** Raw Java mod id detected in metadata */
  javaId: string;
  /** How the dependency is satisfied in Bedrock */
  kind: DependencyMatchKind;
  /** Human-readable name of the Bedrock equivalent */
  bedrockName?: string;
  /** Why / how it is satisfied */
  note: string;
}

/**
 * Catalog of common Java mod dependencies mapped to Bedrock-compatible
 * addon equivalents or built-in Bedrock systems.
 */
const BEDROCK_EQUIVALENTS: Record<string, { name?: string; note: string; kind: DependencyMatchKind }> = {
  fabric: { note: 'Loader-only dependency — not needed on Bedrock; behavior handled natively.', kind: 'builtin' },
  quilt: { note: 'Loader-only dependency — not needed on Bedrock; behavior handled natively.', kind: 'builtin' },
  forge: { note: 'Loader-only dependency — not needed on Bedrock; behavior handled natively.', kind: 'builtin' },
  neoforge: { note: 'Loader-only dependency — not needed on Bedrock; behavior handled natively.', kind: 'builtin' },
  'fabric-api': { name: 'Bedrock Script API', note: 'Covered natively by Bedrock @minecraft/server Script API.', kind: 'builtin' },
  fabric_api: { name: 'Bedrock Script API', note: 'Covered natively by Bedrock @minecraft/server Script API.', kind: 'builtin' },
  geckolib: { name: 'Bedrock Molang Animation Engine', note: 'GeckoLib models & animations map directly to Bedrock Molang geometry & animation controllers.', kind: 'builtin' },
  curios: { name: 'Bedrock Equipment Components', note: 'Custom slots map to Bedrock item wearable components (head, chest, offhand).', kind: 'builtin' },
  trinkets: { name: 'Bedrock Equipment Components', note: 'Trinket slots map to Bedrock wearable components and offhand equipment.', kind: 'builtin' },
  patchouli: { name: 'Bedrock Custom Book & UI', note: 'Documentation books translate to Bedrock Script API modal form dialogues.', kind: 'builtin' },
  pehkui: { name: 'Bedrock Scale Component', note: 'Size scaling maps to Bedrock entity "minecraft:scale" component.', kind: 'builtin' },
  cloth_config: { name: 'Bedrock UI (JSON UI)', note: 'Config screens are replaced by native Bedrock JSON UI settings.', kind: 'builtin' },
  modmenu: { note: 'Mod menu is a Java launcher feature; Bedrock manages addons natively.', kind: 'builtin' },
  jei: { name: 'Native Recipe Book', note: 'Recipe viewing is built into the Bedrock recipe book UI.', kind: 'builtin' },
  rei: { name: 'Native Recipe Book', note: 'Recipe viewing is built into the Bedrock recipe book UI.', kind: 'builtin' },
  emi: { name: 'Native Recipe Book', note: 'Recipe viewing is built into the Bedrock recipe book UI.', kind: 'builtin' },
  appleskin: { name: 'Bedrock HUD & Nutrition Stats', note: 'Nutrition and saturation are displayed natively in Bedrock HUD.', kind: 'builtin' },
  jade: { name: 'Built-in Block Inspector', note: 'Education Edition block inspector covers component tooltips.', kind: 'builtin' },
  wthit: { name: 'Built-in Block Inspector', note: 'Block HUD inspect maps to Bedrock actionbar tooltips.', kind: 'builtin' },
  farmersdelight: { name: 'Farmer\'s Delight Bedrock Edition', note: 'Available as a verified community port on mcpedl.', kind: 'matched' },
  ae2: { name: 'Automation addons (e.g. "Advanced Automation" addon)', note: 'Search Minecraft Marketplace / mcpedl for a digital-storage addon.', kind: 'matched' },
  create: { name: 'Mechanical/machinery addons (e.g. "Create-like" contraption addons)', note: 'Several Marketplace addons provide gears & conveyor mechanics.', kind: 'matched' },
  ironchests: { name: 'Iron Chests Bedrock Addon', note: 'Tiered storage containers map to custom Bedrock container entities.', kind: 'matched' },
  je: { name: 'World-edit addons', note: 'Marketplace world-edit addons cover this capability.', kind: 'matched' },
  worldedit: { name: 'WorldEdit Bedrock Edition addon', note: 'Available as a community .mcaddon on mcpedl.', kind: 'matched' },
  journeymap: { name: 'Native Locator Bar / Map', note: 'Bedrock has native maps and player locator features.', kind: 'builtin' },
  xaerominimap: { name: 'Native Map', note: 'Use Bedrock native map + locator bar.', kind: 'builtin' },
  sodium: { note: 'Performance-only dependency — Bedrock engine already handles rendering.', kind: 'builtin' },
  rubidium: { note: 'Performance-only dependency — Bedrock engine already handles rendering.', kind: 'builtin' },
  iris: { note: 'Shader loader dependency — Bedrock renders with its own pipeline.', kind: 'builtin' },
  oculus: { note: 'Shader loader dependency — Bedrock renders with its own pipeline.', kind: 'builtin' },
  sophisticatedbackpacks: { name: 'Portable Storage addons (e.g. "Portable Containers")', note: 'Multiple Marketplace storage addons exist; the ported addon also includes its own items.', kind: 'matched' },
  cerbons: { name: 'Accessory/equipment addons', note: 'Bedrock wearable components replace accessory-slot APIs.', kind: 'builtin' },
  searchables: { note: 'Inventory search is native in Bedrock creative/inventory UI.', kind: 'builtin' },
  breadcrumbs: { note: 'Cosmetic/trail dependency — no direct need on Bedrock.', kind: 'builtin' },
  supplementaries: { name: 'Decor & storage community addons', note: 'Community decor addons on mcpedl cover lamps, jars, and planter items.', kind: 'matched' },
  botania: { name: 'Magic/flower community addons', note: 'Community magic addons on mcpedl approximate this.', kind: 'matched' },
  techreborn: { name: 'Tech/power community addons', note: 'Marketplace tech addons provide machines & power.', kind: 'matched' },
  industrialforegoing: { name: 'Automation community addons', note: 'Marketplace automation addons provide machines & conveyors.', kind: 'matched' },
  mekanism: { name: 'Tech/power community addons', note: 'Marketplace tech addons provide machines, gases & power.', kind: 'matched' },
};

/**
 * Resolves each detected Java dependency against the Bedrock compatibility
 * catalog. Deterministic — no network calls — so it also works when AI
 * assistance is unavailable.
 */
export function resolveDependencies(deps: string[]): DependencyResolution[] {
  const results: DependencyResolution[] = [];
  for (const raw of deps) {
    const id = raw.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    if (!id) continue;
    const entry = BEDROCK_EQUIVALENTS[id];
    if (entry) {
      results.push({ javaId: raw, kind: entry.kind, bedrockName: entry.name, note: entry.note });
      continue;
    }
    // Fuzzy: check known keys as prefixes (e.g. "xaeroworldmap" -> xaerominimap family)
    const fuzzyKey = Object.keys(BEDROCK_EQUIVALENTS).find((k) => id.startsWith(k) || k.startsWith(id));
    if (fuzzyKey) {
      const entry = BEDROCK_EQUIVALENTS[fuzzyKey];
      results.push({ javaId: raw, kind: entry.kind, bedrockName: entry.name, note: entry.note });
      continue;
    }
    results.push({
      javaId: raw,
      kind: 'unresolved',
      note: 'No known Bedrock equivalent — the ported addon bundles its own items so core content still works.',
    });
  }
  return results;
}

/** Logs + attaches resolved dependencies to decompile stats. */
export function applyDependencyResolution(
  stats: DecompileStats,
  log: (line: string) => void,
): DependencyResolution[] {
  const resolutions = resolveDependencies(stats.dependencies);
  stats.resolvedDependencies = resolutions;
  if (resolutions.length === 0) return resolutions;
  log('[DEPS] Resolving Java dependencies against Bedrock compatibility catalog...');
  for (const r of resolutions) {
    if (r.kind === 'builtin') {
      log(`[DEPS] ✓ "${r.javaId}" — satisfied natively: ${r.note}`);
    } else if (r.kind === 'matched') {
      log(`[DEPS] ✓ "${r.javaId}" — Bedrock equivalent available: ${r.bedrockName ?? 'addon'}. ${r.note}`);
    } else {
      log(`[DEPS] ! "${r.javaId}" — no known Bedrock equivalent. ${r.note}`);
    }
  }
  const matched = resolutions.filter((r) => r.kind !== 'unresolved').length;
  log(`[DEPS] Dependency resolution complete: ${matched}/${resolutions.length} satisfied in Bedrock.`);
  return resolutions;
}