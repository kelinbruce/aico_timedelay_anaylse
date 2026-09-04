import { AgentError } from '@nextagent/agent-common';
import {
  createClipStreamDeltaEmitter,
  normalizeClipSubscribeCommandStdout,
  parseClipExecutionOutput,
  parseClipSubscribeOutput,
} from '@nextagent/agent-capability';
import { describe, expect, it } from 'vitest';

describe('CLIP command output parsing', () => {
  it('keeps ordinary object output unchanged', () => {
    expect(parseClipExecutionOutput(JSON.stringify({ status: 'ok', value: 1 }))).toEqual({ status: 'ok', value: 1 });
  });

  it('parses subscribe JSONL output into events and lines', () => {
    const first = {
      type: 'clip.subscribe.event',
      event: 'char',
      data_raw: JSON.stringify({ char: 'H', index: 0 }),
      data_json: { char: 'H', index: 0 },
    };
    const completed = { type: 'clip.subscribe.completed', reason: 'max_events', event_count: 1 };

    expect(parseClipExecutionOutput(`${JSON.stringify(first)}\n${JSON.stringify(completed)}\n`)).toEqual({
      events: [first],
      lines: [first, completed],
    });
  });

  it('projects subscribe JSONL output to original stream payload text', () => {
    const dataRaw = JSON.stringify({ char: 'H', index: 0 });
    const output = [
      JSON.stringify({
        type: 'clip.subscribe.event',
        operation: 'subscribe',
        target: 'getHelloStream',
        ref: '/api/hello/stream',
        trace_id: 'trace-should-stay-private',
        event: 'char',
        data_raw: dataRaw,
        data_json: { char: 'H', index: 0 },
      }),
      JSON.stringify({ type: 'clip.subscribe.completed', reason: 'max_events', event_count: 1 }),
    ].join('\n');

    expect(parseClipSubscribeOutput(output)).toEqual({
      events: [
        {
          eventType: 'char',
          data: { char: 'H', index: 0 },
          dataRaw,
          text: dataRaw,
        },
      ],
      completion: { reason: 'max_events', eventCount: 1 },
    });
    expect(
      normalizeClipSubscribeCommandStdout({
        command: 'C:\\tools\\clipc.exe',
        args: ['subscribe', 'getHelloStream', '/api/hello/stream', '--format', 'jsonl'],
        stdout: output,
      }),
    ).toEqual({ stdout: dataRaw, eventCount: 1, reason: 'max_events' });
  });

  it('parses subscribe SSE output into CLIP event envelopes', () => {
    const output = ['event: char', 'data: {"char":"H","index":0}', '', ''].join('\n');

    expect(parseClipExecutionOutput(output)).toEqual({
      events: [
        {
          type: 'clip.subscribe.event',
          event: 'char',
          data_raw: '{"char":"H","index":0}',
          data_json: { char: 'H', index: 0 },
        },
      ],
      lines: [
        {
          type: 'clip.subscribe.event',
          event: 'char',
          data_raw: '{"char":"H","index":0}',
          data_json: { char: 'H', index: 0 },
        },
      ],
    });
  });

  it('projects subscribe SSE output to original stream payload text', () => {
    const dataRaw = JSON.stringify({ char: 'H', index: 0 });
    const output = ['event: char', `data: ${dataRaw}`, '', ''].join('\n');

    expect(parseClipSubscribeOutput(output)).toEqual({
      events: [
        {
          eventType: 'char',
          data: { char: 'H', index: 0 },
          dataRaw,
          text: dataRaw,
        },
      ],
    });
    expect(
      normalizeClipSubscribeCommandStdout({
        command: 'clipc',
        args: ['subscribe', 'getHelloStream', '/api/hello/stream'],
        stdout: output,
      }),
    ).toEqual({ stdout: dataRaw, eventCount: 1 });
  });

  it('does not rewrite non-CLIP subscribe command output', () => {
    expect(
      normalizeClipSubscribeCommandStdout({
        command: 'cat',
        args: ['clip.log'],
        stdout: '{"type":"clip.subscribe.event"}',
      }),
    ).toBeUndefined();
    expect(
      normalizeClipSubscribeCommandStdout({
        command: 'clipc',
        args: ['describe', 'getHelloStream'],
        stdout: '{"type":"clip.subscribe.event"}',
      }),
    ).toBeUndefined();
  });

  it('emits only complete frames until flushed', async () => {
    const emitted: unknown[] = [];
    const emitter = createClipStreamDeltaEmitter(async (payload) => {
      emitted.push(payload);
    });
    const firstLine = `${JSON.stringify({ type: 'clip.subscribe.event', event: 'char', data_raw: '{"char":"H"}' })}\n`;
    const secondLine = JSON.stringify({ type: 'clip.subscribe.event', event: 'char', data_raw: '{"char":"e"}' });

    await emitter.accept(firstLine + secondLine.slice(0, 20));
    expect(emitted).toEqual([{ type: 'clip.subscribe.event', event: 'char', data_raw: '{"char":"H"}' }]);

    await emitter.accept(secondLine.slice(20));
    expect(emitted).toHaveLength(1);

    await emitter.flush();
    expect(emitted).toEqual([
      { type: 'clip.subscribe.event', event: 'char', data_raw: '{"char":"H"}' },
      { type: 'clip.subscribe.event', event: 'char', data_raw: '{"char":"e"}' },
    ]);
  });

  it('rejects invalid non-frame output', () => {
    expect(() => parseClipExecutionOutput('not clip output')).toThrow(AgentError);
  });

  it('skips malformed JSON frames during streaming without throwing', async () => {
    const emitted: unknown[] = [];
    const emitter = createClipStreamDeltaEmitter(async (payload) => {
      emitted.push(payload);
    });

    const validFrame = `${JSON.stringify({ type: 'clip.subscribe.event', event: 'char', data_raw: '{"char":"H"}' })}\n`;
    const malformedFrame = '{ broken json }\n';

    await emitter.accept(validFrame + malformedFrame);

    expect(emitted).toEqual([{ type: 'clip.subscribe.event', event: 'char', data_raw: '{"char":"H"}' }]);
    expect(emitted).toHaveLength(1);

    await emitter.flush();
    expect(emitted).toHaveLength(1);
  });
});
