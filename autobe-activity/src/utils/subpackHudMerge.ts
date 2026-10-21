import JSZip from 'jszip';

/**
 * Port of AutoBE._deep_merge_dicts with _combine_visible=True:
 * - dicts merge recursively
 * - lists are replaced (except 'modifications', which concatenates)
 * - string 'visible' conditions combine with && so each pack's visibility survives
 */
export function deepMergeUi(base: any, overlay: any): any {
  for (const k of Object.keys(overlay)) {
    const v = overlay[k];
    if (k in base && typeof base[k] === 'object' && base[k] !== null && typeof v === 'object' && v !== null && !Array.isArray(base[k]) && !Array.isArray(v)) {
      deepMergeUi(base[k], v);
    } else if (k === 'visible' && typeof base[k] === 'string' && typeof v === 'string' && base[k] !== v) {
      base[k] = `(${base[k]}) && (${v})`;
    } else if (k === 'modifications' && Array.isArray(base[k]) && Array.isArray(v)) {
      base[k] = base[k].concat(v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

/**
 * Port of AutoBE._merge_subpack_hud_files: for every subpack inside the merged
 * RP that contains ui/hud_screen.json, merge the merged-root hud_screen into
 * that subpack file so selecting a subpack variant does not discard the merged
 * root HUD patches. Root is the base; subpack changes apply on top (last-wins).
 */
export async function mergeSubpackHudFiles(rpZip: JSZip): Promise<void> {
  const rootHudFile = rpZip.file('ui/hud_screen.json');
  if (!rootHudFile) return;
  let rootHud: any;
  try {
    rootHud = JSON.parse(await rootHudFile.async('text'));
  } catch {
    return;
  }
  const subPaths: string[] = [];
  rpZip.forEach((path, f) => {
    if (!f.dir && path.toLowerCase().startsWith('subpacks/') && path.toLowerCase().endsWith('/ui/hud_screen.json')) {
      subPaths.push(path);
    }
  });
  for (const subPath of subPaths) {
    try {
      const subData = JSON.parse(await (rpZip.file(subPath) as JSZip.JSZipObject).async('text'));
      const combined = JSON.parse(JSON.stringify(rootHud));
      deepMergeUi(combined, subData);
      rpZip.file(subPath, JSON.stringify(combined, null, 2));
    } catch {
      // skip unreadable subpack HUD
    }
  }
}