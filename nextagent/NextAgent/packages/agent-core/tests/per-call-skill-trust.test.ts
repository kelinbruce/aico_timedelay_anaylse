import { executeToolCallsInOrder, type RequestLocalCapabilityState } from '@nextagent/agent-core';
import { createCapabilitySubsystem, type ToolDependencies } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type {
  AgentRunStatePort,
  LifecycleHookInvocationPort,
  RequestContext,
  RequestRun,
  RunTimelineEvent,
} from '@nextagent/agent-contracts/runtime';
import type { SessionMessageDraft } from '@nextagent/agent-contracts/session';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const supportedExecutablePlatformIt = process.platform === 'win32' || process.platform === 'linux' ? it : it.skip;

/**
 * End-to-end coverage of the per-call Skill resource access contract:
 *   1. The Skill tool projects source-owned resources into `.nextagent/skills/...`.
 *   2. The tool loop appends the Skill capability result that discloses only the
 *      logical projection root for the current run.
 *   3. A later bash call can use that logical root, while the sandbox adapter
 *      remains the owner of physical filesystem layout authorization.
 *
 * Without this contract, a Skill that ships its own helper script (e.g.
 * `python .nextagent/skills/.../scripts/rag_query.py ...`) would fail at the
 * policy or sandbox layer because the per-run projection was never authorized.
 */
describe('per-call Skill trust propagation', () => {
  supportedExecutablePlatformIt('routes a projected Skill-bundled python script through bash + sandbox using the logical resource root', async () => {
    const workspace = mkdtempSync(join(os.tmpdir(), 'nextagent-pc-ws-'));
    const skillRoot = mkdtempSync(join(os.tmpdir(), 'nextagent-pc-skill-'));
    const skillDir = join(skillRoot, 'rag-skill');
    mkdirSync(skillDir);
    mkdirSync(join(skillDir, 'scripts'));
    writeFileSync(join(skillDir, 'SKILL.md'), skillManifest('rag-skill'));
    writeFileSync(join(skillDir, 'scripts', 'rag_query.py'), "import sys; print('rag-ok', sys.argv[1])\n");

    try {
      // 1. The bash tool needs a sandbox port. We mock it to capture the
      //    Python script submission; no actual process runs.
      const runShell = vi.fn();
      const runPython = vi.fn<NonNullable<NonNullable<ToolDependencies['sandbox']>['runPython']>>(async () => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
      }));
      const sandboxPort: NonNullable<ToolDependencies['sandbox']> = {
        runShell,
        runPython,
        startBackgroundShell: vi.fn(),
        runShellBackgroundable: vi.fn(),
      };

      // 2. Build the subsystem. `localSkillDiscoveryOptions.systemSkillsRoot`
      //    anchors the system-local skill discovery at our temp fixture
      //    directory so the catalog picks up the Skill we just authored.
      const subsystem = createCapabilitySubsystem({
        read: { workspaceDir: workspace },
        toolDependencies: { sandbox: sandboxPort },
        localSkillDiscoveryOptions: { enabled: true, systemSkillsRoot: skillRoot },
      });

      // 4. Drive two rounds through the real tool loop: round 1 = Skill,
      //    round 2 = Bash. The first round projects and authorizes the Skill
      //    resource root; the second round must be able to use it.
      const run = makeRun();
      const context = makeContext();
      const appendedMessages: SessionMessageDraft[] = [];
      const runState = stubRunState(appendedMessages);
      const assembly = makeAssembly();
      const assemblyRegistry: AgentAssemblyRegistry = {
        async active() {
          return assembly;
        },
        async require() {
          return assembly;
        },
      };
      const lifecycleHook: LifecycleHookInvocationPort = {
        async invoke(request) {
          return { status: 'CONTINUE', boundary: request.boundary };
        },
      };
      const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

      await executeToolCallsInOrder(
        {
          capabilityCatalog: subsystem.catalog,
          capabilityInvocation: subsystem.invocationPort as CapabilityInvocationPort,
          assemblyRegistry,
          ...(lifecycleHook ? { lifecycleHook } : {}),
        },
        {
          run,
          context,
          runState,
          signal: new AbortController().signal,
          round: 0,
          requestLocalState,
          toolCalls: [{ toolCallId: 'call-skill', toolName: 'Skill', arguments: { name: 'rag-skill' } }],
        },
      );

      const skillPayload = capabilityResultPayload(appendedMessages, 'Skill');
      const skillBody = (skillPayload as { readonly body?: unknown }).body;
      expect(typeof skillBody).toBe('string');
      const match = /Skill resource root: (?<root>\.nextagent\/skills\/[^\n]+)/u.exec(typeof skillBody === 'string' ? skillBody : '');
      const projectedRoot = match?.groups?.['root'];
      expect(projectedRoot).toMatch(/^\.nextagent\/skills\/[a-f0-9]{16}\/rag-skill\/$/u);
      if (projectedRoot === undefined) {
        throw new Error('Expected a projected Skill resource root.');
      }
      expect(skillPayload).toMatchObject({
        name: 'rag-skill',
        status: 'loaded',
        capabilityResult: {
          metadata: {
            agenticSkillLoaded: true,
            skillName: 'rag-skill',
            providerId: 'local-skills-system',
          },
        },
      });
      expect(skillBody).toContain('<skill_content name="rag-skill">');
      expect(skillBody).not.toContain('Glob hint: to enumerate Skill files');
      expect(requestLocalState.generatedMessages).toEqual([]);
      const projectedScript = resolve(workspace, projectedRoot, 'scripts', 'rag_query.py');
      expect(readFileSync(projectedScript, 'utf8')).toBe("import sys; print('rag-ok', sys.argv[1])\n");
      expect(existsSync(resolve(workspace, projectedRoot, 'SKILL.md'))).toBe(false);

      await executeToolCallsInOrder(
        {
          capabilityCatalog: subsystem.catalog,
          capabilityInvocation: subsystem.invocationPort as CapabilityInvocationPort,
          assemblyRegistry,
          ...(lifecycleHook ? { lifecycleHook } : {}),
        },
        {
          run,
          context,
          runState,
          signal: new AbortController().signal,
          round: 1,
          requestLocalState,
          toolCalls: [
            { toolCallId: 'call-bash', toolName: 'Bash', arguments: { command: `python ${projectedRoot}scripts/rag_query.py --query=hi` } },
          ],
        },
      );

      const bashCall = runPython.mock.calls[0]?.[0];
      expect(bashCall?.command).toBe('python');
      expect(bashCall?.args).toEqual([`${projectedRoot}scripts/rag_query.py`, '--query=hi']);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(skillRoot, { recursive: true, force: true });
    }
  });

  supportedExecutablePlatformIt('keeps retryable Bash parse failure as a model-visible Tool Result', async () => {
    const workspace = mkdtempSync(join(os.tmpdir(), 'nextagent-bash-policy-ws-'));
    try {
      const runShell = vi.fn<NonNullable<NonNullable<ToolDependencies['sandbox']>['runShell']>>(async () => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
      }));
      const sandboxPort: NonNullable<ToolDependencies['sandbox']> = {
        runShell,
        runPython: runShell,
        startBackgroundShell: vi.fn(),
        runShellBackgroundable: vi.fn(),
      };
      const subsystem = createCapabilitySubsystem({
        read: { workspaceDir: workspace },
        toolDependencies: { sandbox: sandboxPort },
      });
      const run = makeRun();
      const context = makeContext();
      const appendedMessages: SessionMessageDraft[] = [];
      const events: RunTimelineEvent[] = [];
      const runState = stubRunState(appendedMessages, events);
      const assembly = makeAssembly();
      const assemblyRegistry: AgentAssemblyRegistry = {
        async active() {
          return assembly;
        },
        async require() {
          return assembly;
        },
      };
      const lifecycleHook: LifecycleHookInvocationPort = {
        async invoke(request) {
          return { status: 'CONTINUE', boundary: request.boundary };
        },
      };
      const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

      await executeToolCallsInOrder(
        {
          capabilityCatalog: subsystem.catalog,
          capabilityInvocation: subsystem.invocationPort as CapabilityInvocationPort,
          assemblyRegistry,
          lifecycleHook,
        },
        {
          run,
          context,
          runState,
          signal: new AbortController().signal,
          round: 0,
          requestLocalState,
          toolCalls: [{ toolCallId: 'call-bash-denied', toolName: 'Bash', arguments: { command: "cat 'logs/alarm.txt" } }],
        },
      );

      expect(runShell).not.toHaveBeenCalled();
      const bashResult = capabilityResultPayload(appendedMessages, 'Bash');
      expect(bashResult).toMatchObject({
        status: 'FAILED',
        safeError: {
          code: 'COMMAND_NOT_ALLOWED',
          category: 'VALIDATION',
          retryable: false,
          safeDetails: {
            reasonCode: 'BASH_COMMAND_UNCLOSED_QUOTE',
          },
        },
      });
      expect(JSON.stringify((bashResult as { safeError?: unknown }).safeError)).not.toContain('allowedCommands');
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'CAPABILITY_COMPLETED',
            inlinePayload: expect.objectContaining({
              capabilityId: 'Bash',
              toolCallId: 'call-bash-denied',
              status: 'FAILED',
              safeErrorCode: 'COMMAND_NOT_ALLOWED',
              safeErrorCategory: 'VALIDATION',
            }),
          }),
          expect.objectContaining({
            type: 'DEGRADATION_NOTICE',
            inlinePayload: { code: 'COMMAND_NOT_ALLOWED' },
          }),
        ]),
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

function skillManifest(name: string): string {
  return `---
name: ${name}
description: Knowledge QA skill used in the per-call trust integration test.
context: inline
user-invocable: true
model-invocable: true
metadata:
  version: 0.1.0
---

This is a test skill used to verify the per-call trust contract.
`;
}

function makeRun(): RequestRun {
  return {
    sessionId: brand<string, 'SessionId'>('session-pc'),
    requestId: brand<string, 'MessageId'>('request-pc'),
    runId: brand<string, 'RequestRunId'>('run-pc'),
    agentId: brand<string, 'AgentId'>('agent-pc'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-pc:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  } as RequestRun;
}

function makeContext(): RequestContext {
  return {
    sessionId: brand<string, 'SessionId'>('session-pc'),
    requestId: brand<string, 'MessageId'>('request-pc'),
    runId: brand<string, 'RequestRunId'>('run-pc'),
    agentTurnIndex: 0,
    requestContextId: brand<string, 'RequestContextId'>('rc-pc'),
    agentId: brand<string, 'AgentId'>('agent-pc'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-pc:v1',
    locale: brand<string, 'RequestLocale'>('en-US'),
    flowVariables: {},
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-pc'),
      subjectId: brand<string, 'SubjectId'>('subject-pc'),
      displayName: 'Per-call trust tester',
    },
  };
}

function makeAssembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('agent-pc'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-pc:v1',
    displayName: 'Per-call trust tester',
    description: 'Tests per-call Skill trust propagation.',
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
  };
}

function stubRunState(appendedMessages: SessionMessageDraft[] = [], events: RunTimelineEvent[] = []): AgentRunStatePort {
  return {
    beginRun() {
      /* noop */
    },
    finishRun() {
      return { finalContent: '', outputExceeded: false };
    },
    discardRun() {
      /* noop */
    },
    async emitEvent(_run: RequestRun, _context: RequestContext, event: RunTimelineEvent) {
      events.push(event);
    },
    async appendMessage(_run: RequestRun, _context: RequestContext, draft: SessionMessageDraft) {
      appendedMessages.push(draft);
      return brand<string, 'MessageId'>('msg-pc');
    },
    async saveCheckpoint() {
      /* noop */
    },
    async requestPendingInput() {
      throw new Error('not used');
    },
    async loadCheckpoint() {
      return undefined;
    },
    async listActiveRuns() {
      return [];
    },
    async listSessions() {
      return [];
    },
    async requireSession() {
      return { sessionId: brand<string, 'SessionId'>('session-pc') };
    },
  } as unknown as AgentRunStatePort;
}

function capabilityResultPayload(messages: readonly SessionMessageDraft[], toolName: string): unknown {
  const message = messages.find((draft) => draft.role === 'CAPABILITY_RESULT' && draft.metadata?.['toolName'] === toolName);
  expect(message).toBeDefined();
  const parsed = JSON.parse(message?.content ?? '{}') as { readonly payload?: unknown };
  return parsed.payload;
}
