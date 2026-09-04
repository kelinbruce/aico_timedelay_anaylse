import {
  createAgentPackageSourceLocator,
  createAppCredentialResolver,
  createStartupResourceProviderRegistry,
  validateDefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import {
  builtinAgentsProvider,
  builtinSkillsProvider,
  builtinToolsProvider,
  localAgentsProvider,
  localSkillsAgentOwnedProvider,
  localSkillsSystemProvider,
  localSubagentsProvider,
} from '@nextagent/agent-capability';
import { memoryToolsProvider } from '@nextagent/agent-memory';
import { brand } from '@nextagent/agent-common';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('local Skill source app config and locator', () => {
  it('freezes configRoot-derived local Skill roots and workspaceRoot-derived runtime paths', async () => {
    const root = await makeRoot();
    try {
      const defaults = validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver });
      expect(defaults.paths.configRoot).toBe(root);
      expect(defaults.paths.logDirectory).toBe(join(root, 'logs'));
      expect(defaults.paths.systemSkillsRoot).toBe(join(root, 'skills'));
      expect(defaults.paths.agentsRoot).toBe(join(root, 'agents'));
      expect(defaults.paths.workspaceRoot).toBe(join(root, 'workspaces'));
      expect(defaults.paths.sqliteFile).toBe(join(root, 'workspaces', 'data', 'system', 'nextagent.sqlite'));

      const runtimeRoot = validateDefaultSystemConfig(
        rawSystemConfig({
          workspaceRoot: '../runtime',
          logDirectory: '../runtime-logs',
          skillRoot: '../operator-skills',
          agentRoot: '../operator-agents',
        }),
        root,
        { credentialResolver },
      );
      expect(runtimeRoot.paths.logDirectory).toBe(join(root, '..', 'runtime-logs'));
      expect(runtimeRoot.paths.systemSkillsRoot).toBe(join(root, '..', 'operator-skills'));
      expect(runtimeRoot.paths.agentsRoot).toBe(join(root, '..', 'operator-agents'));
      expect(runtimeRoot.paths.workspaceRoot).toBe(join(root, '..', 'runtime'));
      expect(runtimeRoot.paths.sqliteFile).toBe(join(root, '..', 'runtime', 'data', 'system', 'nextagent.sqlite'));

      for (const forbiddenPath of ['sqliteFile']) {
        expect(() => validateDefaultSystemConfig(rawSystemConfig({ [forbiddenPath]: 'operator-controlled' }), root, { credentialResolver })).toThrow(
          'App configuration is blocked before ready.',
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unsafe existing execution workspace roots before startup creates runtime files', async () => {
    const root = await makeRoot();
    try {
      const workspaceRoot = join(root, 'workspaces');
      await mkdir(workspaceRoot, { recursive: true });
      await writeFile(join(workspaceRoot, 'execution'), 'not a directory', 'utf8');
      expect(() => validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver })).toThrow(
        'App configuration is blocked before ready.',
      );

      await rm(join(workspaceRoot, 'execution'), { force: true });
      await mkdir(join(workspaceRoot, 'execution'), { recursive: true });
      try {
        await symlink(join(workspaceRoot, 'execution'), join(root, 'skills'), process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        return;
      }
      expect(() => validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver })).toThrow(
        'App configuration is blocked before ready.',
      );

      await rm(join(root, 'skills'), { recursive: true, force: true });
      await rm(join(workspaceRoot, 'execution'), { recursive: true, force: true });
      const outside = await mkdtemp(join(tmpdir(), 'nextagent-execution-outside-'));
      try {
        await symlink(outside, join(workspaceRoot, 'execution'), process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        return;
      }
      expect(() => validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver })).toThrow(
        'App configuration is blocked before ready.',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { skillRoot: 'workspaces/data' },
    { agentRoot: 'workspaces/data/system' },
    { skillRoot: 'workspaces/execution' },
    { agentRoot: 'workspaces/shared-data' },
  ])('rejects configured local resource roots that overlap runtime paths %j', async (paths) => {
    const root = await makeRoot();
    try {
      expect(() => validateDefaultSystemConfig(rawSystemConfig(paths), root, { credentialResolver })).toThrow(
        'App configuration is blocked before ready.',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('registers reserved local Skill providers for trusted app composition only', () => {
    expect(startupResourceProviderRegistry().capabilityProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'local-skills-system', providerKind: 'LOCAL_DIRECTORY' }),
        expect.objectContaining({ providerId: 'local-skills-agent-owned', providerKind: 'LOCAL_DIRECTORY' }),
      ]),
    );
  });

  it('locates Agent-owned skills through configRoot agents and not workspaceDir', async () => {
    const root = await makeRoot();
    try {
      const systemConfig = validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver });
      const locator = createAgentPackageSourceLocator(systemConfig);
      await mkdir(join(root, 'agents', 'default-agent', 'skills'), { recursive: true });
      await mkdir(join(root, 'workspaces', 'default-agent', 'skills'), { recursive: true });
      await writeFile(join(root, 'workspaces', 'default-agent', 'skills', 'SKILL.md'), 'workspace skill must not be consulted', 'utf8');

      await expect(
        locator.locate({
          agentId: brand<string, 'AgentId'>('default-agent'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          agentAssemblyRef: 'default-agent:v1',
        }),
      ).resolves.toEqual({ status: 'found', agentPackageRoot: join(root, 'agents', 'default-agent') });
      await expect(
        locator.locate({
          agentId: brand<string, 'AgentId'>('missing-agent'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          agentAssemblyRef: 'missing-agent:v1',
        }),
      ).resolves.toMatchObject({ status: 'not-found', safeCode: 'LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

const credentialResolver = createAppCredentialResolver({ OPENAI_API_KEY: 'test-only' });

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nextagent-local-skill-config-'));
}

function rawSystemConfig(paths: Record<string, string> = {}) {
  return {
    deployment: { mode: 'LOCAL' },
    paths: {
      workspaceRoot: 'workspaces',
      logDirectory: 'logs',
      ...paths,
    },
    auth: {
      mode: 'local',
      localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject' },
      localAuth: { enabled: false },
    },
    channel: { transport: 'fastify', host: '127.0.0.1', port: 3000 },
    hostedAgent: { activeAgentId: 'default-agent' },
    modelProfiles: [
      {
        providerId: 'openai-compatible',
        baseUrl: 'https://api.example.test/v1',
        credentialRef: 'env:OPENAI_API_KEY',
        models: [
          {
            modelId: 'test-model',
            timeoutMs: 1000,
            contextWindowTokens: 128_000,
            fallbackEligible: false,
          },
        ],
      },
    ],
    gateway: {
      gateways: [
        { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
        { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
      ],
    },
    noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
  };
}

function startupResourceProviderRegistry() {
  return createStartupResourceProviderRegistry([
    builtinToolsProvider,
    builtinSkillsProvider,
    builtinAgentsProvider,
    localAgentsProvider,
    localSubagentsProvider,
    localSkillsSystemProvider,
    localSkillsAgentOwnedProvider,
    memoryToolsProvider,
  ]);
}
