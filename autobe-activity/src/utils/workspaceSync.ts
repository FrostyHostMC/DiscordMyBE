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
const CLOUD_METADATA_BUDGET = 240 * 1024;

function stripOversizedInlineImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOversizedInlineImages);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    // Icons are presentation-only. Large data URLs can make a small project
    // metadata record exceed the server's 256 KiB limit; omit only the image,
    // retaining all pack/project identity and merge information.
    if (/^(?:iconDataUrl|icon_data_url)$/i.test(key)
      && typeof child === 'string'
      && child.startsWith('data:image/')
      && child.length > 24 * 1024) continue;
    result[key] = stripOversizedInlineImages(child);
  }
  return result;
}
function compactProjectExtras(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const extras = { ...(value as Record<string, unknown>) };
  // Full diagnostics and the complete report are already preserved in the
  // downloadable combined .mcaddon. Cloud metadata only needs the findings
  // used by the restored project's conflict-review indicator.
  delete extras.diagnosticsText;
  if (typeof extras.reportJson === 'string') {
    try {
      const report = JSON.parse(extras.reportJson) as { findings?: unknown[] };
      extras.reportJson = JSON.stringify({
        findings: (report.findings || []).slice(0, 250).map((finding: any) => ({
          code: finding?.code,
          path: typeof finding?.path === 'string' ? finding.path.slice(0, 1000) : '',
          message: typeof finding?.message === 'string' ? finding.message.slice(0, 1200) : '',
        })),
        truncated: (report.findings || []).length > 250,
      });
    } catch {
      delete extras.reportJson;
    }
  }
  return extras;
}
function assertCloudMetadataSize(data: Record<string, unknown>, label: string): Record<string, unknown> {
  const bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
  if (bytes > CLOUD_METADATA_BUDGET) {
    throw new Error(`${label} metadata is ${Math.ceil(bytes / 1024)} KB after compaction; the server limit is 256 KB. Full output files remain stored separately and your local copy is safe. Your local copy and addon files are safe.`);
  }
  return data;
}
function packData(pack: AddonPack): Record<string, unknown> {
  const { fileBlob: _fileBlob, ...data } = pack; void _fileBlob;
  return assertCloudMetadataSize(stripOversizedInlineImages(data) as Record<string, unknown>, `Pack "${pack.name}"`);
}
function stripProjectIcons(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripProjectIcons);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:iconDataUrl|icon_data_url)$/i.test(key)) continue;
    result[key] = stripProjectIcons(child);
  }
  return result;
}
function projectData(project: MergedModpack): Record<string, unknown> {
  const { outputBlob: _outputBlob, outputs, ...data } = project; void _outputBlob;
  const metadata = {
    ...data,
    ...(data.combinedExtras ? { combinedExtras: compactProjectExtras(data.combinedExtras) } : {}),
    outputs: (outputs || []).map(({ blob: _blob, ...out }) => { void _blob; return out; }),
  };
  // Source-pack icons are useful locally but are not required to restore a
  // project: the output files and the compact included-pack descriptors are
  // stored separately. Remove every embedded image from project cloud metadata
  // so several individually-small data URLs cannot collectively exceed D1's cap.
  const withoutProjectIcons = stripProjectIcons(metadata);
  return assertCloudMetadataSize(withoutProjectIcons as Record<string, unknown>, `Project "${project.name}"`);
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
export async function deleteWorkspaceItemsFromCloud(items: Array<{ type: 'pack' | 'project'; id: string }>): Promise<void> {
  if (items.length === 0) return;
  await api('/api/workspace', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  });
}
export async function deleteWorkspaceItemFromCloud(type: 'pack' | 'project', id: string): Promise<void> {
  await deleteWorkspaceItemsFromCloud([{ type, id }]);
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
