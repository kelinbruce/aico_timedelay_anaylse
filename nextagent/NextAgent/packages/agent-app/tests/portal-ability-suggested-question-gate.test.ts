import { brand } from '@nextagent/agent-common';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import { createPrecomputedSuggestedQuestionPort } from '@nextagent/agent-session';
import type {
  RuntimeCommandPort,
  RuntimeSessionPort,
  SuggestedQuestionPort,
  SuggestedQuestionRequest,
  SuggestedQuestionResult,
} from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPortalAbilitySuggestedQuestionGate } from '../src/composition/portal-ability-suggested-question-gate.js';

const TENANT_ID = brand<string, 'TenantId'>('T1');
const SUBJECT_ID = brand<string, 'SubjectId'>('U1');
const AGENT_ID = brand<string, 'AgentId'>('default-agent');
const SESSION_ID = brand<string, 'SessionId'>('S1');
const REQUEST_ID = brand<string, 'MessageId'>('msg-1');
const RUN_ID = brand<string, 'RequestRunId'>('R1');

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close().catch(() => undefined)));
});

describe('portal ability suggested question gate', () => {
  it('skips terminal precompute and REST generation when disabled', async () => {
    const provider = { get: vi.fn(async () => ({ suggestedQuestionsEnabled: false })) };
    const inner = makeInnerSuggestedQuestionPort();
    const gate = createPortalAbilitySuggestedQuestionGate(inner.port, provider);

    gate.precompute({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      runId: RUN_ID,
    });
    await vi.waitFor(() => expect(provider.get).toHaveBeenCalledTimes(1));
    await expect(generateRequest(gate)).resolves.toEqual({ questions: [] });

    expect(inner.generate).not.toHaveBeenCalled();
  });

  it('returns an empty REST response without a model invocation when disabled', async () => {
    const provider = { get: vi.fn(async () => ({ suggestedQuestionsEnabled: false })) };
    const inner = makeInnerSuggestedQuestionPort();
    const gate = createPortalAbilitySuggestedQuestionGate(inner.port, provider);
    const app = Fastify();
    apps.push(app);
    await registerWebChannel(app, makeWebDependencies(gate));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/S1/requests/msg-1/suggested-questions',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ questions: [] });
    expect(inner.generate).not.toHaveBeenCalled();
  });

  it('keeps precompute and REST behavior unchanged when enabled', async () => {
    const provider = { get: vi.fn(async () => ({ suggestedQuestionsEnabled: true })) };
    const inner = makeInnerSuggestedQuestionPort();
    const gate = createPortalAbilitySuggestedQuestionGate(inner.port, provider);

    gate.precompute({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      runId: RUN_ID,
    });
    await vi.waitFor(() => expect(inner.generate).toHaveBeenCalledTimes(1));
    await expect(generateRequest(gate)).resolves.toEqual({ questions: ['model-question'] });
    expect(inner.generate).toHaveBeenCalledTimes(1);
  });
});

async function generateRequest(gate: SuggestedQuestionPort): Promise<SuggestedQuestionResult> {
  const request: SuggestedQuestionRequest = {
    tenantId: TENANT_ID,
    subjectId: SUBJECT_ID,
    agentId: AGENT_ID,
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
  };
  return gate.generate(request);
}

function makeWebDependencies(suggestedQuestions: SuggestedQuestionPort) {
  const sessions: RuntimeSessionPort = {
    requireSession: vi.fn(async () => ({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      sessionId: SESSION_ID,
      createdAt: brand<number, 'EpochMillis'>(0),
      updatedAt: brand<number, 'EpochMillis'>(0),
      hasInFlightRequest: false,
    })),
    listMessages: vi.fn(async () => ({
      items: [
        {
          messageId: REQUEST_ID,
          sessionId: SESSION_ID,
          requestId: REQUEST_ID,
          runId: RUN_ID,
          role: 'ASSISTANT' as const,
          content: 'answer',
          contentType: 'PLAIN_TEXT' as const,
          metadata: {},
          sequence: 1,
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(0),
        },
      ],
      limit: 50,
      hasMore: false,
    })),
  } as unknown as RuntimeSessionPort;

  return {
    runtime: {} as RuntimeCommandPort,
    sessions,
    suggestedQuestions,
    identityResolver: () => ({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      displayName: 'Test User',
    }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    defaultAgentId: AGENT_ID,
  };
}

function makeInnerSuggestedQuestionPort() {
  const generate = vi.fn(async (): Promise<SuggestedQuestionResult> => ({ questions: ['model-question'] }));
  return { generate, port: createPrecomputedSuggestedQuestionPort({ generate }) };
}
