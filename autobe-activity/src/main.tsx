import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import App from '@/App.tsx';
import { describeError } from '@/utils/errorLog';
import './index.css';

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();

type GateState = 'checking' | 'allowed' | 'denied';

function AccessGate() {
  const [state, setState] = useState<GateState>('checking');
  const [message, setMessage] = useState('Connecting to Discord…');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const updateMessage = (value: string) => {
      if (!cancelled) setMessage(value);
    };
    const deny = (value: string) => {
      if (cancelled) return;
      setMessage(value);
      setState('denied');
    };

    async function authenticateAndVerify() {
      // This app is intentionally locked to Discord Activities.
      if (window.self === window.top) {
        deny('AutoBE only works inside Discord. Launch it from your Discord server Activity.');
        return;
      }
      if (!clientId) {
        deny('The Discord Application ID is missing. Set VITE_DISCORD_CLIENT_ID in Cloudflare Pages and redeploy.');
        return;
      }

      try {
        updateMessage('Connecting to Discord Activity…');
        const sdk = new DiscordSDK(clientId);
        await sdk.ready();

        updateMessage('Authorizing your Discord account…');
        const { code } = await sdk.commands.authorize({
          client_id: clientId,
          response_type: 'code',
          state: crypto.randomUUID(),
          prompt: 'none',
          scope: ['identify'],
        });

        if (!code) throw new Error('Discord did not return an authorization code.');

        updateMessage('Completing secure sign-in…');
        const tokenResponse = await fetch('/api/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ code }),
        });
        const tokenData = await tokenResponse.json().catch(() => ({})) as {
          access_token?: string;
          error?: string;
        };

        if (!tokenResponse.ok || !tokenData.access_token) {
          throw new Error(tokenData.error || `Token endpoint failed (${tokenResponse.status}).`);
        }

        updateMessage('Checking your Auto Byte role…');
        await sdk.commands.authenticate({ access_token: tokenData.access_token });

        const accessResponse = await fetch('/api/access', {
          method: 'POST',
          headers: { authorization: `Bearer ${tokenData.access_token}` },
          cache: 'no-store',
        });
        const accessData = await accessResponse.json().catch(() => ({})) as {
          allowed?: boolean;
          reason?: string;
          error?: string;
        };

        if (!accessResponse.ok || accessData.allowed !== true) {
          deny(accessData.reason || accessData.error || `Role verification failed (${accessResponse.status}).`);
          return;
        }

        if (!cancelled) setState('allowed');
      } catch (error) {
        const detail = describeError(error);
        console.error('[AutoBE] Discord access check failed:', detail);
        deny(`Discord sign-in failed: ${detail}. Close the Activity and reopen it. If this keeps happening, send the error text to the administrator.`);
      }
    }

    void authenticateAndVerify();
    return () => { cancelled = true; };
  }, [attempt]);

  if (state === 'allowed') return <App />;

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-[#07050F] text-white p-6">
      <section className="w-full max-w-sm rounded-2xl border border-purple-500/30 bg-[#0D091A] p-6 text-center shadow-2xl">
        <div className="text-3xl mb-3">{state === 'checking' ? '🔐' : '⛔'}</div>
        <h1 className="text-2xl font-black mb-2">Auto<span className="text-purple-400">BE</span></h1>
        <p className="text-sm text-zinc-300 leading-relaxed break-words">{message}</p>
        {state === 'checking' && <div className="mt-4 mx-auto h-1 w-28 overflow-hidden rounded-full bg-zinc-800"><div className="h-full w-1/2 animate-pulse rounded-full bg-purple-500" /></div>}
        {state === 'denied' && (
          <button
            onClick={() => { setMessage('Retrying Discord connection…'); setState('checking'); setAttempt((value) => value + 1); }}
            className="mt-5 rounded-xl bg-purple-700 px-5 py-3 text-sm font-bold"
          >
            Try again
          </button>
        )}
      </section>
    </main>
  );
}

window.addEventListener('error', (event) => {
  console.error('[AutoBE] Uncaught error:', event.error ? describeError(event.error) : event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[AutoBE] Unhandled rejection:', describeError(event.reason));
});

createRoot(document.getElementById('root')!).render(<AccessGate />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).catch((error) => {
      console.info('[AutoBE] Service worker not registered:', describeError(error));
    });
  });
}
