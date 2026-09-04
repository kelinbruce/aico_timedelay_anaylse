import type { JsonObject } from '@nextagent/agent-common';

export const cronExpressionMaxLength = 256;
export const cronPromptMaxLength = 10_000;
export const cronDelayMaxMinutes = 525_600;

const prompt = {
  type: 'string',
  minLength: 1,
  maxLength: cronPromptMaxLength,
  description:
    "Copy the user's task clause nearly verbatim. Remove only execution-time and recurrence wording already represented by cron or delay; retain times that filter the requested data. Do not paraphrase, translate terms, explain abbreviations, infer expected answer sections, or add unstated scope, output format, Tool or Skill names, knowledge sources, diagnostic steps, or execution instructions. Example: “Tomorrow at 9 AM, query what session success rate is” becomes “Query what session success rate is.” It must not become “Use a telecom Skill and provide the definition, formula, scenarios, and related KPIs.” Maximum 10,000 characters.",
};
const delay = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  description:
    'One-time elapsed duration from the trusted current time. Use for “in/after N minutes, hours, or days”, not for calendar wording such as “tomorrow at 09:00”. Values combine to 1..525600 total minutes; one day is exactly 24 hours.',
  properties: {
    days: { type: 'integer', minimum: 0, maximum: 365, description: 'Whole 24-hour days. Optional; minimum 0.' },
    hours: { type: 'integer', minimum: 0, maximum: 8_760, description: 'Whole elapsed hours. Optional; minimum 0.' },
    minutes: { type: 'integer', minimum: 0, maximum: cronDelayMaxMinutes, description: 'Whole elapsed minutes. Optional; minimum 0.' },
  },
};
const cron = {
  type: 'string',
  minLength: 1,
  maxLength: cronExpressionMaxLength,
  description:
    'Standard 5-field local-time expression: minute hour day-of-month month day-of-week. For a target-date interval “between A and B every N minutes”, default to [A,B) and immediately use one recurring expression: */N, hours A through B-1, target day, target month, *. Example: tomorrow 19:00-22:00 every 10 minutes becomes “*/10 19-21 <day> <month> *” with recurring=true. Supports numeric *, single values, comma lists, inclusive ranges, */N, and A-B/N; does not support names or L, W, ?, #. Day-of-week 0 and 7 both mean Sunday. If day-of-month and day-of-week are both restricted, either may match (OR).',
};
const recurring = {
  type: 'boolean',
  description:
    'Set false for one specific future calendar time when the user did not explicitly request repetition. Omit or set true only for explicit recurrence such as every N minutes, daily, or weekly. False executes only the first match; ranges and steps do not continue after that first firing.',
};
const id = { type: 'string', minLength: 1, description: 'Exact task ID returned by create or list.' };

export const cronInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { enum: ['create', 'list', 'delete'], description: 'Create, list, or delete a scheduled task.' },
    cron,
    delay,
    prompt,
    recurring,
    id,
  },
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'cron', 'prompt'],
      properties: {
        action: { const: 'create', description: 'Create a task using a local-time calendar or recurring cron schedule.' },
        cron,
        prompt,
        recurring,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'delay', 'prompt'],
      properties: {
        action: { const: 'create', description: 'Create a one-time task after an elapsed delay.' },
        delay,
        prompt,
        recurring: { const: false, description: 'Delay tasks are always one-shot. Omit this field or set it to false.' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { const: 'list', description: 'List scheduled tasks visible in the current trusted scope and obtain their IDs.' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'id'],
      properties: {
        action: { const: 'delete', description: 'Cancel one scheduled task in the current trusted scope.' },
        id,
      },
    },
  ],
};

export const cronOutputSchema: JsonObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'id', 'humanSchedule', 'recurring'],
      properties: {
        action: { const: 'create' },
        id: { type: 'string', minLength: 1 },
        humanSchedule: { type: 'string', minLength: 1 },
        recurring: { type: 'boolean' },
        delay,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'jobs'],
      properties: {
        action: { const: 'list' },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'cron', 'humanSchedule', 'prompt', 'recurring'],
            properties: {
              id: { type: 'string', minLength: 1 },
              cron: { type: 'string', minLength: 1 },
              humanSchedule: { type: 'string', minLength: 1 },
              prompt: { type: 'string', minLength: 1 },
              recurring: { type: 'boolean' },
            },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'id'],
      properties: {
        action: { const: 'delete' },
        id: { type: 'string', minLength: 1 },
      },
    },
  ],
};
