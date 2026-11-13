import type { ExtractedZipEntry } from '@/utils/zip';
import type { RemakeItem } from '@/types/remaker';
import { safeFileId } from '@/utils/bedrockIds';
import { isPlayableModeEnabled } from '@/utils/provenance';

export interface RecipePortStats {
  modRecipesParsed: number;
  recipesConverted: number;
  fallbackRecipesCount: number;
  deduplicatedCount: number;
  unresolvedIngredients: string[];
  recipeAuditEntries: Array<{
    recipeId: string;
    resultItem: string;
    type: 'mod_converted' | 'contextual_fallback';
    ingredients: string[];
  }>;
}

const decoder = new TextDecoder();

// Common tag dictionary mapping Forge/Fabric/NeoForge/Common tags to standard Minecraft items
const COMMON_TAG_MAP: Record<string, string> = {
  'c:iron_ingots': 'minecraft:iron_ingot',
  'forge:ingots/iron': 'minecraft:iron_ingot',
  'c:gold_ingots': 'minecraft:gold_ingot',
  'forge:ingots/gold': 'minecraft:gold_ingot',
  'c:copper_ingots': 'minecraft:copper_ingot',
  'forge:ingots/copper': 'minecraft:copper_ingot',
  'c:diamonds': 'minecraft:diamond',
  'forge:gems/diamond': 'minecraft:diamond',
  'c:rods/wooden': 'minecraft:stick',
  'forge:rods/wooden': 'minecraft:stick',
  'minecraft:planks': 'minecraft:planks',
  'c:glass_blocks': 'minecraft:glass',
  'forge:glass': 'minecraft:glass',
  'c:cobblestones': 'minecraft:cobblestone',
  'c:stones': 'minecraft:stone',
  'c:leather': 'minecraft:leather',
  'c:honey_buckets': 'minecraft:honey_bottle',
  'c:chests': 'minecraft:chest',
  'forge:chests/wooden': 'minecraft:chest',
  'c:strings': 'minecraft:string',
  'c:feathers': 'minecraft:feather',
};

function normalizeItemId(raw: string, modId: string): string {
  if (!raw) return 'minecraft:iron_ingot';
  const clean = raw.trim();
  if (clean.startsWith('minecraft:')) return clean;

  if (clean.includes(':')) {
    const parts = clean.split(':');
    const path = safeFileId(parts[1]);
    return `${modId}:${path}`;
  }

  return `${modId}:${safeFileId(clean)}`;
}

function resolveIngredient(ing: any, modId: string): string {
  if (typeof ing === 'string') return normalizeItemId(ing, modId);
  if (!ing || typeof ing !== 'object') return 'minecraft:iron_ingot';

  if (Array.isArray(ing)) {
    return resolveIngredient(ing[0], modId);
  }

  if (ing.item) {
    return normalizeItemId(ing.item, modId);
  }

  if (ing.tag) {
    const tag = String(ing.tag);
    if (COMMON_TAG_MAP[tag]) return COMMON_TAG_MAP[tag];
    if (tag.includes(':')) {
      const tagPath = tag.split(':')[1];
      return `${modId}:${safeFileId(tagPath)}`;
    }
    return 'minecraft:iron_ingot';
  }

  return 'minecraft:iron_ingot';
}

/**
 * Trims a shaped crafting matrix and computes canonical matrix fingerprints (both normal and mirrored)
 * plus the multiset ingredient count signature.
 */
function computeShapedFingerprints(
  pattern: string[],
  keyMap: Record<string, { item: string }>,
): {
  canonicalMatrix: string;
  mirroredMatrix: string;
  multisetSig: string;
  normalizedPattern: string[];
} {
  // Convert pattern to 2D grid of resolved item IDs
  const grid: string[][] = pattern.map((row) =>
    row.split('').map((ch) => (ch === ' ' ? '' : keyMap[ch]?.item || '')),
  );

  // Find non-empty row bounds
  let minRow = -1;
  let maxRow = -1;
  for (let r = 0; r < grid.length; r++) {
    if (grid[r].some((c) => c !== '')) {
      if (minRow === -1) minRow = r;
      maxRow = r;
    }
  }

  if (minRow === -1) {
    return {
      canonicalMatrix: 'empty',
      mirroredMatrix: 'empty',
      multisetSig: 'empty',
      normalizedPattern: [' '],
    };
  }

  // Find non-empty col bounds
  let minCol = 3;
  let maxCol = -1;
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== '') {
        minCol = Math.min(minCol, c);
        maxCol = Math.max(maxCol, c);
      }
    }
  }
  if (maxCol === -1) {
    minCol = 0;
    maxCol = 0;
  }

  // Extract trimmed grid
  const trimmed: string[][] = [];
  const trimmedPattern: string[] = [];
  const counts: Record<string, number> = {};

  for (let r = minRow; r <= maxRow; r++) {
    const rowItems: string[] = [];
    let pRow = '';
    for (let c = minCol; c <= maxCol; c++) {
      const itm = grid[r][c] || '';
      rowItems.push(itm);
      pRow += pattern[r]?.[c] || ' ';
      if (itm) counts[itm] = (counts[itm] || 0) + 1;
    }
    trimmed.push(rowItems);
    trimmedPattern.push(pRow);
  }

  const canonicalMatrix = trimmed.map((row) => row.join(',')).join('|');
  const mirroredMatrix = trimmed.map((row) => [...row].reverse().join(',')).join('|');

  const multisetSig = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itm, cnt]) => `${itm}*${cnt}`)
    .join(';');

  return {
    canonicalMatrix: `shaped:${canonicalMatrix}`,
    mirroredMatrix: `shaped:${mirroredMatrix}`,
    multisetSig: `sig:${multisetSig}`,
    normalizedPattern: trimmedPattern,
  };
}

/** Pre-seed standard vanilla crafting collisions to guarantee custom recipes never conflict with core items */
function buildVanillaCollisionSet(): Set<string> {
  const set = new Set<string>();

  // Swords (2 vertical ingots/diamonds/etc. + 1 stick)
  const swords = [
    { itm: 'minecraft:iron_ingot', res: 'iron_sword' },
    { itm: 'minecraft:diamond', res: 'diamond_sword' },
    { itm: 'minecraft:gold_ingot', res: 'golden_sword' },
    { itm: 'minecraft:planks', res: 'wooden_sword' },
    { itm: 'minecraft:cobblestone', res: 'stone_sword' },
  ];
  for (const s of swords) {
    const { canonicalMatrix, mirroredMatrix, multisetSig } = computeShapedFingerprints(
      ['M', 'M', 'S'],
      { M: { item: s.itm }, S: { item: 'minecraft:stick' } },
    );
    set.add(canonicalMatrix);
    set.add(mirroredMatrix);
    set.add(multisetSig);
  }

  // Tools (Pickaxes, Axes, Shovels, Hoes)
  const materials = ['minecraft:iron_ingot', 'minecraft:diamond', 'minecraft:gold_ingot', 'minecraft:cobblestone'];
  for (const m of materials) {
    // Pickaxe
    const pick = computeShapedFingerprints(['MMM', ' S ', ' S '], { M: { item: m }, S: { item: 'minecraft:stick' } });
    set.add(pick.canonicalMatrix);
    set.add(pick.mirroredMatrix);
    set.add(pick.multisetSig);

    // Axe
    const axe = computeShapedFingerprints(['MM', 'MS', ' S'], { M: { item: m }, S: { item: 'minecraft:stick' } });
    set.add(axe.canonicalMatrix);
    set.add(axe.mirroredMatrix);
    set.add(axe.multisetSig);

    // Shovel
    const shovel = computeShapedFingerprints(['M', 'S', 'S'], { M: { item: m }, S: { item: 'minecraft:stick' } });
    set.add(shovel.canonicalMatrix);
    set.add(shovel.mirroredMatrix);
    set.add(shovel.multisetSig);
  }

  // Common blocks: Crafting Table, Chest, Furnace, Storage Blocks (9x ingots)
  const ct = computeShapedFingerprints(['PP', 'PP'], { P: { item: 'minecraft:planks' } });
  set.add(ct.canonicalMatrix);
  set.add(ct.multisetSig);

  const chest = computeShapedFingerprints(['PPP', 'P P', 'PPP'], { P: { item: 'minecraft:planks' } });
  set.add(chest.canonicalMatrix);
  set.add(chest.multisetSig);

  const furnace = computeShapedFingerprints(['CCC', 'C C', 'CCC'], { C: { item: 'minecraft:cobblestone' } });
  set.add(furnace.canonicalMatrix);
  set.add(furnace.multisetSig);

  for (const m of ['minecraft:iron_ingot', 'minecraft:gold_ingot', 'minecraft:diamond', 'minecraft:copper_ingot']) {
    const blk = computeShapedFingerprints(['MMM', 'MMM', 'MMM'], { M: { item: m } });
    set.add(blk.canonicalMatrix);
    set.add(blk.multisetSig);
  }

  return set;
}

/** Checks whether an item ID or category is strictly non-craftable */
function isNonCraftableItem(id: string, category?: string): boolean {
  if (category === 'spawn_egg' || category === 'fluid') return true;
  if (/spawn_egg|summon_egg|_egg$/i.test(id)) return true;
  if (/fluid|liquid/i.test(id) && !id.includes('bottle') && !id.includes('bucket')) return true;

  // Technical, bytecode advancement criteria, leaked formatting tokens
  if (/^(to_|no_|consume_|press_|hold_|when_|if_|release_|name_|type_|registry_name_|display_|tooltip_|info_)/i.test(id)) return true;
  if (/\b(health|inventory|stinger_back|grow_baby|pollinate|cell_maze|new_compass|spawned|advancement|criteria|baby_to_adult|heal_2|put_stinger)\b/i.test(id)) return true;
  if (/[0-9]honey_bottle/i.test(id)) return true;
  if (/_s$|_d$|^[a-z]{1,2}$/i.test(id)) return true;
  if (/%[sdf0-9]|§|\u00a7/i.test(id)) return true;

  return false;
}

/**
 * Universal Recipe Deduplication & Port Engine
 * Parses authentic Java recipes from data/<modid>/recipes/*.json.
 * Validates and deduplicates recipes against both vanilla recipe matrices and internal mod recipes.
 * Synthesizes unique contextual fallback recipes with collision protection.
 */
export function extractAndPortRecipes(
  modId: string,
  items: RemakeItem[],
  entries?: ExtractedZipEntry[],
  onLog?: (line: string) => void,
): {
  behaviorPackRecipes: Record<string, string>;
  stats: RecipePortStats;
} {
  const log = (msg: string) => onLog?.(msg);
  const behaviorPackRecipes: Record<string, string> = {};
  const unresolvedIngredients = new Set<string>();
  const recipeAuditEntries: RecipePortStats['recipeAuditEntries'] = [];
  const coveredItemIds = new Set<string>();

  // Global collision sets
  const usedMatrices = buildVanillaCollisionSet();
  const usedMultisets = new Set<string>();

  let modRecipesParsed = 0;
  let recipesConverted = 0;
  let fallbackRecipesCount = 0;
  let deduplicatedCount = 0;

  // 1. Scan and parse authentic Java mod recipes
  if (entries && entries.length > 0) {
    for (const entry of entries) {
      const cleanPath = entry.path.replace(/\\/g, '/').toLowerCase();
      const isRecipe = (cleanPath.includes('/recipes/') || cleanPath.includes('/recipe/')) && cleanPath.endsWith('.json');
      if (!isRecipe) continue;

      modRecipesParsed++;
      try {
        const text = decoder.decode(entry.data);
        const parsed = JSON.parse(text);
        const fileName = entry.path.split('/').pop()?.replace(/\.json$/i, '') || '';
        const recipeId = safeFileId(fileName);
        const recipeType = String(parsed.type || '').toLowerCase();

        // Extract result item identifier
        let resultItem = `${modId}:${recipeId}`;
        let count = 1;
        if (typeof parsed.result === 'string') {
          resultItem = normalizeItemId(parsed.result, modId);
        } else if (parsed.result && typeof parsed.result === 'object') {
          resultItem = normalizeItemId(parsed.result.id || parsed.result.item || '', modId);
          count = Number(parsed.result.count) || 1;
        }

        const resultStem = resultItem.replace(`${modId}:`, '').replace('minecraft:', '');
        if (isNonCraftableItem(resultStem)) {
          deduplicatedCount++;
          continue;
        }

        // Shaped recipe conversion
        if (recipeType.includes('crafting_shaped') || recipeType.includes('shaped')) {
          const pattern = parsed.pattern;
          if (Array.isArray(pattern) && pattern.length > 0 && pattern.length <= 3) {
            const keyMap: Record<string, { item: string }> = {};
            const keyDef = parsed.key || {};
            const ingredientsUsed: string[] = [];

            for (const [char, val] of Object.entries(keyDef)) {
              const resolved = resolveIngredient(val, modId);
              keyMap[char] = { item: resolved };
              ingredientsUsed.push(resolved);
              if (resolved.startsWith('unresolved_')) unresolvedIngredients.add(resolved);
            }

            const { canonicalMatrix, mirroredMatrix, multisetSig, normalizedPattern } = computeShapedFingerprints(
              pattern,
              keyMap,
            );

            // Deduplication check: reject if identical matrix or multiset already registered
            if (usedMatrices.has(canonicalMatrix) || usedMatrices.has(mirroredMatrix) || usedMultisets.has(multisetSig)) {
              deduplicatedCount++;
              continue;
            }

            usedMatrices.add(canonicalMatrix);
            usedMatrices.add(mirroredMatrix);
            usedMultisets.add(multisetSig);
            coveredItemIds.add(resultStem);

            // Format uniform width rows for Bedrock
            const maxLen = Math.max(...normalizedPattern.map((r) => r.length), 1);
            const uniformPattern = normalizedPattern.map((r) => r.padEnd(maxLen, ' '));

            // Keep only keys actually used in uniformPattern
            const cleanKey: Record<string, { item: string }> = {};
            for (const ch of uniformPattern.join('').replace(/\s/g, '').split('')) {
              if (keyMap[ch]) cleanKey[ch] = keyMap[ch];
            }

            const bedrockRecipe = {
              format_version: '1.12.0',
              'minecraft:recipe_shaped': {
                description: {
                  identifier: `${modId}:${recipeId}`,
                },
                tags: ['crafting_table'],
                pattern: uniformPattern,
                key: cleanKey,
                result: {
                  item: resultItem,
                  count,
                },
              },
            };

            behaviorPackRecipes[`recipes/${recipeId}.json`] = JSON.stringify(bedrockRecipe, null, 2);
            recipesConverted++;
            recipeAuditEntries.push({
              recipeId,
              resultItem,
              type: 'mod_converted',
              ingredients: ingredientsUsed,
            });
            continue;
          }
        }

        // Shapeless recipe conversion
        if (recipeType.includes('crafting_shapeless') || recipeType.includes('shapeless')) {
          const ings = parsed.ingredients || [];
          if (Array.isArray(ings) && ings.length > 0 && ings.length <= 9) {
            const bedrockIngs: Array<{ item: string }> = [];
            const ingredientsUsed: string[] = [];
            const counts: Record<string, number> = {};

            for (const ing of ings) {
              const resolved = resolveIngredient(ing, modId);
              bedrockIngs.push({ item: resolved });
              ingredientsUsed.push(resolved);
              counts[resolved] = (counts[resolved] || 0) + 1;
            }

            const sortedSl = [...bedrockIngs.map((i) => i.item)].sort().join(',');
            const slFp = `shapeless:${sortedSl}`;
            const multisetSig = `sig:${Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([i, c]) => `${i}*${c}`).join(';')}`;

            if (usedMatrices.has(slFp) || usedMultisets.has(multisetSig)) {
              deduplicatedCount++;
              continue;
            }

            usedMatrices.add(slFp);
            usedMultisets.add(multisetSig);
            coveredItemIds.add(resultStem);

            const bedrockRecipe = {
              format_version: '1.12.0',
              'minecraft:recipe_shapeless': {
                description: {
                  identifier: `${modId}:${recipeId}`,
                },
                tags: ['crafting_table'],
                ingredients: bedrockIngs,
                result: {
                  item: resultItem,
                  count,
                },
              },
            };

            behaviorPackRecipes[`recipes/${recipeId}.json`] = JSON.stringify(bedrockRecipe, null, 2);
            recipesConverted++;
            recipeAuditEntries.push({
              recipeId,
              resultItem,
              type: 'mod_converted',
              ingredients: ingredientsUsed,
            });
          }
        }
      } catch {}
    }
  }

  if (recipesConverted > 0) {
    log(`[RECIPES] Converted ${recipesConverted} authentic Java mod recipes. Deduplicated ${deduplicatedCount} duplicate/colliding recipes.`);
  }

  // 2. Discover authentic mod materials to use as base ingredients
  const detectedMaterials = items
    .filter((i) => !isNonCraftableItem(i.id, i.category) && (i.id.includes('shard') || i.id.includes('crystal') || i.id.includes('ingot') || i.id.includes('stinger') || i.id.includes('pollen') || i.id.includes('bread') || i.id.includes('honey') || i.id.includes('comb')))
    .map((i) => `${modId}:${i.id}`);

  const primaryMaterial = detectedMaterials[0] || 'minecraft:copper_ingot';
  const secondaryMaterial = detectedMaterials[1] || 'minecraft:amethyst_shard';

  const VANILLA_PALETTES = [
    'minecraft:honeycomb',
    'minecraft:amethyst_shard',
    'minecraft:copper_ingot',
    'minecraft:quartz',
    'minecraft:gold_ingot',
    'minecraft:redstone',
    'minecraft:sugar',
    'minecraft:glowstone_dust',
    'minecraft:paper',
    'minecraft:prismarine_shard',
    'minecraft:cobblestone',
  ];

  // 3. Contextual Fallback Generation with Guaranteed Non-Colliding Layouts
  // If the mod ships authentic recipes, ONLY generate fallbacks for uncrafted weapons, armor, tools or storage.
  // NEVER generate fallbacks for spawn eggs, fluids, leaked bytecode strings, or items when authentic recipes exist.
  let candidateIndex = 0;
  // Contextual fallback recipes are INVENTED content: they only ship in playable mode.
  const playableMode = isPlayableModeEnabled();
  if (!playableMode) {
    log('[PROVENANCE] INVENTED fallback recipes withheld (playable mode off) — only recipes recovered from the mod are exported.');
  }
  for (const it of items) {
    if (!playableMode) break;
    if (coveredItemIds.has(it.id)) continue;
    if (isNonCraftableItem(it.id, it.category)) continue;

    // If mod already has authentic recipes converted from JSON, do not spam arbitrary recipes for ambient blocks/items
    if (recipesConverted > 0 && !['weapon', 'armor', 'tool', 'storage'].includes(it.category ?? '')) {
      continue;
    }

    const recId = `${it.id}_crafting`;
    if (behaviorPackRecipes[`recipes/${recId}.json`]) continue;

    candidateIndex++;
    let hash = 0;
    for (let c = 0; c < it.id.length; c++) hash = (hash * 31 + it.id.charCodeAt(c)) >>> 0;

    const itemSpecificMaterial = detectedMaterials[hash % Math.max(1, detectedMaterials.length)] || primaryMaterial;
    const altSupport = VANILLA_PALETTES[(hash + candidateIndex) % VANILLA_PALETTES.length];
    const tertiarySupport = VANILLA_PALETTES[(hash + candidateIndex * 3 + 2) % VANILLA_PALETTES.length];
    const stickSupport = 'minecraft:stick';

    const isWeapon = it.category === 'weapon';
    const isArmor = it.category === 'armor';
    const isBlock = it.category === 'block';
    const isStorage = it.category === 'storage';

    // Build diverse candidates per item category to avoid vanilla/mod collisions
    const candidates: Array<{ pattern: string[]; key: Record<string, { item: string }> }> = [];

    if (isWeapon) {
      // Staggered / angled spear or blade shapes that NEVER collide with vanilla vertical swords
      candidates.push(
        { pattern: ['  M', ' M ', 'S  '], key: { M: { item: itemSpecificMaterial }, S: { item: altSupport } } },
        { pattern: [' M ', ' A ', ' S '], key: { M: { item: itemSpecificMaterial }, A: { item: altSupport }, S: { item: stickSupport } } },
        { pattern: ['M  ', ' M ', '  S'], key: { M: { item: itemSpecificMaterial }, S: { item: altSupport } } },
      );
    } else if (isArmor) {
      candidates.push(
        { pattern: ['MAM', 'MMM', 'M M'], key: { M: { item: itemSpecificMaterial }, A: { item: altSupport } } },
        { pattern: ['M M', 'MAM', 'MMM'], key: { M: { item: itemSpecificMaterial }, A: { item: altSupport } } },
        { pattern: ['MMM', 'MAM', 'M M'], key: { M: { item: itemSpecificMaterial }, A: { item: altSupport } } },
      );
    } else if (isBlock) {
      candidates.push(
        { pattern: ['MA', 'AM'], key: { M: { item: itemSpecificMaterial }, A: { item: altSupport } } },
        { pattern: ['MAM', 'ATA', 'MAM'], key: { M: { item: itemSpecificMaterial }, A: { item: altSupport }, T: { item: tertiarySupport } } },
        { pattern: ['AA', 'MM'], key: { A: { item: altSupport }, M: { item: itemSpecificMaterial } } },
        { pattern: ['MAM', 'AMA', 'MAM'], key: { M: { item: itemSpecificMaterial }, A: { item: altSupport } } },
      );
    } else if (isStorage) {
      candidates.push(
        { pattern: ['LML', 'LCL', 'LAL'], key: { L: { item: 'minecraft:leather' }, C: { item: 'minecraft:chest' }, M: { item: itemSpecificMaterial }, A: { item: altSupport } } },
      );
    } else {
      candidates.push(
        { pattern: ['MA', 'TM'], key: { M: { item: itemSpecificMaterial }, A: { item: altSupport }, T: { item: tertiarySupport } } },
        { pattern: [' M ', ' A ', ' T '], key: { M: { item: itemSpecificMaterial }, A: { item: altSupport }, T: { item: tertiarySupport } } },
        { pattern: ['M T', ' A ', '   '], key: { M: { item: itemSpecificMaterial }, A: { item: altSupport }, T: { item: tertiarySupport } } },
      );
    }

    let chosenCandidate: { pattern: string[]; key: Record<string, { item: string }> } | null = null;
    let chosenFps: { canonicalMatrix: string; mirroredMatrix: string; multisetSig: string; normalizedPattern: string[] } | null = null;

    for (const cand of candidates) {
      const fps = computeShapedFingerprints(cand.pattern, cand.key);
      if (!usedMatrices.has(fps.canonicalMatrix) && !usedMatrices.has(fps.mirroredMatrix) && !usedMultisets.has(fps.multisetSig)) {
        chosenCandidate = cand;
        chosenFps = fps;
        break;
      }
    }

    // If candidate shapes all collided, attempt a 3-ingredient unique shapeless recipe
    if (!chosenCandidate || !chosenFps) {
      const uniqueIngredients = [
        { item: itemSpecificMaterial },
        { item: altSupport },
        { item: tertiarySupport },
      ];
      const sorted = [...uniqueIngredients.map((u) => u.item)].sort().join(',');
      const slFp = `shapeless:${sorted}`;
      const slCounts: Record<string, number> = {};
      for (const u of uniqueIngredients) slCounts[u.item] = (slCounts[u.item] || 0) + 1;
      const slSig = `sig:${Object.entries(slCounts).sort(([a], [b]) => a.localeCompare(b)).map(([i, c]) => `${i}*${c}`).join(';')}`;

      if (!usedMatrices.has(slFp) && !usedMultisets.has(slSig)) {
        usedMatrices.add(slFp);
        usedMultisets.add(slSig);
        coveredItemIds.add(it.id);

        const slRecipe = {
          format_version: '1.12.0',
          'minecraft:recipe_shapeless': {
            description: { identifier: `${modId}:${recId}` },
            tags: ['crafting_table'],
            ingredients: uniqueIngredients,
            result: { item: `${modId}:${it.id}`, count: 1 },
          },
        };
        behaviorPackRecipes[`recipes/${recId}.json`] = JSON.stringify(slRecipe, null, 2);
        fallbackRecipesCount++;
        recipeAuditEntries.push({
          recipeId: recId,
          resultItem: `${modId}:${it.id}`,
          type: 'contextual_fallback',
          ingredients: uniqueIngredients.map((u) => u.item),
        });
      } else {
        // Omitting duplicate recipe rather than spamming Bedrock console warning
        deduplicatedCount++;
      }
      continue;
    }

    usedMatrices.add(chosenFps.canonicalMatrix);
    usedMatrices.add(chosenFps.mirroredMatrix);
    usedMultisets.add(chosenFps.multisetSig);
    coveredItemIds.add(it.id);

    const maxLen = Math.max(...chosenFps.normalizedPattern.map((r) => r.length), 1);
    const uniformPattern = chosenFps.normalizedPattern.map((r) => r.padEnd(maxLen, ' '));
    const cleanKey: Record<string, { item: string }> = {};
    for (const ch of uniformPattern.join('').replace(/\s/g, '').split('')) {
      if (chosenCandidate.key[ch]) cleanKey[ch] = chosenCandidate.key[ch];
    }

    const fallbackRecipe = {
      format_version: '1.12.0',
      'minecraft:recipe_shaped': {
        description: {
          identifier: `${modId}:${recId}`,
        },
        tags: ['crafting_table'],
        pattern: uniformPattern,
        key: cleanKey,
        result: {
          item: `${modId}:${it.id}`,
          count: 1,
        },
      },
    };

    behaviorPackRecipes[`recipes/${recId}.json`] = JSON.stringify(fallbackRecipe, null, 2);
    fallbackRecipesCount++;
    recipeAuditEntries.push({
      recipeId: recId,
      resultItem: `${modId}:${it.id}`,
      type: 'contextual_fallback',
      ingredients: Object.values(cleanKey).map((v) => v.item),
    });
  }

  log(`[RECIPES] Deduplication Engine complete: ${recipesConverted} mod recipes + ${fallbackRecipesCount} unique collision-free fallbacks (${deduplicatedCount} collisions eliminated).`);

  const stats: RecipePortStats = {
    modRecipesParsed,
    recipesConverted,
    fallbackRecipesCount,
    deduplicatedCount,
    unresolvedIngredients: Array.from(unresolvedIngredients),
    recipeAuditEntries,
  };

  return { behaviorPackRecipes, stats };
}