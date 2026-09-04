const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildMockRequestPlan, resolveMockRequestMode, StreamEventType } = require('../data/events');
const { getRunEvents, replayBuffer } = require('../data/store');
const { parseInlineMockControls } = require('../routes/requests');
const { logError, logInfo, logWarning } = require('../diagnostics');

function buildContractPlan() {
  return buildMockRequestPlan('session-process-activity', 'request-process-activity', {
    inputText: '检查骨干网络延迟',
  });
}

test('marks the final thinking snapshot completed before capability execution starts', () => {
  const plan = buildContractPlan();
  const thinkingEvents = plan.events.filter((event) => event.eventType === StreamEventType.LLM_THINKING_DELTA);

  assert.ok(thinkingEvents.length > 0);
  assert.equal(thinkingEvents.at(-1).payload.metadata.completed, true);
});

test('uses one toolCallId across capability start, result, and completion events', () => {
  const plan = buildContractPlan();
  const capabilityEvents = plan.events.filter(
    (event) =>
      event.eventType === StreamEventType.CAPABILITY_STARTED ||
      event.eventType === StreamEventType.CAPABILITY_RESULT_DELTA ||
      event.eventType === StreamEventType.CAPABILITY_COMPLETED,
  );
  const toolCallIds = new Set(capabilityEvents.map((event) => event.payload.toolCallId));

  assert.ok(capabilityEvents.length > 2);
  assert.equal(toolCallIds.size, 1);
  assert.equal([...toolCallIds][0], 'tool-request-process-activity-network-diagnostic');
});

test('parses the process-handoff directive into an internal request mode', () => {
  assert.equal(typeof parseInlineMockControls, 'function');

  const parsed = parseInlineMockControls('[mock:process-handoff delay=30 terminal-delay=2500] 检查骨干网络延迟');

  assert.equal(parsed.inputText, '检查骨干网络延迟');
  assert.deepEqual(parsed.controls, {
    requestMode: 'process-handoff',
    delayMs: 30,
    terminalDelayMs: 2500,
  });
});

test('parses the capability presentation directive into an isolated request mode', () => {
  const parsed = parseInlineMockControls('[mock:capability-presentation delay=200 terminal-delay=3000] 验证工具结果展示策略');

  assert.equal(parsed.inputText, '验证工具结果展示策略');
  assert.deepEqual(parsed.controls, {
    requestMode: 'capability-presentation',
    delayMs: 200,
    terminalDelayMs: 3000,
  });
});

test('emits status, summary, ordinary detail, and truncated detail without raw result data', () => {
  const plan = buildMockRequestPlan('session-presentation', 'request-presentation', {
    inputText: '验证工具结果展示策略',
    mockControls: { requestMode: 'capability-presentation' },
  });
  const results = plan.events.filter((event) => event.eventType === StreamEventType.CAPABILITY_RESULT_DELTA);

  assert.equal(plan.mode, 'capability-presentation');
  assert.equal(results.length, 10);

  assert.equal(results[0].payload.capabilityId, 'CustomNetworkProbe');
  assert.equal(results[0].payload.resultPresentationLevel, 'STATUS_ONLY');
  assert.equal(results[0].payload.safeSummary, undefined);
  assert.equal(results[0].payload.safeResult, undefined);
  assert.equal(results[0].payload.content, '');

  assert.equal(results[1].payload.capabilityId, 'Read');
  assert.equal(results[1].payload.resultPresentationLevel, 'SUMMARY');
  assert.equal(results[1].payload.safeSummaryCode, 'CAPABILITY_RESULT_FILE_READ');
  assert.deepEqual(results[1].payload.safeSummaryArgs, { filePath: 'workspace/backbone-latency.csv' });
  assert.equal(results[1].payload.safeSummary, 'Read workspace/backbone-latency.csv and returned its content.');
  assert.equal(results[1].payload.safeResult, undefined);
  assert.equal(results[1].payload.content, '');

  assert.equal(results[2].payload.capabilityId, 'Rag');
  assert.equal(results[2].payload.resultPresentationLevel, 'SUMMARY');
  assert.equal(results[2].payload.safeSummaryCode, 'CAPABILITY_RESULT_RAG_RETRIEVAL');
  assert.deepEqual(results[2].payload.safeSummaryArgs, { totalCount: 3 });
  assert.equal(results[2].payload.safeResult, undefined);

  assert.equal(results[3].payload.capabilityId, 'Bash');
  assert.equal(results[3].payload.resultPresentationLevel, 'DETAIL');
  assert.deepEqual(results[3].payload.safeResult, {
    kind: 'commandOutput',
    exitCode: 0,
    stdoutPreview: 'Core-Router-01 latency=18ms packet-loss=0.01%\nEdge-Router-02 latency=63ms packet-loss=0.18%',
    stderrPreview: '',
    stdoutTruncated: false,
    stderrTruncated: false,
  });
  assert.equal(results[3].payload.content, results[3].payload.text);
  assert.match(results[3].payload.content, /Edge-Router-02/);

  assert.equal(results[4].payload.capabilityId, 'Bash');
  assert.deepEqual(results[4].payload.safeResult, {
    kind: 'commandOutput',
    exitCode: 0,
    stdoutPreview: 'Core-Router-01 latency=18ms packet-loss=0.01%\nEdge-Router-02 latency=63ms packet-loss=0.18%\n...',
    stderrPreview: '',
    stdoutTruncated: true,
    stderrTruncated: false,
  });
  assert.equal(results[4].payload.content, results[4].payload.text);
  assert.doesNotMatch(JSON.stringify(plan.events), /SECRET-CAPABILITY-RESULT-MUST-NOT-LEAK/);

  const completedCapabilities = plan.events
    .filter((event) => event.eventType === StreamEventType.CAPABILITY_COMPLETED)
    .map((event) => event.payload.capabilityId);
  assert.deepEqual(completedCapabilities, [
    'CustomNetworkProbe',
    'Read',
    'Rag',
    'Bash',
    'Bash',
    'Write',
    'Agent',
    'CustomConflictProbe',
    'CustomUnknownProbe',
    'Read',
  ]);
  assert.ok(
    plan.events
      .filter((event) => event.eventType === StreamEventType.CAPABILITY_COMPLETED)
      .every((event) => typeof event.payload.resultPresentationLevel === 'string'),
  );
  assert.ok(plan.events.some((event) => event.eventType === StreamEventType.LLM_CONTENT_DELTA && event.payload.final === true));
});

test('restores capability presentation projections from persisted completion events', () => {
  const sessionId = 'session-presentation-history';
  const requestId = 'request-presentation-history';
  const plan = buildMockRequestPlan(sessionId, requestId, {
    inputText: '验证工具结果展示策略',
    mockControls: { requestMode: 'capability-presentation' },
  });
  const liveResultsByToolCallId = new Map(
    plan.events.filter((event) => event.eventType === StreamEventType.CAPABILITY_RESULT_DELTA).map((event) => [event.payload.toolCallId, event]),
  );

  for (const event of plan.events) {
    replayBuffer.append(sessionId, event);
  }

  const page = getRunEvents(sessionId, requestId, {
    afterSequence: 0,
    limit: 1000,
  });
  assert.equal(page?.availability, 'AVAILABLE');
  assert.ok(page?.events.every((event) => event.eventType !== StreamEventType.CAPABILITY_RESULT_DELTA));

  const completions = page?.events.filter((event) => event.eventType === StreamEventType.CAPABILITY_COMPLETED) ?? [];
  assert.equal(completions.length, liveResultsByToolCallId.size);
  for (const completion of completions) {
    const liveResult = liveResultsByToolCallId.get(completion.payload.toolCallId);
    assert.ok(liveResult);
    assert.deepEqual(pickCapabilityPresentation(completion.payload), pickCapabilityPresentation(liveResult.payload));
  }
  assert.doesNotMatch(JSON.stringify(page), /SECRET-CAPABILITY-RESULT-MUST-NOT-LEAK/);
});

test('exercises factual failure projections and a real step after failure without protocol prose', () => {
  const plan = buildMockRequestPlan('session-presentation-failure', 'request-presentation-failure', {
    inputText: '验证工具失败展示策略',
    mockControls: { requestMode: 'capability-presentation' },
  });
  const results = plan.events.filter((event) => event.eventType === StreamEventType.CAPABILITY_RESULT_DELTA);
  const failures = results.filter((event) => event.payload.status === 'FAILED');

  assert.deepEqual(
    failures.map((event) => ({
      capabilityId: event.payload.capabilityId,
      safeErrorCode: event.payload.safeErrorCode,
      safeErrorCategory: event.payload.safeErrorCategory,
      safeSummaryCode: event.payload.safeSummaryCode,
      safeSummaryArgs: event.payload.safeSummaryArgs,
      resultPresentationLevel: event.payload.resultPresentationLevel,
    })),
    [
      {
        capabilityId: 'Write',
        safeErrorCode: 'WRITE_REQUIRES_FULL_READ',
        safeErrorCategory: 'CONFLICT',
        safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_FULL_READ_REQUIRED',
        safeSummaryArgs: {},
        resultPresentationLevel: 'STATUS_ONLY',
      },
      {
        capabilityId: 'Agent',
        safeErrorCode: 'PLATFORM_UNSUPPORTED',
        safeErrorCategory: 'UNAVAILABLE',
        safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_PLATFORM_UNSUPPORTED',
        safeSummaryArgs: {},
        resultPresentationLevel: 'STATUS_ONLY',
      },
      {
        capabilityId: 'CustomConflictProbe',
        safeErrorCode: 'UNKNOWN_UPSTREAM_FAILURE',
        safeErrorCategory: 'CONFLICT',
        safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_CONFLICT',
        safeSummaryArgs: {},
        resultPresentationLevel: 'STATUS_ONLY',
      },
      {
        capabilityId: 'CustomUnknownProbe',
        safeErrorCode: undefined,
        safeErrorCategory: undefined,
        safeSummaryCode: 'CAPABILITY_RESULT_FAILURE',
        safeSummaryArgs: {},
        resultPresentationLevel: 'STATUS_ONLY',
      },
    ],
  );

  const lastResult = results.at(-1);
  assert.equal(lastResult.payload.capabilityId, 'Read');
  assert.equal(lastResult.payload.status, 'SUCCEEDED');
  assert.equal(lastResult.payload.safeSummaryCode, 'CAPABILITY_RESULT_FILE_READ');
  assert.ok(plan.events.indexOf(lastResult) > plan.events.indexOf(failures.at(-1)));
  assert.doesNotMatch(
    JSON.stringify(plan.events.map((event) => event.payload)),
    /CAPABILITY_STARTED|CAPABILITY_COMPLETED|retry now|\/private\/secret|raw exception/,
  );
});

test('parses the PIU process detail directive into an isolated request mode', () => {
  const parsed = parseInlineMockControls(
    '[mock:piu-process-detail delay=120 pause-after-process=3 pause-ms=5000 terminal-delay=10000] 检查骨干网络延迟',
  );

  assert.equal(parsed.inputText, '检查骨干网络延迟');
  assert.deepEqual(parsed.controls, {
    requestMode: 'piu-process-detail',
    delayMs: 120,
    pauseAfterProcessDeltas: 3,
    pauseMs: 5000,
    terminalDelayMs: 10000,
  });
});

function pickCapabilityPresentation(payload) {
  return {
    resultPresentationLevel: payload.resultPresentationLevel,
    safeErrorCode: payload.safeErrorCode,
    safeErrorCategory: payload.safeErrorCategory,
    failureStatus: payload.status === 'FAILED' ? 'FAILED' : undefined,
    safeSummaryCode: payload.safeSummaryCode,
    safeSummaryArgs: payload.safeSummaryArgs,
    safeSummary: payload.safeSummary,
    safeResult: payload.safeResult,
    text: payload.text,
    content: payload.content,
  };
}

test('parses the PIU answer directive into an isolated request mode', () => {
  const parsed = parseInlineMockControls('[mock:piu-answer delay=120 terminal-delay=10000] 检查骨干网络延迟');

  assert.equal(parsed.inputText, '检查骨干网络延迟');
  assert.deepEqual(parsed.controls, {
    requestMode: 'piu-answer',
    delayMs: 120,
    terminalDelayMs: 10000,
  });
});

test('places answer text, PIU, and the model summary in display order', () => {
  const plan = buildMockRequestPlan('session-piu-answer', 'request-piu-answer', {
    inputText: '检查骨干网络延迟',
    mockControls: { requestMode: 'piu-answer' },
  });
  const introIndex = plan.events.findIndex(
    (event) =>
      event.eventType === StreamEventType.TOOL_STRUCTURED_DELTA &&
      event.payload.toolEventType === 'ANSWER' &&
      event.payload.toolMessageType === 'TEXT',
  );
  const piuIndex = plan.events.findIndex(
    (event) =>
      event.eventType === StreamEventType.TOOL_STRUCTURED_DELTA &&
      event.payload.toolEventType === 'ANSWER' &&
      event.payload.toolMessageType === 'PIU',
  );
  const summaryIndex = plan.events.findIndex(
    (event) => event.eventType === StreamEventType.LLM_CONTENT_DELTA && event.payload.metadata?.streamProfile === 'piu-answer-final-summary',
  );

  assert.equal(plan.mode, 'piu-answer');
  assert.ok(introIndex >= 0);
  assert.ok(piuIndex > introIndex);
  assert.ok(summaryIndex > piuIndex);
  assert.deepEqual(plan.events[piuIndex].payload.content, {
    piuName: 'network-diagnostic',
    piuVersion: '1.0.0',
    method: 'render',
    data: {
      title: '骨干网络链路诊断',
      latencyMs: 63,
      packetLossPercent: 0.01,
      status: 'DEGRADED',
    },
  });
});

test('emits a PIU detail before later assistant output hands off visual focus', () => {
  const plan = buildMockRequestPlan('session-piu', 'request-piu', {
    inputText: '检查骨干网络延迟',
    mockControls: { requestMode: 'piu-process-detail' },
  });
  const titleIndex = plan.events.findIndex((event) => event.eventType === 'TOOL_STRUCTURED_DELTA' && event.payload.toolEventType === 'TITLE');
  const piuDetailIndex = plan.events.findIndex(
    (event) => event.eventType === 'TOOL_STRUCTURED_DELTA' && event.payload.toolEventType === 'DETAIL' && event.payload.toolMessageType === 'PIU',
  );
  const assistantOutputIndex = plan.events.findIndex(
    (event, index) => index > piuDetailIndex && event.eventType === StreamEventType.LLM_CONTENT_DELTA,
  );

  assert.equal(plan.mode, 'piu-process-detail');
  assert.ok(titleIndex >= 0);
  assert.ok(piuDetailIndex > titleIndex);
  assert.ok(assistantOutputIndex > piuDetailIndex);
  assert.equal(plan.events[titleIndex].payload.toolCallId, plan.events[piuDetailIndex].payload.toolCallId);
  assert.deepEqual(plan.events[piuDetailIndex].payload.content, {
    piuName: 'network-diagnostic',
    piuVersion: '1.0.0',
    method: 'render',
    data: {
      title: '骨干网络链路诊断',
      latencyMs: 63,
      packetLossPercent: 0.01,
      status: 'DEGRADED',
    },
  });
});

test('emits an execution explanation after thinking and immediately before its tool call', () => {
  const plan = buildMockRequestPlan('session-handoff', 'request-handoff', {
    inputText: '检查骨干网络延迟',
    mockControls: { requestMode: 'process-handoff' },
  });
  const findIndex = (predicate) => plan.events.findIndex(predicate);
  const completedExecutionExplanationIndex = findIndex(
    (event) =>
      event.eventType === StreamEventType.LLM_CONTENT_DELTA &&
      event.payload.metadata?.streamProfile === 'process-handoff-explanation' &&
      event.payload.metadata?.completed === true,
  );
  const precedingCompletedThinkingIndex = plan.events.findLastIndex(
    (event, index) =>
      index < completedExecutionExplanationIndex &&
      event.eventType === StreamEventType.LLM_THINKING_DELTA &&
      event.payload.metadata?.completed === true,
  );
  const linkedCapabilityStartedIndex = findIndex(
    (event) => event.eventType === StreamEventType.CAPABILITY_STARTED && event.payload.capabilityId === 'analyzeRouteConvergence',
  );
  const linkedCapabilityCompletedIndex = findIndex(
    (event) => event.eventType === StreamEventType.CAPABILITY_COMPLETED && event.payload.capabilityId === 'analyzeRouteConvergence',
  );
  const finalAnswerIndex = findIndex(
    (event) => event.eventType === StreamEventType.LLM_CONTENT_DELTA && event.payload.metadata?.streamProfile === 'process-handoff-final',
  );

  assert.equal(plan.mode, 'process-handoff');
  assert.equal(resolveMockRequestMode('检查骨干网络延迟', { requestMode: 'process-handoff' }), 'process-handoff');
  assert.ok(precedingCompletedThinkingIndex >= 0);
  assert.ok(completedExecutionExplanationIndex > precedingCompletedThinkingIndex);
  assert.equal(linkedCapabilityStartedIndex, completedExecutionExplanationIndex + 1);
  assert.ok(linkedCapabilityCompletedIndex > linkedCapabilityStartedIndex);
  assert.ok(finalAnswerIndex > linkedCapabilityCompletedIndex);

  const executionExplanationEvents = plan.events.filter(
    (event) => event.eventType === StreamEventType.LLM_CONTENT_DELTA && event.payload.metadata?.streamProfile === 'process-handoff-explanation',
  );
  assert.ok(executionExplanationEvents.length > 1);
  assert.equal(executionExplanationEvents.at(-1).payload.stepId, 'process-handoff-route-convergence');
  assert.equal(executionExplanationEvents.at(-1).payload.metadata?.completed, true);
  assert.equal(executionExplanationEvents.at(-1).payload.final, undefined);

  const finalAnswerEvents = plan.events.filter(
    (event) => event.eventType === StreamEventType.LLM_CONTENT_DELTA && event.payload.metadata?.streamProfile === 'process-handoff-final',
  );
  assert.ok(finalAnswerEvents.length > 1);
  assert.equal(finalAnswerEvents.at(-1).payload.final, true);
  assert.equal(finalAnswerEvents.at(-1).payload.metadata?.completed, undefined);

  const finalThinkingEvents = plan.events.filter(
    (event) => event.eventType === StreamEventType.LLM_THINKING_DELTA && event.payload.metadata?.completed === true,
  );
  assert.equal(finalThinkingEvents.length, 2);

  const capabilityToolCallIds = plan.events
    .filter((event) => event.eventType === StreamEventType.CAPABILITY_STARTED)
    .map((event) => event.payload.toolCallId);
  assert.deepEqual(capabilityToolCallIds, ['tool-request-handoff-link-metrics', 'tool-request-handoff-route-convergence']);
});

test('makes completed process content available through run history after live delivery', () => {
  const sessionId = 'session-process-content-history';
  const requestId = 'request-process-content-history';
  const runId = 'run-process-content-history';
  const event = {
    eventId: 'event-process-content-history',
    sessionId,
    requestId,
    runId,
    requestContextId: requestId,
    sequence: 3,
    eventType: StreamEventType.LLM_CONTENT_DELTA,
    timelineEventRef: 'timeline-process-content-history',
    payload: {
      stepId: 'process-content-history-step',
      text: '已完成基础链路检查，继续核查路由收敛记录。',
      contentType: 'MARKDOWN',
      metadata: {
        accumulated: true,
        completed: true,
      },
    },
    transportHints: [],
    createdAt: Date.now(),
  };

  replayBuffer.append(sessionId, event);

  const page = getRunEvents(sessionId, runId, {
    afterSequence: 0,
    limit: 1000,
  });
  assert.equal(page?.availability, 'AVAILABLE');
  assert.deepEqual(page?.events, [event]);
});

test('routes runtime diagnostics through the mock server reporter and keeps console out of runtime modules', (t) => {
  const calls = [];
  const log = t.mock.method(console, 'log', (...args) => calls.push(['info', ...args]));
  const warning = t.mock.method(console, 'warn', (...args) => calls.push(['warning', ...args]));
  const error = t.mock.method(console, 'error', (...args) => calls.push(['error', ...args]));

  logInfo('server listening', { port: 3001 });
  logWarning('pending input missing', 'input-1');
  const errorDetail = { reason: 'invalid envelope' };
  logError('request failed', errorDetail);

  assert.deepEqual(calls, [
    ['info', 'server listening', { port: 3001 }],
    ['warning', 'pending input missing', 'input-1'],
    ['error', 'request failed', errorDetail],
  ]);
  assert.equal(log.mock.callCount(), 1);
  assert.equal(warning.mock.callCount(), 1);
  assert.equal(error.mock.callCount(), 1);

  const root = path.resolve(__dirname, '..');
  const runtimeFiles = [path.join(root, 'server.js')];
  for (const directory of ['routes', 'data']) {
    collectJavaScriptFiles(path.join(root, directory), runtimeFiles);
  }
  const offenders = runtimeFiles
    .filter((file) => path.basename(file) !== 'diagnostics.js')
    .filter((file) => /\bconsole\.[A-Za-z]+\s*\(/u.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file));

  assert.deepEqual(offenders, []);
});

function collectJavaScriptFiles(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJavaScriptFiles(entryPath, files);
    } else if (entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }
}
