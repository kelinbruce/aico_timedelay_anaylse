import { defineConfig } from 'vitest/config';
import { nextAgentVitestAliases } from './vitest.aliases';

export default defineConfig({
  resolve: {
    alias: nextAgentVitestAliases,
  },
  test: {
    environment: 'node',
    include: ['packages/agent-channel-web/tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    hookTimeout: 60_000,
    globals: false,
  },
});
