import { AgentError } from '@nextagent/agent-common';
import type { RequestRun } from '@nextagent/agent-contracts/runtime';

export interface RoutingAsyncGuardOptions {
  readonly signal: AbortSignal;
  readonly deadlineAt?: number;
  readonly timeoutCode: string;
  readonly timeoutMessage: string;
  readonly canceledMessage: string;
}

export async function runWithRoutingGuards<T>(operation: Promise<T>, run: RequestRun, options: RoutingAsyncGuardOptions): Promise<T> {
  if (options.signal.aborted) {
    throw new AgentError({
      code: 'ROUTING_ABORTED',
      message: options.canceledMessage,
      category: 'CANCELED',
      retryable: false,
      safeDetails: { reasonCode: 'ROUTING_ABORTED' },
    });
  }
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      options.signal.removeEventListener('abort', onAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () =>
      finish(() =>
        reject(
          new AgentError({
            code: 'ROUTING_ABORTED',
            message: options.canceledMessage,
            category: 'CANCELED',
            retryable: false,
            safeDetails: { reasonCode: 'ROUTING_ABORTED' },
          }),
        ),
      );
    const remainingMs = options.deadlineAt === undefined ? undefined : Math.max(0, Number(options.deadlineAt) - Date.now());
    if (remainingMs !== undefined) {
      timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new AgentError({
                code: options.timeoutCode,
                message: options.timeoutMessage,
                category: 'TIMEOUT',
                retryable: false,
                safeDetails: { runId: run.runId },
              }),
            ),
          ),
        remainingMs,
      );
    }
    options.signal.addEventListener('abort', onAbort, { once: true });
    void operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export function remainingDeadlineMs(run: RequestRun): number | undefined {
  return run.deadlineAt === undefined ? undefined : Math.max(0, Number(run.deadlineAt) - Date.now());
}
