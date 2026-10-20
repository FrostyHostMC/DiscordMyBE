import { createRoot } from 'react-dom/client';
import App from '@/App.tsx';
import { describeError } from '@/utils/errorLog';
import { initializeDiscordActivity } from '@/utils/discordActivity';
import './index.css';

// Surface uncaught errors as readable logs (objects otherwise print as "[object Object]")
window.addEventListener('error', (ev) => {
  console.error('[AutoBE] Uncaught error:', ev.error ? describeError(ev.error) : ev.message);
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('[AutoBE] Unhandled rejection:', describeError(ev.reason));
});

// Start the Discord Activity handshake when embedded, while keeping standalone
// browser/PWA startup unchanged. The SDK uses the public Application ID only.
void initializeDiscordActivity();
createRoot(document.getElementById('root')!).render(<App />);

// --- PWA: register the offline shell ---------------------------------------
// Registration only succeeds on https:// or localhost; failures are expected in
// insecure contexts and must never break the app.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).catch((err) => {
      console.info('[AutoBE] Service worker not registered:', describeError(err));
    });
  });
}