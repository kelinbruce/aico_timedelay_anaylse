import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { defaultChatUploadFileConfig } from '@nextagent/agent-attachment-runtime';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppCredentialResolver } from '../src/config/env.js';
import { resolveDefaultSystemConfig } from '../src/config/system-config.js';
import { preloadAttachmentCompositionAsync, preloadAttachmentCompositionSync } from '../src/composition/attachment-composition.js';

describe('attachment composition preload', () => {
  it('preserves injected upload config and performs startup cleanup only on the async path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-attachment-preload-'));
    const uploadTempDir = join(root, 'upload-temp');
    const staleFile = join(uploadTempDir, 'stale-upload.tmp');
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const baseConfig = resolveDefaultSystemConfig({ cwd: root, credentialResolver });
    const systemConfig = { ...baseConfig, paths: { ...baseConfig.paths, uploadTempDir } };
    const injectedConfig = defaultChatUploadFileConfig();
    await mkdir(uploadTempDir, { recursive: true });
    await writeFile(staleFile, 'stale', 'utf8');

    try {
      const syncComposition = preloadAttachmentCompositionSync({ chatUploadFileConfig: injectedConfig });
      expect(syncComposition.chatUploadFileConfig).toBe(injectedConfig);
      expect(existsSync(staleFile)).toBe(true);

      const asyncComposition = await preloadAttachmentCompositionAsync({ systemConfig, chatUploadFileConfig: injectedConfig });
      expect(asyncComposition.chatUploadConfigProvider).toBeDefined();
      expect(await asyncComposition.chatUploadConfigProvider!.get()).toBe(injectedConfig);
      expect(existsSync(staleFile)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('selects local provider in LOCAL deployment mode and remote provider in REMOTE mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-attachment-preload-'));
    const credentialResolver = createAppCredentialResolver({
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
    });
    const baseConfig = resolveDefaultSystemConfig({ cwd: root, credentialResolver });
    const systemConfigLocal = { ...baseConfig, deployment: { ...baseConfig.deployment, mode: 'LOCAL' as const } };
    const systemConfigRemote = { ...baseConfig, deployment: { ...baseConfig.deployment, mode: 'REMOTE' as const } };

    const localComposition = await preloadAttachmentCompositionAsync({ systemConfig: systemConfigLocal });
    const remoteComposition = await preloadAttachmentCompositionAsync({ systemConfig: systemConfigRemote });

    expect(localComposition.chatUploadConfigProvider).toBeDefined();
    expect(remoteComposition.chatUploadConfigProvider).toBeDefined();
    // In local mode with no agent package, the provider still returns a default config.
    expect(await localComposition.chatUploadConfigProvider!.get()).toBeDefined();
    // In remote mode with no agent package, the provider returns undefined.
    expect(await remoteComposition.chatUploadConfigProvider!.get()).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });
});
