import { randomUUID } from 'node:crypto';
import { AgentError, brand, getLogger, type IdentityContext } from '@nextagent/agent-common';
import type { SandboxExecutionRequest, SandboxExecutionResult } from '@nextagent/agent-contracts/gateway';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import {
  buildClipExecutionArgs,
  clipDescribeTarget,
  normalizeClipDescribeResult,
  type ClipCommandRunner,
  type ClipExecutionRequest,
  type ClipSourceOptions,
} from './clip-tool-source.js';
import { createClipStreamDeltaEmitter, parseClipExecutionOutput } from './clip-command-output.js';

const logger = getLogger({ component: 'agent-capability', source: 'sandbox-clip-command-runner' });

export interface SandboxClipGatewayPort {
  execute: (request: SandboxExecutionRequest, signal?: AbortSignal) => Promise<SandboxExecutionResult>;
  executeWithStdoutChunks?: (
    request: SandboxExecutionRequest,
    options: { readonly onStdoutChunk?: (chunk: string) => void | Promise<void> },
    signal?: AbortSignal,
  ) => Promise<SandboxExecutionResult>;
}

export function createSandboxClipCommandRunner(input: {
  readonly sandboxGateway: SandboxClipGatewayPort;
  readonly identity: IdentityContext;
  readonly executionCorrelation?: ExecutionCorrelationPort;
  readonly remoteSandbox?: boolean;
}): ClipCommandRunner {
  return {
    async listTools(_provider, options, signal) {
      const result = await input.sandboxGateway.execute(
        clipStartupExecutionRequest(input.identity, 'startup-clip-list', options, [
          'list',
          '--status',
          'all',
          '--limit',
          '1000',
          '--json',
          '--show-id',
        ]),
        signal,
      );
      if (result.safeError !== undefined || result.exitCode !== 0 || result.timedOut) {
        throw new AgentError({
          code: 'CLIP_RUNNER_UNAVAILABLE',
          message:
            'The CLIP command could not start because the governed sandbox runner is unavailable. Choose another available capability, answer without this integration, or stop and report the unavailable runner.',
          category: 'UNAVAILABLE',
          retryable: false,
        });
      }
      return parseRunnerArray(result.stdout);
    },
    async describeTool(_provider, options, listedTool, signal) {
      const listed = clipDescribeTarget(listedTool);
      const result = await input.sandboxGateway.execute(
        clipStartupExecutionRequest(input.identity, `startup-clip-describe-${listed.target}`, options, ['describe', listed.target, listed.ref]),
        signal,
      );
      if (result.safeError !== undefined || result.exitCode !== 0 || result.timedOut) {
        throw new AgentError({
          code: 'CLIP_RUNNER_UNAVAILABLE',
          message:
            'The CLIP command could not start because the governed sandbox runner is unavailable. Choose another available capability, answer without this integration, or stop and report the unavailable runner.',
          category: 'UNAVAILABLE',
          retryable: false,
        });
      }
      return normalizeClipDescribeResult(listedTool, parseRunnerObject(result.stdout));
    },
    async executeTool(request, signal, options) {
      const stream = createClipStreamDeltaEmitter(options?.emitResultDelta);
      const traceHeaders = input.executionCorrelation?.outboundHeaders() ?? {};
      const systemHeaders = { ...traceHeaders, ...(options?.trustedHeaders ?? {}) };
      const clipExecutionRequest = clipToolExecutionRequest(input.identity, request, systemHeaders, input.remoteSandbox ?? false);
      logger.debug({
        event: 'clip.sandbox.execute_full_command',
        clipcCapabilityId: request.clipCapabilityId,
        clipcPrimitive: request.primitive,
        clipcArgCount: clipExecutionRequest.args.length,
        timeoutMs: clipExecutionRequest.timeoutMs,
      });
      const result =
        input.sandboxGateway.executeWithStdoutChunks === undefined
          ? await input.sandboxGateway.execute(clipExecutionRequest, signal)
          : await input.sandboxGateway.executeWithStdoutChunks(
              clipExecutionRequest,
              {
                onStdoutChunk: async (chunk) => {
                  await stream.accept(chunk);
                },
              },
              signal,
            );
      await stream.flush();
      if (result.safeError !== undefined || result.exitCode !== 0 || result.timedOut) {
        throw new AgentError({
          code: 'CLIP_EXECUTION_UNAVAILABLE',
          message:
            'The governed CLIP command execution boundary failed before a usable result was returned. Choose another available capability, answer without this integration, or stop and report the unavailable execution boundary.',
          category: 'UNAVAILABLE',
          retryable: false,
        });
      }
      return parseClipExecutionOutput(result.stdout);
    },
  };
}

function clipStartupExecutionRequest(identity: IdentityContext, executionId: string, options: ClipSourceOptions, args: readonly string[]) {
  return {
    executionId,
    requestRunId: brand<string, 'RequestRunId'>('startup-clip-discovery'),
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    executable: 'bash' as const,
    command: options.clipPathRef,
    args,
    filesystem: startupClipFilesystem(),
    environment: {},
    timeoutMs: options.timeoutMs,
    stdoutLimitBytes: 1_000_000,
    stderrLimitBytes: 16_384,
  };
}

function clipToolExecutionRequest(
  identity: IdentityContext,
  request: ClipExecutionRequest,
  systemHeaders: Readonly<Record<string, string>>,
  remoteSandbox: boolean,
) {
  const builtArgs = buildClipExecutionArgs(request, systemHeaders);
  return {
    executionId: randomUUID(),
    requestRunId: brand<string, 'RequestRunId'>('clip-tool-execution'),
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    executable: 'bash' as const,
    command: request.clipPathRef,
    args: remoteSandbox ? builtArgs.map(quotePosixShellToken) : builtArgs,
    filesystem: startupClipFilesystem(),
    environment: {},
    timeoutMs: request.timeoutMs,
    stdoutLimitBytes: 1_000_000,
    stderrLimitBytes: 16_384,
  };
}

function quotePosixShellToken(token: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/u.test(token)) {
    return token;
  }
  return `'${token.replace(/'/gu, `'\"'\"'`)}'`;
}

function startupClipFilesystem() {
  return { defaultCwd: process.cwd(), roots: [] };
}

function parseRunnerArray(stdout: string): readonly unknown[] {
  const parsed = JSON.parse(stdout) as unknown;
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (isRecord(parsed) && Array.isArray(parsed['items'])) {
    return parsed['items'];
  }
  throw new AgentError({
    code: 'CLIP_RUNNER_RESPONSE_INVALID',
    message:
      'The CLIP runner returned an invalid response envelope, so no result was delivered. Do not repeat the same call unchanged; choose another capability or stop and report the invalid integration result.',
    category: 'VALIDATION',
    retryable: false,
  });
}

function parseRunnerObject(stdout: string): unknown {
  const parsed = JSON.parse(stdout) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AgentError({
      code: 'CLIP_RUNNER_RESPONSE_INVALID',
      message:
        'The CLIP runner returned an invalid response envelope, so no result was delivered. Do not repeat the same call unchanged; choose another capability or stop and report the invalid integration result.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
