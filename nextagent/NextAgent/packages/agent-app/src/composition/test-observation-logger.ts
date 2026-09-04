import { noopRuntimeLogger, type RuntimeLogger } from '@nextagent/agent-common';
import type { OperationalLogWriter } from '@nextagent/agent-log';

export function withTestObservationLogger(observationLogger: RuntimeLogger, delegate?: OperationalLogWriter): OperationalLogWriter {
  const getServerAccessLogger = delegate?.getServerAccessLogger;
  return {
    getLogger: delegate === undefined ? () => noopRuntimeLogger : (bindings) => delegate.getLogger(bindings),
    ...(getServerAccessLogger === undefined ? {} : { getServerAccessLogger: (bindings) => getServerAccessLogger.call(delegate, bindings) }),
    getObservationLogger: () => observationLogger,
    activeIdentity: () => delegate?.activeIdentity(),
    flush: async (timeoutMs) => delegate?.flush(timeoutMs),
    close: async (timeoutMs) => delegate?.close(timeoutMs),
  };
}
