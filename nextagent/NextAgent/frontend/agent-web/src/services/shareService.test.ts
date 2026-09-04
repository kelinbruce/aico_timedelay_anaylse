import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./apiClient.ts', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import { apiClient } from './apiClient.ts';
import { shareService } from './shareService.ts';

const mockPost = vi.mocked(apiClient.post);
const mockGet = vi.mocked(apiClient.get);

describe('shareService hashOps', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockReset();
  });

  it('hashes allowedOps into a length-1 array for createShare', async () => {
    mockPost.mockResolvedValue({ shareId: 's1', shareUrl: 'https://h/#/shared/s1' });
    await shareService.createShare({
      sessionId: 'S1',
      runIds: ['R1'],
      originUrl: 'https://h',
      expiresIn: '7d',
      allowedOps: ['net:read', 'diag:run'],
    });
    const body = mockPost.mock.calls[0]?.[1] as { allowedOps: string[] | null };
    expect(body.allowedOps).toHaveLength(1);
    expect(typeof body.allowedOps?.[0]).toBe('string');
    expect(body.allowedOps?.[0]?.length).toBe(64);
  });

  it('passes null allowedOps unchanged for createShare', async () => {
    mockPost.mockResolvedValue({ shareId: 's1', shareUrl: 'https://h/#/shared/s1' });
    await shareService.createShare({
      sessionId: 'S1',
      runIds: ['R1'],
      originUrl: 'https://h',
      expiresIn: '7d',
      allowedOps: null,
    });
    const body = mockPost.mock.calls[0]?.[1] as { allowedOps: string[] | null };
    expect(body.allowedOps).toBeNull();
  });

  it('produces the same hash regardless of input order', async () => {
    mockPost.mockResolvedValue({ shareId: 's1', shareUrl: 'https://h/#/shared/s1' });
    await shareService.createShare({
      sessionId: 'S1',
      runIds: ['R1'],
      originUrl: 'https://h',
      expiresIn: '7d',
      allowedOps: ['diag:run', 'net:read'],
    });
    const hash1 = (mockPost.mock.calls[0]?.[1] as { allowedOps: string[] }).allowedOps[0];

    mockPost.mockReset();
    mockPost.mockResolvedValue({ shareId: 's1', shareUrl: 'https://h/#/shared/s1' });
    await shareService.createShare({
      sessionId: 'S1',
      runIds: ['R1'],
      originUrl: 'https://h',
      expiresIn: '7d',
      allowedOps: ['net:read', 'diag:run'],
    });
    const hash2 = (mockPost.mock.calls[0]?.[1] as { allowedOps: string[] }).allowedOps[0];

    expect(hash1).toBe(hash2);
  });

  it('produces the same hash regardless of duplicate entries', async () => {
    mockPost.mockResolvedValue({ shareId: 's1', shareUrl: 'https://h/#/shared/s1' });
    await shareService.createShare({
      sessionId: 'S1',
      runIds: ['R1'],
      originUrl: 'https://h',
      expiresIn: '7d',
      allowedOps: ['net:read', 'diag:run', 'net:read'],
    });
    const hash1 = (mockPost.mock.calls[0]?.[1] as { allowedOps: string[] }).allowedOps[0];

    mockPost.mockReset();
    mockPost.mockResolvedValue({ shareId: 's1', shareUrl: 'https://h/#/shared/s1' });
    await shareService.createShare({
      sessionId: 'S1',
      runIds: ['R1'],
      originUrl: 'https://h',
      expiresIn: '7d',
      allowedOps: ['net:read', 'diag:run'],
    });
    const hash2 = (mockPost.mock.calls[0]?.[1] as { allowedOps: string[] }).allowedOps[0];

    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different ops sets', async () => {
    mockPost.mockResolvedValue({ shareId: 's1', shareUrl: 'https://h/#/shared/s1' });
    await shareService.createShare({
      sessionId: 'S1',
      runIds: ['R1'],
      originUrl: 'https://h',
      expiresIn: '7d',
      allowedOps: ['net:read'],
    });
    const hash1 = (mockPost.mock.calls[0]?.[1] as { allowedOps: string[] }).allowedOps[0];

    mockPost.mockReset();
    mockPost.mockResolvedValue({ shareId: 's1', shareUrl: 'https://h/#/shared/s1' });
    await shareService.createShare({
      sessionId: 'S1',
      runIds: ['R1'],
      originUrl: 'https://h',
      expiresIn: '7d',
      allowedOps: ['net:read', 'diag:run'],
    });
    const hash2 = (mockPost.mock.calls[0]?.[1] as { allowedOps: string[] }).allowedOps[0];

    expect(hash1).not.toBe(hash2);
  });

  it('hashes viewerOps into a length-1 array for loadSharedConversation', async () => {
    mockGet.mockResolvedValue({ sessionId: 'S1', messages: [], createdAt: 0 });
    await shareService.loadSharedConversation('share-1', ['net:read', 'diag:run']);
    const opts = mockGet.mock.calls[0]?.[1] as { headers: Record<string, string> };
    const headerValue = JSON.parse(opts.headers['X-Viewer-Ops'] ?? '[]') as string[];
    expect(headerValue).toHaveLength(1);
    expect(headerValue[0]?.length).toBe(64);
  });

  it('does not set X-Viewer-Ops header when viewerOps is null', async () => {
    mockGet.mockResolvedValue({ sessionId: 'S1', messages: [], createdAt: 0 });
    await shareService.loadSharedConversation('share-1', null);
    const opts = mockGet.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(opts.headers['X-Viewer-Ops']).toBeUndefined();
  });
});
