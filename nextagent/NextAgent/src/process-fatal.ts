import type { RuntimeLogger } from '@nextagent/agent-common';

export interface ProcessFatalBoundaryDependencies {
  readonly logger: RuntimeLogger;
  readonly flush: (timeoutMs: number) => Promise<void>;
  readonly exit: (code: number) => void;
  readonly flushTimeoutMs?: number;
}

export function createProcessFatalBoundary(dependencies: ProcessFatalBoundaryDependencies): {
  readonly uncaughtException: (error: unknown) => void;
  readonly unhandledRejection: (reason: unknown) => void;
} {
  let terminating = false;
  const terminate = (error: unknown, event: string, failureStage: string): void => {
    if (terminating) {
      return;
    }
    terminating = true;
    dependencies.logger.error({ err: error, event, failureStage });
    const timeoutMs = dependencies.flushTimeoutMs ?? 5_000;
    void Promise.race([dependencies.flush(timeoutMs).catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]).finally(
      () => dependencies.exit(1),
    );
  };
  return {
    uncaughtException: (error) => terminate(error, 'process.fatal.uncaught_exception', 'PROCESS_UNCAUGHT_EXCEPTION'),
    unhandledRejection: (reason) => terminate(reason, 'process.fatal.unhandled_rejection', 'PROCESS_UNHANDLED_REJECTION'),
  };
}
