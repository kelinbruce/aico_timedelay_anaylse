import { createDefaultAgentTestAssemblyRegistry } from '@nextagent/agent-platform-gateway-local/testing';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import { createSqliteGatewayStores, type LocalGatewayStores } from '@nextagent/agent-platform-gateway-local';
import { createRequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { createTestGatewayStoresWithSqliteFile } from '../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../fixtures/test-agent.js';
import { describe, expect, it } from 'vitest';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-attachment-reserve'),
  subjectId: brand<string, 'SubjectId'>('subject-attachment-reserve'),
  displayName: 'Attachment Reserve',
};
const agentId = brand<string, 'AgentId'>('default-agent');

describe('attachment reserve submit', () => {
  it('replays the same reserved coordinates across process restart', async () => {
    const { gateway, sqliteFile } = createTestGatewayStoresWithSqliteFile();
    const runtime = createRuntime(gateway);
    const session = await runtime.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-reserve-session'),
    });

    const first = await runtime.reserveSubmit({
      sessionId: session.sessionId,
      identityContext: identity,
      action: 'SUBMIT_REQUEST',
      inputText: 'abc',
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-reserve-submit'),
      attachmentIntakePresent: true,
    });
    const restartedGateway = createSqliteGatewayStores({ sqliteFile });
    try {
      const restartedRuntime = createRuntime(restartedGateway);
      const replay = await restartedRuntime.reserveSubmit({
        sessionId: session.sessionId,
        identityContext: identity,
        action: 'SUBMIT_REQUEST',
        inputText: 'abc',
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-reserve-submit'),
        attachmentIntakePresent: true,
      });

      expect(replay).toMatchObject({
        replay: true,
        reservationId: first.reservationId,
        requestId: first.requestId,
        runId: first.runId,
        requestContextId: first.requestContextId,
      });
    } finally {
      restartedGateway.close?.();
    }
  });

  it('returns conflict for same key with different exact input text and does not accept a run', async () => {
    const { gateway } = createTestGatewayStoresWithSqliteFile();
    const runtime = createRuntime(gateway);
    const session = await runtime.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-reserve-conflict-session'),
    });
    const command = {
      sessionId: session.sessionId,
      identityContext: identity,
      action: 'SUBMIT_REQUEST' as const,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-reserve-conflict'),
      attachmentIntakePresent: true,
    };

    await runtime.reserveSubmit({ ...command, inputText: 'abc' });
    await expect(runtime.reserveSubmit({ ...command, inputText: 'abc\n' })).rejects.toMatchObject({
      code: 'RESERVE_SUBMIT_IDEMPOTENCY_CONFLICT',
    });
    const snapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: session.sessionId,
    });
    expect(snapshot.latestRun).toBeUndefined();
    await expect(
      gateway.messages.listMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: session.sessionId,
        includeHidden: false,
        includeCapabilityResults: false,
        limit: 10,
      }),
    ).resolves.toMatchObject({ items: [] });
  });
});

function createRuntime(gateway: LocalGatewayStores) {
  return createRequestLifecycleCoordinator({
    agentConstructors: [createTestAgentConstructor(async () => {})],
    agentRuntimeDependencies: {},
    assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
    capabilityCatalog: createStaticCapabilityCatalog(),
    defaultRouteAgentId: agentId,
    userSessions: createUserSessionService({
      sessionStore: gateway.sessions,
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
    }),
    messageStore: gateway.messages,
    activeContextStore: gateway.activeContext,
    attachmentReservations: gateway.attachmentReservations,
    requestRunStore: gateway.requestRuns,
    timelineStore: gateway.timeline,
    checkpointStore: gateway.checkpoints,
    pendingInputStore: gateway.pendingInputs,
  });
}
