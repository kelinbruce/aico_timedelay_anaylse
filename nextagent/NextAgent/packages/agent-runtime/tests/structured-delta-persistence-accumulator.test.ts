import { brand, type JsonObject, type JsonValue } from '@nextagent/agent-common';
import type { RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';

import { StructuredDeltaPersistenceAccumulator } from '../src/timeline/structured-delta-persistence-accumulator.js';

describe('StructuredDeltaPersistenceAccumulator', () => {
  describe('bounded pending state', () => {
    it('returns a completed batch before accepting the 257th event in one group', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      for (let index = 0; index < 256; index += 1) {
        expect(acc.accept('run-1', makeStructuredEvent('call-1', 'TEXT', `part-${index}`))).toEqual([]);
      }

      const ready = acc.accept('run-1', makeStructuredEvent('call-1', 'TEXT', 'part-256'));

      expect(ready).toHaveLength(256);
      expect(acc.flush('run-1', 'call-1')).toHaveLength(1);
    });

    it('returns the oldest group before retaining a 65th group for one run', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      for (let index = 0; index < 64; index += 1) {
        expect(acc.accept('run-1', makeStructuredEvent(`call-${index}`, 'TEXT', `part-${index}`))).toEqual([]);
      }

      const ready = acc.accept('run-1', makeStructuredEvent('call-64', 'TEXT', 'part-64'));

      expect(ready).toHaveLength(1);
      expect(ready[0]!.inlinePayload['toolCallId']).toBe('call-0');
      expect(acc.flush('run-1', 'call-64')).toHaveLength(1);
    });

    it('returns the previous batch before a group exceeds 49,000 source payload bytes', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      expect(acc.accept('run-1', makeStructuredEvent('call-1', 'TEXT', 'a'.repeat(30_000)))).toEqual([]);

      const ready = acc.accept('run-1', makeStructuredEvent('call-1', 'TEXT', 'b'.repeat(30_000)));

      expect(ready).toHaveLength(1);
      expect(ready[0]!.inlinePayload['content']).toBe('a'.repeat(30_000));
      expect(acc.flush('run-1', 'call-1')).toHaveLength(1);
    });

    it('returns a single oversized event immediately without retaining it', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();

      const ready = acc.accept('run-1', makeStructuredEvent('call-1', 'TEXT', 'x'.repeat(50_000)));

      expect(ready).toHaveLength(1);
      expect(acc.hasPending('run-1')).toBe(false);
    });
  });

  describe('PIU uuid accumulation', () => {
    it('merges same-uuid PIU content.data into object array', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      const runId = 'run-1';
      const toolCallId = 'call-1';

      acc.accept(runId, makePiuEvent(toolCallId, 'abc', { x: 1 }));
      acc.accept(runId, makePiuEvent(toolCallId, 'abc', { x: 2 }));
      acc.accept(runId, makePiuEvent(toolCallId, 'abc', { x: 3 }));

      const flushed = acc.flush(runId, toolCallId);
      expect(flushed).toHaveLength(1);
      const content = flushed[0]!.inlinePayload['content'] as JsonObject;
      expect(content['uuid']).toBe('abc');
      expect(content['piuName']).toBe('thoughtChain');
      expect(content['data']).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }]);
    });

    it('preserves first occurrence fields and drops streaming flag', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makePiuEvent('call-1', 'abc', { x: 1 }, { streaming: true }));
      acc.accept('run-1', makePiuEvent('call-1', 'abc', { x: 2 }, { streaming: true }));

      const flushed = acc.flush('run-1', 'call-1');
      expect(flushed).toHaveLength(1);
      expect(flushed[0]!.inlinePayload['streaming']).toBeUndefined();
    });

    it('handles PIU without uuid as passthrough', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makePiuEvent('call-1', undefined, { x: 1 }));
      acc.accept('run-1', makePiuEvent('call-1', undefined, { x: 2 }));

      const flushed = acc.flush('run-1', 'call-1');
      expect(flushed).toHaveLength(2);
      const content0 = flushed[0]!.inlinePayload['content'] as JsonObject;
      const content1 = flushed[1]!.inlinePayload['content'] as JsonObject;
      expect(content0['data']).toEqual({ x: 1 });
      expect(content1['data']).toEqual({ x: 2 });
    });
  });

  describe('STREAM_DSL aggregation', () => {
    it('concatenates dsl fragments and closes on done', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      const toolCallId = 'call-1';
      acc.accept('run-1', makeDslEvent(toolCallId, 'dataModel', { fields: [] }));
      acc.accept('run-1', makeDslEvent(toolCallId, 'dsl', 'root = Stack('));
      acc.accept('run-1', makeDslEvent(toolCallId, 'dsl', '  TextContent('));
      acc.accept('run-1', makeDslEvent(toolCallId, 'done'));

      const flushed = acc.flush('run-1', toolCallId);
      expect(flushed).toHaveLength(3);
      expect(typeOf(flushed[0]!)).toBe('dataModel');
      expect(typeOf(flushed[1]!)).toBe('dsl');
      expect(dslContent(flushed[1]!)).toBe('root = Stack(  TextContent(');
      expect(typeOf(flushed[2]!)).toBe('done');
    });

    it('handles multiple independent dsl sequences', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      const toolCallId = 'call-1';
      acc.accept('run-1', makeDslEvent(toolCallId, 'dataModel', { fields: [] }));
      acc.accept('run-1', makeDslEvent(toolCallId, 'dsl', 'a'));
      acc.accept('run-1', makeDslEvent(toolCallId, 'dsl', 'b'));
      acc.accept('run-1', makeDslEvent(toolCallId, 'done'));
      acc.accept('run-1', makeDslEvent(toolCallId, 'dataModel', { fields: [{ name: 'x' }] }));
      acc.accept('run-1', makeDslEvent(toolCallId, 'dsl', 'c'));
      acc.accept('run-1', makeDslEvent(toolCallId, 'done'));

      const flushed = acc.flush('run-1', toolCallId);
      expect(flushed).toHaveLength(6);
      expect(typeOf(flushed[0]!)).toBe('dataModel');
      expect(typeOf(flushed[1]!)).toBe('dsl');
      expect(dslContent(flushed[1]!)).toBe('ab');
      expect(typeOf(flushed[2]!)).toBe('done');
      expect(typeOf(flushed[3]!)).toBe('dataModel');
      expect(typeOf(flushed[4]!)).toBe('dsl');
      expect(dslContent(flushed[4]!)).toBe('c');
      expect(typeOf(flushed[5]!)).toBe('done');
    });

    it('writes out unclosed dsl buffer on flush', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makeDslEvent('call-1', 'dsl', 'partial'));
      acc.accept('run-1', makeDslEvent('call-1', 'dsl', 'more'));

      const flushed = acc.flush('run-1', 'call-1');
      expect(flushed).toHaveLength(1);
      expect(typeOf(flushed[0]!)).toBe('dsl');
      expect(dslContent(flushed[0]!)).toBe('partialmore');
    });

    it('stores error type independently', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makeDslEvent('call-1', 'dsl', 'partial'));
      acc.accept('run-1', makeDslEvent('call-1', 'error', { code: 'VALIDATION_ERROR', message: 'title is required' }));

      const flushed = acc.flush('run-1', 'call-1');
      expect(flushed).toHaveLength(2);
      expect(typeOf(flushed[0]!)).toBe('dsl');
      expect(dslContent(flushed[0]!)).toBe('partial');
      expect(typeOf(flushed[1]!)).toBe('error');
    });
  });

  describe('passthrough types', () => {
    it('passes through TEXT events unchanged', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makeStructuredEvent('call-1', 'TEXT', 'hello'));
      acc.accept('run-1', makeStructuredEvent('call-1', 'TEXT', 'world'));

      const flushed = acc.flush('run-1', 'call-1');
      expect(flushed).toHaveLength(2);
      expect(flushed[0]!.inlinePayload['content']).toBe('hello');
      expect(flushed[1]!.inlinePayload['content']).toBe('world');
    });

    it('passes through DSL events unchanged', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makeStructuredEvent('call-1', 'DSL', { foo: 'bar' }));

      const flushed = acc.flush('run-1', 'call-1');
      expect(flushed).toHaveLength(1);
      expect(flushed[0]!.inlinePayload['content']).toEqual({ foo: 'bar' });
    });

    it('passes through ACTION, OPERATOR, FILE events unchanged', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makeStructuredEvent('call-1', 'ACTION', { action: 'click' }));
      acc.accept('run-1', makeStructuredEvent('call-1', 'OPERATOR', { op: 'sum' }));
      acc.accept('run-1', makeStructuredEvent('call-1', 'FILE', { name: 'test.ts' }));

      const flushed = acc.flush('run-1', 'call-1');
      expect(flushed).toHaveLength(3);
      expect(flushed[0]!.inlinePayload['toolMessageType']).toBe('ACTION');
      expect(flushed[1]!.inlinePayload['toolMessageType']).toBe('OPERATOR');
      expect(flushed[2]!.inlinePayload['toolMessageType']).toBe('FILE');
    });
  });

  describe('flush behavior', () => {
    it('returns empty array on flush with no pending events', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      expect(acc.flush('run-1', 'call-1')).toEqual([]);
    });

    it('clears state after flush, next events start fresh', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makePiuEvent('call-1', 'abc', { x: 1 }));
      acc.flush('run-1', 'call-1');
      acc.accept('run-1', makePiuEvent('call-1', 'abc', { x: 2 }));

      const flushed = acc.flush('run-1', 'call-1');
      expect(flushed).toHaveLength(1);
      const content = flushed[0]!.inlinePayload['content'] as JsonObject;
      expect(content['data']).toEqual([{ x: 2 }]);
    });

    it('multiple flushes for different toolCallIds are independent', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makePiuEvent('call-1', 'abc', { x: 1 }));
      acc.accept('run-1', makePiuEvent('call-2', 'def', { y: 1 }));

      const flushed1 = acc.flush('run-1', 'call-1');
      const flushed2 = acc.flush('run-1', 'call-2');

      expect(flushed1).toHaveLength(1);
      expect((flushed1[0]!.inlinePayload['content'] as JsonObject)['uuid']).toBe('abc');
      expect(flushed2).toHaveLength(1);
      expect((flushed2[0]!.inlinePayload['content'] as JsonObject)['uuid']).toBe('def');
    });
  });

  describe('flushAll and clearRun', () => {
    it('isolates identical toolCallId values across runs', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makePiuEvent('shared-call', 'shared-uuid', { source: 'run-1' }));
      acc.accept('run-2', makePiuEvent('shared-call', 'shared-uuid', { source: 'run-2' }));

      expect(acc.hasPending('run-1')).toBe(true);
      expect(acc.hasPending('run-2')).toBe(true);

      const firstRun = acc.flushAll('run-1');
      expect(firstRun).toHaveLength(1);
      expect((firstRun[0]!.inlinePayload['content'] as JsonObject)['data']).toEqual([{ source: 'run-1' }]);
      expect(acc.hasPending('run-2')).toBe(true);

      const secondRun = acc.flushAll('run-2');
      expect(secondRun).toHaveLength(1);
      expect((secondRun[0]!.inlinePayload['content'] as JsonObject)['data']).toEqual([{ source: 'run-2' }]);
    });

    it('flushAll flushes all groups for a runId', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makePiuEvent('call-1', 'abc', { x: 1 }));
      acc.accept('run-1', makePiuEvent('call-2', 'def', { y: 1 }));

      const flushed = acc.flushAll('run-1');
      expect(flushed.length).toBeGreaterThanOrEqual(2);
      expect(acc.hasPending('run-1')).toBe(false);
    });

    it('clearRun removes all groups for a runId', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makePiuEvent('call-1', 'abc', { x: 1 }));
      acc.clearRun('run-1');

      expect(acc.hasPending('run-1')).toBe(false);
      expect(acc.flush('run-1', 'call-1')).toEqual([]);
    });

    it('clearRun only affects the specified runId', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makePiuEvent('call-1', 'abc', { x: 1 }));
      acc.accept('run-2', makePiuEvent('call-2', 'def', { y: 1 }));
      acc.clearRun('run-1');

      expect(acc.hasPending('run-1')).toBe(false);
      expect(acc.hasPending('run-2')).toBe(true);
    });

    it('clearRun does not remove another run with the same toolCallId', () => {
      const acc = new StructuredDeltaPersistenceAccumulator();
      acc.accept('run-1', makePiuEvent('shared-call', 'shared-uuid', { source: 'run-1' }));
      acc.accept('run-2', makePiuEvent('shared-call', 'shared-uuid', { source: 'run-2' }));

      acc.clearRun('run-1');

      expect(acc.hasPending('run-1')).toBe(false);
      expect(acc.hasPending('run-2')).toBe(true);
      const secondRun = acc.flushAll('run-2');
      expect(secondRun).toHaveLength(1);
      expect((secondRun[0]!.inlinePayload['content'] as JsonObject)['data']).toEqual([{ source: 'run-2' }]);
    });
  });
});

// --- helpers ---

function makePiuEvent(toolCallId: string, uuid: string | undefined, data: JsonValue, extra: JsonObject = {}): RunTimelineEvent {
  const content: JsonObject = {
    piuName: 'thoughtChain',
    piuVersion: '1.0.0',
    data,
    method: 'render',
    ...(uuid !== undefined ? { uuid } : {}),
  };
  return makeStructuredEvent(toolCallId, 'PIU', content, extra);
}

function makeDslEvent(toolCallId: string, innerType: string, innerContent: JsonValue = null): RunTimelineEvent {
  const content: JsonObject = { type: innerType, content: innerContent };
  return makeStructuredEvent(toolCallId, 'STREAM_DSL', content);
}

function makeStructuredEvent(toolCallId: string, messageType: string, content: JsonValue, extra: JsonObject = {}): RunTimelineEvent {
  return {
    type: 'TOOL_STRUCTURED_DELTA',
    inlinePayload: {
      capabilityId: 'ApiCall',
      toolCallId,
      toolEventType: 'ANSWER',
      toolMessageType: messageType,
      content,
      ...extra,
    },
  };
}

function typeOf(event: RunTimelineEvent): string {
  return (event.inlinePayload['content'] as JsonObject)['type'] as string;
}

function dslContent(event: RunTimelineEvent): string {
  return (event.inlinePayload['content'] as JsonObject)['content'] as string;
}
