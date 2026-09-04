import type {
  ActiveContextStoreGateway,
  AttachmentIntakeReservationGateway,
  AttachmentStoreGateway,
  BlobStoreGateway,
  CheckpointStoreGateway,
  ConversationAnnotationStoreGateway,
  ConversationShareStoreGateway,
  LongTermMemoryRetrieverGateway,
  LongTermMemorySharingGateway,
  LongTermMemoryStoreGateway,
  PendingInputStoreGateway,
  RequestRunMemoryRecallAttemptGateway,
  RequestRunStoreGateway,
  RunTimelineEventStoreGateway,
  SessionForkStoreGateway,
  SessionMessageStoreGateway,
  SessionStoreGateway,
  TaskTrajectoryQueryGateway,
  TaskTrajectoryStoreGateway,
  TodoStateStoreGateway,
  UserQuestionActivityStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { LocalGatewayStores, LocalLongTermMemoryStores, LocalSqliteStores, LocalWorkingMemoryStores } from '../stores/local-gateway-stores.js';
import { SqliteActiveContextStore } from './sqlite-active-context-store.js';
import { SqliteAttachmentStore } from './sqlite-attachment-store.js';
import { SqliteCheckpointStore } from './sqlite-checkpoint-store.js';
import { SqliteConversationAnnotationStore } from './sqlite-conversation-annotation-store.js';
import { SqliteConversationShareStore } from './sqlite-conversation-share-store.js';
import {
  SqliteGatewayCore,
  SqliteLongTermMemoryCore,
  SqliteResidualGatewayCore,
  SqliteWorkingMemoryCore,
  type SqliteGatewayStoresOptions,
} from './sqlite-gateway-core.js';
import { SqliteLongTermMemoryStore } from './sqlite-long-term-memory-store.js';
import { SqliteMessageStore } from './sqlite-message-store.js';
import { SqliteMemoryRecallAttemptStore } from './sqlite-memory-recall-attempt-store.js';
import { SqlitePendingInputStore } from './sqlite-pending-input-store.js';
import { SqliteRequestRunStore } from './sqlite-request-run-store.js';
import { SqliteSessionForkStore } from './sqlite-session-fork-store.js';
import type { LocalForkActiveContextSelector } from './sqlite-session-fork-application.js';
import { SqliteSessionStore } from './sqlite-session-store.js';
import { SqliteTaskTrajectoryStore } from './sqlite-task-trajectory-store.js';
import { SqliteTimelineStore } from './sqlite-timeline-store.js';
import { SqliteTodoStateStore } from './sqlite-todo-state-store.js';
import { SqliteUserQuestionActivityStore } from './sqlite-user-question-activity-store.js';

export type { SqliteGatewayStoresOptions } from './sqlite-gateway-core.js';

export interface SqliteWorkingMemoryStoresOptions extends SqliteGatewayStoresOptions {
  readonly forkActiveContextSelector?: LocalForkActiveContextSelector;
}

export class SqliteWorkingMemoryStores implements LocalWorkingMemoryStores {
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

  private readonly core: SqliteWorkingMemoryCore;
  private closed = false;

  constructor(options: SqliteWorkingMemoryStoresOptions) {
    this.core = new SqliteWorkingMemoryCore(options);
    this.requestRuns = new SqliteRequestRunStore(this.core);
    this.memoryRecallAttempts = new SqliteMemoryRecallAttemptStore(this.core);
    this.sessions = new SqliteSessionStore(this.core);
    this.messages = new SqliteMessageStore(this.core);
    this.sessionForks = new SqliteSessionForkStore(
      this.core,
      options.forkActiveContextSelector === undefined ? {} : { activeContextSelector: options.forkActiveContextSelector },
    );
    this.attachments = new SqliteAttachmentStore(this.core);
    this.activeContext = new SqliteActiveContextStore(this.core);
    this.timeline = new SqliteTimelineStore(this.core);
    this.checkpoints = new SqliteCheckpointStore(this.core);
    this.pendingInputs = new SqlitePendingInputStore(this.core);
    this.conversationAnnotations = new SqliteConversationAnnotationStore(this.core);
    this.conversationShares = new SqliteConversationShareStore(this.core);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.core.close();
  }
}

export class SqliteLongTermMemoryStores implements LocalLongTermMemoryStores {
  readonly store: LongTermMemoryStoreGateway;
  readonly retriever: LongTermMemoryRetrieverGateway;
  readonly sharing: LongTermMemorySharingGateway;

  private readonly core: SqliteLongTermMemoryCore;
  private closed = false;

  constructor(options: SqliteGatewayStoresOptions) {
    this.core = new SqliteLongTermMemoryCore(options);
    const store = new SqliteLongTermMemoryStore(this.core);
    this.store = store;
    this.retriever = store;
    this.sharing = store;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.core.close();
  }
}

export class SqliteResidualGatewayStores implements LocalSqliteStores {
  readonly attachmentReservations: AttachmentIntakeReservationGateway;
  readonly blobs: BlobStoreGateway;
  readonly taskTrajectoryStore: TaskTrajectoryStoreGateway;
  readonly taskTrajectoryQuery: TaskTrajectoryQueryGateway;
  readonly todoStateStore: TodoStateStoreGateway;
  readonly userQuestionActivity: UserQuestionActivityStoreGateway;

  private readonly core: SqliteResidualGatewayCore;
  private closed = false;

  constructor(options: SqliteGatewayStoresOptions) {
    this.core = new SqliteResidualGatewayCore(options);
    const attachmentStore = new SqliteAttachmentStore(this.core);
    this.attachmentReservations = attachmentStore;
    this.blobs = attachmentStore;
    const trajectoryStore = new SqliteTaskTrajectoryStore(this.core);
    this.taskTrajectoryStore = trajectoryStore;
    this.taskTrajectoryQuery = trajectoryStore;
    this.todoStateStore = new SqliteTodoStateStore(this.core);
    this.userQuestionActivity = new SqliteUserQuestionActivityStore(this.core);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.core.close();
  }
}

export function createSqliteWorkingMemoryStores(options: SqliteWorkingMemoryStoresOptions): SqliteWorkingMemoryStores {
  return new SqliteWorkingMemoryStores(options);
}

export function createSqliteLongTermMemoryStores(options: SqliteGatewayStoresOptions): SqliteLongTermMemoryStores {
  return new SqliteLongTermMemoryStores(options);
}

export function createSqliteResidualGatewayStores(options: SqliteGatewayStoresOptions): SqliteResidualGatewayStores {
  return new SqliteResidualGatewayStores(options);
}

export class SqliteGatewayStores implements LocalGatewayStores {
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
  readonly gatewayKind = 'sqlite' as const;
  readonly sqliteFile: string;

  private readonly core: SqliteGatewayCore;

  constructor(options: SqliteWorkingMemoryStoresOptions) {
    this.core = new SqliteGatewayCore(options);
    this.sqliteFile = this.core.sqliteFile;

    this.requestRuns = new SqliteRequestRunStore(this.core);
    this.memoryRecallAttempts = new SqliteMemoryRecallAttemptStore(this.core);
    this.sessions = new SqliteSessionStore(this.core);
    this.messages = new SqliteMessageStore(this.core);
    this.sessionForks = new SqliteSessionForkStore(
      this.core,
      options.forkActiveContextSelector === undefined ? {} : { activeContextSelector: options.forkActiveContextSelector },
    );

    const attachmentStore = new SqliteAttachmentStore(this.core);
    this.attachments = attachmentStore;
    this.attachmentReservations = attachmentStore;
    this.blobs = attachmentStore;

    this.activeContext = new SqliteActiveContextStore(this.core);
    this.timeline = new SqliteTimelineStore(this.core);

    const taskTrajectoryStore = new SqliteTaskTrajectoryStore(this.core);
    this.taskTrajectoryStore = taskTrajectoryStore;
    this.taskTrajectoryQuery = taskTrajectoryStore;

    this.todoStateStore = new SqliteTodoStateStore(this.core);
    this.checkpoints = new SqliteCheckpointStore(this.core);

    const longTermMemoryStore = new SqliteLongTermMemoryStore(this.core);
    this.longTermMemoryStore = longTermMemoryStore;
    this.longTermMemoryRetriever = longTermMemoryStore;
    this.longTermMemorySharing = longTermMemoryStore;

    this.pendingInputs = new SqlitePendingInputStore(this.core);
    this.conversationAnnotations = new SqliteConversationAnnotationStore(this.core);
    this.conversationShares = new SqliteConversationShareStore(this.core);
    this.userQuestionActivity = new SqliteUserQuestionActivityStore(this.core);
  }

  close(): void {
    this.core.close();
  }
}

export function createSqliteGatewayStores(options: SqliteWorkingMemoryStoresOptions): SqliteGatewayStores {
  return new SqliteGatewayStores(options);
}
