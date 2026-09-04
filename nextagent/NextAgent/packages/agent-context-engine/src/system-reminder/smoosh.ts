import type { ModelMessage, ModelMessageContentPart, ModelTextContentPart, ModelToolResultContentPart } from '@nextagent/agent-contracts/model';
import { isSystemReminderText } from './wrap.js';

/**
 * Spec anchor: add-ts-system-reminder-memory-v1 / specs/system-reminder/spec.md
 * Requirement: "系统提醒管道零影响回归".
 *
 * Folds `<system-reminder>` text blocks that share a USER message with a
 * `tool-result` block into that tool-result's `output`, so the SR text travels
 * inside an existing tool-result rather than standing as a free text block that
 * could confuse turn boundary semantics. Only operates on `text` blocks; never
 * modifies `tool-call` or `tool-result` structure, ids, or ordering.
 *
 * v1 behavior: the memory-recall producer injects SR as a standalone USER
 * message (no tool-result in the same message), so smoosh is a no-op for that
 * path. The full fold logic is implemented so future producers that emit SR
 * alongside a tool-result (e.g. hook additionalContext) are handled without
 * pipeline changes.
 *
 * When no USER message contains both an SR text block and a tool-result, the
 * input is returned unchanged (same contents, new array).
 */
export function smooshSystemReminderSiblings(messages: readonly ModelMessage[]): ModelMessage[] {
  let changed = false;
  const result: ModelMessage[] = [];
  for (const message of messages) {
    const smoothed = smooshMessage(message);
    if (smoothed !== message) {
      changed = true;
    }
    result.push(smoothed);
  }
  return changed ? result : [...messages];
}

function smooshMessage(message: ModelMessage): ModelMessage {
  if (message.role !== 'USER') {
    return message;
  }
  const content = message.content;
  const lastToolResultIndex = findLastToolResultIndex(content);
  if (lastToolResultIndex === -1) {
    return message;
  }
  const srTextIndices = findSystemReminderTextIndices(content);
  if (srTextIndices.length === 0) {
    return message;
  }

  const nextContent: ModelMessageContentPart[] = [];
  const targetToolResult = content[lastToolResultIndex] as ModelToolResultContentPart;
  const foldedTexts: string[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const part = content[index]!;
    if (srTextIndices.includes(index)) {
      foldedTexts.push((part as ModelTextContentPart).text);
      continue;
    }
    if (index === lastToolResultIndex) {
      nextContent.push(foldToolResultReminder(targetToolResult, foldedTexts));
      continue;
    }
    nextContent.push(part);
  }
  return { role: message.role, content: nextContent };
}

function foldToolResultReminder(part: ModelToolResultContentPart, foldedTexts: readonly string[]): ModelToolResultContentPart {
  if (foldedTexts.length === 0) {
    return part;
  }
  const existing = typeof part.output['_systemReminder'] === 'string' ? part.output['_systemReminder'] : '';
  const combined = existing.length > 0 ? `${existing}\n\n${foldedTexts.join('\n\n')}` : foldedTexts.join('\n\n');
  return {
    ...part,
    output: { ...part.output, _systemReminder: combined },
  };
}

function findLastToolResultIndex(content: readonly ModelMessageContentPart[]): number {
  for (let index = content.length - 1; index >= 0; index -= 1) {
    if (content[index]?.type === 'tool-result') {
      return index;
    }
  }
  return -1;
}

function findSystemReminderTextIndices(content: readonly ModelMessageContentPart[]): number[] {
  const indices: number[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const part = content[index];
    if (part?.type === 'text' && isSystemReminderText(part.text)) {
      indices.push(index);
    }
  }
  return indices;
}
