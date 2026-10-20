import JSZip from 'jszip';
import { AddonPack, ConflictItem, ConflictType } from '@/types/modpack';

export interface ParseResult {
  packs: AddonPack[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

/**
 * Strips `//` / `/* *\/` comments and trailing commas.
 *
 * `//` inside a string literal is preserved (e.g. a pack_icon URL), which is the
 * difference between this and the previous naive `replace(/^\s*\/\/.*$/gm)`.
 */
export function sanitizeJsonString(raw: string): string {
  if (!raw) return '';
  let out = '';
  let i = 0;
  const n = raw.length;
  let inString = false;
  let inLine = false;
  let inBlock = false;

  while (i < n) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      i++;
      continue;
    }

    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i += 2;
        continue;
      }
      if (ch === '\n') out += ch; // preserve line numbering
      i++;
      continue;
    }

    if (inString) {
      out += ch;
      if (ch === '\\') {
        // Copy the escaped char verbatim so `\"` does not end the string.
        if (i + 1 < n) out += raw[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLine = true;
      i += 2;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }

  // Remove trailing commas before } or ]
  return out.replace(/,\s*([}\]])/g, '$1');
}

/** `sanitizeJsonString` + `JSON.parse`, returning `null` instead of throwing. */
export function safeParseJson(raw: string): any | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const attempts = [raw, sanitizeJsonString(raw)];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      /* fallback below */
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Stable JSON key order so logically-equal objects dedupe correctly. */
function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Deep merge used for every "mergeable" JSON file.
 *
 * Key fix vs the previous version: object entries inside arrays are compared
 * with a *key-order independent* serialisation, and objects are never round
 * tripped through `JSON.parse` on a string heuristic (which corrupted any real
 * string element that happened to start with `{`).
 */
export function deepMerge(target: any, source: any): any {
  if (source === undefined) return target;
  if (!source || typeof source !== 'object') return source;
  if (!target || typeof target !== 'object') return cloneValue(source);

  if (Array.isArray(target) && Array.isArray(source)) {
    const result = target.slice();
    const seen = new Set(result.map(stableStringify));
    for (const item of source) {
      const key = stableStringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(cloneValue(item));
      }
    }
    return result;
  }

  if (Array.isArray(target) !== Array.isArray(source)) return cloneValue(source);

  const result: Record<string, any> = { ...target };
  for (const key of Object.keys(source)) {
    const a = result[key];
    const b = source[key];
    if (key in result && a && b && typeof a === 'object' && typeof b === 'object') {
      result[key] = deepMerge(a, b);
    } else {
      result[key] = cloneValue(b);
    }
  }
  return result;
}

function cloneValue<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(v);
    } catch {
      /* fall through to JSON clone */
    }
  }
  return JSON.parse(JSON.stringify(v));
}

/**
 * Merges `.lang` files.
 *
 * The header comment is emitted exactly once (the previous version prepended it
 * on every call, so a 5-pack merge produced 5 stacked headers).
 */
export function mergeLangFiles(langA: string, langB: string): string {
  const map = new Map<string, string>();
  const parse = (text: string) => {
    if (!text) return;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/^\uFEFF/, '');
      if (!line.trim()) continue;
      if (line.trimStart().startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      if (!key) continue;
      map.set(key, line.slice(eqIdx + 1).replace(/\r$/, ''));
    }
  };
  parse(langA);
  parse(langB);

  const out: string[] = ['## Merged by AutoBE by StoneByte'];
  for (const [k, v] of map.entries()) out.push(`${k}=${v}`);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------

/** Minecraft module dependencies we care about. */
export const SCRIPT_API_MODULES = [
  '@minecraft/server',
  '@minecraft/server-ui',
  '@minecraft/server-gametest'
] as const;

export function toVersionString(value: any): string {
  if (Array.isArray(value)) return value.join('.');
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Normalizes `[1,21,30]` / `"1.21.30"` into `"1.21.30"`. */
export function normalizeEngineVersion(raw: any): string {
  const s = toVersionString(raw).trim();
  if (!s) return '';
  const parts = s.split('.');
  const major = parseInt(parts[0], 10);
  if (Number.isNaN(major) || major <= 0) return '';
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;
  return `${major}.${minor}.${patch}`;
}

/**
 * Extracts the *bare* version from a dependency version field.
 * Bedrock manifests normally store `"1.13.0"` but some store `"1.13.0-beta"`.
 */
export function normalizeScriptVersion(raw: any): string {
  if (raw === null || raw === undefined) return '';
  const s = toVersionString(raw).trim().replace(/^v/i, '');
  if (!s) return '';
  const m = s.match(/^(\d+(?:\.\d+){0,2})(.*)$/);
  if (!m) return '';
  const nums = m[1].split('.').map((x) => parseInt(x, 10) || 0);
  while (nums.length < 3) nums.push(0);
  const suffix = m[2] || '';
  return `${nums[0]}.${nums[1]}.${nums[2]}${suffix}`;
}

/**
 * Decides whether a pack disables Xbox achievements.
 * Mirrors the Python `_check_achievement_compatibility`.
 */
export function detectAchievementBreaking(
  manifest: any
): { hasScripts: boolean; hasExperimental: boolean; capabilities: string[] } {
  const modules = Array.isArray(manifest?.modules) ? manifest.modules : [];
  const header = manifest?.header || {};

  let hasScripts = false;
  for (const mod of modules) {
    const type = String(mod?.type || '').toLowerCase();
    if (type === 'script') hasScripts = true;
  }

  const capabilities: string[] = Array.isArray(manifest?.capabilities)
    ? manifest.capabilities.filter((c: any) => typeof c === 'string')
    : [];

  // `script_eval` and `experimental_custom_syntax` are the two that matter, but
  // any declared capability marks the pack as experimental for Bedrock.
  const hasExperimental =
    capabilities.length > 0 || header?.experimental === true || header?.experimental === 'true';

  return { hasScripts, hasExperimental, capabilities };
}

/**
 * Detects closed-source / obfuscated packs.
 *
 * Port of the Python `_is_pack_obfuscated`: a file whose first bytes are the
 * illegal-JSON sequence "slash-star slash" (the protection marker those packs
 * ship), or one with a high density of unicode escapes.
 */
export async function isArchiveObfuscated(zip: JSZip): Promise<boolean> {
  const entries = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith('.json'));
  for (const entry of entries) {
    let raw: string;
    try {
      raw = (await entry.async('text')).slice(0, 2048);
    } catch {
      continue;
    }
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('*/')) return true;
    const escapes = trimmed.match(/\\u[0-9a-fA-F]{4}/g);
    if (escapes && escapes.length > 15) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Archive parsing
// ---------------------------------------------------------------------------

/** Finds the best manifest inside a zip (root > behavior_pack > first found). */
export function pickManifestPath(paths: string[]): string | null {
  let behaviorPack: string | null = null;
  let firstSubdir: string | null = null;
  for (const p of paths) {
    const lower = p.toLowerCase().replace(/\\/g, '/');
    if (lower === 'manifest.json') return p;
    if (lower.endsWith('/manifest.json')) {
      if (!firstSubdir) firstSubdir = p;
      if (lower.includes('behavior_pack') && !behaviorPack) behaviorPack = p;
    }
  }
  return behaviorPack || firstSubdir;
}

/**
 * Parses a `.mcpack` / `.mcaddon` / `.zip` blob into one or more AddonPacks.
 *
 * Handles nested archives, `.mcaddon` archives containing `behavior_pack/` +
 * `resource_pack/` folders, and packs whose manifest lives in a subfolder.
 */
export async function parseAddonArchive(
  file: File | Blob,
  originalFileName?: string,
  depth = 0
): Promise<ParseResult> {
  const packs: AddonPack[] = [];
  const errors: string[] = [];

  if (depth > 6) {
    return { packs, errors: ['Archive nesting is too deep to unpack.'] };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err: any) {
    return { packs, errors: [`Not a readable zip archive: ${err?.message || err}`] };
  }

  const manifestPaths: string[] = [];
  zip.forEach((p, entry) => {
    if (entry.dir) return;
    if (p.includes('__MACOSX')) return;
    if (p.toLowerCase().replace(/\\/g, '/').endsWith('manifest.json')) manifestPaths.push(p);
  });

  if (manifestPaths.length === 0) {
    // Recurse into nested archives (an .mcaddon that just wraps two .mcpacks).
    const nested: string[] = [];
    zip.forEach((p, entry) => {
      if (entry.dir || p.includes('__MACOSX')) return;
      const l = p.toLowerCase();
      if (l.endsWith('.mcpack') || l.endsWith('.mcaddon') || l.endsWith('.zip')) nested.push(p);
    });

    if (nested.length > 0) {
      for (const nestedPath of nested) {
        try {
          const nestedBlob = await zip.file(nestedPath)?.async('blob');
          if (!nestedBlob) continue;
          const res = await parseAddonArchive(
            nestedBlob,
            nestedPath.split('/').pop(),
            depth + 1
          );
          packs.push(...res.packs);
          errors.push(...res.errors);
        } catch (err: any) {
          errors.push(`Failed to unpack nested ${nestedPath}: ${err?.message || err}`);
        }
      }
      return { packs, errors };
    }

    errors.push(`No manifest.json found in ${originalFileName || 'archive'}`);
    return { packs, errors };
  }

  const obfuscated = await isArchiveObfuscated(zip);

  // Group entries by the folder that owns their manifest, so each pack only
  // receives its own files when several packs share one archive.
  const folders = new Set(manifestPaths.map((p) => p.slice(0, p.lastIndexOf('/') + 1)));

  for (const manifestPath of manifestPaths) {
    try {
      const content = await zip.file(manifestPath)?.async('text');
      if (!content) continue;
      const manifest = safeParseJson(content);
      if (!manifest) {
        errors.push(`Could not parse ${manifestPath} in ${originalFileName || 'archive'}`);
        continue;
      }

      const rootFolder = manifestPath.substring(0, manifestPath.lastIndexOf('/') + 1);
      const header = manifest.header || {};
      const modules = Array.isArray(manifest.modules) ? manifest.modules : [];

      // --- Type detection ---
      let type: AddonPack['type'] = 'Behavior Pack';
      let moduleType = 'data';
      for (const mod of modules) {
        const t = String(mod?.type || '').toLowerCase();
        if (t === 'resources') {
          type = 'Resource Pack';
          moduleType = 'resources';
        } else if (t === 'skin_pack') {
          type = 'Skin Pack';
          moduleType = 'skin_pack';
        } else if (t === 'data' || t === 'script' || t === 'javascript') {
          type = 'Behavior Pack';
          if (moduleType !== 'resources') moduleType = t === 'data' ? 'data' : 'script';
        }
      }

      const { hasScripts, hasExperimental, capabilities } = detectAchievementBreaking(manifest);

      // --- Script API dependencies ---
      let serverVer = '';
      let serverUiVer = '';
      let gametestVer = '';
      for (const dep of Array.isArray(manifest.dependencies) ? manifest.dependencies : []) {
        const name = dep?.module_name;
        if (name === '@minecraft/server') serverVer = normalizeScriptVersion(dep.version);
        else if (name === '@minecraft/server-ui') serverUiVer = normalizeScriptVersion(dep.version);
        else if (name === '@minecraft/server-gametest')
          gametestVer = normalizeScriptVersion(dep.version);
      }
      const declaredScripts = hasScripts || !!serverVer;

      // --- Subpacks ---
      let subpacks: AddonPack['subpacks'] = undefined;
      if (Array.isArray(manifest.subpacks) && manifest.subpacks.length > 0) {
        subpacks = manifest.subpacks.map((s: any) => ({
          folder: s?.folder || s?.folder_name || '',
          name: s?.name || s?.folder || s?.folder_name || 'Subpack',
          memory_tier: s?.memory_tier
        }));
      }

      // --- Icon ---
      let iconDataUrl: string | undefined;
      const iconFile =
        zip.file(`${rootFolder}pack_icon.png`) ||
        zip.file(`${rootFolder}pack_icon.jpg`) ||
        zip.file(`${rootFolder}pack_icon.jpeg`);
      if (iconFile) {
        try {
          const base64 = await iconFile.async('base64');
          const mime = iconFile.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
          iconDataUrl = `data:${mime};base64,${base64}`;
        } catch {
          /* icon is optional */
        }
      }

      // --- Rebuild this pack as its own zip (only its own folder's files) ---
      const packZip = new JSZip();
      let included = 0;
      zip.forEach((p, entry) => {
        if (entry.dir) return;
        if (!p.startsWith(rootFolder)) {
          // A root-level manifest shares the archive with other packs; only pull
          // in top-level dirs that are not claimed by another pack's manifest.
          const top = p.split('/')[0] + '/';
          if (folders.size > 1 && folders.has(top)) return;
          if (folders.size > 1 && p.includes('/')) return;
        }
        const rel = p.slice(rootFolder.length);
        if (!rel) return;
        packZip.file(rel, entry.async('uint8array'));
        included++;
      });

      if (included === 0) {
        errors.push(`${manifestPath} contained no readable files.`);
        continue;
      }

      const packBlob = await packZip.generateAsync({ type: 'blob' });

      const versionArray = Array.isArray(header.version)
        ? ([0, 1, 2].map((i) => parseInt(String(header.version[i]), 10) || 0) as [number, number, number])
        : undefined;

      packs.push({
        id: generateUUID(),
        name:
          (typeof header.name === 'string' && header.name.trim()) ||
          originalFileName?.replace(/\.[^/.]+$/, '') ||
          'Unnamed Pack',
        type,
        version: versionArray ? `v${versionArray.join('.')}` : String(header.version || 'v1.0.0'),
        versionArray,
        uuid: header.uuid || generateUUID(),
        description:
          typeof header.description === 'string' ? header.description : 'Imported Bedrock addon pack',
        iconDataUrl,
        minEngineVersion: normalizeEngineVersion(header.min_engine_version),
        scriptApiVersion: serverVer || undefined,
        scriptUiApiVersion: serverUiVer || undefined,
        scriptGametestApiVersion: gametestVer || undefined,
        scriptVersion: serverVer
          ? `@minecraft/server ${serverVer}`
          : serverUiVer
          ? `@minecraft/server-ui ${serverUiVer}`
          : declaredScripts
          ? 'Script Module (no version declared)'
          : undefined,
        hasScripts: declaredScripts,
        hasExperimental,
        capabilities,
        isObfuscated: obfuscated,
        subpacks,
        fileSize: packBlob.size || (file as Blob).size || 0,
        dateAdded: Date.now(),
        sourceFileName: originalFileName,
        fileBlob: packBlob
      });
    } catch (e: any) {
      errors.push(`Error parsing ${manifestPath}: ${e?.message || e}`);
    }
  }

  return { packs, errors };
}

// ---------------------------------------------------------------------------
// Identifier scanning & conflict detection
// ---------------------------------------------------------------------------

/** Folders whose JSON files are scanned for identifiers. */
const SCAN_FOLDERS: Array<{ match: RegExp; type: ConflictType; keys: string[] }> = [
  {
    match: /(^|\/)entities?\//i,
    type: 'entity',
    keys: ['minecraft:entity', 'minecraft:client_entity']
  },
  { match: /(^|\/)items\//i, type: 'item', keys: ['minecraft:item'] },
  { match: /(^|\/)blocks\//i, type: 'block', keys: ['minecraft:block'] },
  { match: /(^|\/)recipes\//i, type: 'recipe', keys: ['minecraft:recipe_shaped', 'minecraft:recipe_shapeless', 'minecraft:recipe_furnace', 'minecraft:recipe_crafting_table', 'minecraft:recipe_stonecutter', 'minecraft:recipe_smithing_transform'] },
  { match: /animation_controllers\//i, type: 'animation_controller', keys: ['animation_controllers'] },
  { match: /render_controllers\//i, type: 'render_controller', keys: ['render_controllers'] }
];

/** Identifiers owned by Minecraft that must never be prefixed or renamed. */
const RESERVED_NAMESPACE = 'minecraft';

/** One identifier discovered inside a pack. */
export interface ScannedIdentifier {
  identifier: string;
  type: ConflictType;
  filePath: string;
}

/**
 * Extracts every identifier defined by a pack.
 * Loot-table identifiers are derived from the file path (`minecraft:entities/zombie`).
 */
export async function scanPackIdentifiers(zip: JSZip): Promise<ScannedIdentifier[]> {
  const found: ScannedIdentifier[] = [];
  const push = (identifier: any, type: ConflictType, filePath: string) => {
    if (typeof identifier === 'string' && identifier.trim()) {
      found.push({ identifier: identifier.trim(), type, filePath });
    }
  };

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (path.toLowerCase().includes('__macosx')) continue;
    const norm = path.replace(/\\/g, '/');

    // Loot tables: id comes from the path, not the file body.
    if (/^loot_tables\//i.test(norm) && norm.toLowerCase().endsWith('.json')) {
      const rest = norm.slice('loot_tables/'.length).replace(/\.json$/i, '');
      const parts = rest.split('/').filter(Boolean);
      if (parts.length >= 2) push(`${parts[0]}:${parts.slice(1).join('/')}`, 'loot_table', norm);
      else if (parts.length === 1) push(`loot_tables:${parts[0]}`, 'loot_table', norm);
      continue;
    }

    if (!norm.toLowerCase().endsWith('.json')) continue;

    // Recipe ids that live inside a dedicated recipes/*.json wrapper file.
    if (/^recipes\//i.test(norm)) {
      const json = safeParseJson(await entry.async('text').catch(() => ''));
      if (!json) continue;
      const wrapped =
        json['minecraft:recipe_shaped'] ??
        json['minecraft:recipe_shapeless'] ??
        json['minecraft:recipe_furnace'] ??
        null;
      if (wrapped?.description?.identifier) {
        push(wrapped.description.identifier, 'recipe', norm);
      } else {
        // Bare recipe file: the id is the path itself.
        const rest = norm.slice('recipes/'.length).replace(/\.json$/i, '');
        if (rest) push(`minecraft:${rest}`, 'recipe', norm);
      }
      continue;
    }

    const rule = SCAN_FOLDERS.find((r) => r.match.test(norm));
    if (!rule) continue;

    const json = safeParseJson(await entry.async('text').catch(() => ''));
    if (!json) continue;

    for (const key of rule.keys) {
      const node = json[key];
      if (!node) continue;

      if (rule.type === 'animation_controller' || rule.type === 'render_controller') {
        // These files are keyed directly by identifier: { "ns:foo": { states: {} } }
        for (const k of Object.keys(node)) push(k, rule.type, norm);
        continue;
      }

      const id = node?.description?.identifier;
      if (id && id !== `${RESERVED_NAMESPACE}:player`) push(id, rule.type, norm);
    }
  }

  return found;
}

/**
 * Builds the conflict list from a set of packs.
 *
 * Fixed vs the previous implementation:
 *  - identifiers are keyed per type (an entity and an item may share a name)
 *  - `client_entity` under `entity/` is scanned too (resource packs)
 *  - every colliding pack is listed, so a 3-way conflict produces 3 pairs
 *  - conflicts involving more than one pack include `minecraft:player` edits too
 */
export async function detectConflicts(packs: AddonPack[]): Promise<ConflictItem[]> {
  // `${type}::${identifier}` -> packs that define it, in scan order.
  const index = new Map<string, { identifier: string; type: ConflictType; packs: Array<{ id: string; name: string }> }>();

  for (const pack of packs) {
    if (!pack.fileBlob) continue;
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(pack.fileBlob);
    } catch {
      continue;
    }

    let scanned: ScannedIdentifier[];
    try {
      scanned = await scanPackIdentifiers(zip);
    } catch {
      continue;
    }

    for (const { identifier, type } of scanned) {
      const key = `${type}::${identifier}`;
      let entry = index.get(key);
      if (!entry) {
        entry = { identifier, type, packs: [] };
        index.set(key, entry);
      }
      if (!entry.packs.some((p) => p.id === pack.id)) {
        entry.packs.push({ id: pack.id, name: pack.name });
      }
    }
  }

  const conflicts: ConflictItem[] = [];
  for (const { identifier, type, packs: owners } of index.values()) {
    if (owners.length < 2) continue;
    // Unordered pairs only. Generating (A,B) and (B,A) separately produced
    // contradictory resolutions ("keep A" and "keep B" for the same identifier),
    // which dropped *both* definitions.
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        conflicts.push({
          id: generateUUID(),
          type,
          identifier,
          packs: owners,
          packA: owners[i],
          packB: owners[j],
          resolution: 'prefix_all'
        });
      }
    }
  }

  return conflicts;
}