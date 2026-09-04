import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  registerAgentDevWorkbench,
  type AgentDevWorkbenchAccessScope,
  type AgentDevWorkbenchLocalReadPort,
  type AgentDevWorkbenchRegistrationOptions,
} from '../src/index.js';

const routeScope: AgentDevWorkbenchAccessScope = { tenantId: 'tenant-a', subjectId: 'subject-a', allowedAgentIds: ['agent-a'] };

describe('agent dev workbench routes', () => {
  it('serves the dev-only workbench page and query APIs', async () => {
    const server = Fastify({ logger: false });
    registerAgentDevWorkbench(server, {
      ...registrationOptions(createReadPort()),
      developerDiagnosticArtifactStatus: () => ({
        availability: 'DEGRADED',
        droppedCount: 2,
        lastFailureCode: 'QUEUE_OVERLOADED',
      }),
    });

    const page = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('NextAgent Dev Workbench');
    expect(page.body).not.toMatch(/EventSource|WebSocket|fetch\([^)]*,\s*\{[^}]*method:\s*["']POST/u);

    const launcher = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/launcher.js' });
    expect(launcher.statusCode).toBe(200);
    expect(launcher.headers['content-type']).toContain('text/javascript');
    expect(launcher.body).toContain('nextagent-dev-workbench-launcher');
    expect(launcher.body).toContain('#\\/session\\/');
    expect(launcher.body).toContain('sessionId');
    expect(launcher.body).toContain('pointerdown');
    expect(launcher.body).toContain('pointermove');
    expect(launcher.body).toContain('pointercancel');
    expect(launcher.body).toContain('opacity:.72');
    expect(launcher.body).toContain('data-dragging');

    const agents = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/api/agents' });
    expect(agents.statusCode).toBe(200);
    expect(agents.json()).toMatchObject({ entries: [{ agentId: 'agent-a', kind: 'agent', sessionCount: 1 }] });

    const diagnosticStatus = await server.inject({
      method: 'GET',
      url: '/__nextagent/dev/workbench/api/developer-diagnostics/status',
    });
    expect(diagnosticStatus.json()).toEqual({
      availability: 'DEGRADED',
      droppedCount: 2,
      lastFailureCode: 'QUEUE_OVERLOADED',
    });
    expect(diagnosticStatus.body).not.toMatch(/payload|path|credential|token/i);

    const sessions = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/api/sessions' });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json()).toMatchObject({
      entries: [{ agentId: 'agent-a', sessionId: 'sess-1' }],
      detailAvailability: { status: 'available' },
    });

    const runs = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/api/runs?sessionId=sess-1' });
    expect(runs.statusCode).toBe(200);
    expect(runs.json()).toMatchObject({
      entries: [{ runId: 'run-1', sessionId: 'sess-1' }],
      detailAvailability: { status: 'available' },
    });

    const conversation = await server.inject({
      method: 'GET',
      url: '/__nextagent/dev/workbench/api/sessions/sess-1/conversation?requestRunId=run-1',
    });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.json()).toMatchObject({
      sessionId: 'sess-1',
      messages: [{ messageId: 'msg-1', content: 'hello' }],
      detailAvailability: { status: 'available' },
    });
    const unscopedConversation = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/api/sessions/sess-1/conversation' });
    expect(unscopedConversation.statusCode).toBe(400);

    const logs = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/api/runs/run-1/logs?agentId=agent-a&agentVersion=v1' });
    expect(logs.statusCode).toBe(200);
    expect(logs.json()).toMatchObject({
      requestRunId: 'run-1',
      entries: [],
      detailAvailability: { status: 'unavailable', reasonCode: 'LOG_DIRECTORY_UNAVAILABLE' },
    });

    await server.close();
  });

  it('serves workbench assets only from the dev namespace asset root', async () => {
    const server = Fastify({ logger: false });
    registerAgentDevWorkbench(server, registrationOptions(createReadPort()));

    const missing = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/assets/missing.js' });
    const traversal = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/assets/../package.json' });

    expect(missing.statusCode).toBe(404);
    expect(traversal.statusCode).toBe(404);

    await server.close();
  });

  it('shows running runs without opening stream transports', async () => {
    const server = Fastify({ logger: false });
    registerAgentDevWorkbench(server, {
      resolveAccessScope: () => routeScope,
      readPort: {
        ...createReadPort(),
        async listRuns() {
          const page = await createReadPort().listRuns(routeScope, {});
          return { ...page, entries: page.entries.map((entry) => ({ ...entry, status: 'EXECUTING' as const })) };
        },
        async getRunGraph() {
          return {
            requestRunId: 'run-1',
            nodes: [
              {
                actionId: 'run:run-1:request',
                type: 'request',
                label: 'Request accepted',
                status: 'running',
                refs: { runId: 'run-1' },
                detailAvailability: { status: 'partial', reasonCode: 'RUNNING' },
              },
            ],
            edges: [],
            effectiveView: {
              status: 'partial',
              modelIds: [],
              promptTemplateRefs: [],
              disclosedCapabilityIds: [],
              renderedToolNames: [],
              skillCapabilityIds: [],
              agentCapabilityIds: [],
              agentConfigurationAvailability: { status: 'unavailable', reasonCode: 'RUNNING' },
            },
            detailAvailability: { status: 'partial', reasonCode: 'RUNNING' },
          };
        },
      },
    });

    const graph = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/api/runs/run-1/graph' });
    expect(graph.statusCode).toBe(200);
    expect(graph.json()).toMatchObject({
      nodes: [{ status: 'running' }],
      detailAvailability: { status: 'partial', reasonCode: 'RUNNING' },
    });
    const page = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench' });
    expect(page.body).not.toMatch(/EventSource|WebSocket|\/stream/u);

    await server.close();
  });

  it('rejects invalid dev API responses through runtime schema validation', async () => {
    const server = Fastify({ logger: false });
    registerAgentDevWorkbench(server, {
      resolveAccessScope: () => routeScope,
      readPort: {
        ...createReadPort(),
        async listSessions() {
          return { entries: [{ bad: true }], detailAvailability: { status: 'available' } } as unknown as Awaited<
            ReturnType<AgentDevWorkbenchLocalReadPort['listSessions']>
          >;
        },
      },
    });

    const response = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/api/sessions' });
    expect(response.statusCode).toBe(500);

    await server.close();
  });

  it('isolates projection failures from page rendering and stored facts', async () => {
    const writes = { sessions: 0, messages: 0, timeline: 0, logs: 0 };
    const server = Fastify({ logger: false });
    registerAgentDevWorkbench(server, {
      resolveAccessScope: () => routeScope,
      readPort: {
        ...createReadPort(),
        async getRunGraph() {
          throw new Error('projection failed with raw prompt token=secret');
        },
        async getActionDetail() {
          throw new Error('detail projection failed');
        },
        async listLogEvidence() {
          throw new Error('log evidence unavailable');
        },
      },
    });

    const graph = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/api/runs/run-1/graph' });
    const detail = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/api/runs/run-1/actions/node-1' });
    const logs = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench/api/runs/run-1/logs' });
    const page = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench' });

    expect(graph.statusCode).toBe(500);
    expect(detail.statusCode).toBe(500);
    expect(logs.statusCode).toBe(500);
    expect(page.statusCode).toBe(200);
    expect(`${graph.body}\n${detail.body}\n${logs.body}`).toContain('AGENT_DEV_WORKBENCH_QUERY_FAILED');
    expect(`${graph.body}\n${detail.body}\n${logs.body}`).not.toMatch(/raw prompt|token=secret|detail projection failed|log evidence unavailable/u);
    expect(writes).toEqual({ sessions: 0, messages: 0, timeline: 0, logs: 0 });

    await server.close();
  });

  it('does not expose mutation endpoints', async () => {
    const server = Fastify({ logger: false });
    registerAgentDevWorkbench(server, registrationOptions(createReadPort()));

    for (const url of [
      '/__nextagent/dev/workbench/api/runs/run-1/retry',
      '/__nextagent/dev/workbench/api/runs/run-1/cancel',
      '/__nextagent/dev/workbench/api/runs/run-1/replay',
      '/__nextagent/dev/workbench/api/sessions/sess-1/fork',
      '/__nextagent/dev/workbench/api/pending-inputs/pending-1/answer',
    ]) {
      const response = await server.inject({ method: 'POST', url });
      expect(response.statusCode).toBe(404);
    }

    await server.close();
  });
});

function createReadPort(): AgentDevWorkbenchLocalReadPort {
  return {
    async listAgents() {
      return {
        entries: [
          {
            agentId: 'agent-a',
            agentVersion: 'v1',
            agentAssemblyRef: 'assembly-a',
            displayName: 'Agent A',
            kind: 'agent',
            sessionCount: 1,
            configurationAvailability: { status: 'unavailable', reasonCode: 'FIXTURE' },
          },
        ],
        detailAvailability: { status: 'available' },
      };
    },
    async listSessions() {
      return {
        entries: [
          {
            tenantId: 'tenant-a',
            subjectId: 'subject-a',
            agentId: 'agent-a',
            sessionId: 'sess-1',
            title: 'Session 1',
            createdAt: 1,
            updatedAt: 2,
            latestRunStatus: 'COMPLETED',
          },
        ],
        detailAvailability: { status: 'available' },
      };
    },
    async listConversation() {
      return {
        sessionId: 'sess-1',
        messages: [
          {
            messageId: 'msg-1',
            requestId: 'req-1',
            runId: 'run-1',
            role: 'USER',
            contentType: 'TEXT',
            content: 'hello',
            visible: true,
            createdAt: 1,
          },
        ],
        detailAvailability: { status: 'available' },
      };
    },
    async listRuns() {
      return {
        entries: [
          {
            tenantId: 'tenant-a',
            subjectId: 'subject-a',
            agentId: 'agent-a',
            agentVersion: 'v1',
            sessionId: 'sess-1',
            requestId: 'req-1',
            runId: 'run-1',
            agentAssemblyRef: 'assembly-a',
            attempt: 1,
            status: 'COMPLETED',
            terminalCommitState: 'COMMITTED',
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        detailAvailability: { status: 'available' },
      };
    },
    async getRunGraph() {
      return {
        requestRunId: 'run-1',
        nodes: [],
        edges: [],
        effectiveView: {
          status: 'partial',
          agentId: 'agent-a',
          agentVersion: 'v1',
          agentAssemblyRef: 'assembly-a',
          modelIds: [],
          promptTemplateRefs: [],
          disclosedCapabilityIds: [],
          renderedToolNames: [],
          skillCapabilityIds: [],
          agentCapabilityIds: [],
          agentConfigurationAvailability: { status: 'unavailable', reasonCode: 'AGENT_ASSEMBLY_REGISTRY_UNAVAILABLE' },
        },
        detailAvailability: { status: 'partial', reasonCode: 'TIMELINE_UNAVAILABLE' },
      };
    },
    async getActionDetail() {
      return {
        actionId: 'timeline:event-1',
        detailAvailability: { status: 'partial', reasonCode: 'SAFE_SUMMARY_ONLY' },
        refs: {},
        safeSummary: { rawUnavailable: true },
      };
    },
    async listLogEvidence() {
      return {
        requestRunId: 'run-1',
        entries: [],
        detailAvailability: { status: 'unavailable', reasonCode: 'LOG_DIRECTORY_UNAVAILABLE' },
      };
    },
  };
}

function registrationOptions(readPort: AgentDevWorkbenchLocalReadPort): AgentDevWorkbenchRegistrationOptions {
  return { readPort, resolveAccessScope: () => routeScope };
}
