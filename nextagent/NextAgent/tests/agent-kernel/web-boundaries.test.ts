import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import { describe, expect, it } from 'vitest';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-1'),
  subjectId: brand<string, 'SubjectId'>('subject-1'),
};
const agentId = brand<string, 'AgentId'>('default-agent');

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await assertion()).toBe(true);
}

async function waitForRunTerminal(app: ReturnType<typeof createNextAgentTestApp>, runId: string): Promise<void> {
  await waitFor(async () => {
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(runId),
    });
    return run?.terminalCommitState === 'COMMITTED';
  });
}

describe('minimal Web channel boundaries', () => {
  it('exposes only the minimal route table and rejects non-minimal create-session fields', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }] });

    const create = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: { locale: 'zh-CN' } });
    expect(create.statusCode).toBe(200);
    expect(Object.keys(create.json()).sort()).toEqual(['displayTitle', 'lastActivityAt', 'sessionId']);

    const forbidden = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: { sessionId: 'client-owned', tenantId: 'evil' } });
    expect(forbidden.statusCode).toBe(400);

    const clientIdempotencyKey = await app.server.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      payload: { locale: 'zh-CN', idempotencyKey: 'client-owned-key' },
    });
    expect(clientIdempotencyKey.statusCode).toBe(400);

    const detail = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${create.json<{ sessionId: string }>().sessionId}` });
    expect(detail.statusCode).toBe(404);

    const invalidListQuery = await app.server.inject({ method: 'GET', url: '/api/v1/sessions?cursor=not-public' });
    expect(invalidListQuery.statusCode).toBe(400);
  });

  it('normalizes public empty attachments to core empty attachmentIds and rejects attachment payloads', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }] });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'hello', idempotencyKey: 'idem-attachment-empty', attachments: [] },
    });
    expect(accepted.statusCode).toBe(200);
    await waitForRunTerminal(app, accepted.json<{ runId: string }>().runId);

    const rejected = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'hello', idempotencyKey: 'idem-attachment-object', attachments: [{ uploadRef: 'x' }] },
    });
    expect(rejected.statusCode).toBe(400);

    const rejectedIds = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'hello', idempotencyKey: 'idem-attachment-ids', attachmentIds: [] },
    });
    expect(rejectedIds.statusCode).toBe(400);
  });

  it('rejects multipart submit because requests accept only JSON staged attachment references', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }] });
    const first = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: { 'content-type': `multipart/form-data; boundary=${multipartBoundary}` },
      payload: multipartBody({
        inputText: 'diagnose with attachment',
        idempotencyKey: 'idem-web-attachment-intake',
        fileName: 'diag.md',
        contentType: 'text/markdown',
        content: '# alarm\n',
      }),
    });

    expect(first.statusCode, first.body).toBe(400);
    expect(first.json()).toEqual({
      error: { code: 'REQUEST_VALIDATION_FAILED', message: 'Request submit accepts JSON with staged attachment references.' },
    });
  });

  it('rejects large multipart submit bodies at the JSON-only request boundary', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }] });
    const oversizedDefaultBodyMarkdown = `${'# diag\n'}${'a'.repeat(1_200_000)}`;

    const response = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: { 'content-type': `multipart/form-data; boundary=${multipartBoundary}` },
      payload: multipartBody({
        inputText: 'diagnose with large attachment',
        idempotencyKey: 'idem-web-large-multipart',
        fileName: 'large.md',
        contentType: 'text/markdown',
        content: oversizedDefaultBodyMarkdown,
      }),
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'REQUEST_VALIDATION_FAILED', message: 'Request submit accepts JSON with staged attachment references.' },
    });
  });

  it('rejects multipart edit latest because the route accepts a JSON text body only', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }, { content: 'edited ok' }] });
    const first = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'initial', idempotencyKey: 'idem-web-edit-initial' },
    });

    expect(first.statusCode, first.body).toBe(200);
    const initial = first.json<{ sessionId: string; requestId: string; runId: string }>();
    await waitForRunTerminal(app, initial.runId);

    const edited = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${initial.sessionId}/requests/latest/edit`,
      headers: { 'content-type': `multipart/form-data; boundary=${multipartBoundary}` },
      payload: multipartBody({
        inputText: 'edited with attachment',
        idempotencyKey: 'idem-web-edit-attachment',
        expectedLatestRequestId: initial.requestId,
        fileName: 'edit.md',
        contentType: 'text/markdown',
        content: '# edit\n',
      }),
    });

    expect(edited.statusCode, edited.body).toBe(400);
    expect(edited.json()).toEqual({
      error: { code: 'REQUEST_VALIDATION_FAILED', message: 'Edit latest accepts a JSON text body only.' },
    });
  });

  it('rejects non-minimal submit, conversation and stream public fields', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }] });
    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'hello', idempotencyKey: 'idem-web-minimal' },
    });
    const sessionId = accepted.json<{ sessionId: string }>().sessionId;
    await waitForRunTerminal(app, accepted.json<{ runId: string }>().runId);

    const forbiddenSubmitFields = [
      { requestId: 'client-request' },
      { language: 'zh' },
      { submittedAt: 'now' },
      { owner: 'tenant-other' },
      { metadata: {} },
    ];
    for (const forbidden of forbiddenSubmitFields) {
      const rejected = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'hello', idempotencyKey: `idem-web-${Object.keys(forbidden)[0]}`, ...forbidden },
      });
      expect(rejected.statusCode).toBe(400);
    }

    const rejectedScopedSessionId = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/requests`,
      payload: { inputText: 'hello', idempotencyKey: 'idem-scoped-session-body', sessionId },
    });
    expect(rejectedScopedSessionId.statusCode).toBe(400);

    const hidden = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}/conversation?includeHidden=true` });
    expect(hidden.statusCode).toBe(400);

    const streamPath = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}/stream?streamPath=/internal` });
    expect(streamPath.statusCode).toBe(400);
  });

  it('rejects multipart submit when the boundary is missing', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }] });
    const response = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: { 'content-type': 'multipart/form-data' },
      payload: 'not-a-multipart-body',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'Request submit accepts JSON with staged attachment references.',
      },
    });
  });

  it('rejects multipart submit when required fields are missing', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }] });

    const missingInputText = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: { 'content-type': `multipart/form-data; boundary=${multipartBoundary}` },
      payload: [
        `--${multipartBoundary}`,
        'Content-Disposition: form-data; name="idempotencyKey"',
        '',
        'idem-web-multipart-missing-input',
        `--${multipartBoundary}`,
        'Content-Disposition: form-data; name="file"; filename="diag.md"',
        'Content-Type: text/markdown',
        '',
        '# diag\n',
        `--${multipartBoundary}--`,
        '',
      ].join('\r\n'),
    });
    expect(missingInputText.statusCode).toBe(400);

    const missingIdempotencyKey = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: { 'content-type': `multipart/form-data; boundary=${multipartBoundary}` },
      payload: [
        `--${multipartBoundary}`,
        'Content-Disposition: form-data; name="inputText"',
        '',
        'diagnose',
        `--${multipartBoundary}`,
        'Content-Disposition: form-data; name="file"; filename="diag.md"',
        'Content-Type: text/markdown',
        '',
        '# diag\n',
        `--${multipartBoundary}--`,
        '',
      ].join('\r\n'),
    });
    expect(missingIdempotencyKey.statusCode).toBe(400);
  });

  it('rejects multipart edit latest when expectedLatestRequestId is missing', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }, { content: 'edited ok' }] });
    const first = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'initial', idempotencyKey: 'idem-web-edit-missing-expected' },
    });
    expect(first.statusCode, first.body).toBe(200);
    const initial = first.json<{ sessionId: string }>();

    const response = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${initial.sessionId}/requests/latest/edit`,
      headers: { 'content-type': `multipart/form-data; boundary=${multipartBoundary}` },
      payload: [
        `--${multipartBoundary}`,
        'Content-Disposition: form-data; name="inputText"',
        '',
        'edited with attachment',
        `--${multipartBoundary}`,
        'Content-Disposition: form-data; name="idempotencyKey"',
        '',
        'idem-web-edit-missing-expected',
        `--${multipartBoundary}`,
        'Content-Disposition: form-data; name="file"; filename="edit.md"',
        'Content-Type: text/markdown',
        '',
        '# edit\n',
        `--${multipartBoundary}--`,
        '',
      ].join('\r\n'),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'Edit latest accepts a JSON text body only.',
      },
    });
  });

  it('rejects multipart submit with unsupported extra fields', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }] });
    const response = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: { 'content-type': `multipart/form-data; boundary=${multipartBoundary}` },
      payload: [
        `--${multipartBoundary}`,
        'Content-Disposition: form-data; name="inputText"',
        '',
        'diagnose',
        `--${multipartBoundary}`,
        'Content-Disposition: form-data; name="idempotencyKey"',
        '',
        'idem-web-multipart-extra',
        `--${multipartBoundary}`,
        'Content-Disposition: form-data; name="tenantId"',
        '',
        'tenant-other',
        `--${multipartBoundary}`,
        'Content-Disposition: form-data; name="file"; filename="diag.md"',
        'Content-Type: text/markdown',
        '',
        '# diag\n',
        `--${multipartBoundary}--`,
        '',
      ].join('\r\n'),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'Request submit accepts JSON with staged attachment references.',
      },
    });
  });
});

const multipartBoundary = '----nextagent-test-boundary';

function multipartBody(input: {
  readonly inputText: string;
  readonly idempotencyKey: string;
  readonly expectedLatestRequestId?: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly content: string;
}): string {
  return [
    `--${multipartBoundary}`,
    'Content-Disposition: form-data; name="inputText"',
    '',
    input.inputText,
    `--${multipartBoundary}`,
    'Content-Disposition: form-data; name="idempotencyKey"',
    '',
    input.idempotencyKey,
    ...(input.expectedLatestRequestId === undefined
      ? []
      : [`--${multipartBoundary}`, 'Content-Disposition: form-data; name="expectedLatestRequestId"', '', input.expectedLatestRequestId]),
    `--${multipartBoundary}`,
    `Content-Disposition: form-data; name="file"; filename="${input.fileName}"`,
    `Content-Type: ${input.contentType}`,
    '',
    input.content,
    `--${multipartBoundary}--`,
    '',
  ].join('\r\n');
}
