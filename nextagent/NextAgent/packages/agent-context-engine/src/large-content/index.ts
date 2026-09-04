export { classifyReplacement, type ClassifyReplacementInput, type ClassifyReplacementDecision } from './classifier.js';

export {
  applyReplacement,
  readReplacementDecision,
  projectReplacementMetadata,
  createInMemoryContentRef,
  newReplacementMessageId,
  newReplacementIdempotencyKey,
  type ApplyReplacementInput,
  type ApplyReplacementSuccess,
  type ApplyReplacementFailure,
  type ApplyReplacementResult,
  type PersistedContentRef,
} from './applier.js';

export {
  LARGE_CONTENT_THRESHOLDS,
  DEFAULT_LARGE_CONTENT_POLICY,
  REPLACEMENT_DECISION_ORDER,
  type LargeContentPolicy,
  type LargeContentReasonCode,
} from './thresholds.js';

export { planAggregateOffload, type AggregateOffloadInput, type AggregateOffloadPlan, type AggregateOffloadDecision } from './aggregate-offloader.js';

export {
  readPersistedPreview,
  renderPersistedPreviewBlock,
  type ReadPreviewRequest,
  type ReadPreviewResult,
  type ReadPreviewStatus,
  type ReadPreviewOk,
  type ReadPreviewDegraded,
  type PreviewDegradationCode,
} from './preview-reader.js';

export { renderReadbackFileContent } from './readback-renderer.js';

export {
  classifySpecializedKind,
  renderSpecializedDescriptor,
  renderEmptyMarker,
  type SpecializedKind,
  type SpecializedDescriptorInput,
} from './specialized-binary.js';

export {
  createDefaultForkPromotionContentResolver,
  createDefaultLargeContentExternalizer,
  type DefaultLargeContentExternalizerDependencies,
} from './externalizer.js';
