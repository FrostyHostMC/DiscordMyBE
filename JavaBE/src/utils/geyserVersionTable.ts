import type { GeyserVersionProfile } from '@/types/remaker';

/**
 * Bundled Geyser compatibility snapshot.
 *
 * No live Geyser lookup is performed (the app runs fully in the browser), so these
 * capability floors are shipped with the build and are reported as a snapshot. A version
 * outside the table resolves to an UNKNOWN profile: every capability is then reported as
 * unknown instead of being assumed to work.
 */
const SNAPSHOT_NOTE =
  'Capability floors come from the bundled Geyser snapshot; no live lookup was performed. Confirm each capability against your installed Geyser build before relying on it.';

interface ProfileSeed {
  geyserVersion: string;
  verifiedBedrockTarget: string;
  javaTarget: string;
  customItems: boolean;
  customBlocks: boolean;
  customSkulls: boolean;
  customModelData: boolean;
  extensionDescriptors: boolean;
  customMappingsFormatVersion: number;
  notes: string[];
}

const PROFILE_SEEDS: ProfileSeed[] = [
  {
    geyserVersion: '2.6.0',
    verifiedBedrockTarget: '1.21.50',
    javaTarget: 'Java 1.21.x',
    customItems: true,
    customBlocks: true,
    customSkulls: true,
    customModelData: true,
    extensionDescriptors: true,
    customMappingsFormatVersion: 1,
    notes: [
      'Custom item and custom block mappings are read from the custom_mappings folder.',
      'Custom model data overrides are listed for this snapshot.',
    ],
  },
  {
    geyserVersion: '2.4.0',
    verifiedBedrockTarget: '1.21.20',
    javaTarget: 'Java 1.21.x',
    customItems: true,
    customBlocks: true,
    customSkulls: true,
    customModelData: false,
    extensionDescriptors: true,
    customMappingsFormatVersion: 1,
    notes: [
      'Custom block mappings are listed, but this snapshot was captured against Bedrock 1.21.20 — a newer Bedrock target is unverified.',
      'Custom model data overrides are not listed for this snapshot.',
    ],
  },
  {
    geyserVersion: '2.2.0',
    verifiedBedrockTarget: '1.21.0',
    javaTarget: 'Java 1.21.x',
    customItems: true,
    customBlocks: false,
    customSkulls: true,
    customModelData: false,
    extensionDescriptors: true,
    customMappingsFormatVersion: 1,
    notes: [
      'This snapshot does not list custom block mappings for Geyser 2.2.0, so block output is reported as unknown compatibility.',
    ],
  },
  {
    geyserVersion: '2.0.0',
    verifiedBedrockTarget: '1.20.80',
    javaTarget: 'Java 1.20.x',
    customItems: false,
    customBlocks: false,
    customSkulls: true,
    customModelData: false,
    extensionDescriptors: true,
    customMappingsFormatVersion: 1,
    notes: ['This snapshot lists no custom item or custom block mappings for Geyser 2.0.0.'],
  },
];

export const GEYSER_VERSION_OPTIONS = PROFILE_SEEDS.map((seed) => seed.geyserVersion);

export const DEFAULT_GEYSER_VERSION = GEYSER_VERSION_OPTIONS[0];

function parseVersion(raw: string): number[] {
  return raw
    .split(/[.\-+_]/)
    .map((part) => parseInt(part.replace(/[^0-9]/g, ''), 10))
    .filter((value) => Number.isFinite(value));
}

function compareVersions(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

const UNKNOWN_SUPPORT = {
  customItems: false,
  customBlocks: false,
  customSkulls: false,
  customModelData: false,
  extensionDescriptors: false,
  customMappingsFormatVersion: 1,
};

/** Resolves the advertised Geyser version against the bundled snapshot. */
export function resolveGeyserProfile(geyserVersion: string, bedrockTarget: string): GeyserVersionProfile {
  const requested = parseVersion(geyserVersion);
  let seed: ProfileSeed | undefined;

  for (const candidate of PROFILE_SEEDS) {
    const candidateVersion = parseVersion(candidate.geyserVersion);
    if (requested.length > 0 && compareVersions(candidateVersion, requested) > 0) continue;
    if (!seed || compareVersions(parseVersion(seed.geyserVersion), candidateVersion) < 0) seed = candidate;
  }

  if (!seed) {
    return {
      geyserVersion,
      bedrockTarget,
      verifiedBedrockTarget: 'unknown',
      javaTarget: 'unknown',
      source: 'unknown',
      supports: { ...UNKNOWN_SUPPORT },
      notes: [
        `Geyser ${geyserVersion} is outside the bundled compatibility snapshot, so every capability is reported as unknown rather than assumed.`,
        SNAPSHOT_NOTE,
      ],
    };
  }

  const notes = [...seed.notes];
  if (seed.geyserVersion !== geyserVersion) {
    notes.push(
      `Resolved against the bundled Geyser ${seed.geyserVersion} capability floor for the requested ${geyserVersion}.`,
    );
  }
  if (seed.verifiedBedrockTarget !== bedrockTarget) {
    notes.push(
      `The snapshot was captured against Bedrock ${seed.verifiedBedrockTarget}; Bedrock ${bedrockTarget} is not verified, so features that depend on the engine build stay unverified.`,
    );
  }
  notes.push(SNAPSHOT_NOTE);

  return {
    geyserVersion,
    bedrockTarget,
    verifiedBedrockTarget: seed.verifiedBedrockTarget,
    javaTarget: seed.javaTarget,
    source: 'bundled-snapshot',
    supports: {
      customItems: seed.customItems,
      customBlocks: seed.customBlocks,
      customSkulls: seed.customSkulls,
      customModelData: seed.customModelData,
      extensionDescriptors: seed.extensionDescriptors,
      customMappingsFormatVersion: seed.customMappingsFormatVersion,
    },
    notes,
  };
}