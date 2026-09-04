import { defineConfig } from 'vitest/config';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '..');
const targetRoot = path.resolve(projectRoot, 'target');
const outputDir = path.resolve(projectRoot, 'test-output');

export default defineConfig({
  test: {
    root: projectRoot,
    include: ['tests/suites/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    reporters: ['default', 'json'],
    outputFile: path.resolve(outputDir, 'vitest-results.json'),
    globals: true,
    sequence: {
      sequential: true,
    },
  },
  resolve: {
    alias: {
      // Resolve contract subpaths from target/node_modules.
      '@nextagent/agent-app/testing': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-app', 'dist', 'testing.js'),
      '@nextagent/agent-contracts/runtime': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-contracts', 'dist', 'runtime', 'index.js'),
      '@nextagent/agent-contracts/gateway': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-contracts', 'dist', 'gateway', 'index.js'),
      '@nextagent/agent-contracts/channel': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-contracts', 'dist', 'channel', 'index.js'),
      '@nextagent/agent-contracts/session': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-contracts', 'dist', 'session', 'index.js'),
      '@nextagent/agent-contracts/model': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-contracts', 'dist', 'model', 'index.js'),
      '@nextagent/agent-contracts/capability': path.resolve(
        targetRoot,
        'node_modules',
        '@nextagent',
        'agent-contracts',
        'dist',
        'capability',
        'index.js',
      ),
      '@nextagent/agent-contracts/core': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-contracts', 'dist', 'core', 'index.js'),
      '@nextagent/agent-contracts/agent-assembly': path.resolve(
        targetRoot,
        'node_modules',
        '@nextagent',
        'agent-contracts',
        'dist',
        'agent-assembly',
        'index.js',
      ),
      // Resolve top-level workspace packages from target/node_modules.
      '@nextagent/agent-app': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-app'),
      '@nextagent/agent-common': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-common'),
      '@nextagent/agent-capability': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-capability'),
      '@nextagent/agent-core': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-core'),
      '@nextagent/agent-runtime': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-runtime'),
      '@nextagent/agent-session': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-session'),
      '@nextagent/agent-model': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-model'),
      '@nextagent/agent-platform-gateway-local': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-platform-gateway-local'),
      '@nextagent/agent-attachment-runtime': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-attachment-runtime'),
      '@nextagent/agent-context-engine': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-context-engine'),
      '@nextagent/agent-memory': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-memory'),
      '@nextagent/agent-observability': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-observability'),
      '@nextagent/agent-channel-web': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-channel-web'),
      '@nextagent/agent-channel-web-auth-local': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-channel-web-auth-local'),
      '@nextagent/agent-test-kit': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-test-kit'),
      '@nextagent/agent-web': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-web'),
      '@nextagent/agent-app-frontend-hosting': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-app-frontend-hosting'),
      '@nextagent/agent-platform-gateway-remote': path.resolve(targetRoot, 'node_modules', '@nextagent', 'agent-platform-gateway-remote'),
    },
  },
});
