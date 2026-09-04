import { brand } from '@nextagent/agent-common';
import type { AgentWorkspacePolicy } from '@nextagent/agent-contracts/agent-assembly';
import { createExecutionWorkspaceResolver, deriveExecutionRunKey, deriveExecutionScopeKey } from '@nextagent/agent-runtime';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempRoots: string[] = [];

describe('execution workspace resolver', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('derives a scoped local workspace view from trusted agent and owner scope only', () => {
    const runtimeWorkspaceRoot = tempRuntimeWorkspaceRoot();
    const resolver = createExecutionWorkspaceResolver();
    const input = {
      runtimeWorkspaceRoot,
      workspacePolicy: defaultPolicy(),
      agentId: brand<string, 'AgentId'>('agent-radio'),
      tenantId: brand<string, 'TenantId'>('tenant-a'),
      subjectId: brand<string, 'SubjectId'>('subject-a'),
      sessionId: brand<string, 'SessionId'>('session-a'),
      runId: brand<string, 'RequestRunId'>('run-a'),
      deploymentMode: 'LOCAL' as const,
    };
    const scopeKey = deriveExecutionScopeKey(input);
    const runKey = deriveExecutionRunKey(input.runId);
    const scopeBase = resolve(input.runtimeWorkspaceRoot, scopeKey);
    const view = resolver.resolve(input);

    expect(view).toEqual({
      workspaceDir: 'workspace/',
      defaultCwd: scopeBase,
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', physicalPath: resolve(scopeBase, 'workspace'), access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', physicalPath: resolve(scopeBase, '.nextagent'), access: 'read' },
        { kind: 'temp', logicalPath: 'temp', physicalPath: resolve(scopeBase, 'temp', runKey), access: 'readWrite' },
        { kind: 'generatedSkills', logicalPath: 'generated-skills', physicalPath: resolve(scopeBase, 'generated-skills'), access: 'readWrite' },
      ],
    });
    expect(JSON.stringify(view)).not.toContain('tenant-a');
    expect(JSON.stringify(view)).not.toContain('subject-a');
    expect(JSON.stringify(view)).not.toContain('session-a');
    expect(JSON.stringify(view)).not.toContain('run-a');
  });

  it('uses remote /work as the sandbox cwd while keeping the same physical roots', () => {
    const runtimeWorkspaceRoot = tempRuntimeWorkspaceRoot();
    const resolver = createExecutionWorkspaceResolver();
    const local = resolver.resolve(baseInput('LOCAL', runtimeWorkspaceRoot));
    const remote = resolver.resolve(baseInput('REMOTE', runtimeWorkspaceRoot));

    expect(remote.defaultCwd).toBe('/work');
    expect(remote.workspaceDir).toBe('workspace/');
    expect(remote.roots).toEqual(local.roots);
  });

  it('requires a session id only for session-isolated workspace policies', () => {
    const resolver = createExecutionWorkspaceResolver();
    const runtimeWorkspaceRoot = tempRuntimeWorkspaceRoot();
    const { sessionId: _sessionId, ...inputWithoutSession } = baseInput('LOCAL', runtimeWorkspaceRoot);
    expect(() => resolver.resolve({ ...inputWithoutSession, workspacePolicy: defaultPolicy('session') })).toThrow(
      'Session-scoped execution workspace requires a trusted session id.',
    );

    const first = deriveExecutionScopeKey({
      ...baseInput('LOCAL', runtimeWorkspaceRoot),
      workspacePolicy: defaultPolicy('session'),
      sessionId: brand<string, 'SessionId'>('session-1'),
    });
    const second = deriveExecutionScopeKey({
      ...baseInput('LOCAL', runtimeWorkspaceRoot),
      workspacePolicy: defaultPolicy('session'),
      sessionId: brand<string, 'SessionId'>('session-2'),
    });
    expect(first).not.toBe(second);
  });

  it('locates an existing-scope root without materializing workspace directories', () => {
    const runtimeWorkspaceRoot = tempRuntimeWorkspaceRoot();
    const resolver = createExecutionWorkspaceResolver();
    const { runId: _runId, ...input } = baseInput('LOCAL', runtimeWorkspaceRoot);

    const generatedSkillsRoot = resolver.locateRoot(input, 'generatedSkills');

    expect(generatedSkillsRoot).toBe(resolve(runtimeWorkspaceRoot, deriveExecutionScopeKey(input), 'generated-skills'));
    expect(existsSync(runtimeWorkspaceRoot)).toBe(false);
  });

  it('derives local shared data as a read-only root outside the scoped execution workspace', () => {
    const runtimeWorkspaceRoot = tempRuntimeWorkspaceRoot();
    const sharedDataRoot = resolve(runtimeWorkspaceRoot, '..', 'shared-data');
    const resolver = createExecutionWorkspaceResolver();
    const view = resolver.resolve({
      ...baseInput('LOCAL', runtimeWorkspaceRoot),
      sharedDataRoot,
      workspacePolicy: sharedDataPolicy(),
    });

    expect(view.defaultCwd).not.toBe(sharedDataRoot);
    expect(view.roots).toContainEqual({
      kind: 'sharedData',
      logicalPath: 'shared-data',
      physicalPath: sharedDataRoot,
      access: 'read',
    });
  });

  it('fails closed when shared data is requested outside local deployment mode', () => {
    const runtimeWorkspaceRoot = tempRuntimeWorkspaceRoot();
    const resolver = createExecutionWorkspaceResolver();

    expect(() =>
      resolver.resolve({
        ...baseInput('REMOTE', runtimeWorkspaceRoot),
        sharedDataRoot: resolve(runtimeWorkspaceRoot, '..', 'shared-data'),
        workspacePolicy: sharedDataPolicy(),
      }),
    ).toThrow('Shared data root is only supported in local deployment mode.');
  });
});

function tempRuntimeWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'nextagent-runtime-'));
  tempRoots.push(root);
  return resolve(root, 'execution');
}

function baseInput(deploymentMode: 'LOCAL' | 'REMOTE', runtimeWorkspaceRoot = tempRuntimeWorkspaceRoot()) {
  return {
    runtimeWorkspaceRoot,
    workspacePolicy: defaultPolicy(),
    agentId: brand<string, 'AgentId'>('agent-radio'),
    tenantId: brand<string, 'TenantId'>('tenant-a'),
    subjectId: brand<string, 'SubjectId'>('subject-a'),
    sessionId: brand<string, 'SessionId'>('session-a'),
    runId: brand<string, 'RequestRunId'>('run-a'),
    deploymentMode,
  };
}

function defaultPolicy(isolationMode: 'subject' | 'session' = 'subject'): AgentWorkspacePolicy {
  return {
    schemaVersion: 'nextagent.agent-workspace-policy.v1',
    isolationMode,
    roots: [
      { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
      { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
      { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      { kind: 'generatedSkills', logicalPath: 'generated-skills', access: 'readWrite' },
    ],
  };
}

function sharedDataPolicy(): AgentWorkspacePolicy {
  return {
    ...defaultPolicy(),
    roots: [...defaultPolicy().roots, { kind: 'sharedData', logicalPath: 'shared-data', access: 'read' }],
  };
}
