import type { JsonObject, JsonValue } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';

/**
 * Internal accumulator state for one (runId, toolCallId) group.
 */
interface AccumulatorGroup {
  readonly runId: string;
  readonly toolCallId: string;
  /** Ordered queue of events that are already in final form (passthrough + closed dsl buffers). */
  readonly passthroughQueue: RunTimelineEvent[];
  /** PIU groups keyed by uuid — each accumulates content.data parts. */
  readonly piuGroups: Map<string, PiuAccumulatorState>;
  /** Current open dsl buffer (null when no dsl fragments are pending). */
  dslBuffer: DslBufferState | null;
  bufferedEventCount: number;
  bufferedPayloadBytes: number;
}

interface PiuAccumulatorState {
  readonly firstEvent: RunTimelineEvent;
  readonly dataParts: JsonValue[];
}

interface DslBufferState {
  readonly firstEvent: RunTimelineEvent;
  contentStr: string;
}

/**
 * Aggregates TOOL_STRUCTURED_DELTA events by (runId, toolCallId) before persistence.
 *
 * - PIU with uuid: accumulates content.data into an object array, emits one merged event.
 * - PIU without uuid: passthrough as-is.
 * - STREAM_DSL with content.type=dsl: concatenates content.content strings.
 * - STREAM_DSL with content.type=dataModel/done/error: closes current dsl buffer (pushes
 *   merged dsl to passthrough queue first), then pushes itself.
 * - TEXT/DSL/ACTION/OPERATOR/FILE: passthrough as-is.
 */
export class StructuredDeltaPersistenceAccumulator {
  private readonly groupsByRun = new Map<string, Map<string, AccumulatorGroup>>();

  accept(runId: string, event: RunTimelineEvent): RunTimelineEvent[] {
    const payload = event.inlinePayload;
    const toolCallId = payload['toolCallId'];
    if (typeof toolCallId !== 'string') {
      return [];
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
    const ready: RunTimelineEvent[] = [];
    let runGroups = this.groupsByRun.get(runId);
    let group = runGroups?.get(toolCallId);

    if (payloadBytes > maxStructuredDeltaBufferedPayloadBytes) {
      if (group !== undefined && runGroups !== undefined) {
        ready.push(...this.collectGroupResults(group));
        runGroups.delete(toolCallId);
        if (runGroups.size === 0) {
          this.groupsByRun.delete(runId);
        }
      }
      ready.push(event);
      return ready;
    }

    if (
      group !== undefined &&
      runGroups !== undefined &&
      (group.bufferedEventCount >= maxStructuredDeltaBufferedEvents ||
        group.bufferedPayloadBytes + payloadBytes > maxStructuredDeltaBufferedPayloadBytes)
    ) {
      ready.push(...this.collectGroupResults(group));
      runGroups.delete(toolCallId);
      group = undefined;
    }

    if (runGroups === undefined) {
      runGroups = new Map();
      this.groupsByRun.set(runId, runGroups);
    }
    if (group === undefined) {
      if (runGroups.size >= maxStructuredDeltaPendingGroupsPerRun) {
        const oldest = runGroups.entries().next().value as [string, AccumulatorGroup] | undefined;
        if (oldest !== undefined) {
          ready.push(...this.collectGroupResults(oldest[1]));
          runGroups.delete(oldest[0]);
        }
      }
      group = this.createGroup(runId, toolCallId);
      runGroups.set(toolCallId, group);
    }
    group.bufferedEventCount += 1;
    group.bufferedPayloadBytes += payloadBytes;
    const messageType = payload['toolMessageType'];

    if (messageType === 'PIU') {
      this.acceptPiu(group, event, payload);
    } else if (messageType === 'STREAM_DSL') {
      this.acceptStreamDsl(group, event, payload);
    } else {
      // TEXT, DSL, ACTION, OPERATOR, FILE — passthrough
      group.passthroughQueue.push(event);
    }
    return ready;
  }

  /**
   * Flush a single toolCallId group and return the aggregated events in order.
   * Clears the group state after flushing.
   */
  flush(runId: string, toolCallId: string): RunTimelineEvent[] {
    const runGroups = this.groupsByRun.get(runId);
    if (runGroups === undefined) {
      return [];
    }
    const group = runGroups.get(toolCallId);
    if (group === undefined) {
      return [];
    }
    const result = this.collectGroupResults(group);
    runGroups.delete(toolCallId);
    if (runGroups.size === 0) {
      this.groupsByRun.delete(runId);
    }
    return result;
  }

  /**
   * Flush all groups belonging to a runId. Used by finishRun as a fallback.
   */
  flushAll(runId: string): RunTimelineEvent[] {
    const runGroups = this.groupsByRun.get(runId);
    if (runGroups === undefined) {
      return [];
    }
    const results: RunTimelineEvent[] = [];
    for (const group of runGroups.values()) {
      results.push(...this.collectGroupResults(group));
    }
    this.groupsByRun.delete(runId);
    return results;
  }

  /**
   * Clear all groups belonging to a runId. Used by beginRun to remove stale state.
   */
  clearRun(runId: string): void {
    this.groupsByRun.delete(runId);
  }

  hasPending(runId: string): boolean {
    return (this.groupsByRun.get(runId)?.size ?? 0) > 0;
  }

  // --- internal ---

  private createGroup(runId: string, toolCallId: string): AccumulatorGroup {
    return {
      runId,
      toolCallId,
      passthroughQueue: [],
      piuGroups: new Map(),
      dslBuffer: null,
      bufferedEventCount: 0,
      bufferedPayloadBytes: 0,
    };
  }

  private acceptPiu(group: AccumulatorGroup, event: RunTimelineEvent, payload: JsonObject): void {
    const content = payload['content'];
    if (!isJsonObject(content)) {
      group.passthroughQueue.push(event);
      return;
    }
    const uuid = content['uuid'];
    if (typeof uuid !== 'string' || uuid.length === 0) {
      // PIU without uuid — passthrough
      group.passthroughQueue.push(event);
      return;
    }
    // PIU with uuid — accumulate
    let state = group.piuGroups.get(uuid);
    if (state === undefined) {
      state = { firstEvent: event, dataParts: [] };
      group.piuGroups.set(uuid, state);
    }
    const data = content['data'];
    if (data !== undefined) {
      state.dataParts.push(data);
    }
  }

  private acceptStreamDsl(group: AccumulatorGroup, event: RunTimelineEvent, payload: JsonObject): void {
    const content = payload['content'];
    if (!isJsonObject(content)) {
      group.passthroughQueue.push(event);
      return;
    }
    const innerType = content['type'];
    if (innerType === 'dsl') {
      // Concatenate content.content strings
      const innerContent = content['content'];
      if (typeof innerContent !== 'string') {
        return;
      }
      if (group.dslBuffer === null) {
        group.dslBuffer = { firstEvent: event, contentStr: '' };
      }
      group.dslBuffer.contentStr += innerContent;
    } else {
      // dataModel, done, error — close current dsl buffer first, then push as-is
      this.closeDslBuffer(group);
      group.passthroughQueue.push(event);
    }
  }

  private closeDslBuffer(group: AccumulatorGroup): void {
    if (group.dslBuffer === null) {
      return;
    }
    const merged = mergeDslEvent(group.dslBuffer);
    group.passthroughQueue.push(merged);
    group.dslBuffer = null;
  }

  private collectGroupResults(group: AccumulatorGroup): RunTimelineEvent[] {
    // 1. Close any unclosed dsl buffer
    this.closeDslBuffer(group);

    const result: RunTimelineEvent[] = [...group.passthroughQueue];

    // 2. PIU merged events
    for (const state of group.piuGroups.values()) {
      result.push(mergePiuEvent(state));
    }

    return result;
  }
}

const maxStructuredDeltaPendingGroupsPerRun = 64;
const maxStructuredDeltaBufferedEvents = 256;
const maxStructuredDeltaBufferedPayloadBytes = 49_000;

function mergePiuEvent(state: PiuAccumulatorState): RunTimelineEvent {
  const firstPayload = state.firstEvent.inlinePayload;
  const firstContent = firstPayload['content'] as JsonObject;
  const mergedContent: JsonObject = { ...firstContent, data: state.dataParts };
  const { streaming: _drop, ...restPayload } = firstPayload;
  return {
    ...state.firstEvent,
    inlinePayload: { ...restPayload, content: mergedContent },
  };
}

function mergeDslEvent(state: DslBufferState): RunTimelineEvent {
  const firstPayload = state.firstEvent.inlinePayload;
  const mergedContent: JsonObject = { type: 'dsl', content: state.contentStr };
  const { streaming: _drop, ...restPayload } = firstPayload;
  return {
    ...state.firstEvent,
    inlinePayload: { ...restPayload, content: mergedContent },
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
