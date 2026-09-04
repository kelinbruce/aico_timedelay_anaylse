import { AgentError, brand, getLogger, type JsonObject } from '@nextagent/agent-common';

import {
  defineTool,
  ToolTimedOutResultError,
  type ToolDefinition,
  type ToolExecuteOptions,
  type ToolExecutionContext,
} from '../../tools/tool-spi.js';
import { validateJson } from '../../tools/tool-catalog.js';
import { builtinToolPresentation } from '../presentation-names.js';
import { parseBashCommand, type ParsedBashCommand } from './bash-policy.js';
import {
  bashBackgroundOutputSchema,
  bashConfigSchema,
  bashExecutionOutputSchema,
  createBashInputSchema,
  createBashOutputSchema,
} from './bash-schemas.js';
import { detectSupportedPlatform, prepareBuiltinExecutableFacts } from '../executable-facts.js';
import { createBashStreamDeltaEmitter, normalizeClipSubscribeCommandStdout } from '../../clip/clip-command-output.js';

export const bashCapabilityId = brand<string, 'CapabilityId'>('Bash');

const logger = getLogger({ component: 'agent-capability', source: 'bash-tool' });

/**
 * Grace window used to detect commands that finish immediately even when the
 * agent requested `run_in_background`. A command that exits within this window
 * (e.g. `pwd`, or a bad command that fails at once) is returned as a normal
 * foreground tool result instead of a pointless background task; only commands
 * still running after the window become background tasks.
 */
const BACKGROUND_IMMEDIATE_CHECK_MS = 1000;

const MODEL_ALLOWED_ENV_KEYS = new Set(['PYTHONPATH']);

const AUTO_INJECTED_ENV_KEYS = ['NEXTAGENT_USER_ID', 'NEXTAGENT_USER_NAME', 'NEXTAGENT_CHAT_ID', 'NEXTAGENT_CONVERSATION_ID'] as const;

const CURL_DEFAULT_MAX_TIME_SECONDS = 600;

export interface BashToolDefinitionOptions {
  readonly backgroundExecutionEnabled?: boolean;
}

interface ParsedBashInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly environment: JsonObject;
}

const bashToolDescription = [
  'Execute one bounded local command through the governed sandbox boundary.',
  '',
  'When to use:',
  '- Run command-line operations such as builds, tests, packaging, version control, environment or system inspection, and an existing script or module.',
  '',
  'When NOT to use:',
  '- Prefer a dedicated file tool when it directly represents a known-path read/write/edit or structured name/content search.',
  '- To execute direct Python source in a `code` field, use Python; to launch an existing `.py` file, use Bash with the exact discovered path.',
  '',
  'Key behaviors:',
  '- `command` is tokenized and submitted through the sandbox gateway; executable authority is owned by the composed sandbox policy.',
  '- Bash supports two invocation modes. Command-string mode: put the full shell-like command string in `command`, do not provide `args`, and optionally use `env.PYTHONPATH` for Python imports.',
  '- Argv mode: set `command` to exactly one executable token and put every other token in `args`, including `-m`, script paths, flags, JSON, and user text.',
  '- Never split one command between `command` and `args`; when `args` is provided, `command` must be only the executable.',
  '- `env` supports only `PYTHONPATH`; other keys are rejected. `NEXTAGENT_USER_ID`/`USER_NAME`/`CHAT_ID`/`CONVERSATION_ID` are runtime-injected; never set them or put credentials/business params in `env`.',
  '- `clipc --params`: when a Skill opts in via `api_header_params`, runtime injects the declared `X-Subject-Id`/`X-Display-Name`; never set them manually.',
  '- For quote-heavy arguments such as JSON, Gremlin, SQL, regex, paths, or natural-language queries, prefer argv mode so each value is passed unchanged as one sandbox argv entry.',
  '- When using structured `args`, create JSON arguments with a JSON serializer so nested quotes remain valid inside a single argv entry.',
  '- Do not run inline Python with `python -c`, `python -`, or other Python CLI modes. Use Python with a `code` field for inline source; use Bash only for `python <script.py> ...`, `python -m package.module ...`, or exact `python --version` interpreter inspection.',
  '- Do not prefix commands with shell environment assignments such as `PYTHONPATH=... python ...`; use structured `env.PYTHONPATH` or let this compatibility layer normalize a single leading PYTHONPATH assignment.',
  '- Submit the executable and its arguments directly. Shell built-ins, chaining, and interpreter modes are forwarded to the sandbox gateway; validation-mode behavior is owned by the composed sandbox policy.',
  '- Reuse exact executable and script paths returned by earlier results. Quote arguments completely when they contain spaces or natural language.',
  '- Compatibility: direct `python`/`python3` execution of a `.py` file or direct `bash`/`sh` execution of a `.sh` file may resolve `scripts/...` or `<skill-name>/scripts/...` against the current verified Skill projections. Only one matching script is completed; multiple matches fail with root-qualified candidates.',
  '- Explicit root-qualified paths are never rewritten. Inline modes, shell wrappers, pipes, redirections, command substitutions, non-script resources, and arbitrary text arguments are not Skill-path corrected.',
  '- Timed-out commands return a safe timeout result.',
  '- stdout and stderr are each capped at 100 KB; inspect `stdoutTruncated` and `stderrTruncated` before treating output as complete.',
  '- A non-zero exit code is a normal completed result; the structured payload always includes exitCode, stdout, stderr, and truncation flags regardless of exit status.',
  '- Each invocation runs in its own process; working-directory and environment changes do not persist. Include the required path or state in every dependent invocation.',
  '- Run commands in the foreground by default. Set `run_in_background: true` ONLY for persistent processes (a server, daemon) or genuinely long-running tasks (a build/download that takes minutes); for anything that finishes quickly, the foreground returns the result immediately, so backgrounding it only delays the result to a later turn.',
].join('\n');

export function createBashToolDefinition(options: BashToolDefinitionOptions = {}): ToolDefinition {
  const backgroundExecutionEnabled = options.backgroundExecutionEnabled ?? false;
  const inputSchema = createBashInputSchema({ backgroundExecutionEnabled });
  const outputSchema = createBashOutputSchema({ backgroundExecutionEnabled });
  return defineTool({
    name: bashCapabilityId,
    ...builtinToolPresentation('Bash'),
    description: bashToolDescription,
    inputSchema,
    outputSchema,
    configSchema: bashConfigSchema,
    requiredDependencies: ['sandbox', 'workspaceFiles'],
    replayPolicy: 'NON_IDEMPOTENT',
    disclosurePolicy: { mode: 'EAGER' },
    configure() {
      return {
        async execute(input, execOptions): Promise<JsonObject> {
          return executeBash(input, execOptions, backgroundExecutionEnabled);
        },
      };
    },
    async execute(input, execOptions): Promise<JsonObject> {
      return executeBash(input, execOptions, backgroundExecutionEnabled);
    },
  });
}

export const bashToolDefinition: ToolDefinition = createBashToolDefinition();

function isPythonExecutable(executable: string): boolean {
  return executable === 'python' || executable === 'python3';
}

function resolveTimeoutMs(input: JsonObject, trustedTimeoutMs: number): number {
  const canonical = input['timeout'];
  const alias = input['timeout_ms'];
  const requestedTimeout = typeof canonical === 'number' ? canonical : typeof alias === 'number' ? alias : 600_000;
  return Math.min(requestedTimeout, trustedTimeoutMs, 600_000);
}

/**
 * Project a sandbox background-handle response into the tool result shape.
 * `defaultReason` is set only for auto-backgrounded handles (the foreground
 * path); explicit background starts omit it.
 */
function shapeBackgroundHandle(handle: JsonObject, defaultReason?: string): JsonObject {
  const isAutoBackground = defaultReason !== undefined;
  return {
    taskId: String(handle['taskId'] ?? ''),
    status: String(handle['status'] ?? 'RUNNING'),
    stdoutRef: String(handle['stdoutRef'] ?? ''),
    stderrRef: String(handle['stderrRef'] ?? ''),
    ...(isAutoBackground ? { backgroundReason: String(handle['backgroundReason'] ?? defaultReason) } : {}),
    message: isAutoBackground
      ? 'Foreground command timed out and was moved to background; it keeps running. You will not be notified when it completes, so do not promise to read or report the result automatically — the user can ask you to read it later. Do not mention task IDs, file paths, or other technical details to the user.'
      : 'Background task started; it keeps running in the background. You will not be notified when it completes, so do not promise to read or report the result automatically — the user can ask you to read it later. Do not mention task IDs, file paths, or other technical details to the user.',
  };
}

function shapeValidatedBackgroundHandle(handle: JsonObject, defaultReason?: string): JsonObject {
  if (!validateJson(bashBackgroundOutputSchema, handle)) {
    throw new Error('Sandbox returned an invalid Bash background response.');
  }
  return shapeBackgroundHandle(handle, defaultReason);
}

async function executeBash(input: JsonObject, options: ToolExecuteOptions | undefined, backgroundExecutionEnabled: boolean): Promise<JsonObject> {
  if (options?.deps?.sandbox === undefined || options.deps.workspaceFiles === undefined || options.context === undefined) {
    throw new AgentError({
      code: 'CAPABILITY_EXECUTION_FAILED',
      message:
        'Bash execution could not start because the required sandbox boundary is unavailable. The command was not executed. Stop this action and report the error.',
      category: 'INTERNAL',
      retryable: false,
    });
  }
  const runInBackground = input['run_in_background'] === true;
  if (runInBackground && !backgroundExecutionEnabled) {
    throw new AgentError({
      code: 'CAPABILITY_INPUT_INVALID',
      message:
        'Bash validation failed before execution: background execution is not available in this deployment. Remove run_in_background and use foreground execution, or choose another capability.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'BASH_BACKGROUND_UNAVAILABLE' },
    });
  }
  const command = String(input['command']);
  const parsedInput = parseBashInputForModelCorrection(command, input['args'], input['env']);
  const clipcIdentityHeaders = readClipcIdentityHeaderOptIn(options.context.flowVariables);
  const parsed =
    parsedInput.executable === 'clipc' && clipcIdentityHeaders.size > 0
      ? { ...parsedInput, args: injectClipcIdentityParams(parsedInput.args, options.context.identityContext, clipcIdentityHeaders) }
      : parsedInput;
  const environment = options.context ? injectIdentityEnvironment(options.context, parsed.environment) : parsed.environment;
  const timeoutMs = resolveTimeoutMs(input, options.context.timeoutMs);
  const isPython = isPythonExecutable(parsed.executable);
  if (isPython) {
    rejectUnsupportedPythonInvocationForModelCorrection(parsed.args);
  }
  const resolvedArgs = await resolveSkillRelativeScriptArgs(parsed, options.deps.workspaceFiles, options.context);
  const finalArgs = prepareCurlArguments(parsed.executable, resolvedArgs);
  const facts = prepareBuiltinExecutableFacts({
    platform: detectSupportedPlatform(),
    executable: isPython ? 'python' : 'bash',
    command: parsed.executable,
    args: finalArgs,
    controlledInterpreters: isPython ? { python: parsed.executable } : {},
    environment,
    environmentAllowlist: ['PYTHONPATH', ...AUTO_INJECTED_ENV_KEYS],
  });
  const sandboxInput = {
    command: facts.command,
    args: facts.args,
    environment: facts.environment,
    timeoutMs,
    stdoutLimitBytes: 1_000_000,
    stderrLimitBytes: 1_000_000,
  };
  if (runInBackground) {
    // Race a short grace window before committing to a background task. A
    // command that finishes within the window (especially one that fails or
    // exits immediately, e.g. `pwd`) is returned inline as a normal foreground
    // tool result — there's no point backgrounding a command that already
    // exited. Only commands still running after the window become background
    // tasks.
    const sandbox = options.deps.sandbox;
    if (typeof sandbox.runShellBackgroundable === 'function') {
      const immediateOutput = await sandbox.runShellBackgroundable(
        { ...sandboxInput, timeoutMs: BACKGROUND_IMMEDIATE_CHECK_MS },
        options.context,
        options.signal,
      );
      if (immediateOutput['taskId'] !== undefined) {
        return shapeValidatedBackgroundHandle(immediateOutput);
      }
      if (!validateJson(bashExecutionOutputSchema, immediateOutput)) {
        throw new Error('Sandbox returned an invalid Bash execution response.');
      }
      return mapBashExecutionOutput(immediateOutput, facts);
    }
    const handle = await sandbox.startBackgroundShell(sandboxInput, options.context);
    return shapeValidatedBackgroundHandle(handle);
  }
  // Foreground path: in local deployments, run shell backgroundable so a timeout
  // auto-transitions to a background task instead of killing the running child.
  const useBackgroundable = backgroundExecutionEnabled && !isPython;
  const sandbox = options.deps.sandbox;
  let streamFormat = input['stream_format'];
  if (streamFormat === undefined) {
    const commandText = `${sandboxInput.command} ${(sandboxInput.args ?? []).join(' ')}`;
    if (
      commandText.includes('text/event-stream') ||
      commandText.includes('/sse/') ||
      commandText.includes('--no-buffer') ||
      commandText.includes(' -N ')
    ) {
      streamFormat = 'sse';
    }
  }
  const runShellStreamingFn = sandbox.runShellStreaming;
  const useStreaming = (streamFormat === 'sse' || streamFormat === 'ndjson') && typeof runShellStreamingFn === 'function';
  logger.info({
    event: 'bash.streaming.decision',
    streamFormat: streamFormat ?? 'unset',
    runShellStreamingAvailable: typeof runShellStreamingFn === 'function',
    useStreaming,
  });
  let output: JsonObject;
  if (useStreaming && runShellStreamingFn !== undefined) {
    const emitter = createBashStreamDeltaEmitter(options.context.emitResultDelta);
    output = await runShellStreamingFn(
      sandboxInput,
      options.context,
      async (chunk) => {
        await emitter.accept(chunk);
      },
      options.signal,
    );
    await emitter.flush();
    logger.info({ event: 'bash.streaming.completed', exitCode: output['exitCode'] });
  } else if (useBackgroundable) {
    output = await sandbox.runShellBackgroundable(sandboxInput, options.context, options.signal);
  } else {
    output = await (isPython ? sandbox.runPython : sandbox.runShell)(sandboxInput, options.context, options.signal);
  }
  if (output['taskId'] !== undefined) {
    return shapeValidatedBackgroundHandle(output, 'TIMEOUT_AUTO_BACKGROUND');
  }
  if (!validateJson(bashExecutionOutputSchema, output)) {
    throw new Error('Sandbox returned an invalid Bash execution response.');
  }
  return mapBashExecutionOutput(output, facts);
}

async function resolveSkillRelativeScriptArgs(
  parsed: ParsedBashInput,
  workspaceFiles: NonNullable<ToolExecuteOptions['deps']>['workspaceFiles'],
  context: NonNullable<ToolExecuteOptions['context']>,
): Promise<readonly string[]> {
  if (workspaceFiles?.resolveSkillResourcePath === undefined || hasShellComposition(parsed.args)) {
    return parsed.args;
  }
  const scriptPath = parsed.args[0];
  const requiredExtension = scriptExtensionForExecutable(parsed.executable);
  if (scriptPath === undefined || requiredExtension === undefined || !scriptPath.endsWith(requiredExtension)) {
    return parsed.args;
  }
  if (!isSupportedSkillRelativeScriptPath(scriptPath)) {
    return parsed.args;
  }
  const resolution = await workspaceFiles.resolveSkillResourcePath(scriptPath, context);
  if (resolution.status === 'not-found') {
    return parsed.args;
  }
  if (resolution.status === 'ambiguous') {
    throw new AgentError({
      code: 'SKILL_RESOURCE_PATH_AMBIGUOUS',
      message:
        'Bash could not select a Skill script because the relative path matches multiple loaded Skills. Use one of the root-qualified candidate paths and call Bash again.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { candidates: resolution.candidates },
    });
  }
  return [resolution.logicalPath, ...parsed.args.slice(1)];
}

function scriptExtensionForExecutable(executable: string): '.py' | '.sh' | undefined {
  if (executable === 'python' || executable === 'python3') {
    return '.py';
  }
  if (executable === 'bash' || executable === 'sh') {
    return '.sh';
  }
  return undefined;
}

function isSupportedSkillRelativeScriptPath(value: string): boolean {
  if (value.length === 0 || value.includes('\\') || value.startsWith('/') || value.includes(':')) {
    return false;
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return false;
  }
  if (['workspace', 'temp', '.nextagent', 'generated-skills', 'shared-data'].includes(segments[0]!)) {
    return false;
  }
  return (segments[0] === 'scripts' && segments.length >= 2) || (segments.length >= 3 && segments[1] === 'scripts');
}

function hasShellComposition(args: readonly string[]): boolean {
  const operators = new Set(['|', '||', '&', '&&', ';', '>', '>>', '<', '<<']);
  return args.some((arg) => operators.has(arg) || arg.includes('$(') || arg.includes('`'));
}

function mapBashExecutionOutput(output: JsonObject, facts: { readonly command: string; readonly args: readonly string[] }): JsonObject {
  const stdout = String(output['stdout']);
  const stderr = String(output['stderr']);
  const exitCode = Number(output['exitCode']);
  const stdoutTruncated = Boolean(output['stdoutTruncated']);
  const stderrTruncated = Boolean(output['stderrTruncated']);
  const projectedClipStdout = normalizeClipSubscribeCommandStdout({
    command: facts.command,
    args: facts.args,
    stdout,
  });
  const visibleStdout = projectedClipStdout?.stdout ?? stdout;
  const hasSafePartialOutput = visibleStdout.length > 0 || stderr.length > 0;
  if (output['timedOut'] === true) {
    throw new ToolTimedOutResultError(
      hasSafePartialOutput ? { stdout: visibleStdout, stderr, exitCode, stdoutTruncated, stderrTruncated } : {},
      'SANDBOX_TIMEOUT',
      {
        safeMessage: hasSafePartialOutput
          ? 'Bash execution timed out after producing safe partial output. Inspect stdout and stderr, then reduce the command scope before retrying.'
          : 'Bash execution timed out without safe output. Reduce the command scope before deciding whether to call Bash again.',
      },
    );
  }
  return {
    stdout: visibleStdout,
    stderr,
    exitCode,
    stdoutTruncated,
    stderrTruncated,
  };
}

function parseBashCommandForModelCorrection(command: string): ParsedBashCommand {
  try {
    return parseBashCommand(command);
  } catch (error) {
    if (error instanceof AgentError && error.code === 'COMMAND_NOT_ALLOWED') {
      const unclosedQuote = hasUnclosedQuote(command);
      const hasControlCharacter = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(command);
      const violations = [
        ...(unclosedQuote
          ? [
              {
                path: '/command',
                constraint: 'balancedQuotes',
                expected: 'a single command with every quoted argument closed',
              },
            ]
          : []),
        ...(hasControlCharacter
          ? [
              {
                path: '/command',
                constraint: 'noControlCharacters',
                expected: 'a command without control characters',
              },
            ]
          : []),
      ];
      if (violations.length === 0) {
        violations.push({
          path: '/command',
          constraint: 'tokenizable',
          expected: 'a single command that can be split into an executable and its arguments',
        });
      }
      const count = violations.length;
      throw new AgentError({
        code: 'COMMAND_NOT_ALLOWED',
        message: `Command format validation failed for ${count} constraint${count === 1 ? '' : 's'}. Correct the listed command format issues and call the capability again.`,
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          reasonCode: unclosedQuote ? 'BASH_COMMAND_UNCLOSED_QUOTE' : 'BASH_COMMAND_PARSE_FAILED',
          violations,
        },
      });
    }
    throw error;
  }
}

function parseBashInputForModelCorrection(command: string, argsInput: unknown, envInput: unknown): ParsedBashInput {
  const structuredEnvironment = parseStructuredBashEnvironment(envInput);
  if (argsInput === undefined) {
    const parsed = parseBashCommandForModelCorrection(command);
    return normalizeLeadingPythonPathAssignment(parsed, structuredEnvironment);
  }
  if (!Array.isArray(argsInput) || argsInput.some((arg) => typeof arg !== 'string')) {
    throw new AgentError({
      code: 'CAPABILITY_INPUT_INVALID',
      message: 'Bash validation failed before execution: args must be an array of strings. Correct or omit args and call Bash again.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const executable = parseBashCommandForModelCorrection(command);
  if (executable.args.length > 0) {
    throw new AgentError({
      code: 'CAPABILITY_INPUT_INVALID',
      message:
        'Bash validation failed before execution: command must contain only one executable when args is provided. Choose command-string mode or argv mode as described in the safe hint, then call Bash again.',
      category: 'VALIDATION',
      retryable: true,
      safeDetails: {
        reasonCode: 'BASH_STRUCTURED_ARGS_COMMAND_NOT_EXECUTABLE_ONLY',
        hint: 'Choose one mode. Command-string mode: put the full command in `command` and omit `args`. Argv mode: set `command` to only the executable, for example `python`, and put every other token in `args`, including `-m`, script path, flags, JSON, and user text. Never split one command between `command` and `args`. `env` currently supports only `PYTHONPATH`; `NEXTAGENT_*` keys are auto-injected and cannot be set manually.',
      },
    });
  }
  return { executable: executable.executable, args: argsInput, environment: structuredEnvironment };
}

function parseStructuredBashEnvironment(envInput: unknown): JsonObject {
  if (envInput === undefined) {
    return {};
  }
  if (typeof envInput !== 'object' || envInput === null || Array.isArray(envInput)) {
    throw invalidBashEnvironment('BASH_ENV_INVALID', 'Bash env must be an object with supported string values.');
  }
  const source = envInput as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.some((key) => !MODEL_ALLOWED_ENV_KEYS.has(key))) {
    throw invalidBashEnvironment(
      'BASH_ENV_UNSUPPORTED_KEY',
      'Bash env only supports PYTHONPATH. NEXTAGENT_* keys are automatically injected by the runtime and cannot be set manually.',
    );
  }
  const pythonPath = source['PYTHONPATH'];
  if (pythonPath === undefined) {
    return {};
  }
  if (typeof pythonPath !== 'string' || pythonPath.length === 0 || pythonPath.length > 4096) {
    throw invalidBashEnvironment('BASH_ENV_PYTHONPATH_INVALID', 'Bash env.PYTHONPATH must be a non-empty string.');
  }
  return { PYTHONPATH: pythonPath };
}

function normalizeLeadingPythonPathAssignment(parsed: ParsedBashCommand, environment: JsonObject): ParsedBashInput {
  const assignment = parsePythonPathAssignment(parsed.executable);
  if (assignment === undefined) {
    return { executable: parsed.executable, args: parsed.args, environment };
  }
  const [nextExecutable, ...remainingArgs] = parsed.args;
  if (nextExecutable === undefined) {
    throw invalidBashEnvironment('BASH_ENV_ASSIGNMENT_MISSING_COMMAND', 'PYTHONPATH assignment must be followed by a command.');
  }
  const existingPythonPath = environment['PYTHONPATH'];
  if (typeof existingPythonPath === 'string' && existingPythonPath !== assignment) {
    throw invalidBashEnvironment('BASH_ENV_PYTHONPATH_CONFLICT', 'PYTHONPATH is provided both as env and command prefix with different values.');
  }
  return {
    executable: nextExecutable,
    args: remainingArgs,
    environment: { ...environment, PYTHONPATH: assignment },
  };
}

function parsePythonPathAssignment(token: string): string | undefined {
  const separator = token.indexOf('=');
  if (separator <= 0) {
    return undefined;
  }
  const key = token.slice(0, separator);
  if (AUTO_INJECTED_ENV_KEYS.some((k) => k === key)) {
    throw invalidBashEnvironment('BASH_ENV_AUTO_INJECTED_KEY', `${key} is automatically injected by the runtime and cannot be set manually.`);
  }
  if (!MODEL_ALLOWED_ENV_KEYS.has(key)) {
    return undefined;
  }
  const value = token.slice(separator + 1);
  if (value.length === 0 || value.length > 4096) {
    throw invalidBashEnvironment('BASH_ENV_PYTHONPATH_INVALID', 'PYTHONPATH assignment must be non-empty.');
  }
  return value;
}

function readClipcIdentityHeaderOptIn(flowVariables: JsonObject | undefined): ReadonlySet<string> {
  const activeSkillContext = flowVariables?.['activeSkillContext'];
  if (!isJsonObject(activeSkillContext)) {
    return new Set<string>();
  }

  const apiHeaderParams = activeSkillContext['apiHeaderParams'];
  if (typeof apiHeaderParams !== 'string') {
    return new Set<string>();
  }

  return new Set(
    apiHeaderParams
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name === 'X-Subject-Id' || name === 'X-Display-Name'),
  );
}

function injectClipcIdentityParams(
  args: readonly string[],
  identity: ToolExecutionContext['identityContext'],
  allowedHeaders: ReadonlySet<string>,
): readonly string[] {
  const paramsIndex = args.indexOf('--params');
  if (paramsIndex === -1 || paramsIndex + 1 >= args.length) {
    return args;
  }

  let parsedParams: unknown;
  try {
    parsedParams = JSON.parse(args[paramsIndex + 1]!);
  } catch {
    return args;
  }
  if (!isJsonObject(parsedParams)) {
    return args;
  }

  const header = isJsonObject(parsedParams['header']) ? { ...parsedParams['header'] } : {};
  if (allowedHeaders.has('X-Subject-Id')) {
    header['X-Subject-Id'] = identity.subjectId;
  }
  if (allowedHeaders.has('X-Display-Name')) {
    header['X-Display-Name'] = identity.displayName;
  }

  const nextArgs = [...args];
  nextArgs[paramsIndex + 1] = JSON.stringify({ ...parsedParams, header });
  return nextArgs;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function injectIdentityEnvironment(context: ToolExecutionContext, userEnv: JsonObject): JsonObject {
  const inputVars = context.flowVariables?.['input_variables'];
  const requestHeaders =
    inputVars !== undefined && inputVars !== null && typeof inputVars === 'object' && !Array.isArray(inputVars)
      ? (inputVars as Record<string, unknown>)['requestHeaders']
      : undefined;
  const requestHeadersMap: Record<string, string> =
    requestHeaders !== undefined && requestHeaders !== null && typeof requestHeaders === 'object' && !Array.isArray(requestHeaders)
      ? (requestHeaders as Record<string, string>)
      : {};
  const identity = context.identityContext as unknown as Record<string, unknown> | undefined;
  let userId = typeof identity?.subjectId === 'string' ? (identity.subjectId as string) : '';
  if (userId.length === 0 && typeof requestHeadersMap['x-subject-id'] === 'string') {
    userId = requestHeadersMap['x-subject-id'];
  }
  let userName = typeof identity?.displayName === 'string' ? (identity.displayName as string) : '';
  if (userName.length === 0 && typeof requestHeadersMap['x-display-name'] === 'string') {
    userName = requestHeadersMap['x-display-name'];
  }
  const chatId = context.requestId;
  const conversationId = context.sessionId;
  const injected: Record<string, string> = {};
  if (userId.length > 0) {
    injected['NEXTAGENT_USER_ID'] = userId;
  }
  if (userName.length > 0) {
    injected['NEXTAGENT_USER_NAME'] = userName;
  }
  if (chatId.length > 0) {
    injected['NEXTAGENT_CHAT_ID'] = chatId;
  }
  if (conversationId.length > 0) {
    injected['NEXTAGENT_CONVERSATION_ID'] = conversationId;
  }
  return { ...userEnv, ...injected };
}

function invalidBashEnvironment(reasonCode: string, message: string): AgentError {
  return new AgentError({
    code: 'CAPABILITY_INPUT_INVALID',
    message: `Bash validation failed before execution: ${message} Correct the environment using the safe hint and call Bash again.`,
    category: 'VALIDATION',
    retryable: true,
    safeDetails: {
      reasonCode,
      hint: 'Use command as the executable, pass arguments through args, and set only env.PYTHONPATH when Python imports require an authorized sandbox path. NEXTAGENT_* environment variables are auto-injected and cannot be set manually.',
    },
  });
}

function rejectUnsupportedPythonInvocationForModelCorrection(args: readonly string[]): void {
  const [first, second] = args;
  if (first === undefined) {
    // A zero-argument interpreter start would launch an interactive REPL; the
    // sandbox runs with a non-interactive stdin, so a REPL can only spin in an
    // EOF error loop.
    throw unsupportedPythonInvocation('BASH_PYTHON_REPL_UNSUPPORTED');
  }
  if (first === '-m') {
    if (second === undefined || !isDottedPythonModuleName(second)) {
      throw unsupportedPythonInvocation('BASH_PYTHON_MODULE_INVALID');
    }
    return;
  }
  if (first === '--version' && args.length === 1) {
    return;
  }
  if (first.startsWith('-')) {
    throw unsupportedPythonInvocation(
      first === '-c' || first === '-' ? 'BASH_PYTHON_INLINE_MODE_UNSUPPORTED' : 'BASH_PYTHON_INVOCATION_MODE_UNSUPPORTED',
    );
  }
}

function isDottedPythonModuleName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/u.test(value);
}

function unsupportedPythonInvocation(reasonCode: string): AgentError {
  return new AgentError({
    code: 'CAPABILITY_INPUT_INVALID',
    message: 'Bash Python invocation mode is not supported by the sandbox.',
    category: 'VALIDATION',
    retryable: true,
    safeDetails: {
      reasonCode,
      hint: 'For inline Python source, call the Python tool with a code field. For existing files, call Bash as `python path/to/script.py ...` or `python -m package.module ...`.',
    },
  });
}

function hasUnclosedQuote(command: string): boolean {
  const source = command.trim();
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < source.length; index++) {
    const character = source[index] ?? '';
    // Mirror the tokenizer: inside a double-quoted string, a backslash escapes
    // the next character so `\"` does not close the string. Single-quoted
    // strings are fully literal.
    if (quote === '"') {
      if (character === '\\' && index + 1 < source.length) {
        index += 1;
        continue;
      }
      if (character === '"') {
        quote = undefined;
      }
      continue;
    }
    if (quote === "'") {
      // Mirror the tokenizer: a single quote followed by a non-boundary
      // character is an embedded literal quote, not a closing quote.
      if (character === "'") {
        const next = source[index + 1];
        if (next !== undefined && !/[\s|&;()<>'"]/.test(next)) {
          continue;
        }
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    }
  }
  return quote !== undefined;
}

function prepareCurlArguments(executable: string, args: readonly string[]): readonly string[] {
  if (executable !== 'curl') {
    return args;
  }
  const normalized = normalizeCurlDataArguments(args);
  const hasTimeout = normalized.some((arg) => arg === '--max-time' || arg.startsWith('--max-time=') || arg === '-m' || /^-m\d/u.test(arg));
  return hasTimeout ? normalized : ['--max-time', String(CURL_DEFAULT_MAX_TIME_SECONDS), ...normalized];
}

const CURL_DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii']);

/**
 * curl is executed as a direct exec (shell:false) process, so the `-d`/`--data*`
 * payload is handed to curl as one argv entry. The tokenizer already keeps a
 * shell-escaped JSON payload intact as a single token; this step additionally
 * validates that the payload is parseable JSON and best-effort repairs the
 * common model mistake of using single quotes as JSON string delimiters. A
 * payload that is already valid JSON is returned unchanged, including single
 * quotes that legitimately appear inside JSON string values.
 */
function normalizeCurlDataArguments(args: readonly string[]): readonly string[] {
  const normalized: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (CURL_DATA_FLAGS.has(arg) && i + 1 < args.length) {
      const dataValue = args[i + 1];
      if (dataValue === undefined) {
        normalized.push(arg);
        continue;
      }
      normalized.push(arg, normalizeCurlDataPayload(dataValue));
      i += 1;
      continue;
    }
    const attached = matchAttachedCurlDataArgument(arg);
    if (attached !== undefined) {
      normalized.push(`${attached.flag}${attached.payload}`);
      continue;
    }
    normalized.push(arg);
  }
  return normalized;
}

function matchAttachedCurlDataArgument(arg: string): { flag: string; payload: string } | undefined {
  const longForm = /^(--data(?:-raw|-binary|-ascii)?)=(.*)$/su.exec(arg);
  if (longForm !== null) {
    const flagName = longForm[1] ?? '';
    const payloadValue = longForm[2] ?? '';
    return { flag: `${flagName}=`, payload: normalizeCurlDataPayload(payloadValue) };
  }
  // Short flag glued to its value, e.g. `-d{...}`. `-d` alone is handled as the
  // separate flag/value form above; `--data` is covered by the long-form rule.
  if (/^-d./u.test(arg)) {
    return { flag: '-d', payload: normalizeCurlDataPayload(arg.slice(2)) };
  }
  return undefined;
}

/**
 * Ensure a curl data payload is valid JSON. When it already parses, return it
 * unchanged. Otherwise attempt two repairs in order: replace single quotes with
 * double quotes (fixes `{'k':'v'}` delimiter-style JSON), then drop stray single
 * quotes. If no repair yields valid JSON the original value is returned so curl
 * surfaces the error instead of receiving silently-mangled content.
 */
function normalizeCurlDataPayload(raw: string): string {
  if (tryParseJson(raw) !== undefined) {
    return raw;
  }
  const repairedDelimiters = tryParseJson(raw.replace(/'/gu, '"'));
  if (repairedDelimiters !== undefined) {
    return JSON.stringify(repairedDelimiters);
  }
  const stripped = tryParseJson(raw.replace(/'/gu, ''));
  if (stripped !== undefined) {
    return JSON.stringify(stripped);
  }
  return raw;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
