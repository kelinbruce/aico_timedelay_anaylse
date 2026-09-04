import { brand, type IdentityContext } from '@nextagent/agent-common';
import type { RuntimeCommandPort } from '@nextagent/agent-contracts/runtime';
import { createQuestionActivityTrackingCommandPort } from '../src/services/question-activity-tracking-command-port.js';
import { computeQuestionHash } from '../src/services/category-question-catalog.js';
import { describe, expect, it, vi } from 'vitest';

const identity: IdentityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-question'),
  subjectId: brand<string, 'SubjectId'>('subject-question'),
  displayName: 'question tester',
};
const agentId = brand<string, 'AgentId'>('agent-question');
const locale = brand<string, 'RequestLocale'>('zh-CN');
const now = brand<number, 'EpochMillis'>(1000);

describe('createQuestionActivityTrackingCommandPort', () => {
  it('tracks submit and edit questions after the inner command succeeds', async () => {
    const upsertActivity = vi.fn(async () => undefined);
    const inner = runtimePort();
    const port = createQuestionActivityTrackingCommandPort(inner, { upsertActivity } as never, agentId, () => now);

    await port.submit({ inputText: '  How to inspect cell alarm?  ', identityContext: identity, locale } as never);
    await port.editLatest({ editedInputText: 'How to inspect BGP peer?', identityContext: identity } as never);

    expect(upsertActivity).toHaveBeenCalledTimes(2);
    expect(upsertActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        questionHash: computeQuestionHash('How to inspect cell alarm?'),
        questionText: 'How to inspect cell alarm?',
        locale,
        createdAt: now,
        updatedAt: now,
      }),
    );
    expect(upsertActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        questionHash: computeQuestionHash('How to inspect BGP peer?'),
        locale,
      }),
    );
  });

  it('does not block runtime command success when activity tracking fails', async () => {
    const port = createQuestionActivityTrackingCommandPort(
      runtimePort(),
      {
        upsertActivity: vi.fn(async () => {
          throw new Error('store unavailable');
        }),
      } as never,
      agentId,
      () => now,
    );

    await expect(port.submit({ inputText: 'question', identityContext: identity, locale } as never)).resolves.toEqual({ accepted: true });
  });

  it('does not track activity when guardBlockRefusal is set (guardrail blocked)', async () => {
    const upsertActivity = vi.fn(async () => undefined);
    const inner = runtimePort();
    const port = createQuestionActivityTrackingCommandPort(inner, { upsertActivity } as never, agentId, () => now);

    await port.submit({
      inputText: 'some blocked content',
      identityContext: identity,
      locale,
      guardBlockRefusal: 'Input rejected by guardrail.',
    } as never);

    expect(upsertActivity).not.toHaveBeenCalled();
  });

  it('does not track editLatest activity when guardBlockRefusal is set (guardrail blocked)', async () => {
    const upsertActivity = vi.fn(async () => undefined);
    const inner = runtimePort();
    const port = createQuestionActivityTrackingCommandPort(inner, { upsertActivity } as never, agentId, () => now);

    await port.editLatest({
      editedInputText: 'some blocked edit content',
      identityContext: identity,
      guardBlockRefusal: 'Input rejected by guardrail.',
    } as never);

    expect(upsertActivity).not.toHaveBeenCalled();
  });
});

function runtimePort(): RuntimeCommandPort {
  return {
    submit: vi.fn(async () => ({ accepted: true }) as never),
    cancel: vi.fn(async () => ({ accepted: true }) as never),
    retryLatest: vi.fn(async () => ({ accepted: true }) as never),
    editLatest: vi.fn(async () => ({ accepted: true }) as never),
    answerPendingInput: vi.fn(async () => ({ accepted: true }) as never),
  };
}
