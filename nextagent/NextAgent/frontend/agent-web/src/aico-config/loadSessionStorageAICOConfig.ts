import { validateAICOConfig } from './validateAICOConfig.ts';
import { aicoConfigStore } from './AICOConfigStore.ts';
import { reportWarning } from '../utils/diagnostics.ts';

const AICO_CONFIG_STORAGE_KEY = 'AICOConfig';

/**
 * Local and immersive hosts ingest AICOConfig once at page startup.
 * The caller owns the exactly-once lifecycle; this function does not poll,
 * subscribe, or retain a second configuration snapshot.
 */
export function loadSessionStorageAICOConfig(): void {
  let rawText: string | null;
  try {
    rawText = sessionStorage.getItem(AICO_CONFIG_STORAGE_KEY);
  } catch {
    return;
  }
  if (rawText === null) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    reportWarning(`[AICOConfig] Failed to parse sessionStorage["${AICO_CONFIG_STORAGE_KEY}"] as JSON; falling back to defaults.`);
    return;
  }

  const config = validateAICOConfig(parsed);
  if (config) {
    aicoConfigStore.setConfig(config);
  }
}
