import type { JsonObject } from '@nextagent/agent-common';
import type { ModelMessage, ModelMessageContentPart, ModelToolResultContentPart } from '@nextagent/agent-contracts/model';
import { describe, expect, it } from 'vitest';
import { smooshSystemReminderSiblings } from '../../src/system-reminder/smoosh.js';
import { SYSTEM_REMINDER_OPEN_TAG } from '@nextagent/agent-contracts/system-reminder';

const srText = (content: string) => `${SYSTEM_REMINDER_OPEN_TAG}\n${content}\n</system-reminder>`;
const text = (t: string): ModelMessageContentPart => ({ type: 'text', text: t });
const toolResult = (id: string, output: JsonObject = {} as JsonObject): ModelMessageContentPart => ({
  type: 'tool-result',
  toolCallId: id,
  toolName: 'Tool',
  output,
});
const toolCall = (id: string): ModelMessageContentPart => ({
  type: 'tool-call',
  toolCall: { toolCallId: id, toolName: 'Tool', arguments: {} },
});

function asToolResult(part: ModelMessageContentPart): ModelToolResultContentPart {
  expect(part.type).toBe('tool-result');
  return part as ModelToolResultContentPart;
}

describe('smooshSystemReminderSiblings', () => {
  it('is a no-op when no USER message has both SR text and a tool-result', () => {
    const messages: ModelMessage[] = [
      { role: 'USER', content: [text(srText('fact'))] },
      { role: 'ASSISTANT', content: [text('reply')] },
    ];
    const result = smooshSystemReminderSiblings(messages);
    expect(result).toEqual(messages);
  });

  it('is a no-op for standalone SR USER messages (memory-recall path)', () => {
    const messages: ModelMessage[] = [
      { role: 'USER', content: [text(srText('fact'))] },
      { role: 'USER', content: [text('real question')] },
    ];
    const result = smooshSystemReminderSiblings(messages);
    expect(result).toEqual(messages);
  });

  it('folds SR text into the last tool-result output when both are in the same USER message', () => {
    const messages: ModelMessage[] = [
      {
        role: 'USER',
        content: [text(srText('fact')), toolResult('tc1', { result: 'ok' })],
      },
    ];
    const result = smooshSystemReminderSiblings(messages);
    expect(result[0]?.content).toHaveLength(1);
    const tr = asToolResult(result[0]!.content[0]!);
    expect(tr.output['_systemReminder']).toContain('fact');
    expect(tr.output['result']).toBe('ok');
  });

  it('does not modify tool-call structure', () => {
    const messages: ModelMessage[] = [
      {
        role: 'USER',
        content: [toolCall('tc1'), toolResult('tc1', { ok: true }), text(srText('fact'))],
      },
    ];
    const result = smooshSystemReminderSiblings(messages);
    const tc = result[0]?.content.find((p) => p.type === 'tool-call');
    expect(tc).toEqual(toolCall('tc1'));
  });

  it('does not modify tool-result id, name, or existing output fields', () => {
    const messages: ModelMessage[] = [
      {
        role: 'USER',
        content: [text(srText('fact')), toolResult('tc1', { result: 'ok', count: 3 })],
      },
    ];
    const result = smooshSystemReminderSiblings(messages);
    const trPart = result[0]?.content.find((p) => p.type === 'tool-result');
    const tr = asToolResult(trPart!);
    expect(tr.toolCallId).toBe('tc1');
    expect(tr.toolName).toBe('Tool');
    expect(tr.output['result']).toBe('ok');
    expect(tr.output['count']).toBe(3);
  });

  it('handles empty messages array', () => {
    expect(smooshSystemReminderSiblings([])).toEqual([]);
  });
});
