import { AgentError, type AgentId, type AgentVersion, type RequestLocale } from '@nextagent/agent-common';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { ModelInferenceOptions } from '@nextagent/agent-contracts/model';
import type { SkillDisclosureMode } from './skill-disclosure-mode.js';

export type PromptPurpose = string;

export const SYSTEM_PROMPT = 'SYSTEM_PROMPT' as const;
export const SUMMARY_GENERATION = 'SUMMARY_GENERATION' as const;
export const MEMORY_EXTRACTION = 'MEMORY_EXTRACTION' as const;
export const AGENT_ROUTING_SELECTION = 'AGENT_ROUTING_SELECTION' as const;

export const WELL_KNOWN_PROMPT_PURPOSES = [SYSTEM_PROMPT, SUMMARY_GENERATION, MEMORY_EXTRACTION, AGENT_ROUTING_SELECTION] as const;

export type PromptSourceLayer = 'builtin' | 'agent';

export interface SelectedPromptModel {
  readonly modelId: string;
}

export interface PromptModelCandidate extends SelectedPromptModel {
  readonly order: number;
}

export interface PromptAssemblyRequest {
  readonly purpose: PromptPurpose;
  readonly agentId: AgentId | string;
  readonly agentVersion: AgentVersion | string;
  readonly locale?: RequestLocale | string;
  readonly flowVariables: Readonly<Record<string, string>>;
  readonly selectedModel: SelectedPromptModel;
  /**
   * True when the gating memory capability is visible to the model for
   * the accepted Agent. Drives conditional rendering of the `memory`
   * system section only; it MUST NOT affect template/model selection or
   * prompt text.
   */
  readonly memoryEnabled?: boolean;
  /**
   * Skill disclosure projections for the `skill_disclosure` system
   * section: the governed Skill list (already filtered to model-visible
   * model-invocable Skills by the disclosure policy), the trusted
   * disclosure mode (`list` or `tool-search`), and the mode-matched
   * builtin default instruction body read from the builtin template
   * directory markdown file. They drive conditional section rendering
   * and the `skillDisclosureList` / `skillDisclosureMode` /
   * `skillDisclosureBody` variables only; they MUST NOT affect
   * template/model selection or model options handoff.
   */
  readonly skillDisclosure?: {
    readonly mode: SkillDisclosureMode;
    readonly skills: readonly CapabilityDescriptor[];
    readonly body: string;
  };
}

export interface PromptModelCompatibilityRequest {
  readonly purpose: PromptPurpose;
  readonly agentId: AgentId | string;
  readonly agentVersion: AgentVersion | string;
  readonly locale?: RequestLocale | string;
  readonly flowVariables: Readonly<Record<string, string>>;
  readonly modelCandidates: readonly PromptModelCandidate[];
}

export interface PromptTemplateMatch {
  readonly locale?: string;
  readonly model?: string;
  readonly flowVariables?: Readonly<Record<string, string>>;
}

export interface PromptSectionVariable {
  readonly name: string;
  readonly optional: boolean;
}

export interface PromptSection {
  readonly id: string;
  readonly content: string;
  readonly variables: readonly PromptSectionVariable[];
}

export interface PromptTemplate {
  readonly templateId: string;
  readonly templateRef: string;
  readonly purpose: PromptPurpose;
  readonly sourceLayer: PromptSourceLayer;
  readonly agentId?: string;
  readonly agentVersion?: string;
  readonly match?: PromptTemplateMatch;
  readonly sections: readonly PromptSection[];
  readonly modelOptions?: ModelInferenceOptions;
}

export interface RenderedPromptSection {
  readonly id: string;
  readonly content: string;
}

export interface PromptAssemblyResult {
  readonly templateId: string;
  readonly templateRef: string;
  readonly sections: readonly RenderedPromptSection[];
  readonly renderedContent: string;
  readonly modelOptions?: ModelInferenceOptions;
}

export interface PromptTemplateAssembler {
  assemble: (request: PromptAssemblyRequest) => Promise<PromptAssemblyResult>;
}

export interface PromptTemplateRegistry {
  register: (input: { readonly agentId: string; readonly agentVersion: string; readonly path: string }) => void;
  templatesFor: (agentId: string, agentVersion: string) => readonly PromptTemplate[];
  compatibleModelIds: (request: PromptModelCompatibilityRequest) => readonly string[];
}

const safePromptPurposePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function assertPromptPurpose(value: string): PromptPurpose {
  if (!safePromptPurposePattern.test(value)) {
    throw new AgentError({
      code: 'PROMPT_PURPOSE_INVALID',
      message: 'Prompt purpose must be a non-empty safe id.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return value;
}

export function isWellKnownPromptPurpose(value: string): boolean {
  return (WELL_KNOWN_PROMPT_PURPOSES as readonly string[]).includes(value);
}

export function normalizeStringFlowVariables(input?: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  if (input === undefined) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}
