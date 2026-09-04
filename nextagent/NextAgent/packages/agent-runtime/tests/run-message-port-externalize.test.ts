import { brand } from '@nextagent/agent-common';
import type { SessionMessageRecord, SessionMessageStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import type { SessionMessageDraft } from '@nextagent/agent-contracts/session';
import { createRuntimeOwnedRunMessagePort } from '@nextagent/agent-runtime';
import { describe, expect, it } from 'vitest';

describe('RuntimeOwnedRunMessagePort large content externalizer', () => {
  it('calls the injected externalizer before persisting assistant-owned messages', async () => {
    let saved: SessionMessageRecord | undefined;
    const port = createRuntimeOwnedRunMessagePort({
      messageStore: messageStore((record) => {
        saved = record;
      }),
      clock: () => brand<number, 'EpochMillis'>(1000),
      idFactory: (prefix) => `${prefix}-1`,
      largeContentExternalizer: {
        async externalize(draft, executionContext) {
          expect(executionContext.messageId).toBe('capability-result-1');
          expect(executionContext.agentAssemblyRef).toBe('agent-runtime:v1');
          return {
            ...draft,
            content: 'externalized preview',
            metadata: { replacement: { kind: 'PERSISTED_PREVIEW', contentRef: { refId: 'tool-results/result.txt', refType: 'CAPABILITY_RESULT' } } },
          };
        },
      },
    });

    await expect(port.appendMessage(run(), context(), draft('raw oversized result'))).resolves.toBe('capability-result-1');

    expect(saved).toMatchObject({
      messageId: 'capability-result-1',
      role: 'CAPABILITY_RESULT',
      content: 'externalized preview',
      metadata: {
        replacement: {
          kind: 'PERSISTED_PREVIEW',
          contentRef: { refId: 'tool-results/result.txt', refType: 'CAPABILITY_RESULT' },
        },
      },
    });
  });

  it('persists the original draft when no externalizer is injected', async () => {
    let saved: SessionMessageRecord | undefined;
    const port = createRuntimeOwnedRunMessagePort({
      messageStore: messageStore((record) => {
        saved = record;
      }),
      clock: () => brand<number, 'EpochMillis'>(1000),
      idFactory: (prefix) => `${prefix}-1`,
    });

    await expect(port.appendMessage(run(), context(), draft('plain result'))).resolves.toBe('capability-result-1');

    expect(saved).toMatchObject({
      content: 'plain result',
      metadata: {},
    });
  });
});

function messageStore(capture: (record: SessionMessageRecord) => void): SessionMessageStoreGateway {
  return {
    async appendSessionMessage(record) {
      capture(record);
      return record;
    },
    async loadMessage() {
      return undefined;
    },
    async listConversationPreview() {
      return { sessionId: brand<string, 'SessionId'>('session-runtime'), totalMarkers: 0, offset: 0, limit: 100, markers: [] };
    },
    async loadMessages() {
      return [];
    },
    async listMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async listCurrentRequestMessages() {
      return { items: [], offset: 0, limit: 20, hasMore: false };
    },
    async hideMessage() {
      return undefined;
    },
    async hideRequestMessages() {
      return 0;
    },
  };
}

function draft(content: string): SessionMessageDraft {
  return {
    role: 'CAPABILITY_RESULT',
    content,
    contentType: 'PLAIN_TEXT',
    visible: true,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-runtime-message'),
  };
}

function run(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-runtime'),
    sessionId: brand<string, 'SessionId'>('session-runtime'),
    requestId: brand<string, 'MessageId'>('request-runtime'),
    agentId: brand<string, 'AgentId'>('agent-runtime'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-runtime:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1000),
    updatedAt: brand<number, 'EpochMillis'>(1000),
  };
}

function context(): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-runtime'),
    sessionId: brand<string, 'SessionId'>('session-runtime'),
    requestId: brand<string, 'MessageId'>('request-runtime'),
    runId: brand<string, 'RequestRunId'>('run-runtime'),
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-runtime'),
      subjectId: brand<string, 'SubjectId'>('subject-runtime'),
      displayName: 'Runtime tester',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: brand<string, 'AgentId'>('agent-runtime'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-runtime:v1',
    nextLifecycleStage: 'AFTER_CAPABILITY_RESULT',
    toolCallStates: [],
    flowVariables: {},
  };
}
