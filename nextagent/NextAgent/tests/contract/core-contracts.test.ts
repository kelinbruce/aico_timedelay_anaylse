import {
  AgentError,
  brand,
  deriveCapabilityInvocationIdempotencyKey,
  runtimeRawExceptionData,
  type ArtifactId,
  type EpochMillis,
  type MessageId,
  type RequestPriority,
  type SessionId,
} from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { ModelProfile } from '@nextagent/agent-contracts/app';
import {
  capabilityDescriptorSchema,
  type CapabilityDescriptor,
  type CapabilityInvocationRequest,
  type SubagentExecutionPort,
} from '@nextagent/agent-contracts/capability';
import type { StreamEnvelope, StreamEventType } from '@nextagent/agent-contracts/channel';
import type { ContextAssemblyRequest } from '@nextagent/agent-contracts/context';
import type {
  ArtifactMetadataRecord,
  AttachmentStoreGateway,
  BlobStoreGateway,
  CronTaskGatewayPort,
  CronTaskRecord,
  CronTriggerRecord,
  ListCurrentRequestMessagesRecordQuery,
  ListFavoriteTurnsQuery,
  AgentListUnresolvedPendingInputTimeoutFactsRequest,
  RunTimelineEventRecordQuery,
  RequestAttachmentRecord,
  RequestRunRecord,
  RequestRunStoreGateway,
  PendingInputRecord,
  PendingInputStoreGateway,
  ResolvePendingInputRecordOptions,
  ScheduledMaintenanceGatewayPort,
  ScheduledMaintenanceJob,
  ListSessionMessagesRecordQuery,
  SessionHistoryRecordQuery,
  SandboxFilesystemRoot,
  SessionMessageRecord,
  SessionRecord,
  TerminalCommitRecordResult,
  VersionedUpdateResult,
} from '@nextagent/agent-contracts/gateway';
import type {
  ModelFinishReason,
  ModelInferenceOptions,
  ModelInvocationRequest,
  ModelMessage,
  ModelToolDescriptor,
} from '@nextagent/agent-contracts/model';
import type {
  Agent,
  AgentExecutionOutcome,
  AgentRunStatePort,
  CheckpointPayload,
  HookBoundaryByStage,
  HookInput,
  HookMutationByStage,
  HookResult,
  LifecycleHookDefinition,
  LifecycleHookInvocationPort,
  PendingInputAnswer,
  PendingInputQuestion,
  PendingInputRequest,
  RequestContext,
  RequestRun,
  RunTimelineEvent,
  ExecutionWorkspaceRootView,
  RuntimeActiveRunSummary,
  RuntimeGetActiveRunQuery,
  RuntimeSessionPort,
  RuntimeSessionStreamEventsQuery,
  SubmitRequestCommand,
  ToolCallState,
} from '@nextagent/agent-contracts/runtime';
import { LifecycleHookInterruptionError, runtimeLifecycleStages } from '@nextagent/agent-contracts/runtime';
import { defineLifecycleHook, hookExecutionStrategy, validateLifecycleHookDefinition } from '@nextagent/agent-runtime';
import type { UserSession, SessionMessagePage, UserSessionPage } from '@nextagent/agent-contracts/session';
import { createIdentityFixture, createSafeErrorFixture, createStreamEnvelopeFixture } from '@nextagent/agent-test-kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('core contract foundation', () => {
  it('constructs stable branded ids, identity context, AgentError, and SafeError fixtures', () => {
    const identity = createIdentityFixture();
    const safeError = createSafeErrorFixture();
    const agentError = new AgentError({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { field: 'inputText' },
    });

    expect(identity.tenantId).toBe('tenant-1');
    expect(identity.subjectId).toBe('subject-1');
    expect(safeError).toMatchObject({ code: 'TEST_SAFE_ERROR', category: 'VALIDATION', retryable: false });
    expect(agentError.safeDetails).toEqual({ field: 'inputText' });
  });

  it('keeps ordinary exception fields while redacting sensitive exception data', () => {
    const error = new AgentError({
      code: 'TOOL_FAILURE',
      message: 'failed with request body',
      category: 'INTERNAL',
      safeDetails: {
        status: 'E_CONN',
        password: 'plain-password',
        apiKey: 'key-value',
        configPath: 'C:\\runtime\\secrets\\config.json',
        endpointUrl: 'https://service.example.test/v1/execute',
        prompt: 'describe the failure',
        content: 'raw-content',
        body: 'raw-body',
        message: 'raw-message',
        script: 'raw-script',
        query: 'find token=abc123 in /var/lib/agent/runtime.log',
        pattern: 'raw-pattern',
        text: 'raw-text',
        input: 'raw-input',
        question: 'raw-question',
        location: 'logs/runtime.log',
        diagnostic: 'short-value',
      },
    });

    expect(runtimeRawExceptionData(error)).toMatchObject({
      code: 'TOOL_FAILURE',
      message: 'failed with request body',
      safeDetails: {
        status: 'E_CONN',
        password: '<redacted:credential>',
        apiKey: '<redacted:credential>',
        configPath: 'C:\\runtime\\secrets\\config.json',
        endpointUrl: 'https://service.example.test/v1/execute',
        prompt: 'describe the failure',
        content: 'raw-content',
        body: 'raw-body',
        message: 'raw-message',
        script: 'raw-script',
        query: 'find token=<redacted:credential> in /var/lib/agent/runtime.log',
        pattern: 'raw-pattern',
        text: 'raw-text',
        input: 'raw-input',
        question: 'raw-question',
        location: 'logs/runtime.log',
        diagnostic: 'short-value',
      },
    });
  });

  it('keeps runtime command identity authoritative and attachment references ID-only', () => {
    const identity = createIdentityFixture();
    const command: SubmitRequestCommand = {
      sessionId: brand<string, 'SessionId'>('session-1'),
      identityContext: identity,
      inputText: '诊断小区告警',
      attachmentIds: [brand<string, 'AttachmentId'>('attachment-1')],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-1'),
    };

    expect(command.identityContext.tenantId).toBe(identity.tenantId);
    expect(command.attachmentIds).toEqual(['attachment-1']);
    expect(Object.hasOwn(command, 'tenantId')).toBe(false);
  });

  it('freezes runtime, timeline, and stream vocabulary boundaries', () => {
    const timeline: RunTimelineEvent = {
      type: 'REQUEST_ACCEPTED',
      inlinePayload: {},
    };
    const stream: StreamEnvelope = createStreamEnvelopeFixture();
    const streamEvent: StreamEventType = 'REQUEST_ACCEPTED';

    expect(timeline.type).toBe('REQUEST_ACCEPTED');
    expect(stream.eventType).toBe(streamEvent);
    expect(runtimeLifecycleStages).toContain('BEFORE_AGENT_TERMINAL');
    expect(stream.requestId).toBeDefined();
  });

  it('defines runtime session-facing stream facade and active-run bootstrap contracts', async () => {
    const identity = createIdentityFixture();
    const sessionId = brand<string, 'SessionId'>('session-stream-contract');
    const requestId = brand<string, 'MessageId'>('request-stream-contract');
    const runId = brand<string, 'RequestRunId'>('run-stream-contract');
    const query: RuntimeSessionStreamEventsQuery = {
      identityContext: identity,
      sessionId,
      lastSeenSequence: brand<number, 'TimelineSequence'>(7),
      requestId,
      runId,
    };
    const activeRunQuery: RuntimeGetActiveRunQuery = {
      identityContext: identity,
      sessionId,
    };
    const activeRun: RuntimeActiveRunSummary = {
      requestId,
      runId,
      status: 'EXECUTING',
    };
    const runtimeSession: RuntimeSessionPort = {
      async createSession() {
        throw new Error('not used');
      },
      async requireSession() {
        throw new Error('not used');
      },
      async listSessions() {
        throw new Error('not used');
      },
      async deleteSession() {
        throw new Error('not used');
      },
      async forkFromMessage() {
        throw new Error('not used');
      },
      async forkFromRequest() {
        throw new Error('not used');
      },
      async listMessages() {
        throw new Error('not used');
      },
      async listConversationPreview() {
        throw new Error('not used');
      },
      async updateTitle() {
        throw new Error('not used');
      },
      async *streamEvents(request) {
        expect(request).toBe(query);
        yield timeline;
      },
      async listEvents() {
        return { availability: 'AVAILABLE', events: [] };
      },
      async getActiveRun(request) {
        expect(request).toBe(activeRunQuery);
        return activeRun;
      },
      async getRequestSummary() {
        return undefined;
      },
    };
    const timeline: RunTimelineEvent = {
      eventId: 'timeline-stream-contract',
      sessionId,
      requestId,
      runId,
      sequence: brand<number, 'TimelineSequence'>(8),
      type: 'REQUEST_ACCEPTED',
      inlinePayload: {},
      createdAt: new Date(8),
    };
    const [event] = await collect(runtimeSession.streamEvents(query));

    expect(event).toBe(timeline);
    await expect(runtimeSession.getActiveRun(activeRunQuery)).resolves.toEqual(activeRun);
    expect(Object.hasOwn(query, 'agentId')).toBe(false);
  });

  it('defines RequestRun version, terminal state, and recovery coordinates', () => {
    const run: RequestRun = {
      runId: brand<string, 'RequestRunId'>('run-1'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('message-1'),
      agentId: brand<string, 'AgentId'>('agent-1'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'assembly-1',
      attempt: 1,
      status: 'EXECUTING',
      version: 2,
      terminalCommitState: 'PENDING',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(2),
    };

    expect(run.version).toBeGreaterThan(0);
    expect(run.terminalCommitState).toBe('PENDING');
  });

  it('defines governed subagent execution and submit priority coordinates', async () => {
    const priority: RequestPriority = 'LOW';
    const command: SubmitRequestCommand = {
      agentId: brand<string, 'AgentId'>('child-agent'),
      identityContext: createIdentityFixture(),
      inputText: 'delegate diagnostics',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      parentSessionId: brand<string, 'SessionId'>('session-parent'),
      parentRunId: brand<string, 'RequestRunId'>('run-parent'),
      parentRequestId: brand<string, 'MessageId'>('request-parent'),
      priority,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-subagent-contract'),
    };
    const subagentExecution: SubagentExecutionPort = {
      async executeSubagent(request) {
        expect(request).toMatchObject({
          targetAgentId: 'child-agent',
          targetProviderKind: 'BUNDLED',
          parentSessionId: 'session-parent',
          parentRunId: 'run-parent',
          parentRequestId: 'request-parent',
          parentToolCallId: 'tool-call-parent',
          locale: 'zh-CN',
        });
        return { status: 'COMPLETED', terminalText: 'done', childRunId: brand<string, 'RequestRunId'>('run-child') };
      },
    };

    expect(command.sessionId).toBeUndefined();
    expect(command.priority).toBe('LOW');
    await expect(
      subagentExecution.executeSubagent(
        {
          targetAgentId: command.agentId!,
          targetProviderKind: 'BUNDLED',
          prompt: command.inputText,
          parentSessionId: command.parentSessionId!,
          parentRunId: command.parentRunId!,
          parentRequestId: command.parentRequestId!,
          parentToolCallId: 'tool-call-parent',
          identityContext: command.identityContext,
          locale: command.locale,
          idempotencyKey: command.idempotencyKey,
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: 'COMPLETED', terminalText: 'done' });
  });

  it('allows lifecycle hook invocation ports to receive an optional AbortSignal from stage owners', async () => {
    let capturedSignal: AbortSignal | undefined;
    const invocationPort: LifecycleHookInvocationPort = {
      async invoke(request, signal?: AbortSignal) {
        capturedSignal = signal;
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };
    const controller = new AbortController();

    await expect(
      invocationPort.invoke(
        {
          stage: 'BEFORE_REQUEST_ACCEPT',
          coordinates: {
            agentId: brand<string, 'AgentId'>('agent-1'),
            agentVersion: brand<string, 'AgentVersion'>('v1'),
            agentAssemblyRef: 'assembly-1',
            stageOccurrenceKey: 'accept:idem-1',
          },
          ownerScope: {
            tenantId: brand<string, 'TenantId'>('tenant-1'),
            subjectId: brand<string, 'SubjectId'>('subject-1'),
          },
          boundary: {
            locale: brand<string, 'RequestLocale'>('zh-CN'),
            attachmentCount: 0,
            idempotencyKeyPresent: true,
            safeRequestClass: 'TEXT_ONLY',
          },
        },
        controller.signal,
      ),
    ).resolves.toMatchObject({ status: 'CONTINUE' });
    expect(capturedSignal).toBe(controller.signal);
  });

  it('defines canonical lifecycle hook authoring, mutation, and invocation contracts', async () => {
    const modelMutation: HookMutationByStage['BEFORE_MODEL_INVOKE'] = {
      messages: [],
    };
    const passResult: HookResult<'BEFORE_MODEL_INVOKE'> = {
      outcome: 'PASS',
      resultSummary: { a: 1, b: 2 },
    };
    const skipResult: HookResult = { outcome: 'SKIP' };
    // @ts-expect-error Hook result summary must be a JSON object.
    const scalarResultSummary: HookResult = { outcome: 'PASS', resultSummary: 'not-an-object' };
    // @ts-expect-error Hook result must declare a canonical outcome.
    const missingOutcomeResult: HookResult<'BEFORE_MODEL_INVOKE'> = {};
    // @ts-expect-error Mutation result must still declare a canonical outcome.
    const mutationWithoutOutcome: HookResult<'BEFORE_MODEL_INVOKE'> = { mutation: modelMutation };
    // Planning fields are not legal at the model invoke stage (runtime validates, not type system).
    const wrongStageField = { flowVariables: {} } as HookMutationByStage['BEFORE_MODEL_INVOKE'];
    const terminalBoundary: HookBoundaryByStage['BEFORE_AGENT_TERMINAL'] = {
      finalContent: 'safe terminal',
      toolCalls: [],
      safeTerminalSummary: 'safe terminal',
    };
    const capabilityResultBoundary: HookBoundaryByStage['AFTER_CAPABILITY_RESULT'] = {
      capabilityId: brand<string, 'CapabilityId'>('Bash'),
      capabilityInvocationId: 'run-contract:tool-contract',
      arguments: { command: 'python workspace/action.py' },
      status: 'SUCCEEDED',
      safeResultSummary: 'result fields=1',
      generatedMessageCount: 0,
      artifactCount: 0,
    };
    const terminalCoordinates = {
      sessionId: brand<string, 'SessionId'>('session-terminal-contract'),
      requestId: brand<string, 'MessageId'>('request-terminal-contract'),
      requestRunId: brand<string, 'RequestRunId'>('run-terminal-contract'),
      agentId: brand<string, 'AgentId'>('agent-terminal-contract'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent-terminal-contract:v1',
      stageOccurrenceKey: 'terminal:1',
    };
    const modelHook = defineLifecycleHook({
      hookId: 'contract.model-invoke',
      kind: 'CUSTOM',
      supportedStages: ['BEFORE_MODEL_INVOKE'] as const,
      effects: ['TRANSFORM'] as const,
      failureMode: 'FAIL',
      execute(input) {
        expect(input.boundary.modelId).toBeDefined();
        return {
          outcome: 'PASS',
          mutation: { messages: input.boundary.messages ?? [] },
        };
      },
    });
    const systemDefinition: LifecycleHookDefinition = {
      hookId: 'system.contract',
      kind: 'SYSTEM',
      supportedStages: ['BEFORE_AGENT_TERMINAL'],
      effects: ['CONTROL'],
      executionStrategy: hookExecutionStrategy(['CONTROL']),
      failureMode: 'FAIL',
      order: 0,
    };
    const invocationPort: LifecycleHookInvocationPort = {
      async invoke(request) {
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };

    expect(modelMutation.messages).toEqual([]);
    expect(passResult.outcome).toBe('PASS');
    expect(passResult.resultSummary).toEqual({ a: 1, b: 2 });
    expect(skipResult.outcome).toBe('SKIP');
    expect(scalarResultSummary).toEqual({ outcome: 'PASS', resultSummary: 'not-an-object' });
    expect(missingOutcomeResult).toEqual({});
    expect(mutationWithoutOutcome).toEqual({ mutation: modelMutation });
    expect(capabilityResultBoundary.arguments).toEqual({ command: 'python workspace/action.py' });
    expect(modelHook.supportedStages).toEqual(['BEFORE_MODEL_INVOKE']);
    expect(() => validateLifecycleHookDefinition(systemDefinition)).not.toThrow();
    expect(() =>
      defineLifecycleHook({
        hookId: 'system.missing-order',
        kind: 'SYSTEM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'] as const,
        effects: ['CONTROL'] as const,
        failureMode: 'FAIL',
        execute() {
          return { outcome: 'PASS' };
        },
      }),
    ).toThrow('SYSTEM lifecycle hooks must declare framework order.');
    await expect(
      invocationPort.invoke({
        stage: 'BEFORE_AGENT_TERMINAL',
        coordinates: terminalCoordinates,
        ownerScope: {
          tenantId: brand<string, 'TenantId'>('tenant-terminal-contract'),
          subjectId: brand<string, 'SubjectId'>('subject-terminal-contract'),
        },
        boundary: terminalBoundary,
      }),
    ).resolves.toEqual({ status: 'CONTINUE', boundary: terminalBoundary });
    const interruption = {
      stage: 'BEFORE_AGENT_TERMINAL' as const,
      hookInvocationId: 'hook-contract',
      outcome: 'BLOCK' as const,
      safeReason: 'blocked',
    };
    const interruptionError = new LifecycleHookInterruptionError(interruption);
    expect(interruptionError).toBeInstanceOf(Error);
    expect(interruptionError.interruption).toBe(interruption);
  });

  it('rejects invalid lifecycle hook definition shapes', () => {
    const baseDefinition: LifecycleHookDefinition = {
      hookId: 'contract.definition',
      kind: 'CUSTOM',
      supportedStages: ['BEFORE_MODEL_INVOKE'],
      effects: ['OBSERVE'],
      executionStrategy: 'OBSERVE_PARALLEL',
      failureMode: 'FAIL',
    };

    expect(() => validateLifecycleHookDefinition(baseDefinition)).not.toThrow();
    expect(() => validateLifecycleHookDefinition({ ...baseDefinition, hookId: 'unsafe hook' })).toThrow('hookId');
    expect(() =>
      validateLifecycleHookDefinition({
        ...baseDefinition,
        supportedStages: ['UNKNOWN_STAGE' as never],
      }),
    ).toThrow('stage is unsupported');
    expect(() =>
      validateLifecycleHookDefinition({
        ...baseDefinition,
        effects: ['OBSERVE', 'OBSERVE'],
      }),
    ).toThrow('non-empty and unique');
    expect(() =>
      validateLifecycleHookDefinition({
        ...baseDefinition,
        effects: ['UNKNOWN_EFFECT' as never],
      }),
    ).toThrow('effect is unsupported');
    expect(() =>
      validateLifecycleHookDefinition({
        ...baseDefinition,
        effects: ['CONTROL'],
        executionStrategy: 'OBSERVE_PARALLEL',
      }),
    ).toThrow('execution strategy must be derived');
    expect(() =>
      validateLifecycleHookDefinition({
        ...baseDefinition,
        kind: 'SYSTEM',
        effects: ['CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
      }),
    ).toThrow('framework order');
  });

  it('keeps runtime-safe assembly facts separate from Agent execution and raw app config', async () => {
    const assembly: AgentAssembly = {
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentType: brand<string, 'AgentType'>('default'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      displayName: 'Default Agent',
      description: 'Telecom operations agent.',
      workspacePolicy: {
        schemaVersion: 'nextagent.agent-workspace-policy.v1',
        isolationMode: 'subject',
        roots: [
          { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
          { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
          { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
          { kind: 'sharedData', logicalPath: 'shared-data', access: 'read' },
        ],
      },
      modelIds: ['openai-main'],
      capabilityBindings: [{ capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: true }],
      userInvocable: true,
      agentInvocation: 'BOUND',
      runtimeSettings: { requestTimeoutMs: 1000 },
      routing: { mode: 'default' },
    };
    const source = await readFile(join(process.cwd(), 'packages/agent-contracts/src/agent-assembly/index.ts'), 'utf8');

    expect(assembly.agentAssemblyRef).toBe('default-agent:v1');
    expect(assembly.workspacePolicy.roots).toContainEqual({ kind: 'sharedData', logicalPath: 'shared-data', access: 'read' });
    expect(source).toContain('interface AgentAssemblyRegistry');
    expect(source).toContain('interface AgentRoutingConfig');
    expect(source).not.toContain('interface Agent ');
    expect(source).not.toContain('AgentDefinition');
    expect(source).not.toContain('SystemConfig');
    expect(source).not.toContain('promptTemplateIds');
    expect(source).not.toContain('defaultPromptTemplateId');
    expect(source).not.toContain('credential');
    expect(source).not.toContain('../runtime/');
    expect(source).not.toContain('../gateway/');
    expect(source).not.toContain('../channel/');
    expect(source).not.toContain('../model/');
    expect(source).not.toContain('../capability/');
  });

  it('keeps RequestContext free of run control fields and ToolCallState arguments structured', () => {
    const context: RequestContext = {
      requestContextId: brand<string, 'RequestContextId'>('context-1'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('message-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      agentTurnIndex: 0,
      identityContext: createIdentityFixture(),
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId: brand<string, 'AgentId'>('agent-1'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent-1:v1',
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: {},
    };
    const toolCall: ToolCallState = {
      toolCallId: 'tool-1',
      capabilityId: brand<string, 'CapabilityId'>('Read'),
      arguments: { file_path: 'package.json', offset: 0 },
      status: 'PENDING',
    };

    expect(Object.hasOwn(context, 'attempt')).toBe(false);
    expect(Object.hasOwn(context, 'deadlineAt')).toBe(false);
    expect(Object.hasOwn(context, 'messageRefs')).toBe(false);
    expect(toolCall.arguments).toEqual({ file_path: 'package.json', offset: 0 });
  });

  it('defines sharedData as read-only execution and sandbox root vocabulary', () => {
    const runtimeRoot: ExecutionWorkspaceRootView = {
      kind: 'sharedData',
      logicalPath: 'shared-data',
      physicalPath: '/safe-display-only/shared-data',
      access: 'read',
    };
    const sandboxRoot: SandboxFilesystemRoot = {
      kind: 'sharedData',
      logicalPath: 'shared-data',
      physicalPath: '/safe-display-only/shared-data',
      access: 'read',
    };

    expect(runtimeRoot).toMatchObject({ kind: 'sharedData', logicalPath: 'shared-data', access: 'read' });
    expect(sandboxRoot).toMatchObject({ kind: 'sharedData', logicalPath: 'shared-data', access: 'read' });
  });

  it('defines context, capability, and model-visible boundaries without provider SDK types', () => {
    const contextRequest: ContextAssemblyRequest = {
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('message-1'),
      requestContextId: brand<string, 'RequestContextId'>('context-1'),
      identityContext: createIdentityFixture(),
      agentId: brand<string, 'AgentId'>('agent-1'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      stepId: 'step-1',
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      purpose: 'diagnose',
    };
    const descriptor: CapabilityDescriptor = {
      capabilityId: brand<string, 'CapabilityId'>('capability-1'),
      kind: 'TOOL',
      provider: { providerId: 'bundled', providerKind: 'BUNDLED' },
      displayName: 'Alarm query',
      description: 'Query alarm summary.',
      modelInvocable: true,
      availabilityStatus: 'AVAILABLE',
      outputSchema: { type: 'object', additionalProperties: true },
      compatibility: {
        supportedOsFamilies: [],
        supportedCpuArchitectures: [],
        requiredExecutables: [],
        requiredEnvironmentKeys: [],
        requiredConfigurationKeys: [],
        networkRequired: false,
        runtimeTags: [],
      },
      replayPolicy: 'NON_IDEMPOTENT',
    };
    const invocation: CapabilityInvocationRequest = {
      invocationId: 'invoke-1',
      capabilityId: descriptor.capabilityId,
      arguments: {},
      sessionId: contextRequest.sessionId,
      requestId: contextRequest.requestId,
      runId: contextRequest.runId,
      requestContextId: contextRequest.requestContextId,
      stepId: 'step-1',
      identityContext: createIdentityFixture(),
      agentId: contextRequest.agentId,
      agentVersion: contextRequest.agentVersion,
      timeoutMs: 1000,
      maxRetries: 1,
    };

    expect(contextRequest.locale).toBe('zh-CN');
    expect(descriptor.kind).toBe('TOOL');
    expect(descriptor.outputSchema).toEqual({ type: 'object', additionalProperties: true });
    expect(invocation.identityContext.tenantId).toBe('tenant-1');
    expect(invocation.maxRetries).toBe(1);
  });

  it('uses WORKFLOW rather than RECIPE as the runtime capability kind', () => {
    const kindSchema = (capabilityDescriptorSchema.properties as Record<string, { readonly enum?: readonly string[] }>).kind;

    expect(kindSchema?.enum).toContain('WORKFLOW');
    expect(kindSchema?.enum).not.toContain('RECIPE');
  });

  it('keeps prompt template implementation contracts out of agent-contracts/context', async () => {
    const source = await readFile(join(process.cwd(), 'packages/agent-contracts/src/context/index.ts'), 'utf8');
    const forbidden = [
      'LayeredProfileResolver',
      'PromptTemplateProfile',
      'PromptTemplateProfileQuery',
      'PromptTemplateLoader',
      'TemplateContent',
      'PromptTemplateSectionContent',
      'PromptPurpose',
      'PromptModelCandidate',
      'PromptModelCompatibilityRequest',
      'PromptModelCompatibilityResolver',
      'PromptAssemblyRequest',
      'PromptTemplate',
      'PromptSection',
      'PromptAssemblyResult',
      'PromptTemplateAssembler',
      'SystemPromptContext',
      'SystemPromptBuilder',
      'TemplateVariableResolver',
      'TemplateVariableResolution',
      'SystemPromptContribution',
    ];

    for (const name of forbidden) {
      expect(source).not.toMatch(new RegExp(`export\\s+(interface|type|class|const)\\s+${name}\\b`, 'u'));
    }
    expect(source).toMatch(/export interface PromptTemplateResolverPort\b/u);
    expect(source).toMatch(/export const PromptTemplateResolveRequestSchema\b/u);
  });

  it('keeps capability SEARCH discovery criteria free of binding-owned facts and provider kind vocabulary unchanged', async () => {
    const discoverySource = await readFile(join(process.cwd(), 'packages/agent-contracts/src/capability/index.ts'), 'utf8');
    const commonSource = await readFile(join(process.cwd(), 'packages/agent-common/src/index.ts'), 'utf8');
    const criteriaBlock = discoverySource.slice(
      discoverySource.indexOf('export interface CapabilitySearchCriteria'),
      discoverySource.indexOf('export interface SkillScanEvidenceItem'),
    );

    expect(criteriaBlock).toContain('agentId');
    expect(criteriaBlock).toContain('agentVersion');
    expect(criteriaBlock).toContain('agentAssemblyRef');
    expect(criteriaBlock).not.toContain('readonly agentAssembly:');
    expect(criteriaBlock).not.toContain('boundCapabilityIds');
    expect(criteriaBlock).not.toContain('capabilityBindings');
    expect(commonSource).toMatch(/["']LOCAL_DIRECTORY["']/);
    expect(commonSource).not.toContain('LOCAL_SKILL');
  });

  it('keeps builtin executable platform facts out of public capability and sandbox contracts', async () => {
    const capabilitySource = await readFile(join(process.cwd(), 'packages/agent-contracts/src/capability/index.ts'), 'utf8');
    const gatewaySource = await readFile(join(process.cwd(), 'packages/agent-contracts/src/gateway/index.ts'), 'utf8');
    const invocationBlock = capabilitySource.slice(
      capabilitySource.indexOf('export interface CapabilityInvocationRequest'),
      capabilitySource.indexOf('export interface RuntimeCapabilityResolveRequest'),
    );
    const runtimeContextBlock = capabilitySource.slice(
      capabilitySource.indexOf('export interface CapabilityInvocationRuntimeContext'),
      capabilitySource.indexOf('export interface CapabilityGeneratedMessage'),
    );
    const sandboxPortBlock = gatewaySource.slice(
      gatewaySource.indexOf('export interface SandboxGatewayPort'),
      gatewaySource.indexOf('export interface BackgroundCapableSandboxPort'),
    );

    expect(invocationBlock).not.toContain('platform');
    expect(invocationBlock).not.toContain('workspaceRoot');
    expect(invocationBlock).not.toContain('workspaceDir');
    expect(invocationBlock).toContain('readonly maxRetries?: number;');
    expect(runtimeContextBlock).not.toContain('agentAssemblyRef');
    expect(sandboxPortBlock).toContain('execute: (request: SandboxExecutionRequest, signal?: AbortSignal) => Promise<SandboxExecutionResult>');
    expect(sandboxPortBlock).not.toContain('platform');
  });

  it('keeps Agent execution on runtime timeline and message append ports', async () => {
    const identity = createIdentityFixture();
    const run: RequestRun = {
      runId: brand<string, 'RequestRunId'>('run-agent'),
      sessionId: brand<string, 'SessionId'>('session-agent'),
      requestId: brand<string, 'MessageId'>('request-agent'),
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      attempt: 1,
      status: 'EXECUTING',
      version: 1,
      terminalCommitState: 'NOT_STARTED',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    };
    const context: RequestContext = {
      requestContextId: brand<string, 'RequestContextId'>('context-agent'),
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId: run.runId,
      agentTurnIndex: 0,
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: {},
    };
    const appended: unknown[] = [];
    const emitted: unknown[] = [];
    const checkpointReasons: string[] = [];
    const capabilityTerminalAnswers: string[] = [];
    const runState: AgentRunStatePort = {
      async emitEvent(portRun, portContext, event) {
        emitted.push({ portRun, portContext, event });
      },
      async appendMessage(portRun, portContext, draft) {
        appended.push({ portRun, portContext, draft });
        return brand<string, 'MessageId'>('message-appended');
      },
      async setCapabilityTerminalAnswer(_portRun, _portContext, answer) {
        capabilityTerminalAnswers.push(answer.content);
      },
      async saveCheckpoint(_portRun, _portContext, triggerReason) {
        checkpointReasons.push(triggerReason);
      },
      async requestPendingInput(_portRun, _portContext, _intent) {
        throw new AgentError({ code: 'TEST_PENDING_INPUT_UNAVAILABLE', message: 'not used', category: 'UNAVAILABLE', retryable: false });
      },
    };
    const agent: Agent = {
      async execute(portRun, portContext, signal) {
        expect(portRun).toBe(run);
        expect(portContext).toBe(context);
        expect(signal.aborted).toBe(false);
        await runState.emitEvent(portRun, portContext, { type: 'LLM_CONTENT_DELTA', inlinePayload: { chunk: 'ok' } });
        await runState.appendMessage(portRun, portContext, {
          role: 'ASSISTANT',
          content: 'ok',
          contentType: 'PLAIN_TEXT',
          visible: false,
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-contract-message-draft'),
        });
        await runState.saveCheckpoint(portRun, portContext, 'CAPABILITY_BEFORE_CALL');
        return { status: 'COMPLETED' };
      },
    };

    await agent.execute(run, context, new AbortController().signal);
    await runState.setCapabilityTerminalAnswer(run, context, { content: 'workflow completed' });

    expect(agent.execute.length).toBe(3);
    expect(runState.appendMessage.length).toBe(3);
    expect(runState.emitEvent.length).toBe(3);
    expect(runState.setCapabilityTerminalAnswer.length).toBe(3);
    expect(runState.saveCheckpoint.length).toBe(3);
    expect(runState.requestPendingInput.length).toBe(3);
    expect(emitted).toHaveLength(1);
    expect(appended).toHaveLength(1);
    expect(checkpointReasons).toEqual(['CAPABILITY_BEFORE_CALL']);
    expect(capabilityTerminalAnswers).toEqual(['workflow completed']);
  });

  it('defines minimal pending input question, producer, and execution outcome contracts', async () => {
    const sessionId = brand<string, 'SessionId'>('session-pending-contract');
    const pendingInputId = brand<string, 'PendingInputId'>('pending-contract');
    const question: PendingInputQuestion = {
      prompt: 'Select a maintenance target',
      options: [
        {
          label: 'Existing site',
          value: 'existing_site',
          requiresTextInput: true,
          inputPlaceholder: 'Enter the site ID',
        },
        { label: 'New site', value: 'new_site' },
      ],
    };
    const pendingInput: PendingInputRequest = {
      id: pendingInputId,
      sessionId,
      kind: 'QUESTION',
      questions: [question],
      timeoutAt: brand<number, 'EpochMillis'>(10),
    };
    const answer: PendingInputAnswer = {
      sessionId,
      pendingInputId,
      answers: [['existing_site', 'site-001']],
    };
    const record: PendingInputRecord = {
      tenantId: brand<string, 'TenantId'>('tenant-pending-contract'),
      subjectId: brand<string, 'SubjectId'>('subject-pending-contract'),
      agentId: brand<string, 'AgentId'>('agent-pending-contract'),
      pendingInputId,
      requestRunId: brand<string, 'RequestRunId'>('run-pending-contract'),
      sessionId,
      requestId: brand<string, 'MessageId'>('request-pending-contract'),
      requestContextId: brand<string, 'RequestContextId'>('context-pending-contract'),
      checkpointId: brand<string, 'CheckpointId'>('checkpoint-pending-contract'),
      kind: 'QUESTION',
      request: pendingInput,
      producerRef: {
        kind: 'CAPABILITY_INVOCATION',
        capabilityId: brand<string, 'CapabilityId'>('capability-pending-contract'),
        toolCallId: brand<string, 'ToolCallId'>('tool-call-pending-contract'),
      },
      status: 'PENDING',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    };
    let resolveOptions: ResolvePendingInputRecordOptions | undefined;
    const store: PendingInputStoreGateway = {
      async createPendingInput() {
        return record;
      },
      async loadPendingInput() {
        return record;
      },
      async loadActivePendingInput() {
        return record;
      },
      async listUnresolvedPendingInputTimeoutFacts(_request: AgentListUnresolvedPendingInputTimeoutFactsRequest) {
        return [record];
      },
      async resolvePendingInput(_request, options) {
        resolveOptions = options;
        return { status: 'UPDATED', record };
      },
    };
    const outcome: AgentExecutionOutcome = { status: 'PENDING_INPUT', pendingInput };

    expect(question.options[0]).toEqual({
      label: 'Existing site',
      value: 'existing_site',
      requiresTextInput: true,
      inputPlaceholder: 'Enter the site ID',
    });
    expect(answer.answers).toEqual([['existing_site', 'site-001']]);
    expect(Object.hasOwn(answer, 'identityContext')).toBe(false);
    expect(Object.hasOwn(answer, 'idempotencyKey')).toBe(false);
    expect(Object.hasOwn(answer, 'multiple')).toBe(false);
    expect(record.producerRef.kind).toBe('CAPABILITY_INVOCATION');
    expect(JSON.stringify(record.producerRef)).not.toContain('tenant');
    expect(JSON.stringify(record.producerRef)).not.toContain('idempotency');
    expect(JSON.stringify(outcome)).not.toContain('producerRef');
    expect(JSON.stringify(outcome)).not.toContain('toolCallId');
    await expect(
      store.loadActivePendingInput({
        tenantId: record.tenantId,
        subjectId: record.subjectId,
        agentId: record.agentId,
        sessionId,
      }),
    ).resolves.toBe(record);
    await expect(
      store.listUnresolvedPendingInputTimeoutFacts({
        agentId: record.agentId,
        limit: 100,
        after: {
          timeoutAt: brand<number, 'EpochMillis'>(0),
          pendingInputId: brand<string, 'PendingInputId'>('pending-before-contract'),
        },
      }),
    ).resolves.toEqual([record]);
    await store.resolvePendingInput(
      {
        tenantId: record.tenantId,
        subjectId: record.subjectId,
        agentId: record.agentId,
        pendingInputId,
        expectedStatus: 'PENDING',
        status: 'RECEIVED',
      },
      {
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-pending-contract'),
        idempotencySemantic: '["pending-input-resolve-v1"]',
      },
    );
    expect(resolveOptions?.idempotencySemantic).toBe('["pending-input-resolve-v1"]');
  });

  it('uses branded request ids for model invocation requests', () => {
    const requestId: MessageId = brand<string, 'MessageId'>('message-1');
    const invocation: ModelInvocationRequest = {
      invocationScope: {
        tenantId: brand<string, 'TenantId'>('tenant-model-contract'),
        subjectId: brand<string, 'SubjectId'>('subject-model-contract'),
        agentId: brand<string, 'AgentId'>('agent-model-contract'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'agent-model-contract@v1',
        operationId: 'step-1',
        sessionId: brand<string, 'SessionId'>('session-model-contract'),
        requestId,
        runId: brand<string, 'RequestRunId'>('run-model-contract'),
      },
      modelId: 'nextagent-test-model',
      messages: [],
      tools: [],
      timeoutMs: 1000,
    };

    expect(invocation.invocationScope.requestId).toBe(requestId);
    expect(invocation.invocationScope).toMatchObject({
      agentId: 'agent-model-contract',
      sessionId: 'session-model-contract',
      requestId,
      runId: 'run-model-contract',
    });
    expect(Object.hasOwn(invocation, 'ContextAssembly')).toBe(false);
    expect(Object.hasOwn(invocation, 'RenderedModelInput')).toBe(false);
  });

  it('keeps model invocation inputs provider-neutral and finish reasons closed', () => {
    const finishReason: ModelFinishReason = 'tool-calls';
    const messages: readonly ModelMessage[] = [{ role: 'USER', content: [{ type: 'text', text: 'inspect LTE KPI' }] }];
    const tools: readonly ModelToolDescriptor[] = [{ capabilityId: 'alarm-query', name: 'alarm-query', inputSchema: { type: 'object' } }];
    const providerOptions: NonNullable<ModelInferenceOptions['providerOptions']> = { parallelToolCalls: false };
    // @ts-expect-error Raw provider finish reasons are not public contract values.
    const rawFinishReason: ModelFinishReason = 'function_call';

    expect({ finishReason, messages, tools, providerOptions }).not.toHaveProperty('aiSdk');
    expect(rawFinishReason).toBe('function_call');
  });
});

describe('gateway, recovery, and no-op boundary contracts', () => {
  it('distinguishes CAS result branches and terminal commit branches', () => {
    const cas: VersionedUpdateResult = { status: 'VERSION_CONFLICT' };
    const terminal: TerminalCommitRecordResult = { status: 'ALREADY_COMMITTED' };

    expect(cas.status).toBe('VERSION_CONFLICT');
    expect(terminal.status).toBe('ALREADY_COMMITTED');
  });

  it('keeps gateway port signatures aligned with the design contract', () => {
    const requestRunStore: RequestRunStoreGateway = {
      async saveRun(record) {
        return { status: 'UPDATED', record };
      },
      async loadRun() {
        return undefined;
      },
      async listRuns(request) {
        return { items: [], offset: request.offset, limit: request.limit, hasMore: false };
      },
      async loadSessionLaneSnapshot(request) {
        return { ...request, queuedRuns: [] };
      },
      async loadRunByIdempotencyKey() {
        return { status: 'NOT_FOUND' };
      },
      async claimRun() {
        return { status: 'VERSION_CONFLICT' };
      },
      async listRecoverableRuns() {
        return [];
      },
      async commitTerminal() {
        return { status: 'COMMITTED' };
      },
    };
    const attachmentStore: AttachmentStoreGateway = {
      async saveAttachment(record) {
        return record;
      },
      async loadAttachment() {
        return undefined;
      },
      async listAttachmentsByRequestId() {
        return [];
      },
      async listAttachmentsByRunId() {
        return [];
      },
      async listAttachmentsBySession() {
        return [];
      },
      async updateAttachmentStatus() {
        return undefined;
      },
    };
    const blobStore: BlobStoreGateway = {
      async storeBlob() {
        return brand<string, 'BlobRef'>('blob-1');
      },
      async loadBlob() {
        return undefined;
      },
      async materializeBlob() {
        return false;
      },
      async blobExists() {
        return false;
      },
      async deleteBlob() {
        return true;
      },
      async copyBlob() {
        return { blobRef: 'copy-blob' as never, etag: 'copy-etag', lastModified: 0 as never };
      },
      async getBlobMetadata() {
        return undefined;
      },
      async listBlobs() {
        return { blobs: [], truncated: false };
      },
    };

    expect(requestRunStore.commitTerminal).toBeTypeOf('function');
    expect(attachmentStore.listAttachmentsByRequestId).toBeTypeOf('function');
    expect(blobStore.blobExists).toBeTypeOf('function');
  });

  it('defines minimal scheduled maintenance gateway contracts', async () => {
    const job: ScheduledMaintenanceJob = {
      jobId: 'capability-cleanup',
      cadenceMs: 1000,
      retentionMs: 10_000,
      overlapPolicy: 'SKIP',
      async run(signal, now) {
        expect(signal.aborted).toBe(false);
        expect(now).toBeInstanceOf(Date);
        return { status: 'COMPLETED', cleanedCount: 1 };
      },
    };
    const registered: ScheduledMaintenanceJob[] = [];
    const gateway: ScheduledMaintenanceGatewayPort = {
      register(nextJob) {
        registered.push(nextJob);
      },
      start() {},
      async stop() {},
      async runOnce(jobId, signal = new AbortController().signal, now = new Date(1)) {
        const selected = registered.find((item) => item.jobId === jobId);
        return selected === undefined ? { status: 'FAILED', safeReasonCode: 'SCHEDULED_JOB_NOT_FOUND' } : selected.run(signal, now);
      },
    };

    gateway.register(job);

    expect(registered[0]).toMatchObject({
      jobId: 'capability-cleanup',
      cadenceMs: 1000,
      retentionMs: 10_000,
      overlapPolicy: 'SKIP',
    });
    await expect(gateway.runOnce('capability-cleanup')).resolves.toEqual({ status: 'COMPLETED', cleanedCount: 1 });
  });

  it('uses branded durable ids in gateway public contracts', () => {
    const sessionId: SessionId = brand<string, 'SessionId'>('session-1');
    const artifactId: ArtifactId = brand<string, 'ArtifactId'>('artifact-1');
    const requestId: MessageId = brand<string, 'MessageId'>('message-1');
    const now: EpochMillis = brand<number, 'EpochMillis'>(1);
    const run: RequestRunRecord = {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      sessionId,
      requestId,
      agentId: brand<string, 'AgentId'>('agent-1'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent-1:v1',
      attempt: 1,
      status: 'EXECUTING',
      version: 1,
      terminalCommitState: 'NOT_STARTED',
      createdAt: now,
      updatedAt: now,
    };
    const artifact: ArtifactMetadataRecord = {
      tenantId: run.tenantId,
      subjectId: run.subjectId,
      artifactId,
      safeName: 'summary.md',
      mimeType: 'text/markdown',
      sizeBytes: 12,
      createdAt: now,
    };
    const favoriteQuery: ListFavoriteTurnsQuery = {
      tenantId: run.tenantId,
      subjectId: run.subjectId,
      agentId: run.agentId,
      limit: 10,
      offset: 0,
    };

    expect(run.sessionId).toBe(sessionId);
    expect(artifact.artifactId).toBe(artifactId);
    expect(favoriteQuery.agentId).toBe(run.agentId);
  });

  it('keeps user session domain contracts separate from Web DTOs and gateway records', async () => {
    const identity = createIdentityFixture();
    const agentId = brand<string, 'AgentId'>('default-agent');
    const sessionId = brand<string, 'SessionId'>('session-domain');
    const now = brand<number, 'EpochMillis'>(1);
    const session: UserSession = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      title: 'Network diagnosis',
      createdAt: now,
      updatedAt: now,
      hasInFlightRequest: false,
    };
    const page: UserSessionPage = { entries: [session], offset: 0, limit: 1, hasMore: false };
    const conversation: SessionMessagePage = { items: [], limit: 20, hasMore: false };
    const source = await readFile(join(process.cwd(), 'packages/agent-contracts/src/session/index.ts'), 'utf8');

    expect(page.entries[0]).toMatchObject({ tenantId: identity.tenantId, subjectId: identity.subjectId, agentId, sessionId });
    expect(conversation).not.toHaveProperty('nextCursor');
    expect(source).toContain('interface UserSessionPort');
    expect(source).not.toContain('interface SessionHistoryQuery');
    expect(source).not.toContain('interface SessionHistoryEntry');
    expect(source).not.toContain('interface SessionHistoryPage');
    expect(source).not.toContain('interface SessionConversationQuery');
    expect(source).not.toContain('interface CurrentRequestConversationQuery');
    expect(source).not.toContain('displayTitle');
    expect(source).not.toContain('lastActivityAt');
    expect(source).not.toContain('nextCursor');
    expect(source).not.toContain('Record');
  });

  it('requires gateway session, message, and active-context contracts to be owner and agent scoped', () => {
    const identity = createIdentityFixture();
    const agentId = brand<string, 'AgentId'>('default-agent');
    const sessionId = brand<string, 'SessionId'>('session-gateway');
    const requestId = brand<string, 'MessageId'>('request-gateway');
    const runId = brand<string, 'RequestRunId'>('run-gateway');
    const now = brand<number, 'EpochMillis'>(1);
    const session: SessionRecord = { tenantId: identity.tenantId, subjectId: identity.subjectId, agentId, sessionId, createdAt: now, updatedAt: now };
    const listQuery: SessionHistoryRecordQuery = { tenantId: identity.tenantId, subjectId: identity.subjectId, agentId, offset: 0, limit: 10 };
    const timelineQuery: RunTimelineEventRecordQuery = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(100),
      limit: 1000,
    };
    const conversationQuery: ListSessionMessagesRecordQuery = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      includeHidden: false,
      includeCapabilityResults: false,
      limit: 20,
    };
    const currentQuery: ListCurrentRequestMessagesRecordQuery = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId,
      includeHidden: false,
      offset: 0,
      limit: 20,
    };
    const message: SessionMessageRecord = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      messageId: requestId,
      sessionId,
      requestId,
      runId,
      role: 'USER',
      content: 'diagnose',
      contentType: 'PLAIN_TEXT',
      metadata: { source: 'contract' },
      visible: true,
      createdAt: now,
    };
    const attachment: RequestAttachmentRecord = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      attachmentId: brand<string, 'AttachmentId'>('attachment-gateway'),
      sessionId,
      requestId,
      runId,
      fileName: 'gateway.pdf',
      mediaType: 'PDF',
      sizeBytes: 12,
      validationStatus: 'ACCEPTED',
      availabilityStatus: 'AVAILABLE',
      storageRef: brand<string, 'BlobRef'>('blob-gateway'),
      createdAt: now,
    };

    expect(session.agentId).toBe(agentId);
    expect(listQuery.agentId).toBe(agentId);
    expect(timelineQuery.limit).toBe(1000);
    expect(conversationQuery).not.toHaveProperty('cursor');
    expect(currentQuery.agentId).toBe(agentId);
    expect(message.agentId).toBe(agentId);
    expect(message.metadata).toEqual({ source: 'contract' });
    expect(attachment.agentId).toBe(agentId);
    expect(attachment.fileName).toBe('gateway.pdf');
  });

  it('keeps Cron gateway records owner-scoped and write metadata out of durable records', async () => {
    const identity = createIdentityFixture();
    const agentId = brand<string, 'AgentId'>('default-agent');
    const sessionId = brand<string, 'SessionId'>('session-cron-contract');
    const now = brand<number, 'EpochMillis'>(100);
    const task: CronTaskRecord = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      taskId: 'cron-task-contract',
      cron: '0 9 * * *',
      prompt: 'Check telecom alarms',
      recurring: true,
      status: 'ACTIVE',
      nextRunAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const trigger: CronTriggerRecord = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      taskId: task.taskId,
      triggerId: 'cron-trigger-contract',
      scheduledAt: now,
      status: 'CLAIMED',
      createdAt: now,
      updatedAt: now,
    };
    let observedWriteOptions: unknown;
    const gateway: CronTaskGatewayPort = {
      async createTask(record, options) {
        observedWriteOptions = options;
        return record;
      },
      async loadTask() {
        return task;
      },
      async loadTaskForAgent() {
        return task;
      },
      async listTasks() {
        return [task];
      },
      async listTasksForAgent() {
        return [task];
      },
      async countTasksForAgent() {
        return 1;
      },
      async countActiveTasksForAgent() {
        return 1;
      },
      async updateTask(record, options) {
        observedWriteOptions = options;
        return record;
      },
      async deleteTask(_request, options) {
        observedWriteOptions = options;
        return { ...task, status: 'DELETED' };
      },
      async listDueTasks() {
        return [task];
      },
      async listClaimedTriggers() {
        return [{ task, trigger }];
      },
      async loadTriggerDelivery() {
        return { task, trigger };
      },
      async loadTrigger() {
        return trigger;
      },
      async listTriggersForTask() {
        return [trigger];
      },
      async countTriggersForTask() {
        return 1;
      },
      async claimCronTrigger() {
        return { status: 'CLAIMED', task, trigger };
      },
      async bindCronTriggerRun(request) {
        return { status: 'BOUND', trigger: { ...trigger, status: 'ACCEPTED', requestRunId: request.requestRunId } };
      },
    };

    await gateway.createTask(task, {
      idempotencyKey: brand<string, 'IdempotencyKey'>('cron-task-idem'),
      expectedVersion: 1,
    });

    expect(task.tenantId).toBe(identity.tenantId);
    expect(task.subjectId).toBe(identity.subjectId);
    expect(task.agentId).toBe(agentId);
    expect(trigger.agentId).toBe(agentId);
    expect(trigger.sessionId).toBe(sessionId);
    expect(Object.hasOwn(task, 'idempotencyKey')).toBe(false);
    expect(Object.hasOwn(task, 'expectedVersion')).toBe(false);
    expect(Object.hasOwn(trigger, 'idempotencyKey')).toBe(false);
    expect(Object.hasOwn(trigger, 'expectedVersion')).toBe(false);
    expect(observedWriteOptions).toMatchObject({ idempotencyKey: 'cron-task-idem', expectedVersion: 1 });
  });

  it('anchors checkpoint recovery without full tool state or message refs', () => {
    const checkpoint: CheckpointPayload = {
      agentId: brand<string, 'AgentId'>('agent-1'),
      checkpointId: brand<string, 'CheckpointId'>('checkpoint-1'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('message-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      requestContextId: brand<string, 'RequestContextId'>('context-1'),
      runVersion: 3,
      agentTurnIndex: 0,
      triggerReason: 'CAPABILITY_BEFORE_CALL',
      lastSequence: brand<number, 'TimelineSequence'>(10),
      activeContextVersion: 2,
      flowVariables: {},
      savedAt: brand<number, 'EpochMillis'>(100),
      idempotencyKey: brand<string, 'IdempotencyKey'>('checkpoint-idem'),
    };

    expect(checkpoint.runVersion).toBe(3);
    expect(Object.hasOwn(checkpoint, 'toolCallStates')).toBe(false);
    expect(Object.hasOwn(checkpoint, 'messageRefs')).toBe(false);
  });

  it('derives a stable capability invocation key from the run and tool invocation identity', () => {
    const runId = brand<string, 'RequestRunId'>('run-capability-key');
    const first = deriveCapabilityInvocationIdempotencyKey(runId, 'tool-call-1');
    const second = deriveCapabilityInvocationIdempotencyKey(runId, 'tool-call-1');
    const differentTool = deriveCapabilityInvocationIdempotencyKey(runId, 'tool-call-2');

    expect(first).toBe(second);
    expect(first).toBe('run-capability-key:tool-call-1');
    expect(differentTool).not.toBe(first);
  });

  it('keeps app contracts from becoming a raw configuration bus', async () => {
    const profile: ModelProfile = {
      modelId: 'MiniMax-M2.7',
      timeoutMs: 30_000,
      contextWindowTokens: 128_000,
      fallbackEligible: false,
    };
    const source = await readFile(join(process.cwd(), 'packages/agent-contracts/src/app/index.ts'), 'utf8');

    expect(profile).not.toHaveProperty('credentialRef');
    expect(source).not.toContain('interface SystemConfig');
    expect(source).not.toContain('RuntimePathsConfig');
    expect(source).not.toContain('ChannelConfig');
    expect(source).not.toContain('GatewayAdapterConfig');
    expect(source).not.toContain('CapabilityProviderConfig');
    expect(source).not.toContain('ResourceInventory');
    expect(source).not.toContain('AgentAssemblyCompiler');
    expect(source).not.toContain('AgentDefinition');
  });
});

describe('safe data boundaries', () => {
  it('keeps raw sensitive fields out of safe errors, stream payloads, audit summaries, and redaction policy gaps', async () => {
    const safe = createSafeErrorFixture();
    const stream = createStreamEnvelopeFixture();
    const auditEvent = {
      auditId: 'audit-secret-boundary',
      eventName: 'secret.validation.failed',
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      safeSummary: 'Credential reference is unavailable.',
      attributes: { issueCode: 'APP_CONFIG_SECRET_REF_UNAVAILABLE', referenceKind: 'file' },
      occurredAt: brand<number, 'EpochMillis'>(1),
    };
    const redactionPolicy = await readFile(join(process.cwd(), 'packages', 'agent-observability', 'src', 'logging', 'redaction.ts'), 'utf8');
    const serialized = JSON.stringify({ safe, stream, auditEvent, redactionPolicy });

    expect(redactionPolicy).toContain('credential');
    expect(redactionPolicy).toContain('token');
    expect(redactionPolicy).toContain('PROVIDER_RAW_BODY');
    expect(serialized).not.toContain('raw-secret');
    expect(serialized).not.toContain('env:OPENAI_API_KEY');
    expect(serialized).not.toContain('file:C:');
    expect(serialized).not.toContain('C:\\\\');
    expect(serialized).not.toContain('raw tool input');
  });
});

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of items) {
    collected.push(item);
  }
  return collected;
}
