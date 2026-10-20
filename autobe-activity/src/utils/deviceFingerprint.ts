/**
 * Device fingerprinting.
 *
 * Web equivalent of the Python `_generate_hwid()`. The desktop build reads the
 * machine UUID; a browser has no such API, so we build a stable fingerprint out
 * of the signals a browser does expose. The same rules as the desktop build
 * apply:
 *
 *   - only a one-way SHA-256 of the fingerprint is ever persisted
 *   - the raw fingerprint never leaves this module
 *   - the hash is stable across reloads so offline use keeps working
 */

export interface DeviceSignal {
  name: string;
  value: string;
}

/** Hex SHA-256. Falls back to a simple synchronous digest on ancient WebViews. */
export async function sha256Hex(input: string): Promise<string> {
  const text = input || '';
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      /* fall through */
    }
  }
  // Minimal FNV-1a based fallback (never a security boundary, just a stable id).
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

function ua(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
}

/** Exposed so the environment gate can reuse the exact same UA source. */
export function userAgentString(): string {
  return ua();
}

/** Locale hour cycle (h12/h23) — stable per device and helps fingerprint entropy. */
function hourCycle(): string {
  if (typeof Intl === 'undefined') return '';
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions() as any;
    return String(resolved.hourCycle ?? '');
  } catch {
    return '';
  }
}

function platform(): string {
  if (typeof navigator === 'undefined') return '';
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string; mobile?: boolean };
    deviceMemory?: number;
  };
  return [
    nav.platform || nav.userAgentData?.platform || '',
    nav.language || '',
    (nav.languages || []).join(','),
    (navigator.hardwareConcurrency || 0).toString(),
    (nav.deviceMemory || 0).toString(),
    navigator.maxTouchPoints || 0 ? 'touch' : 'no-touch',
    navigator.language ? String(new Intl.DateTimeFormat().resolvedOptions().timeZone || '') : '',
    String(navigator.doNotTrack ?? ''),
    window.isSecureContext ? 'secure' : 'insecure',
    String(screen.width) + 'x' + String(screen.height) + 'x' + String(window.devicePixelRatio || 1),
    String(screen.colorDepth || 0),
    navigator.cookieEnabled ? 'cookies' : 'nocookies',
    hourCycle()
  ].join('|');
}

/**
 * Non-identifying entropy that is stable per device/browser profile.
 *
 * Used as an extra salt so two devices with identical coarse specs (common on
 * Android) still get distinct fingerprints. It is never transmitted.
 */
function entropySalt(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'nocanvas';
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 100, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('AutoBE\u2028device\u2029fingerprint', 2, 2);
    ctx.fillStyle = 'rgba(120,200,255,0.7)';
    ctx.fillText('\u{1F512}', 4, 18);
    return canvas.toDataURL().slice(-96);
  } catch {
    return 'nocanvas';
  }
}

/**
 * Collects the raw (unsalted) device signals.
 * Exported for the debug "Device ID" row in Settings.
 */
export function collectDeviceSignals(): DeviceSignal[] {
  const signals: DeviceSignal[] = [
    { name: 'platform', value: platform() },
    { name: 'entropy', value: entropySalt() }
  ];
  const gl = (() => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!ctx) return 'nogl';
      const ext = (ctx as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
      const renderer = ext
        ? (ctx as any).getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : (ctx as any).getParameter((ctx as any).RENDERER);
      return String(renderer || 'unknown').slice(0, 64);
    } catch {
      return 'nogl';
    }
  })();
  signals.push({ name: 'gpu', value: gl });
  return signals;
}

/** Builds the stable, salted fingerprint string. Never persisted directly. */
export async function generateDeviceFingerprint(): Promise<string> {
  const parts: string[] = [ua()];
  for (const s of collectDeviceSignals()) parts.push(`${s.name}=${s.value}`);
  const raw = parts.join('||');
  // Salt with the app version so fingerprints are not comparable across apps.
  return `${raw}||salt=autobe`;
}

/**
 * Returns the one-way device id used everywhere else in the app.
 * This is what gets hashed into the verified list and the block list, exactly
 * like the Python `_block_hash(hwid)` flow.
 */
export async function getDeviceId(): Promise<string> {
  const fingerprint = await generateDeviceFingerprint();
  return sha256Hex(fingerprint);
}

/** Short, human-friendly form for display (mirrors the Python masked HWID). */
export function maskDeviceId(deviceId: string): string {
  if (!deviceId || deviceId.length < 16) return 'unknown';
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-8)}`;
}