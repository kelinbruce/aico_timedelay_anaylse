import type { Agent, AgentRunStatePort } from '@nextagent/agent-contracts/runtime';
import { runtimeLifecycleStages } from '@nextagent/agent-contracts/runtime';
import { createStreamEnvelopeFixture } from '@nextagent/agent-test-kit';
import { describe, expect, it } from 'vitest';

describe('async execution and event ownership skeletons', () => {
  it('uses Promise-based Agent execution and timeline publishing boundaries', async () => {
    const emitted: unknown[] = [];
    const runState: AgentRunStatePort = {
      async setCapabilityTerminalAnswer(): Promise<void> {},
      async emitEvent(_run, _context, event) {
        emitted.push(event);
      },
      async appendMessage() {
        throw new Error('messages port should not be used by this fixture.');
      },
      async saveCheckpoint() {},
      async requestPendingInput() {
        throw new Error('pending input port should not be used by this fixture.');
      },
    };
    const agent: Pick<Agent, 'execute'> = {
      async execute(run, context) {
        await runState.emitEvent(run, context, {
          type: 'PLANNING_STARTED',
          inlinePayload: {},
        });
        return { status: 'COMPLETED' };
      },
    };

    await agent.execute({} as Parameters<Agent['execute']>[0], {} as Parameters<Agent['execute']>[1], new AbortController().signal);
    expect(emitted).toHaveLength(1);
  });

  it('keeps runtime lifecycle stages stable and stream envelope projection request-scoped', () => {
    expect(runtimeLifecycleStages).toContain('BEFORE_MODEL_INVOKE');
    expect(runtimeLifecycleStages).toContain('BEFORE_AGENT_TERMINAL');

    const stream = createStreamEnvelopeFixture();
    expect(stream.requestId).toBeDefined();
  });
});
