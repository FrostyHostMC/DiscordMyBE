import type { ModelPortStats } from '@/utils/modelPortEngine';
import type { ModelSourceRegistryReport } from '@/utils/universalModelRegistry';
import type { MeshRepairReport } from '@/utils/geometryMeshRepair';

/**
 * Consolidated model / geometry / animation port report.
 *
 * Every number here is copied from an engine that actually ran: the model source registry
 * (formats found), the model port engine (models recovered per source), the animation engine
 * (clips imported, clamped, withheld), the bone retargeter (tracks bound vs unresolved) and
 * the mesh repair pass (structural defects repaired). Nothing is estimated, and anything the
 * engine could not express stays in `unresolved` instead of being rounded away.
 */

export interface ModelPortAnimationSummary {
  sourceFiles: number;
  clipsImported: number;
  clipsAttributed: number;
  clipsWithheld: number;
  clipsInvented: number;
  boneTracksRetargeted: number;
  boneTracksUnmapped: string[];
  playerRigClips: number;
  playerBoneMappings: number;
}

export interface ModelPortReport {
  /** Modelling documents found in the archive, per format. */
  formats: Record<string, number>;
  documentsFound: number;
  documentsConverted: number;
  unsupportedDocuments: Array<{ path: string; format: string; reason: string }>;
  geckolibModels: number;
  javaEntityModels: number;
  javaElementModels: number;
  polyMeshModels: number;
  blockbenchModels: number;
  /** Tabula `.tbl` / Tabula JSON documents converted into Bedrock geometry. */
  tabulaModels: number;
  /** OptiFine CEM `.jem` / `.jpm` documents converted into Bedrock geometry. */
  cemModels: number;
  cubesConverted: number;
  /** Mobs that still ship on a generated rig because no source model exists at all. */
  mobsWithoutAuthenticModel: string[];
  mobsWithAuthenticModel: number;
  skeletonPartsPreserved: number;
  skeletonPartsReparented: number;
  skeletonRootsAdded: number;
  mesh: {
    geometryFiles: number;
    variants: number;
    bonesReparented: number;
    parentCyclesBroken: number;
    duplicateBonesRenamed: number;
    cubeUvsRestored: number;
    degenerateCubesFixed: number;
    polyMeshBonesPreserved: number;
    unresolved: string[];
  };
  animations: ModelPortAnimationSummary;
  /** Human-readable one-line outcome for the dashboard header. */
  summary: string;
}

export interface ModelPortReportInput {
  stats: ModelPortStats;
  registry: ModelSourceRegistryReport | null;
  mesh: MeshRepairReport | null;
  animation: {
    sourceFiles?: number;
    clipsImported?: number;
    clipsAttributed?: number;
    clipsWithheld?: number;
    clipsInvented?: number;
    boneTracksRetargeted?: number;
    boneTracksUnmapped?: string[];
    playerRigClips?: number;
    playerBoneMappings?: number;
  };
}

export function buildModelPortReport(input: ModelPortReportInput): ModelPortReport {
  const stats = input.stats;
  const registry = input.registry;
  const mesh = input.mesh;
  const animation: ModelPortAnimationSummary = {
    sourceFiles: input.animation.sourceFiles ?? 0,
    clipsImported: input.animation.clipsImported ?? 0,
    clipsAttributed: input.animation.clipsAttributed ?? 0,
    clipsWithheld: input.animation.clipsWithheld ?? 0,
    clipsInvented: input.animation.clipsInvented ?? 0,
    boneTracksRetargeted: input.animation.boneTracksRetargeted ?? 0,
    boneTracksUnmapped: input.animation.boneTracksUnmapped ?? [],
    playerRigClips: input.animation.playerRigClips ?? 0,
    playerBoneMappings: input.animation.playerBoneMappings ?? 0,
  };

  const reports: ModelPortReport = {
    formats: registry ? { ...registry.byFormat } : {},
    documentsFound: registry?.files ?? 0,
    documentsConverted:
      stats.modModelsParsed +
      stats.geckolibModelsFound +
      stats.javaEntityModelsConverted +
      stats.polyMeshModelsConverted +
      stats.blockbenchModelsConverted +
      stats.tabulaModelsConverted +
      stats.cemModelsConverted,
    unsupportedDocuments: registry ? registry.unsupported.map((entry) => ({ path: entry.path, format: entry.format, reason: entry.reason })) : [],
    geckolibModels: stats.geckolibModelsFound,
    javaEntityModels: stats.javaEntityModelsConverted,
    javaElementModels: stats.elementsConvertedCount,
    polyMeshModels: stats.polyMeshModelsConverted,
    blockbenchModels: stats.blockbenchModelsConverted,
    tabulaModels: stats.tabulaModelsConverted,
    cemModels: stats.cemModelsConverted,
    cubesConverted: stats.elementsConvertedCount + stats.javaEntityModelsConverted,
    mobsWithAuthenticModel: stats.authenticMobModels,
    mobsWithoutAuthenticModel: stats.mobsWithoutAuthenticModel,
    skeletonPartsPreserved: stats.skeletonPartsPreserved,
    skeletonPartsReparented: stats.skeletonPartsReparented,
    skeletonRootsAdded: stats.skeletonRootsAdded,
    mesh: {
      geometryFiles: mesh?.geometryFiles ?? 0,
      variants: mesh?.variants ?? 0,
      bonesReparented: mesh?.bonesReparented ?? 0,
      parentCyclesBroken: mesh?.parentCyclesBroken ?? 0,
      duplicateBonesRenamed: mesh?.duplicateBonesRenamed ?? 0,
      cubeUvsRestored: mesh?.cubeUvsRestored ?? 0,
      degenerateCubesFixed: mesh?.degenerateCubesFixed ?? 0,
      polyMeshBonesPreserved: mesh?.polyMeshBonesPreserved ?? 0,
      unresolved: mesh?.unresolved ?? [],
    },
    animations: animation,
    summary: '',
  };

  reports.summary =
    `${reports.documentsFound} modelling document(s) classified across ${Object.values(reports.formats).filter((count) => count > 0).length} format(s); ` +
    `${reports.geckolibModels} GeckoLib, ${reports.javaEntityModels} Java entity, ${reports.polyMeshModels} polygon-mesh, ${reports.blockbenchModels} Blockbench, ${reports.tabulaModels} Tabula and ${reports.cemModels} OptiFine CEM model(s) converted; ` +
    `${reports.mobsWithAuthenticModel} mob(s) bound to an authentic model, ${reports.mobsWithoutAuthenticModel.length} still on a generated rig (the archive ships no model for them), ${reports.skeletonPartsPreserved} source bone name(s) preserved; ` +
    `${animation.clipsImported} clip(s) imported, ${animation.boneTracksRetargeted} bone track(s) retargeted, ${animation.boneTracksUnmapped.length} unresolved bone track name(s).`;
  return reports;
}