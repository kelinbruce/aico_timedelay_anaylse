import { describe, expect, it } from 'vitest';
import { brand } from '@nextagent/agent-common';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import { resolveConflictGroup, pickByPriority, type GetGovernedPriority } from '../src/catalog/conflict-resolution.js';

function d(
  capabilityId: string,
  providerId: string,
  providerKind: 'BUNDLED' | 'LOCAL_DIRECTORY' | 'MCP_SERVER' | 'SKILL_HUB' = 'BUNDLED',
  kind: 'TOOL' | 'SKILL' = 'TOOL',
): CapabilityDescriptor {
  return {
    capabilityId: brand(capabilityId),
    kind,
    provider: { providerId, providerKind },
    displayName: capabilityId,
    description: `${capabilityId} test capability.`,
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
  };
}

function getPriority(candidate: CapabilityDescriptor): number {
  const { providerKind, providerId } = candidate.provider;
  if (providerKind === 'LOCAL_DIRECTORY' && providerId.includes('agent-owned')) {
    return 2;
  }
  if (providerKind === 'BUNDLED') {
    return 3;
  }
  if (providerKind === 'LOCAL_DIRECTORY') {
    return 4;
  }
  return 5;
}

// ---- 4.1: No conflict ----
describe('resolveConflictGroup 4.1 — no conflict', () => {
  it('single candidate returns as winner with empty evidence', () => {
    const { winner, evidence } = resolveConflictGroup([d('a', 'p1')], getPriority);
    expect(winner?.capabilityId).toBe('a');
    expect(evidence).toEqual([]);
  });

  it('empty returns undefined', () => {
    const { winner } = resolveConflictGroup([], getPriority);
    expect(winner).toBeUndefined();
  });
});

// ---- 4.2 & 4.3: Same-scope REJECT ----
describe('resolveConflictGroup 4.2-4.3 — same-scope REJECT', () => {
  it('same providerId duplicates rejected', () => {
    const { winner, evidence } = resolveConflictGroup([d('dup', 'p1'), d('dup', 'p1')], getPriority);
    expect(winner).toBeUndefined();
    expect(evidence).toHaveLength(2);
    expect(evidence.every((e: { decision: string }) => e.decision === 'REJECT')).toBe(true);
    expect(evidence[0]!.reason).toContain('stable source-fact');
  });

  it('same providerId + same kind still rejected', () => {
    const { winner, evidence } = resolveConflictGroup([d('dup', 'p1', 'BUNDLED', 'TOOL'), d('dup', 'p1', 'BUNDLED', 'TOOL')], getPriority);
    expect(winner).toBeUndefined();
    expect(evidence.every((e: { decision: string }) => e.decision === 'REJECT')).toBe(true);
  });
});

// ---- 4.4 & 4.5: Cross-scope SHADOW ----
describe('resolveConflictGroup 4.4-4.5 — cross-scope SHADOW', () => {
  it('builtin shadows system-local', () => {
    const { winner, evidence } = resolveConflictGroup(
      [d('same', 'builtin-tools', 'BUNDLED'), d('same', 'local-skills-system', 'LOCAL_DIRECTORY')],
      getPriority,
    );
    expect(winner?.provider.providerId).toBe('builtin-tools');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.decision).toBe('SHADOW');
  });

  it('agent-owned shadows system-local', () => {
    const { winner, evidence } = resolveConflictGroup(
      [d('same', 'local-skills-agent-owned', 'LOCAL_DIRECTORY'), d('same', 'local-skills-system', 'LOCAL_DIRECTORY')],
      getPriority,
    );
    expect(winner?.provider.providerId).toBe('local-skills-agent-owned');
    expect(evidence[0]!.decision).toBe('SHADOW');
  });

  it('builtin shadows remote', () => {
    const { winner } = resolveConflictGroup([d('same', 'builtin-tools', 'BUNDLED'), d('same', 'hub-1', 'SKILL_HUB')], getPriority);
    expect(winner?.provider.providerId).toBe('builtin-tools');
  });
});

// ---- 4.6: Priority ordering ----
describe('resolveConflictGroup 4.6 — priority ordering', () => {
  it('agent-owned > builtin > sys-local > remote', () => {
    const { winner } = resolveConflictGroup(
      [
        d('same', 'local-skills-system', 'LOCAL_DIRECTORY'),
        d('same', 'hub-1', 'SKILL_HUB'),
        d('same', 'builtin-tools', 'BUNDLED'),
        d('same', 'local-skills-agent-owned', 'LOCAL_DIRECTORY'),
      ],
      getPriority,
    );
    expect(winner?.provider.providerId).toBe('local-skills-agent-owned');
  });
});

// ---- 4.8: Skill candidates ----
describe('resolveConflictGroup 4.8 — Skill candidates', () => {
  it('SKILL same-scope duplicates rejected', () => {
    const { winner, evidence } = resolveConflictGroup(
      [d('dup', 'local-skills-system', 'LOCAL_DIRECTORY', 'SKILL'), d('dup', 'local-skills-system', 'LOCAL_DIRECTORY', 'SKILL')],
      getPriority,
    );
    expect(winner).toBeUndefined();
    expect(evidence.every((e: { decision: string }) => e.decision === 'REJECT')).toBe(true);
  });
});

// ---- 4.10: Same priority unresolved ----
describe('resolveConflictGroup 4.10 — same priority unresolved', () => {
  it('two remote providers same priority → unresolved with evidence', () => {
    const { winner, evidence } = resolveConflictGroup([d('same', 'hub-a', 'SKILL_HUB'), d('same', 'hub-b', 'MCP_SERVER')], getPriority);
    expect(winner).toBeUndefined();
    expect(evidence).toHaveLength(2);
    expect(evidence[0]!.decision).toBe('SHADOW');
    expect(evidence[0]!.reason).toContain('Same priority');
  });

  it('two BUNDLED providers same priority → unresolved with evidence', () => {
    const { winner, evidence } = resolveConflictGroup([d('same', 'builtin-tools', 'BUNDLED'), d('same', 'other-bundled', 'BUNDLED')], getPriority);
    expect(winner).toBeUndefined();
    expect(evidence).toHaveLength(2);
  });
});

// ---- pickByPriority ----
describe('pickByPriority', () => {
  it('returns highest priority candidate', () => {
    expect(pickByPriority([d('a', 'p-low', 'MCP_SERVER'), d('a', 'builtin-tools', 'BUNDLED')], getPriority).provider.providerId).toBe(
      'builtin-tools',
    );
  });

  it('deterministic providerId order for same priority', () => {
    expect(pickByPriority([d('same', 'b-provider', 'SKILL_HUB'), d('same', 'a-provider', 'SKILL_HUB')], getPriority).provider.providerId).toBe(
      'a-provider',
    );
  });
});
