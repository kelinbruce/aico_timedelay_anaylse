import { apiClient } from './apiClient.ts';
import type { BackgroundTaskKillResponse, BackgroundTaskOutputResponse, BackgroundTaskView } from '../state/contracts.ts';

const DEFAULT_OUTPUT_LIMIT_BYTES = 65_536;

export interface BackgroundTaskService {
  listTasks: (sessionId: string, signal?: AbortSignal) => Promise<readonly BackgroundTaskView[]>;
  readOutput: (
    sessionId: string,
    taskId: string,
    stream: 'stdout' | 'stderr',
    limitBytes?: number,
    signal?: AbortSignal,
  ) => Promise<BackgroundTaskOutputResponse>;
  killTask: (sessionId: string, taskId: string) => Promise<BackgroundTaskKillResponse>;
}

export const backgroundTaskService: BackgroundTaskService = {
  listTasks: (sessionId, signal) =>
    apiClient
      .get<{ tasks: readonly BackgroundTaskView[] }>(
        `/api/v1/sessions/${encodeURIComponent(sessionId)}/background-tasks`,
        signal === undefined ? undefined : { signal },
      )
      .then((response) => response.tasks),

  readOutput: (sessionId, taskId, stream, limitBytes = DEFAULT_OUTPUT_LIMIT_BYTES, signal) =>
    apiClient.get<BackgroundTaskOutputResponse>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/background-tasks/${encodeURIComponent(taskId)}/output?stream=${stream}&limitBytes=${limitBytes}`,
      signal === undefined ? undefined : { signal },
    ),

  killTask: (sessionId, taskId) =>
    apiClient.post<BackgroundTaskKillResponse>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/background-tasks/${encodeURIComponent(taskId)}/kill`,
    ),
};
