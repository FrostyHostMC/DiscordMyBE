export interface AddonPack {
  id: string;
  name: string;
  type: 'Behavior Pack' | 'Resource Pack' | 'Skin Pack';
  version: string;
  versionArray?: [number, number, number];
  uuid: string;
  description?: string;
  iconDataUrl?: string; // base64 or objectUrl
  minEngineVersion?: string;
  scriptVersion?: string; // e.g. @minecraft/server version if present
  scriptUiVersion?: string;
  gameTestVersion?: string;
  hasScripts?: boolean;
  hasExperimental?: boolean;
  isObfuscated?: boolean;
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
  outputs?: MergedOutput[];
  includedPacks: Array<{
    name: string;
    type: string;
    version: string;
    iconDataUrl?: string;
    uuid?: string;
  }>;
  outputBlob?: Blob;
  // Small JSON files for the combined .mcaddon. The combined file itself is built on demand
  // (see ensureCombinedBlob) so merging never holds an extra full copy in memory.
  combinedExtras?: { manifestJson: string; reportJson: string };
  outputFileName: string;
}

export interface ConflictItem {
  id: string;
  type: 'entity' | 'item' | 'block' | 'recipe' | 'loot_table' | 'animation_controller' | 'render_controller';
  identifier: string;
  packA: { id: string; name: string };
  packB: { id: string; name: string };
  resolution: 'prefix_all' | 'keep_a' | 'keep_b';
}

export type TabType =
  | 'overview'
  | 'home'
  | 'workspace'
  | 'mypacks'
  | 'bp_library'
  | 'rp_library'
  | 'library'
  | 'community'
  | 'conflicts_tool'
  | 'dependencies_tool'
  | 'history_tool'
  | 'logs_tool'
  | 'settings'
  | 'about';

export interface CommunityModpack {
  id: string;
  name: string;
  description: string;
  author: string;
  author_id: string;
  version: string;
  total_packs: number;
  size: number;
  icon_data_url?: string;
  created_at: number;
  downloads: number;
  blob_url: string;
  file_name: string;
  included_packs: Array<{
    name: string;
    type: string;
    version: string;
    icon_data_url?: string;
  }>;
}

export interface MergeSessionConfig {
  name: string;
  description: string;
  version: string;
  targetEngine: string;
  autoPrefix: boolean;
  generateAddon: boolean;
  generateSeparatePacks: boolean;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'success' | 'warn' | 'error';
  category: string;
  message: string;
  details?: string;
}

export type ScreenType =
  | 'splash'
  | 'main'
  | 'add_packs'
  | 'script_check'
  | 'conflicts'
  | 'merging'
  | 'merge_complete'
  | 'modpack_details'
  | 'community'
  | 'about'
  | 'pack_extract'
  | 'list_maker'
  | 'tos'
  | 'privacy';
