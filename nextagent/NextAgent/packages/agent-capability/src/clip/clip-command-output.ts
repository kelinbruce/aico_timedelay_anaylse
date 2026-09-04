import { AgentError, getLogger, type JsonObject, type JsonValue } from '@nextagent/agent-common';

const logger = getLogger({ component: 'agent-capability', source: 'clip-command-output' });

export interface ClipStreamDeltaEmitter {
  accept: (chunk: string) => Promise<void>;
  flush: () => Promise<void>;
}

export interface ClipSubscribeOutputProjection {
  readonly events: readonly ClipSubscribeEventProjection[];
  readonly completion?: ClipSubscribeCompletionProjection;
}

export interface ClipSubscribeEventProjection {
  readonly eventType?: string;
  readonly data?: JsonValue;
  readonly dataRaw?: string;
  readonly text: string;
}

export interface ClipSubscribeCompletionProjection {
  readonly reason?: string;
  readonly eventCount?: number;
}

export interface ClipSubscribeCommandStdoutProjection {
  readonly stdout: string;
  readonly eventCount: number;
  readonly reason?: string;
}

export function parseClipExecutionOutput(stdout: string): unknown {
  try {
    return parseRunnerObject(stdout);
  } catch {
    const parsed = parseClipOutputFrames(stdout);
    const subscribeEvents = parsed.filter((entry) => entry['type'] === 'clip.subscribe.event');
    if (subscribeEvents.length > 0) {
      return {
        events: subscribeEvents,
        lines: parsed,
      };
    }
    const completion = parsed.find((entry) => isRecord(entry['completion']))?.['completion'];
    const events = parsed.filter((entry) => isRecord(entry['event'])).map((entry) => entry['event']);
    return {
      events,
      ...(isRecord(completion) ? { completion } : {}),
      lines: parsed,
    };
  }
}

export function normalizeClipSubscribeCommandStdout(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdout: string;
}): ClipSubscribeCommandStdoutProjection | undefined {
  if (!isClipSubscribeCommand(input.command, input.args)) {
    return undefined;
  }
  const parsedOutput = parseClipSubscribeOutput(input.stdout);
  if (parsedOutput === undefined) {
    return input.stdout.includes('clip.subscribe.') ? { stdout: '', eventCount: 0 } : undefined;
  }
  const stdout = parsedOutput.events
    .map((event) => event.text)
    .filter((text) => text.trim().length > 0)
    .join('\n');
  const eventCount = parsedOutput.completion?.eventCount ?? parsedOutput.events.length;
  return {
    stdout,
    eventCount,
    ...(parsedOutput.completion?.reason === undefined ? {} : { reason: parsedOutput.completion.reason }),
  };
}

export function parseClipSubscribeOutput(stdout: string): ClipSubscribeOutputProjection | undefined {
  const events: ClipSubscribeEventProjection[] = [];
  let completion: ClipSubscribeCompletionProjection | undefined;
  for (const frame of drainClipOutputFrames(stdout, true).frames) {
    const parsed = safeParseClipOutputFrame(frame);
    if (parsed === undefined) {
      continue;
    }
    const event = readClipSubscribeEvent(parsed);
    if (event !== undefined) {
      events.push(event);
      continue;
    }
    completion = readClipSubscribeCompletion(parsed) ?? completion;
  }
  return events.length > 0 || completion !== undefined ? { events, ...(completion === undefined ? {} : { completion }) } : undefined;
}

export function createClipStreamDeltaEmitter(emitResultDelta?: (payload: JsonObject) => Promise<void>): ClipStreamDeltaEmitter {
  let buffer = '';
  return {
    async accept(chunk: string): Promise<void> {
      if (emitResultDelta === undefined) {
        return;
      }
      buffer += chunk;
      const drained = drainClipOutputFrames(buffer, false);
      buffer = drained.rest;
      for (const frame of drained.frames) {
        await emitClipOutputFrame(frame, emitResultDelta);
      }
    },
    async flush(): Promise<void> {
      if (emitResultDelta === undefined || buffer.trim().length === 0) {
        buffer = '';
        return;
      }
      const drained = drainClipOutputFrames(buffer, true);
      buffer = '';
      for (const frame of drained.frames) {
        await emitClipOutputFrame(frame, emitResultDelta);
      }
    },
  };
}

export interface BashStreamDeltaEmitter {
  accept: (chunk: string) => Promise<void>;
  flush: () => Promise<void>;
}

export function createBashStreamDeltaEmitter(emitResultDelta?: (payload: JsonObject) => Promise<void>): BashStreamDeltaEmitter {
  let buffer = '';
  return {
    async accept(chunk: string): Promise<void> {
      if (emitResultDelta === undefined) {
        return;
      }
      buffer += chunk;
      const drained = drainClipOutputFrames(buffer, false);
      buffer = drained.rest;
      for (const frame of drained.frames) {
        await emitBashOutputFrame(frame, emitResultDelta);
      }
    },
    async flush(): Promise<void> {
      if (emitResultDelta === undefined || buffer.trim().length === 0) {
        buffer = '';
        return;
      }
      const drained = drainClipOutputFrames(buffer, true);
      buffer = '';
      for (const frame of drained.frames) {
        await emitBashOutputFrame(frame, emitResultDelta);
      }
    },
  };
}

function isClipSubscribeCommand(command: string, args: readonly string[]): boolean {
  if (args[0] !== 'subscribe') {
    return false;
  }
  const executable = command.replace(/\\/gu, '/').split('/').pop()?.toLowerCase();
  return executable === 'clipc' || executable === 'clipc.exe' || executable === 'clipc.cmd';
}

async function emitClipOutputFrame(frame: string, emitResultDelta: (payload: JsonObject) => Promise<void>): Promise<void> {
  let parsed: JsonObject | undefined;
  try {
    parsed = parseClipOutputFrame(frame);
  } catch {
    logger.debug({ event: 'clip.streaming.frame_parse_error', frameLength: frame.length });
    return;
  }
  if (parsed !== undefined) {
    await emitResultDelta(parsed);
  }
}

async function emitBashOutputFrame(frame: string, emitResultDelta: (payload: JsonObject) => Promise<void>): Promise<void> {
  let parsed: JsonObject | undefined;
  try {
    parsed = parseClipOutputFrame(frame);
  } catch {
    logger.debug({ event: 'bash.streaming.frame_parse_error', frameLength: frame.length });
    return;
  }
  if (parsed === undefined) {
    logger.info({ event: 'bash.streaming.frame_parse_undefined', frameLength: frame.length });
    return;
  }
  // For SSE frames, parseClipOutputFrame wraps the data: payload in a CLIP
  // envelope {type, event, data_raw, data_json}. Extract data_json so the
  // bridge in emitResultDelta can match {eventType, messageType, content}.
  // For NDJSON / direct JSON frames, parsed is the JSON object itself.
  // Pass the extracted payload directly: executor.ts wraps it with
  // {structuredPayload: payload} before forwarding to tool-loop.
  const dataJson = parsed['data_json'];
  logger.info({
    event: 'bash.streaming.frame_emit',
    hasDataJson: dataJson !== undefined,
    parsedKeys: Object.keys(parsed),
    payloadKeys: Object.keys((dataJson ?? parsed) as JsonObject),
  });
  await emitResultDelta((dataJson ?? parsed) as JsonObject);
}

function safeParseClipOutputFrame(frame: string): JsonObject | undefined {
  try {
    return parseClipOutputFrame(frame);
  } catch {
    return undefined;
  }
}

function readClipSubscribeEvent(record: JsonObject): ClipSubscribeEventProjection | undefined {
  if (readString(record['type']) === 'clip.subscribe.event') {
    const eventType = readString(record['event']);
    const dataRaw = readString(record['data_raw']);
    const dataJson = isJsonValue(record['data_json']) ? record['data_json'] : undefined;
    const parsedRaw = dataJson === undefined && dataRaw !== undefined ? parseJsonValue(dataRaw) : undefined;
    const data = dataJson ?? parsedRaw;
    if (eventType === undefined && dataRaw === undefined && data === undefined) {
      return undefined;
    }
    return {
      ...(eventType === undefined ? {} : { eventType }),
      ...(data === undefined ? {} : { data }),
      ...(dataRaw === undefined ? {} : { dataRaw }),
      text: clipSubscribeEventText(data, dataRaw),
    };
  }

  const event = readJsonObject(record['event']);
  if (event === undefined) {
    return undefined;
  }
  const eventType = readString(event['type']);
  const dataRaw = readString(event['data_raw']);
  const data = isJsonValue(event['data']) ? event['data'] : dataRaw === undefined ? undefined : parseJsonValue(dataRaw);
  if (eventType === undefined && dataRaw === undefined && data === undefined) {
    return undefined;
  }
  return {
    ...(eventType === undefined ? {} : { eventType }),
    ...(data === undefined ? {} : { data }),
    ...(dataRaw === undefined ? {} : { dataRaw }),
    text: clipSubscribeEventText(data, dataRaw),
  };
}

function readClipSubscribeCompletion(record: JsonObject): ClipSubscribeCompletionProjection | undefined {
  if (readString(record['type']) === 'clip.subscribe.completed') {
    return clipSubscribeCompletionFromRecord(record);
  }
  const completion = readJsonObject(record['completion']);
  return completion === undefined ? undefined : clipSubscribeCompletionFromRecord(completion);
}

function clipSubscribeCompletionFromRecord(record: JsonObject): ClipSubscribeCompletionProjection | undefined {
  const reason = readString(record['reason']);
  const eventCount = readNumber(record['event_count']) ?? readNumber(record['eventCount']);
  return reason === undefined && eventCount === undefined
    ? undefined
    : {
        ...(reason === undefined ? {} : { reason }),
        ...(eventCount === undefined ? {} : { eventCount }),
      };
}

function clipSubscribeEventText(data?: JsonValue, dataRaw?: string): string {
  if (typeof data === 'string') {
    return data;
  }
  if (dataRaw !== undefined) {
    return dataRaw;
  }
  return data === undefined ? '' : JSON.stringify(data);
}

function parseJsonValue(text: string): JsonValue | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonValue(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObjectValue(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseRunnerObject(stdout: string): unknown {
  const parsed = JSON.parse(stdout) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidClipRunnerResponse();
  }
  return parsed;
}

function parseClipOutputFrames(stdout: string): readonly JsonObject[] {
  const parsed: JsonObject[] = [];
  for (const frame of drainClipOutputFrames(stdout, true).frames) {
    const value = parseClipOutputFrame(frame);
    if (value === undefined) {
      throw invalidClipRunnerResponse();
    }
    parsed.push(value);
  }
  if (parsed.length === 0) {
    throw invalidClipRunnerResponse();
  }
  return parsed;
}

function parseClipOutputFrame(frame: string): JsonObject | undefined {
  const trimmed = frame.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isJsonObjectValue(parsed)) {
      return undefined;
    }
    return parsed;
  }
  return parseClipSseFrame(trimmed);
}

function parseClipSseFrame(frame: string): JsonObject | undefined {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const rawLine of frame.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    if (line.length === 0 || line.startsWith(':')) {
      continue;
    }
    const delimiter = line.indexOf(':');
    const field = delimiter === -1 ? line : line.slice(0, delimiter);
    const value = delimiter === -1 ? '' : line.slice(delimiter + 1).replace(/^ /u, '');
    if (field === 'event' && value.length > 0) {
      eventName = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0) {
    return undefined;
  }
  const dataRaw = dataLines.join('\n');
  const envelope: Record<string, JsonValue> = {
    type: 'clip.subscribe.event',
    event: eventName,
    data_raw: dataRaw,
  };
  try {
    const dataJson = JSON.parse(dataRaw) as unknown;
    if (isJsonValue(dataJson)) {
      envelope['data_json'] = dataJson;
    }
  } catch {
    // Non-JSON SSE data is still useful as the original event payload.
  }
  return envelope;
}

function drainClipOutputFrames(stdout: string, flush: boolean): { readonly frames: readonly string[]; readonly rest: string } {
  const frames: string[] = [];
  let buffer = stdout;
  while (buffer.length > 0) {
    const sseBoundary = findSseFrameBoundary(buffer);
    if (sseBoundary !== undefined) {
      frames.push(buffer.slice(0, sseBoundary.start));
      buffer = buffer.slice(sseBoundary.end);
      continue;
    }
    if (buffer.trimStart().startsWith('{')) {
      const lineBoundary = findLineBoundary(buffer);
      if (lineBoundary === undefined) {
        if (flush) {
          frames.push(buffer);
          buffer = '';
        }
        break;
      }
      frames.push(buffer.slice(0, lineBoundary.start));
      buffer = buffer.slice(lineBoundary.end);
      continue;
    }
    if (flush) {
      frames.push(buffer);
      buffer = '';
    }
    break;
  }
  return { frames: frames.filter((frame) => frame.trim().length > 0), rest: buffer };
}

function findSseFrameBoundary(value: string): { readonly start: number; readonly end: number } | undefined {
  const match = /\r?\n\r?\n/u.exec(value);
  if (match === null || match.index === undefined) {
    return undefined;
  }
  return { start: match.index, end: match.index + match[0].length };
}

function findLineBoundary(value: string): { readonly start: number; readonly end: number } | undefined {
  const match = /\r?\n/u.exec(value);
  if (match === null || match.index === undefined) {
    return undefined;
  }
  return { start: match.index, end: match.index + match[0].length };
}

function invalidClipRunnerResponse(): AgentError {
  return new AgentError({
    code: 'CLIP_RUNNER_RESPONSE_INVALID',
    message: 'CLIP runner response is invalid.',
    category: 'VALIDATION',
    retryable: false,
  });
}

function isJsonObjectValue(value: unknown): value is JsonObject {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return typeof value !== 'number' || Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isJsonObjectValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
