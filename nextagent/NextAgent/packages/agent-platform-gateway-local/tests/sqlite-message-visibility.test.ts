import {
  brand,
  type AgentId,
  type MessageId,
  type RequestContextId,
  type RequestRunId,
  type SessionId,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import { createSqliteGatewayStores } from '@nextagent/agent-platform-gateway-local';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const tenantId = 'tenant-message-visibility' as TenantId;
const subjectId = 'subject-message-visibility' as SubjectId;
const agentId = 'agent-message-visibility' as AgentId;
const sessionId = 'session-message-visibility' as SessionId;
const sourceRequestId = 'request-source' as MessageId;
const sourceRunId = 'run-source' as RequestRunId;

describe('SQLite request message visibility', () => {
  let dir: string;
  let stores: ReturnType<typeof createSqliteGatewayStores>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'message-visibility-test-'));
    stores = createSqliteGatewayStores({ sqliteFile: join(dir, 'test.db') });
    await stores.messages.appendSessionMessage(message('source-user', 'USER', sourceRequestId, sourceRunId));
    await stores.messages.appendSessionMessage(message('source-assistant', 'ASSISTANT', sourceRequestId, sourceRunId));
    await stores.messages.appendSessionMessage(
      message('replacement-user', 'USER', 'request-replacement' as MessageId, 'run-replacement' as RequestRunId),
    );
  });

  afterEach(() => {
    stores.close?.();
    rmSync(dir, { recursive: true, force: true });
  });

  it('hides every visible source-request message in one scoped idempotent operation', async () => {
    const request = {
      tenantId,
      subjectId,
      agentId,
      sessionId,
      requestId: sourceRequestId,
      reason: 'EDIT_REPLACED' as const,
      hiddenByContextId: 'context-replacement' as RequestContextId,
    };

    await expect(stores.messages.hideRequestMessages(request)).resolves.toBe(2);
    await expect(stores.messages.hideRequestMessages(request)).resolves.toBe(0);

    const visiblePage = await stores.messages.listMessages({
      tenantId,
      subjectId,
      agentId,
      sessionId,
      includeHidden: false,
      includeCapabilityResults: true,
      limit: 20,
    });
    expect(visiblePage.items.map((item) => item.messageId)).toEqual(['replacement-user']);

    for (const messageId of ['source-user', 'source-assistant'] as const) {
      const hidden = await stores.messages.loadMessage({ tenantId, subjectId, agentId, messageId: messageId as MessageId });
      expect(hidden).toMatchObject({
        visible: false,
        metadata: {
          visibility: {
            reason: 'EDIT_REPLACED',
            hiddenByContextId: 'context-replacement',
          },
        },
      });
    }
  });

  it('does not cross owner, Agent, or session scope', async () => {
    const hiddenCount = await stores.messages.hideRequestMessages({
      tenantId,
      subjectId,
      agentId: 'agent-other' as AgentId,
      sessionId,
      requestId: sourceRequestId,
      reason: 'EDIT_REPLACED',
      hiddenByContextId: 'context-replacement' as RequestContextId,
    });

    expect(hiddenCount).toBe(0);
    await expect(stores.messages.loadMessage({ tenantId, subjectId, agentId, messageId: 'source-user' as MessageId })).resolves.toMatchObject({
      visible: true,
    });
  });
});

function message(messageId: string, role: 'USER' | 'ASSISTANT', requestId: MessageId, runId: RequestRunId) {
  return {
    tenantId,
    subjectId,
    agentId,
    messageId: messageId as MessageId,
    sessionId,
    requestId,
    runId,
    role,
    content: messageId,
    contentType: role === 'USER' ? ('PLAIN_TEXT' as const) : ('MARKDOWN' as const),
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(messageId === 'source-user' ? 1 : messageId === 'source-assistant' ? 2 : 3),
  };
}
