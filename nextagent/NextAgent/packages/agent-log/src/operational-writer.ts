import {
  AgentError,
  currentRuntimeLogCorrelation,
  runtimeRawExceptionData,
  type RuntimeLogger,
  type RuntimeLoggerBindings,
  type RuntimeLogLevel,
} from '@nextagent/agent-common';
import { createHash } from 'node:crypto';
import {
  createLocalFileRoll,
  type LocalFileActiveIdentity,
  type LocalFileRollHandle,
  type LocalFileRollPolicy,
} from '@nextagent/agent-local-file-roll';
import pino, { type DestinationStream, type Logger } from 'pino';
import type {
  CreateOperationalLogWriterOptions,
  OperationalEmergencyEvidence,
  OperationalEmergencyReporter,
  OperationalLogWriter,
  OperationalRuntimeLoggingPolicy,
} from './index.js';

const DESTINATION_BUFFER_BYTES = 4 * 1024 * 1024;
const ENTRY_BUDGET_BYTES = 16 * 1024;
const RUNTIME_DIAGNOSTIC_ENTRY_BUDGET_BYTES = 1024 * 1024;
const MAX_FIELD_COUNT = 64;
const MAX_ARRAY_ITEMS = 16;
const MAX_RAW_ARRAY_ITEMS = 100;
const MAX_DEPTH = 6;
const MAX_STRING_BYTES = 1_024;
const MAX_RAW_STRING_BYTES = 16 * 1024;
const MAX_RUNTIME_EXCEPTION_STRING_BYTES = MAX_RAW_STRING_BYTES;
const TEXT_REDACTION_LOOKAHEAD_BYTES = 512;
const MAX_COMPONENT_LENGTH = 64;
const MAX_SERVICE_VERSION_LENGTH = 64;
const MAX_EXCEPTION_CHAIN_NODES = 4;
const MAX_EXCEPTION_FRAMES = 5;
const MAX_EXCEPTION_INSPECTION_CHARS = 64 * 1024;
const MAX_DROPPED_COUNT = 1_000_000_000;

const RESERVED_FIELDS = new Set([
  'timestamp',
  'time',
  'level',
  'surface',
  'component',
  'serviceVersion',
  'msg',
  'message',
  'operation',
  'outcome',
  'ownerScope',
  'correlation',
  'tenantId',
  'subjectId',
  'requestContextId',
  'stepId',
  'traceId',
  'spanId',
  'processState',
  'safeSummary',
  'fallbackReasonCode',
  'err',
  'exception',
]);
const WRITER_EXCEPTION_FIELDS = new Set([
  'exceptionType',
  'exceptionCode',
  'exceptionFingerprint',
  'exceptionFrames',
  'exceptionCause',
  'exceptionChainTruncated',
]);
const SAFE_EXCEPTION_TYPES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'AgentError',
  'AssertionError',
  'DOMException',
]);
const APPROVED_NON_NEGATIVE_INTEGER_FIELDS = new Set([
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'maxOutputTokens',
  'tokenLength',
  'contentLength',
  'toolCallCount',
  'generatedMessageCount',
]);
const APPROVED_NON_NEGATIVE_NUMBER_FIELDS = new Set(['durationMs', 'firstContentLatencyMs', 'modelContentLatencyMs']);
const APPROVED_BUCKETS: Readonly<Record<string, ReadonlySet<string>>> = {
  messageCountBucket: new Set(['0', '1', '2-10', '11-100', '101+']),
  timeoutMsBucket: new Set(['1-1000', '1001-5000', '5001-30000', '30001-120000', '120001+']),
  maxOutputTokensBucket: new Set(['unspecified', '1-1024', '1025-4096', '4097-16384', '16385+']),
  argumentProjectionStatus: new Set(['EMPTY', 'SCHEMA_PROPERTIES_UNAVAILABLE', 'NO_SCHEMA_MATCH', 'PROJECTED', 'PARTIALLY_PROJECTED', 'FILTERED']),
  resultProjectionStatus: new Set([
    'NOT_PRODUCED',
    'EMPTY',
    'SCHEMA_PROPERTIES_UNAVAILABLE',
    'NO_SCHEMA_MATCH',
    'PROJECTED',
    'PARTIALLY_PROJECTED',
    'FILTERED',
  ]),
  summaryStatus: new Set(['COMPLETE', 'PARTIAL']),
};
const APPROVED_NAME_ARRAY_FIELDS = new Set(['disclosedCapabilityNames', 'resolvedToolNames', 'validatedArgumentNames', 'validatedResultFieldNames']);
const APPROVED_TRUNCATION_FIELDS = new Set([
  'disclosedCapabilityNamesTruncated',
  'resolvedToolNamesTruncated',
  'validatedArgumentNamesTruncated',
  'validatedResultFieldNamesTruncated',
]);
const APPROVED_ARRAY_FIELDS = new Set([...APPROVED_NAME_ARRAY_FIELDS, 'generatedMessageKinds', 'contextPatchFields']);
const SAFE_DIAGNOSTIC_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SAFE_LOW_CARDINALITY_TOKEN = /^[A-Za-z0-9_.+-]{1,128}$/u;
const CREDENTIAL_SEGMENTS = new Set([
  'password',
  'passwords',
  'secret',
  'secrets',
  'credential',
  'credentials',
  'authorization',
  'authorizations',
  'cookie',
  'cookies',
]);
const TOKEN_PREFIX_SEGMENTS = new Set(['api', 'access', 'auth', 'refresh', 'bearer', 'id']);
const POLICY_OMITTED_KEYS = new Set(
  `
prompt rawprompt systemprompt developerprompt thinking reasoning
messages messagecontent modeloutput rawmodeloutput content rawcontent delta streamdelta
toolargs toolarguments capabilityarguments toolresult capabilityresult structuredpayload result output
stdout stderr command environment stack filepath path
rawerror rawproviderbody providerbody providerheaders headers attachmentcontent
`
    .trim()
    .split(/\s+/u),
);
const WRITER_MARKERS = /^<(?:redacted:credential|omitted:policy|truncated:(?:1-1024|1025-4096|4097-16384|16385\+)-bytes)>$/u;
const TRUSTED_RUNTIME_STEP_EVENTS = new Set([
  'model.provider.failure_captured',
  'capability.execution.exception_captured',
  'tool.payload.captured',
  'tool.call.failed',
  'tool.call.result_invalid',
  'tool.loop.repeated_failure',
  'model.payload.input_captured',
  'model.payload.output_captured',
  'model.payload.failed',
]);
const SECRET_VALUE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/sk-[A-Za-z0-9._-]{10,}/gu, '<redacted:credential>'],
  [/Bearer\s+[A-Za-z0-9._\-~+/=]+/giu, '<redacted:credential>'],
  [/((?:password|api[-_]?key|token|secret|credential|authorization)\s*[:=]\s*)[^\s,;]+/giu, '$1<redacted:credential>'],
  [/[A-Za-z]:\\[^\s]+/gu, '<omitted:policy>'],
  [/(?:^|\s)\/(?:[^\s/]+\/)+[^\s]*/gu, ' <omitted:policy>'],
];
const RAW_RUNTIME_PAYLOAD_FIELDS = new Set(['toolInput', 'toolOutput', 'modelInput', 'modelOutput']);
const MODEL_OUTPUT_FIELDS = new Set(['content', 'toolCalls', 'finishReason', 'incompleteOutputReason', 'usage', 'safeError']);
const RAW_TOOL_CREDENTIAL_SEGMENTS = new Set([
  'password',
  'passwords',
  'secret',
  'secrets',
  'credential',
  'credentials',
  'authorization',
  'authorizations',
  'cookie',
  'cookies',
]);
const RAW_TOOL_TOKEN_PREFIX_SEGMENTS = new Set(['api', 'access', 'auth', 'refresh', 'bearer', 'id']);
const RAW_TOOL_SECRET_VALUE_SUFFIXES = new Set(['value', 'values']);
const RAW_TOOL_INLINE_SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/(^|[^A-Za-z0-9])sk-[A-Za-z0-9._-]{10,}/gu, '$1<redacted:credential>'],
  [/Bearer\s+[A-Za-z0-9._\-~+/=]{10,}/giu, 'Bearer <redacted:credential>'],
  [
    /((?:password|api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|token|secret|credential|authorization)\s*[:=]\s*)(["']?)[^\s,;"'&]+/giu,
    '$1$2<redacted:credential>',
  ],
];
const ERROR_CODE_REASON_OVERRIDES: Readonly<Record<string, string>> = {
  EADDRINUSE: 'ADDRESS_IN_USE',
};

interface SinkState {
  readonly name: 'console' | 'file';
  degraded: boolean;
  droppedCount: number;
}

export interface ConsoleDestination {
  write: (line: string) => boolean;
  flush: (callback: (error?: Error) => void) => void;
  end: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  once: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

export interface OperationalWriterDependencies {
  readonly createFileRoll: (policy: LocalFileRollPolicy) => Promise<LocalFileRollHandle>;
  readonly createConsoleDestination: (options: { readonly dest: 1; readonly sync: false; readonly maxLength: number }) => ConsoleDestination;
}

export async function createOperationalLogWriter(
  policy: OperationalRuntimeLoggingPolicy,
  options: CreateOperationalLogWriterOptions,
): Promise<OperationalLogWriter> {
  return createOperationalLogWriterWithDependencies(policy, options, {
    createFileRoll: createLocalFileRoll,
    createConsoleDestination: (destinationOptions) => pino.destination(destinationOptions) as ConsoleDestination,
  });
}

export async function createOperationalLogWriterWithDependencies(
  policy: OperationalRuntimeLoggingPolicy,
  options: CreateOperationalLogWriterOptions,
  dependencies: OperationalWriterDependencies,
): Promise<OperationalLogWriter> {
  const reporter = createBoundedReporter(options.emergencyReporter);
  const serviceVersion = requireServiceVersion(options.serviceVersion);
  const fileState: SinkState = { name: 'file', degraded: false, droppedCount: 0 };
  const consoleState: SinkState = { name: 'console', degraded: false, droppedCount: 0 };
  const fileHandle = policy.file.enabled ? await createFileHandle(policy, fileState, reporter, dependencies.createFileRoll) : undefined;
  const consoleDestination = policy.console.enabled
    ? createConsoleDestination(consoleState, reporter, dependencies.createConsoleDestination)
    : undefined;
  const destination = createBroadcastDestination(fileHandle, fileState, consoleDestination, consoleState, reporter);
  const logger = pino(
    {
      level: policy.level,
      base: null,
      redact: {
        paths: ['password', 'apiKey', 'api_key', 'token', 'secret', 'credential', 'authorization'],
        censor: '<redacted:credential>',
      },
      timestamp: () => {
        const d = new Date();
        const offset = -d.getTimezoneOffset();
        const sign = offset >= 0 ? '+' : '-';
        const hh = String(Math.abs(Math.trunc(offset / 60))).padStart(2, '0');
        const mm = String(Math.abs(offset % 60)).padStart(2, '0');
        const tz = `${sign}${hh}:${mm}`;
        return `,"timestamp":"${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}${tz}"`;
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
      hooks: {
        logMethod(args, method, level) {
          const levelName = this.levels.labels[level];
          const nativeAccess = projectNativeAccessLog(levelName, args, this.bindings());
          if (nativeAccess !== undefined) {
            method.apply(this, nativeAccess);
            return;
          }
          const frameworkDiagnostic = projectFastifyFrameworkDiagnostic(levelName, args, this.bindings());
          if (frameworkDiagnostic !== undefined) {
            method.apply(this, frameworkDiagnostic);
            return;
          }
          const fields = args[0];
          if (typeof fields === 'object' && fields !== null && isTrustedEvent(safeProperty(fields, 'event'))) {
            method.apply(this, args);
          }
        },
      },
    },
    destination,
  );
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const maintenanceOutcomes: Partial<Record<'archive' | 'retention', 'completed' | 'failed'>> = {};

  const childLoggers = new Map<string, Logger>();
  const childLogger = (surface: 'runtime_diagnostic' | 'observation_derived', bindings: RuntimeLoggerBindings): Logger => {
    const key = `${surface}\u0000${bindings.component}\u0000${bindings.source ?? ''}`;
    const existing = childLoggers.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const child = logger.child({
      component: normalizeComponent(bindings.component),
      ...(bindings.source === undefined ? {} : { source: normalizeComponent(bindings.source) }),
      surface,
      serviceVersion,
    });
    childLoggers.set(key, child);
    return child;
  };

  const write = (
    surface: 'runtime_diagnostic' | 'observation_derived',
    bindings: RuntimeLoggerBindings,
    level: RuntimeLogLevel,
    fields: object,
    caught?: unknown,
    _msg?: unknown,
  ): void => {
    if (closed) {
      return;
    }
    try {
      if (shouldSuppressCaughtDiagnostic(fields, caught)) {
        return;
      }
      const scopedLogger = childLogger(surface, bindings);
      if (!scopedLogger.isLevelEnabled(level)) {
        return;
      }
      const safeFields = sanitizeFields(fields, caught, surface === 'runtime_diagnostic');
      const correlation =
        surface === 'runtime_diagnostic'
          ? currentRuntimeLogCorrelation()
          : validatedLogCorrelation(safeProperty(fields, 'traceId'), safeProperty(fields, 'spanId'));
      if (correlation !== undefined) {
        safeFields.traceId = correlation.traceId;
        safeFields.spanId = correlation.spanId;
      }
      if (surface === 'observation_derived' || TRUSTED_RUNTIME_STEP_EVENTS.has(String(safeProperty(fields, 'event')))) {
        const stepId = safeProperty(fields, 'stepId');
        if (typeof stepId === 'string' && SAFE_DIAGNOSTIC_NAME.test(stepId)) {
          safeFields.stepId = stepId;
        }
      }
      if (bindings.source !== undefined) {
        delete safeFields.source;
      }
      const hasTrustedEvent = isTrustedEvent(safeFields.event);
      if (!hasTrustedEvent) {
        return;
      }
      if (level === 'error' && !hasApprovedErrorClassification(safeFields)) {
        safeFields.safeReasonCode = 'UNCLASSIFIED_RUNTIME_ERROR';
      }
      const normalized = { ...safeFields };
      const entryBudgetBytes =
        surface === 'runtime_diagnostic' && hasLocalDiagnosticDetail(fields, caught) ? RUNTIME_DIAGNOSTIC_ENTRY_BUDGET_BYTES : ENTRY_BUDGET_BYTES;
      if (serializedSize(level, normalized) <= entryBudgetBytes) {
        writePino(scopedLogger, level, normalized);
        return;
      }
      if (hasTrustedEvent) {
        writePino(scopedLogger, level, {
          event: safeFields.event,
          safeReasonCode: 'entry_too_large',
        });
      }
    } catch {
      // Operational logging is never allowed to affect its caller.
    }
  };

  fileHandle?.setMaintenanceEventListener((event) => {
    if (maintenanceOutcomes[event.operation] === event.outcome) {
      return;
    }
    maintenanceOutcomes[event.operation] = event.outcome;
    const failed = event.outcome === 'failed';
    write('runtime_diagnostic', { component: 'agent-log' }, failed ? 'warn' : 'debug', {
      event: `logging.${event.operation}.${event.outcome}`,
      affectedCountBucket: countBucket(event.affectedCount),
      ...(failed ? { safeReasonCode: 'LOG_MAINTENANCE_FAILED' } : {}),
    });
  });
  const readySinks = [fileHandle === undefined ? undefined : 'file', consoleDestination === undefined ? undefined : 'console'].filter(
    (sink): sink is 'file' | 'console' => sink !== undefined,
  );
  if (readySinks.length > 0) {
    write('runtime_diagnostic', { component: 'agent-log' }, 'info', {
      event: 'logging.transport.ready',
      sinks: readySinks,
    });
  }

  const createBoundLogger = (surface: 'runtime_diagnostic' | 'observation_derived', bindings: RuntimeLoggerBindings): RuntimeLogger => {
    const boundBindings = Object.freeze({
      component: normalizeComponent(bindings.component),
      ...(bindings.source === undefined ? {} : { source: normalizeComponent(bindings.source) }),
    });
    return Object.freeze({
      error: (fields: object, msg?: string) => write(surface, boundBindings, 'error', fields, extractCaught(fields), msg),
      warn: (fields: object, msg?: string) => write(surface, boundBindings, 'warn', fields, extractCaught(fields), msg),
      info: (fields: object, msg?: string) => write(surface, boundBindings, 'info', fields, undefined, msg),
      debug: (fields: object, msg?: string) => write(surface, boundBindings, 'debug', fields, undefined, msg),
    });
  };

  return {
    getLogger(bindings): RuntimeLogger {
      return createBoundLogger('runtime_diagnostic', bindings);
    },
    getServerAccessLogger(bindings): Logger {
      return childLogger('runtime_diagnostic', bindings).child(
        {},
        {
          serializers: {
            req: serializeServerAccessRequest,
            res: serializeServerAccessResponse,
          },
        },
      );
    },
    getObservationLogger(bindings): RuntimeLogger {
      return createBoundLogger('observation_derived', bindings);
    },
    activeIdentity(): LocalFileActiveIdentity | undefined {
      return fileHandle?.activeIdentity();
    },
    async flush(timeoutMs): Promise<void> {
      await completeLifecycleOperations(
        [
          ...(fileHandle === undefined ? [] : [{ sink: 'file' as const, operation: fileHandle.flush(timeoutMs) }]),
          ...(consoleDestination === undefined ? [] : [{ sink: 'console' as const, operation: flushConsole(consoleDestination, timeoutMs) }]),
        ],
        'logging.flush.failed',
        reporter,
      );
    },
    close(timeoutMs): Promise<void> {
      if (closePromise !== undefined) {
        return closePromise;
      }
      closed = true;
      closePromise = completeLifecycleOperations(
        [
          ...(fileHandle === undefined ? [] : [{ sink: 'file' as const, operation: fileHandle.close(timeoutMs) }]),
          ...(consoleDestination === undefined ? [] : [{ sink: 'console' as const, operation: closeConsole(consoleDestination, timeoutMs) }]),
        ],
        'logging.close.failed',
        reporter,
      );
      return closePromise;
    },
  };
}

function projectNativeAccessLog(
  level: string | undefined,
  args: Parameters<Logger['info']>,
  bindings: Readonly<Record<string, unknown>>,
): Parameters<Logger['info']> | undefined {
  const msg = args[1];
  const requestId = bindings.reqId;
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(requestId)) {
    return undefined;
  }
  if (level === 'info' && msg === 'incoming request') {
    return undefined;
  }
  if (!((level === 'info' && msg === 'request completed') || (level === 'error' && msg === 'request errored'))) {
    return undefined;
  }
  const fields = safeRecord(args[0]);
  const response = safeRecord(fields?.res);
  const statusCode = response?.statusCode;
  const responseTime = fields?.responseTime;
  if (typeof statusCode !== 'number' || !Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    return undefined;
  }
  if (typeof responseTime !== 'number' || !Number.isFinite(responseTime) || responseTime < 0) {
    return undefined;
  }
  const safeFields = sanitizeFields(fields ?? {}, extractCaught(fields ?? {}), false);
  const projected: Record<string, unknown> = {
    res: { statusCode },
    responseTime,
  };
  for (const key of ['safeReasonCode', 'safeErrorCategory', 'retryable', ...WRITER_EXCEPTION_FIELDS]) {
    if (safeFields[key] !== undefined) {
      projected[key] = safeFields[key];
    }
  }
  if (level === 'error' && !hasApprovedErrorClassification(projected)) {
    projected.safeReasonCode = 'FASTIFY_REQUEST_ERROR';
  }
  return [projected, msg];
}

function serializeServerAccessRequest(value: unknown): Record<string, unknown> {
  const request = safeRecord(value);
  const methodValue = request?.method;
  const method = typeof methodValue === 'string' && /^[A-Z]{1,16}$/u.test(methodValue) ? methodValue : 'UNKNOWN';
  const routeOptions = safeRecord(request?.routeOptions);
  const routeTemplate = routeOptions?.url;
  const url =
    typeof routeTemplate === 'string' && routeTemplate.length <= 256 && routeTemplate.startsWith('/') && !/[?#\\\x00-\x1f\x7f]/u.test(routeTemplate)
      ? routeTemplate
      : 'unmatched';
  return { method, url };
}

function projectFastifyFrameworkDiagnostic(
  level: string | undefined,
  args: Parameters<Logger['info']>,
  bindings: Readonly<Record<string, unknown>>,
): Parameters<Logger['info']> | undefined {
  if (bindings.source !== 'fastify' || (level !== 'warn' && level !== 'error')) {
    return undefined;
  }
  const fields = safeRecord(args[0]) ?? {};
  const caught = extractCaught(fields);
  return [
    {
      event: level === 'warn' ? 'server.framework.degraded' : 'server.framework.failed',
      failureStage: 'FASTIFY_INTERNAL',
      safeReasonCode: level === 'warn' ? 'FASTIFY_INTERNAL_DEGRADED' : 'FASTIFY_INTERNAL_ERROR',
      ...(caught === undefined ? {} : normalizeCaughtFailure({}, caught)),
    },
  ];
}

function serializeServerAccessResponse(value: unknown): Record<string, unknown> {
  const statusCode = safeRecord(value)?.statusCode;
  return typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? { statusCode } : {};
}

async function createFileHandle(
  policy: OperationalRuntimeLoggingPolicy,
  state: SinkState,
  reporter: (evidence: OperationalEmergencyEvidence) => void,
  createFileRoll: OperationalWriterDependencies['createFileRoll'],
): Promise<LocalFileRollHandle | undefined> {
  try {
    return await createFileRoll({
      directory: policy.file.directory,
      fileName: policy.file.name,
      naming: 'sequence',
      maxFileSizeMiB: policy.file.maxFileSizeMiB,
      retentionDays: policy.file.retentionDays,
      maxArchiveFiles: policy.file.maxArchiveFiles,
      bufferCapacityBytes: DESTINATION_BUFFER_BYTES,
    });
  } catch {
    state.degraded = true;
    reporter({ event: 'logging.transport.init_failed', sink: 'file' });
    return undefined;
  }
}

function createConsoleDestination(
  state: SinkState,
  reporter: (evidence: OperationalEmergencyEvidence) => void,
  createDestination: OperationalWriterDependencies['createConsoleDestination'],
): ConsoleDestination | undefined {
  try {
    const destination = createDestination({ dest: 1, sync: false, maxLength: DESTINATION_BUFFER_BYTES });
    destination.on('error', () => transitionToDegraded(state, reporter));
    return destination;
  } catch {
    state.degraded = true;
    reporter({ event: 'logging.transport.init_failed', sink: 'console' });
    return undefined;
  }
}

function createBroadcastDestination(
  fileHandle: LocalFileRollHandle | undefined,
  fileState: SinkState,
  consoleDestination: ConsoleDestination | undefined,
  consoleState: SinkState,
  reporter: (evidence: OperationalEmergencyEvidence) => void,
): DestinationStream {
  return {
    write(line): void {
      if (fileHandle !== undefined) {
        const result = fileHandle.appendLine(line);
        if (result.status === 'dropped') {
          transitionToDegraded(fileState, reporter);
        } else {
          transitionToRecovered(fileState, reporter);
        }
      }
      if (consoleDestination !== undefined) {
        let dropped = false;
        const onDrop = (): void => {
          dropped = true;
        };
        consoleDestination.once('drop', onDrop);
        try {
          consoleDestination.write(line);
          if (dropped) {
            transitionToDegraded(consoleState, reporter);
          } else {
            transitionToRecovered(consoleState, reporter);
          }
        } catch {
          transitionToDegraded(consoleState, reporter);
        } finally {
          consoleDestination.off('drop', onDrop);
        }
      }
    },
  };
}

function transitionToDegraded(state: SinkState, reporter: (evidence: OperationalEmergencyEvidence) => void): void {
  state.droppedCount = Math.min(MAX_DROPPED_COUNT, state.droppedCount + 1);
  if (state.degraded) {
    return;
  }
  state.degraded = true;
  reporter({
    event: 'logging.transport.overloaded',
    sink: state.name,
    droppedCountBucket: countBucket(state.droppedCount),
  });
}

function transitionToRecovered(state: SinkState, reporter: (evidence: OperationalEmergencyEvidence) => void): void {
  if (!state.degraded) {
    return;
  }
  state.degraded = false;
  reporter({
    event: 'logging.transport.recovered',
    sink: state.name,
    droppedCountBucket: countBucket(state.droppedCount),
  });
  state.droppedCount = 0;
}

function createBoundedReporter(reporter?: OperationalEmergencyReporter) {
  return (evidence: OperationalEmergencyEvidence): void => {
    if (reporter === undefined) {
      return;
    }
    queueMicrotask(() => {
      try {
        void Promise.resolve(reporter(evidence)).catch(() => undefined);
      } catch {
        // The emergency reporter has no fallback path.
      }
    });
  };
}

function sanitizeFields(fields: object, caught: unknown, rawRuntimePayloadAllowed: boolean): Record<string, unknown> {
  const sanitized = sanitizeObject(fields as Readonly<Record<string, unknown>>, 0, new WeakSet<object>(), rawRuntimePayloadAllowed);
  const normalized = normalizeCaughtFailure(sanitized, caught);
  if (!rawRuntimePayloadAllowed || caught === undefined || normalized.rawExceptionData !== undefined) {
    return normalized;
  }
  const rawExceptionData = runtimeRawExceptionData(caught);
  return rawExceptionData === undefined
    ? normalized
    : { ...normalized, rawExceptionData: sanitizeRuntimeExceptionData(rawExceptionData, 0, new WeakSet<object>()) };
}

function extractCaught(fields: object): unknown {
  try {
    if (Object.prototype.hasOwnProperty.call(fields, 'err')) {
      return (fields as { readonly err?: unknown }).err;
    }
    return Object.prototype.hasOwnProperty.call(fields, 'exception') ? (fields as { readonly exception?: unknown }).exception : undefined;
  } catch {
    return undefined;
  }
}

function safeProperty(value: object, key: string): unknown {
  try {
    return (value as Readonly<Record<string, unknown>>)[key];
  } catch {
    return undefined;
  }
}

function safeRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : undefined;
}

function hasLocalDiagnosticDetail(fields: object, caught: unknown): boolean {
  if (caught !== undefined) {
    return true;
  }
  try {
    return Object.keys(fields).some((key) => key === 'rawExceptionData' || RAW_RUNTIME_PAYLOAD_FIELDS.has(key));
  } catch {
    return false;
  }
}

function sanitizeObject(
  value: Readonly<Record<string, unknown>>,
  depth: number,
  seen: WeakSet<object>,
  rawRuntimePayloadAllowed = false,
): Record<string, unknown> {
  if (depth >= MAX_DEPTH || seen.has(value)) {
    return { safeReasonCode: 'value_truncated' };
  }
  seen.add(value);
  const output: Record<string, unknown> = {};
  let count = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }
    if (count >= MAX_FIELD_COUNT) {
      output.safeReasonCode = 'fields_truncated';
      break;
    }
    count++;
    if (RESERVED_FIELDS.has(key) || WRITER_EXCEPTION_FIELDS.has(key)) {
      continue;
    }
    let fieldValue: unknown;
    try {
      fieldValue = value[key];
    } catch {
      continue;
    }
    if (typeof fieldValue === 'string' && WRITER_MARKERS.test(fieldValue)) {
      continue;
    }
    if (key === 'rawExceptionData') {
      output[key] = rawRuntimePayloadAllowed && depth === 0 ? sanitizeRuntimeExceptionData(fieldValue, 0, new WeakSet<object>()) : '<omitted:policy>';
      continue;
    }
    if (RAW_RUNTIME_PAYLOAD_FIELDS.has(key)) {
      output[key] =
        rawRuntimePayloadAllowed && depth === 0 ? normalizeRawRuntimePayloadField(key, fieldValue, 0, new WeakSet<object>()) : '<omitted:policy>';
      continue;
    }
    const approvedValue = sanitizeApprovedSemanticField(key, fieldValue);
    if (approvedValue.matched) {
      if (approvedValue.value !== undefined) {
        output[key] = approvedValue.value;
      }
      continue;
    }
    if (isCredentialKey(key)) {
      output[key] = '<redacted:credential>';
      continue;
    }
    if (POLICY_OMITTED_KEYS.has(canonicalKey(key))) {
      output[key] = '<omitted:policy>';
      continue;
    }
    output[key] = sanitizeValue(fieldValue, depth + 1, seen);
  }
  return output;
}

function sanitizeApprovedSemanticField(
  key: string,
  value: unknown,
): { readonly matched: false } | { readonly matched: true; readonly value?: unknown } {
  if (APPROVED_NON_NEGATIVE_INTEGER_FIELDS.has(key)) {
    return {
      matched: true,
      value: typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined,
    };
  }
  if (APPROVED_NON_NEGATIVE_NUMBER_FIELDS.has(key)) {
    return {
      matched: true,
      value: typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined,
    };
  }
  if (key === 'commandExitCode') {
    return {
      matched: true,
      value: typeof value === 'number' && Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647 ? value : undefined,
    };
  }
  if (key === 'pathPolicyStatus') {
    return { matched: true, value: typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value) ? value : undefined };
  }
  const approvedValues = APPROVED_BUCKETS[key];
  if (approvedValues !== undefined) {
    return { matched: true, value: typeof value === 'string' && approvedValues.has(value) ? value : undefined };
  }
  if (key === 'toolResultStatus' || key === 'reasonCode') {
    return { matched: true, value: typeof value === 'string' && SAFE_LOW_CARDINALITY_TOKEN.test(value) ? value : undefined };
  }
  if (APPROVED_TRUNCATION_FIELDS.has(key)) {
    return { matched: true, value: value === 'true' || value === 'false' ? value : undefined };
  }
  if (APPROVED_ARRAY_FIELDS.has(key)) {
    return { matched: true, value: sanitizeApprovedArray(key, value) };
  }
  return { matched: false };
}

function sanitizeApprovedArray(key: string, value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100 || !value.every((item): item is string => typeof item === 'string')) {
    return undefined;
  }
  if (APPROVED_NAME_ARRAY_FIELDS.has(key)) {
    if (!value.every((item) => SAFE_DIAGNOSTIC_NAME.test(item)) || Buffer.byteLength(JSON.stringify(value)) > 4_096) {
      return undefined;
    }
    return value;
  }
  if (key === 'generatedMessageKinds') {
    return isUniqueOrderedSubset(value, ['USER', 'USER_META']) ? value : undefined;
  }
  if (key === 'contextPatchFields') {
    return isUniqueOrderedSubset(value, ['allowedTools', 'deniedTools', 'discoveredSkills', 'modelId', 'modelOptions']) ? value : undefined;
  }
  return undefined;
}

function isUniqueOrderedSubset(value: readonly string[], allowed: readonly string[]): boolean {
  let lastIndex = -1;
  for (const item of value) {
    const index = allowed.indexOf(item);
    if (index <= lastIndex) {
      return false;
    }
    lastIndex = index;
  }
  return true;
}

function keySegments(key: string): readonly string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[\s._:-]+/u)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

function canonicalKey(key: string): string {
  return keySegments(key).join('');
}

function isCredentialKey(key: string): boolean {
  const segments = keySegments(key);
  return (
    segments.some((segment) => CREDENTIAL_SEGMENTS.has(segment)) ||
    (segments.length === 1 && (segments[0] === 'token' || segments[0] === 'tokens')) ||
    segments.some(
      (segment, index) => (segment === 'token' || segment === 'tokens') && index > 0 && TOKEN_PREFIX_SEGMENTS.has(segments[index - 1]!),
    ) ||
    segments.some((segment, index) => segment === 'api' && (segments[index + 1] === 'key' || segments[index + 1] === 'keys'))
  );
}

function isRawToolCredentialOrTokenKey(key: string): boolean {
  const segments = keySegments(key);
  const lastSegment = segments.at(-1);
  if (lastSegment === undefined) {
    return false;
  }
  if (RAW_TOOL_CREDENTIAL_SEGMENTS.has(lastSegment)) {
    return true;
  }
  if (lastSegment === 'token' || lastSegment === 'tokens') {
    return segments.length === 1 || RAW_TOOL_TOKEN_PREFIX_SEGMENTS.has(segments.at(-2) ?? '');
  }
  if (lastSegment === 'key' || lastSegment === 'keys') {
    return segments.at(-2) === 'api';
  }
  if (!RAW_TOOL_SECRET_VALUE_SUFFIXES.has(lastSegment)) {
    return false;
  }
  const valueKind = segments.at(-2);
  return (
    RAW_TOOL_CREDENTIAL_SEGMENTS.has(valueKind ?? '') ||
    valueKind === 'token' ||
    valueKind === 'tokens' ||
    (valueKind === 'key' && segments.at(-3) === 'api')
  );
}

function normalizeCaughtFailure(fields: Record<string, unknown>, caught: unknown): Record<string, unknown> {
  if (caught === undefined) {
    return fields;
  }
  if (caught instanceof AgentError) {
    return {
      ...fields,
      safeReasonCode: caught.code,
      safeErrorCategory: caught.category,
      retryable: caught.retryable,
      ...(caught.category === 'INTERNAL' ? projectException(caught, true, false) : {}),
    };
  }
  if (isAbortError(caught)) {
    return {
      ...fields,
      safeErrorCategory: 'CANCELED',
      retryable: false,
    };
  }
  if (caught instanceof Error) {
    const exceptionCode = readErrorCode(caught);
    return {
      ...fields,
      ...(exceptionCode === undefined || ERROR_CODE_REASON_OVERRIDES[exceptionCode] === undefined
        ? {}
        : { safeReasonCode: ERROR_CODE_REASON_OVERRIDES[exceptionCode] }),
      safeErrorCategory: 'INTERNAL',
      retryable: false,
      ...projectException(caught, true, true),
    };
  }
  return {
    ...fields,
    safeErrorCategory: 'INTERNAL',
    retryable: false,
    exceptionType: 'NonErrorThrow',
  };
}

function shouldSuppressCaughtDiagnostic(fields: object, caught: unknown): boolean {
  if (!(caught instanceof AgentError) || caught.category === 'INTERNAL') {
    return false;
  }
  const event = (fields as Readonly<Record<string, unknown>>).event;
  return typeof event === 'string' && event.endsWith('.exception_captured');
}

function isAbortError(value: unknown): value is Error {
  if (!(value instanceof Error)) {
    return false;
  }
  try {
    return value.name === 'AbortError';
  } catch {
    return false;
  }
}

interface ExceptionProjectionState {
  readonly seen: WeakSet<Error>;
  remainingInspectionChars: number;
  remainingFrames: number;
  truncated: boolean;
}

function projectException(error: Error, includeCause: boolean, includeCode = true): Record<string, unknown> {
  const state: ExceptionProjectionState = {
    seen: new WeakSet<Error>(),
    remainingInspectionChars: MAX_EXCEPTION_INSPECTION_CHARS,
    remainingFrames: MAX_EXCEPTION_FRAMES,
    truncated: false,
  };
  const projection = projectExceptionNode(error, includeCause, includeCode, 0, state);
  return state.truncated ? { ...projection, exceptionChainTruncated: true } : projection;
}

function projectExceptionNode(
  error: Error,
  includeCause: boolean,
  includeCode: boolean,
  depth: number,
  state: ExceptionProjectionState,
): Record<string, unknown> {
  state.seen.add(error);
  const exceptionType = safeExceptionType(readErrorString(error, 'name'));
  const exceptionCode = includeCode ? readErrorCode(error) : undefined;
  const stack = readBoundedStack(error, state);
  const frames = safeOwnedFrames(stack, state);
  const cause = includeCause ? projectExceptionCause(error, depth, state) : undefined;
  return {
    exceptionType,
    ...(exceptionCode === undefined ? {} : { exceptionCode }),
    exceptionFingerprint: exceptionFingerprint(exceptionType, stack),
    ...(frames.length === 0 ? {} : { exceptionFrames: frames }),
    ...(cause === undefined ? {} : { exceptionCause: cause }),
  };
}

function projectExceptionCause(error: Error, depth: number, state: ExceptionProjectionState): Record<string, unknown> | undefined {
  const cause = readErrorCause(error);
  if (cause.status === 'absent') {
    return undefined;
  }
  if (cause.status === 'non_error') {
    return { exceptionType: 'NonErrorThrow' };
  }
  if (cause.status === 'inaccessible') {
    state.truncated = true;
    return undefined;
  }
  if (depth + 1 >= MAX_EXCEPTION_CHAIN_NODES || state.seen.has(cause.value) || state.remainingInspectionChars <= 0) {
    state.truncated = true;
    return undefined;
  }
  return projectExceptionNode(cause.value, true, true, depth + 1, state);
}

function readErrorCode(error: Error): string | undefined {
  try {
    const code = (error as Error & { readonly code?: unknown }).code;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

function readErrorString(error: Error, key: 'name'): string | undefined {
  try {
    const value = error[key];
    if (typeof value !== 'string') {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

function readBoundedStack(error: Error, state: ExceptionProjectionState): string | undefined {
  try {
    const stack = error.stack;
    if (typeof stack !== 'string') {
      return undefined;
    }
    const inspected = stack.slice(0, state.remainingInspectionChars);
    state.remainingInspectionChars -= inspected.length;
    if (inspected.length < stack.length) {
      state.truncated = true;
    }
    return inspected;
  } catch {
    return undefined;
  }
}

function readErrorCause(
  error: Error,
):
  | { readonly status: 'absent' }
  | { readonly status: 'inaccessible' }
  | { readonly status: 'non_error' }
  | { readonly status: 'error'; readonly value: Error } {
  try {
    const cause = error.cause;
    if (cause === undefined) {
      return { status: 'absent' };
    }
    return cause instanceof Error ? { status: 'error', value: cause } : { status: 'non_error' };
  } catch {
    return { status: 'inaccessible' };
  }
}

function safeExceptionType(name?: string): string {
  return name !== undefined && SAFE_EXCEPTION_TYPES.has(name) ? name : 'Error';
}

function exceptionFingerprint(exceptionType: string, stack?: string): string {
  const stackLines = stack?.split(/\r?\n/u).slice(1).map(normalizeStackLineForFingerprint) ?? [];
  return createHash('sha256')
    .update([exceptionType, ...stackLines].join('\n'))
    .digest('hex')
    .slice(0, 24);
}

function normalizeStackLineForFingerprint(line: string): string {
  return line
    .replace(/file:\/\/\/[A-Za-z]:\//giu, '')
    .replace(/\\/gu, '/')
    .replace(/^.*?(?=(?:packages|node_modules\/@nextagent)\/)/u, '')
    .replace(/(?:[A-Za-z]:)?\/(?:[^\s():]+\/)+/gu, '<path>/')
    .trim();
}

function safeOwnedFrames(stack: string | undefined, state: ExceptionProjectionState): readonly string[] {
  if (stack === undefined) {
    return [];
  }
  const frames: string[] = [];
  for (const line of stack.split(/\r?\n/u).slice(1)) {
    const frame = safeOwnedFrame(line);
    if (frame !== undefined) {
      if (state.remainingFrames <= 0) {
        state.truncated = true;
        break;
      }
      frames.push(frame);
      state.remainingFrames -= 1;
    }
  }
  return frames;
}

function safeOwnedFrame(line: string): string | undefined {
  const normalized = line.replace(/\\/gu, '/');
  const source =
    /(?:packages\/|node_modules\/@nextagent\/)(agent-[a-z0-9-]+)\/(?:src|dist)\/(?:.*\/)?([A-Za-z0-9._-]+\.(?:[cm]?js|ts)):(\d+):(\d+)/u.exec(
      normalized,
    );
  if (source === null) {
    return undefined;
  }
  const functionMatch = /^\s*at\s+(?:async\s+)?(.+?)\s+\(/u.exec(line);
  const functionName = safeFrameFunction(functionMatch?.[1]);
  return `${functionName}@${source[1]}#${source[2]}:${source[3]}:${source[4]}`;
}

function safeFrameFunction(value?: string): string {
  return value !== undefined && value.length <= 96 && /^[A-Za-z0-9_$.[\]<>-]+$/u.test(value) ? value : 'anonymous';
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '<redacted>';
  }
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH || seen.has(value)) {
      return ['<truncated>'];
    }
    seen.add(value);
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1, seen));
  }
  if (typeof value === 'object') {
    return sanitizeObject(value as Readonly<Record<string, unknown>>, depth, seen);
  }
  return '<redacted>';
}

function normalizeRawToolPayload(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '<redacted>';
  }
  if (typeof value === 'string') {
    return normalizeRawToolPayloadString(value);
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH || seen.has(value)) {
      return ['<truncated>'];
    }
    seen.add(value);
    return normalizeRawArray(value, depth, seen);
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH || seen.has(value)) {
      return { safeReasonCode: 'value_truncated' };
    }
    seen.add(value);
    const output: Record<string, unknown> = {};
    let count = 0;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }
      if (count >= MAX_FIELD_COUNT) {
        output.safeReasonCode = 'fields_truncated';
        break;
      }
      count++;
      let fieldValue: unknown;
      try {
        fieldValue = (value as Readonly<Record<string, unknown>>)[key];
      } catch {
        output[key] = '<redacted>';
        continue;
      }
      output[key] = isRawToolCredentialOrTokenKey(key) ? '<redacted:credential>' : normalizeRawToolPayload(fieldValue, depth + 1, seen);
    }
    return output;
  }
  return '<redacted>';
}

function normalizeRawToolPayloadString(value: string): string {
  const originalBytes = Buffer.byteLength(value);
  let normalized = truncateUtf8(value, MAX_RAW_STRING_BYTES + TEXT_REDACTION_LOOKAHEAD_BYTES);
  for (const [pattern, replacement] of RAW_TOOL_INLINE_SECRET_PATTERNS) {
    normalized = normalized.replace(pattern, replacement);
  }
  if (originalBytes <= MAX_RAW_STRING_BYTES) {
    return normalized;
  }
  const marker = `<truncated:${byteBucket(originalBytes)}-bytes>`;
  return `${truncateUtf8(normalized, MAX_RAW_STRING_BYTES - Buffer.byteLength(marker))}${marker}`;
}

function normalizeRawArray(value: readonly unknown[], depth: number, seen: WeakSet<object>): readonly unknown[] {
  const truncated = value.length > MAX_RAW_ARRAY_ITEMS;
  const retained = value.slice(0, truncated ? MAX_RAW_ARRAY_ITEMS - 1 : MAX_RAW_ARRAY_ITEMS);
  return [...retained.map((item) => normalizeRawToolPayload(item, depth + 1, seen)), ...(truncated ? ['<truncated:array-items>'] : [])];
}

function normalizeRawRuntimePayloadField(key: string, value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (key === 'modelInput') {
    return normalizeModelInput(value, depth, seen);
  }
  if (key === 'modelOutput') {
    return normalizeModelOutput(value, depth, seen);
  }
  return normalizeRawToolPayload(value, depth, seen);
}

function normalizeModelInput(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return '<redacted>';
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (!Array.isArray(input.messages)) {
    return {};
  }
  return {
    messages: normalizeRawArray(
      input.messages.filter((message) => safeRecord(message)?.role !== 'SYSTEM'),
      depth,
      seen,
    ),
  };
}

function normalizeModelOutput(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return '<redacted>';
  }
  const output: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!MODEL_OUTPUT_FIELDS.has(key)) {
      continue;
    }
    output[key] = normalizeRawToolPayload(fieldValue, depth + 1, seen);
  }
  return output;
}

function sanitizeRuntimeExceptionData(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '<redacted>';
  }
  if (typeof value === 'string') {
    return sanitizeRuntimeExceptionString(value);
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH || seen.has(value)) {
      return ['<truncated>'];
    }
    seen.add(value);
    const truncated = value.length > MAX_RAW_ARRAY_ITEMS;
    return [
      ...value.slice(0, truncated ? MAX_RAW_ARRAY_ITEMS - 1 : MAX_RAW_ARRAY_ITEMS).map((item) => sanitizeRuntimeExceptionData(item, depth + 1, seen)),
      ...(truncated ? ['<truncated:array-items>'] : []),
    ];
  }
  if (typeof value !== 'object' || depth >= MAX_DEPTH || seen.has(value)) {
    return '<redacted>';
  }
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (Object.keys(output).length >= MAX_FIELD_COUNT) {
      output.safeReasonCode = 'fields_truncated';
      break;
    }
    output[key] = isRawToolCredentialOrTokenKey(key) ? '<redacted:credential>' : sanitizeRuntimeExceptionData(item, depth + 1, seen);
  }
  return output;
}

function sanitizeRuntimeExceptionString(value: string): string {
  let safe = truncateUtf8(value, MAX_RUNTIME_EXCEPTION_STRING_BYTES + TEXT_REDACTION_LOOKAHEAD_BYTES)
    .replace(/[\u0000-\u001F\u007F]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS.slice(0, 3)) {
    safe = safe.replace(pattern, replacement);
  }
  return truncateUtf8(safe, MAX_RUNTIME_EXCEPTION_STRING_BYTES);
}

function sanitizeString(value: string): string {
  return sanitizeText(value, MAX_STRING_BYTES, false);
}

function sanitizeText(value: string, maxBytes: number, singleLine: boolean): string {
  const originalBytes = Buffer.byteLength(value);
  let safe = truncateUtf8(value, maxBytes + TEXT_REDACTION_LOOKAHEAD_BYTES);
  if (singleLine) {
    safe = safe
      .replace(/[\u0000-\u001F\u007F]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) {
    safe = safe.replace(pattern, replacement);
  }
  return originalBytes > maxBytes ? `<truncated:${byteBucket(originalBytes)}-bytes>` : safe;
}

function byteBucket(byteLength: number): '1-1024' | '1025-4096' | '4097-16384' | '16385+' {
  if (byteLength <= 1_024) {
    return '1-1024';
  }
  if (byteLength <= 4_096) {
    return '1025-4096';
  }
  if (byteLength <= 16_384) {
    return '4097-16384';
  }
  return '16385+';
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= maxBytes) {
    return value;
  }
  return bytes
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD$/u, '');
}

function serializedSize(level: RuntimeLogLevel, fields: Readonly<Record<string, unknown>>): number {
  return (
    Buffer.byteLength(
      JSON.stringify({
        level,
        timestamp: new Date().toISOString(),
        ...fields,
      }),
    ) + 1
  );
}

function normalizeComponent(component: string): string {
  return /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(component) && component.length <= MAX_COMPONENT_LENGTH ? component : 'unknown-component';
}

function requireServiceVersion(serviceVersion: string): string {
  if (
    serviceVersion.length > 0 &&
    serviceVersion.length <= MAX_SERVICE_VERSION_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/u.test(serviceVersion)
  ) {
    return serviceVersion;
  }
  throw new TypeError('Operational log service version must be a bounded deployment-owned token.');
}

function isTrustedEvent(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u.test(value);
}

function hasApprovedErrorClassification(fields: Readonly<Record<string, unknown>>): boolean {
  return ['safeReasonCode', 'safeErrorCode', 'errorCode', 'recoveryCode'].some((key) => {
    const value = fields[key];
    return typeof value === 'string' && SAFE_LOW_CARDINALITY_TOKEN.test(value);
  });
}

function validatedLogCorrelation(traceId: unknown, spanId: unknown): { readonly traceId: string; readonly spanId: string } | undefined {
  if (typeof traceId !== 'string' || !/^[0-9a-f]{32}$/u.test(traceId) || /^0{32}$/u.test(traceId)) {
    return undefined;
  }
  if (typeof spanId !== 'string' || !/^[0-9a-f]{16}$/u.test(spanId) || /^0{16}$/u.test(spanId)) {
    return undefined;
  }
  return { traceId, spanId };
}

function writePino(logger: Logger, level: RuntimeLogLevel, fields: object): void {
  logger[level](fields);
}

function countBucket(count: number): string {
  if (count < 10) {
    return String(count);
  }
  if (count < 100) {
    return '10-99';
  }
  if (count < 1_000) {
    return '100-999';
  }
  if (count < 1_000_000) {
    return '1k-999k';
  }
  return '1m+';
}

async function flushConsole(destination: ConsoleDestination, timeoutMs: number): Promise<void> {
  await withinTimeout(
    new Promise<void>((resolvePromise, reject) => {
      try {
        destination.flush((error?: Error) => (error === undefined ? resolvePromise() : reject(error)));
      } catch (error) {
        reject(error);
      }
    }),
    timeoutMs,
  );
}

async function closeConsole(destination: ConsoleDestination, timeoutMs: number): Promise<void> {
  await withinTimeout(
    new Promise<void>((resolvePromise) => {
      destination.once('close', () => resolvePromise());
      destination.end();
    }),
    timeoutMs,
  );
}

async function completeLifecycleOperations(
  operations: ReadonlyArray<{ readonly sink: 'console' | 'file'; readonly operation: Promise<void> }>,
  event: 'logging.flush.failed' | 'logging.close.failed',
  reporter: (evidence: OperationalEmergencyEvidence) => void,
): Promise<void> {
  const results = await Promise.allSettled(operations.map((entry) => entry.operation));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      reporter({ event, sink: operations[index]!.sink });
    }
  });
}

async function withinTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  const boundedTimeout = Number.isFinite(timeoutMs) ? Math.max(0, Math.trunc(timeoutMs)) : 0;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolvePromise, reject) => {
        timer = setTimeout(() => reject(new Error('operational logging operation timed out')), boundedTimeout);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
