import { defineConfig } from 'vitest/config';
import { nextAgentVitestAliases } from './vitest.aliases';

export default defineConfig({
  resolve: {
    alias: nextAgentVitestAliases,
  },
  test: {
    environment: 'node',
    include: ['tests/contract/**/*.test.ts', 'packages/*/tests/**/*.contract.test.ts'],
    exclude: ['tests/TESTClaw/**', 'tests/e2e/**', 'node_modules/**', 'dist/**'],
    globals: false,
    testTimeout: 15_000,
  },
});
