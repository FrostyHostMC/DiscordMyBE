import assetsData from "@/config/assets";
import { normalizePackFiles, type DroppedPackEntry } from '@/utils/packPathSafety';
import { validateManifestText, type PackFinding } from '@/utils/packManifestValidation';
export type PackRole = 'resources' | 'behavior';
export interface PackIntegrityReport {
  role: PackRole;
  fileCount: number;
  totalBytes: number;
  findings: PackFinding[];
  dropped: DroppedPackEntry[];
  errorCount: number;
  warningCount: number;
}
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_PACK_BYTES = 260 * 1024 * 1024;
function isPngBytes(data: string | Uint8Array): boolean {
  if (typeof data === 'string') return false;
  if (data.length < PNG_SIGNATURE.length) return false;
  for (let index = 0; index < PNG_SIGNATURE.length; index++) {
    if (data[index] !== PNG_SIGNATURE[index]) return false;
  }
  return true;
}
function isJsonParseable(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Final gate between the generated pack and the .mcpack/.mcaddon the player imports.
 * It removes everything that makes Bedrock report "unknown pack or broken" (bad entry
 * paths, unparsable JSON, corrupt PNG data, missing manifest/icon) and reports what it
 * found instead of silently shipping a broken archive.
 */
export function preparePackForExport(files: Record<string, string | Uint8Array>, role: PackRole): {
  files: Record<string, string | Uint8Array>;
  report: PackIntegrityReport;
} {
  const normalized = normalizePackFiles(files);
  const findings: PackFinding[] = [];
  const out: Record<string, string | Uint8Array> = {};
  let totalBytes = 0;
  const manifest = normalized.files['manifest.json'] as string | Uint8Array | undefined;
  if (manifest === undefined) {
    findings.push({
      severity: 'error',
      code: 'MANIFEST_MISSING',
      detail: 'manifest.json is not at the pack root, so Bedrock cannot identify the pack.'
    });
  } else {
    out['manifest.json'] = manifest;
    findings.push(...validateManifestText(manifest, role === 'resources' ? 'resources' : 'data'));
  }
  const packIcon = normalized.files[assetsData.IMAGE_QEIG] as string | Uint8Array | undefined;
  if (packIcon === undefined) {
    findings.push({
      severity: 'warning',
      code: 'PACK_ICON_MISSING',
      detail: 'no pack_icon.png at the pack root; the pack shows without an icon.'
    });
  }
  for (const [path, data] of Object.entries(normalized.files)) {
    if (path === 'manifest.json') continue;
    const size = data.length;
    totalBytes += size;
    if (size === 0) {
      findings.push({
        severity: 'error',
        code: 'EMPTY_FILE',
        detail: `${path} is empty and was removed.`
      });
      continue;
    }
    if (path.toLowerCase().endsWith('.json')) {
      if (typeof data !== 'string' || !isJsonParseable(data)) {
        findings.push({
          severity: 'error',
          code: 'JSON_INVALID',
          detail: `${path} is not valid JSON and was removed so it cannot break pack loading.`
        });
        continue;
      }
    }
    if (path.toLowerCase().endsWith('.png') && !isPngBytes(data)) {
      findings.push({
        severity: 'error',
        code: 'PNG_INVALID',
        detail: `${path} does not contain PNG data and was removed.`
      });
      continue;
    }
    out[path] = data;
  }
  for (const drop of normalized.dropped) {
    findings.push({
      severity: 'warning',
      code: 'ENTRY_PATH_DROPPED',
      detail: `"${drop.path}" removed — ${drop.reason}.`
    });
  }
  if (totalBytes > MAX_PACK_BYTES) {
    findings.push({
      severity: 'warning',
      code: 'PACK_TOO_LARGE',
      detail: `pack payload is ${(totalBytes / (1024 * 1024)).toFixed(1)} MB; very large packs can fail to import on mobile.`
    });
  }
  const errorCount = findings.filter(finding => finding.severity === 'error').length;
  return {
    files: out,
    report: {
      role,
      fileCount: Object.keys(out).length,
      totalBytes,
      findings,
      dropped: normalized.dropped,
      errorCount,
      warningCount: findings.length - errorCount
    }
  };
}

/** Human-readable log lines for the conversion log, one per problem found. */
export function formatIntegrityLog(report: PackIntegrityReport): string[] {
  const label = report.role === 'resources' ? 'Resource pack' : 'Behavior pack';
  const lines = [`[PACK] ${label} import check: ${report.fileCount} file(s), ${(report.totalBytes / (1024 * 1024)).toFixed(2)} MB, ${report.errorCount} blocking defect(s), ${report.warningCount} warning(s).`];
  for (const finding of report.findings) {
    lines.push(`[PACK:${finding.severity === 'error' ? 'ERROR' : 'WARN'}] ${finding.code} — ${finding.detail}`);
  }
  if (report.errorCount === 0) {
    lines.push(`[PACK] ${label} manifest, icon, entry paths, JSON and PNG data all validated — the archive is importable.`);
  }
  return lines;
}