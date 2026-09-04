import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requestService } from '../src/services/requestService.ts';
import type { RequestAccepted } from '../src/state/contracts.ts';

describe('requestService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('submitRequest', () => {
    it('sends staged attachment refs in a JSON submit body', async () => {
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

      const result = await requestService.submitRequest('sess-1', {
        inputText: 'Test input',
        locale: 'zh-CN',
        idempotencyKey: 'submit-key',
        attachments: [{ tempRunId: 'temp-1', fileName: 'note.md' }],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/sess-1/requests'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inputText: 'Test input',
            locale: 'zh-CN',
            idempotencyKey: 'submit-key',
            attachments: [{ tempRunId: 'temp-1', fileName: 'note.md' }],
          }),
        }),
      );
      expect(result).toEqual(mockAccepted);
    });
  });

  describe('stageAttachments', () => {
    it('uploads every file to the common staged endpoint before JSON submit', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tempRunId: 'temp-1', fileName: 'note.md', sizeBytes: 4 }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const [attachment] = await requestService.stageAttachments('sess-1', [new File(['note'], 'note.md', { type: 'text/markdown' })]);

      expect(attachment).toEqual({ tempRunId: 'temp-1', fileName: 'note.md' });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/sess-1/files/upload'),
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
      );
      const [, init] = fetchMock.mock.calls[0]!;
      const body = init?.body as FormData;
      expect(body.get('tempRunId')).toBeTruthy();
      expect((body.get('file') as File).name).toBe('note.md');
    });
  });

  describe('stageAttachment', () => {
    it('uploads a single file with the caller-supplied tempRunId', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tempRunId: 'caller-temp', fileName: 'note.md', sizeBytes: 4 }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await requestService.stageAttachment('sess-1', 'caller-temp', new File(['note'], 'note.md', { type: 'text/markdown' }));

      expect(result).toEqual({ tempRunId: 'caller-temp', fileName: 'note.md', sizeBytes: 4 });
      const [, init] = fetchMock.mock.calls[0]!;
      const body = init?.body as FormData;
      expect(body.get('tempRunId')).toBe('caller-temp');
      expect((body.get('file') as File).name).toBe('note.md');
    });
  });

  describe('deleteStagedAttachment', () => {
    it('calls the temp delete endpoint with fileName query parameter', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
      vi.stubGlobal('fetch', fetchMock);

      await requestService.deleteStagedAttachment('sess-1', 'temp-1', 'note.md');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/sess-1/files/tmp/temp-1?fileName=note.md'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('editRequest', () => {
    it('sends a JSON text-only edit body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'sess-1',
            requestId: 'req-1',
            runId: 'run-1',
            attempt: 1,
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await requestService.editRequest('sess-1', 'run-1', 'Edited input text', undefined, 'edit-key');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/sess-1/requests/latest/edit'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedLatestRequestId: 'run-1', editedInputText: 'Edited input text', idempotencyKey: 'edit-key' }),
        }),
      );
    });
  });

  describe('submitUserInputResponse', () => {
    it('posts ordered answers to the pending input answer endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', fetchMock);

      await requestService.submitUserInputResponse('sess-1', 'input-1', { answers: [['approve']] });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/sess-1/pending-inputs/input-1/answer'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: [['approve']] }),
        }),
      );
    });

    it('posts explicit QUESTION answer kinds without changing ordered answers', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', fetchMock);

      await requestService.submitUserInputResponse('sess-1', 'input-1', {
        answers: [['change_ne']],
        answerKinds: ['CUSTOM_TEXT'],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sessions/sess-1/pending-inputs/input-1/answer'),
        expect.objectContaining({
          body: JSON.stringify({ answers: [['change_ne']], answerKinds: ['CUSTOM_TEXT'] }),
        }),
      );
    });
  });
});
