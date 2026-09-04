import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('runtime logging package boundary', () => {
  it('keeps rolling lifecycle dependencies inside the foundation', () => {
    const packagesRoot = join(root, 'packages');
    const violations = readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'agent-local-file-roll')
      .flatMap((entry) => sourceFiles(join(packagesRoot, entry.name, 'src')))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return (
          /from\s+["'](?:pino-roll|sonic-boom)["']/u.test(source) ||
          /import\s*\{[^}]*(?:createGzip|gzip|gunzip)[^}]*\}\s*from\s*["']node:zlib["']/u.test(source)
        );
      });

    expect(violations).toEqual([]);
  });

  it('keeps foundation vocabulary mechanism-only', () => {
    const source = sourceFiles(join(root, 'packages', 'agent-local-file-roll', 'src'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/RuntimeLogger|AuditEventRecord|MetricSample|NextAgentMetricSnapshot|\b(?:log|metrics|audit)\s*\|/u);
    expect(source).not.toMatch(/@nextagent\/agent-(?:common|contracts|runtime|app|observability)/u);
    expect(source).not.toMatch(/matcher|deleteCallback|serializer/u);
  });

  it('allows only the three output owners to declare the foundation dependency', () => {
    const allowed = new Set(['agent-log', 'agent-observability', 'agent-platform-gateway-local']);
    const violations = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => {
        const manifestPath = join(root, 'packages', entry.name, 'package.json');
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> };
          return manifest.dependencies?.['@nextagent/agent-local-file-roll'] !== undefined && !allowed.has(entry.name);
        } catch {
          return false;
        }
      })
      .map((entry) => entry.name);

    expect(violations).toEqual([]);
  });

  it('exposes agent-log construction only to app and tests', () => {
    const violations = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'agent-app' && entry.name !== 'agent-log')
      .flatMap((entry) => sourceFiles(join(root, 'packages', entry.name, 'src')))
      .filter((file) => readFileSync(file, 'utf8').includes('@nextagent/agent-log'));

    expect(violations).toEqual([]);
  });

  it('keeps developer diagnostic writer ownership deployment-neutral and out of product entrypoints', () => {
    const writerPath = join(root, 'packages', 'agent-log', 'src', 'developer-diagnostic-artifact-writer.ts');
    const legacyWriterPath = join(
      root,
      'packages',
      'agent-platform-gateway-local',
      'src',
      'developer-diagnostics',
      'local-developer-diagnostic-artifact-writer.ts',
    );
    const productEntrypoints = [
      join(root, 'packages', 'agent-platform-gateway-local', 'src', 'entrypoints', 'local.ts'),
      join(root, 'packages', 'agent-platform-gateway-local', 'src', 'testing.ts'),
      join(root, 'packages', 'agent-remote-deployment', 'src', 'index.ts'),
    ];

    expect(existsSync(writerPath)).toBe(true);
    expect(existsSync(legacyWriterPath)).toBe(false);
    for (const entrypoint of productEntrypoints) {
      expect(readFileSync(entrypoint, 'utf8')).not.toMatch(/DeveloperDiagnosticArtifactWriter|developerDiagnosticArtifactWriter/u);
    }
  });

  it('keeps product console calls out of runtime code and isolates direct CLI streams', () => {
    const packageSources = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => sourceFiles(join(root, 'packages', entry.name, 'src')));
    const consoleViolations = packageSources
      .filter((file) => !file.endsWith(join('agent-plugin-sdk', 'src', 'scaffold', 'cli.ts')))
      .filter((file) => /console\.(?:log|info|warn|error|debug)\s*\(/u.test(readFileSync(file, 'utf8')))
      .map(relativeSourcePath);
    const directStreamOwners = packageSources
      .filter((file) => /(?:process\.(?:stdout|stderr)\.write\s*\(|writeCli\(process\.(?:stdout|stderr),)/u.test(readFileSync(file, 'utf8')))
      .map(relativeSourcePath);

    expect(consoleViolations).toEqual([]);
    expect(directStreamOwners).toEqual([
      'packages/agent-app/src/local-runtime-package/cli-output.ts',
      'packages/agent-app/src/local-runtime-package/index.ts',
      'packages/agent-remote-deployment/src/index.ts',
    ]);
  });

  it('keeps server access logging on one controlled Fastify boundary', () => {
    const packageSources = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => sourceFiles(join(root, 'packages', entry.name, 'src')));
    const serverAccessOwners = packageSources
      .filter((file) => /server\.access\.(?:completed|failed)/u.test(readFileSync(file, 'utf8')))
      .map(relativeSourcePath);
    const legacyHttpEventOwners = packageSources
      .filter((file) => /http\.request\.(?:completed|failed)/u.test(readFileSync(file, 'utf8')))
      .map(relativeSourcePath);
    const fastifyFactory = readFileSync(join(root, 'packages', 'agent-app', 'src', 'server', 'fastify.ts'), 'utf8');
    const fastifyLoggingPath = join(root, 'packages', 'agent-app', 'src', 'server', 'fastify-logging.ts');

    expect(serverAccessOwners).toEqual([]);
    expect(legacyHttpEventOwners).toEqual([]);
    expect(existsSync(fastifyLoggingPath)).toBe(false);
    expect(fastifyFactory).toContain('loggerInstance: accessLogger');
    expect(fastifyFactory).not.toContain('logController');
    expect(fastifyFactory).not.toContain('addHook("onResponse"');
    expect(fastifyFactory).not.toContain('addHook("onError"');
    const channelComposition = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'channel-composition.ts'), 'utf8');
    const metricsRegistry = readFileSync(join(root, 'packages', 'agent-observability', 'src', 'metrics', 'metrics-registry.ts'), 'utf8');
    const httpInstrumentation = readFileSync(
      join(root, 'packages', 'agent-observability', 'src', 'metrics', 'http-server-instrumentation.ts'),
      'utf8',
    );
    expect(channelComposition).not.toContain('addHook("onResponse"');
    expect(metricsRegistry).not.toMatch(/web_request_|recordWebRequestMetrics/u);
    expect(httpInstrumentation).toContain('new HttpInstrumentation');
    expect(httpInstrumentation).toContain('disableOutgoingRequestInstrumentation: true');
  });

  it('keeps RuntimeLogger fields, messages, and errors on the centralized projection boundary', () => {
    const packageSources = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => sourceFiles(join(root, 'packages', entry.name, 'src')));
    const violations = packageSources
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return hasCallerOwnedLogProjection(file, source) || source.includes('isUnexpectedInternalException');
      })
      .map(relativeSourcePath);

    const loggerContract = readFileSync(join(root, 'packages', 'agent-common', 'src', 'logging', 'logger.ts'), 'utf8');
    const projector = readFileSync(join(root, 'packages', 'agent-observability', 'src', 'logging', 'structured-log-projector.ts'), 'utf8');
    const appHelpers = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'app-composition-helpers.ts'), 'utf8');
    const budgetLogging = readFileSync(join(root, 'packages', 'agent-context-engine', 'src', 'budget', 'budget-logging.ts'), 'utf8');
    expect(violations).toEqual([]);
    expect(loggerContract).toContain('(fields: object, msg?: string): void');
    expect(loggerContract).not.toContain('caught: unknown');
    expect(appHelpers).not.toContain('serverListenFailureDetails');
    expect(budgetLogging).not.toMatch(/try\s*\{\s*logger\.(?:debug|info)/u);
    expect(projector).not.toMatch(/MODEL_INVOCATION_DIAGNOSTIC|CAPABILITY_INVOCATION_DIAGNOSTIC|logMessageFor|messagePrefixFor/u);
  });

  it('keeps logger acquisition open for new classes while app owns the single provider binding', () => {
    const packageSources = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => sourceFiles(join(root, 'packages', entry.name, 'src')));
    const legacyAcquisitionOwners = packageSources
      .filter((file) =>
        /\.componentLogger\s*\(|\breadonly\s+runtimeLogger\??\s*:|\bruntimeLogger\??\s*:\s*RuntimeLogger/u.test(readFileSync(file, 'utf8')),
      )
      .map(relativeSourcePath);
    const providerBindingOwners = packageSources
      .filter((file) => /bindRuntimeLoggerProvider\s*\(/u.test(readFileSync(file, 'utf8')))
      .map(relativeSourcePath);
    const sessionService = readFileSync(join(root, 'packages', 'agent-session', 'src', 'services', 'session-preparation.ts'), 'utf8');
    const sessionComposition = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'session-services-composition.ts'), 'utf8');

    expect(legacyAcquisitionOwners).toEqual([]);
    expect(providerBindingOwners).toEqual([
      'packages/agent-app/src/composition/observability-composition.ts',
      'packages/agent-common/src/logging/logger.ts',
    ]);
    expect(sessionService).toContain("getLogger({ component: 'agent-session', source: 'session-service' })");
    expect(sessionService).not.toMatch(/TitleGenerationLogger|deps\.logger|readonly logger\??:/u);
    expect(sessionComposition).not.toMatch(/\blogger\s*:/u);
  });

  it('uses one surface-bound RuntimeLogger path without a product transport bypass', () => {
    const productSources = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => sourceFiles(join(root, 'packages', entry.name, 'src')));
    const legacyTransportOwners = productSources
      .filter((file) =>
        /StructuredLogTransport|structuredLogTransport|operationalStructuredLogTransport|writeObservation/u.test(readFileSync(file, 'utf8')),
      )
      .map(relativeSourcePath);
    const writer = readFileSync(join(root, 'packages', 'agent-log', 'src', 'operational-writer.ts'), 'utf8');
    const observabilityComposition = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'observability-composition.ts'), 'utf8');
    const productContract = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'composition-contracts.ts'), 'utf8');
    const observabilityIndex = readFileSync(join(root, 'packages', 'agent-observability', 'src', 'index.ts'), 'utf8');
    const observabilityLoggerBarrel = join(root, 'packages', 'agent-observability', 'src', 'logging', 'logger.ts');

    expect(legacyTransportOwners).toEqual([]);
    expect(writer).toContain("return createBoundLogger('runtime_diagnostic', bindings)");
    expect(writer).toContain("return createBoundLogger('observation_derived', bindings)");
    expect(observabilityComposition).toContain('operationalLogWriter.getObservationLogger');
    expect(productContract).not.toMatch(/observationLogger|surface/u);
    expect(observabilityIndex).not.toContain('./logging/logger.js');
    expect(existsSync(observabilityLoggerBarrel)).toBe(false);
  });
});

function hasCallerOwnedLogProjection(file: string, source: string): boolean {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let violation = false;
  const forbiddenFields = new Set(['exception', 'message', 'msg']);
  const logMethods = new Set(['debug', 'error', 'info', 'warn']);

  const visit = (node: ts.Node): void => {
    if (violation) {
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      logMethods.has(node.expression.name.text) &&
      isRuntimeLoggerReceiver(node.expression.expression.getText(sourceFile))
    ) {
      violation = node.arguments.some(
        (argument) =>
          ts.isObjectLiteralExpression(argument) &&
          argument.properties.some((property) => {
            if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
              return false;
            }
            return forbiddenFields.has(propertyName(property.name));
          }),
      );
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violation;
}

function isRuntimeLoggerReceiver(receiver: string): boolean {
  return /(?:^|\.)(?:diagnosticLogger|logger|runtimeLogger)$/u.test(receiver);
}

function propertyName(name: ts.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : '';
}

function relativeSourcePath(file: string): string {
  return relative(root, file).replaceAll('\\', '/');
}

function sourceFiles(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(path);
      }
      return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
    });
  } catch {
    return [];
  }
}
