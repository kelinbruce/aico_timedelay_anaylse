const terminalEventTypes = new Set(['REQUEST_COMPLETED', 'REQUEST_FAILED', 'REQUEST_CANCELED', 'REQUEST_SUPERSEDED']);
const safeEvidenceKeys = new Set(['scenario', 'sessionId', 'requestId', 'runId', 'eventType', 'code', 'terminalStatus', 'historyEventTypes']);

export function parseSseFrames(input) {
  return input
    .replaceAll('\r\n', '\n')
    .split('\n\n')
    .flatMap((frame) => {
      const lines = frame.split('\n').filter((line) => line.length > 0 && !line.startsWith(':'));
      const event = lines
        .find((line) => line.startsWith('event:'))
        ?.slice('event:'.length)
        .trim();
      const dataText = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart())
        .join('\n');
      if (event === undefined || dataText.length === 0) {
        return [];
      }
      return [{ event, data: JSON.parse(dataText) }];
    });
}

export function selectRunEvents(events, runId) {
  return events.filter((event) => event?.runId === runId);
}

export function requireEvent(events, runId, eventType) {
  const event = selectRunEvents(events, runId).find((candidate) => candidate?.eventType === eventType);
  if (event === undefined) {
    throw new Error(`${eventType} was not observed for run ${runId}.`);
  }
  return event;
}

export function isTerminalEventType(eventType) {
  return terminalEventTypes.has(eventType);
}

export function safeEvidence(input) {
  const evidence = Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) =>
        safeEvidenceKeys.has(key) &&
        (typeof value === 'string' || (key === 'historyEventTypes' && Array.isArray(value) && value.every((entry) => typeof entry === 'string'))),
    ),
  );
  if (Array.isArray(input.rounds)) {
    evidence.rounds = input.rounds.flatMap((round) => {
      if (round === null || typeof round !== 'object') {
        return [];
      }
      const safeRound = Object.fromEntries(
        ['requestId', 'runId', 'terminalStatus'].flatMap((key) => (typeof round[key] === 'string' ? [[key, round[key]]] : [])),
      );
      return Object.keys(safeRound).length === 0 ? [] : [safeRound];
    });
  }
  return evidence;
}

export async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const text = await response.text();
  const payload = text.length === 0 ? undefined : JSON.parse(text);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}: ${safeHttpError(payload)}`);
  }
  return payload;
}

export async function readSseRun(baseUrl, sessionId, runId, timeoutMs = 180_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(
    new URL(`/api/v1/sessions/${encodeURIComponent(sessionId)}/stream?lastSeenSequence=0&runId=${encodeURIComponent(runId)}`, baseUrl),
    { headers: { accept: 'text/event-stream' }, signal: controller.signal },
  );
  if (!response.ok || response.body === null) {
    clearTimeout(timeout);
    throw new Error(`SSE stream failed with HTTP ${response.status}.`);
  }

  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');
      const boundary = buffer.lastIndexOf('\n\n');
      if (boundary >= 0) {
        const complete = buffer.slice(0, boundary + 2);
        buffer = buffer.slice(boundary + 2);
        for (const frame of parseSseFrames(complete)) {
          if (frame.data?.runId !== runId) {
            continue;
          }
          events.push(frame.data);
          if (isTerminalEventType(frame.data.eventType)) {
            return events;
          }
        }
      }
      if (done) {
        break;
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  throw new Error(`SSE stream ended without a terminal event for run ${runId}.`);
}

export async function loadAllRunEvents(baseUrl, sessionId, runId) {
  const events = [];
  let afterSequence = 0;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await requestJson(
      baseUrl,
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/events?afterSequence=${afterSequence}&limit=100`,
    );
    if (page?.availability !== 'AVAILABLE' || !Array.isArray(page.events)) {
      throw new Error(`Run history is unavailable for run ${runId}.`);
    }
    events.push(...page.events);
    if (typeof page.nextAfterSequence !== 'number') {
      return events;
    }
    afterSequence = page.nextAfterSequence;
  }
  throw new Error(`Run history exceeded the verification page limit for run ${runId}.`);
}

function safeHttpError(payload) {
  if (payload !== null && typeof payload === 'object') {
    const code = typeof payload.code === 'string' ? payload.code : undefined;
    const message = typeof payload.message === 'string' ? payload.message : undefined;
    if (code !== undefined || message !== undefined) {
      return [code, message].filter(Boolean).join(': ');
    }
  }
  return 'request failed';
}
