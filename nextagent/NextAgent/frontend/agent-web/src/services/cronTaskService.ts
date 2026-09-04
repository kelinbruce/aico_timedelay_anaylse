import { apiClient } from './apiClient.ts';

export type CronTaskTargetKind = 'SKILL' | 'WORKFLOW';

export interface CronTaskTarget {
  readonly kind: CronTaskTargetKind;
  readonly name: string;
}

export interface CronTaskView {
  readonly taskId: string;
  readonly cron: string;
  readonly humanSchedule: string;
  readonly prompt: string;
  readonly target?: CronTaskTarget;
  readonly recurring: boolean;
  readonly status: string;
  readonly createdBy?: string;
  readonly createdByName?: string;
  readonly createdAt: string | number;
  readonly updatedAt: string | number;
  readonly nextRunAt: string | number | null;
}

export interface CronTaskPage {
  readonly tasks: readonly CronTaskView[];
  readonly total: number;
}

export interface CronTaskExecutionView {
  readonly triggerId: string;
  readonly taskId: string;
  readonly scheduledAt: string | number;
  readonly triggerStatus: string;
  readonly createdAt: string | number;
  readonly updatedAt: string | number;
  readonly sessionId?: string;
  readonly requestRunId?: string;
  readonly runStatus?: string;
  readonly terminalCommitState?: string;
  readonly resultEventType?: string;
  readonly resultContent?: string;
  readonly resultAt?: string | number;
}

export interface CronTaskExecutionPage {
  readonly executions: readonly CronTaskExecutionView[];
  readonly total: number;
}

export interface CronTaskListParams {
  readonly offset?: number;
  readonly limit?: number;
}

export interface CreateCronTaskRequest {
  readonly cron: string;
  readonly prompt: string;
  readonly target?: CronTaskTarget;
  readonly recurring?: boolean;
}

export interface UpdateCronTaskRequest {
  readonly cron?: string;
  readonly prompt?: string;
  readonly target?: CronTaskTarget | null;
  readonly recurring?: boolean;
}

function pageQuery(params: CronTaskListParams = {}): string {
  const search = new URLSearchParams();
  if (params.offset !== undefined) {
    search.set('offset', String(params.offset));
  }
  if (params.limit !== undefined) {
    search.set('limit', String(params.limit));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

function taskPath(taskId: string): string {
  return `/api/v1/cron-tasks/${encodeURIComponent(taskId)}`;
}

export const cronTaskService = {
  listCronTasks(params?: CronTaskListParams): Promise<CronTaskPage> {
    return apiClient.get<CronTaskPage>(`/api/v1/cron-tasks${pageQuery(params)}`);
  },

  createCronTask(request: CreateCronTaskRequest): Promise<CronTaskView> {
    return apiClient.post<CronTaskView>('/api/v1/cron-tasks', {
      cron: request.cron,
      prompt: request.prompt,
      ...(request.target !== undefined ? { target: request.target } : {}),
      recurring: request.recurring,
    });
  },

  updateCronTask(taskId: string, request: UpdateCronTaskRequest): Promise<CronTaskView> {
    return apiClient.put<CronTaskView>(taskPath(taskId), {
      ...(request.cron !== undefined ? { cron: request.cron } : {}),
      ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
      ...(request.target !== undefined ? { target: request.target } : {}),
      ...(request.recurring !== undefined ? { recurring: request.recurring } : {}),
    });
  },

  deleteCronTask(taskId: string): Promise<void> {
    return apiClient.delete<void>(taskPath(taskId));
  },

  executeCronTask(taskId: string): Promise<CronTaskExecutionView> {
    return apiClient.post<CronTaskExecutionView>(`${taskPath(taskId)}/runs`, undefined);
  },

  listCronTaskExecutions(taskId: string, params?: CronTaskListParams): Promise<CronTaskExecutionPage> {
    return apiClient.get<CronTaskExecutionPage>(`${taskPath(taskId)}/runs${pageQuery(params)}`);
  },
};
