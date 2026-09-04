import { AgentError } from '@nextagent/agent-common';

export const maxModelVisibleChars = 50_000;
export const modelOutputTruncationMarker = `[Model output truncated at the ${maxModelVisibleChars}-character safety limit.]`;

export function truncateModelVisibleContent(content: string): string {
  if (content.length <= maxModelVisibleChars) {
    return content;
  }

  const marker = `\n\n${modelOutputTruncationMarker}`;
  let prefixLength = maxModelVisibleChars - marker.length;
  while (prefixLength >= 0) {
    const prefix = completeUtf16Prefix(content, prefixLength);
    const closure = markdownTailClosure(prefix);
    const truncated = prefix + closure + marker;
    if (truncated.length <= maxModelVisibleChars) {
      return truncated;
    }
    prefixLength -= truncated.length - maxModelVisibleChars;
  }

  return modelOutputTruncationMarker.slice(0, maxModelVisibleChars);
}

function completeUtf16Prefix(content: string, requestedLength: number): string {
  let length = requestedLength;
  const lastCodeUnit = content.charCodeAt(length - 1);
  const nextCodeUnit = content.charCodeAt(length);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
    length -= 1;
  }
  return content.slice(0, length);
}

export function assertTerminalContentComplete(content: string): void {
  if (!hasIncompleteMarkdownTail(content)) {
    return;
  }
  throw new AgentError({
    code: 'MODEL_FINAL_CONTENT_INCOMPLETE',
    message: 'Model output ended in an incomplete final structure.',
    category: 'UNAVAILABLE',
    retryable: true,
  });
}

export function assertTerminalContentPresent(content: string): void {
  if (content.trim().length > 0) {
    return;
  }
  throw new AgentError({
    code: 'MODEL_FINAL_CONTENT_EMPTY',
    message: 'Model produced no final assistant content.',
    category: 'UNAVAILABLE',
    retryable: true,
  });
}

function hasIncompleteMarkdownTail(content: string): boolean {
  const trimmed = content.trimEnd();
  if (trimmed.length === 0) {
    return false;
  }
  return hasUnclosedCodeFence(trimmed) || hasIncompleteTableRow(trimmed);
}

function markdownTailClosure(content: string): string {
  return `${hasIncompleteTableRow(content) ? '|' : ''}${hasUnclosedCodeFence(content) ? '\n```' : ''}`;
}

function hasUnclosedCodeFence(content: string): boolean {
  let inFence = false;
  for (const line of content.split(/\r?\n/)) {
    if (inFence) {
      if (isClosingCodeFenceLine(line)) {
        inFence = false;
      }
      continue;
    }
    if (isOpeningCodeFenceLine(line) || isAdjacentGeneratedOpeningFence(line)) {
      inFence = true;
    }
  }
  return inFence;
}

function isOpeningCodeFenceLine(line: string): boolean {
  return /^\s{0,3}```/.test(line);
}

function isClosingCodeFenceLine(line: string): boolean {
  return /^\s{0,3}```\s*$/.test(line);
}

function isAdjacentGeneratedOpeningFence(line: string): boolean {
  return /(?:<\/[A-Za-z][A-Za-z0-9:-]*>|[:：])```[A-Za-z0-9_-]*\s*$/.test(line);
}

function hasIncompleteTableRow(content: string): boolean {
  const lines = content.split(/\r?\n/);
  const lastLine = lines[lines.length - 1]?.trimEnd() ?? '';
  if (!lastLine.trimStart().startsWith('|') || lastLine.endsWith('|')) {
    return false;
  }
  return lines.slice(0, -1).some((line) => isTableSeparatorLine(line));
}

function isTableSeparatorLine(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}
