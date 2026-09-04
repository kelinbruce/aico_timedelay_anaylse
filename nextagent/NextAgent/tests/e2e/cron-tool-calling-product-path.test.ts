import { brand } from '@nextagent/agent-common';
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { describe, expect, it } from 'vitest';

describe('Cron tool calling product path', () => {
  it('executes create, list, and delete through the durable gateway-backed Cron tool', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    const identity = {
      tenantId: brand<string, 'TenantId'>('tenant-cron'),
      subjectId: brand<string, 'SubjectId'>('subject-cron'),
      displayName: 'Cron product path tester',
    };
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-cron-create',
              toolName: 'Cron',
              arguments: {
                action: 'create',
                cron: '*/5 * * * *',
                prompt: 'Check LTE handover failures and summarize impacted cells.',
                recurring: true,
              },
            },
          ],
        },
        { toolCalls: [{ toolCallId: 'tool-cron-list-before-delete', toolName: 'Cron', arguments: { action: 'list' } }] },
        { toolCalls: [{ toolCallId: 'tool-cron-delete', toolName: 'Cron', arguments: { action: 'delete', id: 'cron-e2e-task' } }] },
        { toolCalls: [{ toolCallId: 'tool-cron-list-after-delete', toolName: 'Cron', arguments: { action: 'list' } }] },
        { content: 'Cron tools verified.' },
      ],
      identity,
      toolDisclosureMode: 'tool-search',
      modelRequestSink: modelRequests,
      cronTaskIdFactory: () => 'cron-e2e-task',
    });

    const accepted = await app.runtime.submit({
      identityContext: identity,
      agentId: brand<string, 'AgentId'>('default-agent'),
      inputText: 'Schedule, list, then delete the recurring LTE diagnostic cron job.',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('en-US'),
      idempotencyKey: brand<string, 'IdempotencyKey'>(`cron-tools-e2e-${crypto.randomUUID()}`),
    });
    await waitForRunCompleted(app, accepted.runId, identity);

    expect(modelRequests[0]?.tools).toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'Cron', name: 'Cron' })]));

    const messages = await app.gateway.messages.listMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId: brand<string, 'AgentId'>('default-agent'),
      sessionId: accepted.sessionId,
      includeHidden: true,
      includeCapabilityResults: true,
      limit: 20,
    });
    const capabilityResults = messages.items.filter((message) => message.role === 'CAPABILITY_RESULT');
    expect(capabilityResults).toHaveLength(4);
    expect(capabilityResults.every((message) => message.content.includes('"toolName":"Cron"'))).toBe(true);
    expect(
      capabilityResults.every(
        (message) => !message.content.includes('CronCreate') && !message.content.includes('CronList') && !message.content.includes('CronDelete'),
      ),
    ).toBe(true);
    expect(
      capabilityResults.some(
        (message) =>
          message.content.includes('"toolName":"Cron"') &&
          message.content.includes('"action":"create"') &&
          message.content.includes('"id":"cron-e2e-task"'),
      ),
    ).toBe(true);
    expect(
      capabilityResults.some(
        (message) =>
          message.content.includes('"toolName":"Cron"') &&
          message.content.includes('"action":"list"') &&
          message.content.includes('"id":"cron-e2e-task"'),
      ),
    ).toBe(true);
    expect(
      capabilityResults.some(
        (message) =>
          message.content.includes('"toolName":"Cron"') &&
          message.content.includes('"action":"delete"') &&
          message.content.includes('"id":"cron-e2e-task"'),
      ),
    ).toBe(true);
    expect(
      capabilityResults.some(
        (message) =>
          message.content.includes('"toolName":"Cron"') && message.content.includes('"action":"list"') && message.content.includes('"jobs":[]'),
      ),
    ).toBe(true);
    expect(messages.items.some((message) => message.role === 'ASSISTANT' && message.content === 'Cron tools verified.')).toBe(true);

    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${accepted.sessionId}/stream?lastSeenSequence=0&runId=${accepted.runId}`,
    });
    expect(stream.statusCode).toBe(200);
    expect(parseSseEnvelopes(stream.body).filter((event) => event.eventType === 'CAPABILITY_RESULT_DELTA')).toHaveLength(0);
    expect(stream.body).not.toContain('Check LTE handover failures and summarize impacted cells.');
  });
});

interface SseEnvelope {
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
}

function parseSseEnvelopes(body: string): SseEnvelope[] {
  return body
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as SseEnvelope);
}

async function waitForRunCompleted(
  app: ReturnType<typeof createNextAgentTestApp>,
  runId: string,
  identity: { tenantId: ReturnType<typeof brand<string, 'TenantId'>>; subjectId: ReturnType<typeof brand<string, 'SubjectId'>>; displayName: string },
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId: brand<string, 'AgentId'>('default-agent'),
      runId: brand<string, 'RequestRunId'>(runId),
    });
    if (run?.status === 'COMPLETED' && run.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for run completion.');
}
