import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';

export type ConflictDecision = 'ALLOW' | 'REJECT' | 'SHADOW';

export interface ConflictEvidence {
  readonly descriptor: CapabilityDescriptor;
  readonly decision: 'REJECT' | 'SHADOW';
  readonly reason: string;
}

export type GetGovernedPriority = (candidate: CapabilityDescriptor) => number;

export function resolveConflictGroup(
  candidates: readonly CapabilityDescriptor[],
  getPriority: GetGovernedPriority,
): { winner?: CapabilityDescriptor | undefined; evidence: ConflictEvidence[] } {
  if (candidates.length <= 1) {
    return { winner: candidates[0], evidence: [] };
  }
  const byScope = groupBy(candidates, (d) => d.provider.providerId);
  // 1. Same-scope duplicates: REJECT all
  for (const scopeGroup of byScope.values()) {
    if (scopeGroup.length > 1) {
      return {
        winner: undefined,
        evidence: scopeGroup.map((d) => createEvidence(d, 'REJECT', 'Same-scope duplicate without stable source-fact identity proof')),
      };
    }
  }
  // 2. Cross-scope: compare governed priority
  const representatives = [...byScope.values()].map((g) => g[0]!);
  if (representatives.length > 1) {
    const firstPriority = getPriority(representatives[0]!);
    if (representatives.every((r) => getPriority(r) === firstPriority)) {
      // Same priority → unresolved, keep evidence for traceability
      return {
        winner: undefined,
        evidence: representatives.map((d) => createEvidence(d, 'SHADOW', 'Same priority, unresolved conflict')),
      };
    }
  }
  const winner = pickByPriority(representatives, getPriority);
  const shadowed = representatives.filter((d) => d !== winner);
  return {
    winner,
    evidence: shadowed.map((d) => createEvidence(d, 'SHADOW', `Shadowed by higher-priority candidate "${winner.provider.providerId}"`)),
  };
}

export function pickByPriority(candidates: readonly CapabilityDescriptor[], getPriority: GetGovernedPriority): CapabilityDescriptor {
  const sorted = [...candidates].sort((a, b) => {
    const pa = getPriority(a);
    const pb = getPriority(b);
    if (pa !== pb) {
      return pa - pb;
    }
    // Deterministic tie-breaking by providerId
    return a.provider.providerId.localeCompare(b.provider.providerId);
  });
  return sorted[0]!;
}

function createEvidence(descriptor: CapabilityDescriptor, decision: 'REJECT' | 'SHADOW', reason: string): ConflictEvidence {
  return { descriptor, decision, reason };
}

function groupBy<T, K>(items: readonly T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = map.get(key);
    if (existing !== undefined) {
      existing.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}
