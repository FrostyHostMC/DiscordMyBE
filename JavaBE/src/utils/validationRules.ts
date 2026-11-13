import type { RemakeItem, ValidationCheckId, ValidationSeverity } from '@/types/remaker';
import { sanitizeCapabilitiesForVersion } from '@/utils/bedrockCapabilityQuery';
import { analyzeChannel } from '@/utils/animationChannelMath';
import type { ModelFaceName } from '@/utils/javaModelIR';
import { orientFaceRect, pow2Sheet, verifySheetCoverage, type UvSample } from '@/utils/uvMapping';

/**
 * Universal asset validation rules.
 *
 * Every rule inspects a file that actually shipped in the pack and cites the real Bedrock
 * requirement it enforces. A finding is never invented to force the pipeline to generate
 * content: the scan only describes what is broken, what can be safely normalised, and what
 * has no honest repair.
 */

export type ValidationPackRole = 'RP' | 'BP';
export type Pack = Record<string, string | Uint8Array>;

export const CHECK_LABELS: Record<ValidationCheckId, string> = {
  schema: 'Pack schema',
  json: 'JSON validity',
  reference: 'Reference integrity',
  identifier: 'Identifier correctness',
  'format-version': 'Format versions',
  geometry: 'Geometry structure',
  uv: 'UV coordinates',
  texture: 'Texture files',
  animation: 'Animations',
  'render-controller': 'Controllers & state machines',
  material: 'Materials',
  behavior: 'Behaviour components',
  script: 'Scripts',
  dependency: 'Dependencies',
  unsupported: 'Unsupported functionality',
};

export const CHECK_ORDER: ValidationCheckId[] = [
  'schema',
  'json',
  'reference',
  'identifier',
  'format-version',
  'geometry',
  'uv',
  'texture',
  'animation',
  'render-controller',
  'material',
  'behavior',
  'script',
  'dependency',
  'unsupported',
];

const IDENTIFIER_RE = /^[a-z0-9_.-]+:[a-z0-9_.-]+$/;

export type RepairKind =
  | 'none'
  | 'identifier'
  | 'format-version'
  | 'geometry-identifier'
  | 'geometry-volume'
  | 'geometry-bounds'
  | 'geometry-description'
  | 'uv-value'
  | 'uv-face'
  | 'atlas-entry'
  | 'material'
  | 'render-controller'
  | 'manifest-dependency'
  | 'script-module'
  | 'molang-trailer'
  | 'header-capabilities'
  | 'animation-channel';

export interface RepairPayload {
  /** Dot/bracket pointer inside the target JSON document. */
  pointer?: string;
  /** Path tokens for keys that contain dots (animation clip and bone names). */
  path?: Array<string | number>;
  value?: unknown;
  /** Atlas key / identifier the repair registers. */
  key?: string;
  /** Texture path (relative to the pack root). */
  path?: string;
  controllerId?: string;
  geometry?: string;
  texture?: string;
  role?: ValidationPackRole;
}

export interface RawFinding {
  check: ValidationCheckId;
  severity: ValidationSeverity;
  role: ValidationPackRole;
  file: string;
  subject: string;
  detail: string;
  rule: string;
  repair: { kind: RepairKind; payload?: RepairPayload };
  /** True when this file is a conversion result that failed, so it is reported, never dropped. */
  conversionFailure?: boolean;
}

export interface ValidationScanResult {
  findings: RawFinding[];
  checked: Record<ValidationCheckId, number>;
}

export interface ValidationContext {
  modId: string;
  targetVersion: unknown;
  playableMode: boolean;
  resourcePackFiles: Pack;
  behaviorPackFiles: Pack;
  items: RemakeItem[];
}

const RULES = {
  json: 'Every Bedrock JSON document must parse; a single malformed file makes the whole pack fail to load.',
  identifier: 'Bedrock identifiers must be lowercase namespaced values (namespace:path) with no spaces or format codes.',
  formatVersion:
    'A document declares a format_version the engine recognises (geometry 1.8.0/1.12.0/1.16.0, animation 1.8.0/1.10.0, manifest 2).',
  geometry:
    'Bedrock geometry 1.12.0 requires description.identifier, non-empty bones and cubes with positive size; entity geometry also needs visible bounds.',
  uv: 'Bedrock samples face UVs against description.texture_width/texture_height; each face is a uv anchor plus a signed uv_size, and the declared sheet must cover the pixel space the UVs were authored in.',
  texture: 'Bedrock decodes textures with a standard PNG decoder; a file without valid PNG magic bytes is dropped.',
  reference: 'Client entities, atlases, block definitions and render controllers may only reference files that exist in the pack.',
  animation: 'Animation documents must define an animations object with clips whose channels hold numbers or valid Molang.',
  controller:
    'Animation controllers require initial_state to exist, transition targets to exist and referenced clips to be shipped.',
  renderController:
    'A render controller document must define minecraft:render_controllers/render_controllers entries with materials.',
  material:
    'A client entity material must exist in the engine or be declared in a shipped materials/*.material file.',
  behavior: 'Behaviour components must live under minecraft:entity/minecraft:item/minecraft:block and event references must resolve.',
  script: 'A script module declared in the manifest needs a real script file, and the file must import @minecraft/server to use the API.',
  dependency:
    'The behaviour manifest must depend on the resource pack UUID; dependencies may only name known engine modules.',
  unsupported: 'Molang cannot evaluate Java syntax, and a manifest may only declare capability flags the target engine recognises.',
} as const;

const KNOWN_MATERIALS = new Set([
  'entity',
  'entity_alphatest',
  'entity_alphatest_one_sided',
  'entity_alphatest_glint',
  'entity_emissive_alpha_one_sided',
  'entity_alphatest_change_color',
  'entity_alphablend',
  'entity_alphablend_change_color',
  'entity_emissive',
  'entity_emissive_alpha',
  'entity_multitexture',
  'entity_multitexture_masked',
  'entity_multitexture_masked_lit',
  'entity_nocull',
  'entity_static',
  'entity_flat',
  'entity_flat_color',
  'entity_flat_color_emissive',
  'armor',
  'armor_enchanted',
  'armor_glint',
  'player',
  'player_animated',
]);

const KNOWN_MODULES = new Set([
  '@minecraft/server',
  '@minecraft/server-ui',
  '@minecraft/server-gametest',
  '@minecraft/server-admin',
  '@minecraft/server-net',
  '@minecraft/server-editor',
  '@minecraft/server-editor-bindings',
]);

const GEOMETRY_VERSIONS = ['1.8.0', '1.12.0', '1.16.0'];
const ANIMATION_VERSIONS = ['1.8.0', '1.10.0'];
const RENDER_CONTROLLER_VERSIONS = ['1.8.0', '1.10.0'];
const ENTITY_VERSIONS = ['1.10.0', 'any-1.x', '1.8.0', '1.12.0', '1.14.0', '1.16.0', '1.19.0', '1.20.0', '1.20.80', '1.21.0', '1.21.10', '1.21.20', '1.21.30', '1.21.40', '1.21.50'];
const MANIFEST_VERSIONS = ['2'];
const JAVA_LEAK = /Math\.[a-z]+\(|this\.[a-z_]|->|\bnew\s+[A-Z]\w*\s*\(|\bget[A-Z]\w*\(\)/;
/** Audit vocabulary that must never appear inside a shipped resource path. */
const INTERNAL_LABEL = /\b(UNMATCHED|UNRESOLVED|ABSENT|INVENTED|SCAFFOLD|ADAPTED|VALIDATOR|PLACEHOLDER)\b/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function emptyChecked(): Record<ValidationCheckId, number> {
  return CHECK_ORDER.reduce(
    (acc, check) => ({ ...acc, [check]: 0 }),
    {} as Record<ValidationCheckId, number>,
  );
}

function decode(data: string | Uint8Array | undefined): string | null {
  if (data == null) return null;
  if (typeof data === 'string') return data;
  try {
    return new TextDecoder().decode(data);
  } catch {
    return null;
  }
}

function isPng(data: string | Uint8Array | undefined): boolean {
  if (!data) return false;
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (bytes.length < 24) return false;
  return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

interface ParsedDoc {
  role: ValidationPackRole;
  path: string;
  doc: Record<string, unknown>;
}

function walkStrings(value: unknown, pointer: string, visit: (text: string, pointer: string) => void): void {
  if (typeof value === 'string') {
    visit(value, pointer);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, `${pointer}[${index}]`, visit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      walkStrings(entry, pointer ? `${pointer}.${key}` : key, visit);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Highest UV value a raw geometry document refers to. Used to derive the sheet size when
 * a model declares none: re-declaring 16x16 for pixel-space UVs is what made every face
 * "out of range" and produced a clamp repair per face instead of one correct declaration.
 */
function rawUvExtent(bones: unknown): { maxU: number; maxV: number } {
  let maxU = 0;
  let maxV = 0;
  const track = (u: number, v: number) => {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return;
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, v);
  };
  for (const rawBone of asArray(bones)) {
    const bone = asRecord(rawBone);
    if (!bone) continue;
    for (const rawCube of asArray(bone.cubes)) {
      const cube = asRecord(rawCube);
      if (!cube) continue;
      const uv = cube.uv;
      if (Array.isArray(uv)) {
        const numbers = uv.map((entry) => Number(entry));
        if (numbers.length >= 2) track(numbers[0], numbers[1]);
        if (numbers.length >= 4) track(numbers[2], numbers[3]);
      } else if (uv && typeof uv === 'object') {
        for (const rawFace of Object.values(uv as Record<string, unknown>)) {
          const face = asRecord(rawFace);
          if (!face) continue;
          const anchor = asArray(face.uv).map((entry) => Number(entry));
          const size = asArray(face.uv_size).map((entry) => Number(entry));
          if (anchor.length < 2) continue;
          track(anchor[0] + Math.abs(size[0] ?? 0), anchor[1] + Math.abs(size[1] ?? 0));
          track(anchor[0], anchor[1]);
        }
      }
    }
  }
  return { maxU, maxV };
}

/**
 * Scans both packs and returns every defect with the repair it would accept.
 * Pure function: it never mutates the pack — repairs are applied by validationRepair.ts.
 */
export function scanPackForDefects(ctx: ValidationContext): ValidationScanResult {
  const findings: RawFinding[] = [];
  const checked = emptyChecked();
  const rp = ctx.resourcePackFiles;
  const bp = ctx.behaviorPackFiles;

  const lowerIndex = (files: Pack): Map<string, string> => {
    const map = new Map<string, string>();
    for (const key of Object.keys(files)) map.set(key.replace(/\\/g, '/').toLowerCase(), key);
    return map;
  };
  const rpIndex = lowerIndex(rp);
  const bpIndex = lowerIndex(bp);

  const add = (finding: RawFinding) => {
    findings.push(finding);
  };
  const fileExists = (role: ValidationPackRole, path: string): boolean => {
    const clean = path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    return role === 'RP' ? rpIndex.has(clean) : bpIndex.has(clean);
  };
  const resolveTexturePath = (value: string): string | null => {
    const clean = value.replace(/\\/g, '/').replace(/^\/+/, '');
    const withExt = clean.toLowerCase().endsWith('.png') ? clean : `${clean}.png`;
    return rpIndex.get(withExt.toLowerCase()) ?? null;
  };

  // 1. JSON validity — every document in the pack must parse.
  const docs: ParsedDoc[] = [];
  const packs: Array<[ValidationPackRole, Pack]> = [
    ['RP', rp],
    ['BP', bp],
  ];
  for (const [role, files] of packs) {
    for (const [path, data] of Object.entries(files)) {
      if (!path.toLowerCase().endsWith('.json')) continue;
      checked.json += 1;
      const raw = decode(data);
      if (raw == null) {
        add({
          check: 'json',
          severity: 'error',
          role,
          file: path,
          subject: path,
          detail: 'The file could not be decoded as UTF-8 text.',
          rule: RULES.json,
          repair: { kind: 'none' },
          conversionFailure: true,
        });
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (path.toLowerCase().replace(/\\/g, '/').endsWith('texts/languages.json')) {
          if (!Array.isArray(parsed)) {
            add({
              check: 'json', severity: 'error', role, file: path, subject: 'root',
              detail: 'Bedrock texts/languages.json must have a root array of locale identifiers.',
              rule: 'Bedrock language declarations use a JSON array of locale codes and each locale must have a matching texts/<locale>.lang file.',
              repair: { kind: 'none' }, conversionFailure: true,
            });
          } else {
            const locales = parsed.filter((entry): entry is string => typeof entry === 'string');
            const unique = new Set(locales);
            if (parsed.length === 0 || locales.length !== parsed.length || locales.some((locale) => !/^[a-z]{2}_[A-Z]{2}$/.test(locale)) || unique.size !== locales.length) {
              add({
                check: 'json', severity: 'error', role, file: path, subject: 'locale declarations',
                detail: 'The language declaration contains an invalid, duplicate, or non-string locale identifier.',
                rule: 'Bedrock locale codes use the language_COUNTRY form and must be declared once.',
                repair: { kind: 'none' }, conversionFailure: true,
              });
            }
          }
          continue;
        }
        const record = asRecord(parsed);
        if (!record) {
          add({
            check: 'json',
            severity: 'error',
            role,
            file: path,
            subject: path,
            detail: 'The document is valid JSON but not an object, so Bedrock cannot read any schema field from it.',
            rule: RULES.json,
            repair: { kind: 'none' },
            conversionFailure: true,
          });
          continue;
        }
        docs.push({ role, path, doc: record });
      } catch (error) {
        add({
          check: 'json',
          severity: 'error',
          role,
          file: path,
          subject: path,
          detail: `JSON parse failure: ${error instanceof Error ? error.message : String(error)}.`,
          rule: RULES.json,
          repair: { kind: 'none' },
          conversionFailure: true,
        });
      }
    }
  }

  for (const [role, files] of packs) {
    const declaration = files['texts/languages.json'];
    let locales: string[] = [];
    if (!declaration) {
      add({
        check: 'json', severity: 'error', role, file: 'texts/languages.json', subject: 'missing declaration',
        detail: 'The pack has no Bedrock language declaration.',
        rule: 'Each pack declares available locales in texts/languages.json and ships a matching language file.',
        repair: { kind: 'none' }, conversionFailure: true,
      });
    } else {
      try {
        const parsed: unknown = JSON.parse(typeof declaration === 'string' ? declaration : new TextDecoder().decode(declaration));
        if (Array.isArray(parsed)) locales = parsed.filter((entry): entry is string => typeof entry === 'string');
      } catch {
        // The JSON parse pass already reports malformed declaration content.
      }
    }
    if (locales.length > 0 && !locales.includes('en_US')) {
      add({
        check: 'json', severity: 'error', role, file: 'texts/languages.json', subject: 'en_US',
        detail: 'The default English locale is not declared.',
        rule: 'A default en_US language configuration must be declared and shipped.',
        repair: { kind: 'none' },
      });
    }
    for (const locale of locales) {
      if (!files[`texts/${locale}.lang`]) {
        add({
          check: 'json', severity: 'error', role, file: 'texts/languages.json', subject: locale,
          detail: `Locale "${locale}" is declared without texts/${locale}.lang.`,
          rule: 'Every declared locale must have a matching Bedrock .lang file.',
          repair: { kind: 'none' }, conversionFailure: true,
        });
      }
    }
    for (const [path, data] of Object.entries(files)) {
      if (!/^texts\/[a-z]{2}_[A-Z]{2}\.lang$/i.test(path)) continue;
      checked.json += 1;
      const contents = decode(data);
      if (contents == null) {
        add({
          check: 'json', severity: 'error', role, file: path, subject: path,
          detail: 'The language file could not be decoded as UTF-8 text.',
          rule: 'Bedrock language files contain UTF-8 key=value entries.',
          repair: { kind: 'none' }, conversionFailure: true,
        });
        continue;
      }
      const keys = new Set<string>();
      contents.split(/\r?\n/).forEach((line, index) => {
        const row = line.trim();
        if (!row || row.startsWith('#') || row.startsWith('!')) return;
        const split = row.indexOf('=');
        const key = split > 0 ? row.slice(0, split).trim() : '';
        const value = split > 0 ? row.slice(split + 1).trim() : '';
        if (/^[A-Za-z0-9_.:-]+$/.test(key) && value && !keys.has(key)) {
          keys.add(key);
          return;
        }
        add({
          check: 'json', severity: 'error', role, file: path, subject: `line ${index + 1}`,
          detail: 'Localization entry has an invalid/duplicate key or an empty/missing value.',
          rule: 'Bedrock .lang entries require unique non-empty translation keys and non-empty values in key=value form.',
          repair: { kind: 'none' },
        });
      });
      if (keys.size === 0) {
        add({
          check: 'json', severity: 'error', role, file: path, subject: path,
          detail: 'The language file contains no valid key=value translations.',
          rule: 'Each declared Bedrock locale must contain at least one valid localization key and non-empty string value.',
          repair: { kind: 'none' }, conversionFailure: true,
        });
      }
    }
  }

  const geometryIds = new Set<string>();
  /** Which shipped file owns each geometry identifier — Bedrock registers them globally. */
  const geometryIdentifierOwners = new Map<string, string>();
  const animationIds = new Set<string>();
  const controllerIds = new Set<string>();
  const renderControllerIds = new Set<string>();
  const shippedMaterials = new Set<string>();
  const entityIds = new Set<string>();
  const declaredEventsByEntity = new Map<string, Set<string>>();
  const itemAtlas = new Map<string, string>();
  const terrainAtlas = new Set<string>();

  for (const doc of docs) {
    const lower = doc.path.toLowerCase();
    if (lower.startsWith('materials/')) shippedMaterials.add(lower);
  }

  const checkFormatVersion = (
    doc: ParsedDoc,
    allowed: string[],
    pointer = 'format_version',
  ): void => {
    checked['format-version'] += 1;
    const raw = (doc.doc as Record<string, unknown>).format_version;
    const value = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '';
    if (allowed.includes(value)) return;
    // Any well-formed 1.x.y version is accepted where Bedrock versions the document
    // independently of the format schemas listed above.
    if (allowed.includes('any-1.x') && /^1\.\d{1,2}\.\d{1,2}$/.test(value)) return;
    if (allowed.includes('any-1.20+') && /^1\.(?:1[6-9]|[2-9][0-9])\.\d{1,2}$/.test(value)) return;
    const normalised = allowed.find((entry) => !entry.startsWith('any-')) ?? '1.10.0';
    add({
      check: 'format-version',
      severity: 'error',
      role: doc.role,
      file: doc.path,
      subject: pointer,
      detail: value
        ? `format_version "${value}" is not a version the engine accepts for this document kind (accepted: ${allowed.join(', ')}).`
        : 'The document declares no format_version, so the engine falls back to a legacy parser.',
      rule: RULES.formatVersion,
      repair: { kind: 'format-version', payload: { pointer, value: normalised } },
    });
  };

  const checkIdentifier = (
    role: ValidationPackRole,
    file: string,
    pointer: string,
    rawValue: unknown,
    fallbackName: string,
  ): string => {
    checked.identifier += 1;
    const value = textOf(rawValue);
    if (IDENTIFIER_RE.test(value)) return value;
    const body = (value || fallbackName)
      .toLowerCase()
      .replace(/^[a-z0-9_.-]+:/, '')
      .replace(/[^a-z0-9_.-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const repaired = `${ctx.modId.toLowerCase()}:${body || 'unnamed'}`;
    add({
      check: 'identifier',
      severity: 'error',
      role,
      file,
      subject: value || pointer,
      detail: value
        ? `"${value}" is not a valid Bedrock identifier (lowercase namespace:path, no spaces or §format codes).`
        : 'The declaration has no identifier, so the engine cannot register it.',
      rule: RULES.identifier,
      repair: { kind: 'identifier', payload: { pointer, value: repaired } },
    });
    return value;
  };

  // 2. Geometry, UVs and entity bounds.
  for (const doc of docs) {
    if (doc.role !== 'RP') continue;
    const lower = doc.path.toLowerCase();
    if (!lower.startsWith('models/') || !lower.endsWith('.geo.json')) continue;

    checkFormatVersion(doc, GEOMETRY_VERSIONS);
    const geometries = asArray(doc.doc['minecraft:geometry']);
    if (geometries.length === 0) {
      add({
        check: 'geometry',
        severity: 'error',
        role: 'RP',
        file: doc.path,
        subject: doc.path,
        detail: 'The geometry file declares no minecraft:geometry array, so nothing is registered.',
        rule: RULES.geometry,
        repair: { kind: 'none' },
      });
      continue;
    }

    geometries.forEach((rawGeo, geoIndex) => {
      const geo = asRecord(rawGeo);
      checked.geometry += 1;
      if (!geo) {
        add({
          check: 'geometry',
          severity: 'error',
          role: 'RP',
          file: doc.path,
          subject: `minecraft:geometry[${geoIndex}]`,
          detail: 'The geometry entry is not an object.',
          rule: RULES.geometry,
          repair: { kind: 'none' },
        });
        return;
      }
      const description = asRecord(geo.description) ?? {};
      const declared = textOf(description.identifier);
      checkIdentifier(
        'RP',
        doc.path,
        `minecraft:geometry[${geoIndex}].description.identifier`,
        declared,
        doc.path.split('/').pop()?.replace(/\.geo\.json$/i, '') ?? 'geometry',
      );
      if (declared && IDENTIFIER_RE.test(declared)) {
        const owner = geometryIdentifierOwners.get(declared);
        if (owner && owner !== doc.path) {
          add({
            check: 'identifier',
            severity: 'error',
            role: 'RP',
            file: doc.path,
            subject: declared,
            detail: `The identifier "${declared}" is also declared by ${owner}. Bedrock registers geometry identifiers globally, so one of the two models is silently dropped.`,
            rule: RULES.identifier,
            repair: { kind: 'none' },
            conversionFailure: true,
          });
        } else {
          geometryIdentifierOwners.set(declared, doc.path);
        }
        geometryIds.add(declared);
      }

      const textureWidth = Number(description.texture_width) || 0;
      const textureHeight = Number(description.texture_height) || 0;
      if (!textureWidth || !textureHeight) {
        // The sheet is derived from the UVs the document actually uses. Declaring a
        // hardcoded 16x16 for pixel-space UVs turned every face into an "out of range"
        // defect and then clamped each one, destroying the mapping it was meant to fix.
        const extent = rawUvExtent(geo.bones);
        const derivedWidth = Math.max(16, pow2Sheet(extent.maxU));
        const derivedHeight = Math.max(16, pow2Sheet(extent.maxV));
        add({
          check: 'geometry',
          severity: 'warning',
          role: 'RP',
          file: doc.path,
          subject: `${declared || doc.path}:texture_width`,
          detail: `description.texture_width/texture_height are missing, so UVs are interpreted against an unknown sheet size (the document references UVs up to ${Math.round(extent.maxU)}x${Math.round(extent.maxV)}).`,
          rule: RULES.geometry,
          repair: {
            kind: 'geometry-description',
            payload: {
              pointer: `minecraft:geometry[${geoIndex}].description`,
              value: { texture_width: derivedWidth, texture_height: derivedHeight },
            },
          },
        });
      }

      const bones = asArray(geo.bones);
      const cubes: Array<{ cube: Record<string, unknown>; pointer: string }> = [];
      const uvSamples: UvSample[] = [];
      bones.forEach((rawBone, boneIndex) => {
        const bone = asRecord(rawBone);
        if (!bone) return;
        asArray(bone.cubes).forEach((rawCube, cubeIndex) => {
          const cube = asRecord(rawCube);
          if (cube) {
            cubes.push({
              cube,
              pointer: `minecraft:geometry[${geoIndex}].bones[${boneIndex}].cubes[${cubeIndex}]`,
            });
          }
        });
      });

      if (cubes.length === 0) {
        add({
          check: 'geometry',
          severity: 'error',
          role: 'RP',
          file: doc.path,
          subject: declared || doc.path,
          detail: 'The geometry declares no cubes, so the model renders as nothing.',
          rule: RULES.geometry,
          repair: { kind: 'none' },
        });
      }

      for (const { cube, pointer } of cubes) {
        checked.geometry += 1;
        const size = asArray(cube.size);
        const validSize =
          size.length === 3 && size.every((entry) => Number.isFinite(Number(entry)) && Number(entry) > 0);
        if (!validSize) {
          const clamped = [0, 1, 2].map((axis) => {
            const raw = Number(size[axis]);
            if (!Number.isFinite(raw)) return 1;
            return raw > 0 ? raw : 0.05;
          });
          add({
            check: 'geometry',
            severity: 'error',
            role: 'RP',
            file: doc.path,
            subject: `${declared || doc.path}:cube@${pointer.split('.').pop()}`,
            detail: `Cube size ${JSON.stringify(size)} has zero, negative or non-numeric axes; Bedrock culls zero-volume cubes.`,
            rule: RULES.geometry,
            repair: { kind: 'geometry-volume', payload: { pointer: `${pointer}.size`, value: clamped } },
          });
        }
        const rotation = asRecord(cube.rotation);
        if (rotation && !Number.isFinite(Number(rotation.angle))) {
          add({
            check: 'geometry',
            severity: 'warning',
            role: 'RP',
            file: doc.path,
            subject: `${declared || doc.path}:cube rotation`,
            detail: 'Cube rotation declares a non-numeric angle, which the geometry parser rejects.',
            rule: RULES.geometry,
            repair: { kind: 'none' },
          });
        }

        // Numeric validity only. Whether a rectangle actually lands on the declared sheet is
        // decided once per geometry further below: a per-face clamp is what silently moved
        // 668 faces onto the wrong pixels of their own texture.
        const checkBoxUv = (rawUv: unknown, pointer: string) => {
          checked.uv += 1;
          // Bedrock also supports a per-face cube UV object:
          //   { north: { uv: [x, y], uv_size: [w, h] }, ... }
          // That structure is the richest representation of the source mapping and is
          // accepted by the geometry parser, so it is validated face by face here. The
          // old check demanded a 2-number array and rewrote valid per-face data away.
          if (rawUv && typeof rawUv === 'object' && !Array.isArray(rawUv)) {
            const faces = Object.entries(rawUv as Record<string, unknown>);
            if (faces.length === 0) {
              add({
                check: 'uv',
                severity: 'error',
                role: 'RP',
                file: doc.path,
                subject: `${declared || doc.path}:${pointer}`,
                detail: 'The per-face cube UV object declares no faces, so no cube face can be sampled.',
                rule: RULES.uv,
                repair: { kind: 'none' },
              });
              return;
            }
            const invalidFaces: string[] = [];
            for (const [faceName, rawFace] of faces) {
              const face = asRecord(rawFace);
              const anchor = asArray(face?.uv).map((entry) => Number(entry));
              const size = asArray(face?.uv_size).map((entry) => Number(entry));
              const anchorOk = anchor.length === 2 && anchor.every((entry) => Number.isFinite(entry));
              const sizeOk = size.length === 2 && size.every((entry) => Number.isFinite(entry));
              if (!anchorOk || !sizeOk) {
                invalidFaces.push(faceName);
                continue;
              }
              // A negative uv_size is mirroring, not an error: the magnitude is the span.
              uvSamples.push({
                pointer: `${pointer}.${faceName}`,
                origin: [anchor[0], anchor[1]],
                span: [Math.abs(size[0]), Math.abs(size[1])],
              });
            }
            if (invalidFaces.length > 0) {
              add({
                check: 'uv',
                severity: 'error',
                role: 'RP',
                file: doc.path,
                subject: `${declared || doc.path}:${pointer}`,
                detail: `Per-face cube UV face(s) ${invalidFaces.join(', ')} do not declare a numeric uv anchor and uv_size pair.`,
                rule: RULES.uv,
                repair: { kind: 'none' },
              });
            }
            return;
          }
          const numbers = asArray(rawUv).map((entry) => Number(entry));
          if (numbers.length !== 2 || !numbers.every((entry) => Number.isFinite(entry))) {
            add({
              check: 'uv',
              severity: 'error',
              role: 'RP',
              file: doc.path,
              subject: `${declared || doc.path}:${pointer}`,
              detail: `A box UV must be a 2-number origin array or a per-face uv/uv_size object, received ${JSON.stringify(rawUv)}.`,
              rule: RULES.uv,
              repair: { kind: 'none' },
            });
            return;
          }
          uvSamples.push({ pointer, origin: [numbers[0], numbers[1]], span: [0, 0] });
        };

        const checkFaceUv = (face: Record<string, unknown>, pointer: string, faceName: string) => {
          const rawUv = face.uv;
          if (rawUv == null) return;
          checked.uv += 1;
          const numbers = asArray(rawUv).map((entry) => Number(entry));
          if (numbers.length !== 2 && numbers.length !== 4) {
            add({
              check: 'uv',
              severity: 'error',
              role: 'RP',
              file: doc.path,
              subject: `${declared || doc.path}:${pointer}`,
              detail: `A face UV must be an anchor pair (uv) or a legacy 4-number rectangle, received ${JSON.stringify(rawUv)}.`,
              rule: RULES.uv,
              repair: { kind: 'none' },
            });
            return;
          }
          if (!numbers.every((entry) => Number.isFinite(entry))) {
            add({
              check: 'uv',
              severity: 'error',
              role: 'RP',
              file: doc.path,
              subject: `${declared || doc.path}:${pointer}`,
              detail: `UV holds a non-numeric value (${JSON.stringify(rawUv)}).`,
              rule: RULES.uv,
              repair: {
                kind: 'uv-value',
                payload: { pointer, value: numbers.map((entry) => (Number.isFinite(entry) ? entry : 0)) },
              },
            });
            return;
          }
          if (numbers.length === 4) {
            // A legacy rectangle is translated into anchor + signed size with the same
            // region, mirroring included, instead of being flattened or clamped.
            const origin: [number, number] = [Math.min(numbers[0], numbers[2]), Math.min(numbers[1], numbers[3])];
            const span: [number, number] = [
              Math.max(1, Math.abs(numbers[2] - numbers[0])),
              Math.max(1, Math.abs(numbers[3] - numbers[1])),
            ];
            const oriented = orientFaceRect(faceName as ModelFaceName, origin, span, {
              u: numbers[2] < numbers[0],
              v: numbers[3] < numbers[1],
            });
            add({
              check: 'uv',
              severity: 'warning',
              role: 'RP',
              file: doc.path,
              subject: `${declared || doc.path}:${pointer}`,
              detail: `Face UV ${JSON.stringify(numbers)} is a legacy 4-number rectangle; Bedrock reads an anchor (uv) plus a signed size (uv_size), so this face samples the wrong region.`,
              rule: RULES.uv,
              repair: {
                kind: 'uv-face',
                payload: { pointer: pointer.replace(/\.uv$/, ''), value: oriented },
              },
            });
            uvSamples.push({ pointer, origin, span });
            return;
          }
          const sizeNumbers = asArray(face.uv_size).map((entry) => Number(entry));
          const span: [number, number] =
            sizeNumbers.length === 2 && sizeNumbers.every((entry) => Number.isFinite(entry))
              ? [Math.abs(sizeNumbers[0]), Math.abs(sizeNumbers[1])]
              : [0, 0];
          uvSamples.push({ pointer, origin: [numbers[0], numbers[1]], span });
        };

        if (cube.uv != null) checkBoxUv(cube.uv, `${pointer}.uv`);
        const faces = asRecord(cube.faces);
        if (faces) {
          for (const [faceName, rawFace] of Object.entries(faces)) {
            const face = asRecord(rawFace);
            if (face) checkFaceUv(face, `${pointer}.faces.${faceName}.uv`, faceName);
          }
        }
      }

      // One verdict per geometry, not one per face. A rectangle that merely starts at or
      // crosses the sheet edge is a structure Bedrock supports (it clamps sampling exactly
      // like Java), so it is never reported and never rewritten. The one real defect is a
      // declared sheet smaller than the space the emitted rectangles live in: that is
      // reported once per geometry with the sheet declaration that fixes it, and no UV
      // coordinate is ever touched.
      if (uvSamples.length > 0 && textureWidth > 0 && textureHeight > 0) {
        const coverage = verifySheetCoverage(uvSamples, { width: textureWidth, height: textureHeight });
        if (coverage.status === 'sheet-too-small') {
          add({
            check: 'uv',
            severity: 'warning',
            role: 'RP',
            file: doc.path,
            subject: `${declared || doc.path}:uv-sheet`,
            detail: coverage.detail,
            rule: RULES.uv,
            repair: {
              kind: 'geometry-description',
              payload: {
                pointer: `minecraft:geometry[${geoIndex}].description`,
                value: { texture_width: coverage.neededWidth, texture_height: coverage.neededHeight },
              },
            },
          });
        }
      }

      const isEntityGeometry = /models\/entity\//.test(lower) || lower.includes('entity');
      if (isEntityGeometry) {
        const hasBounds =
          Number(description.visible_bounds_width) > 0 && Number(description.visible_bounds_height) > 0;
        if (!hasBounds) {
          add({
            check: 'geometry',
            severity: 'warning',
            role: 'RP',
            file: doc.path,
            subject: `${declared || doc.path}:visible_bounds`,
            detail: 'Entity geometry declares no usable visible_bounds_width/height, so the engine sizes the viewport from the cubes.',
            rule: RULES.geometry,
            repair: {
              kind: 'geometry-bounds',
              payload: { pointer: `minecraft:geometry[${geoIndex}].description` },
            },
          });
        }
      }
    });
  }

  // 3. Animations.
  for (const doc of docs) {
    if (doc.role !== 'RP') continue;
    const lower = doc.path.toLowerCase();
    if (!lower.startsWith('animations/') || !lower.endsWith('.json')) continue;
    checkFormatVersion(doc, ANIMATION_VERSIONS);
    const animations = asRecord(doc.doc.animations);
    if (!animations || Object.keys(animations).length === 0) {
      add({
        check: 'animation',
        severity: 'error',
        role: 'RP',
        file: doc.path,
        subject: doc.path,
        detail: 'The file declares no animations object, so Bedrock registers no clip.',
        rule: RULES.animation,
        repair: { kind: 'none' },
        conversionFailure: true,
      });
      continue;
    }
    for (const [clipId, rawClip] of Object.entries(animations)) {
      checked.animation += 1;
      animationIds.add(clipId);
      const clip = asRecord(rawClip);
      if (!clip) {
        add({
          check: 'animation',
          severity: 'error',
          role: 'RP',
          file: doc.path,
          subject: clipId,
          detail: 'The clip is not an object.',
          rule: RULES.animation,
          repair: { kind: 'none' },
        });
        continue;
      }
      const length = clip.animation_length;
      if (length != null && (!Number.isFinite(Number(length)) || Number(length) <= 0)) {
        add({
          check: 'animation',
          severity: 'warning',
          role: 'RP',
          file: doc.path,
          subject: `${clipId}:animation_length`,
          detail: `animation_length ${JSON.stringify(length)} is not a positive number, so playback length is undefined.`,
          rule: RULES.animation,
          repair: { kind: 'none' },
        });
      }
      const loopValue = clip.loop;
      if (loopValue != null && typeof loopValue !== 'boolean' && textOf(loopValue) !== 'hold_on_last_frame') {
        add({
          check: 'animation',
          severity: 'warning',
          role: 'RP',
          file: doc.path,
          subject: `${clipId}:loop`,
          detail: `loop "${String(loopValue)}" is neither a boolean nor "hold_on_last_frame".`,
          rule: RULES.animation,
          repair: { kind: 'none' },
        });
      }
      const bones = asRecord(clip.bones);
      if (!bones || Object.keys(bones).length === 0) {
        add({
          check: 'animation',
          severity: 'warning',
          role: 'RP',
          file: doc.path,
          subject: clipId,
          detail: 'The clip animates no bones, so it plays as a no-op.',
          rule: RULES.animation,
          repair: { kind: 'none' },
        });
        continue;
      }
      for (const [boneName, rawTrack] of Object.entries(bones)) {
        const track = asRecord(rawTrack);
        if (!track) {
          add({
            check: 'animation',
            severity: 'error',
            role: 'RP',
            file: doc.path,
            subject: `${clipId}/${boneName}`,
            detail: 'The bone track is not an object, so none of its channels can be read.',
            rule: RULES.animation,
            repair: { kind: 'none' },
          });
          continue;
        }
        for (const [channel, value] of Object.entries(track)) {
          if (channel === 'relative_to') continue;
          checked.animation += 1;
          // Bedrock reads a channel as a timestamp map whose keyframes are a number, a
          // Molang string, a 1-3 component array or a {pre, post, lerp_mode} object. Java
          // vector channels, nested arrays and GeckoLib easing names are detected here and
          // rewritten with every source timestamp preserved.
          const analysis = analyzeChannel(channel, value);
          if (!analysis.channel) {
            add({
              check: 'unsupported',
              severity: 'warning',
              role: 'RP',
              file: doc.path,
              subject: `${clipId}/${boneName}.${channel}`,
              detail:
                analysis.problems[0]?.detail ??
                `channel "${channel}" is not part of the Bedrock animation schema, so it animates nothing.`,
              rule: RULES.animation,
              repair: { kind: 'none' },
            });
            continue;
          }
          if (analysis.problems.length === 0) continue;
          add({
            check: 'animation',
            severity: analysis.problems.some((problem) => problem.kind !== 'normalised') ? 'error' : 'warning',
            role: 'RP',
            file: doc.path,
            subject: `${clipId}/${boneName}.${channel}`,
            detail: `Bedrock cannot read this keyframe channel as written: ${analysis.problems
              .map((problem) => problem.detail)
              .join('; ')}.`,
            rule: RULES.animation,
            repair: {
              kind: 'animation-channel',
              payload: {
                path: ['animations', clipId, 'bones', boneName, analysis.channel],
                value: analysis.value,
              },
            },
            conversionFailure: analysis.problems.some((problem) => problem.kind !== 'normalised'),
          });
        }
      }
    }
  }

  // 4. Animation controllers.
  for (const doc of docs) {
    if (doc.role !== 'RP') continue;
    const lower = doc.path.toLowerCase();
    if (!lower.startsWith('animation_controllers/') || !lower.endsWith('.json')) continue;
    checkFormatVersion(doc, ANIMATION_VERSIONS);
    const controllers = asRecord(doc.doc.animation_controllers);
    if (!controllers || Object.keys(controllers).length === 0) {
      add({
        check: 'render-controller',
        severity: 'error',
        role: 'RP',
        file: doc.path,
        subject: doc.path,
        detail: 'The file declares no animation_controllers object.',
        rule: RULES.controller,
        repair: { kind: 'none' },
        conversionFailure: true,
      });
      continue;
    }
    for (const [controllerId, rawController] of Object.entries(controllers)) {
      checked['render-controller'] += 1;
      controllerIds.add(controllerId);
      const controller = asRecord(rawController);
      const states = asRecord(controller?.states) ?? {};
      const stateNames = Object.keys(states);
      const initial = textOf(controller?.initial_state);
      if (!initial || !stateNames.includes(initial)) {
        add({
          check: 'render-controller',
          severity: 'error',
          role: 'RP',
          file: doc.path,
          subject: controllerId,
          detail: `initial_state "${initial}" does not exist, so the state machine never starts.`,
          rule: RULES.controller,
          repair: { kind: 'none' },
        });
      }
      for (const [stateName, rawState] of Object.entries(states)) {
        const state = asRecord(rawState) ?? {};
        for (const transition of asArray(state.transitions)) {
          const record = asRecord(transition);
          const target = record ? Object.keys(record)[0] : textOf(transition);
          if (target && !stateNames.includes(target)) {
            add({
              check: 'render-controller',
              severity: 'error',
              role: 'RP',
              file: doc.path,
              subject: `${controllerId}/${stateName}`,
              detail: `Transition target "${target}" is not a state of this controller.`,
              rule: RULES.controller,
              repair: { kind: 'none' },
            });
          }
        }
        for (const clip of asArray(state.animations)) {
          const clipId = textOf(clip);
          if (clipId && !animationIds.has(clipId)) {
            add({
              check: 'animation',
              severity: 'warning',
              role: 'RP',
              file: doc.path,
              subject: `${controllerId}/${stateName}`,
              detail: `The state plays "${clipId}", but no shipped animation file declares that clip.`,
              rule: RULES.animation,
              repair: { kind: 'none' },
            });
          }
        }
      }
    }
  }

  // 5. Render controllers.
  for (const doc of docs) {
    if (doc.role !== 'RP') continue;
    const lower = doc.path.toLowerCase();
    if (!lower.startsWith('render_controllers/') || !lower.endsWith('.json')) continue;
    checkFormatVersion(doc, RENDER_CONTROLLER_VERSIONS);
    const controllers = asRecord(doc.doc.render_controllers) ?? asRecord(doc.doc['minecraft:render_controllers']);
    if (!controllers || Object.keys(controllers).length === 0) {
      add({
        check: 'render-controller',
        severity: 'error',
        role: 'RP',
        file: doc.path,
        subject: doc.path,
        detail: 'The file declares no render_controllers object, so client entities referencing it render nothing.',
        rule: RULES.renderController,
        repair: { kind: 'none' },
        conversionFailure: true,
      });
      continue;
    }
    for (const [controllerId, rawController] of Object.entries(controllers)) {
      checked['render-controller'] += 1;
      renderControllerIds.add(controllerId);
      const controller = asRecord(rawController);
      if (!controller) continue;
      // The client schema reads `textures` as an ARRAY of texture expressions. A scalar
      // string (or an empty array) is rejected with "unknown child schema option type", so
      // it is validated here and repaired in place instead of being reported as clean.
      const texturesValue = controller.textures;
      if (typeof texturesValue === 'string' || !Array.isArray(texturesValue) || texturesValue.length === 0) {
        add({
          check: 'render-controller',
          severity: 'error',
          role: 'RP',
          file: doc.path,
          subject: `${controllerId}:textures`,
          detail:
            typeof texturesValue === 'string'
              ? `The render controller declares textures as a scalar string ("${texturesValue}"); the client schema requires an array of texture expressions and rejects the document with "unknown child schema option type".`
              : 'The render controller declares no usable textures array, so the client schema rejects it with "unknown child schema option type".',
          rule: RULES.renderController,
          repair: {
            kind: 'render-controller',
            payload: {
              key: controllerId,
              textures: typeof texturesValue === 'string' ? [texturesValue] : ['Texture.default'],
            },
          },
          conversionFailure: true,
        });
      }
      if (!Array.isArray(controller.materials) || controller.materials.length === 0) {
        add({
          check: 'render-controller',
          severity: 'error',
          role: 'RP',
          file: doc.path,
          subject: controllerId,
          detail: 'The render controller declares no materials array.',
          rule: RULES.renderController,
          repair: {
            kind: 'render-controller',
            payload: { key: controllerId, value: ['Material.default'] },
          },
        });
      }
    }
  }

  // 6. Texture atlases & PNG payloads.
  for (const doc of docs) {
    if (doc.role !== 'RP') continue;
    const lower = doc.path.toLowerCase();
    if (lower === 'textures/item_texture.json' || lower === 'textures/terrain_texture.json') {
      const data = asRecord(doc.doc.texture_data);
      for (const [key, rawEntry] of Object.entries(data ?? {})) {
        checked.reference += 1;
        const entry = asRecord(rawEntry);
        const reference = textOf(entry?.textures) || textOf(rawEntry);
        // An atlas key or path carrying an audit label is not a resource path the engine
        // can resolve; such an entry is reported, never exported as if it were valid.
        if (INTERNAL_LABEL.test(key) || INTERNAL_LABEL.test(reference)) {
          add({
            check: 'reference',
            severity: 'warning',
            role: 'RP',
            file: doc.path,
            subject: key,
            detail: `Atlas entry "${key}" → "${reference}" contains an internal validator label, which is not a texture path Bedrock can resolve.`,
            rule: RULES.reference,
            repair: { kind: 'none' },
          });
        }
        if (!reference) {
          add({
            check: 'reference',
            severity: 'error',
            role: 'RP',
            file: doc.path,
            subject: key,
            detail: 'The atlas entry declares no texture path.',
            rule: RULES.reference,
            repair: { kind: 'none' },
          });
          continue;
        }
        if (!resolveTexturePath(reference)) {
          add({
            check: 'reference',
            severity: 'error',
            role: 'RP',
            file: doc.path,
            subject: key,
            detail: `Atlas entry "${key}" points at "${reference}", which is not in the pack — the game renders the checkerboard.`,
            rule: RULES.reference,
            repair: { kind: 'none' },
            conversionFailure: true,
          });
          continue;
        }
        if (lower === 'textures/item_texture.json') itemAtlas.set(key, reference);
        else terrainAtlas.add(key);
      }
    }
  }

  for (const [path, data] of Object.entries(rp)) {
    if (!path.toLowerCase().endsWith('.png')) continue;
    checked.texture += 1;
    if (isPng(data)) continue;
    add({
      check: 'texture',
      severity: 'error',
      role: 'RP',
      file: path,
      subject: path,
      detail: 'The PNG payload is absent, truncated or missing the PNG magic bytes, so the texture loader drops it.',
      rule: RULES.texture,
      repair: { kind: 'none' },
      conversionFailure: true,
    });
  }

  // 7. Client entities: references, materials, render controllers.
  for (const doc of docs) {
    if (doc.role !== 'RP') continue;
    const lower = doc.path.toLowerCase();
    if (!lower.startsWith('entity/') || !lower.endsWith('.json')) continue;
    const description = asRecord(asRecord(doc.doc['minecraft:client_entity'])?.description);
    if (!description) {
      add({
        check: 'behavior',
        severity: 'error',
        role: 'RP',
        file: doc.path,
        subject: doc.path,
        detail: 'The file declares no minecraft:client_entity.description, so the entity has no client definition.',
        rule: RULES.behavior,
        repair: { kind: 'none' },
        conversionFailure: true,
      });
      continue;
    }
    checkFormatVersion(doc, ENTITY_VERSIONS);
    checkIdentifier(
      'RP',
      doc.path,
      'minecraft:client_entity.description.identifier',
      description.identifier,
      doc.path.split('/').pop()?.replace(/\..*$/i, '') ?? 'entity',
    );

    const textures = asRecord(description.textures) ?? {};
    for (const [key, value] of Object.entries(textures)) {
      checked.reference += 1;
      const reference = textOf(value);
      // An entity definition path is not a texture path: nothing may be resolved from it.
      if (/\.(entity\.)?json$/i.test(reference) || /\.entity$/i.test(reference)) {
        add({
          check: 'reference',
          severity: 'error',
          role: 'RP',
          file: doc.path,
          subject: `${key}="${reference}"`,
          detail: 'The client entity binds an entity definition path as a texture; the entity JSON file name is never a texture reference.',
          rule: RULES.reference,
          repair: { kind: 'none' },
          conversionFailure: true,
        });
        continue;
      }
      if (!resolveTexturePath(reference)) {
        add({
          check: 'reference',
          severity: 'error',
          role: 'RP',
          file: doc.path,
          subject: `${key}="${reference}"`,
          detail: `The client entity binds texture "${reference}", which is not shipped — the mob renders untextured.`,
          rule: RULES.reference,
          repair: { kind: 'none' },
          conversionFailure: true,
        });
      }
    }

    const geometries = asRecord(description.geometry) ?? {};
    const geometryRefs = new Map<string, string>();
    for (const [key, value] of Object.entries(geometries)) {
      checked.reference += 1;
      const reference = textOf(value) || textOf(asRecord(value)?.default);
      if (reference) geometryRefs.set(key, reference);
      if (!geometryIds.has(reference)) {
        add({
          check: 'reference',
          severity: 'error',
          role: 'RP',
          file: doc.path,
          subject: `geometry.${key}="${reference}"`,
          detail: `The client entity references geometry "${reference}", but no shipped geometry file declares that identifier.`,
          rule: RULES.reference,
          repair: { kind: 'none' },
          conversionFailure: true,
        });
      }
    }

    const materials = asRecord(description.materials) ?? {};
    for (const [key, value] of Object.entries(materials)) {
      checked.material += 1;
      const material = textOf(value);
      const isShippedMaterial = [...shippedMaterials].some((file) =>
        file.includes(material.toLowerCase().replace(/^[a-z0-9_.-]+:/, '')),
      );
      if (KNOWN_MATERIALS.has(material) || isShippedMaterial) continue;
      add({
        check: 'material',
        severity: 'error',
        role: 'RP',
        file: doc.path,
        subject: `materials.${key}="${material}"`,
        detail: `Material "${material}" is not an engine material and no materials/*.material file in the pack declares it.`,
        rule: RULES.material,
        repair: {
          kind: 'material',
          payload: { pointer: `minecraft:client_entity.description.materials.${key}`, value: 'entity_alphatest' },
        },
      });
    }

    const controllers = description.render_controllers ?? {};
    const controllerList = Array.isArray(controllers)
      ? controllers
      : Object.values(asRecord(controllers) ?? {});
    for (const controller of controllerList) {
      checked['render-controller'] += 1;
      const reference = textOf(controller);
      if (renderControllerIds.has(reference) || controllerIds.has(reference)) continue;
      const firstGeometry = [...geometryRefs.values()].find((value) => geometryIds.has(value)) ?? '';
      const firstTexture = Object.values(textures).map(textOf).find((value) => resolveTexturePath(value)) ?? '';
      add({
        check: 'render-controller',
        severity: 'error',
        role: 'RP',
        file: doc.path,
        subject: reference || 'render_controllers',
        detail: `Render controller "${reference}" is not shipped${firstGeometry ? '' : ' and no geometry is available to rebuild it from'}.`,
        rule: RULES.renderController,
        repair: firstGeometry && firstTexture
          ? {
              kind: 'render-controller',
              payload: {
                pointer: 'minecraft:client_entity.description.render_controllers',
                controllerId: reference || 'controller.render.repaired',
                geometry: firstGeometry,
                texture: firstTexture,
                role: 'RP',
              },
            }
          : { kind: 'none' },
      });
    }

    const animations = asRecord(description.animations) ?? {};
    for (const [key, value] of Object.entries(animations)) {
      checked.animation += 1;
      const reference = textOf(value);
      if (animationIds.has(reference) || controllerIds.has(reference)) continue;
      add({
        check: 'animation',
        severity: 'warning',
        role: 'RP',
        file: doc.path,
        subject: `animations.${key}="${reference}"`,
        detail: `The client entity declares clip "${reference}", which no shipped animation file defines.`,
        rule: RULES.animation,
        repair: { kind: 'none' },
      });
    }
  }

  // 8. Behaviour entities, blocks, items, spawn rules.
  for (const doc of docs) {
    if (doc.role !== 'BP') continue;
    const lower = doc.path.toLowerCase();

    if (lower.startsWith('entities/') && lower.endsWith('.json')) {
      const entityRoot = asRecord(doc.doc['minecraft:entity']);
      const description = asRecord(entityRoot?.description);
      if (!entityRoot || !description) {
        add({
          check: 'behavior',
          severity: 'error',
          role: 'BP',
          file: doc.path,
          subject: doc.path,
          detail: 'The file declares no minecraft:entity.description, so the entity cannot be registered.',
          rule: RULES.behavior,
          repair: { kind: 'none' },
          conversionFailure: true,
        });
        continue;
      }
      checkFormatVersion(doc, ENTITY_VERSIONS);
      const identifier = checkIdentifier(
        'BP',
        doc.path,
        'minecraft:entity.description.identifier',
        description.identifier,
        doc.path.split('/').pop()?.replace(/\.json$/i, '') ?? 'entity',
      );
      if (identifier) entityIds.add(identifier);
      const components = asRecord(entityRoot.components) ?? {};
      if (Object.keys(components).length === 0) {
        add({
          check: 'behavior',
          severity: 'error',
          role: 'BP',
          file: doc.path,
          subject: identifier || doc.path,
          detail: 'The entity declares no components, so it spawns inert and cannot be damaged, moved or targeted.',
          rule: RULES.behavior,
          repair: { kind: 'none' },
        });
      }
      for (const key of Object.keys(components)) {
        checked.behavior += 1;
        if (!key.startsWith('minecraft:')) {
          add({
            check: 'behavior',
            severity: 'warning',
            role: 'BP',
            file: doc.path,
            subject: `${identifier}:${key}`,
            detail: `Component "${key}" is not namespaced under minecraft:, so the engine ignores it.`,
            rule: RULES.behavior,
            repair: { kind: 'none' },
          });
        }
      }
      const events = asRecord(entityRoot.events) ?? {};
      if (identifier) declaredEventsByEntity.set(identifier, new Set(Object.keys(events)));
      const eventRefs: string[] = [];
      walkStrings(entityRoot, 'minecraft:entity', (text, pointer) => {
        if (/\.(event|event_name|time_down_event\.event)$/.test(pointer) && text) eventRefs.push(`${text}|${pointer}`);
      });
      for (const entry of eventRefs) {
        const [name] = entry.split('|');
        checked.behavior += 1;
        if (events[name]) continue;
        add({
          check: 'behavior',
          severity: 'error',
          role: 'BP',
          file: doc.path,
          subject: `${identifier}->${name}`,
          detail: `Trigger references event "${name}", which the entity never declares, so the trigger is dead.`,
          rule: RULES.behavior,
          repair: { kind: 'none' },
        });
      }
      const loot = asRecord(components['minecraft:loot']);
      const table = textOf(loot?.table);
      if (table && !fileExists('BP', table)) {
        add({
          check: 'reference',
          severity: 'error',
          role: 'BP',
          file: doc.path,
          subject: table,
          detail: 'minecraft:loot points at a table that is not shipped.',
          rule: RULES.reference,
          repair: { kind: 'none' },
        });
      }
      continue;
    }

    if (lower.startsWith('spawn_rules/') && lower.endsWith('.json')) {
      const description = asRecord(asRecord(doc.doc['minecraft:spawn_rules'])?.description);
      const identifier = textOf(description?.identifier);
      checked.reference += 1;
      if (!identifier || !entityIds.has(identifier)) {
        add({
          check: 'reference',
          severity: 'warning',
          role: 'BP',
          file: doc.path,
          subject: identifier || doc.path,
          detail: `Spawn rule targets entity "${identifier}" before any shipped entity declares that identifier.`,
          rule: RULES.reference,
          repair: { kind: 'none' },
        });
      }
      continue;
    }

    if (lower.startsWith('blocks/') && lower.endsWith('.json')) {
      const blockRoot = asRecord(doc.doc['minecraft:block']);
      const description = asRecord(blockRoot?.description);
      if (!blockRoot || !description) {
        add({
          check: 'behavior',
          severity: 'error',
          role: 'BP',
          file: doc.path,
          subject: doc.path,
          detail: 'The file declares no minecraft:block.description.',
          rule: RULES.behavior,
          repair: { kind: 'none' },
          conversionFailure: true,
        });
        continue;
      }
      checkFormatVersion(doc, ENTITY_VERSIONS);
      checkIdentifier(
        'BP',
        doc.path,
        'minecraft:block.description.identifier',
        description.identifier,
        doc.path.split('/').pop()?.replace(/\.json$/i, '') ?? 'block',
      );
      const components = asRecord(blockRoot.components) ?? {};
      const geometryComponent = asRecord(components['minecraft:geometry']);
      const geometryRef = textOf(geometryComponent?.identifier);
      if (geometryRef) {
        checked.reference += 1;
        if (!geometryIds.has(geometryRef)) {
          add({
            check: 'reference',
            severity: 'error',
            role: 'BP',
            file: doc.path,
            subject: geometryRef,
            detail: `The block renders with geometry "${geometryRef}", which is not shipped.`,
            rule: RULES.reference,
            repair: { kind: 'none' },
            conversionFailure: true,
          });
        }
      }
      const materialInstances = asRecord(components['minecraft:material_instances']);
      if (materialInstances) {
        for (const [slot, rawInstance] of Object.entries(materialInstances)) {
          checked.reference += 1;
          const texture = textOf(asRecord(rawInstance)?.texture);
          if (!texture || terrainAtlas.has(texture)) continue;
          const candidate = `textures/blocks/${texture}.png`;
          add({
            check: 'reference',
            severity: 'warning',
            role: 'BP',
            file: doc.path,
            subject: `${slot}="${texture}"`,
            detail: `Material instance texture "${texture}" has no terrain atlas entry, so the face renders the checkerboard.`,
            rule: RULES.reference,
            repair: resolveTexturePath(candidate)
              ? { kind: 'atlas-entry', payload: { role: 'RP', key: texture, path: candidate.replace(/\.png$/, '') } }
              : { kind: 'none' },
          });
        }
      }
      continue;
    }

    if (lower.startsWith('items/') && lower.endsWith('.json')) {
      const itemRoot = asRecord(doc.doc['minecraft:item']);
      const description = asRecord(itemRoot?.description);
      if (!itemRoot || !description) {
        add({
          check: 'behavior',
          severity: 'error',
          role: 'BP',
          file: doc.path,
          subject: doc.path,
          detail: 'The file declares no minecraft:item.description.',
          rule: RULES.behavior,
          repair: { kind: 'none' },
          conversionFailure: true,
        });
        continue;
      }
      checkFormatVersion(doc, ENTITY_VERSIONS);
      checkIdentifier(
        'BP',
        doc.path,
        'minecraft:item.description.identifier',
        description.identifier,
        doc.path.split('/').pop()?.replace(/\.json$/i, '') ?? 'item',
      );
      const components = asRecord(itemRoot.components) ?? {};
      const iconRaw = components['minecraft:icon'];
      const iconKey =
        textOf(iconRaw) ||
        textOf(asRecord(iconRaw)?.texture) ||
        textOf(asRecord(asRecord(iconRaw)?.textures)?.default);
      const itemId = textOf(description.identifier).replace(/^[a-z0-9_.-]+:/, '');
      if (iconKey) {
        checked.reference += 1;
        if (!itemAtlas.has(iconKey)) {
          const candidate = `textures/items/${itemId}.png`;
          add({
            check: 'reference',
            severity: 'error',
            role: 'BP',
            file: doc.path,
            subject: `icon "${iconKey}"`,
            detail: `The creative-menu icon key "${iconKey}" has no item atlas entry, so the item shows untextured.`,
            rule: RULES.reference,
            repair: resolveTexturePath(candidate)
              ? { kind: 'atlas-entry', payload: { role: 'RP', key: iconKey, path: candidate.replace(/\.png$/, '') } }
              : { kind: 'none' },
          });
        }
      } else {
        add({
          check: 'behavior',
          severity: 'warning',
          role: 'BP',
          file: doc.path,
          subject: itemId || doc.path,
          detail: 'The item declares no minecraft:icon component, so it renders as the missing-texture placeholder.',
          rule: RULES.behavior,
          repair: { kind: 'none' },
        });
      }
      continue;
    }

    if (lower.startsWith('recipes/') && lower.endsWith('.json')) {
      const shaped = asRecord(doc.doc['minecraft:recipe_shaped']);
      const shapeless = asRecord(doc.doc['minecraft:recipe_shapeless']);
      const recipe = shaped ?? shapeless;
      if (!recipe) {
        add({
          check: 'behavior',
          severity: 'warning',
          role: 'BP',
          file: doc.path,
          subject: doc.path,
          detail: 'The recipe document declares no supported recipe type, so it is silently ignored by the engine.',
          rule: RULES.behavior,
          repair: { kind: 'none' },
        });
        continue;
      }
      checked.behavior += 1;
      const result = asRecord(recipe.result);
      const resultItem = textOf(result?.item) || textOf(recipe.result);
      if (resultItem && !resultItem.startsWith('minecraft:')) {
        const body = resultItem.replace(/^[a-z0-9_.-]+:/, '');
        const exists = fileExists('BP', `items/${body}.json`) || fileExists('BP', `blocks/${body}.json`);
        if (!exists) {
          add({
            check: 'reference',
            severity: 'warning',
            role: 'BP',
            file: doc.path,
            subject: resultItem,
            detail: `The recipe produces "${resultItem}", but no shipped item or block declares that identifier.`,
            rule: RULES.reference,
            repair: { kind: 'none' },
          });
        }
      }
    }
  }

  // 9. Scripts & dependency integrity.
  const behaviorManifest = docs.find((doc) => doc.role === 'BP' && doc.path === 'manifest.json');
  const resourceManifest = docs.find((doc) => doc.role === 'RP' && doc.path === 'manifest.json');
  if (behaviorManifest) {
    checkFormatVersion(behaviorManifest, MANIFEST_VERSIONS);
    const header = asRecord(behaviorManifest.doc.header) ?? {};
    const modules = asArray(behaviorManifest.doc.modules);
    const dependencies = asArray(behaviorManifest.doc.dependencies);
    for (const rawModule of modules) {
      const module = asRecord(rawModule);
      if (!module) continue;
      if (textOf(module.type) !== 'script') continue;
      checked.script += 1;
      const entry = textOf(module.entry);
      if (!entry || !fileExists('BP', entry)) {
        add({
          check: 'script',
          severity: 'error',
          role: 'BP',
          file: 'manifest.json',
          subject: entry || 'script module',
          detail: `The manifest declares a script module with entry "${entry}", which is not shipped — Bedrock refuses to load the pack.`,
          rule: RULES.script,
          repair: { kind: 'script-module', payload: { value: entry } },
        });
        continue;
      }
      const scriptText = decode(bp[bpIndex.get(entry.toLowerCase()) ?? entry]) ?? '';
      const usesApi = /@minecraft\/server|\bworld\.|\bsystem\.|\bPlayer\b|\bEntityComponentTypes\b/.test(scriptText);
      if (usesApi && !/@minecraft\/server/.test(scriptText)) {
        add({
          check: 'script',
          severity: 'error',
          role: 'BP',
          file: entry,
          subject: entry,
          detail: 'The script uses the Script API but never imports @minecraft/server, so every call throws at runtime.',
          rule: RULES.script,
          repair: { kind: 'none' },
        });
      }
    }
    checked.dependency += 1;
    if (!textOf(header.uuid) || !/^[0-9a-f-]{36}$/i.test(textOf(header.uuid))) {
      add({
        check: 'dependency',
        severity: 'error',
        role: 'BP',
        file: 'manifest.json',
        subject: 'header.uuid',
        detail: 'The behaviour manifest header UUID is missing or malformed, so the pack cannot be identified.',
        rule: RULES.dependency,
        repair: { kind: 'none' },
      });
    }
    const resourceUuid = textOf(asRecord(resourceManifest?.doc.header)?.uuid);
    const hasResourceDependency = dependencies.some(
      (rawDependency) => textOf(asRecord(rawDependency)?.uuid) === resourceUuid && Boolean(resourceUuid),
    );
    if (resourceUuid && !hasResourceDependency) {
      add({
        check: 'dependency',
        severity: 'error',
        role: 'BP',
        file: 'manifest.json',
        subject: resourceUuid,
        detail: 'The behaviour manifest does not depend on the resource pack UUID, so textures and models never bind.',
        rule: RULES.dependency,
        repair: { kind: 'manifest-dependency', payload: { value: resourceUuid } },
      });
    }
    for (const rawDependency of dependencies) {
      const dependency = asRecord(rawDependency);
      const moduleName = textOf(dependency?.module_name);
      if (!moduleName) continue;
      checked.dependency += 1;
      if (KNOWN_MODULES.has(moduleName)) continue;
      add({
        check: 'unsupported',
        severity: 'warning',
        role: 'BP',
        file: 'manifest.json',
        subject: moduleName,
        detail: `Dependency "${moduleName}" is not a module the engine ships; the pack fails to resolve it.`,
        rule: RULES.dependency,
        repair: { kind: 'none' },
      });
    }
  }
  if (resourceManifest) {
    checkFormatVersion(resourceManifest, MANIFEST_VERSIONS);
  }

  // 10. Unsupported functionality: Java syntax leakage and rejected capability flags.
  const seenUnsupported = new Set<string>();
  for (const doc of docs) {
    walkStrings(doc.doc, '', (text, pointer) => {
      if (text.length < 4 || text.length > 400) return;
      if (!JAVA_LEAK.test(text)) return;
      const key = `${doc.role}:${doc.path}:${pointer}`;
      if (seenUnsupported.has(key)) return;
      seenUnsupported.add(key);
      checked.unsupported += 1;
      add({
        check: 'unsupported',
        severity: 'warning',
        role: doc.role,
        file: doc.path,
        subject: pointer || doc.path,
        detail: `Java source syntax leaked into a shipped field ("${text.slice(0, 80)}"); Bedrock cannot evaluate it.`,
        rule: RULES.unsupported,
        repair: /;\s*$/.test(text)
          ? { kind: 'molang-trailer', payload: { pointer, value: text.replace(/\s*;+\s*$/, '') } }
          : { kind: 'none' },
      });
    });
  }

  for (const [role, doc] of [
    ['BP', behaviorManifest],
    ['RP', resourceManifest],
  ] as const) {
    if (!doc) continue;
    const declared = asArray(doc.doc.capabilities).map(textOf).filter(Boolean);
    if (declared.length === 0) continue;
    const engine = asRecord(doc.doc.header)?.min_engine_version ?? ctx.targetVersion;
    const { rejected } = sanitizeCapabilitiesForVersion(engine, declared);
    for (const entry of rejected) {
      checked.unsupported += 1;
      add({
        check: 'unsupported',
        severity: 'warning',
        role,
        file: doc.path,
        subject: entry.name,
        detail: `Capability flag "${entry.name}" is not recognised by the target engine: ${entry.evidence}`,
        rule: RULES.unsupported,
        repair: { kind: 'none' },
      });
    }
  }

  return { findings, checked };
}