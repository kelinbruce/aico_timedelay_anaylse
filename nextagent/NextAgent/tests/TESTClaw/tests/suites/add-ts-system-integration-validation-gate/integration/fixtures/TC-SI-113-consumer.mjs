import assert from 'node:assert/strict';

import Ajv from 'ajv/dist/ajv.js';
import { ragRetrievalResultSchema } from '@nextagent/agent-contracts/gateway';
import {
  createFetchWorkflowRemoteExecutionGateway,
  createHttpQuestionRecommendationClient,
  createHttpWorkflowRagClient,
  createReferenceRemoteQuestionRecommendationGateway,
  createReferenceRemoteRagRetrievalGateway,
  createReferenceRemoteSandboxGateway,
  createReferenceRemoteWorkflowRagGateway,
} from '@nextagent/agent-platform-gateway-remote';
import { adaptFetchWorkflowRemoteGateway } from '@nextagent/agent-workflow';

const baseUrl = process.env.TESTCLAW_LOOPBACK_BASE_URL;
assert.equal(typeof baseUrl, 'string');

const ajv = new Ajv({ allErrors: true, strict: false });
const validateRagResult = ajv.compile(ragRetrievalResultSchema);
let currentStage = 'setup';

function sandboxRequest(command) {
  return {
    tenantId: 'tenant-loopback',
    subjectId: 'subject-loopback',
    executionId: `sandbox-${command}`,
    requestRunId: 'run-loopback',
    executable: 'bash',
    command,
    args: [],
    filesystem: {
      defaultCwd: 'workspace',
      roots: [{ kind: 'workspace', logicalPath: 'workspace', physicalPath: 'sandbox-workspace', access: 'readWrite' }],
    },
    environment: {},
    timeoutMs: 1_000,
    stdoutLimitBytes: 1_024,
    stderrLimitBytes: 1_024,
  };
}

function ragRequest(query) {
  return {
    tenantId: 'tenant-loopback',
    subjectId: 'subject-loopback',
    agentId: 'agent-loopback',
    agentVersion: 'v1',
    knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
    query,
    indexes: ['ran-kb'],
    options: { topK: 2 },
  };
}

function workflowRagRequest(query) {
  return {
    ...ragRequest(query),
    indexes: [{ indexName: 'ran-kb', indexType: 'KNOWLEDGE', vsTopN: 2, filters: { region: 'east' } }],
  };
}

function workflowRequest() {
  return {
    recipeName: 'ran-diagnosis',
    recipeVersion: 'v1',
    inputText: 'diagnose radio degradation',
    inputVariables: { region: 'east', severity: 2 },
    identityContext: { tenantId: 'tenant-loopback', subjectId: 'subject-loopback', displayName: 'operator' },
    agentId: 'agent-loopback',
    agentVersion: 'v1',
    sessionId: 'session-loopback',
    requestId: 'request-loopback',
    runId: 'run-loopback',
    requestContextId: 'context-loopback',
  };
}

async function postJson(path, request, signal) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    throw new Error('remote-request-failed');
  }
  return await response.json();
}

function isSandboxResult(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const allowed = new Set([
    'executionId',
    'exitCode',
    'stdout',
    'stderr',
    'stdoutTruncated',
    'stderrTruncated',
    'timedOut',
    'durationMs',
    'safeError',
  ]);
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    typeof value.executionId === 'string' &&
    (value.exitCode === undefined || typeof value.exitCode === 'number') &&
    typeof value.stdout === 'string' &&
    typeof value.stderr === 'string' &&
    typeof value.stdoutTruncated === 'boolean' &&
    typeof value.stderrTruncated === 'boolean' &&
    typeof value.timedOut === 'boolean' &&
    typeof value.durationMs === 'number'
  );
}

function createSandboxGateway() {
  return createReferenceRemoteSandboxGateway({
    async execute(request, signal) {
      const raw = await postJson(`/sandbox?mode=${encodeURIComponent(request.command)}`, request, signal);
      if (!isSandboxResult(raw)) {
        throw new Error('remote-response-invalid');
      }
      return raw;
    },
  });
}

function createRagGateway() {
  return createReferenceRemoteRagRetrievalGateway({
    async retrieve(request, signal) {
      const raw = await postJson(`/rag?mode=${encodeURIComponent(request.query)}`, request, signal);
      if (!validateRagResult(raw)) {
        throw new Error('remote-response-invalid');
      }
      return raw;
    },
  });
}

function correlationHeaders() {
  return {
    async withIncomingCarrier(_carrier, operation) {
      return await operation();
    },
    async withExecutionRef(_ref, operation) {
      return await operation();
    },
    outboundHeaders(input = {}) {
      return {
        ...input,
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
        'x-task-event-id': 'task-loopback',
      };
    },
  };
}

function createQuestionGateway(pathSuffix = '') {
  return createReferenceRemoteQuestionRecommendationGateway(
    createHttpQuestionRecommendationClient({
      frequentHistoryEndpoint: `${baseUrl}/questions/frequent${pathSuffix}`,
      similarQuestionEndpoint: `${baseUrl}/questions/similar${pathSuffix}`,
    }),
  );
}

async function collectWorkflow(endpoint, signal) {
  const raw = createFetchWorkflowRemoteExecutionGateway({ endpoint, timeoutMs: 2_000 });
  const gateway = adaptFetchWorkflowRemoteGateway(raw);
  const items = [];
  for await (const item of gateway.execute(workflowRequest(), signal)) {
    items.push(item);
  }
  return items;
}

async function main() {
  currentStage = 'sandbox';
  const sandbox = createSandboxGateway();
  const sandboxResult = await sandbox.execute(sandboxRequest('normal'), new AbortController().signal);
  assert.equal(sandboxResult.exitCode, 0);
  await assert.rejects(sandbox.execute(sandboxRequest('extra'), new AbortController().signal));
  await assert.rejects(sandbox.execute(sandboxRequest('missing'), new AbortController().signal));
  await assert.rejects(sandbox.execute(sandboxRequest('invalid-json'), new AbortController().signal));
  await assert.rejects(sandbox.execute(sandboxRequest('http-failure'), new AbortController().signal));

  currentStage = 'rag';
  const rag = createRagGateway();
  const ragResult = await rag.retrieve(ragRequest('normal'), new AbortController().signal);
  assert.equal(ragResult.status, 'OK');
  await assert.rejects(rag.retrieve(ragRequest('extra'), new AbortController().signal));
  await assert.rejects(rag.retrieve(ragRequest('missing'), new AbortController().signal));

  currentStage = 'workflow-rag';
  const workflowRag = createReferenceRemoteWorkflowRagGateway(createHttpWorkflowRagClient(`${baseUrl}/workflow-rag`, correlationHeaders()));
  const workflowRagResult = await workflowRag.retrieve(workflowRagRequest('normal'), new AbortController().signal);
  assert.equal(workflowRagResult.status, 'OK');
  const invalidWorkflowRag = createReferenceRemoteWorkflowRagGateway(
    createHttpWorkflowRagClient(`${baseUrl}/workflow-rag?mode=extra`, correlationHeaders()),
  );
  await assert.rejects(invalidWorkflowRag.retrieve(workflowRagRequest('extra'), new AbortController().signal));

  currentStage = 'question-recommendation';
  const questions = createQuestionGateway();
  currentStage = 'question-frequent';
  const frequent = await questions.listFrequentHistoryQuestions({
    tenantId: 'tenant-loopback',
    subjectId: 'subject-loopback',
    agentId: 'agent-loopback',
    limit: 2,
    locale: 'zh-CN',
  });
  assert.deepEqual(frequent, { questions: [{ content: 'recent alarm', frequency: 3 }] });
  currentStage = 'question-similar';
  const similar = await questions.recommendSimilarPresetQuestions({
    tenantId: 'tenant-loopback',
    subjectId: 'subject-loopback',
    agentId: 'agent-loopback',
    query: 'radio alarm',
    limit: 2,
    product: 'RAN',
    domain: 'radio',
    scene: 'diagnosis',
  });
  assert.deepEqual(similar, { questions: [{ questionId: 'preset-1', content: 'inspect radio cells' }] });
  currentStage = 'question-invalid';
  const invalidQuestion = await createQuestionGateway('?mode=invalid').listFrequentHistoryQuestions({
    tenantId: 'tenant-loopback',
    subjectId: 'subject-loopback',
    agentId: 'agent-loopback',
    limit: 1,
  });
  assert.equal(invalidQuestion.code, 'QUESTION_RECOMMENDATION_INVALID_PROVIDER_RESULT');
  currentStage = 'question-failure';
  const unavailableQuestion = await createQuestionGateway('?mode=http-failure').recommendSimilarPresetQuestions({
    tenantId: 'tenant-loopback',
    subjectId: 'subject-loopback',
    agentId: 'agent-loopback',
    query: 'radio alarm',
    limit: 1,
  });
  assert.equal(unavailableQuestion.code, 'QUESTION_RECOMMENDATION_UNAVAILABLE');

  currentStage = 'question-cancel';
  const questionAbort = new AbortController();
  const canceledQuestionPromise = createQuestionGateway('?mode=delay').recommendSimilarPresetQuestions(
    {
      tenantId: 'tenant-loopback',
      subjectId: 'subject-loopback',
      agentId: 'agent-loopback',
      query: 'radio alarm',
      limit: 1,
    },
    questionAbort.signal,
  );
  setTimeout(() => questionAbort.abort(), 25);
  const canceledQuestion = await canceledQuestionPromise;
  assert.equal(canceledQuestion.code, 'QUESTION_RECOMMENDATION_CANCELED');

  currentStage = 'workflow-execution';
  const workflowItems = await collectWorkflow(baseUrl, new AbortController().signal);
  assert.deepEqual(
    workflowItems.map((item) => item.kind),
    ['event', 'result'],
  );
  const invalidWorkflowItems = await collectWorkflow(`${baseUrl}/invalid`, new AbortController().signal);
  assert.equal(invalidWorkflowItems[0].kind, 'failure');
  assert.equal(invalidWorkflowItems[0].reasonCode, 'WORKFLOW_REMOTE_INVALID_RESPONSE');
  const failedWorkflowItems = await collectWorkflow(`${baseUrl}/failure`, new AbortController().signal);
  assert.equal(failedWorkflowItems[0].kind, 'failure');
  assert.equal(failedWorkflowItems[0].message, 'Remote workflow execution failed safely.');
  assert.equal(JSON.stringify(failedWorkflowItems).includes('remote-canary'), false);

  const workflowAbort = new AbortController();
  const canceledWorkflowPromise = collectWorkflow(`${baseUrl}/delay`, workflowAbort.signal);
  setTimeout(() => workflowAbort.abort(), 25);
  const canceledWorkflowItems = await canceledWorkflowPromise;
  assert.equal(canceledWorkflowItems[0].kind, 'failure');
  assert.equal(canceledWorkflowItems[0].reasonCode, 'WORKFLOW_REMOTE_TIMEOUT');

  process.stdout.write(
    `${JSON.stringify({
      cancellationObserved: true,
      questionRecommendationValidated: true,
      ragValidated: true,
      safeFailureMapped: true,
      sandboxValidated: true,
      workflowInputSeparated: true,
      workflowRagValidated: true,
    })}\n`,
  );
}

await main().catch(() => {
  process.stdout.write(`${JSON.stringify({ failedStage: currentStage })}\n`);
  process.exitCode = 1;
});
