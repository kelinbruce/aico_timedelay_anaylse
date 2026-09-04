import type { AuditEvent, AuditEventWriter } from './audit-event.js';

export class NoopAuditEventWriter implements AuditEventWriter {
  readonly writes: AuditEvent[] = [];

  async write(event: AuditEvent): Promise<void> {
    this.writes.push(event);
  }
}

export function createNoopAuditEventWriter(): NoopAuditEventWriter {
  return new NoopAuditEventWriter();
}
