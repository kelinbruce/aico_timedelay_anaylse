import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type EpochMillis, type MessageId } from '@nextagent/agent-common';
import { DefaultContextEngine } from '@nextagent/agent-context-engine';
import type { AgentAssembly, AgentAssemblyRegistry, AgentHookActivation } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type { ContextBudgetPolicyPort, ContextCompactionPlan, TraceableSummaryDraft } from '@nextagent/agent-contracts/context';
import type {
  ActiveContextItemRecord,
  ActiveContextStateRecord,
  ActiveContextViewRecord,
  SessionMessageRecord,
} from '@nextagent/agent-contracts/gateway';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import type { HookInput, HookResult, LifecycleHookDefinition } from '@nextagent/agent-contracts/runtime';
import type { RuntimeLifecycleHookExecutor } from '@nextagent/agent-runtime';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import { afterEach, describe, expect, it } from 'vitest';
import { apps, closeLifecycleHookApps, identity, waitForTimelineEvent } from './lifecycle-hook-test-helpers.js';
import { createTestModelSelectionService } from '../../packages/agent-context-engine/tests/test-model-selection-helpers.js';

afterEach(async () => {
  await closeLifecycleHookApps();
});

describe('lifecycle hook stage-owner integration', () => {
  it('consumes BEFORE_PLANNING mutation before rendering the model request and detaches replacement fields', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    const generatedMessages = [{ role: 'USER', content: 'planning generated context' }];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage !== 'BEFORE_PLANNING') {
          return { outcome: 'PASS' };
        }
        setTimeout(() => {
          generatedMessages[0]!.content = 'mutated after hook return';
        }, 0);
        return {
          outcome: 'PASS',
          mutation: {
            flowVariables: { networkEnvironment: 'PRODUCTION' },
            capabilityGeneratedMessages: generatedMessages,
            capabilityContextPatch: { modelOptions: { temperature: 0.01 } },
          },
        };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [definition('planning-transform', 'BEFORE_PLANNING', ['TRANSFORM'])];
    const hooks: readonly AgentHookActivation[] = [{ hookId: 'planning-transform', enabled: true }];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'planning transformed' }],
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
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-planning-owner-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run planning owner',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-planning-owner-submit'),
    });

    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    const rendered = JSON.stringify(modelRequests[0]?.messages ?? []);
    expect(rendered).toContain('planning generated context');
    expect(rendered).not.toContain('mutated after hook return');
    expect(modelRequests[0]).toMatchObject({ temperature: 0.01 });
  });

  it('detaches only accepted BEFORE_MODEL_INVOKE replacement fields before provider use', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    const replacementMessages = [
      {
        role: 'SYSTEM' as const,
        content: [{ type: 'text' as const, text: 'stable replacement' }],
      },
    ];
    const replacementProviderOptions = {
      vendor_cache_mode: {
        policy: 'stable',
      },
    };
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage !== 'BEFORE_MODEL_INVOKE') {
          return { outcome: 'PASS' };
        }
        setTimeout(() => {
          replacementMessages[0]!.content[0]!.text = 'mutated after hook return';
          replacementProviderOptions.vendor_cache_mode.policy = 'mutated';
        }, 0);
        return {
          outcome: 'PASS',
          mutation: {
            messages: replacementMessages,
            toolChoice: 'REQUIRED',
            providerOptions: replacementProviderOptions,
          },
        };
      },
    };
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'model replacement detached' }],
      modelRequestSink: modelRequests,
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: [definition('model-replacement-detach', 'BEFORE_MODEL_INVOKE', ['TRANSFORM'])],
      hooks: [{ hookId: 'model-replacement-detach', enabled: true }],
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-model-detach-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run model replacement detach',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-model-detach-submit'),
    });

    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(modelRequests[0]).toMatchObject({
      messages: [
        {
          content: [{ text: 'stable replacement' }],
        },
      ],
      providerOptions: {
        vendor_cache_mode: {
          policy: 'stable',
        },
      },
      toolChoice: 'REQUIRED',
    });
  });

  it.each([
    {
      name: 'planning loop limits',
      stage: 'BEFORE_PLANNING' as const,
      mutation: { maxRounds: 2, maxCalls: 3, maxTurns: 4, maxToolCallsPerTurn: 5 },
    },
    {
      name: 'provider-native tool choice alias',
      stage: 'BEFORE_MODEL_INVOKE' as const,
      mutation: { tool_choice: 'none' },
    },
  ])('rejects $name mutations at the closed hook stage boundary', async ({ stage, mutation }) => {
    const modelRequests: ModelInvocationRequest[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        return input.stage === stage ? { outcome: 'PASS', mutation: mutation as never } : { outcome: 'PASS' };
      },
    };
    const hookId = `closed-${stage.toLowerCase()}`;
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'must not complete' }],
      modelRequestSink: modelRequests,
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: [definition(hookId, stage, ['TRANSFORM'])],
      hooks: [{ hookId, enabled: true }],
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-${hookId}-session`),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run closed hook mutation',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-${hookId}-submit`),
    });

    const failed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_FAILED');
    expect(failed.inlinePayload['content']).toEqual(expect.any(String));
    expect(modelRequests).toHaveLength(0);
  });

  it('uses different stable observe idempotency keys for different BEFORE_PLANNING rounds', async () => {
    const keys: string[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_PLANNING' && input.idempotencyKey !== undefined) {
          keys.push(input.idempotencyKey);
        }
        return { outcome: 'PASS' };
      },
    };
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        { toolCalls: [{ toolCallId: 'tool-read-planning-round', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }] },
        { content: 'second round' },
      ],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: [definition('planning-observe', 'BEFORE_PLANNING', ['OBSERVE'])],
      hooks: [{ hookId: 'planning-observe', enabled: true }],
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-planning-key-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run planning idempotency',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-planning-key-submit'),
    });

    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe('BEFORE_PLANNING:round:0:planning-observe');
    expect(keys[1]).toBe('BEFORE_PLANNING:round:1:planning-observe');
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('fails closed when PEND is returned from BEFORE_PLANNING', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage !== 'BEFORE_PLANNING') {
          return { outcome: 'PASS' };
        }
        return {
          outcome: 'PEND',
          pendingInputIntent: {
            kind: 'CONFIRMATION',
            questions: [{ prompt: 'unsupported', options: [{ label: 'OK', value: 'ok' }] }],
          },
        };
      },
    };
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'must not complete' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: [definition('planning-pend', 'BEFORE_PLANNING', ['CONTROL'])],
      hooks: [{ hookId: 'planning-pend', enabled: true }],
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-planning-pend-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run unsupported planning pend',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-planning-pend-submit'),
    });

    const failed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_FAILED');
    expect(failed.inlinePayload['content']).toContain('BEFORE_PLANNING does not support pending');
  });

  it('does not execute a SYSTEM hook explicitly disabled by the Agent assembly', async () => {
    const calls: string[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        calls.push(input.hookId);
        return { outcome: 'PASS' };
      },
    };
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'system disabled' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: [definition('system.disabled-test', 'BEFORE_REQUEST_ACCEPT', ['CONTROL'], 'SYSTEM')],
      hooks: [{ hookId: 'system.disabled-test', disabled: true }],
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-system-disable-session'),
    });

    await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run system disable',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-system-disable-submit'),
    });

    expect(calls).toEqual([]);
  });

  it('rejects Agent assembly materialization when one stage exceeds maxHooksPerStage', () => {
    const lifecycleHookDefinitions = Array.from({ length: 9 }, (_, index) => definition(`custom.limit-${index}`, 'BEFORE_PLANNING', ['OBSERVE']));
    expect(() =>
      createNextAgentTestApp({
        workspaceDir: process.cwd(),
        modelSteps: [{ content: 'unused' }],
        identity,
        lifecycleHookDefinitions,
        hooks: lifecycleHookDefinitions.map((item) => ({ hookId: item.hookId, enabled: true })),
      }),
    ).toThrow('Lifecycle hook count exceeds maxHooksPerStage for BEFORE_PLANNING.');
  });

  it('does not count CUSTOM hooks without an enabled activation toward maxHooksPerStage', () => {
    const lifecycleHookDefinitions = Array.from({ length: 9 }, (_, index) =>
      definition(`custom.inactive-limit-${index}`, 'BEFORE_PLANNING', ['OBSERVE']),
    );
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'inactive custom hooks' }],
      identity,
      lifecycleHookDefinitions,
      hooks: [],
    });
    apps.push(app);
    expect(app.runtime).toBeDefined();
  });

  it('consumes BEFORE_CONTEXT_COMPACT and AFTER_CONTEXT_COMPACT mutations in the context-engine owner', async () => {
    const calls: string[] = [];
    const committed: SessionMessageRecord[] = [];
    const lifecycleHook = {
      async invoke(request: Parameters<NonNullable<ConstructorParameters<typeof DefaultContextEngine>[0]['lifecycleHook']>['invoke']>[0]) {
        calls.push(request.stage);
        if (request.stage === 'BEFORE_CONTEXT_COMPACT') {
          return {
            status: 'CONTINUE' as const,
            boundary: { ...request.boundary, targetBudgetUnits: 12 } as typeof request.boundary,
          };
        }
        return {
          status: 'CONTINUE' as const,
          boundary: { ...request.boundary, content: 'summary changed by after hook' } as typeof request.boundary,
        };
      },
    } as NonNullable<ConstructorParameters<typeof DefaultContextEngine>[0]['lifecycleHook']>;
    const engine = createCompressionEngine({
      lifecycleHook,
      summaryGenerator: {
        async generate(request): Promise<TraceableSummaryDraft> {
          expect(request.targetBudgetUnits).toBe(12);
          return {
            content: 'summary before after hook',
            sourceReferences: [],
            historyLookupLinkage: [],
            rehydrationHints: [],
            generationMode: 'normal',
            promptTemplateVersion: 'compact-summary/v1',
            inputUnitEstimate: 100,
            outputUnitEstimate: 50,
          };
        },
      },
      commit(summary) {
        committed.push(summary);
      },
    });

    const result = await engine.assemble(contextRequest('current'), undefined, new AbortController().signal);

    expect(calls).toEqual(['BEFORE_CONTEXT_COMPACT', 'AFTER_CONTEXT_COMPACT']);
    expect(committed[0]?.content).toBe('summary changed by after hook');
    expect(result.compressionEvidence).toBeDefined();
  });
});

function definition(
  hookId: string,
  stage: LifecycleHookDefinition['supportedStages'][number],
  effects: LifecycleHookDefinition['effects'],
  kind: LifecycleHookDefinition['kind'] = 'CUSTOM',
): LifecycleHookDefinition {
  return {
    hookId,
    kind,
    supportedStages: [stage],
    effects,
    executionStrategy: effects.length === 1 && effects[0] === 'OBSERVE' ? 'OBSERVE_PARALLEL' : 'SERIAL_IMPACT',
    failureMode: 'FAIL',
    ...(kind === 'SYSTEM' ? { order: 0 } : {}),
  };
}

const tenant = brand<string, 'TenantId'>('tenant-context-hook');
const subject = brand<string, 'SubjectId'>('subject-context-hook');
const contextAgent = brand<string, 'AgentId'>('agent-context-hook');
const contextAgentVersion = brand<string, 'AgentVersion'>('v1');
const contextSession = brand<string, 'SessionId'>('session-context-hook');

function msgId(value: string): MessageId {
  return brand<string, 'MessageId'>(value);
}

function contextRequest(currentRequestId: string) {
  return {
    sessionId: contextSession,
    requestId: msgId(currentRequestId),
    requestContextId: brand<string, 'RequestContextId'>('request-context-hook'),
    identityContext: { tenantId: tenant, subjectId: subject, displayName: 'Context hook tester' },
    agentId: contextAgent,
    agentVersion: contextAgentVersion,
    runId: brand<string, 'RequestRunId'>('run-context-hook'),
    stepId: 'turn-context',
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    purpose: 'context-hook-test',
  };
}

function createCompressionEngine(options: {
  readonly lifecycleHook: NonNullable<ConstructorParameters<typeof DefaultContextEngine>[0]['lifecycleHook']>;
  readonly summaryGenerator: NonNullable<ConstructorParameters<typeof DefaultContextEngine>[0]['summaryGenerator']>;
  readonly commit: (summary: SessionMessageRecord) => void;
}): DefaultContextEngine {
  const messages = [
    sessionRecord(userMessage('u1', 'old question', 'turn-1')),
    sessionRecord(assistantMessage('a1', 'old answer', 'turn-1')),
    sessionRecord(userMessage('u2', 'recent question', 'turn-2')),
    sessionRecord(assistantMessage('a2', 'recent answer', 'turn-2')),
    sessionRecord(userMessage('current', 'current question', 'current')),
  ];
  const byId = new Map(messages.map((message) => [message.messageId, message] as const));
  return new DefaultContextEngine({
    activeContextStore: {
      async loadActiveContext() {
        return activeContextView(['u1', 'a1', 'u2', 'a2', 'current'], 7);
      },
      async appendItem() {
        throw new Error('unused');
      },
      async commitCompaction(request) {
        options.commit(request.summaryMessage);
        return { status: 'UPDATED' as const, record: activeContextView(['summary-1', 'u2', 'a2', 'current'], 8) };
      },
      async updateMetadata() {
        return { status: 'UPDATED' as const };
      },
    },
    messageStore: {
      async loadMessage(request) {
        const message = byId.get(request.messageId);
        if (message === undefined) {
          throw new Error(`Missing message ${request.messageId}.`);
        }
        return message;
      },
      async loadMessages(request) {
        return request.messageIds.map((messageId) => byId.get(messageId)).filter((item): item is SessionMessageRecord => item !== undefined);
      },
      async appendSessionMessage() {
        throw new Error('unused');
      },
      async listMessages() {
        throw new Error('unused');
      },
      async listCurrentRequestMessages() {
        throw new Error('unused');
      },
      async listConversationPreview() {
        throw new Error('unused');
      },
      async hideMessage() {
        throw new Error('unused');
      },
      async hideRequestMessages() {
        throw new Error('unused');
      },
    },
    assemblyRegistry: contextAssemblyRegistry(),
    capabilityCatalog: emptyCapabilityCatalog(),
    modelSelectionService: createTestModelSelectionService({
      modelId: 'context-test-model',
      contextWindowTokens: 15_000,
      maxOutputTokens: 1_000,
    }),
    budgetPolicy: compactingPolicy(),
    summaryGenerator: options.summaryGenerator,
    commitCompaction: async (request) => {
      options.commit(request.summaryMessage);
      return { status: 'UPDATED' as const, record: activeContextView(['summary-1', 'u2', 'a2', 'current'], 8) };
    },
    lifecycleHook: options.lifecycleHook,
    idFactory: (prefix) => `${prefix}-1`,
    clock: () => brand<number, 'EpochMillis'>(1),
  });
}

function userMessage(messageId: string, content: string, requestId = messageId): SessionMessage {
  return {
    messageId: msgId(messageId),
    sessionId: contextSession,
    requestId: msgId(requestId),
    role: 'USER',
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence: 0,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function assistantMessage(messageId: string, content: string, requestId = messageId): SessionMessage {
  return {
    messageId: msgId(messageId),
    sessionId: contextSession,
    requestId: msgId(requestId),
    role: 'ASSISTANT',
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence: 0,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function sessionRecord(message: SessionMessage): SessionMessageRecord {
  return {
    tenantId: tenant,
    subjectId: subject,
    agentId: contextAgent,
    messageId: message.messageId,
    sessionId: contextSession,
    requestId: message.requestId,
    role: message.role,
    content: message.content,
    contentType: message.contentType,
    metadata: message.metadata,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function activeContextView(messageIds: readonly string[], activeContextVersion: number): ActiveContextViewRecord {
  const state: ActiveContextStateRecord = {
    tenantId: tenant,
    subjectId: subject,
    agentId: contextAgent,
    sessionId: contextSession,
    activeContextVersion,
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
  const items: readonly ActiveContextItemRecord[] = messageIds.map((id, ordinal) => ({
    tenantId: tenant,
    subjectId: subject,
    agentId: contextAgent,
    sessionId: contextSession,
    ordinal,
    messageId: msgId(id),
  }));
  return { state, items };
}

function contextAssemblyRegistry(): AgentAssemblyRegistry {
  const assembly: AgentAssembly = {
    agentId: contextAgent,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: contextAgentVersion,
    agentAssemblyRef: 'agent-context-hook:v1',
    displayName: 'context hook',
    description: 'context hook',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [],
    },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxTurns: 1, maxToolCallsPerTurn: 30, maxContextMessages: 50 },
  };
  return {
    active: async () => assembly,
    require: async () => assembly,
  };
}

function emptyCapabilityCatalog(): CapabilityCatalog {
  return {
    listAvailable: async () => [],
    resolve: async () => undefined,
  };
}

function compactingPolicy(): ContextBudgetPolicyPort {
  return {
    evaluate(input) {
      const plan: ContextCompactionPlan = {
        decision: 'compact_degrade',
        reasonCode: 'HISTORY_OMITTED_TO_BUDGET',
        compressionMode: 'none',
        degradationMode: [],
        pipelineStageStoppedAt: 'agent-context-engine.budget-decision-gate',
        estimatedFinalInputUnits: input.minimumSafeContextUnits + 1000,
        omittedContextTypes: ['prior_active_history'],
      };
      return {
        plan,
        evidence: input.sourceCandidates.map((candidate) => ({
          category: candidate.category,
          estimatedInputUnits: candidate.estimatedInputUnits,
          status: candidate.priority === 'required' ? 'selected' : 'omitted',
          reasonCode: candidate.priority === 'required' ? 'WITHIN_BUDGET' : 'HISTORY_OMITTED_TO_BUDGET',
          owningBoundary: candidate.owningBoundary,
          safeIdentifier: candidate.safeIdentifier,
        })),
        roleEvidence: [],
      };
    },
  };
}
