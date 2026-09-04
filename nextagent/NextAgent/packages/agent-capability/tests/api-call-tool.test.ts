import {
  BuiltinToolsExecutor,
  GovernedCapabilityInvocationPort,
  builtinToolsProvider,
  createBuiltinToolDefinitions,
  createStaticCapabilityExecutorFactory,
  createToolCatalog,
} from '@nextagent/agent-capability';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { ApiCallPort, CapabilityDescriptor, CapabilityInvocationRequest, ParameterExtractionPort } from '@nextagent/agent-contracts/capability';
import { describe, expect, it, vi } from 'vitest';

import type { SkillSourceRegistry } from '../src/skills/skill-source-discovery.js';

describe('ApiCall builtin Tool', () => {
  it('classifies parent cancellation separately and never replays the non-idempotent request', async () => {
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const callApi = vi.fn<ApiCallPort['callApi']>(async (_request, signal) => {
      markStarted?.();
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      throw new Error('unreachable');
    });
    const invocation = invokeApiCall(apiCallPort({ callApi }), controller.signal);
    await started;
    controller.abort();

    await expect(invocation).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_ABORTED', category: 'CANCELED', retryable: false },
    });
    expect(callApi).toHaveBeenCalledTimes(1);
  });

  it('maps local timeout to TIMED_OUT/TIMEOUT without replay', async () => {
    const callApi = vi.fn<ApiCallPort['callApi']>(async () => {
      throw Object.assign(new Error('local timeout'), { name: 'TimeoutError' });
    });

    await expect(invokeApiCall(apiCallPort({ callApi }))).resolves.toMatchObject({
      status: 'TIMED_OUT',
      safeError: {
        code: 'TIMEOUT',
        message:
          'The API call timed out after dispatch and its final result is unknown. Do not automatically repeat this non-idempotent call. If the integration exposes an independent read or status operation, use it to verify remote state; otherwise stop and report the timeout.',
        category: 'TIMEOUT',
        retryable: false,
      },
    });
    expect(callApi).toHaveBeenCalledTimes(1);
  });

  it('maps an ordinary transport rejection to FAILED/UNAVAILABLE without replay', async () => {
    const callApi = vi.fn<ApiCallPort['callApi']>(async () => {
      throw new Error('connection reset');
    });

    await expect(invokeApiCall(apiCallPort({ callApi }))).resolves.toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'UNAVAILABLE',
        message:
          'The API call failed after dispatch and no safe response was available. Do not automatically repeat this non-idempotent call. If the integration exposes an independent read or status operation, use it to verify remote state; otherwise stop and report the failure.',
        category: 'UNAVAILABLE',
        retryable: false,
      },
    });
    expect(callApi).toHaveBeenCalledTimes(1);
  });

  it('maps an interrupted response stream to FAILED/UNAVAILABLE without replay', async () => {
    const callApiStream = vi.fn<ApiCallPort['callApiStream']>(async function* () {
      yield { data: 'first' };
      throw new Error('stream interrupted');
    });

    await expect(invokeApiCall(apiCallPort({ callApiStream }), undefined, true)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'API_STREAM_INTERRUPTED',
        message:
          'The API response stream was interrupted after dispatch, so the complete result is unavailable. Do not automatically repeat this non-idempotent call. If the integration exposes an independent read or status operation, use it to verify remote state; otherwise stop and report the interruption.',
        category: 'UNAVAILABLE',
        retryable: false,
      },
    });
    expect(callApiStream).toHaveBeenCalledTimes(1);
  });

  it.each(['HTTP 500', 'null response body'])('maps a streaming %s to FAILED without delta or replay', async (failure) => {
    const callApiStream = vi.fn<ApiCallPort['callApiStream']>(async function* () {
      throw new Error(failure);
    });
    const emitResultDelta = vi.fn(async () => undefined);

    await expect(invokeApiCall(apiCallPort({ callApiStream }), undefined, true, emitResultDelta)).resolves.toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: { code: 'API_STREAM_INTERRUPTED', category: 'UNAVAILABLE', retryable: false },
    });
    expect(emitResultDelta).not.toHaveBeenCalled();
    expect(callApiStream).toHaveBeenCalledTimes(1);
  });
});

async function invokeApiCall(
  apiCallPort: ApiCallPort,
  signal = new AbortController().signal,
  streaming = false,
  emitResultDelta?: (payload: { readonly structuredPayload: JsonObject }) => Promise<void>,
) {
  const definition = createBuiltinToolDefinitions({}).find((candidate) => candidate.metadata.name === 'ApiCall');
  if (definition === undefined) {
    throw new Error('ApiCall definition is not registered.');
  }
  const skillSources: SkillSourceRegistry = {
    resolveSkillSource() {
      return {
        async loadCanonicalBodyView() {
          return undefined;
        },
        async readSkillResource(input) {
          const yaml = swaggerDocument(streaming);
          return {
            ...input.resource,
            sizeBytes: Buffer.byteLength(yaml, 'utf8'),
            contentStream: streamText(yaml),
          };
        },
      };
    },
  };
  const parameterExtraction: ParameterExtractionPort = {
    async extractParams() {
      return { status: 'SUCCEEDED', parameters: {} };
    },
  };
  const catalog = createToolCatalog({
    provider: builtinToolsProvider,
    tools: [definition],
    dependencies: { skillSources, apiCallPort, parameterExtraction },
  });
  const descriptor = (await catalog.listAll(signal))[0];
  if (descriptor === undefined) {
    throw new Error('ApiCall descriptor is unavailable.');
  }
  const port = new GovernedCapabilityInvocationPort(
    descriptorResolver(descriptor),
    createStaticCapabilityExecutorFactory([{ provider: builtinToolsProvider, executor: new BuiltinToolsExecutor(catalog) }]),
  );
  return port.invoke(request(), signal, emitResultDelta === undefined ? undefined : { emitResultDelta });
}

function apiCallPort(overrides: Partial<ApiCallPort>): ApiCallPort {
  return {
    async callApi() {
      return { status: 200, headers: {}, body: '{}' };
    },
    async *callApiStream() {},
    ...overrides,
  };
}

function descriptorResolver(descriptor: CapabilityDescriptor) {
  return {
    async resolveForInvocation() {
      return descriptor;
    },
  };
}

function request(): CapabilityInvocationRequest {
  const argumentsValue: JsonObject = {
    apiName: 'health',
    userQuestion: 'Check health.',
    headerParams: {},
    requestParams: {},
    skillName: 'health-skill',
    skillVersion: '1',
    providerId: 'skill-source',
    sourceIdentity: 'source',
    frontmatterHash: 'hash',
    skillBody: 'Use the health API.',
  };
  return {
    invocationId: 'invoke-api-call',
    capabilityId: brand<string, 'CapabilityId'>('ApiCall'),
    arguments: argumentsValue,
    sessionId: brand<string, 'SessionId'>('session-api-call'),
    requestId: brand<string, 'MessageId'>('request-api-call'),
    runId: brand<string, 'RequestRunId'>('run-api-call'),
    requestContextId: brand<string, 'RequestContextId'>('context-api-call'),
    stepId: 'turn-1',
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-api-call'),
      subjectId: brand<string, 'SubjectId'>('subject-api-call'),
      displayName: 'ApiCall tester',
    },
    agentId: brand<string, 'AgentId'>('agent-api-call'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 25,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-api-call'),
  };
}

function swaggerDocument(streaming: boolean): string {
  return [
    'swagger: "2.0"',
    'host: example.test',
    'basePath: /api',
    'schemes: [https]',
    `produces: [${streaming ? 'text/event-stream' : 'application/json'}]`,
    'paths:',
    '  /health:',
    '    get:',
    '      parameters: []',
  ].join('\n');
}

async function* streamText(value: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(value);
}
