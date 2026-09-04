import { defineConfig } from 'vitest/config';
import { nextAgentVitestAliases } from './vitest.aliases';

export default defineConfig({
  resolve: {
    alias: nextAgentVitestAliases,
  },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: [
      'packages/*/tests/**/*.contract.test.ts',
      'tests/TESTClaw/**',
      'tests/architecture/**',
      'tests/capability-source-configuration/**',
      'tests/contract/**',
      'tests/manual/**',
      'tests/smoke/daily-happy-path.test.ts',
      'node_modules/**',
      'dist/**',
    ],
    setupFiles: ['./tests/setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    globals: false,
  },
});
