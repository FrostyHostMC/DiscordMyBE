import type { AssetIndex, JavaModel } from '@/utils/assetIndex';
import { lookupTextureByRef, normKey } from '@/utils/assetIndex';
import { findModelByRef } from '@/utils/blockstateModelResolver';
import { readPngHeader } from '@/utils/textureMetadata';

export function findFoliageBlockModels(index: AssetIndex, blockId: string): JavaModel[] {
  const found = new Map<string, JavaModel>();
  const add = (ref: string) => {
    const model = findModelByRef(index, ref);
    if (model) found.set(model.path, model);
  };
  const direct = index.blockModelByNorm.get(normKey(blockId));
  if (direct) found.set(direct.path, direct);
  const state = index.blockstateByNorm.get(normKey(blockId));
  for (const variant of Object.values(state?.variants ?? {}).slice(0, 24)) add(variant.model);
  for (const part of (state?.multipart ?? []).slice(0, 24)) add(part.apply.model);
  return [...found.values()];
}

export function isCrossFoliageModel(model: JavaModel): boolean {
  if (model.chain.some((parent) => /(?:^|[/:])(?:tinted_)?cross$/i.test(parent))) return true;
  return (model.elements ?? []).some((element) => {
    const sizes = [0, 1, 2].map((axis) => Math.abs((element.to?.[axis] ?? 0) - (element.from?.[axis] ?? 0)));
    return sizes.some((size) => size <= 0.25) && element.rotation?.axis === 'y' && Math.abs(element.rotation.angle ?? 0) >= 30;
  });
}

export function findAlphaTextures(models: JavaModel[], index: AssetIndex): string[] {
  const paths = new Set<string>();
  for (const model of models) {
    for (const value of Object.values(model.textures).slice(0, 32)) {
      let ref = value;
      let depth = 0;
      while (ref.startsWith('#') && depth++ < 8) ref = model.textures[ref.slice(1)] ?? '';
      if (!ref || ref.startsWith('#')) continue;
      const texture = lookupTextureByRef(index, ref);
      if (texture && readPngHeader(texture.data)?.hasAlpha) paths.add(texture.path);
    }
  }
  return [...paths];
}