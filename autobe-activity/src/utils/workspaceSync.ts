import type { AddonPack, MergedModpack } from '@/types/modpack';
import { getDiscordAuth } from '@/utils/discordAuth';
import { getAllPacksFromDB, getAllModpacksFromDB, loadPackFile, savePackToDB, saveModpackToDB } from '@/utils/storage';

type RemoteItem = { id: string; type: 'pack' | 'project'; data: Record<string, unknown>; updatedAt?: number };

function authHeaders(extra?: HeadersInit): HeadersInit {
  const auth = getDiscordAuth();
  if (!auth?.token) throw new Error('Sign in to Discord to sync your private workspace.');
  return { ...extra, Authorization: `Bearer ${auth.token}` };
}

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: authHeaders(init.headers), cache: 'no-store' });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json() as { error?: string }).error || ''; } catch { /* ignore */ }
    throw new Error(detail || `Workspace sync failed (HTTP ${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function packMetadata(pack: AddonPack): Record<string, unknown> {
  const { fileBlob: _fileBlob, ...metadata } = pack;
  void _fileBlob;
  return metadata as unknown as Record<string, unknown>;
}

function projectMetadata(project: MergedModpack): Record<string, unknown> {
  const { outputBlob: _outputBlob, outputs, ...metadata } = project;
  void _outputBlob;
  return {
    ...metadata,
    outputs: outputs?.map(({ blob: _blob, ...output }) => {
      void _blob;
      return output;
    }) || [],
  } as unknown as Record<string, unknown>;
}

async function saveRemote(items: RemoteItem[]): Promise<void> {
  for (let i = 0; i < items.length; i += 25) {
    await api('/api/workspace', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: items.slice(i, i + 25) }),
    });
  }
}

export async function syncPackToCloud(pack: AddonPack): Promise<void> {
  // Upload the binary first. Do not leave cloud metadata pointing at a missing file.
  const withFile = await loadPackFile(pack);
  if (!withFile.fileBlob) throw new Error(`The local file for "${pack.name}" is missing; cloud metadata was not changed.`);
  const response = await fetch(`/api/workspace/files/${encodeURIComponent(pack.id)}`, {
    method: 'PUT',
    headers: authHeaders({ 'content-type': withFile.fileBlob.type || 'application/octet-stream' }),
    body: withFile.fileBlob,
    cache: 'no-store',
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json() as { error?: string }).error || ''; } catch { /* ignore */ }
    throw new Error(detail || `Pack file sync failed (HTTP ${response.status}).`);
  }
  await saveRemote([{ id: pack.id, type: 'pack', data: packMetadata(pack) }]);
}

export async function syncProjectToCloud(project: MergedModpack): Promise<void> {
  await saveRemote([{ id: project.id, type: 'project', data: projectMetadata(project) }]);
}

export async function deleteWorkspaceItemFromCloud(type: 'pack' | 'project', id: string): Promise<void> {
  await api(`/api/workspace?type=${type}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function syncWorkspaceOnStartup(): Promise<{ packs: AddonPack[]; projects: MergedModpack[]; imported: number; uploaded: number }> {
  // Always require the server to verify identity/role before reading or writing cloud data.
  const remote = await api<{ items: RemoteItem[] }>('/api/workspace');
  const localPacks = await getAllPacksFromDB();
  const localProjects = await getAllModpacksFromDB();
  const remotePacks = remote.items.filter(item => item.type === 'pack');
  const remoteProjects = remote.items.filter(item => item.type === 'project');
  const localPackIds = new Set(localPacks.map(pack => pack.id));
  const localProjectIds = new Set(localProjects.map(project => project.id));
  const remotePackIds = new Set(remotePacks.map(item => item.id));
  const remoteProjectIds = new Set(remoteProjects.map(item => item.id));
  let imported = 0;
  let uploaded = 0;

  // Merge by stable IDs. Existing local records win collisions to avoid unexpectedly
  // replacing the only copy of an unsynced local edit. Never send an empty replacement.
  for (const item of remotePacks) {
    if (localPackIds.has(item.id)) continue;
    const metadata = { ...item.data, id: item.id } as unknown as AddonPack;
    try {
      const fileResponse = await fetch(`/api/workspace/files/${encodeURIComponent(item.id)}`, {
        headers: authHeaders(), cache: 'no-store',
      });
      if (fileResponse.ok) metadata.fileBlob = await fileResponse.blob();
      const result = await savePackToDB(metadata);
      if (result === 'saved') imported++;
    } catch (error) {
      console.warn('[WorkspaceSync] Could not import pack file:', item.id, error);
    }
  }

  for (const item of remoteProjects) {
    if (localProjectIds.has(item.id)) continue;
    await saveModpackToDB({ ...item.data, id: item.id } as unknown as MergedModpack);
    imported++;
  }

  // Upload local-only items. Demo content is excluded defensively.
  const packUploads: RemoteItem[] = [];
  for (const pack of localPacks) {
    if (pack.id.startsWith('demo-pack-') || remotePackIds.has(pack.id)) continue;
    packUploads.push({ id: pack.id, type: 'pack', data: packMetadata(pack) });
  }
  const projectUploads: RemoteItem[] = localProjects
    .filter(project => !project.id.startsWith('demo-modpack-') && !remoteProjectIds.has(project.id))
    .map(project => ({ id: project.id, type: 'project', data: projectMetadata(project) }));
  await saveRemote([...packUploads, ...projectUploads]);
  uploaded += packUploads.length + projectUploads.length;

  // Upload the actual binary for every local-only pack after metadata succeeds.
  for (const pack of localPacks) {
    if (pack.id.startsWith('demo-pack-') || remotePackIds.has(pack.id)) continue;
    const withFile = await loadPackFile(pack);
    if (!withFile.fileBlob) continue;
    const response = await fetch(`/api/workspace/files/${encodeURIComponent(pack.id)}`, {
      method: 'PUT',
      headers: authHeaders({ 'content-type': withFile.fileBlob.type || 'application/octet-stream' }),
      body: withFile.fileBlob,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Could not upload pack file "${pack.name}" (HTTP ${response.status}).`);
  }

  return { packs: await getAllPacksFromDB(), projects: await getAllModpacksFromDB(), imported, uploaded };
}
