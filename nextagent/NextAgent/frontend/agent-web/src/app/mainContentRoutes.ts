export const FAVORITES_MAIN_CONTENT_PATH = '/favorites';
export const MEMORY_MAIN_CONTENT_PATH = '/memory';
export const COMPLAINT_MAIN_CONTENT_PATH = '/complaint-history';
export const KNOWLEDGE_MAIN_CONTENT_PATH = '/knowledge-import';

export type RoutedMainContentView = 'favorites' | 'memory' | 'knowledge' | 'complaint';
export type TransientMainContentView = 'history';

export function resolveRoutedMainContentView(pathname: string): RoutedMainContentView | null {
  if (pathname === FAVORITES_MAIN_CONTENT_PATH) {
    return 'favorites';
  }
  if (pathname === MEMORY_MAIN_CONTENT_PATH) {
    return 'memory';
  }
  if (pathname === KNOWLEDGE_MAIN_CONTENT_PATH) {
    return 'knowledge';
  }
  if (pathname === COMPLAINT_MAIN_CONTENT_PATH) {
    return 'complaint';
  }
  return null;
}

export function resolveTransientMainContentView(state: unknown): TransientMainContentView | null {
  if (typeof state !== 'object' || state === null) {
    return null;
  }
  const mainContentView = Reflect.get(state, 'mainContentView');
  return mainContentView === 'history' ? mainContentView : null;
}

export function createTransientMainContentState(mainContentView: TransientMainContentView) {
  return { mainContentView } as const;
}

export function buildHashRouteTarget(pathname: string, search: string): string {
  return `${pathname}${search}`;
}
