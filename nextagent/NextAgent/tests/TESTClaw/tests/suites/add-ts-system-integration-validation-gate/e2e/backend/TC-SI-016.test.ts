import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { readAcceptedCandidateResponse } from '../../helpers/candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

interface PublicAttachmentSummary {
  readonly fileName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
}

describe('TC-SI-016 attachment intake to context', () => {
  it('uploads and finalizes a Markdown attachment while exposing metadata but not body bytes', async () => {
    const candidateRoot = requiredCandidateRoot();
    const candidateHashBefore = await hashDirectoryTree(candidateRoot);

    await withRunScope(
      {
        outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT,
      },
      async (scope) => {
        const attachmentBody = '# attachment\nradio-attachment-canary\n';
        let hasModelSeenFileName = false;
        let hasModelSeenAttachmentBody = false;
        const harness = await startCandidateHarness({
          scope,
          candidateRoot,
          modelAnswer: 'Attachment processed.',
          inspectModelRequest(body): void {
            const rendered = JSON.stringify(body);
            hasModelSeenFileName ||= rendered.includes('field-notes.md');
            hasModelSeenAttachmentBody ||= rendered.includes('radio-attachment-canary');
          },
        });

        const sessionResponse = await fetch(`${harness.baseUrl}/api/v1/sessions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        expect(sessionResponse.status).toBe(200);
        const sessionId = readSessionId(await sessionResponse.json());

        const tempRunId = randomUUID();
        const formData = new FormData();
        formData.append('tempRunId', tempRunId);
        formData.append('file', new Blob([attachmentBody], { type: 'text/markdown' }), 'field-notes.md');
        const uploadResponse = await fetch(`${harness.baseUrl}/api/v1/sessions/${sessionId}/files/upload`, {
          method: 'POST',
          body: formData,
        });
        expect(uploadResponse.status).toBe(200);
        expect(await uploadResponse.json()).toMatchObject({
          tempRunId,
          fileName: 'field-notes.md',
          sizeBytes: Buffer.byteLength(attachmentBody),
        });

        const submitResponse = await fetch(`${harness.baseUrl}/api/v1/sessions/${sessionId}/requests`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            inputText: 'Process the uploaded field notes.',
            idempotencyKey: `tc-si-016-${randomUUID()}`,
            attachments: [{ tempRunId, fileName: 'field-notes.md' }],
          }),
        });
        const accepted = await readAcceptedCandidateResponse(submitResponse, 'attachment-submit');
        const streamResponse = await fetch(`${harness.baseUrl}/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${accepted.runId}`);
        expect(streamResponse.status).toBe(200);
        const streamBody = await streamResponse.text();
        expect(streamBody).toContain('event: REQUEST_COMPLETED');
        expect(streamBody).not.toContain('radio-attachment-canary');

        const conversationResponse = await fetch(`${harness.baseUrl}/api/v1/sessions/${sessionId}/conversation?limit=10`);
        expect(conversationResponse.status).toBe(200);
        const conversationBody: unknown = await conversationResponse.json();
        const attachmentSummary = readUserAttachmentSummary(conversationBody);
        expect(attachmentSummary).toEqual({
          fileName: 'field-notes.md',
          mediaType: 'MARKDOWN',
          sizeBytes: Buffer.byteLength(attachmentBody),
        });
        expect(JSON.stringify(conversationBody)).not.toContain('radio-attachment-canary');
        expect(JSON.stringify(conversationBody)).not.toMatch(/\b[A-Za-z]:[\\/]/u);
        expect(hasModelSeenFileName).toBe(true);
        expect(hasModelSeenAttachmentBody).toBe(false);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-016',
          observations: {
            attachmentFinalized: true,
            bodyExcludedFromModelBoundary: true,
            bodyExcludedFromPublicConversation: true,
            fileNameProjectedToModelBoundary: true,
            publicMetadataProjected: true,
            terminalObserved: true,
          },
          canaries: [
            { category: 'attachment-body', value: 'radio-attachment-canary' },
            { category: 'prompt', value: 'Process the uploaded field notes.' },
            { category: 'model-output', value: 'Attachment processed.' },
            { category: 'credential', value: 'testclaw-loopback-key' },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 90_000);
});

function readSessionId(value: unknown): string {
  if (!isRecord(value) || typeof value.sessionId !== 'string') {
    throw new Error('session-response-invalid');
  }
  return value.sessionId;
}

function readUserAttachmentSummary(value: unknown): PublicAttachmentSummary {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('conversation-response-invalid');
  }
  for (const item of value.items) {
    if (!isRecord(item) || item.role !== 'USER' || !Array.isArray(item.attachments) || item.attachments.length !== 1) {
      continue;
    }
    const summary = item.attachments[0];
    if (isRecord(summary) && typeof summary.fileName === 'string' && typeof summary.mediaType === 'string' && typeof summary.sizeBytes === 'number') {
      return {
        fileName: summary.fileName,
        mediaType: summary.mediaType,
        sizeBytes: summary.sizeBytes,
      };
    }
  }
  throw new Error('attachment-summary-missing');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
