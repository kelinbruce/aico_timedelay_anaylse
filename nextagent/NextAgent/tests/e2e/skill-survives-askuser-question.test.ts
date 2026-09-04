import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { brand } from '@nextagent/agent-common';
import { cleanupE2ETestContext, createE2ETestContext, type E2ETestContext } from './e2e-helpers.js';
import { describe, expect, it } from 'vitest';

const SKILL_NAME = 'skill-survives-askuser-fixture';
const SENTINEL = 'SKILL_SURVIVES_ASKUSER_FIXTURE_SENTINEL_7421';

const identity = {
  tenantId: brand<string, 'TenantId'>('local-tenant'),
  subjectId: brand<string, 'SubjectId'>('local-subject'),
  displayName: 'Local developer',
};

const agentId = brand<string, 'AgentId'>('default-agent');

/**
 * Regression guard: after AskUserQuestion suspends and resumes a run, the
 * Skill body (`<skill_content>`) loaded earlier in the same run MUST still be
 * present in the model input of the post-resume turn.
 *
 * Original bug: the Skill tool injected `<skill_content>` via
 * `generatedMessages` (a request-local, non-persisted field on
 * `requestLocalCapabilityState`). It was never saved into the checkpoint, so
 * when AskUserQuestion triggered a pending-input suspend and the run resumed,
 * the next model invocation no longer contained the previously injected Skill
 * body — the model "forgot" the Skill's instructions after a clarifying
 * question.
 *
 * Fix (plan D): the Skill body now lives on the Skill tool-result payload
 * (`structuredPayload.body`), which persists as a CAPABILITY_RESULT session
 * message and is restored from the message store on resume. The renderer
 * (`placeGeneratedMessages`) reconstructs the `<skill_content>` generated
 * message from `output.body` so it is anchored after the matching Skill
 * tool-result, identical to the previous in-memory injection placement.
 */
describe('Skill body survives AskUserQuestion pending-input resume', () => {
  it('keeps <skill_content> in the model input after AskUserQuestion resume', async () => {
    const requests: ModelInvocationRequest[] = [];
    const ctx = await createE2ETestContext({
      tempPrefix: 'nextagent-skill-survives-askuser-',
      identity,
      modelRequestSink: requests,
      skillDisclosureMode: 'list',
      skillFixtures: [SKILL_NAME],
      modelSteps: [
        // Turn 1: load the Skill — injects <skill_content name="..."> with SENTINEL.
        {
          toolCalls: [
            {
              toolCallId: 'load-skill-1',
              toolName: 'Skill',
              arguments: { name: SKILL_NAME, args: {} },
            },
          ],
        },
        // Turn 2: ask the user a question — suspends the run via pending-input.
        {
          toolCalls: [
            {
              toolCallId: 'ask-1',
              toolName: 'AskUserQuestion',
              arguments: {
                questions: [
                  {
                    prompt: 'Proceed with the sentinel check?',
                    options: [
                      { value: 'yes', label: 'Yes' },
                      { value: 'no', label: 'No' },
                    ],
                  },
                ],
              },
            },
          ],
        },
        // Turn 3 (post-resume): final answer. The model input for THIS turn is
        // what we inspect — the Skill body must still be present here.
        { content: 'final answer after resume' },
      ],
    });

    try {
      const accepted = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Load the Skill, then ask me a question before finishing.',
          idempotencyKey: `skill-survives-askuser-${crypto.randomUUID()}`,
        }),
      });
      expect(accepted.status).toBe(200);
      const acceptedBody = (await accepted.json()) as { sessionId: string; runId: string; requestId: string };

      const pending = await waitForPendingInput(ctx.app, acceptedBody.sessionId);
      expect(pending).toBeDefined();

      await ctx.app.runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>(`skill-survives-askuser-answer-${crypto.randomUUID()}`),
        answer: {
          sessionId: brand<string, 'SessionId'>(acceptedBody.sessionId),
          pendingInputId: pending!.pendingInputId,
          answers: [['yes']],
        },
      });

      await waitForRunTerminal(ctx.app, acceptedBody.runId);

      // We expect exactly 3 model invocations: Skill load, AskUserQuestion, final.
      expect(requests).toHaveLength(3);

      // Sanity: the turn immediately after the Skill load MUST contain the
      // sentinel — this proves the Skill body was injected in-run.
      const afterSkillLoad = requestText(requests[1]!);
      expect(afterSkillLoad).toContain(`<skill_content name="${SKILL_NAME}">`);
      expect(afterSkillLoad).toContain(SENTINEL);

      // The actual reproduction: the turn AFTER the AskUserQuestion resume
      // (requests[2]) must still contain the Skill body. The body lives on the
      // Skill tool-result payload (`output.body`), which persists as a
      // CAPABILITY_RESULT session message and is restored from the message
      // store on resume. The renderer does NOT reconstruct a separate
      // USER(<skill_content>) message — the tool-result's `output.body` is the
      // single, in-place carrier — so `requestText` must serialize tool-result
      // output bodies to observe it.
      const afterResume = requestText(requests[2]!);
      expect(afterResume).toContain(`<skill_content name="${SKILL_NAME}">`);
      expect(afterResume).toContain(SENTINEL);
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 60_000);
});

function requestText(request: ModelInvocationRequest): string {
  // The Skill body (`<skill_content>`) is persisted as a standalone page-hidden
  // USER text message (modelVisibility.included) right after the Skill
  // tool-result, so plain-text extraction observes it. The tool-result body
  // extraction is kept as a defensive fallback for the volatile path.
  return request.messages
    .map((message) =>
      message.content
        .flatMap((part) => {
          if (part.type === 'text') {
            return [part.text];
          }
          if (part.type === 'tool-result') {
            const body = (part.output as { readonly body?: unknown })?.body;
            return typeof body === 'string' ? [body] : [];
          }
          return [];
        })
        .join('\n'),
    )
    .join('\n');
}

async function waitForPendingInput(app: E2ETestContext['app'], sessionId: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = await app.gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(sessionId),
    });
    if (pending !== undefined) {
      return pending;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for pending input.');
}

async function waitForRunTerminal(app: E2ETestContext['app'], runId: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(runId),
    });
    if (run?.terminalCommitState === 'COMMITTED' || run?.status === 'FAILED' || run?.status === 'COMPLETED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for run terminal.');
}
