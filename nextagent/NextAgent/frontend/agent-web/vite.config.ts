import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createPreludeMockSource } from './scripts/prelude-mock-source.mjs';

const repoRoot = path.resolve(__dirname, '..', '..');
const rootPackage = JSON.parse(readFileSync(path.resolve(repoRoot, 'package.json'), 'utf8')) as { version: string };
const packageVersion = rootPackage.version;
const preludePath = '/febs/v1/assets/prelude-loader';

export default defineConfig(({ mode }) => {
  // Load .env files first, then check process.env (which includes vars set by start script)
  const envFromFile = loadEnv(mode, process.cwd(), 'VITE_');
  const proxyTarget = process.env.VITE_PROXY_TARGET || envFromFile.VITE_PROXY_TARGET || 'http://localhost:3001';
  const devHost = process.env.VITE_DEV_HOST || envFromFile.VITE_DEV_HOST || '127.0.0.1';
  const authFlavor = process.env.VITE_AUTH_FLAVOR || envFromFile.VITE_AUTH_FLAVOR || (mode === 'iam-only' ? 'iam-only' : 'local-and-iam');
  const localLoginModule =
    authFlavor === 'iam-only'
      ? path.resolve(__dirname, 'src/features/auth/LocalLoginPage.iam-only.tsx')
      : path.resolve(__dirname, 'src/features/auth/LocalLoginPage.local.tsx');
  const buildTarget = process.env.VITE_BUILD_TARGET || envFromFile.VITE_BUILD_TARGET || mode;
  const base = process.env.VITE_BASE || envFromFile.VITE_BASE || undefined;

  return {
    publicDir: buildTarget === 'piu' ? false : 'public',
    ...(base ? { base } : {}),
    define: {
      'import.meta.env.VITE_AUTH_FLAVOR': JSON.stringify(authFlavor),
      __NEXTAGENT_PACKAGE_VERSION__: JSON.stringify(packageVersion),
      ...(buildTarget === 'piu' ? { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production') } : {}),
    },
    plugins: [multiHostDevRoutesPlugin(packageVersion)],
    server: {
      host: devHost,
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          ws: true,
          configure: (proxy) => {
            // SSE 需要特殊处理 transfer encoding
            proxy.on('proxyRes', (proxyRes) => {
              if (proxyRes.headers['transfer-encoding']) {
                delete proxyRes.headers['transfer-encoding'];
              }
            });
          },
        },
        '/rest': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '#auth/LocalLoginPage': localLoginModule,
        '@cloudsop/dsl-engine-web/genui-components':
          mode === 'production'
            ? '@cloudsop/dsl-engine-web/genui-components'
            : path.resolve(__dirname, 'src/vendor/dsl-engine-genui-components-stub.tsx'),
        '@cloudsop/dsl-engine-web': mode === 'production' ? '@cloudsop/dsl-engine-web' : path.resolve(__dirname, 'src/vendor/dsl-engine-stub.tsx'),
      },
    },
    build: buildConfigForTarget(buildTarget),
  };
});

function multiHostDevRoutesPlugin(version: string) {
  return {
    name: 'nextagent-agent-web-multi-host-dev-routes',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const requestUrl = req.url ?? '/';
        const pathname = new URL(requestUrl, 'http://nextagent.dev').pathname;

        if (pathname === preludePath) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.end(createPreludeMockSource({ defaultVersion: version }));
          return;
        }

        if (!isHtmlNavigation(req) || isNonFallbackPath(pathname)) {
          next();
          return;
        }

        if (pathname === '/immersive' || pathname === '/immersive/' || pathname === '/immersive.html' || pathname.startsWith('/immersive/')) {
          req.url = '/immersive.html';
          next();
          return;
        }

        if (
          pathname === '/collaborative' ||
          pathname === '/collaborative/' ||
          pathname === '/collaborative.html' ||
          pathname.startsWith('/collaborative/')
        ) {
          req.url = '/collaborative.html';
          next();
          return;
        }

        if (pathname === '/' || pathname === '/index.html' || !path.extname(pathname)) {
          req.url = '/index.html';
        }
        next();
      });
    },
  };
}

function isHtmlNavigation(req: { readonly headers?: Record<string, string | string[] | undefined> }): boolean {
  const accept = String(req.headers?.accept ?? '');
  return accept.includes('text/html');
}

function isNonFallbackPath(pathname: string): boolean {
  return (
    pathname === preludePath ||
    pathname.startsWith('/api/') ||
    pathname === '/api' ||
    pathname.startsWith('/@vite/') ||
    pathname.startsWith('/src/') ||
    pathname.startsWith('/assets/')
  );
}

function buildConfigForTarget(buildTarget: string) {
  if (buildTarget === 'multi-host-page') {
    return {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'immersive.html'),
      },
    };
  }

  if (buildTarget === 'piu') {
    return {
      outDir: 'dist/piu',
      emptyOutDir: false,
      cssCodeSplit: false,
      assetsInlineLimit: 300000,
      lib: {
        entry: path.resolve(__dirname, 'src/entries/piu.tsx'),
        name: 'AIAgentPIU',
        formats: ['iife'],
        fileName: () => 'AIAgentPIU.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          entryFileNames: 'AIAgentPIU.js',
          assetFileNames: (assetInfo: { readonly name?: string }) => (assetInfo.name?.endsWith('.css') ? 'AIAgentPIU.css' : '[name][extname]'),
        },
      },
    };
  }

  return undefined;
}
