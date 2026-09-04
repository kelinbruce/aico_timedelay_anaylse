import { admitToolCalls, executeToolCallsInOrder } from '@nextagent/agent-core';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CapabilityCatalog,
  CapabilityDescriptor,
  CapabilityInvocationPort,
  CapabilityInvocationResult,
} from '@nextagent/agent-contracts/capability';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import type { SessionMessageDraft } from '@nextagent/agent-contracts/session';
import { describe, expect, it, vi } from 'vitest';

describe('tool call prefix admission', () => {
  it.each([
    { requested: 29, limit: 30, admitted: 29 },
    { requested: 30, limit: 30, admitted: 30 },
    { requested: 31, limit: 30, admitted: 30 },
    { requested: 100, limit: 100, admitted: 100 },
    { requested: 101, limit: 100, admitted: 100 },
  ])('admits $admitted of $requested calls when the limit is $limit', ({ requested, limit, admitted }) => {
    const admission = admitToolCalls(reads(requested), limit);

    expect(admission.admitted).toEqual(reads(admitted));
    expect(admission).toMatchObject({
      requestedCount: requested,
      admittedCount: admitted,
      omittedCount: requested - admitted,
    });
  });

  it('counts all tool calls uniformly and preserves the model output order', () => {
    const calls = [...reads(2), ...bashes(2)];

    expect(admitToolCalls(calls, 3).admitted.map((call) => call.toolCallId)).toEqual(['read-0', 'read-1', 'bash-0']);
  });

  it('executes only the admitted prefix supplied to the canonical executor', async () => {
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async () => successfulResult({ ok: true }));
    const admission = admitToolCalls(reads(31), 30);

    await executeToolCallsInOrder(deps({ invoke }), input({ toolCalls: admission.admitted }));

    expect(invoke).toHaveBeenCalledTimes(30);
  });
});

function reads(count: number): NonNullable<Parameters<typeof executeToolCallsInOrder>[1]['toolCalls']> {
  return Array.from({ length: count }, (_value, index) => ({
    toolCallId: `read-${index}`,
    toolName: 'Read',
    arguments: { file_path: `file-${index}.txt`, offset: 0, limit: 1 },
  }));
}

function bashes(count: number): NonNullable<Parameters<typeof executeToolCallsInOrder>[1]['toolCalls']> {
  return Array.from({ length: count }, (_value, index) => ({
    toolCallId: `bash-${index}`,
    toolName: 'Bash',
    arguments: { command: `echo ${index}` },
  }));
}

function deps(input: { readonly invoke: CapabilityInvocationPort['invoke'] }) {
  const assemblyValue = assembly();
  return {
    capabilityCatalog: catalog(),
    capabilityInvocation: { invoke: input.invoke },
    assemblyRegistry: {
      async active() {
        return assemblyValue;
      },
      async require() {
        return assemblyValue;
      },
    },
  };
}

function input(overrides: {
  readonly toolCalls: NonNullable<Parameters<typeof executeToolCallsInOrder>[1]['toolCalls']>;
}): Parameters<typeof executeToolCallsInOrder>[1] {
  return {
    run: run(),
    context: context(),
    runState: stubRunState(),
    signal: new AbortController().signal,
    round: 0,
    toolCalls: overrides.toolCalls,
    requestLocalState: { generatedMessages: [] },
  };
}

function catalog(): CapabilityCatalog {
  return {
    async listAvailable() {
      return [];
    },
    async resolve(request) {
      return descriptor(String(request.capabilityId));
    },
  };
}

function descriptor(name: string): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(name),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: name,
    description: name,
    availabilityStatus: 'AVAILABLE',
    replayPolicy: 'IDEMPOTENT',
  };
}

function successfulResult(payload: JsonObject): CapabilityInvocationResult {
  return {
    status: 'SUCCEEDED',
    structuredPayload: payload,
    generatedMessages: [],
    artifactRefs: [],
  };
}

function stubRunState(appendedMessages: SessionMessageDraft[] = [], events: RunTimelineEvent[] = []): AgentRunStatePort {
  return {
    async setCapabilityTerminalAnswer(): Promise<void> {},
    async emitEvent(_run, _context, event) {
      events.push(event);
    },
    async appendMessage(_run, _context, draft) {
      appendedMessages.push(draft);
      return brand<string, 'MessageId'>(`message-${appendedMessages.length}`);
    },
    async saveCheckpoint() {},
    async requestPendingInput() {
      throw new Error('requestPendingInput was not configured for this test.');
    },
  } as AgentRunStatePort;
}

function assembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
    description: 'Test agent',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelIds: ['test-model'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'NONE',
    runtimeSettings: { requestTimeoutMs: 30_000 },
  };
}

function run(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
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
}

function context(): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'tester',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
}
