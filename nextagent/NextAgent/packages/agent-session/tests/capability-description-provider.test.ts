import { describe, it, expect, vi } from 'vitest';
import {
  createLocalCapabilityDescriptionProvider,
  createRemoteCapabilityDescriptionProvider,
  type CapabilityDescriptionSourceLocator,
} from '../src/services/capability-description-provider.js';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function makeAgentDir(descriptionContent: string | null): Promise<{
  agentRoot: string;
  locator: CapabilityDescriptionSourceLocator;
}> {
  const agentRoot = await mkdtemp(join(tmpdir(), 'agent-capdesc-'));
  if (descriptionContent !== null) {
    await mkdir(join(agentRoot, 'resource'), { recursive: true });
    await writeFile(join(agentRoot, 'resource', 'capabilityDescription.md'), descriptionContent, 'utf-8');
  }
  const locator: CapabilityDescriptionSourceLocator = {
    async locate() {
      return { status: 'found' as const, agentPackageRoot: agentRoot };
    },
  };
  return { agentRoot, locator };
}

const SAMPLE_CONTENT = '# 产品能力范围\n\n本Agent支持5G基站告警诊断、邻区配置分析和切换成功率优化。';

describe('local capability-description provider', () => {
  it('returns file content when file exists', async () => {
    const { locator } = await makeAgentDir(SAMPLE_CONTENT);
    const provider = createLocalCapabilityDescriptionProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const content = await provider.get();
    expect(content).toBe(SAMPLE_CONTENT);
  });

  it('returns undefined when file does not exist', async () => {
    const { locator } = await makeAgentDir(null);
    const provider = createLocalCapabilityDescriptionProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const content = await provider.get();
    expect(content).toBeUndefined();
  });

  it('caches content and does not detect file changes', async () => {
    const { agentRoot, locator } = await makeAgentDir(SAMPLE_CONTENT);
    const provider = createLocalCapabilityDescriptionProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const first = await provider.get();
    expect(first).toBe(SAMPLE_CONTENT);

    await writeFile(join(agentRoot, 'resource', 'capabilityDescription.md'), 'updated content', 'utf-8');
    const second = await provider.get();
    expect(second).toBe(first);
  });

  it('returns undefined when source locator fails', async () => {
    const locator: CapabilityDescriptionSourceLocator = {
      async locate() {
        return { status: 'not-found' as const, safeCode: 'AGENT_PACKAGE_NOT_FOUND' };
      },
    };
    const provider = createLocalCapabilityDescriptionProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const content = await provider.get();
    expect(content).toBeUndefined();
  });

  it('returns undefined when signal is already aborted', async () => {
    const { locator } = await makeAgentDir(SAMPLE_CONTENT);
    const provider = createLocalCapabilityDescriptionProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const controller = new AbortController();
    controller.abort();
    const content = await provider.get(controller.signal);
    expect(content).toBeUndefined();
  });
});

describe('remote capability-description provider', () => {
  it('returns file content when file exists', async () => {
    const { locator } = await makeAgentDir(SAMPLE_CONTENT);
    const provider = createRemoteCapabilityDescriptionProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const content = await provider.get();
    expect(content).toBe(SAMPLE_CONTENT);
  });

  it('returns undefined when file does not exist', async () => {
    const { agentRoot, locator } = await makeAgentDir(null);
    const provider = createRemoteCapabilityDescriptionProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const content = await provider.get();
    expect(content).toBeUndefined();
    await rm(agentRoot, { recursive: true, force: true });
  });

  it('reloads content when file changes', async () => {
    const { agentRoot, locator } = await makeAgentDir(SAMPLE_CONTENT);
    const provider = createRemoteCapabilityDescriptionProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const first = await provider.get();
    expect(first).toBe(SAMPLE_CONTENT);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const newContent = 'updated capability description';
    await writeFile(join(agentRoot, 'resource', 'capabilityDescription.md'), newContent, 'utf-8');
    const second = await provider.get();
    expect(second).toBe(newContent);
  });

  it('caches content when file is unchanged', async () => {
    const { agentRoot, locator } = await makeAgentDir(SAMPLE_CONTENT);
    const loadFromFile = vi.fn(async () => SAMPLE_CONTENT);
    const provider = createRemoteCapabilityDescriptionProvider({
      sourceLocator: locator,
      activeAgentId: 'default',
      loadFromFile,
    });
    const first = await provider.get();
    const second = await provider.get();
    expect(second).toBe(first);
    expect(loadFromFile).toHaveBeenCalledTimes(1);
    await rm(agentRoot, { recursive: true, force: true });
  });

  it('returns undefined when source locator fails', async () => {
    const locator: CapabilityDescriptionSourceLocator = {
      async locate() {
        return { status: 'not-found' as const, safeCode: 'AGENT_PACKAGE_NOT_FOUND' };
      },
    };
    const provider = createRemoteCapabilityDescriptionProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const content = await provider.get();
    expect(content).toBeUndefined();
  });

  it('returns undefined when signal is already aborted', async () => {
    const { locator } = await makeAgentDir(SAMPLE_CONTENT);
    const provider = createRemoteCapabilityDescriptionProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const controller = new AbortController();
    controller.abort();
    const content = await provider.get(controller.signal);
    expect(content).toBeUndefined();
  });
});
