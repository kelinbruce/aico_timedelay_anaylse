import { describe, expect, it } from 'vitest';
import { mergeStreamText, readStreamPayloadText, reconcileWorkflowProductFragments } from '../src/features/chat/utils/streamTextSemantics.ts';
import type { StreamEnvelope } from '../src/state/contracts.ts';

describe('stream text semantics', () => {
  it('merges rolling text windows without dropping the prefix', () => {
    let content = '';

    content = mergeStreamText(content, '1234567', { text: '1234567' });
    content = mergeStreamText(content, '2345678', { text: '2345678' });
    content = mergeStreamText(content, '3456789', { text: '3456789' });

    expect(content).toBe('123456789');
  });

  it('keeps normal accumulated snapshots as snapshots', () => {
    let content = '';

    content = mergeStreamText(content, 'hello', { text: 'hello', metadata: { accumulated: true } });
    content = mergeStreamText(content, 'hello world', { text: 'hello world', metadata: { accumulated: true } });

    expect(content).toBe('hello world');
  });

  it('appends explicit delta frames', () => {
    const content = mergeStreamText('123', '456', {
      delta: '456',
      metadata: { accumulated: false },
    });

    expect(content).toBe('123456');
  });

  it('preserves whitespace-only token deltas when requested', () => {
    const space = readStreamPayloadText({ delta: ' ' }, undefined, { allowWhitespaceOnly: true });
    const content = mergeStreamText('hello', space, {
      delta: space,
      metadata: { accumulated: false },
    });

    expect(content).toBe('hello ');
  });

  it('treats delta payloads as append frames even before validation adds accumulated metadata', () => {
    const content = mergeStreamText('hello', ' ', {
      delta: ' ',
    });

    expect(content).toBe('hello ');
  });

  it('replaces unrelated accumulated snapshots', () => {
    const content = mergeStreamText('previous answer', 'new answer', {
      text: 'new answer',
      metadata: { accumulated: true },
    });

    expect(content).toBe('new answer');
  });

  it('keeps a Workflow product fragment visible while its run is active', () => {
    const fragment = workflowProductEvent('NODE_OUTPUT_DELTA', 1, 'partial');

    expect(reconcileWorkflowProductFragments([fragment])).toEqual([fragment]);
  });

  it('replaces prior Workflow product fragments when the completed product arrives', () => {
    const fragment = workflowProductEvent('NODE_OUTPUT_DELTA', 1, 'partial');
    const completed = workflowProductEvent('NODE_COMPLETED', 2, 'complete');

    expect(reconcileWorkflowProductFragments([fragment, completed])).toEqual([completed]);
  });

  it('replaces a live fragment when history composition places its later completion first', () => {
    const fragment = workflowProductEvent('NODE_OUTPUT_DELTA', 1, 'partial');
    const completed = workflowProductEvent('NODE_COMPLETED', 2, 'complete');

    expect(reconcileWorkflowProductFragments([completed, fragment])).toEqual([completed]);
  });

  it('only replaces Workflow product fragments from the matching node execution occurrence', () => {
    const firstOccurrence = workflowProductEvent('NODE_OUTPUT_DELTA', 1, 'first partial', 'render-result-attempt-1');
    const secondOccurrence = workflowProductEvent('NODE_OUTPUT_DELTA', 2, 'second partial', 'render-result-attempt-2');
    const completedSecondOccurrence = workflowProductEvent('NODE_COMPLETED', 3, 'second complete', 'render-result-attempt-2');

    expect(reconcileWorkflowProductFragments([firstOccurrence, secondOccurrence, completedSecondOccurrence])).toEqual([
      firstOccurrence,
      completedSecondOccurrence,
    ]);
  });

  it('removes residual Workflow product fragments when output guard terminates the live stream', () => {
    const fragment = workflowProductEvent('NODE_OUTPUT_DELTA', 1, 'blocked partial');
    const guardTerminal = {
      ...fragment,
      eventId: 'guard-terminal',
      sequence: 2,
      eventType: 'OUTPUT_GUARD_BLOCKED',
      payload: { content: 'Safe refusal.' },
    } as StreamEnvelope;

    expect(reconcileWorkflowProductFragments([fragment, guardTerminal])).toEqual([guardTerminal]);
  });
});

function workflowProductEvent(
  workflowEventType: 'NODE_OUTPUT_DELTA' | 'NODE_COMPLETED',
  sequence: number,
  content: string,
  nodeExecutionId = 'render-result-attempt-1',
): StreamEnvelope {
  return {
    eventId: `product-${sequence}`,
    sequence,
    sessionId: 'session-1',
    requestId: 'request-1',
    runId: 'run-1',
    eventType: 'TOOL_STRUCTURED_DELTA',
    payload: {
      workflowEventType,
      nodeId: 'render-result',
      nodeType: 'DISPLAY',
      nodeExecutionId,
      capabilityId: 'render-result',
      toolCallId: 'workflow:execution-1:render-result',
      toolEventType: 'ANSWER',
      toolMessageType: 'TEXT',
      content,
      metadata: { accumulated: true },
    },
    createdAt: `2026-08-05T00:00:0${sequence}.000Z`,
    transportHints: [],
    timelineEventRef: null,
  } as StreamEnvelope;
}
