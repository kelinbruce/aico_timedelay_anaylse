export interface StreamEvent {
  readonly eventType: string;
  readonly runId?: string;
  readonly payload?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface SseFrame {
  readonly event: string;
  readonly data: StreamEvent;
}

export function parseSseFrames(input: string): SseFrame[];
export function selectRunEvents<T extends { readonly runId?: string }>(events: readonly T[], runId: string): T[];
export function requireEvent<T extends StreamEvent>(events: readonly T[], runId: string, eventType: string): T;
export function isTerminalEventType(eventType: string): boolean;
export function safeEvidence(
  input: Record<string, unknown>,
): Record<string, string | readonly string[] | readonly Readonly<Record<string, string>>[]>;
export function requestJson(
  baseUrl: string,
  path: string,
  options?: { readonly method?: string; readonly body?: unknown; readonly signal?: AbortSignal },
): Promise<any>;
export function readSseRun(baseUrl: string, sessionId: string, runId: string, timeoutMs?: number): Promise<StreamEvent[]>;
export function loadAllRunEvents(baseUrl: string, sessionId: string, runId: string): Promise<StreamEvent[]>;
