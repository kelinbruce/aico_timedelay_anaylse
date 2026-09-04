/// <reference types="vite/client" />

declare const __NEXTAGENT_PACKAGE_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_BACKEND_BASE_URL?: string;
  readonly VITE_TRANSPORT_KIND?: string;
  readonly VITE_AUTH_FLAVOR?: 'local-and-iam' | 'iam-only';
  readonly VITE_BASE?: string;
  // Public API path prefix P, fixed at build time (e.g. /svcA). Empty/`/` = no
  // prefix. Set via --apiUrlPrefix CLI arg in build-modes.mjs.
  readonly VITE_API_URL_PREFIX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
