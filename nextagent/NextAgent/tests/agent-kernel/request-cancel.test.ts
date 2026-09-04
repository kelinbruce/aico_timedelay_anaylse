import { createDefaultAgentTestAssemblyRegistry } from '@nextagent/agent-platform-gateway-local/testing';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import type { PendingInputRecord, RequestRunRecord } from '@nextagent/agent-contracts/gateway';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { createRequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../fixtures/test-agent.js';
import { describe, expect, it } from 'vitest';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-cancel-command'),
  subjectId: brand<string, 'SubjectId'>('subject-cancel-command'),
  displayName: 'Cancel command tester',
};
const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');

function handoffQuestions(): PendingInputRecord['request']['questions'] {
  return [
    {
      prompt: 'How should the human handoff finish?',
      options: [
        { label: 'Final answer', value: 'final_answer' },
        { label: 'Resume with instruction', value: 'resume_instruction' },
      ],
    },
    { prompt: 'Human handoff content', options: [] },
  ];
}

function runRecord(overrides: Partial<RequestRunRecord> & Pick<RequestRunRecord, 'runId' | 'sessionId' | 'requestId'>): RequestRunRecord {
  const now = brand<number, 'EpochMillis'>(overrides.createdAt === undefined ? 1 : Number(overrides.createdAt));
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    agentVersion,
    agentAssemblyRef: 'default-agent:v1',
    attempt: 1,
    status: 'QUEUED',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function pendingInputRecord(
  overrides: Partial<PendingInputRecord> & Pick<PendingInputRecord, 'pendingInputId' | 'sessionId' | 'requestId' | 'requestRunId'>,
): PendingInputRecord {
  const now = brand<number, 'EpochMillis'>(overrides.createdAt === undefined ? 1 : Number(overrides.createdAt));
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    requestContextId: brand<string, 'RequestContextId'>(`context-${overrides.pendingInputId}`),
    checkpointId: brand<string, 'CheckpointId'>(`checkpoint-${overrides.pendingInputId}`),
    kind: 'QUESTION',
    request: {
      id: overrides.pendingInputId,
      sessionId: overrides.sessionId,
      kind: 'QUESTION',
      questions: [{ prompt: 'Continue?', options: [{ label: 'yes', value: 'yes' }] }],
    },
    producerRef: { kind: 'LIFECYCLE_HOOK' },
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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

async function createSession(gateway: ReturnType<typeof createTestGatewayStores>, sessionId: RequestRun['sessionId']): Promise<void> {
  await gateway.sessions.saveSession({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId,
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  });
}

async function loadRun(gateway: ReturnType<typeof createTestGatewayStores>, runId: RequestRun['runId']): Promise<RequestRunRecord | undefined> {
  return gateway.requestRuns.loadRun({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    runId,
  });
}

function createRuntime(gateway: ReturnType<typeof createTestGatewayStores>, execute: LegacyExecute) {
  return createRequestLifecycleCoordinator({
    agentConstructors: [
      createTestAgentConstructor(async ({ runState }, run, context, signal) => {
        await execute(run, context, toLegacyTimeline(runState, run, context), runState, signal);
      }),
    ],
    agentRuntimeDependencies: {},
    assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
    capabilityCatalog: createStaticCapabilityCatalog(),
    defaultRouteAgentId: agentId,
    userSessions: createUserSessionService({
      sessionStore: gateway.sessions,
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
    }),
    messageStore: gateway.messages,
    activeContextStore: gateway.activeContext,
    requestRunStore: gateway.requestRuns,
    timelineStore: gateway.timeline,
    checkpointStore: gateway.checkpoints,
    pendingInputStore: gateway.pendingInputs,
  });
}

type LegacyExecute = (
  run: RequestRun,
  context: RequestContext,
  timeline: { emit: (event: RunTimelineEvent) => Promise<void> },
  messages: Pick<AgentRunStatePort, 'appendMessage'>,
  signal: AbortSignal,
) => Promise<void>;

function toLegacyTimeline(runState: AgentRunStatePort, run: RequestRun, context: RequestContext) {
  return {
    emit(event: RunTimelineEvent): Promise<void> {
      return runState.emitEvent(run, context, event);
    },
  };
}

describe('request cancel', () => {
  it('rejects invalid, missing, stale, historical, terminal and terminal-pending cancel targets safely', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-cancel-negative');
    await createSession(gateway, sessionId);
    const runtime = createRuntime(gateway, async () => {});

    await expect(
      runtime.cancel({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-missing-key'),
        action: 'CANCEL',
      } as unknown as Parameters<typeof runtime.cancel>[0]),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCEL_IDEMPOTENCY_REQUIRED' });
    await expect(
      runtime.cancel({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-blank-key'),
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>(' '),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCEL_IDEMPOTENCY_REQUIRED' });
    await expect(
      runtime.cancel({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-not-found'),
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-not-found'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCEL_NOT_FOUND' });

    const older = runRecord({
      runId: brand<string, 'RequestRunId'>('run-cancel-older'),
      sessionId,
      requestId: brand<string, 'MessageId'>('request-cancel-older'),
      createdAt: brand<number, 'EpochMillis'>(1),
    });
    const newer = runRecord({
      runId: brand<string, 'RequestRunId'>('run-cancel-newer'),
      sessionId,
      requestId: brand<string, 'MessageId'>('request-cancel-newer'),
      createdAt: brand<number, 'EpochMillis'>(2),
    });
    await gateway.requestRuns.saveRun(older, {});
    await gateway.requestRuns.saveRun(newer, {});
    await expect(
      runtime.cancel({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: older.requestId,
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-stale'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCEL_NOT_LATEST' });
    expect((await loadRun(gateway, older.runId))?.status).toBe('QUEUED');
    expect((await loadRun(gateway, newer.runId))?.status).toBe('QUEUED');
    await expect(
      runtime.cancel({
        sessionId,
        identityContext: {
          tenantId: brand<string, 'TenantId'>('tenant-other'),
          subjectId: identity.subjectId,
          displayName: 'Other tenant',
        },
        expectedLatestRequestId: newer.requestId,
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-owner-mismatch'),
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });

    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-cancel-terminal'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-cancel-terminal'),
        status: 'COMPLETED',
        terminalCommitState: 'COMMITTED',
        createdAt: brand<number, 'EpochMillis'>(3),
      }),
      {},
    );
    await expect(
      runtime.cancel({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-cancel-terminal'),
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-terminal'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCEL_ALREADY_TERMINAL' });

    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-cancel-terminal-pending'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-cancel-terminal-pending'),
        status: 'FAILED',
        terminalCommitState: 'PENDING',
        createdAt: brand<number, 'EpochMillis'>(4),
      }),
      {},
    );
    await expect(
      runtime.cancel({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-cancel-terminal-pending'),
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-terminal-pending'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCEL_TERMINAL_PENDING' });
  });

  it('terminal commits queued cancel and keeps the run auditable', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-cancel-queued');
    const runId = brand<string, 'RequestRunId'>('run-cancel-queued');
    const requestId = brand<string, 'MessageId'>('request-cancel-queued');
    let executeCount = 0;
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId }), {});
    const runtime = createRuntime(gateway, async () => {
      executeCount += 1;
    });
    const cancelKey = brand<string, 'IdempotencyKey'>('idem-cancel-queued');

    const accepted = await runtime.cancel({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'CANCEL',
      idempotencyKey: cancelKey,
    });
    const run = await loadRun(gateway, runId);
    const terminalLookup = await gateway.requestRuns.loadRunByIdempotencyKey({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      anchor: 'TERMINAL_COMMIT',
      idempotencyKey: cancelKey,
      idempotencySemantic: run?.terminalCommitIdempotencySemantic ?? '',
    });
    const acceptanceLookup = await gateway.requestRuns.loadRunByIdempotencyKey({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      anchor: 'ACCEPTANCE',
      idempotencyKey: cancelKey,
      idempotencySemantic: run?.terminalCommitIdempotencySemantic ?? '',
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });

    expect(accepted).toMatchObject({ sessionId, targetRequestId: requestId, action: 'CANCEL' });
    expect(run?.status).toBe('CANCELED');
    expect(run?.terminalCommitState).toBe('COMMITTED');
    expect(run?.terminalCommitIdempotencyKey).toBe(cancelKey);
    expect(JSON.parse(run?.terminalCommitIdempotencySemantic ?? '{}')).toMatchObject({
      action: 'CANCEL',
      expectedLatestRequestId: requestId,
      idempotencyKey: cancelKey,
    });
    expect(terminalLookup).toMatchObject({ status: 'FOUND', record: { runId } });
    expect(acceptanceLookup).toMatchObject({ status: 'NOT_FOUND' });
    expect(events.map((event) => event.type)).toContain('REQUEST_CANCELED');
    expect(executeCount).toBe(0);
  });

  it('treats accepted latest work as cancelable pre-execution work', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-cancel-accepted');
    const runId = brand<string, 'RequestRunId'>('run-cancel-accepted');
    const requestId = brand<string, 'MessageId'>('request-cancel-accepted');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(
      runRecord({
        runId,
        sessionId,
        requestId,
        status: 'ACCEPTED',
      }),
      {},
    );
    const runtime = createRuntime(gateway, async () => {});

    await runtime.cancel({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-accepted'),
    });

    expect((await loadRun(gateway, runId))?.status).toBe('CANCELED');
  });

  it('signals executing work, commits canceled terminal, and suppresses late output', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-cancel-executing');
    const started: string[] = [];
    let observedAbort = false;
    await createSession(gateway, sessionId);
    const runtime = createRuntime(gateway, async (run, context, timeline, messages, signal) => {
      started.push(run.runId);
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            observedAbort = true;
            resolve();
          },
          { once: true },
        );
      });
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: 'late after cancel' } });
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'late final after cancel' } });
      await messages.appendMessage(run, context, {
        role: 'CAPABILITY_RESULT',
        content: 'late capability after cancel',
        contentType: 'PLAIN_TEXT',
        visible: true,
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'late-tool' },
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-late-capability-after-cancel'),
      });
      await timeline.emit({ type: 'REQUEST_COMPLETED', inlinePayload: { content: 'late terminal after cancel' } });
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'cancel me',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-submit-cancel-executing'),
    });
    await waitFor(() => started.includes(submitted.runId));
    await runtime.cancel({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: submitted.requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-executing'),
    });
    await waitFor(async () => {
      const run = await loadRun(gateway, submitted.runId);
      return run?.status === 'CANCELED' && run.terminalCommitState === 'COMMITTED';
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });

    expect(observedAbort).toBe(true);
    expect(events.map((event) => event.type)).toContain('REQUEST_CANCELED');
    expect(events.map((event) => event.type)).not.toContain('REQUEST_COMPLETED');
    expect(JSON.stringify(events)).not.toContain('late after cancel');
    expect(JSON.stringify(events)).not.toContain('late terminal after cancel');
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId: submitted.requestId,
      runId: submitted.runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    expect(messages.items.map((message) => message.content)).not.toContain('late capability after cancel');
  });

  it('rejects late pending input answers after the root run is canceled', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-cancel-pending-input');
    const runId = brand<string, 'RequestRunId'>('run-cancel-pending-input');
    const requestId = brand<string, 'MessageId'>('request-cancel-pending-input');
    const pendingInputId = brand<string, 'PendingInputId'>('pending-input-canceled-root');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId }), {});
    await gateway.pendingInputs.createPendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      record: pendingInputRecord({ pendingInputId, sessionId, requestId, requestRunId: runId }),
    });
    const runtime = createRuntime(gateway, async () => {});

    await runtime.cancel({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-pending-input'),
    });

    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-answer-canceled-pending-input'),
        answer: {
          sessionId,
          pendingInputId,
          answers: [['yes']],
        },
      }),
    ).rejects.toMatchObject({ code: 'PENDING_INPUT_CANCELED' });
    await expect(
      gateway.pendingInputs.loadPendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        pendingInputId,
      }),
    ).resolves.toMatchObject({ status: 'CANCELED' });
    await expect(
      gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'USER_INPUT_CANCELED', inlinePayload: expect.objectContaining({ pendingInputId, status: 'CANCELED' }) }),
      ]),
    );
  });

  it('validates pending input answers against the accepted question shape', async () => {
    const gateway = createTestGatewayStores();
    const runtime = createRuntime(gateway, async () => {});
    let ordinal = 0;
    async function seedPending(
      questions: PendingInputRecord['request']['questions'],
      kind: PendingInputRecord['kind'] = 'QUESTION',
    ): Promise<{ readonly sessionId: RequestRun['sessionId']; readonly pendingInputId: PendingInputRecord['pendingInputId'] }> {
      ordinal += 1;
      const sessionId = brand<string, 'SessionId'>(`session-answer-shape-${ordinal}`);
      const runId = brand<string, 'RequestRunId'>(`run-answer-shape-${ordinal}`);
      const requestId = brand<string, 'MessageId'>(`request-answer-shape-${ordinal}`);
      const pendingInputId = brand<string, 'PendingInputId'>(`pending-answer-shape-${ordinal}`);
      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId }), {});
      await gateway.pendingInputs.createPendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        record: pendingInputRecord({
          pendingInputId,
          sessionId,
          requestId,
          requestRunId: runId,
          kind,
          request: {
            id: pendingInputId,
            sessionId,
            kind,
            questions,
          },
        }),
      });
      return { sessionId, pendingInputId };
    }
    async function answer(
      seed: { readonly sessionId: RequestRun['sessionId']; readonly pendingInputId: PendingInputRecord['pendingInputId'] },
      answers: ReadonlyArray<readonly string[]>,
      idempotencyKey = brand<string, 'IdempotencyKey'>(`idem-answer-shape-${ordinal}`),
    ) {
      return runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey,
        answer: {
          sessionId: seed.sessionId,
          pendingInputId: seed.pendingInputId,
          answers,
        },
      });
    }
    async function expectPending(seed: { readonly pendingInputId: PendingInputRecord['pendingInputId'] }) {
      await expect(
        gateway.pendingInputs.loadPendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          pendingInputId: seed.pendingInputId,
        }),
      ).resolves.toMatchObject({ status: 'PENDING' });
    }

    await expect(answer(await seedPending([{ prompt: 'Describe the issue', options: [] }]), [['manual text']])).resolves.toMatchObject({
      status: 'RECEIVED',
    });
    await expect(answer(await seedPending([{ prompt: 'Choose one', options: [{ label: 'yes', value: 'yes' }] }]), [['yes']])).resolves.toMatchObject({
      status: 'RECEIVED',
    });
    await expect(
      answer(
        await seedPending([
          {
            prompt: 'Choose many',
            options: [
              { label: 'A', value: 'a' },
              { label: 'B', value: 'b' },
            ],
            multiple: true,
          },
        ]),
        [['a', 'b']],
      ),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await expect(
      answer(await seedPending([{ prompt: 'Choose many custom', options: [{ label: 'A', value: 'a' }], multiple: true, custom: true }]), [
        ['a', 'manual'],
      ]),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await expect(
      answer(await seedPending([{ prompt: 'Single custom value', options: [{ label: 'A', value: 'a' }], custom: true }]), [['manual']]),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await expect(
      answer(
        await seedPending([
          {
            prompt: 'Choose one and provide details',
            options: [
              { label: 'Existing project', value: 'existing_project', requiresTextInput: true },
              { label: 'Single file', value: 'single_file', requiresTextInput: true },
            ],
          },
        ]),
        [['single_file', 'src/example.ts']],
      ),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await expect(
      answer(
        await seedPending(
          [
            {
              prompt: 'Confirm',
              options: [
                { label: 'Approve', value: 'approve' },
                { label: 'Reject', value: 'reject' },
              ],
            },
          ],
          'CONFIRMATION',
        ),
        [['approve']],
      ),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await expect(
      answer(
        await seedPending(
          [
            {
              prompt: 'Confirm',
              options: [
                { label: 'Approve', value: 'approve' },
                { label: 'Reject', value: 'reject' },
              ],
            },
          ],
          'CONFIRMATION',
        ),
        [['reject']],
      ),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await expect(
      answer(
        await seedPending(
          [
            {
              prompt: 'Authorize',
              options: [
                { label: 'Approve', value: 'approve' },
                { label: 'Deny', value: 'deny' },
              ],
            },
          ],
          'AUTHORIZATION',
        ),
        [['approve']],
      ),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await expect(
      answer(
        await seedPending(
          [
            {
              prompt: 'Authorize',
              options: [
                { label: 'Approve', value: 'approve' },
                { label: 'Deny', value: 'deny' },
              ],
            },
          ],
          'AUTHORIZATION',
        ),
        [['deny']],
      ),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await expect(answer(await seedPending(handoffQuestions(), 'HUMAN_HANDOFF'), [['final_answer'], ['Human final']])).resolves.toMatchObject({
      status: 'RECEIVED',
    });
    await expect(
      answer(await seedPending(handoffQuestions(), 'HUMAN_HANDOFF'), [['resume_instruction'], ['Human instruction']]),
    ).resolves.toMatchObject({ status: 'RECEIVED' });

    const blankText = await seedPending([{ prompt: 'Text', options: [] }]);
    await expect(answer(blankText, [[' ']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(blankText);
    const singleCustomOverflow = await seedPending([{ prompt: 'Single custom', options: [{ label: 'A', value: 'a' }], custom: true }]);
    await expect(answer(singleCustomOverflow, [['a', 'manual']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(singleCustomOverflow);
    const missingAttachedText = await seedPending([
      { prompt: 'Attached', options: [{ label: 'Project', value: 'project', requiresTextInput: true }] },
    ]);
    await expect(answer(missingAttachedText, [['project']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(missingAttachedText);
    const unknownAttachedOption = await seedPending([
      { prompt: 'Attached', options: [{ label: 'Project', value: 'project', requiresTextInput: true }] },
    ]);
    await expect(answer(unknownAttachedOption, [['file', 'src/example.ts']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(unknownAttachedOption);
    const extraAttachedValue = await seedPending([
      { prompt: 'Attached', options: [{ label: 'Project', value: 'project', requiresTextInput: true }] },
    ]);
    await expect(answer(extraAttachedValue, [['project', 'src/example.ts', 'extra']])).rejects.toMatchObject({
      code: 'PENDING_INPUT_ANSWER_INVALID',
    });
    await expectPending(extraAttachedValue);
    const oversizedAttachedText = await seedPending([
      { prompt: 'Attached', options: [{ label: 'Project', value: 'project', requiresTextInput: true }] },
    ]);
    await expect(answer(oversizedAttachedText, [['project', 'x'.repeat(501)]])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(oversizedAttachedText);
    const ordinaryOptionWithText = await seedPending([{ prompt: 'Ordinary', options: [{ label: 'Project', value: 'project' }] }]);
    await expect(answer(ordinaryOptionWithText, [['project', 'src/example.ts']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(ordinaryOptionWithText);
    const emptyMulti = await seedPending([{ prompt: 'Empty multi', options: [{ label: 'A', value: 'a' }], multiple: true }]);
    await expect(answer(emptyMulti, [[]])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(emptyMulti);
    const duplicateMulti = await seedPending([{ prompt: 'Duplicate', options: [{ label: 'A', value: 'a' }], multiple: true }]);
    await expect(answer(duplicateMulti, [['a', 'a']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(duplicateMulti);
    const freeText = await seedPending([{ prompt: 'Free text', options: [{ label: 'A', value: 'a' }] }]);
    await expect(answer(freeText, [['manual']])).resolves.toMatchObject({ status: 'RECEIVED' });
    const tooManyCustom = await seedPending([{ prompt: 'Too many custom', options: [{ label: 'A', value: 'a' }], multiple: true, custom: true }]);
    await expect(answer(tooManyCustom, [['manual-a', 'manual-b']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(tooManyCustom);
    const emptyConfirmation = await seedPending(
      [
        {
          prompt: 'Confirm',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Reject', value: 'reject' },
          ],
        },
      ],
      'CONFIRMATION',
    );
    await expect(answer(emptyConfirmation, [[]])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(emptyConfirmation);
    const unknownConfirmation = await seedPending(
      [
        {
          prompt: 'Confirm',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Reject', value: 'reject' },
          ],
        },
      ],
      'CONFIRMATION',
    );
    await expect(answer(unknownConfirmation, [['yes']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(unknownConfirmation);
    const multiValueConfirmation = await seedPending(
      [
        {
          prompt: 'Confirm',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Reject', value: 'reject' },
          ],
        },
      ],
      'CONFIRMATION',
    );
    await expect(answer(multiValueConfirmation, [['approve', 'reject']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(multiValueConfirmation);
    const customTextConfirmation = await seedPending(
      [
        {
          prompt: 'Confirm',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Reject', value: 'reject' },
          ],
        },
      ],
      'CONFIRMATION',
    );
    await expect(answer(customTextConfirmation, [['manual']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(customTextConfirmation);
    const multiQuestionConfirmation = await seedPending(
      [
        {
          prompt: 'Confirm first',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Reject', value: 'reject' },
          ],
        },
        {
          prompt: 'Confirm second',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Reject', value: 'reject' },
          ],
        },
      ],
      'CONFIRMATION',
    );
    await expect(answer(multiQuestionConfirmation, [['approve'], ['reject']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(multiQuestionConfirmation);
    const emptyAuthorization = await seedPending(
      [
        {
          prompt: 'Authorize',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Deny', value: 'deny' },
          ],
        },
      ],
      'AUTHORIZATION',
    );
    await expect(answer(emptyAuthorization, [[]])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(emptyAuthorization);
    const unknownAuthorization = await seedPending(
      [
        {
          prompt: 'Authorize',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Deny', value: 'deny' },
          ],
        },
      ],
      'AUTHORIZATION',
    );
    await expect(answer(unknownAuthorization, [['yes']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(unknownAuthorization);
    const multiValueAuthorization = await seedPending(
      [
        {
          prompt: 'Authorize',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Deny', value: 'deny' },
          ],
        },
      ],
      'AUTHORIZATION',
    );
    await expect(answer(multiValueAuthorization, [['approve', 'deny']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(multiValueAuthorization);
    const customTextAuthorization = await seedPending(
      [
        {
          prompt: 'Authorize',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Deny', value: 'deny' },
          ],
        },
      ],
      'AUTHORIZATION',
    );
    await expect(answer(customTextAuthorization, [['manual']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(customTextAuthorization);
    const multiQuestionAuthorization = await seedPending(
      [
        {
          prompt: 'Authorize first',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Deny', value: 'deny' },
          ],
        },
        {
          prompt: 'Authorize second',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Deny', value: 'deny' },
          ],
        },
      ],
      'AUTHORIZATION',
    );
    await expect(answer(multiQuestionAuthorization, [['approve'], ['deny']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(multiQuestionAuthorization);
    const missingHandoffContent = await seedPending(handoffQuestions(), 'HUMAN_HANDOFF');
    await expect(answer(missingHandoffContent, [['final_answer']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(missingHandoffContent);
    const unknownHandoffMode = await seedPending(handoffQuestions(), 'HUMAN_HANDOFF');
    await expect(answer(unknownHandoffMode, [['operator_note'], ['text']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(unknownHandoffMode);
    const emptyHandoffContent = await seedPending(handoffQuestions(), 'HUMAN_HANDOFF');
    await expect(answer(emptyHandoffContent, [['final_answer'], [' ']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(emptyHandoffContent);
    const multiModeHandoff = await seedPending(handoffQuestions(), 'HUMAN_HANDOFF');
    await expect(answer(multiModeHandoff, [['final_answer', 'resume_instruction'], ['text']])).rejects.toMatchObject({
      code: 'PENDING_INPUT_ANSWER_INVALID',
    });
    await expectPending(multiModeHandoff);
    const multiContentHandoff = await seedPending(handoffQuestions(), 'HUMAN_HANDOFF');
    await expect(answer(multiContentHandoff, [['final_answer'], ['text', 'more']])).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });
    await expectPending(multiContentHandoff);

    const replaySeed = await seedPending([
      {
        prompt: 'Replay',
        options: [
          { label: 'yes', value: 'yes' },
          { label: 'no', value: 'no' },
        ],
      },
    ]);
    const replayKey = brand<string, 'IdempotencyKey'>('idem-answer-shape-replay');
    await expect(answer(replaySeed, [['yes']], replayKey)).resolves.toMatchObject({ status: 'RECEIVED' });
    await expect(answer(replaySeed, [['yes']], replayKey)).resolves.toMatchObject({ status: 'RECEIVED' });
    await expect(answer(replaySeed, [['no']], replayKey)).rejects.toMatchObject({ code: 'PENDING_INPUT_IDEMPOTENCY_CONFLICT' });
    await expect(answer(replaySeed, [['yes']], brand<string, 'IdempotencyKey'>('idem-answer-shape-new-device'))).rejects.toMatchObject({
      code: 'PENDING_INPUT_ALREADY_RESOLVED',
    });
  });

  it('does not resolve pending input when the owning run is unavailable', async () => {
    const gateway = createTestGatewayStores();
    const runtime = createRuntime(gateway, async () => {});
    const sessionId = brand<string, 'SessionId'>('session-answer-missing-run');
    const requestId = brand<string, 'MessageId'>('request-answer-missing-run');
    const runId = brand<string, 'RequestRunId'>('run-answer-missing-run');
    const pendingInputId = brand<string, 'PendingInputId'>('pending-answer-missing-run');
    await createSession(gateway, sessionId);
    await gateway.pendingInputs.createPendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      record: pendingInputRecord({
        pendingInputId,
        sessionId,
        requestId,
        requestRunId: runId,
        kind: 'HUMAN_HANDOFF',
        request: {
          id: pendingInputId,
          sessionId,
          kind: 'HUMAN_HANDOFF',
          questions: handoffQuestions(),
        },
      }),
    });

    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-answer-missing-run'),
        answer: {
          sessionId,
          pendingInputId,
          answers: [['final_answer'], ['late human final']],
        },
      }),
    ).rejects.toMatchObject({ code: 'PENDING_INPUT_RESUME_UNAVAILABLE' });
    await expect(
      gateway.pendingInputs.loadPendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        pendingInputId,
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('handles duplicate cancel idempotently and rejects semantic conflicts', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-cancel-idem');
    const runId = brand<string, 'RequestRunId'>('run-cancel-idem');
    const requestId = brand<string, 'MessageId'>('request-cancel-idem');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId }), {});
    const runtime = createRuntime(gateway, async () => {});

    const first = await runtime.cancel({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-repeat'),
    });
    const replay = await runtime.cancel({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-repeat'),
    });
    await expect(
      runtime.cancel({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-cancel-other'),
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-repeat'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCEL_IDEMPOTENCY_CONFLICT' });
    await expect(
      runtime.cancel({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: requestId,
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-repeat-other-key'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCEL_ALREADY_TERMINAL' });

    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    expect(replay).toEqual(first);
    expect(events.filter((event) => event.type === 'REQUEST_CANCELED')).toHaveLength(1);
  });

  it('replays accepted cancel outcome from durable facts after runtime restart', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-cancel-idem-restart');
    const runId = brand<string, 'RequestRunId'>('run-cancel-idem-restart');
    const requestId = brand<string, 'MessageId'>('request-cancel-idem-restart');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId }), {});
    const firstRuntime = createRuntime(gateway, async () => {});

    const first = await firstRuntime.cancel({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-restart'),
    });
    const restartedRuntime = createRuntime(gateway, async () => {});
    const replay = await restartedRuntime.cancel({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-restart'),
    });
    await expect(
      restartedRuntime.cancel({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-cancel-restart-other'),
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-restart'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCEL_IDEMPOTENCY_CONFLICT' });

    expect(replay).toEqual(first);
  });

  it('fences cancel against a concurrent terminal commit without publishing a second terminal event', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-cancel-terminal-race');
    const runId = brand<string, 'RequestRunId'>('run-cancel-terminal-race');
    const requestId = brand<string, 'MessageId'>('request-cancel-terminal-race');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId }), {});
    const originalCommit = gateway.requestRuns.commitTerminal.bind(gateway.requestRuns);
    (gateway.requestRuns as unknown as { commitTerminal: typeof gateway.requestRuns.commitTerminal }).commitTerminal = async () => {
      const current = await loadRun(gateway, runId);
      if (current !== undefined) {
        await gateway.requestRuns.saveRun(
          {
            ...current,
            status: 'COMPLETED',
            terminalCommitState: 'COMMITTED',
            version: current.version + 1,
            updatedAt: brand<number, 'EpochMillis'>(99),
          },
          { expectedVersion: current.version },
        );
      }
      return { status: 'ALREADY_COMMITTED' };
    };
    const runtime = createRuntime(gateway, async () => {});

    await expect(
      runtime.cancel({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: requestId,
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-terminal-race'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCEL_ALREADY_TERMINAL' });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    (gateway.requestRuns as unknown as { commitTerminal: typeof gateway.requestRuns.commitTerminal }).commitTerminal = originalCommit;

    expect((await loadRun(gateway, runId))?.status).toBe('COMPLETED');
    expect(events.filter((event) => event.type === 'REQUEST_CANCELED')).toHaveLength(0);
  });
});
