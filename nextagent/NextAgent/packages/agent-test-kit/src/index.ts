import { AgentError, brand, type AgentId, type AgentVersion, type IdentityContext, type JsonObject, type SafeError } from '@nextagent/agent-common';
import type { StreamEnvelope } from '@nextagent/agent-contracts/channel';
import type { CapabilityInvocationRequest, CapabilityInvocationResult, ToolDependencies } from '@nextagent/agent-contracts/capability';
import type { HookInput, HookResult, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import type { AgentRoutingPolicyExecutable, AgentRoutingPolicyResult, NextAgentPlugin } from '@nextagent/agent-plugin-sdk';
import type {
  ForkSessionResult,
  RequestRunRecord,
  SessionForkStoreGateway,
  SessionMessageRecord,
  SessionRecord,
} from '@nextagent/agent-contracts/gateway';

export function createIdentityFixture(): IdentityContext {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    displayName: 'Test User',
  };
}

export function createSafeErrorFixture(): SafeError {
  return {
    code: 'TEST_SAFE_ERROR',
    message: 'A safe test error.',
    category: 'VALIDATION',
    retryable: false,
  };
}

export function createAgentErrorFixture(): AgentError {
  return new AgentError({
    code: 'TEST_AGENT_ERROR',
    message: 'Internal test error.',
    category: 'INTERNAL',
    retryable: false,
  });
}

export function createStreamEnvelopeFixture(): StreamEnvelope {
  return {
    eventId: 'event-1',
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('message-1'),
    sequence: brand<number, 'TimelineSequence'>(1),
    eventType: 'REQUEST_ACCEPTED',
    transportHints: [],
    payload: {},
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

export function classifyArchitectureImport(importPath: string): 'public' | 'private' | 'external' {
  if (importPath.startsWith('@nextagent/')) {
    return 'public';
  }
  if (importPath.includes('../') && importPath.includes('/src/')) {
    return 'private';
  }
  return 'external';
}

export interface PluginTestHarnessOptions {
  readonly toolDependencies?: ToolDependencies;
  readonly defaultAgentScope?: {
    readonly agentId: AgentId;
    readonly agentVersion: AgentVersion;
    readonly agentAssemblyRef: string;
  };
}

export interface PluginTestHarness {
  invokeTool: (providerId: string, capabilityId: string, input: JsonObject) => Promise<CapabilityInvocationResult>;
  evaluateAgentRoutingPolicy: (policyId: string, run: RequestRun, context: RequestContext) => Promise<AgentRoutingPolicyResult>;
  executeHook: (hookId: string, input: HookInput) => Promise<HookResult>;
}

export function createPluginTestHarness(plugin: NextAgentPlugin, options: PluginTestHarnessOptions = {}): PluginTestHarness {
  const scope = options.defaultAgentScope ?? {
    agentId: brand<string, 'AgentId'>('test-agent'),
    agentVersion: brand<string, 'AgentVersion'>('1.0.0'),
    agentAssemblyRef: 'test-agent@1.0.0',
  };
  return {
    async invokeTool(providerId, capabilityId, input) {
      const provider = (plugin.providers ?? []).find((candidate) => candidate.identity.providerId === providerId);
      if (provider === undefined || provider.executor === undefined) {
        throw new AgentError({
          code: 'PLUGIN_PROVIDER_UNAVAILABLE',
          message: 'Plugin provider is unavailable.',
          category: 'NOT_FOUND',
          retryable: false,
        });
      }
      const descriptor =
        (await provider.discovery.resolve?.(brand<string, 'CapabilityId'>(capabilityId), AbortSignal.timeout(30_000))) ??
        (await provider.discovery.listAll?.(AbortSignal.timeout(30_000)))?.find((candidate) => candidate.capabilityId === capabilityId);
      if (descriptor === undefined) {
        throw new AgentError({ code: 'PLUGIN_TOOL_UNAVAILABLE', message: 'Plugin Tool is unavailable.', category: 'NOT_FOUND', retryable: false });
      }
      const missingDependency = missingRequiredToolDependency(descriptor.metadata, options.toolDependencies);
      if (missingDependency !== undefined) {
        throw new AgentError({
          code: 'PLUGIN_TOOL_DEPENDENCY_MISSING',
          message: 'Plugin Tool dependency is unavailable.',
          category: 'UNAVAILABLE',
          retryable: false,
          safeDetails: { dependency: missingDependency },
        });
      }
      return provider.executor.invoke(descriptor, invocationRequest(scope, capabilityId, input), AbortSignal.timeout(30_000), {
        toolDependencies: options.toolDependencies,
      } as never);
    },
    async evaluateAgentRoutingPolicy(policyId, run, context) {
      const policy = (plugin.policies ?? []).find((candidate) => candidate.policyId === policyId && candidate.policyPointId === 'agentRoutingPolicy');
      const executable = asAgentRoutingPolicyExecutable(policy);
      if (policy === undefined || executable === undefined) {
        throw new AgentError({
          code: 'PLUGIN_POLICY_UNAVAILABLE',
          message: 'Plugin routing policy is unavailable.',
          category: 'NOT_FOUND',
          retryable: false,
        });
      }
      return executable.decide(run, context, AbortSignal.timeout(policy.timeoutMs ?? 30_000));
    },
    async executeHook(hookId, input) {
      const hook = (plugin.hooks ?? []).find((candidate) => candidate.hookId === hookId);
      if (hook === undefined) {
        throw new AgentError({
          code: 'PLUGIN_HOOK_UNAVAILABLE',
          message: 'Plugin lifecycle hook is unavailable.',
          category: 'NOT_FOUND',
          retryable: false,
        });
      }
      return hook.execute(input, AbortSignal.timeout(30_000));
    },
  };
}

export interface SessionForkConformanceSourceFixture {
  readonly sourceSession: SessionRecord;
  readonly messages: readonly SessionMessageRecord[];
  readonly requestRuns?: readonly RequestRunRecord[];
  readonly promotionContents?: Readonly<Record<string, { readonly bytes: Uint8Array; readonly mimeType: string }>>;
}

export interface SessionForkConformanceChildFacts {
  readonly session: SessionRecord;
  readonly messages: readonly SessionMessageRecord[];
  readonly activeContextMessageIds: readonly string[];
}

export interface SessionForkProviderConformanceDriver {
  readonly reset: () => Promise<void>;
  readonly seedSource: (fixture: SessionForkConformanceSourceFixture) => Promise<void>;
  readonly sessionForks: SessionForkStoreGateway;
  readonly readChild: (childSessionId: string) => Promise<SessionForkConformanceChildFacts>;
}

export interface SessionForkProviderConformanceReport {
  readonly suiteId: 'session-fork-provider-conformance.v1';
  readonly passedCases: readonly string[];
}

export async function runSessionForkProviderConformance(driver: SessionForkProviderConformanceDriver): Promise<SessionForkProviderConformanceReport> {
  const tenantId = brand<string, 'TenantId'>('fork-conformance-tenant');
  const subjectId = brand<string, 'SubjectId'>('fork-conformance-subject');
  const agentId = brand<string, 'AgentId'>('fork-conformance-agent');
  const sourceSessionId = brand<string, 'SessionId'>('fork-conformance-source');
  const requestId = brand<string, 'MessageId'>('fork-conformance-request');
  const anchorId = brand<string, 'MessageId'>('fork-conformance-anchor');
  const now = brand<number, 'EpochMillis'>(1);
  const sourceSession: SessionRecord = {
    tenantId,
    subjectId,
    agentId,
    sessionId: sourceSessionId,
    title: 'Conformance source',
    createdAt: now,
    updatedAt: now,
  };
  const messages: readonly SessionMessageRecord[] = [
    {
      tenantId,
      subjectId,
      agentId,
      sessionId: sourceSessionId,
      messageId: requestId,
      requestId,
      role: 'USER',
      content: 'question',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: now,
    },
    {
      tenantId,
      subjectId,
      agentId,
      sessionId: sourceSessionId,
      messageId: anchorId,
      requestId,
      role: 'ASSISTANT',
      content: 'answer',
      contentType: 'PLAIN_TEXT',
      metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(2),
    },
  ];
  await driver.reset();
  await driver.seedSource({ sourceSession, messages });
  const messageCoordinates = {
    tenantId,
    subjectId,
    agentId,
    sourceSessionId,
    sourceMessageId: anchorId,
    idempotencyKey: brand<string, 'IdempotencyKey'>('fork-conformance-key'),
  } as const;
  const prepared = await driver.sessionForks.prepareFork(messageCoordinates);
  assertConformance(prepared.requiredContentRefs.length === 0, 'empty-ref prepare must return no required refs');
  assertConformance(prepared.maxPromotedBytes >= 0, 'prepare must return a non-negative promotion byte budget');
  const created = await driver.sessionForks.forkSession({ ...messageCoordinates, forkAttemptId: prepared.forkAttemptId });
  assertConformance(created.replayed === false, 'first fork must not be a replay');
  const child = await driver.readChild(created.childSession.sessionId);
  assertConformance(child.messages.map((item) => item.content).join('\0') === 'question\0answer', 'child must contain the complete source prefix');
  assertConformance(
    child.messages.every((item) => item.metadata['forkInherited'] === true),
    'copied messages must be marked inherited',
  );
  assertConformance(
    child.activeContextMessageIds.every((id) => child.messages.some((item) => item.messageId === id)),
    'active context refs must resolve',
  );

  const replayPrepare = await driver.sessionForks.prepareFork(messageCoordinates);
  assertConformance(replayPrepare.requiredContentRefs.length === 0, 'successful replay prepare must not require restaging');
  const replay = await driver.sessionForks.forkSession({ ...messageCoordinates, forkAttemptId: replayPrepare.forkAttemptId });
  assertSameForkResult(created, replay);

  const requestCoordinates = {
    tenantId,
    subjectId,
    agentId,
    sourceSessionId,
    sourceRequestId: requestId,
    idempotencyKey: messageCoordinates.idempotencyKey,
  } as const;
  const requestPrepare = await driver.sessionForks.prepareFork(requestCoordinates);
  const requestReplay = await driver.sessionForks.forkSession({ ...requestCoordinates, forkAttemptId: requestPrepare.forkAttemptId });
  assertSameForkResult(created, requestReplay);

  const canceled = new AbortController();
  canceled.abort();
  let cancellationCode: string | undefined;
  try {
    await driver.sessionForks.prepareFork({ ...messageCoordinates, idempotencyKey: brand<string, 'IdempotencyKey'>('canceled') }, canceled.signal);
  } catch (error) {
    cancellationCode = error instanceof AgentError ? error.code : undefined;
  }
  assertConformance(cancellationCode === 'SESSION_FORK_CANCELED', 'pre-dispatch cancellation must use the canonical error');

  const promotionSessionId = brand<string, 'SessionId'>('fork-conformance-promotion-source');
  const promotionRequestId = brand<string, 'MessageId'>('fork-conformance-promotion-request');
  const promotionRunId = brand<string, 'RequestRunId'>('fork-conformance-promotion-run');
  const promotionAnchorId = brand<string, 'MessageId'>('fork-conformance-promotion-anchor');
  const promotionRefId = 'tool-results/conformance-result';
  const promotionBytes = new Uint8Array([1, 2, 3, 4]);
  await driver.seedSource({
    sourceSession: { ...sourceSession, sessionId: promotionSessionId, title: 'Promotion source' },
    requestRuns: [
      {
        tenantId,
        subjectId,
        agentId,
        sessionId: promotionSessionId,
        requestId: promotionRequestId,
        runId: promotionRunId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'fork-conformance-agent:v1',
        attempt: 1,
        status: 'COMPLETED',
        version: 1,
        terminalCommitState: 'COMMITTED',
        createdAt: now,
        updatedAt: brand<number, 'EpochMillis'>(2),
      },
    ],
    messages: [
      { ...messages[0]!, sessionId: promotionSessionId, messageId: promotionRequestId, requestId: promotionRequestId, runId: promotionRunId },
      {
        ...messages[1]!,
        sessionId: promotionSessionId,
        messageId: promotionAnchorId,
        requestId: promotionRequestId,
        runId: promotionRunId,
        content: `Result: workspace/${promotionRefId}`,
      },
    ],
    promotionContents: { [promotionRefId]: { bytes: promotionBytes, mimeType: 'text/plain' } },
  });
  const promotionCoordinates = {
    tenantId,
    subjectId,
    agentId,
    sourceSessionId: promotionSessionId,
    sourceMessageId: promotionAnchorId,
    idempotencyKey: brand<string, 'IdempotencyKey'>('fork-conformance-promotion-key'),
  } as const;
  const promotionPrepared = await driver.sessionForks.prepareFork(promotionCoordinates);
  assertConformance(promotionPrepared.requiredContentRefs.length === 1, 'prepare must discover the normalized tool-result ref');
  const requiredRef = promotionPrepared.requiredContentRefs[0]!;
  assertConformance(requiredRef.refId === promotionRefId, 'prepare must return the normalized source ref');
  const staged = await driver.sessionForks.stageForkPromotion({
    tenantId,
    subjectId,
    agentId,
    forkAttemptId: promotionPrepared.forkAttemptId,
    sourceSessionId: promotionSessionId,
    sourceMessageId: requiredRef.sourceMessageId,
    sourceRefId: requiredRef.refId,
    refType: requiredRef.refType,
    bytes: promotionBytes,
    mimeType: 'text/plain',
    sizeBytes: promotionBytes.byteLength,
  });
  const promotionCreated = await driver.sessionForks.forkSession({
    ...promotionCoordinates,
    forkAttemptId: promotionPrepared.forkAttemptId,
  });
  const promotionChild = await driver.readChild(promotionCreated.childSession.sessionId);
  const promotedMessage = promotionChild.messages.find((item) => item.content.includes(staged.promotedContentId));
  assertConformance(promotedMessage !== undefined, 'child content must use the committed promoted content id');
  assertConformance(!promotedMessage.content.includes(promotionRefId), 'child content must not retain the source tool-result ref');
  const committed = await driver.sessionForks.loadCommittedForkPromotionContent({
    tenantId,
    subjectId,
    agentId,
    childSessionId: promotionCreated.childSession.sessionId,
    childMessageId: promotedMessage.messageId,
    promotedContentId: staged.promotedContentId,
  });
  assertConformance(
    committed !== undefined && committed.bytes.every((byte, index) => byte === promotionBytes[index]),
    'committed promotion bytes must be child-readable',
  );

  let scopeFailureCode: string | undefined;
  try {
    await driver.sessionForks.prepareFork({
      ...messageCoordinates,
      subjectId: brand<string, 'SubjectId'>('another-subject'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('scope-failure'),
    });
  } catch (error) {
    scopeFailureCode = error instanceof AgentError ? error.code : undefined;
  }
  assertConformance(scopeFailureCode === 'SESSION_NOT_FOUND', 'cross-owner source lookup must fail without disclosing source facts');
  return {
    suiteId: 'session-fork-provider-conformance.v1',
    passedCases: [
      'message-anchor',
      'request-anchor',
      'complete-prefix',
      'active-context',
      'promotion',
      'scope-isolation',
      'idempotency-replay',
      'cancellation',
    ],
  };
}

function assertSameForkResult(created: ForkSessionResult, replay: ForkSessionResult): void {
  assertConformance(replay.replayed === true, 'repeated fork must report replayed=true');
  assertConformance(replay.childSession.sessionId === created.childSession.sessionId, 'repeated fork must return the first child');
}

function assertConformance(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new AgentError({
      code: 'SESSION_FORK_CONFORMANCE_FAILED',
      message,
      category: 'INTERNAL',
      retryable: false,
    });
  }
}

function missingRequiredToolDependency(metadata?: JsonObject, dependencies?: ToolDependencies): string | undefined {
  const required = metadata?.['requiredDependencies'];
  if (!Array.isArray(required)) {
    return undefined;
  }
  return required.find(
    (dependency): dependency is string =>
      typeof dependency === 'string' && (dependencies as Record<string, unknown> | undefined)?.[dependency] === undefined,
  );
}

function asAgentRoutingPolicyExecutable(policy: unknown): AgentRoutingPolicyExecutable | undefined {
  if (policy === null || typeof policy !== 'object' || typeof (policy as { readonly decide?: unknown }).decide !== 'function') {
    return undefined;
  }
  return policy as AgentRoutingPolicyExecutable;
}

function invocationRequest(
  scope: { readonly agentId: AgentId; readonly agentVersion: AgentVersion },
  capabilityId: string,
  input: JsonObject,
): CapabilityInvocationRequest {
  return {
    invocationId: 'test-invocation',
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    arguments: input,
    sessionId: brand<string, 'SessionId'>('test-session'),
    requestId: brand<string, 'MessageId'>('test-request'),
    runId: brand<string, 'RequestRunId'>('test-run'),
    requestContextId: brand<string, 'RequestContextId'>('test-context'),
    stepId: 'test-step',
    identityContext: createIdentityFixture(),
    agentId: scope.agentId,
    agentVersion: scope.agentVersion,
    timeoutMs: 30_000,
  };
}
