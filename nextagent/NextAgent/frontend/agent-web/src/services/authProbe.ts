import { apiClient } from './apiClient.ts';

let authProbePromise: Promise<void> | null = null;

export function probeAuthChallenge(): Promise<void> {
  if (authProbePromise) {
    return authProbePromise;
  }

  authProbePromise = apiClient
    .get<unknown>('/api/v1/sessions?offset=0&limit=1', {
      headers: { 'x-non-renewal-session': 'true' },
    })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      authProbePromise = null;
    });

  return authProbePromise;
}
