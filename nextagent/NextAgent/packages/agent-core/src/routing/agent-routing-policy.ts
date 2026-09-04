import { AgentError, brand } from '@nextagent/agent-common';
import type {
  AgentAssembly,
  AgentAssemblyRegistry,
  AgentRoutingPolicyConfig,
  AgentRoutingPolicyRule,
} from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type { RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { parseCapabilityDirective } from './capability-directive-parser.js';

const maxRoutingRegexSourceLength = 512;
const nestedQuantifierPattern = /\((?:[^()\\]|\\.|\[[^\]]*\])*[*+](?:[^()\\]|\\.|\[[^\]]*\])*\)\s*(?:[*+]|\{\d+(?:,\d*)?\})/u;

export type FrozenRoutingDecisionKind = 'DETERMINISTIC_FLOW' | 'MODEL_DRIVEN_LOOP' | 'CLARIFY' | 'REJECT' | 'HUMAN_HANDOFF';

export interface AgentRoutingDecision {
  readonly kind: FrozenRoutingDecisionKind;
  readonly safeReason: string;
  readonly evidenceRef?: string;
  readonly acceptedAssembly?: AgentAssembly;
  readonly skillName?: string;
  readonly recipeName?: string;
}

export interface ExplicitRoutingResult {
  readonly decision?: AgentRoutingDecision | undefined;
  readonly acceptedAssembly: AgentAssembly;
}

export interface AgentRoutingPolicy {
  decide: (run: RequestRun, context: RequestContext, signal: AbortSignal) => Promise<AgentRoutingDecision>;
}

export class DefaultAgentRoutingPolicy implements AgentRoutingPolicy {
  constructor(
    private readonly assemblyRegistry: AgentAssemblyRegistry,
    private readonly capabilityCatalog: CapabilityCatalog,
  ) {}

  async decide(run: RequestRun, context: RequestContext, signal: AbortSignal): Promise<AgentRoutingDecision> {
    const result = await this.resolveExplicitRouting(run, context, signal);
    if (result.decision !== undefined) {
      return result.decision;
    }
    return {
      kind: 'MODEL_DRIVEN_LOOP',
      safeReason: 'DEFAULT_MODEL_DRIVEN_LOOP',
      acceptedAssembly: result.acceptedAssembly,
    };
  }

  async resolveExplicitRouting(run: RequestRun, context: RequestContext, signal: AbortSignal): Promise<ExplicitRoutingResult> {
    if (signal.aborted) {
      throw new AgentError({
        code: 'ROUTING_ABORTED',
        message: 'Agent routing was canceled before execution.',
        category: 'CANCELED',
        retryable: false,
        safeDetails: { reasonCode: 'ROUTING_ABORTED' },
      });
    }

    const acceptedAssembly = await this.assemblyRegistry.require(run.agentId, run.agentVersion).catch((error) => {
      throw new AgentError({
        code: 'ROUTING_ASSEMBLY_UNAVAILABLE',
        message: 'Frozen agent assembly is unavailable for routing.',
        category: 'UNAVAILABLE',
        retryable: true,
        safeDetails: { reasonCode: 'ROUTING_ASSEMBLY_UNAVAILABLE' },
        ...(error instanceof Error ? { cause: error } : {}),
      });
    });

    await this.assertCapabilityGovernanceViewAvailable(run, context, acceptedAssembly);

    const directive = parseCapabilityDirective(context.acceptedInputText);
    if (directive.kind === 'invalid') {
      return { decision: { kind: 'REJECT', safeReason: directive.reasonCode, acceptedAssembly }, acceptedAssembly };
    }
    if (directive.kind === 'ambiguous') {
      return { decision: { kind: 'REJECT', safeReason: directive.reasonCode, acceptedAssembly }, acceptedAssembly };
    }
    if (directive.kind === 'skill') {
      return {
        decision: { kind: 'DETERMINISTIC_FLOW', safeReason: 'CAPABILITY_DIRECTIVE_SKILL_MATCHED', acceptedAssembly, skillName: directive.name },
        acceptedAssembly,
      };
    }
    if (directive.kind === 'workflow') {
      if (this.isForbiddenByConstraint(context, directive.name)) {
        return { decision: { kind: 'REJECT', safeReason: 'CAPABILITY_DIRECTIVE_FORBIDDEN', acceptedAssembly }, acceptedAssembly };
      }
      if (await this.isRecipeCapabilityAvailable(context, acceptedAssembly, directive.name)) {
        return {
          decision: { kind: 'DETERMINISTIC_FLOW', safeReason: 'CAPABILITY_DIRECTIVE_WORKFLOW_MATCHED', acceptedAssembly, recipeName: directive.name },
          acceptedAssembly,
        };
      }
      return {
        decision: { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'CAPABILITY_DIRECTIVE_WORKFLOW_MISS_FALLBACK', acceptedAssembly },
        acceptedAssembly,
      };
    }

    const targetRecipe = context.routingConstraints?.targetRecipe;
    if (targetRecipe !== undefined) {
      if (await this.isRecipeCapabilityAvailable(context, acceptedAssembly, targetRecipe)) {
        return {
          decision: { kind: 'DETERMINISTIC_FLOW', safeReason: 'TARGET_RECIPE_MATCHED', acceptedAssembly, recipeName: targetRecipe },
          acceptedAssembly,
        };
      }
      return {
        decision: { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'TARGET_RECIPE_MISS_FALLBACK', acceptedAssembly },
        acceptedAssembly,
      };
    }

    const targetSkill = context.routingConstraints?.targetSkill;
    if (targetSkill !== undefined) {
      return {
        decision: { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'POLICY_RULE_TARGET_SKILL_PRIORITY', acceptedAssembly },
        acceptedAssembly,
      };
    }

    if (acceptedAssembly.routing?.mode === 'policy') {
      const policy = acceptedAssembly.routing.policy;
      if (policy?.method !== 'policy:intent-recognition') {
        throw new AgentError({
          code: 'ROUTING_POLICY_CONFIGURATION_INVALID',
          message: 'Agent routing policy configuration is invalid.',
          category: 'VALIDATION',
          retryable: false,
          safeDetails: { reasonCode: 'ROUTING_POLICY_CONFIGURATION_INVALID' },
        });
      }
      const configuredRoute = this.matchPolicyRule(policy, context.acceptedInputText);
      if (configuredRoute !== undefined) {
        if (
          configuredRoute.recipeName !== undefined &&
          !(await this.isRecipeCapabilityAvailable(context, acceptedAssembly, configuredRoute.recipeName))
        ) {
          return {
            decision: { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'POLICY_RULE_WORKFLOW_MISS_FALLBACK', acceptedAssembly },
            acceptedAssembly,
          };
        }
        if (
          configuredRoute.skillName !== undefined &&
          !(await this.isSkillCapabilityAvailable(context, acceptedAssembly, configuredRoute.skillName))
        ) {
          return {
            decision: { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'POLICY_RULE_SKILL_MISS_FALLBACK', acceptedAssembly },
            acceptedAssembly,
          };
        }
        return {
          decision: {
            kind: 'DETERMINISTIC_FLOW',
            safeReason: configuredRoute.safeReason,
            acceptedAssembly,
            ...(configuredRoute.skillName === undefined ? {} : { skillName: configuredRoute.skillName }),
            ...(configuredRoute.recipeName === undefined ? {} : { recipeName: configuredRoute.recipeName }),
          },
          acceptedAssembly,
        };
      }
      return { decision: undefined, acceptedAssembly };
    }

    return { decision: undefined, acceptedAssembly };
  }

  private async assertCapabilityGovernanceViewAvailable(
    run: RequestRun,
    context: RequestContext,
    acceptedAssembly: Awaited<ReturnType<AgentAssemblyRegistry['require']>>,
  ): Promise<void> {
    await this.capabilityCatalog
      .listAvailable({
        tenantId: context.identityContext.tenantId,
        subjectId: context.identityContext.subjectId,
        agentAssembly: acceptedAssembly,
        includeUnavailable: false,
      })
      .catch((error) => {
        throw new AgentError({
          code: 'ROUTING_CAPABILITY_VIEW_UNAVAILABLE',
          message: 'Capability governance view is unavailable for routing.',
          category: 'UNAVAILABLE',
          retryable: true,
          safeDetails: { reasonCode: 'ROUTING_CAPABILITY_VIEW_UNAVAILABLE', runId: run.runId },
          ...(error instanceof Error ? { cause: error } : {}),
        });
      });
  }

  private async isRecipeCapabilityAvailable(context: RequestContext, acceptedAssembly: AgentAssembly, recipeName: string): Promise<boolean> {
    return this.isGovernedCapabilityAvailable(context, acceptedAssembly, recipeName, 'WORKFLOW');
  }

  private async isSkillCapabilityAvailable(context: RequestContext, acceptedAssembly: AgentAssembly, skillName: string): Promise<boolean> {
    return this.isGovernedCapabilityAvailable(context, acceptedAssembly, skillName, 'SKILL');
  }

  private async isGovernedCapabilityAvailable(
    context: RequestContext,
    acceptedAssembly: AgentAssembly,
    capabilityId: string,
    kind: 'SKILL' | 'WORKFLOW',
  ): Promise<boolean> {
    const capability = await this.capabilityCatalog.resolve({
      tenantId: context.identityContext.tenantId,
      subjectId: context.identityContext.subjectId,
      ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
      agentAssembly: acceptedAssembly,
      capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    });
    return capability?.kind === kind;
  }

  private isForbiddenByConstraint(context: RequestContext, capabilityId: string): boolean {
    return context.routingConstraints?.forbiddenCapabilityIds?.includes(capabilityId) ?? false;
  }

  private matchPolicyRule(
    policy: AgentRoutingPolicyConfig,
    acceptedInputText?: string,
  ): { readonly safeReason: string; readonly skillName?: string; readonly recipeName?: string } | undefined {
    if (policy.rules === undefined || policy.rules.length === 0) {
      return undefined;
    }
    if (acceptedInputText === undefined || acceptedInputText.length === 0) {
      return undefined;
    }
    for (const rule of policy.rules) {
      if (!this.matchesRule(rule, acceptedInputText)) {
        continue;
      }
      return rule.target.kind === 'SKILL'
        ? { safeReason: 'POLICY_RULE_SKILL_MATCHED', skillName: rule.target.name }
        : { safeReason: 'POLICY_RULE_WORKFLOW_MATCHED', recipeName: rule.target.name };
    }
    return undefined;
  }

  private matchesRule(rule: AgentRoutingPolicyRule, acceptedInputText: string): boolean {
    try {
      assertSafePolicyRegex(rule.reg);
      return new RegExp(rule.reg).test(acceptedInputText);
    } catch {
      throw new AgentError({
        code: 'ROUTING_POLICY_CONFIGURATION_INVALID',
        message: 'Agent routing policy configuration is invalid.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'ROUTING_POLICY_CONFIGURATION_INVALID' },
      });
    }
  }
}

function assertSafePolicyRegex(source: string): void {
  if (source.length === 0 || source.length > maxRoutingRegexSourceLength || nestedQuantifierPattern.test(source)) {
    throw new Error('unsafe routing policy regex');
  }
}
