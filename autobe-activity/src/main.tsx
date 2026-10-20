import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import App from '@/App.tsx';
import { describeError } from '@/utils/errorLog';
import './index.css';

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();

function AccessGate() {
  const [state, setState] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [message, setMessage] = useState('Connecting to Discord…');

  useEffect(() => {
    let active = true;
    const deny = (reason: string) => { if (active) { setMessage(reason); setState('denied'); } };
    const authenticate = async () => {
      // This product is intentionally Activity-only. A normal browser must never unlock it.
      if (window.self === window.top) { deny('AutoBE is only available as a Discord Activity. Open it from your Discord server.'); return; }
      if (!clientId) { deny('Discord Activity is not configured. Please contact the server administrator.'); return; }
      try {
        const sdk = new DiscordSDK(clientId);
        await sdk.ready();
        const { code } = await sdk.commands.authorize({
          client_id: clientId, response_type: 'code', state: crypto.randomUUID(),
          prompt: 'none', scope: ['identify', 'applications.commands'],
        });
        const tokenResponse = await fetch('/api/token', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
        if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error || 'Discord sign-in failed.');
        await sdk.commands.authenticate({ access_token: tokenData.access_token });
        const accessResponse = await fetch('/api/access', {
          method: 'POST', headers: { authorization: `Bearer ${tokenData.access_token}` },
        });
        const accessData = await accessResponse.json() as { allowed?: boolean; reason?: string; error?: string };
        if (!accessResponse.ok || accessData.allowed !== true) { deny(accessData.reason || accessData.error || 'You do not have access to AutoBE.'); return; }
        if (active) setState('allowed');
      } catch (error) {
        console.error('[AutoBE] Discord access check failed:', describeError(error));
        deny('Could not verify your Discord access. Close and reopen the Activity, then try again.');
      }
    };
    void authenticate();
    return () => { active = false; };
  }, []);

  if (state === 'allowed') return <App />;
  return <main className="min-h-screen w-full flex items-center justify-center bg-[#07050F] text-white p-6">
    <section className="w-full max-w-sm rounded-2xl border border-purple-500/30 bg-[#0D091A] p-6 text-center shadow-2xl">
      <div className="text-3xl mb-3">{state === 'checking' ? '🔐' : '⛔'}</div>
      <h1 className="text-2xl font-black mb-2">Auto<span className="text-purple-400">BE</span></h1>
      <p className="text-sm text-zinc-300 leading-relaxed">{message}</p>
      {state === 'denied' && <button onClick={() => window.location.reload()} className="mt-5 rounded-xl bg-purple-700 px-5 py-3 text-sm font-bold">Try again</button>}
    </section>
  </main>;
}

window.addEventListener('error', (ev) => {
  console.error('[AutoBE] Uncaught error:', ev.error ? describeError(ev.error) : ev.message);
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('[AutoBE] Unhandled rejection:', describeError(ev.reason));
});

createRoot(document.getElementById('root')!).render(<React.StrictMode><AccessGate /></React.StrictMode>);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).catch((err) => {
      console.info('[AutoBE] Service worker not registered:', describeError(err));
    });
  });
}
