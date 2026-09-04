import type { CreateOperationalLogWriterOptions, OperationalRuntimeLoggingPolicy } from './index.js';
import {
  createOperationalLogWriterWithDependencies as createWriter,
  type ConsoleDestination,
  type OperationalWriterDependencies,
} from './operational-writer.js';

export type { ConsoleDestination, OperationalWriterDependencies };

export function createOperationalLogWriterWithDependencies(
  policy: OperationalRuntimeLoggingPolicy,
  options: Omit<CreateOperationalLogWriterOptions, 'serviceVersion'> & { readonly serviceVersion?: string },
  dependencies: OperationalWriterDependencies,
) {
  return createWriter(policy, { ...options, serviceVersion: options.serviceVersion ?? 'agent-test-1.0.0' }, dependencies);
}
export { createDeveloperDiagnosticArtifactWriterForTesting } from './developer-diagnostic-artifact-writer.js';
