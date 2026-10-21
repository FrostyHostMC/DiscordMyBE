import { createRoot } from 'react-dom/client'
import App from '@/App.tsx'
import { describeError } from '@/utils/errorLog'
import './index.css'

// Surface uncaught errors as readable logs (objects otherwise print as "[object Object]")
// Errors thrown inside the preview tooling scripts (inspector / asset interceptor) are
// external noise, not app failures — filter them out of the log.
function isToolingNoise(message: string, stack?: string, source?: string): boolean {
  const combined = `${message}\n${stack ?? ''}\n${source ?? ''}`;
  // Preview/host tooling scripts (inspector, asset interceptor, WebView bridge)
  // can throw errors like "JSON Parse error: Unexpected EOF" that are NOT app
  // failures — always treat anything originating on the aippy CDN as noise.
  if (/cdn\.aippy\.ai|inspector\.js|asset-interceptor\.js|aippy\.ai\/static|static\//.test(combined)) return true;
  // Some tooling errors arrive with the stack stripped or as bare JSON parser
  // failures. Suppress those as well — the app parses JSON itself and surfaces
  // its own descriptive messages for real failures.
  if (/^\s*(JSON Parse error|SyntaxError: Unexpected EOF|Unexpected token|Unexpected end)/i.test(message)) {
    return true;
  }
  return false;
}

// Final safety net: the platform console capture hooks console.error directly,
// so tooling noise must also be suppressed at the console layer — otherwise it
// still appears in logs even when the window listeners swallow it.
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const text = args
    .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : String(a)))
    .join('\n');
  if (isToolingNoise(text)) return;
  originalConsoleError(...args);
};

window.addEventListener('error', (ev) => {
  const desc = ev.error ? describeError(ev.error) : ev.message;
  if (
    isToolingNoise(ev.message, desc, ev.filename) ||
    isToolingNoise(desc, ev.error?.stack ?? '', ev.filename) ||
    // Frames like "parse@[native code]" + "@https://cdn..." — the stack may
    // live on ev.error only, so check the raw error object too.
    isToolingNoise(ev.error?.message ?? '', describeError(ev.error), ev.filename)
  ) {
    ev.preventDefault();
    return;
  }
  console.error('[Aippy] Uncaught error:', desc);
}, true);
window.addEventListener('unhandledrejection', (ev) => {
  const desc = describeError(ev.reason);
  if (
    isToolingNoise(desc) ||
    isToolingNoise(desc, ev.reason instanceof Error ? ev.reason.stack : undefined)
  ) {
    ev.preventDefault();
    return;
  }
  console.error('[Aippy] Unhandled rejection:', desc);
});

createRoot(document.getElementById("root")!).render(<App />);

// PWA: ensure the manifest link exists, then register the Service Worker
// (stale-while-revalidate) so the app loads instantly and works offline.
function setupPwa() {
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.webmanifest';
    document.head.appendChild(link);
  }
  const themeMeta = document.createElement('meta');
  themeMeta.name = 'theme-color';
  themeMeta.content = '#7C3AED';
  document.head.appendChild(themeMeta);

  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('[Aippy] Service Worker registration skipped:', describeError(e));
    });
  });
}
setupPwa();