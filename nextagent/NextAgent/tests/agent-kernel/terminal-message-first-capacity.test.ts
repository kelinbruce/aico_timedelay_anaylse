import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { deliverWebStream } from '@nextagent/agent-channel-web';
import { AgentError, brand } from '@nextagent/agent-common';
import { createDefaultLargeContentExternalizer } from '@nextagent/agent-context-engine';
import type { TerminalCommitRequest, RequestRunStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { createExecutionWorkspaceResolver, createRequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { createDefaultAgentTestAssemblyRegistry } from '@nextagent/agent-platform-gateway-local/testing';
import { createUserSessionService } from '@nextagent/agent-session';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../fixtures/test-agent.js';

const identityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-terminal-capacity'),
  subjectId: brand<string, 'SubjectId'>('subject-terminal-capacity'),
  displayName: 'Terminal capacity tester',
};
const agentId = brand<string, 'AgentId'>('default-agent');
const longTerminalContent = '结果'.repeat(30_000);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('terminal Message-first provider capacity', () => {
  it.each(['WORKFLOW', 'APICALL'] as const)(
    'commits a long %s Capability result as one materialized terminal Message projection',
    async (executionKind) => {
      const harness = await createHarness(executionKind, 'MESSAGE_FIELD');

      const accepted = await harness.runtime.submit({
        sessionId: harness.sessionId,
        identityContext,
        inputText: `produce a long ${executionKind} answer`,
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`terminal-capacity-${executionKind}`),
      });
      await waitFor(async () => (await harness.loadRun(accepted.runId))?.terminalCommitState === 'COMMITTED');

      const events = await harness.gateway.timeline.listEvents({
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        sessionId: harness.sessionId,
        runId: accepted.runId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 1_000,
      });
      const terminalEvent = events.find((event) => event.type === 'REQUEST_COMPLETED');
      expect(terminalEvent).toBeDefined();
      expect(terminalEvent?.inlinePayload).not.toHaveProperty('content');
      expect(serializedBytes(terminalEvent?.inlinePayload)).toBeLessThanOrEqual(49_000);

      const messages = await harness.gateway.messages.listCurrentRequestMessages({
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        sessionId: harness.sessionId,
        requestId: accepted.requestId,
        runId: accepted.runId,
        includeHidden: false,
        offset: 0,
        limit: 10,
      });
      const terminalMessage = messages.items.find((message) => message.role === 'ASSISTANT');
      expect(terminalMessage?.content.length).toBeLessThanOrEqual(50_000);
      expect(terminalMessage?.content).toContain('File path: tool-results/');
      const replacement = terminalMessage?.metadata['replacement'] as
        { readonly contentRef?: { readonly refId?: string; readonly refType?: string } } | undefined;
      expect(replacement?.contentRef?.refType).toBe('CAPABILITY_RESULT');
      expect(replacement?.contentRef?.refId).toMatch(/^tool-results\/[a-f0-9]+\.txt$/u);
      const workspaceView = harness.executionWorkspaceResolver.resolve({
        runtimeWorkspaceRoot: harness.runtimeWorkspaceRoot,
        workspacePolicy: (await harness.assemblyRegistry.require(agentId, brand<string, 'AgentVersion'>('v1'))).workspacePolicy,
        agentId,
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        sessionId: harness.sessionId,
        runId: accepted.runId,
        deploymentMode: 'LOCAL',
      });
      const workspaceRoot = workspaceView.roots.find((root) => root.kind === 'workspace' && root.access === 'readWrite');
      expect(workspaceRoot).toBeDefined();
      expect(await readFile(join(workspaceRoot!.physicalPath, replacement!.contentRef!.refId!), 'utf8')).toBe(longTerminalContent);
      if (executionKind === 'APICALL') {
        const capabilityResultMessage = messages.items.find((message) => message.role === 'CAPABILITY_RESULT');
        expect(capabilityResultMessage?.content.length).toBeLessThanOrEqual(50_000);
        const capabilityReplacement = capabilityResultMessage?.metadata['replacement'] as
          { readonly contentRef?: { readonly refId?: string; readonly refType?: string } } | undefined;
        expect(capabilityReplacement?.contentRef?.refType).toBe('CAPABILITY_RESULT');
        expect(capabilityReplacement?.contentRef?.refId).toMatch(/^tool-results\/[a-f0-9]+\.txt$/u);
        expect(await readFile(join(workspaceRoot!.physicalPath, capabilityReplacement!.contentRef!.refId!), 'utf8')).toContain(longTerminalContent);
      }
      expect(harness.liveTerminals).toHaveLength(1);
      expect(harness.liveTerminals[0]?.inlinePayload.content).toBe(terminalMessage?.content);

      const replay = await collect(
        deliverWebStream({
          sessions: harness.runtime,
          identityContext,
          sessionId: harness.sessionId,
          requestId: accepted.requestId,
          runId: accepted.runId,
          lastSeenSequence: brand<number, 'TimelineSequence'>(0),
          timelineReadTimeoutMs: 1_000,
        }),
      );
      expect(replay.find((event) => event.eventType === 'REQUEST_COMPLETED')?.payload.content).toBe(terminalMessage?.content);

      const summary = await harness.runtime.getRequestSummary({
        identityContext,
        sessionId: harness.sessionId,
        requestId: accepted.requestId,
      });
      expect(summary?.terminalResult?.content).toBe(terminalMessage?.content);
      await waitFor(() => harness.postTerminalCallback.mock.calls.length === 1);
    },
  );

  it('runs the terminal Hook before Capability materialization', async () => {
    const hookContent = `hooked:${longTerminalContent}`;
    const harness = await createHarness('WORKFLOW', 'MESSAGE_FIELD', { terminalHookContent: hookContent });

    const accepted = await harness.runtime.submit({
      sessionId: harness.sessionId,
      identityContext,
      inputText: 'transform then materialize a Workflow answer',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('terminal-capacity-hook-order'),
    });
    await waitFor(async () => (await harness.loadRun(accepted.runId))?.terminalCommitState === 'COMMITTED');

    const messages = await harness.gateway.messages.listCurrentRequestMessages({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId: harness.sessionId,
      requestId: accepted.requestId,
      runId: accepted.runId,
      includeHidden: false,
      offset: 0,
      limit: 10,
    });
    const terminalMessage = messages.items.find((message) => message.role === 'ASSISTANT');
    const replacement = terminalMessage?.metadata['replacement'] as { readonly contentRef?: { readonly refId?: string } } | undefined;
    const workspaceView = harness.executionWorkspaceResolver.resolve({
      runtimeWorkspaceRoot: harness.runtimeWorkspaceRoot,
      workspacePolicy: (await harness.assemblyRegistry.require(agentId, brand<string, 'AgentVersion'>('v1'))).workspacePolicy,
      agentId,
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      sessionId: harness.sessionId,
      runId: accepted.runId,
      deploymentMode: 'LOCAL',
    });
    const workspaceRoot = workspaceView.roots.find((root) => root.kind === 'workspace' && root.access === 'readWrite');

    expect(terminalMessage?.content).toContain('File path: tool-results/');
    expect(await readFile(join(workspaceRoot!.physicalPath, replacement!.contentRef!.refId!), 'utf8')).toBe(hookContent);
  });

  it('fails raw oversized model content that bypasses Agent Core before a Message-limited provider', async () => {
    const harness = await createHarness('MODEL_LOOP', 'MESSAGE_FIELD');

    const accepted = await harness.runtime.submit({
      sessionId: harness.sessionId,
      identityContext,
      inputText: 'produce an oversized model answer',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('terminal-capacity-model-limit'),
    });
    await waitFor(async () => (await harness.loadRun(accepted.runId))?.terminalCommitState === 'COMMITTED');

    const run = await harness.loadRun(accepted.runId);
    const events = await harness.gateway.timeline.listEvents({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId: harness.sessionId,
      runId: accepted.runId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1_000,
    });
    const messages = await harness.gateway.messages.listCurrentRequestMessages({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId: harness.sessionId,
      requestId: accepted.requestId,
      runId: accepted.runId,
      includeHidden: true,
      offset: 0,
      limit: 10,
    });
    const terminalMessage = messages.items.find((message) => message.role === 'ASSISTANT');

    expect(run?.status).toBe('FAILED');
    expect(events.some((event) => event.type === 'REQUEST_FAILED')).toBe(true);
    expect(events.some((event) => event.type === 'REQUEST_COMPLETED')).toBe(false);
    expect(terminalMessage?.content).toBe('Request failed safely: TERMINAL_MESSAGE_LIMIT_EXCEEDED');
    expect(terminalMessage?.metadata).not.toHaveProperty('replacement');
    expect(harness.liveTerminals).toHaveLength(1);
    expect(harness.liveTerminals[0]?.type).toBe('REQUEST_FAILED');
  });

  it('fails an oversized whole composite without publishing or persisting a false terminal', async () => {
    const harness = await createHarness('MODEL_LOOP', 'REJECT_COMPOSITE');

    const accepted = await harness.runtime.submit({
      sessionId: harness.sessionId,
      identityContext,
      inputText: 'produce a long answer against a whole-request limit',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('terminal-capacity-whole-request'),
    });
    await waitFor(async () => (await harness.loadRun(accepted.runId))?.terminalCommitState === 'PENDING');
    await harness.runtime.waitForIdle({ timeoutMs: 5_000 });

    const events = await harness.gateway.timeline.listEvents({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId: harness.sessionId,
      runId: accepted.runId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1_000,
    });
    expect(events.some(isTerminalEvent)).toBe(false);
    expect(harness.liveTerminals).toEqual([]);
    expect(harness.postTerminalCallback).not.toHaveBeenCalled();

    const messages = await harness.gateway.messages.listCurrentRequestMessages({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId: harness.sessionId,
      requestId: accepted.requestId,
      runId: accepted.runId,
      includeHidden: true,
      offset: 0,
      limit: 10,
    });
    expect(messages.items.map((message) => message.role)).toEqual(['USER']);
    const summary = await harness.runtime.getRequestSummary({
      identityContext,
      sessionId: harness.sessionId,
      requestId: accepted.requestId,
    });
    expect(summary?.terminalResult).toBeUndefined();
  });
});

async function createHarness(
  executionKind: 'MODEL_LOOP' | 'WORKFLOW' | 'APICALL',
  providerLimit: 'MESSAGE_FIELD' | 'REJECT_COMPOSITE',
  options: { readonly terminalHookContent?: string } = {},
) {
  const terminalHookContent = options.terminalHookContent;
  const gateway = createTestGatewayStores();
  const runtimeWorkspaceRoot = await mkdtemp(join(tmpdir(), 'nextagent-terminal-capacity-'));
  temporaryRoots.push(runtimeWorkspaceRoot);
  const executionWorkspaceResolver = createExecutionWorkspaceResolver();
  const baseAssemblyRegistry = createDefaultAgentTestAssemblyRegistry('deterministic-test-model');
  const assemblyRegistry =
    terminalHookContent === undefined
      ? baseAssemblyRegistry
      : {
          active: async (requestedAgentId: Parameters<typeof baseAssemblyRegistry.active>[0]) => ({
            ...(await baseAssemblyRegistry.active(requestedAgentId)),
            hooks: [{ hookId: 'terminal-capacity-transform', enabled: true }],
          }),
          require: async (
            requestedAgentId: Parameters<typeof baseAssemblyRegistry.require>[0],
            requestedVersion: Parameters<typeof baseAssemblyRegistry.require>[1],
          ) => ({
            ...(await baseAssemblyRegistry.require(requestedAgentId, requestedVersion)),
            hooks: [{ hookId: 'terminal-capacity-transform', enabled: true }],
          }),
        };
  const sessionId = brand<string, 'SessionId'>(`session-terminal-capacity-${executionKind}-${providerLimit}`);
  await gateway.sessions.saveSession({
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    sessionId,
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  });
  const liveTerminals: RunTimelineEvent[] = [];
  const postTerminalCallback = vi.fn(async () => undefined);
  const requestRunStore = withProviderLimit(gateway.requestRuns, providerLimit);
  const runtime = createRequestLifecycleCoordinator({
    agentConstructors: [
      createTestAgentConstructor(async ({ runState }, run, context) => {
        if (executionKind === 'WORKFLOW') {
          await runState.emitEvent(run, context, {
            type: 'TOOL_STRUCTURED_DELTA',
            inlinePayload: {
              capabilityId: 'render-result',
              toolCallId: 'workflow:execution-1:render-result',
              toolEventType: 'DETAIL',
              toolMessageType: 'TEXT',
              content: 'bounded inner Workflow product',
              accumulated: true,
              workflowEventType: 'NODE_COMPLETED',
              nodeId: 'render-result',
              nodeType: 'DISPLAY',
              nodeExecutionId: 'node-execution-1',
              parentToolCallId: 'workflow:execution-1',
            },
          });
          await runState.setCapabilityTerminalAnswer(run, context, { content: longTerminalContent });
          return;
        }
        if (executionKind === 'APICALL') {
          await runState.appendMessage(run, context, {
            role: 'CAPABILITY_RESULT',
            content: JSON.stringify({ toolCallId: 'api-call-1', toolName: 'ApiCall', payload: { result: longTerminalContent } }),
            contentType: 'PLAIN_TEXT',
            visible: true,
            metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'api-call-1', toolName: 'ApiCall' },
            idempotencyKey: brand<string, 'IdempotencyKey'>(`${run.runId}:capability-result:api-call-1`),
          });
          await runState.setCapabilityTerminalAnswer(run, context, { content: longTerminalContent });
          return;
        }
        await runState.emitEvent(run, context, {
          type: 'LLM_CONTENT_DELTA',
          inlinePayload: { final: true, content: longTerminalContent },
        });
      }),
    ],
    agentRuntimeDependencies: {},
    assemblyRegistry,
    capabilityCatalog: createStaticCapabilityCatalog(),
    defaultRouteAgentId: agentId,
    userSessions: createUserSessionService({
      sessionStore: gateway.sessions,
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
    }),
    messageStore: gateway.messages,
    activeContextStore: gateway.activeContext,
    requestRunStore,
    largeContentExternalizer: createDefaultLargeContentExternalizer({
      runtimeWorkspaceRoot,
      deploymentMode: 'LOCAL',
      executionWorkspaceResolver,
      assemblyRegistry,
    }),
    ...(terminalHookContent === undefined
      ? {}
      : {
          lifecycleHook: {
            invoke: vi.fn(async (input) =>
              input.stage === 'BEFORE_AGENT_TERMINAL'
                ? { outcome: 'PASS' as const, mutation: { finalContent: terminalHookContent } }
                : { outcome: 'PASS' as const },
            ),
          },
          lifecycleHookDefinitions: [
            {
              hookId: 'terminal-capacity-transform',
              kind: 'CUSTOM' as const,
              supportedStages: ['BEFORE_AGENT_TERMINAL'] as const,
              effects: ['TRANSFORM'] as const,
              executionStrategy: 'SERIAL_IMPACT' as const,
              failureMode: 'FAIL' as const,
            },
          ],
        }),
    timelineStore: gateway.timeline,
    checkpointStore: gateway.checkpoints,
    postTerminalCallback,
    runTimelineEventListeners: [
      (event) => {
        if (isTerminalEvent(event)) {
          liveTerminals.push(event);
        }
      },
    ],
  });
  return {
    gateway,
    runtime,
    sessionId,
    liveTerminals,
    postTerminalCallback,
    runtimeWorkspaceRoot,
    executionWorkspaceResolver,
    assemblyRegistry,
    loadRun: (runId: Parameters<RequestRunStoreGateway['loadRun']>[0]['runId']) =>
      gateway.requestRuns.loadRun({
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        runId,
      }),
  };
}

function withProviderLimit(delegate: RequestRunStoreGateway, providerLimit: 'MESSAGE_FIELD' | 'REJECT_COMPOSITE'): RequestRunStoreGateway {
  return {
    saveRun: delegate.saveRun.bind(delegate),
    loadRun: delegate.loadRun.bind(delegate),
    listRuns: delegate.listRuns.bind(delegate),
    loadSessionLaneSnapshot: delegate.loadSessionLaneSnapshot.bind(delegate),
    loadRunByIdempotencyKey: delegate.loadRunByIdempotencyKey.bind(delegate),
    claimRun: delegate.claimRun.bind(delegate),
    listRecoverableRuns: delegate.listRecoverableRuns.bind(delegate),
    commitTerminal: async (request: TerminalCommitRequest) => {
      const rejected = providerLimit === 'MESSAGE_FIELD' ? request.terminalMessage.content.length > 50_000 : true;
      if (rejected) {
        throw new AgentError({
          code: providerLimit === 'MESSAGE_FIELD' ? 'REMOTE_MESSAGE_CONTENT_REJECTED' : 'REMOTE_COMPOSITE_REJECTED',
          message: 'Remote provider capacity rejected terminal commit.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      return delegate.commitTerminal(request);
    },
  };
}

function isTerminalEvent(event: Pick<RunTimelineEvent, 'type'>): boolean {
  return (
    event.type === 'REQUEST_COMPLETED' || event.type === 'REQUEST_FAILED' || event.type === 'REQUEST_CANCELED' || event.type === 'REQUEST_SUPERSEDED'
  );
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await assertion()).toBe(true);
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of items) {
    collected.push(item);
  }
  return collected;
}
