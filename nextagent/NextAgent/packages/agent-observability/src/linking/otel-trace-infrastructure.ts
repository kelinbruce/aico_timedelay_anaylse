import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { createTraceProjector, type TraceProjector } from './trace-projector.js';
import { instrumentTraceExporterDiagnostics } from './trace-export-diagnostics.js';

export interface OtlpTraceInfrastructureOptions {
  readonly endpoint?: string;
  readonly authPk?: string;
  readonly authSk?: string;
  readonly serviceName: string;
  readonly serviceVersion?: string;
}

export type TraceInfrastructureFailureReason = 'TRACE_EXPORTER_INITIALIZATION_FAILED' | 'TRACE_SDK_INITIALIZATION_FAILED';

export interface OtlpTraceInfrastructure {
  readonly traceEnabled: boolean;
  readonly traceProjector?: TraceProjector;
  readonly failureReason?: TraceInfrastructureFailureReason;
}

export function createOtlpTraceInfrastructure(options: OtlpTraceInfrastructureOptions): OtlpTraceInfrastructure {
  try {
    return {
      traceEnabled: true,
      traceProjector: createOtlpTraceProjector(options),
    };
  } catch {
    if (options.endpoint === undefined) {
      return {
        traceEnabled: false,
        failureReason: 'TRACE_SDK_INITIALIZATION_FAILED',
      };
    }
  }

  try {
    return {
      traceEnabled: true,
      traceProjector: createOtlpTraceProjector({
        serviceName: options.serviceName,
        ...(options.serviceVersion === undefined ? {} : { serviceVersion: options.serviceVersion }),
      }),
      failureReason: 'TRACE_EXPORTER_INITIALIZATION_FAILED',
    };
  } catch {
    return {
      traceEnabled: false,
      failureReason: 'TRACE_SDK_INITIALIZATION_FAILED',
    };
  }
}

export function createOtlpTraceProjector(options: OtlpTraceInfrastructureOptions): TraceProjector {
  const resource = resourceFromAttributes({
    'service.name': options.serviceName,
    ...(options.serviceVersion === undefined ? {} : { 'service.version': options.serviceVersion }),
  });
  const exporter = options.endpoint === undefined ? undefined : new OTLPTraceExporter({ url: options.endpoint });
  if (exporter !== undefined) {
    instrumentTraceExporterDiagnostics(exporter);
  }
  const provider = new NodeTracerProvider({
    resource,
    ...(exporter === undefined ? {} : { spanProcessors: [new BatchSpanProcessor(exporter, { scheduledDelayMillis: 5_000, maxExportBatchSize: 8 })] }),
  });
  provider.register();
  return createTraceProjector();
}
