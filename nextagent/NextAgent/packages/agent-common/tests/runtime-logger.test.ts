import {
  bindRuntimeLoggerProvider,
  getLogger,
  noopRuntimeLogger,
  type OperationalLogSurface,
  type RuntimeLogLevel,
  type RuntimeLogger,
} from '../src/index.js';
import { describe, expect, it, vi } from 'vitest';

describe('runtime logger', () => {
  it('exports a structural logger contract for business packages', () => {
    const logger: RuntimeLogger = noopRuntimeLogger;

    expect(() => {
      logger.info({ event: 'runtime.test', runId: 'run-1' }, 'Runtime run-1 is ready.');
      logger.warn({ event: 'runtime.test.warn', runId: 'run-1' }, 'Runtime run-1 is degraded.');
      logger.warn({ err: new Error('private'), event: 'runtime.test.warn_caught', runId: 'run-1' }, 'Runtime run-1 warning was captured.');
      logger.error({ event: 'runtime.test.error', runId: 'run-1' }, 'Runtime run-1 failed.');
      logger.error({ err: new Error('private'), event: 'runtime.test.error_caught', runId: 'run-1' }, 'Runtime run-1 failure was captured.');
      logger.debug({ event: 'runtime.test.debug', runId: 'run-1' }, 'Runtime run-1 debug state.');
    }).not.toThrow();
  });

  it('freezes the common level and surface vocabulary without owning I/O', () => {
    const levels: readonly RuntimeLogLevel[] = ['debug', 'info', 'warn', 'error'];
    const surfaces: readonly OperationalLogSurface[] = ['runtime_diagnostic', 'observation_derived'];

    expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
    expect(surfaces).toEqual(['runtime_diagnostic', 'observation_derived']);
  });

  it('resolves a provider lazily so classes need no composition change', () => {
    const info = vi.fn();
    const logger = getLogger({ component: 'agent-runtime', source: 'request-runner' });

    logger.info({ event: 'before.binding' });
    const binding = bindRuntimeLoggerProvider({
      getLogger: (bindings) => ({ ...noopRuntimeLogger, info: (fields, msg) => info(bindings, fields, msg) }),
    });
    logger.info({ event: 'after.binding' }, 'Runtime is ready.');
    binding.unbind();
    logger.info({ event: 'after.unbind' });

    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith({ component: 'agent-runtime', source: 'request-runner' }, { event: 'after.binding' }, 'Runtime is ready.');
  });

  it('rejects unsafe bindings and a second active provider', () => {
    expect(() => getLogger({ component: '../../runtime' })).toThrow(TypeError);
    const binding = bindRuntimeLoggerProvider({ getLogger: () => noopRuntimeLogger });
    expect(() => bindRuntimeLoggerProvider({ getLogger: () => noopRuntimeLogger })).toThrow(/already bound/u);
    binding.unbind();
  });
});
