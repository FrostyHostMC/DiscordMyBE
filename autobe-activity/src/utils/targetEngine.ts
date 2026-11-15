/** Compare numeric Bedrock engine versions without lexicographic ordering. */
function compareEngineVersions(a: string, b: string): number {
  const left = a.split('.').map(value => Number.parseInt(value, 10) || 0);
  const right = b.split('.').map(value => Number.parseInt(value, 10) || 0);
  for (let index = 0; index < 3; index++) {
    if ((left[index] || 0) !== (right[index] || 0)) {
      return (left[index] || 0) - (right[index] || 0);
    }
  }
  return 0;
}

/**
 * Resolve the generated manifest minimum engine version from the user's target
 * and the actual source pack requirements. This never claims to downgrade a
 * pack's compatibility requirement.
 */
export function resolveTargetEngineVersion(
  targetEngine: string | undefined,
  sourceVersions: string[],
  diagnostics: string[],
  outputLabel: string
): string {
  const normalizedTarget = /^\d+\.\d+(?:\.\d+)?$/.test(targetEngine || '')
    ? (targetEngine!.split('.').length === 2 ? `${targetEngine}.0` : targetEngine!)
    : '1.20.0';
  const sourceCandidates = sourceVersions.filter(value => /^\d+\.\d+(?:\.\d+)?$/.test(value || ''));
  const sourceMinimum = sourceCandidates.reduce((highest, value) =>
    compareEngineVersions(value, highest) > 0 ? value : highest, '1.13.0');
  const effective = compareEngineVersions(sourceMinimum, normalizedTarget) > 0
    ? sourceMinimum
    : normalizedTarget;

  if (compareEngineVersions(sourceMinimum, normalizedTarget) > 0) {
    diagnostics.push(`WARNING TARGET_ENGINE_RAISED [${outputLabel}]: You selected Bedrock ${normalizedTarget}, but at least one included add-on requires ${sourceMinimum}. This output declares ${effective} as its minimum; it cannot make newer add-ons compatible with older game versions.`);
  }
  return effective;
}
