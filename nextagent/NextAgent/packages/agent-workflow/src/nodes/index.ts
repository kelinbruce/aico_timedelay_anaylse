import { AgentError, type JsonObject, type WorkflowNodeType } from '@nextagent/agent-common';
import type { WorkflowExecutionDiagnostic } from '@nextagent/agent-contracts/core';
import { executeAgentNode, executePythonNode, executeRestfulNode, executeToolChoiceNode } from './capability-nodes.js';
import {
  executeDelayNode,
  executeDisplayContentNode,
  executeGuardrailNode,
  executeInterruptNode,
  executeSubRecipeNode,
  executeUserCheckNode,
  executeUnavailableInteractionNode,
} from './interaction-nodes.js';
import { executeApiChoiceNode, executeKnowledgeQaNode, executeKnowledgeSearchNode, executeRecipeChoiceNode } from './knowledge-nodes.js';
import { executeLlmNode } from './llm-nodes.js';
import { coerceNumber, resolveNodeValue, resolveVariablePath } from './shared.js';
export { redactSecretsFromValue, resolveNodeValue } from './shared.js';
export { resolveSecrets } from './shared.js';
import type { CreateWorkflowNodeCatalogOptions, WorkflowNodeCatalog, WorkflowNodeHandlerContext, WorkflowNodeTransition } from './types.js';

// Default convergence timeout for parallel-gateway join when inputs.join_timeout is unspecified.
const DEFAULT_JOIN_TIMEOUT_MS = 600_000;

export type {
  CreateWorkflowNodeCatalogOptions,
  IntentMatchRule,
  WorkflowExecutionResumeState,
  WorkflowNodeCatalog,
  WorkflowNodeHandler,
  WorkflowNodeHandlerContext,
  WorkflowNodeHandlerResult,
  WorkflowNodeLlmPrompt,
  WorkflowNodeLlmPromptRequest,
  WorkflowNodeModelInvocationConfig,
  WorkflowPendingInputActivation,
  WorkflowPendingInputOption,
  WorkflowPendingInputQuestion,
  WorkflowPendingInputRequest,
  WorkflowNodeTransition,
  WorkflowRecipeAwareObserver,
} from './types.js';

export const defaultWorkflowNodeCatalog: WorkflowNodeCatalog = Object.freeze({
  handlers: Object.freeze({
    START: async () => undefined,
    END: async () => ({ transition: { kind: 'TERMINAL' as const } }),
    DISPLAY: async (context: WorkflowNodeHandlerContext) => executeDisplayContentNode(context),
    GUARDRAIL: async (context: WorkflowNodeHandlerContext) => executeGuardrailNode(context, {}),
    KNOWLEDGE_SEARCH: async (context: WorkflowNodeHandlerContext) => executeKnowledgeSearchNode(context, {}),
    KNOWLEDGE_QA: async (context: WorkflowNodeHandlerContext) => executeKnowledgeQaNode(context, {}),
    API_CHOICE: async (context: WorkflowNodeHandlerContext) => executeApiChoiceNode(context, {}),
    RECIPE_CHOICE: async (context: WorkflowNodeHandlerContext) => executeRecipeChoiceNode(context, {}),
    USER_CHECK: async (context: WorkflowNodeHandlerContext) => executeUserCheckNode(context),
    INTERRUPT: async (context: WorkflowNodeHandlerContext) => executeInterruptNode(context),
    SUBFLOW: async (context: WorkflowNodeHandlerContext) => executeSubRecipeNode(context, {}),
    DELAY: async (context: WorkflowNodeHandlerContext) => executeDelayNode(context),
    CONDITION: async (context: WorkflowNodeHandlerContext) => {
      const branches = Object.entries(context.node.next ?? {}) as Array<readonly [string, { readonly condition?: string }]>;
      const fallback = resolveExclusiveFallback(branches);
      let firstParseFailureIndex: number | undefined;
      for (const [nextNodeId, branch] of branches) {
        if (fallback?.nextNodeId === nextNodeId) {
          continue;
        }
        try {
          if (evaluateBranchCondition(branch.condition, context.variables)) {
            return {
              transition: { kind: 'BRANCH' as const, nextNodeId },
              diagnostic: buildExclusiveDiagnostic('WORKFLOW_EXCLUSIVE_GATEWAY_BRANCH_SELECTED', nextNodeId, firstParseFailureIndex),
            };
          }
        } catch {
          if (firstParseFailureIndex === undefined) {
            firstParseFailureIndex = branches.findIndex(([candidateNodeId]) => candidateNodeId === nextNodeId);
          }
          continue;
        }
      }
      if (fallback !== undefined) {
        return {
          transition: { kind: 'BRANCH' as const, nextNodeId: fallback.nextNodeId },
          diagnostic: buildExclusiveDiagnostic('WORKFLOW_EXCLUSIVE_GATEWAY_FALLBACK_SELECTED', fallback.nextNodeId, firstParseFailureIndex),
        };
      }
      throw new AgentError({
        code: 'WORKFLOW_EXCLUSIVE_GATEWAY_NO_MATCH',
        message: 'Exclusive gateway did not match any branch safely.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          reasonCode: 'WORKFLOW_EXCLUSIVE_GATEWAY_NO_MATCH',
          nodeId: context.nodeId,
          nodeType: context.node.type,
        },
      });
    },
    PARALLEL: async (context: WorkflowNodeHandlerContext) => {
      const branches = Object.entries(context.node.next ?? {}) as Array<readonly [string, { readonly condition?: string }]>;
      const selectedBranchIds: string[] = [];
      let firstParseFailureIndex: number | undefined;
      for (const [nextNodeId, branch] of branches) {
        try {
          if (evaluateBranchCondition(branch.condition, context.variables)) {
            selectedBranchIds.push(nextNodeId);
          }
        } catch {
          if (firstParseFailureIndex === undefined) {
            firstParseFailureIndex = branches.findIndex(([candidateNodeId]) => candidateNodeId === nextNodeId);
          }
        }
      }
      if (selectedBranchIds.length === 0) {
        throw new AgentError({
          code: 'WORKFLOW_PARALLEL_GATEWAY_NO_MATCH',
          message: 'Parallel gateway did not match any branch safely.',
          category: 'VALIDATION',
          retryable: false,
          safeDetails: {
            reasonCode: 'WORKFLOW_PARALLEL_GATEWAY_NO_MATCH',
            nodeId: context.nodeId,
            nodeType: context.node.type,
          },
        });
      }
      const parallelInputs = resolveParallelGatewayInputs(context.node.inputs, context.variables);
      if (selectedBranchIds.length === 1) {
        return {
          transition: { kind: 'BRANCH' as const, nextNodeId: selectedBranchIds[0]! },
          diagnostic: buildExclusiveDiagnostic('WORKFLOW_PARALLEL_GATEWAY_BRANCH_SELECTED', selectedBranchIds[0]!, firstParseFailureIndex),
        };
      }
      return {
        transition: {
          kind: 'FORK_JOIN' as const,
          branchNodeIds: selectedBranchIds,
          joinNodeId: parallelInputs.joinNodeId ?? resolveParallelJoinNodeId(context.recipe, selectedBranchIds, context.nodeId),
          joinOnFailure: parallelInputs.joinOnFailure,
          ...(parallelInputs.joinTimeout === undefined ? {} : { joinTimeout: parallelInputs.joinTimeout }),
        },
        diagnostic: {
          reasonCode: 'WORKFLOW_PARALLEL_GATEWAY_BRANCHES_SELECTED',
          waitingBranchCount: selectedBranchIds.length,
          ...(firstParseFailureIndex === undefined ? {} : { conditionIndex: firstParseFailureIndex }),
        },
      };
    },
  }),
});

export function createWorkflowNodeCatalog(options: CreateWorkflowNodeCatalogOptions = {}): WorkflowNodeCatalog {
  return {
    handlers: Object.freeze({
      ...defaultWorkflowNodeCatalog.handlers,
      LLM: async (context) => executeLlmNode(context, options),
      LLM_ROUTER: async (context) => executeLlmNode(context, options),
      INTENT_RECOGNITION: async (context) => executeLlmNode(context, options),
      QUESTION_REWRITING: async (context) => executeLlmNode(context, options),
      TRANSLATION: async (context) => executeLlmNode(context, options),
      DATA_ANALYSIS: async (context) => executeLlmNode(context, options),
      PARAM_EXTRACT: async (context) => executeLlmNode(context, options),
      TOOL_CHOICE: async (context) => executeToolChoiceNode(context, options),
      RESTFUL: async (context) => executeRestfulNode(context, options),
      PYTHON: async (context) => executePythonNode(context, options),
      AGENT: async (context) => executeAgentNode(context, options),
      KNOWLEDGE_SEARCH: async (context) => executeKnowledgeSearchNode(context, options),
      KNOWLEDGE_QA: async (context) => executeKnowledgeQaNode(context, options),
      API_CHOICE: async (context) => executeApiChoiceNode(context, options),
      RECIPE_CHOICE: async (context) => executeRecipeChoiceNode(context, options),
      GUARDRAIL: async (context) => executeGuardrailNode(context, options),
      SUBFLOW: async (context) => executeSubRecipeNode(context, options),
    }),
  };
}

export function resolveWorkflowBranchTransition(
  nodeType: WorkflowNodeType,
  branches: ReadonlyArray<readonly [string, { readonly condition?: string }]>,
  variables: JsonObject,
): WorkflowNodeTransition {
  const fallback = resolveExclusiveFallback(branches);
  for (const [nextNodeId, branch] of branches) {
    if (fallback?.nextNodeId === nextNodeId) {
      continue;
    }
    try {
      if (evaluateBranchCondition(branch.condition, variables)) {
        return { kind: 'BRANCH', nextNodeId };
      }
    } catch {
      continue;
    }
  }
  if (fallback !== undefined) {
    return { kind: 'BRANCH', nextNodeId: fallback.nextNodeId };
  }
  throw new AgentError({
    code: 'WORKFLOW_TRANSITION_NO_MATCH',
    message: 'Workflow node did not match any branch safely.',
    category: 'VALIDATION',
    retryable: false,
    safeDetails: { reasonCode: 'WORKFLOW_TRANSITION_NO_MATCH', nodeType },
  });
}

function resolveExclusiveFallback(branches: ReadonlyArray<readonly [string, { readonly condition?: string }]>):
  | {
      readonly nextNodeId: string;
    }
  | undefined {
  const candidate = branches.at(-1);
  if (candidate === undefined) {
    return undefined;
  }
  const [nextNodeId, branch] = candidate;
  return isEmptyCondition(branch.condition) ? { nextNodeId } : undefined;
}

interface ParallelGatewayInputs {
  readonly joinNodeId?: string | undefined;
  readonly joinOnFailure: 'break' | 'wait';
  readonly joinTimeout?: number;
}

function resolveParallelGatewayInputs(rawInputs: JsonObject | undefined, variables: JsonObject): ParallelGatewayInputs {
  if (rawInputs === undefined) {
    return { joinNodeId: undefined, joinOnFailure: 'wait', joinTimeout: DEFAULT_JOIN_TIMEOUT_MS };
  }
  let resolved: JsonObject;
  try {
    resolved = resolveNodeValue(rawInputs, variables) as JsonObject;
  } catch {
    return { joinNodeId: undefined, joinOnFailure: 'wait', joinTimeout: DEFAULT_JOIN_TIMEOUT_MS };
  }
  const joinNode = resolved['join_node'];
  const joinOnFailure = resolved['join_on_failure'];
  const joinTimeout = resolved['join_timeout'];
  // 1.0 DSL join_timeout is seconds (string-quoted). Convert to ms for engine.
  const timeoutSeconds = coerceNumber(joinTimeout);
  return {
    joinNodeId: typeof joinNode === 'string' && joinNode.length > 0 ? joinNode : undefined,
    joinOnFailure: joinOnFailure === 'break' ? 'break' : 'wait',
    joinTimeout:
      timeoutSeconds !== undefined && Number.isInteger(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds * 1000 : DEFAULT_JOIN_TIMEOUT_MS,
  };
}

function resolveParallelJoinNodeId(
  recipe: import('@nextagent/agent-contracts/core').RecipeDefinition,
  branchNodeIds: readonly string[],
  parallelNodeId: string,
): string {
  const reachability = branchNodeIds.map((branchNodeId) => collectReachableNodeIds(recipe, branchNodeId));
  const [firstBranchReachability, ...otherBranches] = reachability;
  // Default join resolution: the first END-typed node reachable from every selected branch.
  const joinNodeId = firstBranchReachability?.find(
    (nodeId) => recipe.flowGraph.nodes[nodeId]?.type === 'END' && otherBranches.every((nodes) => nodes.includes(nodeId)),
  );
  if (joinNodeId !== undefined) {
    return joinNodeId;
  }
  throw new AgentError({
    code: 'WORKFLOW_PARALLEL_GATEWAY_JOIN_UNRESOLVED',
    message: 'Parallel gateway branches do not share a safe join node.',
    category: 'VALIDATION',
    retryable: false,
    safeDetails: {
      reasonCode: 'WORKFLOW_PARALLEL_GATEWAY_JOIN_UNRESOLVED',
      nodeId: parallelNodeId,
      nodeType: 'PARALLEL',
    },
  });
}

function collectReachableNodeIds(recipe: import('@nextagent/agent-contracts/core').RecipeDefinition, startNodeId: string): readonly string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (seen.has(nodeId)) {
      continue;
    }
    seen.add(nodeId);
    ordered.push(nodeId);
    const node = recipe.flowGraph.nodes[nodeId];
    if (node === undefined) {
      continue;
    }
    queue.push(...Object.keys(node.next ?? {}));
  }
  return ordered;
}

function isEmptyCondition(condition?: string): boolean {
  return condition === undefined || condition.trim().length === 0;
}

function buildExclusiveDiagnostic(reasonCode: string, selectedBranchId: string, conditionIndex?: number): WorkflowExecutionDiagnostic {
  return {
    reasonCode,
    selectedBranchId,
    ...(conditionIndex === undefined ? {} : { conditionIndex }),
  };
}

export function evaluateBranchCondition(condition: string | undefined, variables: JsonObject): boolean {
  if (condition === undefined || condition.trim().length === 0) {
    return true;
  }
  const parser = new ConditionParser(tokenizeCondition(stripConditionWrapper(condition)), variables);
  return parser.parseExpression();
}

function stripConditionWrapper(condition: string): string {
  const trimmed = condition.trim();
  if (trimmed.startsWith('${') && trimmed.endsWith('}')) {
    return trimmed.slice(2, -1).trim();
  }
  return trimmed;
}

type ConditionToken =
  | { readonly kind: 'identifier'; readonly value: string }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'null'; readonly value: null }
  | { readonly kind: 'operator'; readonly value: '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||' }
  | { readonly kind: 'paren'; readonly value: '(' | ')' };

function tokenizeCondition(source: string): ConditionToken[] {
  const tokens: ConditionToken[] = [];
  let index = 0;
  while (index < source.length) {
    const current = source[index]!;
    if (/\s/u.test(current)) {
      index += 1;
      continue;
    }
    const twoCharacterOperator = source.slice(index, index + 2);
    if (
      twoCharacterOperator === '==' ||
      twoCharacterOperator === '!=' ||
      twoCharacterOperator === '<=' ||
      twoCharacterOperator === '>=' ||
      twoCharacterOperator === '&&' ||
      twoCharacterOperator === '||'
    ) {
      tokens.push({ kind: 'operator', value: twoCharacterOperator });
      index += 2;
      continue;
    }
    if (current === '<' || current === '>') {
      tokens.push({ kind: 'operator', value: current });
      index += 1;
      continue;
    }
    if (current === '(' || current === ')') {
      tokens.push({ kind: 'paren', value: current });
      index += 1;
      continue;
    }
    if (current === '"' || current === "'") {
      const quote = current;
      let value = '';
      index += 1;
      while (index < source.length) {
        const next = source[index]!;
        if (next === '\\') {
          const escaped = source[index + 1];
          if (escaped !== undefined) {
            value += escaped;
            index += 2;
            continue;
          }
        }
        if (next === quote) {
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      tokens.push({ kind: 'string', value });
      continue;
    }
    if (/[0-9]/u.test(current)) {
      let end = index + 1;
      while (end < source.length && /[0-9.]/u.test(source[end]!)) {
        end += 1;
      }
      tokens.push({ kind: 'number', value: Number(source.slice(index, end)) });
      index = end;
      continue;
    }
    let end = index + 1;
    while (end < source.length && /[A-Za-z0-9_.\[\]"']/u.test(source[end]!)) {
      end += 1;
    }
    const identifier = source.slice(index, end);
    if (identifier === 'true' || identifier === 'false') {
      tokens.push({ kind: 'boolean', value: identifier === 'true' });
    } else if (identifier === 'null') {
      tokens.push({ kind: 'null', value: null });
    } else {
      tokens.push({ kind: 'identifier', value: identifier });
    }
    index = end;
  }
  return tokens;
}

class ConditionParser {
  private index = 0;

  constructor(
    private readonly tokens: readonly ConditionToken[],
    private readonly variables: JsonObject,
  ) {}

  parseExpression(): boolean {
    return Boolean(this.parseOr());
  }

  private parseOr(): unknown {
    let value = this.parseAnd();
    while (this.consumeOperator('||')) {
      value = Boolean(value) || Boolean(this.parseAnd());
    }
    return value;
  }

  private parseAnd(): unknown {
    let value = this.parseComparison();
    while (this.consumeOperator('&&')) {
      value = Boolean(value) && Boolean(this.parseComparison());
    }
    return value;
  }

  private parseComparison(): unknown {
    let value = this.parsePrimary();
    while (true) {
      const operator = this.peekOperator();
      if (
        operator === undefined ||
        (operator !== '==' && operator !== '!=' && operator !== '<' && operator !== '<=' && operator !== '>' && operator !== '>=')
      ) {
        return value;
      }
      this.index += 1;
      value = compareValues(value, operator, this.parsePrimary());
    }
  }

  private parsePrimary(): unknown {
    const token = this.tokens[this.index];
    if (token === undefined) {
      throw new Error('Unexpected end of condition.');
    }
    this.index += 1;
    if (token.kind === 'paren' && token.value === '(') {
      const nested = this.parseOr();
      const closing = this.tokens[this.index];
      if (closing?.kind !== 'paren' || closing.value !== ')') {
        throw new Error('Condition closing parenthesis is missing.');
      }
      this.index += 1;
      return nested;
    }
    if (token.kind === 'identifier') {
      return resolveVariablePath(this.variables, token.value);
    }
    if (token.kind === 'string' || token.kind === 'number' || token.kind === 'boolean' || token.kind === 'null') {
      return token.value;
    }
    throw new Error('Unsupported condition token.');
  }

  private consumeOperator(operator: Extract<ConditionToken, { kind: 'operator' }>['value']): boolean {
    const token = this.tokens[this.index];
    if (token?.kind === 'operator' && token.value === operator) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private peekOperator(): Extract<ConditionToken, { kind: 'operator' }>['value'] | undefined {
    const token = this.tokens[this.index];
    return token?.kind === 'operator' ? token.value : undefined;
  }
}

function compareValues(left: unknown, operator: '==' | '!=' | '<' | '<=' | '>' | '>=', right: unknown): boolean {
  switch (operator) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
      return compareOrder(left, right) < 0;
    case '<=':
      return compareOrder(left, right) <= 0;
    case '>':
      return compareOrder(left, right) > 0;
    case '>=':
      return compareOrder(left, right) >= 0;
    default: {
      const exhaustive: never = operator;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function compareOrder(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return left.localeCompare(right);
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right);
  }
  return String(left).localeCompare(String(right));
}
