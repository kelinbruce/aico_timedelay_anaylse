import { AgentError } from '@nextagent/agent-common';
import type { RequestContext } from '@nextagent/agent-contracts/runtime';

export interface GovernedRoutingConstraints {
  readonly forbiddenCapabilityIds: ReadonlySet<string>;
  readonly allowHumanInput: boolean;
  readonly allowSubagents: boolean;
}

export class RoutingConstraintGovernor {
  govern(context: RequestContext): GovernedRoutingConstraints {
    const constraints = context.routingConstraints;
    if (constraints === undefined) {
      return {
        forbiddenCapabilityIds: new Set<string>(),
        allowHumanInput: true,
        allowSubagents: true,
      };
    }

    if (constraints.locale !== undefined && constraints.locale !== context.locale) {
      throw new AgentError({
        code: 'ROUTING_CONSTRAINT_LOCALE_INCOMPATIBLE',
        message: 'Locale constraint is incompatible with the trusted request locale.',
        category: 'VALIDATION',
        retryable: false,
      });
    }

    return {
      forbiddenCapabilityIds: new Set(constraints.forbiddenCapabilityIds ?? []),
      allowHumanInput: constraints.allowHumanInput ?? true,
      allowSubagents: constraints.allowSubagents ?? true,
    };
  }
}
