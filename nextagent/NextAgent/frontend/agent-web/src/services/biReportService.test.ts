import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./apiClient.ts', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

import { apiClient } from './apiClient.ts';
import { biReportService } from './biReportService.ts';

const mockPost = vi.mocked(apiClient.post);

describe('biReportService.generateReport', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('sends POST with requestIds in body', async () => {
    const dslContent = { type: 'piu', properties: { name: 'dte-bi-agent' } };
    mockPost.mockResolvedValue(dslContent);

    const result = await biReportService.generateReport({
      sessionId: 's1',
      requestIds: ['R1', 'R2'],
    });

    expect(mockPost).toHaveBeenCalledOnce();
    const [url, body] = mockPost.mock.calls[0]!;
    expect(url).toBe('/rest/naie/aicoservice/v1/sessions/s1/bi-reports');
    expect(body).toEqual({ requestIds: ['R1', 'R2'] });
    expect(result).toEqual(dslContent);
  });

  it('encodes sessionId in path', async () => {
    mockPost.mockResolvedValue({});

    await biReportService.generateReport({ sessionId: 's/d', requestIds: ['R1'] });

    const url = mockPost.mock.calls[0]![0]! as string;
    expect(url).toContain('/sessions/s%2Fd/bi-reports');
  });

  it('passes AbortSignal when provided', async () => {
    mockPost.mockResolvedValue({});
    const controller = new AbortController();

    await biReportService.generateReport({ sessionId: 's1', requestIds: ['R1'], signal: controller.signal });

    const init = mockPost.mock.calls[0]![2] as { signal: AbortSignal } | undefined;
    expect(init?.signal).toBe(controller.signal);
  });

  it('does not pass init when no signal', async () => {
    mockPost.mockResolvedValue({});

    await biReportService.generateReport({ sessionId: 's1', requestIds: ['R1'] });

    const init = mockPost.mock.calls[0]![2];
    expect(init).toBeUndefined();
  });

  it('handles single requestId', async () => {
    mockPost.mockResolvedValue({});

    await biReportService.generateReport({ sessionId: 's1', requestIds: ['only-id'] });

    const [url, body] = mockPost.mock.calls[0]!;
    expect(url).toBe('/rest/naie/aicoservice/v1/sessions/s1/bi-reports');
    expect(body).toEqual({ requestIds: ['only-id'] });
  });
});
