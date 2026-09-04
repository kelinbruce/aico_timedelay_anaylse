import { afterEach, describe, expect, it } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCategoryQuestionCatalog, type CategoryQuestionCatalogSource } from '../src/services/category-question-catalog.js';
import {
  bindRuntimeLoggerProvider,
  noopRuntimeLogger,
  type AgentId,
  type AgentVersion,
  type RuntimeLoggerProviderBinding,
} from '@nextagent/agent-common';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureResourceDir = join(__dirname, 'fixtures', 'category-questions', 'resource');
const testAgentVersion = 'v1' as AgentVersion;
const testAssemblyRef = 'test-ref';

function createLocatorForFixture(rootDir: string): CategoryQuestionCatalogSource {
  return {
    async locateResourceDir() {
      return rootDir;
    },
  };
}

describe('CategoryQuestionCatalog LRU cache (D5)', () => {
  afterEach(() => loggerBinding?.unbind());

  it('evicts the oldest entry when cache exceeds 64 entries', async () => {
    const discovery = createCategoryQuestionCatalog({ source: createLocatorForFixture(fixtureResourceDir) });

    // Load 65 different agents (same locale) to exceed the 64-entry limit
    for (let i = 0; i < 65; i += 1) {
      const agentId = `agent-${i}` as AgentId;
      await discovery.loadCatalog(agentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    }

    // The first agent (agent-0) should have been evicted — getReadinessEvidence returns empty
    const evictedEvidence = discovery.getReadinessEvidence('agent-0' as AgentId, 'zh-CN');
    expect(evictedEvidence).toHaveLength(0);

    // The last agent (agent-64) should still be cached
    const cachedEvidence = discovery.getReadinessEvidence('agent-64' as AgentId, 'zh-CN');
    expect(cachedEvidence.length).toBeGreaterThan(0);
  });

  it('refreshes entry position on get (LRU access order)', async () => {
    const discovery = createCategoryQuestionCatalog({ source: createLocatorForFixture(fixtureResourceDir) });

    // Load 64 agents to fill the cache
    for (let i = 0; i < 64; i += 1) {
      const agentId = `agent-${i}` as AgentId;
      await discovery.loadCatalog(agentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    }

    // Access agent-0 (oldest) to move it to the end (most recently used)
    const evidence = discovery.getReadinessEvidence('agent-0' as AgentId, 'zh-CN');
    expect(evidence.length).toBeGreaterThan(0);

    // Load agent-64 (65th entry) — should evict agent-1 (now the oldest), not agent-0
    await discovery.loadCatalog('agent-64' as AgentId, testAgentVersion, testAssemblyRef, 'zh-CN');

    // agent-0 was refreshed by get, so it should still be cached
    const agent0Evidence = discovery.getReadinessEvidence('agent-0' as AgentId, 'zh-CN');
    expect(agent0Evidence.length).toBeGreaterThan(0);

    // agent-1 was not refreshed, so it should have been evicted
    const agent1Evidence = discovery.getReadinessEvidence('agent-1' as AgentId, 'zh-CN');
    expect(agent1Evidence).toHaveLength(0);
  });

  it('returns cached catalog without reloading', async () => {
    const discovery = createCategoryQuestionCatalog({ source: createLocatorForFixture(fixtureResourceDir) });
    const agentId = 'cache-test' as AgentId;

    const catalog1 = await discovery.loadCatalog(agentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    const catalog2 = await discovery.loadCatalog(agentId, testAgentVersion, testAssemblyRef, 'zh-CN');

    // Same reference (cached, not reloaded)
    expect(catalog1).toBe(catalog2);
  });
});
