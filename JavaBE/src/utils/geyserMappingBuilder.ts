import type {
  GeyserBlockMapping,
  GeyserItemMapping,
  GeyserMappingStatus,
  GeyserVersionProfile,
  RemakeItem,
} from '@/types/remaker';
import { resolveGeyserProfile } from '@/utils/geyserVersionTable';

/** Geyser expects custom content to live in its own namespace inside the Bedrock pack. */
export const GEYSER_CUSTOM_NAMESPACE = 'geyser_custom';

const CREATIVE_CATEGORY: Record<string, string> = {
  weapon: 'combat',
  tool: 'tools',
  armor: 'combat',
  food: 'food',
  block: 'building_blocks',
  storage: 'decoration_blocks',
  machine: 'redstone',
  fluid: 'misc',
  item: 'misc',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeGeyserToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[a-z0-9_.-]+:/, '')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Java registry identifier for a ported asset, matched by normalized path only. */
function findJavaIdentifier(candidate: string, javaIds: string[]): string | null {
  const target = normalizeGeyserToken(candidate);
  if (!target) return null;
  for (const javaId of javaIds) {
    const [namespace, path] = javaId.split(':');
    if (!path || !namespace) continue;
    if (normalizeGeyserToken(path) !== target) continue;
    return `${namespace}:${path}`;
  }
  return null;
}

/** Locates the shipped Bedrock geometry file that declares this identifier. */
function findGeometrySource(
  identifier: string,
  resourcePackFiles: Record<string, string | Uint8Array>,
): string | null {
  if (!identifier) return null;
  let scanned = 0;
  for (const [path, data] of Object.entries(resourcePackFiles)) {
    if (scanned >= 160) break;
    if (!path.startsWith('models/') || !path.toLowerCase().endsWith('.geo.json')) continue;
    scanned++;
    if (typeof data !== 'string') continue;
    if (data.includes(`"${identifier}"`)) return path;
  }
  return null;
}

export interface GeyserMappingInput {
  modId: string;
  targetVersion: string;
  geyserVersion: string;
  items: RemakeItem[];
  javaItemIds?: string[];
  javaBlockIds?: string[];
  resourcePackFiles: Record<string, string | Uint8Array>;
  behaviorPackFiles: Record<string, string | Uint8Array>;
}

export interface GeyserMappingResult {
  profile: GeyserVersionProfile;
  items: GeyserItemMapping[];
  blocks: GeyserBlockMapping[];
  warnings: string[];
}

export function buildGeyserMappings(input: GeyserMappingInput): GeyserMappingResult {
  const profile = resolveGeyserProfile(input.geyserVersion, input.targetVersion);
  const javaItemIds = input.javaItemIds ?? [];
  const javaBlockIds = input.javaBlockIds ?? [];
  const warnings: string[] = [];
  const items: GeyserItemMapping[] = [];
  const blocks: GeyserBlockMapping[] = [];

  if (profile.source === 'unknown') {
    warnings.push(
      `Geyser ${input.geyserVersion} is not in the bundled snapshot — generated files are documented as unverified rather than claimed compatible.`,
    );
  }

  for (const item of input.items) {
    // Spawn eggs travel through Geyser's protocol translation, and blocks are mapped by
    // the block pass below — neither gets an item mapping.
    if (item.category === 'spawn_egg' || item.category === 'block') continue;
    const token = normalizeGeyserToken(item.id);
    if (!token) continue;
    const textureShortName = `${GEYSER_CUSTOM_NAMESPACE}_${token}`;
    const sourceTexture = `textures/items/${item.id}.png`;
    const hasTexture = Boolean(input.resourcePackFiles[sourceTexture]);
    const javaIdentifier = findJavaIdentifier(item.id, javaItemIds);
    const evidence = [sourceTexture];
    if (javaIdentifier) evidence.push(`Java registry entry: ${javaIdentifier}`);

    let status: GeyserMappingStatus = 'generated';
    let note = 'Java registry identifier and shipped Bedrock item both resolved from mod evidence.';
    if (!profile.supports.customItems) {
      status = 'unknown-compatibility';
      note = `The bundled snapshot does not list custom item mappings for Geyser ${profile.geyserVersion}; treat this mapping as unverified, not working.`;
    } else if (!hasTexture) {
      status = 'unsupported';
      note = `no texture shipped at ${sourceTexture}; a Geyser custom item cannot render without one, so the mapping is withheld.`;
    } else if (!javaIdentifier) {
      status = 'approximated';
      note =
        'the Java registry identifier was not recovered from the mod data; the mapping key is derived from the ported Bedrock id and must be corrected before Geyser can bind it.';
    }

    items.push({
      javaIdentifier: javaIdentifier ?? `${input.modId}:${token}`,
      bedrockIdentifier: `${GEYSER_CUSTOM_NAMESPACE}:${token}`,
      name: item.name || token,
      stackSize: item.category === 'weapon' || item.category === 'armor' || item.category === 'tool' ? 1 : 64,
      creativeCategory: CREATIVE_CATEGORY[item.category ?? 'item'] ?? 'misc',
      textureShortName,
      sourceTexture,
      status,
      provenance: status === 'unsupported' ? 'ABSENT' : 'ADAPTED',
      evidence,
      note,
    });
  }

  for (const [path, data] of Object.entries(input.behaviorPackFiles)) {
    const match = /^blocks\/([A-Za-z0-9_-]+)\.json$/.exec(path);
    if (!match || typeof data !== 'string') continue;
    const blockId = match[1];
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      warnings.push(
        `${path} could not be parsed (${error instanceof Error ? error.message : String(error)}), so no Geyser block mapping was generated for it.`,
      );
      continue;
    }
    const definition = asRecord(asRecord(parsed)?.['minecraft:block']);
    if (!definition) continue;
    const description = asRecord(definition.description);
    const components = asRecord(definition.components);
    const identifier = readString(description?.identifier, `${input.modId}:${blockId}`);
    const material = asRecord(asRecord(components?.['minecraft:material_instances'])?.['*']);
    const textureShortName = readString(material?.texture, blockId);
    const renderMethod = readString(material?.render_method, 'opaque');
    const sourceTexture = `textures/blocks/${textureShortName}.png`;
    const hasTexture = Boolean(input.resourcePackFiles[sourceTexture]);
    const declaredGeometry = readString(asRecord(components?.['minecraft:geometry'])?.identifier);
    const geometrySource = declaredGeometry ? findGeometrySource(declaredGeometry, input.resourcePackFiles) : null;
    const states = asRecord(description?.states);
    const permutations = Array.isArray(definition.permutations) ? definition.permutations.length : 0;
    const javaIdentifier = findJavaIdentifier(blockId, javaBlockIds);
    const evidence = [path, `definition: ${identifier}`, sourceTexture];
    if (javaIdentifier) evidence.push(`Java block registry entry: ${javaIdentifier}`);
    if (geometrySource) evidence.push(`geometry: ${geometrySource}`);

    let status: GeyserMappingStatus = 'generated';
    let note = 'block definition, texture and geometry resolved from the shipped packs.';
    if (!profile.supports.customBlocks) {
      status = 'unknown-compatibility';
      note = `The bundled snapshot does not list custom block mappings for Geyser ${profile.geyserVersion}; report this as unknown, not working.`;
    } else if (!hasTexture) {
      status = 'unsupported';
      note = `no block texture shipped at ${sourceTexture}; the mapping is withheld rather than shipping an invisible block.`;
    } else if (declaredGeometry && !geometrySource) {
      status = 'approximated';
      note = `declared geometry ${declaredGeometry} is not a shipped geo.json in the pack; the mapping falls back to minecraft:geometry.full_block, which is an approximation of the Java shape.`;
    } else if (!javaIdentifier) {
      status = 'approximated';
      note =
        'the Java block registry identifier was not recovered from the mod data; the mapping key is derived from the ported Bedrock id.';
    }

    blocks.push({
      javaIdentifier: javaIdentifier ?? `${input.modId}:${normalizeGeyserToken(blockId)}`,
      bedrockIdentifier: `${GEYSER_CUSTOM_NAMESPACE}:${normalizeGeyserToken(blockId) || 'block'}`,
      name: blockId.replace(/_/g, ' '),
      hardness: readNumber(asRecord(components?.['minecraft:destructible_by_mining'])?.seconds_to_destroy, 1.5),
      blastResistance: readNumber(
        asRecord(components?.['minecraft:destructible_by_explosion'])?.explosion_resistance,
        6,
      ),
      geometryIdentifier: geometrySource ? declaredGeometry : 'minecraft:geometry.full_block',
      ...(geometrySource ? { geometrySource } : {}),
      textureShortName,
      sourceTexture,
      renderMethod,
      stateCount: (states ? Object.keys(states).length : 0) + permutations,
      status,
      provenance: status === 'unsupported' ? 'ABSENT' : 'ADAPTED',
      evidence,
      note,
    });
  }

  if (input.items.some((item) => item.category === 'spawn_egg')) {
    warnings.push(
      'Entities and spawn eggs are translated by Geyser itself; no entity mappings are generated, because Geyser has no entity mapping file for mod entities.',
    );
  }

  return { profile, items, blocks, warnings };
}