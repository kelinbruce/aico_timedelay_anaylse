import { brand, type IdentityContext } from '@nextagent/agent-common';
import { createSessionGatewayReadHealthProbe } from '../src/services/session-gateway-health-probe.js';
import { describe, expect, it, vi } from 'vitest';

describe('createSessionGatewayReadHealthProbe', () => {
  it('performs an owner and agent scoped gateway read', async () => {
    const identity: IdentityContext = {
      tenantId: brand<string, 'TenantId'>('tenant-session'),
      subjectId: brand<string, 'SubjectId'>('subject-session'),
      displayName: 'session tester',
    };
    const agentId = brand<string, 'AgentId'>('agent-session');
    const listSessions = vi.fn(async () => ({ entries: [], limit: 1, offset: 0, hasMore: false }));
    const probe = createSessionGatewayReadHealthProbe({
      identity,
      defaultRouteAgentId: agentId,
      sessions: { listSessions },
    });

    await expect(probe.run(new AbortController().signal)).resolves.toEqual({
      status: 'UP',
      reasonCode: 'GATEWAY_READ_OK',
      summary: 'Gateway read check completed.',
    });
    expect(listSessions).toHaveBeenCalledWith({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      offset: 0,
      limit: 1,
    });
  });

  it('returns a safe DOWN result when gateway read fails', async () => {
    const identity: IdentityContext = {
      tenantId: brand<string, 'TenantId'>('tenant-session'),
      subjectId: brand<string, 'SubjectId'>('subject-session'),
      displayName: 'session tester',
    };
    const probe = createSessionGatewayReadHealthProbe({
      identity,
      defaultRouteAgentId: brand<string, 'AgentId'>('agent-session'),
      sessions: {
        listSessions: vi.fn(async () => {
          throw new Error('raw sqlite path C:/secret/session.db');
        }),
      },
    });

    await expect(probe.run(new AbortController().signal)).resolves.toEqual({
      status: 'DOWN',
      reasonCode: 'GATEWAY_READ_FAILED',
      summary: 'Gateway read check failed safely.',
    });
  });
});
