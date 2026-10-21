// Codebase export: downloads the pre-generated codebase archive.
export interface CodebaseExportResult {
  blob: Blob;
  fileName: string;
  fileCount: number;
  encrypted: boolean;
}

/**
 * Upload a file to Discord's CDN and open it via Discord SDK.
 * This bypasses iframe sandbox restrictions in Discord Activities.
 *
 * For Web/Desktop: Uses openShareMomentDialog (native Discord share)
 * For Mobile: Uses openExternalLink (opens in external browser)
 */
export async function shareViaDiscordCDN(
  blob: Blob,
  fileName: string,
  accessToken: string,
  applicationId: string
): Promise<{ success: boolean; cdnUrl?: string }> {
  console.log('[Aippy] Starting Discord CDN upload for:', fileName);

  // Upload to Discord's attachment API
  const file = new File([await blob.arrayBuffer()], fileName, { type: blob.type });
  const body = new FormData();
  body.append('file', file);

  console.log('[Aippy] Uploading to Discord attachment API...');
  const attachmentResponse = await fetch(
    `https://discord.com/api/applications/${applicationId}/attachment`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body,
    }
  );

  if (!attachmentResponse.ok) {
    const error = await attachmentResponse.text();
    console.error('[Aippy] Discord CDN upload failed:', error);
    throw new Error(`Failed to upload to Discord CDN: ${error}`);
  }

  const attachmentJson = await attachmentResponse.json();
  const mediaUrl = attachmentJson.attachment.url;
  console.log('[Aippy] Discord CDN upload successful:', mediaUrl);

  // Dynamically import Discord SDK
  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  const discordSdk = new DiscordSDK(applicationId);
  await discordSdk.ready();

  // Check platform behavior - openShareMomentDialog only works on Web/Desktop
  const platformBehaviors = await discordSdk.commands.getPlatformBehaviors();
  const isMobile = platformBehaviors.platform === 'ios' || platformBehaviors.platform === 'android';

  console.log('[Aippy] Platform:', platformBehaviors.platform, 'isMobile:', isMobile);

  if (isMobile) {
    // Mobile: Open in external browser where downloads work
    console.log('[Aippy] Opening external link for mobile...');
    await discordSdk.commands.openExternalLink({ url: mediaUrl });
  } else {
    // Web/Desktop: Use native Discord share dialog
    console.log('[Aippy] Opening share moment dialog for desktop...');
    await discordSdk.commands.openShareMomentDialog({ mediaUrl });
  }

  return { success: true, cdnUrl: mediaUrl };
}

/**
 * Helper to share any file via Discord CDN with automatic credential lookup.
 * Returns success status and CDN URL if available.
 */
export async function tryShareViaDiscord(blob: Blob, fileName: string): Promise<{ success: boolean; cdnUrl?: string }> {
  const accessToken = sessionStorage.getItem('discord_access_token');
  const applicationId = sessionStorage.getItem('discord_application_id');

  if (!accessToken || !applicationId) {
    return { success: false };
  }

  try {
    const result = await shareViaDiscordCDN(blob, fileName, accessToken, applicationId);
    return result;
  } catch (error) {
    console.warn('[Aippy] Discord CDN share failed:', error);
    return { success: false };
  }
}

/**
 * Downloads the pre-generated codebase archive.
 *
 * The archive is generated at build time by scripts/generateCodebaseArchive.ts
 * and contains the complete project source code.
 *
 * Note: Client-side re-encryption with @zip.js/zip.js has compatibility issues
 * in Discord Activities. The archive is downloaded unencrypted for now.
 */
export async function buildCodebaseArchive(
  password: string,
  appVersion = 'v2.3.0'
): Promise<CodebaseExportResult> {
  // Step 1: Download the pre-generated archive from public folder
  // Try multiple paths in case of routing issues
  const archivePaths = [
    '/codebase-archive.zip',
    '/public/codebase-archive.zip',
    window.location.origin + '/codebase-archive.zip'
  ];

  let archiveResponse: Response | null = null;
  let lastError: Error | null = null;

  for (const path of archivePaths) {
    try {
      archiveResponse = await fetch(path);
      if (archiveResponse.ok) {
        console.log(`[CodebaseExport] Successfully fetched archive from: ${path}`);
        break;
      }
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`[CodebaseExport] Failed to fetch from ${path}:`, e);
    }
  }

  if (!archiveResponse || !archiveResponse.ok) {
    const errorMsg = lastError ? lastError.message : `Failed to download codebase archive (tried ${archivePaths.length} paths)`;
    console.error('[CodebaseExport] Archive fetch failed:', errorMsg);
    throw new Error(errorMsg);
  }

  const archiveBlob = await archiveResponse.blob();

  // Step 2: Download metadata to get file count
  const metadataPaths = [
    '/codebase-archive.json',
    '/public/codebase-archive.json',
    window.location.origin + '/codebase-archive.json'
  ];

  let metadataResponse: Response | null = null;
  for (const path of metadataPaths) {
    try {
      metadataResponse = await fetch(path);
      if (metadataResponse.ok) break;
    } catch (e) {
      console.warn(`[CodebaseExport] Failed to fetch metadata from ${path}:`, e);
    }
  }

  let fileCount = 0;
  if (metadataResponse && metadataResponse.ok) {
    try {
      const metadata = await metadataResponse.json();
      fileCount = metadata.fileCount || 0;
      console.log(`[CodebaseExport] Metadata loaded: ${fileCount} files`);
    } catch (e) {
      console.warn('[CodebaseExport] Failed to parse metadata:', e);
    }
  } else {
    console.warn('[CodebaseExport] Could not fetch metadata');
  }

  if (!archiveBlob || archiveBlob.size === 0) {
    throw new Error('Archive download produced an empty file.');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const result = {
    blob: archiveBlob,
    fileName: `autobe_codebase_${stamp}.zip`,
    fileCount,
    encrypted: false
  };

  // In Discord Activities, direct downloads are blocked. Create a persistent URL
  // that can be opened in a new tab or used via the manual save panel.
  const url = URL.createObjectURL(archiveBlob);
  setTimeout(() => URL.revokeObjectURL(url), 600_000); // Keep alive for 10 minutes

  // Store the URL on the result for the UI to use
  (result as any).downloadUrl = url;

  return result;
}
