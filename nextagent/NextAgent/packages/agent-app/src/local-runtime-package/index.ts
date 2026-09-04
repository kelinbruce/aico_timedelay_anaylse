import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { AgentError } from '@nextagent/agent-common';
import { createForkActiveContextSelector } from '@nextagent/agent-context-engine';
import type { OperationalLogWriter } from '@nextagent/agent-log';
import {
  createAppOperationalLogWriter,
  runProductCompositionAsync,
  type CreateComposedAppOptions,
  type NextAgentApp,
  type ProductCompositionOutcome,
  type ProductHostCompositionInput,
} from '../composition/create-app.js';
import { createConfigValidationEvidence, type AppConfigEvaluation } from '../config/config-artifacts.js';
import { createAppCredentialResolver, type AppCredentialResolver } from '../config/env.js';
import { applyChannelEnvOverrides, parseBuiltInConfig, resolveModelProfileEnvRefs } from '../config/system-config.js';
import { validateDefaultSystemConfig } from '../config/validation.js';
import { assertModelProviderProfileSupportsProviderIds } from '../composition/model-composition.js';
import type { DefaultSystemConfig } from '../config/component-config.js';
import {
  createBasePackageCandidateEvidence,
  mergePackageExecutionEvidence,
  validatePackageCandidateEvidence,
  type PackageCandidateEvidence,
} from '../packaging/package-candidate-evidence.js';
import { pathToFileURL } from 'node:url';
import { dump as stringifyYaml } from 'js-yaml';
import { loadLocalRuntimeBindings, type LocalRuntimeBindings } from './local-runtime-bindings.js';
import { writeLocalRuntimeReadyNotice, writeLocalRuntimeSelfCheckFailure } from './cli-output.js';

export const localRuntimeLayoutVersion = 'local-runtime-package.v1' as const;
export const localRuntimePackageProfiles = ['backend-only', 'with-frontend'] as const;
export const localRuntimeModelProviderProfiles = ['model-gateway-only'] as const;

export type LocalRuntimePackageProfile = (typeof localRuntimePackageProfiles)[number];
export type LocalRuntimeModelProviderProfile = (typeof localRuntimeModelProviderProfiles)[number];

export interface LocalRuntimePackageManifest {
  readonly candidateId: string;
  readonly version: string;
  readonly buildTime: string;
  readonly packageProfile: LocalRuntimePackageProfile;
  readonly modelProviderProfile?: LocalRuntimeModelProviderProfile;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly nodeVersion: string;
  readonly layoutVersion: typeof localRuntimeLayoutVersion;
  readonly entrypointRefs: {
    readonly start: string;
    readonly stop: string;
    readonly selfCheck: string;
  };
  readonly deploymentEntrypointRefs: {
    readonly LOCAL: LocalRuntimeDeploymentEntrypointRef;
    readonly REMOTE?: LocalRuntimeDeploymentEntrypointRef;
  };
  readonly configSampleRefs: readonly string[];
  readonly packageArchiveRef: string;
  readonly evidenceRefs: readonly string[];
}

export interface LocalRuntimeDeploymentEntrypointRef {
  readonly module: string;
  readonly exportName: string;
}

export interface LocalRuntimeStartProof {
  readonly candidateId: string;
  readonly primaryHealth: 'ok';
  readonly readiness: 'ready';
  readonly runStateRef: 'run/nextagent.pid';
  readonly gateway: {
    readonly selectedProviderId: string;
    readonly deploymentMode: 'LOCAL' | 'REMOTE';
    readonly gatewaySnapshotRef: string;
    readonly bindingsReadinessRef: string;
  };
}

export interface LocalRuntimePackageDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly evidenceRef: string;
}

interface PreparedRuntimePackageConfigFact {
  readonly root: string;
  readonly manifest: LocalRuntimePackageManifest;
  readonly configSampleRef: string;
  readonly credentialResolver: AppCredentialResolver;
  readonly config: DefaultSystemConfig;
  readonly layoutDiagnostics: readonly LocalRuntimePackageDiagnostic[];
}

interface PreparedLocalRuntimePackageHost extends PreparedRuntimePackageConfigFact {
  readonly appSystemConfig: DefaultSystemConfig;
  readonly candidateId: string;
  readonly serviceVersion: string;
  readonly frontendHostingProfile: 'NONE' | 'WITH_FRONTEND';
  readonly productHostInput?: ProductHostCompositionInput;
  readonly localRuntimeBindings: LocalRuntimeBindings;
  readonly operationalLogWriter: OperationalLogWriter;
}

export function createRuntimePackageServiceVersion(manifest: Pick<LocalRuntimePackageManifest, 'version' | 'candidateId'>): string {
  const readable = `${manifest.version}+${manifest.candidateId}`;
  if (readable.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/u.test(readable)) {
    return readable;
  }
  return `build-${createHash('sha256').update(`${manifest.version}\0${manifest.candidateId}`).digest('hex').slice(0, 24)}`;
}

export interface StageLocalRuntimePackageOptions {
  readonly packageRoot: string;
  readonly candidateId: string;
  readonly version: string;
  readonly buildTime: string;
  readonly packageProfile: LocalRuntimePackageProfile;
  readonly modelProviderProfile?: LocalRuntimeModelProviderProfile;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly nodeVersion?: string;
  readonly packageArchiveRef?: string;
  readonly deploymentEntrypointRefs?: Partial<LocalRuntimePackageManifest['deploymentEntrypointRefs']>;
  readonly configSampleContent: string;
}

const requiredDirs = ['bin', 'config', 'backend', 'data', 'logs', 'run', 'workspaces'] as const;
const systemDirs = ['bin', 'config', 'backend', 'data', 'logs', 'run'] as const;
const manifestRef = 'candidate-manifest.json';
const layoutCheckRef = 'run/layout-check.json';
const configValidationEvidenceRef = 'run/config-validation-evidence.json';
const startupProofRef = 'run/startup-proof.json';
const healthReadinessProofRef = 'run/health-readiness-proof.json';
const runningPackages = new Map<string, NextAgentApp>();

export function stageLocalRuntimePackage(options: StageLocalRuntimePackageOptions): LocalRuntimePackageManifest {
  const root = resolve(options.packageRoot);
  if (options.modelProviderProfile === 'model-gateway-only') {
    assertModelGatewayOnlyRawConfig(parseBuiltInConfig(options.configSampleContent));
  }
  for (const dir of [...requiredDirs, 'agents', 'skills'] as const) {
    mkdirSync(resolve(root, dir), { recursive: true });
  }
  writeEntrypointScript(resolve(root, 'bin', 'nextagent-start'), 'start');
  writeEntrypointScript(resolve(root, 'bin', 'nextagent-stop'), 'stop');
  writeEntrypointScript(resolve(root, 'bin', 'nextagent-self-check'), 'self-check');
  for (const dir of ['agents', 'backend', 'data', 'logs', 'run', 'skills', 'workspaces'] as const) {
    writeFileSync(resolve(root, dir, '.keep'), '', 'utf8');
  }
  writeFileSync(
    resolve(root, 'config', 'default-system.yaml'),
    stringifyYaml(createPackageConfigSample(options.configSampleContent), { lineWidth: -1, noRefs: true }),
    'utf8',
  );
  writeJson(resolve(root, 'package.json'), { name: 'nextagent-local-runtime-package', version: options.version, private: true, type: 'module' });

  const manifest = createLocalRuntimePackageManifest({
    candidateId: options.candidateId,
    version: options.version,
    buildTime: options.buildTime,
    packageProfile: options.packageProfile,
    ...(options.modelProviderProfile === undefined ? {} : { modelProviderProfile: options.modelProviderProfile }),
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
    nodeVersion: options.nodeVersion ?? process.version,
    ...(options.packageArchiveRef === undefined ? {} : { packageArchiveRef: options.packageArchiveRef }),
    ...(options.deploymentEntrypointRefs === undefined ? {} : { deploymentEntrypointRefs: options.deploymentEntrypointRefs }),
    evidenceRefs: [layoutCheckRef, configValidationEvidenceRef, startupProofRef, healthReadinessProofRef],
  });
  writeJson(resolve(root, manifestRef), manifest);
  return manifest;
}

export function createLocalRuntimePackageManifest(input: {
  readonly candidateId: string;
  readonly version: string;
  readonly buildTime: string;
  readonly packageProfile: LocalRuntimePackageProfile;
  readonly modelProviderProfile?: LocalRuntimeModelProviderProfile;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly nodeVersion?: string;
  readonly packageArchiveRef?: string;
  readonly deploymentEntrypointRefs?: Partial<LocalRuntimePackageManifest['deploymentEntrypointRefs']>;
  readonly evidenceRefs?: readonly string[];
}): LocalRuntimePackageManifest {
  assertSafeId(input.candidateId, 'candidateId');
  assertNonEmpty(input.version, 'version');
  assertNonEmpty(input.buildTime, 'buildTime');
  assertPackageProfile(input.packageProfile);
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const nodeVersion = input.nodeVersion ?? process.version;
  assertPackagePlatform(platform, arch);
  assertNodeVersion(nodeVersion);
  const evidenceRefs = input.evidenceRefs ?? [layoutCheckRef, configValidationEvidenceRef, startupProofRef, healthReadinessProofRef];
  const packageArchiveRef = input.packageArchiveRef ?? `evidence:local-runtime-package-archive:${input.candidateId}`;
  assertPackageRef(packageArchiveRef, 'package archive');
  for (const ref of evidenceRefs) {
    assertPackageRef(ref, 'evidenceRef');
  }
  const deploymentEntrypointRefs = {
    LOCAL: input.deploymentEntrypointRefs?.LOCAL ?? {
      module: 'backend/agent-app/local-runtime-package/index.js',
      exportName: 'startLocalRuntimePackage',
    },
    ...(input.deploymentEntrypointRefs?.REMOTE === undefined ? {} : { REMOTE: input.deploymentEntrypointRefs.REMOTE }),
  };
  validateDeploymentEntrypointRef(deploymentEntrypointRefs.LOCAL, 'LOCAL deployment entrypoint');
  if (deploymentEntrypointRefs.REMOTE !== undefined) {
    validateDeploymentEntrypointRef(deploymentEntrypointRefs.REMOTE, 'REMOTE deployment entrypoint');
  }
  return {
    candidateId: input.candidateId,
    version: input.version,
    buildTime: input.buildTime,
    packageProfile: input.packageProfile,
    ...(input.modelProviderProfile === undefined ? {} : { modelProviderProfile: input.modelProviderProfile }),
    platform,
    arch,
    nodeVersion,
    layoutVersion: localRuntimeLayoutVersion,
    entrypointRefs: {
      start: 'bin/nextagent-start',
      stop: 'bin/nextagent-stop',
      selfCheck: 'bin/nextagent-self-check',
    },
    deploymentEntrypointRefs,
    configSampleRefs: ['config/default-system.yaml'],
    packageArchiveRef,
    evidenceRefs,
  };
}

export function readLocalRuntimePackageManifest(packageRoot: string): LocalRuntimePackageManifest {
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, manifestRef), 'utf8')) as unknown;
  validateLocalRuntimePackageManifest(manifest);
  return manifest;
}

export function validateLocalRuntimePackageManifest(manifest: unknown): asserts manifest is LocalRuntimePackageManifest {
  const record = asRecord(manifest, 'manifest');
  const entrypointRefs = asRecord(record.entrypointRefs, 'entrypointRefs');
  const deploymentEntrypointRefs = asRecord(record.deploymentEntrypointRefs, 'deploymentEntrypointRefs');
  const candidateId = asString(record.candidateId, 'candidateId');
  const version = asString(record.version, 'version');
  const buildTime = asString(record.buildTime, 'buildTime');
  const packageProfile = asString(record.packageProfile, 'packageProfile');
  const modelProviderProfile = record.modelProviderProfile;
  const platform = asString(record.platform, 'platform');
  const arch = asString(record.arch, 'arch');
  const nodeVersion = asString(record.nodeVersion, 'nodeVersion');
  const layoutVersion = asString(record.layoutVersion, 'layoutVersion');
  const packageArchiveRef = asString(record.packageArchiveRef, 'packageArchiveRef');
  const configSampleRefs = asStringArray(record.configSampleRefs, 'configSampleRefs');
  const evidenceRefs = asStringArray(record.evidenceRefs, 'evidenceRefs');
  assertSafeId(candidateId, 'candidateId');
  assertNonEmpty(version, 'version');
  assertNonEmpty(buildTime, 'buildTime');
  assertPackageProfile(packageProfile);
  if (modelProviderProfile !== undefined && modelProviderProfile !== 'model-gateway-only') {
    throw new Error('Unsupported local runtime model provider profile.');
  }
  assertPackagePlatform(platform, arch);
  assertNodeVersion(nodeVersion);
  if (layoutVersion !== localRuntimeLayoutVersion) {
    throw new Error('Unsupported local runtime package layout version.');
  }
  assertPackageRef(asString(entrypointRefs.start, 'start entrypoint'), 'start entrypoint');
  assertPackageRef(asString(entrypointRefs.stop, 'stop entrypoint'), 'stop entrypoint');
  assertPackageRef(asString(entrypointRefs.selfCheck, 'self-check entrypoint'), 'self-check entrypoint');
  validateDeploymentEntrypointRef(deploymentEntrypointRefs.LOCAL, 'LOCAL deployment entrypoint');
  if (deploymentEntrypointRefs.REMOTE !== undefined) {
    validateDeploymentEntrypointRef(deploymentEntrypointRefs.REMOTE, 'REMOTE deployment entrypoint');
  }
  assertPackageRef(packageArchiveRef, 'package archive');
  if (configSampleRefs.length === 0) {
    throw new Error('At least one config sample ref is required.');
  }
  for (const ref of configSampleRefs) {
    assertPackageRef(ref, 'config sample');
  }
  if (evidenceRefs.length === 0) {
    throw new Error('At least one evidence ref is required.');
  }
  for (const ref of evidenceRefs) {
    assertPackageRef(ref, 'evidence');
  }
}

export function checkLocalRuntimePackageLayout(
  packageRoot: string,
  manifest = readLocalRuntimePackageManifest(packageRoot),
): LocalRuntimePackageDiagnostic[] {
  const root = resolve(packageRoot);
  return checkLocalRuntimePackageLayoutWithResourceDirs(root, manifest, configuredResourceDirs(root, manifest));
}

function checkLocalRuntimePackageLayoutWithResourceDirs(
  root: string,
  manifest: LocalRuntimePackageManifest,
  resourceDirs: readonly string[],
): LocalRuntimePackageDiagnostic[] {
  const diagnostics: LocalRuntimePackageDiagnostic[] = [];
  for (const dir of requiredDirs) {
    if (!existsSync(resolve(root, dir))) {
      diagnostics.push({ code: 'missing-directory', message: `${dir} is required.`, evidenceRef: layoutCheckRef });
    }
  }
  for (const dir of resourceDirs) {
    if (!existsSync(resolve(root, dir))) {
      diagnostics.push({ code: 'missing-directory', message: `${dir} is required.`, evidenceRef: layoutCheckRef });
    }
  }
  if (!existsSync(resolve(root, 'package.json'))) {
    diagnostics.push({ code: 'missing-package-ref', message: 'package.json is required.', evidenceRef: layoutCheckRef });
  }
  for (const ref of [
    manifest.entrypointRefs.start,
    manifest.entrypointRefs.stop,
    manifest.entrypointRefs.selfCheck,
    ...manifest.configSampleRefs,
    'backend',
  ]) {
    if (!existsSync(resolvePackageRef(root, ref))) {
      diagnostics.push({ code: 'missing-package-ref', message: `${ref} is required.`, evidenceRef: layoutCheckRef });
    }
  }
  return diagnostics;
}

function configuredResourceDirs(packageRoot: string, manifest: LocalRuntimePackageManifest): readonly string[] {
  const configSampleRef = manifest.configSampleRefs[0];
  if (configSampleRef === undefined) {
    return ['agents', 'skills'];
  }
  try {
    const configSample = parseBuiltInConfig(readFileSync(resolvePackageRef(packageRoot, configSampleRef), 'utf8'));
    return configuredResourceDirsFromRawConfig(configSample);
  } catch {
    return ['agents', 'skills'];
  }
}

function configuredResourceDirsFromRawConfig(configSample: unknown): readonly string[] {
  if (typeof configSample !== 'object' || configSample === null || Array.isArray(configSample)) {
    return ['agents', 'skills'];
  }
  const paths = (configSample as Record<string, unknown>).paths;
  if (typeof paths !== 'object' || paths === null || Array.isArray(paths)) {
    return ['agents', 'skills'];
  }
  const agentRoot = safePackageDirectoryRef((paths as Record<string, unknown>).agentRoot) ?? 'agents';
  const skillRoot = safePackageDirectoryRef((paths as Record<string, unknown>).skillRoot) ?? 'skills';
  return [...new Set([agentRoot, skillRoot])];
}

function safePackageDirectoryRef(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  if (isAbsolute(value) || value.includes('..') || value.split(/[\\/]/u).some((part) => part === '')) {
    return undefined;
  }
  return value;
}

export function validateLocalRuntimePackageConfigSample(
  packageRoot: string,
  configSampleRef = 'config/default-system.yaml',
  credentialResolver: AppCredentialResolver = createAppCredentialResolver(),
  env: NodeJS.ProcessEnv = process.env,
): LocalRuntimePackageDiagnostic[] {
  try {
    const root = resolve(packageRoot);
    const manifest = readLocalRuntimePackageManifest(root);
    const configPath = resolvePackageRef(root, configSampleRef);
    const config = validateDefaultSystemConfig(
      applyChannelEnvOverrides(resolvePackageConfigEnvRefs(parseBuiltInConfig(readFileSync(configPath, 'utf8')), env), (name) => env[name]),
      dirname(configPath),
      { credentialResolver },
    );
    if (manifest.modelProviderProfile === 'model-gateway-only') {
      assertModelGatewayOnlyConfig(config);
    }
    assertWorkspaceBoundary(root, config.paths.workspaceRoot);
    return [];
  } catch (error) {
    return [configValidationDiagnostic(error, resolve(packageRoot))];
  }
}

function configValidationDiagnostic(error: unknown, packageRoot: string): LocalRuntimePackageDiagnostic {
  return {
    code: error instanceof AgentError && error.code === 'MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE' ? error.code : 'invalid-config-sample',
    message: safeDiagnosticMessage(error, packageRoot),
    evidenceRef: configValidationEvidenceRef,
  };
}

export function createPackageCandidateEvidence(packageRoot: string): PackageCandidateEvidence {
  const manifest = readLocalRuntimePackageManifest(packageRoot);
  const layoutDiagnostics = checkLocalRuntimePackageLayout(packageRoot, manifest);
  writeJson(resolve(packageRoot, layoutCheckRef), {
    candidateId: manifest.candidateId,
    passed: layoutDiagnostics.length === 0,
    diagnostics: layoutDiagnostics,
  });
  const evidenceDiagnostics = validateMandatoryEvidenceRefs(packageRoot, manifest);
  if (layoutDiagnostics.length > 0) {
    throw new Error('Local runtime package evidence requires valid layout.');
  }
  if (evidenceDiagnostics.length > 0) {
    throw new Error('Local runtime package evidence requires startup proof and health/readiness proof.');
  }
  return validatePackageCandidateEvidence(
    mergePackageExecutionEvidence(
      createBasePackageCandidateEvidence({
        candidateId: manifest.candidateId,
        packageProfile: manifest.packageProfile,
        manifestRef,
        layoutCheckRef,
        configValidationEvidenceRef,
      }),
      { startupProofRef, healthReadinessProofRef },
    ),
    manifest.candidateId,
  );
}

export const createLocalRuntimePackageEvidence = createPackageCandidateEvidence;

function prepareRuntimePackageConfigFact(
  packageRoot: string,
  packageLabel: 'Local runtime package' | 'Runtime package',
): PreparedRuntimePackageConfigFact {
  const root = resolve(packageRoot);
  const manifest = readLocalRuntimePackageManifest(root);
  const credentialResolver = createAppCredentialResolver();
  const configSampleRef = manifest.configSampleRefs[0];
  let resourceDirs: readonly string[] = ['agents', 'skills'];
  let config: DefaultSystemConfig | undefined;
  let configDiagnostic: LocalRuntimePackageDiagnostic | undefined;
  try {
    if (configSampleRef === undefined) {
      throw new Error('At least one config sample ref is required.');
    }
    const configPath = resolvePackageRef(root, configSampleRef);
    const rawConfig = parseBuiltInConfig(readFileSync(configPath, 'utf8'));
    resourceDirs = configuredResourceDirsFromRawConfig(rawConfig);
    config = validateDefaultSystemConfig(
      applyChannelEnvOverrides(resolvePackageConfigEnvRefs(rawConfig, process.env), (name) => process.env[name]),
      dirname(configPath),
      { credentialResolver },
    );
    if (manifest.modelProviderProfile === 'model-gateway-only') {
      assertModelGatewayOnlyConfig(config);
    }
    assertWorkspaceBoundary(root, config.paths.workspaceRoot);
  } catch (error) {
    configDiagnostic = configValidationDiagnostic(error, root);
  }
  const layoutDiagnostics = checkLocalRuntimePackageLayoutWithResourceDirs(root, manifest, resourceDirs);
  const diagnostics = [...layoutDiagnostics, ...(configDiagnostic === undefined ? [] : [configDiagnostic])];
  if (diagnostics.length > 0 || config === undefined || configSampleRef === undefined) {
    writeConfigValidationEvidence(root, manifest.candidateId, blockedConfigEvaluationInput(diagnostics));
    writeStartupFailure(root, manifest.candidateId, diagnostics);
    throw new Error(`${packageLabel} cannot start before layout and config validation pass.`);
  }
  return Object.freeze({
    root,
    manifest,
    configSampleRef,
    credentialResolver,
    config,
    layoutDiagnostics: Object.freeze([...layoutDiagnostics]),
  });
}

async function prepareLocalRuntimePackageHost(preparedConfig: PreparedRuntimePackageConfigFact): Promise<PreparedLocalRuntimePackageHost> {
  const appSystemConfig = preparedConfig.config;
  const localRuntimeBindings = await loadLocalRuntimeBindings();
  const serviceVersion = createRuntimePackageServiceVersion(preparedConfig.manifest);
  const frontendHostingProfile = preparedConfig.manifest.packageProfile === 'with-frontend' ? 'WITH_FRONTEND' : 'NONE';
  const productHostInput =
    frontendHostingProfile === 'WITH_FRONTEND'
      ? createWithFrontendPackageHostInput(preparedConfig.root, preparedConfig.manifest.version, localRuntimeBindings.frontendScripts)
      : undefined;
  const operationalLogWriter = await createAppOperationalLogWriter(appSystemConfig, serviceVersion);
  return Object.freeze({
    ...preparedConfig,
    appSystemConfig,
    candidateId: preparedConfig.manifest.candidateId,
    serviceVersion,
    frontendHostingProfile,
    ...(productHostInput === undefined ? {} : { productHostInput }),
    localRuntimeBindings,
    operationalLogWriter,
  });
}

export async function startLocalRuntimePackage(packageRoot: string): Promise<LocalRuntimeStartProof> {
  const preparedConfig = prepareRuntimePackageConfigFact(packageRoot, 'Local runtime package');
  return await startPreparedLocalRuntimePackage(await prepareLocalRuntimePackageHost(preparedConfig));
}

async function startPreparedLocalRuntimePackage(prepared: PreparedLocalRuntimePackageHost): Promise<LocalRuntimeStartProof> {
  cleanupStaleRunState(prepared.root, prepared.candidateId);
  assertNoActiveRunState(prepared.root, prepared.candidateId);
  let runnerAccepted = false;
  let outcome: ProductCompositionOutcome;
  try {
    const localGatewayProvider = prepared.localRuntimeBindings.createLocalGatewayProvider('local-gateway', {
      allowedApis: prepared.appSystemConfig.sandbox.allowedApis,
    });
    const workingMemoryGatewayProvider = prepared.localRuntimeBindings.createSqliteWorkingMemoryGatewayProvider('local-working-memory-gateway', {
      forkActiveContextSelector: createForkActiveContextSelector(),
    });
    const longTermMemoryGatewayProvider = prepared.localRuntimeBindings.createSqliteLongTermMemoryGatewayProvider();
    const appOptions: CreateComposedAppOptions = {
      serviceVersion: prepared.serviceVersion,
      credentialResolver: prepared.credentialResolver,
      systemConfig: prepared.appSystemConfig,
      gatewayProviders: [workingMemoryGatewayProvider, longTermMemoryGatewayProvider, localGatewayProvider],
      backgroundTaskStoreFactory: prepared.localRuntimeBindings.createLocalBackgroundTaskStore,
      cronTaskGatewayFactory: prepared.localRuntimeBindings.createSqliteCronTaskGateway,
      cronTaskSchedulerFactory: prepared.localRuntimeBindings.createLocalCronTaskScheduler,
      sandboxGatewayFactory: prepared.localRuntimeBindings.createRestrictedLocalSandboxGateway,
      scheduledMaintenanceGatewayFactory: prepared.localRuntimeBindings.createLocalScheduledMaintenanceGateway,
      ragRetrievalFactory: prepared.localRuntimeBindings.createLocalRagKnowledgeGovernance,
      trustedLocalWebExtensionRegistration: prepared.localRuntimeBindings.workbenchContribution,
      trustedLocalWebExtensionProtectedPrefixes: prepared.localRuntimeBindings.protectedPathPrefixes,
      operationalLogWriter: prepared.operationalLogWriter,
      ...(prepared.manifest.modelProviderProfile === undefined ? {} : { modelProviderProfile: 'MODEL_GATEWAY_ONLY' as const }),
    };
    const composition = runProductCompositionAsync(
      appOptions,
      {
        channelAuthProfile: 'DEFAULT_WEB',
        frontendHostingProfile: prepared.frontendHostingProfile,
      },
      prepared.productHostInput,
    );
    runnerAccepted = true;
    outcome = await composition;
  } catch (error) {
    if (!runnerAccepted) {
      await closeOperationalWriterQuietly(prepared.operationalLogWriter);
    }
    reportLocalPreAppStartupFailure();
    throw new AgentError({
      code: 'APP_START_FAILED',
      message: 'Local runtime app composition failed.',
      category: 'INTERNAL',
      retryable: false,
      safeDetails: { failureStage: 'APP_STARTUP' },
      cause: error,
    });
  }
  const app = outcome.app;
  writeConfigValidationEvidence(prepared.root, prepared.candidateId, prepared.config.configEvaluation);
  try {
    await app.start();
  } catch (error) {
    outcome.hostFacts.reportAppStartFailure(error);
    await closeAppQuietly(app);
    writeConfigValidationEvidence(
      prepared.root,
      prepared.candidateId,
      blockedConfigEvaluationInput([{ code: 'startup-failed', message: safeDiagnosticMessage(error, prepared.root), evidenceRef: startupProofRef }]),
    );
    writeStartupFailure(prepared.root, prepared.candidateId, [
      { code: 'startup-failed', message: safeDiagnosticMessage(error, prepared.root), evidenceRef: startupProofRef },
    ]);
    throw error;
  }
  writeLocalRuntimeReadyNotice({ host: prepared.appSystemConfig.channel.host, port: prepared.appSystemConfig.channel.port });
  const proof: LocalRuntimeStartProof = {
    candidateId: prepared.candidateId,
    primaryHealth: 'ok',
    readiness: 'ready',
    runStateRef: 'run/nextagent.pid',
    gateway: outcome.hostFacts.gatewayReadiness,
  };
  writeJson(resolve(prepared.root, proof.runStateRef), { candidateId: prepared.candidateId, pid: process.pid });
  writeJson(resolve(prepared.root, startupProofRef), proof);
  writeJson(resolve(prepared.root, healthReadinessProofRef), {
    candidateId: proof.candidateId,
    primaryStatus: 'PASSED',
    deepStatus: 'PASSED',
    criticalDependencyStatuses: [],
    evidenceRefs: [startupProofRef],
  });
  runningPackages.set(prepared.root, app);
  return proof;
}

function reportLocalPreAppStartupFailure(): void {
  try {
    process.stderr.write('{"event":"app.start.failed","failureStage":"APP_STARTUP"}\n');
  } catch {
    // stderr can already be detached; startup must still terminate deterministically.
  }
}

export async function startRuntimePackage(packageRoot: string): Promise<LocalRuntimeStartProof> {
  const preparedConfig = prepareRuntimePackageConfigFact(packageRoot, 'Runtime package');
  const { root, manifest, config } = preparedConfig;
  const deploymentEntrypointRefs = {
    ...manifest.deploymentEntrypointRefs,
    ...(config.deployment.deploymentEntrypointRefs ?? {}),
  };
  validateDeploymentEntrypointRefs(deploymentEntrypointRefs);
  const entrypoint = deploymentEntrypointRefs[config.deployment.mode];
  if (entrypoint === undefined) {
    const failure = [
      {
        code: 'deployment-entrypoint-missing',
        message: `${config.deployment.mode} deployment entrypoint is not declared by this package candidate.`,
        evidenceRef: startupProofRef,
      },
    ];
    writeConfigValidationEvidence(root, manifest.candidateId, config.configEvaluation);
    writeStartupFailure(root, manifest.candidateId, failure);
    throw new Error('Runtime package cannot start because the selected deployment entrypoint is missing.');
  }
  if (isCanonicalLocalDeploymentEntrypoint(entrypoint)) {
    return await startPreparedLocalRuntimePackage(await prepareLocalRuntimePackageHost(preparedConfig));
  }
  return await invokeDeploymentEntrypoint(root, manifest.candidateId, entrypoint);
}

function isCanonicalLocalDeploymentEntrypoint(entrypoint: LocalRuntimeDeploymentEntrypointRef): boolean {
  return entrypoint.module === 'backend/agent-app/local-runtime-package/index.js' && entrypoint.exportName === 'startLocalRuntimePackage';
}

export function runLocalRuntimePackageSelfCheck(packageRoot: string): number {
  let diagnostics: readonly LocalRuntimePackageDiagnostic[];
  try {
    diagnostics = [...checkLocalRuntimePackageLayout(packageRoot), ...validateLocalRuntimePackageConfigSample(packageRoot)];
  } catch {
    writeLocalRuntimeSelfCheckFailure([{ code: 'self-check-failed' }]);
    return 1;
  }
  if (diagnostics.length === 0) {
    return 0;
  }
  writeLocalRuntimeSelfCheckFailure(diagnostics);
  return 1;
}

async function invokeDeploymentEntrypoint(
  packageRoot: string,
  candidateId: string,
  entrypoint: LocalRuntimeDeploymentEntrypointRef,
): Promise<LocalRuntimeStartProof> {
  let module: unknown;
  try {
    module = await import(resolveDeploymentEntrypointModule(packageRoot, entrypoint.module));
  } catch {
    const diagnostics = [
      {
        code: 'deployment-entrypoint-unavailable',
        message: 'Selected deployment entrypoint module is unavailable.',
        evidenceRef: startupProofRef,
      },
    ];
    writeStartupFailure(packageRoot, candidateId, diagnostics);
    throw new Error('Runtime package cannot start because the selected deployment entrypoint module is unavailable.');
  }
  const start = asDeploymentStartFunction(module, entrypoint.exportName);
  if (start === undefined) {
    const diagnostics = [
      {
        code: 'deployment-entrypoint-invalid',
        message: 'Selected deployment entrypoint must export the configured startup function.',
        evidenceRef: startupProofRef,
      },
    ];
    writeStartupFailure(packageRoot, candidateId, diagnostics);
    throw new Error('Runtime package cannot start because the selected deployment entrypoint is invalid.');
  }
  return await start(packageRoot);
}

function resolveDeploymentEntrypointModule(packageRoot: string, moduleRef: string): string {
  if (isPackageModuleSpecifier(moduleRef)) {
    const packageRequire = createRequire(resolve(packageRoot, 'package.json'));
    return pathToFileURL(packageRequire.resolve(moduleRef)).href;
  }
  return pathToFileURL(resolvePackageRef(packageRoot, moduleRef)).href;
}

function asDeploymentStartFunction(
  module: unknown,
  exportName: string,
): ((packageRoot: string) => Promise<LocalRuntimeStartProof> | LocalRuntimeStartProof) | undefined {
  if (typeof module !== 'object' || module === null) {
    return undefined;
  }
  const candidate = (module as Record<string, unknown>)[exportName];
  return typeof candidate === 'function'
    ? (candidate as (packageRoot: string) => Promise<LocalRuntimeStartProof> | LocalRuntimeStartProof)
    : undefined;
}

export async function stopLocalRuntimePackage(packageRoot: string): Promise<void> {
  const root = resolve(packageRoot);
  const app = runningPackages.get(root);
  if (app !== undefined) {
    await closeAppQuietly(app);
    runningPackages.delete(root);
  } else {
    const state = readRunState(packageRoot);
    if (state !== undefined && isProcessLive(state.pid) && state.pid !== process.pid) {
      try {
        process.kill(state.pid);
      } catch {
        // Stop is best-effort once the recorded process is already gone.
      }
    }
  }
  cleanupStaleRunState(packageRoot);
  rmSync(resolve(packageRoot, 'run', 'nextagent.pid'), { force: true });
}

export function safeDiagnosticMessage(error: unknown, packageRoot: string): string {
  const message = error instanceof Error ? error.message : 'Unknown validation failure.';
  const withoutRoot = message.split(resolve(packageRoot)).join('<package-root>');
  return withoutRoot
    .replace(/[A-Za-z]:[\\/][^\s,;)]*/gu, '<local-path>')
    .replace(/\/(?:[^/\s,;)]+\/){2,}[^/\s,;)]*/gu, '<local-path>')
    .replace(/(?:sk-|key-|token-)[A-Za-z0-9_-]+/gu, '<redacted>');
}

function assertWorkspaceBoundary(packageRoot: string, workspaceRoot: string): void {
  const normalizedWorkspace = resolve(workspaceRoot);
  for (const dir of systemDirs) {
    const systemDir = resolve(packageRoot, dir);
    if (isSameOrInside(normalizedWorkspace, systemDir)) {
      throw new Error(`Workspace root must not point to package system directory ${dir}.`);
    }
  }
}

function resolvePackageRef(packageRoot: string, ref: string): string {
  assertPackageRef(ref, 'package ref');
  return resolve(packageRoot, ref);
}

function assertPackageRef(ref: string, label: string): void {
  assertNonEmpty(ref, label);
  if (isAbsolute(ref) || ref.includes('..') || ref.split(/[\\/]/u).some((part) => part === '')) {
    throw new Error(`${label} must be package-root relative.`);
  }
  if (/\s/u.test(ref) || /(?:sk-|key-|token-)[A-Za-z0-9_-]+/u.test(ref) || /provider[-_/]payload/iu.test(ref) || /stack[-_/]trace/iu.test(ref)) {
    throw new Error(`${label} must be a safe package ref.`);
  }
}

function validateDeploymentEntrypointRef(value: unknown, label: string): void {
  const record = asRecord(value, label);
  const moduleRef = asString(record.module, `${label} module`);
  const exportName = asString(record.exportName, `${label} exportName`);
  if (!isPackageModuleSpecifier(moduleRef)) {
    assertPackageRef(moduleRef, `${label} module`);
  }
  assertSafeId(exportName, `${label} exportName`);
}

function validateDeploymentEntrypointRefs(deploymentEntrypointRefs: LocalRuntimePackageManifest['deploymentEntrypointRefs']): void {
  validateDeploymentEntrypointRef(deploymentEntrypointRefs.LOCAL, 'LOCAL deployment entrypoint');
  if (deploymentEntrypointRefs.REMOTE !== undefined) {
    validateDeploymentEntrypointRef(deploymentEntrypointRefs.REMOTE, 'REMOTE deployment entrypoint');
  }
}

function isPackageModuleSpecifier(value: string): boolean {
  return (
    /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._/-]*)?$/u.test(value) &&
    !value.startsWith('backend/') &&
    !value.startsWith('bin/') &&
    !value.startsWith('config/') &&
    !value.startsWith('data/') &&
    !value.startsWith('logs/') &&
    !value.startsWith('run/') &&
    !value.startsWith('skills/') &&
    !value.startsWith('workspaces/')
  );
}

function assertSafeId(value: string, label: string): void {
  assertNonEmpty(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new Error(`${label} must be a safe id.`);
  }
}

function assertPackageProfile(profile: string): asserts profile is LocalRuntimePackageProfile {
  if (!(localRuntimePackageProfiles as readonly string[]).includes(profile)) {
    throw new Error('Unsupported local runtime package profile.');
  }
}

function assertPackagePlatform(platform: string, arch: string): void {
  if (!((platform === 'win32' || platform === 'linux') && arch === 'x64')) {
    throw new Error('Unsupported local runtime package platform.');
  }
}

function assertNodeVersion(nodeVersion: string): void {
  assertNonEmpty(nodeVersion, 'nodeVersion');
  if (!/^v\d+\.\d+\.\d+/u.test(nodeVersion)) {
    throw new Error('nodeVersion must be a Node.js version string.');
  }
}

function validateMandatoryEvidenceRefs(packageRoot: string, manifest: LocalRuntimePackageManifest): LocalRuntimePackageDiagnostic[] {
  const diagnostics: LocalRuntimePackageDiagnostic[] = [];
  const mandatoryRefs = [manifestRef, layoutCheckRef, configValidationEvidenceRef, startupProofRef, healthReadinessProofRef];
  for (const ref of mandatoryRefs) {
    if (!manifest.evidenceRefs.includes(ref) && ref !== manifestRef) {
      diagnostics.push({ code: 'missing-mandatory-evidence-ref', message: `${ref} is required.`, evidenceRef: ref });
      continue;
    }
    if (!existsSync(resolvePackageRef(resolve(packageRoot), ref))) {
      diagnostics.push({ code: 'missing-mandatory-evidence', message: `${ref} is required.`, evidenceRef: ref });
    }
  }
  if (diagnostics.length > 0) {
    return diagnostics;
  }
  const evidenceRecords = [
    [layoutCheckRef, readEvidenceRecord(packageRoot, layoutCheckRef)],
    [configValidationEvidenceRef, readEvidenceRecord(packageRoot, configValidationEvidenceRef)],
    [startupProofRef, readEvidenceRecord(packageRoot, startupProofRef)],
    [healthReadinessProofRef, readEvidenceRecord(packageRoot, healthReadinessProofRef)],
  ] as const;
  for (const [ref, record] of evidenceRecords) {
    if (record.candidateId !== manifest.candidateId) {
      diagnostics.push({ code: 'candidate-evidence-mismatch', message: `${ref} does not belong to this package candidate.`, evidenceRef: ref });
    }
  }
  if (evidenceRecords[0][1].passed !== true) {
    diagnostics.push({ code: 'layout-check-not-passed', message: 'Package layout check must pass before handoff.', evidenceRef: layoutCheckRef });
  }
  if (evidenceRecords[2][1].primaryHealth !== 'ok' || evidenceRecords[2][1].readiness !== 'ready') {
    diagnostics.push({ code: 'startup-proof-not-passed', message: 'Startup proof must be passed before handoff.', evidenceRef: startupProofRef });
  }
  if (evidenceRecords[3][1].primaryStatus !== 'PASSED' || evidenceRecords[3][1].deepStatus !== 'PASSED') {
    diagnostics.push({
      code: 'health-readiness-not-passed',
      message: 'Health/readiness proof must pass before handoff.',
      evidenceRef: healthReadinessProofRef,
    });
  }
  return diagnostics;
}

function readEvidenceRecord(packageRoot: string, ref: string): Record<string, unknown> {
  return asRecord(JSON.parse(readFileSync(resolvePackageRef(resolve(packageRoot), ref), 'utf8')), ref);
}
function createPackageConfigSample(content: string): unknown {
  const raw = parseBuiltInConfig(content);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const config = raw as Record<string, unknown>;
  const modelProfiles = Array.isArray(config.modelProfiles) ? config.modelProfiles : [];
  return {
    ...config,
    paths: {
      ...(typeof config.paths === 'object' && config.paths !== null && !Array.isArray(config.paths) ? config.paths : {}),
      agentRoot: 'agents',
      skillRoot: 'skills',
    },
    modelProfiles: modelProfiles.map((profile) => {
      if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) {
        return profile;
      }
      const record = profile as Record<string, unknown>;
      const models = Array.isArray(record.models) ? record.models : [];
      return {
        ...record,
        models: models.map((model, index) =>
          index === 0 && record.providerId === 'openai-compatible' && typeof model === 'object' && model !== null && !Array.isArray(model)
            ? { ...model, modelId: 'env:OPENAI_MODEL_NAME' }
            : model,
        ),
      };
    }),
  };
}

function assertModelGatewayOnlyRawConfig(rawConfig: unknown): void {
  const config =
    typeof rawConfig === 'object' && rawConfig !== null && !Array.isArray(rawConfig) ? (rawConfig as Record<string, unknown>) : undefined;
  const modelProfiles = config !== undefined && Array.isArray(config.modelProfiles) ? config.modelProfiles : [];
  const providerIds = modelProfiles.flatMap((profile) => {
    const providerId =
      typeof profile === 'object' && profile !== null && !Array.isArray(profile) ? (profile as Record<string, unknown>).providerId : undefined;
    return typeof providerId === 'string' ? [providerId] : [];
  });
  assertModelProviderProfileSupportsProviderIds('MODEL_GATEWAY_ONLY', providerIds);
}

function assertModelGatewayOnlyConfig(config: DefaultSystemConfig): void {
  assertModelProviderProfileSupportsProviderIds(
    'MODEL_GATEWAY_ONLY',
    config.modelProfiles.map((profile) => profile.providerId),
  );
}

function resolvePackageConfigEnvRefs(input: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return input;
  }
  const config = input as Record<string, unknown>;
  const modelProfiles = Array.isArray(config.modelProfiles) ? config.modelProfiles : [];
  return {
    ...config,
    modelProfiles: modelProfiles.map((profile) => {
      if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) {
        return profile;
      }
      const record = profile as Record<string, unknown>;
      return resolveModelProfileEnvRefs(record, (name) => env[name]);
    }),
  };
}

function assertNoActiveRunState(packageRoot: string, candidateId: string): void {
  const state = readRunState(packageRoot);
  if (state !== undefined && state.candidateId === candidateId && isProcessLive(state.pid)) {
    writeStartupFailure(packageRoot, candidateId, [
      { code: 'already-running', message: 'Local runtime package candidate is already running.', evidenceRef: startupProofRef },
    ]);
    throw new Error('Local runtime package candidate is already running.');
  }
}

function cleanupStaleRunState(packageRoot: string, candidateId?: string): void {
  const state = readRunState(packageRoot);
  if (state === undefined) {
    return;
  }
  if ((candidateId === undefined || state.candidateId === candidateId) && !isProcessLive(state.pid)) {
    rmSync(resolve(packageRoot, 'run', 'nextagent.pid'), { force: true });
  }
}

function readRunState(packageRoot: string): { readonly candidateId: string; readonly pid: number } | undefined {
  const path = resolve(packageRoot, 'run', 'nextagent.pid');
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { candidateId?: unknown; pid?: unknown };
    if (typeof value.candidateId === 'string' && typeof value.pid === 'number') {
      return { candidateId: value.candidateId, pid: value.pid };
    }
  } catch {
    return { candidateId: 'stale', pid: -1 };
  }
  return { candidateId: 'stale', pid: -1 };
}

function isProcessLive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (pid === process.pid) {
    return true;
  }
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== 'win32') {
    return true;
  }
  return isWindowsProcessLive(pid);
}

function isWindowsProcessLive(pid: number): boolean {
  try {
    const output = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 2000,
    }).toString('utf8');
    const firstLine = output.split(/\r?\n/u)[0] ?? '';
    return firstLine.includes(`"${pid}"`);
  } catch {
    return false;
  }
}

async function closeAppQuietly(app: NextAgentApp): Promise<void> {
  try {
    await app.close();
  } catch {
    // Startup/stop failures are reported through safe package evidence.
  }
}

async function closeOperationalWriterQuietly(writer: OperationalLogWriter): Promise<void> {
  try {
    await writer.close(5_000);
  } catch {
    // Pre-runner package preparation cleanup is best-effort.
  }
}

function createWithFrontendPackageHostInput(
  packageRoot: string,
  productVersion: string,
  indexHtmlScripts: readonly string[],
): ProductHostCompositionInput {
  const candidateHostingPath = resolve(packageRoot, 'node_modules', '@nextagent', 'agent-web', 'hosting.js');
  if (!existsSync(candidateHostingPath)) {
    throw new Error('with-frontend candidate is missing @nextagent/agent-web/hosting.js.');
  }
  return {
    productVersion,
    indexHtmlScripts,
    resolveFrontendHostingManifest: async () => {
      const frontendHosting = (await import(pathToFileURL(candidateHostingPath).href)) as { resolveFrontendHostingManifest?: () => unknown };
      if (typeof frontendHosting.resolveFrontendHostingManifest !== 'function') {
        throw new Error('@nextagent/agent-web/hosting must export resolveFrontendHostingManifest().');
      }
      return frontendHosting.resolveFrontendHostingManifest();
    },
    useDefaultWorkbenchScripts: false,
  };
}

function writeConfigValidationEvidence(packageRoot: string, candidateId: string, validation: AppConfigEvaluation): void {
  writeJson(
    resolve(packageRoot, configValidationEvidenceRef),
    createConfigValidationEvidence(candidateId, validation, [configValidationEvidenceRef]),
  );
}

function blockedConfigEvaluationInput(diagnostics: readonly LocalRuntimePackageDiagnostic[]): AppConfigEvaluation {
  return {
    readinessState: 'BLOCKED',
    diagnostics: diagnostics.map((diagnostic) => ({
      issueCode: diagnostic.code,
      severity: 'ERROR' as const,
      scope: 'app' as const,
      fieldRef: diagnostic.evidenceRef,
      safeMessage: diagnostic.message,
      affectsReadiness: true,
    })),
    evaluatedAt: new Date().toISOString(),
  };
}

function writeStartupFailure(packageRoot: string, candidateId: string, diagnostics: readonly LocalRuntimePackageDiagnostic[]): void {
  writeJson(resolve(packageRoot, startupProofRef), {
    candidateId,
    started: false,
    diagnostics: diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: safeDiagnosticMessage(new Error(diagnostic.message), packageRoot),
      evidenceRef: diagnostic.evidenceRef,
    })),
  });
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function asStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be a string array.`);
  }
  return value as readonly string[];
}

function isSameOrInside(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function writeEntrypointScript(path: string, command: 'start' | 'stop' | 'self-check'): void {
  const commands = {
    start: 'await startRuntimePackage(packageRoot);',
    stop: 'await stopLocalRuntimePackage(packageRoot);',
    'self-check': 'process.exitCode = runLocalRuntimePackageSelfCheck(packageRoot);',
  };
  writeFileSync(
    path,
    `#!/usr/bin/env node
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning") return;
  if (warning.code === "FSTWRN004") return;
  process.stderr.write((warning.stack ?? warning.message) + "\\n");
});
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
process.env.NEXTAGENT_CONFIG_DIR ??= resolve(packageRoot, "config");
const { runLocalRuntimePackageSelfCheck, startRuntimePackage, stopLocalRuntimePackage } = await import(new URL("../backend/agent-app/local-runtime-package/index.js", import.meta.url));
${commands[command]}
`,
    'utf8',
  );
  chmodSync(path, 0o755);
  writeFileSync(
    `${path}.cmd`,
    `@echo off
cd /d "%~dp0.."
node "%~dp0${path.split(/[\\/]/u).at(-1)}" %*
`,
    'utf8',
  );
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
