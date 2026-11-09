import JSZip from 'jszip';
import { expandBrarchiveFiles } from './brarchive';
import { AddonPack, ConflictItem } from '@/types/modpack';
import { mergeAdditions } from './conservativeMerge';

export interface ParseResult {
  packs: AddonPack[];
  errors: string[];
}

/**
 * Strip JSONC comments and trailing commas without touching quoted strings.
 * Bedrock addon JSON commonly has end-of-line comments after properties;
 * regex-only stripping can delete valid JSON content or leave the file invalid,
 * causing the parser to silently drop important files such as hud_screen.json.
 */
export function sanitizeJsonString(raw: string): string {
  let input = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  let withoutComments = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      withoutComments += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      withoutComments += ch;
      continue;
    }

    // Preserve newlines so line structure remains useful in parser errors.
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n' && input[i] !== '\r') i++;
      if (i < input.length) withoutComments += input[i];
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) {
        if (input[i] === '\n' || input[i] === '\r') withoutComments += input[i];
        i++;
      }
      i++; // consume the slash in */
      continue;
    }
    withoutComments += ch;
  }

  // Remove commas immediately before a closing array/object delimiter, but
  // only when the comma is outside a quoted string.
  let output = '';
  inString = false;
  escaped = false;
  for (let i = 0; i < withoutComments.length; i++) {
    const ch = withoutComments[i];
    if (inString) {
      output += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      output += ch;
      continue;
    }
    if (ch === ',') {
      let nextIndex = i + 1;
      while (nextIndex < withoutComments.length && /\s/.test(withoutComments[nextIndex])) nextIndex++;
      if (withoutComments[nextIndex] === '}' || withoutComments[nextIndex] === ']') continue;
    }
    output += ch;
  }
  return output;
}

/** Normalize a UI registration path relative to the resource-pack root. */
export function normalizeRegisteredUiPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
}

/** Read custom UI paths from every _ui_defs.json in a resource-pack archive. */
export async function collectRegisteredUiPathsFromZip(zip: JSZip): Promise<Set<string>> {
  const paths = new Set<string>();
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir || path.split('/').pop()?.toLowerCase() !== '_ui_defs.json') continue;
    try {
      const data = JSON.parse(sanitizeJsonString(await file.async('text')));
      for (const entry of Array.isArray(data?.ui_defs) ? data.ui_defs : []) {
        if (typeof entry === 'string' && entry.trim()) paths.add(normalizeRegisteredUiPath(entry.trim()));
      }
    } catch {
      // Invalid registrations are reported by archive validation; do not guess paths.
    }
  }
  return paths;
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      // fallback
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Deep merge objects/records
export function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object') return source;
  if (!target || typeof target !== 'object') return structuredClone(source);

  if (Array.isArray(target) && Array.isArray(source)) {
    // Deduplicate primitives or concatenate
    const combined = [...target, ...source];
    return Array.from(new Set(combined.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)))).map((x) =>
      typeof x === 'string' && (x.startsWith('{') || x.startsWith('[')) ? JSON.parse(x) : x
    );
  }

  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key in result && typeof result[key] === 'object' && typeof source[key] === 'object') {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// Merge .lang files and deduplicate keys
export function mergeLangFiles(langA: string, langB: string): string {
  const map = new Map<string, string>();
  const parse = (text: string) => {
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('##') || trimmed.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1);
        map.set(key, val);
      }
    }
  };
  parse(langA);
  parse(langB);

  const out: string[] = ['## Merged by AutoBE by StoneByte'];
  for (const [k, v] of map.entries()) {
    out.push(`${k}=${v}`);
  }
  return out.join('\n');
}

// Detect closed-source/obfuscated JSON content inside a pack folder.
// Markers: JSON starting with '*/' (illegal syntax used for protection),
// or high density of Unicode escapes (\u0065 format) in the first 2KB.
export async function detectObfuscation(
  zip: JSZip,
  rootFolder: string,
  maxChecks = 50
): Promise<boolean> {
  let checked = 0;
  for (const [path, fileObj] of Object.entries(zip.files)) {
    if (fileObj.dir || !path.endsWith('.json')) continue;
    if (rootFolder && !path.startsWith(rootFolder)) continue;
    if (checked >= maxChecks) break;
    checked++;
    try {
      const raw = (await fileObj.async('string')).slice(0, 2048).trim();
      if (raw.startsWith('*/')) return true;
      const escapes = raw.match(/\\u[0-9a-fA-F]{4}/g);
      if (escapes && escapes.length > 15) return true;
    } catch {
      // ignore unreadable entries
    }
  }
  return false;
}

const MAX_NESTED_ARCHIVE_DEPTH = 10;

// Parse an archive file (zip / mcpack / mcaddon) into AddonPacks
export async function parseAddonArchive(
  file: File | Blob,
  originalFileName?: string,
  recursionDepth = 0
): Promise<ParseResult> {
  const zip = new JSZip();
  const loaded = await zip.loadAsync(file);
  const packs: AddonPack[] = [];
  const errors: string[] = [];

  // Only a file whose basename is exactly "manifest.json" is a pack
  // manifest. Combined .mcaddon files also contain AutoBE's
  // "_autobe_merge_manifest.json" report; treating that report as a pack
  // manifest prevents discovery of the actual nested .mcpack files below.
  const manifestPaths: string[] = [];
  loaded.forEach((relativePath) => {
    const basename = relativePath.split('/').pop()?.toLowerCase();
    // Only consider pack manifests at the root or one level deep.
    // Ignore report files and unrelated nested manifests in asset folders.
    const pathParts = relativePath.split('/');
    if (basename === 'manifest.json' && !relativePath.includes('__MACOSX') && pathParts.length <= 2) {
      manifestPaths.push(relativePath);
    }
  });

  if (manifestPaths.length === 0) {
    // Check if there are nested archives
    const nestedZips: string[] = [];
    loaded.forEach((p) => {
      const l = p.toLowerCase();
      if ((l.endsWith('.mcpack') || l.endsWith('.zip') || l.endsWith('.mcaddon')) && !p.includes('__MACOSX')) {
        nestedZips.push(p);
      }
    });

    if (nestedZips.length > 0) {
      if (recursionDepth >= MAX_NESTED_ARCHIVE_DEPTH) {
        errors.push(`Nested archive depth limit reached in ${originalFileName || 'archive'}`);
        return { packs, errors };
      }
      for (const nestedPath of nestedZips) {
        try {
          const nestedData = await loaded.file(nestedPath)?.async('blob');
          if (nestedData) {
            const nestedRes = await parseAddonArchive(
              nestedData,
              nestedPath.split('/').pop(),
              recursionDepth + 1
            );
            packs.push(...nestedRes.packs);
            errors.push(...nestedRes.errors);
          }
        } catch (err: any) {
          errors.push(`Failed to unpack nested ${nestedPath}: ${err.message}`);
        }
      }
    } else {
      errors.push(`No manifest.json found in ${originalFileName || 'archive'}`);
    }
    return { packs, errors };
  }

  for (const manifestPath of manifestPaths) {
    try {
      const content = await loaded.file(manifestPath)?.async('text');
      if (!content) continue;
      const sanitized = sanitizeJsonString(content);
      const manifest = JSON.parse(sanitized);

      const rootFolder = manifestPath.substring(0, manifestPath.lastIndexOf('/') + 1);
      const header = manifest.header || {};
      const modules = manifest.modules || [];

      // Determine type
      let type: AddonPack['type'] = 'Behavior Pack';
      let hasScripts = false;
      let scriptVersion = '';

      for (const mod of modules) {
        const modType = mod.type?.toLowerCase() || '';
        if (modType === 'resources') {
          type = 'Resource Pack';
        } else if (modType === 'skin_pack') {
          type = 'Skin Pack';
        } else if (modType === 'data' || modType === 'script' || modType === 'javascript') {
          type = 'Behavior Pack';
          if (modType === 'script' || modType === 'javascript') {
            hasScripts = true;
          }
        }
      }

      // Check dependencies for scripts and retain each supported module version.
      const scriptVersions: Record<string, string> = {};
      const compareDependencyVersion = (left: string, right: string): number => {
        const clean = (value: string) => {
          const normalized = value.toLowerCase() === 'beta' ? '2.7.0-beta' : value;
          const match = normalized.match(/\d+(?:\.\d+){0,3}/);
          const parts = (match?.[0] || '0.0.0').split('.').map((part) => parseInt(part, 10) || 0);
          while (parts.length < 3) parts.push(0);
          return { parts, beta: /-(beta|alpha|rc|preview)/i.test(normalized) };
        };
        const a = clean(left);
        const b = clean(right);
        for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] - b.parts[i];
        return Number(!a.beta) - Number(!b.beta);
      };
      for (const dep of manifest.dependencies || []) {
        const moduleName = dep?.module_name;
        if (!['@minecraft/server', '@minecraft/server-ui', '@minecraft/server-gametest'].includes(moduleName)) continue;
        // A Script API dependency alone does not make this a script pack.
        // The manifest must declare a script module; otherwise ordinary data packs
        // can be incorrectly routed into the script merger and fail on a missing entry.
        const rawVersion = Array.isArray(dep.version) ? dep.version.join('.') : String(dep.version || '');
        if (!rawVersion) continue;
        const key = moduleName === '@minecraft/server' ? 'server' : moduleName === '@minecraft/server-ui' ? 'ui' : 'gametest';
        if (!scriptVersions[key] || compareDependencyVersion(rawVersion, scriptVersions[key]) > 0) {
          scriptVersions[key] = rawVersion;
        }
      }
      scriptVersion = scriptVersions.server || '';
      const minEngineVersion = Array.isArray(header.min_engine_version)
        ? header.min_engine_version.join('.')
        : typeof header.min_engine_version === 'string' ? header.min_engine_version : undefined;

      // Bedrock's manifest schema uses `folder_name` for subpack folders.
      // Some community packs use the older/nonstandard `folder` spelling, so
      // accept both. Also discover physical subpacks/ folders as a recovery
      // path: otherwise a pack with omitted/malformed manifest metadata would
      // silently lose every file under subpacks/ during accumulation.
      const subpackByFolder = new Map<string, NonNullable<AddonPack['subpacks']>[number]>();
      for (const subpack of Array.isArray(manifest.subpacks) ? manifest.subpacks : []) {
        const folder = String(subpack?.folder_name || subpack?.folder || '').trim();
        if (!folder) continue;
        subpackByFolder.set(folder.toLowerCase(), {
          folder,
          name: String(subpack?.name || folder || 'Subpack'),
          memory_tier: subpack?.memory_tier
        });
      }
      loaded.forEach((path) => {
        const relativePath = rootFolder && path.startsWith(rootFolder) ? path.slice(rootFolder.length) : path;
        const match = relativePath.match(/^subpacks\/([^/]+)\//i);
        if (!match) return;
        const folder = match[1];
        const key = folder.toLowerCase();
        if (!subpackByFolder.has(key)) {
          subpackByFolder.set(key, { folder, name: folder, memory_tier: undefined });
        }
      });
      const subpacks: AddonPack['subpacks'] = subpackByFolder.size > 0
        ? [...subpackByFolder.values()]
        : undefined;

      // Look for pack_icon.png
      let iconDataUrl: string | undefined = undefined;
      const iconFile = loaded.file(`${rootFolder}pack_icon.png`) || loaded.file(`${rootFolder}pack_icon.jpg`);
      if (iconFile) {
        const base64 = await iconFile.async('base64');
        iconDataUrl = `data:image/png;base64,${base64}`;
      }

      // Build single pack zip blob
      const packZip = new JSZip();
      loaded.forEach((p, fileObj) => {
        if (p.startsWith(rootFolder) && !fileObj.dir) {
          const relativeInPack = p.slice(rootFolder.length);
          packZip.file(relativeInPack, fileObj.async('uint8array'));
        }
      });
      const packBlob = await packZip.generateAsync({ type: 'blob' });

      // Obfuscated / closed-source JSON detection (ported from legacy MCPacker)
      let isObfuscated: boolean | undefined;
      try {
        isObfuscated = await detectObfuscation(loaded, rootFolder);
      } catch {
        isObfuscated = undefined;
      }

      packs.push({
        id: generateUUID(),
        name: header.name || originalFileName?.replace(/\.[^/.]+$/, '') || 'Unnamed Pack',
        type,
        version: Array.isArray(header.version) ? `v${header.version.join('.')}` : (header.version || 'v1.0.0'),
        versionArray: Array.isArray(header.version) ? header.version : [1, 0, 0],
        uuid: header.uuid || generateUUID(),
        description: header.description || 'Imported Bedrock addon pack',
        iconDataUrl,
        minEngineVersion,
        hasScripts,
        scriptVersion: scriptVersion || undefined,
        scriptUiVersion: scriptVersions.ui,
        gameTestVersion: scriptVersions.gametest,
        hasExperimental: hasScripts || !!manifest.capabilities?.length,
        isObfuscated,
        subpacks,
        fileSize: packBlob.size || file.size,
        dateAdded: Date.now(),
        sourceFileName: originalFileName,
        fileBlob: packBlob
      });
    } catch (e: any) {
      errors.push(`Error parsing ${manifestPath}: ${e.message}`);
    }
  }

  return { packs, errors };
}

// Scans packs for duplicate identifiers and builds conflicts list
export async function detectConflicts(packs: AddonPack[]): Promise<ConflictItem[]> {
  const conflicts: ConflictItem[] = [];
  const identifierMap = new Map<string, { packId: string; packName: string; type: ConflictItem['type']; data: any }>();
  const assetMap = new Map<string, { packId: string; packName: string; bytes: Uint8Array }>();
  const playersByScope = new Map<string, Array<{ packId: string; packName: string; path: string; data: any }>>();

  for (const pack of packs) {
    if (!pack.fileBlob) continue;
    try {
      const zip = await JSZip.loadAsync(pack.fileBlob);
      // Preflight must inspect the same expanded file inventory that the merge
      // pipeline will actually process. Otherwise definitions stored inside
      // optimized .brarchive containers evade conflict detection.
      await expandBrarchiveFiles(zip);
      // Detect byte-different vanilla-facing textures as explicit user conflicts.
      for (const [path, fileObj] of Object.entries(zip.files)) {
        if (fileObj.dir) continue;
        const lower = path.toLowerCase().replace(/\\/g, '/');
        const vanillaAsset = /^textures\/(items?|blocks?|entity|models|environment|particle|gui)\//i.test(lower)
          && /\.(png|tga|jpg|jpeg|webp)$/i.test(lower);
        if (vanillaAsset) {
          const bytes = await fileObj.async('uint8array');
          const assetKey = `${pack.type}:${lower}`;
          const existing = assetMap.get(assetKey);
          if (existing && existing.packId !== pack.id
            && (existing.bytes.length !== bytes.length || existing.bytes.some((byte, index) => byte !== bytes[index]))) {
            conflicts.push({
              id: generateUUID(),
              type: 'vanilla_asset',
              identifier: path,
              packA: { id: existing.packId, name: existing.packName },
              packB: { id: pack.id, name: pack.name },
              resolution: 'keep_a'
            });
          } else if (!existing) {
            assetMap.set(assetKey, { packId: pack.id, packName: pack.name, bytes });
          }
        }
        if (!lower.endsWith('.json')) continue;

        // minecraft:player is a vanilla override, not a custom identifier to
        // prefix. Compare actual definitions under the relevant pack root,
        // independently of file name; BP and RP definitions are separate.
        const playerRoot = pack.type === 'Resource Pack' && lower.startsWith('entity/')
          ? 'minecraft:client_entity'
          : pack.type === 'Behavior Pack' && lower.startsWith('entities/') ? 'minecraft:entity' : null;
        if (playerRoot) {
          try {
            const playerData = JSON.parse(sanitizeJsonString(await fileObj.async('text')));
            if (playerData?.[playerRoot]?.description?.identifier === 'minecraft:player') {
              const scope = `${pack.type}:${playerRoot}`;
              const previous = playersByScope.get(scope) || [];
              for (const first of previous) {
                // Identical JSON is a redundant copy, not a content conflict.
                const forward = mergeAdditions(first.data, playerData);
                const reverse = mergeAdditions(playerData, first.data);
                if (!forward.changed && !forward.conflicts.length && !reverse.changed && !reverse.conflicts.length) continue;
                conflicts.push({
                  id: generateUUID(), type: 'entity', identifier: 'minecraft:player',
                  packA: { id: first.packId, name: first.packName, path: first.path },
                  packB: { id: pack.id, name: pack.name, path }, resolution: 'keep_a'
                });
              }
              previous.push({ packId: pack.id, packName: pack.name, path, data: playerData });
              playersByScope.set(scope, previous);
              continue;
            }
          } catch { /* Invalid JSON is reported by archive validation. */ }
        }
        let cat: ConflictItem['type'] | null = null;
        if (lower.includes('entities/')) cat = 'entity';
        else if (lower.includes('items/')) cat = 'item';
        else if (lower.includes('blocks/')) cat = 'block';
        else if (lower.includes('recipes/')) cat = 'recipe';
        else if (lower.includes('animation_controllers/')) cat = 'animation_controller';
        else if (lower.includes('render_controllers/')) cat = 'render_controller';

        if (!cat) continue;

        try {
          const txt = await fileObj.async('text');
          const json = JSON.parse(sanitizeJsonString(txt));
          let ident = '';
          if (cat === 'entity') ident = json['minecraft:entity']?.description?.identifier;
          else if (cat === 'item') ident = json['minecraft:item']?.description?.identifier;
          else if (cat === 'block') ident = json['minecraft:block']?.description?.identifier;
          else if (cat === 'recipe') ident = json['minecraft:recipe_shaped']?.description?.identifier || json['minecraft:recipe_shapeless']?.description?.identifier;
          else if (cat === 'animation_controller') ident = Object.keys(json.animation_controllers || {})[0];
          else if (cat === 'render_controller') ident = Object.keys(json.render_controllers || {})[0];

          if (ident && ident !== 'minecraft:player') {
            const identifierKey = `${pack.type}:${cat}:${ident}`;
            if (identifierMap.has(identifierKey)) {
              const existing = identifierMap.get(identifierKey)!;
              const comparison = mergeAdditions(existing.data, json);
              if (existing.packId !== pack.id && (comparison.changed || comparison.conflicts.length > 0)) {
                conflicts.push({
                  id: generateUUID(),
                  type: cat,
                  identifier: ident,
                  packA: { id: existing.packId, name: existing.packName },
                  packB: { id: pack.id, name: pack.name },
                  resolution: 'keep_a'
                });
              }
            } else {
              identifierMap.set(identifierKey, { packId: pack.id, packName: pack.name, type: cat, data: json });
            }
          }
        } catch {
          // ignore individual json parse errors
        }
      }
    } catch (error) {
      // A malformed optimized archive can hide definitions from conflict
      // preflight. Do not silently continue with an incomplete inventory.
      if (error instanceof Error && /\\.brarchive|brarchive/i.test(error.message)) {
        throw error;
      }
      // Ignore unreadable non-archive packs here; their parse diagnostics are
      // surfaced by the normal import/validation path.
    }
  }

  return conflicts;
}