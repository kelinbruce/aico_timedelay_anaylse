import { createDefaultAgentTestAssemblyRegistry, createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../fixtures/test-agent.js';
import { createRequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { describe, expect, it } from 'vitest';

const identityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-cancel'),
  subjectId: brand<string, 'SubjectId'>('subject-cancel'),
  displayName: 'Cancel tester',
};
const agentId = brand<string, 'AgentId'>('default-agent');

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

describe('internal cancellation boundary', () => {
  it('propagates runtime-owned timeout AbortSignal to Agent.execute and normalizes failure safely', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-cancel-timeout');
    let observedAbort = false;
    await gateway.sessions.saveSession({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(async (_kit, _run, _context, signal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener(
              'abort',
              () => {
                observedAbort = true;
                resolve();
              },
              { once: true },
            );
          });
          throw new Error('raw abort detail should not leak');
        }),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: {
        async active(agentId) {
          return {
            ...(await createDefaultAgentTestAssemblyRegistry('deterministic-test-model').active(agentId)),
            runtimeSettings: { requestTimeoutMs: 1 },
          };
        },
        async require(agentId, agentVersion) {
          return {
            ...(await createDefaultAgentTestAssemblyRegistry('deterministic-test-model').require(agentId, agentVersion)),
            runtimeSettings: { requestTimeoutMs: 1 },
          };
        },
      },
      capabilityCatalog: createStaticCapabilityCatalog(),
      defaultRouteAgentId: brand<string, 'AgentId'>('default-agent'),
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
    });

    const accepted = await runtime.submit({
      sessionId,
      identityContext,
      inputText: 'timeout',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-timeout'),
    });

    await waitFor(() => observedAbort);
    const events = await gateway.timeline.listEvents({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    expect(events.map((event) => event.type)).toContain('REQUEST_FAILED');
    expect(events.map((event) => event.type)).not.toContain('REQUEST_CANCELED');
    const failedEvent = events.find((event) => event.type === 'REQUEST_FAILED');
    expect(failedEvent?.inlinePayload?.content).toMatch(/^Request failed:/u);

    const run = await gateway.requestRuns.loadRun({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      runId: accepted.runId,
    });
    expect(run?.status).toBe('FAILED');
    expect(run?.status).not.toBe('CANCELED');
  });

  it('exposes user cancel through the Web channel and normalizes cancel action aliases', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }], identity: identityContext });
    const created = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
    const sessionId = created.json<{ sessionId: string }>().sessionId;
    await app.gateway.requestRuns.saveRun(
      {
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(sessionId),
        requestId: brand<string, 'MessageId'>('request-web-cancel'),
        runId: brand<string, 'RequestRunId'>('run-web-cancel'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'default-agent:v1',
        attempt: 1,
        status: 'QUEUED',
        version: 1,
        terminalCommitState: 'NOT_STARTED',
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      },
      {},
    );

    const route = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/cancel`,
      payload: {
        expectedLatestRequestId: 'request-web-cancel',
        action: 'CANCEL_LATEST',
        idempotencyKey: 'idem-web-cancel',
      },
    });
    const replay = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/cancel`,
      payload: {
        expectedLatestRequestId: 'request-web-cancel',
        action: 'CANCEL',
        idempotencyKey: 'idem-web-cancel',
      },
    });
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>('run-web-cancel'),
    });

    expect(route.statusCode).toBe(200);
    expect(route.json<{ action: string }>().action).toBe('CANCEL');
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(route.json());
    expect(run?.status).toBe('CANCELED');
  });
});
