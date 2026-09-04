import { brand, type AgentType } from '@nextagent/agent-common';
import type { AgentConstructor, AgentExecutionOutcome, AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import type { AgentRuntimeKit } from '@nextagent/agent-runtime';

export type TestAgentExecute = (
  kit: { readonly runState: AgentRunStatePort },
  run: RequestRun,
  context: RequestContext,
  signal: AbortSignal,
) => Promise<void>;

export interface TestAgentConstructorOptions {
  readonly agentType?: AgentType;
  readonly onConstruct?: () => void;
}

export function createTestAgentConstructor(
  execute: TestAgentExecute,
  options: TestAgentConstructorOptions = {},
): AgentConstructor<AgentRuntimeKit<object>> {
  return class TestAgent {
    static getType(): AgentType {
      return options.agentType ?? brand<string, 'AgentType'>('default');
    }

    constructor(private readonly kit: AgentRuntimeKit<object>) {
      options.onConstruct?.();
    }

    async execute(run: RequestRun, context: RequestContext, signal: AbortSignal): Promise<AgentExecutionOutcome> {
      await execute({ runState: this.kit.runState }, run, context, signal);
      return { status: 'COMPLETED' };
    }
  };
}
