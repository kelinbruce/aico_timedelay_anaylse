import { brand } from '@nextagent/agent-common';
import type { ReplaceTodoStateRequest, TodoStateCurrentRecord, TodoStateRevisionRecord } from '@nextagent/agent-contracts/gateway';
import { describe, expect, it } from 'vitest';

describe('Todo state gateway contracts', () => {
  it('carries owner, agent, session, and revision coordinates explicitly', () => {
    const request = {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      agentId: brand<string, 'AgentId'>('agent-1'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('request-1'),
      requestRunId: brand<string, 'RequestRunId'>('run-1'),
      requestContextId: brand<string, 'RequestContextId'>('context-1'),
      toolCallId: brand<string, 'ToolCallId'>('tool-1'),
      todos: [{ content: 'Inspect AMF alarm', activeForm: 'Inspecting AMF alarm', status: 'pending' }],
    } satisfies ReplaceTodoStateRequest;
    const revision = {
      ...request,
      revisionSeq: 1,
      createdAt: brand<number, 'EpochMillis'>(1),
    } satisfies TodoStateRevisionRecord;
    const current = {
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: request.agentId,
      sessionId: request.sessionId,
      revisionSeq: revision.revisionSeq,
      todos: revision.todos,
      updatedAt: brand<number, 'EpochMillis'>(2),
    } satisfies TodoStateCurrentRecord;

    expect(current).toMatchObject({
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
      agentId: 'agent-1',
      sessionId: 'session-1',
      revisionSeq: 1,
    });
  });
});
