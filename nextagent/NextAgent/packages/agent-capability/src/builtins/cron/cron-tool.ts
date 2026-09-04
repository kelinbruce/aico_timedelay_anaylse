import { AgentError, brand, type JsonObject } from '@nextagent/agent-common';

import { defineTool, type CronDelay, type CronTaskPort, type CronTaskScope, type ToolExecutionContext } from '../../tools/tool-spi.js';
import { builtinToolPresentation } from '../presentation-names.js';
import { cronToHuman, parseCronExpression } from './cron-expression.js';
import { cronScopeFromContext } from './cron-task-store.js';
import { cronInputSchema, cronOutputSchema, cronPromptMaxLength } from './cron-schemas.js';

export const cronCapabilityId = brand<string, 'CapabilityId'>('Cron');

const CRON_PROMPT_MAX_LENGTH = cronPromptMaxLength;

export const cronToolDefinition = defineTool({
  name: cronCapabilityId,
  ...builtinToolPresentation('Cron'),
  description:
    'Create, list, or delete scheduled tasks in the current trusted scope. Choose create+delay for a one-time elapsed duration such as “10 minutes from now”; choose create+cron for local calendar times or recurring schedules. ' +
    'A cron schedule uses five minute-level fields (minute hour day-of-month month day-of-week). A request for one specific future time, such as “At 10 PM, query a KPI” or “Remind me tomorrow at 8 AM”, is one-shot unless the user explicitly says every, daily, weekly, repeatedly, or another recurrence phrase; set recurring=false explicitly. Only explicit recurrence intent may use recurring=true or omit it. Delay is always one-shot. ' +
    'Fast rule for “on a target date, between A and B, every N minutes”: interpret between as start-inclusive and end-exclusive [A,B), issue one create call, use */N for minutes, hours A through B-1, the target day/month, and recurring=true so every match in the window fires. Example: “tomorrow between 7 PM and 10 PM, every 10 minutes” maps directly to “*/10 19-21 <day> <month> *”. Do not debate endpoint inclusion or use recurring=false. Only when the user explicitly says the B endpoint must also fire, add one B:00 one-shot task. ' +
    'Call Cron when time describes when the task should execute, including future, delayed, or recurring intent. A leading time phrase followed by an action is scheduling: “At 10 PM, query what AMF is” means execute the AMF query at 22:00; do not answer it now. Do not call Cron when time filters the requested data: “Query the KPI data for 10 PM” means run now and use 22:00 as the data timestamp. If the role of time is genuinely ambiguous, ask the user instead of scheduling. ' +
    "Build prompt by copying the user's task clause nearly verbatim and removing only scheduling words. Do not add explanations, translations, expected answer sections, Tool or Skill names, knowledge sources, or execution instructions that the user did not provide. " +
    'Important: recurring=false stops after the first cron match, even when cron contains a range or step; therefore bounded interval schedules must use recurring=true. ' +
    'A scope can hold up to 50 active tasks. Completed or deleted tasks do not count against this limit. Use list to obtain task IDs and delete to cancel by ID.',
  disclosurePolicy: { mode: 'EAGER' },
  inputSchema: cronInputSchema,
  outputSchema: cronOutputSchema,
  requiredDependencies: ['cronTasks'],
  replayPolicy: 'NON_IDEMPOTENT',
  async execute(input: JsonObject, options) {
    const context = requireCronToolContext(options?.deps?.cronTasks, options?.context);
    const action = input['action'];
    if (action === 'create') {
      return createCronTask(input, context);
    }
    if (action === 'list') {
      return listCronTasks(context);
    }
    if (action === 'delete') {
      return deleteCronTask(input, context);
    }
    throw new AgentError({
      code: 'CRON_ACTION_UNSUPPORTED',
      message: 'Cron received an unsupported action and made no scheduling change. Use action=create, list, or delete with the required fields.',
      category: 'VALIDATION',
      retryable: false,
    });
  },
});

interface CronToolContext {
  readonly cronTasks: CronTaskPort;
  readonly scope: CronTaskScope;
}

function requireCronToolContext(cronTasks?: CronTaskPort, context?: ToolExecutionContext): CronToolContext {
  if (cronTasks === undefined || context === undefined) {
    throw new AgentError({
      code: cronTasks === undefined ? 'TOOL_DEPENDENCY_MISSING' : 'TOOL_CONTEXT_MISSING',
      message:
        'Cron could not start because its scheduling dependency or trusted execution context is unavailable. Stop this scheduling action and report the unavailable boundary.',
      category: cronTasks === undefined ? 'UNAVAILABLE' : 'INTERNAL',
      retryable: false,
    });
  }
  return {
    cronTasks,
    scope: cronScopeFromContext(context.identityContext, context.agentId, context.agentVersion, context.sessionId, context.runId),
  };
}

async function createCronTask(input: JsonObject, context: CronToolContext): Promise<JsonObject> {
  const prompt = String(input['prompt']);

  if (prompt.length > CRON_PROMPT_MAX_LENGTH) {
    throw new AgentError({
      code: 'CRON_PROMPT_TOO_LONG',
      message: `The Cron prompt exceeds the ${CRON_PROMPT_MAX_LENGTH}-character limit, so no task was created. Shorten the task prompt and call Cron again.`,
      category: 'VALIDATION',
      retryable: false,
    });
  }

  if (input['delay'] !== undefined) {
    const delay = input['delay'] as CronDelay;
    const id = await context.cronTasks.addTask({ scope: context.scope, delay, prompt, recurring: false });
    return { action: 'create', id, delay: { ...delay }, humanSchedule: delayToHuman(delay), recurring: false };
  }
  const cron = String(input['cron']);
  const recurring = input['recurring'] === undefined ? true : Boolean(input['recurring']);
  if (parseCronExpression(cron) === null) {
    throw new AgentError({
      code: 'CRON_INVALID_EXPRESSION',
      message: 'Cron expression is invalid. Provide a supported five-field expression (M H DoM Mon DoW) and call Cron again.',
      category: 'VALIDATION',
      retryable: false,
    });
  }

  const id = await context.cronTasks.addTask({ scope: context.scope, cron, prompt, recurring });
  return { action: 'create', id, humanSchedule: safeCronToHuman(cron), recurring };
}

function delayToHuman(delay: CronDelay): string {
  const parts = (['days', 'hours', 'minutes'] as const).flatMap((unit) => {
    const value = delay[unit] ?? 0;
    return value === 0 ? [] : [`${value} ${value === 1 ? unit.slice(0, -1) : unit}`];
  });
  return `Once after ${parts.join(' ')}`;
}

async function listCronTasks(context: CronToolContext): Promise<JsonObject> {
  const tasks = await context.cronTasks.listTasks({ scope: context.scope });
  const jobs = tasks.map((task) => ({
    id: task.id,
    cron: task.cron,
    humanSchedule: task.humanSchedule,
    prompt: task.prompt,
    recurring: task.recurring,
  }));
  return { action: 'list', jobs };
}

async function deleteCronTask(input: JsonObject, context: CronToolContext): Promise<JsonObject> {
  const id = String(input['id']);
  const task = await context.cronTasks.findTask({ scope: context.scope, id });
  if (task === undefined) {
    throw new AgentError({
      code: 'CRON_TASK_NOT_FOUND',
      message: 'The scheduled task was not found in the current scope. Run Cron with action=list to obtain a current task id before deleting.',
      category: 'NOT_FOUND',
      retryable: false,
    });
  }
  await context.cronTasks.removeTasks({ scope: context.scope, ids: [id] });
  return { action: 'delete', id };
}

function safeCronToHuman(cron: string): string {
  try {
    return cronToHuman(cron);
  } catch {
    return cron;
  }
}
