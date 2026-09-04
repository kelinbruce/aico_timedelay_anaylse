export type RemoteAuditSinkWriteOutcome = 'accepted' | 'degraded' | 'failed_closed';

export interface RemoteAuditSinkWriteResult {
  readonly outcome: RemoteAuditSinkWriteOutcome;
  readonly safeReasonCode?: string;
}

export interface RemoteAuditSinkAdapter<TAuditEvent = unknown> {
  writeAuditEvent: (event: TAuditEvent) => Promise<RemoteAuditSinkWriteResult>;
}

export function createUnsupportedRemoteAuditSinkAdapter<TAuditEvent = unknown>(): RemoteAuditSinkAdapter<TAuditEvent> {
  return {
    async writeAuditEvent() {
      return { outcome: 'degraded', safeReasonCode: 'REMOTE_AUDIT_SINK_UNIMPLEMENTED' };
    },
  };
}
