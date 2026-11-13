import type { PipelineStageResult, StageStatus } from '@/types/remaker';

/**
 * Bounded pipeline stage tracking.
 *
 * Every conversion stage is recorded with an explicit outcome. A failed stage never
 * degrades into a silent zero: the stage is reported as STAGE FAILED and every count
 * that depended on it is marked FAILED instead.
 */

export interface StageOutcome<T> {
  ok: boolean;
  value?: T;
  detail: string;
}

export interface StageTracker {
  run<T>(id: string, label: string, work: () => Promise<T> | T): Promise<StageOutcome<T>>;
  ok(id: string, label: string, detail: string): void;
  skip(id: string, label: string, detail: string): void;
  fail(id: string, label: string, detail: string): void;
  hasFailure(): boolean;
  failedLabels(): string[];
  results(): PipelineStageResult[];
  violationLine(): string;
}

export function createStageTracker(onLog?: (line: string) => void): StageTracker {
  const stages: PipelineStageResult[] = [];

  const push = (id: string, label: string, status: StageStatus, detail: string) => {
    stages.push({ id, label, status, detail });
    const statusText = status === 'ok' ? 'OK' : status === 'failed' ? 'STAGE FAILED' : 'SKIPPED';
    onLog?.(`[STAGE] ${label} -> ${statusText}${detail ? ` (${detail})` : ''}`);
  };

  return {
    async run<T>(id: string, label: string, work: () => Promise<T> | T): Promise<StageOutcome<T>> {
      try {
        const value = await work();
        push(id, label, 'ok', '');
        return { ok: true, value, detail: '' };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        push(id, label, 'failed', detail);
        return { ok: false, detail };
      }
    },
    ok(id, label, detail) {
      push(id, label, 'ok', detail);
    },
    skip(id, label, detail) {
      push(id, label, 'skipped', detail);
    },
    fail(id, label, detail) {
      push(id, label, 'failed', detail);
    },
    hasFailure() {
      return stages.some((stage) => stage.status === 'failed');
    },
    failedLabels() {
      return stages.filter((stage) => stage.status === 'failed').map((stage) => stage.label);
    },
    results() {
      return stages;
    },
    violationLine() {
      const failed = stages.filter((stage) => stage.status === 'failed');
      if (failed.length === 0) return '';
      return `STAGE FAILED: ${failed.map((stage) => stage.label).join(', ')} — dependent counts are reported as FAILED, never as zero or passed.`;
    },
  };
}