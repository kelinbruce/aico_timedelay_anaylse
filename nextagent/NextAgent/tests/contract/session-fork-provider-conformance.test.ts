import { brand } from '@nextagent/agent-common';
import { runSessionForkProviderConformance, type SessionForkProviderConformanceDriver } from '@nextagent/agent-test-kit';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { describe, expect, it } from 'vitest';

describe('session fork provider conformance', () => {
  it('runs the published provider-neutral suite against LOCAL SQLite', async () => {
    const gateway = createTestGatewayStores();
    const driver: SessionForkProviderConformanceDriver = {
      async reset() {
        return undefined;
      },
      async seedSource(fixture) {
        await gateway.sessions.saveSession(fixture.sourceSession);
        for (const run of fixture.requestRuns ?? []) {
          await gateway.requestRuns.saveRun(run, {});
        }
        for (const message of fixture.messages) {
          await gateway.messages.appendSessionMessage(message);
        }
      },
      sessionForks: gateway.sessionForks,
      async readChild(childSessionId) {
        const sessionId = brand<string, 'SessionId'>(childSessionId);
        const session = await gateway.sessions.loadSession({
          tenantId: brand<string, 'TenantId'>('fork-conformance-tenant'),
          subjectId: brand<string, 'SubjectId'>('fork-conformance-subject'),
          agentId: brand<string, 'AgentId'>('fork-conformance-agent'),
          sessionId,
        });
        if (session === undefined) throw new Error('conformance child session missing');
        const messages = await gateway.messages.listMessages({
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          sessionId,
          includeHidden: true,
          includeCapabilityResults: true,
          limit: 500,
        });
        const active = await gateway.activeContext.loadActiveContext({
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          sessionId,
        });
        return {
          session,
          messages: messages.items,
          activeContextMessageIds: active.items.map((item) => item.messageId),
        };
      },
    };
    await expect(runSessionForkProviderConformance(driver)).resolves.toEqual({
      suiteId: 'session-fork-provider-conformance.v1',
      passedCases: [
        'message-anchor',
        'request-anchor',
        'complete-prefix',
        'active-context',
        'promotion',
        'scope-isolation',
        'idempotency-replay',
        'cancellation',
      ],
    });
  });
});
