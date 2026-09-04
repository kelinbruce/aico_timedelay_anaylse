import type {
  AgentId,
  AgentVersion,
  EpochMillis,
  MessageId,
  RequestContextId,
  RequestRunId,
  RestrictedOperationKind,
  RiskLevel,
  RiskPolicyOutcome,
  SessionId,
} from '@nextagent/agent-common';

export interface RiskPolicyEvaluation {
  readonly occurredAt: EpochMillis;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly requestRunId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly operationKind: RestrictedOperationKind;
  readonly operationId: string;
  readonly outcome: RiskPolicyOutcome;
  readonly riskLevel: RiskLevel;
  readonly reasonCode: string;
  readonly capabilityId?: string;
  readonly providerId?: string;
  readonly toolCallId?: string;
  readonly authorizationScopeMatched?: boolean;
  readonly sandboxRequired?: boolean;
  readonly sandboxReady?: boolean;
  readonly policyId?: string;
  readonly policyVersion?: string;
}

export type ExecutionCorrelationKind = 'REQUEST' | 'MODEL' | 'CAPABILITY' | 'WORKFLOW_NODE';

export interface ExecutionCorrelationRef {
  readonly requestRunId: string;
  readonly kind: ExecutionCorrelationKind;
  readonly executionId: string;
}

export interface W3CTraceCarrier {
  readonly traceparent?: string;
  readonly tracestate?: string;
}

export interface ExecutionCorrelationPort {
  withIncomingCarrier: <T>(carrier: W3CTraceCarrier | undefined, operation: () => Promise<T>) => Promise<T>;

  withExecutionRef: <T>(ref: ExecutionCorrelationRef, operation: () => Promise<T>) => Promise<T>;

  outboundHeaders: (input?: Readonly<Record<string, string>>) => Readonly<Record<string, string>>;
}
