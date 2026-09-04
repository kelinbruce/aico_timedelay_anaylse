import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExecutionWorkspaceResolver, ExecutionWorkspaceRootView, ResolveExecutionWorkspaceInput } from '@nextagent/agent-contracts/runtime';

const scopeNamespace = 'nextagent.execution-scope.v1';
const runNamespace = 'nextagent.execution-run.v1';
const workspacePolicySchemaVersion = 'nextagent.agent-workspace-policy.v1';

export interface ExecutionWorkspaceRootInspector {
  locateRoot: (input: Omit<ResolveExecutionWorkspaceInput, 'runId'>, kind: ExecutionWorkspaceRootView['kind']) => string | undefined;
}

export function createExecutionWorkspaceResolver(): ExecutionWorkspaceResolver & ExecutionWorkspaceRootInspector {
  return new DefaultExecutionWorkspaceResolver();
}

export function deriveExecutionScopeKey(
  input: Pick<ResolveExecutionWorkspaceInput, 'workspacePolicy' | 'agentId' | 'tenantId' | 'subjectId' | 'sessionId'>,
): string {
  if (input.workspacePolicy.isolationMode === 'session' && input.sessionId === undefined) {
    throw new Error('Session-scoped execution workspace requires a trusted session id.');
  }
  return shortHash([
    scopeNamespace,
    input.workspacePolicy.isolationMode,
    input.agentId,
    input.tenantId,
    input.subjectId,
    input.workspacePolicy.isolationMode === 'session' ? input.sessionId! : '',
  ]);
}

export function deriveExecutionRunKey(runId: ResolveExecutionWorkspaceInput['runId']): string {
  return shortHash([runNamespace, runId]);
}

class DefaultExecutionWorkspaceResolver implements ExecutionWorkspaceResolver {
  locateRoot(input: Omit<ResolveExecutionWorkspaceInput, 'runId'>, kind: ExecutionWorkspaceRootView['kind']): string | undefined {
    validatePolicy(input);
    const root = input.workspacePolicy.roots.find((candidate) => candidate.kind === kind);
    if (root === undefined || root.kind === 'temp') {
      return undefined;
    }
    if (root.kind === 'sharedData') {
      return resolve(requireSharedDataRoot(input));
    }
    return resolve(input.runtimeWorkspaceRoot, deriveExecutionScopeKey(input), root.logicalPath);
  }

  resolve(input: ResolveExecutionWorkspaceInput) {
    validatePolicy(input);
    const runtimeWorkspaceRoot = resolve(input.runtimeWorkspaceRoot);
    const scopeKey = deriveExecutionScopeKey(input);
    const runKey = deriveExecutionRunKey(input.runId);
    const scopeBase = resolve(runtimeWorkspaceRoot, scopeKey);
    mkdirSync(scopeBase, { recursive: true });
    const roots = input.workspacePolicy.roots.map<ExecutionWorkspaceRootView>((root) => {
      const physicalPath =
        root.kind === 'sharedData'
          ? resolve(requireSharedDataRoot(input))
          : root.kind === 'temp'
            ? resolve(scopeBase, root.logicalPath, runKey)
            : resolve(scopeBase, root.logicalPath);
      mkdirSync(physicalPath, { recursive: true });
      return {
        kind: root.kind,
        logicalPath: root.logicalPath,
        physicalPath,
        access: root.access,
      };
    });
    return {
      workspaceDir: 'workspace/' as const,
      defaultCwd: input.deploymentMode === 'REMOTE' ? '/work' : scopeBase,
      roots,
    };
  }
}

function requireSharedDataRoot(input: Pick<ResolveExecutionWorkspaceInput, 'sharedDataRoot'>): string {
  if (input.sharedDataRoot === undefined) {
    throw new Error('Shared data root path is required for local shared data policy.');
  }
  return input.sharedDataRoot;
}

function validatePolicy(input: Pick<ResolveExecutionWorkspaceInput, 'workspacePolicy' | 'sharedDataRoot' | 'deploymentMode'>): void {
  if (input.workspacePolicy.schemaVersion !== workspacePolicySchemaVersion) {
    throw new Error('Execution workspace policy schema version is invalid.');
  }
  const seen = new Set<string>();
  for (const root of input.workspacePolicy.roots) {
    if (seen.has(root.kind)) {
      throw new Error('Execution workspace policy contains duplicate roots.');
    }
    seen.add(root.kind);
    if (root.kind === 'workspace' && (root.logicalPath !== 'workspace' || root.access !== 'readWrite')) {
      throw new Error('Workspace root policy is invalid.');
    }
    if (root.kind === 'systemResources' && (root.logicalPath !== '.nextagent' || root.access !== 'read')) {
      throw new Error('System resource root policy is invalid.');
    }
    if (root.kind === 'temp' && (root.logicalPath !== 'temp' || root.access !== 'readWrite')) {
      throw new Error('Temp root policy is invalid.');
    }
    if (root.kind === 'generatedSkills' && (root.logicalPath !== 'generated-skills' || root.access !== 'readWrite')) {
      throw new Error('Generated skills root policy is invalid.');
    }
    if (root.kind === 'sharedData' && (root.logicalPath !== 'shared-data' || root.access !== 'read')) {
      throw new Error('Shared data root policy is invalid.');
    }
    if (root.kind === 'sharedData' && input.deploymentMode !== 'LOCAL') {
      throw new Error('Shared data root is only supported in local deployment mode.');
    }
  }
  if (!seen.has('workspace') || !seen.has('systemResources') || !seen.has('temp')) {
    throw new Error('Execution workspace policy must contain workspace, systemResources and temp roots.');
  }
}

function shortHash(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}
