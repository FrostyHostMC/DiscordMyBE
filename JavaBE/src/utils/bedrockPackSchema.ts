import assetsData from "@/config/assets";
import type { PackSchemaReport } from '@/types/remaker';
import type { Pack, RawFinding } from '@/utils/validationRules';

/**
 * FIX 7 — mandatory Bedrock pack schema validation.
 *
 * A pack that is structurally valid but whose manifest violates Bedrock's schema is refused
 * on import with "unknown pack or broken", which used to be discovered only in game. These
 * checks run on every export before the archive is written: format_version, header fields,
 * module declarations, dependency shape, capability placement and pack icon. Every rule cites
 * the requirement it enforces, and a defect is reported rather than papered over.
 */

const RULES = {
  format: 'Bedrock reads manifest format_version 1 (legacy) or 2 (current); any other value is not parsed as a manifest.',
  header: 'A manifest header requires name, description, uuid and a [major, minor, patch] version.',
  engine: 'header.min_engine_version must be a three-part version array so the engine can decide which builds may load the pack.',
  modules: 'modules must be a non-empty array of resources/data/script modules, each with its own UUID and version.',
  script: 'A script module declares language and entry, and the entry file must exist inside the pack.',
  dependencies: 'Each dependency entry is either {uuid, version} for another pack or {module_name, version} for an engine module — never both, never neither.',
  top: 'Bedrock reads format_version, header, modules, dependencies, metadata, subpacks and header.capabilities; other root keys are ignored.',
  icon: 'pack_icon.png is shown in the pack list; the pack still loads without it.'
} as const;
const MODULE_TYPES = new Set(['resources', 'data', 'script', 'world_template', 'skin_pack']);
const TOP_LEVEL_KEYS = new Set(['format_version', 'header', 'modules', 'dependencies', 'metadata', 'subpacks', 'capabilities', 'legacy']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_STRING_RE = /^\d+\.\d+\.\d+$/;
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Accepts both the array form and the "1.2.0" string form Bedrock allows for module versions. */
function isVersion(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 3 && value.every(part => Number.isFinite(Number(part)));
  }
  return typeof value === 'string' && VERSION_STRING_RE.test(value);
}
function parseManifest(files: Pack): Record<string, unknown> | null {
  const raw = files['manifest.json'];
  if (raw == null) return null;
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  try {
    return asRecord(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
function fileExists(files: Pack, path: string): boolean {
  const target = path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  return Object.keys(files).some(key => key.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase() === target);
}
function hasPackIcon(files: Pack): boolean {
  return Object.keys(files).some(key => /(^|\/)pack_icon\.png$/i.test(key.trim()));
}
export interface PackSchemaInput {
  resourcePackFiles: Pack;
  behaviorPackFiles: Pack;
  modId: string;
}
export interface PackSchemaOutcome {
  findings: RawFinding[];
  /** Manifest schema requirements actually inspected. */
  requirements: number;
  report: PackSchemaReport;
}

/** Validates both manifests of the addon against Bedrock's manifest schema. */
export function validatePackSchema(input: PackSchemaInput): PackSchemaOutcome {
  const findings: RawFinding[] = [];
  const notes: string[] = [];
  const seenUuids = new Map<string, string>();
  let requirements = 0;
  let manifestsChecked = 0;
  let resourceModules = 0;
  let behaviorModules = 0;
  let dependencies = 0;
  let scriptModules = 0;
  let iconCount = 0;
  const add = (finding: RawFinding) => findings.push(finding);
  for (const [role, files] of [['RP', input.resourcePackFiles], ['BP', input.behaviorPackFiles]] as const) {
    requirements += 1;
    const doc = parseManifest(files);
    if (!doc) {
      add({
        check: 'schema',
        severity: 'error',
        role,
        file: 'manifest.json',
        subject: 'manifest',
        detail: 'The pack has no readable manifest.json, so Bedrock cannot identify this half of the addon.',
        rule: RULES.header,
        repair: {
          kind: 'none'
        },
        conversionFailure: true
      });
      continue;
    }
    manifestsChecked += 1;
    if (hasPackIcon(files)) iconCount += 1;else add({
      check: 'schema',
      severity: 'warning',
      role,
      file: assetsData.IMAGE_QEIG,
      subject: 'pack icon',
      detail: 'The pack ships no pack_icon.png, so the pack list shows a blank icon.',
      rule: RULES.icon,
      repair: {
        kind: 'none'
      }
    });
    requirements += 1;
    const declaredFormat = doc.format_version;
    const formatText = typeof declaredFormat === 'number' || typeof declaredFormat === 'string' ? String(declaredFormat) : '';
    if (formatText !== '1' && formatText !== '2') {
      add({
        check: 'schema',
        severity: 'error',
        role,
        file: 'manifest.json',
        subject: 'format_version',
        detail: formatText ? `Manifest format_version "${formatText}" is not a schema Bedrock reads (1 or 2).` : 'The manifest declares no format_version.',
        rule: RULES.format,
        repair: {
          kind: 'format-version',
          payload: {
            pointer: 'format_version',
            value: 2
          }
        },
        conversionFailure: true
      });
    }
    requirements += 1;
    const header = asRecord(doc.header);
    if (!header) {
      add({
        check: 'schema',
        severity: 'error',
        role,
        file: 'manifest.json',
        subject: 'header',
        detail: 'The manifest declares no header object, so the pack has no identity the engine can register.',
        rule: RULES.header,
        repair: {
          kind: 'none'
        },
        conversionFailure: true
      });
    } else {
      for (const field of ['name', 'description'] as const) {
        requirements += 1;
        if (asString(header[field]).trim()) continue;
        add({
          check: 'schema',
          severity: field === 'name' ? 'error' : 'warning',
          role,
          file: 'manifest.json',
          subject: `header.${field}`,
          detail: `header.${field} is missing or empty, which Bedrock requires for a loadable pack.`,
          rule: RULES.header,
          repair: {
            kind: 'none'
          }
        });
      }
      requirements += 1;
      const headerUuid = asString(header.uuid);
      if (!UUID_RE.test(headerUuid)) {
        add({
          check: 'schema',
          severity: 'error',
          role,
          file: 'manifest.json',
          subject: 'header.uuid',
          detail: 'header.uuid is missing or not a valid UUID, so the pack cannot be identified or depended on.',
          rule: RULES.header,
          repair: {
            kind: 'none'
          },
          conversionFailure: true
        });
      } else if (seenUuids.has(headerUuid)) {
        add({
          check: 'schema',
          severity: 'error',
          role,
          file: 'manifest.json',
          subject: `header.uuid=${headerUuid}`,
          detail: `The UUID ${headerUuid} is already used by ${seenUuids.get(headerUuid)}; duplicate UUIDs make the packs collide.`,
          rule: RULES.header,
          repair: {
            kind: 'none'
          },
          conversionFailure: true
        });
      } else {
        seenUuids.set(headerUuid, `${role} header`);
      }
      for (const field of ['version', 'min_engine_version'] as const) {
        requirements += 1;
        if (isVersion(header[field])) continue;
        add({
          check: 'schema',
          severity: 'error',
          role,
          file: 'manifest.json',
          subject: `header.${field}`,
          detail: `header.${field} must be a three-part version (e.g. [1, 0, 0]); Bedrock rejects the pack otherwise.`,
          rule: field === 'version' ? RULES.header : RULES.engine,
          repair: {
            kind: 'none'
          },
          conversionFailure: true
        });
      }
    }
    requirements += 1;
    const modules = Array.isArray(doc.modules) ? doc.modules : [];
    if (modules.length === 0) {
      add({
        check: 'schema',
        severity: 'error',
        role,
        file: 'manifest.json',
        subject: 'modules',
        detail: 'The manifest declares no modules, so the pack contains nothing the engine can load.',
        rule: RULES.modules,
        repair: {
          kind: 'none'
        },
        conversionFailure: true
      });
    }
    modules.forEach((rawModule, index) => {
      requirements += 1;
      const module = asRecord(rawModule);
      if (!module) {
        add({
          check: 'schema',
          severity: 'error',
          role,
          file: 'manifest.json',
          subject: `modules[${index}]`,
          detail: 'The module entry is not an object, so no module type can be read from it.',
          rule: RULES.modules,
          repair: {
            kind: 'none'
          }
        });
        return;
      }
      if (role === 'RP') resourceModules += 1;else behaviorModules += 1;
      const type = asString(module.type);
      if (!MODULE_TYPES.has(type)) {
        add({
          check: 'schema',
          severity: 'error',
          role,
          file: 'manifest.json',
          subject: `modules[${index}].type="${type}"`,
          detail: `Module type "${type}" is not one Bedrock loads (resources, data, script, world_template, skin_pack).`,
          rule: RULES.modules,
          repair: {
            kind: 'none'
          },
          conversionFailure: true
        });
      }
      const moduleUuid = asString(module.uuid);
      if (!UUID_RE.test(moduleUuid)) {
        add({
          check: 'schema',
          severity: 'error',
          role,
          file: 'manifest.json',
          subject: `modules[${index}].uuid`,
          detail: 'The module UUID is missing or malformed; Bedrock cannot register the module.',
          rule: RULES.modules,
          repair: {
            kind: 'none'
          },
          conversionFailure: true
        });
      } else if (seenUuids.has(moduleUuid)) {
        add({
          check: 'schema',
          severity: 'error',
          role,
          file: 'manifest.json',
          subject: `modules[${index}].uuid=${moduleUuid}`,
          detail: `The module UUID is already used by ${seenUuids.get(moduleUuid)}; every module needs its own UUID.`,
          rule: RULES.modules,
          repair: {
            kind: 'none'
          },
          conversionFailure: true
        });
      } else {
        seenUuids.set(moduleUuid, `${role} ${type || 'module'}`);
      }
      if (!isVersion(module.version)) {
        add({
          check: 'schema',
          severity: 'error',
          role,
          file: 'manifest.json',
          subject: `modules[${index}].version`,
          detail: 'The module version is not a three-part version, so the engine cannot resolve the module.',
          rule: RULES.modules,
          repair: {
            kind: 'none'
          }
        });
      }
      if (type !== 'script') return;
      scriptModules += 1;
      const entry = asString(module.entry);
      if (!entry || !fileExists(files, entry)) {
        add({
          check: 'schema',
          severity: 'error',
          role,
          file: 'manifest.json',
          subject: `modules[${index}].entry="${entry}"`,
          detail: `The script module entry "${entry}" is not shipped, so Bedrock refuses to load the pack.`,
          rule: RULES.script,
          repair: {
            kind: 'script-module',
            payload: {
              value: entry
            }
          }
        });
      }
      if (asString(module.language) !== 'javascript') {
        add({
          check: 'schema',
          severity: 'warning',
          role,
          file: 'manifest.json',
          subject: `modules[${index}].language`,
          detail: 'The script module declares no language: "javascript".',
          rule: RULES.script,
          repair: {
            kind: 'none'
          }
        });
      }
    });
    requirements += 1;
    const rawDependencies = doc.dependencies;
    if (rawDependencies != null && !Array.isArray(rawDependencies)) {
      add({
        check: 'schema',
        severity: 'error',
        role,
        file: 'manifest.json',
        subject: 'dependencies',
        detail: 'dependencies must be an array; the engine cannot read dependency entries from this shape.',
        rule: RULES.dependencies,
        repair: {
          kind: 'none'
        },
        conversionFailure: true
      });
    }
    const dependencyList = Array.isArray(rawDependencies) ? rawDependencies : [];
    dependencyList.forEach((rawDependency, index) => {
      dependencies += 1;
      const dependency = asRecord(rawDependency);
      const hasUuid = Boolean(asString(dependency?.uuid));
      const hasModule = Boolean(asString(dependency?.module_name));
      if (!dependency || hasUuid === hasModule) {
        add({
          check: 'schema',
          severity: 'error',
          role,
          file: 'manifest.json',
          subject: `dependencies[${index}]`,
          detail: hasUuid ? 'The dependency declares both a pack UUID and a module_name; Bedrock accepts only one form per entry.' : 'The dependency entry declares neither a pack UUID nor a module_name.',
          rule: RULES.dependencies,
          repair: {
            kind: 'none'
          },
          conversionFailure: true
        });
        return;
      }
      if (!isVersion(dependency.version)) {
        add({
          check: 'schema',
          severity: 'warning',
          role,
          file: 'manifest.json',
          subject: `dependencies[${index}].version`,
          detail: 'The dependency version is not a three-part version, so the engine cannot resolve it.',
          rule: RULES.dependencies,
          repair: {
            kind: 'none'
          }
        });
      }
    });
    requirements += 1;
    if (doc.capabilities != null) {
      const listed = Array.isArray(doc.capabilities) ? doc.capabilities.filter((entry): entry is string => typeof entry === 'string') : [];
      add({
        check: 'schema',
        severity: 'error',
        role,
        file: 'manifest.json',
        subject: 'capabilities',
        detail: `capabilities is declared at the manifest root (${listed.join(', ') || 'no values'}); Bedrock reads capability flags from header.capabilities, so this declaration is ignored.`,
        rule: RULES.top,
        repair: {
          kind: 'header-capabilities',
          payload: {
            value: listed
          }
        }
      });
    }
    for (const key of Object.keys(doc)) {
      requirements += 1;
      if (TOP_LEVEL_KEYS.has(key)) continue;
      add({
        check: 'schema',
        severity: 'warning',
        role,
        file: 'manifest.json',
        subject: key,
        detail: `"${key}" is not a manifest root the engine reads, so it is silently ignored.`,
        rule: RULES.top,
        repair: {
          kind: 'none'
        }
      });
    }
  }
  notes.push(`Manifest schema checked: format_version, header, module declarations, dependency shape and capability placement for ${manifestsChecked} manifest(s).`);
  notes.push('Schema validity is structural — it does not open the pack in a Bedrock client.');
  const report: PackSchemaReport = {
    manifestsChecked,
    requirements,
    defects: findings.filter(finding => finding.severity === 'error').length,
    passed: findings.every(finding => finding.severity !== 'error'),
    resourceModules,
    behaviorModules,
    dependencies,
    scriptModules,
    packIcon: iconCount === 2,
    notes
  };
  return {
    findings,
    requirements,
    report
  };
}