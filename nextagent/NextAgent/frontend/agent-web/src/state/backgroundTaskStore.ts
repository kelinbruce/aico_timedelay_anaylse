import { create } from 'zustand';
import type { BackgroundTaskStatus, BackgroundTaskView, StreamEnvelope } from './contracts.ts';

/** Background-task state projected independently from conversation envelopes. */

export type BackgroundTasksBySession = Readonly<Record<string, readonly BackgroundTaskView[]>>;

export interface BackgroundTaskState {
  readonly tasksBySession: BackgroundTasksBySession;
  seedTasks: (sessionId: string, tasks: readonly BackgroundTaskView[]) => void;
  applyStreamEnvelope: (envelope: StreamEnvelope) => boolean;
  markTaskKilled: (sessionId: string, taskId: string, finishedAt: number) => void;
  clearTasks: (sessionId: string) => void;
}

const BACKGROUND_TASK_EVENT_TYPES = new Set<StreamEnvelope['eventType']>([
  'BACKGROUND_TASK_STARTED',
  'BACKGROUND_TASK_COMPLETED',
  'BACKGROUND_TASK_FAILED',
]);

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function readTaskFromEnvelope(envelope: StreamEnvelope): BackgroundTaskView | undefined {
  if (!BACKGROUND_TASK_EVENT_TYPES.has(envelope.eventType)) {
    return undefined;
  }
  const payload = envelope.payload as Record<string, unknown>;
  const taskId = readString(payload.taskId);
  if (!taskId) {
    return undefined;
  }
  const status: BackgroundTaskStatus =
    envelope.eventType === 'BACKGROUND_TASK_STARTED' ? 'RUNNING' : envelope.eventType === 'BACKGROUND_TASK_COMPLETED' ? 'COMPLETED' : 'FAILED';
  const finishedAt = readNumber(payload.finishedAt);
  const exitCode = readNumber(payload.exitCode);
  return {
    taskId,
    commandName: readString(payload.commandName) ?? '',
    status,
    startedAt: readNumber(payload.startedAt) ?? 0,
    stdoutRef: readString(payload.stdoutRef) ?? '',
    stderrRef: readString(payload.stderrRef) ?? '',
    ...(finishedAt !== undefined ? { finishedAt } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

function tasksEqual(left: BackgroundTaskView, right: BackgroundTaskView): boolean {
  return (
    left.taskId === right.taskId &&
    left.commandName === right.commandName &&
    left.commandLine === right.commandLine &&
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.finishedAt === right.finishedAt &&
    left.exitCode === right.exitCode &&
    left.stdoutRef === right.stdoutRef &&
    left.stderrRef === right.stderrRef
  );
}

function mergeSeedTask(existing: BackgroundTaskView, seed: BackgroundTaskView): BackgroundTaskView {
  if (existing.status === 'KILLED' || (existing.status !== 'RUNNING' && seed.status === 'RUNNING')) {
    return seed.commandLine !== undefined && existing.commandLine === undefined ? { ...existing, commandLine: seed.commandLine } : existing;
  }
  if (existing.status === 'RUNNING' && seed.status !== 'RUNNING') {
    return {
      ...existing,
      ...seed,
      ...(existing.commandLine !== undefined ? { commandLine: existing.commandLine } : {}),
    };
  }
  return {
    ...seed,
    ...existing,
    ...(existing.commandLine === undefined && seed.commandLine !== undefined ? { commandLine: seed.commandLine } : {}),
  };
}

function mergeLiveTask(existing: BackgroundTaskView | undefined, incoming: BackgroundTaskView): BackgroundTaskView {
  if (!existing) {
    return incoming;
  }
  if (existing.status === 'KILLED' || (existing.status !== 'RUNNING' && incoming.status === 'RUNNING')) {
    return existing;
  }
  return {
    ...existing,
    ...incoming,
    ...(existing.commandLine !== undefined ? { commandLine: existing.commandLine } : {}),
  };
}

export const useBackgroundTaskStore = create<BackgroundTaskState>((set) => ({
  tasksBySession: {},
  seedTasks: (sessionId, tasks) =>
    set((state) => {
      const current = state.tasksBySession[sessionId] ?? [];
      let next = current;
      for (const seed of tasks) {
        const index = next.findIndex((task) => task.taskId === seed.taskId);
        if (index < 0) {
          next = [...next, seed];
          continue;
        }
        const merged = mergeSeedTask(next[index]!, seed);
        if (!tasksEqual(next[index]!, merged)) {
          next = [...next.slice(0, index), merged, ...next.slice(index + 1)];
        }
      }
      if (next === current) {
        return state;
      }
      return { tasksBySession: { ...state.tasksBySession, [sessionId]: next } };
    }),
  applyStreamEnvelope: (envelope) => {
    const incoming = readTaskFromEnvelope(envelope);
    if (!incoming) {
      return false;
    }
    set((state) => {
      const current = state.tasksBySession[envelope.sessionId] ?? [];
      const index = current.findIndex((task) => task.taskId === incoming.taskId);
      const merged = mergeLiveTask(index < 0 ? undefined : current[index], incoming);
      if (index >= 0 && tasksEqual(current[index]!, merged)) {
        return state;
      }
      const next = index < 0 ? [...current, merged] : [...current.slice(0, index), merged, ...current.slice(index + 1)];
      return { tasksBySession: { ...state.tasksBySession, [envelope.sessionId]: next } };
    });
    return true;
  },
  markTaskKilled: (sessionId, taskId, finishedAt) =>
    set((state) => {
      const current = state.tasksBySession[sessionId];
      const index = current?.findIndex((task) => task.taskId === taskId) ?? -1;
      if (!current || index < 0 || current[index]?.status === 'KILLED') {
        return state;
      }
      const killed = { ...current[index]!, status: 'KILLED' as const, finishedAt };
      const next = [...current.slice(0, index), killed, ...current.slice(index + 1)];
      return { tasksBySession: { ...state.tasksBySession, [sessionId]: next } };
    }),
  clearTasks: (sessionId) =>
    set((state) => {
      if (state.tasksBySession[sessionId] === undefined) {
        return state;
      }
      const next = { ...state.tasksBySession };
      delete next[sessionId];
      return { tasksBySession: next };
    }),
}));
