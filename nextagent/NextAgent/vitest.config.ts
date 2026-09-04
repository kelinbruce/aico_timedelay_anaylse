import { defineConfig } from 'vitest/config';
import { nextAgentVitestAliases } from './vitest.aliases';

export default defineConfig({
  resolve: {
    alias: nextAgentVitestAliases,
  },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'tests/capability-source-configuration/**/*.test.ts', 'tests/process-fatal.test.ts'],
    exclude: [
      'packages/agent-app/tests/**',
      'packages/agent-capability/tests/**',
      'packages/agent-channel-web/tests/**',
      'packages/agent-context-engine/tests/**',
      'packages/agent-memory/tests/**',
      'packages/agent-session/tests/**',
      'packages/agent-platform-gateway-local/tests/**',
      'packages/agent-platform-gateway-remote/tests/**',
      'packages/*/tests/**/*.contract.test.ts',
      'tests/TESTClaw/**',
      'tests/architecture/**',
      'tests/agent-kernel/**',
      'tests/contract/**',
      'tests/e2e/**',
      'node_modules/**',
      'dist/**',
    ],
    globals: false,
    testTimeout: 15_000,
  },
});
