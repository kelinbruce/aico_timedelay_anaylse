import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type { HookInput, HookResult, LifecycleHookDefinition } from '@nextagent/agent-contracts/runtime';
import type { RuntimeLifecycleHookExecutor } from '@nextagent/agent-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentHookActivation } from '@nextagent/agent-contracts/agent-assembly';
import { agentId, apps, closeLifecycleHookApps, identity, waitForTimelineEvent } from './lifecycle-hook-test-helpers.js';

afterEach(async () => {
  await closeLifecycleHookApps();
});

describe('lifecycle hook execution pending', () => {
  it('creates pending input and resumes the same run from BEFORE_CAPABILITY_INVOKE after answer', async () => {
    const capabilityStages: string[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage !== 'BEFORE_CAPABILITY_INVOKE') {
          return { outcome: 'PASS' };
        }
        capabilityStages.push(
          'pendingAnswerSummary' in input.boundary && typeof input.boundary.pendingAnswerSummary === 'string'
            ? input.boundary.pendingAnswerSummary
            : 'PENDING',
        );
        if ('pendingAnswerSummary' in input.boundary && input.boundary.pendingAnswerSummary === 'approve') {
          return { outcome: 'PASS' };
        }
        return {
          outcome: 'PEND',
          pendingInputIntent: {
            kind: 'CONFIRMATION',
            questions: [
              {
                prompt: 'continue?',
                options: [
                  { label: 'Continue', value: 'approve' },
                  { label: 'Cancel', value: 'reject' },
                ],
              },
            ],
          },
        };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'capability-confirm',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_CAPABILITY_INVOKE'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'capability-confirm',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        { toolCalls: [{ toolCallId: 'tool-read-1', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }] },
        { content: 'resumed after pending' },
      ],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-pending-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run pending capability path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-pending-submit'),
    });

    const required = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'USER_INPUT_REQUIRED');
    const pendingInputId = required.inlinePayload['pendingInputId'];
    expect(typeof pendingInputId).toBe('string');
    const userInputRequired = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'USER_INPUT_REQUIRED');
    expect(userInputRequired.inlinePayload).toMatchObject({
      pendingInputId,
    });

    const answered = await app.runtime.answerPendingInput({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-pending-answer'),
      answer: {
        sessionId: session.sessionId,
        pendingInputId: pendingInputId as never,
        answers: [['approve']],
      },
    });
    expect(answered.pendingInputId).toBe(pendingInputId);

    const received = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'USER_INPUT_RECEIVED');
    expect(received.inlinePayload['pendingInputId']).toBe(pendingInputId);
    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(capabilityStages).toEqual(['PENDING', 'approve']);
  });

  it('creates pending input and resumes terminal commit from BEFORE_AGENT_TERMINAL after answer', async () => {
    const terminalStages: string[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage !== 'BEFORE_AGENT_TERMINAL') {
          return { outcome: 'PASS' };
        }
        terminalStages.push(
          'pendingAnswerSummary' in input.boundary && typeof input.boundary.pendingAnswerSummary === 'string'
            ? input.boundary.pendingAnswerSummary
            : 'PENDING',
        );
        if ('pendingAnswerSummary' in input.boundary && input.boundary.pendingAnswerSummary === 'approve') {
          return { outcome: 'PASS' };
        }
        return {
          outcome: 'PEND',
          pendingInputIntent: {
            kind: 'CONFIRMATION',
            questions: [
              {
                prompt: 'publish terminal output?',
                options: [
                  { label: 'Continue', value: 'approve' },
                  { label: 'Cancel', value: 'reject' },
                ],
              },
            ],
          },
        };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'terminal-confirm',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'terminal-confirm',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'terminal pending resume ok' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-terminal-pending-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run terminal pending path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-terminal-pending-submit'),
    });

    const required = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'USER_INPUT_REQUIRED');
    const pendingInputId = required.inlinePayload['pendingInputId'];
    expect(typeof pendingInputId).toBe('string');
    expect(required.inlinePayload).toMatchObject({
      pendingInputId,
    });

    await app.runtime.answerPendingInput({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-terminal-pending-answer'),
      answer: {
        sessionId: session.sessionId,
        pendingInputId: pendingInputId as never,
        answers: [['approve']],
      },
    });

    const received = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'USER_INPUT_RECEIVED');
    expect(received.inlinePayload['pendingInputId']).toBe(pendingInputId);
    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(completed.inlinePayload['content']).toBe('terminal pending resume ok');
    expect(terminalStages).toEqual(['PENDING', 'approve']);
  });
});
