import type { JsonObject } from '@nextagent/agent-common';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { RecipeDefinition, WorkflowExecutionEvent } from '@nextagent/agent-contracts/core';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { WorkflowRuntimeEventProjector } from '../agent/workflow-runtime-event-projector.js';
import { isWorkflowCapability } from './workflow-capability.js';

export interface WorkflowToolDeltaProjectionState {
  readonly projectorsByExecution: Map<string, WorkflowRuntimeEventProjector>;
}

export function createWorkflowToolDeltaProjectionState(): WorkflowToolDeltaProjectionState {
  return { projectorsByExecution: new Map() };
}

export async function tryEmitWorkflowToolDelta(input: {
  readonly runState: AgentRunStatePort;
  readonly run: RequestRun;
  readonly context: RequestContext;
  readonly descriptor: CapabilityDescriptor;
  readonly toolCallId: string;
  readonly structuredPayload: JsonObject;
  readonly state: WorkflowToolDeltaProjectionState;
}): Promise<boolean> {
  if (!isWorkflowCapability(input.descriptor)) {
    return false;
  }

  const recipe = readRecord(input.structuredPayload['workflowRecipe']);
  const event = readRecord(input.structuredPayload['workflowExecutionEvent']);
  if (recipe !== undefined && event !== undefined) {
    await emitWorkflowExecutionEvent(input, recipe as unknown as RecipeDefinition, event);
    return true;
  }

  return false;
}

async function emitWorkflowExecutionEvent(
  input: Parameters<typeof tryEmitWorkflowToolDelta>[0],
  recipe: RecipeDefinition,
  rawEvent: JsonObject,
): Promise<void> {
  const event = hydrateWorkflowExecutionEvent(rawEvent);
  if (event === undefined) {
    return;
  }
  const projector = resolveProjector(input.state, recipe, event.executionId, input.toolCallId);
  for (const timelineEvent of projector.project(event)) {
    await input.runState.emitEvent(input.run, input.context, timelineEvent);
  }
}

function readRecord(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function resolveProjector(
  state: WorkflowToolDeltaProjectionState,
  recipe: RecipeDefinition,
  executionId: string,
  parentToolCallId: string,
): WorkflowRuntimeEventProjector {
  const key = `${recipe.recipeName}:${recipe.version}:${executionId}`;
  const existing = state.projectorsByExecution.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = new WorkflowRuntimeEventProjector(recipe, 'SUB', parentToolCallId);
  state.projectorsByExecution.set(key, created);
  return created;
}

function hydrateWorkflowExecutionEvent(raw: JsonObject): WorkflowExecutionEvent | undefined {
  const executionId = raw['executionId'];
  const nodeId = raw['nodeId'];
  const nodeType = raw['nodeType'];
  const eventType = raw['eventType'];
  const retryCount = raw['retryCount'];
  const startedAtEpochMs = raw['startedAtEpochMs'];
  const completedAtEpochMs = raw['completedAtEpochMs'];
  const nodeExecutionId = raw['nodeExecutionId'];
  const predecessorNodeExecutionIds = readStringArray(raw['predecessorNodeExecutionIds']);
  if (
    typeof executionId !== 'string' ||
    typeof nodeId !== 'string' ||
    typeof nodeType !== 'string' ||
    typeof eventType !== 'string' ||
    typeof retryCount !== 'number' ||
    typeof startedAtEpochMs !== 'number' ||
    (nodeExecutionId !== undefined && typeof nodeExecutionId !== 'string') ||
    (raw['predecessorNodeExecutionIds'] !== undefined && predecessorNodeExecutionIds === undefined)
  ) {
    return undefined;
  }
  return {
    executionId,
    nodeId,
    nodeType,
    eventType,
    retryCount,
    startedAt: new Date(startedAtEpochMs),
    ...(typeof nodeExecutionId === 'string' ? { nodeExecutionId } : {}),
    ...(predecessorNodeExecutionIds === undefined ? {} : { predecessorNodeExecutionIds }),
    ...(typeof completedAtEpochMs === 'number' ? { completedAt: new Date(completedAtEpochMs) } : {}),
    ...(readRecord(raw['visibleDelta']) === undefined ? {} : { visibleDelta: raw['visibleDelta'] }),
    ...(readRecord(raw['output']) === undefined ? {} : { output: raw['output'] }),
    ...(readRecord(raw['input']) === undefined ? {} : { input: raw['input'] }),
    ...(readRecord(raw['diagnostic']) === undefined ? {} : { diagnostic: raw['diagnostic'] }),
    ...(readRecord(raw['safeError']) === undefined ? {} : { safeError: raw['safeError'] }),
  } as unknown as WorkflowExecutionEvent;
}

function readStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : undefined;
}
