import type { AliasOptions } from 'vite';

const resolvePath = (relativePath: string): string => decodeURIComponent(new URL(relativePath, import.meta.url).pathname);

export const nextAgentVitestAliases: AliasOptions = [
  {
    find: /^@nextagent\/agent-contracts\/(.+)$/,
    replacement: resolvePath('./packages/agent-contracts/src/$1/index.ts'),
  },
  {
    find: '@nextagent/agent-app/local-runtime-package',
    replacement: resolvePath('./packages/agent-app/src/local-runtime-package/index.ts'),
  },
  {
    find: '@nextagent/agent-app/config',
    replacement: resolvePath('./packages/agent-app/src/config/system-config.ts'),
  },
  {
    find: /^@nextagent\/agent-app\/(.+)$/,
    replacement: resolvePath('./packages/agent-app/src/$1.ts'),
  },
  {
    find: '@nextagent/agent-model/testing',
    replacement: resolvePath('./packages/agent-model/src/testing/index.ts'),
  },
  {
    find: '@nextagent/agent-model/providers/openai-compatible',
    replacement: resolvePath('./packages/agent-model/src/providers/openai-compatible/registration.ts'),
  },
  {
    find: '@nextagent/agent-plugin-sdk/scaffold',
    replacement: resolvePath('./packages/agent-plugin-sdk/src/scaffold/index.ts'),
  },
  {
    find: '@nextagent/agent-plugin-sdk/developer-hook-trace',
    replacement: resolvePath('./packages/agent-plugin-sdk/src/developer-hook-trace.ts'),
  },
  {
    find: '@nextagent/agent-plugin-sdk/context-monitor',
    replacement: resolvePath('./packages/agent-plugin-sdk/src/context-monitor.ts'),
  },
  {
    find: '@nextagent/agent-plugin-sdk/northbound-output-normalization-hook',
    replacement: resolvePath('./packages/agent-plugin-sdk/src/northbound-output-normalization-hook.ts'),
  },
  {
    find: '@nextagent/agent-platform-gateway-local/entrypoints/local',
    replacement: resolvePath('./packages/agent-platform-gateway-local/src/entrypoints/local.ts'),
  },
  {
    find: '@nextagent/agent-platform-gateway-local/testing',
    replacement: resolvePath('./packages/agent-platform-gateway-local/src/testing.ts'),
  },
  {
    find: '@nextagent/agent-common',
    replacement: resolvePath('./packages/agent-common/src/index.ts'),
  },
  {
    find: '@nextagent/agent-contracts',
    replacement: resolvePath('./packages/agent-contracts/src/index.ts'),
  },
  {
    find: '@nextagent/agent-app',
    replacement: resolvePath('./packages/agent-app/src/index.ts'),
  },
  {
    find: '@nextagent/agent-test-kit',
    replacement: resolvePath('./packages/agent-test-kit/src/index.ts'),
  },
  {
    find: /^@nextagent\/(.+)$/,
    replacement: resolvePath('./packages/$1/src/index.ts'),
  },
];
