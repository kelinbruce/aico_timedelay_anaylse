import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import type { MeterProvider } from '@opentelemetry/sdk-metrics';

const instrumentation = createStableHttpInstrumentation();

export function bindHttpServerMetrics(provider: MeterProvider): void {
  instrumentation.setMeterProvider(provider);
}

function createStableHttpInstrumentation(): HttpInstrumentation {
  const environmentName = 'OTEL_SEMCONV_STABILITY_OPT_IN';
  const previousSelection = process.env[environmentName];
  process.env[environmentName] = 'http';
  try {
    const httpInstrumentation = new HttpInstrumentation({
      disableIncomingRequestInstrumentation: false,
      disableOutgoingRequestInstrumentation: true,
      requireParentforIncomingSpans: true,
    });
    httpInstrumentation.enable();
    return httpInstrumentation;
  } finally {
    if (previousSelection === undefined) {
      delete process.env[environmentName];
    } else {
      process.env[environmentName] = previousSelection;
    }
  }
}
