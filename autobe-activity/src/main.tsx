import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShieldCheck, ShieldAlert, LoaderCircle, LockKeyhole } from 'lucide-react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import App from '@/App.tsx';
import { describeError } from '@/utils/errorLog';
import { getDiscordAuth, setDiscordAuth } from '@/utils/discordAuth';
import './index.css';

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();
// Must match the redirect URI registered in Discord Developer Portal and the server's OAuth setting.
const browserRedirectUri = 'https://discordmybe.pages.dev/';

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
      if (!cancelled) {
        setMessage(value);
        setState('denied');
      }
    };

    async function authenticateAndVerify() {
      if (!clientId) {
        deny('The Discord Application ID is missing. Set VITE_DISCORD_CLIENT_ID in Cloudflare Pages and redeploy.');
        return;
      }

      try {
        // Standalone browser sign-in lets the same Discord account manage published
        // community modpacks outside the embedded Activity.
        if (window.self === window.top) {
          const params = new URLSearchParams(window.location.search);
          const code = params.get('code');
          if (!code) {
            // Restore this browser's existing Discord session if it is still valid.
            const savedAuth = getDiscordAuth();
            if (savedAuth) {
              updateMessage('Restoring your Discord session…');
              const accessResponse = await fetch('/api/access', {
                method: 'POST',
                headers: { authorization: `Bearer ${savedAuth.token}` },
                cache: 'no-store',
              });
              const accessData = await accessResponse.json().catch(() => ({})) as {
                allowed?: boolean;
                reason?: string;
                error?: string;
                user?: { id: string; username: string; global_name?: string | null; avatar?: string | null };
              };
              if (accessResponse.ok && accessData.allowed === true && accessData.user) {
                setDiscordAuth(savedAuth.token, savedAuth.applicationId, undefined, accessData.user);
                if (!cancelled) setState('allowed');
                return;
              }
            }
            deny('Sign in with Discord to view and manage community modpacks from this browser.');
            return;
          }

          const returnedState = params.get('state') || '';
          let expectedState = '';
          try {
            // OAuth may return in a new tab/window in the same browser profile.
            // localStorage survives that context switch; keep strict state validation.
            expectedState = localStorage.getItem('autobe_discord_oauth_state') || '';
            localStorage.removeItem('autobe_discord_oauth_state');
            sessionStorage.removeItem('autobe_discord_oauth_state');
          } catch {
            /* If persistent storage is blocked, fail closed rather than skip state validation. */
          }
          window.history.replaceState({}, document.title, window.location.pathname);
          if (!expectedState || returnedState !== expectedState) {
            throw new Error('Discord sign-in state did not match. Please start sign-in again.');
          }

          updateMessage('Completing Discord sign-in…');
          const tokenResponse = await fetch('/api/token', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ code, redirect_uri: browserRedirectUri }),
          });
          const tokenData = await tokenResponse.json().catch(() => ({})) as {
            access_token?: string;
            error?: string;
          };
          if (!tokenResponse.ok || !tokenData.access_token) {
            throw new Error(tokenData.error || `Token endpoint failed (${tokenResponse.status}).`);
          }

          updateMessage('Verifying your AutoBE access…');
          const accessResponse = await fetch('/api/access', {
            method: 'POST',
            headers: { authorization: `Bearer ${tokenData.access_token}` },
            cache: 'no-store',
          });
          const accessData = await accessResponse.json().catch(() => ({})) as {
            allowed?: boolean;
            reason?: string;
            error?: string;
            user?: { id: string; username: string; global_name?: string | null };
          };
          if (!accessResponse.ok || accessData.allowed !== true) {
            deny(accessData.reason || accessData.error || `Role verification failed (${accessResponse.status}).`);
            return;
          }
          setDiscordAuth(tokenData.access_token, clientId, undefined, accessData.user ?? null);
          if (!cancelled) setState('allowed');
          return;
        }

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
        const authResult = await sdk.commands.authenticate({ access_token: tokenData.access_token });

        const accessResponse = await fetch('/api/access', {
          method: 'POST',
          headers: { authorization: `Bearer ${tokenData.access_token}` },
          cache: 'no-store',
        });
        const accessData = await accessResponse.json().catch(() => ({})) as {
          allowed?: boolean;
          reason?: string;
          error?: string;
          user?: { id: string; username: string; global_name?: string | null; avatar?: string | null };
        };

        if (!accessResponse.ok || accessData.allowed !== true) {
          deny(accessData.reason || accessData.error || `Role verification failed (${accessResponse.status}).`);
          return;
        }

        // Store credentials for Discord SDK features (file sharing, etc.)
        setDiscordAuth(tokenData.access_token, clientId, sdk, accessData.user ?? authResult?.user ?? null);

        if (!cancelled) setState('allowed');
      } catch (error) {
        const detail = describeError(error);
        console.error('[AutoBE] Discord access check failed:', detail);
        deny(`Discord sign-in failed: ${detail}. You can try again below. If it keeps failing, send this error text to the administrator.`);
      }
    }

    void authenticateAndVerify();
    return () => { cancelled = true; };
  }, [attempt]);

  if (state === 'allowed') return <App />;

  return (
    <main className="autobe-access-loading" role="status" aria-live="polite">
      <img src="/assets/loading-screen.gif" alt="" className="autobe-loading-media" />
      <div className="autobe-loading-copy">
        <p className="autobe-loading-kicker">AUTOBE · BEDROCK MERGING STUDIO</p>
        <h1>Loading a wonderful place</h1>
        <p className="autobe-loading-status">{message}</p>
        {state === 'checking' && <p className="mt-5 text-xs font-semibold tracking-wide text-violet-100/90">Verifying Discord access…</p>}
      </div>
      <section className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#30263F] bg-[#100D18] shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="h-1 w-full bg-gradient-to-r from-[#762BFF] via-[#A855F7] to-[#4F13C4]" />
        <div className="p-6 sm:p-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#762BFF]/40 bg-[#762BFF]/15 text-[#C4A5FF] shadow-[0_0_28px_rgba(118,43,255,0.16)]">
            {state === 'checking' ? <LoaderCircle className="h-7 w-7 animate-spin" strokeWidth={1.8} /> : <ShieldAlert className="h-7 w-7" strokeWidth={1.8} />}
          </div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-[#A78BDB]">Bedrock Merging Studio</p>
          <h1 className="text-3xl font-black tracking-tight text-white">Auto<span className="text-[#A855F7]">BE</span></h1>
          <div className="mx-auto my-5 h-px w-16 bg-[#762BFF]/50" />
          <h2 className="mb-2 text-lg font-bold text-white">{state === 'checking' ? 'Securing your session' : 'Access unavailable'}</h2>
          <p className="text-sm leading-relaxed text-[#AAA3BB] break-words">{message}</p>
          {state === 'checking' && <div className="mt-6 flex items-center justify-center gap-2 text-xs font-medium text-[#A78BDB]"><LockKeyhole className="h-3.5 w-3.5" /> Verifying Discord access</div>}
        {state === 'denied' && (
          window.self === window.top ? (
            <button
              onClick={() => {
                if (!clientId) {
                  setMessage('The Discord Application ID is missing. Contact the AutoBE administrator.');
                  return;
                }
                try {
                  const oauthState = crypto.randomUUID();
                  // Persist across OAuth tab/window transitions in the same browser profile.
                  localStorage.setItem('autobe_discord_oauth_state', oauthState);
                  const params = new URLSearchParams({
                    client_id: clientId,
                    response_type: 'code',
                    redirect_uri: browserRedirectUri,
                    scope: 'identify',
                    state: oauthState,
                  });
                  window.location.assign(`https://discord.com/oauth2/authorize?${params.toString()}`);
                } catch (error) {
                  setMessage(`Could not start Discord sign-in: ${describeError(error)}`);
                }
              }}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#762BFF] to-[#5D21C9] px-5 py-3.5 text-sm font-bold text-white shadow-[0_8px_24px_rgba(118,43,255,0.24)] transition hover:brightness-110 active:scale-[0.98]"
            >
              <ShieldCheck className="h-4 w-4" /> Sign in with Discord
            </button>
          ) : (
            <button
              onClick={() => { setMessage('Retrying Discord connection…'); setState('checking'); setAttempt((value) => value + 1); }}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#762BFF] to-[#5D21C9] px-5 py-3.5 text-sm font-bold text-white shadow-[0_8px_24px_rgba(118,43,255,0.24)] transition hover:brightness-110 active:scale-[0.98]"
            >
              <ShieldCheck className="h-4 w-4" /> Try again
            </button>
          )
        )}
        </div>
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
