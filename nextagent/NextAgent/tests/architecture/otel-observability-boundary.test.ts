import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('otel observability boundary', () => {
  it('keeps OpenTelemetry SDK imports inside observability owners', () => {
    const workspacePackages = readdirSync(join(process.cwd(), 'packages'));
    for (const packageName of workspacePackages) {
      const srcRoot = join(process.cwd(), 'packages', packageName, 'src');
      if (!statSafe(srcRoot)?.isDirectory()) {
        continue;
      }
      for (const file of tsFiles(srcRoot)) {
        const source = readFileSync(file, 'utf8');
        if (packageName === 'agent-observability') {
          continue;
        }
        expect(source, `${file} must not import OpenTelemetry SDK`).not.toMatch(/@opentelemetry\/api/u);
      }
    }
  });

  it('does not leak trace SDK fields outside observability owners', () => {
    const forbiddenSdkFields = /\b(traceId|spanId|SpanContext|Tracer|MeterProvider|Meter)\b/u;
    const modelHeaderComposer = join(process.cwd(), 'packages', 'agent-model', 'src', 'transport', 'invocation-headers.ts');
    for (const packageName of [
      'agent-contracts',
      'agent-runtime',
      'agent-core',
      'agent-model',
      'agent-capability',
      'agent-channel-web',
      'agent-platform-gateway-local',
      'agent-platform-gateway-remote',
    ]) {
      const srcRoot = join(process.cwd(), 'packages', packageName, 'src');
      for (const file of tsFiles(srcRoot)) {
        const source = readFileSync(file, 'utf8');
        expect(source, `${file} must not leak trace SDK fields`).not.toMatch(forbiddenSdkFields);
      }
    }
    const headerComposerSource = readFileSync(modelHeaderComposer, 'utf8');
    expect(headerComposerSource).not.toMatch(/ModelOutboundHeaderPolicy|composeModelOutboundHeaders|protectedHeaderNames/u);
  });

  it('keeps W3C carrier fields out of non-observability contracts', () => {
    const contractsRoot = join(process.cwd(), 'packages', 'agent-contracts', 'src');
    const observabilityContract = join(contractsRoot, 'observability', 'index.ts');
    for (const file of tsFiles(contractsRoot)) {
      if (file === observabilityContract) {
        continue;
      }
      expect(readFileSync(file, 'utf8'), `${file} must not expose W3C carrier fields`).not.toMatch(/\b(traceparent|tracestate)\b/u);
    }
  });

  it('prevents physical outbound adapters from creating local spans', () => {
    for (const relativeRoot of [
      join('packages', 'agent-model', 'src', 'providers', 'openai-compatible'),
      join('packages', 'agent-capability', 'src', 'clip'),
      join('packages', 'agent-platform-gateway-remote', 'src'),
    ]) {
      const sourceRoot = join(process.cwd(), relativeRoot);
      for (const file of tsFiles(sourceRoot)) {
        const source = readFileSync(file, 'utf8');
        expect(source, `${file} must not create a physical transport span`).not.toMatch(/\.(?:startSpan|startActiveSpan)\s*\(/u);
      }
    }
  });

  it('keeps outgoing HTTP auto-instrumentation disabled', () => {
    const source = readFileSync(join(process.cwd(), 'packages', 'agent-observability', 'src', 'metrics', 'http-server-instrumentation.ts'), 'utf8');
    expect(source).toContain('disableOutgoingRequestInstrumentation: true');
  });

  it('routes runtime timeline writes through the trace-aware stores', () => {
    const source = readFileSync(join(process.cwd(), 'packages', 'agent-app', 'src', 'composition', 'request-runtime-composition.ts'), 'utf8');
    expect(source).toContain('const timelineStore = createTraceAwareTimelineStore(input.gateway.timeline, input.timelineSpanLifecycle);');
    expect(source).toContain('const requestRunStore = createTraceAwareRequestRunStore(input.gateway.requestRuns, input.timelineSpanLifecycle);');
    expect(source).toMatch(/\brequestRunStore,\s*\r?\n\s*timelineStore,/u);
  });
});

function tsFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...tsFiles(path));
      continue;
    }
    if (path.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

function statSafe(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}
