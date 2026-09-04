import { AgentError } from '@nextagent/agent-common';
import type { RoutingConstraints } from '@nextagent/agent-contracts/runtime';

export type CapabilityDirectiveParseResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'skill'; readonly name: string }
  | { readonly kind: 'workflow'; readonly name: string }
  | { readonly kind: 'invalid'; readonly reasonCode: 'CAPABILITY_DIRECTIVE_INVALID' }
  | { readonly kind: 'ambiguous'; readonly reasonCode: 'CAPABILITY_DIRECTIVE_AMBIGUOUS' };

const directivePattern = /\$(skill|workflow):(\S*)/gu;
const safeDirectiveNamePattern = /^[A-Za-z0-9._-]+$/u;

export interface CapabilityDirectiveInputProjection {
  readonly inputText: string;
  readonly routingConstraints?: RoutingConstraints;
}

export function parseCapabilityDirective(inputText?: string): CapabilityDirectiveParseResult {
  if (inputText === undefined || inputText.length === 0) {
    return { kind: 'none' };
  }

  const parsed: Array<{ readonly kind: 'skill' | 'workflow'; readonly name: string }> = [];
  for (const match of inputText.matchAll(directivePattern)) {
    const kind = match[1] === 'skill' ? 'skill' : 'workflow';
    const name = match[2] ?? '';
    if (!safeDirectiveNamePattern.test(name)) {
      return { kind: 'invalid', reasonCode: 'CAPABILITY_DIRECTIVE_INVALID' };
    }
    parsed.push({ kind, name });
  }

  if (parsed.length === 0) {
    return { kind: 'none' };
  }

  const [first] = parsed;
  if (first === undefined) {
    return { kind: 'none' };
  }
  if (parsed.some((entry) => entry.kind !== first.kind || entry.name !== first.name)) {
    return { kind: 'ambiguous', reasonCode: 'CAPABILITY_DIRECTIVE_AMBIGUOUS' };
  }
  return first;
}

export function normalizeCapabilityDirectiveInput(inputText: string, routingConstraints?: RoutingConstraints): CapabilityDirectiveInputProjection {
  const directive = parseCapabilityDirective(inputText);
  if (directive.kind !== 'skill' && directive.kind !== 'workflow') {
    return {
      inputText,
      ...(routingConstraints === undefined ? {} : { routingConstraints }),
    };
  }

  const projectedConstraints = { ...routingConstraints } as {
    -readonly [Key in keyof RoutingConstraints]?: RoutingConstraints[Key];
  };
  if (directive.kind === 'skill') {
    delete projectedConstraints.targetRecipe;
    projectedConstraints.targetSkill = directive.name;
  } else {
    delete projectedConstraints.targetSkill;
    projectedConstraints.targetRecipe = directive.name;
  }

  const projectedInputText = inputText.replace(directivePattern, '').trim();
  if (projectedInputText.length === 0) {
    throw new AgentError({
      code: 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY',
      message: 'Capability directive stripped the effective user question to empty.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY' },
    });
  }

  return {
    inputText: projectedInputText,
    routingConstraints: projectedConstraints,
  };
}
