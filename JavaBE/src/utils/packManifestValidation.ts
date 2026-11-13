export interface PackFinding {
  severity: 'error' | 'warning';
  code: string;
  detail: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isVersionTriple(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((part) => typeof part === 'number' && Number.isFinite(part) && part >= 0 && part <= 999)
  );
}

function readModuleUuids(modules: unknown): string[] {
  if (!Array.isArray(modules)) return [];
  const uuids: string[] = [];
  for (const module of modules) {
    const uuid = (module as { uuid?: unknown })?.uuid;
    if (typeof uuid === 'string') uuids.push(uuid.toLowerCase());
  }
  return uuids;
}

/**
 * Structural validation of a Bedrock manifest against the rules the real importer
 * enforces. Every rule here is a documented Bedrock requirement — nothing is invented,
 * so a clean report means the manifest is readable, not that the addon is correct.
 */
export function validateManifestText(raw: unknown, expectedModuleType: 'resources' | 'data'): PackFinding[] {
  const findings: PackFinding[] = [];
  const error = (code: string, detail: string) => findings.push({ severity: 'error', code, detail });

  if (typeof raw !== 'string' || raw.trim().length === 0) {
    error('MANIFEST_UNREADABLE', 'manifest.json is not text and Bedrock cannot parse it.');
    return findings;
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    error('MANIFEST_INVALID_JSON', 'manifest.json is not valid JSON, so the pack shows as unknown/broken.');
    return findings;
  }

  const header = manifest.header as Record<string, unknown> | undefined;
  if (!header || typeof header !== 'object') {
    error('MANIFEST_NO_HEADER', 'manifest.json has no header object.');
    return findings;
  }

  if (typeof header.name !== 'string' || header.name.trim().length === 0) {
    error('MANIFEST_NO_NAME', 'header.name is missing, so the pack has no display name.');
  }
  if (typeof header.description !== 'string') {
    error('MANIFEST_NO_DESCRIPTION', 'header.description is missing.');
  }
  if (typeof header.uuid !== 'string' || !UUID_PATTERN.test(header.uuid)) {
    error('MANIFEST_BAD_HEADER_UUID', `header.uuid "${String(header.uuid)}" is not a valid UUID.`);
  }
  if (!isVersionTriple(header.version)) {
    error('MANIFEST_BAD_VERSION', 'header.version must be three numbers, e.g. [1, 0, 0].');
  }
  if (manifest.format_version !== undefined && typeof manifest.format_version !== 'number') {
    findings.push({
      severity: 'warning',
      code: 'MANIFEST_FORMAT_VERSION',
      detail: 'format_version is not a number; the implicit value 1 will be used.',
    });
  }

  const modules = manifest.modules as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(modules) || modules.length === 0) {
    error('MANIFEST_NO_MODULES', 'manifest.json declares no modules, so Bedrock ignores the pack.');
  } else {
    const types = modules.map((module) => String(module?.type ?? ''));
    if (!types.includes(expectedModuleType)) {
      error(
        'MANIFEST_WRONG_MODULE_TYPE',
        `expected a "${expectedModuleType}" module but the manifest declares [${types.join(', ')}].`,
      );
    }
    const moduleUuids = readModuleUuids(modules);
    for (const module of modules) {
      if (typeof module?.uuid !== 'string' || !UUID_PATTERN.test(module.uuid)) {
        error('MANIFEST_BAD_MODULE_UUID', `module "${String(module?.type)}" has an invalid uuid.`);
      }
      if (!isVersionTriple(module?.version)) {
        error('MANIFEST_BAD_MODULE_VERSION', `module "${String(module?.type)}" has an invalid version array.`);
      }
    }
    if (new Set(moduleUuids).size !== moduleUuids.length) {
      error('MANIFEST_DUPLICATE_MODULE_UUID', 'two modules share a uuid; Bedrock refuses the pack.');
    }
    if (typeof header.uuid === 'string' && moduleUuids.includes(header.uuid.toLowerCase())) {
      error('MANIFEST_REUSED_UUID', 'the header uuid is reused by a module; Bedrock refuses the pack.');
    }
  }

  const minEngine = header.min_engine_version;
  if (minEngine !== undefined && !isVersionTriple(minEngine)) {
    findings.push({
      severity: 'warning',
      code: 'MANIFEST_MIN_ENGINE',
      detail: 'min_engine_version is not a three-number array; older clients may refuse the pack.',
    });
  }

  return findings;
}