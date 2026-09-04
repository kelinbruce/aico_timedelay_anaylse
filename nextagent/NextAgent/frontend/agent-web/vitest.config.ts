import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname),
  define: {
    'import.meta.env.VITE_AUTH_FLAVOR': JSON.stringify('local-and-iam'),
  },
  resolve: {
    alias: {
      '#auth/LocalLoginPage': path.resolve(__dirname, 'src/features/auth/LocalLoginPage.local.tsx'),
      '@cloudsop/dsl-engine-web/genui-components': path.resolve(__dirname, 'src/vendor/dsl-engine-genui-components-stub.tsx'),
      '@cloudsop/dsl-engine-web': path.resolve(__dirname, 'src/vendor/dsl-engine-stub.tsx'),
    },
  },
  test: {
    environment: 'jsdom',
    cache: false,
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['src/test/setup.ts'],
  },
});
