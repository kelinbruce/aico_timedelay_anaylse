import type { AgentId, AgentType, AgentVersion, CapabilityId } from '@nextagent/agent-common';
import type {
  AgentHookActivation,
  AgentPolicyActivation,
  AgentPresentationLocales,
  AgentRoutingConfig,
  AgentRuntimeSettings,
} from '@nextagent/agent-contracts/agent-assembly';
import type { AgentInvocationPolicy } from '@nextagent/agent-contracts/agent-assembly';

export interface AgentDefinitionResource {
  readonly resourceId: string;
  readonly kind: 'WORKSPACE_FILE' | 'CAPABILITY';
  readonly path: string;
}

export interface AgentCapabilityBindingDefinition {
  readonly capabilityId: CapabilityId;
  readonly capabilityType: 'TOOL' | 'SKILL' | 'AGENT' | 'WORKFLOW';
  readonly providerId: string;
  readonly enabled: boolean;
  readonly description?: string;
}

export interface AgentDefinition {
  readonly agentId: AgentId;
  readonly agentType: AgentType;
  readonly agentVersion: AgentVersion;
  readonly displayName: string;
  readonly locales?: AgentPresentationLocales;
  readonly description: string;
  readonly workspaceDir?: string;
  readonly workspaceFiles?: WorkspaceFilesDefinition;
  readonly modelIds?: readonly string[];
  readonly defaultModelId?: string;
  readonly capabilityBindings: readonly AgentCapabilityBindingDefinition[];
  readonly policies?: readonly AgentPolicyActivation[];
  readonly hooks?: readonly AgentHookActivation[];
  readonly userInvocable?: boolean;
  readonly agentInvocation?: AgentInvocationPolicy;
  readonly runtimeSettings: AgentRuntimeSettings;
  readonly routing?: AgentRoutingConfig;
  readonly resources: readonly AgentDefinitionResource[];
}

export interface WorkspaceFilesDefinition {
  readonly readDirectories?: readonly string[];
  readonly writeDirectories?: readonly string[];
  readonly readAllowedExtensions?: readonly string[];
  readonly readDeniedExtensions?: readonly string[];
  readonly writeAllowedExtensions?: readonly string[];
  readonly writeDeniedExtensions?: readonly string[];
  readonly maxTextBytes?: number;
}
