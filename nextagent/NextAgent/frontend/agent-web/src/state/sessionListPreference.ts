import { RECENT_SESSION_LIMIT, SESSION_HISTORY_PAGE_LIMIT } from './sessionStore.ts';

export const SIDEBAR_SESSION_LIST_EXPANDED_STORAGE_KEY = 'nextagent.sidebar.sessionListExpanded';

function readSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readSessionListExpandedPreference(): boolean {
  return readSessionStorage()?.getItem(SIDEBAR_SESSION_LIST_EXPANDED_STORAGE_KEY) === 'true';
}

export function writeSessionListExpandedPreference(expanded: boolean): void {
  try {
    readSessionStorage()?.setItem(SIDEBAR_SESSION_LIST_EXPANDED_STORAGE_KEY, expanded ? 'true' : 'false');
  } catch {
    // A blocked sessionStorage should not break session navigation.
  }
}

export function getPreferredSessionListInitialLimit(): number {
  return readSessionListExpandedPreference() ? SESSION_HISTORY_PAGE_LIMIT : RECENT_SESSION_LIMIT;
}
