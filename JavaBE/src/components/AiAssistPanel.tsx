import type { DecompileStats } from '@/types/remaker';

interface Props {
  accent: string;
  modContext: string | null;
  onPortPlan: (brief: string, stats: DecompileStats) => void;
}

/**
 * AI assistance was intentionally removed from JavaBE.
 * The Activity is a standalone Java-to-Bedrock converter and must not depend
 * on Aippy or any external app-host runtime.
 */
export function AiAssistPanel(_props: Props) {
  return null;
}
