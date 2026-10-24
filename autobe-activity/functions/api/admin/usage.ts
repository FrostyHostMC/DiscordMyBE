/**
 * GET /api/admin/usage
 * Lightweight published-storage estimate. Set ADMIN_DISCORD_USER_ID as a
 * Pages secret/variable to enable access; never exposes object keys or URLs.
 */
import type { Context } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
  DISCORD_CLIENT_ID: string;
  ADMIN_DISCORD_USER_ID?: string;
}

type Ctx = Context & { env: Env };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function onRequestGet({ request, env }: Ctx) {
  if (!env.ADMIN_DISCORD_USER_ID) {
    return json({ error: 'Usage dashboard is not configured. Set ADMIN_DISCORD_USER_ID in Cloudflare Pages variables.' }, 503);
  }
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: 'Sign in with the owner Discord account to view usage.' }, 401);
  try {
    const auth = await fetch('https://discord.com/api/v10/oauth2/@me', {
      headers: { authorization: `Bearer ${match[1]}` },
    });
    if (!auth.ok) return json({ error: 'Discord session expired. Reopen the Activity and try again.' }, 401);
    const info = await auth.json() as { application?: { id?: string }; user?: { id?: string } };
    if (info.application?.id !== env.DISCORD_CLIENT_ID || info.user?.id !== env.ADMIN_DISCORD_USER_ID) {
      return json({ error: 'You do not have permission to view storage usage.' }, 403);
    }
    const published = await env.DB.prepare(
      'SELECT COUNT(*) AS pack_count, COALESCE(SUM(size), 0) AS estimated_bytes FROM community_modpacks'
    ).first<{ pack_count: number; estimated_bytes: number }>();
    const recent = await env.DB.prepare(
      'SELECT COALESCE(SUM(request_count), 0) AS upload_starts FROM autobe_rate_limits WHERE window_start >= ?'
    ).bind(Date.now() - 24 * 60 * 60 * 1000).first<{ upload_starts: number }>().catch(() => null);
    const bytes = Number(published?.estimated_bytes || 0);
    const storageLimitBytes = 10 * 1024 * 1024 * 1024;
    return json({
      publishedModpacks: Number(published?.pack_count || 0),
      estimatedPublishedBytes: bytes,
      estimatedPublishedGiB: Number((bytes / (1024 ** 3)).toFixed(3)),
      percentOfR2FreeStorage: Number(Math.min(100, bytes / storageLimitBytes * 100).toFixed(2)),
      r2FreeStorageGiB: 10,
      uploadStartsInLast24Hours: Number(recent?.upload_starts || 0),
      warning: 'Published-size estimate only. It does not include temporary R2 objects, orphaned uploads, or other bucket objects. Confirm actual usage in Cloudflare R2 dashboard.',
    });
  } catch (error) {
    console.error('[AdminUsage] Failed to read usage:', error);
    return json({ error: 'Usage could not be loaded. Check D1 availability and the Cloudflare function logs.' }, 503);
  }
}
