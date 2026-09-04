import { brand, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import { describe, expect, it } from 'vitest';
import {
  createBuiltInRiskPolicyEvaluator,
  summarizeCapabilityOperation,
  summarizeSandboxOperation,
  toRiskPolicyEvaluation,
} from '@nextagent/agent-core';

describe('built-in risk policy evaluator', () => {
  it('denies unavailable capability invocations before risk classification', async () => {
    const evaluator = createBuiltInRiskPolicyEvaluator({ authorizationSupported: false });
    const operation = summarizeCapabilityOperation({
      descriptor: capability('read'),
      toolCallId: 'tool-missing',
      arguments: {} as JsonObject,
      sandboxReady: true,
    });

    await expect(
      evaluator.evaluate({
        ...baseInput(operation),
        capabilityAvailable: false,
      }),
    ).resolves.toEqual({
      outcome: 'DENY',
      reasonCode: 'CAPABILITY_UNAVAILABLE',
    });
  });

  it('denies capability invocations that carry forged owner scope fields', async () => {
    const evaluator = createBuiltInRiskPolicyEvaluator({ authorizationSupported: false });
    const descriptor = capability('read');
    const operation = summarizeCapabilityOperation({
      descriptor,
      toolCallId: 'tool-1',
      arguments: { tenantId: 'forged' } as JsonObject,
      sandboxReady: true,
    });

    await expect(evaluator.evaluate(baseInput(operation))).resolves.toEqual({
      outcome: 'DENY',
      reasonCode: 'OWNER_SCOPE_MISMATCH',
    });
  });

  it('allows target agentId capability arguments while still rejecting runtime scope overrides', async () => {
    const evaluator = createBuiltInRiskPolicyEvaluator({ authorizationSupported: false });
    const descriptor = capability('Agent');
    const allowedOperation = summarizeCapabilityOperation({
      descriptor,
      toolCallId: 'tool-agent',
      arguments: { agentId: 'network-explorer', prompt: 'check active alarms' } as JsonObject,
      sandboxReady: true,
    });
    const deniedOperation = summarizeCapabilityOperation({
      descriptor,
      toolCallId: 'tool-agent-forged',
      arguments: { agentId: 'network-explorer', prompt: 'check active alarms', sessionId: 'forged' } as JsonObject,
      sandboxReady: true,
    });

    await expect(evaluator.evaluate(baseInput(allowedOperation))).resolves.toEqual({
      outcome: 'ALLOW',
      reasonCode: 'ALLOWED',
    });
    await expect(evaluator.evaluate(baseInput(deniedOperation))).resolves.toEqual({
      outcome: 'DENY',
      reasonCode: 'OWNER_SCOPE_MISMATCH',
    });
  });

  it('degrades dynamic execution when the sandbox boundary is unavailable', async () => {
    const evaluator = createBuiltInRiskPolicyEvaluator({ authorizationSupported: false });
    const operation = summarizeSandboxOperation({
      executable: 'python',
      command: "print('hi')",
      args: [],
      sandboxReady: false,
    });

    await expect(evaluator.evaluate(baseInput(operation))).resolves.toEqual({
      outcome: 'DEGRADED',
      reasonCode: 'SANDBOX_UNAVAILABLE',
    });
  });

  it('does not degrade the parent capability invocation before sandbox execution is evaluated', async () => {
    const evaluator = createBuiltInRiskPolicyEvaluator({ authorizationSupported: false });
    const operation = summarizeCapabilityOperation({
      descriptor: capability('python'),
      toolCallId: 'tool-python',
      arguments: {} as JsonObject,
      sandboxReady: false,
    });

    await expect(evaluator.evaluate(baseInput(operation))).resolves.toEqual({
      outcome: 'ALLOW',
      reasonCode: 'ALLOWED',
    });
  });

  it('degrades when safe policy observability cannot be formed', async () => {
    const evaluator = createBuiltInRiskPolicyEvaluator({ authorizationSupported: false });
    const operation = summarizeCapabilityOperation({
      descriptor: capability('read'),
      toolCallId: 'tool-obs',
      arguments: {} as JsonObject,
      sandboxReady: true,
      observabilityReady: false,
    });

    await expect(evaluator.evaluate(baseInput(operation))).resolves.toEqual({
      outcome: 'DEGRADED',
      reasonCode: 'RISK_POLICY_OBSERVABILITY_UNAVAILABLE',
    });
  });

  it('denies replay of a non-idempotent capability before execution resumes', async () => {
    const evaluator = createBuiltInRiskPolicyEvaluator({ authorizationSupported: true });
    const operation = summarizeCapabilityOperation({
      descriptor: capability('write'),
      toolCallId: 'tool-replay',
      arguments: { file_path: 'workspace/config.txt' },
      sandboxReady: true,
      replayAttempt: true,
    });

    await expect(evaluator.evaluate(baseInput(operation))).resolves.toEqual({
      outcome: 'DENY',
      reasonCode: 'RECOVERY_UNSAFE_CAPABILITY_REPLAY',
    });
  });

  it('classifies sandbox execution as medium-risk instead of high-risk', async () => {
    const evaluator = createBuiltInRiskPolicyEvaluator({ authorizationSupported: true });
    const operation = summarizeSandboxOperation({
      executable: 'python',
      command: 'snippet.py',
      args: ['snippet.py'],
      sandboxReady: true,
    });

    expect(operation.riskLevel).toBe('MEDIUM');
    await expect(evaluator.evaluate(baseInput(operation))).resolves.toMatchObject({
      outcome: 'ALLOW',
      reasonCode: 'ALLOWED',
    });
  });

  it('classifies builtin tool invocations as medium-risk and does not require authorization', async () => {
    const evaluator = createBuiltInRiskPolicyEvaluator({ authorizationSupported: true });
    const operation = summarizeCapabilityOperation({
      descriptor: capability('write'),
      toolCallId: 'tool-write',
      arguments: { file_path: 'workspace/config.txt', content: 'hello' } as JsonObject,
      sandboxReady: true,
    });

    expect(operation.riskLevel).toBe('MEDIUM');
    await expect(evaluator.evaluate(baseInput(operation))).resolves.toMatchObject({
      outcome: 'ALLOW',
      reasonCode: 'ALLOWED',
    });
  });

  it('produces a redacted observability fact from the policy input and outcome', () => {
    const operation = summarizeCapabilityOperation({
      descriptor: capability('write'),
      toolCallId: 'tool-2',
      arguments: { file_path: 'workspace/config.txt' },
      sandboxReady: true,
    });
    const fact = toRiskPolicyEvaluation(baseInput(operation), {
      outcome: 'ALLOW',
      reasonCode: 'ALLOWED',
    });

    expect(fact).toMatchObject({
      operationKind: 'CAPABILITY_INVOCATION',
      operationId: 'write:tool-2',
      outcome: 'ALLOW',
      riskLevel: 'MEDIUM',
      capabilityId: 'write',
    });
    expect(Object.keys(fact)).not.toContain('arguments');
    expect(Object.keys(fact)).not.toContain('prompt');
  });
});

function baseInput(operation: ReturnType<typeof summarizeCapabilityOperation> | ReturnType<typeof summarizeSandboxOperation>) {
  return {
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    requestRunId: brand<string, 'RequestRunId'>('run-1'),
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'tester',
    },
    agentId: brand<string, 'AgentId'>('agent-1'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    operation,
    capabilityAvailable: true,
    capabilityEnabled: true,
    policyId: 'builtin-risk-policy',
    policyVersion: '1',
  };
}

function capability(capabilityId: string): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: capabilityId,
    description: capabilityId,
    availabilityStatus: 'AVAILABLE',
    replayPolicy: capabilityId === 'read' ? 'IDEMPOTENT' : 'NON_IDEMPOTENT',
  };
}
