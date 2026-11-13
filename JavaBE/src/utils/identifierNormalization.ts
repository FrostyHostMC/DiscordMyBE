/** Canonical normalization for archive asset paths and Java-style identifiers. */
export function normalizeAssetPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^[a-z0-9_.-]+:/i, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .toLowerCase();
}

/**
 * Normalizes namespaced IDs, file names, and nested asset paths to one comparable key.
 * Namespace and separators are intentionally excluded from the comparison key.
 */
export function normalizeAssetIdentifier(value: string): string {
  return normalizeAssetPath(value)
    .replace(/\.(?:json|png|jpe?g|tga)$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Finds identifiers that collapse to the same canonical key without discarding either value. */
export function findDuplicateIdentifierGroups(values: string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const value of values) {
    const key = normalizeAssetIdentifier(value);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}