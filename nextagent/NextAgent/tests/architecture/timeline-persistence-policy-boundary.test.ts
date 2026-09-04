import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('timeline persistence policy boundary', () => {
  it('keeps thinking classification out of RuntimeOwnedAgentRunStatePort.emitEvent', () => {
    const source = readFileSync(join(process.cwd(), 'packages/agent-runtime/src/lifecycle/agent-run-state-port.ts'), 'utf8');
    const emitStart = source.indexOf('async emitEvent(');
    const appendMessageStart = source.indexOf('async appendMessage(', emitStart);
    const emitEventSource = source.slice(emitStart, appendMessageStart);

    expect(emitStart).toBeGreaterThanOrEqual(0);
    expect(appendMessageStart).toBeGreaterThan(emitStart);
    expect(emitEventSource).toContain('timelinePersistencePolicy.resolve(event)');
    expect(emitEventSource).not.toContain('LLM_THINKING_DELTA');
    expect(emitEventSource).not.toContain('completed');
  });
});
