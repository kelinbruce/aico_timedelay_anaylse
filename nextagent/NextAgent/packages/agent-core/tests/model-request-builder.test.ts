import { brand } from '@nextagent/agent-common';
import type { RenderedModelInput } from '@nextagent/agent-contracts/context';
import type { RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { flattenModelRequest } from '../src/model/model-request-builder.js';
import { describe, expect, it } from 'vitest';

describe('flattenModelRequest', () => {
  it('overrides effective thinking and toolChoice with trusted request options without changing other fields', () => {
    const request = flattenModelRequest(
      makeRun(),
      makeContext({ requestModelOptions: { thinking: { depth: 'OFF' }, toolChoice: 'REQUIRED' } }),
      makeRendered(),
      'turn-1',
    );

    expect(request).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 512,
      topP: 0.9,
      thinking: { depth: 'OFF' },
      toolChoice: 'REQUIRED',
    });
  });

  it('preserves effective model options when request-scoped model options are absent', () => {
    const request = flattenModelRequest(makeRun(), makeContext(), makeRendered(), 'turn-1');

    expect(request).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 512,
      topP: 0.9,
      thinking: { depth: 'HIGH' },
      toolChoice: 'AUTO' as const,
    });
  });
});

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-model-request-builder'),
    sessionId: brand<string, 'SessionId'>('session-model-request-builder'),
    requestId: brand<string, 'MessageId'>('request-model-request-builder'),
    agentId: brand<string, 'AgentId'>('agent-model-request-builder'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-model-request-builder@v1',
    attempt: 1,
    status: 'QUEUED',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-model-request-builder'),
    sessionId: brand<string, 'SessionId'>('session-model-request-builder'),
    requestId: brand<string, 'MessageId'>('request-model-request-builder'),
    runId: brand<string, 'RequestRunId'>('run-model-request-builder'),
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-model-request-builder'),
      subjectId: brand<string, 'SubjectId'>('subject-model-request-builder'),
      displayName: 'Model Request Builder',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: brand<string, 'AgentId'>('agent-model-request-builder'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-model-request-builder@v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
    ...overrides,
  };
}

function makeRendered(): RenderedModelInput {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-model-request-builder'),
    messages: [{ role: 'USER', content: [{ type: 'text', text: 'diagnose' }] }],
    tools: [],
    modelConfiguration: {
      modelId: 'MiniMax-M2.7',
      contextWindowTokens: 128_000,
      temperature: 0.2,
      maxOutputTokens: 512,
      topP: 0.9,
      thinking: { depth: 'HIGH' },
      toolChoice: 'AUTO' as const,
      defaultTimeoutMs: 30_000,
      defaultMaxRetries: 2,
    },
    modelOptions: {
      temperature: 0.2,
      maxOutputTokens: 512,
      topP: 0.9,
      thinking: { depth: 'HIGH' },
    },
    providerOptions: {},
  };
}
