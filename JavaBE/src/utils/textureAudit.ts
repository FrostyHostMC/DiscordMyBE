import type { BedrockRemake } from '@/types/remaker';

export type AuditStatus = 'linked' | 'orphaned' | 'missing';

export interface AuditModelNode {
  id: string;
  textures: string[];
  status: 'linked' | 'missing';
}

export interface AuditTextureNode {
  id: string;
  models: string[];
  status: 'linked' | 'orphaned';
}

export interface AuditLink {
  model: string;
  texture: string;
  status: AuditStatus;
}

export interface TextureAuditGraph {
  models: AuditModelNode[];
  textures: AuditTextureNode[];
  links: AuditLink[];
  linkedCount: number;
  orphanCount: number;
  missingCount: number;
  coverage: number;
}

const decodeText = (v: string | Uint8Array): string =>
  typeof v === 'string' ? v : new TextDecoder().decode(v);

/**
 * Builds a deterministic model→texture mapping graph from the generated
 * Bedrock resource pack, flagging orphaned textures and missing mappings.
 */
export function buildTextureAuditGraph(remake: BedrockRemake): TextureAuditGraph {
  const rp = remake.resourcePackFiles;
  const texKeys = Object.keys(rp).filter((k) => /^textures\/entity\/[^/]+\.png$/.test(k));
  const texIdSet = new Set(texKeys.map((k) => k.slice('textures/entity/'.length, -4)));
  const entityKeys = Object.keys(rp).filter((k) => k.startsWith('entity/') && k.endsWith('.entity.json'));

  const texturesByModel = new Map<string, string[]>();
  const modelsByTexture = new Map<string, string[]>();

  for (const key of entityKeys) {
    const modelId = key.slice('entity/'.length, -'.entity.json'.length);
    let refs: string[] = [];
    try {
      const parsed = JSON.parse(decodeText(rp[key])) as {
        'minecraft:client_entity'?: { description?: { textures?: Record<string, string> } };
      };
      refs = Object.values(parsed['minecraft:client_entity']?.description?.textures ?? {});
    } catch {
      refs = [];
    }

    const resolved = new Set<string>();
    for (const ref of refs) {
      const normalized = ref.replace(/\.png$/i, '');
      if (texKeys.includes(`${normalized}.png`)) {
        resolved.add(normalized.replace(/^textures\/entity\//, ''));
      }
    }
    if (resolved.size === 0 && texIdSet.has(modelId)) resolved.add(modelId);

    const list = [...resolved];
    texturesByModel.set(modelId, list);
    for (const texId of list) {
      const arr = modelsByTexture.get(texId) ?? [];
      arr.push(modelId);
      modelsByTexture.set(texId, arr);
    }
  }

  const models: AuditModelNode[] = [...texturesByModel.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, textures]) => ({ id, textures, status: textures.length > 0 ? 'linked' : 'missing' }));

  const textures: AuditTextureNode[] = [...texIdSet]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => {
      const linkedModels = modelsByTexture.get(id) ?? [];
      return { id, models: linkedModels, status: linkedModels.length > 0 ? 'linked' : 'orphaned' };
    });

  const links: AuditLink[] = [];
  for (const model of models) {
    for (const texId of model.textures) {
      links.push({ model: model.id, texture: texId, status: 'linked' });
    }
  }

  const linkedCount = models.filter((m) => m.status === 'linked').length;
  return {
    models,
    textures,
    links,
    linkedCount,
    orphanCount: textures.filter((t) => t.status === 'orphaned').length,
    missingCount: models.filter((m) => m.status === 'missing').length,
    coverage: models.length > 0 ? Math.round((linkedCount / models.length) * 100) : 100,
  };
}