import { createNextAgentTestApp, readCapturedAuditRecords } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-risk-policy'),
  subjectId: brand<string, 'SubjectId'>('subject-risk-policy'),
  displayName: 'Risk policy tester',
};

describe('risk policy enforcement', () => {
  it('allows medium-risk writes without authorization pending input and still records an ALLOW evaluation', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-risk-policy-write-allow-'));
    const relativePath = 'diagnostics/allowed-write.txt';
    const content = 'Write completed without authorization.\n';
    const app = createNextAgentTestApp({
      workspaceDir,
      identity,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-write-allow',
              toolName: 'Write',
              arguments: { file_path: `workspace/${relativePath}`, content },
            },
          ],
        },
        { content: '写入完成。' },
      ],
    });

    try {
      const sessionId = brand<string, 'SessionId'>('session-risk-policy-write-allow');
      await app.gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const accepted = await app.runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: '请写入诊断文件。',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-risk-policy-submit-write-allow'),
      });

      await waitForRunTerminal(app, accepted.runId, 'COMPLETED');
      await expect(readAuthorizedFile(app, accepted.runId, sessionId, relativePath)).resolves.toBe(content);

      const events = await app.gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId,
        runId: accepted.runId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining(['POLICY_APPLIED', 'CAPABILITY_STARTED', 'CAPABILITY_COMPLETED', 'REQUEST_COMPLETED']),
      );
      expect(events.map((event) => event.type)).not.toContain('USER_INPUT_REQUIRED');
      expect(
        events.find((event) => event.type === 'POLICY_APPLIED' && event.inlinePayload['operationId'] === 'Write:tool-write-allow')?.inlinePayload,
      ).toMatchObject({
        operationKind: 'CAPABILITY_INVOCATION',
        outcome: 'ALLOW',
        riskLevel: 'MEDIUM',
      });
    } finally {
      await app.close();
      await rm(workspaceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('allows multiple medium-risk writes in one run without creating authorization pending input', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-risk-policy-multi-write-'));
    const firstPath = 'diagnostics/first-write.txt';
    const secondPath = 'diagnostics/second-write.txt';
    const app = createNextAgentTestApp({
      workspaceDir,
      identity,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-write-first',
              toolName: 'Write',
              arguments: { file_path: `workspace/${firstPath}`, content: 'first write\n' },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'tool-write-second',
              toolName: 'Write',
              arguments: { file_path: `workspace/${secondPath}`, content: 'second write\n' },
            },
          ],
        },
        { content: 'writes completed' },
      ],
    });

    try {
      const sessionId = brand<string, 'SessionId'>('session-risk-policy-multi-write');
      await app.gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const accepted = await app.runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: '连续写两个文件。',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-risk-policy-submit-multi-write'),
      });

      await waitForRunTerminal(app, accepted.runId, 'COMPLETED');
      await expect(readAuthorizedFile(app, accepted.runId, sessionId, firstPath)).resolves.toBe('first write\n');
      await expect(readAuthorizedFile(app, accepted.runId, sessionId, secondPath)).resolves.toBe('second write\n');

      const events = await app.gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId,
        runId: accepted.runId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });
      expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['CAPABILITY_STARTED', 'CAPABILITY_COMPLETED', 'REQUEST_COMPLETED']));
      expect(events.map((event) => event.type)).not.toContain('USER_INPUT_REQUIRED');
    } finally {
      await app.close();
      await rm(workspaceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('records medium risk for tool evaluations instead of high risk', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-risk-policy-medium-risk-'));
    const relativePath = 'diagnostics/medium-write.txt';
    const app = createNextAgentTestApp({
      workspaceDir,
      identity,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-write-medium',
              toolName: 'Write',
              arguments: { file_path: `workspace/${relativePath}`, content: 'medium risk write\n' },
            },
          ],
        },
        { content: 'medium write completed' },
      ],
    });

    try {
      const sessionId = brand<string, 'SessionId'>('session-risk-policy-medium-risk');
      await app.gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const accepted = await app.runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: '写一个 medium 风险文件。',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-risk-policy-submit-medium-risk'),
      });

      await waitForRunTerminal(app, accepted.runId, 'COMPLETED');

      const events = await app.gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId,
        runId: accepted.runId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });
      expect(
        events.find((event) => event.type === 'POLICY_APPLIED' && event.inlinePayload['operationId'] === 'Write:tool-write-medium')?.inlinePayload,
      ).toMatchObject({
        outcome: 'ALLOW',
        riskLevel: 'MEDIUM',
      });
    } finally {
      await app.close();
      await rm(workspaceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('denies forged owner scope fields before the capability executes', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-risk-policy-forged-owner-'));
    const app = createNextAgentTestApp({
      workspaceDir,
      identity,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-read-forged-owner',
              toolName: 'Read',
              arguments: { file_path: 'workspace/diagnostics/ignored.txt', tenantId: 'forged-tenant' },
            },
          ],
        },
        { content: 'should not happen' },
      ],
    });

    try {
      const sessionId = brand<string, 'SessionId'>('session-risk-policy-forged-owner');
      await app.gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const accepted = await app.runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: '读取一个文件。',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-risk-policy-submit-forged-owner'),
      });

      await waitForRunTerminal(app, accepted.runId, 'COMPLETED');

      const events = await app.gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId,
        runId: accepted.runId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });
      expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['POLICY_APPLIED', 'REQUEST_COMPLETED']));
      expect(events.map((event) => event.type)).not.toContain('CAPABILITY_STARTED');
      expect(
        events.find((event) => event.type === 'POLICY_APPLIED' && event.inlinePayload['operationKind'] === 'CAPABILITY_INVOCATION')?.inlinePayload,
      ).toMatchObject({
        outcome: 'DENY',
        reasonCode: 'OWNER_SCOPE_MISMATCH',
        toolCallId: 'tool-read-forged-owner',
      });
      const audit = readCapturedAuditRecords(app);
      expect(audit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventName: 'policy.denied',
            safeSummary: 'Risk policy outcome applied.',
            attributes: expect.objectContaining({
              operation: 'POLICY_DENIED',
              safeReasonCode: 'OWNER_SCOPE_MISMATCH',
            }),
          }),
        ]),
      );
    } finally {
      await app.close();
      await rm(workspaceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('denies unavailable capabilities through policy before execution starts', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-risk-policy-unavailable-'));
    const app = createNextAgentTestApp({
      workspaceDir,
      identity,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-unavailable-capability',
              toolName: 'UnknownCapability',
              arguments: {},
            },
          ],
        },
        { content: 'should not happen' },
      ],
    });

    try {
      const sessionId = brand<string, 'SessionId'>('session-risk-policy-unavailable');
      await app.gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const accepted = await app.runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: '调用一个不存在的 capability。',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-risk-policy-submit-unavailable'),
      });

      await waitForRunTerminal(app, accepted.runId, 'COMPLETED');

      const events = await app.gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId,
        runId: accepted.runId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });
      expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['POLICY_APPLIED', 'REQUEST_COMPLETED']));
      expect(events.map((event) => event.type)).not.toContain('CAPABILITY_STARTED');
      expect(
        events.find((event) => event.type === 'POLICY_APPLIED' && event.inlinePayload['operationKind'] === 'CAPABILITY_INVOCATION')?.inlinePayload,
      ).toMatchObject({
        outcome: 'DENY',
        reasonCode: 'CAPABILITY_UNAVAILABLE',
        toolCallId: 'tool-unavailable-capability',
      });
      const audit = readCapturedAuditRecords(app);
      expect(audit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventName: 'policy.denied',
            attributes: expect.objectContaining({
              operation: 'POLICY_DENIED',
              safeReasonCode: 'CAPABILITY_UNAVAILABLE',
            }),
          }),
        ]),
      );
    } finally {
      await app.close();
      await rm(workspaceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('allows medium-risk reads and records a redacted ALLOW policy evaluation', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-risk-policy-allow-'));
    const targetFile = join(workspaceDir, 'allow-me.txt');
    await writeFile(targetFile, 'allow path\n', 'utf8');
    const app = createNextAgentTestApp({
      workspaceDir,
      identity,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-read-allow',
              toolName: 'Read',
              arguments: { file_path: 'workspace/allow-me.txt', offset: 0, limit: 20 },
            },
          ],
        },
        { content: '读取完成。' },
      ],
    });

    try {
      const sessionId = brand<string, 'SessionId'>('session-risk-policy-allow');
      await app.gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const accepted = await app.runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: '读取这个文件。',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-risk-policy-submit-allow'),
      });

      await waitForRunTerminal(app, accepted.runId, 'COMPLETED');

      const events = await app.gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId,
        runId: accepted.runId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining(['POLICY_APPLIED', 'CAPABILITY_STARTED', 'CAPABILITY_COMPLETED', 'REQUEST_COMPLETED']),
      );
      expect(events.map((event) => event.type)).not.toContain('USER_INPUT_REQUIRED');

      const policy = events.find((event) => event.type === 'POLICY_APPLIED' && event.inlinePayload['operationId'] === 'Read:tool-read-allow');
      expect(policy?.inlinePayload).toMatchObject({ outcome: 'ALLOW', riskLevel: 'MEDIUM' });
      expect(JSON.stringify(policy)).not.toMatch(/allow-me\.txt|file_path|offset|limit/u);
    } finally {
      await app.close();
      await rm(workspaceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await assertion()).toBe(true);
}

async function waitForRunTerminal(app: ReturnType<typeof createNextAgentTestApp>, runId: string, status: 'COMPLETED' | 'FAILED'): Promise<void> {
  await waitFor(async () => {
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId: brand<string, 'AgentId'>('default-agent'),
      runId: brand<string, 'RequestRunId'>(runId),
    });
    return run?.status === status && run.terminalCommitState === 'COMMITTED';
  });
}

async function readAuthorizedFile(
  app: ReturnType<typeof createNextAgentTestApp>,
  runId: string,
  sessionId: string,
  relativePath: string,
): Promise<string> {
  const assembly = await app.assemblyRegistry.require(brand<string, 'AgentId'>('default-agent'), brand<string, 'AgentVersion'>('v1'));
  const executionWorkspace = createExecutionWorkspaceResolver().resolve({
    runtimeWorkspaceRoot: app.systemConfig.paths.runtimeWorkspaceRoot,
    sharedDataRoot: app.systemConfig.paths.sharedDataRoot,
    workspacePolicy: assembly.workspacePolicy,
    agentId: brand<string, 'AgentId'>('default-agent'),
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    sessionId: brand<string, 'SessionId'>(sessionId),
    runId: brand<string, 'RequestRunId'>(runId),
    deploymentMode: 'LOCAL',
  });
  const workspaceRoot = executionWorkspace.roots.find((root) => root.kind === 'workspace')?.physicalPath;
  if (workspaceRoot === undefined) {
    throw new Error('Workspace root was not resolved.');
  }
  const target = join(workspaceRoot, ...relativePath.split('/'));
  await access(target);
  return readFile(target, 'utf8');
}
