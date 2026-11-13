import type { ComponentProvenance } from '@/types/remaker';
import { safeFileId } from '@/utils/bedrockIds';
import type { Pack, RawFinding } from '@/utils/validationRules';

/**
 * Safe automatic repair for validation findings.
 *
 * Repairs are limited to structural normalisation the engine itself performs (identifier
 * casing, format versions, manifest wiring, atlas registration, clamping impossible
 * geometry/UV values). Nothing that changes gameplay is generated here, so a repair never
 * becomes an invented behaviour. A finding with no safe repair stays UNRESOLVED and is
 * reported with the file and requirement it violates.
 */

export interface RepairOutcome {
  applied: boolean;
  provenance: ComponentProvenance;
  action: string;
}

const NOT_APPLIED: RepairOutcome = { applied: false, provenance: 'ABSENT', action: '' };

function findKey(files: Pack, path: string): string | null {
  if (files[path] !== undefined) return path;
  const target = path.replace(/\\/g, '/').toLowerCase();
  return Object.keys(files).find((key) => key.replace(/\\/g, '/').toLowerCase() === target) ?? null;
}

function readDoc(files: Pack, path: string): { key: string; doc: Record<string, unknown> } | null {
  const key = findKey(files, path);
  if (!key) return null;
  const raw = files[key];
  const text = typeof raw === 'string' ? raw : raw ? new TextDecoder().decode(raw) : '';
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { key, doc: parsed as Record<string, unknown> };
  } catch {
    return null;
  }
}

function writeDoc(files: Pack, key: string, doc: Record<string, unknown>): void {
  files[key] = JSON.stringify(doc, null, 2);
}

function tokenize(pointer: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null = re.exec(pointer);
  while (match) {
    tokens.push(match[1] !== undefined ? match[1] : Number(match[2]));
    match = re.exec(pointer);
  }
  return tokens;
}

function setPointer(doc: Record<string, unknown>, pointer: string, value: unknown, merge = false): boolean {
  const tokens = tokenize(pointer);
  if (tokens.length === 0) return false;
  let cursor: any = doc;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (cursor == null || typeof cursor !== 'object') return false;
    cursor = cursor[tokens[index] as never];
  }
  if (cursor == null || typeof cursor !== 'object') return false;
  const last = tokens[tokens.length - 1] as never;
  if (merge && value && typeof value === 'object' && !Array.isArray(value)) {
    cursor[last] = { ...(cursor[last] ?? {}), ...(value as Record<string, unknown>) };
  } else {
    cursor[last] = value;
  }
  return true;
}

/** Applies the repair a finding accepts. Returns whether the pack actually changed. */
export function applyValidationRepair(
  finding: RawFinding,
  resourcePackFiles: Pack,
  behaviorPackFiles: Pack,
): RepairOutcome {
  const { kind, payload } = finding.repair;
  const files = finding.role === 'RP' ? resourcePackFiles : behaviorPackFiles;

  switch (kind) {
    case 'none':
      return NOT_APPLIED;

    case 'identifier':
    case 'format-version':
    case 'geometry-volume':
    case 'uv-value':
    case 'molang-trailer': {
      if (!payload?.pointer || payload.value === undefined) return NOT_APPLIED;
      const target = readDoc(files, finding.file);
      if (!target) return NOT_APPLIED;
      if (!setPointer(target.doc, payload.pointer, payload.value)) return NOT_APPLIED;
      writeDoc(files, target.key, target.doc);
      return {
        applied: true,
        provenance: 'SCAFFOLD',
        action:
          kind === 'identifier'
            ? `Normalised identifier to "${String(payload.value)}"`
            : kind === 'format-version'
              ? `Declared supported format version ${String(payload.value)}`
              : kind === 'geometry-volume'
                ? 'Clamped impossible cube size to a non-zero volume'
                : kind === 'uv-value'
                  ? 'Replaced a non-numeric UV coordinate with a finite value (UVs are never clamped)'
                  : 'Stripped Java statement terminators from a shipped Molang value',
      };
    }

    case 'uv-face': {
      const pointer = payload?.pointer;
      const value = payload?.value;
      if (!pointer || !value || typeof value !== 'object') return NOT_APPLIED;
      const target = readDoc(files, finding.file);
      if (!target) return NOT_APPLIED;
      if (!setPointer(target.doc, pointer, value, true)) return NOT_APPLIED;
      writeDoc(files, target.key, target.doc);
      return {
        applied: true,
        provenance: 'ADAPTED',
        action:
          'Rewrote the legacy 4-number face rectangle into a Bedrock uv anchor + uv_size, keeping the same texture region (no coordinate was clamped)',
      };
    }

    case 'geometry-description': {
      const target = readDoc(files, finding.file);
      const pointer = payload?.pointer;
      const value = payload?.value;
      if (!target || !pointer || !value) return NOT_APPLIED;
      if (!setPointer(target.doc, pointer, value, true)) return NOT_APPLIED;
      writeDoc(files, target.key, target.doc);
      return {
        applied: true,
        provenance: 'SCAFFOLD',
        action: 'Declared the texture sheet size the geometry UVs are measured against',
      };
    }

    case 'geometry-bounds': {
      const target = readDoc(files, finding.file);
      const pointer = payload?.pointer;
      if (!target || !pointer) return NOT_APPLIED;
      const bounds = { visible_bounds_width: 3, visible_bounds_height: 3, visible_bounds_offset: [0, 1, 0] };
      if (!setPointer(target.doc, pointer, bounds, true)) return NOT_APPLIED;
      writeDoc(files, target.key, target.doc);
      return { applied: true, provenance: 'SCAFFOLD', action: 'Declared visible bounds so the engine sizes the entity viewport' };
    }

    case 'atlas-entry': {
      const key = payload?.key;
      const texturePath = payload?.path;
      if (!key || !texturePath) return NOT_APPLIED;
      const isBlockTexture = /^textures\/blocks\//i.test(texturePath);
      const atlasPath = isBlockTexture ? 'textures/terrain_texture.json' : 'textures/item_texture.json';
      const existing = readDoc(resourcePackFiles, atlasPath);
      const doc: Record<string, unknown> = existing?.doc ?? {
        resource_pack_name: 'vanilla',
        texture_name: isBlockTexture ? 'atlas.terrain' : 'atlas.items',
        texture_data: {},
      };
      const textureData = (doc.texture_data && typeof doc.texture_data === 'object'
        ? doc.texture_data
        : {}) as Record<string, unknown>;
      if (textureData[key]) return NOT_APPLIED;
      textureData[key] = { textures: texturePath };
      doc.texture_data = textureData;
      if (!existing) {
        doc.resource_pack_name = 'vanilla';
        doc.texture_name = isBlockTexture ? 'atlas.terrain' : 'atlas.items';
      }
      writeDoc(resourcePackFiles, existing?.key ?? atlasPath, doc);
      return {
        applied: true,
        provenance: 'SCAFFOLD',
        action: `Registered "${key}" in ${atlasPath} pointing at the shipped texture ${texturePath}.png`,
      };
    }

    case 'material': {
      if (!payload?.pointer) return NOT_APPLIED;
      const target = readDoc(files, finding.file);
      if (!target) return NOT_APPLIED;
      if (!setPointer(target.doc, payload.pointer, payload.value)) return NOT_APPLIED;
      writeDoc(files, target.key, target.doc);
      return {
        applied: true,
        provenance: 'SCAFFOLD',
        action: `Bound the client entity to the engine material "${String(payload.value)}" because the declared material is not shipped`,
      };
    }

    case 'manifest-dependency': {
      const target = readDoc(behaviorPackFiles, 'manifest.json');
      const uuid = payload?.value;
      if (!target || typeof uuid !== 'string') return NOT_APPLIED;
      const dependencies = Array.isArray(target.doc.dependencies)
        ? [...(target.doc.dependencies as unknown[])]
        : [];
      if (dependencies.some((entry) => (entry as { uuid?: string })?.uuid === uuid)) return NOT_APPLIED;
      dependencies.push({ uuid, version: [1, 0, 0] });
      target.doc.dependencies = dependencies;
      writeDoc(behaviorPackFiles, target.key, target.doc);
      return {
        applied: true,
        provenance: 'SCAFFOLD',
        action: `Added the missing resource-pack dependency ${uuid} to the behaviour manifest`,
      };
    }

    case 'script-module': {
      const target = readDoc(behaviorPackFiles, 'manifest.json');
      if (!target) return NOT_APPLIED;
      const entry = typeof payload?.value === 'string' ? payload.value : '';
      const modules = Array.isArray(target.doc.modules) ? (target.doc.modules as unknown[]) : [];
      const remaining = modules.filter((module) => {
        const record = module as { type?: string; entry?: string };
        if (record?.type !== 'script') return true;
        return Boolean(record.entry && record.entry !== entry);
      });
      if (remaining.length === modules.length) return NOT_APPLIED;
      target.doc.modules = remaining;
      const dependencies = Array.isArray(target.doc.dependencies) ? (target.doc.dependencies as unknown[]) : [];
      target.doc.dependencies = dependencies.filter(
        (dependency) => (dependency as { module_name?: string })?.module_name !== '@minecraft/server',
      );
      writeDoc(behaviorPackFiles, target.key, target.doc);
      return {
        applied: true,
        provenance: 'SCAFFOLD',
        action: `Removed the script module declaration for the missing entry "${entry}" so the pack still loads`,
      };
    }

    case 'render-controller': {
      // Shape A: an existing render controller that declares no materials array.
      if (payload?.key && Array.isArray(payload.value)) {
        const target = readDoc(files, finding.file);
        if (!target) return NOT_APPLIED;
        const controllers = target.doc.render_controllers ?? target.doc['minecraft:render_controllers'];
        if (!controllers || typeof controllers !== 'object') return NOT_APPLIED;
        const controller = (controllers as Record<string, unknown>)[payload.key];
        if (!controller || typeof controller !== 'object') return NOT_APPLIED;
        (controller as Record<string, unknown>).materials = payload.value;
        target.doc.render_controllers = controllers;
        writeDoc(files, target.key, target.doc);
        return {
          applied: true,
          provenance: 'SCAFFOLD',
          action: `Declared the default material list on render controller "${payload.key}"`,
        };
      }
      // Shape A2: the controller declares `textures` as a scalar or an empty value. Bedrock
      // requires an array of texture expressions here — a scalar is the exact cause of the
      // "unknown child schema option type" error in the content log.
      if (payload?.key && Array.isArray(payload.textures)) {
        const target = readDoc(files, finding.file);
        if (!target) return NOT_APPLIED;
        const controllers = target.doc.render_controllers ?? target.doc['minecraft:render_controllers'];
        if (!controllers || typeof controllers !== 'object') return NOT_APPLIED;
        const controller = (controllers as Record<string, unknown>)[payload.key];
        if (!controller || typeof controller !== 'object') return NOT_APPLIED;
        const list = payload.textures.filter((entry): entry is string => typeof entry === 'string');
        (controller as Record<string, unknown>).textures = list.length > 0 ? list : ['Texture.default'];
        target.doc.render_controllers = controllers;
        writeDoc(files, target.key, target.doc);
        return {
          applied: true,
          provenance: 'SCAFFOLD',
          action: `Rewrote the textures field of render controller "${payload.key}" as an array of texture expressions`,
        };
      }
      // Shape B: a client entity references a render controller that was never shipped.
      const controllerId = payload?.controllerId;
      const geometry = payload?.geometry;
      const texture = payload?.texture;
      if (!controllerId || !geometry || !texture) return NOT_APPLIED;
      const safeId = safeFileId(controllerId) || 'controller_render_repaired';
      const controllerDoc = {
        format_version: '1.10.0',
        render_controllers: {
          [controllerId]: {
            geometry: 'Geometry.default',
            materials: [{ '*': 'Material.default' }],
            textures: ['Texture.default'],
          },
        },
      };
      resourcePackFiles[`render_controllers/${safeId}.json`] = JSON.stringify(controllerDoc, null, 2);
      const clientEntity = readDoc(resourcePackFiles, finding.file);
      if (clientEntity) {
        const description = (clientEntity.doc['minecraft:client_entity'] as Record<string, unknown> | undefined)
          ?.description as Record<string, unknown> | undefined;
        if (description) {
          description.render_controllers = [controllerId];
          writeDoc(resourcePackFiles, clientEntity.key, clientEntity.doc);
        }
      }
      return {
        applied: true,
        provenance: 'SCAFFOLD',
        action: `Shipped a render controller binding ${geometry} with the shipped texture ${texture} and pointed the client entity at it`,
      };
    }

    case 'header-capabilities': {
      const target = readDoc(files, 'manifest.json');
      if (!target) return NOT_APPLIED;
      const header = target.doc.header;
      if (!header || typeof header !== 'object' || Array.isArray(header)) return NOT_APPLIED;
      const listed = Array.isArray(payload?.value)
        ? payload.value.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const headerRecord = header as Record<string, unknown>;
      const existing = Array.isArray(headerRecord.capabilities)
        ? headerRecord.capabilities.filter((entry): entry is string => typeof entry === 'string')
        : [];
      delete (target.doc as Record<string, unknown>).capabilities;
      headerRecord.capabilities = [...new Set([...existing, ...listed])];
      writeDoc(files, target.key, target.doc);
      return {
        applied: true,
        provenance: 'SCAFFOLD',
        action:
          'Moved the capability flags from the manifest root into header.capabilities, which is where the engine reads them',
      };
    }

    case 'animation-channel': {
      const path = payload?.path;
      if (!path || path.length === 0) return NOT_APPLIED;
      const target = readDoc(files, finding.file);
      if (!target) return NOT_APPLIED;
      let cursor: any = target.doc;
      for (let index = 0; index < path.length - 1; index += 1) {
        if (cursor == null || typeof cursor !== 'object') return NOT_APPLIED;
        cursor = cursor[path[index] as never];
      }
      if (cursor == null || typeof cursor !== 'object') return NOT_APPLIED;
      cursor[path[path.length - 1] as never] = payload.value;
      writeDoc(files, target.key, target.doc);
      return {
        applied: true,
        provenance: 'ADAPTED',
        action:
          'Rewrote the Java animation channel into a valid Bedrock keyframe channel, keeping every source timestamp and the clip looping state',
      };
    }

    default:
      return NOT_APPLIED;
  }
}