export interface SseEvent {
  event?: string;
  data?: unknown;
  rawData?: string;
  type?: string;
  lifecycle?: string;
  sequence?: number;
}

export interface ConsumeSseOptions {
  timeoutMs?: number;
  stopWhen?: (events: SseEvent[], event: SseEvent) => boolean;
}

function parseSseEvent(block: string): SseEvent | null {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  let eventName: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!eventName && dataLines.length === 0) {
    return null;
  }

  const rawData = dataLines.join('\n');
  let data: unknown = rawData;

  if (rawData.length > 0) {
    try {
      data = JSON.parse(rawData);
    } catch {
      data = rawData;
    }
  }

  const typedData = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;

  return {
    event: eventName,
    data,
    rawData,
    type: typeof typedData?.type === 'string' ? typedData.type : eventName,
    lifecycle: typeof typedData?.lifecycle === 'string' ? typedData.lifecycle : undefined,
    sequence: typeof typedData?.sequence === 'number' ? typedData.sequence : undefined,
  };
}

export function isTerminalSseEvent(event: SseEvent): boolean {
  return (
    event.type === 'REQUEST_COMPLETED' ||
    event.type === 'REQUEST_FAILED' ||
    event.type === 'REQUEST_CANCELED' ||
    event.type === 'REQUEST_SUPERSEDED' ||
    event.lifecycle === 'COMPLETED' ||
    event.lifecycle === 'FAILED' ||
    event.lifecycle === 'CANCELED' ||
    event.lifecycle === 'SUPERSEDED'
  );
}

export async function consumeSse(url: string, options: ConsumeSseOptions = {}): Promise<SseEvent[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  const events: SseEvent[] = [];

  try {
    const response = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`SSE request failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('SSE response body is not readable');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const event = parseSseEvent(block);
        if (!event) {
          continue;
        }

        events.push(event);
        if (options.stopWhen?.(events, event)) {
          controller.abort();
          return events;
        }
      }
    }

    const tailEvent = parseSseEvent(buffer);
    if (tailEvent) {
      events.push(tailEvent);
    }

    return events;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError' && events.length > 0) {
      return events;
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
