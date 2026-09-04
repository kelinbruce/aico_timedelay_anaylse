import type { ReplacementKind } from '@nextagent/agent-contracts/session';

import { DEFAULT_LARGE_CONTENT_POLICY, type LargeContentPolicy, type LargeContentReasonCode } from './thresholds.js';

export interface ClassifyReplacementInput {
  readonly content: string;
  readonly contentType?: string;
  readonly originalSize: number;
  readonly policy?: LargeContentPolicy;
}

export interface ClassifyReplacementDecision {
  readonly kind: ReplacementKind;
  readonly reason: LargeContentReasonCode;
  readonly shouldPersist: boolean;
}

export function classifyReplacement(input: ClassifyReplacementInput): ClassifyReplacementDecision {
  const policy = input.policy ?? DEFAULT_LARGE_CONTENT_POLICY;

  if (input.content.trim().length === 0) {
    return { kind: 'EMPTY_MARKER', reason: 'empty-output', shouldPersist: false };
  }

  if (isBinaryContentType(input.contentType) || containsBinaryBlob(input.content)) {
    return { kind: 'SPECIALIZED_REF', reason: 'content-type-binary', shouldPersist: true };
  }

  if (policy.infinity) {
    return { kind: 'INLINE', reason: 'size-above-inline-threshold', shouldPersist: false };
  }

  if (input.originalSize <= policy.inlineMaxBytes) {
    return { kind: 'INLINE', reason: 'size-above-inline-threshold', shouldPersist: false };
  }

  return { kind: 'PERSISTED_PREVIEW', reason: 'size-above-inline-threshold', shouldPersist: true };
}

function isBinaryContentType(contentType?: string): boolean {
  if (contentType === undefined) {
    return false;
  }
  const normalized = contentType.toLowerCase();
  return (
    normalized.startsWith('image/') ||
    normalized.startsWith('video/') ||
    normalized.startsWith('audio/') ||
    normalized === 'application/pdf' ||
    normalized === 'application/octet-stream' ||
    normalized === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    normalized === 'application/vnd.ms-excel' ||
    normalized === 'application/zip'
  );
}

function containsBinaryBlob(content: string): boolean {
  if (content.length === 0 || content.length > 1_024) {
    return false;
  }
  let nonPrintable = 0;
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      nonPrintable += 1;
    }
  }
  return nonPrintable / content.length > 0.1;
}
