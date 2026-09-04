import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const captures = vi.hoisted(() => ({
  appOptions: [] as Array<Record<string, unknown>>,
  manifest: {
    version: '0.1.0',
    candidateId: 'remote-candidate-007',
    configSampleRefs: ['config/remote.yaml'],
  },
}));

vi.mock('@nextagent/agent-app', () => ({
  createNextAgentApp: vi.fn((options: Record<string, unknown>) => {
    captures.appOptions.push(options);
    return {};
  }),
  createNextAgentAppAsync: vi.fn(async (options: Record<string, unknown>) => {
    captures.appOptions.push(options);
    return {
      start: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      systemConfig: {
        gateway: { deploymentMode: 'REMOTE' },
        gatewaySelection: { diagnosticRef: 'gateway-selection' },
      },
    };
  }),
}));

vi.mock('@nextagent/agent-app/local-runtime-package', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nextagent/agent-app/local-runtime-package')>();
  return {
    ...actual,
    readLocalRuntimePackageManifest: vi.fn(() => captures.manifest),
    checkLocalRuntimePackageLayout: vi.fn(() => []),
    validateLocalRuntimePackageConfigSample: vi.fn(() => []),
  };
});

vi.mock('@nextagent/agent-platform-gateway-local', () => ({
  createSqliteWorkingMemoryGatewayProvider: vi.fn(() => ({ providerId: 'working-memory' })),
  createSqliteLongTermMemoryGatewayProvider: vi.fn(() => ({ providerId: 'long-term-memory' })),
  createRemoteSupportLocalGatewayProvider: vi.fn(() => ({ providerId: 'remote-support-local' })),
}));

vi.mock('@nextagent/agent-platform-gateway-remote', () => ({
  createReferenceRemoteModelGatewayProvider: vi.fn(),
  createReferenceRemoteRagRetrievalGateway: vi.fn(),
  createReferenceRemoteSandboxGateway: vi.fn(),
  createRemoteGatewayProvider: vi.fn(() => ({ providerId: 'remote' })),
}));

import { createRemoteNextAgentApp, startRemoteRuntimePackage, stopRemoteRuntimePackage } from '../src/index.js';

describe('remote runtime package service version', () => {
  const roots: string[] = [];

  afterEach(async () => {
    captures.appOptions.splice(0);
    await Promise.all(
      roots.splice(0).map(async (root) => {
        await stopRemoteRuntimePackage(root);
        rmSync(root, { recursive: true, force: true });
      }),
    );
  });

  it('binds manifest version and candidateId to the app serviceVersion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-remote-version-'));
    roots.push(root);

    await startRemoteRuntimePackage(root);

    expect(captures.appOptions).toHaveLength(1);
    expect(captures.appOptions[0]).toMatchObject({
      serviceVersion: '0.1.0+remote-candidate-007',
    });
    expect(captures.appOptions[0]).not.toHaveProperty('webIdentityResolver');
  });

  it('does not install a default Web identity resolver for the programmatic REMOTE app', () => {
    createRemoteNextAgentApp({
      remoteGatewayClients: { sandbox: {} as never, ragRetrieval: {} as never },
    });

    expect(captures.appOptions[0]).not.toHaveProperty('webIdentityResolver');
  });

  it('preserves an explicitly injected product Web identity resolver', () => {
    const productResolver = vi.fn();
    createRemoteNextAgentApp({
      remoteGatewayClients: { sandbox: {} as never, ragRetrieval: {} as never },
      webIdentityResolver: productResolver,
    });

    expect(captures.appOptions[0]).toMatchObject({ webIdentityResolver: productResolver });
  });
});
