import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Gateway provider injection architecture boundary', () => {
  it('keeps the shared gateway module on the GatewayProvider SPI and local factories in async host defaults', () => {
    const createAppSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-app.ts'), 'utf8');
    const gatewayCompositionSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'gateway-composition.ts'), 'utf8');
    const workflowRemoteBridgeSource = readFileSync(join(root, 'packages', 'agent-workflow', 'src', 'workflow-remote-bridge.ts'), 'utf8');
    const packageManifest = JSON.parse(readFileSync(join(root, 'packages', 'agent-app', 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, unknown>;
    };

    expect(gatewayCompositionSource).not.toMatch(/\bcreateLocalGatewayProvider\b/u);
    expect(gatewayCompositionSource).not.toMatch(/\bcreateRemoteGatewayProvider\b/u);
    expect(gatewayCompositionSource).not.toContain('@nextagent/agent-platform-gateway-local');
    expect(gatewayCompositionSource).not.toContain('@nextagent/agent-platform-gateway-remote');
    expect(createAppSource).toContain('needsLocalFrontendDefaults');
    expect(createAppSource.match(/localGateway\.createLocalGatewayProvider\(/gu)).toHaveLength(1);
    expect(createAppSource).not.toMatch(/\bcreateRemoteGatewayProvider\b/u);
    expect(workflowRemoteBridgeSource).not.toContain('@nextagent/agent-platform-gateway-remote');
    expect(packageManifest.dependencies).not.toHaveProperty('@nextagent/agent-platform-gateway-local');
    expect(packageManifest.dependencies).not.toHaveProperty('@nextagent/agent-platform-gateway-remote');
  });

  it('keeps concrete provider imports at product entrypoints', () => {
    const localEntrypoint = readFileSync(join(root, 'packages', 'agent-platform-gateway-local', 'src', 'entrypoints', 'local.ts'), 'utf8');
    const packageManifest = JSON.parse(readFileSync(join(root, 'packages', 'agent-platform-gateway-local', 'package.json'), 'utf8')) as {
      readonly exports?: Record<string, unknown>;
    };

    expect(localEntrypoint).toContain('createLocalGatewayProvider');
    expect(packageManifest.exports).toHaveProperty('./entrypoints/local');
  });

  it('keeps the in-repo remote gateway package as implementation reference only', () => {
    const remotePackageManifest = JSON.parse(readFileSync(join(root, 'packages', 'agent-platform-gateway-remote', 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, unknown>;
      readonly exports?: Record<string, unknown>;
    };
    const remoteProvider = readFileSync(
      join(root, 'packages', 'agent-platform-gateway-remote', 'src', 'providers', 'remote-gateway-provider.ts'),
      'utf8',
    );

    expect(remotePackageManifest.exports).not.toHaveProperty('./entrypoints/remote');
    expect(remotePackageManifest.dependencies).not.toHaveProperty('@nextagent/agent-app');
    expect(remoteProvider).toContain('createRemoteGatewayProvider');
    expect(remoteProvider).not.toContain('@nextagent/agent-app');
  });

  it('keeps merged-workspace remote deployment assembled through the remote gateway package', () => {
    const remoteDeploymentExample = JSON.parse(readFileSync(join(root, 'packages', 'agent-remote-deployment', 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, unknown>;
    };
    const remoteDeploymentSource = readFileSync(join(root, 'packages', 'agent-remote-deployment', 'src', 'index.ts'), 'utf8');

    expect(remoteDeploymentExample.dependencies).toHaveProperty('@nextagent/agent-app');
    expect(remoteDeploymentExample.dependencies).toHaveProperty('@nextagent/agent-platform-gateway-local');
    expect(remoteDeploymentExample.dependencies).toHaveProperty('@nextagent/agent-platform-gateway-remote');
    expect(Object.keys(remoteDeploymentExample.dependencies ?? {}).some((dependency) => dependency.startsWith('@vendor/'))).toBe(false);
    expect(remoteDeploymentSource).toContain('export async function startRemoteRuntimePackage');
    expect(remoteDeploymentSource).toContain('createRemoteGatewayProvider');
  });
});
