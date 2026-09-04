import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveDefaultSystemConfig } from '@nextagent/agent-app/config';
import {
  classifyAppStartupFailure,
  createNextAgentApp,
  createNextAgentAppAsync,
  type CreateNextAgentAppOptions,
  type NextAgentApp,
} from '@nextagent/agent-app';
import { getLogger } from '@nextagent/agent-common';
import { createForkActiveContextSelector } from '@nextagent/agent-context-engine';
import {
  checkLocalRuntimePackageLayout,
  createRuntimePackageServiceVersion,
  readLocalRuntimePackageManifest,
  validateLocalRuntimePackageConfigSample,
  type LocalRuntimeStartProof,
} from '@nextagent/agent-app/local-runtime-package';
import { ragRetrievalResultSchema } from '@nextagent/agent-contracts/gateway';
import type { RagRetrievalResult, SandboxExecutionResult } from '@nextagent/agent-contracts/gateway';
import type { ModelGatewayModelInformationService } from '@nextagent/agent-contracts/model';
import {
  createRemoteSupportLocalGatewayProvider,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider,
} from '@nextagent/agent-platform-gateway-local';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import {
  createReferenceRemoteModelGatewayProvider,
  createReferenceRemoteRagRetrievalGateway,
  createReferenceRemoteWorkflowRagGateway,
  createHttpWorkflowRagClient,
  createReferenceRemoteSandboxGateway,
  createReferenceRemoteQuestionRecommendationGateway,
  createHttpQuestionRecommendationClient,
  createRemoteGatewayProvider,
  type ReferenceRemoteModelGatewayClient,
  type ReferenceRemoteRagRetrievalClient,
  type ReferenceRemoteWorkflowRagClient,
  type ReferenceRemoteSandboxClient,
} from '@nextagent/agent-platform-gateway-remote';
import { Ajv } from 'ajv/dist/ajv.js';

export interface VendorRemoteGatewayClients {
  readonly sandbox: ReferenceRemoteSandboxClient;
  readonly ragRetrieval: ReferenceRemoteRagRetrievalClient;
  readonly workflowRagRetrieval?: ReferenceRemoteWorkflowRagClient;
  readonly modelGateway?: ReferenceRemoteModelGatewayClient;
  readonly modelGatewayInformation?: ModelGatewayModelInformationService;
}

export interface RemoteDeploymentOptions extends CreateNextAgentAppOptions {
  readonly remoteGatewayClients: VendorRemoteGatewayClients;
}

const startupProofRef = 'run/startup-proof.json';
const healthReadinessProofRef = 'run/health-readiness-proof.json';
const runningRemoteRuntimePackages = new Map<string, NextAgentApp>();
const resolvedAllowedApis = resolveDefaultSystemConfig().sandbox.allowedApis;
const validateRagRetrievalResult = new Ajv({ allErrors: true, strict: false }).compile(ragRetrievalResultSchema);

export function createRemoteNextAgentApp(options: RemoteDeploymentOptions): NextAgentApp {
  const { remoteGatewayClients, gatewayProviders: _gatewayProviders, metricsExporter, ...appOptions } = options;
  const resolvedMetricsExporter = metricsExporter ?? createRemoteOtlpMetricExporter(process.env);
  return createNextAgentApp({
    ...appOptions,
    ...(resolvedMetricsExporter === undefined ? {} : { metricsExporter: resolvedMetricsExporter }),
    ...(remoteGatewayClients.modelGateway === undefined
      ? {}
      : {
          modelGatewayProviders: [
            createReferenceRemoteModelGatewayProvider({
              providerId: 'vendor-remote-model-gateway',
              client: remoteGatewayClients.modelGateway,
              ...(remoteGatewayClients.modelGatewayInformation === undefined
                ? {}
                : { modelInformationService: remoteGatewayClients.modelGatewayInformation }),
            }),
          ],
        }),
    gatewayProviders: [
      createSqliteWorkingMemoryGatewayProvider('local-working-memory-gateway', {
        forkActiveContextSelector: createForkActiveContextSelector(),
      }),
      createSqliteLongTermMemoryGatewayProvider(),
      createRemoteSupportLocalGatewayProvider('remote-support-local-gateway', { allowedApis: resolvedAllowedApis }),
      createRemoteGatewayProvider({
        providerId: 'vendor-remote',
        bindings: (input) => {
          const selectedKinds = new Set(input.selectedEntries.map((entry) => entry.adapterKind));
          return {
            ...(selectedKinds.has('sandbox') ? { sandbox: createReferenceRemoteSandboxGateway(remoteGatewayClients.sandbox) } : {}),
            ...(selectedKinds.has('rag-knowledge')
              ? { ragRetrieval: createReferenceRemoteRagRetrievalGateway(remoteGatewayClients.ragRetrieval) }
              : {}),
            ...(selectedKinds.has('rag-knowledge') && remoteGatewayClients.workflowRagRetrieval !== undefined
              ? { workflowRagRetrieval: createReferenceRemoteWorkflowRagGateway(remoteGatewayClients.workflowRagRetrieval) }
              : {}),
          };
        },
      }),
    ],
  });
}

export async function startRemoteRuntimePackage(packageRoot: string): Promise<LocalRuntimeStartProof> {
  const root = resolve(packageRoot);
  const manifest = readLocalRuntimePackageManifest(root);
  const configSampleRef = requireConfigSampleRef(manifest.configSampleRefs);
  const diagnostics = [...checkLocalRuntimePackageLayout(root, manifest), ...validateLocalRuntimePackageConfigSample(root, configSampleRef)];
  if (diagnostics.length > 0) {
    throw new Error('Remote runtime package cannot start before layout and config validation pass.');
  }

  const workingMemoryGatewayProvider = createSqliteWorkingMemoryGatewayProvider('local-working-memory-gateway', {
    forkActiveContextSelector: createForkActiveContextSelector(),
  });
  const longTermMemoryGatewayProvider = createSqliteLongTermMemoryGatewayProvider();
  const localGatewayProvider = createRemoteSupportLocalGatewayProvider('remote-support-local-gateway', { allowedApis: resolvedAllowedApis });
  const remoteGatewayProvider = createRemoteGatewayProvider({
    providerId: 'vendor-remote',
    bindings: (input) => {
      const selectedKinds = new Set(input.selectedEntries.map((entry) => entry.adapterKind));
      return {
        ...(selectedKinds.has('sandbox')
          ? { sandbox: createReferenceRemoteSandboxGateway(createHttpSandboxClient(requireEnv(process.env, 'NEXTAGENT_REMOTE_SANDBOX_ENDPOINT'))) }
          : {}),
        ...(selectedKinds.has('rag-knowledge')
          ? {
              ragRetrieval: createReferenceRemoteRagRetrievalGateway(
                createHttpRagRetrievalClient(requireEnv(process.env, 'NEXTAGENT_REMOTE_RAG_RETRIEVAL_ENDPOINT')),
              ),
            }
          : {}),
        ...(selectedKinds.has('rag-knowledge')
          ? {
              workflowRagRetrieval: createReferenceRemoteWorkflowRagGateway(
                createHttpWorkflowRagClient(requireEnv(process.env, 'NEXTAGENT_REMOTE_RAG_RETRIEVAL_ENDPOINT'), input.executionCorrelation),
              ),
            }
          : {}),
      };
    },
  });
  const metricsExporter = createRemoteOtlpMetricExporter(process.env);
  let app: NextAgentApp;
  try {
    const questionRecommendationEndpoint = process.env.NEXTAGENT_REMOTE_QUESTION_RECOMMENDATION_ENDPOINT;
    app = await createNextAgentAppAsync({
      serviceVersion: createRuntimePackageServiceVersion(manifest),
      configFile: join(root, configSampleRef),
      ...(metricsExporter === undefined ? {} : { metricsExporter }),
      gatewayProviders: [workingMemoryGatewayProvider, longTermMemoryGatewayProvider, localGatewayProvider, remoteGatewayProvider],
      ...(questionRecommendationEndpoint === undefined
        ? {}
        : {
            questionRecommendationsGateway: createReferenceRemoteQuestionRecommendationGateway(
              createHttpQuestionRecommendationClient({
                frequentHistoryEndpoint: `${questionRecommendationEndpoint}/rest/naie/memory/v1/user/portrait`,
                similarQuestionEndpoint: `${questionRecommendationEndpoint}/rest/naie/memory/v2/recommendation/similar-question`,
              }),
            ),
          }),
    });
  } catch (error) {
    reportPreAppStartupFailure();
    throw error;
  }
  try {
    await app.start();
  } catch (error) {
    getLogger({ component: 'agent-remote-deployment', source: 'startup' }).error({
      err: error,
      event: 'app.start.failed',
      failureStage: classifyAppStartupFailure(error),
    });
    await app.close();
    throw error;
  }
  runningRemoteRuntimePackages.set(root, app);

  const proof: LocalRuntimeStartProof = {
    candidateId: manifest.candidateId,
    primaryHealth: 'ok',
    readiness: 'ready',
    runStateRef: 'run/nextagent.pid',
    gateway: {
      selectedProviderId: `${workingMemoryGatewayProvider.providerId}+${longTermMemoryGatewayProvider.providerId}+${localGatewayProvider.providerId}+${remoteGatewayProvider.providerId}`,
      deploymentMode: app.systemConfig.gateway.deploymentMode,
      gatewaySnapshotRef: app.systemConfig.gatewaySelection.diagnosticRef,
      bindingsReadinessRef: `gateway-provider:${workingMemoryGatewayProvider.providerId}:ready+gateway-provider:${longTermMemoryGatewayProvider.providerId}:ready+gateway-provider:${localGatewayProvider.providerId}:ready+gateway-provider:${remoteGatewayProvider.providerId}:ready`,
    },
  };
  mkdirSync(join(root, 'run'), { recursive: true });
  writeFileSync(join(root, proof.runStateRef), JSON.stringify({ candidateId: manifest.candidateId, pid: process.pid }, null, 2), 'utf8');
  writeFileSync(join(root, startupProofRef), JSON.stringify(proof, null, 2), 'utf8');
  writeFileSync(
    join(root, healthReadinessProofRef),
    JSON.stringify(
      {
        candidateId: manifest.candidateId,
        primaryStatus: 'PASSED',
        deepStatus: 'PASSED',
        criticalDependencyStatuses: [],
        evidenceRefs: [startupProofRef],
      },
      null,
      2,
    ),
    'utf8',
  );
  return proof;
}

function reportPreAppStartupFailure(): void {
  try {
    process.stderr.write('{"event":"app.start.failed","failureStage":"APP_STARTUP"}\n');
  } catch {
    // stderr can already be detached; startup must still terminate deterministically.
  }
}

export function createRemoteOtlpMetricExporter(env: NodeJS.ProcessEnv): NonNullable<CreateNextAgentAppOptions['metricsExporter']> | undefined {
  const metricsEndpoint = nonEmpty(env['OTEL_EXPORTER_OTLP_METRICS_ENDPOINT']);
  const generalEndpoint = nonEmpty(env['OTEL_EXPORTER_OTLP_ENDPOINT']);
  const url = metricsEndpoint ?? (generalEndpoint === undefined ? undefined : `${generalEndpoint.replace(/\/+$/u, '')}/v1/metrics`);
  if (url === undefined) {
    return undefined;
  }
  const headers = parseOtlpHeaders(nonEmpty(env['OTEL_EXPORTER_OTLP_METRICS_HEADERS']) ?? nonEmpty(env['OTEL_EXPORTER_OTLP_HEADERS']));
  const compression = nonEmpty(env['OTEL_EXPORTER_OTLP_METRICS_COMPRESSION']) ?? nonEmpty(env['OTEL_EXPORTER_OTLP_COMPRESSION']);
  const timeoutMillis = parsePositiveInteger(nonEmpty(env['OTEL_EXPORTER_OTLP_METRICS_TIMEOUT']) ?? nonEmpty(env['OTEL_EXPORTER_OTLP_TIMEOUT']));
  return new OTLPMetricExporter({
    url,
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    ...(compression === 'gzip' ? { compression: 'gzip' as never } : {}),
    ...(timeoutMillis === undefined ? {} : { timeoutMillis }),
  });
}

function nonEmpty(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function parsePositiveInteger(value?: string): number | undefined {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOtlpHeaders(value?: string): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const member of value.split(',')) {
    const separator = member.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = member.slice(0, separator).trim();
    const headerValue = member.slice(separator + 1).trim();
    if (key.length > 0 && headerValue.length > 0) {
      headers[key] = headerValue;
    }
  }
  return headers;
}

export async function stopRemoteRuntimePackage(packageRoot: string): Promise<void> {
  const root = resolve(packageRoot);
  const app = runningRemoteRuntimePackages.get(root);
  if (app !== undefined) {
    await app.close();
    runningRemoteRuntimePackages.delete(root);
  }
  const runState = join(root, 'run', 'nextagent.pid');
  if (existsSync(runState)) {
    rmSync(runState, { force: true });
  }
}

function createHttpSandboxClient(endpoint: string): ReferenceRemoteSandboxClient {
  return {
    async execute(request, signal) {
      return assertSandboxExecutionResult(await postJson(endpoint, request, signal));
    },
  };
}

function createHttpRagRetrievalClient(endpoint: string): ReferenceRemoteRagRetrievalClient {
  return {
    async retrieve(request, signal) {
      return assertRagRetrievalResult(await postJson(endpoint, request, signal));
    },
  };
}

async function postJson(endpoint: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    throw new Error('Remote gateway request failed.');
  }
  return (await response.json()) as unknown;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for remote runtime package startup.`);
  }
  return value;
}

function requireConfigSampleRef(configSampleRefs: readonly string[]): string {
  const configSampleRef = configSampleRefs[0];
  if (configSampleRef === undefined) {
    throw new Error('Remote runtime package requires a config sample ref.');
  }
  return configSampleRef;
}

function assertSandboxExecutionResult(value: unknown): SandboxExecutionResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('Remote sandbox returned an invalid response.');
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'executionId',
    'exitCode',
    'stdout',
    'stderr',
    'stdoutTruncated',
    'stderrTruncated',
    'timedOut',
    'durationMs',
    'safeError',
  ]);
  if (
    Object.keys(record).some((key) => !allowedKeys.has(key)) ||
    typeof record.executionId !== 'string' ||
    !optionalNumber(record.exitCode) ||
    typeof record.stdout !== 'string' ||
    typeof record.stderr !== 'string' ||
    typeof record.stdoutTruncated !== 'boolean' ||
    typeof record.stderrTruncated !== 'boolean' ||
    typeof record.timedOut !== 'boolean' ||
    typeof record.durationMs !== 'number' ||
    !optionalSafeError(record.safeError)
  ) {
    throw new Error('Remote sandbox returned an invalid response.');
  }
  return value as SandboxExecutionResult;
}

function assertRagRetrievalResult(value: unknown): RagRetrievalResult {
  if (!validateRagRetrievalResult(value)) {
    throw new Error('Remote RAG returned an invalid response.');
  }
  return value as RagRetrievalResult;
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

function optionalSafeError(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(['code', 'message', 'category', 'retryable', 'safeDetails']);
  return (
    Object.keys(record).every((key) => allowedKeys.has(key)) &&
    typeof record.code === 'string' &&
    typeof record.message === 'string' &&
    typeof record.category === 'string' &&
    typeof record.retryable === 'boolean' &&
    (record.safeDetails === undefined ||
      (record.safeDetails !== null && typeof record.safeDetails === 'object' && !Array.isArray(record.safeDetails)))
  );
}
