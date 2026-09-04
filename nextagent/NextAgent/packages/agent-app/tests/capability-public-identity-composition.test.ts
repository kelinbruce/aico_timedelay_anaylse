import { projectTimelineEventToStreamEnvelope } from '@nextagent/agent-channel-common';
import { executeToolCallsInOrder } from '@nextagent/agent-core';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';

describe('capability public identity composition', () => {
  it('projects Tool, wrappers, and direct Workflow nodes from tool loop through the Web channel', async () => {
    const timeline: RunTimelineEvent[] = [];
    const assemblyValue = assembly();
    const invoke: CapabilityInvocationPort['invoke'] = async (request, _signal, runtimeContext) => {
      if (request.capabilityId === 'Workflow') {
        const recipe = {
          recipeName: 'alarm-recovery',
          version: 'v1',
          displayName: 'Alarm recovery',
          flowGraph: {
            nodes: {
              diagnose: { type: 'SKILL', inputs: { skill_name: 'workflow-network-diagnosis' }, next: {} },
              recover: { type: 'SUBFLOW', inputs: { recipe_name: 'alarm-recovery-child' }, next: {} },
            },
          },
        };
        const startedAtEpochMs = Date.now();
        await runtimeContext?.emitResultDelta?.({
          structuredPayload: {
            workflowRecipe: recipe,
            workflowExecutionEvent: {
              executionId: 'workflow-execution-1',
              nodeId: 'diagnose',
              nodeType: 'SKILL',
              eventType: 'NODE_STARTED',
              retryCount: 0,
              startedAtEpochMs,
            },
          },
        });
        await runtimeContext?.emitResultDelta?.({
          structuredPayload: {
            workflowRecipe: recipe,
            workflowExecutionEvent: {
              executionId: 'workflow-execution-1',
              nodeId: 'diagnose',
              nodeType: 'SKILL',
              eventType: 'NODE_COMPLETED',
              retryCount: 0,
              startedAtEpochMs,
              completedAtEpochMs: startedAtEpochMs + 1,
              output: {},
            },
          },
        });
        await runtimeContext?.emitResultDelta?.({
          structuredPayload: {
            workflowRecipe: recipe,
            workflowExecutionEvent: {
              executionId: 'workflow-execution-1',
              nodeId: 'recover',
              nodeType: 'SUBFLOW',
              eventType: 'NODE_STARTED',
              retryCount: 0,
              startedAtEpochMs,
            },
          },
        });
        await runtimeContext?.emitResultDelta?.({
          structuredPayload: {
            workflowRecipe: recipe,
            workflowExecutionEvent: {
              executionId: 'workflow-execution-1',
              nodeId: 'recover',
              nodeType: 'SUBFLOW',
              eventType: 'NODE_COMPLETED',
              retryCount: 0,
              startedAtEpochMs,
              completedAtEpochMs: startedAtEpochMs + 2,
              output: {},
            },
          },
        });
      }
      return { status: 'SUCCEEDED', structuredPayload: {}, generatedMessages: [], artifactRefs: [] };
    };

    await executeToolCallsInOrder(
      {
        capabilityCatalog: catalog(),
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
        runState: runState(timeline),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [
          { toolCallId: 'call-read', toolName: 'Read', arguments: { path: 'workspace/alarm.log' } },
          { toolCallId: 'call-extension', toolName: 'NetworkElementStatusLookup', arguments: { networkElementId: 'NE-1' } },
          { toolCallId: 'call-agent', toolName: 'Agent', arguments: { agentId: 'network-agent', prompt: 'private prompt' } },
          { toolCallId: 'call-skill', toolName: 'Skill', arguments: { name: 'network-diagnosis', args: { private: true } } },
          { toolCallId: 'call-workflow', toolName: 'Workflow', arguments: { recipeName: 'alarm-recovery' } },
        ],
        requestLocalState: { generatedMessages: [] },
      },
    );

    const publicLifecycle = timeline
      .filter((event) => event.type === 'CAPABILITY_STARTED' || event.type === 'CAPABILITY_COMPLETED')
      .map((event) => projectTimelineEventToStreamEnvelope(event))
      .filter((outcome) => outcome.kind === 'ENVELOPE')
      .map((outcome) => outcome.envelope.payload);

    expect(publicLifecycle.filter((payload) => payload.capabilityId === 'Read')).toHaveLength(2);
    expect(publicLifecycle.filter((payload) => payload.capabilityId === 'Read')).toEqual([
      expect.objectContaining({ capabilityKind: 'TOOL' }),
      expect.objectContaining({ capabilityKind: 'TOOL' }),
    ]);
    expect(publicLifecycle.filter((payload) => payload.capabilityId === 'NetworkElementStatusLookup')).toEqual([
      expect.objectContaining({ capabilityKind: 'TOOL' }),
      expect.objectContaining({ capabilityKind: 'TOOL' }),
    ]);
    expect(publicLifecycle.filter((payload) => payload.capabilityId === 'Agent')).toEqual([
      expect.objectContaining({ capabilityKind: 'TOOL', targetCapabilityId: 'network-agent' }),
      expect.objectContaining({ capabilityKind: 'TOOL', targetCapabilityId: 'network-agent' }),
    ]);
    expect(publicLifecycle.filter((payload) => payload.capabilityId === 'Skill')).toEqual([
      expect.objectContaining({ capabilityKind: 'TOOL', targetCapabilityId: 'network-diagnosis' }),
      expect.objectContaining({ capabilityKind: 'TOOL', targetCapabilityId: 'network-diagnosis' }),
    ]);
    expect(publicLifecycle.filter((payload) => payload.capabilityId === 'workflow-network-diagnosis')).toEqual([
      expect.objectContaining({ capabilityKind: 'SKILL' }),
      expect.objectContaining({ capabilityKind: 'SKILL' }),
    ]);
    expect(publicLifecycle.filter((payload) => payload.capabilityId === 'alarm-recovery-child')).toEqual([
      expect.objectContaining({ capabilityKind: 'WORKFLOW', parentToolCallId: 'call-workflow' }),
      expect.objectContaining({ capabilityKind: 'WORKFLOW', parentToolCallId: 'call-workflow' }),
    ]);
    expect(publicLifecycle.filter((payload) => payload.capabilityId === 'Workflow')).toEqual([
      expect.objectContaining({ capabilityKind: 'TOOL', targetCapabilityId: 'alarm-recovery' }),
      expect.objectContaining({ capabilityKind: 'TOOL', targetCapabilityId: 'alarm-recovery' }),
    ]);
    expect(JSON.stringify(publicLifecycle)).not.toMatch(/private prompt|"args"|"recipeName"/);
  });
});

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
    provider:
      capabilityId === 'NetworkElementStatusLookup'
        ? {
            providerId: 'network-integration.tools',
            providerKind: 'CUSTOM',
            providerType: 'nextagent-plugin-tool',
          }
        : { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: capabilityId,
    description: capabilityId,
    availabilityStatus: 'AVAILABLE',
    replayPolicy: 'IDEMPOTENT',
  };
}

function runState(events: RunTimelineEvent[]): AgentRunStatePort {
  let messageOrdinal = 0;
  let sequence = 0;
  return {
    async setCapabilityTerminalAnswer(): Promise<void> {},
    async emitEvent(_run, _context, event) {
      sequence += 1;
      events.push({
        ...event,
        eventId: brand<string, 'TimelineEventId'>(`timeline-${sequence}`),
        sessionId: brand<string, 'SessionId'>('session-1'),
        requestId: brand<string, 'MessageId'>('request-1'),
        runId: brand<string, 'RequestRunId'>('run-1'),
        sequence: brand<number, 'TimelineSequence'>(sequence),
        createdAt: new Date(sequence),
      } as RunTimelineEvent);
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
