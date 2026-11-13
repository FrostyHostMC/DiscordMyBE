import { useState } from 'react';
import { generateText, streamText } from 'ai';
import { aippyAIProvider, normalizeError } from '@aippy/runtime/ai';
import aiConfigJson from '@/config/aiConfig.json';
import type { DecompileStats, RemakeItem } from '@/types/remaker';
import { BrainCircuit, Cog, FileCheck2, Loader2, TriangleAlert } from 'lucide-react';

interface Props {
  accent: string;
  modContext: string | null;
  onPortPlan: (brief: string, stats: DecompileStats) => void;
}

const SYSTEM_PROMPT = [
  'You are the AI-Assisted Porting Engine of a Java-to-Bedrock mod porting tool.',
  'The user gives you a mod description (or pastes mod details). Your ONLY job is to output a complete,',
  'concrete Bedrock addon specification so the deterministic compiler can build a real downloadable addon.',
  'Output ONLY a single JSON object, no markdown fences, no commentary, with exactly this shape:',
  '{"modName": "short addon name", "description": "one-sentence addon description",',
  ' "items": [{"name": "Item Name", "category": "weapon|tool|armor|storage|food|block|spawn_egg|machine|fluid|item"}],',
  ' "mechanics": ["Mechanic Name: short one-line summary"]}',
  'Rules: derive 4-20 items from the mod description with descriptive names (tier materials, machines, fluids,',
  'mobs, foods, tools etc.). Derive 3-10 mechanics matching the described gameplay. Use exact item names',
  'players would recognize. Never refuse, never explain limitations, never draft text or code — just output the JSON.',
].join(' ');

function useAiConfig() {
  const model = (aiConfigJson.model?.value as string) || 'gpt-5-nano';
  const temperature = (aiConfigJson.temperature?.value as number) ?? 0.4;
  const maxTokens = (aiConfigJson.maxTokens?.value as number) ?? 2000;
  return { model, temperature, maxTokens };
}

interface AiPlan {
  modName: string;
  description: string;
  items: { name: string; category?: RemakeItem['category'] }[];
  mechanics: string[];
}

function parsePlan(raw: string): AiPlan | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Partial<AiPlan>;
    if (!obj.modName || !Array.isArray(obj.items) || obj.items.length === 0) return null;
    return {
      modName: String(obj.modName).slice(0, 60),
      description: String(obj.description ?? '').slice(0, 200),
      items: obj.items
        .filter((it) => it && typeof it.name === 'string')
        .slice(0, 24)
        .map((it) => ({ name: it.name.trim().slice(0, 48), category: it.category })),
      mechanics: Array.isArray(obj.mechanics) ? obj.mechanics.map(String).slice(0, 10) : [],
    };
  } catch {
    return null;
  }
}

function buildStats(plan: AiPlan): DecompileStats {
  return {
    modId: plan.modName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) || 'ai_port',
    modName: plan.modName,
    version: '1.0.0',
    filesCount: plan.items.length,
    classesCount: 0,
    texturesCount: 0,
    modelsCount: 0,
    foundIcon: false,
    classes: [],
    registeredItems: plan.items.map((it) => it.name),
    mechanics: plan.mechanics,
    dependencies: [],
    metadataFormat: 'AI-Assisted Specification',
  };
}

function buildBrief(plan: AiPlan): string {
  const itemLines = plan.items.map((it) => `- ${it.name}${it.category ? ` (${it.category})` : ''}`).join('\n');
  const mechLines = plan.mechanics.map((m) => `- ${m}`).join('\n');
  return [plan.modName, plan.description, itemLines && `Items:\n${itemLines}`, mechLines && `Mechanics:\n${mechLines}`]
    .filter(Boolean)
    .join('\n');
}

export function AiAssistPanel({ accent, modContext, onPortPlan }: Props) {
  const { model, temperature, maxTokens } = useAiConfig();
  const [input, setInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<AiPlan | null>(null);

  const requestPlan = async (description: string): Promise<string> => {
    const provider = aippyAIProvider();
    const context = modContext ? `\n\nMod currently loaded in the engine: ${modContext}` : '';
    // Streamed requests are far more reliable through the Aippy bridge than
    // single-shot generateText (which can surface as "failed with status undefined"
    // when the bridge buffers the full response).
    const result = streamText({
      model: provider(model),
      system: SYSTEM_PROMPT,
      prompt: `Mod description to port into a real Bedrock addon:\n\n${description}${context}`,
      temperature,
      maxOutputTokens: maxTokens,
      abortSignal: AbortSignal.timeout(90_000),
    });
    return await result.text;
  };

  const runAnalysis = async () => {
    const description = input.trim();
    if (!description || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setPlan(null);
    try {
      // Retry with backoff: brief bridge dropouts recover automatically.
      let raw = '';
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 1200 * attempt));
        }
        try {
          raw = await requestPlan(description);
          if (raw.trim().length > 0) {
            lastError = null;
            break;
          }
          lastError = new Error('The AI engine returned an empty response.');
        } catch (attemptError) {
          lastError = attemptError;
        }
      }
      if (lastError !== null) {
        throw lastError;
      }
      const parsed = parsePlan(raw);
      if (!parsed) {
        setError('The AI response could not be structured into a port plan. Try rephrasing the description.');
      } else {
        setPlan(parsed);
      }
    } catch (aiError) {
      console.warn('[Aippy] AI port analysis failed:', aiError);
      const normalized = normalizeError(aiError);
      const rawMessage = normalized.message || '';
      const isBridgeError = /status undefined|failed with status|undefined status/i.test(rawMessage);
      setError(
        isBridgeError
          ? 'The AI service bridge was temporarily unavailable. Please tap Analyze again — if it keeps failing, check your connection and retry in a moment.'
          : `${rawMessage || 'The AI engine could not complete the analysis.'} (Attempted 4 times.) Check your connection and retry.`,
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const compile = () => {
    if (!plan) return;
    onPortPlan(buildBrief(plan), buildStats(plan));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-xl border border-purple-500/30 bg-purple-950/20 p-3">
        <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-purple-300" />
        <p className="text-[11px] leading-relaxed text-slate-300">
          <span className="font-semibold text-purple-200">AI-Assisted Porting</span> — describe a mod (or upload one first
          and let the AI study it). The AI builds a complete port specification, then the deterministic engine compiles it
          into a real, downloadable .mcaddon — no manual work needed.
        </p>
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste the full mod description here — items, mechanics, machines, fluids, mobs, progression. The AI turns it into a real Bedrock addon spec and compiles it automatically."
        rows={5}
        disabled={analyzing}
        className="min-h-[110px] flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-purple-500 focus:outline-none disabled:opacity-60"
      />

      {!analyzing && (
        <button
          type="button"
          onClick={() => void runAnalysis()}
          disabled={!input.trim()}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-purple-500 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-purple-500/20 transition active:scale-[0.99] disabled:opacity-40"
        >
          <BrainCircuit className="h-5 w-5" />
          <span>Analyze & Build Port Plan</span>
        </button>
      )}
      {analyzing && (
        <div className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-purple-500/40 bg-purple-950/30 px-4 text-sm font-semibold text-purple-200">
          <Loader2 className="h-4 w-4 animate-spin" />
          AI is analyzing the mod and drafting the port specification…
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {plan && !analyzing && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-200">
            <FileCheck2 className="h-4 w-4" />
            Port plan ready: {plan.modName}
          </div>
          <p className="text-[11px] leading-relaxed text-slate-300">
            {plan.items.length} items · {plan.mechanics.length} mechanics detected for full Bedrock compilation.
          </p>
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-[11px] text-slate-400">
            {plan.items.map((it) => (
              <li key={it.name} className="truncate">
                • {it.name}
                {it.category ? <span className="text-slate-600"> · {it.category}</span> : null}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={compile}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition active:scale-[0.99]"
          >
            <Cog className="h-5 w-5" />
            <span>Compile .mcaddon Now</span>
          </button>
        </div>
      )}
    </div>
  );
}