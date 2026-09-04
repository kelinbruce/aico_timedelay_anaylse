import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import { createDefaultContextEngine } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';
import { createTestModelSelectionService } from '../../packages/agent-context-engine/tests/test-model-selection-helpers.js';

const ownerA = {
  tenantId: brand<string, 'TenantId'>('tenant-owner-a'),
  subjectId: brand<string, 'SubjectId'>('subject-owner-a'),
  displayName: 'Owner A',
};

const ownerB = {
  tenantId: brand<string, 'TenantId'>('tenant-owner-b'),
  subjectId: brand<string, 'SubjectId'>('subject-owner-b'),
  displayName: 'Owner B',
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

describe('owner scope isolation', () => {
  it('keeps session, message, run, timeline and history facts invisible across owners', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'owner scoped answer' }],
      identity: ownerA,
    });
    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'owner scoped request', idempotencyKey: 'idem-owner-scope' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    await waitFor(async () => {
      const run = await app.gateway.requestRuns.loadRun({
        tenantId: ownerA.tenantId,
        subjectId: ownerA.subjectId,
        agentId,
        runId: brand<string, 'RequestRunId'>(body.runId),
      });
      return run?.terminalCommitState === 'COMMITTED';
    });

    await expect(
      app.sessions.requireSession({ identityContext: ownerB, agentId, sessionId: brand<string, 'SessionId'>(body.sessionId) }),
    ).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
    await expect(
      app.sessions.listMessages({
        identityContext: ownerB,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        includeCapabilityResults: false,
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });

    await expect(
      app.gateway.messages.loadMessage({
        tenantId: ownerB.tenantId,
        subjectId: ownerB.subjectId,
        agentId,
        messageId: brand<string, 'MessageId'>(body.requestId),
      }),
    ).resolves.toBeUndefined();
    await expect(
      app.gateway.requestRuns.loadRun({
        tenantId: ownerB.tenantId,
        subjectId: ownerB.subjectId,
        agentId,
        runId: brand<string, 'RequestRunId'>(body.runId),
      }),
    ).resolves.toBeUndefined();
    await expect(
      app.gateway.timeline.listEvents({
        tenantId: ownerB.tenantId,
        subjectId: ownerB.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 1000,
      }),
    ).resolves.toEqual([]);
  });

  it('fails closed when runtime stream lacks owner and passes request owner into context assembly', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'unused' }],
      identity: ownerA,
    });
    const sessionId = brand<string, 'SessionId'>('session-without-runtime-owner');

    await expect(
      (async () => {
        for await (const _event of app.runtime.stream({ sessionId, lastSeenSequence: brand<number, 'TimelineSequence'>(0) })) {
          // no-op
        }
      })(),
    ).rejects.toMatchObject({ code: 'OWNER_SCOPE_UNAVAILABLE' });

    const assembly = await app.assemblyRegistry.active(app.systemConfig.activeAgentId);
    const contextEngine = createDefaultContextEngine({
      activeContextStore: app.gateway.activeContext,
      messageStore: app.gateway.messages,
      assemblyRegistry: app.assemblyRegistry,
      capabilityCatalog: createStaticCapabilityCatalog([]),
      modelSelectionService: createTestModelSelectionService({
        modelId: 'owner-scope-test',
        defaultTimeoutMs: 1_000,
      }),
    });

    await expect(
      contextEngine.assemble(
        {
          sessionId,
          requestId: brand<string, 'MessageId'>('request-with-owner'),
          requestContextId: brand<string, 'RequestContextId'>('context-with-owner'),
          identityContext: ownerA,
          agentId: assembly.agentId,
          agentVersion: assembly.agentVersion,
          runId: brand<string, 'RequestRunId'>('run-with-owner'),
          stepId: 'turn-1',
          locale: brand<string, 'RequestLocale'>('zh-CN'),
          purpose: 'minimal-question-answer',
        },
        undefined,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ request: { identityContext: ownerA } });
  });
});
