import type { ReplacementKind } from '@nextagent/agent-contracts/session';

export const LARGE_CONTENT_THRESHOLDS = {
  inlineMaxBytes: 50_000,
  aggregateMaxBytes: 16_384,
  previewMaxChars: 2_048,
} as const;

export interface LargeContentPolicy {
  readonly inlineMaxBytes: number;
  readonly previewMaxChars: number;
  readonly infinity: boolean;
}

export const DEFAULT_LARGE_CONTENT_POLICY: LargeContentPolicy = {
  inlineMaxBytes: LARGE_CONTENT_THRESHOLDS.inlineMaxBytes,
  previewMaxChars: LARGE_CONTENT_THRESHOLDS.previewMaxChars,
  infinity: false,
};

export type LargeContentReasonCode =
  | 'size-above-inline-threshold'
  | 'aggregate-above-budget'
  | 'content-type-binary'
  | 'empty-output'
  | 'degradation:offload-failed-into-overflow'
  | 'degradation:offload-failed-into-inline-fallback'
  | 'frozen-from-prior-decision';

export const REPLACEMENT_DECISION_ORDER: readonly ReplacementKind[] = ['EMPTY_MARKER', 'SPECIALIZED_REF', 'PERSISTED_PREVIEW', 'INLINE'] as const;
