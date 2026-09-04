import { createNextAgentTestApp, loadBuiltInDefaultAgentDefinition, readCapturedAuditRecords } from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type AgentType, type JsonObject, type RequestLocale } from '@nextagent/agent-common';
import { assertCapabilityResultSafe, executeToolCallsInOrder, type RequestLocalCapabilityState } from '@nextagent/agent-core';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { CheckpointRecord, PendingInputRecord, RequestRunRecord, SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import type { SessionMessageDraft } from '@nextagent/agent-contracts/session';
import { describe, expect, it } from 'vitest';

describe('minimal tool loop behavior', () => {
  it('preserves public assistant content with tool calls for the next model round without retaining reasoning', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    const publicContent = '我先读取配置，再根据结果继续诊断。';
    const privateReasoning = 'private-reasoning-must-not-persist';
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelRequestSink: modelRequests,
      modelSteps: [
        {
          content: publicContent,
          reasoningChunks: [privateReasoning],
          toolCalls: [{ toolCallId: 'tool-read-with-content', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }],
        },
        { content: '诊断完成。' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: '检查配置', idempotencyKey: 'idem-tool-assistant-content' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body).toContain('event: REQUEST_COMPLETED');
    expect(modelRequests).toHaveLength(2);
    const followUpMessages = modelRequests[1]!.messages;
    const assistantToolUse = followUpMessages.find(
      (message) => message.role === 'ASSISTANT' && message.content.some((part) => part.type === 'tool-call'),
    );
    expect(assistantToolUse?.content).toEqual([
      { type: 'text', text: publicContent },
      {
        type: 'tool-call',
        toolCall: { toolCallId: 'tool-read-with-content', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } },
      },
    ]);
    expect(followUpMessages.findIndex((message) => message === assistantToolUse)).toBeLessThan(
      followUpMessages.findIndex((message) => message.role === 'TOOL'),
    );

    const fullCurrentRunMessages = await app.gateway.messages.listCurrentRequestMessages({
      tenantId: defaultHttpIdentity.tenantId,
      subjectId: defaultHttpIdentity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(body.sessionId),
      requestId: brand<string, 'MessageId'>(body.requestId),
      runId: brand<string, 'RequestRunId'>(body.runId),
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    const persistedToolUse = fullCurrentRunMessages.items.find((message) => message.metadata['kind'] === 'ASSISTANT_TOOL_USE');
    expect(JSON.parse(persistedToolUse!.content)).toEqual({
      content: publicContent,
      toolCalls: [{ toolCallId: 'tool-read-with-content', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }],
    });
    expect(JSON.stringify({ persistedToolUse, followUpMessages })).not.toContain(privateReasoning);
    await app.close();
  });

  it('persists each tool round as one assistant message without repeating prior round content', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelRequestSink: modelRequests,
      modelSteps: [
        {
          content: 'round-one',
          toolCalls: [{ toolCallId: 'tool-round-one', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }],
        },
        {
          content: 'round-two',
          toolCalls: [{ toolCallId: 'tool-round-two', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }],
        },
        { content: 'done' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'inspect two rounds', idempotencyKey: 'idem-tool-assistant-round-boundary' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body).toContain('event: REQUEST_COMPLETED');
    expect(modelRequests).toHaveLength(3);
    const thirdRequestAssistantTexts = modelRequests[2]!.messages
      .filter((message) => message.role === 'ASSISTANT' && message.content.some((part) => part.type === 'tool-call'))
      .flatMap((message) => message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])));
    expect(thirdRequestAssistantTexts).toEqual(['round-one', 'round-two']);

    const messages = await app.gateway.messages.listCurrentRequestMessages({
      tenantId: defaultHttpIdentity.tenantId,
      subjectId: defaultHttpIdentity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(body.sessionId),
      requestId: brand<string, 'MessageId'>(body.requestId),
      runId: brand<string, 'RequestRunId'>(body.runId),
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    const persistedAssistantTexts = messages.items
      .filter((message) => message.metadata['kind'] === 'ASSISTANT_TOOL_USE')
      .map((message) => (JSON.parse(message.content) as { content?: string }).content);
    expect(persistedAssistantTexts).toEqual(['round-one', 'round-two']);
    const finalAssistant = messages.items.find((message) => message.role === 'ASSISTANT' && message.visible);
    expect(finalAssistant?.content).toBe('done');
    await app.close();
  });

  it('executes multiple read tool calls in model order before the follow-up model answer', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            { toolCallId: 'tool-read-a', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } },
            { toolCallId: 'tool-read-b', toolName: 'Read', arguments: { file_path: 'package-lock.json', offset: 0, limit: 1 } },
          ],
        },
        { content: '两个文件均已读取。' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: '读取两个文件', idempotencyKey: 'idem-tool-order' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body.indexOf('tool-read-a')).toBeLessThan(stream.body.indexOf('tool-read-b'));
    expect(stream.body).toContain('event: REQUEST_COMPLETED');
    expect(readCapturedAuditRecords(app)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: 'request.accepted', requestRunId: body.runId }),
        expect.not.objectContaining({ eventName: 'capability.completed' }),
      ]),
    );

    const currentRunMessages = await app.gateway.messages.listCurrentRequestMessages({
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      agentId: brand<string, 'AgentId'>('default-agent'),
      sessionId: brand<string, 'SessionId'>(body.sessionId),
      requestId: brand<string, 'MessageId'>(body.requestId),
      runId: brand<string, 'RequestRunId'>(body.runId),
      includeHidden: false,
      offset: 0,
      limit: 20,
    });
    expect(currentRunMessages.items.map((item) => item.role)).toEqual(['USER', 'CAPABILITY_RESULT', 'CAPABILITY_RESULT', 'ASSISTANT']);
    expect(currentRunMessages.items.filter((item) => item.role === 'CAPABILITY_RESULT').map((item) => item.content)).toEqual([
      expect.stringContaining('tool-read-a'),
      expect.stringContaining('tool-read-b'),
    ]);

    const fullCurrentRunMessages = await app.gateway.messages.listCurrentRequestMessages({
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      agentId: brand<string, 'AgentId'>('default-agent'),
      sessionId: brand<string, 'SessionId'>(body.sessionId),
      requestId: brand<string, 'MessageId'>(body.requestId),
      runId: brand<string, 'RequestRunId'>(body.runId),
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    const persistedToolUse = fullCurrentRunMessages.items.find((item) => item.metadata['kind'] === 'ASSISTANT_TOOL_USE' && item.visible === false);
    expect(persistedToolUse).toBeDefined();
    expect(JSON.parse(persistedToolUse!.content)).not.toHaveProperty('content');
    await app.close();
  });

  it('materializes AskUserQuestion answer as one capability result and resumes without reinvoking it', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'ask-region-1',
              toolName: 'AskUserQuestion',
              arguments: {
                questions: [
                  {
                    prompt: 'Which region should I inspect?',
                    options: [
                      { value: 'north', label: 'North' },
                      { value: 'south', label: 'South' },
                    ],
                  },
                ],
              },
            },
          ],
        },
        { content: 'region accepted' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'need region', idempotencyKey: 'idem-ask-user-question' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const pending = await waitForActivePending(app, body.sessionId);

    expect(pending).toMatchObject({
      kind: 'QUESTION',
      producerRef: { kind: 'CAPABILITY_INVOCATION', capabilityId: 'AskUserQuestion', toolCallId: 'ask-region-1' },
    });
    expect((await listCurrentRunMessages(app, body)).items.some((message) => message.role === 'CAPABILITY_RESULT')).toBe(false);

    await app.runtime.answerPendingInput({
      identityContext: defaultHttpIdentity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-ask-user-question-answer'),
      answer: { sessionId: pending.sessionId, pendingInputId: pending.pendingInputId, answers: [['north']] },
    });
    await waitFor(async () => (await listCurrentRunMessages(app, body)).items.some((message) => message.content === 'region accepted'));

    const messages = await listCurrentRunMessages(app, body);
    const capabilityResults = messages.items.filter((message) => message.role === 'CAPABILITY_RESULT');
    expect(capabilityResults).toHaveLength(1);
    expect(JSON.parse(capabilityResults[0]!.content)).toEqual({
      toolCallId: 'ask-region-1',
      toolName: 'AskUserQuestion',
      payload: expect.objectContaining({
        status: 'RECEIVED',
        kind: 'QUESTION',
        answers: [['north']],
      }),
    });
    const timeline = await app.gateway.timeline.listEvents({
      tenantId: defaultHttpIdentity.tenantId,
      subjectId: defaultHttpIdentity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(body.sessionId),
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
      runId: brand<string, 'RequestRunId'>(body.runId),
    });
    expect(timeline).toContainEqual(
      expect.objectContaining({
        type: 'CAPABILITY_COMPLETED',
        inlinePayload: expect.objectContaining({
          messageId: capabilityResults[0]!.messageId,
          capabilityId: 'AskUserQuestion',
          toolCallId: 'ask-region-1',
          status: 'SUCCEEDED',
        }),
      }),
    );
    expect(messages.items.at(-1)?.content).toBe('region accepted');
  });

  it('preserves Tool call overflow feedback across AskUserQuestion pause and resume', async () => {
    const agentDefinition = loadBuiltInDefaultAgentDefinition();
    const modelRequests: ModelInvocationRequest[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelRequestSink: modelRequests,
      agentDefinition: {
        ...agentDefinition,
        workspaceDir: '.',
        runtimeSettings: { ...agentDefinition.runtimeSettings, maxTurns: 2, maxToolCallsPerTurn: 1 },
      },
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'ask-overflow-region',
              toolName: 'AskUserQuestion',
              arguments: {
                questions: [
                  {
                    prompt: 'Which region should I inspect?',
                    options: [
                      { value: 'north', label: 'North' },
                      { value: 'south', label: 'South' },
                    ],
                  },
                ],
              },
            },
            {
              toolCallId: 'omitted-after-pending',
              toolName: 'Read',
              arguments: { file_path: 'package.json', offset: 0, limit: 1 },
            },
          ],
        },
        { content: 'region accepted after overflow feedback' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'need region with overflow', idempotencyKey: 'idem-ask-user-question-overflow' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const pending = await waitForActivePending(app, body.sessionId);

    await app.runtime.answerPendingInput({
      identityContext: defaultHttpIdentity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-ask-user-question-overflow-answer'),
      answer: { sessionId: pending.sessionId, pendingInputId: pending.pendingInputId, answers: [['north']] },
    });
    await waitFor(async () =>
      (await listCurrentRunMessages(app, body)).items.some((message) => message.content === 'region accepted after overflow feedback'),
    );

    expect(modelRequests).toHaveLength(2);
    const resumedInput = JSON.stringify(modelRequests[1]!.messages);
    expect(resumedInput).toContain('requested 2 tool calls');
    expect(resumedInput).toContain('1 were admitted and 1 were not admitted or executed');
    expect(resumedInput).not.toContain('omitted-after-pending');
    await app.close();
  });

  it('creates later AskUserQuestion pending input only after the earlier one resumes', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'ask-first',
              toolName: 'AskUserQuestion',
              arguments: {
                questions: [
                  {
                    prompt: 'Which market?',
                    options: [
                      { value: 'east', label: 'East' },
                      { value: 'west', label: 'West' },
                    ],
                  },
                ],
              },
            },
            {
              toolCallId: 'ask-second',
              toolName: 'AskUserQuestion',
              arguments: {
                questions: [
                  {
                    prompt: 'Which severity?',
                    options: [
                      { value: 'minor', label: 'Minor' },
                      { value: 'major', label: 'Major' },
                    ],
                  },
                ],
              },
            },
          ],
        },
        { content: 'both answers received' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'need two clarifications', idempotencyKey: 'idem-ask-user-question-batch' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const firstPending = await waitForActivePending(app, body.sessionId);
    expect(firstPending.producerRef).toMatchObject({ kind: 'CAPABILITY_INVOCATION', toolCallId: 'ask-first' });
    expect(
      (await listCurrentRunMessages(app, body)).items.some(
        (message) => message.content.includes('ask-second') && message.role === 'CAPABILITY_RESULT',
      ),
    ).toBe(false);

    await app.runtime.answerPendingInput({
      identityContext: defaultHttpIdentity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-ask-user-question-batch-first'),
      answer: { sessionId: firstPending.sessionId, pendingInputId: firstPending.pendingInputId, answers: [['east']] },
    });
    await waitFor(async () => {
      const active = await loadActivePending(app, body.sessionId);
      return active !== undefined && active.pendingInputId !== firstPending.pendingInputId;
    });
    const secondPending = (await loadActivePending(app, body.sessionId))!;
    expect(secondPending.producerRef).toMatchObject({ kind: 'CAPABILITY_INVOCATION', toolCallId: 'ask-second' });

    await app.runtime.answerPendingInput({
      identityContext: defaultHttpIdentity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-ask-user-question-batch-second'),
      answer: { sessionId: secondPending.sessionId, pendingInputId: secondPending.pendingInputId, answers: [['major']] },
    });
    await waitFor(async () => (await listCurrentRunMessages(app, body)).items.some((message) => message.content === 'both answers received'));

    const capabilityResults = (await listCurrentRunMessages(app, body)).items.filter((message) => message.role === 'CAPABILITY_RESULT');
    expect(capabilityResults.map((message) => JSON.parse(message.content).toolCallId)).toEqual(['ask-first', 'ask-second']);
    expect(capabilityResults.map((message) => JSON.parse(message.content).payload.answers)).toEqual([[['east']], [['major']]]);
  });

  it('executes a tool-call batch below the configured per-turn limit', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: Array.from({ length: 6 }, (_value, index) => ({
            toolCallId: `tool-read-${index}`,
            toolName: 'Read',
            arguments: { file_path: 'package.json', offset: 0, limit: 1 },
          })),
        },
        { content: 'done' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'read several files', idempotencyKey: 'idem-tool-read-batch' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body).not.toContain('TOOL_CALL_LIMIT_EXCEEDED');
    expect(stream.body).toContain('event: CAPABILITY_STARTED');
  });

  it('admits only the configured tool-call prefix and completes after model feedback', async () => {
    const agentDefinition = loadBuiltInDefaultAgentDefinition();
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      agentDefinition: {
        ...agentDefinition,
        workspaceDir: '.',
        runtimeSettings: { ...agentDefinition.runtimeSettings, maxTurns: 2, maxToolCallsPerTurn: 30 },
      },
      modelSteps: [
        {
          toolCalls: Array.from({ length: 31 }, (_item, index) => ({
            toolCallId: `tool-too-many-${index}`,
            toolName: 'Read',
            arguments: { file_path: 'package.json', offset: 0, limit: 1 },
          })),
        },
        { content: 'admitted prefix completed' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'too many read-only tools', idempotencyKey: 'idem-tool-limit-readonly' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body).toContain('TOOL_CALL_LIMIT_EXCEEDED');
    expect(stream.body).toContain('event: REQUEST_COMPLETED');
    expect(stream.body.match(/event: CAPABILITY_STARTED/gu)).toHaveLength(30);
    expect(stream.body).not.toContain('tool-too-many-30');
    const messages = (await listCurrentRunMessages(app, body, true)).items;
    const assistantToolUse = messages.find((message) => message.role === 'ASSISTANT' && message.metadata['kind'] === 'ASSISTANT_TOOL_USE');
    const storedCalls = JSON.parse(assistantToolUse?.content ?? '{}').toolCalls as ReadonlyArray<{ readonly toolCallId: string }>;
    expect(storedCalls).toHaveLength(30);
    expect(storedCalls.at(-1)?.toolCallId).toBe('tool-too-many-29');
    expect(messages.filter((message) => message.role === 'CAPABILITY_RESULT')).toHaveLength(30);
  });

  it('finalizes once after maxTurns without executing returned tool calls', async () => {
    const agentDefinition = loadBuiltInDefaultAgentDefinition();
    const modelRequests: ModelInvocationRequest[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelRequestSink: modelRequests,
      agentDefinition: {
        ...agentDefinition,
        workspaceDir: '.',
        runtimeSettings: { ...agentDefinition.runtimeSettings, maxTurns: 2, maxToolCallsPerTurn: 30 },
      },
      modelSteps: [
        { toolCalls: [{ toolCallId: 'tool-round-1', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }] },
        { toolCalls: [{ toolCallId: 'tool-round-2', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }] },
        {
          content: 'final verified summary',
          toolCalls: [{ toolCallId: 'tool-round-3', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }],
        },
        { content: 'should not be reached' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'repeat tools', idempotencyKey: 'idem-tool-round-limit' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body).toContain('TOOL_ROUND_LIMIT_EXCEEDED');
    expect(stream.body).toContain('event: REQUEST_COMPLETED');
    expect(stream.body).toContain('final verified summary');
    expect(stream.body).not.toContain('tool-round-3');
    expect(stream.body).not.toContain('should not be reached');
    expect(modelRequests).toHaveLength(3);
    expect(modelRequests[2]?.toolChoice).toBe('NONE');
    expect(modelRequests[2]?.tools.length).toBeGreaterThan(0);
    expect(JSON.stringify(modelRequests[2]?.messages)).toContain('reached its normal turn limit');
    expect(JSON.stringify((await listCurrentRunMessages(app, body, true)).items)).not.toContain('reached its normal turn limit');
  });

  it('returns both missing-file and security-rejection read failures to the model', async () => {
    const missingFileApp = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        { toolCalls: [{ toolCallId: 'tool-missing', toolName: 'Read', arguments: { file_path: 'missing-file-for-tool-loop.txt' } }] },
        { content: '缺失文件已作为安全工具结果处理。' },
      ],
    });
    const missingAccepted = await missingFileApp.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'read missing', idempotencyKey: 'idem-tool-missing' },
    });
    const missingBody = missingAccepted.json<{ sessionId: string; runId: string }>();
    const missingStream = await missingFileApp.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${missingBody.sessionId}/stream?lastSeenSequence=0&runId=${missingBody.runId}`,
    });
    expect(missingStream.body).toContain('event: REQUEST_COMPLETED');
    expect(missingStream.body).toContain('缺失文件');

    const rejectedPathApp = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        { toolCalls: [{ toolCallId: 'tool-escape', toolName: 'Read', arguments: { file_path: '../package.json' } }] },
        { content: '路径超出授权范围，已停止读取并报告该限制。' },
      ],
    });
    const rejectedAccepted = await rejectedPathApp.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'read escape', idempotencyKey: 'idem-tool-escape' },
    });
    const rejectedBody = rejectedAccepted.json<{ sessionId: string; runId: string }>();
    const rejectedStream = await rejectedPathApp.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${rejectedBody.sessionId}/stream?lastSeenSequence=0&runId=${rejectedBody.runId}`,
    });
    expect(rejectedStream.body).toContain('CAPABILITY_PATH_REJECTED');
    expect(rejectedStream.body).toContain('event: REQUEST_COMPLETED');
    expect(rejectedStream.body).toContain('路径超出授权范围');
    expect(rejectedStream.body).not.toContain(process.cwd());
    expect(readCapturedAuditRecords(rejectedPathApp)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventName: 'capability.denied',
          requestRunId: rejectedBody.runId,
        }),
      ]),
    );
  });

  it('records Write and Edit extension-policy evidence before returning control to the model', async () => {
    const agentDefinition = loadBuiltInDefaultAgentDefinition();
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      agentDefinition: {
        ...agentDefinition,
        workspaceDir: '.',
        workspaceFiles: {
          ...(agentDefinition.workspaceFiles ?? {}),
          writeDirectories: ['.'],
          readAllowedExtensions: ['.json'],
          writeAllowedExtensions: ['.json'],
        },
      },
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-write-extension-rejected',
              toolName: 'Write',
              arguments: { file_path: 'extension-policy-blocked.exe', content: 'blocked' },
            },
            {
              toolCallId: 'tool-edit-extension-rejected',
              toolName: 'Edit',
              arguments: { file_path: 'extension-policy-blocked.exe', old_string: 'before', new_string: 'after' },
            },
          ],
        },
        { content: '文件后缀不允许，已停止该文件操作并继续处理。' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'write blocked extension', idempotencyKey: 'idem-tool-extension-recoverable' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });
    const messages = await listCurrentRunMessages(app, body);
    const rejectedResults = messages.items.filter((message) => message.role === 'CAPABILITY_RESULT');
    const streamEvents = stream.body.split(/\r?\n\r?\n/).flatMap((block) => {
      const eventType = block
        .split(/\r?\n/)
        .find((line) => line.startsWith('event: '))
        ?.slice('event: '.length);
      const data = block
        .split(/\r?\n/)
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length);
      const envelope = data === undefined ? undefined : (JSON.parse(data) as { payload?: JsonObject });
      return eventType === undefined || envelope?.payload === undefined ? [] : [{ eventType, payload: envelope.payload }];
    });
    const rejectedCompletions = streamEvents.filter((event) => event.eventType === 'CAPABILITY_COMPLETED');

    expect(stream.body).toContain('CAPABILITY_PATH_REJECTED');
    expect(stream.body).toContain('文件后缀不允许');
    expect(stream.body).toContain('event: REQUEST_COMPLETED');
    expect(stream.body).not.toContain('event: REQUEST_FAILED');
    expect(stream.body).not.toContain(process.cwd());
    expect(stream.body).not.toContain('readAllowedExtensions');
    expect(stream.body).not.toContain('writeAllowedExtensions');
    expect(rejectedResults).toHaveLength(2);
    expect(rejectedResults.every((message) => message.content.includes('CAPABILITY_PATH_REJECTED'))).toBe(true);
    expect(rejectedResults.every((message) => message.content.includes('File extension is not allowed by Agent workspace policy.'))).toBe(true);
    expect(rejectedCompletions.map((event) => event.payload)).toEqual([
      expect.objectContaining({
        toolCallId: 'tool-write-extension-rejected',
        status: 'FAILED',
        safeErrorCode: 'CAPABILITY_PATH_REJECTED',
        safeErrorCategory: 'AUTHORIZATION',
        safeSummary: 'Path access was blocked by policy.',
      }),
      expect.objectContaining({
        toolCallId: 'tool-edit-extension-rejected',
        status: 'FAILED',
        safeErrorCode: 'CAPABILITY_PATH_REJECTED',
        safeErrorCategory: 'AUTHORIZATION',
        safeSummary: 'Path access was blocked by policy.',
      }),
    ]);
    expect(rejectedCompletions.every((event) => !Object.hasOwn(event.payload, 'result'))).toBe(true);
  });

  it('continues after degraded bash result and persists the structured payload for later tool-loop steps', async () => {
    const events: Array<{ type: string; inlinePayload: JsonObject }> = [];
    const appendedMessages: SessionMessageDraft[] = [];
    const runState: AgentRunStatePort = {
      async setCapabilityTerminalAnswer(): Promise<void> {},
      async emitEvent(_run, _context, event) {
        events.push({ type: event.type, inlinePayload: event.inlinePayload });
      },
      async appendMessage(_run, _context, draft) {
        appendedMessages.push(draft);
        return brand<string, 'MessageId'>(`message-${appendedMessages.length}`);
      },
      async saveCheckpoint() {},
      async requestPendingInput() {
        throw new Error('requestPendingInput should not be called by bash degraded result tests.');
      },
    };
    const capabilityCatalog: CapabilityCatalog = {
      async listAvailable() {
        return [];
      },
      async resolve() {
        return bashCapabilityDescriptor();
      },
    };
    let invocations = 0;
    const capabilityInvocation: CapabilityInvocationPort = {
      async invoke() {
        invocations += 1;
        return {
          status: 'DEGRADED',
          structuredPayload: {
            stdout: 'partial stdout',
            stderr: 'safe stderr',
            exitCode: 2,
            stdoutTruncated: false,
            stderrTruncated: false,
          },
          generatedMessages: [],
          artifactRefs: [],
          safeError: {
            code: 'SANDBOX_EXECUTION_FAILED',
            message: 'Capability returned a safe degraded result.',
            category: 'UNAVAILABLE',
            retryable: false,
          },
        };
      },
    };
    const assemblyRegistry: AgentAssemblyRegistry = {
      async active() {
        return bashTestAssembly();
      },
      async require() {
        return bashTestAssembly();
      },
    };
    const run: RequestRun = {
      runId: brand<string, 'RequestRunId'>('run-bash-degraded'),
      sessionId: brand<string, 'SessionId'>('session-bash-degraded'),
      requestId: brand<string, 'MessageId'>('request-bash-degraded'),
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      attempt: 1,
      status: 'EXECUTING',
      version: 1,
      terminalCommitState: 'PENDING',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    };
    const context: RequestContext = {
      requestContextId: brand<string, 'RequestContextId'>('context-bash-degraded'),
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId: run.runId,
      agentTurnIndex: 0,
      identityContext: { tenantId: brand<string, 'TenantId'>('tenant-1'), subjectId: brand<string, 'SubjectId'>('subject-1'), displayName: 'Tester' },
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: {},
    };
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await expect(
      executeToolCallsInOrder(
        { capabilityCatalog, capabilityInvocation, assemblyRegistry },
        {
          run,
          context,
          runState,
          signal: new AbortController().signal,
          round: 0,
          requestLocalState,
          persistAssistantToolUse: false,
          toolCalls: [{ toolCallId: 'tool-bash-degraded', toolName: 'Bash', arguments: { command: 'ls' } }],
        },
      ),
    ).resolves.toBeUndefined();

    expect(invocations).toBe(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'DEGRADATION_NOTICE',
          inlinePayload: expect.objectContaining({ code: 'SANDBOX_EXECUTION_FAILED' }),
        }),
        expect.objectContaining({
          type: 'CAPABILITY_RESULT_DELTA',
          inlinePayload: expect.objectContaining({
            capabilityId: 'Bash',
            toolCallId: 'tool-bash-degraded',
            result: expect.objectContaining({ exitCode: 2, stdout: 'partial stdout', stderr: 'safe stderr' }),
          }),
        }),
      ]),
    );

    expect(appendedMessages).toHaveLength(1);
    const parsed = JSON.parse(appendedMessages[0]!.content) as {
      payload: {
        stdout: string;
        stderr: string;
        exitCode: number;
        stdoutTruncated: boolean;
        stderrTruncated: boolean;
      };
    };
    expect(parsed.payload).toEqual({
      stdout: 'partial stdout',
      stderr: 'safe stderr',
      exitCode: 2,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
  });

  it('returns every repeated degraded capability failure to the model-visible transcript', async () => {
    const events: Array<{ type: string; inlinePayload: JsonObject }> = [];
    const appendedMessages: SessionMessageDraft[] = [];
    const runState: AgentRunStatePort = {
      async setCapabilityTerminalAnswer(): Promise<void> {},
      async emitEvent(_run, _context, event) {
        events.push({ type: event.type, inlinePayload: event.inlinePayload });
      },
      async appendMessage(_run, _context, draft) {
        appendedMessages.push(draft);
        return brand<string, 'MessageId'>(`message-repeat-${appendedMessages.length}`);
      },
      async saveCheckpoint() {},
      async requestPendingInput() {
        throw new Error('requestPendingInput should not be called by repeated failure tests.');
      },
    };
    const capabilityCatalog: CapabilityCatalog = {
      async listAvailable() {
        return [];
      },
      async resolve() {
        return bashCapabilityDescriptor();
      },
    };
    let invocations = 0;
    const capabilityInvocation: CapabilityInvocationPort = {
      async invoke() {
        invocations += 1;
        return {
          status: 'DEGRADED',
          structuredPayload: {
            stdout: 'same stdout',
            stderr: 'same stderr',
            exitCode: 2,
            stdoutTruncated: false,
            stderrTruncated: false,
          },
          generatedMessages: [],
          artifactRefs: [],
          safeError: {
            code: 'SANDBOX_EXECUTION_FAILED',
            message: 'Capability returned a safe degraded result.',
            category: 'UNAVAILABLE',
            retryable: false,
          },
        };
      },
    };
    const assemblyRegistry: AgentAssemblyRegistry = {
      async active() {
        return bashTestAssembly();
      },
      async require() {
        return bashTestAssembly();
      },
    };
    const run: RequestRun = {
      runId: brand<string, 'RequestRunId'>('run-bash-repeat'),
      sessionId: brand<string, 'SessionId'>('session-bash-repeat'),
      requestId: brand<string, 'MessageId'>('request-bash-repeat'),
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      attempt: 1,
      status: 'EXECUTING',
      version: 1,
      terminalCommitState: 'PENDING',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    };
    const context: RequestContext = {
      requestContextId: brand<string, 'RequestContextId'>('context-bash-repeat'),
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId: run.runId,
      agentTurnIndex: 0,
      identityContext: { tenantId: brand<string, 'TenantId'>('tenant-1'), subjectId: brand<string, 'SubjectId'>('subject-1'), displayName: 'Tester' },
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: {},
    };
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };
    const deps = { capabilityCatalog, capabilityInvocation, assemblyRegistry };
    const baseInput = {
      run,
      context,
      runState,
      signal: new AbortController().signal,
      requestLocalState,
      persistAssistantToolUse: false,
    };

    await expect(
      executeToolCallsInOrder(deps, {
        ...baseInput,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-bash-repeat-1', toolName: 'Bash', arguments: { command: 'python failing.py' } }],
      }),
    ).resolves.toBeUndefined();

    await expect(
      executeToolCallsInOrder(deps, {
        ...baseInput,
        round: 1,
        toolCalls: [{ toolCallId: 'tool-bash-repeat-2', toolName: 'Bash', arguments: { command: 'python failing.py' } }],
      }),
    ).resolves.toBeUndefined();

    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'DEGRADATION_NOTICE',
          inlinePayload: expect.objectContaining({ code: 'CAPABILITY_REPEATED_FAILURE' }),
        }),
      ]),
    );

    await expect(
      executeToolCallsInOrder(deps, {
        ...baseInput,
        round: 2,
        toolCalls: [{ toolCallId: 'tool-bash-repeat-3', toolName: 'Bash', arguments: { command: 'python failing.py' } }],
      }),
    ).resolves.toBeUndefined();

    expect(invocations).toBe(3);
    expect(appendedMessages).toHaveLength(3);
    expect(JSON.parse(appendedMessages[2]!.content)).toMatchObject({
      toolCallId: 'tool-bash-repeat-3',
      toolName: 'Bash',
      payload: { exitCode: 2, stdout: 'same stdout', stderr: 'same stderr' },
    });
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toHaveLength(3);
    expect(events.filter((event) => event.inlinePayload['code'] === 'CAPABILITY_REPEATED_FAILURE')).toHaveLength(0);
  });

  it('returns every repeated failed capability result to the model-visible transcript', async () => {
    const events: Array<{ type: string; inlinePayload: JsonObject }> = [];
    const appendedMessages: SessionMessageDraft[] = [];
    const runState: AgentRunStatePort = {
      async setCapabilityTerminalAnswer(): Promise<void> {},
      async emitEvent(_run, _context, event) {
        events.push({ type: event.type, inlinePayload: event.inlinePayload });
      },
      async appendMessage(_run, _context, draft) {
        appendedMessages.push(draft);
        return brand<string, 'MessageId'>(`message-repeat-failed-${appendedMessages.length}`);
      },
      async saveCheckpoint() {},
      async requestPendingInput() {
        throw new Error('requestPendingInput should not be called by repeated failed result tests.');
      },
    };
    const capabilityCatalog: CapabilityCatalog = {
      async listAvailable() {
        return [];
      },
      async resolve() {
        return bashCapabilityDescriptor();
      },
    };
    let invocations = 0;
    const capabilityInvocation: CapabilityInvocationPort = {
      async invoke() {
        invocations += 1;
        return {
          status: 'FAILED',
          structuredPayload: {
            stdout: 'same failed stdout',
            stderr: 'same failed stderr',
            exitCode: 2,
            stdoutTruncated: false,
            stderrTruncated: false,
          },
          generatedMessages: [],
          artifactRefs: [],
          safeError: {
            code: 'SANDBOX_EXECUTION_FAILED',
            message: 'Capability execution failed.',
            category: 'UNAVAILABLE',
            retryable: false,
          },
        };
      },
    };
    const assemblyRegistry: AgentAssemblyRegistry = {
      async active() {
        return bashTestAssembly();
      },
      async require() {
        return bashTestAssembly();
      },
    };
    const run: RequestRun = {
      runId: brand<string, 'RequestRunId'>('run-bash-repeat-failed'),
      sessionId: brand<string, 'SessionId'>('session-bash-repeat-failed'),
      requestId: brand<string, 'MessageId'>('request-bash-repeat-failed'),
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      attempt: 1,
      status: 'EXECUTING',
      version: 1,
      terminalCommitState: 'PENDING',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    };
    const context: RequestContext = {
      requestContextId: brand<string, 'RequestContextId'>('context-bash-repeat-failed'),
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId: run.runId,
      agentTurnIndex: 0,
      identityContext: { tenantId: brand<string, 'TenantId'>('tenant-1'), subjectId: brand<string, 'SubjectId'>('subject-1'), displayName: 'Tester' },
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: {},
    };
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };
    const deps = { capabilityCatalog, capabilityInvocation, assemblyRegistry };
    const baseInput = {
      run,
      context,
      runState,
      signal: new AbortController().signal,
      requestLocalState,
      persistAssistantToolUse: false,
    };

    await expect(
      executeToolCallsInOrder(deps, {
        ...baseInput,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-bash-repeat-failed-1', toolName: 'Bash', arguments: { command: 'python failing.py' } }],
      }),
    ).resolves.toBeUndefined();

    await expect(
      executeToolCallsInOrder(deps, {
        ...baseInput,
        round: 1,
        toolCalls: [{ toolCallId: 'tool-bash-repeat-failed-2', toolName: 'Bash', arguments: { command: 'python failing.py' } }],
      }),
    ).resolves.toBeUndefined();

    expect(invocations).toBe(2);
    expect(appendedMessages).toHaveLength(2);
    expect(JSON.parse(appendedMessages[1]!.content)).toMatchObject({
      toolCallId: 'tool-bash-repeat-failed-2',
      toolName: 'Bash',
      payload: {
        status: 'FAILED',
        result: { exitCode: 2, stdout: 'same failed stdout', stderr: 'same failed stderr' },
      },
    });
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload['code'] === 'SANDBOX_EXECUTION_FAILED')).toHaveLength(
      2,
    );
    expect(events.filter((event) => event.inlinePayload['code'] === 'CAPABILITY_REPEATED_FAILURE')).toHaveLength(0);
  });

  it('persists a safe failed capability payload and returns it to the model-visible transcript', async () => {
    const appendedMessages: SessionMessageDraft[] = [];
    const runState: AgentRunStatePort = {
      async setCapabilityTerminalAnswer(): Promise<void> {},
      async emitEvent() {},
      async appendMessage(_run, _context, draft) {
        appendedMessages.push(draft);
        return brand<string, 'MessageId'>(`message-${appendedMessages.length}`);
      },
      async saveCheckpoint(_run, _context, _triggerReason) {},
      async requestPendingInput() {
        throw new Error('requestPendingInput should not be called by bash failed result tests.');
      },
    };
    const capabilityCatalog: CapabilityCatalog = {
      async listAvailable() {
        return [];
      },
      async resolve() {
        return bashCapabilityDescriptor();
      },
    };
    const capabilityInvocation: CapabilityInvocationPort = {
      async invoke() {
        return {
          status: 'FAILED',
          structuredPayload: {
            stdout: 'partial stdout',
            stderr: 'safe stderr',
            exitCode: 2,
            stdoutTruncated: false,
            stderrTruncated: false,
          },
          generatedMessages: [],
          artifactRefs: [],
          safeError: {
            code: 'SANDBOX_EXECUTION_FAILED',
            message: 'Capability execution failed.',
            category: 'INTERNAL',
            retryable: false,
          },
        };
      },
    };
    const assemblyRegistry: AgentAssemblyRegistry = {
      async active() {
        return bashTestAssembly();
      },
      async require() {
        return bashTestAssembly();
      },
    };
    const run: RequestRun = {
      runId: brand<string, 'RequestRunId'>('run-bash-failed'),
      sessionId: brand<string, 'SessionId'>('session-bash-failed'),
      requestId: brand<string, 'MessageId'>('request-bash-failed'),
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      attempt: 1,
      status: 'EXECUTING',
      version: 1,
      terminalCommitState: 'PENDING',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    };
    const context: RequestContext = {
      requestContextId: brand<string, 'RequestContextId'>('context-bash-failed'),
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId: run.runId,
      agentTurnIndex: 0,
      identityContext: { tenantId: brand<string, 'TenantId'>('tenant-1'), subjectId: brand<string, 'SubjectId'>('subject-1'), displayName: 'Tester' },
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: {},
    };
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await expect(
      executeToolCallsInOrder(
        { capabilityCatalog, capabilityInvocation, assemblyRegistry },
        {
          run,
          context,
          runState,
          signal: new AbortController().signal,
          round: 0,
          requestLocalState,
          persistAssistantToolUse: false,
          toolCalls: [{ toolCallId: 'tool-bash-failed', toolName: 'Bash', arguments: { command: 'ls' } }],
        },
      ),
    ).resolves.toBeUndefined();

    expect(appendedMessages).toHaveLength(1);
    const parsed = JSON.parse(appendedMessages[0]!.content) as {
      payload: {
        status: string;
        result: { stdout: string; stderr: string; exitCode: number; stdoutTruncated: boolean; stderrTruncated: boolean };
        safeError: { code: string; category: string; retryable: boolean };
      };
    };
    expect(parsed.payload).toEqual({
      status: 'FAILED',
      result: {
        stdout: 'partial stdout',
        stderr: 'safe stderr',
        exitCode: 2,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
      safeError: {
        code: 'SANDBOX_EXECUTION_FAILED',
        category: 'INTERNAL',
        errorMessage: 'Capability execution failed.',
        retryable: false,
      },
    });
  });

  it('replays a guarded recovered pending tool without duplicating the assistant tool-use message', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'after recovered tool' }],
    });
    const sessionId = brand<string, 'SessionId'>('session-tool-recovery-app');
    const requestId = brand<string, 'MessageId'>('request-tool-recovery-app');
    const runId = brand<string, 'RequestRunId'>('run-tool-recovery-app');
    const requestContextId = brand<string, 'RequestContextId'>('context-tool-recovery-app');
    await app.gateway.sessions.saveSession({
      tenantId: localIdentity.tenantId,
      subjectId: localIdentity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    await app.gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'EXECUTING' }), {});
    await app.gateway.messages.appendSessionMessage(
      messageRecord({ messageId: requestId, sessionId, requestId, runId, role: 'USER', content: 'recover read' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('app-recovery-user') },
    );
    await app.gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('assistant-tool-use-app-recovery'),
        sessionId,
        requestId,
        runId,
        role: 'ASSISTANT',
        content: JSON.stringify({
          toolCalls: [{ toolCallId: 'tool-recovered-read', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }],
        }),
        metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['tool-recovered-read'] },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('app-recovery-tool-use') },
    );
    await saveCheckpoint(app, { sessionId, requestId, runId, requestContextId, triggerReason: 'CAPABILITY_BEFORE_CALL' }, 'app-recovery-checkpoint');

    const report = await app.runtime.recoverLocalRuntime({ limit: 10 });
    const messages = await app.gateway.messages.listCurrentRequestMessages({
      tenantId: localIdentity.tenantId,
      subjectId: localIdentity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    const events = await app.gateway.timeline.listEvents({
      tenantId: localIdentity.tenantId,
      subjectId: localIdentity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
      runId,
    });

    expect(report).toMatchObject({ scanned: 1, claimedExecuting: 1, failed: 0 });
    expect(messages.items.filter((message) => message.metadata['kind'] === 'ASSISTANT_TOOL_USE')).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'CAPABILITY_STARTED',
        inlinePayload: expect.objectContaining({
          messageId: 'assistant-tool-use-app-recovery',
          capabilityId: 'Read',
          toolCallId: 'tool-recovered-read',
        }),
      }),
    );
    expect(
      messages.items
        .filter((message) => message.role === 'CAPABILITY_RESULT')
        .map((message) => message.content)
        .join('\n'),
    ).toContain('tool-recovered-read');
    expect(messages.items.at(-1)?.content).toBe('after recovered tool');
    await app.close();
  });

  it('returns a recovered non-idempotent risk-policy denial to the model before execution resumes', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'The recovered write was denied by policy, so no write was attempted.' }],
    });
    const sessionId = brand<string, 'SessionId'>('session-tool-recovery-write');
    const requestId = brand<string, 'MessageId'>('request-tool-recovery-write');
    const runId = brand<string, 'RequestRunId'>('run-tool-recovery-write');
    const requestContextId = brand<string, 'RequestContextId'>('context-tool-recovery-write');
    await app.gateway.sessions.saveSession({
      tenantId: localIdentity.tenantId,
      subjectId: localIdentity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    await app.gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'EXECUTING' }), {});
    await app.gateway.messages.appendSessionMessage(
      messageRecord({ messageId: requestId, sessionId, requestId, runId, role: 'USER', content: 'recover write' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('app-recovery-write-user') },
    );
    await app.gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('assistant-tool-use-app-recovery-write'),
        sessionId,
        requestId,
        runId,
        role: 'ASSISTANT',
        content: JSON.stringify({
          toolCalls: [
            { toolCallId: 'tool-recovered-write', toolName: 'Write', arguments: { file_path: 'ops/recovered.txt', content: 'must-not-replay' } },
          ],
        }),
        metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['tool-recovered-write'] },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('app-recovery-write-tool-use') },
    );
    await saveCheckpoint(
      app,
      { sessionId, requestId, runId, requestContextId, triggerReason: 'CAPABILITY_BEFORE_CALL' },
      'app-recovery-write-checkpoint',
    );

    const report = await app.runtime.recoverLocalRuntime({ limit: 10 });
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: localIdentity.tenantId,
      subjectId: localIdentity.subjectId,
      agentId,
      runId,
    });
    const events = await app.gateway.timeline.listEvents({
      tenantId: localIdentity.tenantId,
      subjectId: localIdentity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
      runId,
    });
    const messages = await app.gateway.messages.listCurrentRequestMessages({
      tenantId: localIdentity.tenantId,
      subjectId: localIdentity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });

    expect(report).toMatchObject({ scanned: 1, claimedExecuting: 1, failed: 0 });
    expect(run?.status).toBe('COMPLETED');
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['POLICY_APPLIED', 'CAPABILITY_COMPLETED', 'REQUEST_COMPLETED']));
    expect(events.map((event) => event.type)).not.toContain('CAPABILITY_STARTED');
    expect(
      events.find((event) => event.type === 'POLICY_APPLIED' && event.inlinePayload['operationKind'] === 'CAPABILITY_INVOCATION')?.inlinePayload,
    ).toMatchObject({
      operationKind: 'CAPABILITY_INVOCATION',
      operationId: 'Write:tool-recovered-write',
      outcome: 'DENY',
      reasonCode: 'RECOVERY_UNSAFE_CAPABILITY_REPLAY',
    });
    expect(messages.items.filter((message) => message.role === 'CAPABILITY_RESULT')).toHaveLength(1);
    expect(JSON.stringify(messages.items)).toContain('RECOVERY_UNSAFE_CAPABILITY_REPLAY');
    await app.close();
  });

  describe('capability result metadata safety', () => {
    const safeBase = {
      status: 'SUCCEEDED' as const,
      structuredPayload: { ok: true } as JsonObject,
      generatedMessages: [],
      artifactRefs: [],
    };

    it('accepts metadata that legitimately describes a path or endpoint URL', () => {
      for (const metadata of [
        { filePath: '/usr/local/bin/app', truncated: false },
        { url: 'https://api.example.com/v1/agents', method: 'POST' },
        { path: 'C:\\Users\\test\\config.yaml' },
        { endpoint: 'http://127.0.0.1:8080/mcp', serverName: 'mcp-test' },
        { registryRef: 'https://registry.example.com/agents/abc' },
      ]) {
        expect(() => assertCapabilityResultSafe({ ...safeBase, metadata })).not.toThrow();
      }
    });

    it('rejects metadata whose serialized form contains secret-keyword leakage', () => {
      for (const metadata of [
        { secret: 'raw-secret-value' },
        { credential: 'raw-credential-value' },
        { token: 'raw-token-value' },
        { apiToken: 'abc.def.ghi' },
      ]) {
        expect(() => assertCapabilityResultSafe({ ...safeBase, metadata })).toThrowError(
          expect.objectContaining({ code: 'CAPABILITY_METADATA_INVALID' }),
        );
      }
    });

    it('rejects metadata whose serialized form exceeds the size limit', () => {
      const metadata = { blob: 'x'.repeat(5000) };
      expect(() => assertCapabilityResultSafe({ ...safeBase, metadata })).toThrowError(
        expect.objectContaining({ code: 'CAPABILITY_METADATA_INVALID' }),
      );
    });
  });

  it('recovers when the model returns a tool call with an empty tool name and continues the loop', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        { toolCalls: [{ toolCallId: 'call-empty-name', toolName: '', arguments: { query: 'diag' } }] },
        { content: 'Corrected, no tool needed.' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'trigger empty tool name', idempotencyKey: 'idem-empty-tool-name-recover' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body).toContain('TOOL_NAME_EMPTY');
    expect(stream.body).toContain('event: REQUEST_COMPLETED');
    expect(stream.body).not.toContain('event: REQUEST_FAILED');
    // The empty-name batch is never executed: no capability is started.
    expect(stream.body).not.toContain('event: CAPABILITY_STARTED');
  });

  it('stops the run safely after the empty-tool-name recovery limit is exhausted', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: Array.from({ length: 4 }, (_value, round) => ({
        toolCalls: [{ toolCallId: `call-empty-${round}`, toolName: '', arguments: {} }],
      })),
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'persistently empty tool name', idempotencyKey: 'idem-empty-tool-name-exhaust' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body).toContain('TOOL_NAME_EMPTY');
    expect(stream.body).toContain('event: REQUEST_FAILED');
    expect(stream.body).not.toContain('event: REQUEST_COMPLETED');
    expect(stream.body).not.toContain('event: CAPABILITY_STARTED');
  });
});

const localIdentity = {
  tenantId: brand<string, 'TenantId'>('local-tenant'),
  subjectId: brand<string, 'SubjectId'>('local-subject'),
  displayName: 'Local developer',
};
const defaultHttpIdentity = {
  tenantId: brand<string, 'TenantId'>('tenant-1'),
  subjectId: brand<string, 'SubjectId'>('subject-1'),
  displayName: 'Test user',
};
const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');

function bashCapabilityDescriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('Bash'),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: 'Bash',
    description: 'bash',
    inputSchema: {},
    outputSchema: {},
    availabilityStatus: 'AVAILABLE',
    modelInvocable: true,
    replayPolicy: 'IDEMPOTENT',
  };
}

function bashTestAssembly(): AgentAssembly {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default' as AgentType),
    agentVersion,
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
    description: 'Test agent',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['test-model'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'NONE',
    runtimeSettings: {},
  };
}

function runRecord(overrides: Partial<RequestRunRecord> & Pick<RequestRunRecord, 'runId' | 'sessionId' | 'requestId'>): RequestRunRecord {
  return {
    tenantId: localIdentity.tenantId,
    subjectId: localIdentity.subjectId,
    agentId,
    agentVersion,
    agentAssemblyRef: 'default-agent:v1',
    attempt: 1,
    status: 'QUEUED',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    ...overrides,
  };
}

function messageRecord(
  overrides: Partial<SessionMessageRecord> & Pick<SessionMessageRecord, 'messageId' | 'sessionId' | 'requestId' | 'runId' | 'role' | 'content'>,
): SessionMessageRecord {
  return {
    tenantId: localIdentity.tenantId,
    subjectId: localIdentity.subjectId,
    agentId,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
    ...overrides,
  };
}

async function saveCheckpoint(
  app: ReturnType<typeof createNextAgentTestApp>,
  overrides: Parameters<typeof checkpointRecord>[0],
  idempotencyKey: string,
): Promise<void> {
  const active = await app.gateway.activeContext.loadActiveContext({
    tenantId: localIdentity.tenantId,
    subjectId: localIdentity.subjectId,
    agentId,
    sessionId: overrides.sessionId,
  });
  await app.gateway.checkpoints.saveCheckpoint(
    checkpointRecord({
      activeContextVersion: active.state.activeContextVersion,
      ...overrides,
    }),
    { idempotencyKey: brand<string, 'IdempotencyKey'>(idempotencyKey) },
  );
}

async function waitForActivePending(app: ReturnType<typeof createNextAgentTestApp>, sessionId: string): Promise<PendingInputRecord> {
  await waitFor(async () => (await loadActivePending(app, sessionId)) !== undefined);
  return (await loadActivePending(app, sessionId))!;
}

async function loadActivePending(app: ReturnType<typeof createNextAgentTestApp>, sessionId: string): Promise<PendingInputRecord | undefined> {
  return app.gateway.pendingInputs.loadActivePendingInput({
    tenantId: defaultHttpIdentity.tenantId,
    subjectId: defaultHttpIdentity.subjectId,
    agentId,
    sessionId: brand<string, 'SessionId'>(sessionId),
  });
}

function listCurrentRunMessages(
  app: ReturnType<typeof createNextAgentTestApp>,
  body: { readonly sessionId: string; readonly requestId: string; readonly runId: string },
  includeHidden = false,
) {
  return app.gateway.messages.listCurrentRequestMessages({
    tenantId: defaultHttpIdentity.tenantId,
    subjectId: defaultHttpIdentity.subjectId,
    agentId,
    sessionId: brand<string, 'SessionId'>(body.sessionId),
    requestId: brand<string, 'MessageId'>(body.requestId),
    runId: brand<string, 'RequestRunId'>(body.runId),
    includeHidden,
    offset: 0,
    limit: 100,
  });
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
}

function checkpointRecord(
  overrides: {
    readonly sessionId: RequestRun['sessionId'];
    readonly requestId: RequestRun['requestId'];
    readonly runId: RequestRun['runId'];
    readonly requestContextId: RequestContext['requestContextId'];
    readonly triggerReason: CheckpointRecord['triggerReason'];
  } & Partial<CheckpointRecord>,
): CheckpointRecord {
  const { sessionId, requestId, runId, requestContextId, triggerReason, agentTurnIndex = 0, ...rest } = overrides;
  return {
    tenantId: localIdentity.tenantId,
    subjectId: localIdentity.subjectId,
    agentId,
    checkpointId: brand<string, 'CheckpointId'>(`checkpoint-${runId}`),
    sessionId,
    requestId,
    runId,
    requestContextId,
    runVersion: 1,
    agentTurnIndex,
    triggerReason,
    lastSequence: brand<number, 'TimelineSequence'>(0),
    activeContextVersion: 0,
    flowVariables: {},
    savedAt: brand<number, 'EpochMillis'>(10),
    ...rest,
  };
}
