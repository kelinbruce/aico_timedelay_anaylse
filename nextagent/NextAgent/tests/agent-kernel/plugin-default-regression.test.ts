import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type IdentityContext } from '@nextagent/agent-common';
import { createCapabilitySubsystem } from '@nextagent/agent-capability';
import { describe, expect, it } from 'vitest';

describe('plugin default regression', () => {
  it('keeps builtin capability visibility when no plugins are configured', async () => {
    const subsystem = createCapabilitySubsystem({ builtinSkillDiscoveryOptions: { enabled: false } });

    await expect(
      subsystem.catalog.listAvailable({
        tenantId: brand<string, 'TenantId'>('tenant-default-regression'),
        subjectId: brand<string, 'SubjectId'>('subject-default-regression'),
        agentAssembly: {
          agentId: brand<string, 'AgentId'>('agent-default-regression'),
          agentType: brand<string, 'AgentType'>('telecom'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          agentAssemblyRef: 'agent-default-regression:v1',
          displayName: 'Default regression agent',
          description: 'Default regression agent.',
          workspacePolicy: {
            schemaVersion: 'nextagent.agent-workspace-policy.v1',
            isolationMode: 'subject',
            roots: [
              { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
              { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
              { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
            ],
          },
          modelIds: ['test-model'],
          capabilityBindings: [],
          userInvocable: true,
          agentInvocation: 'BOUND',
          runtimeSettings: { requestTimeoutMs: 1000 },
        },
        includeUnavailable: false,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ capabilityId: 'Read', provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' } })]),
    );
  });

  it('keeps request execution on the built-in routing and lifecycle path when no plugin is loaded or activated', async () => {
    const identity = {
      tenantId: brand<string, 'TenantId'>('tenant-plugin-default'),
      subjectId: brand<string, 'SubjectId'>('subject-plugin-default'),
      displayName: 'Plugin default tester',
    };
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'default plugin regression ok' }],
      identity,
    });
    try {
      const session = await app.runtime.createSession({
        identityContext: identity,
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-plugin-default-session'),
      });
      const accepted = await app.runtime.submit({
        sessionId: session.sessionId,
        identityContext: identity,
        inputText: 'run without plugins',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-plugin-default-submit'),
      });
      const event = await waitForCompleted(app, identity, session.sessionId, accepted.runId);

      expect(event.inlinePayload['content']).toBe('default plugin regression ok');
    } finally {
      await app.close();
    }
  });
});

async function waitForCompleted(app: ReturnType<typeof createNextAgentTestApp>, identity: IdentityContext, sessionId: string, runId: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const events = await app.gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId: brand<string, 'AgentId'>('default-agent'),
      sessionId: sessionId as never,
      runId: runId as never,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 200,
    });
    const completed = events.find((event) => event.type === 'REQUEST_COMPLETED');
    if (completed !== undefined) {
      return completed;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for default plugin regression run.');
}
