import { createRecipeCapabilityProvider, WorkflowRecipeDefinitionSource } from '@nextagent/agent-workflow';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { localRecipeProvider } from '@nextagent/agent-capability';
import { brand, type AgentId } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import { createRuntimePaths } from '../src/config/paths.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const agentId = brand<string, 'AgentId'>('default-agent');

function makeAssembly(root: string, targetAgentId: AgentId = agentId): AgentAssembly {
  return {
    agentId: targetAgentId,
    agentVersion: 'v1',
    agentAssemblyRef: `ref-${targetAgentId}`,
    packageRoot: root,
    capabilityBindings: [],
  } as unknown as AgentAssembly;
}

function writeRecipe(root: string, name: string, content: string, ext: string = '.yaml', targetAgentId: AgentId = agentId): void {
  const agentsDir = join(root, 'agents');
  const dir = join(agentsDir, targetAgentId, 'recipes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + ext), content, 'utf8');
}

function makeRegistry(root: string): WorkflowRecipeDefinitionSource {
  return new WorkflowRecipeDefinitionSource({ agentsRoot: join(root, 'agents') });
}

describe('workflow recipe classification and index loading', () => {
  it('searchDescriptors scans directory at runtime without flowGraph in descriptor', () => {
    const root = join(process.cwd(), 'tmp-test-recipe-index');
    rmSync(root, { recursive: true, force: true });
    try {
      writeRecipe(
        root,
        'alarm-diagnosis',
        JSON.stringify({
          recipeName: 'alarm-diagnosis',
          version: 'v1',
          displayName: 'Alarm Diagnosis',
          domain: 'fault-diagnosis',
          scene: 'alarm-location',
          lang: 'zh',
          flowGraph: { nodes: { start: { type: 'START', next: {} } } },
        }),
      );
      const registry = makeRegistry(root);

      const descriptors = registry.searchDescriptors(agentId);
      expect(descriptors).toHaveLength(1);
      const descriptor = descriptors[0]!;
      expect(descriptor.capabilityId).toBe('alarm-diagnosis');
      expect(descriptor.kind).toBe('WORKFLOW');
      expect(descriptor.modelInvocable).toBe(false);
      expect((descriptor.metadata as Record<string, unknown>).domain).toBe('fault-diagnosis');
      expect((descriptor.metadata as Record<string, unknown>).scene).toBe('alarm-location');
      expect((descriptor.metadata as Record<string, unknown>).lang).toBe('zh');
      expect((descriptor as unknown as Record<string, unknown>).flowGraph).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lazy loads full DSL on require and caches', () => {
    const root = join(process.cwd(), 'tmp-test-recipe-lazy');
    rmSync(root, { recursive: true, force: true });
    try {
      writeRecipe(
        root,
        'alarm-diagnosis',
        JSON.stringify({
          recipeName: 'alarm-diagnosis',
          version: 'v1',
          displayName: 'Alarm Diagnosis',
          flowGraph: { nodes: { start: { type: 'START', next: {} } } },
        }),
      );
      const registry = makeRegistry(root);

      const recipe = registry.require(agentId, 'alarm-diagnosis');
      expect(recipe.recipeName).toBe('alarm-diagnosis');
      expect(recipe.flowGraph).toBeDefined();
      expect(recipe.flowGraph.nodes.start!.type).toBe('START');

      const cached = registry.require(agentId, 'alarm-diagnosis');
      expect(cached).toBe(recipe);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips invalid recipe and continues loading others', () => {
    const root = join(process.cwd(), 'tmp-test-recipe-invalid');
    rmSync(root, { recursive: true, force: true });
    try {
      writeRecipe(
        root,
        'valid-recipe',
        JSON.stringify({
          recipeName: 'valid-recipe',
          version: 'v1',
          displayName: 'Valid',
          flowGraph: { nodes: { start: { type: 'START', next: {} } } },
        }),
      );
      writeRecipe(root, 'bad-recipe', '{not valid yaml: [unterminated');
      const registry = makeRegistry(root);

      const descriptors = registry.searchDescriptors(agentId);
      expect(descriptors.map((d) => d.capabilityId)).toEqual(['valid-recipe']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not scan .json files (YAML only)', () => {
    const root = join(process.cwd(), 'tmp-test-recipe-json');
    rmSync(root, { recursive: true, force: true });
    try {
      writeRecipe(
        root,
        'yaml-recipe',
        JSON.stringify({
          recipeName: 'yaml-recipe',
          version: 'v1',
          displayName: 'YAML',
          flowGraph: { nodes: { start: { type: 'START', next: {} } } },
        }),
      );
      writeRecipe(
        root,
        'json-recipe',
        JSON.stringify({
          recipeName: 'json-recipe',
          version: 'v1',
          displayName: 'JSON',
          flowGraph: { nodes: { start: { type: 'START', next: {} } } },
        }),
        '.json',
      );
      const registry = makeRegistry(root);

      const descriptors = registry.searchDescriptors(agentId);
      expect(descriptors.map((d) => d.capabilityId)).toEqual(['yaml-recipe']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('normal startup when recipe directory is empty or missing', () => {
    const root = join(process.cwd(), 'tmp-test-recipe-empty');
    rmSync(root, { recursive: true, force: true });
    try {
      const registry = makeRegistry(root);
      expect(registry.searchDescriptors(agentId)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes through domain/scene/lang without merging into metadata', () => {
    const root = join(process.cwd(), 'tmp-test-recipe-passthrough');
    rmSync(root, { recursive: true, force: true });
    try {
      writeRecipe(
        root,
        'classified',
        JSON.stringify({
          recipeName: 'classified',
          version: 'v1',
          displayName: 'Classified',
          domain: 'fault-diagnosis',
          scene: 'alarm-location',
          lang: 'zh',
          flowGraph: { nodes: { start: { type: 'START', next: {} } } },
        }),
      );
      const registry = makeRegistry(root);

      const recipe = registry.require(agentId, 'classified');
      expect(recipe.domain).toBe('fault-diagnosis');
      expect(recipe.scene).toBe('alarm-location');
      expect(recipe.lang).toBe('zh');
      expect((recipe as Record<string, unknown>).metadata).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('scopes recipe capability discovery to the requested agent', async () => {
    const root = join(process.cwd(), 'tmp-test-recipe-capability-scope');
    const firstAgentId = brand<string, 'AgentId'>('agent-a');
    const secondAgentId = brand<string, 'AgentId'>('agent-b');
    rmSync(root, { recursive: true, force: true });
    try {
      writeRecipe(
        root,
        'shared-recipe',
        JSON.stringify({
          recipeName: 'shared-recipe',
          version: 'v1',
          displayName: 'Shared A',
          description: 'agent-a recipe',
          flowGraph: { nodes: { start: { type: 'START', next: {} } } },
        }),
        '.yaml',
        firstAgentId,
      );
      writeRecipe(
        root,
        'shared-recipe',
        JSON.stringify({
          recipeName: 'shared-recipe',
          version: 'v1',
          displayName: 'Shared B',
          description: 'agent-b recipe',
          flowGraph: { nodes: { start: { type: 'START', next: {} } } },
        }),
        '.yaml',
        secondAgentId,
      );
      const source = new WorkflowRecipeDefinitionSource({ agentsRoot: join(root, 'agents') });
      const catalog = createStaticCapabilityCatalog([], {
        searchDiscoveries: [createRecipeCapabilityProvider(source).discovery],
      });

      await expect(
        catalog.resolve({
          tenantId: brand<string, 'TenantId'>('tenant-1'),
          subjectId: brand<string, 'SubjectId'>('subject-1'),
          agentAssembly: bindRecipe(makeAssembly(root, firstAgentId), 'shared-recipe'),
          capabilityId: brand<string, 'CapabilityId'>('shared-recipe'),
        }),
      ).resolves.toMatchObject({ description: 'agent-a recipe' });
      await expect(
        catalog.resolve({
          tenantId: brand<string, 'TenantId'>('tenant-1'),
          subjectId: brand<string, 'SubjectId'>('subject-1'),
          agentAssembly: bindRecipe(makeAssembly(root, secondAgentId), 'shared-recipe'),
          capabilityId: brand<string, 'CapabilityId'>('shared-recipe'),
        }),
      ).resolves.toMatchObject({ description: 'agent-b recipe' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('FIFO eviction when cache reaches limit', () => {
    const root = join(process.cwd(), 'tmp-test-recipe-fifo');
    rmSync(root, { recursive: true, force: true });
    try {
      for (let i = 0; i <= 100; i++) {
        writeRecipe(
          root,
          `recipe-${i}`,
          JSON.stringify({
            recipeName: `recipe-${i}`,
            version: 'v1',
            displayName: `Recipe ${i}`,
            flowGraph: { nodes: { start: { type: 'START', next: {} } } },
          }),
        );
      }
      const registry = makeRegistry(root);

      const first = registry.require(agentId, 'recipe-0');
      for (let i = 1; i < 100; i++) {
        registry.require(agentId, `recipe-${i}`);
      }
      registry.require(agentId, 'recipe-100');

      const reloaded = registry.require(agentId, 'recipe-0');
      expect(reloaded).not.toBe(first);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('require throws RECIPE_INVALID on validation failure and does not cache', () => {
    const root = join(process.cwd(), 'tmp-test-recipe-invalid-require');
    rmSync(root, { recursive: true, force: true });
    try {
      writeRecipe(
        root,
        'broken',
        JSON.stringify({
          recipeName: 'broken',
          version: 'v1',
          flowGraph: { nodes: {} },
        }),
      );
      const registry = makeRegistry(root);

      expect(() => registry.require(agentId, 'broken')).toThrow();
      expect(() => registry.require(agentId, 'broken')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('require throws RECIPE_NOT_FOUND when recipe does not exist', () => {
    const root = join(process.cwd(), 'tmp-test-recipe-not-found');
    rmSync(root, { recursive: true, force: true });
    try {
      writeRecipe(
        root,
        'exists',
        JSON.stringify({
          recipeName: 'exists',
          version: 'v1',
          displayName: 'Exists',
          flowGraph: { nodes: { start: { type: 'START', next: {} } } },
        }),
      );
      const registry = makeRegistry(root);

      expect(() => registry.require(agentId, 'missing')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('search and require follow configured agentsRoot instead of default agents directory', () => {
    const root = join(process.cwd(), 'tmp-test-recipe-custom-root');
    rmSync(root, { recursive: true, force: true });
    try {
      const customAgentsDir = join(root, 'custom-agents');
      const recipeDir = join(customAgentsDir, agentId, 'recipes');
      mkdirSync(recipeDir, { recursive: true });
      writeFileSync(
        join(recipeDir, 'custom-root-recipe.yaml'),
        JSON.stringify({
          recipeName: 'custom-root-recipe',
          version: 'v1',
          displayName: 'Custom Root Recipe',
          flowGraph: { nodes: { start: { type: 'START', next: {} } } },
        }),
        'utf8',
      );

      const defaultAgentsDir = join(root, 'agents', agentId, 'recipes');
      mkdirSync(defaultAgentsDir, { recursive: true });
      writeFileSync(
        join(defaultAgentsDir, 'default-path-recipe.yaml'),
        JSON.stringify({
          recipeName: 'default-path-recipe',
          version: 'v1',
          displayName: 'Default Path Recipe',
          flowGraph: { nodes: { start: { type: 'START', next: {} } } },
        }),
        'utf8',
      );

      const registry = new WorkflowRecipeDefinitionSource({ agentsRoot: customAgentsDir });

      const descriptors = registry.searchDescriptors(agentId);
      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]!.capabilityId).toBe(brand<string, 'CapabilityId'>('custom-root-recipe'));

      const definition = registry.require(agentId, 'custom-root-recipe');
      expect(definition.recipeName).toBe('custom-root-recipe');

      expect(() => registry.require(agentId, 'default-path-recipe')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('createRuntimePaths resolves absolute agentRoot and recipe loader follows the configured path', () => {
    const root = join(process.cwd(), 'tmp-test-recipe-config-driven-agent-root');
    rmSync(root, { recursive: true, force: true });
    try {
      const absoluteAgentsRoot = join(root, 'opt-share-agents');
      const workspaceRoot = join(root, 'workspace');

      const recipeDir = join(absoluteAgentsRoot, agentId, 'recipes');
      mkdirSync(recipeDir, { recursive: true });
      writeFileSync(
        join(recipeDir, 'telecom-alarm-diagnosis.yaml'),
        JSON.stringify({
          recipeName: 'telecom-alarm-diagnosis',
          version: 'v1',
          displayName: 'Telecom Alarm Diagnosis',
          domain: 'fault-diagnosis',
          scene: 'alarm-location',
          lang: 'zh',
          flowGraph: { nodes: { start: { type: 'START', next: {} } } },
        }),
        'utf8',
      );

      const paths = createRuntimePaths(root, {
        workspaceRoot,
        agentRoot: absoluteAgentsRoot,
      });
      expect(paths.agentsRoot).toBe(absoluteAgentsRoot);

      const registry = new WorkflowRecipeDefinitionSource({ agentsRoot: paths.agentsRoot });

      const descriptors = registry.searchDescriptors(agentId);
      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]!.capabilityId).toBe(brand<string, 'CapabilityId'>('telecom-alarm-diagnosis'));

      const definition = registry.require(agentId, 'telecom-alarm-diagnosis');
      expect(definition.recipeName).toBe('telecom-alarm-diagnosis');
      expect(definition.domain).toBe('fault-diagnosis');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function bindRecipe(assembly: AgentAssembly, recipeName: string): AgentAssembly {
  return {
    ...assembly,
    capabilityBindings: [
      {
        capabilityId: brand<string, 'CapabilityId'>(recipeName),
        capabilityType: 'WORKFLOW',
        providerId: localRecipeProvider.providerId,
      },
    ],
  };
}
