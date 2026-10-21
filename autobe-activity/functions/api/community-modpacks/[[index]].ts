/**
 * POST /api/community-modpacks
 * Publish a modpack to the community
 */
import type { Context } from '@cloudflare/workers-types';

export async function onRequestPost(context: Context) {
  const { request, env } = context;

  try {
    // Check if DB is available
    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Database not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await request.json();

    // Validate required fields
    if (!data.name || !data.description || !data.author || !data.author_id || !data.blob_url || !data.file_name) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    const stmt = env.DB.prepare(
      'INSERT INTO community_modpacks (id, name, description, author, author_id, version, total_packs, size, icon_data_url, created_at, downloads, blob_url, file_name, included_packs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    stmt.bind(
      id,
      data.name,
      data.description,
      data.author,
      data.author_id,
      data.version,
      data.total_packs,
      data.size,
      data.icon_data_url || null,
      now,
      0,
      data.blob_url,
      data.file_name,
      JSON.stringify(data.included_packs || [])
    );

    const result = stmt.run();

    if (!result.success) {
      return new Response(JSON.stringify({ error: 'Failed to save modpack', details: result }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ id, success: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Community modpacks POST error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * GET /api/community-modpacks
 * Fetch all community modpacks
 */
export async function onRequestGet(context: Context) {
  const { env, request } = context;

  try {
    const url = new URL(request.url);
    const modpackId = url.searchParams.get('id');

    // Check if DB is available
    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Database not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Increment download count if fetching a specific modpack
    if (modpackId) {
      const incrementStmt = env.DB.prepare(
        'UPDATE community_modpacks SET downloads = downloads + 1 WHERE id = ?'
      );
      incrementStmt.bind(modpackId);
      incrementStmt.run();
    }

    const stmt = env.DB.prepare('SELECT * FROM community_modpacks ORDER BY created_at DESC');
    const result = stmt.all();

    if (!result.success) {
      return new Response(JSON.stringify({ error: 'Failed to fetch modpacks', details: result }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ modpacks: result.results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Community modpacks GET error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * DELETE /api/community-modpacks
 * Delete a modpack (only by the author)
 */
export async function onRequestDelete(context: Context) {
  const { request, env } = context;

  try {
    // Check if DB is available
    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Database not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const authorId = url.searchParams.get('author_id');

    if (!id || !authorId) {
      return new Response(JSON.stringify({ error: 'Missing id or author_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify the user is the author
    const stmt = env.DB.prepare('SELECT author_id FROM community_modpacks WHERE id = ?');
    stmt.bind(id);
    const result = stmt.first();

    if (!result || !result.success) {
      return new Response(JSON.stringify({ error: 'Modpack not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (result.results.author_id !== authorId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Delete the modpack
    const deleteStmt = env.DB.prepare('DELETE FROM community_modpacks WHERE id = ?');
    deleteStmt.bind(id);
    const deleteResult = deleteStmt.run();

    if (!deleteResult.success) {
      return new Response(JSON.stringify({ error: 'Failed to delete modpack', details: deleteResult }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Community modpacks DELETE error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
