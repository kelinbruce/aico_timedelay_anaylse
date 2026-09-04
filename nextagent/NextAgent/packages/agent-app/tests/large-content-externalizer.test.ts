import { brand } from '@nextagent/agent-common';
import { createWorkspaceFilePort, type ToolExecutionContext } from '@nextagent/agent-capability';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { ExecutionWorkspaceResolver, LargeContentExternalizationContext } from '@nextagent/agent-contracts/runtime';
import type { SessionMessageDraft } from '@nextagent/agent-contracts/session';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultLargeContentExternalizer } from '@nextagent/agent-context-engine';

describe('large content externalizer composition', () => {
  it.each([
    ['ASCII', 'x'.repeat(50_000), 'x'.repeat(50_001)],
    ['CJK', '界'.repeat(50_000), '界'.repeat(50_001)],
    ['emoji', '😀'.repeat(25_000), `${'😀'.repeat(25_000)}x`],
  ])('uses UTF-16 code-unit boundaries for %s capability results', async (_label, inlineContent, oversizedContent) => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-large-content-boundary-'));
    const workspaceRoot = join(root, 'workspace');
    await mkdir(workspaceRoot, { recursive: true });
    try {
      const externalizer = createDefaultLargeContentExternalizer({
        runtimeWorkspaceRoot: root,
        deploymentMode: 'LOCAL',
        executionWorkspaceResolver: resolver(workspaceRoot),
        assemblyRegistry: registry(),
      });

      expect(inlineContent.length).toBe(50_000);
      expect(oversizedContent.length).toBe(50_001);
      await expect(externalizer.externalize(draft(inlineContent), externalizationContext())).resolves.toEqual(draft(inlineContent));

      const externalized = await externalizer.externalize(draft(oversizedContent), externalizationContext());
      expect(externalized.content.length).toBeLessThanOrEqual(50_000);
      expect(externalized.metadata?.['replacement']).toMatchObject({
        contentRef: { refType: 'CAPABILITY_RESULT' },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes oversized non-Read capability results to execution workspace tool-results files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-large-content-'));
    const workspaceRoot = join(root, 'workspace');
    await mkdir(workspaceRoot, { recursive: true });
    try {
      const externalizer = createDefaultLargeContentExternalizer({
        runtimeWorkspaceRoot: root,
        deploymentMode: 'LOCAL',
        executionWorkspaceResolver: resolver(workspaceRoot),
        assemblyRegistry: registry(),
        now: () => 1000,
      });
      const content = JSON.stringify({ toolCallId: 'call-1', toolName: 'DiagnosticDump', payload: 'x'.repeat(60_000) });

      const result = await externalizer.externalize(draft(content), externalizationContext());

      expect(result.content).toContain('<persisted-content>');
      expect(result.content).toContain('File path: tool-results/');
      expect(result.content).toContain('Read tool');
      const rendered = JSON.parse(result.content) as {
        readonly toolCallId: string;
        readonly toolName: string;
        readonly payload: { readonly preview: string };
      };
      expect(rendered.toolCallId).toBe('call-1');
      expect(rendered.toolName).toBe('DiagnosticDump');
      expect(rendered.payload.preview).toContain('<persisted-content>');
      const replacement = result.metadata?.['replacement'] as
        { readonly contentRef?: { readonly refId?: string; readonly refType?: string } } | undefined;
      expect(replacement?.contentRef?.refType).toBe('CAPABILITY_RESULT');
      expect(replacement?.contentRef?.refId).toMatch(/^tool-results\/[a-f0-9]+\.txt$/u);
      const readbackContent = await readFile(join(workspaceRoot, replacement!.contentRef!.refId!), 'utf8');
      expect(readbackContent).toContain('toolCallId: call-1');
      expect(readbackContent).toContain('toolName: DiagnosticDump');
      expect(readbackContent).toContain('payload:');

      await expect(externalizer.externalize(result, externalizationContext())).resolves.toBe(result);
      await expect(readdir(join(workspaceRoot, 'tool-results'))).resolves.toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns an explicit failure marker when the workspace write fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-large-content-failure-'));
    const blockedWorkspacePath = join(root, 'not-a-directory');
    await writeFile(blockedWorkspacePath, 'blocked', 'utf8');
    try {
      const externalizer = createDefaultLargeContentExternalizer({
        runtimeWorkspaceRoot: root,
        deploymentMode: 'LOCAL',
        executionWorkspaceResolver: resolver(blockedWorkspacePath),
        assemblyRegistry: registry(),
      });
      const content = JSON.stringify({ toolCallId: 'call-1', toolName: 'DiagnosticDump', payload: 'x'.repeat(60_000) });

      const result = await externalizer.externalize(draft(content), externalizationContext());

      const rendered = JSON.parse(result.content) as { readonly payload: { readonly preview: string } };
      expect(rendered.payload.preview).toContain('large-content-offload-failed');
      expect(result.metadata?.['replacement']).toMatchObject({
        degradation: { code: 'degradation:offload-failed-into-overflow' },
      });
      expect(rendered.payload.preview).not.toContain('x'.repeat(5000));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('externalizes oversized Read results to workspace tool-results files (Read is no longer infinity-exempt)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-large-content-read-'));
    const workspaceRoot = join(root, 'workspace');
    await mkdir(workspaceRoot, { recursive: true });
    try {
      const externalizer = createDefaultLargeContentExternalizer({
        runtimeWorkspaceRoot: root,
        deploymentMode: 'LOCAL',
        executionWorkspaceResolver: resolver(workspaceRoot),
        assemblyRegistry: registry(),
      });
      const content = JSON.stringify({ toolCallId: 'call-1', toolName: 'Read', payload: { content: 'x'.repeat(60_000) } });
      const original = draft(content);

      const result = await externalizer.externalize(original, externalizationContext());

      expect(result).not.toBe(original);
      expect(result.content).toContain('<persisted-content>');
      expect(result.content).toContain('File path: tool-results/');
      const rendered = JSON.parse(result.content) as { readonly toolName: string; readonly payload: { readonly preview: string } };
      expect(rendered.toolName).toBe('Read');
      expect(rendered.payload.preview).toContain('<persisted-content>');
      const replacement = result.metadata?.['replacement'] as
        { readonly contentRef?: { readonly refId?: string; readonly refType?: string } } | undefined;
      expect(replacement?.contentRef?.refType).toBe('CAPABILITY_RESULT');
      expect(replacement?.contentRef?.refId).toMatch(/^tool-results\/[a-f0-9]+\.txt$/u);
      const readbackContent = await readFile(join(workspaceRoot, replacement!.contentRef!.refId!), 'utf8');
      expect(readbackContent).toContain('toolCallId: call-1');
      expect(readbackContent).toContain('toolName: Read');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('still externalizes oversized results when an explicit infinityToolNames opt-out is injected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-large-content-read-infinity-'));
    const workspaceRoot = join(root, 'workspace');
    await mkdir(workspaceRoot, { recursive: true });
    try {
      const externalizer = createDefaultLargeContentExternalizer({
        runtimeWorkspaceRoot: root,
        deploymentMode: 'LOCAL',
        executionWorkspaceResolver: resolver(workspaceRoot),
        assemblyRegistry: registry(),
        infinityToolNames: new Set(['Read']),
      });
      const content = JSON.stringify({ toolCallId: 'call-1', toolName: 'Read', payload: { content: 'x'.repeat(60_000) } });
      const original = draft(content);

      // Hosts can still opt a tool back into the infinity exemption via
      // explicit injection; the default just no longer includes Read.
      await expect(externalizer.externalize(original, externalizationContext())).resolves.toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes files that the Read workspace port can page back with offset and limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-large-content-readback-'));
    const workspaceRoot = join(root, 'workspace');
    await mkdir(workspaceRoot, { recursive: true });
    try {
      const workspaceResolver = resolver(workspaceRoot);
      const externalizer = createDefaultLargeContentExternalizer({
        runtimeWorkspaceRoot: root,
        deploymentMode: 'LOCAL',
        executionWorkspaceResolver: workspaceResolver,
        assemblyRegistry: registry(),
      });
      const lines = Array.from({ length: 600 }, (_, index) => `line-${index}:` + 'x'.repeat(80));
      const content = lines.join('\n');
      const result = await externalizer.externalize(draft(content), externalizationContext());
      const replacement = result.metadata?.['replacement'] as { readonly contentRef?: { readonly refId?: string } } | undefined;
      const filePath = replacement?.contentRef?.refId;
      expect(filePath).toMatch(/^tool-results\/[a-f0-9]+\.txt$/u);
      if (filePath === undefined) {
        throw new Error('Expected externalized contentRef file path.');
      }
      const workspaceFilePath = `workspace/${filePath}`;
      const blockedReadPort = createWorkspaceFilePort({
        runtimeWorkspaceRoot: root,
        executionWorkspaceResolver: workspaceResolver,
        deploymentMode: 'LOCAL',
        workspacePolicyProvider: {
          async require() {
            return agentAssembly().workspacePolicy;
          },
        },
        workspaceFileExtensionPolicyProvider: {
          async require() {
            return { readAllowedExtensions: ['.json'] };
          },
        },
      });
      await expect(blockedReadPort.readText({ file_path: workspaceFilePath }, toolContext())).rejects.toMatchObject({
        code: 'CAPABILITY_PATH_REJECTED',
        category: 'AUTHORIZATION',
        retryable: false,
      });
      const readPort = createWorkspaceFilePort({
        runtimeWorkspaceRoot: root,
        executionWorkspaceResolver: workspaceResolver,
        deploymentMode: 'LOCAL',
        workspacePolicyProvider: {
          async require() {
            return agentAssembly().workspacePolicy;
          },
        },
        workspaceFileExtensionPolicyProvider: {
          async require() {
            return { readAllowedExtensions: ['.txt'] };
          },
        },
        maxTextBytes: 160,
      });

      await expect(readPort.readText({ file_path: workspaceFilePath }, toolContext())).rejects.toMatchObject({
        reasonCode: 'PAGING_REQUIRED',
        structuredPayload: { error: 'PAGING_REQUIRED', content: '', nextOffset: 0 },
      });
      await expect(readPort.readText({ file_path: workspaceFilePath, offset: 599, limit: 1 }, toolContext())).resolves.toMatchObject({
        file_path: workspaceFilePath,
        offset: 599,
        limit: 1,
        content: lines[599],
        truncated: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
function draft(content: string): SessionMessageDraft {
  return {
    role: 'CAPABILITY_RESULT',
    content,
    contentType: 'PLAIN_TEXT',
    visible: true,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-large-content'),
  };
}

function resolver(workspaceRoot: string): ExecutionWorkspaceResolver {
  return {
    resolve: () => ({
      workspaceDir: 'workspace/',
      defaultCwd: workspaceRoot,
      roots: [{ kind: 'workspace', logicalPath: 'workspace', physicalPath: workspaceRoot, access: 'readWrite' }],
    }),
  };
}

function registry(): AgentAssemblyRegistry {
  const assembly = agentAssembly();
  return {
    active: async () => assembly,
    require: async () => assembly,
  };
}

function agentAssembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
    description: 'Telecom test agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [{ kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' }],
    },
    modelIds: ['test-model'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

function externalizationContext(): LargeContentExternalizationContext {
  return {
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'Test User',
    },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    messageId: brand<string, 'MessageId'>('message-1'),
  };
}

function toolContext(): ToolExecutionContext {
  const context = externalizationContext();
  return {
    identityContext: context.identityContext,
    agentId: context.agentId,
    agentVersion: context.agentVersion,
    sessionId: context.sessionId,
    requestId: context.requestId,
    runId: context.runId,
    requestContextId: context.requestContextId,
    stepId: 'turn-1',
    toolCallId: 'tool-readback',
    timeoutMs: 30_000,
  };
}
