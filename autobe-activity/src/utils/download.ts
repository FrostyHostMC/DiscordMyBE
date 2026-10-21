/**
 * Starts a browser download for a generated file.
 *
 * Standard `<a download>` clicks are silently blocked in many environments:
 * sandboxed iframes (Discord Activities, embedded previews), iOS/Android
 * in-app WebViews, and some privacy browsers. To make downloads work
 * everywhere, we use a layered strategy:
 *
 * 1. If the Web Share API supports sharing FILES (iOS Safari, Android
 *    Chrome, Discord/mobile WebViews), open the native share/save sheet.
 *    The user can save directly to Files / Minecraft — the most reliable
 *    path on mobile.
 * 2. If we are inside an embedded iframe (where anchor downloads are
 *    silently dropped), open the blob in a new tab via window.open() —
 *    the browser then downloads the file from the top-level context.
 * 3. Otherwise (normal desktop / standalone mobile browser), fall back to
 *    the classic anchor download.
 * 4. If EVERYTHING is blocked, show a manual save panel overlay with the
 *    file ready as a direct link the user can tap / long-press to save.
 *    This guarantees the user can ALWAYS get the file.
 *
 * Audio feedback (synthesized, no audio files):
 * - Success  -> Minecraft-style wooden block PLACE (hollow thud).
 * - Failure  -> Minecraft-style block BREAK (crunchy, granular).
 */

/** Detects iOS / iPadOS (Safari & Home-screen WebViews). */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
}

/**
 * True when the current click's user activation is still fresh. iOS voids the
 * activation as soon as we `await` anything (zip packaging takes seconds), and
 * an expired activation makes BOTH navigator.share() and <a download> fail
 * SILENTLY — this is the #1 cause of "downloaded" but nothing saved.
 */
function hasFreshUserGesture(): boolean {
  try {
    const ua = navigator as Navigator & { userActivation?: { isActive: boolean } };
    if (ua.userActivation) return ua.userActivation.isActive;
  } catch {
    // Unknown — assume fresh so we still attempt the normal paths.
    return true;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Download Progress Indicator (themed, DOM-rendered, always on top)
 * ------------------------------------------------------------------ */

type DownloadStage = 'preparing' | 'sharing' | 'saving' | 'done' | 'blocked' | 'error';

interface IndicatorRefs {
  root: HTMLDivElement;
  card: HTMLDivElement;
  label: HTMLDivElement;
  file: HTMLDivElement;
  fill: HTMLDivElement;
  hideTimer: number | undefined;
}

let indicator: IndicatorRefs | null = null;

const STAGE_META: Record<DownloadStage, { pct: number; text: string; color: string }> = {
  preparing: { pct: 35, text: 'Packaging your file…', color: 'linear-gradient(90deg,#762BFF,#A855F7)' },
  sharing: { pct: 70, text: 'Open save sheet — choose “Save to Files”…', color: 'linear-gradient(90deg,#762BFF,#A855F7)' },
  saving: { pct: 70, text: 'Saving to your device…', color: 'linear-gradient(90deg,#762BFF,#A855F7)' },
  done: { pct: 100, text: 'Saved! ✓', color: 'linear-gradient(90deg,#22C55E,#4ADE80)' },
  blocked: { pct: 100, text: 'Auto-save blocked — use the save panel ↓', color: 'linear-gradient(90deg,#F59E0B,#FBBF24)' },
  error: { pct: 100, text: 'Save failed — use the save panel ↓', color: 'linear-gradient(90deg,#EF4444,#F87171)' },
};

function ensureIndicator(): IndicatorRefs {
  if (indicator) return indicator;

  const root = document.createElement('div');
  root.id = 'autobe-dl-progress';
  root.style.cssText =
    'position:fixed;left:12px;right:12px;bottom:18px;z-index:2147483646;display:flex;justify-content:center;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;';

  const card = document.createElement('div');
  card.style.cssText =
    'width:100%;max-width:380px;background:#14101F;border:1px solid #762BFF;border-radius:14px;padding:12px 14px;box-shadow:0 0 30px rgba(118,43,255,0.4);color:#F7F5FC;transition:opacity .25s;opacity:0;';

  const label = document.createElement('div');
  label.style.cssText = 'font-size:12px;font-weight:700;margin-bottom:2px;';

  const file = document.createElement('div');
  file.style.cssText =
    'font-size:10px;color:#AAA3BB;margin-bottom:8px;word-break:break-all;font-weight:600;';

  const track = document.createElement('div');
  track.style.cssText = 'width:100%;height:6px;border-radius:999px;background:#2A2440;overflow:hidden;';

  const fill = document.createElement('div');
  fill.style.cssText =
    'height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#762BFF,#A855F7);transition:width .35s ease, background .35s ease;';

  track.appendChild(fill);
  card.appendChild(label);
  card.appendChild(file);
  card.appendChild(track);
  root.appendChild(card);
  document.body.appendChild(root);

  indicator = { root, card, label, file, fill, hideTimer: undefined };
  return indicator;
}

function setDownloadStage(stage: DownloadStage, fileName?: string): void {
  if (typeof document === 'undefined') return;
  const el = ensureIndicator();
  const meta = STAGE_META[stage];
  el.label.textContent = meta.text;
  if (fileName) el.file.textContent = fileName;
  el.fill.style.width = `${meta.pct}%`;
  el.fill.style.background = meta.color;
  el.card.style.borderColor =
    stage === 'done' ? '#22C55E' : stage === 'error' ? '#EF4444' : stage === 'blocked' ? '#F59E0B' : '#762BFF';
  el.card.style.opacity = '1';

  if (el.hideTimer !== undefined) window.clearTimeout(el.hideTimer);
  if (stage === 'done' || stage === 'blocked' || stage === 'error') {
    el.hideTimer = window.setTimeout(() => {
      el.card.style.opacity = '0';
    }, stage === 'done' ? 2600 : 6000);
  }
}

function blobToFile(blob: Blob, fileName: string): File {
  // Preserve the extension so the OS picks the right handler (.mcaddon etc.)
  return new File([blob], fileName, {
    type: blob.type || 'application/octet-stream',
    lastModified: Date.now(),
  });
}

/** Returns true when the environment can share real files (best mobile path). */
function canShareFiles(file: File): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      typeof navigator.share === 'function' &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

/** Detects embedded contexts (Discord Activities, iframes, previews). */
function isEmbeddedFrame(): boolean {
  try {
    if (window.self !== window.top) return true;
  } catch {
    // Cross-origin access throws — that itself proves we are framed.
    return true;
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Discord/i.test(ua);
}

/** Classic anchor download. Returns false if the click could not be made. */
function anchorDownload(blob: Blob, fileName: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.target = '_self';
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Keep the URL alive long enough for slow mobile downloads to complete.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Minecraft-style wooden block PLACE sound (synth — no audio file).
 * A short noise "knock" through a bandpass + a low membrane thud gives the
 * crisp, hollow wood character with quick attack and ~150ms decay.
 */
function playBlockPlace(): void {
  try {
    void import('tone').then((Tone) => {
      const now = Tone.now();

      const knock = new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: 0.06, sustain: 0 },
        volume: -16,
      }).toDestination();
      const knockFilter = new Tone.Filter(900, 'bandpass').toDestination();
      knock.connect(knockFilter);

      const thud = new Tone.MembraneSynth({
        pitchDecay: 0.02,
        octaves: 4,
        envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
        volume: -14,
      }).toDestination();

      knock.triggerAttackRelease('16n', now);
      thud.triggerAttackRelease('A2', '32n', now + 0.005);

      setTimeout(() => {
        void knock.dispose();
        void knockFilter.dispose();
        void thud.dispose();
      }, 1000);
    });
  } catch {
    // Audio is best-effort — never block the download.
  }
}

/**
 * Minecraft-style block BREAK sound (synth — no audio file).
 * A sharp initial impact followed by a granular gravel crumble: two
 * staggered noise bursts with different filter colors and fast decay.
 */
function playBlockBreak(): void {
  try {
    void import('tone').then((Tone) => {
      const now = Tone.now();

      const impact = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.08, sustain: 0 },
        volume: -12,
      }).toDestination();
      const impactFilter = new Tone.Filter(1800, 'bandpass').toDestination();
      impact.connect(impactFilter);

      const crumble = new Tone.NoiseSynth({
        noise: { type: 'brown' },
        envelope: { attack: 0.002, decay: 0.2, sustain: 0 },
        volume: -14,
      }).toDestination();
      const crumbleFilter = new Tone.Filter(600, 'lowpass').toDestination();
      crumble.connect(crumbleFilter);

      impact.triggerAttackRelease('16n', now);
      // Granular texture: a few rapid sub-bursts of the crumble layer.
      crumble.triggerAttackRelease('64n', now + 0.02);
      crumble.triggerAttackRelease('64n', now + 0.08);
      crumble.triggerAttackRelease('32n', now + 0.13);

      setTimeout(() => {
        void impact.dispose();
        void impactFilter.dispose();
        void crumble.dispose();
        void crumbleFilter.dispose();
      }, 1200);
    });
  } catch {
    // Audio is best-effort — never block the download.
  }
}

/**
 * Last-resort manual save panel. Builds a dark themed overlay (matching the
 * AutoBE aesthetic) containing a direct link to the blob. The user can tap
 * it to open/save, or long-press → "Save to Files" / "Share" on mobile.
 * The object URL stays valid for 10 minutes, then is released.
 */
function showManualSavePanel(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined') return;
  // Avoid stacking duplicate panels.
  document.getElementById('autobe-save-panel')?.remove();

  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 600_000);

  const backdrop = document.createElement('div');
  backdrop.id = 'autobe-save-panel';
  backdrop.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:rgba(4,3,10,0.92);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif;';

  const panel = document.createElement('div');
  panel.style.cssText =
    'background:#14101F;border:1px solid #762BFF;border-radius:16px;padding:20px;max-width:380px;width:100%;box-shadow:0 0 40px rgba(118,43,255,0.45);color:#F7F5FC;';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:4px;';
  title.textContent = 'Save your file';

  const subtitle = document.createElement('div');
  subtitle.style.cssText =
    'font-size:12px;color:#AAA3BB;margin-bottom:14px;line-height:1.5;';
  subtitle.textContent =
    'Automatic saving was blocked by this app. Your file is ready below — tap "Save file" to try again, or long-press it and choose "Save" / "Share".';

  const name = document.createElement('div');
  name.style.cssText =
    'font-size:12px;font-weight:600;color:#A855F7;margin-bottom:12px;word-break:break-all;';
  name.textContent = fileName;

  // Copyable link section
  const linkSection = document.createElement('div');
  linkSection.style.cssText = 'margin-bottom:14px;';

  const linkLabel = document.createElement('div');
  linkLabel.style.cssText = 'font-size:11px;color:#AAA3BB;margin-bottom:6px;';
  linkLabel.textContent = 'Or copy this link and open it in your browser:';

  const linkInput = document.createElement('input');
  linkInput.type = 'text';
  linkInput.value = url;
  linkInput.readOnly = true;
  linkInput.style.cssText =
    'width:100%;padding:10px;border-radius:8px;border:1px solid #2A2440;background:#1C1730;color:#F7F5FC;font-size:11px;font-family:monospace;word-break:break-all;margin-bottom:8px;';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.style.cssText =
    'display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:10px;border-radius:8px;border:1px solid #762BFF;background:#1C1730;color:#A855F7;font-size:12px;font-weight:600;cursor:pointer;';
  copyBtn.textContent = '📋 Copy link';
  copyBtn.onclick = () => {
    linkInput.select();
    document.execCommand('copy');
    copyBtn.textContent = '✅ Copied!';
    setTimeout(() => {
      copyBtn.textContent = '📋 Copy link';
    }, 2000);
  };

  linkSection.appendChild(linkLabel);
  linkSection.appendChild(linkInput);
  linkSection.appendChild(copyBtn);

  const primary = document.createElement('a');
  primary.href = url;
  primary.download = fileName;
  primary.rel = 'noopener';
  primary.style.cssText =
    'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;border-radius:12px;border:none;background:linear-gradient(135deg,#762BFF,#A855F7);color:#fff;font-size:14px;font-weight:700;text-decoration:none;cursor:pointer;margin-bottom:10px;';
  primary.textContent = '⬇ Save file';

  const shareBtn = document.createElement('button');
  shareBtn.type = 'button';
  shareBtn.style.cssText =
    'display:block;width:100%;padding:12px;border-radius:10px;border:1px solid #2A2440;background:#1C1730;color:#D9D3E8;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:14px;';
  shareBtn.textContent = '📤 Save via share sheet (best on phone)';
  // A tap on this panel is a FRESH user gesture — retry the strongest save
  // paths here, since the original click's activation may have expired.
  shareBtn.onclick = () => {
    const retryFile = blobToFile(blob, fileName);
    if (canShareFiles(retryFile)) {
      void navigator.share({ files: [retryFile], title: fileName }).then(
        () => {
          shareBtn.textContent = '✅ Saved!';
          playBlockPlace();
        },
        () => {
          if (!anchorDownload(blob, fileName)) {
            shareBtn.textContent = 'Blocked — long-press the Save button instead';
          }
        }
      );
    } else if (!anchorDownload(blob, fileName)) {
      shareBtn.textContent = 'Blocked — long-press the Save button instead';
    }
  };

  const pickerBtn = document.createElement('button');
  pickerBtn.type = 'button';
  pickerBtn.style.cssText =
    'display:block;width:100%;padding:12px;border-radius:10px;border:1px solid #2A2440;background:#1C1730;color:#D9D3E8;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:10px;';
  pickerBtn.textContent = '📁 Choose save location';
  pickerBtn.onclick = async () => {
    const pickerWindow = window as Window & {
      showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{
        createWritable: () => Promise<{
          write: (value: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    };
    if (!pickerWindow.showSaveFilePicker) {
      pickerBtn.textContent = 'Save location picker is unavailable here';
      return;
    }
    try {
      const handle = await pickerWindow.showSaveFilePicker({ suggestedName: fileName });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      pickerBtn.textContent = '✅ Saved to your chosen location';
      playBlockPlace();
      setDownloadStage('done', fileName);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        pickerBtn.textContent = 'Save cancelled — choose a location to try again';
        return;
      }
      pickerBtn.textContent = 'Could not save here — use the save or share buttons above';
      playBlockBreak();
    }
  };

  const tabBtn = document.createElement('button');
  tabBtn.type = 'button';
  tabBtn.style.cssText =
    'display:block;width:100%;padding:12px;border-radius:10px;border:1px solid #2A2440;background:#1C1730;color:#D9D3E8;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:10px;';
  tabBtn.textContent = '↗ Open in new tab (computers & some phones)';
  tabBtn.onclick = () => {
    const tabUrl = URL.createObjectURL(blob);
    const win = window.open(tabUrl, '_blank');
    if (win) {
      setTimeout(() => URL.revokeObjectURL(tabUrl), 120_000);
      tabBtn.textContent = '✅ Opened in a new tab';
      playBlockPlace();
    } else {
      tabBtn.textContent = 'Popup blocked — use “Save file” above';
    }
  };

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.style.cssText =
    'position:absolute;top:12px;right:16px;background:none;border:none;color:#AAA3BB;font-size:22px;cursor:pointer;line-height:1;';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => backdrop.remove();

  backdrop.onclick = (ev) => {
    if (ev.target === backdrop) backdrop.remove();
  };

  const holder = document.createElement('div');
  holder.style.cssText = 'position:relative;';
  holder.appendChild(closeBtn);
  holder.appendChild(title);
  holder.appendChild(subtitle);
  holder.appendChild(name);
  holder.appendChild(linkSection);
  holder.appendChild(primary);
  holder.appendChild(shareBtn);
  holder.appendChild(pickerBtn);
  holder.appendChild(tabBtn);
  panel.appendChild(holder);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
}

/** Creates a long-lived object URL for callers that want a manual link UI. */
export function createPersistentDownload(
  blob: Blob,
  fileName: string
): { url: string; fileName: string } {
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 600_000);
  return { url, fileName };
}

/** Export manual save panel for direct use in Discord Activities. */
export { showManualSavePanel };

export async function downloadBlob(blob: Blob, fileName: string): Promise<void> {
  const file = blobToFile(blob, fileName);

  setDownloadStage('preparing', fileName);

  // If the tap's activation already expired (we awaited zip packaging first),
  // iOS/Discord silently swallow EVERY automatic save attempt. Don't pretend
  // it worked — go straight to the manual save panel, whose buttons are a
  // FRESH user gesture and therefore actually permitted.
  if (!hasFreshUserGesture()) {
    playBlockBreak();
    showManualSavePanel(blob, fileName);
    setDownloadStage('blocked', fileName);
    // Resolve instead of throwing — the manual panel IS the fix here, and a
    // thrown error becomes an unhandled promise rejection for `void` callers.
    return;
  }

  // Strategy 1: native share/save sheet — works in WebViews where anchor
  // downloads are blocked. Must be called within the user gesture, which
  // all callers already are (button click handlers).
  if (canShareFiles(file)) {
    setDownloadStage('sharing', fileName);
    try {
      await navigator.share({ files: [file], title: fileName });
      playBlockPlace();
      setDownloadStage('done', fileName);
      return;
    } catch (e) {
      // User cancelled the sheet — that's not a failure; do not fall through
      // with a second download prompt.
      if (e instanceof Error && e.name === 'AbortError') {
        setDownloadStage('done', fileName);
        return;
      }
      // Permission denied (activation lost / host blocked) → manual panel.
      playBlockBreak();
      showManualSavePanel(blob, fileName);
      setDownloadStage('blocked', fileName);
      // Resolve: the manual panel is the fix, and throwing would surface as
      // an unhandled promise rejection for callers that use `void`.
      return;
    }
  }

  // Strategy 2: embedded frames (Discord Activities, previews). Try a direct
  // anchor download FIRST — it works whenever the host frame grants the
  // allow-downloads permission, and it keeps the user in-context. Opening a
  // new tab is only a backup, because many hosts (Discord) block popups.
  if (isEmbeddedFrame()) {
    if (anchorDownload(blob, fileName)) {
      playBlockPlace();
      return;
    }
    const url = URL.createObjectURL(blob);
    let opened: Window | null;
    try {
      opened = window.open(url, '_blank');
    } catch {
      opened = null;
    }
    if (opened) {
      // Give the new tab time to begin loading before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
      playBlockPlace();
      return;
    }
    URL.revokeObjectURL(url);
    // Everything blocked — show the manual save panel so the user always
    // has a way to get the file, then report the block.
    playBlockBreak();
    showManualSavePanel(blob, fileName);
    setDownloadStage('blocked', fileName);
    return;
  }

  // Strategy 3: classic anchor download (desktop + standalone mobile browsers).
  if (anchorDownload(blob, fileName)) {
    playBlockPlace();
    // Anchors report "clicked", not "saved" — on iOS a silent block is common.
    // Keep the manual panel one tap away instead of lying about success.
    if (isIOS()) {
      showManualSavePanel(blob, fileName);
      setDownloadStage('saving', fileName);
      return;
    }
    setDownloadStage('done', fileName);
    return;
  }

  playBlockBreak();
  showManualSavePanel(blob, fileName);
  setDownloadStage('blocked', fileName);
  return;
}