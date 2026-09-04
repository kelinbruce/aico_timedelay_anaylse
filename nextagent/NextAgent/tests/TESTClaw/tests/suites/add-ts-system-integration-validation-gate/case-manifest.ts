export type SystemIntegrationCaseId = `TC-SI-${string}`;
export type SystemIntegrationLayer = 'INTEGRATION' | 'E2E';
export type SystemIntegrationOrigin = 'FIXED_GATE' | 'BACKEND_E2E' | 'BROWSER_E2E' | 'NEW_INTEGRATION' | 'NEW_E2E';
export type SystemIntegrationInputRoot = 'candidate' | 'external-packages';

export interface SystemIntegrationCaseDefinition {
  readonly caseId: SystemIntegrationCaseId;
  readonly title: string;
  readonly layer: SystemIntegrationLayer;
  readonly originKind: SystemIntegrationOrigin;
  readonly sourceCaseRef: string;
  readonly ownerGate: 'testclaw-system-integration';
  readonly featureRefs: readonly string[];
  readonly functionRefs: readonly string[];
  readonly requirementRefs: readonly string[];
  readonly externalDependencyRefs: readonly string[];
  readonly executionRef: string;
  readonly requiredInputRoots: readonly SystemIntegrationInputRoot[];
}

export interface DeferredCoverageEntry {
  readonly coverageId: string;
  readonly stage: 'PLANNED' | 'EXCLUDED';
  readonly owner: string;
  readonly safeReason: string;
  readonly activationCondition: string;
}

interface SourceCase {
  readonly title: string;
  readonly sourceCaseRef: string;
}

const fixedGateCases: readonly SourceCase[] = [
  ['minimal Q&A main flow', 'alpha-kernel-gate:alpha-01'],
  ['SSE canonical sequence', 'alpha-kernel-gate:alpha-02'],
  ['same-session concurrent conflict rejection', 'alpha-kernel-gate:alpha-03'],
  ['SafeError security boundary', 'alpha-kernel-gate:alpha-04'],
  ['idempotent submit reuse of session and run', 'alpha-kernel-gate:alpha-05'],
  ['owner scope isolation', 'alpha-kernel-gate:alpha-06'],
  ['same-round parallel tool calls', 'alpha-kernel-gate:alpha-07'],
  ['login session create and conversation read', 'product-journey:e2e-P0-02'],
  ['SSE canonical sequence and terminal state', 'product-journey:e2e-P0-03'],
  ['SSE and WebSocket lifecycle terminal consistency', 'product-journey:e2e-P0-04'],
  ['terminal commit stream history and refresh consistency', 'product-journey:e2e-P0-06'],
  ['same-session latest-submit replacement and serial dispatch', 'product-journey:e2e-P0-07'],
  ['cancel terminal state and partial answer', 'product-journey:e2e-P0-08'],
  ['retry new run and old result traceability', 'product-journey:e2e-P0-09'],
  ['edit-resubmit new mainline', 'product-journey:e2e-P0-10'],
  ['attachment intake to context', 'product-journey:e2e-P0-11'],
  ['long session selection summary compaction and degradation hint', 'product-journey:e2e-P0-13'],
  ['large content lazy load on demand', 'product-journey:e2e-P0-14'],
  ['model-tool-capability complete loop', 'product-journey:e2e-P0-15'],
  ['capability source disable directory and call result', 'product-journey:e2e-P0-18'],
  ['feedback immutable and associated facts', 'product-journey:e2e-P0-22'],
  ['auto title vs manual title priority', 'product-journey:e2e-P0-23'],
  ['bilingual output with telecom term fidelity', 'product-journey:e2e-P0-24'],
  ['unauthenticated request creates no user data', 'security-gate:e2e-P0-01'],
  ['attachment failure remains safe', 'security-gate:e2e-P0-12'],
  ['dynamic execution cannot bypass sandbox gateway', 'security-gate:e2e-P0-16'],
  ['provider failure maps to SafeError', 'security-gate:e2e-P0-17'],
  ['audit and log output contains safe fields only', 'security-gate:e2e-P0-21'],
  ['stream replay resumes after disconnect', 'resilience-gate:e2e-P0-05'],
  ['candidate survives process restart', 'resilience-gate:e2e-P0-27'],
  ['uncertain recovery does not replay non-idempotent capability', 'resilience-gate:e2e-P0-28'],
  ['illegal candidate configuration fails closed', 'release-package:e2e-P0-19'],
  ['candidate health and readiness', 'release-package:e2e-P0-20'],
  ['with-frontend route precedence', 'release-package:e2e-P0-25'],
  ['candidate manifest and evidence integrity', 'release-package:e2e-P0-26'],
  ['extension governance product path', 'p1-p2-scenario-gate:e2e-P1P2-01'],
  ['long-term memory product path', 'p1-p2-scenario-gate:e2e-P1P2-02'],
  ['routing child-agent product path', 'p1-p2-scenario-gate:e2e-P1P2-03'],
  ['human pending input product path', 'p1-p2-scenario-gate:e2e-P1P2-04'],
  ['workflow routing product path', 'p1-p2-scenario-gate:e2e-P1P2-05'],
  ['conversation share product path', 'p1-p2-scenario-gate:e2e-P1P2-06'],
].map(([title, sourceCaseRef]) => ({ title, sourceCaseRef }));

const backendSourceCases: readonly SourceCase[] = [
  ['starts an HTTP service and accepts a QA request', 'tests/e2e/backend-service-smoke.test.ts#qa-request'],
  ['streams content and thinking deltas as cumulative snapshots', 'tests/e2e/backend-service-smoke.test.ts#cumulative-snapshots'],
  ['keeps CLIP APIs deferred until ToolSearch activation', 'tests/e2e/clipc-tool-search-lazy-context.test.ts#lazy-context'],
  ['loads context-monitor plugin and writes context artifact', 'tests/e2e/context-monitor-plugin-product-path.test.ts#context-monitor'],
  ['creates durable Cron tasks and excludes deleted tasks', 'tests/e2e/cron-task-management-api-product-path.test.ts#durable-cron'],
  ['executes Cron create list and delete tool calls', 'tests/e2e/cron-tool-calling-product-path.test.ts#cron-tool'],
  ['delivers local due trigger exactly once', 'tests/e2e/cron-trigger-product-path.test.ts#local-trigger'],
  ['deduplicates signed remote Cron callback', 'tests/e2e/cron-trigger-product-path.test.ts#remote-callback'],
  ['runs daily single-turn request', 'tests/e2e/daily-product-path.test.ts#single-turn'],
  ['keeps daily multi-turn session state', 'tests/e2e/daily-product-path.test.ts#multi-turn'],
  ['executes Tool Skill and Agent capabilities', 'tests/e2e/daily-product-path.test.ts#capabilities'],
  ['round-trips human pending input', 'tests/e2e/daily-product-path.test.ts#pending-input'],
  ['writes developer hook trace artifact', 'tests/e2e/developer-hook-trace-plugin-product-path.test.ts#hook-trace'],
  ['executes Edit and Grep over HTTP', 'tests/e2e/edit-grep-pascalcase-product-path.test.ts#edit-grep'],
  ['pages back externalized large tool result', 'tests/e2e/large-tool-result-readback-product-path.test.ts#large-result'],
  ['propagates model invocation scope', 'tests/e2e/model-invocation-scope.test.ts#model-scope'],
  ['loads Agent-scoped plugin composition', 'tests/e2e/plugin-composition-product-path.test.ts#plugin-composition'],
  ['retry preserves workflow directive', 'tests/e2e/retry-directive-recovery.test.ts#workflow-directive'],
  ['retry preserves Skill directive', 'tests/e2e/retry-directive-recovery.test.ts#skill-directive'],
  ['retry without directive uses model loop', 'tests/e2e/retry-directive-recovery.test.ts#model-loop'],
  ['retry without directive avoids accidental Workflow', 'tests/e2e/retry-directive-recovery.test.ts#no-workflow'],
  ['loads Tool Calling Skill fixture', 'tests/e2e/skill-fixtures.test.ts#tool-calling'],
  ['loads extension-policy Skill fixture', 'tests/e2e/skill-fixtures.test.ts#extension-policy'],
  ['applies Skill model metadata', 'tests/e2e/skill-tool-search-multi-round-context.test.ts#model-metadata'],
  ['rejects unauthorized Skill model metadata', 'tests/e2e/skill-tool-search-multi-round-context.test.ts#unauthorized-model'],
  ['loads multiple Skills across ToolSearch rounds', 'tests/e2e/skill-tool-search-multi-round-context.test.ts#multi-round'],
  ['creates task coordinates', 'tests/e2e/task-channel-product-path.test.ts#create'],
  ['rejects task request without identity', 'tests/e2e/task-channel-product-path.test.ts#missing-identity'],
  ['rejects async task without callback', 'tests/e2e/task-channel-product-path.test.ts#missing-callback'],
  ['accepts optional task metadata', 'tests/e2e/task-channel-product-path.test.ts#metadata'],
  ['replays task create idempotency result', 'tests/e2e/task-channel-product-path.test.ts#idempotency'],
  ['streams task accepted through completed', 'tests/e2e/task-channel-product-path.test.ts#sse'],
  ['rejects task stream without identity', 'tests/e2e/task-channel-product-path.test.ts#stream-identity'],
  ['delivers narrowed task callback payload', 'tests/e2e/task-channel-product-path.test.ts#callback'],
  ['creates edited task attempt', 'tests/e2e/task-channel-product-path.test.ts#edit'],
  ['creates retried task attempt', 'tests/e2e/task-channel-product-path.test.ts#retry'],
  ['cancels running task', 'tests/e2e/task-channel-product-path.test.ts#cancel'],
  ['answers pending task input', 'tests/e2e/task-channel-product-path.test.ts#pending-answer'],
  ['does not expose task WebSocket endpoint', 'tests/e2e/task-channel-product-path.test.ts#no-websocket'],
  ['returns completed task status', 'tests/e2e/task-channel-product-path.test.ts#completed-status'],
  ['returns pending task status', 'tests/e2e/task-channel-product-path.test.ts#pending-status'],
  ['returns nonexistent task per-item error', 'tests/e2e/task-channel-product-path.test.ts#not-found'],
  ['returns 404 for unimplemented task endpoints', 'tests/e2e/task-channel-product-path.test.ts#unimplemented'],
  ['ToolSearch exposes safe governed metadata', 'tests/e2e/tool-search-product-path.test.ts#safe-metadata'],
  ['ToolSearch hides disabled Tool', 'tests/e2e/tool-search-product-path.test.ts#disabled-tool'],
  ['runs local Workflow agent loop', 'tests/e2e/workflow-tool-agent-loop.test.ts#local'],
  ['runs remote Workflow agent loop', 'tests/e2e/workflow-tool-agent-loop.test.ts#remote'],
  ['executes workspace file tools over HTTP', 'tests/e2e/workspace-tool-calling-product-path.test.ts#workspace-tools'],
  ['executes model Write into Agent workspace', 'tests/e2e/write-product-path.test.ts#write'],
].map(([title, sourceCaseRef]) => ({ title, sourceCaseRef }));

const browserSourceCases: readonly SourceCase[] = [
  ['loads the chat shell', 'frontend/agent-web/tests/e2e/app-smoke.spec.cjs#chat-shell'],
  ['keeps long memory search clear of quick-clear', 'frontend/agent-web/tests/e2e/app-smoke.spec.cjs#memory-clear'],
  ['keeps favorites and memory management exclusive', 'frontend/agent-web/tests/e2e/app-smoke.spec.cjs#favorites-memory'],
  ['local complaint feedback hides history', 'frontend/agent-web/tests/e2e/complaint-feedback.spec.cjs#local'],
  ['immersive-left complaint history', 'frontend/agent-web/tests/e2e/complaint-feedback.spec.cjs#immersive-left'],
  ['immersive-right complaint history', 'frontend/agent-web/tests/e2e/complaint-feedback.spec.cjs#immersive-right'],
  ['collaborative complaint history modal', 'frontend/agent-web/tests/e2e/complaint-feedback.spec.cjs#collaborative'],
  ['manages Cron dashboard', 'frontend/agent-web/tests/e2e/cron-task-dashboard.spec.cjs#dashboard'],
  ['shares process behavior across hosts', 'frontend/agent-web/tests/e2e/process-history-modes.spec.cjs#hosts'],
  ['suppresses motion across hosts', 'frontend/agent-web/tests/e2e/process-history-modes.spec.cjs#reduced-motion'],
  ['bounds 200-turn journey', 'frontend/agent-web/tests/e2e/process-history-modes.spec.cjs#bounded-history'],
  ['keeps latest edit and retry attempt', 'frontend/agent-web/tests/e2e/session-edit-retry.spec.cjs#latest-attempt'],
  ['composes fork retry edit reload and share', 'frontend/agent-web/tests/e2e/session-edit-retry.spec.cjs#composition'],
  ['keeps anchored history window stable', 'frontend/agent-web/tests/e2e/session-history-streaming.spec.cjs#anchored-window'],
  ['keeps settled answer with user-only history', 'frontend/agent-web/tests/e2e/session-history-streaming.spec.cjs#settled-answer'],
  ['keeps AskUserQuestion through refresh', 'frontend/agent-web/tests/e2e/session-history-streaming.spec.cjs#pending-question'],
  ['keeps 20-question input reachable', 'frontend/agent-web/tests/e2e/session-history-streaming.spec.cjs#twenty-questions'],
  ['keeps live-tail before submit response', 'frontend/agent-web/tests/e2e/session-live-run-identity-recovery.spec.cjs#live-tail'],
  ['keeps submit retry edit in one turn', 'frontend/agent-web/tests/e2e/session-live-run-identity-recovery.spec.cjs#first-event'],
  ['retries refreshed historical turn', 'frontend/agent-web/tests/e2e/session-live-run-identity-recovery.spec.cjs#historical-retry'],
  ['replays exact active run', 'frontend/agent-web/tests/e2e/session-live-run-identity-recovery.spec.cjs#active-run'],
].map(([title, sourceCaseRef]) => ({ title, sourceCaseRef }));

const newCases: readonly SourceCase[] = [
  ['external ESM consumer public exports', 'change:add-ts-system-integration-validation-gate#TC-SI-112'],
  ['remote gateways loopback', 'change:add-ts-system-integration-validation-gate#TC-SI-113'],
  ['SkillHub HTTP and filesystem', 'change:add-ts-system-integration-validation-gate#TC-SI-114'],
  ['remote deployment HTTP and SSE mainline', 'change:add-ts-system-integration-validation-gate#TC-SI-115'],
  ['telecom RAG and sandbox diagnosis', 'change:add-ts-system-integration-validation-gate#TC-SI-116'],
  ['SkillHub acquisition to execution', 'change:add-ts-system-integration-validation-gate#TC-SI-117'],
  ['remote invalid response failure and cancellation', 'change:add-ts-system-integration-validation-gate#TC-SI-118'],
  ['three hosts with one real backend truth', 'change:add-ts-system-integration-validation-gate#TC-SI-119'],
].map(([title, sourceCaseRef]) => ({ title, sourceCaseRef }));

const refreshedBrowserCases: readonly SourceCase[] = [
  ['keeps pending tool-round output in the process bridge', 'frontend/agent-web/tests/e2e/process-history-modes.spec.cjs#pending-process-bridge'],
  [
    'hands pending output to the final answer without presentation drift',
    'frontend/agent-web/tests/e2e/process-history-modes.spec.cjs#final-answer-handoff',
  ],
  [
    'shows one factual failure reason with collapsed safe technical details',
    'frontend/agent-web/tests/e2e/process-history-modes.spec.cjs#safe-failure-details',
  ],
].map(([title, sourceCaseRef]) => ({ title, sourceCaseRef }));

export const SYSTEM_INTEGRATION_CASES: readonly SystemIntegrationCaseDefinition[] = Object.freeze([
  ...fixedGateCases.map((entry, index) => createCase(index + 1, entry)),
  ...backendSourceCases.map((entry, index) => createCase(index + 42, entry)),
  ...browserSourceCases.map((entry, index) => createCase(index + 91, entry)),
  ...newCases.map((entry, index) => createCase(index + 112, entry)),
  ...refreshedBrowserCases.map((entry, index) => createCase(index + 120, entry)),
]);

export const DEFERRED_COVERAGE: readonly DeferredCoverageEntry[] = Object.freeze([
  {
    coverageId: 'planned-aico-service-consumer',
    stage: 'PLANNED',
    owner: 'external-aico-consumer',
    safeReason: 'executable consumer artifact is unavailable',
    activationCondition: 'a versioned executable consumer artifact and stable acceptance contract are supplied',
  },
  {
    coverageId: 'planned-joint-release-flows',
    stage: 'PLANNED',
    owner: 'testclaw-system-integration',
    safeReason: 'joint release artifacts are incomplete',
    activationCondition: 'all participating artifacts expose stable executable product entries',
  },
  {
    coverageId: 'excluded-independent-performance-gate',
    stage: 'EXCLUDED',
    owner: 'testclaw-performance',
    safeReason: 'stable performance thresholds have an independent gate owner and verdict',
    activationCondition: 'a future OpenSpec explicitly composes the performance verdict into this system integration gate',
  },
  {
    coverageId: 'excluded-cluster-agentlink-capacity',
    stage: 'EXCLUDED',
    owner: 'quality-governance',
    safeReason: 'stable cluster, AgentLink and capacity behavior is not defined',
    activationCondition: 'dedicated OpenSpec capabilities define measurable system-level black-box behavior and executable artifacts',
  },
]);

function createCase(number: number, source: SourceCase): SystemIntegrationCaseDefinition {
  const caseId = `TC-SI-${String(number).padStart(3, '0')}` as SystemIntegrationCaseId;
  const isIntegration = number >= 112 && number <= 114;
  const isBrowser = (number >= 91 && number <= 111) || number === 119 || (number >= 120 && number <= 122);
  const originKind: SystemIntegrationOrigin =
    number <= 41
      ? 'FIXED_GATE'
      : number <= 90
        ? 'BACKEND_E2E'
        : number <= 111 || (number >= 120 && number <= 122)
          ? 'BROWSER_E2E'
          : number <= 114
            ? 'NEW_INTEGRATION'
            : 'NEW_E2E';
  const relativeFile = isIntegration
    ? `tests/suites/add-ts-system-integration-validation-gate/integration/${caseId}.test.ts`
    : isBrowser
      ? `tests/suites/add-ts-system-integration-validation-gate/e2e/browser/${caseId}.spec.ts`
      : `tests/suites/add-ts-system-integration-validation-gate/e2e/backend/${caseId}.test.ts`;
  const isNewRemoteE2E = number >= 115 && number <= 118;
  const requiresLocalTestHost = number === 94 || number === 119 || number === 122;
  const requiredInputRoots: readonly SystemIntegrationInputRoot[] = isIntegration
    ? ['external-packages']
    : isNewRemoteE2E || requiresLocalTestHost
      ? ['candidate', 'external-packages']
      : ['candidate'];

  return Object.freeze({
    caseId,
    title: source.title,
    layer: isIntegration ? 'INTEGRATION' : 'E2E',
    originKind,
    sourceCaseRef: source.sourceCaseRef,
    ownerGate: 'testclaw-system-integration',
    featureRefs: Object.freeze(['F-10.8']),
    functionRefs: Object.freeze(['FN-10.31']),
    requirementRefs: Object.freeze([
      number <= 111 || (number >= 120 && number <= 122)
        ? 'ts-system-integration-validation-gate:现有场景逐条同步到 TestClaw'
        : isIntegration
          ? 'ts-system-integration-validation-gate:三个新增系统集成用例覆盖外部真实边界'
          : 'ts-system-integration-validation-gate:五个新增 E2E 流程覆盖跨边界产品路径',
      `source:${source.sourceCaseRef}`,
    ]),
    externalDependencyRefs: Object.freeze(
      requiresLocalTestHost ? ['agent-web-test-hosts'] : number >= 112 && number <= 118 ? ['nextagent-remote-packages'] : [],
    ),
    executionRef: `${relativeFile}#${caseId}`,
    requiredInputRoots: Object.freeze(requiredInputRoots),
  });
}

const caseKeys = [
  'caseId',
  'title',
  'layer',
  'originKind',
  'sourceCaseRef',
  'ownerGate',
  'featureRefs',
  'functionRefs',
  'requirementRefs',
  'externalDependencyRefs',
  'executionRef',
  'requiredInputRoots',
] as const;

const originByRange = (number: number): SystemIntegrationOrigin =>
  number <= 41
    ? 'FIXED_GATE'
    : number <= 90
      ? 'BACKEND_E2E'
      : number <= 111 || (number >= 120 && number <= 122)
        ? 'BROWSER_E2E'
        : number <= 114
          ? 'NEW_INTEGRATION'
          : 'NEW_E2E';

export function validateSystemIntegrationManifest(input: readonly SystemIntegrationCaseDefinition[]): readonly SystemIntegrationCaseDefinition[] {
  if (!Array.isArray(input) || input.length !== 122) {
    throw new Error('system integration manifest must contain exactly 122 cases');
  }

  const executionRefs = new Set<string>();
  const sourceRefs = new Set<string>();
  input.forEach((entry, index) => {
    if (!isPlainObject(entry) || !hasExactKeys(entry as unknown as Record<string, unknown>, caseKeys)) {
      throw new Error(`invalid manifest shape at index ${index}`);
    }
    const expectedId = `TC-SI-${String(index + 1).padStart(3, '0')}`;
    if (entry.caseId !== expectedId) {
      throw new Error(`expected ${expectedId}`);
    }
    const number = index + 1;
    if (entry.originKind !== originByRange(number)) {
      throw new Error(`invalid origin for ${entry.caseId}`);
    }
    if (entry.layer !== (number >= 112 && number <= 114 ? 'INTEGRATION' : 'E2E')) {
      throw new Error(`invalid layer for ${entry.caseId}`);
    }
    if (entry.ownerGate !== 'testclaw-system-integration') {
      throw new Error(`invalid owner for ${entry.caseId}`);
    }
    for (const value of [entry.title, entry.sourceCaseRef, entry.executionRef]) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`empty string field for ${entry.caseId}`);
      }
    }
    validateStringRefs(entry.featureRefs, 'featureRefs', entry.caseId);
    validateStringRefs(entry.functionRefs, 'functionRefs', entry.caseId);
    validateStringRefs(entry.requirementRefs, 'requirementRefs', entry.caseId);
    validateStringRefs(entry.externalDependencyRefs, 'externalDependencyRefs', entry.caseId, true);
    validateInputRoots(entry.requiredInputRoots, entry.caseId, entry.layer);
    if (!entry.executionRef.includes(entry.caseId) || /^[A-Za-z]:[\\/]|^\//.test(entry.executionRef)) {
      throw new Error(`unsafe executionRef for ${entry.caseId}`);
    }
    if (executionRefs.has(entry.executionRef)) {
      throw new Error(`duplicate executionRef for ${entry.caseId}`);
    }
    executionRefs.add(entry.executionRef);
    if (number <= 111 || (number >= 120 && number <= 122)) {
      if (sourceRefs.has(entry.sourceCaseRef)) {
        throw new Error(`duplicate sourceCaseRef for ${entry.caseId}`);
      }
      sourceRefs.add(entry.sourceCaseRef);
    }
  });

  return input;
}

const deferredKeys = ['coverageId', 'stage', 'owner', 'safeReason', 'activationCondition'] as const;

export function validateDeferredCoverage(input: readonly DeferredCoverageEntry[]): readonly DeferredCoverageEntry[] {
  if (!Array.isArray(input)) {
    throw new Error('deferred coverage must be an array');
  }
  const ids = new Set<string>();
  for (const entry of input) {
    if (!isPlainObject(entry) || !hasExactKeys(entry as unknown as Record<string, unknown>, deferredKeys)) {
      throw new Error('invalid deferred coverage shape');
    }
    if (/^TC-SI-\d{3}$/.test(entry.coverageId) || ids.has(entry.coverageId)) {
      throw new Error(`invalid deferred coverage id: ${entry.coverageId}`);
    }
    if (entry.stage !== 'PLANNED' && entry.stage !== 'EXCLUDED') {
      throw new Error(`invalid deferred stage: ${entry.stage}`);
    }
    for (const value of [entry.coverageId, entry.owner, entry.safeReason, entry.activationCondition]) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error('deferred coverage strings must be non-empty');
      }
    }
    ids.add(entry.coverageId);
  }
  return input;
}

function validateStringRefs(value: readonly string[], field: string, caseId: string, allowEmpty = false): void {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${field} is invalid for ${caseId}`);
  }
  if (value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw new Error(`${field} contains an invalid value for ${caseId}`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${field} contains duplicates for ${caseId}`);
  }
}

function validateInputRoots(value: readonly SystemIntegrationInputRoot[], caseId: string, layer: SystemIntegrationLayer): void {
  validateStringRefs(value, 'requiredInputRoots', caseId);
  if (value.some((entry) => entry !== 'candidate' && entry !== 'external-packages')) {
    throw new Error(`invalid required input root for ${caseId}`);
  }
  const sorted = [...value].sort((left, right) => left.localeCompare(right));
  if (sorted.join('|') !== [...value].join('|')) {
    throw new Error(`required input roots must be sorted for ${caseId}`);
  }
  if (layer === 'E2E' && !value.includes('candidate')) {
    throw new Error(`E2E case must require candidate root: ${caseId}`);
  }
  if (layer === 'INTEGRATION' && !value.includes('external-packages')) {
    throw new Error(`integration case must require external packages root: ${caseId}`);
  }
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys<T extends readonly string[]>(value: Record<string, unknown>, keys: T): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

validateSystemIntegrationManifest(SYSTEM_INTEGRATION_CASES);
validateDeferredCoverage(DEFERRED_COVERAGE);
