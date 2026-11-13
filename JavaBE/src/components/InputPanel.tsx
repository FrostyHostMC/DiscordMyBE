import assetsData from "@/config/assets";
import { useRef, useState } from 'react';
import { FileArchive, Link2, Sparkles, X, FileCheck, CheckCircle2, Scaling, ToggleLeft, ToggleRight, Terminal } from 'lucide-react';
import type { ExtractedZipEntry } from '@/utils/zip';
import { readZipArchive } from '@/utils/zip';
import { isPlayableModeEnabled, setPlayableMode } from '@/utils/provenance';
import { learnFromContentLog, getLearnedDenyQueries } from '@/utils/bedrockPostProcess';
import { expandNestedArchives } from '@/utils/nestedArchives';
import {
  formatArchiveBytes,
  getArchiveBudget,
  prioritizeArchiveEntries,
} from '@/utils/archiveScale';

interface Props {
  value: string;
  file: File | null;
  entries: ExtractedZipEntry[];
  upscalingEnabled: boolean;
  onChange: (value: string) => void;
  onFileLoaded: (file: File | null, entries: ExtractedZipEntry[]) => void;
  onGenerate: () => void;
  onUpscalingChange: (enabled: boolean) => void;
  generating: boolean;
  accent: string;
}
const UPLOAD_ICON_URL = assetsData.IMAGE_OVJL;

export function InputPanel({ value, file, entries, upscalingEnabled, onChange, onFileLoaded, onGenerate, onUpscalingChange, generating, accent }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [unzipping, setUnzipping] = useState(false);
  const [unzipError, setUnzipError] = useState<string | null>(null);
  const [nestedNote, setNestedNote] = useState<string | null>(null);
  const [playableMode, setPlayableModeState] = useState(isPlayableModeEnabled);
  const [logText, setLogText] = useState('');
  const [learnedNote, setLearnedNote] = useState<string | null>(null);
  const [learnedQueryCount, setLearnedQueryCount] = useState(getLearnedDenyQueries().length);
  const canGenerate = value.trim().length > 0 || file !== null;

  const processFile = async (selectedFile: File) => {
    setUnzipError(null); setNestedNote(null); setUnzipping(true);
    try {
      const oversized: string[] = [];
      let skippedBytes = 0;
      const budget = getArchiveBudget();
      const extracted = await readZipArchive(await selectedFile.arrayBuffer(), {
        maxEntries: budget.maxEntries,
        maxEntryBytes: budget.maxEntryBytes,
        maxTotalBytes: budget.maxTotalBytes,
        onSkip: (path, bytes, reason) => {
          skippedBytes += bytes;
          if (reason === 'entry-too-large' && oversized.length < 5) oversized.push(path);
        },
      });
      // A mod archive is not always flat: modpacks and bundled distributions keep the real mod
      // one level down. Nested jars/zips are expanded so their clips, models and skins are found.
      const nested = await expandNestedArchives(extracted);
      // A modpack-sized archive is trimmed to the mobile budget before it is scanned: audio and
      // oversized binaries are left unread instead of inflating hundreds of megabytes at once.
      const budgeted = prioritizeArchiveEntries(nested.entries, { maxEntries: budget.maxEntries, maxTotalBytes: budget.maxTotalBytes });
      const notes: string[] = [];
      if (nested.expanded.length > 0) notes.push(`Expanded ${nested.expanded.length} nested archive(s) so their content is analysed.`);
      if (skippedBytes > 0) {
        notes.push(`This archive is very large, so ${formatArchiveBytes(skippedBytes)} of low-priority or oversized files were not read${oversized.length > 0 ? ` (for example ${oversized[0].split('/').pop()})` : ''}.`);
      }
      if (budgeted.report.limited) notes.push(budgeted.report.summary.replace('[MEMORY] ', ''));
      if (selectedFile.size > 300 * 1024 * 1024) {
        notes.push(`Large archive detected (${formatArchiveBytes(selectedFile.size)}). JavaBE is using its ${budget.profile} processing profile with up to ${formatArchiveBytes(budget.maxTotalBytes)} of expanded source data. Any skipped content is listed above rather than silently treated as converted.`);
      }
      if (notes.length > 0) setNestedNote(notes.join(' '));
      onFileLoaded(selectedFile, budgeted.entries);
    } catch {
      onFileLoaded(selectedFile, []);
      setUnzipError('Could not unpack this archive. A description can still be used for a draft.');
    } finally { setUnzipping(false); }
  };
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault(); setIsDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) void processFile(dropped);
  };
  const learnFromLog = () => {
    if (!logText.trim()) return;
    const result = learnFromContentLog(logText);
    const parts: string[] = [];
    if (result.queries.length > 0) parts.push(`${result.queries.length} query rule(s)`);
    if (result.modules.length > 0) parts.push(`${result.modules.length} module version rule(s)`);
    setLearnedNote(parts.length > 0 ? `Saved ${parts.join(' and ')} for later conversions.` : 'No new repair rules were identified.');
    setLearnedQueryCount(getLearnedDenyQueries().length);
  };

  return <section className="flex flex-col gap-4">
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Java mod archive</p>
      <input ref={fileInput} type="file" accept=".jar,.zip" onChange={event => { const selected = event.target.files?.[0]; if (selected) void processFile(selected); }} className="sr-only" aria-label="Choose Java mod archive" />
      <div onDragOver={event => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop} onClick={() => !file && fileInput.current?.click()}
        className={`flex min-h-[112px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-4 text-center transition active:bg-slate-800/70 ${isDragging ? 'border-violet-300 bg-violet-950/30' : file ? 'border-emerald-500/50 bg-emerald-950/20' : 'border-slate-700 bg-slate-950/60'}`}>
        {file ? <div className="flex w-full items-center justify-between gap-3 text-left">
          <div className="flex min-w-0 items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"><FileCheck className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{file.name}</p><p className="text-xs text-slate-400">{(file.size / (1024 * 1024)).toFixed(2)} MB · {entries.length} entries scanned</p></div>
          </div>
          <button type="button" onClick={event => { event.stopPropagation(); onFileLoaded(null, []); if (fileInput.current) fileInput.current.value = ''; }} className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl text-slate-400 active:bg-slate-800" aria-label="Remove selected archive"><X className="h-4 w-4" /></button>
        </div> : unzipping ? <div className="flex items-center gap-2 text-sm text-violet-200"><FileArchive className="h-5 w-5 animate-pulse" />Reading archive contents…</div> : <div className="flex flex-col items-center gap-2 text-slate-300">
          <img src={UPLOAD_ICON_URL} alt="" className="h-9 w-9 object-contain" /><p className="text-sm font-semibold">Choose or drop a .jar / .zip file</p>
          <p className="text-xs text-slate-500">JavaBE inspects the archive and prepares supported conversions automatically.</p>
        </div>}
      </div>
      {unzipError && <p className="mt-2 text-xs text-amber-300">{unzipError}</p>}
      {nestedNote && <p className="mt-2 text-xs text-slate-400">{nestedNote}</p>}
    </div>

    <div>
      <label htmlFor="mod-source" className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-300"><Link2 className="h-4 w-4" style={{ color: accent }} />Additional notes <span className="font-normal text-slate-500">(optional)</span></label>
      <textarea id="mod-source" value={value} onChange={event => onChange(event.target.value)} placeholder="Add context only if needed. JavaBE will use the archive as its primary source." rows={3} maxLength={15000} className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-400" />
    </div>

    {entries.length > 0 && <div className="flex items-center gap-2 rounded-xl bg-emerald-950/30 px-3 py-3 text-xs text-emerald-200"><CheckCircle2 className="h-4 w-4 shrink-0" /><span>Archive scanned. JavaBE starts the conversion automatically.</span></div>}
    <button type="button" onClick={onGenerate} disabled={!canGenerate || generating || unzipping} className="flex min-h-[62px] w-full items-center justify-center gap-2.5 rounded-xl px-5 text-sm font-bold text-slate-950 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40" style={{ background: accent }}>
      <Sparkles className="h-5 w-5" />{generating ? 'Analyzing and preparing your add-on…' : file && entries.length > 0 ? 'Rebuild add-on' : 'Build add-on from notes'}
    </button>

    <details className="rounded-xl border border-slate-800 bg-slate-950/40">
      <summary className="flex min-h-[56px] cursor-pointer items-center gap-2 px-3 text-xs font-semibold text-slate-300"><Scaling className="h-4 w-4 text-violet-300" />Optional conversion settings</summary>
      <div className="space-y-3 border-t border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs font-semibold text-slate-100">Upscale legacy textures</p><p className="text-[10px] text-slate-400">Off preserves the original resolution.</p></div>
          <button type="button" onClick={() => onUpscalingChange(!upscalingEnabled)} aria-pressed={upscalingEnabled} className={`flex min-h-[56px] items-center gap-1.5 rounded-lg border px-3 text-xs font-bold active:scale-[0.97] ${upscalingEnabled ? 'border-violet-400/40 bg-violet-950/40 text-violet-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>{upscalingEnabled ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}{upscalingEnabled ? 'ON' : 'OFF'}</button>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 p-3">
          <div><p className="text-xs font-semibold text-slate-100">Playable mode</p><p className="mt-1 text-[10px] leading-snug text-slate-400">When enabled, optional invented gameplay content may be added and will not count toward source parity.</p></div>
          <button type="button" onClick={() => { const next = !playableMode; setPlayableModeState(next); setPlayableMode(next); }} aria-pressed={playableMode} className={`flex min-h-[56px] items-center gap-1.5 rounded-lg border px-3 text-xs font-bold active:scale-[0.97] ${playableMode ? 'border-amber-500/40 bg-amber-950/40 text-amber-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>{playableMode ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}{playableMode ? 'ON' : 'OFF'}</button>
        </div>
        <div className="rounded-lg border border-slate-800 p-3">
          <div className="mb-2 flex items-center gap-2"><Terminal className="h-4 w-4 text-violet-300" /><p className="text-xs font-semibold text-slate-100">Minecraft content log feedback</p>{learnedQueryCount > 0 && <span className="rounded-full bg-violet-400/10 px-2 py-1 text-[10px] text-violet-200">{learnedQueryCount} saved rules</span>}</div>
          <p className="mb-2 text-[10px] leading-snug text-slate-400">Paste errors from a test import to save supported repair rules for later conversions.</p>
          <textarea value={logText} onChange={event => setLogText(event.target.value)} placeholder="Paste content log lines here…" rows={3} maxLength={60000} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-400" />
          <div className="mt-2 flex flex-wrap items-center gap-3"><button type="button" onClick={learnFromLog} disabled={!logText.trim()} className="min-h-[48px] rounded-lg bg-violet-400/20 px-4 text-xs font-bold text-violet-100 active:bg-violet-400/30 disabled:opacity-40">Save repair rules</button>{learnedNote && <p className="text-[10px] text-violet-200">{learnedNote}</p>}</div>
        </div>
      </div>
    </details>
  </section>;
}