import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requestService } from '../src/services/requestService.ts';
import type { RequestAccepted } from '../src/state/contracts.ts';

describe('requestService skill directive integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('injects a skill directive in JSON inputText when targetSkill is provided', async () => {
    const mockAccepted: RequestAccepted = {
      sessionId: 'sess-1',
      requestId: 'req-1',
      runId: 'run-1',
      attempt: 1,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockAccepted),
    });
    vi.stubGlobal('fetch', fetchMock);

    await requestService.submitRequest('sess-1', {
      inputText: 'Test input',
      locale: 'zh-CN',
      idempotencyKey: 'submit-key',
      targetSkill: 'alarm-diagnosis',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    expect(body.routingConstraints).toBeUndefined();
    expect(body.inputText).toBe('$skill:alarm-diagnosis Test input');
    expect(body.idempotencyKey).toBe('submit-key');
  });

  it('does not include routingConstraints when targetSkill is undefined', async () => {
    const mockAccepted: RequestAccepted = {
      sessionId: 'sess-1',
      requestId: 'req-1',
      runId: 'run-1',
      attempt: 1,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockAccepted),
    });
    vi.stubGlobal('fetch', fetchMock);

    await requestService.submitRequest('sess-1', {
      inputText: 'Test input',
      locale: 'zh-CN',
      idempotencyKey: 'submit-key',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    expect(body.routingConstraints).toBeUndefined();
  });

  it('injects a skill directive in staged JSON inputText when attachments are provided', async () => {
    const mockAccepted: RequestAccepted = {
      sessionId: 'sess-1',
      requestId: 'req-1',
      runId: 'run-1',
      attempt: 1,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockAccepted),
    });
    vi.stubGlobal('fetch', fetchMock);

    await requestService.submitRequest('sess-1', {
      inputText: 'Test input',
      locale: 'zh-CN',
      idempotencyKey: 'submit-key',
      attachments: [{ tempRunId: 'temp-1', fileName: 'note.md' }],
      targetSkill: 'alarm-diagnosis',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    expect(body.inputText).toBe('$skill:alarm-diagnosis Test input');
    expect(body.attachments).toEqual([{ tempRunId: 'temp-1', fileName: 'note.md' }]);
  });

  it('injects a skill directive in edit inputText when targetSkill is provided', async () => {
    const mockAccepted: RequestAccepted = {
      sessionId: 'sess-1',
      requestId: 'req-1',
      runId: 'run-1',
      attempt: 1,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockAccepted),
    });
    vi.stubGlobal('fetch', fetchMock);

    await requestService.editRequest('sess-1', 'req-old', 'Edited text', undefined, 'edit-key', 'alarm-diagnosis');

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    expect(body.routingConstraints).toBeUndefined();
    expect(body.editedInputText).toBe('$skill:alarm-diagnosis Edited text');
  });
});
