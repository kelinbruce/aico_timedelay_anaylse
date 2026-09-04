import type { RuntimeLogger } from '@nextagent/agent-common';
import { describe, expect, it, vi } from 'vitest';
import { createProcessFatalBoundary } from '../src/process-fatal.js';

describe('deployment process fatal boundary', () => {
  it('reports, flushes, and exits once across fatal re-entry', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies RuntimeLogger;
    const flush = vi.fn(async () => undefined);
    const exit = vi.fn();
    const boundary = createProcessFatalBoundary({ logger, flush, exit, flushTimeoutMs: 10 });
    const failure = new Error('private fatal body');

    boundary.uncaughtException(failure);
    boundary.unhandledRejection(new Error('duplicate'));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith({
      err: failure,
      event: 'process.fatal.uncaught_exception',
      failureStage: 'PROCESS_UNCAUGHT_EXCEPTION',
    });
    expect(flush).toHaveBeenCalledWith(10);
  });

  it('still exits when the writer flush is unavailable', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies RuntimeLogger;
    const exit = vi.fn();
    const boundary = createProcessFatalBoundary({
      logger,
      flush: async () => {
        throw new Error('writer unavailable');
      },
      exit,
      flushTimeoutMs: 10,
    });

    boundary.unhandledRejection('non-error rejection');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'process.fatal.unhandled_rejection',
        failureStage: 'PROCESS_UNHANDLED_REJECTION',
      }),
    );
  });
});
