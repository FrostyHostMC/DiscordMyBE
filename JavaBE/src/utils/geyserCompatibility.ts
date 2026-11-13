import type { GeyserCompatibilityReport, RemakeItem } from '@/types/remaker';
import { buildGeyserMappings } from '@/utils/geyserMappingBuilder';
import { assembleGeyserBundle } from '@/utils/geyserPackWriter';

export interface GeyserCompatibilityInput {
  modId: string;
  name: string;
  description: string;
  /** Bedrock runtime the native pack targets. */
  targetVersion: string;
  geyserVersion: string;
  items: RemakeItem[];
  javaItemIds?: string[];
  javaBlockIds?: string[];
  resourcePackFiles: Record<string, string | Uint8Array>;
  behaviorPackFiles: Record<string, string | Uint8Array>;
}

export interface GeyserCompatibilityOutput {
  report: GeyserCompatibilityReport;
  files: Record<string, string | Uint8Array>;
}

/**
 * Optional Geyser compatibility target. Mappings are derived only from the packs this port
 * actually shipped (item/block definitions plus their textures and geometry) — nothing is
 * inferred from asset names, and unverified capability states are surfaced rather than
 * assumed to work. The native Bedrock packs remain the primary output.
 */
export function buildGeyserCompatibility(input: GeyserCompatibilityInput): GeyserCompatibilityOutput {
  const mappings = buildGeyserMappings({
    modId: input.modId,
    targetVersion: input.targetVersion,
    geyserVersion: input.geyserVersion,
    items: input.items,
    javaItemIds: input.javaItemIds,
    javaBlockIds: input.javaBlockIds,
    resourcePackFiles: input.resourcePackFiles,
    behaviorPackFiles: input.behaviorPackFiles,
  });
  const bundle = assembleGeyserBundle({
    modId: input.modId,
    name: input.name,
    description: input.description,
    targetVersion: input.targetVersion,
    resourcePackFiles: input.resourcePackFiles,
    mappings,
  });
  return { report: bundle.report, files: bundle.files };
}

/** Log lines for the conversion log, one per generated file and warning. */
export function formatGeyserLog(report: GeyserCompatibilityReport): string[] {
  const lines = [
    `[GEYSER] ${report.summary}. Profile: Geyser ${report.profile.geyserVersion} (${report.profile.source}, bundled snapshot — no live lookup).`,
  ];
  for (const file of report.files) {
    lines.push(`[GEYSER:FILE] ${file.path} — ${file.description}`);
  }
  for (const warning of report.warnings) {
    lines.push(`[GEYSER:WARN] ${warning}`);
  }
  lines.push(
    '[GEYSER] Custom mappings are an additional output target only: the native Bedrock packs stay primary, and no live Geyser or Java client test was performed.',
  );
  return lines;
}