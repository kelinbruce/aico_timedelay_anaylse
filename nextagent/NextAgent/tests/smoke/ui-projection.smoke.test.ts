/**
 * E2E Case: feature-tree smoke - 界面测试.
 * Entry: backend UI-facing bootstrap and skill catalog DTO projection.
 */
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { expect, it } from 'vitest';
import { describeRealModelSmoke } from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 界面测试', () => {
  it('serves UI bootstrap and catalog DTOs through public Web routes', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'unused' }] });

    const bootstrap = await app.server.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json<{ transportKind: string; chatUploadFileConfig?: unknown }>()).toEqual(
      expect.objectContaining({
        transportKind: 'SSE',
        chatUploadFileConfig: expect.objectContaining({
          chatUploadFileType: ['*.md', '*.markdown'],
          chatUploadMaxFileNumber: 10,
          chatUploadMaxFileSize: 10,
          uploadFileIdleExpireTime: 5,
          uploadFileMaxExpireTime: 30,
        }),
      }),
    );

    const skills = await app.server.inject({ method: 'GET', url: '/api/v1/skills?pageNum=1&pageSize=10' });
    expect(skills.statusCode).toBe(200);
    const body = skills.json<{ skills: unknown[]; total: number }>();
    expect(Array.isArray(body.skills)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(body.skills.length);
  });
});
