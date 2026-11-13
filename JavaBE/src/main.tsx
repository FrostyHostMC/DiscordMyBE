import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import App from '@/App.tsx';
import './index.css';

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();

type GateState =
  | { status: 'loading'; message: string }
  | { status: 'allowed' }
  | { status: 'denied'; message: string };

function GateScreen({ message, retry }: { message: string; retry: () => void }) {
  return (
    <main className="javabe-gate">
      <section className="javabe-gate-panel">
        <div className="javabe-gate-mark">JB</div>
        <p className="javabe-gate-eyebrow">JAVA TO BEDROCK</p>
        <h1>JavaBE</h1>
        <p className="javabe-gate-message">{message}</p>
        <button className="javabe-gate-retry" onClick={retry}>Try again</button>
      </section>
    </main>
  );
}

function JavaBEActivity() {
  const [attempt, setAttempt] = useState(0);
  const [gate, setGate] = useState<GateState>({
    status: 'loading',
    message: 'Connecting to Discord…',
  });

  useEffect(() => {
    let cancelled = false;
    const fail = (message: string) => {
      if (!cancelled) setGate({ status: 'denied', message });
    };

    async function connect() {
      if (!clientId) {
        fail('JavaBE is not fully configured yet. Please try again later.');
        return;
      }

      setGate({ status: 'loading', message: 'Connecting to Discord…' });
      try {
        const sdk = new DiscordSDK(clientId);
        await sdk.ready();

        setGate({ status: 'loading', message: 'Checking your Discord account…' });
        const { code } = await sdk.commands.authorize({
          client_id: clientId,
          response_type: 'code',
          state: crypto.randomUUID(),
          prompt: 'none',
          scope: ['identify'],
        });

        const tokenResponse = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const tokenData = await tokenResponse.json() as {
          access_token?: string;
          error?: string;
        };
        if (!tokenResponse.ok || !tokenData.access_token) {
          throw new Error(tokenData.error || 'Discord sign-in could not be completed.');
        }

        await sdk.commands.authenticate({ access_token: tokenData.access_token });

        setGate({ status: 'loading', message: 'Verifying your server role…' });
        const accessResponse = await fetch('/api/access', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const accessData = await accessResponse.json() as {
          allowed?: boolean;
          reason?: string;
          error?: string;
        };
        if (!accessResponse.ok || !accessData.allowed) {
          throw new Error(accessData.reason || accessData.error || 'You do not have access to JavaBE.');
        }
        if (!cancelled) setGate({ status: 'allowed' });
      } catch (error) {
        console.error('[JavaBE] Activity sign-in failed:', error);
        fail(error instanceof Error ? error.message : 'Could not connect to Discord. Please retry.');
      }
    }

    void connect();
    return () => { cancelled = true; };
  }, [attempt]);

  if (gate.status === 'allowed') return <App />;
  return <GateScreen message={gate.message} retry={() => setAttempt((value) => value + 1)} />;
}

createRoot(document.getElementById('root')!).render(<JavaBEActivity />);
