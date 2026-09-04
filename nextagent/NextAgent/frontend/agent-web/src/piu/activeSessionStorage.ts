export const AI_AGENT_PIU_ACTIVE_SESSION_STORAGE_KEY = 'nextagent:AICOPIU:activeSessionId';

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readAIAgentPiuActiveSessionId(): string | null {
  const storage = getSessionStorage();
  if (!storage) {
    return null;
  }
  try {
    const sessionId = storage.getItem(AI_AGENT_PIU_ACTIVE_SESSION_STORAGE_KEY)?.trim() ?? '';
    return sessionId.length > 0 ? sessionId : null;
  } catch {
    return null;
  }
}

export function writeAIAgentPiuActiveSessionId(sessionId: string | null): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }
  try {
    const normalized = sessionId?.trim() ?? '';
    if (normalized.length === 0) {
      storage.removeItem(AI_AGENT_PIU_ACTIVE_SESSION_STORAGE_KEY);
      return;
    }
    storage.setItem(AI_AGENT_PIU_ACTIVE_SESSION_STORAGE_KEY, normalized);
  } catch {
    // Storage can be unavailable in privacy-restricted host pages; runtime state still works for the current mount.
  }
}
