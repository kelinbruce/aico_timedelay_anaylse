import { describe, expect, it } from 'vitest';
import type { Attributes, AttributeValue } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

// We test the gen_ai mapping by instrumenting a mock exporter.
// The mapping logic is internal to trace-export-diagnostics.ts, but
// instrumentTraceExporterDiagnostics wraps export and applies the mapping.
// We verify the mapped spans that reach the underlying exporter.

import { instrumentTraceExporterDiagnostics } from '../src/linking/trace-export-diagnostics.js';

function createMockExporter(): {
  exporter: { export: (spans: ReadableSpan[], cb: (r: { code: number }) => void) => void; shutdown: () => Promise<void> };
  capturedSpans: ReadableSpan[];
} {
  const capturedSpans: ReadableSpan[] = [];
  return {
    exporter: {
      export: (spans, cb) => {
        capturedSpans.push(...spans);
        cb({ code: 0 });
      },
      shutdown: async () => {},
    },
    capturedSpans,
  };
}

function createSpan(attributes: Attributes): ReadableSpan {
  return {
    name: 'test-span',
    kind: 0,
    spanContext: () => ({
      traceId: 'abcdef0123456789abcdef0123456789',
      spanId: '0123456789abcdef',
      traceFlags: 1,
    }),

    startTime: [0, 0],
    endTime: [0, 1],
    status: { code: 0 },
    attributes,
    links: [],
    events: [],
    duration: [0, 1],
    ended: true,
    resource: {} as never,
    instrumentationScope: {} as never,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

describe('gen_ai attribute mapping at export boundary', () => {
  it('maps request span observation_type to gen_ai.operation.name and response.status', () => {
    const { exporter, capturedSpans } = createMockExporter();
    instrumentTraceExporterDiagnostics(exporter as never);

    const span = createSpan({
      'nextagent.observation_type': 'request',
      'nextagent.outcome': 'success',
    });

    exporter.export([span], () => {});

    expect(capturedSpans).toHaveLength(1);
    const attrs = capturedSpans[0]!.attributes;
    expect(attrs['gen_ai.operation.name']).toBe('invoke_agent');
    expect(attrs['gen_ai.response.status']).toBe('completed');
    // Original keys preserved
    expect(attrs['nextagent.observation_type']).toBe('request');
    expect(attrs['nextagent.outcome']).toBe('success');
  });

  it('maps model span with usage tokens to gen_ai attributes', () => {
    const { exporter, capturedSpans } = createMockExporter();
    instrumentTraceExporterDiagnostics(exporter as never);

    const span = createSpan({
      'nextagent.observation_type': 'model',
      'nextagent.outcome': 'success',
      'nextagent.usage.input_tokens': 100 as AttributeValue,
      'nextagent.usage.output_tokens': 200 as AttributeValue,
      'nextagent.usage.total_tokens': 300 as AttributeValue,
      'nextagent.duration_ms': 5000 as AttributeValue,
    });

    exporter.export([span], () => {});

    const attrs = capturedSpans[0]!.attributes;
    expect(attrs['gen_ai.operation.name']).toBe('chat');
    expect(attrs['gen_ai.response.status']).toBe('completed');
    expect(attrs['gen_ai.usage.input_tokens']).toBe(100);
    expect(attrs['gen_ai.usage.output_tokens']).toBe(200);
    expect(attrs['gen_ai.usage.total_tokens']).toBe(300);
    expect(attrs['gen_ai.client.operation.duration']).toBe(5000);
    expect(attrs['gen_ai.token.type']).toBe('input;output');
  });

  it('maps model span without usage tokens does not add gen_ai.usage', () => {
    const { exporter, capturedSpans } = createMockExporter();
    instrumentTraceExporterDiagnostics(exporter as never);

    const span = createSpan({
      'nextagent.observation_type': 'model',
      'nextagent.outcome': 'success',
    });

    exporter.export([span], () => {});

    const attrs = capturedSpans[0]!.attributes;
    expect(attrs['gen_ai.operation.name']).toBe('chat');
    expect(attrs['gen_ai.response.status']).toBe('completed');
    expect(attrs['gen_ai.usage.input_tokens']).toBeUndefined();
    expect(attrs['gen_ai.usage.output_tokens']).toBeUndefined();
    expect(attrs['gen_ai.token.type']).toBeUndefined();
  });

  it('maps tool span to gen_ai.operation.name=execute_tool', () => {
    const { exporter, capturedSpans } = createMockExporter();
    instrumentTraceExporterDiagnostics(exporter as never);

    const span = createSpan({
      'nextagent.observation_type': 'tool',
      'nextagent.outcome': 'canceled',
    });

    exporter.export([span], () => {});

    const attrs = capturedSpans[0]!.attributes;
    expect(attrs['gen_ai.operation.name']).toBe('execute_tool');
    expect(attrs['gen_ai.response.status']).toBe('cancelled');
  });

  it('maps workflow_node span to gen_ai.operation.name=invoke_workflow', () => {
    const { exporter, capturedSpans } = createMockExporter();
    instrumentTraceExporterDiagnostics(exporter as never);

    const span = createSpan({
      'nextagent.observation_type': 'workflow_node',
      'nextagent.outcome': 'success',
    });

    exporter.export([span], () => {});

    const attrs = capturedSpans[0]!.attributes;
    expect(attrs['gen_ai.operation.name']).toBe('invoke_workflow');
    expect(attrs['gen_ai.response.status']).toBe('completed');
  });

  it('maps auxiliary span (no observation_type, no usage) with only common gen_ai attributes', () => {
    const { exporter, capturedSpans } = createMockExporter();
    instrumentTraceExporterDiagnostics(exporter as never);

    const span = createSpan({
      'nextagent.owner.agent_id': 'agent-1' as AttributeValue,
      'nextagent.owner.agent_version': '1.0.0' as AttributeValue,
      'session.id': 'session-1' as AttributeValue,
    });

    exporter.export([span], () => {});

    const attrs = capturedSpans[0]!.attributes;
    expect(attrs['gen_ai.agent.id']).toBe('agent-1');
    expect(attrs['gen_ai.agent.version']).toBe('1.0.0');
    expect(attrs['gen_ai.conversation.id']).toBe('session-1');
    // Must NOT set operation.name or response.status
    expect(attrs['gen_ai.operation.name']).toBeUndefined();
    expect(attrs['gen_ai.response.status']).toBeUndefined();
  });

  it('maps auxiliary span with usage tokens as model span', () => {
    const { exporter, capturedSpans } = createMockExporter();
    instrumentTraceExporterDiagnostics(exporter as never);

    const span = createSpan({
      'nextagent.owner.agent_id': 'agent-1' as AttributeValue,
      'nextagent.usage.input_tokens': 100 as AttributeValue,
      'nextagent.usage.output_tokens': 200 as AttributeValue,
    });

    exporter.export([span], () => {});

    const attrs = capturedSpans[0]!.attributes;
    // Usage tokens trigger model span mapping even without observation_type
    expect(attrs['gen_ai.usage.input_tokens']).toBe(100);
    expect(attrs['gen_ai.usage.output_tokens']).toBe(200);
    expect(attrs['gen_ai.operation.name']).toBe('chat');
    expect(attrs['gen_ai.token.type']).toBe('input;output');
  });

  it('skips gen_ai keys when source keys are absent', () => {
    const { exporter, capturedSpans } = createMockExporter();
    instrumentTraceExporterDiagnostics(exporter as never);

    const span = createSpan({
      'nextagent.observation_type': 'request',
      'nextagent.outcome': 'success',
    });

    exporter.export([span], () => {});

    const attrs = capturedSpans[0]!.attributes;
    // No agent_id/session.id on this span
    expect(attrs['gen_ai.agent.id']).toBeUndefined();
    expect(attrs['gen_ai.conversation.id']).toBeUndefined();
    // operation.name and response.status still set
    expect(attrs['gen_ai.operation.name']).toBe('invoke_agent');
    expect(attrs['gen_ai.response.status']).toBe('completed');
  });

  it('does not modify original ReadableSpan objects', () => {
    const { exporter } = createMockExporter();
    instrumentTraceExporterDiagnostics(exporter as never);

    const span = createSpan({
      'nextagent.observation_type': 'request',
      'nextagent.outcome': 'success',
    });

    exporter.export([span], () => {});

    // Original span must not have gen_ai keys
    expect(span.attributes['gen_ai.operation.name']).toBeUndefined();
    expect(span.attributes['gen_ai.response.status']).toBeUndefined();
  });

  it('does not set gen_ai.response.status when outcome is absent', () => {
    const { exporter, capturedSpans } = createMockExporter();
    instrumentTraceExporterDiagnostics(exporter as never);

    const span = createSpan({
      'nextagent.observation_type': 'request',
    });

    exporter.export([span], () => {});

    const attrs = capturedSpans[0]!.attributes;
    expect(attrs['gen_ai.operation.name']).toBe('invoke_agent');
    expect(attrs['gen_ai.response.status']).toBeUndefined();
  });
});
