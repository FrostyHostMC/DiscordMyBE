import { createRoot } from 'react-dom/client'
import App from '@/App.tsx'
import './index.css'
import aiConfigJson from '@/config/aiConfig.json'

// Re-establish the AI bridge handshake on startup. The call is fully guarded:
// if the runtime build does not expose it, nothing happens (no crash, no
// unhandled rejection), and a failed handshake never blocks rendering.
void import('@aippy/runtime/ai')
  .then((mod) => {
    if (typeof mod.sendAIConfigToContainer === 'function') {
      try {
        void Promise.resolve(mod.sendAIConfigToContainer(aiConfigJson)).catch(() => {});
      } catch {
        /* bridge not ready — AI tab retries lazily on first use */
      }
    }
  })
  .catch(() => {});

createRoot(document.getElementById("root")!).render(<App />);