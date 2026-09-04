import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./apiClient.ts', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { apiClient } from './apiClient.ts';
import { complaintService } from './complaintService.ts';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

describe('complaintService.fetchRiskConfig', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('calls GET /rest/naie/guardrail/config/v1/report/risks', async () => {
    mockGet.mockResolvedValue({ records: [] });
    await complaintService.fetchRiskConfig();
    expect(mockGet).toHaveBeenCalledOnce();
    expect(mockGet.mock.calls[0]![0]).toBe('/rest/naie/guardrail/config/v1/report/risks');
  });

  it('filters records to valid shape', async () => {
    mockGet.mockResolvedValue({
      records: [
        { id: '1', name_en: 'Type One', name_zh: '类型一' },
        { id: 2, name_en: 'Bad', name_zh: '坏' },
        { id: '3', name_en: 'Type Three' },
        null,
      ],
    });
    const config = await complaintService.fetchRiskConfig();
    expect(config.records).toHaveLength(1);
    expect(config.records[0]!.id).toBe('1');
  });

  it('rejects a response without a records array', async () => {
    mockGet.mockResolvedValue({});
    await expect(complaintService.fetchRiskConfig()).rejects.toThrow('Complaint risk config response must contain a records array.');
  });
});

describe('complaintService.createReport', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('calls POST with correct body', async () => {
    mockPost.mockResolvedValue(undefined);
    await complaintService.createReport({
      alog_card: '[Q]q\n[A]a',
      tenant_id: '',
      user_id: 'user-1',
      reason_id: '3',
      reason_detail: 'description',
    });
    expect(mockPost).toHaveBeenCalledOnce();
    const [url, body] = mockPost.mock.calls[0]!;
    expect(url).toBe('/rest/naie/guardrail/config/v1/report/create');
    expect(body).toEqual({
      alog_card: '[Q]q\n[A]a',
      tenant_id: '',
      user_id: 'user-1',
      reason_id: '3',
      reason_detail: 'description',
    });
  });
});
