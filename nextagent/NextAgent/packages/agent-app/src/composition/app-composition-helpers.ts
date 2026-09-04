import { AgentError, brand, type SecretReference } from '@nextagent/agent-common';
import type { WorkflowRemoteExecutionGateway } from '@nextagent/agent-contracts/core';
import type { CredentialResolver } from '@nextagent/agent-model';
import { createWorkflowRuntimeAdapters } from '@nextagent/agent-workflow';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { createAppCredentialResolver, type AppCredentialResolver } from '../config/env.js';
import type { AppRuntimePaths } from '../config/paths.js';
import type { AgentScope, AppGatewayStores, CapabilityProviderReferenceValidation } from './composition-contracts.js';
import type { MemoryAgingCycleDiagnostic, MemoryExtractionCycleDiagnostic, TaskTrajectoryWorkerDiagnostic } from '@nextagent/agent-memory';
import type { IdentityContext } from '@nextagent/agent-common';
import type { TrustedOwnerScope } from '@nextagent/agent-observability';

export function requireRemoteGateway(gateway?: WorkflowRemoteExecutionGateway): WorkflowRemoteExecutionGateway {
  if (gateway === undefined) {
    throw new Error('Workflow execution mode is "remote" but no WorkflowRemoteExecutionGateway dependency was provided.');
  }
  return gateway;
}

export function requireWorkflowRuntimeAdapters(
  adapters?: ReturnType<typeof createWorkflowRuntimeAdapters>,
): ReturnType<typeof createWorkflowRuntimeAdapters> {
  if (adapters === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_RUNTIME_ADAPTERS_UNAVAILABLE',
      message: 'Workflow runtime adapters are unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
    });
  }
  return adapters;
}

export function requireAppCredentialResolver(resolver?: CredentialResolver): AppCredentialResolver {
  if (resolver !== undefined && !('validate' in resolver)) {
    throw new AgentError({
      code: 'APP_CREDENTIAL_RESOLVER_INVALID',
      message: 'App credential resolver must support startup validation.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return resolver === undefined ? createAppCredentialResolver() : (resolver as AppCredentialResolver);
}

export function isTerminalRuntimeEvent(type: string): boolean {
  return type === 'REQUEST_COMPLETED' || type === 'REQUEST_FAILED' || type === 'REQUEST_CANCELED' || type === 'REQUEST_SUPERSEDED';
}

export async function closeGateway(gateway: AppGatewayStores): Promise<void> {
  try {
    await gateway.close?.();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('database is not open')) {
      throw error;
    }
  }
}

export function createMonotonicClock() {
  let last = 0;
  return () => {
    const next = Math.max(Date.now(), last + 1);
    last = next;
    return brand<number, 'EpochMillis'>(next);
  };
}

export function createCapabilityProviderReferenceValidation(baseDir: string): CapabilityProviderReferenceValidation {
  return {
    isCredentialReferenceResolvable(reference): boolean {
      if (reference.startsWith('env:')) {
        const value = process.env[reference.slice(4)];
        return value !== undefined && value.length > 0;
      }
      return isReadableFileReference(reference, baseDir);
    },
    resolveLocalDirectoryPath(path: string): string {
      return isAbsolute(path) ? path : resolve(baseDir, path);
    },
    isUrlResolvable(url: string): boolean {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
  };
}

export function createSystemCapabilityProviderReferenceValidation(
  paths: Pick<AppRuntimePaths, 'configRoot' | 'workspaceRoot'>,
): CapabilityProviderReferenceValidation {
  const configRootReferenceValidation = createCapabilityProviderReferenceValidation(paths.configRoot);
  const workspaceRootReferenceValidation = createCapabilityProviderReferenceValidation(paths.workspaceRoot);
  return {
    ...configRootReferenceValidation,
    resolveLocalDirectoryPath: workspaceRootReferenceValidation.resolveLocalDirectoryPath,
  };
}

export function findDuplicateProviderId(providers: ReadonlyArray<{ readonly providerId: string }>): string | undefined {
  const seen = new Set<string>();
  for (const provider of providers) {
    if (seen.has(provider.providerId)) {
      return provider.providerId;
    }
    seen.add(provider.providerId);
  }
  return undefined;
}

export function taskTrajectoryDiagnosticAgentScope(
  event: TaskTrajectoryWorkerDiagnostic,
  scopesByAgentId: ReadonlyMap<string, AgentScope>,
): AgentScope | undefined {
  if (event.agentVersion !== undefined) {
    return {
      agentId: event.agentId,
      agentVersion: event.agentVersion,
    };
  }
  return scopesByAgentId.get(String(event.agentId));
}

export function memoryAgingDiagnosticAgentScope(
  event: MemoryAgingCycleDiagnostic,
  scopesByAgentId: ReadonlyMap<string, AgentScope>,
): AgentScope | undefined {
  if (event.agentId === undefined) {
    return scopesByAgentId.values().next().value;
  }
  if (event.agentVersion !== undefined) {
    return {
      agentId: event.agentId,
      agentVersion: event.agentVersion,
    };
  }
  return scopesByAgentId.get(String(event.agentId));
}

export function memoryExtractionDiagnosticAgentScope(
  event: MemoryExtractionCycleDiagnostic,
  scopesByAgentId: ReadonlyMap<string, AgentScope>,
): AgentScope | undefined {
  if (event.agentId === undefined) {
    return scopesByAgentId.values().next().value;
  }
  if (event.agentVersion !== undefined) {
    return {
      agentId: event.agentId,
      agentVersion: event.agentVersion,
    };
  }
  return scopesByAgentId.get(String(event.agentId));
}

export function trustedOwnerScope(identity: IdentityContext, agentScope: AgentScope): TrustedOwnerScope {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId: agentScope.agentId,
    agentVersion: agentScope.agentVersion,
  };
}

function isReadableFileReference(reference: SecretReference, baseDir: string): boolean {
  const path = resolveFileReference(reference, baseDir);
  return path !== undefined && isPathType(path, 'file');
}

function resolveFileReference(reference: string, baseDir: string): string | undefined {
  if (!reference.startsWith('file:')) {
    return undefined;
  }
  const configuredPath = reference.slice('file:'.length);
  if (configuredPath.length === 0) {
    return undefined;
  }
  return isAbsolute(configuredPath) ? configuredPath : resolve(baseDir, configuredPath);
}

function isPathType(path: string, expected: 'file' | 'directory'): boolean {
  try {
    if (!existsSync(path)) {
      return false;
    }
    const stats = statSync(path);
    return expected === 'file' ? stats.isFile() : stats.isDirectory();
  } catch {
    return false;
  }
}
