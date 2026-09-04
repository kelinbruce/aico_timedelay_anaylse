import { executeToolCallsInOrder } from '@nextagent/agent-core';
import { AgentError, brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CapabilityCatalog,
  CapabilityDescriptor,
  CapabilityInvocationPort,
  CapabilityInvocationResult,
} from '@nextagent/agent-contracts/capability';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';

describe('capability public identity', () => {
  it.each([
    ['Read', { path: '/private/alarm.json', agentId: 'must-not-leak' }, undefined],
    ['Agent', { agentId: ' network-diagnostic-agent ', prompt: 'secret prompt' }, 'network-diagnostic-agent'],
    ['Skill', { name: ' network-diagnosis ', args: { secret: true } }, 'network-diagnosis'],
    ['Workflow', { recipeName: ' alarm-recovery ', inputText: 'secret workflow input' }, 'alarm-recovery'],
  ] as const)('reuses the resolved %s identity across started and successful completed', async (capabilityId, argumentsValue, targetCapabilityId) => {
    const events = await execute(capabilityId, argumentsValue, async () => succeeded());
    const lifecycle = events.filter(isCapabilityLifecycle).map((event) => event.inlinePayload);

    expect(lifecycle).toHaveLength(2);
    for (const payload of lifecycle) {
      expect(payload).toMatchObject({ capabilityKind: 'TOOL', capabilityId });
      if (targetCapabilityId === undefined) {
        expect(payload).not.toHaveProperty('targetCapabilityId');
      } else {
        expect(payload.targetCapabilityId).toBe(targetCapabilityId);
      }
      expect(payload).not.toHaveProperty('agentId');
      expect(payload).not.toHaveProperty('name');
      expect(payload).not.toHaveProperty('prompt');
      expect(payload).not.toHaveProperty('args');
      expect(payload).not.toHaveProperty('recipeName');
      expect(payload).not.toHaveProperty('inputText');
      expect(payload).not.toHaveProperty('arguments');
    }
    expect(events.find((event) => event.type === 'CAPABILITY_RESULT_DELTA')?.inlinePayload).not.toHaveProperty('capabilityKind');
    expect(events.find((event) => event.type === 'CAPABILITY_RESULT_DELTA')?.inlinePayload).not.toHaveProperty('targetCapabilityId');
  });

  it.each([
    ['FAILED', failed('CAPABILITY_FAILED')],
    ['TIMED_OUT', timedOut()],
  ] as const)('keeps wrapper identity for the %s terminal result', async (_scenario, result) => {
    const events = await execute('Agent', { agentId: 'network-agent', prompt: 'secret' }, async () => result);
    expect(events.filter(isCapabilityLifecycle).map((event) => pickIdentity(event.inlinePayload))).toEqual([
      { capabilityKind: 'TOOL', capabilityId: 'Agent', targetCapabilityId: 'network-agent' },
      { capabilityKind: 'TOOL', capabilityId: 'Agent', targetCapabilityId: 'network-agent' },
    ]);
  });

  it('keeps wrapper identity when invocation throws', async () => {
    const events: RunTimelineEvent[] = [];
    const failure = new AgentError({ code: 'CANCELED', message: 'Canceled.', category: 'CANCELED', retryable: false });

    await expect(execute('Skill', { name: 'network-skill' }, async () => Promise.reject(failure), events)).rejects.toBe(failure);

    expect(events.filter(isCapabilityLifecycle).map((event) => pickIdentity(event.inlinePayload))).toEqual([
      { capabilityKind: 'TOOL', capabilityId: 'Skill', targetCapabilityId: 'network-skill' },
      { capabilityKind: 'TOOL', capabilityId: 'Skill', targetCapabilityId: 'network-skill' },
    ]);
  });

  it('keeps wrapper identity when result validation fails', async () => {
    const events: RunTimelineEvent[] = [];

    await execute('Skill', { name: 'network-skill' }, async () => ({ ...succeeded(), structuredPayload: [] as never }), events);

    expect(events.filter(isCapabilityLifecycle).map((event) => pickIdentity(event.inlinePayload))).toEqual([
      { capabilityKind: 'TOOL', capabilityId: 'Skill', targetCapabilityId: 'network-skill' },
      { capabilityKind: 'TOOL', capabilityId: 'Skill', targetCapabilityId: 'network-skill' },
    ]);
    expect(events.find((event) => event.type === 'CAPABILITY_COMPLETED')?.inlinePayload).toMatchObject({
      status: 'FAILED',
      safeErrorCode: 'CAPABILITY_RESULT_INVALID',
    });
  });

  it('keeps the safe entry kind when started payload falls back', async () => {
    const events = await execute('Read', {}, async () => succeeded(), [], catalog(), 'call-'.padEnd(300, 'x'));

    expect(events.find((event) => event.type === 'CAPABILITY_STARTED')?.inlinePayload).toMatchObject({
      capabilityKind: 'TOOL',
      capabilityId: 'Read',
      projectionUnavailable: 'CAPABILITY_PROJECTION_INVALID',
    });
  });

  it.each(['', '   ', 'x'.repeat(129), 'network\u0000agent'])('omits an invalid wrapper target without changing entry identity', async (agentId) => {
    const events = await execute('Agent', { agentId }, async () => succeeded());
    for (const event of events.filter(isCapabilityLifecycle)) {
      expect(event.inlinePayload).toMatchObject({ capabilityKind: 'TOOL', capabilityId: 'Agent' });
      expect(event.inlinePayload).not.toHaveProperty('targetCapabilityId');
    }
  });

  it('publishes only the safe entry identity on a completion-only preflight rejection', async () => {
    const events: RunTimelineEvent[] = [];
    const askCatalog: CapabilityCatalog = {
      async listAvailable() {
        return [];
      },
      async resolve() {
        return askUserQuestionDescriptor();
      },
    };

    await execute('AskUserQuestion', { questions: [{ prompt: 'Which site?', header: 'Site' }] }, async () => succeeded(), events, askCatalog);

    expect(events.filter(isCapabilityLifecycle)).toHaveLength(1);
    expect(events.find(isCapabilityLifecycle)?.inlinePayload).toMatchObject({
      capabilityKind: 'TOOL',
      capabilityId: 'AskUserQuestion',
      toolCallId: 'call-1',
      status: 'FAILED',
      safeErrorCode: 'CAPABILITY_INPUT_INVALID',
    });
    expect(events.find(isCapabilityLifecycle)?.inlinePayload).not.toHaveProperty('targetCapabilityId');
  });
});

async function execute(
  capabilityId: string,
  argumentsValue: JsonObject,
  invoke: CapabilityInvocationPort['invoke'],
  events: RunTimelineEvent[] = [],
  capabilityCatalog: CapabilityCatalog = catalog(),
  toolCallId = 'call-1',
): Promise<RunTimelineEvent[]> {
  const assemblyValue = assembly();
  await executeToolCallsInOrder(
    {
      capabilityCatalog,
      capabilityInvocation: { invoke },
      assemblyRegistry: {
        async active() {
          return assemblyValue;
        },
        async require() {
          return assemblyValue;
        },
      },
    },
    {
      run: run(),
      context: context(),
      runState: runState(events),
      signal: new AbortController().signal,
      round: 0,
      toolCalls: [{ toolCallId, toolName: capabilityId, arguments: argumentsValue }],
      requestLocalState: { generatedMessages: [] },
    },
  );
  return events;
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

function descriptor(capabilityId: string): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: capabilityId,
    description: capabilityId,
    availabilityStatus: 'AVAILABLE',
    replayPolicy: 'IDEMPOTENT',
  };
}

function askUserQuestionDescriptor(): CapabilityDescriptor {
  return {
    ...descriptor('AskUserQuestion'),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['prompt'],
            properties: {
              prompt: { type: 'string', minLength: 1, maxLength: 500 },
              options: { type: 'array' },
              multiple: { type: 'boolean' },
              custom: { type: 'boolean' },
            },
          },
        },
      },
    },
  };
}

function succeeded(): CapabilityInvocationResult {
  return { status: 'SUCCEEDED', structuredPayload: { ok: true }, generatedMessages: [], artifactRefs: [] };
}

function failed(code: string): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: { code, message: 'Failed safely.', category: 'UNAVAILABLE', retryable: false },
  };
}

function timedOut(): CapabilityInvocationResult {
  return {
    ...failed('CAPABILITY_TIMEOUT'),
    status: 'TIMED_OUT',
    safeError: { code: 'CAPABILITY_TIMEOUT', message: 'Timed out.', category: 'TIMEOUT', retryable: false },
  };
}

function runState(events: RunTimelineEvent[]): AgentRunStatePort {
  let messageOrdinal = 0;
  return {
    async setCapabilityTerminalAnswer(): Promise<void> {},
    async emitEvent(_run, _context, event) {
      events.push(event);
    },
    async appendMessage() {
      messageOrdinal += 1;
      return brand<string, 'MessageId'>(`message-${messageOrdinal}`);
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

function isCapabilityLifecycle(event: RunTimelineEvent): boolean {
  return event.type === 'CAPABILITY_STARTED' || event.type === 'CAPABILITY_COMPLETED';
}

function pickIdentity(payload: JsonObject): JsonObject {
  return {
    capabilityKind: payload.capabilityKind as never,
    capabilityId: payload.capabilityId as never,
    targetCapabilityId: payload.targetCapabilityId as never,
  };
}
