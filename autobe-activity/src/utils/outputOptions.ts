import type { MergedOutput } from '@/types/modpack';

/**
 * Choose which generated pack files are public downloads and which must be
 * retained privately to assemble a combined .mcaddon later.
 */
export function selectMergeOutputs(
  generatedParts: MergedOutput[],
  generateAddon: boolean,
  generateSeparatePacks: boolean
): { outputs: MergedOutput[]; bundleParts?: MergedOutput[] } {
  return {
    outputs: generateSeparatePacks ? generatedParts : [],
    ...(generateAddon && !generateSeparatePacks ? { bundleParts: generatedParts } : {})
  };
}
