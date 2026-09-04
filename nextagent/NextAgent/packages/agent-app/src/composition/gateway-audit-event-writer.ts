import type { AuditEventRecord, AuditEventStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { AuditEvent, AuditEventWriter } from '@nextagent/agent-observability';

export class GatewayAuditEventWriter implements AuditEventWriter {
  constructor(private readonly gateway: AuditEventStoreGateway) {}

  async write(event: AuditEvent): Promise<void> {
    await this.gateway.appendAuditEvent(toAuditEventRecord(event));
  }
}

export function createGatewayAuditEventWriter(gateway: AuditEventStoreGateway): GatewayAuditEventWriter {
  return new GatewayAuditEventWriter(gateway);
}

function toAuditEventRecord(event: AuditEvent): AuditEventRecord {
  if (event.agentId === undefined) {
    throw new TypeError('Audit event requires trusted agent scope.');
  }
  return {
    auditId: event.auditId,
    eventName: event.eventName,
    tenantId: event.tenantId,
    subjectId: event.subjectId,
    agentId: event.agentId,
    ...(event.requestRunId === undefined ? {} : { requestRunId: event.requestRunId }),
    ...(event.capabilityInvocationId === undefined ? {} : { capabilityInvocationId: event.capabilityInvocationId }),
    safeSummary: event.safeSummary,
    attributes: event.attributes,
    occurredAt: event.occurredAt,
  };
}
