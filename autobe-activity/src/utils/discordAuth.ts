// Keeps the Discord token + SDK instance in memory (and sessionStorage as a
// backup) so features don't fail if the webview drops sessionStorage.
import type { DiscordSDK } from '@discord/embedded-app-sdk';

let token: string | null = null;
let applicationId: string | null = null;
let sdk: DiscordSDK | null = null;

export interface DiscordUserInfo {
  id: string;
  username: string;
  global_name?: string | null;
}
let user: DiscordUserInfo | null = null;

export function setDiscordAuth(
  accessToken: string,
  appId: string,
  sdkInstance?: DiscordSDK,
  userInfo?: DiscordUserInfo | null
): void {
  token = accessToken;
  if (userInfo) user = userInfo;
  applicationId = appId;
  if (sdkInstance) sdk = sdkInstance;
  try {
    sessionStorage.setItem('discord_access_token', accessToken);
    sessionStorage.setItem('discord_application_id', appId);
  } catch {
    /* storage unavailable — the in-memory copy is enough */
  }
}

export function getDiscordAuth(): { token: string; applicationId: string } | null {
  let t = token;
  let a = applicationId;
  if (!t || !a) {
    try {
      t = sessionStorage.getItem('discord_access_token');
      a = sessionStorage.getItem('discord_application_id');
    } catch {
      /* ignore */
    }
  }
  return t && a ? { token: t, applicationId: a } : null;
}

export function getDiscordSdk(): DiscordSDK | null {
  return sdk;
}

/** The signed-in user, as returned by the Discord SDK (no extra network call needed). */
export function getDiscordUser(): DiscordUserInfo | null {
  return user;
}
