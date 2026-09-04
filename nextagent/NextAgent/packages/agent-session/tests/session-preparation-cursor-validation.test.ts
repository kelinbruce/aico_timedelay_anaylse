import {
  brand,
  type AgentId,
  type EpochMillis,
  type IdentityContext,
  type MessageId,
  type RequestRunId,
  type SessionId,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type {
  ActiveContextStoreGateway,
  SessionMessageRecord,
  SessionMessageStoreGateway,
  SessionRecord,
  SessionStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import { createUserSessionService } from '../src/services/session-preparation.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The release vitest config binds a noop runtime logger globally via tests/setup.ts; this file
// relies on that binding and does not rebind it.
let unbindLogger: (() => void) | undefined;
afterEach(() => unbindLogger?.());

const tenantId = 'T-cursor' as TenantId;
const subjectId = 'U-cursor' as SubjectId;
const agentId = 'A-cursor' as AgentId;
const sessionId = 'S-cursor' as SessionId;
const otherSessionId = 'S-other' as SessionId;

const identityContext: IdentityContext = {
  tenantId,
  subjectId,
  displayName: 'cursor-test-user',
};

const sessionRecord: SessionRecord = {
  tenantId,
  subjectId,
  agentId,
  sessionId,
  createdAt: brand<number, 'EpochMillis'>(0),
  updatedAt: brand<number, 'EpochMillis'>(0),
};

function makeMessageRecord(overrides: Partial<Omit<SessionMessageRecord, 'messageId'>> & { readonly messageId: string }): SessionMessageRecord {
  return {
    tenantId,
    subjectId,
    agentId,
    sessionId,
    requestId: 'req-1' as MessageId,
    runId: 'run-1' as RequestRunId,
    role: 'USER',
    content: 'hello',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
    ...overrides,
    messageId: brand<string, 'MessageId'>(overrides.messageId),
  };
}

interface CreateServiceOptions {
  readonly loadMessage?: SessionMessageStoreGateway['loadMessage'];
  readonly listMessages?: SessionMessageStoreGateway['listMessages'];
  readonly sessionRecord?: SessionRecord;
}

function createService(options: CreateServiceOptions = {}) {
  return createUserSessionService({
    sessionStore: {
      loadSession: vi.fn(async () => options.sessionRecord ?? sessionRecord),
    } as unknown as SessionStoreGateway,
    messageStore: {
      loadMessage: options.loadMessage ?? vi.fn(async () => undefined),
      listMessages: options.listMessages ?? vi.fn(async () => ({ items: [], limit: 50, hasMore: false })),
    } as unknown as SessionMessageStoreGateway,
    activeContextStore: {} as ActiveContextStoreGateway,
  });
}

const baseQuery = {
  identityContext,
  agentId,
  sessionId,
  includeCapabilityResults: false,
  limit: 50,
};

describe('UserSessionService.listMessages cursor existence precheck', () => {
  it('throws SESSION_MESSAGE_ANCHOR_NOT_FOUND when anchorMessageId does not resolve', async () => {
    const service = createService({ loadMessage: vi.fn(async () => undefined) });
    await expect(service.listMessages({ ...baseQuery, anchorMessageId: 'msg-missing' as MessageId })).rejects.toMatchObject({
      code: 'SESSION_MESSAGE_ANCHOR_NOT_FOUND',
      category: 'NOT_FOUND',
      retryable: false,
    });
  });

  it('throws when anchorMessageId resolves to a different session (cross-session guard)', async () => {
    const service = createService({
      loadMessage: vi.fn(async () => makeMessageRecord({ messageId: 'msg-x', sessionId: otherSessionId })),
    });
    await expect(service.listMessages({ ...baseQuery, anchorMessageId: 'msg-x' as MessageId })).rejects.toMatchObject({
      code: 'SESSION_MESSAGE_ANCHOR_NOT_FOUND',
    });
  });

  it('throws when anchorMessageId resolves but the store returns an empty page (memory hidden-anchor gap)', async () => {
    // Memory returns an empty set for a hidden anchor; the service must still surface NOT_FOUND
    // rather than transparently returning items: [].
    const service = createService({
      loadMessage: vi.fn(async () => makeMessageRecord({ messageId: 'msg-anchor', visible: false })),
      listMessages: vi.fn(async () => ({ items: [], limit: 50, hasMore: false })),
    });
    await expect(service.listMessages({ ...baseQuery, anchorMessageId: 'msg-anchor' as MessageId })).rejects.toMatchObject({
      code: 'SESSION_MESSAGE_ANCHOR_NOT_FOUND',
    });
  });

  it('returns the page when anchorMessageId resolves and the store returns items', async () => {
    const anchor = makeMessageRecord({ messageId: 'msg-anchor' });
    const service = createService({
      loadMessage: vi.fn(async () => anchor),
      listMessages: vi.fn(async () => ({ items: [anchor], limit: 50, hasMore: false })),
    });
    const page = await service.listMessages({ ...baseQuery, anchorMessageId: 'msg-anchor' as MessageId });
    expect(page.items.map((m) => m.messageId)).toEqual(['msg-anchor']);
  });

  it('throws SESSION_MESSAGE_ANCHOR_NOT_FOUND when beforeCursor (cursor) does not resolve', async () => {
    const service = createService({ loadMessage: vi.fn(async () => undefined) });
    await expect(service.listMessages({ ...baseQuery, beforeCursor: 'msg-missing' })).rejects.toMatchObject({
      code: 'SESSION_MESSAGE_ANCHOR_NOT_FOUND',
      category: 'NOT_FOUND',
    });
  });

  it('throws when afterCursor (newerCursor) resolves to a different session', async () => {
    const service = createService({
      loadMessage: vi.fn(async () => makeMessageRecord({ messageId: 'msg-x', sessionId: otherSessionId })),
    });
    await expect(service.listMessages({ ...baseQuery, afterCursor: 'msg-x' })).rejects.toMatchObject({ code: 'SESSION_MESSAGE_ANCHOR_NOT_FOUND' });
  });

  it('returns an empty page (paging boundary) when beforeCursor resolves but the store has no older messages', async () => {
    const service = createService({
      loadMessage: vi.fn(async () => makeMessageRecord({ messageId: 'msg-cursor' })),
      listMessages: vi.fn(async () => ({ items: [], limit: 50, hasMore: false })),
    });
    const page = await service.listMessages({ ...baseQuery, beforeCursor: 'msg-cursor' });
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('returns an empty page (paging boundary) when afterCursor resolves but the store has no newer messages', async () => {
    const service = createService({
      loadMessage: vi.fn(async () => makeMessageRecord({ messageId: 'msg-cursor' })),
      listMessages: vi.fn(async () => ({ items: [], limit: 50, hasMore: false })),
    });
    const page = await service.listMessages({ ...baseQuery, afterCursor: 'msg-cursor' });
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('does not precheck when no cursor/anchor is supplied (first page)', async () => {
    const loadMessage = vi.fn(async () => undefined);
    const service = createService({
      loadMessage,
      listMessages: vi.fn(async () => ({ items: [makeMessageRecord({ messageId: 'msg-1' })], limit: 50, hasMore: false })),
    });
    const page = await service.listMessages({ ...baseQuery });
    expect(page.items.map((m) => m.messageId)).toEqual(['msg-1']);
    expect(loadMessage).not.toHaveBeenCalled();
  });
});
