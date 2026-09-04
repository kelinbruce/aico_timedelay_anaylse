import { apiClient } from './apiClient.ts';

export const SESSION_ACTIVITY_ID_MAX_LENGTH = 256;
const SESSION_ACTIVITY_SESSION_ID_MAX_LENGTH = 256;

export const SESSION_ACTIVITY_PENDING_INPUT_KINDS = ['QUESTION', 'CONFIRMATION', 'AUTHORIZATION', 'HUMAN_HANDOFF'] as const;

export type SessionActivityPendingInputKind = (typeof SESSION_ACTIVITY_PENDING_INPUT_KINDS)[number];

export type SessionActivityEntry =
  | {
      readonly sessionId: string;
      readonly status: 'NONE';
    }
  | {
      readonly sessionId: string;
      readonly status: 'WAITING_FOR_INPUT';
      readonly pendingInputKind: SessionActivityPendingInputKind;
    }
  | {
      readonly sessionId: string;
      readonly status: 'RUNNING';
    }
  | {
      readonly sessionId: string;
      readonly status: 'UNREAD_FAILURE';
      readonly activityId: string;
    }
  | {
      readonly sessionId: string;
      readonly status: 'UNREAD_RESULT';
      readonly activityId: string;
    };

export type PublishedSessionActivityEntry = Exclude<SessionActivityEntry, { readonly status: 'NONE' }>;

export type SessionActivityMessage =
  | {
      readonly type: 'SNAPSHOT';
      readonly entries: readonly PublishedSessionActivityEntry[];
    }
  | {
      readonly type: 'DELTA';
      readonly entry: SessionActivityEntry;
    };

export interface ConsumeSessionActivityCommand {
  readonly sessionId: string;
  readonly activityId: string;
  readonly observedRunId: string;
  readonly signal?: AbortSignal;
}

export class SessionActivityProtocolError extends Error {
  constructor() {
    super('Invalid session activity message');
    this.name = 'SessionActivityProtocolError';
  }
}

function invalidMessage(): never {
  throw new SessionActivityProtocolError();
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidMessage();
  }
  return value as Record<string, unknown>;
}

function hasExactKeys(record: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(record);
  return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(record, key));
}

function readBoundedId(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return invalidMessage();
  }
  return value;
}

function readPendingInputKind(value: unknown): SessionActivityPendingInputKind {
  if (typeof value !== 'string' || !SESSION_ACTIVITY_PENDING_INPUT_KINDS.includes(value as SessionActivityPendingInputKind)) {
    return invalidMessage();
  }
  return value as SessionActivityPendingInputKind;
}

function parseEntry(value: unknown, isSnapshotEntry: boolean): SessionActivityEntry {
  const record = readRecord(value);
  const sessionId = readBoundedId(record.sessionId, SESSION_ACTIVITY_SESSION_ID_MAX_LENGTH);

  switch (record.status) {
    case 'NONE':
      if (isSnapshotEntry || !hasExactKeys(record, ['sessionId', 'status'])) {
        return invalidMessage();
      }
      return { sessionId, status: 'NONE' };
    case 'WAITING_FOR_INPUT':
      if (!hasExactKeys(record, ['sessionId', 'status', 'pendingInputKind'])) {
        return invalidMessage();
      }
      return {
        sessionId,
        status: 'WAITING_FOR_INPUT',
        pendingInputKind: readPendingInputKind(record.pendingInputKind),
      };
    case 'RUNNING':
      if (!hasExactKeys(record, ['sessionId', 'status'])) {
        return invalidMessage();
      }
      return { sessionId, status: 'RUNNING' };
    case 'UNREAD_FAILURE':
    case 'UNREAD_RESULT':
      if (!hasExactKeys(record, ['sessionId', 'status', 'activityId'])) {
        return invalidMessage();
      }
      return {
        sessionId,
        status: record.status,
        activityId: readBoundedId(record.activityId, SESSION_ACTIVITY_ID_MAX_LENGTH),
      };
    default:
      return invalidMessage();
  }
}

export function parseSessionActivityMessage(raw: string): SessionActivityMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalidMessage();
  }

  const record = readRecord(value);
  if (record.type === 'SNAPSHOT') {
    if (!hasExactKeys(record, ['type', 'entries']) || !Array.isArray(record.entries)) {
      return invalidMessage();
    }
    return {
      type: 'SNAPSHOT',
      entries: record.entries.map((entry) => {
        const parsed = parseEntry(entry, true);
        if (parsed.status === 'NONE') {
          return invalidMessage();
        }
        return parsed;
      }),
    };
  }
  if (record.type === 'DELTA') {
    if (!hasExactKeys(record, ['type', 'entry'])) {
      return invalidMessage();
    }
    return {
      type: 'DELTA',
      entry: parseEntry(record.entry, false),
    };
  }
  return invalidMessage();
}

interface InFlightConsume {
  readonly request: Promise<void>;
  readonly signal?: AbortSignal;
}

const inFlightConsumes = new Map<string, InFlightConsume>();

function consumeKey(command: ConsumeSessionActivityCommand): string {
  return JSON.stringify([command.sessionId, command.activityId, command.observedRunId]);
}

function consume(command: ConsumeSessionActivityCommand): Promise<void> {
  const key = consumeKey(command);
  const existing = inFlightConsumes.get(key);
  if (existing && existing.signal?.aborted !== true) {
    return existing.request;
  }

  const request = apiClient.post<void>(
    `/api/v1/sessions/${encodeURIComponent(command.sessionId)}/activity/consume`,
    {
      activityId: command.activityId,
      observedRunId: command.observedRunId,
    },
    command.signal ? { signal: command.signal } : undefined,
  );
  const inFlight = {
    request,
    ...(command.signal === undefined ? {} : { signal: command.signal }),
  };
  inFlightConsumes.set(key, inFlight);
  const clear = () => {
    if (inFlightConsumes.get(key) === inFlight) {
      inFlightConsumes.delete(key);
    }
  };
  void request.then(clear, clear);
  return request;
}

export const sessionActivityService = {
  consume,
};
