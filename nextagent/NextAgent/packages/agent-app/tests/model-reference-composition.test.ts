import { brand } from '@nextagent/agent-common';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileAgentAssembly } from '../src/assembly/agent-assembly-compiler.js';
import type { AgentAssemblyResourceReferences } from '../src/assembly/agent-assembly-compiler.js';
import { createCompiledAgentAssemblyRegistry } from '../src/assembly/agent-assembly-registry.js';
import { loadAgentDefinitionForSystemConfig } from '../src/assembly/agent-directory-loader.js';
import { createHotReloadingActiveAssemblyRegistry } from '../src/composition/assembly-composition.js';
import { createAppCredentialResolver } from '../src/config/env.js';
import { resolveDefaultSystemConfig } from '../src/config/system-config.js';

const temporaryRoots: string[] = [];

describe('model reference composition', () => {
  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('rejects an unknown model during hot reload and preserves the active assembly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-model-reference-'));
    temporaryRoots.push(root);
    const agentsRoot = join(root, 'agents');
    const agentRoot = join(agentsRoot, 'default-agent');
    await mkdir(agentRoot, { recursive: true });
    await writeAgentDefinition(agentRoot, ['configured-model'], 'initial');

    const baseConfig = resolveDefaultSystemConfig({
      cwd: root,
      credentialResolver: createAppCredentialResolver({
        OPENAI_API_KEY: 'test-only',
        OPENAI_MODEL_NAME: 'configured-model',
        OPENAI_BASE_URL: 'https://example.invalid/v1',
      }),
    });
    const systemConfig = {
      ...baseConfig,
      paths: { ...baseConfig.paths, agentsRoot },
    };
    const resourceReferences = {
      capabilityProviders: [],
      lifecycleHookDefinitions: [],
    };
    const initialAssembly = compileAgentAssembly({
      systemConfig,
      agentDefinition: loadAgentDefinitionForSystemConfig(systemConfig),
      resourceReferences,
    });
    const registry = createHotReloadingActiveAssemblyRegistry({
      baseRegistry: createCompiledAgentAssemblyRegistry([initialAssembly]),
      systemConfig,
      initialActiveAssembly: initialAssembly,
      validationReferences: resourceReferences,
    });

    await writeAgentDefinition(agentRoot, ['configured-model', 'unknown-model'], 'invalid reload');
    await expect(registry.active(brand<string, 'AgentId'>('default-agent'))).resolves.toMatchObject({
      displayName: 'initial',
      modelIds: ['configured-model'],
    });

    await writeAgentDefinition(agentRoot, ['configured-model'], 'accepted reload');
    await expect(registry.active(brand<string, 'AgentId'>('default-agent'))).resolves.toMatchObject({
      displayName: 'accepted reload',
      modelIds: ['configured-model'],
    });
  });

  it('hot reload accepts capability bindings after validation references are updated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-capability-provider-'));
    temporaryRoots.push(root);
    const agentsRoot = join(root, 'agents');
    const agentRoot = join(agentsRoot, 'default-agent');
    await mkdir(agentRoot, { recursive: true });
    const providerId = 'builtin-agents';
    await writeAgentDefinitionWithCapabilities(agentRoot, ['configured-model'], 'initial', providerId);

    const baseConfig = resolveDefaultSystemConfig({
      cwd: root,
      credentialResolver: createAppCredentialResolver({
        OPENAI_API_KEY: 'test-only',
        OPENAI_MODEL_NAME: 'configured-model',
        OPENAI_BASE_URL: 'https://example.invalid/v1',
      }),
    });
    const systemConfig = {
      ...baseConfig,
      paths: { ...baseConfig.paths, agentsRoot },
    };
    const emptyReferences: AgentAssemblyResourceReferences = {
      capabilityProviders: [],
      lifecycleHookDefinitions: [],
    };
    const initialAssembly = compileAgentAssembly({
      systemConfig,
      agentDefinition: loadAgentDefinitionForSystemConfig(systemConfig),
      resourceReferences: emptyReferences,
    });
    const registry = createHotReloadingActiveAssemblyRegistry({
      baseRegistry: createCompiledAgentAssemblyRegistry([initialAssembly]),
      systemConfig,
      initialActiveAssembly: initialAssembly,
      validationReferences: emptyReferences,
    });
    // Simulate capability layer resolving providers after assembly layer.
    registry.updateValidationReferences({
      capabilityProviders: [{ providerId, providerKind: 'LOCAL_DIRECTORY' }],
      lifecycleHookDefinitions: [],
    });

    // Touch agent.yaml to trigger hot reload; capability binding must pass validation.
    await writeAgentDefinitionWithCapabilities(agentRoot, ['configured-model'], 'reloaded', providerId);
    await expect(registry.active(brand<string, 'AgentId'>('default-agent'))).resolves.toMatchObject({
      displayName: 'reloaded',
    });
  });
});

async function writeAgentDefinition(agentRoot: string, modelIds: readonly string[], displayName: string): Promise<void> {
  await writeFile(
    join(agentRoot, 'agent.yaml'),
    JSON.stringify({
      agentId: 'default-agent',
      agentType: 'telecom',
      agentVersion: 'v1',
      displayName,
      description: 'Model reference composition fixture.',
      modelIds,
      defaultModelId: modelIds[0],
      capabilityBindings: [],
      runtimeSettings: {},
      resources: [],
    }),
    'utf8',
  );
}

async function writeAgentDefinitionWithCapabilities(
  agentRoot: string,
  modelIds: readonly string[],
  displayName: string,
  providerId: string,
): Promise<void> {
  await writeFile(
    join(agentRoot, 'agent.yaml'),
    JSON.stringify({
      agentId: 'default-agent',
      agentType: 'telecom',
      agentVersion: 'v1',
      displayName,
      description: 'Capability provider hot reload fixture.',
      modelIds,
      defaultModelId: modelIds[0],
      capabilityBindings: [{ capabilityId: 'network-explorer', capabilityType: 'AGENT', providerId, enabled: true }],
      runtimeSettings: {},
      resources: [],
    }),
    'utf8',
  );
}
