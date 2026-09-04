import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('user query memory recall architecture boundary', () => {
  it('keeps final-input admission independent from memory and gateway owners', () => {
    const source = read('packages/agent-context-engine/src/budget/rendered-context-supplement-admission.ts');

    expect(source).not.toContain('@nextagent/agent-memory');
    expect(source).not.toContain('@nextagent/agent-contracts/gateway');
  });

  it('composes recall directly from ports without invoking model-facing capabilities', () => {
    const source = read('packages/agent-app/src/composition/user-query-memory-recall-hook.ts');

    expect(source).not.toContain('@nextagent/agent-capability');
    expect(source).not.toContain('capabilityInvocation');
    expect(source).not.toContain('toolCallId');
  });

  it('keeps trusted owner scope out of the generic plugin HookInput contract', () => {
    const source = read('packages/agent-contracts/src/runtime/index.ts');
    const hookInput = source.slice(source.indexOf('export interface HookInput'), source.indexOf('export type HookMutationForStage'));

    expect(hookInput).not.toContain('ownerScope');
    expect(hookInput).not.toContain('tenantId');
    expect(hookInput).not.toContain('subjectId');
  });
});

function read(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}
