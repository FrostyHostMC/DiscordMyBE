import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import App from '@/App.tsx';
import './index.css';
import aiConfigJson from '@/config/aiConfig.json';

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();

declare global {
  interface Window {
    __JAVABE_DISCORD__?: { sdk: DiscordSDK };
  }
}

// Keep JavaBE's existing Aippy bridge working independently of Discord.
void import('@aippy/runtime/ai')
  .then((mod) => {
    if (typeof mod.sendAIConfigToContainer === 'function') {
      try {
        void Promise.resolve(mod.sendAIConfigToContainer(aiConfigJson)).catch(() => {});
      } catch {
        /* The host bridge may not be ready yet. */
      }
    }
  })
  .catch(() => {});

function JavaBEActivity() {
  useEffect(() => {
    if (!clientId) {
      console.warn('[JavaBE] VITE_DISCORD_CLIENT_ID is not configured; running in browser preview mode.');
      return;
    }
    const sdk = new DiscordSDK(clientId);
    void sdk.ready()
      .then(() => {
        window.__JAVABE_DISCORD__ = { sdk };
        console.info('[JavaBE] Discord Activity connection is ready.');
      })
      .catch((error: unknown) => {
        // The app remains usable in a normal browser preview. Discord's host
        // handshake completes when JavaBE is launched as an Activity.
        console.info('[JavaBE] Discord host handshake is not active in this browser context.', error);
      });
  }, []);

  return <App />;
}

createRoot(document.getElementById('root')!).render(<JavaBEActivity />);
