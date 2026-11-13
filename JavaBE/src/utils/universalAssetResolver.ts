import type { AssetIndex, IndexedTexture, JavaModel } from '@/utils/assetIndex';
import { lookupTextureByRef, normKey, resolveModelTexture } from '@/utils/assetIndex';
import { normalizeAssetPath } from '@/utils/identifierNormalization';
import { findModelByRef } from '@/utils/blockstateModelResolver';

const ICON_NOISE = /glow|eyes|eyees|emissive|overlay|mask|armor|saddle|shadow|particle|hurt|flash|ring|spark|template|blank|empty|_n$|_s$/;
const ANIMATION_STATE = /(ambient|idle|taunt|walking|walk|running|run|attack|attacking|hurt|death|dead|sleep|sleeping|angry|rage|enraged|charge|charging|shoot|reload|phase)/;

/**
 * GUI art, menus and atlas fragments sit in the archive next to the real skins and
 * carry the mob's name (`blacksmith_gui_trade.png`). Binding one as a body texture
 * smears a 300x180 menu screenshot across the rig, so they are rejected outright.
 */
const NON_SKIN_STEM =
  /(^|_)(gui|menu|inventory|container|crafting|trade|button|panel|hud|slot|icon|logo|title|banner|splash|font|atlas|palette|preview|tooltip|background|bg)(_|$)/;

/** Entity sheets are block-aligned pixel grids; menu art and icons usually are not. */
function isEntitySheet(texture: IndexedTexture): boolean {
  const { width, height } = texture;
  if (width < 16 || height < 16) return false;
  if (width > 2048 || height > 2048) return false;
  return width % 8 === 0 && height % 8 === 0;
}

/**
 * Final gate for anything about to be bound to a mob rig. Archives keep GUI screens,
 * inventory icons and particle sheets right next to the real skins, and binding one of
 * those smears menu art across every cube of the model in game.
 */
export function isBindableEntitySheet(texture: IndexedTexture): boolean {
  if (!isEntitySheet(texture)) return false;
  if (ICON_NOISE.test(texture.stem)) return false;
  if (NON_SKIN_STEM.test(texture.stem)) return false;
  // Java animated skins are vertical frame strips; Bedrock samples the whole sheet as a
  // single frame, so a strip renders as garbage instead of the mob.
  if (texture.height > texture.width && texture.height % texture.width === 0) return false;
  return true;
}

/** True when two identifiers name the same creature family (`balder` / `balder_x`). */
function sharesFamily(a: string, b: string): boolean {
  const na = normKey(a);
  const nb = normKey(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

/**
 * Words that describe a mob category rather than one specific mob. Sharing only a
 * generic word is never enough to link a skin, otherwise `sewer_rat` would borrow
 * `snow_rat.png` and every soldier would wear a skeleton's armour.
 */
const GENERIC_TOKENS = new Set([
  'soldier',
  'skeleton',
  'zombie',
  'knight',
  'demon',
  'fiend',
  'monster',
  'creature',
  'mob',
  'entity',
  'man',
  'men',
  'people',
  'person',
  'warrior',
  'guard',
  'archer',
  'mage',
  'priest',
  'boss',
  'elite',
  'baby',
  'giant',
  'small',
  'big',
  'body',
  'base',
  'skin',
  'texture',
  'layer',
  'spawn',
  'egg',
  'generic',
  'custom',
  'the',
  'and',
  'for',
]);

function slugTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

/** Collapses doubled letters so spelling drift in mod ids still resolves a skin. */
function collapseRepeats(value: string): string {
  return value.replace(/(.)\1+/g, '$1');
}

function scoreCandidate(targetKeys: string[], targetTokens: string[], texture: IndexedTexture): number {
  let score = 0;
  for (const key of targetKeys) {
    if (key.length < 3) continue;
    if (texture.norm === key) score = Math.max(score, 100);
    else if (texture.norm.startsWith(key) || key.startsWith(texture.norm)) score = Math.max(score, 62);
  }
  if (score < 62 && targetTokens.length > 0) {
    const candidateTokens = slugTokens(texture.stem);
    let tokenScore = 0;
    for (const token of targetTokens) {
      if (candidateTokens.includes(token)) tokenScore += 5;
      else if (texture.norm.includes(token)) tokenScore += 1.5;
    }
    if (tokenScore >= 5) score = Math.max(score, 40 + tokenScore);
  }
  return score;
}

function bestTexture(
  pool: IndexedTexture[],
  targetKeys: string[],
  targetTokens: string[],
): IndexedTexture | null {
  let best: IndexedTexture | null = null;
  let bestScore = 39;
  for (const texture of pool) {
    if (texture.width < 8 || texture.height < 8) continue;
    if (ICON_NOISE.test(texture.stem)) continue;
    const score = scoreCandidate(targetKeys, targetTokens, texture);
    if (score > bestScore) {
      bestScore = score;
      best = texture;
    }
  }
  return best;
}

/** Finds the Java model that belongs to an item or block identifier / display name. */
export function findModel(
  index: AssetIndex,
  id: string,
  name: string,
  bucket: 'item' | 'block',
): JavaModel | null {
  const map = bucket === 'block' ? index.blockModelByNorm : index.itemModelByNorm;
  const keys = [normKey(id), normKey(name), normKey(name.replace(/spawn egg|summon egg/gi, ''))].filter(
    (key) => key.length >= 3,
  );
  for (const key of keys) {
    const direct = map.get(key);
    if (direct) return direct;
  }
  let best: JavaModel | null = null;
  let bestLength = 0;
  for (const key of keys) {
    for (const [norm, model] of map) {
      if (norm.length < 4 || key.length < 4) continue;
      if (!norm.startsWith(key) && !key.startsWith(norm)) continue;
      if (norm.length > bestLength) {
        best = model;
        bestLength = norm.length;
      }
    }
  }
  return best;
}

/**
 * Resolves the authentic texture used by an item or block.
 * Priority: explicit texture reference declared in its real Java model / blockstate JSON textures map
 * -> exact 1:1 filename match in the archive.
 * Loose token matching is strictly disabled to prevent incorrect links.
 */
export function resolveItemTexture(
  index: AssetIndex,
  id: string,
  name: string,
  isBlock: boolean,
): IndexedTexture | null {
  // Check blockstate model reference if applicable
  if (isBlock && index.blockstateByNorm) {
    const bs = index.blockstateByNorm.get(normKey(id)) ?? index.blockstateByNorm.get(normKey(name));
    if (bs) {
      const modelRefs = [
        ...Object.values(bs.variants).map((variant) => variant?.model),
        ...bs.multipart.map((part) => part.apply?.model),
      ];
      for (const modelRef of modelRefs) {
        if (!modelRef) continue;
        const bsModel = findModelByRef(index, modelRef);
        if (!bsModel) continue;
        const linked = resolveModelTexture(bsModel, index, ['all', 'side', 'front', 'top', 'texture', 'cross']);
        if (linked) return linked;
      }
    }
  }

  const primaryBucket: 'item' | 'block' = isBlock ? 'block' : 'item';
  const model =
    findModel(index, id, name, primaryBucket) ?? findModel(index, id, name, primaryBucket === 'block' ? 'item' : 'block');
  if (model) {
    const preferredVars = isBlock
      ? ['all', 'side', 'front', 'top', 'texture', 'particle', 'cross', 'bottom', 'end']
      : ['layer0', 'layer1', 'texture', 'all', 'particle', '0'];
    const linked = resolveModelTexture(model, index, preferredVars);
    if (linked) return linked;
  }

  const exactKeys = [...new Set([normKey(id), normKey(name)].filter(Boolean))];
  for (const key of exactKeys) {
    const candidates = index.textureByNorm.get(key) ?? [];
    const exact = isBlock
      ? candidates.find((texture) => texture.bucket === 'block') ?? candidates.find((texture) => texture.bucket === 'item')
      : candidates.find((texture) => texture.bucket === 'item');
    if (exact) return exact;
  }

  return null;
}

/** Normalizes a `namespace:textures/entity/foo.png` reference to an index tail. */
function normalizeSkinRef(ref: string): string {
  return normalizeAssetPath(ref)
    .replace(/^textures\//, '')
    .replace(/\.png$/i, '');
}

/**
 * Highest-fidelity link available: Java entity models spell out their own skin in
 * their `textures` map, so the mob gets exactly the sheet the mod author bound to
 * that model instead of a filename guess.
 */
function resolveEntityModelSkin(index: AssetIndex, keys: string[]): IndexedTexture | null {
  if (index.entitySkinRefs.size === 0) return null;
  const usableSkin = (texture: IndexedTexture | null): IndexedTexture | null =>
    texture && isEntitySheet(texture) && !NON_SKIN_STEM.test(texture.stem) ? texture : null;
  for (const key of keys) {
    const ref = index.entitySkinRefs.get(key);
    if (!ref) continue;
    const texture = usableSkin(lookupTextureByRef(index, normalizeSkinRef(ref)));
    if (texture) return texture;
  }
  for (const [norm, ref] of index.entitySkinRefs) {
    if (norm.length < 5) continue;
    if (!keys.some((key) => norm.startsWith(key) || key.startsWith(norm))) continue;
    const texture = usableSkin(lookupTextureByRef(index, normalizeSkinRef(ref)));
    if (texture) return texture;
  }
  return null;
}

function scoreMobSkin(texture: IndexedTexture, keys: string[], distinctive: string[]): number {
  let score = 0;
  for (const key of keys) {
    if (texture.norm === key) score = Math.max(score, 120);
    else if (texture.folder && normKey(texture.folder) === key) score = Math.max(score, 96);
    else if (texture.norm.startsWith(key) || key.startsWith(texture.norm)) score = Math.max(score, 78);
    else if (texture.norm.includes(key) || key.includes(texture.norm)) score = Math.max(score, 60);
  }
  if (score === 0) {
    // Spelling drift still describes a real skin: `undead_assasin` vs
    // `undead_assassin.png`, `brown_mushroom_texture.png` for `mushroom_people`.
    const collapsedStem = collapseRepeats(texture.norm);
    for (const key of keys) {
      const collapsedKey = collapseRepeats(key);
      if (collapsedStem === collapsedKey) score = Math.max(score, 92);
      else if (collapsedStem.startsWith(collapsedKey) || collapsedKey.startsWith(collapsedStem)) {
        score = Math.max(score, 66);
      }
    }
  }
  if (score === 0) {
    const shared = slugTokens(texture.stem).filter((token) => token.length >= 4 && distinctive.includes(token));
    if (shared.length > 0) score = 56 + Math.min(shared.length, 3) * 4;
  }
  if (score === 0) return 0;
  // A sheet whose name carries extra distinctive words belongs to a different
  // creature (`undead_assassin.png` is not the `undead` skin). Ranking it below the
  // mob's own sheet keeps a loose substring match from stealing the link.
  if (!keys.some((key) => texture.norm === key)) {
    const ownTokens = new Set(distinctive);
    const extraTokens = slugTokens(texture.stem).filter(
      (token) => token.length >= 4 && !GENERIC_TOKENS.has(token) && !ownTokens.has(token),
    );
    if (extraTokens.length > 0) score -= 12 * Math.min(extraTokens.length, 3);
  }
  if (ANIMATION_STATE.test(texture.stem)) score -= 30;
  if (texture.width >= 64 && texture.height >= 64) score += 8;
  // Java animated skins are vertical frame strips (16x256 ...). Bedrock samples the
  // whole sheet as a single frame, so linking one renders the mob as garbage.
  if (texture.height > texture.width && texture.height % texture.width === 0) return 0;
  return score;
}

function scanMobSkinPool(
  pool: IndexedTexture[],
  keys: string[],
  distinctive: string[],
  minScore: number,
  skip?: (texture: IndexedTexture) => boolean,
): IndexedTexture | null {
  let best: IndexedTexture | null = null;
  let bestScore = minScore - 1;
  for (const texture of pool) {
    if (!isEntitySheet(texture)) continue;
    if (ICON_NOISE.test(texture.stem)) continue;
    if (NON_SKIN_STEM.test(texture.stem)) continue;
    if (skip?.(texture)) continue;
    const score = scoreMobSkin(texture, keys, distinctive);
    if (score > bestScore) {
      bestScore = score;
      best = texture;
    }
  }
  return best;
}

/**
 * Resolves the authentic entity skin for a mob.
 * Priority: the skin its Java entity model declares → exact/folder/token match in
 * the entity bucket → a strict match anywhere outside the item/block/gui buckets
 * (some mods keep mob skins under `textures/models` or `textures/mob`).
 */
export function resolveMobTexture(
  index: AssetIndex,
  mobId: string,
  displayName: string,
  claimed?: Map<string, string>,
): IndexedTexture | null {
  const idKey = normKey(mobId.replace(/_spawn_egg$/, ''));
  const nameKey = normKey(displayName.replace(/spawn egg|summon egg/gi, ''));
  const keys = [idKey, nameKey].filter((key) => key.length >= 3);
  if (keys.length === 0) return null;

  // A sheet already worn by an unrelated mob must never be reused: two mobs sharing
  // one skin read in game as duplicated ghosts of the same creature. Family ids
  // (`balder` and `balder_crossbow`) may still share, because the alias collapse pass
  // merges those into a single entity.
  const claimedByOther = (texture: IndexedTexture): boolean => {
    if (!claimed || claimed.size === 0) return false;
    const owner =
      claimed.get(texture.tail) ?? claimed.get(texture.stem) ?? claimed.get(`${texture.stem}.png`);
    if (!owner) return false;
    return !sharesFamily(owner, mobId);
  };

  const declaredSkin = resolveEntityModelSkin(index, keys);
  if (declaredSkin && !claimedByOther(declaredSkin)) return declaredSkin;

  const distinctive = [...new Set(keys.flatMap((key) => slugTokens(key)))].filter(
    (token) => token.length >= 4 && !GENERIC_TOKENS.has(token),
  );

  const entityPool = index.entities.length > 0 ? index.entities : index.textures;
  const linked = scanMobSkinPool(entityPool, keys, distinctive, 55, claimedByOther);
  if (linked) return linked;

  // Family tier: mods frequently name a sheet after the family instead of the variant
  // (`rat.png` for `sewer_rat`, `mimic_texture.png` for `mimic_chest`). Only a UNIQUE,
  // unclaimed, block-aligned sheet sharing a distinctive word is accepted, so a mob
  // can never walk off wearing a stranger's skin.
  const familyMatches = entityPool.filter(
    (texture) =>
      isBindableEntitySheet(texture) &&
      !claimedByOther(texture) &&
      distinctive.some((token) => {
        const collapsed = collapseRepeats(token);
        return (
          slugTokens(texture.stem).includes(token) ||
          collapseRepeats(texture.norm).includes(collapsed) ||
          collapseRepeats(normKey(texture.folder)).includes(collapsed)
        );
      }),
  );
  const uniqueFamily = new Map<string, IndexedTexture>();
  for (const texture of familyMatches) {
    const dedupeKey = texture.tail || texture.path;
    if (!uniqueFamily.has(dedupeKey)) uniqueFamily.set(dedupeKey, texture);
  }
  if (uniqueFamily.size === 1) return [...uniqueFamily.values()][0];

  const loosePool = index.textures.filter((texture) => texture.bucket === 'other');
  if (loosePool.length === 0) return null;
  return scanMobSkinPool(loosePool, keys, distinctive, 62, claimedByOther);
}