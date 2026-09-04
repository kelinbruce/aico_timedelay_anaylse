import { brand } from '@nextagent/agent-common';
import type { ForkActiveContextMessage, ForkActiveContextSelectionPort } from '@nextagent/agent-contracts/context';
import type {
  ForkPromotionContent,
  ForkSessionRequest,
  PrepareForkRequest,
  SessionForkStoreGateway,
  StageForkPromotionRequest,
} from '@nextagent/agent-contracts/gateway';
import {
  ForkSessionRequestSchema,
  ForkSessionResultSchema,
  PrepareForkRequestSchema,
  PrepareForkResultSchema,
  StageForkPromotionRequestSchema,
  StageForkPromotionResultSchema,
} from '@nextagent/agent-contracts/gateway';
import { Value } from '@sinclair/typebox/value';
import type {
  RuntimeForkSessionFromMessageCommand,
  RuntimeForkSessionFromRequestCommand,
  RuntimeSessionPort,
} from '@nextagent/agent-contracts/runtime';
import type { ForkNotice, SessionMessagePage, UserSession } from '@nextagent/agent-contracts/session';
import { describe, expect, it } from 'vitest';

const owner = {
  tenantId: brand<string, 'TenantId'>('tenant-fork-contract'),
  subjectId: brand<string, 'SubjectId'>('subject-fork-contract'),
  agentId: brand<string, 'AgentId'>('agent-fork-contract'),
};
const sourceSessionId = brand<string, 'SessionId'>('source-session');
const sourceMessageId = brand<string, 'MessageId'>('source-message');
const sourceRequestId = brand<string, 'MessageId'>('source-request');
const idempotencyKey = brand<string, 'IdempotencyKey'>('fork-key');
const forkAttemptId = brand<string, 'ForkAttemptId'>('fork-attempt');

describe('session fork public contracts', () => {
  it('keeps fork notice on message pages and out of UserSession', () => {
    const notice: ForkNotice = { sourceSessionId, sourceSessionTitle: 'Source title' };
    const page: SessionMessagePage = { items: [], limit: 20, hasMore: false, forkNotice: notice };
    const session: UserSession = {
      ...owner,
      sessionId: brand<string, 'SessionId'>('child-session'),
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    };
    expect(page.forkNotice).toEqual(notice);
    expect(Object.hasOwn(session, 'forkNotice')).toBe(false);
  });

  it('keeps message and request anchors as separate runtime commands with optional cancellation', async () => {
    const identityContext = { tenantId: owner.tenantId, subjectId: owner.subjectId, displayName: 'fork tester' };
    const messageCommand: RuntimeForkSessionFromMessageCommand = {
      identityContext,
      sourceSessionId,
      sourceAnchorMessageId: sourceMessageId,
      idempotencyKey,
    };
    const requestCommand: RuntimeForkSessionFromRequestCommand = {
      identityContext,
      sourceSessionId,
      sourceRequestId,
      idempotencyKey,
    };
    const signals: Array<AbortSignal | undefined> = [];
    const child: UserSession = {
      ...owner,
      sessionId: brand<string, 'SessionId'>('child-session'),
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    };
    const runtime: Pick<RuntimeSessionPort, 'forkFromMessage' | 'forkFromRequest'> = {
      async forkFromMessage(command: RuntimeForkSessionFromMessageCommand, signal?: AbortSignal) {
        expect(command).toBe(messageCommand);
        signals.push(signal);
        return { childSession: child };
      },
      async forkFromRequest(command: RuntimeForkSessionFromRequestCommand, signal?: AbortSignal) {
        expect(command).toBe(requestCommand);
        signals.push(signal);
        return { childSession: child };
      },
    };
    const controller = new AbortController();
    await expect(runtime.forkFromMessage(messageCommand, controller.signal)).resolves.toEqual({ childSession: child });
    await expect(runtime.forkFromRequest(requestCommand, controller.signal)).resolves.toEqual({ childSession: child });
    expect(signals).toEqual([controller.signal, controller.signal]);
    expect(Object.hasOwn(messageCommand, 'sourceRequestId')).toBe(false);
    expect(Object.hasOwn(requestCommand, 'sourceAnchorMessageId')).toBe(false);
  });

  it('keeps context selector input narrowed to copied child messages', async () => {
    const copied: ForkActiveContextMessage = {
      ...owner,
      sessionId: brand<string, 'SessionId'>('child-session'),
      messageId: brand<string, 'MessageId'>('child-anchor'),
      requestId: brand<string, 'MessageId'>('child-request'),
      role: 'ASSISTANT',
      content: 'done',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(1),
    };
    const selector: ForkActiveContextSelectionPort = {
      async select(request) {
        expect(request.copiedMessages).toEqual([copied]);
        return { messageIds: [request.childAnchorMessageId] };
      },
    };
    await expect(
      selector.select({ childSessionId: copied.sessionId, childAnchorMessageId: copied.messageId, copiedMessages: [copied] }),
    ).resolves.toEqual({ messageIds: [copied.messageId] });
  });

  it('defines the bounded prepare, stage and success-only fork shapes', async () => {
    const prepare: PrepareForkRequest = { ...owner, sourceSessionId, sourceMessageId, idempotencyKey };
    const fork: ForkSessionRequest = { ...prepare, forkAttemptId };
    const stage: StageForkPromotionRequest = {
      ...owner,
      forkAttemptId,
      sourceSessionId,
      sourceMessageId,
      sourceRefId: 'tool-results/result-1',
      refType: 'CAPABILITY_RESULT',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'text/plain',
      sizeBytes: 3,
    };
    const committed: ForkPromotionContent = {
      refType: stage.refType,
      bytes: stage.bytes,
      mimeType: stage.mimeType,
      sizeBytes: stage.sizeBytes,
    };
    const methods: Record<keyof SessionForkStoreGateway, true> = {
      prepareFork: true,
      stageForkPromotion: true,
      forkSession: true,
      abortForkPromotions: true,
      loadSessionForkSource: true,
      loadForkProcessSnapshotStatus: true,
      hasUserMessageAfterForkAnchor: true,
      loadCommittedForkPromotionContent: true,
      cleanupExpiredForkPromotions: true,
    };
    expect(Object.keys(methods).sort()).toEqual([
      'abortForkPromotions',
      'cleanupExpiredForkPromotions',
      'forkSession',
      'hasUserMessageAfterForkAnchor',
      'loadCommittedForkPromotionContent',
      'loadForkProcessSnapshotStatus',
      'loadSessionForkSource',
      'prepareFork',
      'stageForkPromotion',
    ]);
    expect(Object.keys(prepare).sort()).toEqual(['agentId', 'idempotencyKey', 'sourceMessageId', 'sourceSessionId', 'subjectId', 'tenantId']);
    expect(Object.keys(fork).sort()).toEqual([...Object.keys(prepare), 'forkAttemptId'].sort());
    expect(Object.keys(stage).sort()).not.toContain('childSessionId');
    expect(Object.keys(stage).sort()).not.toContain('blobRef');
    expect(Object.hasOwn(committed, 'blobRef')).toBe(false);
  });

  it('strictly validates gateway fork request and result DTOs', () => {
    const prepare = { ...owner, sourceSessionId, sourceMessageId, idempotencyKey };
    const requiredRef = {
      sourceMessageId,
      sourceRequestId,
      sourceRunId: brand<string, 'RequestRunId'>('source-run'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      refType: 'CAPABILITY_RESULT' as const,
      refId: 'tool-results/result-1',
    };
    const stage = {
      ...owner,
      forkAttemptId,
      sourceSessionId,
      sourceMessageId,
      sourceRefId: requiredRef.refId,
      refType: 'CAPABILITY_RESULT' as const,
      bytes: new Uint8Array([1]),
      mimeType: 'text/plain',
      sizeBytes: 1,
    };
    const childSession = {
      ...owner,
      sessionId: brand<string, 'SessionId'>('child-session'),
      title: 'Fork · Source title',
      titleSource: 'automatic' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(Value.Check(PrepareForkRequestSchema, prepare)).toBe(true);
    expect(Value.Check(PrepareForkResultSchema, { forkAttemptId, requiredContentRefs: [requiredRef], maxPromotedBytes: 10 })).toBe(true);
    expect(Value.Check(StageForkPromotionRequestSchema, stage)).toBe(true);
    expect(
      Value.Check(StageForkPromotionResultSchema, {
        forkAttemptId,
        sourceMessageId,
        sourceRefId: requiredRef.refId,
        promotedContentId: 'fork-promoted:1',
      }),
    ).toBe(true);
    expect(Value.Check(ForkSessionRequestSchema, { ...prepare, forkAttemptId })).toBe(true);
    expect(Value.Check(ForkSessionResultSchema, { childSession, replayed: false })).toBe(true);

    expect(Value.Check(PrepareForkRequestSchema, { ...prepare, sourceRequestId })).toBe(false);
    expect(Value.Check(PrepareForkRequestSchema, { ...owner, sourceSessionId, idempotencyKey })).toBe(false);
    expect(Value.Check(PrepareForkRequestSchema, { ...prepare, sourceMessageId: null })).toBe(false);
    expect(Value.Check(PrepareForkRequestSchema, { ...prepare, unknown: true })).toBe(false);
    expect(Value.Check(ForkSessionRequestSchema, { ...prepare, forkAttemptId: '' })).toBe(false);
    expect(Value.Check(StageForkPromotionRequestSchema, { ...stage, childSessionId: 'forbidden' })).toBe(false);
    expect(Value.Check(ForkSessionResultSchema, { childSession, replayed: false, error: {} })).toBe(false);
  });
});
