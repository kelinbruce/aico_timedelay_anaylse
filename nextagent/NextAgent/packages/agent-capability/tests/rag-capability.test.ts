import { builtinToolsProvider, createCapabilitySubsystem, createToolCatalog, ragCapabilityId, ragToolDefinition } from '@nextagent/agent-capability';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityInvocationRequest } from '@nextagent/agent-contracts/capability';
import type { RagRetrievalGateway, RagRetrievalRequest, RagRetrievalResult } from '@nextagent/agent-contracts/gateway';
import { describe, expect, it } from 'vitest';

describe('rag capability', () => {
  it('is unavailable without the RAG retrieval gateway dependency', async () => {
    const catalog = createToolCatalog({ provider: builtinToolsProvider, tools: [ragToolDefinition] });

    await expect(catalog.listAll(new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({
        capabilityId: 'Rag',
        availabilityStatus: 'UNAVAILABLE',
        availabilityReason: 'TOOL_DEPENDENCY_MISSING',
      }),
    ]);
    expect(catalog.resolveExecutable(ragCapabilityId)).toBeUndefined();
  });

  it('registers strict schema metadata and applies default indexes and topK', async () => {
    const calls: RagRetrievalRequest[] = [];
    const subsystem = createCapabilitySubsystem({
      toolDependencies: { ragRetrieval: gateway(calls, { status: 'OK', results: [{ content: 'UPF timers', source: 'docs/upf.md' }] }) },
    });

    const result = await subsystem.invocationPort.invoke(request({ query: 'UPF timeout handling' }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        status: 'OK',
        results: [{ content: 'UPF timers', source: 'docs/upf.md' }],
      },
      metadata: {
        toolDiagnostics: [
          { key: 'toolResultStatus', value: 'OK' },
          { key: 'toolResultCountBucket', value: '1' },
        ],
      },
    });
    expect(calls).toEqual([
      expect.objectContaining({
        tenantId: 'tenant-rag',
        subjectId: 'subject-rag',
        agentId: 'default-agent',
        agentVersion: 'v1',
        knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
        query: 'UPF timeout handling',
        indexes: ['local'],
        options: { topK: 5 },
      }),
    ]);
  });

  it('uses configured default indexes when the model omits indexes', async () => {
    const calls: RagRetrievalRequest[] = [];
    const subsystem = createCapabilitySubsystem({
      toolDependencies: {
        ragRetrieval: gateway(calls, { status: 'OK', results: [{ content: 'UPF timers', source: 'docs/upf.md' }] }),
        ragDefaultIndexes: ['local', 'remote-netops'],
      },
    });

    await subsystem.invocationPort.invoke(request({ query: 'UPF timeout handling' }), new AbortController().signal);
    await subsystem.invocationPort.invoke(request({ query: 'UPF timeout handling', indexes: ['local'] }), new AbortController().signal);

    expect(calls.map((call) => call.indexes)).toEqual([['local', 'remote-netops'], ['local']]);
  });

  it('rejects authority and provider-private input fields through the schema', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { ragRetrieval: gateway([], { status: 'OK', results: [] }) } });
    const invalidInputs: JsonObject[] = [
      { query: '' },
      { query: '   ' },
      { query: 'x'.repeat(2049) },
      { query: 'UPF', indexes: [] },
      { query: 'UPF', indexes: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { query: 'UPF', indexes: [''] },
      { query: 'UPF', indexes: ['local', 7] },
      { query: 'UPF', indexes: ['x'.repeat(129)] },
      { query: 'UPF', topK: 0 },
      { query: 'UPF', topK: 11 },
      { query: 'UPF', providerKind: 'local-fts5' },
      { query: 'UPF', deploymentMode: 'LOCAL' },
      { query: 'UPF', path: 'C:\\secret\\kb' },
      { query: 'UPF', sqlitePath: 'C:\\secret\\db.sqlite' },
      { query: 'UPF', fts5Expression: 'raw OR expression' },
      { query: 'UPF', connection: { endpoint: 'http://private' } },
      { query: 'UPF', credential: 'token-secret' },
      { query: 'UPF', providerIndexBinding: 'netkb-private' },
    ];

    for (const input of invalidInputs) {
      await expect(subsystem.invocationPort.invoke(request(input), new AbortController().signal), JSON.stringify(input)).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
      });
    }
  });

  it('maps provider unavailable to an empty failure payload and retries once by default', async () => {
    const calls: RagRetrievalRequest[] = [];
    const subsystem = createCapabilitySubsystem({
      toolDependencies: { ragRetrieval: gateway(calls, { status: 'UNAVAILABLE', results: [], diagnostics: { reason: 'PROVIDER_UNAVAILABLE' } }) },
    });

    await expect(subsystem.invocationPort.invoke(request({ query: 'UPF' }), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: { code: 'PROVIDER_UNAVAILABLE', category: 'UNAVAILABLE', retryable: true },
    });
    expect(calls).toHaveLength(2);
  });

  it('passes through explicit governance and retrieval reasons from the gateway whitelist', async () => {
    for (const reason of ['CAPACITY_EXCEEDED', 'INDEX_NOT_FOUND', 'NO_RESULTS_FOUND'] as const) {
      const subsystem = createCapabilitySubsystem({
        toolDependencies: { ragRetrieval: gateway([], { status: 'DEGRADED', results: [], diagnostics: { reason } }) },
      });

      await expect(subsystem.invocationPort.invoke(request({ query: 'UPF' }), new AbortController().signal), reason).resolves.toMatchObject({
        status: reason === 'NO_RESULTS_FOUND' ? 'SUCCEEDED' : 'FAILED',
        structuredPayload: reason === 'NO_RESULTS_FOUND' ? { status: 'OK', results: [] } : {},
        ...(reason === 'NO_RESULTS_FOUND'
          ? {}
          : reason === 'INDEX_NOT_FOUND'
            ? { safeError: { code: 'RAG_INDEX_NOT_FOUND', category: 'NOT_FOUND', retryable: false } }
            : { safeError: { code: 'RAG_EXECUTION_FAILED', category: 'INTERNAL', retryable: false } }),
      });
    }
  });

  it('maps index missing, index not ready, timeout, cancellation, failed, and invalid provider results safely', async () => {
    for (const [gatewayResult, expected] of [
      [
        { status: 'UNAVAILABLE', results: [], diagnostics: { reason: 'INDEX_NOT_FOUND' } },
        { status: 'FAILED', code: 'RAG_INDEX_NOT_FOUND', category: 'NOT_FOUND' },
      ],
      [
        { status: 'UNAVAILABLE', results: [], diagnostics: { reason: 'INDEX_NOT_READY' } },
        { status: 'FAILED', code: 'RAG_INDEX_NOT_READY', category: 'CONFLICT' },
      ],
      [
        { status: 'UNAVAILABLE', results: [], diagnostics: { reason: 'SCOPE_MISMATCH' } },
        { status: 'FAILED', code: 'RAG_SCOPE_MISMATCH', category: 'AUTHORIZATION' },
      ],
      [
        { status: 'TIMEOUT', results: [], diagnostics: { reason: 'TIMEOUT' } },
        { status: 'TIMED_OUT', code: 'TIMEOUT', category: 'TIMEOUT' },
      ],
      [
        { status: 'CANCELED', results: [], diagnostics: { reason: 'CANCELED' } },
        { status: 'FAILED', code: 'CANCELED', category: 'CANCELED' },
      ],
      [
        { status: 'FAILED', results: [], diagnostics: { reason: 'EXECUTION_FAILED' } },
        { status: 'FAILED', code: 'RAG_EXECUTION_FAILED', category: 'INTERNAL' },
      ],
      [
        { status: 'UNAVAILABLE', results: [], diagnostics: { reason: 'C:\\secret' } },
        { status: 'FAILED', code: 'RAG_EXECUTION_FAILED', category: 'INTERNAL' },
      ],
    ] as const) {
      const subsystem = createCapabilitySubsystem({
        toolDependencies: { ragRetrieval: gateway([], gatewayResult as unknown as RagRetrievalResult) },
      });
      const result = await subsystem.invocationPort.invoke(request({ query: 'UPF' }), new AbortController().signal);
      expect(result, JSON.stringify(gatewayResult)).toMatchObject({
        status: expected.status,
        structuredPayload: {},
        safeError: { code: expected.code, category: expected.category },
      });
    }
  });

  it('reports partial retrieval as degraded only when safe chunks are present', async () => {
    const subsystem = createCapabilitySubsystem({
      toolDependencies: {
        ragRetrieval: gateway([], {
          status: 'DEGRADED',
          results: [{ content: 'partial', source: 'docs/partial.md' }],
          diagnostics: { reason: 'INDEX_NOT_READY' },
        }),
      },
    });

    const result = await subsystem.invocationPort.invoke(request({ query: 'UPF' }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'DEGRADED',
      structuredPayload: {
        status: 'DEGRADED',
        results: [{ content: 'partial', source: 'docs/partial.md' }],
      },
      safeError: { code: 'INDEX_NOT_READY', category: 'UNAVAILABLE', retryable: false },
    });
    expect(result.safeError?.message).toContain('partial chunks');
    expect(result.safeError?.message).toContain('not fully ready');
  });

  it('keeps topK-bounded complete results as SUCCEEDED without degrading', async () => {
    const chunks = Array.from({ length: 3 }, (_, i) => ({ content: `chunk-${i}`, source: `docs/upf-${i}.md` }));
    const subsystem = createCapabilitySubsystem({
      toolDependencies: {
        ragRetrieval: gateway([], { status: 'OK', results: chunks }),
      },
    });

    const result = await subsystem.invocationPort.invoke(request({ query: 'UPF', topK: 3 }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { status: 'OK', results: chunks },
    });
    expect(result.safeError).toBeUndefined();
  });

  it('keeps zero-hit retrieval as SUCCEEDED', async () => {
    const subsystem = createCapabilitySubsystem({
      toolDependencies: {
        ragRetrieval: gateway([], { status: 'OK', results: [] }),
      },
    });

    const result = await subsystem.invocationPort.invoke(request({ query: 'nonexistent topic' }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { status: 'OK', results: [] },
    });
    expect(result.safeError).toBeUndefined();
  });

  it('does not report direct execution cancellation as success', async () => {
    const requestValue = request({ query: 'UPF' });
    const calls: RagRetrievalRequest[] = [];
    const controller = new AbortController();
    controller.abort();

    await expect(
      ragToolDefinition.tool.execute(
        { query: 'UPF' },
        {
          context: {
            identityContext: requestValue.identityContext,
            agentId: requestValue.agentId,
            agentVersion: requestValue.agentVersion,
            sessionId: requestValue.sessionId,
            requestId: requestValue.requestId,
            runId: requestValue.runId,
            requestContextId: requestValue.requestContextId,
            stepId: requestValue.stepId,
            toolCallId: 'tool-rag-canceled',
            timeoutMs: requestValue.timeoutMs,
          },
          deps: { ragRetrieval: gateway(calls, { status: 'OK', results: [] }) },
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({
      code: 'CANCELED',
      category: 'CANCELED',
    });
    expect(calls).toEqual([]);
  });

  it('bounds returned chunks to topK', async () => {
    const subsystem = createCapabilitySubsystem({
      toolDependencies: {
        ragRetrieval: gateway([], {
          status: 'OK',
          results: [
            { content: 'one', source: 'docs/1.md' },
            { content: 'two', source: 'docs/2.md' },
            { content: 'three', source: 'docs/3.md' },
          ],
        }),
      },
    });

    const result = await subsystem.invocationPort.invoke(request({ query: 'UPF', topK: 2 }), new AbortController().signal);

    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload.results).toHaveLength(2);
  });

  it('retries an empty timeout once by default and respects maxRetries=0', async () => {
    const defaultCalls: RagRetrievalRequest[] = [];
    const singleCalls: RagRetrievalRequest[] = [];
    const gatewayResult: RagRetrievalResult = { status: 'TIMEOUT', results: [], diagnostics: { reason: 'TIMEOUT' } };
    const defaultSubsystem = createCapabilitySubsystem({ toolDependencies: { ragRetrieval: gateway(defaultCalls, gatewayResult) } });
    const singleSubsystem = createCapabilitySubsystem({ toolDependencies: { ragRetrieval: gateway(singleCalls, gatewayResult) } });

    const defaultResult = await defaultSubsystem.invocationPort.invoke(request({ query: 'UPF' }), new AbortController().signal);
    const singleResult = await singleSubsystem.invocationPort.invoke(request({ query: 'UPF' }, 0), new AbortController().signal);

    expect(defaultResult).toMatchObject({
      status: 'TIMED_OUT',
      structuredPayload: {},
      safeError: { code: 'TIMEOUT', category: 'TIMEOUT', retryable: true },
    });
    expect(singleResult).toMatchObject({
      status: 'TIMED_OUT',
      structuredPayload: {},
      safeError: { code: 'TIMEOUT', category: 'TIMEOUT', retryable: true },
    });
    expect(defaultCalls).toHaveLength(2);
    expect(singleCalls).toHaveLength(1);
  });
});

function gateway(calls: RagRetrievalRequest[], result: RagRetrievalResult): RagRetrievalGateway {
  return {
    async retrieve(requestValue) {
      calls.push(requestValue);
      return result;
    },
  };
}

function request(argumentsValue: JsonObject, maxRetries?: number): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-rag',
    capabilityId: ragCapabilityId,
    arguments: argumentsValue,
    sessionId: brand<string, 'SessionId'>('session-rag'),
    requestId: brand<string, 'MessageId'>('request-rag'),
    runId: brand<string, 'RequestRunId'>('run-rag'),
    requestContextId: brand<string, 'RequestContextId'>('context-rag'),
    stepId: 'turn-1',
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-rag'),
      subjectId: brand<string, 'SubjectId'>('subject-rag'),
      displayName: 'RAG tester',
    },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-rag'),
    ...(maxRetries === undefined ? {} : { maxRetries }),
  };
}
