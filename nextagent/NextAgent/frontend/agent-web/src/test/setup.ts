// Polyfill for jsdom - Ant Design's responsive observer uses matchMedia
export {};

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }),
});

function ensureLocalStorage(): Storage {
  if (typeof window.localStorage?.setItem === 'function') {
    return window.localStorage;
  }

  const store = new Map<string, string>();
  const fallback: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: fallback,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: fallback,
  });
  return fallback;
}

ensureLocalStorage().setItem('nextagent.localePreference', 'zh-CN');

await import('../i18n/index.ts');
