import { AgentError, bindRuntimeLoggerProvider, brand, noopRuntimeLogger, type JsonObject } from '@nextagent/agent-common';
import type {
  ActiveContextStoreGateway,
  DeleteSessionCascadeResult,
  SessionRecord,
  SessionMessageStoreGateway,
  SessionStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import { createUserSessionService } from '../src/services/session-preparation.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

let unbindLogger: (() => void) | undefined;
afterEach(() => unbindLogger?.());

const identityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-delete-service'),
  subjectId: brand<string, 'SubjectId'>('subject-delete-service'),
  displayName: 'delete-service-user',
};
const agentId = brand<string, 'AgentId'>('agent-delete-service');
const sessionId = brand<string, 'SessionId'>('session-delete-service');

describe('UserSessionService.deleteSession', () => {
  it('delegates a trusted owner and agent scoped composite delete', async () => {
    const deleteSessionCascade = vi.fn(async (): Promise<DeleteSessionCascadeResult> => ({ status: 'DELETED' }));
    const invalidateDeletedSession = vi.fn();
    const service = createService(deleteSessionCascade, invalidateDeletedSession);

    await service.deleteSession({ identityContext, agentId, sessionId });

    expect(deleteSessionCascade).toHaveBeenCalledWith({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
    });
    expect(invalidateDeletedSession).toHaveBeenCalledWith({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
    });
  });

  it('maps missing scoped sessions to SESSION_NOT_FOUND', async () => {
    const invalidateDeletedSession = vi.fn();
    const service = createService(
      vi.fn(async (): Promise<DeleteSessionCascadeResult> => ({ status: 'NOT_FOUND' })),
      invalidateDeletedSession,
    );

    await expect(service.deleteSession({ identityContext, agentId, sessionId })).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
      category: 'NOT_FOUND',
      retryable: false,
    });
    expect(invalidateDeletedSession).not.toHaveBeenCalled();
  });

  it('maps active run conflicts to SESSION_DELETE_CONFLICT', async () => {
    const invalidateDeletedSession = vi.fn();
    const service = createService(
      vi.fn(async (): Promise<DeleteSessionCascadeResult> => ({ status: 'CONFLICT_ACTIVE_RUN' })),
      invalidateDeletedSession,
    );

    await expect(service.deleteSession({ identityContext, agentId, sessionId })).rejects.toMatchObject({
      code: 'SESSION_DELETE_CONFLICT',
      category: 'CONFLICT',
      retryable: true,
    });
    expect(invalidateDeletedSession).not.toHaveBeenCalled();
  });

  it('does not remap storage failures raised by the gateway', async () => {
    const service = createService(
      vi.fn(async () => {
        throw new AgentError({
          code: 'LOCAL_STORE_UNAVAILABLE',
          message: 'Local session store is unavailable.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }),
    );

    await expect(service.deleteSession({ identityContext, agentId, sessionId })).rejects.toMatchObject({
      code: 'LOCAL_STORE_UNAVAILABLE',
      category: 'UNAVAILABLE',
      retryable: true,
    });
  });

  it('does not roll back a durable delete when Activity invalidation fails', async () => {
    const service = createService(
      vi.fn(async (): Promise<DeleteSessionCascadeResult> => ({ status: 'DELETED' })),
      vi.fn(() => {
        throw new Error('activity sidecar unavailable');
      }),
    );

    await expect(service.deleteSession({ identityContext, agentId, sessionId })).resolves.toBeUndefined();
  });

  it('logs successful owner checks at debug and rejected owner checks at warn', async () => {
    const entries: Array<{ readonly level: string; readonly fields: JsonObject }> = [];
    const binding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        ...noopRuntimeLogger,
        debug: (fields) => entries.push({ level: 'debug', fields: fields as JsonObject }),
        info: (fields) => entries.push({ level: 'info', fields: fields as JsonObject }),
        warn: (fields) => entries.push({ level: 'warn', fields: fields as JsonObject }),
      }),
    });
    unbindLogger = binding.unbind;
    const deleteSessionCascade = vi.fn(async (): Promise<DeleteSessionCascadeResult> => ({ status: 'DELETED' }));

    await createService(deleteSessionCascade).deleteSession({ identityContext, agentId, sessionId });
    const mismatchedRecord: SessionRecord = {
      tenantId: brand<string, 'TenantId'>('other-tenant'),
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(0),
      updatedAt: brand<number, 'EpochMillis'>(0),
    };
    await expect(
      createService(deleteSessionCascade, undefined, mismatchedRecord).deleteSession({ identityContext, agentId, sessionId }),
    ).rejects.toMatchObject({
      code: 'SESSION_ACCESS_DENIED',
    });

    expect(entries.filter((entry) => entry.fields.event === 'session.owner-scope-check')).toEqual([
      expect.objectContaining({ level: 'debug', fields: expect.objectContaining({ event: 'session.owner-scope-check' }) }),
      expect.objectContaining({
        level: 'warn',
        fields: expect.objectContaining({ event: 'session.owner-scope-check', safeReasonCode: 'SESSION_OWNER_SCOPE_MISMATCH' }),
      }),
    ]);
  });
});

function createService(
  deleteSessionCascade: SessionStoreGateway['deleteSessionCascade'],
  invalidateDeletedSession?: (coordinates: {
    readonly tenantId: typeof identityContext.tenantId;
    readonly subjectId: typeof identityContext.subjectId;
    readonly agentId: typeof agentId;
    readonly sessionId: typeof sessionId;
  }) => void,
  sessionRecordOverride?: SessionRecord,
) {
  const sessionRecord: SessionRecord = sessionRecordOverride ?? {
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    sessionId,
    createdAt: brand<number, 'EpochMillis'>(0),
    updatedAt: brand<number, 'EpochMillis'>(0),
  };
  return createUserSessionService({
    sessionStore: { deleteSessionCascade, loadSession: vi.fn(async () => sessionRecord) } as unknown as SessionStoreGateway,
    messageStore: {} as SessionMessageStoreGateway,
    activeContextStore: {} as ActiveContextStoreGateway,
    ...(invalidateDeletedSession === undefined ? {} : { invalidateDeletedSession }),
  });
}
