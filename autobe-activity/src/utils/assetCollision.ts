import JSZip from 'jszip';

const BINARY_ASSET_EXTENSIONS = /\.(png|tga|jpg|jpeg|webp|ogg|wav|mp3|m4a|bin|materialbin)$/i;

// Vanilla-facing paths must keep their expected names; blindly renaming them can break Minecraft references.
const VANILLA_OVERRIDE_PATHS = [
  /^textures\/(items|item|blocks|block|entity|models|environment|particle)\//i,
  /^textures\/gui\//i,
  /^textures\/models\/armor\//i,
  /^textures\/entity\/armor\//i
];

export function isVanillaOverridePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return VANILLA_OVERRIDE_PATHS.some(pattern => pattern.test(normalized));
}

export function uniqueAssetPath(targetZip: JSZip, originalPath: string, sourceLabel: string): string {
  const slash = originalPath.lastIndexOf('/');
  const dir = slash >= 0 ? originalPath.slice(0, slash + 1) : '';
  const filename = slash >= 0 ? originalPath.slice(slash + 1) : originalPath;
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  const slug = sourceLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 18) || 'addon';
  let candidate = `${dir}${stem}__${slug}${ext}`;
  let suffix = 2;
  while (targetZip.file(candidate)) candidate = `${dir}${stem}__${slug}_${suffix++}${ext}`;
  return candidate;
}

export function rewriteAssetReferences(text: string, pathMap: Map<string, string>): string {
  let output = text;
  const replacePath = (oldPath: string, newPath: string) => {
    const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Do not rewrite a longer path merely because it begins with this one.
    const expression = new RegExp(`(^|[^A-Za-z0-9_./-])${escaped}(?![A-Za-z0-9_./-])`, 'g');
    output = output.replace(expression, (_match, before) => before + newPath);
  };
  const replacements = [...pathMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [oldPath, newPath] of replacements) {
    replacePath(oldPath, newPath);
    const oldWithoutExtension = oldPath.replace(/\.(png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\.json)$/i, '');
    const newWithoutExtension = newPath.replace(/\.(png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\.json)$/i, '');
    if (oldWithoutExtension !== oldPath) replacePath(oldWithoutExtension, newWithoutExtension);
  }
  return output;
}

export async function planBinaryAssetCollisions(
  sourceZip: JSZip,
  targetZip: JSZip,
  sourceLabel: string,
  pathTransform?: (path: string) => string,
  diagnostics?: string[]
): Promise<Map<string, string>> {
  const pathMap = new Map<string, string>();
  for (const [sourcePath, sourceFile] of Object.entries(sourceZip.files)) {
    if (sourceFile.dir || !BINARY_ASSET_EXTENSIONS.test(sourcePath)) continue;
    const normalizedPath = pathTransform ? pathTransform(sourcePath) : sourcePath;
    const existing = targetZip.file(normalizedPath);
    if (!existing) continue;
    const [incomingBytes, existingBytes] = await Promise.all([
      sourceFile.async('uint8array'),
      existing.async('uint8array')
    ]);
    if (incomingBytes.length === existingBytes.length && incomingBytes.every((byte, index) => byte === existingBytes[index])) continue;
    if (isVanillaOverridePath(normalizedPath)) {
      diagnostics?.push('WARNING VANILLA_ASSET_CONFLICT [' + normalizedPath + ']: Multiple add-ons change a vanilla-facing asset. AutoBE will not rename this path because Minecraft may rely on its original name. An explicit keep-this-add-on choice is required; current merge order determines the temporary winner.');
      continue;
    }
    const renamed = uniqueAssetPath(targetZip, normalizedPath, sourceLabel);
    pathMap.set(sourcePath, renamed);
    pathMap.set(normalizedPath, renamed);
    diagnostics?.push(`WARNING ASSET_PATH_COLLISION [${normalizedPath}]: Different add-ons supplied different binary assets at the same path. Preserved this add-on's file as ${renamed} and rewrote explicit matching references where found.`);
  }
  return pathMap;
}

export async function applyVanillaAssetResolutions(
  targetZip: JSZip,
  packs: Array<{ id: string; name: string; type: string; fileBlob?: Blob }>,
  conflicts: Array<{ type: string; resolution: string; identifier: string; packA: { id: string; name: string }; packB: { id: string; name: string } }>,
  packType: string,
  diagnostics: string[]
): Promise<void> {
  for (const conflict of conflicts) {
    if (conflict.type !== 'vanilla_asset' || (conflict.resolution !== 'keep_a' && conflict.resolution !== 'keep_b')) continue;
    const selected = conflict.resolution === 'keep_b' ? conflict.packB : conflict.packA;
    const winner = packs.find(pack => pack.id === selected.id && pack.type === packType);
    if (!winner?.fileBlob) continue;
    const sourceZip = await JSZip.loadAsync(winner.fileBlob);
    const sourcePath = Object.keys(sourceZip.files).find(path => path.toLowerCase() === conflict.identifier.toLowerCase());
    const sourceFile = sourcePath ? sourceZip.file(sourcePath) : null;
    if (!sourceFile) {
      diagnostics.push(`WARNING VANILLA_OVERRIDE_CHOICE [${conflict.identifier}]: Selected add-on "${winner.name}" no longer contains this asset; kept the existing merged version.`);
      continue;
    }
    targetZip.file(conflict.identifier, await sourceFile.async('uint8array'));
    diagnostics.push(`INFO VANILLA_OVERRIDE_CHOICE [${conflict.identifier}]: Kept the version supplied by "${winner.name}" as requested.`);
  }
}
