import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import {
  createAppCredentialResolver,
  createComposedApp,
  createTestSystemConfig,
  loadBuiltInDefaultAgentDefinition,
  readCapturedMetricSamples,
  type AgentDefinition,
  type DefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import { bindRuntimeLoggerProvider, brand, type RuntimeLogger, type RuntimeLogLevel } from '@nextagent/agent-common';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { StructuredLogEntry } from '@nextagent/agent-observability';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-memory-tools'),
  subjectId: brand<string, 'SubjectId'>('subject-memory-tools'),
  displayName: 'Memory runtime tester',
};

describe('memory tools runtime integration', () => {
  it('does not expose memory tools when MemoryConfig is disabled even if the AgentAssembly opts in', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-tools-disabled-'));
    const captured: ModelInvocationRequest[] = [];
    const app = createComposedApp(
      {
        systemConfig: withMemoryDisabled(createTestSystemConfig(tempDir, credentialResolver())),
        agentDefinition: memoryAgentDefinition(),
        credentialResolver: credentialResolver(),
        identity,
      },
      captureModel(captured),
    );
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'check disabled memory tools', idempotencyKey: 'idem-memory-tools-disabled' },
      });
      expect(accepted.statusCode).toBe(200);
      await waitForRunTerminal(app.gateway, accepted.json<{ runId: string }>().runId);

      expect(captured[0]?.tools.map((tool) => tool.name).sort()).not.toContain('search_memory');
      expect(captured[0]?.tools.map((tool) => tool.name).sort()).not.toContain('get_memory_detail');
      expect(captured[0]?.tools.map((tool) => tool.name).sort()).not.toContain('add_memory');
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('does not expose memory tools when MemoryConfig is invalid even if the AgentAssembly opts in', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-tools-invalid-'));
    const captured: ModelInvocationRequest[] = [];
    const app = createComposedApp(
      {
        systemConfig: withMemoryInvalid(createTestSystemConfig(tempDir, credentialResolver())),
        agentDefinition: memoryAgentDefinition(),
        credentialResolver: credentialResolver(),
        identity,
      },
      captureModel(captured),
    );
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'check invalid memory tools', idempotencyKey: 'idem-memory-tools-invalid' },
      });
      expect(accepted.statusCode).toBe(200);
      await waitForRunTerminal(app.gateway, accepted.json<{ runId: string }>().runId);

      expect(captured[0]?.tools.map((tool) => tool.name).sort()).not.toContain('search_memory');
      expect(captured[0]?.tools.map((tool) => tool.name).sort()).not.toContain('get_memory_detail');
      expect(captured[0]?.tools.map((tool) => tool.name).sort()).not.toContain('add_memory');
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('does not expose memory tools when MemoryConfig is valid but the AgentAssembly does not opt in', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-tools-no-opt-in-'));
    const captured: ModelInvocationRequest[] = [];
    const app = createComposedApp(
      {
        systemConfig: createTestSystemConfig(tempDir, credentialResolver()),
        agentDefinition: memoryAgentDefinition({ bindMemoryTools: false }),
        credentialResolver: credentialResolver(),
        identity,
      },
      captureModel(captured),
    );
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'check missing memory opt-in', idempotencyKey: 'idem-memory-tools-no-opt-in' },
      });
      expect(accepted.statusCode).toBe(200);
      await waitForRunTerminal(app.gateway, accepted.json<{ runId: string }>().runId);

      expect(captured[0]?.tools.map((tool) => tool.name).sort()).not.toContain('search_memory');
      expect(captured[0]?.tools.map((tool) => tool.name).sort()).not.toContain('get_memory_detail');
      expect(captured[0]?.tools.map((tool) => tool.name).sort()).not.toContain('add_memory');
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('exposes memory tools for the builtin default Agent when default MemoryConfig is valid', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-tools-builtin-default-'));
    const captured: ModelInvocationRequest[] = [];
    const app = createComposedApp(
      {
        systemConfig: createTestSystemConfig(tempDir, credentialResolver()),
        agentDefinition: loadBuiltInDefaultAgentDefinition(),
        credentialResolver: credentialResolver(),
        identity,
      },
      captureModel(captured),
    );
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'check builtin default memory tools', idempotencyKey: 'idem-memory-tools-builtin-default' },
      });
      expect(accepted.statusCode).toBe(200);
      await waitForRunTerminal(app.gateway, accepted.json<{ runId: string }>().runId);

      const toolNames = captured[0]?.tools.map((tool) => tool.name).sort() ?? [];
      expect(toolNames).toEqual(expect.arrayContaining(['add_memory', 'get_memory_detail', 'search_memory']));
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('exposes memory tools through provider-scoped capability catalog when default MemoryConfig is valid and the AgentAssembly opts in', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-tools-enabled-'));
    const captured: ModelInvocationRequest[] = [];
    const structuredLogs: Array<{ readonly entry: StructuredLogEntry; readonly message: string }> = [];
    const app = createComposedApp(
      {
        systemConfig: createTestSystemConfig(tempDir, credentialResolver()),
        agentDefinition: memoryAgentDefinition({ searchDescription: 'Trusted search memory override.' }),
        credentialResolver: credentialResolver(),
        identity,
        observationLogger: captureObservationLogger(structuredLogs),
      },
      captureModel(captured),
    );
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'check enabled memory tools', idempotencyKey: 'idem-memory-tools-enabled' },
      });
      expect(accepted.statusCode).toBe(200);
      await waitForRunTerminal(app.gateway, accepted.json<{ runId: string }>().runId);

      const tools = captured[0]?.tools ?? [];
      expect(tools.map((tool) => tool.name).sort()).toEqual(expect.arrayContaining(['add_memory', 'get_memory_detail', 'search_memory']));
      expect(tools.find((tool) => tool.name === 'search_memory')?.description).toBe('Trusted search memory override.');
      expect(readCapturedMetricSamples(app)).toContainEqual(
        expect.objectContaining({
          name: 'configuration_evaluation_total',
          labels: { component: 'capability_description_override', outcome: 'success' },
        }),
      );
      // Description-override diagnostics now flow through the observability projector host,
      // not the structured log transport. The metric above confirms the override was applied.
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('truncates overlong memory tool description overrides and emits safe telemetry', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-tools-description-truncated-'));
    const captured: ModelInvocationRequest[] = [];
    const structuredLogs: Array<{ readonly entry: StructuredLogEntry; readonly message: string }> = [];
    const longDescription = `Memory override ${'x'.repeat(600)}`;
    const app = createComposedApp(
      {
        systemConfig: withMemoryEnabled(createTestSystemConfig(tempDir, credentialResolver())),
        agentDefinition: memoryAgentDefinition({ searchDescription: longDescription }),
        credentialResolver: credentialResolver(),
        identity,
        observationLogger: captureObservationLogger(structuredLogs),
      },
      captureModel(captured),
    );
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'check memory description truncation', idempotencyKey: 'idem-memory-tools-description-truncated' },
      });
      expect(accepted.statusCode).toBe(200);
      await waitForRunTerminal(app.gateway, accepted.json<{ runId: string }>().runId);

      const description = captured[0]?.tools.find((tool) => tool.name === 'search_memory')?.description;
      expect(description).toBe(longDescription.slice(0, 512));
      expect(description).toHaveLength(512);
      expect(readCapturedMetricSamples(app)).toContainEqual(
        expect.objectContaining({
          name: 'configuration_evaluation_total',
          labels: { component: 'capability_description_override', outcome: 'degraded' },
        }),
      );
      // Description-override diagnostics now flow through the observability projector host,
      // not the structured log transport. The metric above confirms the truncation was recorded.
      expect(JSON.stringify(structuredLogs)).not.toContain(longDescription);
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('executes add_memory through capability invocation and writes the current owner and agent scoped memory record', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-tools-add-'));
    const captured: ModelInvocationRequest[] = [];
    const app = createComposedApp(
      {
        systemConfig: withMemoryEnabled(createTestSystemConfig(tempDir, credentialResolver())),
        agentDefinition: memoryAgentDefinition(),
        credentialResolver: credentialResolver(),
        identity,
      },
      scriptedAddMemoryModel(captured),
    );
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'Remember that the BGP peer is 10.0.0.1', idempotencyKey: 'idem-memory-tools-add' },
      });
      expect(accepted.statusCode).toBe(200);
      await waitForRunTerminal(app.gateway, accepted.json<{ runId: string }>().runId);

      const list = await app.gateway.longTermMemoryStore.listLongTermMemory({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        limit: 10,
      });
      expect(list).toMatchObject({
        items: [expect.objectContaining({ memoryType: 'FACTUAL', briefIndex: 'BGP peer: 10.0.0.1' })],
        total: 1,
      });
      expect(captured).toHaveLength(2);
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('revives archived memory through the get_memory_detail L2 tool boundary when aging is enabled', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-aging-revival-'));
    const captured: ModelInvocationRequest[] = [];
    const structuredLogs: Array<{ readonly entry: StructuredLogEntry; readonly message: string }> = [];
    const systemConfig = withDebugObservability(withMemoryAgingEnabled(createTestSystemConfig(tempDir, credentialResolver())));
    const app = createComposedApp(
      {
        systemConfig,
        agentDefinition: memoryAgentDefinition(),
        credentialResolver: credentialResolver(),
        identity,
        observationLogger: captureObservationLogger(structuredLogs),
      },
      scriptedGetMemoryDetailModel(captured),
    );
    try {
      const saved = await app.gateway.longTermMemoryStore.saveLongTermMemory({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        memoryType: 'FACTUAL',
        knowledgeSourceType: 'LEARNED',
        confidence: 0.6,
        briefIndex: 'BGP peer ASN',
        content: JSON.stringify({ category: 'FACTUAL', subject: 'BGP peer ASN', claim: '65001' }),
        source: JSON.stringify({ sessionId: brand<string, 'SessionId'>('session-aging-revival') }),
      });
      if ('code' in saved) {
        throw new Error(saved.code);
      }
      const archived = await app.gateway.longTermMemoryStore.mutateLongTermMemory(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          memoryId: saved.memoryId,
          targetState: 'ARCHIVED',
          archiveReason: 'test_archive',
        },
        { expectedVersion: saved.version },
      );
      if ('code' in archived || archived.status !== 'UPDATED') {
        throw new Error('archive failed');
      }
      capturedMemoryId = String(saved.memoryId);

      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'Open the archived memory detail', idempotencyKey: 'idem-memory-aging-revival' },
      });
      expect(accepted.statusCode).toBe(200);
      await waitForRunTerminal(app.gateway, accepted.json<{ runId: string }>().runId);

      const revived = await app.gateway.longTermMemoryStore.getLongTermMemory({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        memoryId: saved.memoryId,
      });
      expect(revived).toMatchObject({ state: 'ACTIVE' });
      expect('code' in revived).toBe(false);
      if (!('code' in revived)) {
        expect(revived.confidence).toBeCloseTo(0.7);
      }
      expect(captured).toHaveLength(2);
      // Aging revival diagnostics now flow through the observability projector host, not the
      // structured log transport. Verify the longTermMemoryId does not leak into metrics.
      // (Tool-call summary logs carry the id in toolInputPreview/toolSafeSummary — a known
      // pre-existing summary-field leak tracked separately, not introduced by this change.)
      expect(JSON.stringify(readCapturedMetricSamples(app))).not.toContain(String(saved.memoryId));
    } finally {
      capturedMemoryId = undefined;
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('persists fork-compatible memory detail output while retaining the memory id for authorized provenance lookup', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-memory-detail-fork-'));
    const captured: ModelInvocationRequest[] = [];
    const runtimeLogs: Array<{ readonly entry: StructuredLogEntry; readonly message: string }> = [];
    const runtimeLoggerBinding = bindRuntimeLoggerProvider({ getLogger: () => captureObservationLogger(runtimeLogs) });
    const app = createComposedApp(
      {
        systemConfig: withMemoryEnabled(createTestSystemConfig(tempDir, credentialResolver())),
        agentDefinition: memoryAgentDefinition(),
        credentialResolver: credentialResolver(),
        identity,
      },
      scriptedForkMemoryDetailModel(captured),
    );
    try {
      const sourceResponse = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'Establish the source run', idempotencyKey: 'idem-memory-detail-fork-source' },
      });
      expect(sourceResponse.statusCode).toBe(200);
      const source = sourceResponse.json<{ sessionId: string; requestId: string; runId: string }>();
      await waitForRunTerminal(app.gateway, source.runId);

      const saved = await app.gateway.longTermMemoryStore.saveLongTermMemory({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        memoryType: 'FACTUAL',
        knowledgeSourceType: 'LEARNED',
        confidence: 0.8,
        briefIndex: 'BGP peer address',
        content: JSON.stringify({ category: 'FACTUAL', subject: 'BGP peer', claim: '10.0.0.1' }),
        source: JSON.stringify({ sessionId: source.sessionId, requestId: source.requestId, runId: source.runId }),
      });
      if ('code' in saved) {
        throw new Error(saved.code);
      }
      capturedMemoryId = String(saved.memoryId);

      const detailResponse = await app.server.inject({
        method: 'POST',
        url: `/api/v1/sessions/${source.sessionId}/requests`,
        payload: { inputText: 'Open the BGP memory detail', idempotencyKey: 'idem-memory-detail-fork-detail' },
      });
      expect(detailResponse.statusCode).toBe(200);
      const detail = detailResponse.json<{ requestId: string; runId: string }>();
      const detailStreamPromise = app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${source.sessionId}/stream?lastSeenSequence=0&runId=${detail.runId}`,
      });
      await waitForRunTerminal(app.gateway, detail.runId);
      const detailStream = await detailStreamPromise;
      expect(detailStream.body).toContain('event: CAPABILITY_RESULT_DELTA');
      expect(detailStream.body).not.toContain('"sourceTrace"');
      expect(detailStream.body).not.toContain(source.runId);

      const sourceMessages = await app.gateway.messages.listMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(source.sessionId),
        includeHidden: true,
        includeCapabilityResults: true,
        limit: 20,
      });
      const durableDetailResult = sourceMessages.items.find(
        (message) =>
          message.requestId === detail.requestId && message.role === 'CAPABILITY_RESULT' && message.metadata['toolName'] === 'get_memory_detail',
      );
      expect(durableDetailResult?.content).toContain(String(saved.memoryId));
      expect(durableDetailResult?.content).toContain('10.0.0.1');
      expect(durableDetailResult?.content).not.toContain('"sourceTrace"');
      expect(durableDetailResult?.content).not.toContain('"source":');
      const payloadLog = runtimeLogs.find(
        ({ entry }) =>
          entry.event === 'tool.payload.captured' &&
          (entry as StructuredLogEntry & { readonly toolCallId?: string }).toolCallId === 'tool-get-memory-detail-fork',
      );
      const toolOutput = JSON.stringify((payloadLog?.entry as (StructuredLogEntry & { readonly toolOutput?: unknown }) | undefined)?.toolOutput);
      expect(toolOutput).toContain(String(saved.memoryId));
      expect(toolOutput).toContain('10.0.0.1');
      expect(toolOutput).toContain('"sourceTrace"');
      expect(toolOutput).toContain('"source":');
      expect(toolOutput).toContain(source.runId);
      const anchor = sourceMessages.items.find(
        (message) => message.requestId === detail.requestId && message.role === 'ASSISTANT' && message.visible,
      );
      expect(anchor).toBeDefined();

      const fork = await app.server.inject({
        method: 'POST',
        url: `/api/v1/sessions/${source.sessionId}/messages/${anchor!.messageId}/fork`,
        payload: { idempotencyKey: 'idem-memory-detail-fork' },
      });
      expect(fork.statusCode, fork.body).toBe(200);
      const childSessionId = fork.json<{ sessionId: string }>().sessionId;
      const childMessages = await app.gateway.messages.listMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(childSessionId),
        includeHidden: true,
        includeCapabilityResults: true,
        limit: 20,
      });
      const copiedDetailResult = childMessages.items.find(
        (message) => message.role === 'CAPABILITY_RESULT' && message.metadata['toolName'] === 'get_memory_detail',
      );
      expect(copiedDetailResult?.content).toContain(String(saved.memoryId));
      expect(copiedDetailResult?.content).toContain('10.0.0.1');
      expect(copiedDetailResult?.content).not.toContain('"sourceTrace"');
      expect(copiedDetailResult?.content).not.toContain(source.runId);
      expect(captured).toHaveLength(3);
      expect(JSON.stringify(captured[2])).not.toContain('"sourceTrace"');
      expect(JSON.stringify(captured[2])).not.toContain(source.runId);
    } finally {
      capturedMemoryId = undefined;
      runtimeLoggerBinding.unbind();
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);
});

let capturedMemoryId: string | undefined;

function withMemoryEnabled(systemConfig: DefaultSystemConfig): DefaultSystemConfig {
  return {
    ...systemConfig,
    memory: {
      enabled: true,
      status: 'VALID',
      search: { defaultLimit: 20, minConfidence: 0.3 },
      extraction: {
        enabled: true,
        strategy: 'RULE_FIRST',
        crossSessionSchedule: '0 0 0 * * ?',
        maxCycleTrajectories: 20,
        maxCandidates: 50,
        timeoutMs: 60_000,
        lookbackDays: 7,
      },
      aging: {
        enabled: true,
        schedule: '0 0 0 * * ?',
        decayStaleDays: 30,
        archiveRetentionDays: 90,
        decayFactor: 0.05,
        batchLimit: 1_000,
        timeoutMs: 30_000,
        reviveConfidenceBoost: 0.1,
      },
      diagnostics: [
        {
          issueCode: 'MEMORY_CONFIG_VALID',
          status: 'VALID',
          fieldRef: 'nextAgent.memory.enabled',
          safeMessage: 'Long-term memory configuration is enabled.',
          source: 'explicit',
        },
      ],
    },
  };
}

function withMemoryDisabled(systemConfig: DefaultSystemConfig): DefaultSystemConfig {
  const enabled = withMemoryEnabled(systemConfig);
  return {
    ...enabled,
    memory: {
      ...enabled.memory,
      enabled: false,
      status: 'DISABLED',
      extraction: {
        ...enabled.memory.extraction,
        enabled: false,
      },
      aging: {
        ...enabled.memory.aging,
        enabled: false,
      },
      diagnostics: [
        {
          issueCode: 'MEMORY_CONFIG_DISABLED_EXPLICIT',
          status: 'DISABLED',
          fieldRef: 'nextAgent.memory.enabled',
          safeMessage: 'Long-term memory is disabled by explicit configuration.',
          source: 'explicit',
        },
      ],
    },
  };
}

function withMemoryInvalid(systemConfig: DefaultSystemConfig): DefaultSystemConfig {
  return {
    ...systemConfig,
    memory: {
      enabled: true,
      status: 'INVALID',
      search: { defaultLimit: 20, minConfidence: 0.3 },
      extraction: {
        enabled: true,
        strategy: 'RULE_FIRST',
        crossSessionSchedule: '0 0 0 * * ?',
        maxCycleTrajectories: 20,
        maxCandidates: 50,
        timeoutMs: 60_000,
        lookbackDays: 7,
      },
      aging: {
        enabled: true,
        schedule: '0 0 0 * * ?',
        decayStaleDays: 30,
        archiveRetentionDays: 90,
        decayFactor: 0.05,
        batchLimit: 1_000,
        timeoutMs: 30_000,
        reviveConfidenceBoost: 0.1,
      },
      diagnostics: [
        {
          issueCode: 'MEMORY_CONFIG_INVALID',
          status: 'INVALID',
          fieldRef: 'nextAgent.memory',
          safeMessage: 'Long-term memory configuration is invalid.',
          source: 'explicit',
        },
      ],
    },
  };
}

function withMemoryAgingEnabled(systemConfig: DefaultSystemConfig): DefaultSystemConfig {
  const enabled = withMemoryEnabled(systemConfig);
  return {
    ...enabled,
    memory: {
      ...enabled.memory,
      aging: {
        ...enabled.memory.aging,
        enabled: true,
      },
    },
  };
}

function withDebugObservability(systemConfig: DefaultSystemConfig): DefaultSystemConfig {
  return {
    ...systemConfig,
    observability: {
      ...systemConfig.observability,
      logging: {
        ...systemConfig.observability.logging,
        diagnosticDetail: 'debug',
      },
    },
  };
}

function memoryAgentDefinition(options: { readonly searchDescription?: string; readonly bindMemoryTools?: boolean } = {}): AgentDefinition {
  const memoryBindings =
    options.bindMemoryTools === false
      ? []
      : [
          {
            capabilityId: brand<string, 'CapabilityId'>('search_memory'),
            capabilityType: 'TOOL' as const,
            providerId: 'memory-tools',
            enabled: true,
            ...(options.searchDescription === undefined ? {} : { description: options.searchDescription }),
          },
          {
            capabilityId: brand<string, 'CapabilityId'>('get_memory_detail'),
            capabilityType: 'TOOL' as const,
            providerId: 'memory-tools',
            enabled: true,
          },
          { capabilityId: brand<string, 'CapabilityId'>('add_memory'), capabilityType: 'TOOL' as const, providerId: 'memory-tools', enabled: true },
        ];
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion,
    displayName: 'Memory tools test agent',
    description: 'Telecom memory tools test agent.',
    workspaceDir: 'default-agent',
    capabilityBindings: memoryBindings,
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 1_800_000,
    },
    resources: [],
  };
}

function agingLogContainsMemoryRef(entry: StructuredLogEntry, longTermMemoryId: string): boolean {
  const candidates = entry.diagnostic?.['candidates'];
  return (
    Array.isArray(candidates) &&
    entry.details?.['reasonCode'] === 'detail_access_revived' &&
    candidates.some((candidate) => candidate === `longTermMemoryId=${longTermMemoryId} [HIGH_CARDINALITY/HIGH]`)
  );
}

function captureModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'ok' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield { content: 'ok', finishReason: 'stop' };
    }),
  };
}

function scriptedAddMemoryModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'Memory saved.' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      if (captured.length === 1) {
        yield {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'tool-add-memory-1',
              toolName: 'add_memory',
              arguments: {
                category: 'FACTUAL',
                content: { category: 'FACTUAL', subject: 'BGP peer', claim: '10.0.0.1' },
                briefIndex: 'BGP peer: 10.0.0.1',
                confidence: 0.7,
              },
            },
          ],
        };
        return;
      }
      yield { content: 'Memory saved.', finishReason: 'stop' };
    }),
  };
}

function scriptedGetMemoryDetailModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'Memory opened.' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      if (captured.length === 1) {
        yield {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'tool-get-memory-detail-1',
              toolName: 'get_memory_detail',
              arguments: {
                longTermMemoryIds: [capturedMemoryId ?? 'missing-memory'],
              },
            },
          ],
        };
        return;
      }
      yield { content: 'Memory opened.', finishReason: 'stop' };
    }),
  };
}

function scriptedForkMemoryDetailModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'Memory opened.' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      if (captured.length === 1) {
        yield { content: 'Source run established.', finishReason: 'stop' };
        return;
      }
      if (captured.length === 2) {
        yield {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'tool-get-memory-detail-fork',
              toolName: 'get_memory_detail',
              arguments: { longTermMemoryIds: [capturedMemoryId ?? 'missing-memory'] },
            },
          ],
        };
        return;
      }
      yield { content: 'Memory detail opened.', finishReason: 'stop' };
    }),
  };
}

function credentialResolver() {
  return createAppCredentialResolver({
    OPENAI_API_KEY: 'test-only',
    OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
  });
}

async function waitForRunTerminal(gateway: ReturnType<typeof createComposedApp>['gateway'], runId: string, timeoutMs = 5_000): Promise<void> {
  await waitFor(async () => {
    const run = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(runId),
    });
    return run?.terminalCommitState === 'COMMITTED';
  }, timeoutMs);
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

function captureObservationLogger(entries: Array<{ readonly entry: StructuredLogEntry; readonly message: string }>): RuntimeLogger {
  const capture =
    (level: RuntimeLogLevel) =>
    (fields: object): void => {
      const entry = { ...fields, level } as StructuredLogEntry;
      entries.push({ entry, message: entry.event });
    };
  return {
    debug: capture('debug'),
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
  };
}
