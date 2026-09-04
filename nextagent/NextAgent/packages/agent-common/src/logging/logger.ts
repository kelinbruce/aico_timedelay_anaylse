import { AsyncLocalStorage } from 'node:async_hooks';

export type RuntimeLogLevel = 'error' | 'warn' | 'info' | 'debug';

export type OperationalLogSurface = 'runtime_diagnostic' | 'observation_derived';

export interface RuntimeLogFn {
  (fields: object, msg?: string): void;
}

/** Safe, Pino-compatible subset exposed to product packages. */
export interface RuntimeLogger {
  readonly error: RuntimeLogFn;
  readonly warn: RuntimeLogFn;
  readonly info: RuntimeLogFn;
  readonly debug: RuntimeLogFn;
}

export interface RuntimeLoggerBindings {
  readonly component: string;
  readonly source?: string;
}

export interface RuntimeLoggerProvider {
  getLogger: (bindings: RuntimeLoggerBindings) => RuntimeLogger;
}

export interface RuntimeLoggerProviderBinding {
  unbind: () => void;
}

export interface RuntimeLogCorrelation {
  readonly traceId: string;
  readonly spanId: string;
}

const BINDING_TOKEN_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const MAX_BINDING_LENGTH = 64;

export const noopRuntimeLogger: RuntimeLogger = Object.freeze({
  error(_fields: object, _msg?: string): void {},
  warn(_fields: object, _msg?: string): void {},
  info(_fields: object, _msg?: string): void {},
  debug(_fields: object, _msg?: string): void {},
});

let activeProvider: RuntimeLoggerProvider | undefined;
let activeBinding: symbol | undefined;
const runtimeLogCorrelation = new AsyncLocalStorage<RuntimeLogCorrelation>();

export function runWithRuntimeLogCorrelation<T>(correlation: RuntimeLogCorrelation, operation: () => T): T {
  return runtimeLogCorrelation.run(normalizeRuntimeLogCorrelation(correlation), operation);
}

export function currentRuntimeLogCorrelation(): RuntimeLogCorrelation | undefined {
  return runtimeLogCorrelation.getStore();
}

export function bindRuntimeLoggerProvider(provider: RuntimeLoggerProvider): RuntimeLoggerProviderBinding {
  if (activeProvider !== undefined) {
    throw new Error('A runtime logger provider is already bound.');
  }
  const binding = Symbol('runtime-logger-provider-binding');
  activeProvider = provider;
  activeBinding = binding;
  let unbound = false;
  return {
    unbind(): void {
      if (unbound) {
        return;
      }
      unbound = true;
      if (activeBinding !== binding) {
        return;
      }
      activeProvider = undefined;
      activeBinding = undefined;
    },
  };
}

export function getLogger(bindings: RuntimeLoggerBindings): RuntimeLogger {
  const safeBindings = normalizeBindings(bindings);
  let cachedProvider: RuntimeLoggerProvider | undefined;
  let cachedLogger: RuntimeLogger | undefined;

  const resolve = (): RuntimeLogger => {
    const provider = activeProvider;
    if (provider === undefined) {
      return noopRuntimeLogger;
    }
    if (provider === cachedProvider && cachedLogger !== undefined) {
      return cachedLogger;
    }
    try {
      const logger = provider.getLogger(safeBindings);
      cachedProvider = provider;
      cachedLogger = logger;
      return logger;
    } catch {
      return noopRuntimeLogger;
    }
  };

  const logger: RuntimeLogger = {
    error: (fields: object, msg?: string) => invoke(resolve(), 'error', fields, msg),
    warn: (fields: object, msg?: string) => invoke(resolve(), 'warn', fields, msg),
    info: (fields: object, msg?: string) => invoke(resolve(), 'info', fields, msg),
    debug: (fields: object, msg?: string) => invoke(resolve(), 'debug', fields, msg),
  };
  return Object.freeze(logger);
}

function invoke(logger: RuntimeLogger, level: RuntimeLogLevel, fields: object, msg?: string): void {
  try {
    logger[level](fields, msg);
  } catch {
    // Diagnostics must never change the business result.
  }
}

function normalizeBindings(bindings: RuntimeLoggerBindings): RuntimeLoggerBindings {
  return Object.freeze({
    component: normalizeBinding('component', bindings.component),
    ...(bindings.source === undefined ? {} : { source: normalizeBinding('source', bindings.source) }),
  });
}

function normalizeBinding(name: 'component' | 'source', value: string): string {
  if (value.length === 0 || value.length > MAX_BINDING_LENGTH || !BINDING_TOKEN_PATTERN.test(value)) {
    throw new TypeError(`Runtime logger ${name} must be a stable code-owned token.`);
  }
  return value;
}

function normalizeRuntimeLogCorrelation(correlation: RuntimeLogCorrelation): RuntimeLogCorrelation {
  if (!/^[0-9a-f]{32}$/u.test(correlation.traceId) || /^0{32}$/u.test(correlation.traceId)) {
    throw new TypeError('Runtime log traceId must be a valid non-zero lowercase trace id.');
  }
  if (!/^[0-9a-f]{16}$/u.test(correlation.spanId) || /^0{16}$/u.test(correlation.spanId)) {
    throw new TypeError('Runtime log spanId must be a valid non-zero lowercase span id.');
  }
  return Object.freeze({ traceId: correlation.traceId, spanId: correlation.spanId });
}

export function createRuntimeLogger(component: string, source?: string): RuntimeLogger {
  return getLogger({ component, ...(source !== undefined ? { source } : {}) });
}
