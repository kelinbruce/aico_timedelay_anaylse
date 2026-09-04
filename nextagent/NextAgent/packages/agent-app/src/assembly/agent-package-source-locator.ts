import type { AgentPackageSourceLocator } from '@nextagent/agent-capability';
import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { DefaultSystemConfig } from '../config/component-config.js';

export function createAgentPackageSourceLocator(systemConfig: DefaultSystemConfig): AgentPackageSourceLocator {
  const rootLocator = createAgentPackageRootLocator(systemConfig);
  return {
    async locate(input) {
      return rootLocator.locate(input.agentId);
    },
  };
}

export interface AgentPackageRootLocator {
  locate: (
    agentId: string,
  ) => Promise<
    | { readonly status: 'found'; readonly agentPackageRoot: string }
    | { readonly status: 'not-configured' | 'not-found' | 'unavailable' | 'invalid'; readonly safeCode: string }
  >;
}

export function createAgentPackageRootLocator(systemConfig: DefaultSystemConfig): AgentPackageRootLocator {
  const agentsRoot = systemConfig.paths.agentsRoot;
  return {
    async locate(agentId) {
      return locateAgentPackage(agentsRoot, agentId);
    },
  };
}

async function locateAgentPackage(agentsRoot: string, agentId: string) {
  if (agentId.trim().length === 0) {
    return { status: 'invalid' as const, safeCode: 'LOCAL_SKILL_AGENTS_ROOT_INVALID' };
  }
  const agentPackageRoot = resolve(agentsRoot, agentId);
  if (agentPackageRoot !== agentsRoot && !isPathInside(agentsRoot, agentPackageRoot)) {
    return { status: 'invalid' as const, safeCode: 'LOCAL_SKILL_AGENTS_ROOT_INVALID' };
  }
  try {
    const info = await stat(agentPackageRoot);
    if (!info.isDirectory()) {
      return { status: 'unavailable' as const, safeCode: 'LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE' };
    }
  } catch {
    return { status: 'not-found' as const, safeCode: 'LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE' };
  }
  return { status: 'found' as const, agentPackageRoot };
}

function isPathInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path.length > 0 && !path.startsWith('..') && !isAbsolute(path);
}
