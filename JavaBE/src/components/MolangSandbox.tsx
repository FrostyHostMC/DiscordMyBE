import { useState, type PointerEvent } from 'react';
import { vibrate } from '@aippy/runtime/device';
import { AlertTriangle, Braces, CheckCircle2, Play, X } from 'lucide-react';
import { useRemakerAudio } from '@/hooks/useRemakerAudio';
import { evaluateMolangExpression, type MockEntityState } from '@/utils/molangExpressionSandbox';

interface Props {
  initialExpression: string;
  onClose: () => void;
}

type Result = { value: number; passed: boolean } | { error: string };

const PRESETS = [
  { label: 'Health ratio', value: 'math.clamp(query.health / 20, 0, 1)' },
  { label: 'Moving check', value: 'query.velocity > 0.5' },
  { label: 'Time pulse', value: 'math.sin(query.time * 30)' },
  { label: 'Low-health branch', value: 'query.health < 8 ? 1 : 0' },
];

const STATE_CONTROLS: Array<{ key: keyof MockEntityState; label: string; max: number; step: number }> = [
  { key: 'health', label: 'Health', max: 20, step: 0.5 },
  { key: 'velocity', label: 'Velocity', max: 10, step: 0.1 },
  { key: 'time', label: 'Time', max: 120, step: 0.1 },
];

export function MolangSandbox({ initialExpression, onClose }: Props) {
  const [expression, setExpression] = useState(initialExpression);
  const [state, setState] = useState<MockEntityState>({ health: 15, velocity: 1.2, time: 2 });
  const [minimum, setMinimum] = useState('0');
  const [maximum, setMaximum] = useState('1');
  const [result, setResult] = useState<Result | null>(null);
  const { playSuccess, playWarning } = useRemakerAudio();

  const updateState = (key: keyof MockEntityState, value: number) => {
    setState((current) => ({ ...current, [key]: value }));
    setResult(null);
  };

  const handleRun = () => {
    const min = Number(minimum);
    const max = Number(maximum);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      setResult({ error: 'Set a valid output range with minimum no greater than maximum.' });
      void playWarning().catch(() => undefined);
      return;
    }
    try {
      const value = evaluateMolangExpression(expression, state);
      const passed = value >= min && value <= max;
      setResult({ value, passed });
      if (passed) {
        void playSuccess().catch(() => undefined);
        void vibrate(120).catch(() => undefined);
      } else {
        void playWarning().catch(() => undefined);
      }
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : 'This expression could not be evaluated.' });
      void playWarning().catch(() => undefined);
    }
  };

  const closeOnBackdrop = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/90 p-2 sm:items-center sm:p-5"
      onPointerDown={closeOnBackdrop}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="molang-sandbox-title"
        className="max-h-[94dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-sky-800/60 bg-slate-900 text-slate-100 shadow-2xl shadow-black/50"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-700/50 bg-sky-950/50 text-sky-300">
              <Braces className="h-4 w-4" />
            </span>
            <div>
              <h2 id="molang-sandbox-title" className="text-sm font-bold">Molang Sandbox</h2>
              <p className="text-[10px] text-slate-400">Evaluate against a mock entity state</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close sandbox" className="flex min-h-[60px] min-w-[60px] items-center justify-center rounded-xl text-slate-400 active:bg-slate-800 active:text-white">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label htmlFor="molang-expression" className="text-xs font-semibold text-slate-200">Expression</label>
            <select
              aria-label="Load example expression"
              value={PRESETS.some((preset) => preset.value === expression) ? expression : ''}
              onChange={(event) => { setExpression(event.target.value); setResult(null); }}
              className="min-h-[60px] rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-300"
            >
              <option value="">Load an example…</option>
              {PRESETS.map((preset) => <option key={preset.label} value={preset.value}>{preset.label}</option>)}
            </select>
          </div>
          <textarea
            id="molang-expression"
            value={expression}
            onChange={(event) => { setExpression(event.target.value); setResult(null); }}
            spellCheck={false}
            aria-describedby="molang-supported-values"
            className="min-h-[88px] w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-sm leading-relaxed text-cyan-100 outline-none focus:border-sky-500"
          />
          <p id="molang-supported-values" className="-mt-2 text-[10px] leading-relaxed text-slate-500">
            Mock values: query.health, query.velocity, query.time · Math: sin, cos, abs, sqrt, clamp, min, max, pow
          </p>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200">Mock entity state</h3>
              <span className="text-[10px] text-slate-500">Adjust values before each run</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {STATE_CONTROLS.map((control) => (
                <label key={control.key} className="flex flex-col gap-1.5">
                  <span className="flex items-center justify-between text-[11px] text-slate-300">
                    {control.label}<span className="font-mono text-sky-300">{state[control.key]}</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max={control.max}
                    step={control.step}
                    value={state[control.key]}
                    aria-label={`${control.label} mock value`}
                    onChange={(event) => updateState(control.key, Number(event.target.value))}
                    className="min-h-[60px] w-full accent-sky-400"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <label className="flex flex-col gap-1.5 text-[11px] text-slate-300">
              Expected minimum
              <input type="number" value={minimum} onChange={(event) => { setMinimum(event.target.value); setResult(null); }} className="min-h-[60px] rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white" />
            </label>
            <label className="flex flex-col gap-1.5 text-[11px] text-slate-300">
              Expected maximum
              <input type="number" value={maximum} onChange={(event) => { setMaximum(event.target.value); setResult(null); }} className="min-h-[60px] rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white" />
            </label>
          </div>

          <div aria-live="polite" className={`min-h-[72px] rounded-xl border p-3 ${result && 'passed' in result && result.passed ? 'border-emerald-700/60 bg-emerald-950/40' : result ? 'border-rose-800/60 bg-rose-950/30' : 'border-slate-800 bg-slate-950/70'}`}>
            {!result ? (
              <p className="text-xs leading-relaxed text-slate-400">Run the expression to see its value and range check.</p>
            ) : 'error' in result ? (
              <p className="flex items-start gap-2 text-xs leading-relaxed text-rose-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{result.error}</p>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-slate-400">Output</span>
                  <span className="font-mono text-2xl font-bold text-white">{Number(result.value.toFixed(5))}</span>
                </div>
                <span className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${result.passed ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`}>
                  {result.passed ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  {result.passed ? 'IN RANGE' : 'OUT OF RANGE'}
                </span>
              </div>
            )}
          </div>

          <button type="button" onClick={handleRun} className="flex min-h-[60px] w-full items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 text-sm font-extrabold text-slate-950 active:scale-[0.99]">
            <Play className="h-4 w-4 fill-current" /> Run range check
          </button>
        </div>
      </section>
    </div>
  );
}