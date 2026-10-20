export interface AddonPack {
  id: string;
  name: string;
  type: 'Behavior Pack' | 'Resource Pack' | 'Skin Pack';
  version: string;
  versionArray?: [number, number, number];
  uuid: string;
  description?: string;
  iconDataUrl?: string; // base64 or objectUrl
  minEngineVersion?: string; // e.g. "1.21.30" (Bedrock min_engine_version)
  /** Bare @minecraft/server version, e.g. "1.13.0" / "2.5.0-beta". Empty when absent. */
  scriptApiVersion?: string;
  /** @minecraft/server-ui version, e.g. "2.0.0". */
  scriptUiApiVersion?: string;
  /** @minecraft/server-gametest version, e.g. "1.5.0". */
  scriptGametestApiVersion?: string;
  /** Human readable label kept for display, e.g. "@minecraft/server 1.13.0". */
  scriptVersion?: string;
  hasScripts?: boolean;
  hasExperimental?: boolean;
  isObfuscated?: boolean;
  /** Manifest capabilities list (e.g. ["script_eval"]). */
  capabilities?: string[];
  subpacks?: Array<{ folder: string; name: string; memory_tier?: number }>;
  fileSize: number; // in bytes
  dateAdded: number; // timestamp
  sourceFileName?: string;
  fileBlob?: Blob; // optional raw blob stored in memory/IDB
}

export interface MergedOutput {
  id: string;
  label: string; // e.g. "Resource Pack", "Behavior (Data)", "Behavior (Script API v2)"
  fileName: string; // e.g. resource_pack.mcpack
  type: 'resource' | 'behavior_data' | 'behavior_script';
  scriptMajor?: number;
  scriptVersion?: string;
  packCount: number;
  size: number;
  achievementsDisabled: boolean;
  blob?: Blob;
}

export interface MergedModpack {
  id: string;
  name: string;
  totalPacks: number;
  size: number; // bytes
  version: string;
  createdAt: number;
  iconDataUrl?: string;
  description: string;
  author?: string;
  outputs?: MergedOutput[];
  includedPacks: Array<{
    name: string;
    type: string;
    version: string;
    iconDataUrl?: string;
    uuid?: string;
    fileSize?: number;
    dateAdded?: number;
  }>;
  outputBlob?: Blob;
  outputFileName: string;
  /**
   * AutoBE merge metadata. Deliberately NOT written inside the .mcaddon so
   * Minecraft only ever sees pack entries; exposed here so the app can offer
   * it as a separate sidecar download.
   */
  mergeManifest?: {
    tool: string;
    mergedAt: string;
    modpackName: string;
    version: string;
    plan: string;
    identifierResolutions: number;
    sourcePacks: Array<{
      name: string;
      type: string;
      version: string;
      uuid: string;
      sourceFileName?: string;
    }>;
  };
}

export type ConflictType =
  | 'entity'
  | 'item'
  | 'block'
  | 'recipe'
  | 'loot_table'
  | 'animation_controller'
  | 'render_controller'
  | 'custom_command'
  | 'entity_component'
  | 'item_component'
  | 'tick_function';

export type ConflictResolution = 'prefix_all' | 'keep_a' | 'keep_b' | 'merge';

export interface ConflictItem {
  id: string;
  type: ConflictType;
  identifier: string;
  /** Every pack that defines this identifier (2 or more when conflicting). */
  packs: Array<{ id: string; name: string }>;
  packA: { id: string; name: string };
  packB: { id: string; name: string };
  resolution: ConflictResolution;
}

export type TabType = 'home' | 'library' | 'mypacks' | 'settings';
export type ScreenType =
  | 'splash'
  | 'main'
  | 'activation'
  | 'add_packs'
  | 'compatibility'
  | 'subpack'
  | 'script_check'
  | 'conflicts'
  | 'merging'
  | 'merge_complete'
  | 'modpack_details'
  | 'about'
  | 'pack_extract'
  | 'list_maker'
  | 'tos'
  | 'privacy';

/** Mirrors the Python `_detect_spoofing` / `_check_activation` verification pipeline. */
export interface VerificationState {
  /** SHA-256 of the device fingerprint. Never the raw fingerprint itself. */
  deviceId: string;
  status: 'checking' | 'unverified' | 'verified' | 'denied' | 'offline_ok' | 'update_required';
  reason?: string;
  minVersion?: string;
  latestVersion?: string;
  /** Populated once the device has been authorised (mirrors `_save_verified_hwid`). */
  verifiedAt?: number;
}