import { readToolDefinition } from '@nextagent/agent-capability';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityDescriptor, CapabilityInvocationRequest, CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';

export function readDescriptor(
  provider: CapabilityProviderIdentity = { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
): CapabilityDescriptor {
  return toolDescriptor({
    capabilityId: 'Read',
    provider,
    inputSchema: readToolDefinition.metadata.inputSchema,
    outputSchema: readToolDefinition.metadata.outputSchema,
    description: readToolDefinition.metadata.description,
    replayPolicy: 'IDEMPOTENT',
  });
}

export function toolDescriptor(input: {
  readonly capabilityId: string;
  readonly provider: CapabilityProviderIdentity;
  readonly inputSchema?: JsonObject;
  readonly outputSchema?: JsonObject;
  readonly description?: string;
  readonly availabilityStatus?: CapabilityDescriptor['availabilityStatus'];
  readonly replayPolicy?: CapabilityDescriptor['replayPolicy'];
}): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(input.capabilityId),
    kind: 'TOOL',
    provider: input.provider,
    version: '1',
    displayName: input.capabilityId,
    description: input.description ?? 'Test capability.',
    modelInvocable: true,
    availabilityStatus: input.availabilityStatus ?? 'AVAILABLE',
    ...(input.inputSchema === undefined ? {} : { inputSchema: input.inputSchema }),
    ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
    replayPolicy: input.replayPolicy ?? 'NON_IDEMPOTENT',
  };
}

export function capabilityRequest(argumentsValue: CapabilityInvocationRequest['arguments'], capabilityId = 'Read'): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-test',
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    arguments: argumentsValue,
    sessionId: brand<string, 'SessionId'>('session-test'),
    requestId: brand<string, 'MessageId'>('request-test'),
    runId: brand<string, 'RequestRunId'>('run-test'),
    requestContextId: brand<string, 'RequestContextId'>('context-test'),
    stepId: 'turn-1',
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-test'),
      subjectId: brand<string, 'SubjectId'>('subject-test'),
      displayName: 'Capability tester',
    },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-test'),
  };
}
