import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import type { AgentHookActivation } from '@nextagent/agent-contracts/agent-assembly';
import type { HookInput, HookResult, LifecycleHookDefinition } from '@nextagent/agent-contracts/runtime';
import type { RuntimeLifecycleHookExecutor } from '@nextagent/agent-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { agentId, apps, closeLifecycleHookApps, identity, listTimelineEvents, waitForTimelineEvent } from './lifecycle-hook-test-helpers.js';

afterEach(async () => {
  await closeLifecycleHookApps();
});

describe('lifecycle hook coverage gaps', () => {
  it('system.output-redaction-guard redacts sensitive patterns in final output via TRANSFORM', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'Credentials: password=admin123, token: Bearer abc.def.ghi, phone: 13800138000, ip: 192.168.1.1, ipv6: 2001:db8::1' }],
      identity,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-redact-session'),
    });
    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'show credentials',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-redact-submit'),
    });
    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    const content = String(completed.inlinePayload['content'] ?? '');
    expect(content).toContain('[REDACTED_SECRET]');
    expect(content).toContain('[REDACTED_PHONE]');
    expect(content).toContain('192.168.1.1');
    expect(content).toContain('2001:db8::1');
    expect(content).not.toContain('admin123');
    expect(content).not.toContain('abc.def.ghi');
    expect(content).not.toContain('13800138000');
  });

  it('system.output-redaction-guard preserves IPv4 and IPv6-only final output', async () => {
    const finalContent = 'Network endpoints: 10.20.30.40, 192.168.1.1, 172.16.2.3, 2001:db8::1';
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: finalContent }],
      identity,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-ip-preserve-session'),
    });
    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'show network endpoints',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-ip-preserve-submit'),
    });
    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(completed.inlinePayload['content']).toBe(finalContent);
  });

  it('system.output-redaction-guard BLOCKs final output containing a private key', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        { content: 'Here is the key:\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDX\n-----END PRIVATE KEY-----' },
      ],
      identity,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-block-key-session'),
    });
    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'show key',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-block-key-submit'),
    });
    const failed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_FAILED');
    expect(failed).toBeDefined();
    const events = await listTimelineEvents(app, session.sessionId, accepted.runId);
    const finalContentEvents = events.filter((event) => {
      if (event.type !== 'LLM_CONTENT_DELTA') {
        return false;
      }
      const payload = event.inlinePayload as Record<string, unknown>;
      return payload['final'] === true;
    });
    expect(finalContentEvents.length).toBe(0);
  });

  it('ignores mutation when a TRANSFORM+CONTROL hook returns DENY', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_AGENT_TERMINAL' && input.hookId === 'custom.deny-with-mutation') {
          const result: Record<string, unknown> = {
            outcome: 'DENY',
            safeReason: 'denied-with-mutation',
            mutation: { finalContent: 'should-not-apply' },
          };
          return result as unknown as HookResult;
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'custom.deny-with-mutation',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const hooks: readonly AgentHookActivation[] = [{ hookId: 'custom.deny-with-mutation', enabled: true }];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'should-not-appear-in-output' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-deny-mut-session'),
    });
    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run deny with mutation',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-deny-mut-submit'),
    });
    const failed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_FAILED');
    expect(failed).toBeDefined();
    const events = await listTimelineEvents(app, session.sessionId, accepted.runId);
    const finalContentEvents = events.filter((event) => {
      if (event.type !== 'LLM_CONTENT_DELTA') {
        return false;
      }
      const payload = event.inlinePayload as Record<string, unknown>;
      return payload['final'] === true;
    });
    expect(finalContentEvents.length).toBe(0);
    const allContent = events.map((event) => JSON.stringify(event.inlinePayload)).join('');
    expect(allContent).not.toContain('should-not-apply');
    const hookEvents = events.filter((event) => event.type === 'HOOK_INVOKED');
    const denyEvent = hookEvents.find((event) => {
      const payload = event.inlinePayload as Record<string, unknown>;
      return payload['hookId'] === 'custom.deny-with-mutation' && payload['outcome'] === 'DENY';
    });
    expect(denyEvent).toBeDefined();
  });

  it('continues flow when hook returns SKIP without mutation', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_AGENT_TERMINAL' && input.hookId === 'custom.skip-hook') {
          return { outcome: 'SKIP', safeReason: 'not-applicable' };
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'custom.skip-hook',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'],
        effects: ['OBSERVE'],
        executionStrategy: 'OBSERVE_PARALLEL',
        failureMode: 'FAIL',
      },
    ];
    const hooks: readonly AgentHookActivation[] = [{ hookId: 'custom.skip-hook', enabled: true }];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'skip flow completed' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-skip-session'),
    });
    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run skip',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-skip-submit'),
    });
    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(String(completed.inlinePayload['content'] ?? '')).toContain('skip flow completed');
    const events = await listTimelineEvents(app, session.sessionId, accepted.runId);
    const hookEvents = events.filter((event) => event.type === 'HOOK_INVOKED');
    const skipEvent = hookEvents.find((event) => {
      const payload = event.inlinePayload as Record<string, unknown>;
      return payload['hookId'] === 'custom.skip-hook' && payload['outcome'] === 'SKIP';
    });
    expect(skipEvent).toBeDefined();
    const degradationEvents = events.filter((event) => event.type === 'DEGRADATION_NOTICE');
    expect(degradationEvents.length).toBe(0);
  });

  it('rejects SKIP with mutation as an invalid hook result under FAIL failure mode', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_AGENT_TERMINAL' && input.hookId === 'custom.skip-with-mutation') {
          return {
            outcome: 'SKIP',
            mutation: { finalContent: 'should-not-apply' },
          } as never;
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'custom.skip-with-mutation',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'],
        effects: ['TRANSFORM'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const hooks: readonly AgentHookActivation[] = [{ hookId: 'custom.skip-with-mutation', enabled: true }];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'skip with mutation should fail' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-skip-mut-session'),
    });
    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run skip with mutation',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-skip-mut-submit'),
    });
    const failed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_FAILED');
    expect(failed).toBeDefined();
    const events = await listTimelineEvents(app, session.sessionId, accepted.runId);
    const finalContentEvents = events.filter((event) => {
      if (event.type !== 'LLM_CONTENT_DELTA') {
        return false;
      }
      const payload = event.inlinePayload as Record<string, unknown>;
      return payload['final'] === true;
    });
    expect(finalContentEvents.length).toBe(0);
    const allContent = events.map((event) => JSON.stringify(event.inlinePayload)).join('');
    expect(allContent).not.toContain('should-not-apply');
  });

  it('does not allow hook to mutate received boundary in place to affect the model request', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_MODEL_INVOKE') {
          const boundary = input.boundary as unknown as Record<string, unknown>;
          const messages = boundary['messages'];
          if (Array.isArray(messages)) {
            (messages as unknown[]).push({ role: 'system', content: 'injected-by-hook-mutation' });
          }
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'custom.boundary-mutate',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_MODEL_INVOKE'],
        effects: ['OBSERVE'],
        executionStrategy: 'OBSERVE_PARALLEL',
        failureMode: 'CONTINUE',
      },
    ];
    const hooks: readonly AgentHookActivation[] = [{ hookId: 'custom.boundary-mutate', enabled: true }];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'boundary immutability check' }],
      modelRequestSink: modelRequests,
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-boundary-imm-session'),
    });
    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run boundary immutability',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-boundary-imm-submit'),
    });
    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    const requestMessages = JSON.stringify(modelRequests[0]?.messages ?? []);
    expect(requestMessages).not.toContain('injected-by-hook-mutation');
  });

  it('applies BEFORE_MODEL_INVOKE messages TRANSFORM and provider receives replaced messages', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_MODEL_INVOKE' && input.hookId === 'custom.model-messages-transform') {
          const boundary = input.boundary as unknown as Record<string, unknown>;
          const originalMessages = Array.isArray(boundary['messages']) ? [...(boundary['messages'] as unknown[])] : [];
          return {
            outcome: 'PASS',
            mutation: {
              messages: [{ role: 'SYSTEM', content: [{ type: 'text', text: 'injected system instruction by hook' }] }, ...originalMessages] as never,
            },
          };
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'custom.model-messages-transform',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_MODEL_INVOKE'],
        effects: ['TRANSFORM'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const hooks: readonly AgentHookActivation[] = [{ hookId: 'custom.model-messages-transform', enabled: true }];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'model invoke transform applied' }],
      modelRequestSink: modelRequests,
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-model-transform-session'),
    });
    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run model invoke transform',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-model-transform-submit'),
    });
    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    const requestMessages = JSON.stringify(modelRequests[0]?.messages ?? []);
    expect(requestMessages).toContain('injected system instruction by hook');
  });
});
