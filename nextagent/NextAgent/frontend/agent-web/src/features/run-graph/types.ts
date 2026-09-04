import type { StreamEnvelope, StreamEventType, WireTimestamp } from '../../state/contracts.ts';

export type RunGraphStatus = 'pending' | 'running' | 'success' | 'failed' | 'canceled' | 'superseded' | 'waiting' | 'warning' | 'info';

export type RunGraphNodeKind = 'request' | 'model' | 'capability' | 'userInput' | 'degradation' | 'answer' | 'terminal';

export interface RunGraphEventReference {
  readonly eventId: string;
  readonly sequence: number;
  readonly eventType: StreamEventType;
  readonly createdAt: WireTimestamp | null;
}

export interface RunGraphNodeState {
  readonly id: string;
  readonly x6NodeId: string;
  readonly kind: RunGraphNodeKind;
  readonly phaseLabel: string;
  readonly title: string;
  readonly status: RunGraphStatus;
  readonly statusLabel: string;
  readonly eventLabel: string;
  readonly metricLabel: string;
  readonly summary: string;
  readonly detailLines: readonly string[];
  readonly startedAt: WireTimestamp | null;
  readonly updatedAt: WireTimestamp | null;
  readonly relatedEventIds: readonly string[];
  readonly relatedToolCallIds: readonly string[];
  readonly references: readonly RunGraphEventReference[];
}

export interface RunGraphEdgeState {
  readonly id: string;
  readonly x6EdgeId: string;
  readonly source: string;
  readonly target: string;
  readonly label: string | null;
  readonly status: RunGraphStatus;
}

export interface RunGraphActivityItem {
  readonly id: string;
  readonly type: RunGraphNodeKind;
  readonly title: string;
  readonly description: string;
  readonly timestamp: WireTimestamp | null;
  readonly status: RunGraphStatus;
  readonly statusLabel: string;
  readonly eventIds: readonly string[];
}

export interface RunGraphSummary {
  readonly eventCount: number;
  readonly nodeCount: number;
  readonly capabilityCount: number;
  readonly failedCapabilityCount: number;
  readonly startedAt: WireTimestamp | null;
  readonly updatedAt: WireTimestamp | null;
}

export interface RunGraphViewState {
  readonly runKey: string;
  readonly sessionId: string;
  readonly runId: string | null;
  readonly requestId: string | null;
  readonly rootMessageId: string;
  readonly requestContextId: string | null;
  readonly status: RunGraphStatus;
  readonly statusLabel: string;
  readonly summary: RunGraphSummary;
  readonly nodes: readonly RunGraphNodeState[];
  readonly edges: readonly RunGraphEdgeState[];
  readonly activities: readonly RunGraphActivityItem[];
  readonly latestNodeId: string | null;
  readonly latestRunningNodeId: string | null;
  readonly rawEvents: readonly StreamEnvelope[];
}

export type RunGraphTranslate = (key: string, options?: Record<string, string | number>) => string;
