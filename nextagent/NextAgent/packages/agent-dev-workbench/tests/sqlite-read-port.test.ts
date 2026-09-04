import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { bindRuntimeLoggerProvider } from '@nextagent/agent-common';
import { describe, expect, it } from 'vitest';
import { createSqliteAgentDevWorkbenchReadPort, type AgentDevWorkbenchAccessScope, type AgentDevWorkbenchLocalReadPort } from '../src/index.js';

describe('SQLite Agent Dev Workbench read port', () => {
  it('logs a safe diagnostic when a SQLite read fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-dev-workbench-failure-'));
    const sqliteFile = join(root, 'working-memory.sqlite');
    new DatabaseSync(sqliteFile).close();
    const errorLogs: object[] = [];
    const loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        error: (fields) => errorLogs.push(fields),
        warn() {},
        info() {},
        debug() {},
      }),
    });
    try {
      const readPort = createSqliteAgentDevWorkbenchReadPort({ sqliteFile });
      const result = await readPort.listSessions(accessScope('tenant-a', 'subject-a', ['agent-a']), {});

      expect(result).toEqual({ entries: [], detailAvailability: { status: 'unavailable', reasonCode: 'SQLITE_READ_FAILED' } });
      expect(errorLogs).toEqual([
        {
          event: 'agent_dev_workbench.sqlite_read_failed',
          safeReasonCode: 'SQLITE_SCHEMA_UNAVAILABLE',
          operation: 'list_sessions',
        },
      ]);
      expect(JSON.stringify(errorLogs)).not.toContain(sqliteFile);
      expect(JSON.stringify(errorLogs)).not.toContain('no such table');
    } finally {
      loggerBinding.unbind();
    }
  });

  it('reads local sessions, conversations, runs, graph, detail, and log evidence without mutation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-dev-workbench-'));
    const sqliteFile = join(root, 'nextagent.sqlite');
    const logDirectory = join(root, 'logs');
    const db = new DatabaseSync(sqliteFile);
    initializeSchema(db);
    seedRun(db, {
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      agentId: 'agent-a',
      sessionId: 'sess-a',
      runId: 'run-a',
      requestId: 'req-a',
      title: 'Session A',
    });
    seedFollowupRun(db, 'sess-a', 'run-a-2', 'req-a-2', 'second question');
    seedRun(db, {
      tenantId: 'tenant-b',
      subjectId: 'subject-b',
      agentId: 'agent-b',
      sessionId: 'sess-b',
      runId: 'run-b',
      requestId: 'req-b',
      title: 'Session B',
    });
    db.close();
    mkdirSync(logDirectory);
    const activeLog = join(logDirectory, 'nextagent-operational.log.1.jsonl');
    writeFileSync(
      activeLog,
      [
        '{"surface":"runtime_diagnostic","timestamp":"2026-07-08T00:00:01.000Z","runId":"run-a","requestId":"req-a","sessionId":"sess-a","agentId":"agent-a","agentVersion":"v1","requestContextId":"ctx-a","capabilityInvocationId":"cap-a","message":"safe runtime event"}',
        '{"surface":"runtime_diagnostic","timestamp":"2026-07-08T00:00:02.000Z","runId":"run-a","requestId":"req-a","sessionId":"sess-a","agentId":"agent-b","agentVersion":"v1","requestContextId":"ctx-a","capabilityInvocationId":"cap-a","message":"wrong agent"}',
        ...Array.from(
          { length: 12 },
          (_unused, index) =>
            `{"surface":"runtime_diagnostic","runId":"run-a","requestId":"req-a","sessionId":"sess-a","agentId":"agent-a","agentVersion":"v1","message":"bulk-${index}"}`,
        ),
      ].join('\n'),
      'utf8',
    );

    const rawReadPort = createSqliteAgentDevWorkbenchReadPort({
      sqliteFile,
      activeOperationalLog: () => ({ file: activeLog }),
      resolvePromptTemplate: promptTemplateResolver('prompt-a'),
      resolveAgentInventory: async () => [
        agentInventoryEntry('agent-a'),
        {
          ...agentInventoryEntry('child-agent'),
          displayName: 'Child Agent',
          userInvocable: false,
          agentInvocation: 'PARENT',
          parentAgentScope: { agentId: 'agent-a', agentVersion: 'v1', agentAssemblyRef: 'assembly-a' },
        },
        {
          ...agentInventoryEntry('invoked-agent'),
          displayName: 'Invoked Agent',
          userInvocable: false,
          agentInvocation: 'BOUND',
        },
      ],
    });
    const readPort = scopedReadPort(rawReadPort, accessScope('tenant-a', 'subject-a', ['agent-a', 'child-agent', 'invoked-agent']));
    const agents = await readPort.listAgents();
    expect(agents.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: 'agent-a', kind: 'agent', sessionCount: 1 }),
        expect.objectContaining({
          agentId: 'child-agent',
          kind: 'subagent',
          sessionCount: 0,
          parentAgentScope: expect.objectContaining({ agentId: 'agent-a' }),
        }),
        expect.objectContaining({ agentId: 'invoked-agent', kind: 'subagent', agentInvocation: 'BOUND', sessionCount: 0 }),
      ]),
    );
    expect(agents.entries.find((entry) => entry.agentId === 'invoked-agent')).not.toHaveProperty('parentAgentScope');
    const allSessions = await readPort.listSessions({});
    expect(allSessions.entries.map((entry) => entry.sessionId)).toEqual(['sess-a']);
    await expect(rawReadPort.listSessions(accessScope('tenant-b', 'subject-b', ['agent-a']), {})).resolves.toMatchObject({ entries: [] });
    await expect(rawReadPort.listSessions(accessScope('tenant-b', 'subject-b', ['agent-b']), {})).resolves.toMatchObject({
      entries: [expect.objectContaining({ sessionId: 'sess-b' })],
    });

    const filteredSessions = await readPort.listSessions({ agentId: 'agent-a', requestRunId: 'run-a' });
    expect(filteredSessions.entries).toHaveLength(1);
    expect(filteredSessions.entries[0]).toMatchObject({ agentId: 'agent-a', sessionId: 'sess-a', latestRunStatus: 'COMPLETED' });
    await expect(readPort.listSessions({ agentId: 'agent-missing' })).resolves.toMatchObject({ entries: [] });

    const conversation = await readPort.listConversation({ sessionId: 'sess-a', requestRunId: 'run-a', agentId: 'agent-a' });
    expect(conversation.messages).toEqual([expect.objectContaining({ messageId: 'msg-a', requestId: 'req-a', runId: 'run-a', content: 'hello' })]);
    await expect(readPort.listConversation({ sessionId: 'sess-a', requestRunId: 'run-a', agentId: 'agent-b' })).resolves.toMatchObject({
      messages: [],
    });
    await expect(readPort.listConversation({ sessionId: 'sess-a', requestRunId: 'run-b', agentId: 'agent-a' })).resolves.toMatchObject({
      messages: [],
    });

    const runs = await readPort.listRuns({ sessionId: 'sess-a' });
    expect(runs.entries).toEqual([
      expect.objectContaining({ runId: 'run-a-2', agentId: 'agent-a', status: 'COMPLETED', rootMessageSummary: 'second question' }),
      expect.objectContaining({ runId: 'run-a', agentId: 'agent-a', status: 'COMPLETED', rootMessageSummary: 'hello' }),
    ]);
    await expect(readPort.listRuns({ requestRunId: 'run-missing' })).resolves.toMatchObject({ entries: [] });

    const graph = await readPort.getRunGraph({ requestRunId: 'run-a' });
    expect(graph.nodes.map((node) => node.type)).toEqual(['request', 'model', 'terminal']);
    expect(graph.effectiveView).toMatchObject({
      status: 'reconstructed',
      agentId: 'agent-a',
      modelIds: ['profile-a'],
      promptTemplateRefs: ['prompt-a'],
      disclosedCapabilityIds: ['tool-a'],
      renderedToolNames: [],
    });

    const detail = await readPort.getActionDetail({ requestRunId: 'run-a', actionId: 'timeline:event-model-started-a' });
    expect(detail.safeSummary).toMatchObject({
      rawUnavailable: true,
      payload: {
        modelId: 'profile-a',
        promptTemplateRef: 'prompt-a',
        disclosedCapabilityIds: ['tool-a'],
        renderedToolNames: ['toolA'],
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        finishReason: 'stop',
        toolCallCount: 0,
      },
      effectiveView: {
        status: 'reconstructed',
        modelIds: ['profile-a'],
        promptTemplateRefs: ['prompt-a'],
        renderedToolNames: [],
      },
    });
    expect(detail.safeSummary).not.toHaveProperty('payloadKeys');
    expect(detail.safeSummary).not.toHaveProperty('usage');
    expect(JSON.stringify(detail.safeSummary.payload)).not.toMatch(/raw prompt|credential|secret|token|path/u);
    expect(detail.promptApproximation).toMatchObject({
      status: 'approximate',
      authoritative: false,
      templateRef: 'prompt-a',
      template: { templateRef: 'prompt-a', purpose: 'SYSTEM_PROMPT' },
      selectedMessageRefs: ['msg-a'],
      selectedMessages: [{ messageId: 'msg-a', role: 'USER', content: 'hello' }],
      missingMessageRefs: [],
      renderedToolNames: ['toolA'],
    });
    expect(detail.promptApproximation?.limitations).toContain('BEFORE_MODEL_INVOKE_HOOK_MUTATIONS_NOT_RECONSTRUCTED');

    const logs = await readPort.listLogEvidence({
      requestRunId: 'run-a',
      requestId: 'req-a',
      sessionId: 'sess-a',
      agentId: 'agent-a',
      agentVersion: 'v1',
      requestContextId: 'ctx-a',
      capabilityInvocationId: 'cap-a',
      fromEpochMillis: Date.parse('2026-07-08T00:00:00.000Z'),
      toEpochMillis: Date.parse('2026-07-08T00:00:01.500Z'),
    });
    expect(logs.entries).toEqual([
      expect.objectContaining({
        source: 'runtime-diagnostic-log',
        timestamp: Date.parse('2026-07-08T00:00:01.000Z'),
        message: expect.stringContaining('safe runtime event'),
        refs: expect.objectContaining({ agentId: 'agent-a', agentVersion: 'v1', capabilityInvocationId: 'cap-a' }),
      }),
    ]);
    const spoofedAgentLogs = await readPort.listLogEvidence({ requestRunId: 'run-a', agentId: 'agent-missing' });
    expect(spoofedAgentLogs.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('safe runtime event') })]),
    );
    const truncatedLogs = await readPort.listLogEvidence({ requestRunId: 'run-a', limit: 10 });
    expect(truncatedLogs.entries).toHaveLength(10);
    expect(truncatedLogs.detailAvailability).toEqual({ status: 'truncated' });

    const checkDb = new DatabaseSync(sqliteFile, { readOnly: true });
    const sessionCount = checkDb.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { readonly count: number };
    const messageCount = checkDb.prepare('SELECT COUNT(*) AS count FROM messages').get() as { readonly count: number };
    const runCount = checkDb.prepare('SELECT COUNT(*) AS count FROM request_runs').get() as { readonly count: number };
    const timelineCount = checkDb.prepare('SELECT COUNT(*) AS count FROM timeline_events').get() as { readonly count: number };
    const metricCount = checkDb.prepare('SELECT COUNT(*) AS count FROM metric_samples').get() as { readonly count: number };
    const traceCount = checkDb.prepare('SELECT COUNT(*) AS count FROM trace_spans').get() as { readonly count: number };
    const memoryCount = checkDb.prepare('SELECT COUNT(*) AS count FROM memories').get() as { readonly count: number };
    const checkpointCount = checkDb.prepare('SELECT COUNT(*) AS count FROM checkpoints').get() as { readonly count: number };
    checkDb.close();
    expect({
      sessions: sessionCount.count,
      messages: messageCount.count,
      runs: runCount.count,
      timeline: timelineCount.count,
      metrics: metricCount.count,
      traces: traceCount.count,
      memories: memoryCount.count,
      checkpoints: checkpointCount.count,
    }).toEqual({
      sessions: 2,
      messages: 3,
      runs: 3,
      timeline: 4,
      metrics: 1,
      traces: 1,
      memories: 1,
      checkpoints: 1,
    });
  });

  it('reads only the identity supplied as current-active and returns no evidence across archive-only and rotation-race states', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-dev-workbench-active-only-'));
    const sqliteFile = join(root, 'nextagent.sqlite');
    const logDirectory = join(root, 'logs');
    const db = new DatabaseSync(sqliteFile);
    initializeSchema(db);
    seedRun(db, {
      tenantId: 'tenant-active',
      subjectId: 'subject-active',
      agentId: 'agent-active',
      sessionId: 'session-active',
      runId: 'run-active',
      requestId: 'request-active',
      title: 'Active only',
    });
    db.close();
    mkdirSync(logDirectory);
    const closed = join(logDirectory, 'nextagent-operational.log.1.jsonl.gz');
    const active = join(logDirectory, 'nextagent-operational.log.2.jsonl');
    const nextActive = join(logDirectory, 'nextagent-operational.log.3.jsonl');
    const otherDomain = join(logDirectory, 'nextagent-metrics.2026-07-15.1.ndjson');
    const line =
      '{"surface":"runtime_diagnostic","runId":"run-active","requestId":"request-active","sessionId":"session-active","agentId":"agent-active","agentVersion":"v1"}\n';
    writeFileSync(closed, line, 'utf8');
    writeFileSync(active, line, 'utf8');
    writeFileSync(nextActive, line, 'utf8');
    writeFileSync(otherDomain, line, 'utf8');
    const scope = accessScope('tenant-active', 'subject-active', ['agent-active']);

    const archiveOnly = createSqliteAgentDevWorkbenchReadPort({ sqliteFile });
    await expect(archiveOnly.listLogEvidence(scope, { requestRunId: 'run-active' })).resolves.toMatchObject({
      entries: [],
      detailAvailability: { status: 'unavailable', reasonCode: 'LOG_ACTIVE_SEGMENT_UNAVAILABLE' },
    });

    let providerCalls = 0;
    const rotationRace = createSqliteAgentDevWorkbenchReadPort({
      sqliteFile,
      activeOperationalLog: () => ({ file: providerCalls++ === 0 ? active : nextActive }),
    });
    await expect(rotationRace.listLogEvidence(scope, { requestRunId: 'run-active' })).resolves.toMatchObject({
      entries: [],
      detailAvailability: { status: 'partial', reasonCode: 'NO_MATCHING_ENTRIES' },
    });

    const stable = createSqliteAgentDevWorkbenchReadPort({ sqliteFile, activeOperationalLog: () => ({ file: active }) });
    const evidence = await stable.listLogEvidence(scope, { requestRunId: 'run-active' });
    expect(evidence.entries).toHaveLength(1);
    expect(evidence.entries[0]?.message).not.toContain('nextagent-metrics');
  });

  it('reconstructs graph nodes from timeline facts, marks missing facts, and never builds graph from logs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-dev-workbench-graph-'));
    const sqliteFile = join(root, 'nextagent.sqlite');
    const logDirectory = join(root, 'logs');
    const db = new DatabaseSync(sqliteFile);
    initializeSchema(db);
    seedRunSkeleton(db, 'run-graph');
    insertTimelineEvent(db, 'run-graph', 1, 'request-accepted', 'REQUEST_ACCEPTED', { attempt: 1, status: 'ACCEPTED' });
    insertTimelineEvent(db, 'run-graph', 2, 'planning', 'PLANNING_STARTED', {});
    insertTimelineEvent(db, 'run-graph', 3, 'policy', 'POLICY_APPLIED', {
      policyId: 'policy-a',
      policyVersion: 'v1',
      policyDomain: 'ROUTING',
      policyPoint: 'ROUTING',
      outcome: 'ALLOW',
      reasonCode: 'ROUTE_SELECTED',
    });
    insertTimelineEvent(db, 'run-graph', 4, 'context', 'USER_INPUT_REQUIRED', {});
    insertTimelineEvent(db, 'run-graph', 5, 'context-compacted', 'CONTEXT_COMPACTED', {});
    insertTimelineEvent(db, 'run-graph', 6, 'hook', 'HOOK_INVOKED', {
      hookInvocationId: 'hook-invocation-a',
      hookId: 'terminal-hook',
      stage: 'BEFORE_AGENT_TERMINAL',
      kind: 'SYSTEM',
      effects: { emittedEvents: 0 },
      executionStrategy: 'CONTINUE',
      status: 'SUCCESS',
      durationMs: 3,
      outcome: 'PASS',
      idempotencyKey: 'idem-hook-a',
    });
    insertTimelineEvent(db, 'run-graph', 7, 'stream', 'DEGRADATION_NOTICE', {});
    insertTimelineEvent(db, 'run-graph', 8, 'model', 'MODEL_INVOCATION_STARTED', {
      stepId: 'turn-1',
      modelId: 'profile-graph',
      promptTemplateRef: 'prompt-graph',
      selectedMessageRefs: ['message-prompt-second', 'message-prompt-first', 'message-prompt-missing'],
      disclosedCapabilityIds: ['Read', 'Bash', 'telecom-diagnosis', 'network-specialist'],
    });
    insertTimelineEvent(db, 'run-graph', 9, 'thinking', 'LLM_THINKING_DELTA', { stepId: 'turn-1', reasoning: 'hidden reasoning text' });
    insertTimelineEvent(db, 'run-graph', 10, 'content-delta', 'LLM_CONTENT_DELTA', { stepId: 'turn-1', content: 'raw model output' });
    insertTimelineEvent(db, 'run-graph', 11, 'capability-no-gateway', 'CAPABILITY_COMPLETED', {});
    insertTimelineEvent(db, 'run-graph', 12, 'capability-gateway-started', 'CAPABILITY_STARTED', {
      capabilityId: 'Read',
      toolCallId: 'call-read',
      capabilityKind: 'TOOL',
      providerKind: 'BUILTIN',
      providerId: 'builtin-tools',
      version: '1.0.0',
      toolName: 'Read',
      stepId: 'turn-1',
      toolBatchExecutionMode: 'PARALLEL',
      toolBatchOrdinal: 1,
      toolBatchSize: 2,
      timeoutMs: 1000,
      argumentKeys: ['file_path'],
      argumentSizeBucket: 'small',
    });
    insertTimelineEvent(db, 'run-graph', 13, 'capability-gateway', 'CAPABILITY_COMPLETED', {
      capabilityId: 'Read',
      toolCallId: 'call-read',
      status: 'FAILED',
      capabilityKind: 'TOOL',
      providerKind: 'BUILTIN',
      providerId: 'builtin-tools',
      version: '1.0.0',
      toolName: 'Read',
      stepId: 'turn-1',
      timeoutMs: 1000,
      argumentKeys: ['file_path'],
      argumentSizeBucket: 'small',
      generatedMessageCount: 1,
      artifactCount: 0,
      resultRefPresent: true,
      fallbackTriggered: false,
      safeResultSummary: { status: 'FAILED' },
      gatewayOperations: [
        {
          gatewayKind: 'oss-inventory',
          operation: 'read-ne-summary',
          status: 'FAILED',
          durationMs: 24,
          resultCountBucket: '0',
          safeErrorCode: 'OSS_TIMEOUT',
          safeErrorCategory: 'UNAVAILABLE',
        },
      ],
    });
    insertTimelineEvent(db, 'run-graph', 13, 'capability-gateway', 'CAPABILITY_COMPLETED', {
      capabilityId: 'Read',
      toolCallId: 'call-read',
      status: 'FAILED',
      capabilityKind: 'TOOL',
      providerKind: 'BUILTIN',
      providerId: 'builtin-tools',
      version: '1.0.0',
      toolName: 'Read',
    });
    insertMessage(
      db,
      'run-graph',
      'assistant-tool-use',
      'ASSISTANT',
      {
        toolCalls: [
          { toolCallId: 'call-read', toolName: 'Read', arguments: { file_path: 'C:/workspace/read.txt', limit: 20 } },
          { toolCallId: 'call-other', toolName: 'Bash', arguments: { command: `npm run build\n${'x'.repeat(180)}` } },
          { toolCallId: 'call-agent', toolName: 'Agent', arguments: { agentId: 'child-agent', prompt: 'diagnose child task' } },
          { toolCallId: 'call-agent-missing', toolName: 'Agent', arguments: { agentId: 'missing-child', prompt: 'must not attach another child' } },
        ],
      },
      { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['call-read', 'call-other', 'call-agent', 'call-agent-missing'] },
    );
    insertMessage(
      db,
      'run-graph',
      'capability-result-read',
      'CAPABILITY_RESULT',
      {
        toolCallId: 'call-read',
        toolName: 'Read',
        payload: { content: 'raw file content', totalLines: 1 },
      },
      { kind: 'CAPABILITY_RESULT', toolCallId: 'call-read', toolName: 'Read' },
    );
    insertMessage(
      db,
      'run-graph',
      'capability-result-other',
      'CAPABILITY_RESULT',
      {
        toolCallId: 'call-other',
        toolName: 'Bash',
        payload: { stdout: 'must-not-leak' },
      },
      { kind: 'CAPABILITY_RESULT', toolCallId: 'call-other', toolName: 'Bash' },
    );
    insertMessage(db, 'run-graph', 'prompt-first', 'USER', { text: 'first selected message' }, {});
    insertMessage(db, 'run-graph', 'prompt-second', 'ASSISTANT', { text: 'second selected message' }, {});
    insertTimelineEvent(db, 'run-graph', 14, 'capability-bash-started', 'CAPABILITY_STARTED', {
      capabilityId: 'Bash',
      toolCallId: 'call-other',
      capabilityKind: 'TOOL',
      providerKind: 'BUILTIN',
      providerId: 'builtin-tools',
      version: '1.0.0',
      toolName: 'Bash',
      stepId: 'turn-1',
      toolBatchExecutionMode: 'PARALLEL',
      toolBatchOrdinal: 2,
      toolBatchSize: 2,
      argumentKeys: ['command'],
      argumentSizeBucket: 'large',
    });
    insertTimelineEvent(db, 'run-graph', 15, 'capability-bash', 'CAPABILITY_COMPLETED', {
      capabilityId: 'Bash',
      toolCallId: 'call-other',
      capabilityKind: 'TOOL',
      providerKind: 'BUILTIN',
      providerId: 'builtin-tools',
      version: '1.0.0',
      toolName: 'Bash',
      status: 'SUCCEEDED',
    });
    insertMessage(
      db,
      'run-graph',
      'capability-result-agent',
      'CAPABILITY_RESULT',
      {
        toolCallId: 'call-agent',
        toolName: 'Agent',
        payload: { agentId: 'child-agent', status: 'completed', result: { text: 'child diagnosis complete' } },
      },
      { kind: 'CAPABILITY_RESULT', toolCallId: 'call-agent', toolName: 'Agent' },
    );
    insertMessage(
      db,
      'run-graph',
      'capability-result-agent-missing',
      'CAPABILITY_RESULT',
      {
        toolCallId: 'call-agent-missing',
        toolName: 'Agent',
        payload: { agentId: 'missing-child', status: 'failed' },
      },
      { kind: 'CAPABILITY_RESULT', toolCallId: 'call-agent-missing', toolName: 'Agent' },
    );
    insertTimelineEvent(db, 'run-graph', 16, 'subagent-started', 'CAPABILITY_STARTED', {
      capabilityId: 'child-agent',
      toolCallId: 'call-agent',
      capabilityKind: 'AGENT',
      providerKind: 'LOCAL_DIRECTORY',
      providerId: 'local-subagents',
      version: 'v1',
      toolName: 'Agent',
      stepId: 'turn-2',
      argumentKeys: ['agentId', 'prompt'],
      argumentSizeBucket: 'small',
    });
    insertTimelineEvent(db, 'run-graph', 17, 'subagent', 'CAPABILITY_COMPLETED', {
      capabilityId: 'child-agent',
      toolCallId: 'call-agent',
      capabilityKind: 'AGENT',
      providerKind: 'LOCAL_DIRECTORY',
      providerId: 'local-subagents',
      version: 'v1',
      toolName: 'Agent',
      status: 'SUCCEEDED',
    });
    insertTimelineEvent(db, 'run-graph', 18, 'subagent-missing-started', 'CAPABILITY_STARTED', {
      capabilityId: 'missing-child',
      toolCallId: 'call-agent-missing',
      capabilityKind: 'AGENT',
      providerKind: 'LOCAL_DIRECTORY',
      providerId: 'local-subagents',
      version: 'v1',
      toolName: 'Agent',
      stepId: 'turn-3',
      argumentKeys: ['agentId', 'prompt'],
      argumentSizeBucket: 'small',
    });
    insertTimelineEvent(db, 'run-graph', 19, 'subagent-missing', 'CAPABILITY_COMPLETED', {
      capabilityId: 'missing-child',
      toolCallId: 'call-agent-missing',
      capabilityKind: 'AGENT',
      providerKind: 'LOCAL_DIRECTORY',
      providerId: 'local-subagents',
      version: 'v1',
      toolName: 'Agent',
      status: 'FAILED',
    });
    insertSubagentChild(db, 'run-graph', 'call-agent', 'child-agent', 'child-session', 'child-run');
    insertTimelineEvent(db, 'run-graph', 20, 'terminal', 'REQUEST_COMPLETED', { terminalMessageId: 'assistant-a', content: 'raw terminal content' });
    seedRunSkeleton(db, 'run-partial');
    seedRunSkeleton(db, 'run-truncated');
    for (let sequence = 1; sequence <= 501; sequence += 1) {
      insertTimelineEvent(db, 'run-truncated', sequence, `model-${sequence}`, 'MODEL_INVOCATION_STARTED', {});
    }
    seedRunSkeleton(db, 'run-current-view');
    insertTimelineEvent(db, 'run-current-view', 1, 'current-view', 'MODEL_INVOCATION_STARTED', { effectiveViewStatus: 'current-view' });
    seedRunSkeleton(db, 'run-parallel-five');
    insertTimelineEvent(db, 'run-parallel-five', 1, 'parallel-model', 'MODEL_INVOCATION_COMPLETED', { stepId: 'turn-1', toolCallCount: 5 });
    for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
      insertTimelineEvent(db, 'run-parallel-five', ordinal * 2, `parallel-${ordinal}-started`, 'CAPABILITY_STARTED', {
        capabilityId: `Read${ordinal}`,
        toolCallId: `call-${ordinal}`,
        capabilityKind: 'TOOL',
        providerKind: 'BUILTIN',
        providerId: 'builtin-tools',
        toolName: `Read${ordinal}`,
        stepId: 'turn-1',
        timeoutMs: 1000,
        argumentKeys: [],
        argumentSizeBucket: 'small',
        toolBatchExecutionMode: 'PARALLEL',
        toolBatchOrdinal: ordinal,
        toolBatchSize: 5,
      });
      insertTimelineEvent(db, 'run-parallel-five', ordinal * 2 + 1, `parallel-${ordinal}`, 'CAPABILITY_COMPLETED', {
        capabilityId: `Read${ordinal}`,
        toolCallId: `call-${ordinal}`,
        status: 'SUCCEEDED',
      });
    }
    insertTimelineEvent(db, 'run-parallel-five', 12, 'parallel-terminal', 'REQUEST_COMPLETED', {});
    db.close();
    mkdirSync(logDirectory);
    const activeLog = join(logDirectory, 'nextagent-operational.log.1.jsonl');
    writeFileSync(
      activeLog,
      '{"surface":"runtime_diagnostic","runId":"run-graph","type":"CAPABILITY_COMPLETED","gatewayOperations":[{"gatewayKind":"log-only"}]}\n',
      'utf8',
    );

    const readPort = scopedReadPort(
      createSqliteAgentDevWorkbenchReadPort({
        sqliteFile,
        activeOperationalLog: () => ({ file: activeLog }),
        resolveAgentConfiguration: graphAgentConfigurationResolver('assembly-graph'),
        resolveCapabilityDescriptors: async () => [
          { capabilityId: 'Read', kind: 'TOOL' },
          { capabilityId: 'Bash', kind: 'TOOL' },
          { capabilityId: 'telecom-diagnosis', kind: 'SKILL' },
          { capabilityId: 'network-specialist', kind: 'AGENT' },
        ],
        resolvePromptTemplate: promptTemplateResolver('prompt-graph'),
      }),
      accessScope('tenant-graph', 'subject-graph', ['agent-graph', 'child-agent', 'missing-child']),
    );
    const graph = await readPort.getRunGraph({ requestRunId: 'run-graph' });

    expect(graph.nodes.filter((node) => node.type === 'request')).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({
      actionId: 'run:run-graph:request',
      refs: {
        eventId: 'event-request-accepted',
        timelineType: 'REQUEST_ACCEPTED',
        sequence: 1,
      },
    });
    const requestDetail = await readPort.getActionDetail({ requestRunId: 'run-graph', actionId: 'run:run-graph:request' });
    expect(requestDetail.safeSummary).toMatchObject({
      payload: {
        attempt: 1,
        status: 'ACCEPTED',
      },
    });
    expect(graph.nodes.map((node) => node.type)).toEqual([
      'request',
      'scheduler',
      'policy',
      'context',
      'context_compaction',
      'hook',
      'stream',
      'model',
      'capability',
      'capability',
      'gateway',
      'capability',
      'subagent',
      'subagent',
      'terminal',
    ]);
    expect(graph.nodes.map((node) => node.label)).not.toContain('LLM_THINKING_DELTA');
    expect(graph.nodes.map((node) => node.label)).not.toContain('LLM_CONTENT_DELTA');
    expect(graph.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(['Capability completed', 'Read', 'BEFORE_AGENT_TERMINAL']));
    expect(graph.effectiveView).toMatchObject({
      modelIds: ['profile-graph'],
      defaultModelId: 'profile-graph',
      renderedToolNames: ['Read', 'Bash'],
      skillCapabilityIds: ['telecom-diagnosis'],
      agentCapabilityIds: ['network-specialist'],
      agentConfigurationAvailability: { status: 'available' },
      agentConfiguration: {
        agentAssemblyRef: 'assembly-graph',
        displayName: 'Graph Agent',
        runtimeSettings: { maxTurns: 8, maxToolCallsPerTurn: 30 },
        workspacePolicy: { schemaVersion: 'v1', isolationMode: 'session' },
      },
    });
    expect(graph.edges).toContainEqual({
      from: 'timeline:event-capability-gateway',
      to: 'timeline:event-capability-gateway:gateway:1',
      kind: 'child',
    });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'timeline:event-capability-no-gateway', to: 'timeline:event-capability-gateway', kind: 'parallel' },
        { from: 'timeline:event-capability-no-gateway', to: 'timeline:event-capability-bash', kind: 'parallel' },
        { from: 'timeline:event-capability-gateway', to: 'timeline:event-subagent', kind: 'parallel' },
        { from: 'timeline:event-capability-bash', to: 'timeline:event-subagent', kind: 'parallel' },
      ]),
    );
    expect(graph.edges).not.toContainEqual({
      from: 'timeline:event-capability-gateway',
      to: 'timeline:event-capability-bash',
      kind: 'sequence',
    });
    expect(graph.nodes.some((node) => node.type === 'gateway' && node.refs.gatewayKind === 'log-only')).toBe(false);

    const capabilityWithoutGateway = await readPort.getActionDetail({ requestRunId: 'run-graph', actionId: 'timeline:event-capability-no-gateway' });
    expect(capabilityWithoutGateway.refs).toMatchObject({ gatewayOperationsAvailability: 'unavailable' });
    expect(capabilityWithoutGateway.safeSummary).toMatchObject({
      effectiveView: {
        status: 'reconstructed',
      },
    });
    const capabilityWithGateway = await readPort.getActionDetail({ requestRunId: 'run-graph', actionId: 'timeline:event-capability-gateway' });
    expect(capabilityWithGateway.safeSummary).toMatchObject({
      payload: {
        capabilityKind: 'TOOL',
        providerKind: 'BUILTIN',
        providerId: 'builtin-tools',
        toolName: 'Read',
        argumentKeys: ['file_path'],
        generatedMessageCount: 1,
        artifactCount: 0,
        resultRefPresent: true,
        safeResultSummary: { status: 'FAILED' },
      },
    });
    expect(capabilityWithGateway.input).toEqual({ file_path: 'C:/workspace/read.txt', limit: 20 });
    expect(capabilityWithGateway.output).toEqual({ content: 'raw file content', totalLines: 1 });
    expect(capabilityWithGateway.detailAvailability).toEqual({ status: 'available' });
    expect(capabilityWithGateway.safeSummary.rawUnavailable).toBe(false);
    expect(JSON.stringify({ input: capabilityWithGateway.input, output: capabilityWithGateway.output })).not.toContain('must-not-leak');
    expect(JSON.stringify(capabilityWithGateway)).not.toContain('npm run build');
    const bashNode = graph.nodes.find((node) => node.actionId === 'timeline:event-capability-bash');
    expect(bashNode?.refs.commandPreview).toMatch(/^npm run build x+\.\.\.$/u);
    expect(String(bashNode?.refs.commandPreview)).not.toContain('\n');
    expect(String(bashNode?.refs.commandPreview)).toHaveLength(160);
    const bashDetail = await readPort.getActionDetail({ requestRunId: 'run-graph', actionId: 'timeline:event-capability-bash' });
    expect(bashDetail.input).toEqual({ command: `npm run build\n${'x'.repeat(180)}` });
    expect(bashDetail.output).toEqual({ stdout: 'must-not-leak' });
    const modelDetail = await readPort.getActionDetail({ requestRunId: 'run-graph', actionId: 'timeline:event-model' });
    expect(modelDetail.promptApproximation).toMatchObject({
      status: 'partial',
      authoritative: false,
      templateRef: 'prompt-graph',
      selectedMessageRefs: ['message-prompt-second', 'message-prompt-first', 'message-prompt-missing'],
      selectedMessages: [
        { messageId: 'message-prompt-second', role: 'ASSISTANT' },
        { messageId: 'message-prompt-first', role: 'USER' },
      ],
      missingMessageRefs: ['message-prompt-missing'],
      renderedToolNames: ['Read', 'Bash'],
    });
    expect(modelDetail.promptApproximation?.limitations).toEqual(
      expect.arrayContaining(['SELECTED_MESSAGE_MISSING', 'DYNAMIC_TEMPLATE_VARIABLES_NOT_REPLAYED', 'TOOL_SCHEMAS_NOT_RECONSTRUCTED']),
    );
    const subagentDetail = await readPort.getActionDetail({ requestRunId: 'run-graph', actionId: 'timeline:event-subagent' });
    expect(subagentDetail.refs).toMatchObject({
      targetAgentId: 'child-agent',
      childLinkAvailability: 'available',
      childAgentId: 'child-agent',
      childSessionId: 'child-session',
      childRunId: 'child-run',
      childRunStatus: 'COMPLETED',
    });
    expect(subagentDetail.input).toEqual({ agentId: 'child-agent', prompt: 'diagnose child task' });
    expect(subagentDetail.output).toEqual({ agentId: 'child-agent', status: 'completed', result: { text: 'child diagnosis complete' } });
    expect(subagentDetail.safeSummary.effectiveView).toMatchObject({
      status: 'reconstructed',
      capabilityId: 'child-agent',
      capabilityKind: 'AGENT',
      targetAgentId: 'child-agent',
      childRunId: 'child-run',
    });
    const missingSubagentDetail = await readPort.getActionDetail({ requestRunId: 'run-graph', actionId: 'timeline:event-subagent-missing' });
    expect(missingSubagentDetail.refs).toMatchObject({
      targetAgentId: 'missing-child',
      childLinkAvailability: 'unavailable',
      childLinkReasonCode: 'SUBAGENT_CHILD_NOT_FOUND',
    });
    expect(JSON.stringify(missingSubagentDetail.refs)).not.toContain('child-run');
    const policyDetail = await readPort.getActionDetail({ requestRunId: 'run-graph', actionId: 'timeline:event-policy' });
    expect(policyDetail.safeSummary).toMatchObject({
      payload: {
        policyId: 'policy-a',
        policyVersion: 'v1',
        policyDomain: 'ROUTING',
        policyPoint: 'ROUTING',
        outcome: 'ALLOW',
        reasonCode: 'ROUTE_SELECTED',
      },
    });
    const hookDetail = await readPort.getActionDetail({ requestRunId: 'run-graph', actionId: 'timeline:event-hook' });
    expect(hookDetail.safeSummary).toMatchObject({
      payload: {
        hookInvocationId: 'hook-invocation-a',
        hookId: 'terminal-hook',
        stage: 'BEFORE_AGENT_TERMINAL',
        kind: 'SYSTEM',
        effects: { emittedEvents: 0 },
        executionStrategy: 'CONTINUE',
        status: 'SUCCESS',
        durationMs: 3,
        outcome: 'PASS',
        idempotencyKey: 'idem-hook-a',
      },
    });
    const thinkingDetail = await readPort.getActionDetail({ requestRunId: 'run-graph', actionId: 'timeline:event-thinking' });
    expect(thinkingDetail.detailAvailability).toEqual({ status: 'unavailable', reasonCode: 'ACTION_NOT_FOUND' });
    const contentDetail = await readPort.getActionDetail({ requestRunId: 'run-graph', actionId: 'timeline:event-content-delta' });
    expect(contentDetail.detailAvailability).toEqual({ status: 'unavailable', reasonCode: 'ACTION_NOT_FOUND' });
    const terminalDetail = await readPort.getActionDetail({ requestRunId: 'run-graph', actionId: 'timeline:event-terminal' });
    expect(terminalDetail.safeSummary).toMatchObject({
      payload: {
        terminalMessageId: 'assistant-a',
        contentSummary: { charCount: 20, redacted: true, reasonCode: 'RAW_CONTENT_NOT_EXPOSED' },
      },
    });

    const partialGraph = await readPort.getRunGraph({ requestRunId: 'run-partial' });
    expect(partialGraph.nodes.map((node) => node.type)).toEqual(['request']);
    expect(partialGraph.detailAvailability).toEqual({ status: 'partial', reasonCode: 'TIMELINE_UNAVAILABLE' });
    expect(partialGraph.effectiveView.status).toBe('partial');

    const currentViewGraph = await readPort.getRunGraph({ requestRunId: 'run-current-view' });
    expect(currentViewGraph.effectiveView.status).toBe('current-view');
    expect(currentViewGraph.effectiveView.modelIds).toEqual(['profile-graph']);
    expect(currentViewGraph.effectiveView.defaultModelId).toBe('profile-graph');

    const parallelFiveGraph = await readPort.getRunGraph({ requestRunId: 'run-parallel-five' });
    const parallelFiveNodes = parallelFiveGraph.nodes.filter((node) => node.refs.toolBatchExecutionMode === 'PARALLEL');
    expect(parallelFiveNodes).toHaveLength(5);
    expect(parallelFiveGraph.edges.filter((edge) => edge.kind === 'parallel')).toHaveLength(10);
    expect(parallelFiveGraph.edges.filter((edge) => edge.kind === 'sequence')).toEqual([
      { from: 'run:run-parallel-five:request', to: 'timeline:event-parallel-model', kind: 'sequence' },
    ]);

    const truncatedGraph = await readPort.getRunGraph({ requestRunId: 'run-truncated' });
    expect(truncatedGraph.nodes).toHaveLength(501);
    expect(truncatedGraph.detailAvailability).toEqual({ status: 'truncated', reasonCode: 'TIMELINE_EVENT_LIMIT_EXCEEDED' });

    const mismatchedReadPort = scopedReadPort(
      createSqliteAgentDevWorkbenchReadPort({
        sqliteFile,
        resolveAgentConfiguration: graphAgentConfigurationResolver('different-assembly'),
      }),
      accessScope('tenant-graph', 'subject-graph', ['agent-graph']),
    );
    const mismatchedGraph = await mismatchedReadPort.getRunGraph({ requestRunId: 'run-graph' });
    expect(mismatchedGraph.effectiveView.agentConfiguration).toBeUndefined();
    expect(mismatchedGraph.effectiveView.agentConfigurationAvailability).toEqual({
      status: 'unavailable',
      reasonCode: 'AGENT_ASSEMBLY_REF_MISMATCH',
    });
  }, 60_000);
});

function accessScope(tenantId: string, subjectId: string, allowedAgentIds: readonly string[]): AgentDevWorkbenchAccessScope {
  return { tenantId, subjectId, allowedAgentIds };
}

function scopedReadPort(readPort: AgentDevWorkbenchLocalReadPort, scope: AgentDevWorkbenchAccessScope) {
  return {
    listAgents: () => readPort.listAgents(scope),
    listSessions: (query: Parameters<AgentDevWorkbenchLocalReadPort['listSessions']>[1]) => readPort.listSessions(scope, query),
    listConversation: (query: Parameters<AgentDevWorkbenchLocalReadPort['listConversation']>[1]) => readPort.listConversation(scope, query),
    listRuns: (query: Parameters<AgentDevWorkbenchLocalReadPort['listRuns']>[1]) => readPort.listRuns(scope, query),
    getRunGraph: (query: Parameters<AgentDevWorkbenchLocalReadPort['getRunGraph']>[1]) => readPort.getRunGraph(scope, query),
    getActionDetail: (query: Parameters<AgentDevWorkbenchLocalReadPort['getActionDetail']>[1]) => readPort.getActionDetail(scope, query),
    listLogEvidence: (query: Parameters<AgentDevWorkbenchLocalReadPort['listLogEvidence']>[1]) => readPort.listLogEvidence(scope, query),
  };
}

function graphAgentConfigurationResolver(agentAssemblyRef: string) {
  const assembly = {
    agentId: 'agent-graph',
    agentType: 'GENERAL',
    agentVersion: 'v1',
    agentAssemblyRef,
    displayName: 'Graph Agent',
    description: 'Graph projection fixture',
    workspacePolicy: {
      schemaVersion: 'v1',
      isolationMode: 'session',
      roots: [{ kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' }],
    },
    modelIds: ['profile-graph'],
    defaultModelId: 'profile-graph',
    capabilityBindings: [
      { capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools' },
      { capabilityId: 'telecom-diagnosis', capabilityType: 'SKILL', providerId: 'builtin-skills' },
      { capabilityId: 'network-specialist', capabilityType: 'AGENT', providerId: 'builtin-agents' },
    ],
    hooks: [{ hookId: 'terminal-hook', stages: ['BEFORE_AGENT_TERMINAL'] }],
    policies: [{ policyPointId: 'routing', pluginId: 'builtin', policyId: 'policy-a' }],
    userInvocable: true,
    agentInvocation: 'NONE',
    runtimeSettings: { maxTurns: 8, maxToolCallsPerTurn: 30 },
  };
  return async () => assembly;
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE sessions (
      tenant_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      parent_session_id TEXT,
      parent_run_id TEXT,
      parent_request_id TEXT,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      idempotency_key TEXT
    );
    CREATE TABLE request_runs (
      tenant_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER NOT NULL,
      idempotency_key TEXT,
      json TEXT NOT NULL
    );
    CREATE TABLE messages (
      tenant_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      run_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      content_type TEXT NOT NULL,
      metadata TEXT NOT NULL,
      visible INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE timeline_events (
      tenant_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE TABLE metric_samples (id TEXT NOT NULL);
    CREATE TABLE trace_spans (id TEXT NOT NULL);
    CREATE TABLE memories (id TEXT NOT NULL);
    CREATE TABLE checkpoints (id TEXT NOT NULL);
  `);
}

function seedRun(
  db: DatabaseSync,
  input: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly agentId: string;
    readonly sessionId: string;
    readonly runId: string;
    readonly requestId: string;
    readonly title: string;
  },
): void {
  const suffix = input.runId.endsWith('a') ? 'a' : 'b';
  db.prepare('INSERT INTO sessions(tenant_id, subject_id, agent_id, session_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    input.tenantId,
    input.subjectId,
    input.agentId,
    input.sessionId,
    input.title,
    1,
    4,
  );
  db.prepare(
    'INSERT INTO request_runs(tenant_id, subject_id, run_id, session_id, request_id, agent_id, status, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    input.tenantId,
    input.subjectId,
    input.runId,
    input.sessionId,
    input.requestId,
    input.agentId,
    'COMPLETED',
    4,
    JSON.stringify({
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      agentId: input.agentId,
      agentVersion: 'v1',
      sessionId: input.sessionId,
      requestId: input.requestId,
      runId: input.runId,
      agentAssemblyRef: `assembly-${suffix}`,
      attempt: 1,
      status: 'COMPLETED',
      terminalCommitState: 'COMMITTED',
      version: 1,
      createdAt: 1,
      updatedAt: 4,
    }),
  );
  db.prepare(
    'INSERT INTO messages(tenant_id, subject_id, agent_id, message_id, session_id, request_id, run_id, role, content, content_type, metadata, visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    input.tenantId,
    input.subjectId,
    input.agentId,
    `msg-${suffix}`,
    input.sessionId,
    input.requestId,
    input.runId,
    'USER',
    'hello',
    'TEXT',
    '{}',
    1,
    2,
  );
  db.prepare(
    'INSERT INTO timeline_events(tenant_id, subject_id, agent_id, session_id, sequence, event_id, request_id, run_id, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    input.tenantId,
    input.subjectId,
    input.agentId,
    input.sessionId,
    1,
    `event-model-started-${suffix}`,
    input.requestId,
    input.runId,
    JSON.stringify({
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      agentId: input.agentId,
      agentVersion: 'v1',
      eventId: `event-model-started-${suffix}`,
      sessionId: input.sessionId,
      requestId: input.requestId,
      runId: input.runId,
      requestContextId: `ctx-${suffix}`,
      sequence: 1,
      type: 'MODEL_INVOCATION_STARTED',
      inlinePayload: {
        stepId: 'turn-1',
        modelId: `profile-${suffix}`,
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        finishReason: 'stop',
        toolCallCount: 0,
        promptTemplateRef: `prompt-${suffix}`,
        selectedMessageRefs: [`msg-${suffix}`],
        disclosedCapabilityIds: [`tool-${suffix}`],
        renderedToolNames: [`tool${suffix.toUpperCase()}`],
        rawPrompt: 'raw prompt must not appear',
        credentialRef: 'env:secret-token',
        localPath: 'C:/secret/path',
      },
      createdAt: 2,
    }),
  );
  db.prepare(
    'INSERT INTO timeline_events(tenant_id, subject_id, agent_id, session_id, sequence, event_id, request_id, run_id, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    input.tenantId,
    input.subjectId,
    input.agentId,
    input.sessionId,
    2,
    `event-terminal-${suffix}`,
    input.requestId,
    input.runId,
    JSON.stringify({
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      agentId: input.agentId,
      agentVersion: 'v1',
      eventId: `event-terminal-${suffix}`,
      sessionId: input.sessionId,
      requestId: input.requestId,
      runId: input.runId,
      requestContextId: `ctx-${suffix}`,
      sequence: 2,
      type: 'REQUEST_COMPLETED',
      inlinePayload: {},
      createdAt: 4,
    }),
  );
  if (suffix === 'a') {
    for (const table of ['metric_samples', 'trace_spans', 'memories', 'checkpoints']) {
      db.prepare(`INSERT INTO ${table}(id) VALUES (?)`).run(`${table}-guard`);
    }
  }
}

function promptTemplateResolver(templateRef: string) {
  return async (query: { readonly promptTemplateRef: string }) =>
    query.promptTemplateRef === templateRef
      ? {
          templateId: 'system',
          templateRef,
          purpose: 'SYSTEM_PROMPT',
          sourceLayer: 'agent',
          sections: [{ id: 'identity', content: 'You are {{agentName}}.', variables: [{ name: 'agentName', optional: false }] }],
        }
      : undefined;
}

function seedFollowupRun(db: DatabaseSync, sessionId: string, runId: string, requestId: string, content: string): void {
  db.prepare(
    'INSERT INTO request_runs(tenant_id, subject_id, run_id, session_id, request_id, agent_id, status, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'tenant-a',
    'subject-a',
    runId,
    sessionId,
    requestId,
    'agent-a',
    'COMPLETED',
    5,
    JSON.stringify({
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      agentId: 'agent-a',
      agentVersion: 'v1',
      sessionId,
      requestId,
      runId,
      agentAssemblyRef: 'assembly-a',
      attempt: 1,
      status: 'COMPLETED',
      terminalCommitState: 'COMMITTED',
      version: 1,
      createdAt: 5,
      updatedAt: 5,
    }),
  );
  db.prepare(
    'INSERT INTO messages(tenant_id, subject_id, agent_id, message_id, session_id, request_id, run_id, role, content, content_type, metadata, visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('tenant-a', 'subject-a', 'agent-a', `msg-${runId}`, sessionId, requestId, runId, 'USER', content, 'TEXT', '{}', 1, 5);
}

function agentInventoryEntry(agentId: string) {
  return {
    agentId,
    agentType: 'GENERAL',
    agentVersion: 'v1',
    agentAssemblyRef: `assembly-${agentId === 'agent-a' ? 'a' : agentId}`,
    displayName: agentId,
    description: `${agentId} fixture`,
    sourceKind: 'LOCAL',
    workspacePolicy: { schemaVersion: 'v1', isolationMode: 'session', roots: [] },
    modelIds: ['profile-a'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: {},
  };
}

function seedRunSkeleton(db: DatabaseSync, runId: string): void {
  db.prepare('INSERT INTO sessions(tenant_id, subject_id, agent_id, session_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'tenant-graph',
    'subject-graph',
    'agent-graph',
    `sess-${runId}`,
    `Session ${runId}`,
    1,
    4,
  );
  db.prepare(
    'INSERT INTO request_runs(tenant_id, subject_id, run_id, session_id, request_id, agent_id, status, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'tenant-graph',
    'subject-graph',
    runId,
    `sess-${runId}`,
    `req-${runId}`,
    'agent-graph',
    'COMPLETED',
    4,
    JSON.stringify({
      tenantId: 'tenant-graph',
      subjectId: 'subject-graph',
      agentId: 'agent-graph',
      agentVersion: 'v1',
      sessionId: `sess-${runId}`,
      requestId: `req-${runId}`,
      runId,
      agentAssemblyRef: 'assembly-graph',
      attempt: 1,
      status: 'COMPLETED',
      terminalCommitState: 'COMMITTED',
      version: 1,
      createdAt: 1,
      updatedAt: 4,
    }),
  );
}

function insertSubagentChild(
  db: DatabaseSync,
  parentRunId: string,
  toolCallId: string,
  childAgentId: string,
  childSessionId: string,
  childRunId: string,
): void {
  const parentRequestId = `req-${parentRunId}`;
  const idempotencyKey = `${parentRunId}:${toolCallId}`;
  const childRequestId = `req-${childRunId}`;
  db.prepare(
    `
    INSERT INTO sessions(
      tenant_id, subject_id, agent_id, session_id,
      parent_session_id, parent_run_id, parent_request_id,
      title, created_at, updated_at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    'tenant-graph',
    'subject-graph',
    childAgentId,
    childSessionId,
    `sess-${parentRunId}`,
    parentRunId,
    parentRequestId,
    'Child diagnosis',
    16,
    17,
    idempotencyKey,
  );
  db.prepare(
    `
    INSERT INTO request_runs(
      tenant_id, subject_id, run_id, session_id, request_id,
      agent_id, status, created_at, updated_at, idempotency_key, json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    'tenant-graph',
    'subject-graph',
    childRunId,
    childSessionId,
    childRequestId,
    childAgentId,
    'COMPLETED',
    16,
    17,
    `${idempotencyKey}:request`,
    JSON.stringify({
      tenantId: 'tenant-graph',
      subjectId: 'subject-graph',
      agentId: childAgentId,
      agentVersion: 'v1',
      sessionId: childSessionId,
      requestId: childRequestId,
      runId: childRunId,
      agentAssemblyRef: 'assembly-child',
      attempt: 1,
      parentRunId,
      parentRequestId,
      priority: 'LOW',
      status: 'COMPLETED',
      terminalCommitState: 'COMMITTED',
      version: 1,
      createdAt: 16,
      updatedAt: 17,
    }),
  );
}

function insertTimelineEvent(
  db: DatabaseSync,
  runId: string,
  sequence: number,
  eventSuffix: string,
  type: string,
  inlinePayload: Record<string, unknown>,
): void {
  db.prepare(
    'INSERT INTO timeline_events(tenant_id, subject_id, agent_id, session_id, sequence, event_id, request_id, run_id, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'tenant-graph',
    'subject-graph',
    'agent-graph',
    `sess-${runId}`,
    sequence,
    `event-${eventSuffix}`,
    `req-${runId}`,
    runId,
    JSON.stringify({
      tenantId: 'tenant-graph',
      subjectId: 'subject-graph',
      agentId: 'agent-graph',
      agentVersion: 'v1',
      eventId: `event-${eventSuffix}`,
      sessionId: `sess-${runId}`,
      requestId: `req-${runId}`,
      runId,
      requestContextId: `ctx-${runId}`,
      sequence,
      type,
      inlinePayload,
      createdAt: sequence,
    }),
  );
}

function insertMessage(
  db: DatabaseSync,
  runId: string,
  messageSuffix: string,
  role: string,
  content: Record<string, unknown>,
  metadata: Record<string, unknown>,
): void {
  db.prepare(
    'INSERT INTO messages(tenant_id, subject_id, agent_id, message_id, session_id, request_id, run_id, role, content, content_type, metadata, visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'tenant-graph',
    'subject-graph',
    'agent-graph',
    `message-${messageSuffix}`,
    `sess-${runId}`,
    `req-${runId}`,
    runId,
    role,
    JSON.stringify(content),
    'PLAIN_TEXT',
    JSON.stringify(metadata),
    role === 'ASSISTANT' ? 0 : 1,
    12,
  );
}
