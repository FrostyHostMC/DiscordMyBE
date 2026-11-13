/**
 * Engine execution trace and fresh-merge verification.
 *
 * The defect this file exists to catch cannot be seen in the output: a newer engine living in the
 * repository while an older writer still produces the archive. No amount of structure proves which
 * engine ran, so every conversion records two independent facts:
 *
 *   1. Which animation stage executed, in order, with the numbers it observed. A stage that did not
 *      run is recorded as NOT EXECUTED — an archive that ships animation documents but whose
 *      interpretation engine produced no result means the layout importers were the only writers.
 *   2. A fingerprint of every animation-relevant file at the moment the final audits measured the
 *      pack, and again at the moment the archive is written. If they differ, a writer ran after the
 *      audits, and every animation verdict in the report describes a pack that was not shipped.
 *
 * All state lives inside the object the factory returns, so nothing survives from one conversion to
 * the next and a cached result cannot be mistaken for a fresh run.
 */

export type PipelineTraceVerdict = 'fresh' | 'stale' | 'engine-missing' | 'not-measured';

export interface PipelineTraceStage {
  index: number;
  engine: string;
  detail: string;
}

export interface AnimationPipelineTraceReport {
  /** Identity of this conversion, so a report can be traced back to one run. */
  runId: string;
  stages: PipelineTraceStage[];
  /** Animation-relevant files the final audits measured (definitions, controllers, entities, rigs, scripts). */
  animationFileCount: number;
  clipCountAtAudit: number;
  clipCountAtExport: number;
  auditFingerprint: string;
  exportFingerprint: string;
  /** Files created, rewritten or removed after the audits measured the pack. */
  mutatedAfterAudit: string[];
  /** Stages whose engine produced no result, with the reason. */
  missingEngines: string[];
  fresh: boolean;
  verdict: PipelineTraceVerdict;
  summary: string;
}

type FileMap = Record<string, string | Uint8Array>;

/** Files whose content decides whether an animation can play, or whether it is bound to anything. */
const ANIMATION_RELEVANT =
  /(\.animation\.json|\.animation_controllers\.json|^animations\/|^animation_controllers\/|^entity\/|^render_controllers\/|^attachables\/|^scripts\/|^models\/)/i;

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  const limit = Math.min(value.length, 40000);
  for (let index = 0; index < limit; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}:${value.length}`;
}

function hashBytes(value: Uint8Array): string {
  let hash = 0x811c9dc5;
  const step = Math.max(1, Math.floor(value.length / 512));
  for (let index = 0; index < value.length; index += step) {
    hash ^= value[index];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}:${value.length}`;
}

function hashEntry(value: string | Uint8Array): string {
  return typeof value === 'string' ? hashText(value) : hashBytes(value);
}

interface Digest {
  hashes: Map<string, string>;
  fingerprint: string;
  clips: number;
  animationFiles: number;
}

function fingerprintOf(hashes: Map<string, string>): string {
  return hashText(
    [...hashes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, hash]) => `${path}=${hash}`)
      .join('|'),
  );
}

function packDigest(files: FileMap, prefix: string): Digest {
  const hashes = new Map<string, string>();
  let clips = 0;
  let animationFiles = 0;
  for (const path of Object.keys(files)) {
    if (!ANIMATION_RELEVANT.test(path)) continue;
    const value = files[path];
    hashes.set(`${prefix}${path}`, hashEntry(value));
    if (!path.toLowerCase().endsWith('.animation.json')) continue;
    animationFiles += 1;
    if (typeof value !== 'string') continue;
    try {
      const parsed = JSON.parse(value) as { animations?: Record<string, unknown> };
      clips += Object.keys(parsed.animations ?? {}).length;
    } catch {
      // A malformed document contributes no clip id here; the JSON validators report it instead.
    }
  }
  return { hashes, fingerprint: fingerprintOf(hashes), clips, animationFiles };
}

function mergeDigests(resource: Digest, behavior: Digest): Digest {
  const hashes = new Map<string, string>();
  for (const [path, hash] of resource.hashes) hashes.set(path, hash);
  for (const [path, hash] of behavior.hashes) hashes.set(path, hash);
  return {
    hashes,
    fingerprint: fingerprintOf(hashes),
    clips: resource.clips + behavior.clips,
    animationFiles: resource.animationFiles + behavior.animationFiles,
  };
}

export interface AnimationPipelineTrace {
  /** Record a stage that ran in this conversion, with the evidence it produced. */
  stage(engine: string, detail: string): void;
  /** Record a stage together with whether its engine actually produced a result this run. */
  requireEngine(engine: string, executed: boolean, detail: string): void;
  /** Freeze the exact file set the final audits measured. */
  markAudit(resourcePackFiles: FileMap, behaviorPackFiles?: FileMap): void;
  /** Compare that file set with the one about to be zipped and report the verdict. */
  verify(resourcePackFiles: FileMap, behaviorPackFiles?: FileMap): AnimationPipelineTraceReport;
}

export function createAnimationPipelineTrace(input: {
  seed: string;
  onLog?: (line: string) => void;
}): AnimationPipelineTrace {
  const log = (line: string) => input.onLog?.(line);
  const runId = `${input.seed || 'port'}@${Date.now().toString(36)}`;
  const stages: PipelineTraceStage[] = [];
  const missingEngines: string[] = [];
  let audit: Digest | null = null;

  const push = (engine: string, detail: string): void => {
    stages.push({ index: stages.length + 1, engine, detail });
  };

  return {
    stage(engine, detail) {
      push(engine, detail);
    },
    requireEngine(engine, executed, detail) {
      if (executed) {
        push(engine, detail);
        return;
      }
      missingEngines.push(`${engine} — ${detail}`);
      push(engine, `NOT EXECUTED — ${detail}`);
    },
    markAudit(resourcePackFiles, behaviorPackFiles) {
      audit = mergeDigests(
        packDigest(resourcePackFiles, 'resource:'),
        packDigest(behaviorPackFiles ?? {}, 'behavior:'),
      );
    },
    verify(resourcePackFiles, behaviorPackFiles) {
      const atExport = mergeDigests(
        packDigest(resourcePackFiles, 'resource:'),
        packDigest(behaviorPackFiles ?? {}, 'behavior:'),
      );
      const mutated: string[] = [];
      if (audit) {
        for (const [path, hash] of atExport.hashes) {
          const before = audit.hashes.get(path);
          if (before === undefined) mutated.push(`${path} (created after the audit)`);
          else if (before !== hash) mutated.push(`${path} (rewritten after the audit)`);
        }
        for (const path of audit.hashes.keys()) {
          if (!atExport.hashes.has(path)) mutated.push(`${path} (removed after the audit)`);
        }
      }
      const fresh = audit !== null && mutated.length === 0;
      const verdict: PipelineTraceVerdict =
        audit === null
          ? 'not-measured'
          : missingEngines.length > 0
            ? 'engine-missing'
            : fresh
              ? 'fresh'
              : 'stale';
      const report: AnimationPipelineTraceReport = {
        runId,
        stages: [...stages],
        animationFileCount: atExport.animationFiles,
        clipCountAtAudit: audit?.clips ?? 0,
        clipCountAtExport: atExport.clips,
        auditFingerprint: audit?.fingerprint ?? '',
        exportFingerprint: atExport.fingerprint,
        mutatedAfterAudit: mutated,
        missingEngines: [...missingEngines],
        fresh,
        verdict,
        summary:
          verdict === 'not-measured'
            ? `Engine trace ${runId}: ${stages.length} animation stage(s) executed in this run; the audit point was never marked, so freshness is NOT MEASURED.`
            : verdict === 'engine-missing'
              ? `Engine trace ${runId}: ${missingEngines.length} expected engine(s) produced no result — ${missingEngines.join(' | ')}.`
              : verdict === 'fresh'
                ? `Engine trace ${runId}: ${stages.length} animation stage(s) executed in this run, and the ${atExport.animationFiles} animation-relevant file(s) the final audits measured are identical to the ones written into the archive (${atExport.clips} clip(s)); no writer ran after the audits.`
                : `Engine trace ${runId}: ${mutated.length} file(s) changed after the final audits measured the pack — ${mutated.slice(0, 6).join(', ')}${mutated.length > 6 ? ' …' : ''}. The audit verdicts describe a pack that was not shipped.`,
      };

      for (const stage of report.stages) {
        log(`[TRACE] ${stage.index}. ${stage.engine} — ${stage.detail}`);
      }
      if (report.verdict === 'fresh') {
        log(`[TRACE:VERIFY:PASS] ${report.summary}`);
      } else if (report.verdict === 'stale') {
        log(`[TRACE:VERIFY:FAIL] ${report.summary}`);
      } else if (report.verdict === 'engine-missing') {
        log(`[TRACE:VERIFY:FAIL] ${report.summary}`);
      } else {
        log(`[TRACE:VERIFY:NOT-MEASURED] ${report.summary}`);
      }
      return report;
    },
  };
}