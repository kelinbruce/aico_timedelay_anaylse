import type {
  ActiveContextStoreGateway,
  AttachmentIntakeReservationGateway,
  AttachmentStoreGateway,
  BlobStoreGateway,
  CheckpointStoreGateway,
  ConversationAnnotationStoreGateway,
  ConversationShareStoreGateway,
  UserQuestionActivityStoreGateway,
  LongTermMemoryRetrieverGateway,
  LongTermMemorySharingGateway,
  LongTermMemoryStoreGateway,
  PendingInputStoreGateway,
  RequestRunMemoryRecallAttemptGateway,
  RequestRunStoreGateway,
  RunTimelineEventStoreGateway,
  SessionMessageStoreGateway,
  SessionForkStoreGateway,
  SessionStoreGateway,
  TaskTrajectoryQueryGateway,
  TaskTrajectoryStoreGateway,
  TodoStateStoreGateway,
} from '@nextagent/agent-contracts/gateway';
export interface LocalGatewayStores {
  readonly requestRuns: RequestRunStoreGateway;
  readonly memoryRecallAttempts: RequestRunMemoryRecallAttemptGateway;
  readonly sessions: SessionStoreGateway;
  readonly messages: SessionMessageStoreGateway;
  readonly sessionForks: SessionForkStoreGateway;
  readonly attachments: AttachmentStoreGateway;
  readonly attachmentReservations: AttachmentIntakeReservationGateway;
  readonly blobs: BlobStoreGateway;
  readonly activeContext: ActiveContextStoreGateway;
  readonly timeline: RunTimelineEventStoreGateway;
  readonly taskTrajectoryStore: TaskTrajectoryStoreGateway;
  readonly taskTrajectoryQuery: TaskTrajectoryQueryGateway;
  readonly todoStateStore: TodoStateStoreGateway;
  readonly checkpoints: CheckpointStoreGateway;
  readonly longTermMemoryStore: LongTermMemoryStoreGateway;
  readonly longTermMemoryRetriever: LongTermMemoryRetrieverGateway;
  readonly longTermMemorySharing: LongTermMemorySharingGateway;
  readonly pendingInputs: PendingInputStoreGateway;
  readonly conversationAnnotations: ConversationAnnotationStoreGateway;
  readonly conversationShares: ConversationShareStoreGateway;
  readonly userQuestionActivity: UserQuestionActivityStoreGateway;
  readonly gatewayKind: 'sqlite';
  close?: () => void;
}

export interface LocalWorkingMemoryStores {
  readonly requestRuns: RequestRunStoreGateway;
  readonly memoryRecallAttempts: RequestRunMemoryRecallAttemptGateway;
  readonly sessions: SessionStoreGateway;
  readonly messages: SessionMessageStoreGateway;
  readonly sessionForks: SessionForkStoreGateway;
  readonly attachments: AttachmentStoreGateway;
  readonly activeContext: ActiveContextStoreGateway;
  readonly timeline: RunTimelineEventStoreGateway;
  readonly checkpoints: CheckpointStoreGateway;
  readonly pendingInputs: PendingInputStoreGateway;
  readonly conversationAnnotations: ConversationAnnotationStoreGateway;
  readonly conversationShares: ConversationShareStoreGateway;
  close: () => void;
}

export interface LocalLongTermMemoryStores {
  readonly store: LongTermMemoryStoreGateway;
  readonly retriever: LongTermMemoryRetrieverGateway;
  readonly sharing: LongTermMemorySharingGateway;
  close: () => void;
}

export interface LocalSqliteStores {
  readonly attachmentReservations: AttachmentIntakeReservationGateway;
  readonly blobs: BlobStoreGateway;
  readonly taskTrajectoryStore: TaskTrajectoryStoreGateway;
  readonly taskTrajectoryQuery: TaskTrajectoryQueryGateway;
  readonly todoStateStore: TodoStateStoreGateway;
  readonly userQuestionActivity: UserQuestionActivityStoreGateway;
  close: () => void;
}
