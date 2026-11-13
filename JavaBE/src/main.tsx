import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { LoaderCircle, ShieldAlert } from 'lucide-react';
import App from '@/App.tsx';
import './index.css';
import aiConfigJson from '@/config/aiConfig.json';

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();

declare global {
  interface Window {
    __JAVABE_DISCORD__?: { sdk: DiscordSDK; accessToken: string; user: unknown };
  }
}

// Preserve JavaBE's existing Aippy AI bridge initialization. It must never
// prevent the main app from rendering if the host bridge is unavailable.
void import('@aippy/runtime/ai')
  .then((mod) => {
    if (typeof mod.sendAIConfigToContainer === 'function') {
      try {
        void Promise.resolve(mod.sendAIConfigToContainer(aiConfigJson)).catch(() => {});
      } catch {
        /* Host bridge may not be ready yet. */
      }
    }
  })
  .catch(() => {});

function ActivityGate() {
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [message, setMessage] = useState('Connecting to Discord…');

  useEffect(() => {
    let cancelled = false;
    async function connect() {
      if (!clientId) throw new Error('JavaBE is missing VITE_DISCORD_CLIENT_ID. Configure it in Cloudflare Pages.');
      setMessage('Waiting for Discord Activity…');
      const sdk = new DiscordSDK(clientId);
      await sdk.ready();
      if (cancelled) return;
      setMessage('Authorizing your Discord account…');
      const authorization = await sdk.commands.authorize({
        client_id: clientId, response_type: 'code', state: crypto.randomUUID(), prompt: 'none', scope: ['identify'],
      });
      if (!authorization.code) throw new Error('Discord did not return an authorization code.');
      setMessage('Completing secure sign-in…');
      const tokenResponse = await fetch('/api/token', {
        method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ code: authorization.code }),
      });
      const tokenData = await tokenResponse.json().catch(() => ({})) as { access_token?: string; error?: string };
      if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error || 'Discord sign-in could not be completed.');
      setMessage('Opening JavaBE…');
      const authenticated = await sdk.commands.authenticate({ access_token: tokenData.access_token });
      if (!authenticated?.user) throw new Error('Discord did not return the signed-in user.');
      window.__JAVABE_DISCORD__ = { sdk, accessToken: tokenData.access_token, user: authenticated.user };
      if (!cancelled) setStatus('ready');
    }
    void connect().catch((reason: unknown) => {
      console.error('[JavaBE] Discord Activity connection failed:', reason);
      if (!cancelled) {
        setMessage(reason instanceof Error ? reason.message : 'Could not connect to Discord. Close and reopen the Activity.');
        setStatus('error');
      }
    });
    return () => { cancelled = true; };
  }, []);

  if (status === 'ready') return <App />;
  return <main className="min-h-screen flex items-center justify-center p-6"><section className="w-full max-w-lg rounded-2xl border border-white/10 bg-black/30 p-8 text-center shadow-2xl">
    {status === 'connecting' ? <LoaderCircle className="mx-auto mb-5 h-10 w-10 animate-spin" /> : <ShieldAlert className="mx-auto mb-5 h-10 w-10 text-amber-400" />}
    <h1 className="mb-2 text-2xl font-semibold">JavaBE</h1><p className="text-sm opacity-75">{message}</p>
    {status === 'error' && <button className="mt-6 rounded-lg border px-4 py-2" onClick={() => window.location.reload()}>Try again</button>}
  </section></main>;
}

createRoot(document.getElementById('root')!).render(<ActivityGate />);
