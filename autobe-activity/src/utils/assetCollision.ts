import JSZip from 'jszip';

const BINARY_ASSET_EXTENSIONS = /\.(png|tga|jpg|jpeg|webp|ogg|wav|mp3|m4a|bin|materialbin)$/i;

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
  const replacements = [...pathMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [oldPath, newPath] of replacements) {
    output = output.split(oldPath).join(newPath);
    const oldWithoutExtension = oldPath.replace(/\.(png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\.json)$/i, '');
    const newWithoutExtension = newPath.replace(/\.(png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\.json)$/i, '');
    if (oldWithoutExtension !== oldPath) output = output.split(oldWithoutExtension).join(newWithoutExtension);
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
    const renamed = uniqueAssetPath(targetZip, normalizedPath, sourceLabel);
    pathMap.set(sourcePath, renamed);
    pathMap.set(normalizedPath, renamed);
    diagnostics?.push(`WARNING ASSET_PATH_COLLISION [${normalizedPath}]: Different add-ons supplied different binary assets at the same path. Preserved this add-on's file as ${renamed} and rewrote explicit matching references where found.`);
  }
  return pathMap;
}
