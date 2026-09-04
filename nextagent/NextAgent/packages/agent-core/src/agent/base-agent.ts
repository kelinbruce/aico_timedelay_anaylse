import { AgentError } from '@nextagent/agent-common';
import type { Agent, AgentExecutionOutcome, AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';

export abstract class BaseAgent<TDependencies extends { readonly runState: AgentRunStatePort }> implements Agent {
  protected constructor(protected readonly deps: TDependencies) {}

  async execute(run: RequestRun, context: RequestContext, signal: AbortSignal): Promise<AgentExecutionOutcome> {
    this.assertRunContext(run, context);
    return (await this.executeRun(run, context, signal)) ?? { status: 'COMPLETED' };
  }

  protected abstract executeRun(run: RequestRun, context: RequestContext, signal: AbortSignal): Promise<AgentExecutionOutcome | void>;

  private assertRunContext(run: RequestRun, context: RequestContext): void {
    if (
      run.runId !== context.runId ||
      run.sessionId !== context.sessionId ||
      run.requestId !== context.requestId ||
      run.agentId !== context.agentId
    ) {
      throw new AgentError({
        code: 'RUN_CONTEXT_MISMATCH',
        message: 'Agent execution context does not match the accepted run.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
  }
}
