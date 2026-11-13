import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { Cpu, LoaderCircle, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import App from '@/App.tsx';
import './index.css';

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();

type GateState =
  | { status: 'loading'; message: string }
  | { status: 'allowed' }
  | { status: 'denied'; message: string };

function GateScreen({ state, message, retry }: {
  state: 'loading' | 'denied';
  message: string;
  retry: () => void;
}) {
  const isLoading = state === 'loading';
  return (
    <main className="javabe-launch-screen" role={isLoading ? 'status' : 'alert'} aria-live="polite">
      <div className="javabe-launch-aurora" aria-hidden="true">
        <span className="javabe-launch-orb javabe-launch-orb-one" />
        <span className="javabe-launch-orb javabe-launch-orb-two" />
        <span className="javabe-launch-stars" />
      </div>
      <section className="javabe-launch-content">
        <div className="javabe-launch-brand">
          <div className="javabe-launch-logo">
            <Cpu size={29} strokeWidth={1.8} />
            <span className="javabe-launch-logo-glint" />
          </div>
          <p className="javabe-launch-kicker">JAVA TO BEDROCK</p>
          <h1>Java<span>BE</span></h1>
          <p className="javabe-launch-tagline">Your mods. Rebuilt for Bedrock.</p>
        </div>

        <div className="javabe-launch-progress-card">
          <div className="javabe-launch-status-icon">
            {isLoading
              ? <LoaderCircle className="javabe-launch-spinner" size={25} />
              : <ShieldAlert size={25} />}
          </div>
          <div className="javabe-launch-status-copy">
            <h2>{isLoading ? 'Preparing your workspace' : 'Could not connect'}</h2>
            <p>{message}</p>
          </div>
          {isLoading ? (
            <div className="javabe-launch-progress" aria-hidden="true"><span /></div>
          ) : (
            <button className="javabe-launch-retry" onClick={retry}>
              <RefreshCw size={16} /> Try again
            </button>
          )}
        </div>

        <div className="javabe-launch-footer">
          <Sparkles size={14} />
          <span>{isLoading ? 'Getting your conversion studio ready' : 'Your workspace is waiting'}</span>
        </div>
      </section>
    </main>
  );
}

function JavaBEActivity() {
  const [attempt, setAttempt] = useState(0);
  const [gate, setGate] = useState<GateState>({
    status: 'loading',
    message: 'Connecting securely to Discord…',
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

      setGate({ status: 'loading', message: 'Connecting securely to Discord…' });
      try {
        const sdk = new DiscordSDK(clientId);
        await sdk.ready();

        if (cancelled) return;
        setGate({ status: 'loading', message: 'Confirming your Discord session…' });
        const { code } = await sdk.commands.authorize({
          client_id: clientId,
          response_type: 'code',
          state: crypto.randomUUID(),
          prompt: 'none',
          scope: ['identify'],
        });
        if (!code) throw new Error('Discord did not return an authorization code.');

        const tokenResponse = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
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

        if (cancelled) return;
        setGate({ status: 'loading', message: 'Checking your Byte server access…' });
        const accessResponse = await fetch('/api/access', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
          cache: 'no-store',
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
  return (
    <GateScreen
      state={gate.status}
      message={gate.message}
      retry={() => setAttempt(value => value + 1)}
    />
  );
}

createRoot(document.getElementById('root')!).render(<JavaBEActivity />);
