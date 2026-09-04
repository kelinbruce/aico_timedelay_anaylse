import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type JsonObject } from '@nextagent/agent-common';
import { defineLifecycleHook } from '@nextagent/agent-runtime';
import type { HookInput, HookResult, LifecycleHookDefinition } from '@nextagent/agent-contracts/runtime';
import type { RuntimeLifecycleHookExecutor } from '@nextagent/agent-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentHookActivation } from '@nextagent/agent-contracts/agent-assembly';
import {
  createNorthboundOutputNormalizationPlugin,
  northboundOutputNormalizationHookId,
} from '@nextagent/agent-plugin-sdk/northbound-output-normalization-hook';
import {
  agentId,
  apps,
  closeLifecycleHookApps,
  identity,
  listTimelineEvents,
  waitForAuditEvent,
  waitForTimelineEvent,
} from './lifecycle-hook-test-helpers.js';

afterEach(async () => {
  await closeLifecycleHookApps();
});

describe('lifecycle hook execution terminal', () => {
  it('persists terminal-hook tool calls with only the current model round content', async () => {
    let terminalToolInjected = false;
    const terminalContents: string[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage !== 'BEFORE_AGENT_TERMINAL') {
          return { outcome: 'PASS' };
        }
        if ('finalContent' in input.boundary) {
          terminalContents.push(input.boundary.finalContent);
        }
        if (terminalToolInjected) {
          return { outcome: 'PASS' };
        }
        terminalToolInjected = true;
        return {
          outcome: 'PASS',
          mutation: {
            toolCalls: [{ toolCallId: 'tool-terminal-round', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }],
          },
        };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'terminal-tool-round',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'],
        effects: ['TRANSFORM'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const hooks: readonly AgentHookActivation[] = [{ hookId: 'terminal-tool-round', enabled: true }];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          content: 'round-one',
          toolCalls: [{ toolCallId: 'tool-model-round', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }],
        },
        { content: 'round-two' },
        { content: 'done' },
      ],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-tool-round-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run model and terminal tool rounds',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-tool-round-submit'),
    });
    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');

    const messages = await app.gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: session.sessionId,
      requestId: accepted.requestId,
      runId: accepted.runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    const persistedAssistantTexts = messages.items
      .filter((message) => message.metadata['kind'] === 'ASSISTANT_TOOL_USE')
      .map((message) => (JSON.parse(message.content) as { content?: string }).content);
    expect(persistedAssistantTexts).toEqual(['round-one', 'round-two']);
    expect(terminalContents).toEqual(['round-two', 'done']);
  });

  it('materializes canonical LifecycleHook objects with per-agent configure config', async () => {
    const terminalHook = defineLifecycleHook({
      hookId: 'custom.terminal-prefix',
      kind: 'CUSTOM',
      supportedStages: ['BEFORE_AGENT_TERMINAL'] as const,
      effects: ['TRANSFORM'] as const,
      failureMode: 'FAIL',
      configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prefix: { type: 'string' },
        },
      },
      configure(config) {
        const prefix = typeof config['prefix'] === 'string' ? config['prefix'] : '';
        return {
          execute(input) {
            return {
              outcome: 'PASS',
              mutation: { finalContent: `${prefix}${input.boundary.finalContent}` },
            };
          },
        };
      },
      execute(input) {
        return { outcome: 'PASS', mutation: { finalContent: input.boundary.finalContent } };
      },
    });
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'configured terminal' }],
      identity,
      lifecycleHooks: [terminalHook],
      hooks: [{ hookId: 'custom.terminal-prefix', enabled: true, config: { prefix: 'checked: ' } }],
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-hook-object-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run configured hook object',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-hook-object-submit'),
    });

    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(completed.inlinePayload['content']).toBe('checked: configured terminal');
  });

  it('persists Hook result summaries in the terminal snapshot without content processing', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_AGENT_TERMINAL') {
          return {
            outcome: 'PASS',
            resultSummary: {
              a: 1,
              b: 2,
              nested: { '原样-key': ['value', null, true] },
            },
          };
        }
        return { outcome: 'PASS' };
      },
    };
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'hook summary terminal' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: [
        {
          hookId: 'terminal-result-summary',
          kind: 'CUSTOM',
          supportedStages: ['BEFORE_AGENT_TERMINAL'],
          effects: ['OBSERVE'],
          executionStrategy: 'OBSERVE_PARALLEL',
          failureMode: 'CONTINUE',
        },
      ],
      hooks: [{ hookId: 'terminal-result-summary', enabled: true }],
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-result-summary-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'return the Hook result in terminal',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-result-summary-submit'),
    });

    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(completed.inlinePayload['content']).toBe('hook summary terminal');
    const hookResults = completed.inlinePayload['hookResults'];
    expect(Array.isArray(hookResults)).toBe(true);
    if (!Array.isArray(hookResults)) {
      throw new Error('Expected terminal hookResults.');
    }
    const matchingResults = hookResults.filter(
      (entry): entry is JsonObject =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry) && entry.hookId === 'terminal-result-summary',
    );
    expect(matchingResults).toEqual([
      {
        hookInvocationId: expect.any(String),
        hookId: 'terminal-result-summary',
        stage: 'BEFORE_AGENT_TERMINAL',
        status: 'SUCCESS',
        failureMode: 'CONTINUE',
        outcome: 'PASS',
        resultSummary: {
          a: 1,
          b: 2,
          nested: { '原样-key': ['value', null, true] },
        },
      },
    ]);
  });

  it('projects only matching northbound Bash output into the terminal Hook snapshot', async () => {
    const hook = createNorthboundOutputNormalizationPlugin().hooks?.[0];
    if (hook === undefined) {
      throw new Error('Expected northbound output normalization Hook.');
    }
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-bash-northbound-match',
              toolName: 'Bash',
              arguments: { command: 'printf northbound-entry.py' },
            },
            {
              toolCallId: 'tool-bash-northbound-skip',
              toolName: 'Bash',
              arguments: { command: 'printf worker.py' },
            },
          ],
        },
        { content: 'northbound hook terminal complete' },
      ],
      identity,
      lifecycleHooks: [hook],
      hooks: [{ hookId: northboundOutputNormalizationHookId, enabled: true, config: { matchText: 'northbound-entry.py' } }],
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-northbound-hook-terminal-session'),
    });
    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run matching and non-matching Bash calls',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-northbound-hook-terminal-submit'),
    });

    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    const hookResults = completed.inlinePayload['hookResults'];
    expect(Array.isArray(hookResults)).toBe(true);
    if (!Array.isArray(hookResults)) {
      throw new Error('Expected terminal hookResults.');
    }
    const northboundResults = hookResults.filter(
      (entry): entry is JsonObject =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry) && entry.hookId === northboundOutputNormalizationHookId,
    );
    expect(northboundResults).toHaveLength(2);
    expect(northboundResults.filter((entry) => entry.resultSummary !== undefined)).toEqual([
      expect.objectContaining({
        stage: 'AFTER_CAPABILITY_RESULT',
        outcome: 'PASS',
        resultSummary: expect.objectContaining({
          stdout: 'northbound-entry.py',
          exitCode: 0,
        }),
      }),
    ]);
    expect(northboundResults.filter((entry) => entry.outcome === 'SKIP')).toEqual([
      expect.not.objectContaining({ resultSummary: expect.anything() }),
    ]);
    const timeline = await listTimelineEvents(app, session.sessionId, accepted.runId);
    const hookInvocations = timeline.filter(
      (event) => event.type === 'HOOK_INVOKED' && event.inlinePayload['hookId'] === northboundOutputNormalizationHookId,
    );
    expect(hookInvocations).toHaveLength(2);
    for (const invocation of hookInvocations) {
      expect(invocation.inlinePayload).not.toHaveProperty('arguments');
      expect(invocation.inlinePayload).not.toHaveProperty('boundary');
    }
  });

  it('rejects lifecycle hook config that fails the declared schema', () => {
    const terminalHook = defineLifecycleHook({
      hookId: 'custom.terminal-prefix',
      kind: 'CUSTOM',
      supportedStages: ['BEFORE_AGENT_TERMINAL'] as const,
      effects: ['TRANSFORM'] as const,
      failureMode: 'FAIL',
      configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prefix: { type: 'string' },
        },
      },
      execute(input) {
        return { outcome: 'PASS', mutation: { finalContent: input.boundary.finalContent } };
      },
    });

    expect(() =>
      createNextAgentTestApp({
        workspaceDir: process.cwd(),
        modelSteps: [{ content: 'invalid config' }],
        identity,
        lifecycleHooks: [terminalHook],
        hooks: [{ hookId: 'custom.terminal-prefix', enabled: true, config: { prefix: 1 } }],
      }),
    ).toThrow('Lifecycle hook config is invalid: custom.terminal-prefix.');
  });

  it('records hook invocation evidence when a terminal hook rejects the request', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_AGENT_TERMINAL') {
          return { outcome: 'DENY', safeReason: 'blocked-by-terminal-hook' };
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'terminal-guard',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'terminal-guard',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'terminal hook reject' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-terminal-reject-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run terminal reject path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-terminal-reject-submit'),
    });

    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_FAILED');
    const events = await listTimelineEvents(app, session.sessionId, accepted.runId);
    const denyEvent = events.find(
      (event) => event.type === 'HOOK_INVOKED' && (event.inlinePayload as Record<string, unknown>)['hookId'] === 'terminal-guard',
    );
    expect(denyEvent).toBeDefined();
    expect(denyEvent!.inlinePayload).toMatchObject({
      stage: 'BEFORE_AGENT_TERMINAL',
      hookId: 'terminal-guard',
      outcome: 'DENY',
      safeReason: 'blocked-by-terminal-hook',
    });
    await expect(
      waitForAuditEvent(app, 'hook.invoked', 5_000, (event) => event.requestRunId === accepted.runId && event.attributes['outcome'] === 'denied'),
    ).resolves.toMatchObject({
      requestRunId: accepted.runId,
      attributes: expect.objectContaining({
        operation: 'HOOK_INVOKED',
        outcome: 'denied',
        requestId: accepted.requestId,
      }),
    });
  });

  it('applies terminal mutation before the next blocking hook and terminal commit', async () => {
    const seenSummaries: string[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.hookId === 'terminal-mutate') {
          return {
            outcome: 'PASS',
            mutation: { finalContent: 'mutated-terminal-output' },
          };
        }
        if (input.hookId === 'terminal-observe') {
          if ('finalContent' in input.boundary && typeof input.boundary.finalContent === 'string') {
            seenSummaries.push(input.boundary.finalContent);
          }
          return { outcome: 'PASS' };
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'terminal-mutate',
        kind: 'SYSTEM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
        order: 0,
      },
      {
        hookId: 'terminal-observe',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
        order: 1,
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'terminal-observe',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'original terminal output' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-terminal-mutation-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run terminal mutation path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-terminal-mutation-submit'),
    });

    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(seenSummaries).toEqual(['mutated-terminal-output']);
    expect(completed.inlinePayload['content']).toBe('mutated-terminal-output');
  });

  it('ignores lifecycle control outputs from NON_BLOCKING hooks', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_REQUEST_ACCEPT') {
          return {
            outcome: 'DENY',
            safeReason: 'should-be-ignored',
          };
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'non-blocking-audit',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['OBSERVE'],
        executionStrategy: 'OBSERVE_PARALLEL',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'non-blocking-audit',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'non blocking complete' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-non-blocking-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run non-blocking path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-non-blocking-submit'),
    });

    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(completed.inlinePayload['content']).toBe('non blocking complete');
    expect(await listTimelineEvents(app, session.sessionId, accepted.runId)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'DEGRADATION_NOTICE' })]),
    );
    await expect(
      waitForAuditEvent(
        app,
        'hook.invoked',
        5_000,
        (event) => event.requestRunId === accepted.runId && event.attributes['safeReasonCode'] === 'OBSERVE_CONTROL_IGNORED',
      ),
    ).resolves.toMatchObject({
      requestRunId: accepted.runId,
      attributes: expect.objectContaining({
        operation: 'HOOK_INVOKED',
        outcome: 'denied',
        safeReasonCode: 'OBSERVE_CONTROL_IGNORED',
      }),
    });
  });

  it('keeps request truth unchanged when hook observability sinks degrade', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_AGENT_TERMINAL') {
          return { outcome: 'PASS' };
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'observability-degrade-hook',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'observability-degrade-hook',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'observability degraded but request completed' }],
      identity,
      observationLogger: {
        debug() {
          throw new Error('log sink down');
        },
        info() {
          throw new Error('log sink down');
        },
        warn() {
          throw new Error('log sink down');
        },
        error() {
          throw new Error('log sink down');
        },
      },
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-observability-degrade-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run observability degrade path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-observability-degrade-submit'),
    });

    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(completed.inlinePayload['content']).toBe('observability degraded but request completed');
  });
});
