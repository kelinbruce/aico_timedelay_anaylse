import type { RequestRunRecord } from '@nextagent/agent-contracts/gateway';
import { type RequestRun, type SubmitRequestCommand } from '@nextagent/agent-contracts/runtime';

export function toRunRecord(run: RequestRun, command: SubmitRequestCommand): RequestRunRecord {
  return {
    tenantId: command.identityContext.tenantId,
    subjectId: command.identityContext.subjectId,
    runId: run.runId,
    sessionId: run.sessionId,
    requestId: run.requestId,
    agentId: run.agentId,
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    attempt: run.attempt,
    ...(run.retryOfRunId === undefined ? {} : { retryOfRunId: run.retryOfRunId }),
    ...(run.parentRunId === undefined ? {} : { parentRunId: run.parentRunId }),
    ...(run.parentRequestId === undefined ? {} : { parentRequestId: run.parentRequestId }),
    ...(run.priority === undefined ? {} : { priority: run.priority }),
    status: run.status,
    version: run.version,
    terminalCommitState: run.terminalCommitState,
    ...(run.lockedBy === undefined ? {} : { lockedBy: run.lockedBy }),
    ...(run.lockExpiresAt === undefined ? {} : { lockExpiresAt: run.lockExpiresAt }),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
