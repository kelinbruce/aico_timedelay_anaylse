import { describe, it, expect, vi } from 'vitest';
import {
  createLocalChatUploadConfigProvider,
  createRemoteChatUploadConfigProvider,
  type ChatUploadConfigSourceLocator,
} from '../src/chat-upload-config.js';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function makeAgentDir(configJson: string | null): Promise<{ agentRoot: string; locator: ChatUploadConfigSourceLocator }> {
  const agentRoot = await mkdtemp(join(tmpdir(), 'agent-cfg-'));
  if (configJson !== null) {
    await mkdir(join(agentRoot, 'config'), { recursive: true });
    await writeFile(join(agentRoot, 'config', 'config.json'), configJson, 'utf-8');
  }
  const locator: ChatUploadConfigSourceLocator = {
    async locate() {
      return { status: 'found' as const, agentPackageRoot: agentRoot };
    },
  };
  return { agentRoot, locator };
}

const fullConfigJson = JSON.stringify({
  'chat-upload-file-config': {
    'hofs-bucket-name': 'my-bucket',
    'chat-upload-file-type': ['*.xlsx', '*.csv'],
    'chat-upload-max-file-number': 10,
    'chat-upload-max-file-size': 10,
    'upload-file-idle-expire-time': 5,
    'upload-file-max-expire-time': 30,
  },
});

describe('local chat-upload-config provider', () => {
  it('returns default config when config.json is missing', async () => {
    const { locator } = await makeAgentDir(null);
    const provider = createLocalChatUploadConfigProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const config = await provider.get();
    expect(config).toBeDefined();
    expect(config!.hofsBucketName).toBe('');
    expect(config!.chatUploadFileType).toEqual(['*.md', '*.markdown']);
  });

  it('loads and caches effective config', async () => {
    const { agentRoot, locator } = await makeAgentDir(fullConfigJson);
    const provider = createLocalChatUploadConfigProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const first = await provider.get();
    expect(first).toBeDefined();
    expect(first!.hofsBucketName).toBe('my-bucket');
    expect(first!.chatUploadFileType).toEqual(['*.xlsx', '*.csv']);

    // Mutate the file after the first load; local provider must not detect the change.
    await writeFile(
      join(agentRoot, 'config', 'config.json'),
      JSON.stringify({
        'chat-upload-file-config': { 'hofs-bucket-name': 'other-bucket', 'chat-upload-file-type': ['*.pdf'] },
      }),
      'utf-8',
    );
    const second = await provider.get();
    expect(second).toBe(first);
    expect(second!.hofsBucketName).toBe('my-bucket');
  });

  it('returns default config when source locator fails', async () => {
    const locator: ChatUploadConfigSourceLocator = {
      async locate() {
        return { status: 'not-found' as const, safeCode: 'AGENT_PACKAGE_NOT_FOUND' };
      },
    };
    const provider = createLocalChatUploadConfigProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const config = await provider.get();
    expect(config).toBeDefined();
    expect(config!.chatUploadFileType).toEqual(['*.md', '*.markdown']);
  });
});

describe('remote chat-upload-config provider', () => {
  it('returns undefined when config.json is missing', async () => {
    const { agentRoot, locator } = await makeAgentDir(null);
    const provider = createRemoteChatUploadConfigProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const config = await provider.get();
    expect(config).toBeUndefined();
    await rm(agentRoot, { recursive: true, force: true });
  });

  it('loads effective config and reloads on file change', async () => {
    const { agentRoot, locator } = await makeAgentDir(fullConfigJson);
    const provider = createRemoteChatUploadConfigProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const first = await provider.get();
    expect(first).toBeDefined();
    expect(first!.hofsBucketName).toBe('my-bucket');

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(
      join(agentRoot, 'config', 'config.json'),
      JSON.stringify({
        'chat-upload-file-config': { 'hofs-bucket-name': 'other-bucket', 'chat-upload-file-type': ['*.pdf'] },
      }),
      'utf-8',
    );
    const second = await provider.get();
    expect(second).toBeDefined();
    expect(second!.hofsBucketName).toBe('other-bucket');
    expect(second!.chatUploadFileType).toEqual(['*.pdf']);
  });

  it('caches effective config when file is unchanged', async () => {
    const { agentRoot, locator } = await makeAgentDir(fullConfigJson);
    const loadFromFile = vi.fn(async () => ({
      hofsBucketName: 'mock-bucket',
      chatUploadFileType: ['*.md'],
      chatUploadMaxFileNumber: 1,
      chatUploadMaxFileSize: 1,
      uploadFileIdleExpireTime: 1,
      uploadFileMaxExpireTime: 1,
    }));
    const provider = createRemoteChatUploadConfigProvider({ sourceLocator: locator, activeAgentId: 'default', loadFromFile });
    const first = await provider.get();
    const second = await provider.get();
    expect(second).toBe(first);
    expect(loadFromFile).toHaveBeenCalledTimes(1);
    await rm(agentRoot, { recursive: true, force: true });
  });

  it('returns undefined when source locator fails', async () => {
    const locator: ChatUploadConfigSourceLocator = {
      async locate() {
        return { status: 'not-found' as const, safeCode: 'AGENT_PACKAGE_NOT_FOUND' };
      },
    };
    const provider = createRemoteChatUploadConfigProvider({ sourceLocator: locator, activeAgentId: 'default' });
    const config = await provider.get();
    expect(config).toBeUndefined();
  });
});
