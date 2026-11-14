import type { DiscordSDK } from '@discord/embedded-app-sdk';

let accessToken: string | null = null;
let discordSdk: DiscordSDK | null = null;

export function setJavaBEDownloadSession(token: string, sdk: DiscordSDK): void {
  accessToken = token;
  discordSdk = sdk;
}

const PART_SIZE = 8 * 1024 * 1024;
const MAX_RETRIES = 3;

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(body.error || `Download service returned HTTP ${response.status}.`);
    return body;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The upload timed out. Please retry.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export interface JavaBEExportResult {
  success: boolean;
  message: string;
  url?: string;
}

export async function deliverJavaBEAddon(
  bytes: Uint8Array,
  fileName: string,
  onProgress?: (message: string) => void,
): Promise<JavaBEExportResult> {
  if (!accessToken || !discordSdk) throw new Error('Your Discord session is not ready. Reopen JavaBE and try again.');
  const size = bytes.byteLength;
  if (!size) throw new Error('The generated add-on is empty. Rebuild it before downloading.');

  onProgress?.('Preparing a temporary download…');
  const created = await requestJson<{ key: string; uploadId: string; uploadToken: string; size: number }>(
    '/api/download?action=create',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fileName, size }),
    },
  );

  const totalParts = Math.ceil(size / PART_SIZE);
  const parts: Array<{ partNumber: number; etag: string }> = new Array(totalParts);
  let nextPart = 0;
  let uploaded = 0;
  const uploadPart = async (index: number) => {
    const start = index * PART_SIZE;
    const chunk = bytes.slice(start, Math.min(start + PART_SIZE, size));
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await requestJson<{ partNumber: number; etag: string }>(
          `/api/download?action=part&key=${encodeURIComponent(created.key)}&uploadId=${encodeURIComponent(created.uploadId)}&size=${size}&partNumber=${index + 1}`,
          { method: 'PUT', headers: { 'x-upload-token': created.uploadToken, 'content-type': 'application/octet-stream' }, body: chunk },
        );
        parts[index] = { partNumber: result.partNumber, etag: result.etag };
        uploaded += chunk.byteLength;
        onProgress?.(`Uploading add-on… ${Math.min(99, Math.round(uploaded / size * 100))}%`);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES) await new Promise(resolve => window.setTimeout(resolve, 500 * attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('An upload part failed.');
  };

  try {
    await Promise.all(Array.from({ length: Math.min(2, totalParts) }, async () => {
      while (true) {
        const index = nextPart++;
        if (index >= totalParts) return;
        await uploadPart(index);
      }
    }));
    onProgress?.('Finishing temporary download…');
    const completed = await requestJson<{ url: string; expiresAt: number }>('/api/download?action=complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: created.key, uploadId: created.uploadId, uploadToken: created.uploadToken, size, parts }),
    });
    onProgress?.('Opening the download in your browser…');
    await discordSdk.commands.openExternalLink({ url: completed.url });
    return { success: true, url: completed.url, message: 'Download opened in your browser. Use the browser download or Share menu to save the .mcaddon to Files or open it in Minecraft.' };
  } catch (error) {
    await requestJson('/api/download?action=abort', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: created.key, uploadId: created.uploadId, uploadToken: created.uploadToken, size }),
    }).catch(() => ({}));
    throw error;
  }
}
