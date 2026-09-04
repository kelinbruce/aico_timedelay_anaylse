import { describe, it, expect } from 'vitest';
import { createChatUploadConfigLoader, type ChatUploadConfigSourceLocator } from '../src/chat-upload-config.js';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
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

describe('chat-upload-config loader', () => {
  it('loads valid config', async () => {
    const { locator } = await makeAgentDir(
      JSON.stringify({
        'chat-upload-file-config': {
          'hofs-bucket-name': 'my-bucket',
          'chat-upload-file-type': ['*.xlsx', '*.csv'],
          'chat-upload-max-file-number': 10,
          'chat-upload-max-file-size': 10,
          'upload-file-idle-expire-time': 5,
          'upload-file-max-expire-time': 30,
        },
      }),
    );
    const loader = createChatUploadConfigLoader(locator);
    const config = await loader.load('default');
    expect(config).toBeDefined();
    expect(config!.hofsBucketName).toBe('my-bucket');
    expect(config!.chatUploadFileType).toEqual(['*.xlsx', '*.csv']);
    expect(config!.chatUploadMaxFileNumber).toBe(10);
    expect(config!.chatUploadMaxFileSize).toBe(10);
    expect(config!.uploadFileIdleExpireTime).toBe(5);
    expect(config!.uploadFileMaxExpireTime).toBe(30);
  });

  it('returns default config when config.json does not exist', async () => {
    const { locator } = await makeAgentDir(null);
    const loader = createChatUploadConfigLoader(locator);
    const config = await loader.load('default');
    expect(config).toMatchObject({ hofsBucketName: '', chatUploadFileType: ['*.md', '*.markdown'] });
  });

  it('returns default config when chat-upload-file-config is missing', async () => {
    const { locator } = await makeAgentDir(JSON.stringify({ transportKind: 'SSE' }));
    const loader = createChatUploadConfigLoader(locator);
    const config = await loader.load('default');
    expect(config).toMatchObject({ hofsBucketName: '', chatUploadFileType: ['*.md', '*.markdown'] });
  });

  it('keeps effective config when hofs-bucket-name is empty', async () => {
    const { locator } = await makeAgentDir(
      JSON.stringify({
        'chat-upload-file-config': { 'hofs-bucket-name': '' },
      }),
    );
    const loader = createChatUploadConfigLoader(locator);
    const config = await loader.load('default');
    expect(config).toMatchObject({ hofsBucketName: '', chatUploadFileType: ['*.md', '*.markdown'] });
  });

  it('caps file number to system limit of 200', async () => {
    const { locator } = await makeAgentDir(
      JSON.stringify({
        'chat-upload-file-config': {
          'hofs-bucket-name': 'b',
          'chat-upload-max-file-number': 500,
        },
      }),
    );
    const loader = createChatUploadConfigLoader(locator);
    const config = await loader.load('default');
    expect(config!.chatUploadMaxFileNumber).toBe(200);
  });

  it('caps file size to system limit of 500', async () => {
    const { locator } = await makeAgentDir(
      JSON.stringify({
        'chat-upload-file-config': {
          'hofs-bucket-name': 'b',
          'chat-upload-max-file-size': 999,
        },
      }),
    );
    const loader = createChatUploadConfigLoader(locator);
    const config = await loader.load('default');
    expect(config!.chatUploadMaxFileSize).toBe(500);
  });

  it('uses defaults for missing fields', async () => {
    const { locator } = await makeAgentDir(
      JSON.stringify({
        'chat-upload-file-config': { 'hofs-bucket-name': 'b' },
      }),
    );
    const loader = createChatUploadConfigLoader(locator);
    const config = await loader.load('default');
    expect(config!.chatUploadMaxFileNumber).toBe(10);
    expect(config!.chatUploadMaxFileSize).toBe(10);
    expect(config!.uploadFileIdleExpireTime).toBe(5);
    expect(config!.uploadFileMaxExpireTime).toBe(30);
    expect(config!.chatUploadFileType).toEqual(['*.md', '*.markdown']);
  });

  it('uses defaults for wrong-type fields', async () => {
    const { locator } = await makeAgentDir(
      JSON.stringify({
        'chat-upload-file-config': {
          'hofs-bucket-name': 'b',
          'chat-upload-max-file-size': '10',
        },
      }),
    );
    const loader = createChatUploadConfigLoader(locator);
    const config = await loader.load('default');
    expect(config!.chatUploadMaxFileSize).toBe(10);
  });

  it('adjusts max-expire-time to idle-expire-time when smaller', async () => {
    const { locator } = await makeAgentDir(
      JSON.stringify({
        'chat-upload-file-config': {
          'hofs-bucket-name': 'b',
          'upload-file-idle-expire-time': 30,
          'upload-file-max-expire-time': 5,
        },
      }),
    );
    const loader = createChatUploadConfigLoader(locator);
    const config = await loader.load('default');
    expect(config!.uploadFileMaxExpireTime).toBe(30);
  });

  it('defaults empty file-type array to *.md', async () => {
    const { locator } = await makeAgentDir(
      JSON.stringify({
        'chat-upload-file-config': {
          'hofs-bucket-name': 'b',
          'chat-upload-file-type': [],
        },
      }),
    );
    const loader = createChatUploadConfigLoader(locator);
    const config = await loader.load('default');
    expect(config!.chatUploadFileType).toEqual(['*.md', '*.markdown']);
  });
});
