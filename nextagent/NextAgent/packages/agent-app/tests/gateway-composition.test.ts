import type { FetchGateway, GatewayProvider, UserQueryGateway } from '@nextagent/agent-contracts/gateway';
import { createInMemoryMetricsRegistry } from '@nextagent/agent-observability';
import {
  createLocalGatewayProvider,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider,
} from '@nextagent/agent-platform-gateway-local';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDefaultSystemConfig } from '../src/config/system-config.js';
import { createAppCredentialResolver } from '../src/config/env.js';
import { loadAppCompositionConfiguration } from '../src/composition/configuration-composition.js';
import { createGatewayBindingsForSelection } from '../src/composition/gateway-composition.js';

describe('gateway composition', () => {
  it('accepts a selected remote user-query binding from an external provider', async () => {
    const fixture = await gatewayFixture();
    const userQuery: UserQueryGateway = {
      async queryUsers() {
        return { users: [] };
      },
    };
    const provider = remoteUserQueryProvider(userQuery);
    try {
      const bindings = createGatewayBindingsForSelection([provider], withRemoteUserQuerySelection(fixture.systemConfig), fixture.sandboxRuntimeInput);

      expect(bindings?.userQuery).toBe(userQuery);
      await bindings?.close?.();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('fails before ready when selected remote user-query has no provider or binding', async () => {
    const fixture = await gatewayFixture();
    const systemConfig = withRemoteUserQuerySelection(fixture.systemConfig);
    try {
      expect(() => createGatewayBindingsForSelection([], systemConfig, fixture.sandboxRuntimeInput)).toThrow(
        expect.objectContaining({ code: 'GATEWAY_PROVIDER_MISSING' }),
      );
      expect(() => createGatewayBindingsForSelection([remoteUserQueryProvider(undefined)], systemConfig, fixture.sandboxRuntimeInput)).toThrow(
        expect.objectContaining({ code: 'GATEWAY_BINDINGS_INCOMPLETE' }),
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects a user-query binding returned by a provider selected for another adapter', async () => {
    const fixture = await gatewayFixture();
    const userQuery: UserQueryGateway = {
      async queryUsers() {
        return { users: [] };
      },
    };
    const sandboxProvider: GatewayProvider = {
      providerId: 'remote-sandbox',
      deploymentMode: 'REMOTE',
      supportedAdapterKinds: ['sandbox'],
      create() {
        return {
          providerId: 'remote-sandbox',
          deploymentMode: 'REMOTE',
          readiness: {
            state: 'READY',
            evidenceRef: 'gateway-provider:remote-sandbox:ready',
            safeMessage: 'Remote sandbox provider is ready.',
          },
          sandbox: {
            async execute(request) {
              return {
                executionId: request.executionId,
                exitCode: 0,
                stdout: '',
                stderr: '',
                stdoutTruncated: false,
                stderrTruncated: false,
                timedOut: false,
                durationMs: 0,
              };
            },
          },
          userQuery,
        };
      },
    };
    const systemConfig = withRemoteUserQuerySelection(fixture.systemConfig);
    try {
      expect(() =>
        createGatewayBindingsForSelection(
          [remoteUserQueryProvider(userQuery), sandboxProvider],
          {
            ...systemConfig,
            gatewaySelection: {
              ...systemConfig.gatewaySelection,
              entries: [
                ...systemConfig.gatewaySelection.entries,
                {
                  gatewayId: 'remote-sandbox',
                  adapterKind: 'sandbox',
                  deploymentMode: 'REMOTE',
                  selectionState: 'enabled',
                },
              ],
            },
          },
          fixture.sandboxRuntimeInput,
        ),
      ).toThrow(
        expect.objectContaining({
          code: 'GATEWAY_BINDINGS_UNSELECTED',
          safeDetails: expect.objectContaining({ binding: 'userQuery' }),
        }),
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('merges one optional fetch binding without making it a selected adapter', async () => {
    const fixture = await gatewayFixture();
    const fetchGateway: FetchGateway = {
      async fetch() {
        return new Response(null, { status: 204 });
      },
    };
    try {
      const bindings = createGatewayBindingsForSelection(
        [
          withFetch(createSqliteWorkingMemoryGatewayProvider(), fetchGateway),
          createSqliteLongTermMemoryGatewayProvider(),
          createLocalGatewayProvider(),
        ],
        fixture.systemConfig,
        fixture.sandboxRuntimeInput,
      );

      expect(bindings?.fetch).toBe(fetchGateway);
      await bindings?.close?.();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('fails closed when multiple providers return a fetch binding', async () => {
    const fixture = await gatewayFixture();
    const fetchGateway: FetchGateway = {
      async fetch() {
        return new Response(null, { status: 204 });
      },
    };
    try {
      expect(() =>
        createGatewayBindingsForSelection(
          [
            withFetch(createSqliteWorkingMemoryGatewayProvider(), fetchGateway),
            withFetch(createSqliteLongTermMemoryGatewayProvider(), fetchGateway),
            createLocalGatewayProvider(),
          ],
          fixture.systemConfig,
          fixture.sandboxRuntimeInput,
        ),
      ).toThrow(
        expect.objectContaining({
          code: 'GATEWAY_BINDINGS_CONFLICT',
          safeDetails: { binding: 'fetch' },
        }),
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

function remoteUserQueryProvider(userQuery?: UserQueryGateway): GatewayProvider {
  return {
    providerId: 'remote-user-query',
    deploymentMode: 'REMOTE',
    supportedAdapterKinds: ['user-query'],
    create() {
      return {
        providerId: 'remote-user-query',
        deploymentMode: 'REMOTE',
        readiness: {
          state: 'READY',
          evidenceRef: 'gateway-provider:remote-user-query:ready',
          safeMessage: 'Remote user query provider is ready.',
        },
        ...(userQuery === undefined ? {} : { userQuery }),
      };
    },
  };
}

function withRemoteUserQuerySelection(systemConfig: Awaited<ReturnType<typeof gatewayFixture>>['systemConfig']) {
  return {
    ...systemConfig,
    gateway: { gatewayId: 'remote-user-query', gatewayKind: 'user-query' as const, deploymentMode: 'REMOTE' as const },
    gatewaySelection: {
      ...systemConfig.gatewaySelection,
      entries: [
        {
          gatewayId: 'remote-user-query',
          adapterKind: 'user-query' as const,
          deploymentMode: 'REMOTE' as const,
          selectionState: 'enabled' as const,
        },
      ],
    },
  };
}

function withFetch(provider: GatewayProvider, fetchGateway: FetchGateway): GatewayProvider {
  return {
    ...provider,
    create(input) {
      return {
        ...provider.create(input),
        fetch: fetchGateway,
      };
    },
  };
}

async function gatewayFixture() {
  const root = await mkdtemp(join(tmpdir(), 'nextagent-fetch-gateway-'));
  const credentialResolver = createAppCredentialResolver({
    OPENAI_API_KEY: 'test-only',
    OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
  });
  const systemConfig = resolveDefaultSystemConfig({ cwd: root, credentialResolver });
  const configuration = loadAppCompositionConfiguration({
    systemConfig,
    credentialResolver,
    metricsRegistry: createInMemoryMetricsRegistry(),
  });
  return {
    root,
    systemConfig,
    sandboxRuntimeInput: configuration.sandboxRuntimeInput,
  };
}
