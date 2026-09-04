import { defineConfig } from 'vitest/config';
import { nextAgentVitestAliases } from './vitest.aliases';

export default defineConfig({
  resolve: {
    alias: nextAgentVitestAliases,
  },
  test: {
    environment: 'node',
    include: ['tests/architecture/**/*.test.ts'],
    exclude: ['tests/TESTClaw/**', 'node_modules/**', 'dist/**'],
    globals: false,
    testTimeout: 15_000,
  },
});
