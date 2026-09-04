import { createHash } from 'node:crypto';
import {
  brand,
  type AgentId,
  type AgentVersion,
  type EpochMillis,
  type IdempotencyKey,
  type JsonObject,
  type MemoryCategory,
  type MessageId,
  type RequestRunId,
  type SafeError,
  type SessionId,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type {
  GuardrailGatewayPort,
  IdempotentWriteOptions,
  LongTermMemoryRecord,
  LongTermMemoryStoreGateway,
  SaveLongTermMemoryRequest,
  TaskTrajectoryQueryGateway,
  TaskTrajectoryRecord,
  TaskTrajectorySourceRef,
  VersionedWriteOptions,
} from '@nextagent/agent-contracts/gateway';
import { createLongTermMemorySaveCoordinator, type LongTermMemorySaveCoordinator } from './long-term-memory-write-coordinator.js';
import { isMemoryCronDue } from './memory-cron.js';
import {
  parseMemoryContent,
  parseMemorySource,
  serializeMemoryContent,
  serializeMemorySource,
  type InteractionMemorySourceTrace,
  type MemoryContentByCategory,
  type MemorySourceTrace,
  type MemorySourceTraceRef,
} from './memory-data.js';

export type MemoryExtractionStrategy = 'RULE_FIRST' | 'LLM_ONLY';
export type MemoryExtractionStrategyProvenance = 'RULE' | 'LLM' | 'MERGED';
export type MemoryExtractionCycleStatus = 'STARTED' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';

export type MemoryExtractionRejectionReason =
  | 'CATEGORY_INVALID'
  | 'CONTENT_INVALID'
  | 'SOURCE_TRACE_MISSING'
  | 'BRIEF_INDEX_INVALID'
  | 'TAGS_INVALID'
  | 'CONFIDENCE_INVALID'
  | 'CANDIDATE_UNSAFE'
  | 'CANDIDATE_NOT_USEFUL'
  | 'CORE_WRITE_PROJECTION_INVALID'
  | 'CANDIDATE_LIMIT_REACHED'
  | 'CONTENT_REF_UNAVAILABLE'
  | 'CROSS_SCOPE_TRAJECTORY'
  | 'CROSS_SESSION_AMBIGUOUS'
  | 'CROSS_SESSION_CONFLICTING_EVIDENCE'
  | 'FUSION_SCAN_LIMIT_REACHED'
  | 'CORROBORATION_LIMIT_REACHED';

export interface MemoryExtractionRuntimeConfig {
  readonly enabled: boolean;
  readonly strategy: MemoryExtractionStrategy;
  readonly crossSessionSchedule?: string;
  readonly maxCycleTrajectories: number;
  readonly maxCandidates: number;
  readonly timeoutMs: number;
  readonly lookbackDays: number;
}

export interface MemoryExtractionConfigSnapshot {
  readonly enabled: boolean;
  readonly status: 'VALID' | 'INVALID' | 'DISABLED';
  readonly extraction: MemoryExtractionRuntimeConfig;
}

export interface MemoryExtractionScope {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion?: AgentVersion;
}

export interface MemoryExtractionCandidate {
  readonly category: MemoryCategory;
  readonly content: MemoryContentByCategory;
  readonly briefIndex: string;
  readonly confidence: number;
  readonly tags: readonly string[];
  readonly sourceTrace: InteractionMemorySourceTrace;
  readonly strategyProvenance: MemoryExtractionStrategyProvenance;
}

export interface MemoryExtractionCandidateRejection {
  readonly reasonCode: MemoryExtractionRejectionReason;
  readonly category?: MemoryCategory;
  readonly sourceTrace?: Pick<InteractionMemorySourceTrace, 'sessionId' | 'requestId' | 'runId' | 'extractionCycleId'>;
}

export interface MemoryExtractionCycleDiagnostic {
  readonly status: MemoryExtractionCycleStatus;
  readonly reasonCode: string;
  readonly tenantId?: TenantId;
  readonly subjectId?: SubjectId;
  readonly agentId?: AgentId;
  readonly agentVersion?: AgentVersion;
  readonly strategy: MemoryExtractionStrategy;
  readonly trajectoryCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly writtenCount: number;
  readonly fusedCount: number;
  readonly newCount: number;
  readonly skippedCount: number;
  readonly failureCount: number;
  readonly reasonCodes: readonly string[];
  readonly durationMs: number;
}

export interface MemoryExtractionAuditEvent {
  readonly eventType: 'MEMORY_EXTRACTION_WRITE' | 'MEMORY_EXTRACTION_USER_CHARACTERISTICS_REJECTED';
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly category: MemoryCategory;
  readonly longTermMemoryId?: LongTermMemoryRecord['memoryId'];
  readonly sourceRefCount: number;
  readonly occurredAt: EpochMillis;
}

export interface MemoryExtractionLlmRequest {
  readonly scope: MemoryExtractionScope;
  readonly trajectories: readonly TaskTrajectoryRecord[];
  readonly maxCandidates: number;
  readonly cycleId: string;
}

export interface MemoryExtractionLlmResult {
  readonly candidates: readonly MemoryExtractionCandidate[];
  readonly reasonCode?: string;
}

export type MemoryExtractionLlmStrategy = (
  request: MemoryExtractionLlmRequest,
  signal?: AbortSignal,
) => Promise<MemoryExtractionLlmResult | SafeError>;
export type MemoryExtractionCandidateExtractor = (trajectory: TaskTrajectoryRecord, cycleId: string) => readonly MemoryExtractionCandidate[];

export interface MemoryExtractionCycleOptions {
  readonly config: MemoryExtractionConfigSnapshot;
  readonly scopes: readonly MemoryExtractionScope[];
  readonly store: Pick<LongTermMemoryStoreGateway, 'saveLongTermMemory' | 'listLongTermMemory' | 'getLongTermMemory' | 'mutateLongTermMemory'>;
  readonly guardrail?: GuardrailGatewayPort;
  readonly taskTrajectoryQuery?: Pick<TaskTrajectoryQueryGateway, 'listTaskTrajectories'>;
  readonly extractTrajectoryCandidates?: MemoryExtractionCandidateExtractor;
  readonly llmStrategy?: MemoryExtractionLlmStrategy;
  readonly now?: () => EpochMillis;
  readonly cycleId?: string;
  readonly diagnosticObserver?: (event: MemoryExtractionCycleDiagnostic) => void;
  readonly auditObserver?: (event: MemoryExtractionAuditEvent) => void;
}

export interface MemoryExtractionScheduler {
  start: () => void;
  stop: () => Promise<void>;
  triggerNow: (reason: 'manual' | 'scheduled', signal?: AbortSignal) => Promise<MemoryExtractionCycleDiagnostic>;
}

export interface MemoryExtractionSchedulerOptions extends MemoryExtractionCycleOptions {
  readonly intervalMs?: number;
}

interface ValidationOutcome {
  readonly accepted: readonly MemoryExtractionCandidate[];
  readonly rejections: readonly CandidateRejection[];
}

interface WriteOutcome {
  readonly status: 'NEW' | 'FUSED' | 'SKIPPED' | 'FAILED';
  readonly reasonCode: string;
  readonly record?: LongTermMemoryRecord;
}

interface MemoryExtractionDeadline {
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
  timedOut: () => boolean;
  dispose: () => void;
}

type ExtractionDeadlineResult<T> =
  | { readonly status: 'COMPLETED'; readonly value: T }
  | { readonly status: 'STOPPED'; readonly reasonCode: 'MEMORY_EXTRACTION_TIMEOUT' | 'MEMORY_EXTRACTION_CANCELED' };

interface CandidateRejection extends MemoryExtractionCandidateRejection {
  readonly candidate: MemoryExtractionCandidate;
}

interface CollectedTrajectoryInputs {
  readonly status: 'OK';
  readonly trajectories: readonly TaskTrajectoryRecord[];
  readonly trajectoryScopes: ReadonlyMap<string, MemoryExtractionOwnerScope>;
  readonly reasonCodes: readonly string[];
}

type MemoryExtractionOwnerScope = Pick<MemoryExtractionScope, 'tenantId' | 'subjectId' | 'agentId'>;

const defaultIntervalMs = 60_000;
const maxBriefIndexChars = 100;
const maxTagChars = 64;
const dayMs = 86_400_000;
const categoryOrder: readonly MemoryCategory[] = ['FACTUAL', 'CONCEPTUAL', 'PROCEDURAL', 'USER_CHARACTERISTICS'];
const maxLlmCandidateConfidence = 0.75;
const safeTagPattern = /^[A-Za-z0-9._:-]{1,64}$/u;
const unsafeContentPattern = /\b(secret|credential|token|password|api[_-]?key|bearer|private key)\b|[A-Za-z]:\\|\/(?:home|users|etc|var|tmp)\//iu;
const sensitiveTraitPattern =
  /\b(credential|password|token|secret|health|medical|political|religion|financial|salary|bank|relationship|married|passport|ssn|identity card|private identity)\b/iu;
const operationalSummaryPatterns: readonly RegExp[] = [
  /^messages:\d+$/iu,
  /^timelineEvents:\d+$/u,
  /^Terminal status [A-Z_]+\.?$/iu,
  /^Request terminal status [A-Z_]+\.?$/iu,
  /^Visible user message count \d+\.?$/iu,
  /^Committed (?:completed|failed|canceled|cancelled|superseded) request run\.?$/iu,
  /^CAPABILITY_(?:STARTED|COMPLETED)\b/iu,
  /\b(?:Rag|Glob|Grep|Read|Write|Edit|Bash)\b.*\b(?:status|failed|succeeded|scope_mismatch|usage)\b/iu,
  /\bSCOPE_MISMATCH\b/iu,
  /\b(?:tool|capability)\b.*\b(?:status|failed|succeeded|error|diagnostic)\b/iu,
  /^Tool status is available without verification evidence\.?$/iu,
  /^No verification evidence is available\.?$/iu,
  /^Verification evidence completed\.?$/iu,
];
const durableRelationPattern = /(?:[:=]|\bis\b|\bmeans\b|\buses\b|\bshould be\b|\bthreshold\b|\bversion\b|\bsla\b|是|为|指|等于|表示|代表)/iu;
const durableEntityPattern =
  /(?:alarm|告警|kpi|sla|threshold|latency|cell|bgp|ospf|isis|interface|neighbor|peer|route|topology|version|config|region|site|fault|disk|局点|区域|接口|网元|邻居|路由|拓扑|版本|配置|故障|磁盘|[A-Z]{2,}[-_][A-Z0-9._-]*\d|\d+(?:ms|s|%)\b)/iu;
const cjkPattern = /\p{Script=Han}/u;
const reusableProcedureSignalPattern =
  /\b(?:query|check|inspect|verify|confirm|validate|restart|apply|compare|review|collect|diagnose|troubleshoot)\b|查询|检查|核对|确认|验证|复测|排查|查看|采集|应用|回滚|重启|隔离|恢复|记录/u;
const nonReusableProcedureSummaryPattern =
  /黑盒验证|进入长期记忆|轨迹已确认|validation fixture|memory extraction|dreaming|committed completed request run/iu;

export function createMemoryExtractionScheduler(options: MemoryExtractionSchedulerOptions): MemoryExtractionScheduler {
  const intervalMs = boundedInteger(options.intervalMs, defaultIntervalMs, 3_600_000);
  const controller = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<MemoryExtractionCycleDiagnostic> | undefined;
  let lastScheduledAt: EpochMillis | undefined;
  let stopped = false;

  async function triggerNow(reason: 'manual' | 'scheduled', signal?: AbortSignal): Promise<MemoryExtractionCycleDiagnostic> {
    if (stopped) {
      return skipped(options, 'MEMORY_EXTRACTION_STOPPED', 0);
    }
    if (running !== undefined) {
      return skipped(options, 'MEMORY_EXTRACTION_ALREADY_RUNNING', 0);
    }
    const combinedSignal = combineSignals(controller.signal, signal);
    running = runMemoryExtractionCycle(options, combinedSignal);
    try {
      const result = await running;
      if (reason === 'scheduled' && result.status !== 'STARTED') {
        lastScheduledAt = options.now?.() ?? brand<number, 'EpochMillis'>(Date.now());
      }
      return result;
    } finally {
      running = undefined;
    }
  }

  return {
    start() {
      if (timer !== undefined || stopped) {
        return;
      }
      const schedule = options.config.extraction.crossSessionSchedule;
      if (options.config.status === 'INVALID') {
        options.diagnosticObserver?.(skipped(options, 'MEMORY_CONFIG_INVALID', 0));
        return;
      }
      if (!options.config.enabled || !options.config.extraction.enabled || schedule === undefined) {
        return;
      }
      timer = setInterval(() => {
        const now = options.now?.() ?? brand<number, 'EpochMillis'>(Date.now());
        if (isMemoryExtractionCronDue(schedule, now, lastScheduledAt)) {
          void triggerNow('scheduled', controller.signal);
        }
      }, intervalMs);
      (timer as { unref?: () => void }).unref?.();
    },
    async stop() {
      stopped = true;
      controller.abort();
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      await running;
    },
    triggerNow,
  };
}

export async function runMemoryExtractionCycle(
  options: MemoryExtractionCycleOptions,
  signal?: AbortSignal,
): Promise<MemoryExtractionCycleDiagnostic> {
  const startedAt = Date.now();
  const deadline = createMemoryExtractionDeadline(options.config.extraction.timeoutMs, signal, startedAt);
  try {
    return await runMemoryExtractionCycleWithinDeadline(options, deadline, startedAt);
  } finally {
    deadline.dispose();
  }
}

async function runMemoryExtractionCycleWithinDeadline(
  options: MemoryExtractionCycleOptions,
  deadline: MemoryExtractionDeadline,
  startedAt: number,
): Promise<MemoryExtractionCycleDiagnostic> {
  const strategy = options.config.extraction.strategy;
  const cycleId = options.cycleId ?? `memory-extraction-${startedAt}`;
  if (options.scopes.length > 1) {
    return runScopedMemoryExtractionCycles({ ...options, cycleId }, startedAt, deadline);
  }
  const writeCoordinator = createLongTermMemorySaveCoordinator({
    store: options.store,
    ...(options.guardrail === undefined ? {} : { guardrail: options.guardrail }),
  });
  const started = diagnostic(options, 'STARTED', 'MEMORY_EXTRACTION_STARTED', startedAt, {
    trajectoryCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    writtenCount: 0,
    fusedCount: 0,
    newCount: 0,
    skippedCount: 0,
    failureCount: 0,
    reasonCodes: [],
  });
  options.diagnosticObserver?.(started);

  if (options.config.status === 'DISABLED' || !options.config.enabled || !options.config.extraction.enabled) {
    return emitResult(options, diagnostic(options, 'SKIPPED', 'EXTRACTION_DISABLED', startedAt, zeroCounts(['EXTRACTION_DISABLED'])));
  }
  if (options.config.status !== 'VALID') {
    return emitResult(options, diagnostic(options, 'FAILED', 'MEMORY_CONFIG_INVALID', startedAt, zeroCounts(['MEMORY_CONFIG_INVALID'])));
  }
  const initialStopReason = extractionStopReason(deadline);
  if (initialStopReason !== undefined) {
    return emitResult(options, diagnostic(options, 'FAILED', initialStopReason, startedAt, zeroCounts([initialStopReason])));
  }
  if (options.taskTrajectoryQuery === undefined) {
    return emitResult(
      options,
      diagnostic(options, 'FAILED', 'EXTRACTION_INPUT_UNAVAILABLE', startedAt, zeroCounts(['EXTRACTION_INPUT_UNAVAILABLE'])),
    );
  }

  const input = await collectTrajectoryInputs(options, deadline);
  if (input.status === 'FAILED') {
    return emitResult(options, diagnostic(options, 'FAILED', input.reasonCode, startedAt, zeroCounts([input.reasonCode])));
  }
  if (input.trajectories.length === 0) {
    const reason = input.reasonCodes.length === 0 ? 'NO_ELIGIBLE_TRAJECTORIES' : input.reasonCodes[0]!;
    return emitResult(
      options,
      diagnostic(options, 'SKIPPED', reason, startedAt, {
        trajectoryCount: 0,
        acceptedCount: 0,
        rejectedCount: input.reasonCodes.length,
        writtenCount: 0,
        fusedCount: 0,
        newCount: 0,
        skippedCount: input.reasonCodes.length,
        failureCount: 0,
        reasonCodes: input.reasonCodes.length === 0 ? [reason] : input.reasonCodes,
      }),
    );
  }

  const ruleCandidates =
    strategy === 'LLM_ONLY'
      ? []
      : input.trajectories.flatMap((trajectory) => (options.extractTrajectoryCandidates ?? extractTrajectoryCandidates)(trajectory, cycleId));
  const ruleValidation = validateAndPrepareCandidates(ruleCandidates, options.config.extraction.maxCandidates);
  const llmOnlyTrajectories = input.trajectories.filter(trajectoryRequiresLlmSemanticExtraction);
  const llmTrajectories =
    options.config.extraction.strategy === 'RULE_FIRST' && ruleValidation.accepted.length > 0 && llmOnlyTrajectories.length > 0
      ? llmOnlyTrajectories
      : input.trajectories;
  const llmAttempt = await awaitWithinExtractionDeadline(
    maybeRunLlmStrategy(options, llmTrajectories, ruleValidation.accepted.length, llmOnlyTrajectories.length > 0, cycleId, deadline.signal),
    deadline,
  );
  if (llmAttempt.status === 'STOPPED') {
    const counts = zeroCounts([llmAttempt.reasonCode]);
    return emitResult(
      options,
      diagnostic(options, 'FAILED', llmAttempt.reasonCode, startedAt, { ...counts, trajectoryCount: input.trajectories.length }),
    );
  }
  const llmResult = llmAttempt.value;
  if (isSafeError(llmResult)) {
    const counts = zeroCounts([llmResult.code]);
    return emitResult(options, diagnostic(options, 'FAILED', llmResult.code, startedAt, { ...counts, trajectoryCount: input.trajectories.length }));
  }
  const candidates = [...ruleCandidates, ...(llmResult?.candidates ?? [])];
  const validation = llmResult === undefined ? ruleValidation : validateAndPrepareCandidates(candidates, options.config.extraction.maxCandidates);
  const writeResults: WriteOutcome[] = [];
  if (validation.accepted.length > 0) {
    for (const candidate of validation.accepted) {
      const beforeWriteStopReason = extractionStopReason(deadline);
      if (beforeWriteStopReason !== undefined) {
        writeResults.push({ status: 'FAILED', reasonCode: beforeWriteStopReason });
        break;
      }
      writeResults.push(await writeCandidate(options, writeCoordinator, candidate, cycleId, input.trajectoryScopes, deadline));
      const afterWriteStopReason = extractionStopReason(deadline);
      if (afterWriteStopReason !== undefined) {
        writeResults.push({ status: 'FAILED', reasonCode: afterWriteStopReason });
        break;
      }
    }
  }
  emitUserCharacteristicsRejectionAudits(options, validation.rejections, input.trajectoryScopes);

  const reasonCodes = [
    ...input.reasonCodes,
    ...(llmResult?.reasonCode === undefined ? [] : [llmResult.reasonCode]),
    ...validation.rejections.map((item) => item.reasonCode),
    ...(validation.rejections.some((item) => item.reasonCode === 'CANDIDATE_LIMIT_REACHED') ? ['EXTRACTION_BUDGET_EXCEEDED'] : []),
    ...writeResults.map((item) => item.reasonCode).filter((code) => code !== 'MEMORY_EXTRACTION_WRITTEN' && code !== 'MEMORY_EXTRACTION_FUSED'),
  ];
  const writtenCount = writeResults.filter((item) => item.status === 'NEW' || item.status === 'FUSED').length;
  const newCount = writeResults.filter((item) => item.status === 'NEW').length;
  const fusedCount = writeResults.filter((item) => item.status === 'FUSED').length;
  const failureCount = writeResults.filter((item) => item.status === 'FAILED').length;
  const skippedCount = writeResults.filter((item) => item.status === 'SKIPPED').length;
  const rejectedCount = validation.rejections.length + skippedCount;

  if (validation.accepted.length === 0) {
    const reason = reasonCodes[0] ?? 'NO_CROSS_SESSION_CANDIDATES';
    return emitResult(
      options,
      diagnostic(options, 'SKIPPED', reason, startedAt, {
        trajectoryCount: input.trajectories.length,
        acceptedCount: 0,
        rejectedCount,
        writtenCount: 0,
        fusedCount: 0,
        newCount: 0,
        skippedCount,
        failureCount,
        reasonCodes: reasonCodes.length === 0 ? [reason] : reasonCodes,
      }),
    );
  }

  const status: MemoryExtractionCycleStatus =
    failureCount > 0 ? (writtenCount > 0 ? 'PARTIAL' : 'FAILED') : rejectedCount > 0 ? (writtenCount > 0 ? 'PARTIAL' : 'SKIPPED') : 'COMPLETED';
  const reasonCode =
    status === 'COMPLETED'
      ? 'MEMORY_EXTRACTION_COMPLETED'
      : status === 'PARTIAL'
        ? reasonCodes.includes('MEMORY_EXTRACTION_TIMEOUT')
          ? 'MEMORY_EXTRACTION_TIMEOUT'
          : 'MEMORY_EXTRACTION_PARTIAL'
        : status === 'SKIPPED'
          ? (reasonCodes[0] ?? 'NO_CROSS_SESSION_CANDIDATES')
          : (reasonCodes[0] ?? 'MEMORY_EXTRACTION_FAILED');

  return emitResult(
    options,
    diagnostic(options, status, reasonCode, startedAt, {
      trajectoryCount: input.trajectories.length,
      acceptedCount: validation.accepted.length,
      rejectedCount,
      writtenCount,
      fusedCount,
      newCount,
      skippedCount,
      failureCount,
      reasonCodes: uniqueStrings(reasonCodes.length === 0 ? [reasonCode] : reasonCodes).slice(0, 20),
    }),
  );
}

async function runScopedMemoryExtractionCycles(
  options: MemoryExtractionCycleOptions,
  startedAt: number,
  deadline: MemoryExtractionDeadline,
): Promise<MemoryExtractionCycleDiagnostic> {
  const results: MemoryExtractionCycleDiagnostic[] = [];
  for (const scope of options.scopes) {
    const stopReason = extractionStopReason(deadline);
    if (stopReason !== undefined) {
      results.push({
        status: 'FAILED',
        reasonCode: stopReason,
        strategy: options.config.extraction.strategy,
        trajectoryCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        writtenCount: 0,
        fusedCount: 0,
        newCount: 0,
        skippedCount: 0,
        failureCount: 1,
        reasonCodes: [stopReason],
        durationMs: Math.max(0, Date.now() - startedAt),
      });
      break;
    }
    results.push(await runMemoryExtractionCycleWithinDeadline({ ...options, scopes: [scope] }, deadline, startedAt));
  }
  return aggregateScopedDiagnostics(options, results, startedAt);
}

function aggregateScopedDiagnostics(
  options: MemoryExtractionCycleOptions,
  results: readonly MemoryExtractionCycleDiagnostic[],
  startedAt: number,
): MemoryExtractionCycleDiagnostic {
  const trajectoryCount = sumDiagnostics(results, 'trajectoryCount');
  const acceptedCount = sumDiagnostics(results, 'acceptedCount');
  const rejectedCount = sumDiagnostics(results, 'rejectedCount');
  const writtenCount = sumDiagnostics(results, 'writtenCount');
  const fusedCount = sumDiagnostics(results, 'fusedCount');
  const newCount = sumDiagnostics(results, 'newCount');
  const skippedCount = sumDiagnostics(results, 'skippedCount');
  const failureCount = sumDiagnostics(results, 'failureCount');
  const reasonCodes = uniqueStrings(results.flatMap((result) => (result.reasonCodes.length === 0 ? [result.reasonCode] : result.reasonCodes))).slice(
    0,
    20,
  );
  const hasFailure = results.some((result) => result.status === 'FAILED');
  const hasPartial = results.some((result) => result.status === 'PARTIAL');
  const hasCompleted = results.some((result) => result.status === 'COMPLETED');
  const hasSkipped = results.some((result) => result.status === 'SKIPPED');
  const status: MemoryExtractionCycleStatus = hasFailure
    ? writtenCount > 0 || hasCompleted
      ? 'PARTIAL'
      : 'FAILED'
    : hasPartial
      ? 'PARTIAL'
      : hasCompleted && hasSkipped
        ? 'PARTIAL'
        : hasCompleted
          ? 'COMPLETED'
          : 'SKIPPED';
  const reasonCode =
    status === 'COMPLETED'
      ? 'MEMORY_EXTRACTION_COMPLETED'
      : status === 'PARTIAL'
        ? reasonCodes.includes('MEMORY_EXTRACTION_TIMEOUT')
          ? 'MEMORY_EXTRACTION_TIMEOUT'
          : 'MEMORY_EXTRACTION_PARTIAL'
        : (reasonCodes[0] ?? 'NO_ELIGIBLE_TRAJECTORIES');
  return {
    status,
    reasonCode,
    strategy: options.config.extraction.strategy,
    trajectoryCount,
    acceptedCount,
    rejectedCount,
    writtenCount,
    fusedCount,
    newCount,
    skippedCount,
    failureCount,
    reasonCodes: reasonCodes.length === 0 ? [reasonCode] : reasonCodes,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

function sumDiagnostics(
  results: readonly MemoryExtractionCycleDiagnostic[],
  field: 'trajectoryCount' | 'acceptedCount' | 'rejectedCount' | 'writtenCount' | 'fusedCount' | 'newCount' | 'skippedCount' | 'failureCount',
): number {
  return results.reduce((total, result) => total + result[field], 0);
}

export function extractTrajectoryCandidates(
  trajectory: TaskTrajectoryRecord,
  cycleId = 'memory-extraction-cycle',
): readonly MemoryExtractionCandidate[] {
  if (!isEligibleTrajectory(trajectory)) {
    return [];
  }
  const sourceTrace = memoryExtractionSourceTraceFromTrajectory(trajectory, cycleId);
  const candidates: MemoryExtractionCandidate[] = [];
  for (const constraint of trajectory.constraintSummaries.slice(0, 5)) {
    const concept = conceptualContentFromSummary(constraint);
    if (concept !== undefined) {
      candidates.push(candidate('CONCEPTUAL', concept, constraint, sourceTrace, ['task-constraint']));
      continue;
    }
    const factual = factualContentFromSummary(constraint, trajectory);
    if (factual !== undefined) {
      candidates.push(candidate('FACTUAL', factual, constraint, sourceTrace, ['task-constraint']));
    }
  }
  for (const observation of trajectory.observations.slice(0, 10)) {
    if (observation.kind === 'REQUEST_FACT' && !isLlmNoteSummary(observation.summary)) {
      const factual = factualContentFromSummary(observation.summary, trajectory);
      if (factual !== undefined) {
        candidates.push(candidate('FACTUAL', factual, observation.summary, sourceTrace, ['task-observation']));
      }
    }
    if (!isLlmNoteSummary(observation.summary)) {
      const concept = conceptualContentFromSummary(observation.summary);
      if (concept !== undefined) {
        candidates.push(candidate('CONCEPTUAL', concept, observation.summary, sourceTrace, ['task-concept']));
      }
      const trait = userCharacteristicFromSummary(observation.summary);
      if (trait !== undefined) {
        candidates.push(
          candidate(
            'USER_CHARACTERISTICS',
            {
              category: 'USER_CHARACTERISTICS',
              traits: [trait],
              purpose: ['GENERAL'],
            },
            'User preference or workflow habit observed.',
            sourceTrace,
            ['user-characteristic'],
          ),
        );
      }
    }
  }
  const goalConcept = conceptualContentFromSummary(trajectory.goalSummary);
  if (goalConcept !== undefined) {
    candidates.push(candidate('CONCEPTUAL', goalConcept, trajectory.goalSummary, sourceTrace, ['task-concept']));
  }
  const goalTrait = userCharacteristicFromSummary(trajectory.goalSummary);
  if (goalTrait !== undefined) {
    candidates.push(
      candidate(
        'USER_CHARACTERISTICS',
        {
          category: 'USER_CHARACTERISTICS',
          traits: [goalTrait],
          purpose: ['GENERAL'],
        },
        'User preference or workflow habit observed.',
        sourceTrace,
        ['user-characteristic'],
      ),
    );
  }
  if (canCreateProceduralMemory(trajectory)) {
    const procedureText = trajectory.actions
      .map((action) => sanitizeSummary(action.summary))
      .filter((summary) => summary.length > 0)
      .slice(0, 12)
      .join('; ');
    candidates.push(
      candidate(
        'PROCEDURAL',
        {
          category: 'PROCEDURAL',
          procedureName: sanitizeSummary(trajectory.goalSummary) || `${trajectory.taskKind} procedure`,
          procedureText,
        },
        trajectory.goalSummary,
        sourceTrace,
        ['task-procedure'],
      ),
    );
  }
  return candidates;
}

export function projectTaskTrajectoryForMemoryExtractionPrompt(trajectory: TaskTrajectoryRecord): JsonObject {
  return {
    taskTrajectoryId: String(trajectory.taskTrajectoryId),
    sessionId: String(trajectory.sessionId),
    requestRunId: String(trajectory.requestRunId),
    taskKind: trajectory.taskKind,
    taskOutcomeStatus: trajectory.taskOutcomeStatus,
    outcomeEvidenceLevel: trajectory.outcomeEvidenceLevel,
    goalSummary: isPromptBusinessSummary(trajectory.goalSummary) ? trajectory.goalSummary : '',
    constraintSummaries: trajectory.constraintSummaries.filter(isPromptBusinessSummary),
    observations: trajectory.observations.filter(isPromptBusinessObservation).map((observation) => ({
      kind: observation.kind,
      summary: observation.summary,
    })),
    actions: trajectory.actions.filter(isPromptBusinessAction).map((action) => ({
      kind: action.kind,
      status: action.status,
      summary: action.summary,
    })),
    sourceRefCount: trajectory.sourceRefs.length,
  };
}

function isPromptBusinessObservation(observation: TaskTrajectoryRecord['observations'][number]): boolean {
  if (!isPromptBusinessSummary(observation.summary)) {
    return false;
  }
  return observation.kind === 'REQUEST_FACT' || observation.kind === 'VERIFICATION' || observation.kind === 'USER_CONFIRMATION';
}

function isPromptBusinessAction(action: TaskTrajectoryRecord['actions'][number]): boolean {
  if (!isPromptBusinessSummary(action.summary)) {
    return false;
  }
  return action.kind === 'CONFIG_APPLY' || action.kind === 'VERIFICATION' || action.kind === 'USER_INPUT' || action.kind === 'OTHER';
}

function isPromptBusinessSummary(summary: string): boolean {
  return !isOperationalSummary(summary);
}

export function validateMemoryExtractionCandidate(candidate: MemoryExtractionCandidate): MemoryExtractionCandidateRejection | undefined {
  if (!categoryOrder.includes(candidate.category)) {
    return rejection('CATEGORY_INVALID', candidate);
  }
  if (candidate.content.category !== candidate.category || !isValidContent(candidate.content)) {
    return rejection('CONTENT_INVALID', candidate);
  }
  if (!hasCompleteSourceTrace(candidate.sourceTrace)) {
    return rejection('SOURCE_TRACE_MISSING', candidate);
  }
  if (!isSafeBriefIndex(candidate.briefIndex)) {
    return rejection('BRIEF_INDEX_INVALID', candidate);
  }
  if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
    return rejection('CONFIDENCE_INVALID', candidate);
  }
  if (candidate.tags.some((tag) => !safeTagPattern.test(tag) || tag.length > maxTagChars)) {
    return rejection('TAGS_INVALID', candidate);
  }
  if (isUnsafeCandidate(candidate)) {
    return rejection('CANDIDATE_UNSAFE', candidate);
  }
  if (!isUsefulCandidate(candidate)) {
    return rejection('CANDIDATE_NOT_USEFUL', candidate);
  }
  return undefined;
}

export function projectMemoryExtractionCandidateWrite(
  scope: Pick<MemoryExtractionScope, 'tenantId' | 'subjectId' | 'agentId'>,
  candidate: MemoryExtractionCandidate,
): { readonly request: SaveLongTermMemoryRequest; readonly options: IdempotentWriteOptions } | MemoryExtractionCandidateRejection {
  const invalid = validateMemoryExtractionCandidate(candidate);
  if (invalid !== undefined) {
    return invalid;
  }
  const identity = candidateIdentity(candidate);
  if (identity.length === 0) {
    return rejection('CORE_WRITE_PROJECTION_INVALID', candidate);
  }
  return {
    request: {
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      memoryType: candidate.category,
      knowledgeSourceType: 'LEARNED',
      confidence: candidate.confidence,
      labels: candidate.tags.slice(0, 10),
      briefIndex: candidate.briefIndex,
      content: serializeMemoryContent(candidate.content),
      source: serializeMemorySource(candidate.sourceTrace),
    },
    options: {
      idempotencyKey: idempotencyKeyFor(scope, candidate),
    },
  };
}

export function isMemoryExtractionCronDue(schedule: string, now: EpochMillis, lastRunAt?: EpochMillis): boolean {
  return isMemoryCronDue(schedule, now, lastRunAt);
}

function emitResult(options: MemoryExtractionCycleOptions, event: MemoryExtractionCycleDiagnostic): MemoryExtractionCycleDiagnostic {
  options.diagnosticObserver?.(event);
  return event;
}

function skipped(options: MemoryExtractionCycleOptions, reasonCode: string, durationMs: number): MemoryExtractionCycleDiagnostic {
  return {
    status: 'SKIPPED',
    reasonCode,
    strategy: options.config.extraction.strategy,
    trajectoryCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    writtenCount: 0,
    fusedCount: 0,
    newCount: 0,
    skippedCount: 0,
    failureCount: 0,
    reasonCodes: [reasonCode],
    durationMs,
  };
}

function diagnostic(
  options: MemoryExtractionCycleOptions,
  status: MemoryExtractionCycleStatus,
  reasonCode: string,
  startedAt: number,
  counts: Omit<
    MemoryExtractionCycleDiagnostic,
    'status' | 'reasonCode' | 'strategy' | 'durationMs' | 'tenantId' | 'subjectId' | 'agentId' | 'agentVersion'
  >,
): MemoryExtractionCycleDiagnostic {
  const scope = options.scopes[0];
  return {
    status,
    reasonCode,
    ...(scope === undefined
      ? {}
      : {
          tenantId: scope.tenantId,
          subjectId: scope.subjectId,
          agentId: scope.agentId,
          ...(scope.agentVersion === undefined ? {} : { agentVersion: scope.agentVersion }),
        }),
    strategy: options.config.extraction.strategy,
    ...counts,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

function zeroCounts(
  reasonCodes: readonly string[],
): Omit<
  MemoryExtractionCycleDiagnostic,
  'status' | 'reasonCode' | 'strategy' | 'durationMs' | 'tenantId' | 'subjectId' | 'agentId' | 'agentVersion'
> {
  return {
    trajectoryCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    writtenCount: 0,
    fusedCount: 0,
    newCount: 0,
    skippedCount: 0,
    failureCount: 0,
    reasonCodes,
  };
}

async function collectTrajectoryInputs(
  options: MemoryExtractionCycleOptions,
  deadline: MemoryExtractionDeadline,
): Promise<CollectedTrajectoryInputs | { readonly status: 'FAILED'; readonly reasonCode: string }> {
  const query = options.taskTrajectoryQuery;
  if (query === undefined) {
    return { status: 'FAILED', reasonCode: 'EXTRACTION_INPUT_UNAVAILABLE' };
  }
  const trajectories: TaskTrajectoryRecord[] = [];
  const trajectoryScopes = new Map<string, MemoryExtractionOwnerScope>();
  const reasonCodes: string[] = [];
  const now = options.now?.() ?? brand<number, 'EpochMillis'>(Date.now());
  const since = brand<number, 'EpochMillis'>(Math.max(0, Number(now) - options.config.extraction.lookbackDays * dayMs));
  for (const scope of options.scopes) {
    const beforeQueryStopReason = extractionStopReason(deadline);
    if (beforeQueryStopReason !== undefined) {
      return { status: 'FAILED', reasonCode: beforeQueryStopReason };
    }
    const result = await query.listTaskTrajectories({
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      completedAfter: since,
      completedBefore: now,
      limit: Math.max(1, options.config.extraction.maxCycleTrajectories - trajectories.length),
    });
    const afterQueryStopReason = extractionStopReason(deadline);
    if (afterQueryStopReason !== undefined) {
      return { status: 'FAILED', reasonCode: afterQueryStopReason };
    }
    if (isSafeError(result)) {
      return { status: 'FAILED', reasonCode: result.code === 'LTM_DISABLED' ? 'LTM_DISABLED' : 'EXTRACTION_INPUT_UNAVAILABLE' };
    }
    for (const item of result.items) {
      if (item.tenantId !== scope.tenantId || item.subjectId !== scope.subjectId || item.agentId !== scope.agentId) {
        reasonCodes.push('CROSS_SCOPE_TRAJECTORY');
        continue;
      }
      if (!isEligibleTrajectory(item)) {
        reasonCodes.push('CONTENT_REF_UNAVAILABLE');
        continue;
      }
      trajectories.push(item);
      trajectoryScopes.set(trajectoryScopeKey(item), {
        tenantId: scope.tenantId,
        subjectId: scope.subjectId,
        agentId: scope.agentId,
      });
      if (trajectories.length >= options.config.extraction.maxCycleTrajectories) {
        break;
      }
    }
    if (trajectories.length >= options.config.extraction.maxCycleTrajectories) {
      break;
    }
  }
  return { status: 'OK', trajectories, trajectoryScopes, reasonCodes: uniqueStrings(reasonCodes) };
}

async function maybeRunLlmStrategy(
  options: MemoryExtractionCycleOptions,
  trajectories: readonly TaskTrajectoryRecord[],
  acceptedUsefulRuleCandidateCount: number,
  hasLlmOnlyTrajectories: boolean,
  cycleId: string,
  signal?: AbortSignal,
): Promise<MemoryExtractionLlmResult | SafeError | undefined> {
  if (options.config.extraction.strategy === 'RULE_FIRST' && acceptedUsefulRuleCandidateCount > 0 && !hasLlmOnlyTrajectories) {
    return undefined;
  }
  if (options.config.extraction.strategy !== 'LLM_ONLY' && options.config.extraction.strategy !== 'RULE_FIRST') {
    return undefined;
  }
  const scope = options.scopes[0];
  if (scope === undefined || trajectories.length === 0) {
    return undefined;
  }
  if (options.llmStrategy === undefined) {
    return options.config.extraction.strategy === 'LLM_ONLY' ? safeError('MODEL_UNAVAILABLE', 'UNAVAILABLE', false) : undefined;
  }
  return options.llmStrategy(
    {
      scope,
      trajectories,
      maxCandidates: options.config.extraction.maxCandidates,
      cycleId,
    },
    signal,
  );
}

function validateAndPrepareCandidates(candidates: readonly MemoryExtractionCandidate[], maxCandidates: number): ValidationOutcome {
  const initialRejections: CandidateRejection[] = [];
  const normalized = candidates.flatMap((candidate): readonly MemoryExtractionCandidate[] => {
    const invalid = validateMemoryExtractionCandidate(candidate);
    if (invalid !== undefined) {
      initialRejections.push({ ...invalid, candidate });
      return [];
    }
    return [normalizeCandidate(candidate)];
  });
  const merged = mergeDuplicateCandidates(normalized);
  const sorted = [...merged].sort((left, right) => candidateSortKey(left).localeCompare(candidateSortKey(right)));
  const limited = sorted.slice(0, maxCandidates);
  const rejections: CandidateRejection[] =
    sorted.length > maxCandidates
      ? [...initialRejections, ...sorted.slice(maxCandidates).map((candidate) => candidateRejection('CANDIDATE_LIMIT_REACHED', candidate))]
      : initialRejections;
  return { accepted: limited, rejections };
}

async function writeCandidate(
  options: MemoryExtractionCycleOptions,
  writeCoordinator: LongTermMemorySaveCoordinator,
  candidate: MemoryExtractionCandidate,
  cycleId: string,
  trajectoryScopes: ReadonlyMap<string, MemoryExtractionOwnerScope>,
  deadline: MemoryExtractionDeadline,
): Promise<WriteOutcome> {
  const scope = ownerScopeFromCandidate(candidate, trajectoryScopes);
  if (scope === undefined) {
    return { status: 'SKIPPED', reasonCode: 'CROSS_SCOPE_TRAJECTORY' };
  }
  if (candidate.category === 'USER_CHARACTERISTICS' && options.auditObserver === undefined) {
    return { status: 'SKIPPED', reasonCode: 'USER_CHARACTERISTICS_AUDIT_UNAVAILABLE' };
  }
  const existing = await findExistingMemory(options.store, scope, candidate, options.config.extraction.maxCandidates, deadline);
  if (existing.status === 'FAILED' || existing.status === 'SKIPPED') {
    return existing;
  }
  if (existing.record !== undefined) {
    const outcome = await mergeExistingMemory(options, writeCoordinator, scope, existing.record, candidate, cycleId, deadline);
    if (outcome.status === 'FUSED' && !emitMemoryWriteAudit(options, scope, candidate, outcome.record)) {
      return { status: 'FAILED', reasonCode: 'USER_CHARACTERISTICS_AUDIT_UNAVAILABLE' };
    }
    return outcome;
  }
  const projection = projectMemoryExtractionCandidateWrite(scope, candidate);
  if ('reasonCode' in projection) {
    return { status: 'FAILED', reasonCode: projection.reasonCode };
  }
  const beforeSaveStopReason = extractionStopReason(deadline);
  if (beforeSaveStopReason !== undefined) {
    return { status: 'FAILED', reasonCode: beforeSaveStopReason };
  }
  const saved = await saveMemoryWrite(writeCoordinator, projection.request, projection.options, deadline.signal);
  if (isSafeError(saved)) {
    return memoryWriteFailure(saved);
  }
  if (!emitMemoryWriteAudit(options, scope, candidate, saved)) {
    return { status: 'FAILED', reasonCode: 'USER_CHARACTERISTICS_AUDIT_UNAVAILABLE' };
  }
  return { status: 'NEW', reasonCode: 'MEMORY_EXTRACTION_WRITTEN', record: saved };
}

function emitMemoryWriteAudit(
  options: MemoryExtractionCycleOptions,
  scope: MemoryExtractionOwnerScope,
  candidate: MemoryExtractionCandidate,
  record?: LongTermMemoryRecord,
): boolean {
  try {
    options.auditObserver?.({
      eventType: 'MEMORY_EXTRACTION_WRITE',
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      category: candidate.category,
      ...(record === undefined ? {} : { longTermMemoryId: record.memoryId }),
      sourceRefCount: candidate.sourceTrace.refs?.length ?? 0,
      occurredAt: options.now?.() ?? brand<number, 'EpochMillis'>(Date.now()),
    });
    return options.auditObserver !== undefined || candidate.category !== 'USER_CHARACTERISTICS';
  } catch {
    return candidate.category !== 'USER_CHARACTERISTICS';
  }
}

async function findExistingMemory(
  store: MemoryExtractionCycleOptions['store'],
  scope: Pick<MemoryExtractionScope, 'tenantId' | 'subjectId' | 'agentId'>,
  candidate: MemoryExtractionCandidate,
  maxCandidates: number,
  deadline: MemoryExtractionDeadline,
): Promise<{ readonly status: 'OK'; readonly record?: LongTermMemoryRecord } | WriteOutcome> {
  const beforeListStopReason = extractionStopReason(deadline);
  if (beforeListStopReason !== undefined) {
    return { status: 'FAILED', reasonCode: beforeListStopReason };
  }
  const list = await store.listLongTermMemory({
    tenantId: scope.tenantId,
    subjectId: scope.subjectId,
    agentId: scope.agentId,
    memoryType: candidate.category,
    state: 'ACTIVE',
    limit: maxCandidates,
  });
  const afterListStopReason = extractionStopReason(deadline);
  if (afterListStopReason !== undefined) {
    return { status: 'FAILED', reasonCode: afterListStopReason };
  }
  if (isSafeError(list)) {
    return { status: 'FAILED', reasonCode: mapStoreError(list) };
  }
  let sawRelated = false;
  for (const item of list.items) {
    const beforeDetailStopReason = extractionStopReason(deadline);
    if (beforeDetailStopReason !== undefined) {
      return { status: 'FAILED', reasonCode: beforeDetailStopReason };
    }
    const detail = await store.getLongTermMemory({
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      memoryId: item.memoryId,
    });
    const afterDetailStopReason = extractionStopReason(deadline);
    if (afterDetailStopReason !== undefined) {
      return { status: 'FAILED', reasonCode: afterDetailStopReason };
    }
    if (isSafeError(detail)) {
      continue;
    }
    const relation = compareCandidateWithRecord(candidate, detail);
    if (relation === 'EQUIVALENT') {
      return { status: 'OK', record: detail };
    }
    if (relation === 'CONFLICT') {
      return { status: 'SKIPPED', reasonCode: 'CROSS_SESSION_CONFLICTING_EVIDENCE' };
    }
    if (relation === 'AMBIGUOUS') {
      sawRelated = true;
    }
  }
  if (list.items.length >= maxCandidates) {
    return { status: 'SKIPPED', reasonCode: 'FUSION_SCAN_LIMIT_REACHED' };
  }
  if (sawRelated) {
    return { status: 'SKIPPED', reasonCode: 'CROSS_SESSION_AMBIGUOUS' };
  }
  return { status: 'OK' };
}

async function mergeExistingMemory(
  options: MemoryExtractionCycleOptions,
  writeCoordinator: LongTermMemorySaveCoordinator,
  scope: Pick<MemoryExtractionScope, 'tenantId' | 'subjectId' | 'agentId'>,
  existing: LongTermMemoryRecord,
  candidate: MemoryExtractionCandidate,
  cycleId: string,
  deadline: MemoryExtractionDeadline,
): Promise<WriteOutcome> {
  const existingSource = parseMemorySource(existing.source);
  if (existingSource === undefined || isManualMemorySourceTrace(existingSource)) {
    return { status: 'SKIPPED', reasonCode: 'DUPLICATE_SOURCE_EVIDENCE' };
  }
  const newRefs = newSourceEvidenceRefs(existingSource, candidate.sourceTrace);
  if (newRefs.length === 0) {
    return { status: 'SKIPPED', reasonCode: 'DUPLICATE_SOURCE_EVIDENCE' };
  }
  const hasIndependentEvidence = hasNewIndependentSourceEvidence(existingSource, newRefs);
  const mergedSourceTrace = mergeSourceTrace(existingSource, { ...candidate.sourceTrace, refs: newRefs }, cycleId);
  const beforeSaveStopReason = extractionStopReason(deadline);
  if (beforeSaveStopReason !== undefined) {
    return { status: 'FAILED', reasonCode: beforeSaveStopReason };
  }
  const saved = await saveMemoryWrite(
    writeCoordinator,
    {
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      memoryId: existing.memoryId,
      memoryInstance: existing.memoryInstance,
      memoryType: existing.memoryType,
      knowledgeSourceType: existing.knowledgeSourceType,
      confidence: existing.confidence,
      labels: uniqueStrings([...existing.labels, ...candidate.tags]).slice(0, 10),
      briefIndex: existing.briefIndex,
      content: existing.content,
      source: serializeMemorySource(mergedSourceTrace),
    },
    { expectedVersion: existing.version },
    deadline.signal,
  );
  if (isSafeError(saved)) {
    return memoryWriteFailure(saved);
  }
  if (!hasIndependentEvidence) {
    return { status: 'FUSED', reasonCode: 'SOURCE_EVIDENCE_MERGED', record: saved };
  }
  const afterSaveStopReason = extractionStopReason(deadline);
  if (afterSaveStopReason !== undefined) {
    return { status: 'FUSED', reasonCode: afterSaveStopReason, record: saved };
  }
  if (existing.extractionCount >= 2 || saved.confidence >= 1) {
    return { status: 'FUSED', reasonCode: 'CORROBORATION_LIMIT_REACHED', record: saved };
  }
  const adjusted = await options.store.mutateLongTermMemory(
    {
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      memoryId: saved.memoryId,
      memoryInstance: saved.memoryInstance,
      delta: Math.min(0.1, 1 - saved.confidence),
    },
    { expectedVersion: saved.version },
  );
  if (isSafeError(adjusted)) {
    return { status: 'FAILED', reasonCode: mapStoreError(adjusted) };
  }
  return adjusted.record === undefined
    ? { status: 'FAILED', reasonCode: 'LTM_STORAGE_UNAVAILABLE' }
    : { status: 'FUSED', reasonCode: 'MEMORY_EXTRACTION_FUSED', record: adjusted.record };
}

function ownerScopeFromCandidate(
  candidate: MemoryExtractionCandidate,
  trajectoryScopes: ReadonlyMap<string, MemoryExtractionOwnerScope>,
): MemoryExtractionOwnerScope | undefined {
  const key = sourceTraceScopeKey(candidate.sourceTrace);
  return key === undefined ? undefined : trajectoryScopes.get(key);
}

function candidate(
  category: MemoryCategory,
  content: MemoryContentByCategory,
  brief: string,
  sourceTrace: InteractionMemorySourceTrace,
  tags: readonly string[],
): MemoryExtractionCandidate {
  return {
    category,
    content,
    briefIndex: sanitizeBrief(brief),
    confidence: category === 'PROCEDURAL' ? 0.7 : category === 'USER_CHARACTERISTICS' ? 0.6 : 0.5,
    tags,
    sourceTrace,
    strategyProvenance: 'RULE',
  };
}

function normalizeCandidate(candidate: MemoryExtractionCandidate): MemoryExtractionCandidate {
  return {
    ...candidate,
    briefIndex: sanitizeBrief(candidate.briefIndex),
    confidence: normalizeCandidateConfidence(candidate),
    tags: uniqueStrings(candidate.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)).slice(0, 20),
    sourceTrace: {
      ...candidate.sourceTrace,
      ...(candidate.sourceTrace.messageRefs === undefined ? {} : { messageRefs: uniqueMessageIds(candidate.sourceTrace.messageRefs) }),
      ...(candidate.sourceTrace.refs === undefined ? {} : { refs: mergeSourceRefs(candidate.sourceTrace.refs) }),
    },
  };
}

function normalizeCandidateConfidence(candidate: MemoryExtractionCandidate): number {
  const clamped = Math.max(0, Math.min(1, candidate.confidence));
  return candidate.strategyProvenance === 'LLM' ? Math.min(clamped, maxLlmCandidateConfidence) : clamped;
}

function mergeDuplicateCandidates(candidates: readonly MemoryExtractionCandidate[]): readonly MemoryExtractionCandidate[] {
  const byKey = new Map<string, MemoryExtractionCandidate>();
  for (const item of candidates) {
    const key = candidateIdentity(item);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, item);
      continue;
    }
    byKey.set(key, {
      ...existing,
      confidence: Math.max(existing.confidence, item.confidence),
      tags: uniqueStrings([...existing.tags, ...item.tags]),
      sourceTrace: mergeSourceTrace(
        existing.sourceTrace,
        item.sourceTrace,
        item.sourceTrace.extractionCycleId ?? existing.sourceTrace.extractionCycleId ?? 'memory-extraction-cycle',
      ),
      strategyProvenance: existing.strategyProvenance === item.strategyProvenance ? existing.strategyProvenance : 'MERGED',
    });
  }
  return [...byKey.values()];
}

function isEligibleTrajectory(trajectory: TaskTrajectoryRecord): boolean {
  return (
    trajectory.trajectoryBuildStatus === 'COMPLETED' &&
    trajectory.goalSummary.trim().length > 0 &&
    trajectory.sourceRefs.length > 0 &&
    trajectory.sourceRefs.some((ref) => ref.sessionId !== undefined || ref.refKind === 'REQUEST_RUN')
  );
}

function trajectoryRequiresLlmSemanticExtraction(trajectory: TaskTrajectoryRecord): boolean {
  return trajectory.observations.some((observation) => observation.kind === 'REQUEST_FACT' && isLlmNoteSummary(observation.summary));
}

export function memoryExtractionSourceTraceFromTrajectory(trajectory: TaskTrajectoryRecord, cycleId: string): InteractionMemorySourceTrace {
  const messageRefs = uniqueMessageIds([
    ...trajectory.sourceRefs.flatMap(messageIdsFromTrajectoryRef),
    ...trajectory.observations.flatMap((observation) => observation.sourceRefs.flatMap(messageIdsFromTrajectoryRef)),
    trajectory.requestId,
  ]);
  const refs: MemorySourceTraceRef[] = [
    {
      sessionId: trajectory.sessionId,
      rootMessageId: trajectory.requestId,
      runId: trajectory.requestRunId,
      messageRefs,
      extractionCycleId: cycleId,
    },
  ];
  return {
    sessionId: trajectory.sessionId,
    requestId: trajectory.requestId,
    runId: trajectory.requestRunId,
    messageRefs,
    extractionCycleId: cycleId,
    refs,
  };
}

function messageIdsFromTrajectoryRef(ref: TaskTrajectorySourceRef): readonly MessageId[] {
  return ref.messageId === undefined ? [] : [ref.messageId];
}

function canCreateProceduralMemory(trajectory: TaskTrajectoryRecord): boolean {
  if (trajectory.actions.length === 0) {
    return false;
  }
  if (trajectory.taskOutcomeStatus !== 'SUCCEEDED') {
    return false;
  }
  if (trajectory.outcomeEvidenceLevel !== 'VERIFICATION' && trajectory.outcomeEvidenceLevel !== 'USER_CONFIRMATION') {
    return false;
  }
  if (!trajectory.actions.some((action) => action.status === 'SUCCEEDED' || action.kind === 'VERIFICATION')) {
    return false;
  }
  const actionText = trajectory.actions.map((action) => action.summary).join('; ');
  if (nonReusableProcedureSummaryPattern.test(actionText)) {
    return false;
  }
  if (nonReusableProcedureSummaryPattern.test(trajectory.goalSummary)) {
    return false;
  }
  return true;
}

function evidenceSummaries(trajectory: TaskTrajectoryRecord): readonly string[] {
  return [
    ...(trajectory.outcomeSummary === undefined ? [] : [trajectory.outcomeSummary]),
    ...trajectory.observations
      .filter((item) => item.kind === 'VERIFICATION' || item.kind === 'USER_CONFIRMATION' || item.kind === 'TERMINAL_STATUS')
      .map((item) => item.summary),
  ]
    .map(sanitizeSummary)
    .filter((item) => item.length > 0)
    .slice(0, 5);
}

function factualContentFromSummary(summary: string, trajectory: TaskTrajectoryRecord): MemoryContentByCategory | undefined {
  const clean = sanitizeSummary(summary);
  if (isConceptualDefinitionSummary(clean) || !isDurableBusinessFact(clean)) {
    return undefined;
  }
  return {
    category: 'FACTUAL',
    subject: subjectFromSummary(clean, trajectory),
    claim: clean,
    evidence: evidenceSummaries(trajectory),
  };
}

function subjectFromSummary(summary: string, trajectory: TaskTrajectoryRecord): string {
  const clean = sanitizeSummary(summary);
  const colon = clean.indexOf(':');
  if (colon > 0 && colon <= 48) {
    return clean.slice(0, colon).trim();
  }
  return trajectory.taskKind.toLowerCase().replaceAll('_', ' ');
}

function conceptualContentFromSummary(summary: string): MemoryContentByCategory | undefined {
  const clean = sanitizeSummary(summary);
  const enMatch = /(?:concept|term|definition)\s*[:=]\s*([^:=]+)\s*(?:[:=]|means|is)\s*(.+)$/iu.exec(clean);
  if (enMatch !== null) {
    const concept = sanitizeSummary(enMatch[1] ?? '');
    const definition = sanitizeSummary(enMatch[2] ?? '');
    if (concept.length > 0 && definition.length > 0) {
      return { category: 'CONCEPTUAL', concept, definition };
    }
  }
  const zhMatch = /^(.{2,60}?)\s*(?:代表|表示|归到|对应|等于)\s*(.{2,80}?)[。.，；;,.]*$/u.exec(clean);
  if (zhMatch !== null) {
    const concept = sanitizeSummary(zhMatch[1] ?? '');
    const definition = sanitizeSummary(zhMatch[2] ?? '');
    if (concept.length > 0 && definition.length > 0) {
      return { category: 'CONCEPTUAL', concept, definition };
    }
  }
  return undefined;
}

function isConceptualDefinitionSummary(summary: string): boolean {
  return /(?:concept|term|definition)\s*[:=]/iu.test(summary) || /.{2,60}\s*(?:代表|表示|归到|对应|等于)\s*.{2,}/u.test(summary);
}

function userCharacteristicFromSummary(summary: string): string | undefined {
  const clean = sanitizeSummary(summary);
  const match = /(?:prefers|preference|likes|wants|uses terminology|language preference)\s*[:=]?\s*(.+)$/iu.exec(clean);
  if (match === null) {
    return undefined;
  }
  const trait = sanitizeSummary(match[1] ?? '');
  if (trait.length === 0 || sensitiveTraitPattern.test(trait)) {
    return undefined;
  }
  return trait;
}

function isValidContent(content: MemoryContentByCategory): boolean {
  switch (content.category) {
    case 'FACTUAL':
      return nonEmpty(content.subject) && nonEmpty(content.claim);
    case 'CONCEPTUAL':
      return nonEmpty(content.concept) && nonEmpty(content.definition);
    case 'PROCEDURAL':
      return nonEmpty(content.procedureName) && nonEmpty(content.procedureText);
    case 'USER_CHARACTERISTICS':
      return content.traits.length > 0 && content.purpose.length > 0 && content.traits.every(nonEmpty);
    default: {
      const exhaustive: never = content;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function hasCompleteSourceTrace(trace: InteractionMemorySourceTrace): boolean {
  return (
    trace.sessionId !== undefined &&
    trace.requestId !== undefined &&
    trace.runId !== undefined &&
    ((trace.messageRefs?.length ?? 0) > 0 ||
      (trace.refs?.some((ref) => ref.rootMessageId !== undefined || (ref.messageRefs?.length ?? 0) > 0) ?? false))
  );
}

function isSafeBriefIndex(value: string): boolean {
  return value.length > 0 && value.length <= maxBriefIndexChars && !unsafeContentPattern.test(value);
}

function isUnsafeCandidate(candidate: MemoryExtractionCandidate): boolean {
  const serialized = JSON.stringify(candidate.content);
  if (unsafeContentPattern.test(serialized) || unsafeContentPattern.test(candidate.briefIndex)) {
    return true;
  }
  return candidate.content.category === 'USER_CHARACTERISTICS' && candidate.content.traits.some((trait) => sensitiveTraitPattern.test(trait));
}

function isUsefulCandidate(candidate: MemoryExtractionCandidate): boolean {
  if (isOperationalSummary(candidate.briefIndex)) {
    return false;
  }
  switch (candidate.content.category) {
    case 'FACTUAL':
      return (
        !isOperationalSummary(candidate.content.subject) &&
        !isOperationalSummary(candidate.content.claim) &&
        isDurableBusinessFact(`${candidate.content.subject} ${candidate.content.claim}`)
      );
    case 'CONCEPTUAL':
      return (
        !isOperationalSummary(candidate.content.concept) &&
        !isOperationalSummary(candidate.content.definition) &&
        hasDurableBusinessSignal(`${candidate.content.concept} ${candidate.content.definition}`)
      );
    case 'PROCEDURAL':
      return (
        !isOperationalSummary(candidate.content.procedureName) &&
        !isOperationalSummary(candidate.content.procedureText) &&
        hasDurableBusinessSignal(`${candidate.content.procedureName} ${candidate.content.procedureText}`)
      );
    case 'USER_CHARACTERISTICS':
      return candidate.content.traits.some((trait) => !isOperationalSummary(trait));
    default: {
      const exhaustive: never = candidate.content;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function isDurableBusinessFact(value: string): boolean {
  const clean = sanitizeSummary(value);
  if (clean.length === 0 || isOperationalSummary(clean)) {
    return false;
  }
  if (!durableRelationPattern.test(clean)) {
    return false;
  }
  return hasDurableBusinessSignal(clean);
}

function hasDurableBusinessSignal(value: string): boolean {
  const clean = sanitizeSummary(value);
  return durableEntityPattern.test(clean) || cjkPattern.test(clean);
}

function isOperationalSummary(value: string): boolean {
  const clean = sanitizeSummary(value);
  return clean.length === 0 || operationalSummaryPatterns.some((pattern) => pattern.test(clean));
}

function isLlmNoteSummary(value: string): boolean {
  return sanitizeSummary(value).toLowerCase().startsWith('llm-note:');
}

function compareCandidateWithRecord(
  candidate: MemoryExtractionCandidate,
  record: LongTermMemoryRecord,
): 'EQUIVALENT' | 'CONFLICT' | 'AMBIGUOUS' | 'UNRELATED' {
  if (candidate.category !== record.memoryType) {
    return 'UNRELATED';
  }
  const recordContent = parseMemoryContent(record.content);
  if (recordContent === undefined) {
    return 'AMBIGUOUS';
  }
  const candidateKey = contentIdentity(candidate.content);
  const recordKey = contentIdentity(recordContent);
  if (candidateKey === recordKey && normalizedContent(candidate.content) === normalizedContent(recordContent)) {
    return 'EQUIVALENT';
  }
  if (candidateKey === recordKey) {
    return 'CONFLICT';
  }
  return isAmbiguousRelatedContent(candidate.content, recordContent) ? 'AMBIGUOUS' : 'UNRELATED';
}

function isAmbiguousRelatedContent(left: MemoryContentByCategory, right: MemoryContentByCategory): boolean {
  if (left.category !== right.category) {
    return false;
  }
  switch (left.category) {
    case 'FACTUAL':
      return right.category === 'FACTUAL' && hasMeaningfulTokenOverlap(left.subject, right.subject);
    case 'CONCEPTUAL':
      return (
        right.category === 'CONCEPTUAL' &&
        (hasMeaningfulTokenOverlap(left.concept, right.concept) ||
          left.aliases?.some((alias) => hasMeaningfulTokenOverlap(alias, right.concept)) === true ||
          right.aliases?.some((alias) => hasMeaningfulTokenOverlap(left.concept, alias)) === true)
      );
    case 'PROCEDURAL':
      return right.category === 'PROCEDURAL' && hasMeaningfulTokenOverlap(left.procedureName, right.procedureName);
    case 'USER_CHARACTERISTICS':
      return (
        right.category === 'USER_CHARACTERISTICS' &&
        left.traits.some((trait) => right.traits.some((other) => hasMeaningfulTokenOverlap(trait, other)))
      );
    default: {
      const exhaustive: never = left;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function hasMeaningfulTokenOverlap(left: string, right: string): boolean {
  const rightTokens = significantTokens(right);
  return [...significantTokens(left)].filter((token) => rightTokens.has(token)).length >= 2;
}

function significantTokens(value: string): Set<string> {
  const stopWords = new Set(['and', 'for', 'the', 'with', 'from', 'into', 'uses', 'use', 'user', 'task', 'memory']);
  return new Set(
    normalizeText(value)
      .split(/[^a-z0-9]+/u)
      .filter((token) => (token.length >= 3 || (token.length >= 2 && /\d/u.test(token))) && !stopWords.has(token)),
  );
}

function contentIdentity(content: MemoryContentByCategory): string {
  switch (content.category) {
    case 'FACTUAL':
      return `${content.category}:${normalizeText(content.subject)}`;
    case 'CONCEPTUAL':
      return `${content.category}:${normalizeText(content.concept)}`;
    case 'PROCEDURAL':
      return `${content.category}:${normalizeText(content.procedureName)}`;
    case 'USER_CHARACTERISTICS':
      return `${content.category}:${normalizeText(content.traits[0] ?? '')}:${[...content.purpose].sort().join(',')}`;
    default: {
      const exhaustive: never = content;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function candidateIdentity(candidate: MemoryExtractionCandidate): string {
  return `${candidate.category}:${contentIdentity(candidate.content)}:${normalizedContent(candidate.content)}`;
}

function candidateSortKey(candidate: MemoryExtractionCandidate): string {
  return `${categoryOrder.indexOf(candidate.category)}:${candidateIdentity(candidate)}`;
}

function normalizedContent(content: MemoryContentByCategory): string {
  return JSON.stringify(normalizeForCompare(content));
}

function normalizeForCompare(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForCompare).sort();
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForCompare(item)]),
    );
  }
  return typeof value === 'string' ? normalizeText(value) : value;
}

function mergeSourceTrace(left: InteractionMemorySourceTrace, right: InteractionMemorySourceTrace, cycleId: string): InteractionMemorySourceTrace {
  return {
    sessionId: left.sessionId,
    messageRefs: uniqueMessageIds([...(left.messageRefs ?? []), ...(right.messageRefs ?? [])]),
    extractionCycleId: left.extractionCycleId ?? right.extractionCycleId ?? cycleId,
    refs: mergeSourceRefs([...(left.refs ?? []), ...(right.refs ?? [])]),
    ...((left.requestId ?? right.requestId) === undefined ? {} : { requestId: (left.requestId ?? right.requestId)! }),
    ...((left.runId ?? right.runId) === undefined ? {} : { runId: (left.runId ?? right.runId)! }),
  };
}

function newSourceEvidenceRefs(existing: MemorySourceTrace, candidate: InteractionMemorySourceTrace): readonly MemorySourceTraceRef[] {
  const existingKeys = new Set(sourceRefsFromTrace(existing).map(sourceEvidenceKey));
  return sourceRefsFromTrace(candidate).filter((ref) => !existingKeys.has(sourceEvidenceKey(ref)));
}

function hasNewIndependentSourceEvidence(existing: MemorySourceTrace, newRefs: readonly MemorySourceTraceRef[]): boolean {
  const existingGroups = new Set(sourceRefsFromTrace(existing).map(sourceEvidenceGroupKey));
  return newRefs.some((ref) => !existingGroups.has(sourceEvidenceGroupKey(ref)));
}

function sourceRefsFromTrace(trace: MemorySourceTrace): readonly MemorySourceTraceRef[] {
  if (isManualMemorySourceTrace(trace)) {
    return [];
  }
  if ((trace.refs?.length ?? 0) > 0) {
    return trace.refs ?? [];
  }
  return [
    {
      sessionId: trace.sessionId,
      ...(trace.requestId === undefined ? {} : { rootMessageId: trace.requestId }),
      ...(trace.runId === undefined ? {} : { runId: trace.runId }),
      ...(trace.messageRefs === undefined ? {} : { messageRefs: trace.messageRefs }),
      ...(trace.extractionCycleId === undefined ? {} : { extractionCycleId: trace.extractionCycleId }),
    },
  ];
}

function sourceEvidenceKey(ref: MemorySourceTraceRef): string {
  return JSON.stringify({
    sessionId: ref.sessionId,
    rootMessageId: ref.rootMessageId ?? '',
    runId: ref.runId ?? '',
    messageRefs: [...(ref.messageRefs ?? [])].sort(),
  });
}

function sourceEvidenceGroupKey(ref: MemorySourceTraceRef): string {
  return JSON.stringify({
    sessionId: ref.sessionId,
    rootMessageId: ref.rootMessageId ?? '',
    runId: ref.runId ?? '',
  });
}

function mergeSourceRefs(refs: readonly MemorySourceTraceRef[]): readonly MemorySourceTraceRef[] {
  const byKey = new Map<string, MemorySourceTraceRef>();
  for (const ref of refs) {
    byKey.set(JSON.stringify(ref), ref);
  }
  return [...byKey.values()].slice(0, 50);
}

function uniqueMessageIds(values: readonly MessageId[]): readonly MessageId[] {
  return [...new Map(values.map((value) => [String(value), value])).values()].slice(0, 50);
}

function idempotencyKeyFor(
  scope: Pick<MemoryExtractionScope, 'tenantId' | 'subjectId' | 'agentId'>,
  candidate: MemoryExtractionCandidate,
): IdempotencyKey {
  const hash = createHash('sha256')
    .update(`${scope.tenantId}:${scope.subjectId}:${scope.agentId}:${candidateIdentity(candidate)}`)
    .digest('base64url')
    .slice(0, 32);
  return brand<string, 'IdempotencyKey'>(`memory-extraction:${hash}`);
}

function rejection(reasonCode: MemoryExtractionRejectionReason, candidate: MemoryExtractionCandidate): MemoryExtractionCandidateRejection {
  return {
    reasonCode,
    category: candidate.category,
    sourceTrace: {
      sessionId: candidate.sourceTrace.sessionId,
      ...(candidate.sourceTrace.requestId === undefined ? {} : { requestId: candidate.sourceTrace.requestId }),
      ...(candidate.sourceTrace.runId === undefined ? {} : { runId: candidate.sourceTrace.runId }),
      ...(candidate.sourceTrace.extractionCycleId === undefined ? {} : { extractionCycleId: candidate.sourceTrace.extractionCycleId }),
    },
  };
}

function candidateRejection(reasonCode: MemoryExtractionRejectionReason, candidate: MemoryExtractionCandidate): CandidateRejection {
  return { ...rejection(reasonCode, candidate), candidate };
}

function emitUserCharacteristicsRejectionAudits(
  options: MemoryExtractionCycleOptions,
  rejections: readonly CandidateRejection[],
  trajectoryScopes: ReadonlyMap<string, MemoryExtractionOwnerScope>,
): void {
  for (const item of rejections) {
    if (item.category !== 'USER_CHARACTERISTICS' || item.reasonCode !== 'CANDIDATE_UNSAFE') {
      continue;
    }
    const scope = ownerScopeFromCandidate(item.candidate, trajectoryScopes);
    if (scope === undefined) {
      continue;
    }
    options.auditObserver?.({
      eventType: 'MEMORY_EXTRACTION_USER_CHARACTERISTICS_REJECTED',
      tenantId: scope.tenantId,
      subjectId: scope.subjectId,
      agentId: scope.agentId,
      category: item.category,
      sourceRefCount: item.candidate.sourceTrace.refs?.length ?? 0,
      occurredAt: options.now?.() ?? brand<number, 'EpochMillis'>(Date.now()),
    });
  }
}

function trajectoryScopeKey(trajectory: Pick<TaskTrajectoryRecord, 'sessionId' | 'requestId' | 'requestRunId'>): string {
  return `${String(trajectory.sessionId)}:${String(trajectory.requestId)}:${String(trajectory.requestRunId)}`;
}

function sourceTraceScopeKey(trace: Pick<InteractionMemorySourceTrace, 'sessionId' | 'requestId' | 'runId'>): string | undefined {
  if (trace.sessionId === undefined || trace.requestId === undefined || trace.runId === undefined) {
    return undefined;
  }
  return `${String(trace.sessionId)}:${String(trace.requestId)}:${String(trace.runId)}`;
}

function isManualMemorySourceTrace(trace: MemorySourceTrace): trace is Extract<MemorySourceTrace, { readonly sourceKind: 'MANUAL' }> {
  return 'sourceKind' in trace && trace.sourceKind === 'MANUAL';
}

function mapStoreError(error: SafeError): string {
  if (error.code === 'LTM_DISABLED') {
    return 'LTM_DISABLED';
  }
  if (error.code === 'LTM_STORAGE_UNAVAILABLE') {
    return 'LTM_STORAGE_UNAVAILABLE';
  }
  if (error.code === 'LTM_CONTENT_GUARD_CANCELED') {
    return 'MEMORY_EXTRACTION_CANCELED';
  }
  return error.code;
}

function saveMemoryWrite(
  writeCoordinator: LongTermMemorySaveCoordinator,
  request: SaveLongTermMemoryRequest,
  writeOptions: VersionedWriteOptions | undefined,
  signal: AbortSignal,
): Promise<LongTermMemoryRecord | SafeError> {
  return writeCoordinator.saveLongTermMemory(request, writeOptions, signal);
}

function memoryWriteFailure(error: SafeError): WriteOutcome {
  return error.code === 'LTM_CONTENT_GUARD_BLOCKED'
    ? { status: 'SKIPPED', reasonCode: 'CANDIDATE_UNSAFE' }
    : { status: 'FAILED', reasonCode: mapStoreError(error) };
}

function safeError(code: string, category: SafeError['category'], retryable: boolean): SafeError {
  return {
    code,
    message: 'Memory extraction failed safely.',
    category,
    retryable,
  };
}

function sanitizeBrief(value: string): string {
  return sanitizeSummary(value).slice(0, maxBriefIndexChars);
}

function sanitizeSummary(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizeText(value: string): string {
  return sanitizeSummary(value).toLowerCase();
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function isSafeError(value: unknown): value is SafeError {
  return typeof value === 'object' && value !== null && 'code' in value && 'category' in value && 'retryable' in value;
}

function createMemoryExtractionDeadline(timeoutMs: number, parentSignal: AbortSignal | undefined, startedAt: number): MemoryExtractionDeadline {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted === true) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }
  const timeout = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(1, timeoutMs),
  );
  (timeout as { unref?: () => void }).unref?.();
  return {
    signal: controller.signal,
    deadlineAt: startedAt + timeoutMs,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function extractionStopReason(deadline: MemoryExtractionDeadline): 'MEMORY_EXTRACTION_TIMEOUT' | 'MEMORY_EXTRACTION_CANCELED' | undefined {
  if (deadline.timedOut() || Date.now() >= deadline.deadlineAt) {
    return 'MEMORY_EXTRACTION_TIMEOUT';
  }
  return deadline.signal.aborted ? 'MEMORY_EXTRACTION_CANCELED' : undefined;
}

async function awaitWithinExtractionDeadline<T>(work: Promise<T>, deadline: MemoryExtractionDeadline): Promise<ExtractionDeadlineResult<T>> {
  const currentStopReason = extractionStopReason(deadline);
  if (currentStopReason !== undefined) {
    return { status: 'STOPPED', reasonCode: currentStopReason };
  }
  return new Promise<ExtractionDeadlineResult<T>>((resolve, reject) => {
    const onAbort = () =>
      resolve({
        status: 'STOPPED',
        reasonCode: extractionStopReason(deadline) ?? 'MEMORY_EXTRACTION_CANCELED',
      });
    deadline.signal.addEventListener('abort', onAbort, { once: true });
    void work.then((value) => resolve({ status: 'COMPLETED', value }), reject).finally(() => deadline.signal.removeEventListener('abort', onAbort));
  });
}

function combineSignals(first: AbortSignal, second?: AbortSignal): AbortSignal {
  if (second === undefined) {
    return first;
  }
  if (first.aborted || second.aborted) {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  first.addEventListener('abort', abort, { once: true });
  second.addEventListener('abort', abort, { once: true });
  return controller.signal;
}
