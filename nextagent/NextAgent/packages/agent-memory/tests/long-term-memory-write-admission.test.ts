import { brand, type SafeError } from '@nextagent/agent-common';
import type {
  GuardrailGatewayPort,
  LongTermMemoryRecord,
  LongTermMemoryStoreGateway,
  ManualSaveLongTermMemoryRequest,
  SaveLongTermMemoryRequest,
} from '@nextagent/agent-contracts/gateway';
import { createLongTermMemoryWriteCoordinator } from '../src/long-term-memory-write-coordinator.js';
import { describe, expect, it, vi } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-1');
const subjectId = brand<string, 'SubjectId'>('subject-1');
const agentId = brand<string, 'AgentId'>('agent-1');
const memoryId = brand<string, 'LongTermMemoryId'>('memory-1');
const now = brand<number, 'EpochMillis'>(100);

describe('long-term memory write admission', () => {
  it('checks the exact short admission text with privacy enabled before one save', async () => {
    const store = createStore();
    const checkKnowledge = vi.fn<GuardrailGatewayPort['checkKnowledge']>(async () => ({ isLegal: true }));
    const coordinator = createLongTermMemoryWriteCoordinator({
      store,
      guardrail: createGuardrail(checkKnowledge),
    });
    const request = saveRequest({
      briefIndex: 'BGP diagnosis',
      content: 'Inspect peer state.',
      labels: ['LABEL_CANARY'],
    });

    await expect(coordinator.saveLongTermMemory(request)).resolves.toEqual(record);

    expect(checkKnowledge).toHaveBeenCalledWith(
      {
        texts: ['BGP diagnosis\nInspect peer state.'],
        isPrivacy: true,
      },
      undefined,
    );
    expect(JSON.stringify(checkKnowledge.mock.calls)).not.toContain('LABEL_CANARY');
    expect(store.saveLongTermMemory).toHaveBeenCalledOnce();
    expect(store.saveLongTermMemory).toHaveBeenCalledWith(request, undefined);
    expect(checkKnowledge.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(store.saveLongTermMemory).mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it.each([
    {
      name: 'exactly 2000 code points',
      briefIndex: '',
      content: '😀'.repeat(1999),
      fragmentLengths: [2000],
    },
    {
      name: '2001 code points',
      briefIndex: '',
      content: '😀'.repeat(2000),
      fragmentLengths: [2000, 1],
    },
    {
      name: 'maximum valid memory text',
      briefIndex: '索'.repeat(2048),
      content: '文'.repeat(4000),
      fragmentLengths: [2000, 2000, 2000, 49],
    },
  ])('splits $name without omission', async ({ briefIndex, content, fragmentLengths }) => {
    const store = createStore();
    const checkKnowledge = vi.fn<GuardrailGatewayPort['checkKnowledge']>(async () => ({ isLegal: true }));
    const coordinator = createLongTermMemoryWriteCoordinator({
      store,
      guardrail: createGuardrail(checkKnowledge),
    });

    await coordinator.saveLongTermMemory(saveRequest({ briefIndex, content }));

    const texts = checkKnowledge.mock.calls[0]?.[0].texts ?? [];
    expect(texts.map((text) => Array.from(text).length)).toEqual(fragmentLengths);
    expect(texts.join('')).toBe(`${briefIndex}\n${content}`);
    expect(checkKnowledge).toHaveBeenCalledTimes(1);
    expect(store.saveLongTermMemory).toHaveBeenCalledOnce();
  });

  it('preserves order across batches of at most five fragments', async () => {
    const store = createStore();
    const checkKnowledge = vi.fn<GuardrailGatewayPort['checkKnowledge']>(async () => ({ isLegal: true }));
    const coordinator = createLongTermMemoryWriteCoordinator({
      store,
      guardrail: createGuardrail(checkKnowledge),
    });
    const content = Array.from({ length: 12_049 }, (_, index) => String(index % 10)).join('');

    await coordinator.saveLongTermMemory(saveRequest({ briefIndex: '', content }));

    expect(checkKnowledge).toHaveBeenCalledTimes(2);
    expect(checkKnowledge.mock.calls.map(([input]) => input.texts.length)).toEqual([5, 2]);
    expect(checkKnowledge.mock.calls.flatMap(([input]) => input.texts).join('')).toBe(`\n${content}`);
    expect(checkKnowledge.mock.calls.every(([input]) => input.isPrivacy === true)).toBe(true);
    expect(store.saveLongTermMemory).toHaveBeenCalledOnce();
  });

  it('stops on a blocked batch and never calls the store', async () => {
    const store = createStore();
    const checkKnowledge = vi
      .fn<GuardrailGatewayPort['checkKnowledge']>()
      .mockResolvedValueOnce({ isLegal: true })
      .mockResolvedValueOnce({ isLegal: false });
    const coordinator = createLongTermMemoryWriteCoordinator({
      store,
      guardrail: createGuardrail(checkKnowledge),
    });

    const result = await coordinator.saveLongTermMemory(
      saveRequest({
        briefIndex: '',
        content: 'x'.repeat(12_049),
      }),
    );

    expect(result).toEqual({
      code: 'LTM_CONTENT_GUARD_BLOCKED',
      message:
        'The security guardrail blocked this long-term memory write, so no memory was saved. Do not attempt to bypass the guardrail; continue without saving this content or stop and report the policy boundary.',
      category: 'POLICY_DENIED',
      retryable: false,
    });
    expect(checkKnowledge).toHaveBeenCalledTimes(2);
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it.each([
    {
      guardError: safeError('GUARDRAIL_KNOWLEDGE_UNAVAILABLE', 'UNAVAILABLE', true),
      expected: safeError('LTM_CONTENT_GUARD_UNAVAILABLE', 'UNAVAILABLE', true),
    },
    {
      guardError: safeError('GUARDRAIL_KNOWLEDGE_REQUEST_INVALID', 'VALIDATION', false),
      expected: safeError('LTM_CONTENT_GUARD_UNAVAILABLE', 'UNAVAILABLE', false),
    },
    {
      guardError: safeError('GUARDRAIL_KNOWLEDGE_CANCELED', 'CANCELED', false),
      expected: safeError('LTM_CONTENT_GUARD_CANCELED', 'CANCELED', false),
    },
  ])('maps $guardError.code without invoking the store', async ({ guardError, expected }) => {
    const store = createStore();
    const coordinator = createLongTermMemoryWriteCoordinator({
      store,
      guardrail: createGuardrail(async () => guardError),
    });

    const result = await coordinator.saveLongTermMemory(saveRequest());

    expect(result).toEqual(expected);
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(record.content);
  });

  it('honors caller cancellation before the guard and after a legal result', async () => {
    const preCanceledStore = createStore();
    const preCanceledCheck = vi.fn<GuardrailGatewayPort['checkKnowledge']>(async () => ({ isLegal: true }));
    const preCanceledCoordinator = createLongTermMemoryWriteCoordinator({
      store: preCanceledStore,
      guardrail: createGuardrail(preCanceledCheck),
    });
    const preCanceled = new AbortController();
    preCanceled.abort();

    await expect(preCanceledCoordinator.saveLongTermMemory(saveRequest(), undefined, preCanceled.signal)).resolves.toEqual(
      safeError('LTM_CONTENT_GUARD_CANCELED', 'CANCELED', false),
    );
    expect(preCanceledCheck).not.toHaveBeenCalled();
    expect(preCanceledStore.saveLongTermMemory).not.toHaveBeenCalled();

    const postCanceledStore = createStore();
    const postCanceled = new AbortController();
    const postCanceledCoordinator = createLongTermMemoryWriteCoordinator({
      store: postCanceledStore,
      guardrail: createGuardrail(async (_input, signal) => {
        expect(signal).toBe(postCanceled.signal);
        postCanceled.abort();
        return { isLegal: true };
      }),
    });

    await expect(postCanceledCoordinator.saveLongTermMemory(saveRequest(), undefined, postCanceled.signal)).resolves.toEqual(
      safeError('LTM_CONTENT_GUARD_CANCELED', 'CANCELED', false),
    );
    expect(postCanceledStore.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('preserves cancellation when the guard throws after the signal is aborted', async () => {
    const store = createStore();
    const controller = new AbortController();
    const coordinator = createLongTermMemoryWriteCoordinator({
      store,
      guardrail: createGuardrail(async () => {
        controller.abort();
        throw new Error('provider abort');
      }),
    });

    await expect(coordinator.saveLongTermMemory(saveRequest(), undefined, controller.signal)).resolves.toEqual(
      safeError('LTM_CONTENT_GUARD_CANCELED', 'CANCELED', false),
    );
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('delegates save and manual save unchanged when no guardrail is bound', async () => {
    const store = createStore();
    const coordinator = createLongTermMemoryWriteCoordinator({ store });
    const save = saveRequest();
    const manual = manualRequest();
    const writeOptions = {
      idempotencyKey: brand<string, 'IdempotencyKey'>('memory-save-1'),
      expectedVersion: 2,
    };

    await expect(coordinator.saveLongTermMemory(save, writeOptions)).resolves.toEqual(record);
    await expect(coordinator.manualSaveLongTermMemory(manual)).resolves.toEqual(record);

    expect(store.saveLongTermMemory).toHaveBeenCalledWith(save, writeOptions);
    expect(store.manualSaveLongTermMemory).toHaveBeenCalledWith(manual);
  });

  it('checks every batch item and excludes blocked content before persistence', async () => {
    const store = createStore();
    const checkKnowledge = vi
      .fn<GuardrailGatewayPort['checkKnowledge']>()
      .mockResolvedValueOnce({ isLegal: true })
      .mockResolvedValueOnce({ isLegal: false });
    const coordinator = createLongTermMemoryWriteCoordinator({ store, guardrail: createGuardrail(checkKnowledge) });
    const request = {
      tenantId,
      subjectId,
      agentId,
      items: [
        { memoryType: 'FACTUAL' as const, knowledgeSourceType: 'CONFIGURED' as const, briefIndex: 'Allowed', content: 'Allowed content' },
        { memoryType: 'FACTUAL' as const, knowledgeSourceType: 'CONFIGURED' as const, briefIndex: 'Blocked', content: 'Blocked content' },
      ],
    };

    await expect(coordinator.batchCreateLongTermMemory(request)).resolves.toEqual({
      successCount: 1,
      failCount: 1,
      memoryIds: [memoryId],
    });
    expect(store.batchCreateLongTermMemory).toHaveBeenCalledWith({ ...request, items: [request.items[0]] });
  });
});

function createGuardrail(checkKnowledge: GuardrailGatewayPort['checkKnowledge']): GuardrailGatewayPort {
  return {
    checkQuestion: async () => ({ isLegal: true, refusalMessage: '' }),
    checkAnswer: async () => ({ isLegal: true, refusalMessage: '' }),
    checkNl2Python: async () => ({ status: true, errorMsg: [] }),
    checkKnowledge,
  };
}

function createStore(): Pick<LongTermMemoryStoreGateway, 'saveLongTermMemory' | 'batchCreateLongTermMemory' | 'manualSaveLongTermMemory'> {
  return {
    saveLongTermMemory: vi.fn(async () => record),
    batchCreateLongTermMemory: vi.fn(async () => ({ successCount: 1, failCount: 0, memoryIds: [memoryId] })),
    manualSaveLongTermMemory: vi.fn(async () => record),
  };
}

function saveRequest(overrides: Partial<Pick<SaveLongTermMemoryRequest, 'briefIndex' | 'content' | 'labels'>> = {}): SaveLongTermMemoryRequest {
  return {
    tenantId,
    subjectId,
    agentId,
    memoryType: 'PROCEDURAL',
    knowledgeSourceType: 'LEARNED',
    briefIndex: 'Inspect BGP neighbor state',
    content: 'Run the approved BGP diagnostic procedure.',
    labels: ['bgp'],
    confidence: 0.9,
    source: 'manual',
    ...overrides,
  };
}

function manualRequest(): ManualSaveLongTermMemoryRequest {
  return {
    tenantId,
    subjectId,
    agentId,
    memoryType: 'FACTUAL',
    knowledgeSourceType: 'CONFIGURED',
    briefIndex: record.briefIndex,
    content: record.content,
    labels: record.labels,
    confidence: 1,
  };
}

function safeError(code: string, category: SafeError['category'], retryable: boolean): SafeError {
  return {
    code,
    message: safeMessage(code),
    category,
    retryable,
  };
}

function safeMessage(code: string): string {
  switch (code) {
    case 'GUARDRAIL_KNOWLEDGE_UNAVAILABLE':
      return 'Knowledge security check is temporarily unavailable.';
    case 'GUARDRAIL_KNOWLEDGE_REQUEST_INVALID':
      return 'Knowledge security check request is invalid.';
    case 'GUARDRAIL_KNOWLEDGE_CANCELED':
      return 'Knowledge security check was canceled.';
    case 'LTM_CONTENT_GUARD_UNAVAILABLE':
      return 'The long-term memory write did not start because its security check is temporarily unavailable. Continue without saving, try again later, or stop and report the unavailable guardrail.';
    case 'LTM_CONTENT_GUARD_CANCELED':
      return 'Long-term memory content security check was canceled.';
    default:
      return 'Safe failure.';
  }
}

const record: LongTermMemoryRecord = {
  tenantId,
  subjectId,
  agentId,
  memoryId,
  memoryInstance: 'defaultInstance',
  memoryType: 'PROCEDURAL',
  knowledgeSourceType: 'LEARNED',
  sharingState: 'PRIVATE',
  state: 'ACTIVE',
  briefIndex: 'Inspect BGP neighbor state',
  content: 'Run the approved BGP diagnostic procedure.',
  labels: ['bgp'],
  confidence: 0.9,
  version: 1,
  accessCount: 0,
  recallCount: 0,
  extractionCount: 0,
  archivedAt: brand<number, 'EpochMillis'>(0),
  archiveReason: '',
  isPinned: false,
  source: 'manual',
  createTime: now,
  updateTime: now,
};
