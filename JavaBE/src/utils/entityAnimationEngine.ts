import type { AssetIndex } from '@/utils/assetIndex';
import type { EntityAnimationEngineReport, RemakeItem } from '@/types/remaker';
import { readPngHeader } from '@/utils/textureMetadata';
import {
  discoverEntityTextureVariants,
  findEmissiveSibling,
  type PackFile,
} from '@/utils/entityTextureVariants';
import { buildEntityRenderController, readGeometryIdentifiers } from '@/utils/entityRenderControllers';
import { resolveEntityMaterial } from '@/utils/entityMaterials';
import { shipArmorAttachables } from '@/utils/armorAttachables';

/**
 * Entity & Animation Engine — final binding pass.
 *
 * Runs on the assembled resource pack so every client entity definition references only
 * things that really shipped: its own geometry identifier(s), the skins present on disk,
 * a material that matches the skin's alpha channel, and a render controller that can
 * actually select the registered variants. Texture/geometry variants, material mapping
 * and armour attachables are all derived from shipped files — nothing is invented here.
 */
export function applyEntityAnimationEngine(options: {
  modId: string;
  resourcePackFiles: Record<string, PackFile>;
  items: RemakeItem[];
  assetIndex: AssetIndex | null;
  onLog?: (line: string) => void;
}): EntityAnimationEngineReport {
  const { modId, resourcePackFiles: files, items, assetIndex } = options;
  const log = (line: string) => options.onLog?.(line);
  const report: EntityAnimationEngineReport = {
    mobs: 0,
    renderControllersGenerated: 0,
    textureVariantsRegistered: 0,
    geometryVariantsRegistered: 0,
    materials: {},
    attachablesGenerated: 0,
    armorSheetsShipped: 0,
    skipped: [],
  };

  const clientFiles = Object.keys(files).filter((path) =>
    /^entity\/[^/]+\.entity\.json$/.test(path),
  );

  for (const path of clientFiles) {
    const mobId = path.slice('entity/'.length, -'.entity.json'.length);
    const raw = files[path];
    if (typeof raw !== 'string') continue;
    let doc: Record<string, any>;
    try {
      doc = JSON.parse(raw) as Record<string, any>;
    } catch {
      report.skipped.push(`${mobId}: client entity JSON is unreadable`);
      continue;
    }
    const desc = doc?.['minecraft:client_entity']?.description;
    if (!desc || typeof desc !== 'object') continue;
    report.mobs += 1;

    // Geometry: keep the primary identifier plus any extra variants the file declares.
    const declared = readGeometryIdentifiers(files[`models/entity/${mobId}.geo.json`]);
    const existingGeometry = desc.geometry && typeof desc.geometry === 'object' ? desc.geometry : {};
    const primary =
      declared[0] ??
      (typeof existingGeometry.default === 'string'
        ? existingGeometry.default
        : `geometry.${mobId}`);
    const geometryIds = declared.length > 0 ? declared : [primary];

    // Textures: the shipped base sheet plus every genuine body-sheet variant.
    const existingTextures = desc.textures && typeof desc.textures === 'object' ? desc.textures : {};
    const { base, variants } = discoverEntityTextureVariants(files, mobId);
    const defaultTexture =
      base ??
      (typeof existingTextures.default === 'string'
        ? existingTextures.default
        : `textures/entity/${mobId}`);
    const textureMap: Record<string, string> = { ...existingTextures, default: defaultTexture };
    const textureKeys = ['default'];
    for (const variant of variants) {
      textureMap[variant.key] = variant.path;
      textureKeys.push(variant.key);
    }

    const header = readPngHeader(files[`${defaultTexture}.png`] as Uint8Array | undefined);
    const emissive = findEmissiveSibling(files, defaultTexture);
    const choice = resolveEntityMaterial(header, Boolean(emissive));

    const geometryMap: Record<string, string> = { default: geometryIds[0] };
    geometryIds.slice(1).forEach((identifier, index) => {
      geometryMap[`variant_${index + 1}`] = identifier;
    });

    const controller = buildEntityRenderController({
      modId,
      mobId,
      geometryIds,
      textureKeys,
    });
    files[controller.filePath] = controller.json;
    report.renderControllersGenerated += 1;

    desc.textures = textureMap;
    desc.geometry = geometryMap;
    desc.materials = {
      ...(desc.materials && typeof desc.materials === 'object' ? desc.materials : {}),
      default: choice.material,
    };
    // The shared default controller only reads `*.default`, which makes the registered
    // variants unreachable (and double-renders the mob if both stay bound).
    const otherControllers = (Array.isArray(desc.render_controllers) ? desc.render_controllers : [])
      .filter(
        (id: unknown) =>
          typeof id === 'string' && id !== 'controller.render.default' && id !== controller.controllerId,
      );
    desc.render_controllers = [controller.controllerId, ...otherControllers];
    files[path] = JSON.stringify(doc, null, 2);

    report.textureVariantsRegistered += variants.length;
    report.geometryVariantsRegistered += geometryIds.length - 1;
    report.materials[choice.material] = (report.materials[choice.material] ?? 0) + 1;

    log(
      `[ENTITY] Mob "${mobId}" -> ${controller.controllerId} bound to ${geometryIds.length} geometry / ${textureKeys.length} texture variant(s); material ${choice.material} — ${choice.evidence}.`,
    );
    if (controller.usesArrays) {
      log(
        `[ENTITY] Mob "${mobId}" -> variants selectable through query.skin_id (registered only; skin selection is unverified until tested in game).`,
      );
    }
    if (emissive) {
      log(
        `[ENTITY] Mob "${mobId}" -> emissive sheet ${emissive}.png detected; it is not bound as a second layer (no texture_set ships), so the body sheet stays the only texture.`,
      );
    }
  }

  const armor = shipArmorAttachables({ modId, items, assetIndex, resourcePackFiles: files, onLog: log });
  report.attachablesGenerated = armor.attachables;
  report.armorSheetsShipped = armor.armorSheets;
  report.skipped.push(...armor.skipped);

  const materialSummary = Object.entries(report.materials)
    .map(([material, count]) => `${material} x${count}`)
    .join(', ');
  log(
    `[ENTITY] Entity & animation engine: ${report.mobs} client entity definition(s) verified against shipped geometry/texture/render-controller files, ${report.renderControllersGenerated} render controller(s) written, ${report.textureVariantsRegistered} texture + ${report.geometryVariantsRegistered} geometry variant(s) registered${materialSummary ? `, materials: ${materialSummary}` : ''}, ${report.attachablesGenerated} armour attachable(s).`,
  );

  return report;
}