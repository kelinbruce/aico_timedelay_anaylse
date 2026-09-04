import {
  createCapabilitySubsystem,
  createInMemoryCronTaskPort,
  cronCapabilityId,
  cronToolDefinition,
  parseCronExpression,
  type CronTaskPort,
} from '@nextagent/agent-capability';
import { brand, type AgentId, type JsonObject, type SessionId, type SubjectId, type TenantId } from '@nextagent/agent-common';
import type { CapabilityInvocationRequest } from '@nextagent/agent-contracts/capability';
import { describe, expect, it } from 'vitest';

describe('Cron tool', () => {
  it('declares eager disclosure so ToolSearch activation is not required', () => {
    expect(cronToolDefinition.metadata.disclosurePolicy).toEqual({ mode: 'EAGER' });
  });

  it('explains schedule selection, bounded windows, and lifecycle limits', () => {
    const description = cronToolDefinition.metadata.description;

    expect(description).toContain('create+delay');
    expect(description).toContain('recurring=false');
    expect(description).toContain('start-inclusive and end-exclusive [A,B)');
    expect(description).toContain('issue one create call');
    expect(description).toContain('*/10 19-21 <day> <month> *');
    expect(description).toContain('Do not debate endpoint inclusion');
    expect(description).toContain('bounded interval schedules must use recurring=true');
    expect(description).toContain('add one B:00 one-shot task');
    expect(description).toContain('At 10 PM, query what AMF is');
    expect(description).toContain('do not answer it now');
    expect(description).toContain('Query the KPI data for 10 PM');
    expect(description).toContain('one specific future time');
    expect(description).toContain('set recurring=false explicitly');
    expect(description).toContain('Only explicit recurrence intent');
    expect(description).toContain('ask the user instead of scheduling');
    expect(description).toContain("copying the user's task clause nearly verbatim");
    expect(description).toContain('Do not add explanations, translations');
    expect(description).toContain('recurring=false stops after the first cron match');
    expect(description).toContain('up to 50 active tasks');
    expect(description).toContain('Completed or deleted tasks do not count against this limit');
  });

  it('describes cron and delay parameters without changing their schema shapes', () => {
    const inputSchema = cronToolDefinition.metadata.inputSchema;
    const topLevelProperties = inputSchema['properties'] as JsonObject;
    const branches = inputSchema['oneOf'] as JsonObject[];
    const cronProperties = branches[0]?.['properties'] as JsonObject;
    const delayProperties = branches[1]?.['properties'] as JsonObject;
    const cronDescription = (cronProperties['cron'] as JsonObject)['description'];
    const delayDescription = (delayProperties['delay'] as JsonObject)['description'];
    const promptDescription = (cronProperties['prompt'] as JsonObject)['description'];

    expect(cronDescription).toContain('A-B/N');
    expect(cronDescription).toContain('default to [A,B)');
    expect(cronDescription).toContain('immediately use one recurring expression');
    expect(cronDescription).toContain('*/10 19-21 <day> <month> *');
    expect(cronDescription).toContain('does not support names or L, W, ?, #');
    expect(cronDescription).toContain('OR');
    expect(delayDescription).toContain('1..525600 total minutes');
    expect(delayDescription).toContain('not for calendar wording');
    expect(promptDescription).toContain("Copy the user's task clause nearly verbatim");
    expect(promptDescription).toContain('Remove only execution-time and recurrence wording');
    expect(promptDescription).toContain('retain times that filter the requested data');
    expect(promptDescription).toContain('Do not paraphrase, translate terms');
    expect(promptDescription).toContain('Tool or Skill names');
    expect(promptDescription).toContain('Query what session success rate is.');
    expect(promptDescription).toContain('It must not become');
    expect(Object.keys(topLevelProperties)).toEqual(['action', 'cron', 'delay', 'prompt', 'recurring', 'id']);
    const recurringDescription = (topLevelProperties['recurring'] as JsonObject)['description'];
    expect(recurringDescription).toContain('one specific future calendar time');
    expect(recurringDescription).toContain('only for explicit recurrence');
    expect(recurringDescription).toContain('only the first match');
  });

  it('parses the documented stepped ranges and bounded-window expressions', () => {
    expect(parseCronExpression('*/10 16-17 * * *')).toMatchObject({
      minute: [0, 10, 20, 30, 40, 50],
      hour: [16, 17],
    });
    expect(parseCronExpression('10-50/10 16 * * *')).toMatchObject({
      minute: [10, 20, 30, 40, 50],
      hour: [16],
    });
    expect(parseCronExpression('0 18 * * *')).not.toBeNull();
    expect(parseCronExpression('0 9 ? * MON')).toBeNull();
  });

  it('creates a recurring task and returns id + human schedule', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks: createInMemoryCronTaskPort() } });

    const result = await invoke(subsystem, { action: 'create', cron: '*/5 * * * *', prompt: 'Check AMF alarms' });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        action: 'create',
        humanSchedule: 'Every 5 minutes',
        recurring: true,
      },
    });
    expect(typeof (result as unknown as { structuredPayload: { id: string } }).structuredPayload.id).toBe('string');
  });

  it('creates a one-shot task when recurring is false', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks: createInMemoryCronTaskPort() } });

    const result = await invoke(subsystem, { action: 'create', cron: '30 14 28 2 *', prompt: 'Remind me', recurring: false });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { action: 'create', recurring: false },
    });
  });

  it('creates a structured-delay one-shot without sandbox or unit conversion', async () => {
    const subsystem = createCapabilitySubsystem({
      toolDependencies: { cronTasks: createInMemoryCronTaskPort({ now: () => new Date(2026, 6, 22, 23, 55, 30).getTime() }) },
    });
    await expect(invoke(subsystem, { action: 'create', delay: { hours: 1, minutes: 10 }, prompt: 'Recheck alarms' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { action: 'create', delay: { hours: 1, minutes: 10 }, humanSchedule: 'Once after 1 hour 10 minutes', recurring: false },
    });
  });

  it.each([
    { action: 'create', prompt: 'missing' },
    { action: 'create', cron: '* * * * *', delay: { minutes: 10 }, prompt: 'conflict' },
    { action: 'create', delay: { minutes: 10 }, prompt: 'recurring', recurring: true },
    { action: 'create', delay: { minutes: -1 }, prompt: 'negative' },
    { action: 'create', delay: { hours: 1.5 }, prompt: 'fraction' },
    { action: 'create', delay: { seconds: 1 }, prompt: 'unknown' },
  ])('rejects invalid structured delay %#', async (input) => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks: createInMemoryCronTaskPort() } });
    await expect(invoke(subsystem, input)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
    });
  });

  it('reports only the selected delete-branch diagnostics for an unknown field', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks: createInMemoryCronTaskPort() } });

    const result = await invoke(subsystem, { action: 'delete', id: 'x', unknownField: 1 });

    expect(result).toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' } });
    const serialized = JSON.stringify(result.safeError);
    const violations = result.safeError?.safeDetails?.violations as
      Array<{ readonly path: string; readonly constraint: string; readonly expected: string }> | undefined;
    expect(violations).toBeDefined();
    const additionalProperty = violations?.find((violation) => violation.constraint === 'additionalProperties');
    expect(additionalProperty).toBeDefined();
    expect(additionalProperty?.expected).toContain('"action"');
    expect(additionalProperty?.expected).toContain('"id"');
    expect(additionalProperty?.expected).not.toContain('"cron"');
    expect(additionalProperty?.expected).not.toContain('"delay"');
    expect(additionalProperty?.expected).not.toContain('"prompt"');
    expect(serialized).not.toContain('must contain at least 1 character');
    // No const or aggregate oneOf errors from the unselected create branches.
    expect(violations?.some((violation) => violation.constraint === 'const')).toBe(false);
    expect(violations?.some((violation) => violation.constraint === 'oneOf')).toBe(false);
  });

  it('does not guess a oneOf branch when create branches share the same discriminator', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks: createInMemoryCronTaskPort() } });

    const result = await invoke(subsystem, { action: 'create', delay: { minutes: 5 }, prompt: 'x', unknownField: 1 });

    expect(result).toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' } });
    const violations = result.safeError?.safeDetails?.violations as
      Array<{ readonly path: string; readonly constraint: string; readonly expected: string }> | undefined;
    expect(violations).toBeDefined();
    const additionalProperty = violations?.find((violation) => violation.constraint === 'additionalProperties');
    expect(additionalProperty).toBeDefined();
    expect(additionalProperty?.expected).toContain('"action"');
    expect(additionalProperty?.expected).toContain('"cron"');
    expect(additionalProperty?.expected).toContain('"delay"');
    expect(additionalProperty?.expected).toContain('"prompt"');
    // Ambiguous branches expose the aggregate failure without branch-local guesses.
    expect(violations?.some((violation) => violation.constraint === 'required' && violation.path === '/cron')).toBe(false);
    expect(violations?.some((violation) => violation.constraint === 'oneOf')).toBe(true);
  });

  it('reports only the aggregate oneOf failure when the create branch is ambiguous', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks: createInMemoryCronTaskPort() } });

    const result = await invoke(subsystem, { action: 'create', delay: { minutes: 5 }, prompt: 'check alarms', recurring: true });

    expect(result).toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' } });
    const violations = result.safeError?.safeDetails?.violations as Array<{ readonly path: string; readonly constraint: string }> | undefined;
    expect(violations).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: '/recurring', constraint: 'const' })]));
    expect(violations).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: '/cron', constraint: 'required' })]));
    expect(violations).toEqual(expect.arrayContaining([expect.objectContaining({ constraint: 'oneOf' })]));
  });

  it('rejects invalid cron expressions on create', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks: createInMemoryCronTaskPort() } });

    await expect(invoke(subsystem, { action: 'create', cron: 'not a cron', prompt: 'test' })).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CRON_INVALID_EXPRESSION', category: 'VALIDATION' },
    });
    await expect(invoke(subsystem, { action: 'create', cron: '* * *', prompt: 'test' })).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CRON_INVALID_EXPRESSION' },
    });
    const canary = 'PRIVATE_CRON_CANARY';
    const result = await invoke(subsystem, { action: 'create', cron: canary, prompt: 'test' });
    expect(result.safeError?.message).toContain('five-field expression');
    expect(JSON.stringify(result.safeError)).not.toContain(canary);
  });

  it('rejects invalid action-shaped input before execution', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks: createInMemoryCronTaskPort() } });

    await expect(invoke(subsystem, { action: 'create', cron: '0 9 * * *', prompt: '' })).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
    });
    await expect(invoke(subsystem, { action: 'create', cron: '0 9 * * *', prompt: 'test', tenantId: 'evil' })).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
    });
    await expect(invoke(subsystem, { action: 'list', tenantId: 'evil' })).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
    });
    await expect(invoke(subsystem, { action: 'delete', id: 'deadbeef', subjectId: 'evil' })).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
    });
  });

  it('lists created tasks in scope', async () => {
    const cronTasks = createInMemoryCronTaskPort();
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks } });

    await invoke(subsystem, { action: 'create', cron: '0 9 * * *', prompt: 'Daily morning check' });
    await invoke(subsystem, { action: 'create', cron: '*/15 * * * *', prompt: 'One-time KPI scan', recurring: false });

    const listResult = await invoke(subsystem, { action: 'list' });

    expect(listResult).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { action: 'list' } });
    const jobs = (listResult as unknown as { structuredPayload: { jobs: JsonObject[] } }).structuredPayload.jobs;
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ cron: '0 9 * * *', prompt: 'Daily morning check', recurring: true });
    expect(jobs[1]).toMatchObject({ cron: '*/15 * * * *', prompt: 'One-time KPI scan', recurring: false });
  });

  it('returns empty jobs when no tasks exist', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks: createInMemoryCronTaskPort() } });

    const result = await invoke(subsystem, { action: 'list' });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { action: 'list', jobs: [] },
    });
  });

  it('deletes a task by id', async () => {
    const cronTasks = createInMemoryCronTaskPort();
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks } });

    const createResult = await invoke(subsystem, { action: 'create', cron: '0 * * * *', prompt: 'Hourly' });
    const id = (createResult as unknown as { structuredPayload: { id: string } }).structuredPayload.id;

    const deleteResult = await invoke(subsystem, { action: 'delete', id });
    expect(deleteResult).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { action: 'delete', id } });

    const listResult = await invoke(subsystem, { action: 'list' });
    expect((listResult as unknown as { structuredPayload: { jobs: unknown[] } }).structuredPayload.jobs).toHaveLength(0);
  });

  it('fails delete for non-existent id', async () => {
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks: createInMemoryCronTaskPort() } });

    const result = await invoke(subsystem, { action: 'delete', id: 'deadbeef' });
    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CRON_TASK_NOT_FOUND',
        category: 'NOT_FOUND',
        message: expect.stringContaining('action=list'),
      },
    });
    expect(JSON.stringify(result.safeError)).not.toContain('deadbeef');
  });

  it('isolates tasks by owner + agent scope while keeping them visible across sessions', async () => {
    const cronTasks = createInMemoryCronTaskPort();
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks } });

    await invoke(subsystem, { action: 'create', cron: '0 9 * * *', prompt: 'Agent A task' });
    await invoke(subsystem, { action: 'create', cron: '0 10 * * *', prompt: 'Agent B task' }, { agentId: brand<string, 'AgentId'>('agent-b') });

    const listA = await invoke(subsystem, { action: 'list' });
    expect((listA as unknown as { structuredPayload: { jobs: unknown[] } }).structuredPayload.jobs).toHaveLength(1);

    const listB = await invoke(subsystem, { action: 'list' }, { agentId: brand<string, 'AgentId'>('agent-b') });
    expect((listB as unknown as { structuredPayload: { jobs: unknown[] } }).structuredPayload.jobs).toHaveLength(1);

    const listC = await invoke(subsystem, { action: 'list' }, { tenantId: brand<string, 'TenantId'>('other-tenant') });
    expect((listC as unknown as { structuredPayload: { jobs: unknown[] } }).structuredPayload.jobs).toHaveLength(0);

    const listD = await invoke(subsystem, { action: 'list' }, { subjectId: brand<string, 'SubjectId'>('other-subject') });
    expect((listD as unknown as { structuredPayload: { jobs: unknown[] } }).structuredPayload.jobs).toHaveLength(0);

    const listE = await invoke(subsystem, { action: 'list' }, { sessionId: brand<string, 'SessionId'>('other-session') });
    expect((listE as unknown as { structuredPayload: { jobs: unknown[] } }).structuredPayload.jobs).toHaveLength(1);
  });

  it('cannot delete a task owned by another agent scope', async () => {
    const cronTasks = createInMemoryCronTaskPort();
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks } });

    const createResult = await invoke(subsystem, { action: 'create', cron: '0 9 * * *', prompt: 'Agent A task' });
    const id = (createResult as unknown as { structuredPayload: { id: string } }).structuredPayload.id;

    await expect(invoke(subsystem, { action: 'delete', id }, { agentId: brand<string, 'AgentId'>('agent-b') })).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CRON_TASK_NOT_FOUND', category: 'NOT_FOUND' },
    });
  });

  it('cannot delete a task owned by another owner scope', async () => {
    const cronTasks = createInMemoryCronTaskPort();
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks } });

    const createResult = await invoke(subsystem, { action: 'create', cron: '0 9 * * *', prompt: 'Scoped task' });
    const id = (createResult as unknown as { structuredPayload: { id: string } }).structuredPayload.id;

    for (const overrides of [{ tenantId: brand<string, 'TenantId'>('other-tenant') }, { subjectId: brand<string, 'SubjectId'>('other-subject') }]) {
      await expect(invoke(subsystem, { action: 'delete', id }, overrides)).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CRON_TASK_NOT_FOUND', category: 'NOT_FOUND' },
      });
    }

    await expect(invoke(subsystem, { action: 'list' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { action: 'list', jobs: [expect.objectContaining({ id })] },
    });
  });

  it('rejects missing dependency safely', async () => {
    await expect(
      createCapabilitySubsystem().invocationPort.invoke(
        request({ action: 'create', cron: '0 9 * * *', prompt: 'test' }),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_UNAVAILABLE', category: 'UNAVAILABLE' },
    });
  });

  it('enforces max tasks per scope', async () => {
    const cronTasks: CronTaskPort = createInMemoryCronTaskPort();
    const subsystem = createCapabilitySubsystem({ toolDependencies: { cronTasks } });

    for (let i = 0; i < 50; i++) {
      await invoke(subsystem, { action: 'create', cron: '0 9 * * *', prompt: `task-${i}` });
    }

    const overflow = await invoke(subsystem, { action: 'create', cron: '0 10 * * *', prompt: 'overflow' });
    expect(overflow).toMatchObject({ status: 'FAILED' });
  });
});

async function invoke(subsystem: ReturnType<typeof createCapabilitySubsystem>, args: JsonObject, overrides: InvocationOverrides = {}) {
  return subsystem.invocationPort.invoke(request(args, overrides), new AbortController().signal);
}

function request(args: JsonObject, overrides: InvocationOverrides = {}): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-cron',
    capabilityId: cronCapabilityId,
    arguments: args,
    sessionId: overrides.sessionId ?? sessionId(),
    requestId: brand<string, 'MessageId'>('request-cron'),
    runId: brand<string, 'RequestRunId'>('run-cron'),
    requestContextId: brand<string, 'RequestContextId'>('context-cron'),
    stepId: 'turn-1',
    toolCallId: 'tool-cron',
    identityContext: {
      tenantId: overrides.tenantId ?? tenantId(),
      subjectId: overrides.subjectId ?? subjectId(),
      displayName: 'Cron tester',
    },
    agentId: overrides.agentId ?? agentId(),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cron'),
  };
}

interface InvocationOverrides {
  readonly agentId?: AgentId;
  readonly tenantId?: TenantId;
  readonly subjectId?: SubjectId;
  readonly sessionId?: SessionId;
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-cron');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-cron');
}

function agentId() {
  return brand<string, 'AgentId'>('default-agent');
}

function sessionId() {
  return brand<string, 'SessionId'>('session-cron');
}
