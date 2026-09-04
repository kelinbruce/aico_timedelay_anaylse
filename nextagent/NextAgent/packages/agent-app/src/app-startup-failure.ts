import { AgentError } from '@nextagent/agent-common';

export const appStartupFailureStages = [
  'SCHEDULED_MAINTENANCE_START',
  'CRON_SCHEDULER_START',
  'TRAJECTORY_WORKER_START',
  'MEMORY_AGING_SCHEDULER_START',
  'MEMORY_EXTRACTION_SCHEDULER_START',
  'CAPABILITY_STARTUP_VALIDATION',
  'WEB_CHANNEL_READY',
  'TASK_CHANNEL_READY',
  'CRON_CALLBACK_READY',
  'RAG_KNOWLEDGE_BUILD',
  'SERVER_LISTEN',
  'RUNTIME_RECOVERY',
  'APP_STARTUP',
] as const;

export type AppStartupFailureStage = (typeof appStartupFailureStages)[number];

const appStartupFailureStageSet = new Set<string>(appStartupFailureStages);

export function classifyAppStartupFailure(error: unknown): AppStartupFailureStage {
  if (!(error instanceof AgentError) || error.code !== 'APP_START_FAILED' || error.category !== 'INTERNAL') {
    return 'APP_STARTUP';
  }
  const failureStage = error.safeDetails?.['failureStage'];
  return typeof failureStage === 'string' && appStartupFailureStageSet.has(failureStage) ? (failureStage as AppStartupFailureStage) : 'APP_STARTUP';
}
