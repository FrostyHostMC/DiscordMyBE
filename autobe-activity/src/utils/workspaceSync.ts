import type { AddonPack, MergedModpack, MergedOutput } from '@/types/modpack';
import { getDiscordAuth } from '@/utils/discordAuth';
import { getAllPacksFromDB, getAllModpacksFromDB, loadPackFile, loadModpackFiles, savePackToDB, saveModpackToDB } from '@/utils/storage';

type RemoteItem = { id: string; type: 'pack' | 'project'; data: Record<string, unknown>; updatedAt?: number };
function headers(extra?: HeadersInit): HeadersInit {
  const auth = getDiscordAuth();
  if (!auth?.token) throw new Error('Sign in to Discord to sync your private workspace.');
  return { ...extra, Authorization: `Bearer ${auth.token}` };
}
async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: headers(init.headers), cache: 'no-store' });
  if (!response.ok) {
    let message = '';
    try { message = (await response.json() as { error?: string }).error || ''; } catch { /* response may not be JSON */ }
    throw new Error(message || `Workspace sync failed (HTTP ${response.status}).`);
  }
  return response.json() as Promise<T>;
}
function packData(pack: AddonPack): Record<string, unknown> {
  const { fileBlob: _fileBlob, ...data } = pack; void _fileBlob; return data;
}
function projectData(project: MergedModpack): Record<string, unknown> {
  const { outputBlob: _outputBlob, outputs, ...data } = project; void _outputBlob;
  return { ...data, outputs: (outputs || []).map(({ blob: _blob, ...out }) => { void _blob; return out; }) };
}
async function putFile(url: string, blob: Blob): Promise<void> {
  const response = await fetch(url, { method: 'PUT', headers: headers({ 'content-type': blob.type || 'application/octet-stream' }), body: blob, cache: 'no-store' });
  if (!response.ok) {
    let message = '';
    try { message = (await response.json() as { error?: string }).error || ''; } catch { /* ignore */ }
    throw new Error(message || `Workspace file upload failed (HTTP ${response.status}).`);
  }
}
async function getFile(url: string): Promise<Blob | undefined> {
  const response = await fetch(url, { headers: headers(), cache: 'no-store' });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    let message = '';
    try { message = (await response.json() as { error?: string }).error || ''; } catch { /* ignore */ }
    throw new Error(message || `Workspace file download failed (HTTP ${response.status}).`);
  }
  return response.blob();
}
async function saveRemote(items: RemoteItem[]): Promise<void> {
  for (let i = 0; i < items.length; i += 25) {
    await api('/api/workspace', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: items.slice(i, i + 25) }) });
  }
}
export async function syncPackToCloud(pack: AddonPack): Promise<void> {
  const hydrated = await loadPackFile(pack);
  if (!hydrated.fileBlob) throw new Error(`The local file for "${pack.name}" is missing; nothing was overwritten in the cloud.`);
  await putFile(`/api/workspace/files/${encodeURIComponent(pack.id)}`, hydrated.fileBlob);
  await saveRemote([{ id: pack.id, type: 'pack', data: packData(pack) }]);
}
export async function syncProjectToCloud(project: MergedModpack): Promise<void> {
  const hydrated = await loadModpackFiles(project);
  if (hydrated.outputBlob) await putFile(`/api/workspace/files/${encodeURIComponent(project.id)}?kind=combined&key=combined`, hydrated.outputBlob);
  for (const output of hydrated.outputs || []) {
    if (output.blob) await putFile(`/api/workspace/files/${encodeURIComponent(project.id)}?kind=output&key=${encodeURIComponent(output.id)}`, output.blob);
  }
  await saveRemote([{ id: project.id, type: 'project', data: projectData(hydrated) }]);
}
export async function deleteWorkspaceItemFromCloud(type: 'pack' | 'project', id: string): Promise<void> {
  await api(`/api/workspace?type=${type}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export async function syncWorkspaceOnStartup(): Promise<{ packs: AddonPack[]; projects: MergedModpack[]; imported: number; uploaded: number }> {
  const remote = await api<{ items: RemoteItem[] }>('/api/workspace');
  const localPacks = await getAllPacksFromDB();
  const localProjects = await getAllModpacksFromDB();
  const remotePacks = remote.items.filter(item => item.type === 'pack');
  const remoteProjects = remote.items.filter(item => item.type === 'project');
  const localPackMap = new Map(localPacks.map(item => [item.id, item]));
  const localProjectMap = new Map(localProjects.map(item => [item.id, item]));
  const remotePackMap = new Map(remotePacks.map(item => [item.id, item]));
  const remoteProjectMap = new Map(remoteProjects.map(item => [item.id, item]));
  let imported = 0, uploaded = 0;

  // Existing local copies win if newer; otherwise refresh from cloud. Never replace a
  // local pack with metadata unless its corresponding cloud archive is readable.
  for (const item of remotePacks) {
    const local = localPackMap.get(item.id);
    const localStamp = Number((local as (AddonPack & { __autobeStoredAt?: number }) | undefined)?.__autobeStoredAt || 0);
    if (local && localStamp > Number(item.updatedAt || 0)) {
      await syncPackToCloud(local); uploaded++; continue;
    }
    const blob = await getFile(`/api/workspace/files/${encodeURIComponent(item.id)}`);
    if (!blob) {
      if (local) continue;
      console.warn('[WorkspaceSync] Cloud metadata has no source file; leaving it untouched:', item.id);
      continue;
    }
    const restored = { ...item.data, id: item.id, fileBlob: blob } as unknown as AddonPack;
    const result = await savePackToDB(restored);
    if (result !== 'saved') throw new Error(`Could not persist restored pack "${restored.name}" on this device.`);
    if (!local) imported++;
  }
  for (const item of remoteProjects) {
    const local = localProjectMap.get(item.id);
    const localStamp = Number((local as (MergedModpack & { __autobeStoredAt?: number }) | undefined)?.__autobeStoredAt || 0);
    if (local && localStamp > Number(item.updatedAt || 0)) {
      await syncProjectToCloud(await loadModpackFiles(local)); uploaded++; continue;
    }
    const raw = { ...item.data, id: item.id } as unknown as MergedModpack;
    const outputs: MergedOutput[] = [];
    for (const output of raw.outputs || []) {
      const blob = await getFile(`/api/workspace/files/${encodeURIComponent(raw.id)}?kind=output&key=${encodeURIComponent(output.id)}`);
      outputs.push({ ...output, ...(blob ? { blob } : {}) });
    }
    const combined = await getFile(`/api/workspace/files/${encodeURIComponent(raw.id)}?kind=combined&key=combined`);
    const restored = { ...raw, outputs, ...(combined ? { outputBlob: combined } : {}) };
    await saveModpackToDB(restored);
    if (!local) imported++;
  }
  for (const pack of localPacks) {
    if (pack.id.startsWith('demo-pack-') || remotePackMap.has(pack.id)) continue;
    await syncPackToCloud(pack); uploaded++;
  }
  for (const project of localProjects) {
    if (project.id.startsWith('demo-modpack-') || remoteProjectMap.has(project.id)) continue;
    await syncProjectToCloud(await loadModpackFiles(project)); uploaded++;
  }
  // Refresh the account's inactivity clock without re-uploading large archives.
  await api('/api/workspace', { method: 'POST' });
  const [packs, projectRows] = await Promise.all([getAllPacksFromDB(), getAllModpacksFromDB()]);
  const projects = await Promise.all(projectRows.map(loadModpackFiles));
  return { packs, projects, imported, uploaded };
}
