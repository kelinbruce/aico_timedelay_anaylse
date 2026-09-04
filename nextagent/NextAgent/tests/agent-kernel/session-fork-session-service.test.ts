import { brand, type EpochMillis } from '@nextagent/agent-common';
import type { SessionMessageRecord, SessionRecord } from '@nextagent/agent-contracts/gateway';
import { createUserSessionService } from '@nextagent/agent-session';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { describe, expect, it } from 'vitest';

const identityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-fork-session'),
  subjectId: brand<string, 'SubjectId'>('subject-fork-session'),
  displayName: 'session fork tester',
};
const agentId = brand<string, 'AgentId'>('agent-fork-session');
const sourceSessionId = brand<string, 'SessionId'>('source-session-service');
const childSessionId = brand<string, 'SessionId'>('child-session-service');

function at(value: number): EpochMillis {
  return brand<number, 'EpochMillis'>(value);
}

function session(sessionId: SessionRecord['sessionId'], title: string): SessionRecord {
  return {
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    sessionId,
    title,
    createdAt: at(1),
    updatedAt: at(1),
  };
}

function message(overrides: Partial<SessionMessageRecord> = {}): SessionMessageRecord {
  return {
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    sessionId: childSessionId,
    messageId: brand<string, 'MessageId'>('child-u1'),
    requestId: brand<string, 'MessageId'>('child-u1'),
    role: 'USER',
    content: 'hello',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: at(1),
    ...overrides,
  };
}

describe('session fork notice read model', () => {
  it('shows notice only on default latest reads before the first child user message', async () => {
    const gateway = createTestGatewayStores();
    const childSessionId = await materializeForkChild(gateway);
    const service = createUserSessionService({
      sessionStore: gateway.sessions,
      messageStore: gateway.messages,
      sessionForkStore: gateway.sessionForks,
      activeContextStore: gateway.activeContext,
    });

    const latest = await service.listMessages({
      identityContext,
      agentId,
      sessionId: childSessionId,
      includeCapabilityResults: true,
      limit: 10,
    });
    expect(latest.forkNotice).toEqual({ sourceSessionId, sourceSessionTitle: 'Source Snapshot' });
    expect(latest.items.map((item) => item.content)).toEqual(['hello', 'answer']);
    const childAnchorMessageId = latest.items.at(-1)!.messageId;

    await expect(
      service.listMessages({
        identityContext,
        agentId,
        sessionId: childSessionId,
        includeCapabilityResults: true,
        beforeCursor: childAnchorMessageId,
        limit: 10,
      }),
    ).resolves.not.toHaveProperty('forkNotice');
    await expect(
      service.listMessages({
        identityContext,
        agentId,
        sessionId: childSessionId,
        includeCapabilityResults: true,
        anchorMessageId: childAnchorMessageId,
        limit: 10,
      }),
    ).resolves.not.toHaveProperty('forkNotice');

    await gateway.messages.appendSessionMessage(
      message({
        sessionId: childSessionId,
        messageId: brand<string, 'MessageId'>('child-u2'),
        requestId: brand<string, 'MessageId'>('child-u2'),
        role: 'USER',
        content: 'new question',
        createdAt: at(Date.now() + 10_000),
      }),
    );
    await expect(
      service.listMessages({
        identityContext,
        agentId,
        sessionId: childSessionId,
        includeCapabilityResults: true,
        limit: 10,
      }),
    ).resolves.not.toHaveProperty('forkNotice');
  });

  it('uses the stored title snapshot without checking source availability', async () => {
    const gateway = createTestGatewayStores();
    const childSessionId = await materializeForkChild(gateway);
    await gateway.sessions.deleteSessionCascade({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId: sourceSessionId,
    });
    const service = createUserSessionService({
      sessionStore: gateway.sessions,
      messageStore: gateway.messages,
      sessionForkStore: gateway.sessionForks,
      activeContextStore: gateway.activeContext,
    });

    await expect(
      service.listMessages({
        identityContext,
        agentId,
        sessionId: childSessionId,
        includeCapabilityResults: true,
        limit: 10,
      }),
    ).resolves.toMatchObject({ forkNotice: { sourceSessionId, sourceSessionTitle: 'Source Snapshot' } });
  });
});

async function materializeForkChild(gateway: ReturnType<typeof createTestGatewayStores>): Promise<SessionRecord['sessionId']> {
  await gateway.sessions.saveSession(session(sourceSessionId, 'Source Snapshot'));
  const sourceRequestId = brand<string, 'MessageId'>('source-u1');
  const sourceAnchorMessageId = brand<string, 'MessageId'>('source-a1');
  await gateway.messages.appendSessionMessage(
    message({ sessionId: sourceSessionId, messageId: sourceRequestId, requestId: sourceRequestId, createdAt: at(2) }),
  );
  await gateway.messages.appendSessionMessage(
    message({
      sessionId: sourceSessionId,
      messageId: sourceAnchorMessageId,
      requestId: sourceRequestId,
      role: 'ASSISTANT',
      content: 'answer',
      createdAt: at(3),
    }),
  );
  const coordinates = {
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    sourceSessionId,
    sourceMessageId: sourceAnchorMessageId,
    idempotencyKey: brand<string, 'IdempotencyKey'>('fork-key-session-service'),
  } as const;
  const prepared = await gateway.sessionForks.prepareFork(coordinates);
  const result = await gateway.sessionForks.forkSession({ ...coordinates, forkAttemptId: prepared.forkAttemptId });
  return result.childSession.sessionId;
}
