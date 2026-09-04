import { bindRuntimeLoggerProvider, type RuntimeLogger } from '@nextagent/agent-common';
import type { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { describe, expect, it } from 'vitest';
import { instrumentTraceExporterDiagnostics } from '../src/linking/trace-export-diagnostics.js';

describe('OTLP trace infrastructure diagnostics', () => {
  it('passes exporter errors through the centralized caught-value boundary', () => {
    const entries: Array<{ readonly caught?: unknown; readonly fields: object }> = [];
    const logger: RuntimeLogger = {
      error(fields: object): void {
        const record = fields as Record<string, unknown>;
        const { err, ...safeFields } = record;
        entries.push({ ...(err === undefined ? {} : { caught: err }), fields: safeFields });
      },
      warn() {},
      info() {},
      debug() {},
    };
    const failure = new TypeError('credential=trace-secret https://collector.private/v1/traces');
    const exporter = {
      export(_spans: unknown[], callback: (result: { code: number; error?: Error }) => void): void {
        callback({ code: 1, error: failure });
      },
    } as unknown as OTLPTraceExporter;

    const binding = bindRuntimeLoggerProvider({ getLogger: () => logger });
    instrumentTraceExporterDiagnostics(exporter);
    exporter.export([], () => undefined);
    binding.unbind();

    expect(entries).toEqual([
      {
        caught: failure,
        fields: {
          event: 'otel.trace.export.failed',
          failureStage: 'batch_export',
          exportResultCode: 1,
        },
      },
    ]);
    expect(JSON.stringify(entries[0]?.fields)).not.toMatch(/trace-secret|collector\.private/u);
  });
});
