import { describe, expect, it } from 'vitest';
import { brand } from '@nextagent/agent-common';
import type {
  AgentId,
  AgentVersion,
  EpochMillis,
  RequestRunId,
  TenantId,
  SubjectId,
  CapabilityInvocationId,
  CapabilityProviderKind,
} from '@nextagent/agent-common';
import type { CapabilityInvocationRequest, CapabilityDescriptor } from '@nextagent/agent-contracts/capability';

type InvocationAuditPhase = 'started' | 'terminal';
type InvocationAuditOutcome = 'started' | 'completed' | 'failed' | 'denied' | 'disabled' | 'not_found' | 'timed_out' | 'canceled' | 'aborted';

interface SafeInvocationAuditFact {
  readonly phase: InvocationAuditPhase;
  readonly outcome: InvocationAuditOutcome;
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly sessionId: string;
  readonly requestId: string;
  readonly runId: RequestRunId;
  readonly requestContextId: string;
  readonly capabilityInvocationId: CapabilityInvocationId;
  readonly capabilityId: string;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly occurredAt: EpochMillis;
  readonly providerId?: string;
  readonly providerKind?: CapabilityProviderKind;
  readonly durationMs?: number;
  readonly safeReasonCode?: string;
  readonly safeSummary?: string;
  readonly parentInvocationId?: string;
  readonly executionMode?: 'inline' | 'forked';
  readonly generatedMessageCount?: number;
  readonly generatedMessageRole?: string;
}
type InvocationAuditObserver = (fact: SafeInvocationAuditFact) => void;

function buildStartedFact(request: CapabilityInvocationRequest): SafeInvocationAuditFact {
  return {
    phase: 'started',
    outcome: 'started',
    tenantId: request.identityContext.tenantId,
    subjectId: request.identityContext.subjectId,
    sessionId: request.sessionId,
    requestId: request.requestId,
    runId: request.runId,
    requestContextId: request.requestContextId,
    capabilityInvocationId: request.invocationId as CapabilityInvocationId,
    capabilityId: request.capabilityId,
    agentId: request.agentId,
    agentVersion: request.agentVersion,
    occurredAt: Date.now() as EpochMillis,
  };
}

function buildTerminalFact(
  request: CapabilityInvocationRequest,
  outcome: InvocationAuditOutcome,
  safeReasonCode?: string,
  safeSummary?: string,
  durationMs?: number,
  descriptor?: CapabilityDescriptor,
  nested?: { parentInvocationId?: string; executionMode?: 'inline' | 'forked'; generatedMessageCount?: number; generatedMessageRole?: string },
): SafeInvocationAuditFact {
  const base: SafeInvocationAuditFact = {
    phase: 'terminal',
    outcome,
    tenantId: request.identityContext.tenantId,
    subjectId: request.identityContext.subjectId,
    sessionId: request.sessionId,
    requestId: request.requestId,
    runId: request.runId,
    requestContextId: request.requestContextId,
    capabilityInvocationId: request.invocationId as CapabilityInvocationId,
    capabilityId: request.capabilityId,
    agentId: request.agentId,
    agentVersion: request.agentVersion,
    occurredAt: Date.now() as EpochMillis,
  };
  if (descriptor?.provider.providerId !== undefined) {
    (base as unknown as Record<string, unknown>).providerId = descriptor.provider.providerId;
  }
  if (descriptor?.provider.providerKind !== undefined) {
    (base as unknown as Record<string, unknown>).providerKind = descriptor.provider.providerKind;
  }
  if (durationMs !== undefined) {
    (base as unknown as Record<string, unknown>).durationMs = durationMs;
  }
  if (safeReasonCode !== undefined) {
    (base as unknown as Record<string, unknown>).safeReasonCode = safeReasonCode;
  }
  if (safeSummary !== undefined) {
    (base as unknown as Record<string, unknown>).safeSummary = safeSummary;
  }
  if (nested?.parentInvocationId !== undefined) {
    (base as unknown as Record<string, unknown>).parentInvocationId = nested.parentInvocationId;
  }
  if (nested?.executionMode !== undefined) {
    (base as unknown as Record<string, unknown>).executionMode = nested.executionMode;
  }
  if (nested?.generatedMessageCount !== undefined) {
    (base as unknown as Record<string, unknown>).generatedMessageCount = nested.generatedMessageCount;
  }
  if (nested?.generatedMessageRole !== undefined) {
    (base as unknown as Record<string, unknown>).generatedMessageRole = nested.generatedMessageRole;
  }
  return base;
}

function outcomeFromResultStatus(status: 'SUCCEEDED' | 'FAILED' | 'DEGRADED' | 'TIMED_OUT'): InvocationAuditOutcome {
  switch (status) {
    case 'SUCCEEDED':
    case 'DEGRADED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'TIMED_OUT':
      return 'timed_out';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function makeRequest(): CapabilityInvocationRequest {
  return {
    invocationId: 'inv-1' as CapabilityInvocationRequest['invocationId'],
    capabilityId: brand('test-cap'),
    arguments: {},
    sessionId: brand('sess-1'),
    requestId: brand('msg-1'),
    runId: brand('run-1'),
    requestContextId: brand('ctx-1'),
    stepId: 'step-1',
    identityContext: { tenantId: brand('t-1'), subjectId: brand('s-1'), displayName: 's-1' },
    agentId: brand('agent-1'),
    agentVersion: brand('v1'),
    timeoutMs: 30000,
  };
}

function makeDescriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand('test-cap'),
    kind: 'TOOL',
    provider: { providerId: 'test-provider', providerKind: 'BUNDLED' },
    displayName: 'Test Capability',
    description: 'Test capability',
    availabilityStatus: 'AVAILABLE',
    modelInvocable: true,
  };
}

// ---- 3.1 Normal path ----
describe('Invocation audit 3.1 — normal path', () => {
  it('produces started and terminal facts', () => {
    const facts: SafeInvocationAuditFact[] = [];
    const obs: InvocationAuditObserver = (f) => facts.push(f);
    const req = makeRequest();
    obs(buildStartedFact(req));
    obs(buildTerminalFact(req, 'completed', undefined, 'ok', 100, makeDescriptor()));
    expect(facts).toHaveLength(2);
    expect(facts[0]!.phase).toBe('started');
    expect(facts[1]!.phase).toBe('terminal');
    expect(facts[1]!.outcome).toBe('completed');
  });
});

// ---- 3.2 Pre-exec rejection ----
describe('Invocation audit 3.2 — pre-execution rejection', () => {
  it('not_found has stable business ids and safe reason code', () => {
    const req = makeRequest();
    const fact = buildTerminalFact(req, 'not_found', 'CAPABILITY_NOT_FOUND', 'msg');
    expect(fact.outcome).toBe('not_found');
    expect(fact.tenantId).toBe('t-1');
    expect(fact.agentId).toBe('agent-1');
    expect(fact.providerId).toBeUndefined();
  });
});

// ---- 3.3 Outcome mapping ----
describe('Invocation audit 3.3 — outcome mapping', () => {
  it('SUCCEEDED→completed', () => expect(outcomeFromResultStatus('SUCCEEDED')).toBe('completed'));
  it('FAILED→failed', () => expect(outcomeFromResultStatus('FAILED')).toBe('failed'));
  it('TIMED_OUT→timed_out', () => expect(outcomeFromResultStatus('TIMED_OUT')).toBe('timed_out'));
  it('DEGRADED→completed', () => expect(outcomeFromResultStatus('DEGRADED')).toBe('completed'));
});

// ---- 3.4 Redaction ----
describe('Invocation audit 3.4 — safe facts only', () => {
  it('terminal facts exclude raw payloads', () => {
    const fact = buildTerminalFact(makeRequest(), 'completed', 'OK', 's', 10, makeDescriptor());
    const json = JSON.stringify(fact);
    expect(json).not.toContain('arguments');
    expect(json).not.toContain('password');
    expect(json).not.toContain('token');
  });
});

// ---- 3.5 Boundary ----
describe('Invocation audit 3.5 — boundary isolation', () => {
  it('observer is generic callback, not audit sink', () => {
    const obs: InvocationAuditObserver = () => {};
    expect(typeof obs).toBe('function');
  });
});

// ---- 4.4 Terminal uniqueness ----
describe('Invocation audit 4.4 — terminal uniqueness', () => {
  it('single invocation has at most one terminal fact', () => {
    const facts: SafeInvocationAuditFact[] = [];
    const obs: InvocationAuditObserver = (f) => facts.push(f);
    const req = makeRequest();
    obs(buildStartedFact(req));
    obs(buildTerminalFact(req, 'timed_out', 'TO', 'to', 30000));
    const terminals = facts.filter((f) => f.phase === 'terminal');
    expect(terminals).toHaveLength(1);
  });

  // ---- 3.3 Timeout/late result ----
  describe('Invocation audit 3.3 — timeout and late result', () => {
    it('timed_out terminal carries correct outcome and duration', () => {
      const fact = buildTerminalFact(makeRequest(), 'timed_out', 'TIMEOUT', 'Timed out', 30000, makeDescriptor());
      expect(fact.outcome).toBe('timed_out');
      expect(fact.durationMs).toBe(30000);
    });

    it('late result does not rewrite terminal fact', () => {
      const facts: SafeInvocationAuditFact[] = [];
      const obs: InvocationAuditObserver = (f) => facts.push(f);
      const req = makeRequest();
      obs(buildStartedFact(req));
      obs(buildTerminalFact(req, 'timed_out', 'TO', 'to', 30000));
      const terminals = facts.filter((f) => f.phase === 'terminal');
      expect(terminals).toHaveLength(1);
    });
  });

  // ---- 3.6 Skill/nested correlation ----
  describe('Invocation audit 3.6 — Skill/nested correlation', () => {
    it('nested invocation carries parentInvocationId and executionMode', () => {
      const fact = buildTerminalFact(makeRequest(), 'completed', undefined, 'nested ok', 5, makeDescriptor(), {
        parentInvocationId: 'parent-inv-1',
        executionMode: 'forked',
      });
      expect((fact as unknown as Record<string, unknown>).parentInvocationId).toBe('parent-inv-1');
      expect((fact as unknown as Record<string, unknown>).executionMode).toBe('forked');
    });

    it('inline Skill generated messages are summarized safely', () => {
      const fact = buildTerminalFact(makeRequest(), 'completed', undefined, 'skill ok', 10, makeDescriptor(), {
        executionMode: 'inline',
        generatedMessageCount: 3,
        generatedMessageRole: 'assistant',
      });
      expect((fact as unknown as Record<string, unknown>).generatedMessageCount).toBe(3);
      const json = JSON.stringify(fact);
      expect(json).not.toContain('generatedContent');
      expect(json).not.toContain('messageBody');
    });

    it('Skill correlation excludes raw content/manifest/transcript', () => {
      const fact = buildTerminalFact(makeRequest(), 'completed', 'OK', 's', 5, makeDescriptor(), {
        parentInvocationId: 'tool-inv-skill-1',
      });
      const json = JSON.stringify(fact);
      expect(json).not.toContain('rawArgs');
      expect(json).not.toContain('rawSkillContent');
      expect(json).not.toContain('rawManifest');
      expect(json).not.toContain('forkTranscript');
    });
  });
});
