/**
 * Choose which generated pack files are public downloads and which must be
 * retained privately to assemble a combined .mcaddon later.
 */
export function selectMergeOutputs<T>(
  generatedParts: T[],
  generateAddon: boolean,
  generateSeparatePacks: boolean
): { outputs: T[]; bundleParts?: T[] } {
  return {
    outputs: generateSeparatePacks ? generatedParts : [],
    ...(generateAddon && !generateSeparatePacks ? { bundleParts: generatedParts } : {})
  };
}
