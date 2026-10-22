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

    // Check if table exists
    try {
      const checkTable = env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='community_modpacks'");
      const tableResult = checkTable.first();
      if (!tableResult) {
        console.error('[Community] Table community_modpacks does not exist');
        return new Response(JSON.stringify({ error: 'Database table not found. Please run schema.sql to create the table.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (tableError) {
      console.error('[Community] Error checking table:', tableError);
      return new Response(JSON.stringify({ error: 'Database table check failed', details: tableError instanceof Error ? tableError.message : String(tableError) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await request.json();
    console.log('[Community] POST request data:', { name: data.name, author: data.author, blob_url: data.blob_url });

    // Validate required fields
    if (!data.name || !data.description || !data.author || !data.author_id || !data.blob_url || !data.file_name) {
      console.error('[Community] Missing required fields:', { name: !!data.name, description: !!data.description, author: !!data.author, author_id: !!data.author_id, blob_url: !!data.blob_url, file_name: !!data.file_name });
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Only accept files that were uploaded through our own /api/upload (kind "pub").
    try {
      const blobUrl = new URL(String(data.blob_url));
      if (!blobUrl.pathname.startsWith('/api/files/pub/')) throw new Error('bad path');
    } catch {
      console.error('[Community] Invalid blob_url:', data.blob_url);
      return new Response(JSON.stringify({ error: 'Invalid file link. Upload the modpack through the app first.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    console.log('[Community] Inserting modpack:', { id, name: data.name, author: data.author });

    const stmt = env.DB.prepare(
      'INSERT INTO community_modpacks (id, name, description, author, author_id, version, total_packs, size, icon_data_url, created_at, downloads, blob_url, file_name, included_packs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const result = stmt.bind(
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
    ).run();

    console.log('[Community] Insert result:', result, 'meta:', result.meta);

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

    // Check if table exists
    try {
      const checkTable = env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='community_modpacks'");
      const tableResult = checkTable.first();
      if (!tableResult) {
        console.error('[Community] Table community_modpacks does not exist');
        return new Response(JSON.stringify({ error: 'Database table not found. Please run schema.sql to create the table.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (tableError) {
      console.error('[Community] Error checking table:', tableError);
      return new Response(JSON.stringify({ error: 'Database table check failed', details: tableError instanceof Error ? tableError.message : String(tableError) }), {
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

    console.log('[Community] Fetched modpacks:', result.results?.length || 0);

    return new Response(JSON.stringify({ modpacks: result.results || [] }), {
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

    // Check if table exists
    try {
      const checkTable = env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='community_modpacks'");
      const tableResult = checkTable.first();
      if (!tableResult) {
        console.error('[Community] Table community_modpacks does not exist');
        return new Response(JSON.stringify({ error: 'Database table not found. Please run schema.sql to create the table.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (tableError) {
      console.error('[Community] Error checking table:', tableError);
      return new Response(JSON.stringify({ error: 'Database table check failed', details: tableError instanceof Error ? tableError.message : String(tableError) }), {
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

    console.log('[Community] DELETE request:', { id, authorId });

    // Verify the user is the author
    const stmt = env.DB.prepare('SELECT author_id FROM community_modpacks WHERE id = ?');
    const result = stmt.bind(id).first();

    if (!result) {
      console.error('[Community] Modpack not found:', id);
      return new Response(JSON.stringify({ error: 'Modpack not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (result.author_id !== authorId) {
      console.error('[Community] Unauthorized delete attempt:', { authorId, actual_author: result.author_id });
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Delete the modpack
    const deleteStmt = env.DB.prepare('DELETE FROM community_modpacks WHERE id = ?');
    deleteStmt.bind(id).run();

    console.log('[Community] Deleted modpack:', id);
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

/**
 * PATCH /api/community-modpacks
 * Update a modpack (only by the author)
 */
export async function onRequestPatch(context: Context) {
  const { request, env } = context;

  try {
    // Check if DB is available
    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Database not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if table exists
    try {
      const checkTable = env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='community_modpacks'");
      const tableResult = checkTable.first();
      if (!tableResult) {
        console.error('[Community] Table community_modpacks does not exist');
        return new Response(JSON.stringify({ error: 'Database table not found. Please run schema.sql to create the table.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (tableError) {
      console.error('[Community] Error checking table:', tableError);
      return new Response(JSON.stringify({ error: 'Database table check failed', details: tableError instanceof Error ? tableError.message : String(tableError) }), {
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

    const data = await request.json();
    console.log('[Community] PATCH request:', { id, authorId, data });

    // Verify the user is the author
    const checkStmt = env.DB.prepare('SELECT author_id FROM community_modpacks WHERE id = ?');
    const checkResult = checkStmt.bind(id).first();

    if (!checkResult) {
      console.error('[Community] Modpack not found:', id);
      return new Response(JSON.stringify({ error: 'Modpack not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (checkResult.author_id !== authorId) {
      console.error('[Community] Unauthorized update attempt:', { authorId, actual_author: checkResult.author_id });
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description);
    }
    if (data.version !== undefined) {
      updates.push('version = ?');
      values.push(data.version);
    }
    if (data.icon_data_url !== undefined) {
      updates.push('icon_data_url = ?');
      values.push(data.icon_data_url);
    }

    if (updates.length === 0) {
      return new Response(JSON.stringify({ error: 'No fields to update' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    values.push(id);
    const query = `UPDATE community_modpacks SET ${updates.join(', ')} WHERE id = ?`;

    const stmt = env.DB.prepare(query);
    stmt.bind(...values).run();

    console.log('[Community] Updated modpack:', id);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Community modpacks PATCH error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
