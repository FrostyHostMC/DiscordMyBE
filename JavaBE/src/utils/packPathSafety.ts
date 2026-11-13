export interface DroppedPackEntry {
  path: string;
  reason: string;
}

export interface NormalizedPackFiles {
  files: Record<string, string | Uint8Array>;
  dropped: DroppedPackEntry[];
}

const INVALID_SEGMENT_CHARS = /[<>:"|?*]/;
const URL_PREFIX = /^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i;
const MAX_PATH_LENGTH = 180;

function hasInvalidSegmentChars(segment: string): boolean {
  if (INVALID_SEGMENT_CHARS.test(segment)) return true;
  for (const char of segment) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Bedrock's pack importer rejects an archive as "unknown pack or broken" when it meets
 * an entry name that is not a clean pack-relative path. Two sources leak bad names into
 * every export: asset-dictionary values (absolute `/pack_icon.png` or CDN URLs) and raw
 * mod archive paths (backslashes, `..`, control characters). Every entry is therefore
 * normalised before it reaches the zip writer.
 */
export function sanitizePackEntryPath(rawPath: string): string | null {
  if (typeof rawPath !== 'string') return null;
  let path = rawPath.trim().replace(/\\/g, '/');
  if (path.length === 0) return null;
  path = path.replace(URL_PREFIX, '');
  path = path.replace(/^\/+/, '');

  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0) segments.pop();
      continue;
    }
    if (hasInvalidSegmentChars(segment)) return null;
    segments.push(segment);
  }
  if (segments.length === 0) return null;

  const clean = segments.join('/');
  return clean.length > MAX_PATH_LENGTH ? null : clean;
}

/**
 * Drops unusable entries, collapses case-insensitive duplicates and forces
 * `manifest.json` to be the first entry so the archive is always readable as a pack.
 */
export function normalizePackFiles(files: Record<string, string | Uint8Array>): NormalizedPackFiles {
  const normalized: Record<string, string | Uint8Array> = {};
  const dropped: DroppedPackEntry[] = [];
  const seen = new Set<string>();
  let manifest: string | Uint8Array | null = null;

  for (const [rawPath, data] of Object.entries(files ?? {})) {
    const value: unknown = data;
    if (value === undefined || value === null) {
      dropped.push({ path: rawPath, reason: 'entry has no data' });
      continue;
    }
    const safePath = sanitizePackEntryPath(rawPath);
    if (!safePath) {
      dropped.push({ path: rawPath, reason: 'not a pack-relative path' });
      continue;
    }
    const key = safePath.toLowerCase();
    if (seen.has(key)) {
      dropped.push({ path: rawPath, reason: `duplicate of ${safePath}` });
      continue;
    }
    seen.add(key);
    if (key === 'manifest.json') {
      manifest = data;
      continue;
    }
    normalized[safePath] = data;
  }

  const ordered: Record<string, string | Uint8Array> = {};
  if (manifest !== null) ordered['manifest.json'] = manifest;
  for (const [path, data] of Object.entries(normalized)) ordered[path] = data;
  return { files: ordered, dropped };
}