import { brand, type JsonObject, type RiskLevel, type RiskPolicyOutcome, type RestrictedOperationKind } from '@nextagent/agent-common';
import type { CapabilityInvocationRequest, CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type {
  AuthorizationScopeRecord,
  PendingInputRecord,
  SandboxExecutionRequest,
  SandboxExecutionResult,
} from '@nextagent/agent-contracts/gateway';
import type {
  RestrictedOperationSummary,
  RiskPolicyAuthorizationIntent,
  RiskPolicyDecision,
  RiskPolicyEvaluationInput,
  RiskPolicyEvaluator,
} from '@nextagent/agent-contracts/runtime';
import type { RiskPolicyEvaluation } from '@nextagent/agent-contracts/observability';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('risk policy contract refinement', () => {
  it('keeps shared vocabulary in agent-common owning and evaluator contracts in runtime owning', async () => {
    const outcome: RiskPolicyOutcome = 'ALLOW';
    const level: RiskLevel = 'HIGH';
    const kind: RestrictedOperationKind = 'CAPABILITY_INVOCATION';
    const operation: RestrictedOperationSummary = {
      operationId: 'op-1',
      operationKind: kind,
      capabilityId: brand<string, 'CapabilityId'>('Write'),
      capabilityKind: 'TOOL',
      providerId: 'builtin-tools',
      toolCallId: 'tool-call-1',
      replayPolicy: 'NON_IDEMPOTENT',
      riskLevel: level,
      targetOwnerScopeMatched: true,
      parametersSchemaValid: true,
      requiresSandbox: false,
      sandboxReady: true,
      observabilityReady: true,
    };
    const input: RiskPolicyEvaluationInput = {
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
    const intent: RiskPolicyAuthorizationIntent = {
      operationId: operation.operationId,
      operationKind: operation.operationKind,
      riskLevel: operation.riskLevel,
      prompt: 'Approve the requested operation?',
      approveLabel: 'Approve',
      denyLabel: 'Deny',
      ...(operation.capabilityId === undefined ? {} : { capabilityId: operation.capabilityId }),
      ...(operation.toolCallId === undefined ? {} : { toolCallId: operation.toolCallId }),
    };
    const decision: RiskPolicyDecision = {
      outcome,
      reasonCode: 'ALLOWED',
      authorizationIntent: intent,
    };
    const evaluator: RiskPolicyEvaluator = {
      async evaluate(candidate) {
        expect(candidate).toBe(input);
        return decision;
      },
    };
    const runtimeSource = await readFile(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'runtime', 'index.ts'), 'utf8');

    expect(outcome).toBe('ALLOW');
    expect(level).toBe('HIGH');
    expect(kind).toBe('CAPABILITY_INVOCATION');
    await expect(evaluator.evaluate(input)).resolves.toBe(decision);
    expect(runtimeSource).toContain('export interface RiskPolicyEvaluator');
  });

  it('keeps authorization scope bound to pending input gateway facts only', () => {
    const authorizationScope: AuthorizationScopeRecord = {
      operationKind: 'CAPABILITY_INVOCATION',
      operationId: 'op-2',
      capabilityId: 'Write',
      toolCallId: 'tool-call-2',
      riskLevel: 'CRITICAL',
    };
    const record: PendingInputRecord = {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      agentId: brand<string, 'AgentId'>('agent-1'),
      pendingInputId: brand<string, 'PendingInputId'>('pending-1'),
      requestRunId: brand<string, 'RequestRunId'>('run-1'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('request-1'),
      requestContextId: brand<string, 'RequestContextId'>('context-1'),
      checkpointId: brand<string, 'CheckpointId'>('checkpoint-1'),
      kind: 'AUTHORIZATION',
      request: {
        id: brand<string, 'PendingInputId'>('pending-1'),
        sessionId: brand<string, 'SessionId'>('session-1'),
        kind: 'AUTHORIZATION',
        questions: [
          {
            prompt: 'Approve?',
            options: [
              { label: 'Approve', value: 'approve' },
              { label: 'Deny', value: 'deny' },
            ],
          },
        ],
      },
      producerRef: { kind: 'LIFECYCLE_HOOK' },
      status: 'PENDING',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      authorizationScope,
    };

    expect(record.authorizationScope).toEqual(authorizationScope);
    expect('authorizationScope' in record.request).toBe(false);
  });

  it('keeps evaluation facts observability-owned and redacted', async () => {
    const fact: RiskPolicyEvaluation = {
      occurredAt: brand<number, 'EpochMillis'>(1),
      agentId: brand<string, 'AgentId'>('agent-1'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('request-1'),
      requestRunId: brand<string, 'RequestRunId'>('run-1'),
      requestContextId: brand<string, 'RequestContextId'>('context-1'),
      operationKind: 'SANDBOX_EXECUTION',
      operationId: 'sandbox-op-1',
      outcome: 'DEGRADED',
      riskLevel: 'MEDIUM',
      reasonCode: 'SANDBOX_UNAVAILABLE',
      providerId: 'builtin-tools',
      toolCallId: 'tool-call-3',
      sandboxRequired: true,
      sandboxReady: false,
      policyId: 'builtin-risk-policy',
      policyVersion: '1',
    };
    const observabilitySource = await readFile(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'observability', 'index.ts'), 'utf8');

    expect(fact.reasonCode).toBe('SANDBOX_UNAVAILABLE');
    expect(Object.keys(fact)).not.toContain('prompt');
    expect(Object.keys(fact)).not.toContain('arguments');
    expect(Object.keys(fact)).not.toContain('credentialRef');
    expect(Object.keys(fact)).not.toContain('physicalPath');
    expect(observabilitySource).toContain('export interface RiskPolicyEvaluation');
  });

  it('keeps execution contracts free of policy payloads and avoids a policy subpath', async () => {
    const capabilitySource = await readFile(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'capability', 'index.ts'), 'utf8');
    const gatewaySource = await readFile(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');
    const packageJson = await readFile(join(process.cwd(), 'packages', 'agent-contracts', 'package.json'), 'utf8');
    const invocationBlock = capabilitySource.slice(
      capabilitySource.indexOf('export interface CapabilityInvocationRequest'),
      capabilitySource.indexOf('export interface RuntimeCapabilityResolveRequest'),
    );
    const resultBlock = capabilitySource.slice(
      capabilitySource.indexOf('export interface CapabilityInvocationResult'),
      capabilitySource.indexOf('export interface CapabilityCatalogRequest'),
    );
    const sandboxBlock = gatewaySource.slice(
      gatewaySource.indexOf('export interface SandboxExecutionRequest'),
      gatewaySource.indexOf('export interface ScheduledMaintenanceOverlapPolicy'),
    );
    const invocation: CapabilityInvocationRequest = {
      invocationId: 'invoke-1',
      capabilityId: brand<string, 'CapabilityId'>('Read'),
      arguments: {} as JsonObject,
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('request-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      requestContextId: brand<string, 'RequestContextId'>('context-1'),
      stepId: 'turn-1',
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        displayName: 'tester',
      },
      agentId: brand<string, 'AgentId'>('agent-1'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      timeoutMs: 1_000,
    };
    const result: CapabilityInvocationResult = {
      status: 'SUCCEEDED',
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
    };
    const sandboxRequest: SandboxExecutionRequest = {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      executionId: 'sandbox-1',
      requestRunId: brand<string, 'RequestRunId'>('run-1'),
      executable: 'bash',
      command: 'ls',
      args: [],
      filesystem: { defaultCwd: 'workspace', roots: [] },
      environment: {},
      timeoutMs: 1_000,
      stdoutLimitBytes: 1,
      stderrLimitBytes: 1,
    };
    const sandboxResult: SandboxExecutionResult = {
      executionId: 'sandbox-1',
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      durationMs: 0,
    };

    expect(invocation.capabilityId).toBe('Read');
    expect(result.status).toBe('SUCCEEDED');
    expect(sandboxRequest.command).toBe('ls');
    expect(sandboxResult.executionId).toBe('sandbox-1');
    expect(invocationBlock).not.toContain('RiskPolicy');
    expect(invocationBlock).not.toContain('authorizationIntent');
    expect(resultBlock).not.toContain('RiskPolicy');
    expect(sandboxBlock).not.toContain('RiskPolicy');
    expect(sandboxBlock).not.toContain('authorizationIntent');
    expect(packageJson).toContain('"./observability"');
    expect(packageJson).not.toContain('"./policy"');
    expect(capabilitySource).not.toContain('interface PolicyPort');
  });
});
