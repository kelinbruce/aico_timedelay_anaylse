import { createNextAgentTestApp } from '../src/composition/create-test-composition.js';
import { AgentError, type JsonObject } from '@nextagent/agent-common';
import { describe, expect, it } from 'vitest';

describe('runtime trajectory observability', () => {
  it('does not change request completion when the trajectory logger throws', async () => {
    const throwingLogger = {
      debug() {
        throw new Error('logger unavailable');
      },
      info() {
        throw new Error('logger unavailable');
      },
      warn() {
        throw new Error('logger unavailable');
      },
      error() {
        throw new Error('logger unavailable');
      },
    };
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'completed despite logger failure' }],
      observationLogger: throwingLogger,
    });
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'test logger isolation', idempotencyKey: 'trajectory-logger-isolation' },
      });
      expect(accepted.statusCode).toBe(200);
      await app.runtime.waitForIdle({ timeoutMs: 5_000 });
      const body = accepted.json<{ sessionId: string }>();
      const conversation = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${body.sessionId}/conversation`,
      });
      expect(conversation.statusCode).toBe(200);
      expect(conversation.body).toContain('completed despite logger failure');
    } finally {
      await app.close();
    }
  });

  it('projects context budget, capability selection, sandbox execution outcome, and first visible content into observability logs', async () => {
    const entries: unknown[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      sandboxGateway: {
        async execute(request) {
          return {
            executionId: request.executionId,
            stdout: '',
            stderr: '',
            exitCode: 0,
            stdoutTruncated: false,
            stderrTruncated: false,
            timedOut: false,
            durationMs: 0,
          };
        },
        isExecutionReady() {
          return true;
        },
      },
      modelSteps: [
        {
          toolCalls: [{ toolCallId: 'tool-python-1', toolName: 'Python', arguments: { code: "print('ok')" } }],
        },
        {
          contentChunks: ['done'],
        },
      ],
      observationLogger: {
        debug(entry) {
          entries.push({ ...entry, level: 'debug' });
        },
        info(entry) {
          entries.push({ ...entry, level: 'info' });
        },
        warn(entry) {
          entries.push({ ...entry, level: 'warn' });
        },
        error(entry) {
          entries.push({ ...entry, level: 'error' });
        },
      },
    });

    try {
      const session = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
      const sessionId = session.json<{ sessionId: string }>().sessionId;
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'run ls', idempotencyKey: 'runtime-trajectory-1', sessionId },
      });

      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ runId: string }>();

      await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
      });

      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'info',
            event: 'context.assembly.completed',
            sessionId,
            runId: body.runId,
          }),
          expect.objectContaining({
            event: 'capability.started',
            sessionId,
            runId: body.runId,
            capabilityInvocationId: 'tool-python-1',
            details: expect.objectContaining({
              capabilityId: 'Python',
            }),
          }),
          expect.objectContaining({
            level: 'info',
            event: 'model.stream.first_visible_content',
            sessionId,
            runId: body.runId,
            stepId: 'turn-2',
          }),
          expect.objectContaining({
            event: 'model.invocation.started',
            runId: body.runId,
            stepId: 'turn-1',
            details: expect.objectContaining({
              disclosedCapabilityNames: expect.arrayContaining(['Python']),
              messageCountBucket: expect.any(String),
            }),
          }),
          expect.objectContaining({
            event: 'model.invocation.completed',
            runId: body.runId,
            stepId: 'turn-1',
            details: expect.objectContaining({
              resolvedToolNames: ['Python'],
            }),
          }),
        ]),
      );

      const capabilityOutcome = findDiagnostic(entries, ['capability.completed', 'capability.failed', 'capability.security.failed'], 'tool-python-1');
      expect(capabilityOutcome).toBeDefined();
      expect(capabilityOutcome).toEqual(
        expect.objectContaining({
          sessionId,
          runId: body.runId,
          capabilityInvocationId: 'tool-python-1',
          details: expect.objectContaining({
            capabilityId: 'Python',
            validatedArgumentNames: ['code'],
            argumentProjectionStatus: 'PROJECTED',
          }),
        }),
      );

      const sandboxEntries = entries.filter((entry) => readEvent(entry) === 'sandbox.execution.completed');
      expect(sandboxEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'info',
            runId: body.runId,
            details: expect.objectContaining({ executableKind: 'python' }),
          }),
        ]),
      );
      expect(JSON.stringify(entries)).not.toMatch(/"operation"|"outcome"|"safeSummary"|"correlation"|"ownerScope"|"requestContextId"/u);
    } finally {
      await app.close();
    }
  });

  it('projects tool-specific safe summaries for grep into observability logs', async () => {
    const entries: unknown[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-grep-1',
              toolName: 'Grep',
              arguments: { pattern: 'createNextAgentTestApp', path: 'workspace/packages/agent-app/tests', output_mode: 'content' },
            },
          ],
        },
        {
          contentChunks: ['grep done'],
        },
      ],
      observationLogger: {
        debug(entry) {
          entries.push({ ...entry, level: 'debug' });
        },
        info(entry) {
          entries.push({ ...entry, level: 'info' });
        },
        warn(entry) {
          entries.push({ ...entry, level: 'warn' });
        },
        error(entry) {
          entries.push({ ...entry, level: 'error' });
        },
      },
    });

    try {
      const session = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
      const sessionId = session.json<{ sessionId: string }>().sessionId;
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'run grep', idempotencyKey: 'runtime-trajectory-grep-1', sessionId },
      });

      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ runId: string }>();

      await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
      });

      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'capability.started',
            sessionId,
            runId: body.runId,
            capabilityInvocationId: 'tool-grep-1',
            details: expect.objectContaining({
              capabilityId: 'Grep',
            }),
          }),
          expect.objectContaining({
            event: 'capability.failed',
            sessionId,
            runId: body.runId,
            capabilityInvocationId: 'tool-grep-1',
            details: expect.objectContaining({
              capabilityId: 'Grep',
              grepOutputMode: 'content',
              status: 'FAILED',
            }),
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('writes sandbox failure diagnostics and unified python failure completion logs', async () => {
    const structuredEntries: unknown[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      observationLogger: {
        debug(entry) {
          structuredEntries.push({ ...entry, level: 'debug' });
        },
        info(entry) {
          structuredEntries.push({ ...entry, level: 'info' });
        },
        warn(entry) {
          structuredEntries.push({ ...entry, level: 'warn' });
        },
        error(entry) {
          structuredEntries.push({ ...entry, level: 'error' });
        },
      },
      sandboxGateway: {
        async execute() {
          throw new AgentError({
            code: 'SANDBOX_UNAVAILABLE',
            message: 'Sandbox execution is unavailable.',
            category: 'UNAVAILABLE',
            retryable: false,
            safeDetails: { reason: 'sandbox-offline' },
          });
        },
        isExecutionReady() {
          return true;
        },
      },
      modelSteps: [
        {
          toolCalls: [{ toolCallId: 'tool-python-1', toolName: 'Python', arguments: { code: "print('hello')" } }],
        },
        {
          contentChunks: ['done'],
        },
      ],
    });

    try {
      const session = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
      const sessionId = session.json<{ sessionId: string }>().sessionId;
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'run python', idempotencyKey: 'runtime-python-failure-1', sessionId },
      });

      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ runId: string }>();

      await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
      });

      expect(structuredEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'error',
            event: 'sandbox.execution.failed',
            runId: body.runId,
            safeReasonCode: 'SANDBOX_UNAVAILABLE',
            details: expect.objectContaining({ safeErrorCategory: 'UNAVAILABLE' }),
          }),
          expect.objectContaining({
            level: 'error',
            event: 'capability.failed',
            runId: body.runId,
            capabilityInvocationId: 'tool-python-1',
            safeReasonCode: 'SANDBOX_UNAVAILABLE',
            details: expect.objectContaining({ capabilityId: 'Python' }),
          }),
        ]),
      );
      expect(JSON.stringify(structuredEntries)).not.toContain('sandbox-offline');
    } finally {
      await app.close();
    }
  });

  it('formats raw exception failures into bounded runtime diagnostics', async () => {
    const structuredEntries: unknown[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      observationLogger: {
        debug(entry) {
          structuredEntries.push({ ...entry, level: 'debug' });
        },
        info(entry) {
          structuredEntries.push({ ...entry, level: 'info' });
        },
        warn(entry) {
          structuredEntries.push({ ...entry, level: 'warn' });
        },
        error(entry) {
          structuredEntries.push({ ...entry, level: 'error' });
        },
      },
      sandboxGateway: {
        async execute() {
          const error = new Error('clip worker crashed at C:\\sandbox\\worker\\index.js:42');
          error.cause = new Error('spawn EPERM /tmp/agent-run/child');
          throw error;
        },
        isExecutionReady() {
          return true;
        },
      },
      modelSteps: [
        {
          toolCalls: [{ toolCallId: 'tool-python-ex-1', toolName: 'Python', arguments: { code: "print('explode')" } }],
        },
        {
          contentChunks: ['done'],
        },
      ],
    });

    try {
      const session = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
      const sessionId = session.json<{ sessionId: string }>().sessionId;
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'run python explode', idempotencyKey: 'runtime-python-exception-1', sessionId },
      });

      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ runId: string }>();

      await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
      });

      expect(structuredEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'error',
            event: 'sandbox.execution.failed',
            runId: body.runId,
            safeReasonCode: 'SANDBOX_EXECUTION_FAILED',
            details: expect.objectContaining({ safeErrorCategory: 'INTERNAL' }),
          }),
          expect.objectContaining({
            level: 'error',
            event: 'capability.failed',
            runId: body.runId,
            capabilityInvocationId: 'tool-python-ex-1',
            safeReasonCode: 'CAPABILITY_EXECUTION_FAILED',
            details: expect.objectContaining({ capabilityId: 'Python' }),
          }),
        ]),
      );
      expect(JSON.stringify(structuredEntries)).not.toMatch(/clip worker|C:\\sandbox|\/tmp\/agent-run|spawn EPERM/u);
    } finally {
      await app.close();
    }
  });
});

function readEvent(entry: unknown): string | undefined {
  return isJsonObject(entry) ? readString(entry.event) : undefined;
}

function findDiagnostic(entries: readonly unknown[], events: readonly string[], capabilityInvocationId?: string): unknown {
  return entries.find((entry) => {
    if (!isJsonObject(entry) || !events.includes(readEvent(entry) ?? '')) {
      return false;
    }
    if (capabilityInvocationId === undefined) {
      return true;
    }
    return readString(entry.capabilityInvocationId) === capabilityInvocationId;
  });
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
