import type { AgentId, AgentType, AgentVersion, JsonObject, LifecycleStage } from '@nextagent/agent-common';

export type ExecutionIsolationMode = 'subject' | 'session';
export type ExecutionWorkspaceRootKind = 'workspace' | 'systemResources' | 'temp' | 'generatedSkills' | 'sharedData';
export type ExecutionWorkspaceRootAccess = 'read' | 'readWrite';

export interface AgentWorkspaceRootPolicy {
  readonly kind: ExecutionWorkspaceRootKind;
  readonly logicalPath: 'workspace' | '.nextagent' | 'temp' | 'generated-skills' | 'shared-data';
  readonly access: ExecutionWorkspaceRootAccess;
}

export interface AgentWorkspaceFilePolicy {
  readonly readDirectories?: readonly string[];
  readonly writeDirectories: readonly string[];
  readonly maxTextBytes: number;
  readonly maxLines?: number;
  readonly maxOutputBytes?: number;
  readonly maxGlobInspectedEntries?: number;
}

export interface AgentWorkspacePolicy {
  readonly schemaVersion: string;
  readonly isolationMode: ExecutionIsolationMode;
  readonly roots: readonly AgentWorkspaceRootPolicy[];
  readonly files?: AgentWorkspaceFilePolicy;
}

export interface AgentCapabilityBinding {
  readonly capabilityId: string;
  readonly capabilityType: string;
  readonly providerId: string;
  readonly enabled?: boolean;
  readonly description?: string;
}

export interface AgentHookOrder {
  readonly priority?: number;
  readonly before?: string | readonly string[];
  readonly after?: string | readonly string[];
}

export interface AgentHookActivation {
  readonly hookId: string;
  readonly enabled?: boolean;
  readonly disabled?: boolean;
  readonly stages?: readonly LifecycleStage[];
  readonly order?: AgentHookOrder;
  readonly timeoutMs?: number;
  readonly config?: JsonObject;
}

export interface AgentPolicyActivation {
  readonly policyPointId: string;
  readonly pluginId: string;
  readonly policyId: string;
  readonly enabled?: boolean;
  readonly timeoutMs?: number;
  readonly config?: JsonObject;
}

export interface AgentRuntimeSettings {
  readonly defaultLanguage?: string;
  readonly maxTurns?: number;
  readonly maxToolCallsPerTurn?: number;
  readonly maxContextMessages?: number;
  readonly requestTimeoutMs?: number;
}

export type AgentRoutingMode = 'default' | 'policy';

export type AgentRoutingTargetKind = 'SKILL' | 'WORKFLOW';

export interface AgentRoutingPolicyRuleTarget {
  readonly kind: AgentRoutingTargetKind;
  readonly name: string;
}

export interface AgentRoutingPolicyRule {
  readonly reg: string;
  readonly target: AgentRoutingPolicyRuleTarget;
}

export interface AgentRoutingPolicyConfig {
  readonly method: 'policy:intent-recognition';
  readonly rules?: readonly AgentRoutingPolicyRule[];
}

export interface AgentRoutingConfig {
  readonly mode?: AgentRoutingMode;
  readonly policy?: AgentRoutingPolicyConfig;
}

export type AgentInvocationPolicy = 'NONE' | 'BOUND' | 'PARENT';
export type AgentAssemblySourceKind = 'BUILTIN' | 'LOCAL';

export interface AgentLocalizedDisplayName {
  readonly displayName: string;
}

export interface AgentPresentationLocales {
  readonly language: Readonly<Record<string, AgentLocalizedDisplayName>>;
}

export interface AgentAssemblyParentScope {
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
}

export interface AgentAssembly {
  readonly agentId: AgentId;
  readonly agentType: AgentType;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
  readonly displayName: string;
  readonly locales?: AgentPresentationLocales;
  readonly description: string;
  readonly recipeIds?: readonly string[];
  readonly workspacePolicy: AgentWorkspacePolicy;
  readonly modelIds: readonly string[];
  readonly defaultModelId?: string;
  readonly capabilityBindings: readonly AgentCapabilityBinding[];
  readonly policies?: readonly AgentPolicyActivation[];
  readonly hooks?: readonly AgentHookActivation[];
  readonly userInvocable: boolean;
  readonly agentInvocation: AgentInvocationPolicy;
  readonly sourceKind?: AgentAssemblySourceKind;
  readonly parentAgentScope?: AgentAssemblyParentScope;
  readonly runtimeSettings: AgentRuntimeSettings;
  readonly routing?: AgentRoutingConfig;
}

export interface AgentAssemblyRegistry {
  active: (agentId: AgentId) => Promise<AgentAssembly>;
  require: (agentId: AgentId, agentVersion: AgentVersion) => Promise<AgentAssembly>;
}

export interface AgentSelectionRequest {
  readonly headerAgentId?: string;
  readonly defaultRouteAgentId: AgentId;
}

export interface AgentSelectionResult {
  readonly agentId: AgentId;
  readonly safeReason: string;
}

export interface AgentSelectionPolicy {
  resolve: (request: AgentSelectionRequest, signal: AbortSignal) => Promise<AgentSelectionResult>;
}
