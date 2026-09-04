import { brand } from '@nextagent/agent-common';
import { createLocalUserQueryGateway } from '@nextagent/agent-platform-gateway-local';
import { describe, expect, it } from 'vitest';

describe('local user query gateway', () => {
  it('maps requested users in request order', async () => {
    const gateway = createLocalUserQueryGateway();

    await expect(
      gateway.queryUsers({
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('caller-1'),
        targetSubjectIds: [brand<string, 'SubjectId'>('subject-a'), brand<string, 'SubjectId'>('subject-b')],
      }),
    ).resolves.toEqual({
      users: [
        { subjectId: 'subject-a', userName: 'subject-a-name' },
        { subjectId: 'subject-b', userName: 'subject-b-name' },
      ],
    });
  });

  it('returns a safe cancellation without partial users', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createLocalUserQueryGateway().queryUsers(
        {
          tenantId: brand<string, 'TenantId'>('tenant-1'),
          subjectId: brand<string, 'SubjectId'>('caller-1'),
          targetSubjectIds: [brand<string, 'SubjectId'>('subject-a')],
        },
        controller.signal,
      ),
    ).resolves.toMatchObject({ category: 'CANCELED', retryable: false });
  });
});
