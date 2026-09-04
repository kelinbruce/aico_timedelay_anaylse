import type { AgentId, CapabilityInvocationId, EpochMillis, RequestRunId, SubjectId, TenantId } from '@nextagent/agent-common';

export type AttributeValue = string | number | boolean | readonly string[] | readonly number[] | readonly boolean[];
export type Attributes = Readonly<Record<string, AttributeValue>>;

export interface AuditEvent {
  readonly auditId: string;
  readonly eventName: string;
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId?: AgentId;
  readonly requestRunId?: RequestRunId;
  readonly capabilityInvocationId?: CapabilityInvocationId;
  readonly safeSummary: string;
  readonly attributes: Attributes;
  readonly occurredAt: EpochMillis;
}

export interface AuditEventWriter {
  write: (event: AuditEvent) => Promise<void>;
}
