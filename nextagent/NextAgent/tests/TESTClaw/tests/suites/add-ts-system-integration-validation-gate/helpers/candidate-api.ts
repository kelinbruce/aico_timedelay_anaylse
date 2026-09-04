import { randomUUID } from 'node:crypto';

export interface AcceptedRequest {
  readonly sessionId: string;
  readonly requestId: string;
  readonly runId: string;
  readonly attempt: number;
}

export interface ConversationItem {
  readonly role: string;
  readonly content: string;
  readonly messageId?: string;
  readonly runId?: string;
}

export interface CandidateSseEvent {
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export async function createCandidateSession(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  requireStatus(response, 200, 'create-session');
  const body: unknown = await response.json();
  if (!isObject(body) || typeof body.sessionId !== 'string') {
    throw new Error('create-session-response-invalid');
  }
  return body.sessionId;
}

export async function submitCandidateRequest(input: {
  readonly baseUrl: string;
  readonly inputText: string;
  readonly sessionId?: string;
  readonly idempotencyKey?: string;
  readonly locale?: string;
}): Promise<AcceptedRequest> {
  const response = await fetch(`${input.baseUrl}/api/v1/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      inputText: input.inputText,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.locale === undefined ? {} : { locale: input.locale }),
      idempotencyKey: input.idempotencyKey ?? `testclaw-${randomUUID()}`,
    }),
  });
  return await readAcceptedCandidateResponse(response, 'submit-request');
}

export async function readAcceptedCandidateResponse(response: Response, operation: string): Promise<AcceptedRequest> {
  requireStatus(response, 200, operation);
  const body: unknown = await response.json();
  if (!isAcceptedRequest(body)) {
    throw new Error('submit-request-response-invalid');
  }
  return body;
}

export async function readCandidateStream(baseUrl: string, request: Pick<AcceptedRequest, 'sessionId' | 'runId'>): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/sessions/${request.sessionId}/stream?lastSeenSequence=0&runId=${request.runId}`);
  requireStatus(response, 200, 'read-stream');
  return await response.text();
}

export async function readCandidateConversation(baseUrl: string, sessionId: string): Promise<readonly ConversationItem[]> {
  const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/conversation?limit=10`);
  requireStatus(response, 200, 'read-conversation');
  const body: unknown = await response.json();
  if (!isObject(body) || !Array.isArray(body.items) || !body.items.every(isConversationItem)) {
    throw new Error('conversation-response-invalid');
  }
  return body.items;
}

export function parseSseEventTypes(streamBody: string): readonly string[] {
  return streamBody
    .split('\n')
    .filter((line) => line.startsWith('event: '))
    .map((line) => line.slice('event: '.length));
}

export function parseCandidateSseEvents(streamBody: string): readonly CandidateSseEvent[] {
  const events: CandidateSseEvent[] = [];
  for (const line of streamBody.split('\n')) {
    if (!line.startsWith('data: ')) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(line.slice('data: '.length));
      if (isObject(value) && typeof value.eventType === 'string' && isObject(value.payload)) {
        events.push({ eventType: value.eventType, payload: value.payload });
      }
    } catch {
      // Ignore an incomplete transport frame; complete SSE data frames remain verifiable.
    }
  }
  return events;
}

function requireStatus(response: Response, expected: number, operation: string): void {
  if (response.status !== expected) {
    throw new Error(`${operation}-status-${response.status}`);
  }
}

function isAcceptedRequest(value: unknown): value is AcceptedRequest {
  return (
    isObject(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.requestId === 'string' &&
    typeof value.runId === 'string' &&
    typeof value.attempt === 'number'
  );
}

function isConversationItem(value: unknown): value is ConversationItem {
  return (
    isObject(value) &&
    typeof value.role === 'string' &&
    typeof value.content === 'string' &&
    (value.messageId === undefined || typeof value.messageId === 'string') &&
    (value.runId === undefined || typeof value.runId === 'string')
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
