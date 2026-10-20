import { DiscordSDK } from '@discord/embedded-app-sdk';

/**
 * Initializes Discord's Embedded App SDK when AutoBE is opened as a Discord
 * Activity. Normal browser/PWA use remains unchanged.
 *
 * This does not authenticate a Discord user and does not need the bot token.
 * Only the public Discord Application ID (Client ID) is used in the frontend.
 */
export async function initializeDiscordActivity(): Promise<boolean> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();
  const isEmbedded = window.self !== window.top;

  if (!isEmbedded) return false;

  if (!clientId) {
    console.warn(
      '[AutoBE] Running in an iframe without VITE_DISCORD_CLIENT_ID. ' +
      'Set the Discord Application ID to enable the Activity SDK handshake.'
    );
    return false;
  }

  try {
    const discordSdk = new DiscordSDK(clientId);
    await discordSdk.ready();
    console.info('[AutoBE] Discord Activity SDK is ready.');
    return true;
  } catch (error) {
    // Do not break the existing standalone app if Discord's handshake fails.
    console.error('[AutoBE] Discord Activity SDK initialization failed:', error);
    return false;
  }
}
