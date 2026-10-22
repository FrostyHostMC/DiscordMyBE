// Gets a generated file onto the user's device from inside a Discord Activity.
//
// Activities are sandboxed iframes: <a download>, blob: tabs and the share
// sheet are blocked or unreliable (blob: links can't even be opened in the
// phone's browser — that is the "WebKitBlobResource error 1" page). So we
// upload the file to our own R2 bucket and open the resulting https link in
// the system browser, which downloads it normally.
import { uploadToCloud } from '@/utils/cloudUpload';
import { getDiscordAuth, getDiscordSdk } from '@/utils/discordAuth';

export async function openExternalUrl(url: string): Promise<void> {
  let sdk = getDiscordSdk();
  if (!sdk) {
    const auth = getDiscordAuth();
    if (!auth) throw new Error('Discord is not ready. Close and reopen the Activity.');
    const { DiscordSDK } = await import('@discord/embedded-app-sdk');
    sdk = new DiscordSDK(auth.applicationId);
    await sdk.ready();
  }
  await sdk.commands.openExternalLink({ url });
}

export interface DeliverResult {
  ok: boolean;
  url?: string;
  error?: string;
}

export async function deliverFile(
  blob: Blob,
  fileName: string,
  onStatus?: (message: string) => void
): Promise<DeliverResult> {
  let url: string;
  try {
    let lastShown = -1;
    onStatus?.(`Preparing ${fileName} for download… 0%`);
    const result = await uploadToCloud(blob, fileName, 'temp', (pct) => {
      if (pct - lastShown >= 10 || pct === 100) {
        lastShown = pct;
        onStatus?.(`Preparing ${fileName} for download… ${pct}%`);
      }
    });
    url = result.url;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    await openExternalUrl(url);
    return { ok: true, url };
  } catch (err) {
    // Upload worked but the link could not be opened — caller can show the link to copy.
    return { ok: false, url, error: err instanceof Error ? err.message : String(err) };
  }
}
