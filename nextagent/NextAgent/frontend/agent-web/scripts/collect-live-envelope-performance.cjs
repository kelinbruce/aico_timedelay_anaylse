const { chromium } = require('playwright');

const baseURL = process.argv[2];
const label = process.argv[3] || 'trace';
const liveBatchCount = Number.parseInt(process.argv[4] ?? '40', 10);
if (!baseURL) {
  throw new Error('Usage: node scripts/collect-live-envelope-performance.cjs <base-url> [label] [live-batch-count]');
}
if (!Number.isInteger(liveBatchCount) || liveBatchCount <= 0) {
  throw new Error('live-batch-count must be a positive integer');
}

const sessionId = 'performance-session';
const historicalTurnCount = 200;
const deltasPerBatch = 5;

function historyMessage(turnIndex, role) {
  const sequence = turnIndex * 2 + (role === 'USER' ? 1 : 2);
  const rootMessageId = `history-root-${turnIndex}`;
  return {
    messageId: `${rootMessageId}-${role.toLowerCase()}`,
    sessionId,
    requestId: rootMessageId,
    runId: role === 'USER' ? null : `history-run-${turnIndex}`,
    requestContextId: rootMessageId,
    rootMessageId,
    role,
    sequence,
    content: role === 'USER' ? `historical question ${turnIndex}` : `historical answer ${turnIndex}`,
    contentType: role === 'USER' ? 'PLAIN_TEXT' : 'MARKDOWN',
    metadata: role === 'ASSISTANT' ? { status: 'COMPLETED' } : {},
    createdAt: new Date(Date.parse('2026-07-22T00:00:00.000Z') + sequence * 1000).toISOString(),
    visible: true,
  };
}

async function readTraceStream(client, handle) {
  let trace = '';
  while (true) {
    const chunk = await client.send('IO.read', { handle });
    trace += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data;
    if (chunk.eof) break;
  }
  await client.send('IO.close', { handle });
  return JSON.parse(trace);
}

function summarizeTrace(trace) {
  const completeEvents = trace.traceEvents.filter((event) => event.ph === 'X' && Number(event.dur || 0) > 0);
  const completeEventTotals = new Map();
  for (const event of completeEvents) {
    const current = completeEventTotals.get(event.name) ?? { count: 0, durationMs: 0, maxMs: 0 };
    const durationMs = Number(event.dur || 0) / 1000;
    current.count += 1;
    current.durationMs += durationMs;
    current.maxMs = Math.max(current.maxMs, durationMs);
    completeEventTotals.set(event.name, current);
  }
  const sampledFrames = new Map();
  let cpuSampleCount = 0;
  for (const event of trace.traceEvents) {
    if (event.name !== 'ProfileChunk') continue;
    const profile = event.args?.data?.cpuProfile;
    const nodes = new Map((profile?.nodes ?? []).map((node) => [node.id, node.callFrame]));
    for (const sample of profile?.samples ?? []) {
      cpuSampleCount += 1;
      const frame = nodes.get(sample);
      if (!frame) continue;
      const key = `${frame.functionName || '(anonymous)'} @ ${frame.url || '(native)'}`;
      sampledFrames.set(key, (sampledFrames.get(key) ?? 0) + 1);
    }
  }
  const relevantFrames = [...sampledFrames.entries()]
    .filter(([key]) => /agent-web|conversationStore|ChatPage|buildSessionProjection|buildTurnBlocks|TurnBlock/.test(key))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([frame, samples]) => ({ frame, samples }));
  return {
    cpuSampleCount,
    topCompleteEvents: [...completeEventTotals.entries()]
      .sort((left, right) => right[1].durationMs - left[1].durationMs)
      .slice(0, 8)
      .map(([name, value]) => ({
        name,
        count: value.count,
        durationMs: Number(value.durationMs.toFixed(2)),
        maxMs: Number(value.maxMs.toFixed(2)),
      })),
    relevantFrames,
  };
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  let releaseHeldStream;
  const heldStream = new Promise((resolve) => {
    releaseHeldStream = resolve;
  });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [{ sessionId, displayTitle: 'Performance session', lastActivityAt: '2026-07-22T04:00:00.000Z' }],
          offset: 0,
          limit: 50,
          hasMore: false,
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/conversation`) {
      const items = Array.from({ length: historicalTurnCount }, (_, index) => [
        historyMessage(index, 'USER'),
        historyMessage(index, 'ASSISTANT'),
      ]).flat();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, items, nextCursor: null, newerCursor: null, activeRun: null }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/conversation/preview`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      await heldStream;
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
  });

  await page.goto(`${baseURL}/#/session/${sessionId}`);
  await page.getByText('historical answer 199', { exact: true }).waitFor();
  await page.waitForFunction((expected) => document.querySelectorAll('[data-testid="turn-block"]').length === expected, historicalTurnCount);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const client = await context.newCDPSession(page);
  await client.send('Tracing.start', {
    categories: 'devtools.timeline,v8.execute,disabled-by-default-v8.cpu_profiler,disabled-by-default-v8.cpu_profiler.hires',
    options: 'sampling-frequency=1000',
    transferMode: 'ReturnAsStream',
  });
  const startedAt = Date.now();
  await page.evaluate(
    async ({ id, batchCount, batchSize }) => {
      const loadedModuleUrl = (suffix) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => new URL(name).pathname.endsWith(suffix)) ?? suffix;
      const { useConversationStore } = await import(loadedModuleUrl('/src/state/conversationStore.ts'));
      const { useRequestStore } = await import(loadedModuleUrl('/src/state/requestStore.ts'));
      const createdAt = '2026-07-22T05:00:00.000Z';
      const makeEnvelope = (sequence, eventType, payload, transportHints = ['SSE']) => ({
        eventId: `performance-live-${sequence}`,
        sessionId: id,
        requestId: 'live-root',
        runId: 'live-run',
        requestContextId: 'live-run',
        rootMessageId: 'live-root',
        sequence,
        eventType,
        timelineEventRef: `performance-timeline-${sequence}`,
        transportHints,
        payload: { rootMessageId: 'live-root', ...payload },
        createdAt,
      });
      useRequestStore.setState({
        requestStatus: 'accepted',
        activeRequestSessionId: id,
        activeRequestRootMessageId: 'live-root',
      });
      useConversationStore.getState().setRuntimeState(id, {
        activeRootMessageId: 'live-root',
        activeRun: { requestId: 'live-root', runId: 'live-run', status: 'EXECUTING' },
      });
      useConversationStore.getState().appendEnvelope(
        id,
        makeEnvelope(
          1,
          'REQUEST_ACCEPTED',
          {
            role: 'USER',
            content: 'latest performance question',
            messageId: 'live-root',
          },
          ['local-optimistic'],
        ),
      );
      let sequence = 2;
      for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
        await new Promise(requestAnimationFrame);
        const batch = Array.from({ length: batchSize }, (_, index) => {
          const currentSequence = sequence + index;
          return makeEnvelope(currentSequence, 'LLM_CONTENT_DELTA', {
            role: 'ASSISTANT',
            delta: ` token-${currentSequence}`,
            text: ` token-${currentSequence}`,
            contentType: 'PLAIN_TEXT',
            metadata: { accumulated: false },
          });
        });
        sequence += batchSize;
        useConversationStore.getState().appendEnvelopes(id, batch);
      }
    },
    { id: sessionId, batchCount: liveBatchCount, batchSize: deltasPerBatch },
  );
  const lastDeltaSequence = liveBatchCount * deltasPerBatch + 1;
  const lastDeltaToken = `token-${lastDeltaSequence}`;
  await page.getByText(lastDeltaToken, { exact: false }).waitFor();
  await page.evaluate(
    async ({ id, sequence }) => {
      const conversationStoreUrl =
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => new URL(name).pathname.endsWith('/src/state/conversationStore.ts')) ?? '/src/state/conversationStore.ts';
      const { useConversationStore } = await import(conversationStoreUrl);
      useConversationStore.getState().appendEnvelope(id, {
        eventId: `performance-live-${sequence}`,
        sessionId: id,
        requestId: 'live-root',
        runId: 'live-run',
        requestContextId: 'live-run',
        rootMessageId: 'live-root',
        sequence,
        eventType: 'REQUEST_COMPLETED',
        timelineEventRef: `performance-timeline-${sequence}`,
        transportHints: ['SSE'],
        payload: { rootMessageId: 'live-root', status: 'COMPLETED' },
        createdAt: '2026-07-22T05:00:00.000Z',
      });
    },
    { id: sessionId, sequence: lastDeltaSequence + 1 },
  );
  await page.waitForFunction((expectedToken) => {
    const lastBlock = document.querySelectorAll('[data-testid="turn-block"]');
    return lastBlock.length === 201 && document.body.textContent?.includes(expectedToken);
  }, lastDeltaToken);
  const elapsedMs = Date.now() - startedAt;

  const complete = new Promise((resolve) => client.once('Tracing.tracingComplete', resolve));
  await client.send('Tracing.end');
  const { stream } = await complete;
  const trace = await readTraceStream(client, stream);
  const visibleTurnCount = await page.locator('[data-testid="turn-block"]').count();

  console.log(
    JSON.stringify({
      label,
      chromiumVersion: browser.version(),
      fixture: { historicalTurnCount, liveBatchCount, deltasPerBatch, liveEnvelopeCount: liveBatchCount * deltasPerBatch + 2 },
      elapsedMs,
      visibleTurnCount,
      trace: summarizeTrace(trace),
    }),
  );
  releaseHeldStream();
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
