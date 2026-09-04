import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { afterEach, describe, expect, it } from 'vitest';
import { agentId, apps, closeLifecycleHookApps, identity, listTimelineEvents, waitForTimelineEvent } from './lifecycle-hook-test-helpers.js';

afterEach(async () => {
  await closeLifecycleHookApps();
});

describe('user query memory recall product path', () => {
  it('injects recalled memory into the first final model input and skips later model rounds', async () => {
    const captured: ModelInvocationRequest[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'read-after-recall',
              toolName: 'Read',
              arguments: { file_path: 'package.json', offset: 0, limit: 1 },
            },
          ],
        },
        { content: 'recall complete' },
      ],
      modelRequestSink: captured,
      identity,
      hooks: [
        {
          hookId: 'user-query-memory-recall',
          stages: ['BEFORE_MODEL_INVOKE'],
          enabled: true,
        },
      ],
    });
    apps.push(app);
    const saved = await app.gateway.longTermMemoryStore.saveLongTermMemory({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'LEARNED',
      briefIndex: 'UPF route preference',
      content: 'The preferred UPF route uses the east region.',
      confidence: 0.9,
      source: 'integration-test',
    });
    expect(saved).not.toHaveProperty('code');
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('memory-recall-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'Which UPF route should I use?',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('memory-recall-submit'),
    });
    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');

    const root = await app.gateway.messages.loadMessage({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      messageId: accepted.requestId,
    });
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: accepted.runId,
    });
    const hookEvents = (await listTimelineEvents(app, session.sessionId, accepted.runId))
      .filter((event) => event.type === 'HOOK_INVOKED')
      .map((event) => event.inlinePayload);
    const recallHookEvents = hookEvents.filter((event) => event['hookId'] === 'user-query-memory-recall');
    expect({ root, run, hookEvents }).toMatchObject({
      root: { role: 'USER', runId: accepted.runId },
      run: { attempt: 1 },
      hookEvents: expect.arrayContaining([
        expect.objectContaining({ hookId: 'user-query-memory-recall', diagnosticCode: 'MEMORY_RECALL_L2_CONTEXT_ADMITTED' }),
        expect.objectContaining({ hookId: 'user-query-memory-recall', diagnosticCode: 'MEMORY_RECALL_SKIPPED_NOT_INITIAL_MODEL' }),
      ]),
    });
    expect(captured).toHaveLength(2);
    expect(recallHookEvents.filter((event) => event['diagnosticCode'] === 'MEMORY_RECALL_L2_CONTEXT_ADMITTED')).toHaveLength(1);
    expect(recallHookEvents.filter((event) => event['diagnosticCode'] === 'MEMORY_RECALL_SKIPPED_NOT_INITIAL_MODEL')).toHaveLength(1);
    const firstMessageText = captured[0]!.messages.map((message) => JSON.stringify(message)).join('\n');
    const secondMessageText = captured[1]!.messages.map((message) => JSON.stringify(message)).join('\n');
    expect(firstMessageText).toContain('The preferred UPF route uses the east region.');
    expect(firstMessageText.indexOf('The preferred UPF route uses the east region.')).toBeLessThan(
      firstMessageText.indexOf('Which UPF route should I use?'),
    );
    expect(secondMessageText).not.toContain('The preferred UPF route uses the east region.');
  });
});
