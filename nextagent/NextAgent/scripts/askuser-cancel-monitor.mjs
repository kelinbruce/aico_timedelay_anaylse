#!/usr/bin/env node
/**
 * Cancel Monitor (multi-session, model-invocation trigger)
 *
 * Polls all sessions every 1s. For any session with hasInFlightRequest=true
 * that we're not already watching, connects to its SSE stream. When a
 * model-invocation event (LLM_THINKING_DELTA or LLM_CONTENT_DELTA) is
 * detected, immediately sends cancel.
 *
 * Usage:
 *   node scripts/askuser-cancel-monitor.mjs [sessionId]
 *
 * Env:
 *   BASE_URL  (default http://127.0.0.1:3000)
 *   DELAY_MS  (default 0 — cancel immediately on model call)
 */

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const DELAY_MS = Number.parseInt(process.env.DELAY_MS ?? '0', 10);
const POLL_INTERVAL_MS = 1000;
const FIXED_SESSION_ID = process.argv[2] ?? undefined;

const monitoredSessions = new Map();
const armedSessions = new Set();

function ts() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}
function log(tag, msg) {
  console.log(`[${ts()}] [${tag}] ${msg}`);
}

async function listSessions() {
  const res = await fetch(`${BASE_URL}/api/v1/sessions`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.entries ?? [];
}

async function fetchLatestRequestId(sid) {
  const res = await fetch(`${BASE_URL}/api/v1/sessions/${sid}/conversation?limit=5`);
  if (!res.ok) return null;
  const page = await res.json();
  const items = page.items ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]?.requestId) return items[i].requestId;
  }
  return null;
}

async function sendCancel(sid, requestId) {
  const idempotencyKey = crypto.randomUUID();
  log('CANCEL', `sessionId=${sid} requestId=${requestId}`);
  const res = await fetch(`${BASE_URL}/api/v1/sessions/${sid}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedLatestRequestId: requestId,
      action: 'CANCEL',
      idempotencyKey,
    }),
  });
  const body = await res.text();
  if (res.ok) {
    log('CANCEL', `OK ${res.status}: ${body.slice(0, 200)}`);
  } else {
    log('CANCEL', `FAILED ${res.status}: ${body.slice(0, 300)}`);
  }
}

function extractSseData(frame) {
  const lines = frame.split(/\r?\n/);
  const dataParts = [];
  for (const line of lines) {
    if (line.startsWith('data:')) dataParts.push(line.slice(5).trimStart());
  }
  return dataParts.length > 0 ? dataParts.join('\n') : null;
}

async function connectStream(sid) {
  log('STREAM', `Connecting to ${sid} ...`);
  const url = `${BASE_URL}/api/v1/sessions/${sid}/stream`;
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'text/event-stream' } });
  } catch (err) {
    log('STREAM', `Fetch error for ${sid}: ${err.message}`);
    monitoredSessions.delete(sid);
    return;
  }
  if (!res.ok || !res.body) {
    log('STREAM', `Connect failed for ${sid}: ${res.status}`);
    monitoredSessions.delete(sid);
    return;
  }
  log('STREAM', `Connected to ${sid}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  monitoredSessions.set(sid, { reader, active: true });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const dataLine = extractSseData(frame);
      if (!dataLine) continue;
      let envelope;
      try {
        envelope = JSON.parse(dataLine);
      } catch {
        continue;
      }
      handleEnvelope(sid, envelope);
    }
  }
  log('STREAM', `Stream ended for ${sid}`);
  monitoredSessions.delete(sid);
}

const MODEL_EVENT_TYPES = new Set(['LLM_THINKING_DELTA', 'LLM_CONTENT_DELTA']);

async function handleEnvelope(sid, envelope) {
  const type = envelope.eventType;
  if (MODEL_EVENT_TYPES.has(type) && !armedSessions.has(sid)) {
    armedSessions.add(sid);
    log('MODEL', `Detected ${type} on ${sid}! requestId=${envelope.requestId}`);
    if (DELAY_MS > 0) {
      log('MODEL', `Waiting ${DELAY_MS}ms before cancel ...`);
      await sleep(DELAY_MS);
    }
    const latestReqId = (await fetchLatestRequestId(sid)) ?? envelope.requestId;
    await sendCancel(sid, latestReqId);
    await sleep(1000);
    armedSessions.delete(sid);
    log('MONITOR', `Re-armed for ${sid}`);
  } else if (type === 'REQUEST_CANCELED' || type === 'REQUEST_COMPLETED' || type === 'REQUEST_FAILED' || type === 'USER_INPUT_REQUIRED') {
    log('EVENT', `${type} on ${sid} (requestId=${envelope.requestId})`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollAndConnect() {
  while (true) {
    try {
      if (FIXED_SESSION_ID) {
        if (!monitoredSessions.has(FIXED_SESSION_ID)) {
          connectStream(FIXED_SESSION_ID).catch((err) => log('ERROR', `Stream error: ${err.message}`));
        }
      } else {
        const sessions = await listSessions();
        for (const entry of sessions) {
          if (entry.hasInFlightRequest && !monitoredSessions.has(entry.sessionId)) {
            log('SCAN', `Found in-flight: ${entry.sessionId} (${entry.displayTitle ?? 'untitled'})`);
            connectStream(entry.sessionId).catch((err) => log('ERROR', `Stream error: ${err.message}`));
          }
        }
      }
    } catch (err) {
      log('ERROR', `Poll error: ${err.message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

log('START', `Base: ${BASE_URL} | Trigger: model-invocation | Delay: ${DELAY_MS}ms | Poll: ${POLL_INTERVAL_MS}ms`);
pollAndConnect();
