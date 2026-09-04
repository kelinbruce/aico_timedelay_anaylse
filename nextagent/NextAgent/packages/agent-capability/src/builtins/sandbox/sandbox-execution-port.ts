import {
  AgentError,
  brand,
  getLogger,
  type CapabilityId,
  type EpochMillis,
  type JsonObject,
  type RestrictedOperationKind,
  type RiskLevel,
  type RiskPolicyOutcome,
  type SafeError,
} from '@nextagent/agent-common';
import type {
  BackgroundCompletionPayload,
  BackgroundStartResult,
  BackgroundTaskRecord,
  BackgroundTaskStoreGatewayPort,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxGatewayPort,
} from '@nextagent/agent-contracts/gateway';
import { raceBackgroundableCompletion } from '@nextagent/agent-contracts/gateway';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SandboxExecutionInput, SandboxExecutionPort, ToolExecutionContext, WorkspaceFilePort } from '../../tools/tool-spi.js';

const logger = getLogger({ component: 'agent-capability', source: 'sandbox-execution-port' });
const python36SubprocessRunCompatibilityPrelude = String.raw`
# NextAgent compatibility: Python 3.6 subprocess.run lacks capture_output/text.
import subprocess as _nextagent_subprocess

_nextagent_original_subprocess_run = _nextagent_subprocess.run

def _nextagent_subprocess_run_compat(*popenargs, **kwargs):
    if "capture_output" in kwargs:
        capture_output = kwargs.pop("capture_output")
        if capture_output:
            if kwargs.get("stdout") is not None or kwargs.get("stderr") is not None:
                raise ValueError("stdout and stderr arguments may not be used with capture_output.")
            kwargs["stdout"] = _nextagent_subprocess.PIPE
            kwargs["stderr"] = _nextagent_subprocess.PIPE
    if "text" in kwargs:
        kwargs["universal_newlines"] = kwargs.pop("text")
    return _nextagent_original_subprocess_run(*popenargs, **kwargs)

_nextagent_subprocess.run = _nextagent_subprocess_run_compat
`;

export interface SandboxGatewayExecutionAdapter {
  execute: (request: SandboxExecutionRequest, signal?: AbortSignal) => Promise<SandboxExecutionResult>;
  executeWithStdoutChunks?: (
    request: SandboxExecutionRequest,
    options: { readonly onStdoutChunk?: (chunk: string) => void | Promise<void> },
    signal?: AbortSignal,
  ) => Promise<SandboxExecutionResult>;
  isExecutionReady?: () => boolean;
}

export interface WorkspaceBackedSandboxExecutionPortOptions {
  readonly gateway: SandboxGatewayPort;
  readonly workspaceFiles: WorkspaceFilePort;
  readonly riskPolicyEvaluator: RiskPolicyEvaluator;
  readonly backgroundTaskStore?: BackgroundTaskStoreGatewayPort;
  readonly onBackgroundStart?: (record: BackgroundTaskRecord) => Promise<void>;
  readonly onBackgroundComplete?: (payload: BackgroundCompletionPayload) => void;
}

export interface RiskPolicyEvaluator {
  evaluate: (input: RiskPolicyEvaluationInput, signal?: AbortSignal) => Promise<RiskPolicyDecision>;
}

interface RiskPolicyEvaluationInput {
  readonly sessionId: ToolExecutionContext['sessionId'];
  readonly requestId: ToolExecutionContext['requestId'];
  readonly requestRunId: ToolExecutionContext['runId'];
  readonly requestContextId: ToolExecutionContext['requestContextId'];
  readonly identityContext: ToolExecutionContext['identityContext'];
  readonly agentId: ToolExecutionContext['agentId'];
  readonly agentVersion: ToolExecutionContext['agentVersion'];
  readonly operation: RestrictedOperationSummary;
  readonly capabilityAvailable: boolean;
  readonly capabilityEnabled: boolean;
  readonly policyId?: string;
  readonly policyVersion?: string;
}

interface RestrictedOperationSummary {
  readonly operationId: string;
  readonly operationKind: RestrictedOperationKind;
  readonly capabilityId?: CapabilityId;
  readonly toolCallId?: string;
  readonly executable?: 'bash' | 'python';
  readonly riskLevel: RiskLevel;
  readonly targetOwnerScopeMatched: boolean;
  readonly parametersSchemaValid: boolean;
  readonly requiresSandbox: boolean;
  readonly sandboxReady: boolean;
  readonly observabilityReady: boolean;
}

interface RiskPolicyDecision {
  readonly outcome: RiskPolicyOutcome;
  readonly reasonCode: string;
  readonly safeError?: SafeError;
}

interface SandboxSubmission {
  readonly command: string;
  readonly args: readonly string[];
  readonly cleanup: () => Promise<void>;
}

export function createWorkspaceBackedSandboxExecutionPort(options: WorkspaceBackedSandboxExecutionPortOptions): SandboxExecutionPort {
  const backgroundEnabled =
    options.backgroundTaskStore !== undefined && options.onBackgroundComplete !== undefined && options.gateway.startBackground !== undefined;
  const runShellFn = async (input: SandboxExecutionInput, context: ToolExecutionContext, signal?: AbortSignal) =>
    runSandbox(options, 'bash', input, context, signal);
  const gatewaySupportsStreaming = typeof (options.gateway as SandboxGatewayExecutionAdapter).executeWithStdoutChunks === 'function';
  return {
    runShell: runShellFn,
    ...(gatewaySupportsStreaming
      ? {
          runShellStreaming: async (input, context, onStdoutChunk, signal) => runSandbox(options, 'bash', input, context, signal, onStdoutChunk),
        }
      : {}),
    runPython: async (input, context, signal) => runSandbox(options, 'python', input, context, signal),
    runShellBackgroundable: backgroundEnabled
      ? async (input, context, signal) => runShellBackgroundable(options, input, context, signal)
      : runShellFn,
    startBackgroundShell: backgroundEnabled
      ? async (input, context) => startBackgroundShell(options, input, context)
      : async () => {
          throw new AgentError({
            code: 'SANDBOX_BACKGROUND_UNAVAILABLE',
            message:
              'Background sandbox execution could not start because this deployment has no governed background runner. Use foreground execution if appropriate, choose another capability, or stop and report the unavailable runner.',
            category: 'UNAVAILABLE',
            retryable: false,
          });
        },
  };
}

async function runSandbox(
  options: WorkspaceBackedSandboxExecutionPortOptions,
  executable: 'bash' | 'python',
  input: SandboxExecutionInput,
  context: ToolExecutionContext,
  signal?: AbortSignal,
  onStdoutChunk?: (chunk: string) => void | Promise<void>,
): Promise<JsonObject> {
  const submission =
    executable === 'python'
      ? await createPythonSandboxSubmission(options.workspaceFiles, context, input)
      : { command: input.command, args: input.args, cleanup: async () => {} };
  try {
    const sandboxReady = (options.gateway as SandboxGatewayExecutionAdapter).isExecutionReady?.() ?? true;
    const policyInput = {
      sessionId: context.sessionId,
      requestId: context.requestId,
      requestRunId: context.runId,
      requestContextId: context.requestContextId,
      identityContext: context.identityContext,
      agentId: context.agentId,
      agentVersion: context.agentVersion,
      operation: summarizeSandboxOperation({
        executable,
        command: submission.command,
        args: submission.args,
        sandboxReady,
        observabilityReady: context.emitPolicyApplied !== undefined,
      }),
      capabilityAvailable: true,
      capabilityEnabled: true,
      policyId: 'builtin-risk-policy',
      policyVersion: '1',
    } satisfies RiskPolicyEvaluationInput;
    const policyDecision = await evaluateRiskPolicySafely(options.riskPolicyEvaluator, policyInput, signal);
    if (policyDecision.outcome !== 'ALLOW') {
      logger.warn({
        event: 'sandbox.risk_policy.denied',
        executable,
        outcome: policyDecision.outcome,
        reasonCode: policyDecision.reasonCode,
        observabilityReady: policyInput.operation.observabilityReady,
        sandboxReady: policyInput.operation.sandboxReady,
      });
    }
    const policyEvaluation = toPolicyAppliedPayload(policyInput, policyDecision);
    await context.emitPolicyApplied?.(policyEvaluation);
    if (policyDecision.outcome !== 'ALLOW') {
      throw toRiskPolicyError(policyDecision);
    }
    const request = await sandboxRequest(options.workspaceFiles, executable, submission, input, context);
    const gatewayAdapter = options.gateway as SandboxGatewayExecutionAdapter;
    const result =
      onStdoutChunk !== undefined && gatewayAdapter.executeWithStdoutChunks !== undefined
        ? await gatewayAdapter.executeWithStdoutChunks(request, { onStdoutChunk }, signal)
        : await options.gateway.execute(request, signal);
    if (result.safeError !== undefined) {
      throw new AgentError(toSandboxCapabilitySafeError(result.safeError));
    }
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? -1,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      timedOut: result.timedOut,
    };
  } finally {
    await submission.cleanup();
  }
}

function summarizeSandboxOperation(input: {
  readonly executable: 'bash' | 'python';
  readonly command: string;
  readonly args: readonly string[];
  readonly sandboxReady: boolean;
  readonly observabilityReady?: boolean;
}): RestrictedOperationSummary {
  return {
    operationId: `${input.executable}:${input.command}`,
    operationKind: 'SANDBOX_EXECUTION',
    executable: input.executable,
    riskLevel: 'MEDIUM',
    targetOwnerScopeMatched: true,
    parametersSchemaValid: input.command.length > 0 && input.args.every((arg) => typeof arg === 'string'),
    requiresSandbox: true,
    sandboxReady: input.sandboxReady,
    observabilityReady: input.observabilityReady ?? true,
  };
}

async function evaluateRiskPolicySafely(
  evaluator: RiskPolicyEvaluator,
  input: RiskPolicyEvaluationInput,
  signal?: AbortSignal,
): Promise<RiskPolicyDecision> {
  try {
    return await evaluator.evaluate(input, signal);
  } catch {
    return {
      outcome: 'POLICY_FAILED',
      reasonCode: 'RISK_POLICY_EVALUATION_FAILED',
    };
  }
}

function toPolicyAppliedPayload(
  input: RiskPolicyEvaluationInput,
  decision: RiskPolicyDecision,
): Parameters<NonNullable<ToolExecutionContext['emitPolicyApplied']>>[0] {
  return {
    operationKind: input.operation.operationKind,
    operationId: input.operation.operationId,
    outcome: decision.outcome,
    reasonCode: decision.reasonCode,
    riskLevel: input.operation.riskLevel,
    ...(input.operation.capabilityId === undefined ? {} : { capabilityId: input.operation.capabilityId }),
    ...(input.operation.toolCallId === undefined ? {} : { toolCallId: input.operation.toolCallId }),
  };
}

function toRiskPolicyError(decision: RiskPolicyDecision): AgentError {
  switch (decision.outcome) {
    case 'DENY':
      return new AgentError({
        code: decision.reasonCode,
        message:
          'Risk policy denied the requested sandbox operation in the current trusted scope. Choose an already allowed command or alternative capability, or stop and report that the operation is not permitted.',
        category: 'POLICY_DENIED',
        retryable: false,
      });
    case 'DEGRADED':
      return new AgentError({
        code: decision.reasonCode,
        message:
          'The sandbox operation could not start because the governed risk-policy dependency is unavailable. Choose a non-sandbox alternative, try again later, or stop and report the unavailable policy boundary.',
        category: 'UNAVAILABLE',
        retryable: false,
      });
    case 'POLICY_FAILED':
      return new AgentError({
        code: decision.reasonCode,
        message:
          'Risk-policy evaluation failed at the governed pre-dispatch boundary, so the sandbox operation did not start. Choose an already allowed alternative capability or stop and report the policy-evaluation failure.',
        category: 'INTERNAL',
        retryable: false,
      });
    case 'REQUIRE_AUTHORIZATION':
      return new AgentError({
        code: decision.reasonCode,
        message:
          'Risk policy requires explicit authorization before this sandbox operation can start. Wait for the runtime authorization control or choose an already allowed alternative; do not treat this message as authorization.',
        category: 'POLICY_DENIED',
        retryable: false,
      });
    case 'ALLOW':
      return new AgentError({
        code: 'RISK_POLICY_UNEXPECTED_ALLOW_ERROR',
        message:
          'The sandbox policy adapter received an inconsistent ALLOW result while constructing an error, so execution stopped before dispatch. Choose another capability or stop and report the policy-adapter failure.',
        category: 'INTERNAL',
        retryable: false,
      });
    default: {
      const exhaustive: never = decision.outcome;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

async function sandboxRequest(
  workspaceFiles: WorkspaceFilePort,
  executable: 'bash' | 'python',
  submission: { readonly command: string; readonly args: readonly string[] },
  input: SandboxExecutionInput,
  context: ToolExecutionContext,
): Promise<SandboxExecutionRequest> {
  const filesystem = await workspaceFiles.sandboxFilesystem(context);
  return {
    executionId: randomUUID(),
    requestRunId: context.runId,
    tenantId: context.identityContext.tenantId,
    subjectId: context.identityContext.subjectId,
    executable,
    command: submission.command,
    args: submission.args,
    filesystem,
    environment: buildSandboxEnvironment(context, input.environment),
    timeoutMs: input.timeoutMs,
    stdoutLimitBytes: input.stdoutLimitBytes,
    stderrLimitBytes: input.stderrLimitBytes,
  };
}

async function createPythonSandboxSubmission(
  workspaceFiles: WorkspaceFilePort,
  context: ToolExecutionContext,
  input: SandboxExecutionInput,
): Promise<SandboxSubmission> {
  if (input.command === 'python' || input.command === 'python3') {
    return { command: input.command, args: input.args, cleanup: async () => {} };
  }
  const view = await workspaceFiles.resolveView(context);
  const tempRoot = view.roots.find((root) => root.kind === 'temp');
  if (tempRoot === undefined) {
    throw new AgentError({
      code: 'SANDBOX_TEMP_UNAVAILABLE',
      message:
        'Python sandbox execution could not start because its governed temporary workspace is unavailable. Choose another available capability or stop and report the unavailable sandbox workspace.',
      category: 'UNAVAILABLE',
      retryable: false,
    });
  }
  await mkdir(tempRoot.physicalPath, { recursive: true });
  const scriptName = `${randomUUID()}.py`;
  const scriptPath = join(tempRoot.physicalPath, scriptName);
  await writeFile(scriptPath, buildPythonInlineScript(input.command), 'utf8');
  return {
    command: 'python',
    args: [`temp/${scriptName}`, ...input.args],
    cleanup: async () => {
      await rm(scriptPath, { force: true });
    },
  };
}

function buildPythonInlineScript(source: string): string {
  const lines = source.split(/\r?\n/u);
  let insertAt = 0;
  if (lines[0]?.startsWith('#!') === true) {
    insertAt = 1;
  }
  if (lines[insertAt] !== undefined && /^#.*coding[:=]\s*[-\w.]+/u.test(lines[insertAt]!)) {
    insertAt += 1;
  }
  insertAt = advancePastPythonTrivia(lines, insertAt);
  insertAt = advancePastPythonModuleDocstring(lines, insertAt);
  insertAt = advancePastPythonTrivia(lines, insertAt);
  while (lines[insertAt] !== undefined && /^\s*from\s+__future__\s+import\s+/u.test(lines[insertAt]!)) {
    insertAt += 1;
    insertAt = advancePastPythonTrivia(lines, insertAt);
  }
  return [...lines.slice(0, insertAt), python36SubprocessRunCompatibilityPrelude, ...lines.slice(insertAt)].join('\n');
}

function advancePastPythonTrivia(lines: readonly string[], start: number): number {
  let index = start;
  while (lines[index] !== undefined && /^\s*(?:#.*)?$/u.test(lines[index]!)) {
    index += 1;
  }
  return index;
}

function advancePastPythonModuleDocstring(lines: readonly string[], start: number): number {
  const line = lines[start];
  if (line === undefined) {
    return start;
  }
  const trimmed = line.trimStart();
  let delimiter: string | undefined;
  if (trimmed.startsWith('"""')) {
    delimiter = '"""';
  } else if (trimmed.startsWith("'''")) {
    delimiter = "'''";
  }
  if (delimiter === undefined) {
    return start;
  }
  if (trimmed.indexOf(delimiter, delimiter.length) >= delimiter.length) {
    return start + 1;
  }
  let index = start + 1;
  while (lines[index] !== undefined) {
    if (lines[index]!.includes(delimiter)) {
      return index + 1;
    }
    index += 1;
  }
  return start;
}

function toSandboxCapabilitySafeError(error: SafeError): SafeError {
  const sandboxReason = sandboxSafeReason(error);
  if (sandboxReason === 'denied-executable' || sandboxReason === 'unsupported-executable' || sandboxReason === 'shell-composition-not-allowed') {
    return {
      code: 'COMMAND_NOT_ALLOWED',
      message:
        'Sandbox policy does not allow executing this command. The executable is not in the supported set. Choose a different command or use an available alternative capability.',
      category: 'AUTHORIZATION',
      retryable: false,
      safeDetails: { ...(error.safeDetails ?? {}), sandboxReasonCode: error.code },
    };
  }
  if (sandboxReason === 'unsupported-python-invocation') {
    return {
      code: 'CAPABILITY_INPUT_INVALID',
      message: 'Python invocation mode is not supported by the sandbox.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        ...(error.safeDetails ?? {}),
        sandboxReasonCode: error.code,
        hint: 'Use python with a script path or an authorized -m module invocation; do not use python -c, python -, incomplete -m, or extra args with --version.',
      },
    };
  }
  if (sandboxReason === 'unsafe-path' || sandboxReason === 'unauthorized-path' || sandboxReason === 'permission-denied') {
    return {
      code: 'CAPABILITY_PATH_REJECTED',
      message:
        'Sandbox policy rejected the requested path. The path is outside the authorized scope. Use a path within the workspace or choose an alternative capability.',
      category: 'AUTHORIZATION',
      retryable: false,
      safeDetails: { ...(error.safeDetails ?? {}), sandboxReasonCode: error.code },
    };
  }
  if (error.category === 'CANCELED') {
    return {
      code: 'SANDBOX_EXECUTION_CANCELED',
      message: 'Sandbox execution was canceled.',
      category: 'CANCELED',
      retryable: false,
      ...(error.safeDetails === undefined ? {} : { safeDetails: error.safeDetails }),
    };
  }
  if (error.category === 'UNAVAILABLE') {
    return {
      code: 'SANDBOX_UNAVAILABLE',
      message:
        'The governed sandbox execution boundary is unavailable before a usable result was returned. Choose another available capability, try again later when permitted by the task, or stop and report the unavailable sandbox.',
      category: 'UNAVAILABLE',
      retryable: error.retryable,
      safeDetails: { ...(error.safeDetails ?? {}), sandboxReasonCode: error.code },
    };
  }
  return error;
}

function sandboxSafeReason(error: SafeError): string | undefined {
  const details = error.safeDetails;
  if (details === undefined) {
    return undefined;
  }
  const reason = details['reason'];
  return typeof reason === 'string' ? reason : undefined;
}

// ---- Background execution support (LOCAL deployments) ----
// When backgroundTaskStore + onBackgroundComplete + gateway.startBackground are
// all present, createWorkspaceBackedSandboxExecutionPort enables real detached
// background execution. Otherwise it degrades to foreground-only.

interface PreparedBackgroundExecution {
  readonly taskId: string;
  readonly request: SandboxExecutionRequest;
  readonly record: BackgroundTaskRecord;
  readonly workspaceRoot: string;
}

async function startBackgroundShell(
  options: WorkspaceBackedSandboxExecutionPortOptions,
  input: SandboxExecutionInput,
  context: ToolExecutionContext,
): Promise<JsonObject> {
  const prepared = await prepareBackgroundExecution(options, input, context);
  const started = await launchBackgroundProcess(options, prepared);
  if ('code' in started) {
    throw new AgentError({
      code: started.code,
      message: started.message,
      category: started.category,
      retryable: false,
      ...(started.safeDetails === undefined ? {} : { safeDetails: started.safeDetails }),
    });
  }
  await options.onBackgroundStart?.(prepared.record);
  started.completion.then((payload) => {
    void options.onBackgroundComplete?.(payload);
  });
  return {
    taskId: started.handle.taskId,
    status: started.handle.status,
    stdoutRef: started.handle.stdoutRef,
    stderrRef: started.handle.stderrRef,
  };
}

async function runShellBackgroundable(
  options: WorkspaceBackedSandboxExecutionPortOptions,
  input: SandboxExecutionInput,
  context: ToolExecutionContext,
  signal?: AbortSignal,
): Promise<JsonObject> {
  const prepared = await prepareBackgroundExecution(options, input, context);
  const started = await launchBackgroundProcess(options, prepared);
  if ('code' in started) {
    await options.backgroundTaskStore?.remove(prepared.taskId);
    return runSandbox(options, 'bash', input, context, signal);
  }
  const raced = await raceBackgroundableCompletion(started.completion, input.timeoutMs, signal).catch(async (error: unknown) => {
    await options.backgroundTaskStore?.remove(prepared.taskId);
    throw error;
  });
  if (raced.kind === 'completed') {
    // Foreground completion: the result is returned to the model inline, so
    // this command never actually became a background task. Drop the provisional
    // store record (so it does not pollute the background-task monitor panel)
    // and do NOT fire onBackgroundComplete — the model already has the result.
    // Only real background transitions (timeout / explicit / abort) keep the
    // record, emit STARTED, and notify on completion.
    await options.backgroundTaskStore!.remove(prepared.taskId);
    const stdout = await readBoundedOutput(`${prepared.workspaceRoot}/${prepared.record.stdoutRef}`, input.stdoutLimitBytes);
    const stderr = await readBoundedOutput(`${prepared.workspaceRoot}/${prepared.record.stderrRef}`, input.stderrLimitBytes);
    return {
      stdout: stdout.content,
      stderr: stderr.content,
      exitCode: raced.payload.exitCode,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      timedOut: false,
    };
  }
  // Confirmed background transition: emit STARTED now (not before the race, so
  // foreground-completing commands never appear in the monitor) and attach the
  // completion callback that emits the terminal event when the process exits.
  await options.onBackgroundStart?.(prepared.record);
  started.completion.then((payload) => {
    void options.onBackgroundComplete?.(payload);
  });
  return {
    taskId: prepared.taskId,
    status: 'RUNNING',
    stdoutRef: prepared.record.stdoutRef,
    stderrRef: prepared.record.stderrRef,
    backgroundReason: raced.reason,
  };
}

async function prepareBackgroundExecution(
  options: WorkspaceBackedSandboxExecutionPortOptions,
  input: SandboxExecutionInput,
  context: ToolExecutionContext,
): Promise<PreparedBackgroundExecution> {
  const taskId = randomUUID();
  const filesystem = await options.workspaceFiles.sandboxFilesystem(context);
  const workspaceRoot = filesystem.roots.find((root) => root.kind === 'workspace' && root.access === 'readWrite')?.physicalPath ?? '';
  const policyInput = {
    sessionId: context.sessionId,
    requestId: context.requestId,
    requestRunId: context.runId,
    requestContextId: context.requestContextId,
    identityContext: context.identityContext,
    agentId: context.agentId,
    agentVersion: context.agentVersion,
    operation: {
      operationId: `bash:${input.command}`,
      operationKind: 'SANDBOX_EXECUTION' as const,
      ...(context.toolCallId === undefined ? {} : { toolCallId: context.toolCallId }),
      executable: 'bash' as const,
      riskLevel: 'MEDIUM' as const,
      targetOwnerScopeMatched: true,
      parametersSchemaValid: true,
      requiresSandbox: true,
      sandboxReady: true,
      observabilityReady: context.emitPolicyApplied !== undefined,
    },
    capabilityAvailable: true,
    capabilityEnabled: true,
    policyId: 'builtin-risk-policy',
    policyVersion: '1',
  };
  const policyDecision = await evaluateRiskPolicySafely(options.riskPolicyEvaluator, policyInput, undefined);
  if (policyDecision.outcome !== 'ALLOW') {
    throw new AgentError({
      code: 'RISK_POLICY_DENIED',
      message:
        'Risk policy denied background sandbox execution in the current trusted scope. Use foreground execution if already allowed, choose another allowed capability, or stop and report that background execution is not permitted.',
      category: 'AUTHORIZATION',
      retryable: false,
    });
  }
  const stdoutRef = `tool-results/${taskId}.stdout.txt`;
  const stderrRef = `tool-results/${taskId}.stderr.txt`;
  const startedAt = brand<number, 'EpochMillis'>(Date.now());
  const record: BackgroundTaskRecord = {
    taskId,
    sessionId: context.sessionId,
    agentId: context.agentId,
    agentVersion: context.agentVersion,
    runId: context.runId,
    requestId: context.requestId,
    requestContextId: context.requestContextId,
    toolCallId: context.toolCallId,
    commandName: input.command,
    commandLine: formatCommandLine(input.command, input.args),
    workspaceRoot,
    identityContext: context.identityContext,
    ...(context.locale === undefined ? {} : { locale: context.locale }),
    status: 'RUNNING',
    stdoutRef,
    stderrRef,
    startedAt,
    notified: false,
  };
  const request: SandboxExecutionRequest = {
    executionId: taskId,
    requestRunId: context.runId,
    tenantId: context.identityContext.tenantId,
    subjectId: context.identityContext.subjectId,
    executable: 'bash',
    command: input.command,
    args: input.args,
    filesystem,
    environment: buildSandboxEnvironment(context),
    timeoutMs: input.timeoutMs,
    stdoutLimitBytes: input.stdoutLimitBytes,
    stderrLimitBytes: input.stderrLimitBytes,
  };
  return { taskId, request, record, workspaceRoot };
}

async function launchBackgroundProcess(
  options: WorkspaceBackedSandboxExecutionPortOptions,
  prepared: PreparedBackgroundExecution,
): Promise<BackgroundStartResult | SafeError> {
  if (options.gateway.startBackground === undefined) {
    return {
      code: 'SANDBOX_BACKGROUND_UNAVAILABLE',
      message:
        'Background sandbox execution could not start because the deployment has no governed background runner. Use foreground execution if appropriate, choose another capability, or stop and report the unavailable runner.',
      category: 'UNAVAILABLE',
      retryable: false,
    };
  }
  try {
    const started = options.gateway.startBackground(prepared.request);
    if ('code' in started) {
      return started;
    }
    await options.backgroundTaskStore!.create(prepared.record);
    return started;
  } catch {
    return {
      code: 'SANDBOX_BACKGROUND_UNAVAILABLE',
      message:
        'Background sandbox execution failed at the governed spawn boundary before a task was accepted. Use foreground execution if appropriate, choose another capability, or stop and report the background-start failure.',
      category: 'UNAVAILABLE',
      retryable: false,
    };
  }
}

async function readBoundedOutput(filePath: string, limit: number): Promise<{ content: string; truncated: boolean }> {
  if (filePath === '') {
    return { content: '', truncated: false };
  }
  try {
    const { readFile } = await import('node:fs/promises');
    const buffer = await readFile(filePath);
    if (buffer.length <= limit) {
      return { content: decodeOutputBuffer(buffer), truncated: false };
    }
    return { content: decodeOutputBuffer(buffer.subarray(0, limit)), truncated: true };
  } catch {
    return { content: '', truncated: false };
  }
}

const utf8DecoderFatal = new TextDecoder('utf-8', { fatal: true });
function decodeOutputBuffer(buffer: Uint8Array): string {
  try {
    return utf8DecoderFatal.decode(buffer);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch {
      return new TextDecoder('utf-8').decode(buffer);
    }
  }
}

function formatCommandLine(command: string, args: readonly string[]): string {
  const tokens = [command, ...args].map((token) => (token.length === 0 || /\s/u.test(token) ? `"${token.replace(/"/gu, '""')}"` : token));
  return tokens.join(' ');
}

/**
 * Inject materialized execution paths as FILE_PATHS without model visibility.
 */
function buildSandboxEnvironment(context: ToolExecutionContext, inputEnvironment?: JsonObject): JsonObject {
  const attachmentPaths = context.attachmentPaths;
  const environment: Record<string, unknown> = {};
  const pythonPath = inputEnvironment?.['PYTHONPATH'];
  if (typeof pythonPath === 'string') {
    environment['PYTHONPATH'] = pythonPath;
  }
  if (attachmentPaths !== undefined && attachmentPaths.length > 0) {
    environment['FILE_PATHS'] = JSON.stringify(attachmentPaths);
  }
  return environment as JsonObject;
}
