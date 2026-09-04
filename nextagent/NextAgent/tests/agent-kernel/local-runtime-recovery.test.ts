import { createDefaultAgentTestAssemblyRegistry } from '@nextagent/agent-platform-gateway-local/testing';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CheckpointRecord,
  RequestRunRecord,
  RunTimelineEventRecord,
  RuntimeRunTimelineEventRecord,
  SessionMessageRecord,
} from '@nextagent/agent-contracts/gateway';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { createRequestLifecycleCoordinator, type RequestLifecycleDependencies } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { afterEach, describe, expect, it } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());
import { readDescriptor, toolDescriptor } from '../fixtures/capability.js';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../fixtures/test-agent.js';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-recovery'),
  subjectId: brand<string, 'SubjectId'>('subject-recovery'),
  displayName: 'Recovery tester',
};
const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');

describe('local runtime recovery', () => {
  it('scopes checkpoint save and load by agent as well as owner', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-checkpoint-scope');
    const requestId = brand<string, 'MessageId'>('request-checkpoint-scope');
    const runId = brand<string, 'RequestRunId'>('run-checkpoint-scope');
    const otherAgentId = brand<string, 'AgentId'>('other-checkpoint-agent');
    await gateway.checkpoints.saveCheckpoint(
      checkpointRecord({
        sessionId,
        requestId,
        runId,
        requestContextId: brand<string, 'RequestContextId'>('context-checkpoint-default-agent'),
        triggerReason: 'RUN_ACCEPTED',
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-checkpoint-default-agent') },
    );
    await gateway.checkpoints.saveCheckpoint(
      checkpointRecord({
        agentId: otherAgentId,
        sessionId,
        requestId,
        runId,
        requestContextId: brand<string, 'RequestContextId'>('context-checkpoint-other-agent'),
        triggerReason: 'RUN_ACCEPTED',
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-checkpoint-other-agent') },
    );

    await expect(
      gateway.checkpoints.loadCheckpoint({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId,
        runId,
      }),
    ).resolves.toMatchObject({ agentId, requestContextId: 'context-checkpoint-default-agent' });
    await expect(
      gateway.checkpoints.loadCheckpoint({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: otherAgentId,
        sessionId,
        requestId,
        runId,
      }),
    ).resolves.toMatchObject({ agentId: otherAgentId, requestContextId: 'context-checkpoint-other-agent' });
  });

  it('lists recoverable durable runs with a finite limit and claims executing work by version', async () => {
    const gateway = createTestGatewayStores();
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-recover-queued'),
        sessionId: brand<string, 'SessionId'>('session-scan-a'),
        requestId: brand<string, 'MessageId'>('request-scan-a'),
        status: 'QUEUED',
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-recover-executing'),
        sessionId: brand<string, 'SessionId'>('session-scan-b'),
        requestId: brand<string, 'MessageId'>('request-scan-b'),
        status: 'EXECUTING',
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-recover-pending'),
        sessionId: brand<string, 'SessionId'>('session-scan-c'),
        requestId: brand<string, 'MessageId'>('request-scan-c'),
        status: 'FAILED',
        terminalCommitState: 'PENDING',
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-recover-retrying'),
        sessionId: brand<string, 'SessionId'>('session-scan-e'),
        requestId: brand<string, 'MessageId'>('request-scan-e'),
        status: 'COMPLETED',
        terminalCommitState: 'RETRYING',
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-skip-committed'),
        sessionId: brand<string, 'SessionId'>('session-scan-d'),
        requestId: brand<string, 'MessageId'>('request-scan-d'),
        status: 'COMPLETED',
        terminalCommitState: 'COMMITTED',
      }),
      {},
    );

    const limited = await gateway.requestRuns.listRecoverableRuns({ agentId, now: brand<number, 'EpochMillis'>(100), limit: 2 });
    const all = await gateway.requestRuns.listRecoverableRuns({ agentId, now: brand<number, 'EpochMillis'>(100), limit: 10 });
    const executing = all.find((run) => run.runId === 'run-recover-executing');
    const claim = await gateway.requestRuns.claimRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>('run-recover-executing'),
      expectedVersion: executing?.version ?? 0,
      lockedBy: 'test-recovery',
      lockExpiresAt: brand<number, 'EpochMillis'>(200),
    });
    const conflict = await gateway.requestRuns.claimRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>('run-recover-executing'),
      expectedVersion: executing?.version ?? 0,
      lockedBy: 'test-recovery-conflict',
      lockExpiresAt: brand<number, 'EpochMillis'>(300),
    });

    expect(limited).toHaveLength(2);
    expect(all.map((run) => run.runId)).toEqual(
      expect.arrayContaining(['run-recover-queued', 'run-recover-executing', 'run-recover-pending', 'run-recover-retrying']),
    );
    expect(all.map((run) => run.runId)).not.toContain('run-skip-committed');
    expect(claim).toMatchObject({ status: 'UPDATED', record: { lockedBy: 'test-recovery', lockExpiresAt: 200 } });
    expect(conflict.status).toBe('VERSION_CONFLICT');
  });

  it('allows only one same-agent runtime instance to rebuild and execute a queued run', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recovery-concurrent');
    const requestId = brand<string, 'MessageId'>('request-recovery-concurrent');
    const runId = brand<string, 'RequestRunId'>('run-recovery-concurrent');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'QUEUED' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId,
        role: 'USER',
        content: 'recover once',
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('concurrent-recovery-user') },
    );

    let executeCount = 0;
    const execute: LegacyExecute = async (run, context, timeline) => {
      executeCount += 1;
      await completeRecoveredRun(run, context, timeline);
    };
    const runtimeA = createRuntime(gateway, execute, { recoveryLockedBy: 'runtime-a' });
    const runtimeB = createRuntime(gateway, execute, { recoveryLockedBy: 'runtime-b' });

    const reports = await Promise.all([runtimeA.recoverLocalRuntime({ limit: 10 }), runtimeB.recoverLocalRuntime({ limit: 10 })]);
    await waitForRunStatus(gateway, runId, 'COMPLETED');
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      runId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId,
      includeHidden: true,
      offset: 0,
      limit: 100,
    });

    expect(reports.reduce((sum, report) => sum + report.rebuiltQueued, 0)).toBe(1);
    expect(executeCount).toBe(1);
    expect(events.filter((event) => event.type === 'REQUEST_COMPLETED')).toHaveLength(1);
    expect(messages.items.filter((message) => message.role === 'ASSISTANT')).toHaveLength(1);
  });

  it('restores schema-valid routing facts with effective input during queued recovery', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recovery-routing');
    const requestId = brand<string, 'MessageId'>('request-recovery-routing');
    const runId = brand<string, 'RequestRunId'>('run-recovery-routing');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'QUEUED' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId,
        role: 'USER',
        content: 'diagnose RAN alarms',
        metadata: { routingConstraints: { targetRecipe: 'ran-alarm-diagnosis' } },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('recovery-routing-user') },
    );
    let recoveredContext: RequestContext | undefined;
    const runtime = createRuntime(gateway, async (run, context, timeline) => {
      recoveredContext = context;
      await completeRecoveredRun(run, context, timeline);
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    await waitForRunStatus(gateway, runId, 'COMPLETED');

    expect(report).toMatchObject({ scanned: 1, rebuiltQueued: 1, failed: 0 });
    expect(recoveredContext).toMatchObject({
      acceptedInputText: 'diagnose RAN alarms',
      routingConstraints: { targetRecipe: 'ran-alarm-diagnosis' },
    });
  });

  it('fails queued recovery closed when persisted routing facts are invalid', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recovery-invalid-routing');
    const requestId = brand<string, 'MessageId'>('request-recovery-invalid-routing');
    const runId = brand<string, 'RequestRunId'>('run-recovery-invalid-routing');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'QUEUED' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId,
        role: 'USER',
        content: 'diagnose RAN alarms',
        metadata: { routingConstraints: { targetRecipe: '../unsafe' } },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('recovery-invalid-routing-user') },
    );
    let executeCount = 0;
    const runtime = createRuntime(gateway, async () => {
      executeCount += 1;
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    await waitForRunStatus(gateway, runId, 'FAILED');

    expect(report).toMatchObject({ scanned: 1, rebuiltQueued: 0, failed: 1 });
    expect(executeCount).toBe(0);
  });

  it('does not discover or mutate recoverable runs owned by another agent', async () => {
    const gateway = createTestGatewayStores();
    const otherAgentId = brand<string, 'AgentId'>('other-recovery-agent');
    const runId = brand<string, 'RequestRunId'>('run-other-recovery-agent');
    const record = runRecord({
      agentId: otherAgentId,
      runId,
      sessionId: brand<string, 'SessionId'>('session-other-recovery-agent'),
      requestId: brand<string, 'MessageId'>('request-other-recovery-agent'),
      status: 'QUEUED',
    });
    await gateway.requestRuns.saveRun(record, {});
    let executeCount = 0;
    const runtime = createRuntime(gateway, async () => {
      executeCount += 1;
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    const persisted = await gateway.requestRuns.loadRun({
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: otherAgentId,
      runId,
    });

    expect(report).toMatchObject({ scanned: 0, rebuiltQueued: 0, claimedExecuting: 0, failed: 0, skipped: 0 });
    expect(executeCount).toBe(0);
    expect(persisted).toMatchObject({ version: record.version, status: 'QUEUED' });
    expect(persisted?.lockedBy).toBeUndefined();
    expect(persisted?.lockExpiresAt).toBeUndefined();
  });

  it('claims planning work before rebuilding it through the scheduler', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recover-planning');
    const requestId = brand<string, 'MessageId'>('request-recover-planning');
    const runId = brand<string, 'RequestRunId'>('run-recover-planning');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'PLANNING' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId,
        role: 'USER',
        content: 'recover planning',
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('planning-recovery-user') },
    );
    const runtime = createRuntime(gateway, completeRecoveredRun);

    const report = await runtime.recoverLocalRuntime({ limit: 10, lockedBy: 'planning-recovery' });
    await waitForRunStatus(gateway, runId, 'COMPLETED');

    expect(report).toMatchObject({ scanned: 1, rebuiltQueued: 1, failed: 0 });
  });

  it('rebuilds queued work through scheduler dispatch rather than inline execution', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recover-queued');
    const requestId = brand<string, 'MessageId'>('request-recover-queued');
    const runId = brand<string, 'RequestRunId'>('run-recover-queued');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'QUEUED' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({ messageId: requestId, sessionId, requestId, runId, role: 'USER', content: 'recover queued' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('queued-user') },
    );

    let recoveryReturned = false;
    const runtime = createRuntime(gateway, async (run, context, timeline) => {
      expect(recoveryReturned).toBe(true);
      await completeRecoveredRun(run, context, timeline);
    });
    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    recoveryReturned = true;

    await waitForRunStatus(gateway, runId, 'COMPLETED');
    expect(report).toMatchObject({ scanned: 1, rebuiltQueued: 1, failed: 0 });
  });

  it('emits recovery scan component diagnostics with bounded summary counts', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recovery-observation');
    const requestId = brand<string, 'MessageId'>('request-recovery-observation');
    const runId = brand<string, 'RequestRunId'>('run-recovery-observation');
    const operations: Array<Record<string, unknown>> = [];
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'QUEUED' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({ messageId: requestId, sessionId, requestId, runId, role: 'USER', content: 'recover observed' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('recover-observed-user') },
    );
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        debug(entry) {
          operations.push({ ...entry });
        },
        info() {},
        warn() {},
        error() {},
      }),
    });
    const runtime = createRuntime(gateway, completeRecoveredRun);

    const report = await runtime.recoverLocalRuntime({ limit: 10 });

    await waitForRunStatus(gateway, runId, 'COMPLETED');
    expect(report).toMatchObject({ scanned: 1, rebuiltQueued: 1, failed: 0 });
    expect(operations.map((entry) => entry.event)).toEqual(
      expect.arrayContaining(['runtime.recovery.scan_started', 'runtime.recovery.scan_completed']),
    );
    expect(operations.find((entry) => entry.event === 'runtime.recovery.scan_completed')).toEqual(
      expect.objectContaining({
        scanned: 1,
        rebuiltQueued: 1,
        claimedExecuting: 0,
        failed: 0,
        skipped: 0,
      }),
    );
  });

  it('repairs an accepted pre-queue durable window into the scheduler path', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recover-accepted');
    const requestId = brand<string, 'MessageId'>('request-recover-accepted');
    const runId = brand<string, 'RequestRunId'>('run-recover-accepted');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'ACCEPTED' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({ messageId: requestId, sessionId, requestId, runId, role: 'USER', content: 'recover accepted' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('accepted-user') },
    );
    const runtime = createRuntime(gateway, completeRecoveredRun);

    const report = await runtime.recoverLocalRuntime({ limit: 10 });

    await waitForRunStatus(gateway, runId, 'COMPLETED');
    expect(report).toMatchObject({ scanned: 1, rebuiltQueued: 1, failed: 0 });
  });

  it('skips executing recovery when claim fencing loses the race', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recover-claim-conflict');
    const requestId = brand<string, 'MessageId'>('request-recover-claim-conflict');
    const runId = brand<string, 'RequestRunId'>('run-recover-claim-conflict');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'EXECUTING' }), {});
    const originalClaim = gateway.requestRuns.claimRun.bind(gateway.requestRuns);
    (gateway.requestRuns as unknown as { claimRun: typeof gateway.requestRuns.claimRun }).claimRun = async () => ({ status: 'VERSION_CONFLICT' });
    const runtime = createRuntime(gateway, async () => {
      throw new Error('claim conflict must not execute recovered work');
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    const run = await loadRun(gateway, runId);
    (gateway.requestRuns as unknown as { claimRun: typeof gateway.requestRuns.claimRun }).claimRun = originalClaim;

    expect(report).toMatchObject({ scanned: 1, claimedExecuting: 0, failed: 0, skipped: 1 });
    expect(run?.status).toBe('EXECUTING');
  });

  it('fails closed on missing persisted assembly without falling back to active assembly or leaking adapter details', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recover-missing-assembly');
    const requestId = brand<string, 'MessageId'>('request-recover-missing-assembly');
    const runId = brand<string, 'RequestRunId'>('run-recover-missing-assembly');
    const contextId = brand<string, 'RequestContextId'>('context-recover-missing-assembly');
    let activeLookups = 0;
    let requireLookups = 0;
    const defaultRegistry = createDefaultAgentTestAssemblyRegistry('deterministic-test-model');
    const assemblyRegistry: AgentAssemblyRegistry = {
      async active(requestedAgentId) {
        activeLookups += 1;
        return defaultRegistry.active(requestedAgentId);
      },
      async require() {
        requireLookups += 1;
        throw new Error('adapter-private assembly path C:\\secret\\agent.json');
      },
    };
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(
      runRecord({
        runId,
        sessionId,
        requestId,
        status: 'EXECUTING',
        agentVersion: brand<string, 'AgentVersion'>('missing-version'),
        agentAssemblyRef: 'default-agent:missing-version',
      }),
      {},
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({ messageId: requestId, sessionId, requestId, runId, role: 'USER', content: 'missing assembly' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('missing-assembly-user') },
    );
    await saveCheckpoint(
      gateway,
      { sessionId, requestId, runId, requestContextId: contextId, triggerReason: 'STEP_STARTED' },
      'missing-assembly-checkpoint',
    );
    const runtime = createRuntime(
      gateway,
      async () => {
        throw new Error('missing assembly must fail before agent execution');
      },
      { assemblyRegistry },
    );

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    const run = await loadRun(gateway, runId);
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId,
      includeHidden: true,
      offset: 0,
      limit: 10,
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      runId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });

    expect(report).toMatchObject({ scanned: 1, claimedExecuting: 1, failed: 1 });
    expect(run?.status).toBe('FAILED');
    expect(run?.terminalCommitState).toBe('COMMITTED');
    expect(activeLookups).toBe(0);
    expect(requireLookups).toBe(1);
    expect(messages.items.map((message) => message.content).join('\n')).toContain('RECOVERY_MISSING_ASSEMBLY');
    expect(events.map((event) => JSON.stringify(event.inlinePayload)).join('\n')).toContain('RECOVERY_MISSING_ASSEMBLY');
    expect(JSON.stringify({ events, messages })).not.toContain('adapter-private');
  });

  it('terminalizes unsafe executing recovery as failed instead of leaving the run executing', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recover-executing');
    const requestId = brand<string, 'MessageId'>('request-recover-executing');
    const runId = brand<string, 'RequestRunId'>('run-recover-executing');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'EXECUTING' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({ messageId: requestId, sessionId, requestId, runId, role: 'USER', content: 'recover executing' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('executing-user') },
    );
    const runtime = createRuntime(gateway, async () => {
      throw new Error('unsafe executing recovery must not call the agent without a checkpoint');
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    const run = await loadRun(gateway, runId);
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
      runId,
    });

    expect(report).toMatchObject({ scanned: 1, claimedExecuting: 1, failed: 1 });
    expect(run?.status).toBe('FAILED');
    expect(run?.terminalCommitState).toBe('COMMITTED');
    expect(events.map((event) => event.type)).toContain('REQUEST_FAILED');
    expect(events.map((event) => JSON.stringify(event.inlinePayload)).join('\n')).toContain('RECOVERY_MISSING_CHECKPOINT');
  });

  it('takes over pending terminal commits idempotently without duplicating terminal facts', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-terminal-takeover');
    const requestId = brand<string, 'MessageId'>('request-terminal-takeover');
    const runId = brand<string, 'RequestRunId'>('run-terminal-takeover');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'COMPLETED', terminalCommitState: 'PENDING' }), {});
    await gateway.timeline.appendEvent(
      timelineEventRecord({
        eventId: 'event-terminal-final',
        sessionId,
        requestId,
        runId,
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: { final: true, content: 'terminal recovered answer' },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('terminal-final') },
    );
    const runtime = createRuntime(gateway, async () => {
      throw new Error('terminal takeover must not call agent execution');
    });

    const first = await runtime.recoverLocalRuntime({ limit: 10 });
    const second = await runtime.recoverLocalRuntime({ limit: 10 });
    const run = await loadRun(gateway, runId);
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
      runId,
    });

    expect(first).toMatchObject({ scanned: 1, failed: 0 });
    expect(second).toMatchObject({ scanned: 0, failed: 0 });
    expect(run?.status).toBe('COMPLETED');
    expect(run?.terminalCommitState).toBe('COMMITTED');
    expect(messages.items.filter((message) => message.role === 'ASSISTANT').map((message) => message.content)).toEqual(['terminal recovered answer']);
    expect(events.filter((event) => event.type === 'REQUEST_COMPLETED')).toHaveLength(1);
  });

  it('preserves cancel terminal idempotency metadata during terminal takeover recovery', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-terminal-cancel-replay');
    const requestId = brand<string, 'MessageId'>('request-terminal-cancel-replay');
    const runId = brand<string, 'RequestRunId'>('run-terminal-cancel-replay');
    const cancelKey = brand<string, 'IdempotencyKey'>('idem-terminal-cancel-replay');
    const cancelSemantic = cancelCommandSemantic(sessionId, requestId, cancelKey);
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(
      runRecord({
        runId,
        sessionId,
        requestId,
        status: 'CANCELED',
        terminalCommitState: 'PENDING',
        terminalCommitIdempotencyKey: cancelKey,
        terminalCommitIdempotencySemantic: cancelSemantic,
      }),
      {},
    );
    const runtime = createRuntime(gateway, async () => {
      throw new Error('cancel terminal takeover must not call agent execution');
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    const run = await loadRun(gateway, runId);
    const lookup = await gateway.requestRuns.loadRunByIdempotencyKey({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      anchor: 'TERMINAL_COMMIT',
      idempotencyKey: cancelKey,
      idempotencySemantic: cancelSemantic,
    });
    const replay = await runtime.cancel({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'CANCEL',
      idempotencyKey: cancelKey,
    });

    expect(report).toMatchObject({ scanned: 1, failed: 0 });
    expect(run?.status).toBe('CANCELED');
    expect(run?.terminalCommitState).toBe('COMMITTED');
    expect(run?.terminalCommitIdempotencyKey).toBe(cancelKey);
    expect(run?.terminalCommitIdempotencySemantic).toBe(cancelSemantic);
    expect(lookup).toMatchObject({ status: 'FOUND', record: { runId } });
    expect(replay).toEqual({ sessionId, targetRequestId: requestId, action: 'CANCEL', idempotencyKey: cancelKey });
  });

  it('reconciles partial terminal facts without regenerating terminal message or event', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-terminal-reconcile');
    const requestId = brand<string, 'MessageId'>('request-terminal-reconcile');
    const runId = brand<string, 'RequestRunId'>('run-terminal-reconcile');
    const terminalMessageId = brand<string, 'MessageId'>('assistant-terminal-reconcile');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'EXECUTING', terminalCommitState: 'RETRYING' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({ messageId: terminalMessageId, sessionId, requestId, runId, role: 'ASSISTANT', content: 'existing terminal answer' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('terminal-reconcile-message') },
    );
    await gateway.timeline.appendEvent(
      timelineEventRecord({
        eventId: 'event-terminal-reconcile',
        sessionId,
        requestId,
        runId,
        type: 'REQUEST_COMPLETED',
        inlinePayload: { content: 'existing terminal answer', terminalMessageId },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('terminal-reconcile-event') },
    );
    const runtime = createRuntime(gateway, async () => {
      throw new Error('partial terminal reconcile must not call agent execution');
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    const run = await loadRun(gateway, runId);
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
      runId,
    });

    expect(report).toMatchObject({ scanned: 1, failed: 0 });
    expect(run?.status).toBe('COMPLETED');
    expect(run?.terminalCommitState).toBe('COMMITTED');
    expect(messages.items.filter((message) => message.role === 'ASSISTANT').map((message) => message.messageId)).toEqual([terminalMessageId]);
    expect(events.filter((event) => event.type === 'REQUEST_COMPLETED').map((event) => event.eventId)).toEqual(['event-terminal-reconcile']);
  });

  it('continues terminal checkpoint recovery through terminal boundary without rerunning the agent', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-terminal-checkpoint');
    const requestId = brand<string, 'MessageId'>('request-terminal-checkpoint');
    const runId = brand<string, 'RequestRunId'>('run-terminal-checkpoint');
    const contextId = brand<string, 'RequestContextId'>('context-terminal-checkpoint');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'EXECUTING' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({ messageId: requestId, sessionId, requestId, runId, role: 'USER', content: 'terminal checkpoint' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('terminal-checkpoint-user') },
    );
    await saveCheckpoint(
      gateway,
      { sessionId, requestId, runId, requestContextId: contextId, triggerReason: 'TERMINAL_COMMIT_PENDING' },
      'terminal-checkpoint',
    );
    await gateway.timeline.appendEvent(
      timelineEventRecord({
        eventId: 'event-terminal-checkpoint-final',
        sessionId,
        requestId,
        runId,
        requestContextId: contextId,
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: { final: true, content: 'checkpoint terminal answer' },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('terminal-checkpoint-final') },
    );
    let executeCount = 0;
    const runtime = createRuntime(gateway, async () => {
      executeCount += 1;
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    const run = await loadRun(gateway, runId);

    expect(report).toMatchObject({ scanned: 1, claimedExecuting: 1, failed: 0 });
    expect(executeCount).toBe(0);
    expect(run?.status).toBe('COMPLETED');
    expect(run?.terminalCommitState).toBe('COMMITTED');
  });

  it('continues model checkpoint recovery by re-entering agent execution once', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-model-checkpoint');
    const requestId = brand<string, 'MessageId'>('request-model-checkpoint');
    const runId = brand<string, 'RequestRunId'>('run-model-checkpoint');
    const contextId = brand<string, 'RequestContextId'>('context-model-checkpoint');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'EXECUTING' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({ messageId: requestId, sessionId, requestId, runId, role: 'USER', content: 'model checkpoint' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('model-checkpoint-user') },
    );
    await saveCheckpoint(
      gateway,
      { sessionId, requestId, runId, requestContextId: contextId, triggerReason: 'STEP_STARTED', agentTurnIndex: 3 },
      'model-checkpoint',
    );
    let executeCount = 0;
    const runtime = createRuntime(gateway, async (_run, context, timeline) => {
      executeCount += 1;
      expect(context.nextLifecycleStage).toBe('BEFORE_MODEL_INVOKE');
      expect(context.agentTurnIndex).toBe(3);
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'model checkpoint recovered' } });
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    await waitForRunStatus(gateway, runId, 'COMPLETED');

    expect(report).toMatchObject({ scanned: 1, claimedExecuting: 1, failed: 0 });
    expect(executeCount).toBe(1);
  });

  it('leaves an executing run parked when its pending input is still active', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-active-pending-recovery');
    const requestId = brand<string, 'MessageId'>('request-active-pending-recovery');
    const runId = brand<string, 'RequestRunId'>('run-active-pending-recovery');
    const contextId = brand<string, 'RequestContextId'>('context-active-pending-recovery');
    const pendingInputId = brand<string, 'PendingInputId'>('pending-active-pending-recovery');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'EXECUTING' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId,
        role: 'USER',
        content: 'wait for pending input',
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('active-pending-recovery-user') },
    );
    await saveCheckpoint(
      gateway,
      { sessionId, requestId, runId, requestContextId: contextId, triggerReason: 'STEP_STARTED' },
      'active-pending-recovery-checkpoint',
    );
    await gateway.pendingInputs.createPendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      record: {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        pendingInputId,
        requestRunId: runId,
        sessionId,
        requestId,
        requestContextId: contextId,
        checkpointId: brand<string, 'CheckpointId'>(`checkpoint-${runId}`),
        kind: 'QUESTION',
        request: {
          id: pendingInputId,
          sessionId,
          kind: 'QUESTION',
          questions: [{ prompt: 'Continue?', options: [{ label: 'Yes', value: 'yes' }] }],
        },
        producerRef: { kind: 'LIFECYCLE_HOOK' },
        status: 'PENDING',
        createdAt: brand<number, 'EpochMillis'>(10),
        updatedAt: brand<number, 'EpochMillis'>(10),
      },
    });
    let executeCount = 0;
    const runtime = createRuntime(gateway, async (_run, _context, timeline) => {
      executeCount += 1;
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'must not recover while pending' } });
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    const run = await loadRun(gateway, runId);
    const pending = await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    expect(report).toMatchObject({ scanned: 1, claimedExecuting: 0, failed: 0, skipped: 1 });
    expect(executeCount).toBe(0);
    expect(run).toMatchObject({ status: 'EXECUTING', version: 1 });
    expect(run?.lockedBy).toBeUndefined();
    expect(pending).toMatchObject({ pendingInputId, requestRunId: runId, status: 'PENDING' });
  });

  it('passes guarded tool recovery forward with reused results marked complete and pending tools left for replay', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recover-tool-positive');
    const requestId = brand<string, 'MessageId'>('request-recover-tool-positive');
    const runId = brand<string, 'RequestRunId'>('run-recover-tool-positive');
    const contextId = brand<string, 'RequestContextId'>('context-recover-tool-positive');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'EXECUTING' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('assistant-tool-use-positive'),
        sessionId,
        requestId,
        runId,
        role: 'ASSISTANT',
        content: JSON.stringify({
          toolCalls: [
            { toolCallId: 'tool-existing', toolName: 'Read', arguments: { path: 'existing' } },
            { toolCallId: 'tool-replay', toolName: 'Read', arguments: { path: 'replay' } },
          ],
        }),
        metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['tool-existing', 'tool-replay'] },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('tool-positive-assistant') },
    );
    await saveCheckpoint(
      gateway,
      {
        sessionId,
        requestId,
        runId,
        requestContextId: contextId,
        triggerReason: 'CAPABILITY_BEFORE_CALL',
        flowVariables: { recovered: true },
      },
      'tool-positive-checkpoint',
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('result-tool-existing'),
        sessionId,
        requestId,
        runId,
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({ toolCallId: 'tool-existing', toolName: 'Read', payload: { ok: true } }),
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-existing', toolName: 'Read' },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('tool-positive-result') },
    );
    let observedContext: RequestContext | undefined;
    const runtime = createRuntime(gateway, async (_run, context, timeline) => {
      observedContext = context;
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'tool recovery resumed' } });
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    await waitForRunStatus(gateway, runId, 'COMPLETED');

    expect(report).toMatchObject({ scanned: 1, claimedExecuting: 1, failed: 0 });
    expect(observedContext?.toolCallStates).toEqual([
      expect.objectContaining({ toolCallId: 'tool-existing', status: 'SUCCEEDED' }),
      expect.objectContaining({ toolCallId: 'tool-replay', status: 'PENDING' }),
    ]);
    expect(observedContext?.flowVariables).toEqual({ recovered: true });
  });

  it('hands pending tool recovery to the replay guard and redacts raw tool arguments', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recover-tool');
    const requestId = brand<string, 'MessageId'>('request-recover-tool');
    const runId = brand<string, 'RequestRunId'>('run-recover-tool');
    const contextId = brand<string, 'RequestContextId'>('context-recover-tool');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'EXECUTING' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('assistant-tool-use-recovery'),
        sessionId,
        requestId,
        runId,
        role: 'ASSISTANT',
        content: JSON.stringify({
          toolCalls: [{ toolCallId: 'tool-recovery', toolName: 'unknown-tool', arguments: { rawSecret: 'must-not-leak' } }],
        }),
        metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['tool-recovery'] },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('tool-assistant') },
    );
    await saveCheckpoint(
      gateway,
      { sessionId, requestId, runId, requestContextId: contextId, triggerReason: 'CAPABILITY_BEFORE_CALL' },
      'tool-checkpoint',
    );
    const runtime = createRuntime(gateway, async () => {
      throw new Error('guard rejection must happen before capability execution');
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
      runId,
    });
    const payloads = events.map((event) => JSON.stringify(event.inlinePayload)).join('\n');

    expect(report).toMatchObject({ scanned: 1, claimedExecuting: 1, failed: 1 });
    expect(payloads).toContain('RECOVERY_CAPABILITY_DESCRIPTOR_UNAVAILABLE');
    expect(payloads).not.toContain('must-not-leak');
  });

  it('hands non-idempotent pending replay back to the main flow for policy re-evaluation', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-recover-non-idempotent');
    const requestId = brand<string, 'MessageId'>('request-recover-non-idempotent');
    const runId = brand<string, 'RequestRunId'>('run-recover-non-idempotent');
    const contextId = brand<string, 'RequestContextId'>('context-recover-non-idempotent');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'EXECUTING' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('assistant-tool-use-non-idempotent'),
        sessionId,
        requestId,
        runId,
        role: 'ASSISTANT',
        content: JSON.stringify({
          toolCalls: [
            { toolCallId: 'tool-write-recovery', toolName: 'write', arguments: { file_path: 'ops/runbook.txt', content: 'must-not-replay' } },
          ],
        }),
        metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['tool-write-recovery'] },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('tool-non-idempotent-assistant') },
    );
    await saveCheckpoint(
      gateway,
      { sessionId, requestId, runId, requestContextId: contextId, triggerReason: 'CAPABILITY_BEFORE_CALL' },
      'tool-non-idempotent-checkpoint',
    );
    let observedContext: RequestContext | undefined;
    const runtime = createRuntime(
      gateway,
      async (_run, context, timeline) => {
        observedContext = context;
        await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'policy will re-evaluate this replay' } });
      },
      {
        capabilityCatalog: createStaticCapabilityCatalog([
          toolDescriptor({
            capabilityId: 'write',
            provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
            replayPolicy: 'NON_IDEMPOTENT',
          }),
        ]),
      },
    );

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    await waitForRunStatus(gateway, runId, 'COMPLETED');

    expect(report).toMatchObject({ scanned: 1, claimedExecuting: 1, failed: 0 });
    expect(observedContext?.toolCallStates).toEqual([expect.objectContaining({ toolCallId: 'tool-write-recovery', status: 'PENDING' })]);
  });

  it('fails checkpoint fact mismatches before recovered execution', async () => {
    const cases = [
      {
        name: 'stale-version',
        sessionId: brand<string, 'SessionId'>('session-stale-checkpoint'),
        requestId: brand<string, 'MessageId'>('request-stale-checkpoint'),
        runId: brand<string, 'RequestRunId'>('run-stale-checkpoint'),
        checkpoint: { runVersion: 0 },
        expectedCode: 'RECOVERY_CHECKPOINT_MISMATCH',
      },
      {
        name: 'active-context-version',
        sessionId: brand<string, 'SessionId'>('session-active-context-mismatch'),
        requestId: brand<string, 'MessageId'>('request-active-context-mismatch'),
        runId: brand<string, 'RequestRunId'>('run-active-context-mismatch'),
        beforeCheckpoint: async (
          gateway: ReturnType<typeof createTestGatewayStores>,
          sessionId: RequestRun['sessionId'],
          requestId: RequestRun['requestId'],
        ) => {
          await gateway.activeContext.appendItem({
            tenantId: identity.tenantId,
            subjectId: identity.subjectId,
            agentId,
            sessionId,
            messageId: requestId,
            expectedActiveContextVersion: 0,
          });
        },
        checkpoint: { activeContextVersion: 99 },
        expectedCode: 'RECOVERY_CHECKPOINT_MISMATCH',
      },
      {
        name: 'future-timeline-sequence',
        sessionId: brand<string, 'SessionId'>('session-future-timeline'),
        requestId: brand<string, 'MessageId'>('request-future-timeline'),
        runId: brand<string, 'RequestRunId'>('run-future-timeline'),
        checkpoint: { lastSequence: brand<number, 'TimelineSequence'>(99) },
        expectedCode: 'RECOVERY_CHECKPOINT_MISMATCH',
      },
      {
        name: 'negative-agent-turn-index',
        sessionId: brand<string, 'SessionId'>('session-negative-agent-turn-index'),
        requestId: brand<string, 'MessageId'>('request-negative-agent-turn-index'),
        runId: brand<string, 'RequestRunId'>('run-negative-agent-turn-index'),
        checkpoint: { agentTurnIndex: -1 },
        expectedCode: 'RECOVERY_CHECKPOINT_MISMATCH',
      },
      {
        name: 'agent-turn-index-after-finalizing',
        sessionId: brand<string, 'SessionId'>('session-agent-turn-index-after-finalizing'),
        requestId: brand<string, 'MessageId'>('request-agent-turn-index-after-finalizing'),
        runId: brand<string, 'RequestRunId'>('run-agent-turn-index-after-finalizing'),
        checkpoint: { agentTurnIndex: 51 },
        expectedCode: 'RECOVERY_CHECKPOINT_MISMATCH',
      },
      {
        name: 'after-return-missing-result',
        sessionId: brand<string, 'SessionId'>('session-after-return-missing-result'),
        requestId: brand<string, 'MessageId'>('request-after-return-missing-result'),
        runId: brand<string, 'RequestRunId'>('run-after-return-missing-result'),
        checkpoint: { triggerReason: 'CAPABILITY_AFTER_RETURN' as const },
        expectedCode: 'RECOVERY_CAPABILITY_RESULT_INCONSISTENT',
      },
    ];

    for (const item of cases) {
      const gateway = createTestGatewayStores();
      const contextId = brand<string, 'RequestContextId'>(`context-${item.name}`);
      await createSession(gateway, item.sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({ runId: item.runId, sessionId: item.sessionId, requestId: item.requestId, status: 'EXECUTING' }),
        {},
      );
      await gateway.messages.appendSessionMessage(
        messageRecord({
          messageId: item.requestId,
          sessionId: item.sessionId,
          requestId: item.requestId,
          runId: item.runId,
          role: 'USER',
          content: `recover ${item.name}`,
        }),
        {
          idempotencyKey: brand<string, 'IdempotencyKey'>(`${item.name}-user`),
        },
      );
      await gateway.messages.appendSessionMessage(
        messageRecord({
          messageId: brand<string, 'MessageId'>(`assistant-${item.name}`),
          sessionId: item.sessionId,
          requestId: item.requestId,
          runId: item.runId,
          role: 'ASSISTANT',
          content: JSON.stringify({ toolCalls: [{ toolCallId: `tool-${item.name}`, toolName: 'Read', arguments: { path: item.name } }] }),
          metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: [`tool-${item.name}`] },
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>(`${item.name}-assistant`) },
      );
      await item.beforeCheckpoint?.(gateway, item.sessionId, item.requestId);
      await saveCheckpoint(
        gateway,
        {
          sessionId: item.sessionId,
          requestId: item.requestId,
          runId: item.runId,
          requestContextId: contextId,
          triggerReason: 'CAPABILITY_BEFORE_CALL',
          ...item.checkpoint,
        },
        `${item.name}-checkpoint`,
      );
      const runtime = createRuntime(gateway, async () => {
        throw new Error(`checkpoint mismatch ${item.name} must not reach agent execution`);
      });

      const report = await runtime.recoverLocalRuntime({ limit: 10 });
      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: item.sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 1000,
        runId: item.runId,
      });
      const payloads = events.map((event) => JSON.stringify(event.inlinePayload)).join('\n');

      expect(report, item.name).toMatchObject({ scanned: 1, claimedExecuting: 1, failed: 1 });
      expect(payloads, item.name).toContain(item.expectedCode);
    }
  });
});

function runRecord(overrides: Partial<RequestRunRecord> & Pick<RequestRunRecord, 'runId' | 'sessionId' | 'requestId'>): RequestRunRecord {
  const now = brand<number, 'EpochMillis'>(overrides.createdAt === undefined ? 1 : Number(overrides.createdAt));
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    agentVersion,
    agentAssemblyRef: 'default-agent:v1',
    attempt: 1,
    status: 'QUEUED',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function messageRecord(
  overrides: Partial<SessionMessageRecord> & Pick<SessionMessageRecord, 'messageId' | 'sessionId' | 'requestId' | 'runId' | 'role' | 'content'>,
): SessionMessageRecord {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
    ...overrides,
  };
}

function timelineEventRecord(
  overrides: Partial<RuntimeRunTimelineEventRecord> &
    Pick<RuntimeRunTimelineEventRecord, 'eventId' | 'sessionId' | 'requestId' | 'runId' | 'type' | 'inlinePayload'>,
): RuntimeRunTimelineEventRecord {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    agentVersion,
    requestContextId: brand<string, 'RequestContextId'>('context-timeline'),
    sequence: brand<number, 'TimelineSequence'>(0),
    createdAt: brand<number, 'EpochMillis'>(5),
    ...overrides,
  };
}

async function createSession(gateway: ReturnType<typeof createTestGatewayStores>, sessionId: RequestRun['sessionId']): Promise<void> {
  await gateway.sessions.saveSession(
    {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    },
    { idempotencyKey: brand<string, 'IdempotencyKey'>(`${sessionId}:session`) },
  );
}

async function saveCheckpoint(
  gateway: ReturnType<typeof createTestGatewayStores>,
  overrides: Parameters<typeof checkpointRecord>[0],
  idempotencyKey: string,
): Promise<void> {
  const active = await gateway.activeContext.loadActiveContext({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId: overrides.sessionId,
  });
  await gateway.checkpoints.saveCheckpoint(
    checkpointRecord({
      activeContextVersion: active.state.activeContextVersion,
      ...overrides,
    }),
    { idempotencyKey: brand<string, 'IdempotencyKey'>(idempotencyKey) },
  );
}

function checkpointRecord(
  overrides: {
    readonly sessionId: RequestRun['sessionId'];
    readonly requestId: RequestRun['requestId'];
    readonly runId: RequestRun['runId'];
    readonly requestContextId: RequestContext['requestContextId'];
    readonly triggerReason: CheckpointRecord['triggerReason'];
  } & Partial<CheckpointRecord>,
): CheckpointRecord {
  const { sessionId, requestId, runId, requestContextId, triggerReason, agentTurnIndex = 0, ...rest } = overrides;
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    checkpointId: brand<string, 'CheckpointId'>(`checkpoint-${runId}`),
    sessionId,
    requestId,
    runId,
    requestContextId,
    runVersion: 1,
    agentTurnIndex,
    triggerReason,
    lastSequence: brand<number, 'TimelineSequence'>(0),
    activeContextVersion: 0,
    flowVariables: {},
    savedAt: brand<number, 'EpochMillis'>(10),
    ...rest,
  };
}

async function loadRun(gateway: ReturnType<typeof createTestGatewayStores>, runId: RequestRun['runId']): Promise<RequestRunRecord | undefined> {
  return gateway.requestRuns.loadRun({ tenantId: identity.tenantId, subjectId: identity.subjectId, agentId, runId });
}

function cancelCommandSemantic(sessionId: RequestRun['sessionId'], expectedLatestRequestId: RequestRun['requestId'], idempotencyKey: string): string {
  return JSON.stringify({
    action: 'CANCEL',
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId,
    expectedLatestRequestId,
    idempotencyKey,
  });
}

function createRuntime(
  gateway: ReturnType<typeof createTestGatewayStores>,
  execute: LegacyExecute,
  overrides: Partial<RequestLifecycleDependencies<object>> = {},
) {
  return createRequestLifecycleCoordinator({
    agentConstructors: [
      createTestAgentConstructor(async ({ runState }, run, context, signal) => {
        await execute(run, context, toLegacyTimeline(runState, run, context), runState, signal);
      }),
    ],
    agentRuntimeDependencies: {},
    assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
    capabilityCatalog: createStaticCapabilityCatalog([readDescriptor()]),
    defaultRouteAgentId: agentId,
    recoveryAgentId: agentId,
    recoveryLockedBy: 'test-runtime-recovery',
    userSessions: createUserSessionService({
      sessionStore: gateway.sessions,
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
    }),
    messageStore: gateway.messages,
    activeContextStore: gateway.activeContext,
    requestRunStore: gateway.requestRuns,
    timelineStore: gateway.timeline,
    checkpointStore: gateway.checkpoints,
    pendingInputStore: gateway.pendingInputs,
    ...overrides,
  });
}

type LegacyExecute = (
  run: RequestRun,
  context: RequestContext,
  timeline: { emit: (event: RunTimelineEvent) => Promise<void> },
  messages: Pick<AgentRunStatePort, 'appendMessage'>,
  signal: AbortSignal,
) => Promise<void>;

async function completeRecoveredRun(_run: RequestRun, _context: RequestContext, timeline: Parameters<LegacyExecute>[2]): Promise<void> {
  await timeline.emit({
    type: 'LLM_CONTENT_DELTA',
    inlinePayload: { final: true, content: 'Recovered request completed.' },
  });
}

function toLegacyTimeline(runState: AgentRunStatePort, run: RequestRun, context: RequestContext) {
  return {
    emit(event: RunTimelineEvent): Promise<void> {
      return runState.emitEvent(run, context, event);
    },
  };
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await assertion()).toBe(true);
}

async function waitForRunStatus(
  gateway: ReturnType<typeof createTestGatewayStores>,
  runId: RequestRun['runId'],
  status: RequestRun['status'],
): Promise<void> {
  await waitFor(async () => {
    const run = await loadRun(gateway, runId);
    return run?.status === status && run.terminalCommitState === 'COMMITTED';
  });
}
