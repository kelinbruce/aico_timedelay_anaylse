import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './apiClient.ts';
import { loadCapabilityPresentationResources } from './capabilityPresentationResourceService.ts';

vi.mock('./apiClient.ts', () => ({ apiClient: { get: vi.fn() } }));

describe('loadCapabilityPresentationResources', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads and validates the complete Session-scoped resource projection', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      resources: [
        {
          capabilityKind: 'SKILL',
          capabilityId: 'alarm-diagnosis',
          displayName: 'Alarm diagnosis',
          locales: { language: { 'zh-CN': { displayName: '告警诊断' }, 'en-US': { displayName: 'Alarm diagnosis' } } },
        },
      ],
    });
    const signal = new AbortController().signal;

    await expect(loadCapabilityPresentationResources('session / 1', signal)).resolves.toEqual({
      resources: [
        {
          capabilityKind: 'SKILL',
          capabilityId: 'alarm-diagnosis',
          displayName: 'Alarm diagnosis',
          locales: { language: { 'zh-CN': { displayName: '告警诊断' }, 'en-US': { displayName: 'Alarm diagnosis' } } },
        },
      ],
    });
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/sessions/session%20%2F%201/capability-presentation-resources', { signal });
  });

  it.each([
    { resources: [{ capabilityKind: 'TOOL', capabilityId: 'Read', displayName: 'Read', extra: true }] },
    { resources: [{ capabilityKind: 'TOOL', capabilityId: 'Read', displayName: '   ' }] },
    { resources: [{ capabilityKind: 'TOOL', capabilityId: 'Read', displayName: 'Read', locales: { language: {} } }] },
    {
      resources: [
        { capabilityKind: 'TOOL', capabilityId: 'Read', displayName: 'Read' },
        { capabilityKind: 'TOOL', capabilityId: 'Write', displayName: 'Write\u0000unsafe' },
      ],
    },
  ])('rejects the complete response when any boundary value is invalid', async (response) => {
    vi.mocked(apiClient.get).mockResolvedValue(response);

    await expect(loadCapabilityPresentationResources('session-a', new AbortController().signal)).rejects.toThrow(
      'Invalid capability presentation resources response.',
    );
  });
});
