import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { nextAgentVitestAliases } from '../../vitest.aliases';

export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  resolve: {
    alias: nextAgentVitestAliases,
  },
  test: {
    environment: 'node',
    include: ['packages/agent-app/tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    globals: false,
    testTimeout: 15_000,
  },
});
