import type { JsonObject, JsonValue } from '@nextagent/agent-common';
import type { WorkflowExecutionEvent, WorkflowExecutionObserver } from '@nextagent/agent-contracts/core';
import type { DeveloperDiagnosticArtifactInput, DeveloperDiagnosticArtifactSink } from './index.js';

const WORKFLOW_NODE_TRACE_ARTIFACT_TYPE = 'workflow-node-trace';
const WORKFLOW_BOUNDARY_TRACE_ARTIFACT_TYPE = 'workflow-boundary-trace';

type BoundaryType = 'MODEL' | 'API' | 'PYTHON';

interface PendingNodeTrace {
  readonly startedAt: Date;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly executionId: string;
  readonly input: JsonObject | undefined;
}

export class WorkflowTraceCollector implements WorkflowExecutionObserver {
  private readonly pending = new Map<string, PendingNodeTrace>();

  constructor(
    private readonly sink: DeveloperDiagnosticArtifactSink,
    private readonly coordinates: WorkflowTraceCoordinates,
  ) {}

  async emitEvent(event: WorkflowExecutionEvent): Promise<void> {
    try {
      const traceKey = event.nodeExecutionId ?? `${event.executionId}:${event.nodeId}`;

      if (event.eventType === 'NODE_STARTED') {
        const input = extractSafeValue(event.input);
        this.pending.set(traceKey, {
          startedAt: event.startedAt,
          nodeId: event.nodeId,
          nodeType: event.nodeType,
          executionId: event.executionId,
          input,
        });

        // Emit a trace record at node start so the viewer can show
        // the node beginning with its input before boundary calls
        // and the terminal record appear.
        await this.sink.emit({
          artifactType: WORKFLOW_NODE_TRACE_ARTIFACT_TYPE,
          ...optionalCoordinate('sessionId', this.coordinates.sessionId),
          ...optionalCoordinate('requestId', this.coordinates.requestId),
          ...optionalCoordinate('runId', this.coordinates.runId),
          ...optionalCoordinate('agentId', this.coordinates.agentId),
          ...optionalCoordinate('agentVersion', this.coordinates.agentVersion),
          payload: {
            executionId: event.executionId,
            nodeId: event.nodeId,
            nodeType: event.nodeType,
            nodeExecutionId: event.nodeExecutionId,
            durationMs: 0,
            status: 'NODE_STARTED',
            input,
          },
        });
        return;
      }

      if (
        event.eventType === 'NODE_COMPLETED' ||
        event.eventType === 'NODE_FAILED' ||
        event.eventType === 'NODE_SKIPPED' ||
        event.eventType === 'NODE_WAITING'
      ) {
        const pending = this.pending.get(traceKey);
        if (pending === undefined) {
          return;
        }
        this.pending.delete(traceKey);

        const completedAt = event.completedAt ?? event.startedAt;
        const durationMs = Math.max(0, completedAt.getTime() - pending.startedAt.getTime());
        const output = extractSafeValue(event.output);

        await this.sink.emit({
          artifactType: WORKFLOW_NODE_TRACE_ARTIFACT_TYPE,
          ...optionalCoordinate('sessionId', this.coordinates.sessionId),
          ...optionalCoordinate('requestId', this.coordinates.requestId),
          ...optionalCoordinate('runId', this.coordinates.runId),
          ...optionalCoordinate('agentId', this.coordinates.agentId),
          ...optionalCoordinate('agentVersion', this.coordinates.agentVersion),
          payload: {
            executionId: pending.executionId,
            nodeId: pending.nodeId,
            nodeType: pending.nodeType,
            nodeExecutionId: event.nodeExecutionId,
            durationMs,
            status: event.eventType,
            input: pending.input,
            output,
            ...(event.safeError === undefined ? {} : { safeError: event.safeError }),
          },
        });
      }
    } catch {
      // Observe-only: must not affect workflow execution.
    }
  }
}

export function createTimingWrappedService<T extends object>(
  original: T,
  sink: DeveloperDiagnosticArtifactSink,
  coordinates: WorkflowTraceCoordinates,
  boundaryType: BoundaryType,
  methodNames: readonly (keyof T)[],
): T {
  const wrapped = Object.create(original) as T;
  for (const methodName of methodNames) {
    const fn = original[methodName];
    if (typeof fn !== 'function') {
      continue;
    }
    (wrapped as Record<string, unknown>)[methodName as string] = function (...args: unknown[]) {
      return trackBoundaryCall(() => (fn as Function).apply(original, args), sink, coordinates, boundaryType);
    };
  }
  return Object.freeze(wrapped);
}

async function trackBoundaryCall<T>(
  operation: () => T | Promise<T>,
  sink: DeveloperDiagnosticArtifactSink,
  coordinates: WorkflowTraceCoordinates,
  boundaryType: BoundaryType,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    await emitBoundaryTrace(sink, coordinates, boundaryType, startedAt, 'SUCCEEDED');
    return result;
  } catch (error) {
    await emitBoundaryTrace(sink, coordinates, boundaryType, startedAt, 'FAILED');
    throw error;
  }
}

async function emitBoundaryTrace(
  sink: DeveloperDiagnosticArtifactSink,
  coordinates: WorkflowTraceCoordinates,
  boundaryType: BoundaryType,
  startedAt: number,
  status: 'SUCCEEDED' | 'FAILED',
): Promise<void> {
  try {
    const durationMs = Math.max(0, Date.now() - startedAt);
    await sink.emit({
      artifactType: WORKFLOW_BOUNDARY_TRACE_ARTIFACT_TYPE,
      ...optionalCoordinate('sessionId', coordinates.sessionId),
      ...optionalCoordinate('requestId', coordinates.requestId),
      ...optionalCoordinate('runId', coordinates.runId),
      ...optionalCoordinate('agentId', coordinates.agentId),
      ...optionalCoordinate('agentVersion', coordinates.agentVersion),
      payload: {
        recordedAt: new Date(startedAt).toISOString(),
        boundaryType,
        durationMs,
        status,
      },
    });
  } catch {
    // Observe-only: must not affect workflow execution.
  }
}

function extractSafeValue(value: unknown): JsonObject | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    return value as JsonObject;
  }
  return { value: value as JsonValue };
}

function optionalCoordinate(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

export interface WorkflowTraceCoordinates {
  sessionId?: string;
  requestId?: string;
  runId?: string;
  agentId?: string;
  agentVersion?: string;
}

export function createWorkflowTraceCoordinates(): WorkflowTraceCoordinates {
  return {};
}
