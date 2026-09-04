/**
 * E2E Case: feature-tree smoke - 上下文管理.
 * Entry: model tool call result is committed and read back into the next model turn.
 */
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { expect, it } from 'vitest';
import { agentId, describeRealModelSmoke, idem, smokeIdentity, submitAndWaitForSession, waitForSessionStream } from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 上下文管理', () => {
  it('feeds capability result context into the follow-up model turn and conversation projection', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelRequestSink: modelRequests,
      modelSteps: [
        {
          toolCalls: [{ toolCallId: 'context-read-smoke', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }],
        },
        { content: 'Context management smoke completed.' },
      ],
    });

    const result = await submitAndWaitForSession(
      app,
      'Read package metadata for context smoke.',
      'Context management smoke completed.',
      'context-management',
    );
    expect(modelRequests.length).toBeGreaterThanOrEqual(2);

    const conversation = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${result.sessionId}/conversation?limit=10&includeCapabilityResults=true`,
    });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.json<{ items: Array<{ role: string; content: string }> }>().items.map((item) => item.role)).toEqual([
      'USER',
      'CAPABILITY_RESULT',
      'ASSISTANT',
    ]);
  });

  it('persists long-term memory and recalls it through a later request in the same owner and agent scope', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      identity: smokeIdentity,
      modelRequestSink: modelRequests,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'memory-add-smoke',
              toolName: 'add_memory',
              arguments: {
                category: 'FACTUAL',
                content: { category: 'FACTUAL', subject: 'BGP peer', claim: '10.0.0.1' },
                briefIndex: 'BGP peer: 10.0.0.1',
                confidence: 0.7,
              },
            },
          ],
        },
        { content: 'memory saved.' },
        {
          toolCalls: [
            {
              toolCallId: 'memory-search-smoke',
              toolName: 'search_memory',
              arguments: { queryText: 'BGP peer', limit: 5 },
            },
          ],
        },
        { content: 'memory recalled.' },
      ],
    });

    const first = await submitAndWaitForSession(app, 'Remember that BGP peer is 10.0.0.1.', 'memory saved.', 'memory-add');
    expect(first.streamBody).toContain('"capabilityId":"add_memory"');

    const secondAccepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: {
        sessionId: first.sessionId,
        inputText: 'Recall the BGP peer.',
        idempotencyKey: idem('memory-search'),
      },
    });
    expect(secondAccepted.statusCode).toBe(200);
    const second = secondAccepted.json<{ runId: string }>();
    await waitForSessionStream(app, first.sessionId, second.runId, 'memory recalled.');

    expect(modelRequests.some((request) => request.tools.some((tool) => tool.name === 'add_memory'))).toBe(true);
    expect(modelRequests.some((request) => request.tools.some((tool) => tool.name === 'search_memory'))).toBe(true);

    const stored = await app.gateway.longTermMemoryStore.listLongTermMemory({
      tenantId: smokeIdentity.tenantId,
      subjectId: smokeIdentity.subjectId,
      agentId,
      limit: 10,
    });
    expect('code' in stored).toBe(false);
    if ('code' in stored) {
      throw new Error(`Unexpected long-term memory list error: ${stored.code}`);
    }
    expect(stored.items.some((item) => item.briefIndex === 'BGP peer: 10.0.0.1')).toBe(true);

    const conversation = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${first.sessionId}/conversation?limit=30&includeCapabilityResults=true`,
    });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.body).toContain('"toolName":"add_memory"');
    expect(conversation.body).toContain('memory recalled.');
  });
});
