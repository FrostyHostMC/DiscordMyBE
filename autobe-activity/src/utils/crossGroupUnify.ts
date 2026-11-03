import type JSZip from 'jszip';
import { sanitizeJsonString } from './addonParser';
import { mergeAdditions } from './conservativeMerge';

/** Separate behavior packs are already loaded together by Bedrock. Copying every
 * definition into every group creates redundant overrides, and rewriting the
 * player in all groups can change behavior. Report player conflicts instead. */
export async function unifyCrossGroupBps(zips: JSZip[], diagnostics: string[] = []): Promise<void> {
  if (zips.length < 2) return;
  const players: Array<{ group: number; path: string; data: any }> = [];
  for (let group = 0; group < zips.length; group++) {
    for (const [path, file] of Object.entries(zips[group].files)) {
      if (file.dir || !path.toLowerCase().startsWith('entities/') || !path.toLowerCase().endsWith('.json')) continue;
      try {
        const data = JSON.parse(sanitizeJsonString(await file.async('text')));
        if (data?.['minecraft:entity']?.description?.identifier === 'minecraft:player') players.push({ group, path, data });
      } catch { /* The regular validator reports invalid JSON. */ }
    }
  }
  if (players.some(player => player.group !== players[0]?.group &&
    (mergeAdditions(players[0].data, player.data).changed || mergeAdditions(players[0].data, player.data).conflicts.length))) {
    diagnostics.push('WARNING CROSS_GROUP_PLAYER_CONFLICT [behavior outputs]: Multiple behavior outputs define different minecraft:player entities. Their original files were preserved in their own packs; Minecraft pack order can determine the active definition. Review these overrides manually.');
  }
}
