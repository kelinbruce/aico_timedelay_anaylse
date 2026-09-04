import { brand, type IdentityContext } from '@nextagent/agent-common';
import { type RestrictedLocalSandboxGatewayPort } from '@nextagent/agent-platform-gateway-local';
import type {
  BackgroundCompletionPayload,
  BackgroundStartResult,
  SandboxExecutionRequest,
  SandboxExecutionResult,
} from '@nextagent/agent-contracts/gateway';
import type { RiskPolicyDecision, RiskPolicyEvaluator, RiskPolicyEvaluationInput } from '@nextagent/agent-contracts/runtime';
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { describe, expect, it, vi } from 'vitest';

const identity: IdentityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-bg-endpoint'),
  subjectId: brand<string, 'SubjectId'>('subject-bg-endpoint'),
  displayName: 'Background tasks tester',
};
const agentId = brand<string, 'AgentId'>('default-agent');

const permissiveRiskPolicy: RiskPolicyEvaluator = {
  async evaluate(_input: RiskPolicyEvaluationInput): Promise<RiskPolicyDecision> {
    return { outcome: 'ALLOW', reasonCode: 'TEST_ALLOW' };
  },
};

async function waitForRunTerminal(app: ReturnType<typeof createNextAgentTestApp>, runId: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(runId),
    });
    if (run?.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run ${runId} did not reach terminal within ${timeoutMs}ms`);
}

describe('background tasks endpoint integration', () => {
  it('keeps the originating request active when a foreground Bash task completes naturally', async () => {
    const startBackground = vi.fn(async (request: SandboxExecutionRequest): Promise<BackgroundStartResult> => ({
      handle: {
        taskId: request.executionId,
        status: 'RUNNING',
        stdoutRef: `tool-results/${request.executionId}.stdout.txt`,
        stderrRef: `tool-results/${request.executionId}.stderr.txt`,
        startedAt: brand<number, 'EpochMillis'>(100),
      },
      completion: Promise.resolve({
        taskId: request.executionId,
        exitCode: 0,
        status: 'COMPLETED',
        finishedAt: brand<number, 'EpochMillis'>(200),
      }),
    }));
    const sandboxGateway: RestrictedLocalSandboxGatewayPort = {
      execute: async (request: SandboxExecutionRequest): Promise<SandboxExecutionResult> => ({
        executionId: request.executionId,
        stdout: '',
        stderr: '',
        exitCode: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 0,
      }),
      startBackground,
      killBackground: async () => ({ killed: false }),
      isExecutionReady: () => true,
    };
    const app = createNextAgentTestApp({
      identity,
      riskPolicyEvaluator: permissiveRiskPolicy,
      sandboxGateway,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-bash-natural-completion',
              toolName: 'Bash',
              arguments: { command: 'ls -l', description: 'list workspace' },
            },
          ],
        },
        { content: 'workspace listed' },
      ],
    });

    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'list the workspace', idempotencyKey: 'idem-bg-natural-completion' },
      });
      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ sessionId: string; runId: string }>();
      await waitForRunTerminal(app, body.runId);

      const originalRun = await app.gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId: brand<string, 'RequestRunId'>(body.runId),
      });
      const lane = await app.gateway.requestRuns.loadSessionLaneSnapshot({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
      });

      expect(startBackground).toHaveBeenCalledTimes(1);
      expect(originalRun?.status).toBe('COMPLETED');
      expect(lane.latestRun?.runId).toBe(body.runId);
      expect(lane.queuedRuns).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('lists a background task started via run_in_background with safe fields only', async () => {
    const completion: Promise<BackgroundCompletionPayload> = new Promise(() => {
      /* never resolves: process keeps running */
    });
    const startBackground = vi.fn(async (request: SandboxExecutionRequest): Promise<BackgroundStartResult> => ({
      handle: {
        taskId: request.executionId,
        status: 'RUNNING',
        stdoutRef: `tool-results/${request.executionId}.stdout.txt`,
        stderrRef: `tool-results/${request.executionId}.stderr.txt`,
        startedAt: brand<number, 'EpochMillis'>(100),
      },
      completion,
    }));
    const sandboxGateway: RestrictedLocalSandboxGatewayPort = {
      execute: async (request: SandboxExecutionRequest): Promise<SandboxExecutionResult> => ({
        executionId: request.executionId,
        stdout: '',
        stderr: '',
        exitCode: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 0,
      }),
      startBackground,
      killBackground: async () => ({ killed: false }),
      isExecutionReady: () => true,
    };

    const app = createNextAgentTestApp({
      identity,
      riskPolicyEvaluator: permissiveRiskPolicy,
      sandboxGateway,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-bash-1',
              toolName: 'Bash',
              arguments: { command: 'sleep 5', description: 'long build', run_in_background: true },
            },
          ],
        },
        { content: 'background task started, continuing' },
      ],
    });

    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'run a long build in the background', idempotencyKey: 'idem-bg-int-1' },
      });
      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ sessionId: string; runId: string }>();

      await waitForRunTerminal(app, body.runId);

      expect(startBackground).toHaveBeenCalledTimes(1);
      const startedRequestId = startBackground.mock.calls[0]?.[0]?.executionId;

      const listRes = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${body.sessionId}/background-tasks`,
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = listRes.json<{ tasks: Array<Record<string, unknown>> }>();
      expect(listBody.tasks).toHaveLength(1);
      const task = listBody.tasks[0]!;
      expect(task['taskId']).toBe(startedRequestId);
      expect(task['status']).toBe('RUNNING');
      expect(task['commandName']).toBe('sleep');
      expect(String(task['stdoutRef'])).toContain('tool-results/');
      expect(String(task['stdoutRef'])).toContain('.stdout.txt');
      // commandLine (display-only full command) is intentionally exposed.
      expect(typeof task['commandLine']).toBe('string');
      expect(String(task['commandLine'])).toContain('sleep');
      // Safe fields only — no identity, no run/request ids, no host paths.
      expect(task['identityContext']).toBeUndefined();
      expect(task['runId']).toBeUndefined();
      expect(task['requestId']).toBeUndefined();
      expect(task['workspaceRoot']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns an empty list when a session has no background tasks', async () => {
    const app = createNextAgentTestApp({
      identity,
      riskPolicyEvaluator: permissiveRiskPolicy,
      modelSteps: [{ content: 'no tool call' }],
    });
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'hello', idempotencyKey: 'idem-bg-int-2' },
      });
      const body = accepted.json<{ sessionId: string; runId: string }>();
      await waitForRunTerminal(app, body.runId);

      const listRes = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${body.sessionId}/background-tasks`,
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = listRes.json<{ tasks: unknown[] }>();
      expect(listBody.tasks).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns an empty list for a session that has not been created yet', async () => {
    const app = createNextAgentTestApp({
      identity,
      riskPolicyEvaluator: permissiveRiskPolicy,
      modelSteps: [{ content: 'no tool call' }],
    });
    try {
      const listRes = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/session-never-created/background-tasks`,
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = listRes.json<{ tasks: unknown[] }>();
      expect(listBody.tasks).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('kills a RUNNING task via SIGTERM, then rejects a repeat kill as ALREADY_TERMINAL', async () => {
    const completion: Promise<BackgroundCompletionPayload> = new Promise(() => {
      /* never resolves */
    });
    const startBackground = vi.fn(async (request: SandboxExecutionRequest): Promise<BackgroundStartResult> => ({
      handle: {
        taskId: request.executionId,
        status: 'RUNNING',
        stdoutRef: `tool-results/${request.executionId}.stdout.txt`,
        stderrRef: `tool-results/${request.executionId}.stderr.txt`,
        startedAt: brand<number, 'EpochMillis'>(100),
      },
      completion,
    }));
    const killBackground = vi.fn(async () => ({ killed: true }));
    const sandboxGateway: RestrictedLocalSandboxGatewayPort = {
      execute: async (request: SandboxExecutionRequest): Promise<SandboxExecutionResult> => ({
        executionId: request.executionId,
        stdout: '',
        stderr: '',
        exitCode: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 0,
      }),
      startBackground,
      killBackground,
      isExecutionReady: () => true,
    };

    const app = createNextAgentTestApp({
      identity,
      riskPolicyEvaluator: permissiveRiskPolicy,
      sandboxGateway,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-bash-kill',
              toolName: 'Bash',
              arguments: { command: 'sleep 30', description: 'long build', run_in_background: true },
            },
          ],
        },
        { content: 'background task started' },
      ],
    });

    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'run a long build in the background', idempotencyKey: 'idem-bg-kill-1' },
      });
      const body = accepted.json<{ sessionId: string; runId: string }>();
      await waitForRunTerminal(app, body.runId);
      const taskId = startBackground.mock.calls[0]?.[0]?.executionId!;

      const killRes = await app.server.inject({
        method: 'POST',
        url: `/api/v1/sessions/${body.sessionId}/background-tasks/${taskId}/kill`,
      });
      expect(killRes.statusCode).toBe(200);
      expect(killBackground).toHaveBeenCalledTimes(1);
      expect(killRes.json<{ status: string }>().status).toBe('KILLED');

      // A repeat kill on the now-terminal task is rejected.
      const killAgain = await app.server.inject({
        method: 'POST',
        url: `/api/v1/sessions/${body.sessionId}/background-tasks/${taskId}/kill`,
      });
      expect(killAgain.statusCode).toBe(200);
      expect(killAgain.json<{ status: string }>().status).toBe('ALREADY_TERMINAL');
      // The sandbox was NOT signaled a second time.
      expect(killBackground).toHaveBeenCalledTimes(1);

      // The list reflects KILLED.
      const listRes = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${body.sessionId}/background-tasks`,
      });
      const task = listRes.json<{ tasks: Array<{ status: string }> }>().tasks[0]!;
      expect(task.status).toBe('KILLED');
    } finally {
      await app.close();
    }
  });

  it('kill returns NOT_FOUND for an unknown task in a valid session', async () => {
    const app = createNextAgentTestApp({
      identity,
      riskPolicyEvaluator: permissiveRiskPolicy,
      modelSteps: [{ content: 'no tool call' }],
    });
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'hello', idempotencyKey: 'idem-bg-notfound' },
      });
      const body = accepted.json<{ sessionId: string; runId: string }>();
      await waitForRunTerminal(app, body.runId);

      const killRes = await app.server.inject({
        method: 'POST',
        url: `/api/v1/sessions/${body.sessionId}/background-tasks/does-not-exist/kill`,
      });
      expect(killRes.statusCode).toBe(200);
      expect(killRes.json<{ status: string }>().status).toBe('NOT_FOUND');
    } finally {
      await app.close();
    }
  });

  it('output endpoint returns 404 for an unknown task and content for a known task', async () => {
    const completion: Promise<BackgroundCompletionPayload> = new Promise(() => {
      /* never resolves */
    });
    const startBackground = vi.fn(async (request: SandboxExecutionRequest): Promise<BackgroundStartResult> => ({
      handle: {
        taskId: request.executionId,
        status: 'RUNNING',
        stdoutRef: `tool-results/${request.executionId}.stdout.txt`,
        stderrRef: `tool-results/${request.executionId}.stderr.txt`,
        startedAt: brand<number, 'EpochMillis'>(100),
      },
      completion,
    }));
    const sandboxGateway: RestrictedLocalSandboxGatewayPort = {
      execute: async (request: SandboxExecutionRequest): Promise<SandboxExecutionResult> => ({
        executionId: request.executionId,
        stdout: '',
        stderr: '',
        exitCode: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 0,
      }),
      startBackground,
      killBackground: async () => ({ killed: false }),
      isExecutionReady: () => true,
    };

    const app = createNextAgentTestApp({
      identity,
      riskPolicyEvaluator: permissiveRiskPolicy,
      sandboxGateway,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-bash-out',
              toolName: 'Bash',
              arguments: { command: 'sleep 30', description: 'long build', run_in_background: true },
            },
          ],
        },
        { content: 'background task started' },
      ],
    });

    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'run a long build in the background', idempotencyKey: 'idem-bg-out-1' },
      });
      const body = accepted.json<{ sessionId: string; runId: string }>();
      await waitForRunTerminal(app, body.runId);
      const taskId = startBackground.mock.calls[0]?.[0]?.executionId!;

      // Unknown task → 404.
      const notFoundRes = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${body.sessionId}/background-tasks/unknown/output?stream=stdout`,
      });
      expect(notFoundRes.statusCode).toBe(404);

      // Known task → 200 with content + truncated fields (file may be empty).
      const outRes = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${body.sessionId}/background-tasks/${taskId}/output?stream=stdout&limitBytes=1024`,
      });
      expect(outRes.statusCode).toBe(200);
      const outBody = outRes.json<{ content: string; truncated: boolean; stream: string }>();
      expect(outBody.stream).toBe('stdout');
      expect(typeof outBody.content).toBe('string');
      expect(typeof outBody.truncated).toBe('boolean');
    } finally {
      await app.close();
    }
  });
});
