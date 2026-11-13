/**
 * PBR / Deferred-material port engine.
 *
 * Java shader packs and resource packs ship physically-based material data as extra images
 * beside each colour sheet. Bedrock cannot run Java shader code, but it does read the same
 * material data through its Deferred (Render Dragon) pipeline — so the port is a data
 * conversion, not a shader rewrite:
 *
 *   1. discovery   — every `.png` in the imported archive is measured against the known PBR
 *                    naming conventions, whatever the mod, loader or folder layout is.
 *   2. registration — matched maps are carried into the resource pack next to the colour
 *                    sheet the converted pack already ships.
 *   3. synthesis   — normal / height sheets are wired as-is; specular + emissive data is
 *                    re-encoded into the `metalness_emissive_roughness` sheet Bedrock reads.
 *   4. declaration — `minecraft:texture_set` is written and the resource manifest gains the
 *                    `pbr` capability so the material is actually resolved at runtime.
 *
 * Nothing is invented: a map whose colour sheet did not survive the port is reported
 * UNRESOLVED, and every conversion is logged for the in-app audit trail.
 */

import type { ComponentProvenance } from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';
import { discoverPbrMaps, type PbrChannel } from '@/utils/pbrMapDiscovery';
import { synthesizeMerSheet } from '@/utils/pbrMerSynthesis';
import { TEXTURE_SET_FORMAT_VERSION } from '@/utils/contentLogRepairs';

type PackFiles = Record<string, string | Uint8Array>;

export type PbrMapStatus = 'registered' | 'unresolved' | 'skipped';

export interface PbrMapRecord {
  channel: PbrChannel;
  sourcePath: string;
  bedrockPath?: string;
  status: PbrMapStatus;
  provenance: ComponentProvenance;
  note: string;
}

export interface PbrTextureSetRecord {
  texturePath: string;
  textureSetPath: string;
  color: string;
  normal?: string;
  mer?: string;
  heightmap?: string;
  provenance: ComponentProvenance;
  status: 'registered' | 'unresolved';
  sources: string[];
  note: string;
}

export interface PbrMaterialReport {
  baseTextures: number;
  mapsDetected: number;
  mapsRegistered: number;
  mapsUnresolved: number;
  mapsSkipped: number;
  normalMaps: number;
  specularMaps: number;
  emissiveMaps: number;
  heightMaps: number;
  prePackedMerMaps: number;
  synthesizedMer: number;
  textureSetsWritten: number;
  capabilityEnabled: boolean;
  conventions: string[];
  maps: PbrMapRecord[];
  textureSets: PbrTextureSetRecord[];
  log: string[];
  summary: string;
}

const MAX_BASE_TEXTURES = 96;
const MIN_ENGINE_VERSION = [1, 21, 50];

function asBytes(value: string | Uint8Array | undefined): Uint8Array | null {
  return value instanceof Uint8Array ? value : null;
}

function stemOf(path: string): string {
  return path.split('/').pop() ?? path;
}

function readJsonObject(value: string | Uint8Array | undefined): Record<string, any> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function compareTriples(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Declares the `pbr` capability so the deferred pipeline resolves the texture sets. */
function declarePbrCapability(rp: PackFiles, onLog: (line: string) => void): boolean {
  const doc = readJsonObject(rp['manifest.json']);
  const header = doc?.header;
  if (!doc || !header) {
    onLog('[PBR][MANIFEST] Resource manifest could not be read — the `pbr` capability was not declared, so the texture sets stay inert until it is.');
    return false;
  }
  const capabilities: string[] = Array.isArray(header.capabilities) ? header.capabilities : [];
  let changed = false;
  if (!capabilities.includes('pbr')) {
    capabilities.push('pbr');
    header.capabilities = capabilities;
    changed = true;
  }
  const current: number[] = Array.isArray(header.min_engine_version) ? header.min_engine_version : [1, 20, 0];
  if (compareTriples(current, MIN_ENGINE_VERSION) < 0) {
    header.min_engine_version = [...MIN_ENGINE_VERSION];
    changed = true;
  }
  if (changed) rp['manifest.json'] = JSON.stringify(doc, null, 2);
  return true;
}

export async function buildPbrMaterials(options: {
  resourcePackFiles: PackFiles;
  entries: ExtractedZipEntry[];
  onLog?: (line: string) => void;
}): Promise<PbrMaterialReport> {
  const rp = options.resourcePackFiles;
  const log = (line: string) => options.onLog?.(line);
  const lines: string[] = [];
  const record = (line: string) => {
    lines.push(line);
    log(line);
  };

  const report: PbrMaterialReport = {
    baseTextures: 0,
    mapsDetected: 0,
    mapsRegistered: 0,
    mapsUnresolved: 0,
    mapsSkipped: 0,
    normalMaps: 0,
    specularMaps: 0,
    emissiveMaps: 0,
    heightMaps: 0,
    prePackedMerMaps: 0,
    synthesizedMer: 0,
    textureSetsWritten: 0,
    capabilityEnabled: false,
    conventions: [],
    maps: [],
    textureSets: [],
    log: lines,
    summary: 'PBR stage did not run.',
  };

  let discovery: ReturnType<typeof discoverPbrMaps>;
  try {
    discovery = discoverPbrMaps(options.entries ?? []);
  } catch (error) {
    report.summary = `PBR discovery failed — ${error instanceof Error ? error.message : String(error)}. No material map is claimed as ported.`;
    record(`[PBR:ERROR] ${report.summary}`);
    return report;
  }
  report.conventions = discovery.conventions;
  report.mapsDetected = discovery.candidates.length;
  record(
    `[PBR] Scanned ${discovery.inspectedPngs} PNG(s) in the imported archive — ${discovery.candidates.length} PBR channel map(s) matched a naming convention (normal / specular / emissive / height / pre-packed MER). Discovery is convention-driven, not mod-specific.`,
  );

  if (discovery.candidates.length === 0) {
    report.summary = 'No PBR channel map was found in the imported archive, so no deferred material was generated. The pack stays on vanilla rendering.';
    record('[PBR] No PBR channel map matched — nothing is generated and no material is invented. Vanilla rendering stays in effect.');
    return report;
  }

  const shippedPngs = new Map<string, string>();
  for (const key of Object.keys(rp)) {
    if (!/\.png$/i.test(key)) continue;
    shippedPngs.set(key.replace(/\.png$/i, '').toLowerCase(), key);
  }

  const groups = new Map<string, Map<PbrChannel, { sourcePath: string; data: Uint8Array; convention: string }>>();
  for (const candidate of discovery.candidates) {
    const bucket: Map<PbrChannel, { sourcePath: string; data: Uint8Array; convention: string }> =
      groups.get(candidate.baseTexture) ?? new Map();
    if (bucket.has(candidate.channel)) {
      report.mapsSkipped += 1;
      report.maps.push({
        channel: candidate.channel,
        sourcePath: candidate.sourcePath,
        status: 'skipped',
        provenance: 'ADAPTED',
        note: `A ${candidate.channel} map for ${candidate.baseTexture} was already supplied by another file — the first match wins and this duplicate is not shipped.`,
      });
      continue;
    }
    bucket.set(candidate.channel, { sourcePath: candidate.sourcePath, data: candidate.data, convention: candidate.convention });
    groups.set(candidate.baseTexture, bucket);
  }

  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, MAX_BASE_TEXTURES);
  if (groups.size > ordered.length) {
    const dropped = groups.size - ordered.length;
    report.mapsSkipped += dropped;
    record(`[PBR][LIMIT] ${dropped} additional base texture(s) exceed the per-pack PBR budget of ${MAX_BASE_TEXTURES} — reported as skipped rather than silently dropped.`);
  }

  for (const [base, channelMap] of ordered) {
    report.baseTextures += 1;
    const colorKey = shippedPngs.get(base.toLowerCase());
    const setPath = `${base}.texture_set.json`;
    const sources = [...channelMap.values()].map((entry) => entry.sourcePath);

    if (!colorKey) {
      for (const [channel, entry] of channelMap) {
        report.mapsUnresolved += 1;
        report.maps.push({
          channel,
          sourcePath: entry.sourcePath,
          status: 'unresolved',
          provenance: 'ABSENT',
          note: `The colour sheet ${base}.png is not in the converted pack, so this ${channel} map cannot be bound to anything.`,
        });
        record(`[PBR][UNRESOLVED] ${entry.sourcePath} → ${base}.png does not ship in the converted pack; the ${channel} map stays unbound.`);
      }
      report.textureSets.push({
        texturePath: base,
        textureSetPath: setPath,
        color: stemOf(base),
        provenance: 'ABSENT',
        status: 'unresolved',
        sources,
        note: 'Colour sheet absent from the converted pack — no texture set was written.',
      });
      continue;
    }

    const normalEntry = channelMap.get('normal');
    const heightEntry = channelMap.get('height');
    const merEntry = channelMap.get('mer');
    const specEntry = channelMap.get('specular');
    const emissiveEntry = channelMap.get('emissive');

    let normalName: string | undefined;
    if (normalEntry) {
      const dest = `${base}_normal.png`;
      rp[dest] = normalEntry.data;
      normalName = stemOf(dest);
      report.normalMaps += 1;
      report.mapsRegistered += 1;
      report.maps.push({ channel: 'normal', sourcePath: normalEntry.sourcePath, bedrockPath: dest, status: 'registered', provenance: 'SOURCE', note: btn('normal map', normalEntry.convention) });
      record(`[PBR][MAP] ${normalEntry.sourcePath} → ${dest} (normal map, verbatim copy).`);
    }

    let heightName: string | undefined;
    if (heightEntry) {
      const dest = `${base}_heightmap.png`;
      rp[dest] = heightEntry.data;
      heightName = stemOf(dest);
      report.heightMaps += 1;
      report.mapsRegistered += 1;
      report.maps.push({ channel: 'height', sourcePath: heightEntry.sourcePath, bedrockPath: dest, status: 'registered', provenance: 'SOURCE', note: btn('height map', heightEntry.convention) });
      record(`[PBR][MAP] ${heightEntry.sourcePath} → ${dest} (height/parallax map, verbatim copy).`);
    }

    let merName: string | undefined;
    let merProvenance: ComponentProvenance = 'ABSENT';
    if (merEntry) {
      const dest = `${base}_mer.png`;
      rp[dest] = merEntry.data;
      merName = stemOf(dest);
      merProvenance = 'SOURCE';
      report.prePackedMerMaps += 1;
      report.mapsRegistered += 1;
      report.maps.push({ channel: 'mer', sourcePath: merEntry.sourcePath, bedrockPath: dest, status: 'registered', provenance: 'SOURCE', note: 'Pre-packed Bedrock MER sheet copied verbatim.' });
      record(`[PBR][MAP] ${merEntry.sourcePath} → ${dest} (pre-packed metalness/emissive/roughness sheet).`);
    } else if (specEntry || emissiveEntry) {
      const synthesis = await synthesizeMerSheet({
        color: asBytes(rp[colorKey]),
        specular: specEntry?.data ?? null,
        emissive: emissiveEntry?.data ?? null,
      });
      if (synthesis) {
        const dest = `${base}_mer.png`;
        rp[dest] = synthesis.bytes;
        merName = stemOf(dest);
        merProvenance = 'ADAPTED';
        report.synthesizedMer += 1;
        if (specEntry) {
          report.specularMaps += 1;
          report.mapsRegistered += 1;
          report.maps.push({ channel: 'specular', sourcePath: specEntry.sourcePath, bedrockPath: dest, status: 'registered', provenance: 'ADAPTED', note: synthesis.roughnessSource });
        }
        if (emissiveEntry) {
          report.emissiveMaps += 1;
          report.mapsRegistered += 1;
          report.maps.push({ channel: 'emissive', sourcePath: emissiveEntry.sourcePath, bedrockPath: dest, status: 'registered', provenance: 'ADAPTED', note: synthesis.emissiveSource });
        }
        record(`[PBR][MER] ${base} → ${dest} rebuilt at ${synthesis.width}x${synthesis.height}. ${synthesis.note}`);
      } else {
        for (const [channel, entry] of [['specular', specEntry], ['emissive', emissiveEntry]] as const) {
          if (!entry) continue;
          report.mapsUnresolved += 1;
          report.maps.push({ channel, sourcePath: entry.sourcePath, status: 'unresolved', provenance: 'ABSENT', note: 'The channel data could not be re-encoded in this browser (unsupported PNG encoding), so no MER sheet was written.' });
        }
        record(`[PBR][UNRESOLVED] ${base}: specular/emissive data could not be re-encoded — the material keeps vanilla lighting instead of a guessed MER sheet.`);
      }
    }

    const setName = stemOf(base);
    const textureSet: Record<string, unknown> = { color: setName };
    if (normalName) textureSet.normal = normalName;
    if (merName) textureSet.metalness_emissive_roughness = merName;
    if (heightName) textureSet.heightmap = heightName;

    // A texture-set document is validated against the TEXTURE schema, not the entity schema:
    // an entity-era value logs "Unsupported version value in format_version field".
    rp[setPath] = JSON.stringify(
      { format_version: TEXTURE_SET_FORMAT_VERSION, 'minecraft:texture_set': textureSet },
      null,
      2,
    );
    report.textureSetsWritten += 1;
    const setProvenance: ComponentProvenance = merProvenance === 'ADAPTED' ? 'ADAPTED' : 'SOURCE';
    report.textureSets.push({
      texturePath: base,
      textureSetPath: setPath,
      color: setName,
      normal: normalName,
      mer: merName,
      heightmap: heightName,
      provenance: setProvenance,
      status: 'registered',
      sources,
      note: [normalName ? 'normal' : null, merName ? 'MER' : null, heightName ? 'heightmap' : null].filter(Boolean).join(' + '),
    });
    record(
      `[PBR][SET] ${setPath} written — color ${setName}${normalName ? `, normal ${normalName}` : ''}${merName ? `, MER ${merName}` : ''}${heightName ? `, heightmap ${heightName}` : ''} (${setProvenance}).`,
    );
  }

  if (report.textureSetsWritten > 0) {
    report.capabilityEnabled = declarePbrCapability(rp, record);
    if (report.capabilityEnabled) {
      record('[PBR][MANIFEST] Resource manifest declares capability "pbr" with min_engine_version 1.21.50 — enable Render Dragon / Deferred Technical Preview in the client to see the materials.');
    }
  }

  report.summary =
    report.textureSetsWritten > 0
      ? `${report.textureSetsWritten} texture set(s) written from ${report.mapsRegistered} source channel map(s); ${report.synthesizedMer} MER sheet(s) re-encoded from Java specular/emissive data; ${report.mapsUnresolved} map(s) unresolved. Structural conversion only — the material has not been viewed in a Deferred-capable client.`
      : `No texture set could be written (${report.mapsUnresolved} map(s) unbound). Nothing was invented to fill the gap.`;
  record(`[PBR] ${report.summary}`);

  return {
    ...report,
    summary: report.summary,
    log: lines.slice(-60),
  };
}

function btn(kind: string, convention: string): string {
  return `${kind} bound verbatim (${convention}).`;
}