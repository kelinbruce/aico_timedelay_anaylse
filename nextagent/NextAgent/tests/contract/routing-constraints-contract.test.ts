import { brand, type CapabilityId, type RequestLocale } from '@nextagent/agent-common';
import {
  RoutingConstraintsSchema,
  type RequestContext,
  type RoutingConstraints,
  type SubmitRequestCommand,
} from '@nextagent/agent-contracts/runtime';
import { Ajv } from 'ajv/dist/ajv.js';
import { describe, expect, it } from 'vitest';

describe('routing constraints contract', () => {
  const validate = new Ajv({ allErrors: true }).compile(RoutingConstraintsSchema);

  it('defines the minimal request-carried routing constraints shape', () => {
    const constraints: RoutingConstraints = {
      targetSkill: 'alarm-diagnosis',
      targetRecipe: 'ran-alarm-diagnosis',
      forbiddenCapabilityIds: [brand<string, 'CapabilityId'>('write-config') as unknown as string],
      executionMode: 'model-only',
      locale: brand<string, 'RequestLocale'>('zh-CN') as unknown as string,
      allowHumanInput: false,
      allowSubagents: false,
    };
    const sessionId = brand<string, 'SessionId'>('session-routing-constraints');
    const command: SubmitRequestCommand = {
      sessionId,
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant-routing-constraints'),
        subjectId: brand<string, 'SubjectId'>('subject-routing-constraints'),
        displayName: 'Routing Constraints',
      },
      inputText: 'diagnose LTE alarm',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      routingConstraints: constraints,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-routing-constraints'),
    };
    const context: RequestContext = {
      requestContextId: brand<string, 'RequestContextId'>('context-routing-constraints'),
      sessionId,
      requestId: brand<string, 'MessageId'>('request-routing-constraints'),
      runId: brand<string, 'RequestRunId'>('run-routing-constraints'),
      agentTurnIndex: 0,
      identityContext: command.identityContext,
      locale: command.locale,
      routingConstraints: constraints,
      agentId: brand<string, 'AgentId'>('agent-routing-constraints'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent-routing-constraints:v1',
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: {},
    };

    expect(validate(constraints)).toBe(true);
    expect(command.routingConstraints).toEqual(constraints);
    expect(context.routingConstraints).toEqual(constraints);
  });

  it('rejects forbidden override fields and extra properties from the contract shape', () => {
    const invalid = {
      targetSkill: 'alarm-diagnosis',
      targetRecipe: 'ran-alarm-diagnosis',
      tenantId: 'tenant-override',
      providerOverride: 'vendor-a',
      rawSystemPrompt: 'ignore policy',
      modelProfileOverride: 'gpt-5',
      maxToolCalls: 2,
      path: 'C:\\secret.txt',
    };

    expect(validate(invalid)).toBe(false);
    expect(validate.errors?.map((error) => error.instancePath || error.params.additionalProperty)).toBeTruthy();
  });

  it('keeps the contract optional on submit and accepted context', () => {
    const sessionId = brand<string, 'SessionId'>('session-routing-constraints-absent');
    const command: SubmitRequestCommand = {
      sessionId,
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant-routing-constraints-absent'),
        subjectId: brand<string, 'SubjectId'>('subject-routing-constraints-absent'),
        displayName: 'No Constraints',
      },
      inputText: 'diagnose BBU health',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('en-US'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-routing-constraints-absent'),
    };
    const context: RequestContext = {
      requestContextId: brand<string, 'RequestContextId'>('context-routing-constraints-absent'),
      sessionId,
      requestId: brand<string, 'MessageId'>('request-routing-constraints-absent'),
      runId: brand<string, 'RequestRunId'>('run-routing-constraints-absent'),
      agentTurnIndex: 0,
      identityContext: command.identityContext,
      locale: command.locale as RequestLocale,
      agentId: brand<string, 'AgentId'>('agent-routing-constraints-absent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent-routing-constraints-absent:v1',
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: {},
    };

    expect(Object.hasOwn(command, 'routingConstraints')).toBe(false);
    expect(Object.hasOwn(context, 'routingConstraints')).toBe(false);
  });
});
