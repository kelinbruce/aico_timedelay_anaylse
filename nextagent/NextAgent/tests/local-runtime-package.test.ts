import {
  checkLocalRuntimePackageLayout,
  createAppCredentialResolver,
  createLocalRuntimePackageEvidence,
  createLocalRuntimePackageManifest,
  createRuntimePackageServiceVersion,
  parseBuiltInConfig,
  readLocalRuntimePackageManifest,
  runLocalRuntimePackageSelfCheck,
  safeDiagnosticMessage,
  stageLocalRuntimePackage,
  startLocalRuntimePackage,
  startRuntimePackage,
  stopLocalRuntimePackage,
  validateLocalRuntimePackageConfigSample,
  validateLocalRuntimePackageManifest,
} from '@nextagent/agent-app/testing';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dump as stringifyYaml } from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let previousOpenAIKey: string | undefined;
let previousOpenAIModelName: string | undefined;
let previousOpenAIBaseUrl: string | undefined;
const localRuntimePackageIt = (process.platform === 'win32' || process.platform === 'linux') && process.arch === 'x64' ? it : it.skip;

describe('runtime package service version', () => {
  it('is stable per candidate and differs across candidates sharing a product version', () => {
    const first = createRuntimePackageServiceVersion({ version: '1.0.0', candidateId: 'candidate-a' });
    const replay = createRuntimePackageServiceVersion({ version: '1.0.0', candidateId: 'candidate-a' });
    const second = createRuntimePackageServiceVersion({ version: '1.0.0', candidateId: 'candidate-b' });
    const bounded = createRuntimePackageServiceVersion({ version: '1.0.0', candidateId: 'x'.repeat(200) });

    expect(first).toBe('1.0.0+candidate-a');
    expect(replay).toBe(first);
    expect(second).not.toBe(first);
    expect(bounded).toMatch(/^build-[a-f0-9]{24}$/u);
    expect(bounded.length).toBeLessThanOrEqual(64);
  });
});

interface TestRuntimePackageConfig {
  deployment: {
    mode: string;
    deploymentEntrypointRefs?: Partial<Record<'LOCAL' | 'REMOTE', { module: string; exportName: string }>>;
  };
  paths: Record<string, string>;
  auth: Record<string, unknown>;
  channel: Record<string, unknown>;
  hostedAgent: Record<string, unknown>;
  modelProfiles: Array<Record<string, unknown>>;
  observability?: {
    tracing?: {
      endpoint: string;
      authPkRef: string;
      authSkRef: string;
      serviceName?: string;
    };
  };
  gateway: {
    gateways: Array<{ gatewayId: string; gatewayKind: string; deploymentMode: string; sqliteFileRef?: string }>;
  };
  noopBoundaries: Record<string, string>;
}

describe('local runtime package', () => {
  beforeEach(() => {
    previousOpenAIKey = process.env.OPENAI_API_KEY;
    previousOpenAIModelName = process.env.OPENAI_MODEL_NAME;
    previousOpenAIBaseUrl = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_API_KEY = 'test-only';
    process.env.OPENAI_MODEL_NAME = 'MiniMax-M2.7';
    process.env.OPENAI_BASE_URL = 'https://api.minimaxi.com/v1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousOpenAIKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousOpenAIKey;
    }
    if (previousOpenAIModelName === undefined) {
      delete process.env.OPENAI_MODEL_NAME;
    } else {
      process.env.OPENAI_MODEL_NAME = previousOpenAIModelName;
    }
    if (previousOpenAIBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = previousOpenAIBaseUrl;
    }
  });

  localRuntimePackageIt('stages a backend-only candidate manifest, layout, startup proof, and qualification evidence', async () => {
    const packageRoot = await createTempPackage();
    try {
      const port = await freePort();
      const manifest = stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-001',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        platform: 'win32',
        arch: 'x64',
        nodeVersion: 'v22.1.0',
        configSampleContent: JSON.stringify(rawConfig(port), null, 2),
      });

      expect(manifest).toMatchObject({
        candidateId: 'local-candidate-001',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        platform: 'win32',
        arch: 'x64',
        nodeVersion: 'v22.1.0',
        layoutVersion: 'local-runtime-package.v1',
        entrypointRefs: {
          start: 'bin/nextagent-start',
          stop: 'bin/nextagent-stop',
          selfCheck: 'bin/nextagent-self-check',
        },
        deploymentEntrypointRefs: {
          LOCAL: {
            module: 'backend/agent-app/local-runtime-package/index.js',
            exportName: 'startLocalRuntimePackage',
          },
        },
        configSampleRefs: ['config/default-system.yaml'],
        packageArchiveRef: 'evidence:local-runtime-package-archive:local-candidate-001',
      });
      const configContent = readFileSync(join(packageRoot, 'config', 'default-system.yaml'), 'utf8');
      expect(() => JSON.parse(configContent)).toThrow();
      const configSample = parseBuiltInConfig(configContent) as ReturnType<typeof rawConfig>;
      expect(configSample.paths).toMatchObject({ agentRoot: 'agents', skillRoot: 'skills' });
      expect(configSample.modelProfiles[0]).toMatchObject({
        providerId: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com/v1',
        credentialRef: 'env:OPENAI_API_KEY',
        models: [{ modelId: 'env:OPENAI_MODEL_NAME' }],
      });
      expect(configSample.gateway.gateways.every((gateway: { deploymentMode?: string }) => gateway.deploymentMode === 'LOCAL')).toBe(true);
      expect(readFileSync(join(packageRoot, 'bin', 'nextagent-start'), 'utf8')).toContain(
        'process.env.NEXTAGENT_CONFIG_DIR ??= resolve(packageRoot, "config")',
      );
      expect(readFileSync(join(packageRoot, 'bin', 'nextagent-start'), 'utf8')).toContain('await startRuntimePackage(packageRoot)');
      expect(readFileSync(join(packageRoot, 'bin', 'nextagent-start.cmd'), 'utf8')).toContain('%~dp0nextagent-start');
      expect(readFileSync(join(packageRoot, 'bin', 'nextagent-stop'), 'utf8')).toContain('await stopLocalRuntimePackage(packageRoot)');
      expect(readFileSync(join(packageRoot, 'bin', 'nextagent-self-check'), 'utf8')).toContain(
        'process.env.NEXTAGENT_CONFIG_DIR ??= resolve(packageRoot, "config")',
      );
      expect(readFileSync(join(packageRoot, 'bin', 'nextagent-self-check'), 'utf8')).toContain('runLocalRuntimePackageSelfCheck');
      expect(readFileSync(join(packageRoot, 'bin', 'nextagent-self-check'), 'utf8')).not.toContain('console.');
      expect(existsSync(join(packageRoot, 'recipes'))).toBe(false);
      expect(existsSync(join(packageRoot, 'agents'))).toBe(true);
      expect(JSON.stringify(manifest)).not.toContain(packageRoot);
      expect(JSON.stringify(manifest)).not.toContain('OPENAI_API_KEY=');

      expect(readLocalRuntimePackageManifest(packageRoot)).toEqual(manifest);
      expect(checkLocalRuntimePackageLayout(packageRoot)).toEqual([]);
      expect(validateLocalRuntimePackageConfigSample(packageRoot)).toEqual([]);

      const proof = await startRuntimePackage(packageRoot);
      expect(proof).toEqual({
        candidateId: 'local-candidate-001',
        primaryHealth: 'ok',
        readiness: 'ready',
        runStateRef: 'run/nextagent.pid',
        gateway: {
          selectedProviderId: 'local-gateway',
          deploymentMode: 'LOCAL',
          gatewaySnapshotRef: 'gateway',
          bindingsReadinessRef: 'gateway-provider:local-gateway:ready',
        },
      });
      expect(existsSync(join(packageRoot, 'run', 'nextagent.pid'))).toBe(true);
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/sessions`);
      expect(response.status).toBe(200);
      const workbenchPage = await fetch(`http://127.0.0.1:${port}/__nextagent/dev/workbench`);
      expect(workbenchPage.status).toBe(200);
      expect(await workbenchPage.text()).toContain('Agent Dev Workbench');
      const workbenchSessions = await fetch(`http://127.0.0.1:${port}/__nextagent/dev/workbench/api/sessions`);
      expect(workbenchSessions.status).toBe(200);
      expect(await workbenchSessions.json()).toMatchObject({
        entries: [],
        detailAvailability: { status: 'available' },
      });

      expect(createLocalRuntimePackageEvidence(packageRoot)).toEqual({
        candidateId: 'local-candidate-001',
        packageProfile: 'backend-only',
        manifestRef: 'candidate-manifest.json',
        layoutCheckRef: 'run/layout-check.json',
        configValidationEvidenceRef: 'run/config-validation-evidence.json',
        startupProofRef: 'run/startup-proof.json',
        healthReadinessProofRef: 'run/health-readiness-proof.json',
        evidenceRefs: [
          'candidate-manifest.json',
          'run/layout-check.json',
          'run/config-validation-evidence.json',
          'run/startup-proof.json',
          'run/health-readiness-proof.json',
        ],
      });

      await stopLocalRuntimePackage(packageRoot);
      expect(existsSync(join(packageRoot, 'run', 'nextagent.pid'))).toBe(false);
      const localEvidenceFiles = readdirSync(join(packageRoot, 'logs'));
      const operationalFile = localEvidenceFiles.find((name) => /^nextagent-operational\.log\.\d+\.jsonl$/u.test(name));
      const auditFile = localEvidenceFiles.find((name) => /^nextagent-audit\.\d{4}-\d{2}-\d{2}\.\d+\.ndjson$/u.test(name));
      const metricsFile = localEvidenceFiles.find((name) => /^nextagent-metrics\.\d{4}-\d{2}-\d{2}\.\d+\.ndjson$/u.test(name));
      expect({ operationalFile, auditFile, metricsFile }).toEqual({
        operationalFile: expect.any(String),
        auditFile: expect.any(String),
        metricsFile: expect.any(String),
      });
      const operationalEvidence = readFileSync(join(packageRoot, 'logs', operationalFile!), 'utf8');
      expect(operationalEvidence).toContain('"serviceVersion":"0.1.0+local-candidate-001"');
      expect(operationalEvidence).not.toContain('request_outcome_total');
      expect(operationalEvidence).not.toContain('"schemaVersion":1');
      expect(readFileSync(join(packageRoot, 'logs', auditFile!), 'utf8')).not.toContain('request_outcome_total');
      const metricsEvidence = readFileSync(join(packageRoot, 'logs', metricsFile!), 'utf8');
      expect(metricsEvidence).toContain('"metrics":');
      expect(metricsEvidence).toContain('"service.version":"0.1.0+local-candidate-001"');
      expect(localEvidenceFiles).not.toEqual(expect.arrayContaining(['nextagent-audit.log', 'nextagent-runtime.log', 'nextagent-observability.log']));
      await expect(fetch(`http://127.0.0.1:${port}/api/v1/sessions`)).rejects.toThrow();
    } finally {
      await stopLocalRuntimePackage(packageRoot);
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('stages a model-gateway-only manifest from a compatible config sample', async () => {
    const packageRoot = await createTempPackage();
    try {
      const config = rawConfig();
      config.modelProfiles = [
        {
          providerId: 'model-gateway',
          models: [
            {
              modelId: 'MiniMax-M2.7',
              contextWindowTokens: 128_000,
              fallbackEligible: false,
            },
          ],
        },
      ];
      const manifest = stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-gateway-only-001',
        version: '0.1.0',
        buildTime: '2026-08-22T00:00:00.000Z',
        packageProfile: 'backend-only',
        modelProviderProfile: 'model-gateway-only',
        configSampleContent: JSON.stringify(config),
      });

      expect(manifest.modelProviderProfile).toBe('model-gateway-only');
      expect(readLocalRuntimePackageManifest(packageRoot)).toEqual(manifest);
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  });

  localRuntimePackageIt('rejects an OpenAI-compatible config for a model-gateway-only package', async () => {
    const packageRoot = await createTempPackage();
    try {
      expect(() =>
        stageLocalRuntimePackage({
          packageRoot,
          candidateId: 'local-gateway-only-002',
          version: '0.1.0',
          buildTime: '2026-08-22T00:00:00.000Z',
          packageProfile: 'backend-only',
          modelProviderProfile: 'model-gateway-only',
          configSampleContent: JSON.stringify(rawConfig()),
        }),
      ).toThrowError(expect.objectContaining({ code: 'MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE' }));
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  });

  localRuntimePackageIt('rejects a tampered OpenAI-compatible config during model-gateway-only self-check', async () => {
    const packageRoot = await createTempPackage();
    try {
      const config = rawConfig();
      config.modelProfiles = [
        {
          providerId: 'model-gateway',
          models: [
            {
              modelId: 'MiniMax-M2.7',
              contextWindowTokens: 128_000,
              fallbackEligible: false,
            },
          ],
        },
      ];
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-gateway-only-003',
        version: '0.1.0',
        buildTime: '2026-08-22T00:00:00.000Z',
        packageProfile: 'backend-only',
        modelProviderProfile: 'model-gateway-only',
        configSampleContent: JSON.stringify(config),
      });
      const packagedConfig = parseBuiltInConfig(readFileSync(join(packageRoot, 'config', 'default-system.yaml'), 'utf8')) as ReturnType<
        typeof rawConfig
      >;
      packagedConfig.modelProfiles = rawConfig().modelProfiles;
      writeFileSync(join(packageRoot, 'config', 'default-system.yaml'), stringifyYaml(packagedConfig), 'utf8');

      expect(validateLocalRuntimePackageConfigSample(packageRoot)).toEqual([
        expect.objectContaining({ code: 'MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE' }),
      ]);
      expect(runLocalRuntimePackageSelfCheck(packageRoot)).toBe(1);
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  });

  localRuntimePackageIt('uses the active Agent definition from the packaged agents directory', async () => {
    const packageRoot = await createTempPackage();
    try {
      const port = await freePort();
      const config = rawConfig(port);
      config.hostedAgent = { activeAgentId: 'custom-agent' };
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-renamed-agent',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(config, null, 2),
      });
      expect(existsSync(join(packageRoot, 'config', 'default-agent.yaml'))).toBe(false);
      mkdirSync(join(packageRoot, 'agents', 'custom-agent'), { recursive: true });
      writeFileSync(
        join(packageRoot, 'agents', 'custom-agent', 'agent.yaml'),
        JSON.stringify(
          {
            agentId: 'custom-agent',
            agentVersion: 'v1',
            displayName: 'Custom agent',
            description: 'Custom packaged agent.',
            modelIds: ['MiniMax-M2.7'],
            capabilityBindings: [],
            runtimeSettings: {
              defaultLanguage: 'zh-CN',

              maxTurns: 1,
              maxToolCallsPerTurn: 30,
              requestTimeoutMs: 1_800_000,
            },
            resources: [],
          },
          null,
          2,
        ),
        'utf8',
      );

      const proof = await startLocalRuntimePackage(packageRoot);
      expect(proof.candidateId).toBe('local-candidate-renamed-agent');
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/sessions`);
      expect(response.status).toBe(200);
    } finally {
      await stopLocalRuntimePackage(packageRoot);
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('reuses one validated package config fact for direct and deployment-dispatch local starts', async () => {
    for (const [candidateId, start] of [
      ['local-candidate-single-read-direct', startLocalRuntimePackage],
      ['local-candidate-single-read-dispatch', startRuntimePackage],
    ] as const) {
      const packageRoot = await createTempPackage();
      try {
        const port = await freePort();
        stageLocalRuntimePackage({
          packageRoot,
          candidateId,
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          configSampleContent: JSON.stringify(rawConfig(port), null, 2),
        });

        const startup = start(packageRoot);
        writeFileSync(join(packageRoot, 'config', 'default-system.yaml'), '{ invalid after package preparation', 'utf8');

        await expect(startup).resolves.toMatchObject({ candidateId, readiness: 'ready' });
        expect((await fetch(`http://127.0.0.1:${port}/api/v1/sessions`)).status).toBe(200);
      } finally {
        await stopLocalRuntimePackage(packageRoot);
        await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      }
    }
  });

  localRuntimePackageIt('creates the operational writer before optional trace initialization and degrades invalid trace credentials', async () => {
    const traceEnv = {
      endpoint: 'NEXTAGENT_TEST_PACKAGE_TRACE_ENDPOINT',
      authPk: 'NEXTAGENT_TEST_PACKAGE_TRACE_PK',
      authSk: 'NEXTAGENT_TEST_PACKAGE_TRACE_SK',
    } as const;
    for (const key of Object.values(traceEnv)) {
      delete process.env[key];
    }
    for (const [candidateId, ready, expectedEvent] of [
      ['local-candidate-trace-invalid', false, '"failureStage":"credential_resolution"'],
      ['local-candidate-trace-ready', true, '"event":"otel.trace.init.completed"'],
    ] as const) {
      const packageRoot = await createTempPackage();
      try {
        const port = await freePort();
        const config = rawConfig(port);
        config.observability = {
          tracing: {
            endpoint: `env:${traceEnv.endpoint}`,
            authPkRef: `env:${traceEnv.authPk}`,
            authSkRef: `env:${traceEnv.authSk}`,
            serviceName: 'nextagent-package-test',
          },
        };
        if (ready) {
          process.env[traceEnv.endpoint] = 'http://127.0.0.1:4318/v1/traces';
          process.env[traceEnv.authPk] = 'test-pk';
          process.env[traceEnv.authSk] = 'test-sk';
        }
        stageLocalRuntimePackage({
          packageRoot,
          candidateId,
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          configSampleContent: JSON.stringify(config, null, 2),
        });

        await startLocalRuntimePackage(packageRoot);
        await stopLocalRuntimePackage(packageRoot);

        const operationalFile = readdirSync(join(packageRoot, 'logs')).find((name) => /^nextagent-operational\.log\.\d+\.jsonl$/u.test(name));
        expect(operationalFile).toBeDefined();
        const operationalEvidence = readFileSync(join(packageRoot, 'logs', operationalFile!), 'utf8');
        expect(operationalEvidence).toContain(expectedEvent);
        expect(operationalEvidence).not.toContain('NEXTAGENT_TEST_PACKAGE_TRACE');
      } finally {
        await stopLocalRuntimePackage(packageRoot);
        await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        for (const key of Object.values(traceEnv)) {
          delete process.env[key];
        }
      }
    }
  });

  localRuntimePackageIt('selects startup script from deployment mode and blocks remote packages without a remote entrypoint', async () => {
    const packageRoot = await createTempPackage();
    try {
      const config = rawConfig();
      config.deployment.mode = 'REMOTE';
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'remote-candidate-missing-entrypoint',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(config, null, 2),
      });

      expect(validateLocalRuntimePackageConfigSample(packageRoot)).toEqual([]);
      await expect(startRuntimePackage(packageRoot)).rejects.toThrow(/selected deployment entrypoint is missing/u);
      const startupProof = readFileSync(join(packageRoot, 'run', 'startup-proof.json'), 'utf8');
      expect(startupProof).toContain('deployment-entrypoint-missing');
      expect(startupProof).not.toContain(packageRoot);
      expect(existsSync(join(packageRoot, 'run', 'nextagent.pid'))).toBe(false);
    } finally {
      await stopLocalRuntimePackage(packageRoot);
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('rejects unsafe deployment entrypoints declared by package config', async () => {
    const packageRoot = await createTempPackage();
    try {
      const config = rawConfig();
      config.deployment.mode = 'REMOTE';
      config.deployment.deploymentEntrypointRefs = {
        REMOTE: {
          module: resolve(packageRoot, 'vendor', 'gateway-remote-entrypoint.mjs'),
          exportName: 'startRemoteRuntimePackage',
        },
      };
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'remote-candidate-unsafe-config-entrypoint',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(config, null, 2),
      });

      expect(validateLocalRuntimePackageConfigSample(packageRoot)).toEqual([]);
      await expect(startRuntimePackage(packageRoot)).rejects.toThrow(/package-root relative/u);
      expect(existsSync(join(packageRoot, 'run', 'nextagent.pid'))).toBe(false);
    } finally {
      await stopLocalRuntimePackage(packageRoot);
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt(
    'starts a remote runtime package through a packaged gateway-remote entrypoint',
    async () => {
      const packageRoot = await createTempPackage();
      try {
        const port = await freePort();
        const config = rawConfig(port);
        config.deployment.mode = 'REMOTE';
        config.deployment.deploymentEntrypointRefs = {
          REMOTE: {
            module: './vendor/gateway-remote-entrypoint.mjs',
            exportName: 'startRemoteRuntimePackage',
          },
        };
        config.gateway.gateways = [
          { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
          { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
          { gatewayId: 'remote-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
        ];
        stageLocalRuntimePackage({
          packageRoot,
          candidateId: 'remote-candidate-gateway-entrypoint',
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          configSampleContent: JSON.stringify(config, null, 2),
        });
        writeRemoteGatewayEntrypoint(packageRoot);

        expect(validateLocalRuntimePackageConfigSample(packageRoot)).toEqual([]);
        const proof = await startRuntimePackage(packageRoot);
        expect(proof).toEqual({
          candidateId: 'remote-candidate-gateway-entrypoint',
          primaryHealth: 'ok',
          readiness: 'ready',
          runStateRef: 'run/nextagent.pid',
          gateway: {
            selectedProviderId: 'local-working-memory-gateway+local-long-term-memory-gateway+remote-support-local-gateway+vendor-remote',
            deploymentMode: 'REMOTE',
            gatewaySnapshotRef: 'gateway',
            bindingsReadinessRef:
              'gateway-provider:local-working-memory-gateway:ready+gateway-provider:local-long-term-memory-gateway:ready+gateway-provider:remote-support-local-gateway:ready+gateway-provider:vendor-remote:ready',
          },
        });
        expect(JSON.parse(readFileSync(join(packageRoot, 'run', 'startup-proof.json'), 'utf8'))).toEqual(proof);
        expect(existsSync(join(packageRoot, 'run', 'nextagent.pid'))).toBe(true);
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/sessions`);
        expect(response.status).toBe(200);
      } finally {
        await stopRemoteRuntimePackage(packageRoot);
        await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      }
    },
    15_000,
  );

  localRuntimePackageIt(
    'starts a remote runtime package through a package-local remote deployment package',
    async () => {
      const packageRoot = await createTempPackage();
      try {
        const port = await freePort();
        const config = rawConfig(port);
        config.deployment.mode = 'REMOTE';
        config.deployment.deploymentEntrypointRefs = {
          REMOTE: {
            module: '@nextagent/agent-remote-deployment',
            exportName: 'startRemoteRuntimePackage',
          },
        };
        config.gateway.gateways = [
          { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
          { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
          { gatewayId: 'remote-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
        ];
        stageLocalRuntimePackage({
          packageRoot,
          candidateId: 'remote-candidate-two-packages',
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          configSampleContent: JSON.stringify(config, null, 2),
        });
        writeNextAgentPackageProxies(packageRoot);
        writeRemoteDeploymentPackage(packageRoot);

        expect(validateLocalRuntimePackageConfigSample(packageRoot)).toEqual([]);
        const proof = await startRuntimePackage(packageRoot);
        expect(proof).toEqual({
          candidateId: 'remote-candidate-two-packages',
          primaryHealth: 'ok',
          readiness: 'ready',
          runStateRef: 'run/nextagent.pid',
          gateway: {
            selectedProviderId: 'local-working-memory-gateway+local-long-term-memory-gateway+remote-support-local-gateway+vendor-remote',
            deploymentMode: 'REMOTE',
            gatewaySnapshotRef: 'gateway',
            bindingsReadinessRef:
              'gateway-provider:local-working-memory-gateway:ready+gateway-provider:local-long-term-memory-gateway:ready+gateway-provider:remote-support-local-gateway:ready+gateway-provider:vendor-remote:ready',
          },
        });
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/sessions`);
        expect(response.status).toBe(200);
      } finally {
        await stopRemoteDeploymentPackage(packageRoot);
        await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      }
    },
    15_000,
  );

  localRuntimePackageIt('stages package.json with version and type module, and fails layout when it is missing', async () => {
    const packageRoot = await createTempPackage();
    try {
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-package-json',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(rawConfig()),
      });

      const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
      expect(pkg.version).toBe('0.1.0');
      expect(pkg.type).toBe('module');

      rmSync(join(packageRoot, 'package.json'), { force: true });
      const diagnostics = checkLocalRuntimePackageLayout(packageRoot);
      expect(diagnostics.map((d) => d.message)).toContain('package.json is required.');
    } finally {
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('rejects raw secrets and unsafe package refs without leaking diagnostics', async () => {
    const packageRoot = await createTempPackage();
    try {
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-002',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(rawConfig()),
      });
      const config = parseBuiltInConfig(readFileSync(join(packageRoot, 'config', 'default-system.yaml'), 'utf8')) as ReturnType<typeof rawConfig>;
      config.modelProfiles[0]!.credentialRef = 'sk-secret-value';
      writeFileSync(join(packageRoot, 'config', 'default-system.yaml'), stringifyYaml(config), 'utf8');

      const diagnostics = validateLocalRuntimePackageConfigSample(packageRoot);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe('invalid-config-sample');
      expect(diagnostics[0]?.message).not.toContain('sk-secret-value');
      expect(diagnostics[0]?.message).not.toContain(packageRoot);

      expect(() =>
        createLocalRuntimePackageManifest({
          candidateId: 'bad/../candidate',
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
        }),
      ).toThrow(/safe id/u);
      expect(() =>
        createLocalRuntimePackageManifest({
          candidateId: 'valid-candidate',
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          evidenceRefs: ['../outside'],
        }),
      ).toThrow(/package-root relative/u);
      expect(() =>
        createLocalRuntimePackageManifest({
          candidateId: 'valid-candidate',
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          evidenceRefs: ['run/sk-secret-value'],
        }),
      ).toThrow(/safe package ref/u);
      expect(() =>
        createLocalRuntimePackageManifest({
          candidateId: 'valid-candidate',
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          evidenceRefs: ['run/provider-payload.json'],
        }),
      ).toThrow(/safe package ref/u);
      expect(() =>
        createLocalRuntimePackageManifest({
          candidateId: 'valid-candidate',
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          platform: 'darwin',
          arch: 'x64',
        }),
      ).toThrow(/Unsupported local runtime package platform/u);
      expect(() =>
        createLocalRuntimePackageManifest({
          candidateId: 'valid-candidate',
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          platform: 'linux',
          arch: 'arm64',
        }),
      ).toThrow(/Unsupported local runtime package platform/u);
      expect(() =>
        createLocalRuntimePackageManifest({
          candidateId: 'valid-candidate',
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          platform: 'linux',
          arch: 'x64',
          nodeVersion: '22.1.0',
        }),
      ).toThrow(/nodeVersion/u);
      expect(() => validateLocalRuntimePackageManifest({ candidateId: 'candidate-without-entrypoints' })).toThrow(
        /entrypointRefs must be an object/u,
      );
    } finally {
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('blocks package config evidence and startup when active secrets are unresolved', async () => {
    const packageRoot = await createTempPackage();
    try {
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-secret-missing',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(rawConfig()),
      });
      const config = parseBuiltInConfig(readFileSync(join(packageRoot, 'config', 'default-system.yaml'), 'utf8')) as ReturnType<typeof rawConfig>;
      config.modelProfiles[0]!.credentialRef = 'env:NEXTAGENT_MISSING_PACKAGE_SECRET';
      writeFileSync(join(packageRoot, 'config', 'default-system.yaml'), stringifyYaml(config), 'utf8');

      const diagnostics = validateLocalRuntimePackageConfigSample(packageRoot);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe('invalid-config-sample');
      expect(diagnostics[0]?.message).not.toContain('NEXTAGENT_MISSING_PACKAGE_SECRET');
      await expect(startLocalRuntimePackage(packageRoot)).rejects.toThrow(/cannot start/u);
      expect(readFileSync(join(packageRoot, 'run', 'startup-proof.json'), 'utf8')).toContain('invalid-config-sample');
      expect(existsSync(join(packageRoot, 'run', 'nextagent.pid'))).toBe(false);
    } finally {
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('applies channel environment overrides before validating a package config sample', async () => {
    const packageRoot = await createTempPackage();
    const env: NodeJS.ProcessEnv = {
      OPENAI_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7',
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
      NEXTAGENT_CHANNEL_HOST: '::1',
      NEXTAGENT_CHANNEL_PORT: '3100',
    };
    try {
      const config = rawConfig();
      config.channel = { transport: 'fastify', host: '', port: 70_000 };
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-channel-env',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(config),
      });

      expect(validateLocalRuntimePackageConfigSample(packageRoot, undefined, createAppCredentialResolver(env), env)).toEqual([]);

      delete env.NEXTAGENT_CHANNEL_PORT;
      config.channel = { transport: 'fastify', host: '', port: 3000 };
      writeFileSync(join(packageRoot, 'config', 'default-system.yaml'), stringifyYaml(config), 'utf8');
      expect(validateLocalRuntimePackageConfigSample(packageRoot, undefined, createAppCredentialResolver(env), env)).toEqual([]);

      delete env.NEXTAGENT_CHANNEL_HOST;
      config.channel = { transport: 'fastify', host: '127.0.0.1', port: 3000 };
      writeFileSync(join(packageRoot, 'config', 'default-system.yaml'), stringifyYaml(config), 'utf8');
      expect(validateLocalRuntimePackageConfigSample(packageRoot, undefined, createAppCredentialResolver(env), env)).toEqual([]);
    } finally {
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt.each(['', '0', '65536', '+3100', ' 3100', '3100 ', 'not-a-port'])(
    'rejects invalid package channel port environment override %j without exposing it',
    async (invalidPort) => {
      const packageRoot = await createTempPackage();
      const env: NodeJS.ProcessEnv = {
        OPENAI_API_KEY: 'test-only',
        OPENAI_MODEL_NAME: 'MiniMax-M2.7',
        OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
        NEXTAGENT_CHANNEL_PORT: invalidPort,
      };
      try {
        stageLocalRuntimePackage({
          packageRoot,
          candidateId: 'local-candidate-channel-env-invalid',
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          configSampleContent: JSON.stringify(rawConfig()),
        });

        const diagnostics = validateLocalRuntimePackageConfigSample(packageRoot, undefined, createAppCredentialResolver(env), env);
        expect(diagnostics).toHaveLength(1);
        expect(JSON.stringify(diagnostics)).not.toContain(invalidPort || 'NEXTAGENT_CHANNEL_PORT');
      } finally {
        await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      }
    },
  );

  localRuntimePackageIt('rejects workspace paths that point into package system directories', async () => {
    const packageRoot = await createTempPackage();
    try {
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-003',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify({ ...rawConfig(), paths: { workspaceRoot: 'data' } }),
      });

      const diagnostics = validateLocalRuntimePackageConfigSample(packageRoot);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Workspace root must not point to package system directory data.');
      await expect(startLocalRuntimePackage(packageRoot)).rejects.toThrow(/cannot start/u);
    } finally {
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('fails layout validation when required package directories or refs are missing', async () => {
    const packageRoot = await createTempPackage();
    try {
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-004',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(rawConfig()),
      });
      rmSync(join(packageRoot, 'bin'), { recursive: true, force: true });
      const diagnostics = checkLocalRuntimePackageLayout(packageRoot);
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('missing-directory');
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('missing-package-ref');
      expect(() => createLocalRuntimePackageEvidence(packageRoot)).toThrow(/valid layout/u);
    } finally {
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('validates configured agent and skill roots instead of hard-coded resource directories', async () => {
    const packageRoot = await createTempPackage();
    try {
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-custom-skill-root',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(rawConfig()),
      });
      const configPath = join(packageRoot, 'config', 'default-system.yaml');
      const config = parseBuiltInConfig(readFileSync(configPath, 'utf8')) as TestRuntimePackageConfig;
      config.paths.agentRoot = 'abc/agents';
      config.paths.skillRoot = 'abc/skills';
      writeFileSync(configPath, stringifyYaml(config), 'utf8');
      mkdirSync(join(packageRoot, 'abc', 'agents'), { recursive: true });
      mkdirSync(join(packageRoot, 'abc', 'skills'), { recursive: true });
      rmSync(join(packageRoot, 'agents'), { recursive: true, force: true });
      rmSync(join(packageRoot, 'skills'), { recursive: true, force: true });

      expect(checkLocalRuntimePackageLayout(packageRoot)).toEqual([]);

      rmSync(join(packageRoot, 'abc', 'skills'), { recursive: true, force: true });
      expect(checkLocalRuntimePackageLayout(packageRoot)).toContainEqual(
        expect.objectContaining({ code: 'missing-directory', message: 'abc/skills is required.' }),
      );
      mkdirSync(join(packageRoot, 'abc', 'skills'), { recursive: true });
      rmSync(join(packageRoot, 'abc', 'agents'), { recursive: true, force: true });
      expect(checkLocalRuntimePackageLayout(packageRoot)).toContainEqual(
        expect.objectContaining({ code: 'missing-directory', message: 'abc/agents is required.' }),
      );
    } finally {
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('blocks release handoff when mandatory package evidence is missing', async () => {
    const packageRoot = await createTempPackage();
    try {
      const port = await freePort();
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-missing-evidence',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(rawConfig(port)),
      });

      expect(() => createLocalRuntimePackageEvidence(packageRoot)).toThrow(/startup proof and health\/readiness proof/u);
      await startLocalRuntimePackage(packageRoot);
      rmSync(join(packageRoot, 'run', 'health-readiness-proof.json'), { force: true });
      expect(() => createLocalRuntimePackageEvidence(packageRoot)).toThrow(/startup proof and health\/readiness proof/u);
    } finally {
      await stopLocalRuntimePackage(packageRoot);
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('rejects candidate evidence that does not belong to the manifest candidate or did not pass startup', async () => {
    const packageRoot = await createTempPackage();
    try {
      const port = await freePort();
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-evidence-owner',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(rawConfig(port)),
      });
      await startLocalRuntimePackage(packageRoot);
      writeFileSync(join(packageRoot, 'run', 'startup-proof.json'), JSON.stringify({ candidateId: 'other-candidate', started: false }), 'utf8');

      expect(() => createLocalRuntimePackageEvidence(packageRoot)).toThrow(/startup proof and health\/readiness proof/u);
    } finally {
      await stopLocalRuntimePackage(packageRoot);
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt(
    'validates a zip-extracted package root without using the staging root',
    async () => {
      const stagingRoot = await createTempPackage();
      const extractedRoot = await createTempPackage();
      try {
        stageLocalRuntimePackage({
          packageRoot: stagingRoot,
          candidateId: 'local-candidate-extracted-root',
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          packageArchiveRef: 'evidence:local-runtime-package-archive:local-candidate-extracted-root',
          configSampleContent: JSON.stringify(rawConfig()),
        });
        const archivePath = `${stagingRoot}.zip`;
        compressPackageRoot(stagingRoot, archivePath);
        expandPackageArchive(archivePath, extractedRoot);
        rmSync(stagingRoot, { recursive: true, force: true });

        const manifest = readLocalRuntimePackageManifest(extractedRoot);
        expect(manifest.candidateId).toBe('local-candidate-extracted-root');
        expect(manifest.packageArchiveRef).toBe('evidence:local-runtime-package-archive:local-candidate-extracted-root');
        expect(JSON.stringify(manifest)).not.toContain(stagingRoot);
        expect(checkLocalRuntimePackageLayout(extractedRoot)).toEqual([]);
        expect(validateLocalRuntimePackageConfigSample(extractedRoot)).toEqual([]);
      } finally {
        await rm(stagingRoot, { recursive: true, force: true });
        await rm(`${stagingRoot}.zip`, { force: true });
        await rm(extractedRoot, { recursive: true, force: true });
      }
    },
    15_000,
  );
  localRuntimePackageIt('handles startup and stop negative paths safely', async () => {
    const packageRoot = await createTempPackage();
    try {
      const port = await freePort();
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-negative-start',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(rawConfig(port)),
      });

      const portHolder = await holdPort(port);
      await expect(startLocalRuntimePackage(packageRoot)).rejects.toMatchObject({
        code: 'APP_START_FAILED',
        category: 'INTERNAL',
        retryable: false,
        safeDetails: { failureStage: 'SERVER_LISTEN' },
      });
      await closeServer(portHolder);
      const portFailure = readFileSync(join(packageRoot, 'run', 'startup-proof.json'), 'utf8');
      expect(portFailure).toContain('startup-failed');
      expect(portFailure).not.toContain(packageRoot);
      const operationalFile = readdirSync(join(packageRoot, 'logs')).find((name) => /^nextagent-operational\.log\.\d+\.jsonl$/u.test(name));
      expect(operationalFile).toBeDefined();
      const runtimeLog = readFileSync(join(packageRoot, 'logs', operationalFile!), 'utf8');
      const runtimeEntries = runtimeLog
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(runtimeEntries.find((entry) => entry['event'] === 'app.server.listen.started')).toBeDefined();
      const startFailureEntry = runtimeEntries.find((entry) => entry['event'] === 'app.start.failed');
      expect(startFailureEntry).toMatchObject({
        failureStage: 'SERVER_LISTEN',
        safeReasonCode: 'APP_START_FAILED',
        safeErrorCategory: 'INTERNAL',
        retryable: false,
        exceptionCause: {
          exceptionType: 'Error',
          exceptionCode: 'EADDRINUSE',
        },
        rawExceptionData: {
          cause: {
            code: 'EADDRINUSE',
            port,
          },
        },
      });
      const proof = await startLocalRuntimePackage(packageRoot);
      expect(proof.candidateId).toBe('local-candidate-negative-start');
      await expect(startLocalRuntimePackage(packageRoot)).rejects.toThrow(/already running/u);

      await stopLocalRuntimePackage(packageRoot);
      mkdirSync(join(packageRoot, 'config', 'preserved'), { recursive: true });
      mkdirSync(join(packageRoot, 'data', 'preserved'), { recursive: true });
      mkdirSync(join(packageRoot, 'logs', 'preserved'), { recursive: true });
      mkdirSync(join(packageRoot, 'workspaces', 'preserved'), { recursive: true });
      writeFileSync(
        join(packageRoot, 'run', 'nextagent.pid'),
        JSON.stringify({ candidateId: 'local-candidate-negative-start', pid: 999_999_999 }),
        'utf8',
      );

      expect((await startLocalRuntimePackage(packageRoot)).candidateId).toBe('local-candidate-negative-start');
      await stopLocalRuntimePackage(packageRoot);
      expect(existsSync(join(packageRoot, 'run', 'nextagent.pid'))).toBe(false);
      expect(existsSync(join(packageRoot, 'config', 'preserved'))).toBe(true);
      expect(existsSync(join(packageRoot, 'data', 'preserved'))).toBe(true);
      expect(existsSync(join(packageRoot, 'logs', 'preserved'))).toBe(true);
      expect(existsSync(join(packageRoot, 'workspaces', 'preserved'))).toBe(true);
    } finally {
      await stopLocalRuntimePackage(packageRoot);
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('redacts local paths, credentials, provider payloads, and stack-like details from package diagnostics', async () => {
    const packageRoot = await createTempPackage();
    try {
      const message = safeDiagnosticMessage(
        new Error(`Failed ${join(packageRoot, 'config', 'default-system.yaml')} with token-secret-value and /provider/raw/payload/value`),
        packageRoot,
      );
      expect(message).not.toContain(packageRoot);
      expect(message).not.toContain('token-secret-value');
      expect(message).not.toContain('/provider/raw/payload/value');
      expect(message).toContain('<package-root>');
      expect(message).toContain('<redacted>');
    } finally {
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('keeps package evidence separate from release verdicts', async () => {
    const packageRoot = await createTempPackage();
    try {
      const port = await freePort();
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-005',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(rawConfig(port)),
      });
      await startLocalRuntimePackage(packageRoot);
      const manifestText = readFileSync(join(packageRoot, 'candidate-manifest.json'), 'utf8');
      const evidenceText = JSON.stringify(createLocalRuntimePackageEvidence(packageRoot));
      expect(manifestText).not.toMatch(/QUALIFIED|BLOCKED/u);
      expect(evidenceText).not.toMatch(/QUALIFIED|BLOCKED/u);
    } finally {
      await stopLocalRuntimePackage(packageRoot);
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt(
    'starts with an unconfigured model provider and no model name override',
    async () => {
      const packageRoot = await createTempPackage();
      const previousModelName = process.env.OPENAI_MODEL_NAME;
      delete process.env.OPENAI_MODEL_NAME;
      try {
        const port = await freePort();
        const config = rawConfig(port);
        const provider = config.modelProfiles[0]!;
        delete provider.baseUrl;
        delete provider.credentialRef;
        (provider.models as Array<Record<string, unknown>>)[0]!.modelId = 'env:OPENAI_MODEL_NAME';
        stageLocalRuntimePackage({
          packageRoot,
          candidateId: 'local-candidate-unconfigured-model',
          version: '0.1.0',
          buildTime: '2026-06-03T00:00:00.000Z',
          packageProfile: 'backend-only',
          configSampleContent: JSON.stringify(config, null, 2),
        });

        const proof = await startRuntimePackage(packageRoot);
        const evidence = JSON.parse(readFileSync(join(packageRoot, 'run', 'config-validation-evidence.json'), 'utf8')) as {
          readinessState: string;
          declaredDegradations: readonly string[];
        };

        expect(proof.readiness).toBe('ready');
        expect(evidence.readinessState).toBe('DEGRADED_READY');
        expect(evidence.declaredDegradations).toContain('OpenAI-compatible model provider is not configured.');
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/sessions`);
        expect(response.status).toBe(200);
      } finally {
        if (previousModelName !== undefined) {
          process.env.OPENAI_MODEL_NAME = previousModelName;
        }
        await stopLocalRuntimePackage(packageRoot).catch(() => undefined);
        await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      }
    },
    15_000,
  );

  localRuntimePackageIt('maps only the primary canonical model id to an env reference', async () => {
    const packageRoot = await createTempPackage();
    try {
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-env-mapped',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(rawConfig()),
      });
      const configSample = parseBuiltInConfig(readFileSync(join(packageRoot, 'config', 'default-system.yaml'), 'utf8')) as ReturnType<
        typeof rawConfig
      >;
      expect(configSample.modelProfiles[0]).toMatchObject({
        providerId: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com/v1',
        credentialRef: 'env:OPENAI_API_KEY',
        models: [{ modelId: 'env:OPENAI_MODEL_NAME' }],
      });
      expect(validateLocalRuntimePackageConfigSample(packageRoot)).toEqual([]);
    } finally {
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('accepts model profile without credentialRef for local model scenarios', async () => {
    const packageRoot = await createTempPackage();
    try {
      const config = rawConfig();
      delete (config.modelProfiles[0] as any).credentialRef;
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-no-credential',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(config),
      });
      const configSample = parseBuiltInConfig(readFileSync(join(packageRoot, 'config', 'default-system.yaml'), 'utf8')) as ReturnType<
        typeof rawConfig
      >;
      expect(configSample.modelProfiles[0]!.credentialRef).toBeUndefined();
      expect(configSample.modelProfiles[0]).toMatchObject({
        providerId: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com/v1',
        models: [{ modelId: 'env:OPENAI_MODEL_NAME' }],
      });
      expect(validateLocalRuntimePackageConfigSample(packageRoot)).toEqual([]);
    } finally {
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  localRuntimePackageIt('projects self-check failures to stable CLI codes without raw diagnostics', async () => {
    const packageRoot = await createTempPackage();
    try {
      stageLocalRuntimePackage({
        packageRoot,
        candidateId: 'local-candidate-safe-self-check',
        version: '0.1.0',
        buildTime: '2026-06-03T00:00:00.000Z',
        packageProfile: 'backend-only',
        configSampleContent: JSON.stringify(rawConfig()),
      });
      const configPath = join(packageRoot, 'config', 'default-system.yaml');
      const invalidConfig = parseBuiltInConfig(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      invalidConfig['credential-sk-cli-leak-canary'] = 'C:\\private\\provider-token';
      writeFileSync(configPath, stringifyYaml(invalidConfig), 'utf8');
      const writes: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      });

      expect(runLocalRuntimePackageSelfCheck(packageRoot)).toBe(1);

      const output = writes.join('');
      expect(JSON.parse(output.trim())).toEqual({
        status: 'failed',
        diagnostics: [{ code: 'invalid-config-sample', evidenceRef: 'run/config-validation-evidence.json' }],
      });
      expect(output).not.toContain('credential-sk-cli-leak-canary');
      expect(output).not.toContain('provider-token');
      expect(output).not.toContain(packageRoot);
      expect(output).not.toContain('message');
      expect(output).not.toContain('stack');

      writes.length = 0;
      rmSync(join(packageRoot, 'candidate-manifest.json'), { force: true });
      expect(runLocalRuntimePackageSelfCheck(packageRoot)).toBe(1);
      expect(JSON.parse(writes.join('').trim())).toEqual({
        status: 'failed',
        diagnostics: [{ code: 'self-check-failed', evidenceRef: 'run/layout-check.json' }],
      });
      expect(writes.join('')).not.toContain(packageRoot);
      expect(writes.join('')).not.toContain('stack');
    } finally {
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

function compressPackageRoot(packageRoot: string, archivePath: string): void {
  const command = process.platform === 'win32' ? 'powershell' : 'pwsh';
  const result = spawnSync(
    command,
    [
      '-NoProfile',
      '-Command',
      "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path $env:NEXTAGENT_ARCHIVE_PATH) { Remove-Item -LiteralPath $env:NEXTAGENT_ARCHIVE_PATH -Force }; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:NEXTAGENT_PACKAGE_ROOT, $env:NEXTAGENT_ARCHIVE_PATH)",
    ],
    { encoding: 'utf8', env: { ...process.env, NEXTAGENT_PACKAGE_ROOT: packageRoot, NEXTAGENT_ARCHIVE_PATH: archivePath } },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Unable to compress package root.');
  }
}

function expandPackageArchive(archivePath: string, destination: string): void {
  const command = process.platform === 'win32' ? 'powershell' : 'pwsh';
  const result = spawnSync(
    command,
    [
      '-NoProfile',
      '-Command',
      "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path $env:NEXTAGENT_EXTRACT_ROOT) { Remove-Item -LiteralPath $env:NEXTAGENT_EXTRACT_ROOT -Recurse -Force }; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:NEXTAGENT_ARCHIVE_PATH, $env:NEXTAGENT_EXTRACT_ROOT)",
    ],
    { encoding: 'utf8', env: { ...process.env, NEXTAGENT_ARCHIVE_PATH: archivePath, NEXTAGENT_EXTRACT_ROOT: destination } },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Unable to expand package archive.');
  }
}
async function createTempPackage(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nextagent-local-package-'));
  await writeFile(join(dir, '.keep'), '', 'utf8');
  return dir;
}

function writeRemoteGatewayEntrypoint(packageRoot: string): void {
  mkdirSync(join(packageRoot, 'vendor'), { recursive: true });
  writeFileSync(
    join(packageRoot, 'vendor', 'gateway-remote-entrypoint.mjs'),
    `
import { createComposedAppAsync, createAppCredentialResolver, parseBuiltInConfig, validateDefaultSystemConfig } from "@nextagent/agent-platform-gateway-local/testing";
import {
  createRemoteSupportLocalGatewayProvider,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider
} from "@nextagent/agent-platform-gateway-local";
import { createRemoteGatewayProvider } from "@nextagent/agent-platform-gateway-remote";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const running = new Map();

export async function startRemoteRuntimePackage(packageRoot) {
  const root = resolve(packageRoot);
  const manifest = JSON.parse(readFileSync(join(root, "candidate-manifest.json"), "utf8"));
  const rawConfig = resolveEnvBackedModelProfileFields(parseBuiltInConfig(readFileSync(join(root, "config", "default-system.yaml"), "utf8")));
  const credentialResolver = createAppCredentialResolver();
  const systemConfig = validateDefaultSystemConfig(rawConfig, root, { credentialResolver });
  const remoteProvider = createRemoteGatewayProvider({
    providerId: "vendor-remote",
    bindings: {
      sandbox: {
        async execute(request) {
          return {
            executionId: request.executionId,
            exitCode: 0,
            stdout: "",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
            timedOut: false,
            durationMs: 0
          };
        }
      },
      ragRetrieval: {
        async retrieve() {
          return { status: "UNAVAILABLE", results: [], diagnostics: { reason: "PROVIDER_UNAVAILABLE" } };
        }
      }
    }
  });
  const gatewayProviders = [
    createSqliteWorkingMemoryGatewayProvider(),
    createSqliteLongTermMemoryGatewayProvider(),
    createRemoteSupportLocalGatewayProvider(),
    remoteProvider
  ];
  const app = await createComposedAppAsync({
    credentialResolver,
    systemConfig,
    gatewayProviders
  }, noopModel(), "OPENAI");
  await app.start();
  running.set(root, app);
  const proof = {
    candidateId: manifest.candidateId,
    primaryHealth: "ok",
    readiness: "ready",
    runStateRef: "run/nextagent.pid",
    gateway: {
      selectedProviderId: "local-working-memory-gateway+local-long-term-memory-gateway+remote-support-local-gateway+vendor-remote",
      deploymentMode: "REMOTE",
      gatewaySnapshotRef: systemConfig.gatewaySelection.diagnosticRef,
      bindingsReadinessRef: "gateway-provider:local-working-memory-gateway:ready+gateway-provider:local-long-term-memory-gateway:ready+gateway-provider:remote-support-local-gateway:ready+gateway-provider:vendor-remote:ready"
    }
  };
  mkdirSync(join(root, "run"), { recursive: true });
  writeFileSync(join(root, "run", "nextagent.pid"), JSON.stringify({ candidateId: manifest.candidateId, pid: process.pid }), "utf8");
  writeFileSync(join(root, "run", "startup-proof.json"), JSON.stringify(proof), "utf8");
  writeFileSync(join(root, "run", "health-readiness-proof.json"), JSON.stringify({
    candidateId: manifest.candidateId,
    primaryStatus: "PASSED",
    deepStatus: "PASSED",
    criticalDependencyStatuses: [],
    evidenceRefs: ["run/startup-proof.json"]
  }), "utf8");
  return proof;
}

export async function stopRemoteRuntimePackage(packageRoot) {
  const root = resolve(packageRoot);
  const app = running.get(root);
  if (app !== undefined) {
    await app.close();
    running.delete(root);
  }
  if (existsSync(join(root, "run", "nextagent.pid"))) {
    rmSync(join(root, "run", "nextagent.pid"), { force: true });
  }
}

function noopModel() {
  return {
    async complete() {
      return { content: "ok" };
    },
    async stream() {
      return { content: "ok", finishReason: "stop" };
    }
  };
}

function resolveEnvBackedModelProfileFields(rawConfig) {
  for (const profile of rawConfig.modelProfiles ?? []) {
    if (typeof profile.baseUrl === "string" && profile.baseUrl.startsWith("env:")) {
      profile.baseUrl = process.env[profile.baseUrl.slice(4)];
    }
    for (const model of profile.models ?? []) {
      if (typeof model.modelId === "string" && model.modelId.startsWith("env:")) {
        model.modelId = process.env[model.modelId.slice(4)];
      }
    }
  }
  return rawConfig;
}
`,
    'utf8',
  );
}

function writeNextAgentPackageProxies(packageRoot: string): void {
  writePackageProxy(packageRoot, '@nextagent/agent-platform-gateway-local', {
    '.': import.meta.resolve('@nextagent/agent-platform-gateway-local'),
    './testing': import.meta.resolve('@nextagent/agent-platform-gateway-local/testing'),
  });
  writePackageProxy(packageRoot, '@nextagent/agent-platform-gateway-remote', {
    '.': import.meta.resolve('@nextagent/agent-platform-gateway-remote'),
  });
}

function writePackageProxy(packageRoot: string, packageName: string, exports: Record<string, string>): void {
  const packageDir = join(packageRoot, 'node_modules', ...packageName.split('/'));
  mkdirSync(packageDir, { recursive: true });
  const packageExports: Record<string, string> = {};
  for (const [subpath, target] of Object.entries(exports)) {
    const fileName = subpath === '.' ? 'index.mjs' : `${subpath.slice(2)}.mjs`;
    packageExports[subpath] = `./${fileName}`;
    writeFileSync(join(packageDir, fileName), `export * from ${JSON.stringify(target)};\n`, 'utf8');
  }
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify(
      {
        name: packageName,
        version: '1.0.0',
        type: 'module',
        exports: packageExports,
      },
      null,
      2,
    ),
    'utf8',
  );
}

function writeRemoteDeploymentPackage(packageRoot: string): void {
  const packageDir = join(packageRoot, 'node_modules', '@nextagent', 'agent-remote-deployment');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify(
      {
        name: '@nextagent/agent-remote-deployment',
        version: '1.0.0',
        type: 'module',
        exports: { '.': './index.mjs' },
        dependencies: {
          '@nextagent/agent-app': '1.0.0',
          '@nextagent/agent-platform-gateway-local': '1.0.0',
          '@nextagent/agent-platform-gateway-remote': '1.0.0',
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(
    join(packageDir, 'index.mjs'),
    `
import { createComposedAppAsync, createAppCredentialResolver, parseBuiltInConfig, validateDefaultSystemConfig } from "@nextagent/agent-platform-gateway-local/testing";
import {
  createRemoteSupportLocalGatewayProvider,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider
} from "@nextagent/agent-platform-gateway-local";
import {
  createReferenceRemoteRagRetrievalGateway,
  createReferenceRemoteSandboxGateway,
  createRemoteGatewayProvider
} from "@nextagent/agent-platform-gateway-remote";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const running = new Map();

export async function startRemoteRuntimePackage(packageRoot) {
  const root = resolve(packageRoot);
  const manifest = JSON.parse(readFileSync(join(root, "candidate-manifest.json"), "utf8"));
  const rawConfig = resolveEnvBackedModelProfileFields(parseBuiltInConfig(readFileSync(join(root, "config", "default-system.yaml"), "utf8")));
  const credentialResolver = createAppCredentialResolver();
  const systemConfig = validateDefaultSystemConfig(rawConfig, root, { credentialResolver });
  const app = await createComposedAppAsync({
    credentialResolver,
    systemConfig,
    gatewayProviders: [
      createSqliteWorkingMemoryGatewayProvider(),
      createSqliteLongTermMemoryGatewayProvider(),
      createRemoteSupportLocalGatewayProvider(),
      createRemoteGatewayProvider({
      providerId: "vendor-remote",
      bindings: {
        sandbox: createReferenceRemoteSandboxGateway({
          async execute(request) {
            return {
              executionId: request.executionId,
              exitCode: 0,
              stdout: "",
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
              timedOut: false,
              durationMs: 0
            };
          }
        }),
        ragRetrieval: createReferenceRemoteRagRetrievalGateway({
          async retrieve() {
            return { status: "UNAVAILABLE", results: [], diagnostics: { reason: "PROVIDER_UNAVAILABLE" } };
          }
        })
      }
      })
    ]
  }, noopModel(), "OPENAI");
  await app.start();
  running.set(root, app);
  const proof = {
    candidateId: manifest.candidateId,
    primaryHealth: "ok",
    readiness: "ready",
    runStateRef: "run/nextagent.pid",
    gateway: {
      selectedProviderId: "local-working-memory-gateway+local-long-term-memory-gateway+remote-support-local-gateway+vendor-remote",
      deploymentMode: "REMOTE",
      gatewaySnapshotRef: systemConfig.gatewaySelection.diagnosticRef,
      bindingsReadinessRef: "gateway-provider:local-working-memory-gateway:ready+gateway-provider:local-long-term-memory-gateway:ready+gateway-provider:remote-support-local-gateway:ready+gateway-provider:vendor-remote:ready"
    }
  };
  mkdirSync(join(root, "run"), { recursive: true });
  writeFileSync(join(root, "run", "nextagent.pid"), JSON.stringify({ candidateId: manifest.candidateId, pid: process.pid }), "utf8");
  writeFileSync(join(root, "run", "startup-proof.json"), JSON.stringify(proof), "utf8");
  return proof;
}

export async function stopRemoteRuntimePackage(packageRoot) {
  const root = resolve(packageRoot);
  const app = running.get(root);
  if (app !== undefined) {
    await app.close();
    running.delete(root);
  }
  if (existsSync(join(root, "run", "nextagent.pid"))) {
    rmSync(join(root, "run", "nextagent.pid"), { force: true });
  }
}

function noopModel() {
  return {
    async complete() {
      return { content: "ok" };
    },
    async stream() {
      return { content: "ok", finishReason: "stop" };
    }
  };
}

function resolveEnvBackedModelProfileFields(rawConfig) {
  for (const profile of rawConfig.modelProfiles ?? []) {
    if (typeof profile.baseUrl === "string" && profile.baseUrl.startsWith("env:")) {
      profile.baseUrl = process.env[profile.baseUrl.slice(4)];
    }
    for (const model of profile.models ?? []) {
      if (typeof model.modelId === "string" && model.modelId.startsWith("env:")) {
        model.modelId = process.env[model.modelId.slice(4)];
      }
    }
  }
  return rawConfig;
}
`,
    'utf8',
  );
}

async function stopRemoteRuntimePackage(packageRoot: string): Promise<void> {
  const entrypoint = join(packageRoot, 'vendor', 'gateway-remote-entrypoint.mjs');
  if (!existsSync(entrypoint)) {
    return;
  }
  const module = (await import(pathToFileURL(entrypoint).href)) as { readonly stopRemoteRuntimePackage?: (packageRoot: string) => Promise<void> };
  await module.stopRemoteRuntimePackage?.(packageRoot);
}

async function stopRemoteDeploymentPackage(packageRoot: string): Promise<void> {
  const entrypoint = join(packageRoot, 'node_modules', '@nextagent', 'agent-remote-deployment', 'index.mjs');
  if (!existsSync(entrypoint)) {
    return;
  }
  const module = (await import(pathToFileURL(entrypoint).href)) as { readonly stopRemoteRuntimePackage?: (packageRoot: string) => Promise<void> };
  await module.stopRemoteRuntimePackage?.(packageRoot);
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address !== null) {
          resolve(address.port);
        } else {
          reject(new Error('Unable to allocate a local test port.'));
        }
      });
    });
  });
}

async function holdPort(port: number): Promise<Server> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function rawConfig(port = 3000): TestRuntimePackageConfig {
  return {
    deployment: { mode: 'LOCAL' },
    paths: { workspaceRoot: 'workspaces' },
    auth: {
      mode: 'local',
      localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject', displayName: 'Local operator' },
    },
    channel: { transport: 'fastify', host: '127.0.0.1', port },
    hostedAgent: { activeAgentId: 'default-agent' },
    modelProfiles: [
      {
        providerId: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com/v1',
        credentialRef: 'env:OPENAI_API_KEY',
        models: [
          {
            modelId: 'MiniMax-M2.7',
            timeoutMs: 30_000,
            contextWindowTokens: 128_000,
            fallbackEligible: false,
          },
        ],
      },
    ],
    gateway: {
      gateways: [
        { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
        { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
      ],
    },
    noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
  };
}
