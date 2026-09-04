import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const agentAppSourceRoot = join(root, 'packages', 'agent-app', 'src');
const appCompositionRoot = join(agentAppSourceRoot, 'composition');

const forbiddenAppCompositionPatterns = [
  /\bfunction\s+runtimeObservationFromLogEntry\b/u,
  /\bfunction\s+budgetObservationFromRuntimeLog\b/u,
  /\bfunction\s+sandboxCompletionObservationFromRuntimeLog\b/u,
  /\bfunction\s+parseMemoryExtractionLlmCandidates\b/u,
  /\bfunction\s+memoryExtractionSafeError\b/u,
  /\bfunction\s+createMemoryAgingDiagnosticObservation\b/u,
  /\bfunction\s+createMemoryExtractionDiagnosticObservation\b/u,
  /\bfunction\s+createTaskTrajectoryDiagnosticObservation\b/u,
  /\bfunction\s+createMemoryAgingAuditObservation\b/u,
  /\bfunction\s+createMemoryExtractionAuditObservation\b/u,
  /\bfunction\s+createWorkflowRuntimeCapabilityResolver\b/u,
  /\bfunction\s+resolveWorkflowModelInvocationConfig\b/u,
  /\bfunction\s+prepareWorkflowLlmPrompt\b/u,
  /\bfunction\s+createWorkflowToolPort\b/u,
  /\bfunction\s+mapWorkflowResult\b/u,
  /\bfunction\s+safeFilterOutputVariables\b/u,
  /\bfunction\s+createRecipeCapabilityProvider\b/u,
  /\bfunction\s+normalizeNodeDefinition\b/u,
  /\bfunction\s+adaptFetchWorkflowRemoteGateway\b/u,
  /\bfunction\s+createFetchWorkflowRemoteExecutionGatewayFromEndpoint\b/u,
  /\basync\s+function\s+runSandbox\b/u,
  /\bfunction\s+preparePythonSandboxExecution\b/u,
  /\bfunction\s+sanitizeSandboxExecutionDiagnosticMessage\b/u,
  /\bfunction\s+toSandboxCapabilitySafeError\b/u,
  /\bfunction\s+createSandboxClipCommandRunner\b/u,
  /\bfunction\s+clipStartupExecutionRequest\b/u,
  /\bfunction\s+clipToolExecutionRequest\b/u,
  /\bfunction\s+parseRunnerArray\b/u,
  /\bfunction\s+parseRunnerObject\b/u,
  /\bfunction\s+createLongTermMemoryToolPort\b/u,
  /\bfunction\s+filterUserCharacteristicsByPurpose\b/u,
  /\bfunction\s+listActiveMemory\b/u,
  /\bfunction\s+createDefaultLargeContentExternalizer\b/u,
  /\bfunction\s+shouldExternalizeDraft\b/u,
  /\bfunction\s+renderCapabilityResultPreview\b/u,
  /\bfunction\s+selectModelProfileForPatch\b/u,
  /\bfunction\s+mergeModelOptions\b/u,
  /\bfunction\s+modelInfoFromProfile\b/u,
  /\bfunction\s+registerAppRequestLogging\b/u,
  /\bfunction\s+gatewayObservationStableRefs\b/u,
  /\bfunction\s+writeSafeErrorTerminalContentLog\b/u,
  /\bfunction\s+createAttachmentIntakeObservation\b/u,
  /\bfunction\s+createAttachmentCleanupObservation\b/u,
  /\bfunction\s+updateModelObservationContext\b/u,
  /\bfunction\s+createSkillCatalogQueryPort\b/u,
  /\bfunction\s+isSkillHubProviderSourceAuthorized\b/u,
  /\bfunction\s+noopRagRetrievalGateway\b/u,
  /\bfunction\s+lazySubagentExecutionPort\b/u,
  /\bfunction\s+recordProjectionResult\b/u,
  /\bfunction\s+attachRecipeCapabilitiesToAssemblies\b/u,
  /\bclass\s+DisabledLongTermMemoryAdapter\b/u,
  /\bfunction\s+createDisabledLongTermMemoryGateway\b/u,
  /\bfunction\s+ltmDisabledSafeError\b/u,
  /\bfunction\s+createAppHealthProbes\b/u,
  /\bSUGGESTED_QUESTION_SYSTEM_PROMPT\b/u,
  /\bparseQuestions\b/u,
  /\bcomputeQuestionHash\b/u,
  /\blistQuestionAssociations\b/u,
  /\bCategoryQuestionResourceDiscovery\b/u,
] as const;

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('agent-app composition root ownership source guard', () => {
  for (const file of sourceFiles(appCompositionRoot)) {
    it(`${file.replace(root, '')} does not define owner-owned helper implementations`, () => {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbiddenAppCompositionPatterns) {
        expect(source).not.toMatch(pattern);
      }
    });
  }

  it('assembles Gateway bindings before registering the model adapter', () => {
    const source = readFileSync(join(appCompositionRoot, 'create-app.ts'), 'utf8');
    const gatewayComposition = source.indexOf('const gatewayLayer = composeGatewayLayer(');
    const modelComposition = source.indexOf('composeModelRuntime({', gatewayComposition);

    expect(gatewayComposition).toBeGreaterThanOrEqual(0);
    expect(modelComposition).toBeGreaterThan(gatewayComposition);
    expect(source.slice(modelComposition, modelComposition + 800)).toContain('gatewayBindings.fetch');
  });

  it('delegates provider registration composition and distributes explicit model ports', () => {
    const modelCompositionSource = readFileSync(join(appCompositionRoot, 'model-composition.ts'), 'utf8');
    const appSource = readFileSync(join(appCompositionRoot, 'create-app.ts'), 'utf8');
    const contextCompositionSource = readFileSync(join(appCompositionRoot, 'context-engine-composition.ts'), 'utf8');
    const modelIndexSource = readFileSync(join(root, 'packages', 'agent-model', 'src', 'index.ts'), 'utf8');
    const configuredRuntimeSource = readFileSync(join(root, 'packages', 'agent-model', 'src', 'runtime', 'configured-model-runtime.ts'), 'utf8');
    const catalogSource = readFileSync(join(root, 'packages', 'agent-model', 'src', 'catalog', 'model-catalog.ts'), 'utf8');
    const invocationSource = readFileSync(join(root, 'packages', 'agent-model', 'src', 'invocation', 'catalog-backed-model-invocation.ts'), 'utf8');
    const registrySource = readFileSync(join(root, 'packages', 'agent-model', 'src', 'runtime', 'model-runtime-registry.ts'), 'utf8');

    expect(modelCompositionSource).toContain('createConfiguredModelRuntime({');
    expect(modelCompositionSource).toContain('assemblyRegistry: input.assemblyRegistry');
    expect(modelCompositionSource).toContain('lifecycleHookInvocation: input.lifecycleHookInvocation');
    expect(modelCompositionSource).not.toMatch(/createModelCatalogRuntime|createModelGatewayProviderRegistration|ModelProviderRuntimeRegistration/u);
    expect(modelCompositionSource).toContain('createOpenAICompatibleModelProviderRegistration({');
    expect(appSource).toMatch(/const\s*\{\s*modelCatalog,\s*modelInvocationService\s*\}\s*=\s*composeModelRuntime/u);
    expect(configuredRuntimeSource).toContain('readonly modelCatalog: ModelCatalogQueryService;');
    expect(configuredRuntimeSource).toContain('readonly modelInvocationService: ModelInvocationService;');
    expect(appSource).not.toContain('createAssemblyAuthorizedModelInvocationService');
    expect(appSource).not.toContain('createLifecycleHookModelInvocationService');
    expect(appSource).not.toContain('configuredModelInvocationService');
    expect(appSource).not.toContain('runBoundModelInvocationService');
    expect(appSource).not.toContain('modelRuntime.');
    expect(appSource).not.toContain('providers.' + 'membership');
    expect(configuredRuntimeSource).toContain('createAssemblyAuthorizedModelInvocationService(');
    expect(configuredRuntimeSource).toContain('createLifecycleHookModelInvocationService(');
    expect(catalogSource).not.toContain('ModelInvocationService');
    expect(catalogSource).not.toContain('effectiveRequest');
    expect(catalogSource).not.toMatch(/providerId\s*[!=]==?/u);
    expect(invocationSource).toContain('createCatalogBackedModelInvocationService(');
    expect(invocationSource).toContain('effectiveRequest(');
    expect(registrySource).toContain('createModelRuntimeRegistry(');
    expect(registrySource).toContain('bindingsByModelId');
    expect(contextCompositionSource).toContain('ModelCatalogQueryService');
    expect(contextCompositionSource).not.toMatch(/ModelCatalogQueryService\s*&/u);
    expect(modelIndexSource).not.toMatch(
      /catalog\/model-catalog|model-gateway-registration|openai-compatible-provider|assembly-authorization|lifecycle-hook-wrapper/u,
    );
  });

  it('keeps scripted-model factories on the testing surface without a service-input loop', () => {
    const appSource = readFileSync(join(appCompositionRoot, 'create-app.ts'), 'utf8');
    const modelCompositionSource = readFileSync(join(appCompositionRoot, 'model-composition.ts'), 'utf8');
    const contractsSource = readFileSync(join(appCompositionRoot, 'composition-contracts.ts'), 'utf8');
    const localConfiguredSource = readFileSync(join(appCompositionRoot, 'create-local-configured-app.ts'), 'utf8');
    const testingSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'testing.ts'), 'utf8');
    const configuredRuntimeSource = readFileSync(join(root, 'packages', 'agent-model', 'src', 'runtime', 'configured-model-runtime.ts'), 'utf8');
    const compatibleProviderSource = readFileSync(
      join(root, 'packages', 'agent-model', 'src', 'providers', 'openai-compatible', 'openai-compatible-provider.ts'),
      'utf8',
    );

    expect(appSource).not.toMatch(/export (?:async )?function createComposedApp/u);
    expect(appSource).not.toContain('ExplicitModel' + 'Input');
    expect(appSource).not.toContain('explicit' + 'Model');
    expect(appSource).not.toContain('model' + 'Input');
    expect(
      contractsSource.slice(
        contractsSource.indexOf('export interface CreateNextAgentAppOptions'),
        contractsSource.indexOf('export type NextAgentAppOptions'),
      ),
    ).not.toContain('ModelInvocationService');
    expect(localConfiguredSource).not.toContain('ModelInvocationService');
    expect(localConfiguredSource).not.toContain('createLocalConfiguredComposedApp');
    expect(modelCompositionSource).not.toContain('ModelInvocationService');
    expect(
      configuredRuntimeSource.slice(
        configuredRuntimeSource.indexOf('export interface ConfiguredModelRuntimeOptions'),
        configuredRuntimeSource.indexOf('export type PreparedConfiguredModelProviders'),
      ),
    ).not.toContain('ModelInvocationService');
    expect(compatibleProviderSource).not.toContain('createInjectedOpenAICompatibleModelProviderRegistration');
    expect(
      sourceFiles(appCompositionRoot)
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n'),
    ).not.toContain('injectedModel');
    expect(testingSource).toContain('export function createComposedApp(');
    expect(testingSource).toContain('export async function createComposedAppAsync(');
    expect(testingSource).toContain('export function createLocalConfiguredComposedApp(');
    expect(testingSource).toContain('withScriptedModelProvider(');
    expect(testingSource).toContain('modelGatewayProviders: fixture.modelGatewayProviders');
  });

  it('names auth and frontend variant selection as host composition', () => {
    const appSource = readFileSync(join(appCompositionRoot, 'create-app.ts'), 'utf8');

    expect(appSource).toContain('interface HostCompositionSelection');
    expect(appSource).toContain('function defaultHostCompositionSelection(');
    expect(appSource).not.toContain('ProductComposition' + 'Selection');
    expect(appSource).not.toContain('defaultProduct' + 'Selection');
  });

  it('uses the frozen system model profiles for startup and hot-reload assembly publication', () => {
    const assemblyCompositionSource = readFileSync(join(appCompositionRoot, 'assembly-composition.ts'), 'utf8');
    const assemblyCompilerSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'assembly', 'agent-assembly-compiler.ts'), 'utf8');

    expect(assemblyCompositionSource).not.toContain('configured' + 'Models');
    expect(assemblyCompositionSource).not.toContain('flattenModelProfiles');
    expect(assemblyCompilerSource).toContain('input.systemConfig.modelProfiles');
    expect(assemblyCompilerSource).not.toContain('ConfiguredModel' + 'Membership');
  });

  it('does not maintain a duplicate host model-profile registry', () => {
    const appSources = sourceFiles(agentAppSourceRoot)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(appSources).not.toContain('ModelProfile' + 'Registry');
    expect(appSources).not.toContain('modelProfile' + 'Registry');
  });

  it('keeps model config authoring types separate from runtime unknown validation', () => {
    const configContractSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'config', 'component-config.ts'), 'utf8');
    const validationSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'config', 'validation.ts'), 'utf8');

    expect(configContractSource).toContain('export type RawModelProfileConfig = ModelProfile;');
    expect(validationSource).toContain('rawProfiles: readonly unknown[]');
    expect(validationSource).toContain('rawProvider: unknown');
    expect(validationSource).toContain('rawProfile: unknown');
  });

  it('keeps recommendation operation identity generation in the session owner', () => {
    const appSessionCompositionSource = readFileSync(join(appCompositionRoot, 'session-services-composition.ts'), 'utf8');
    const suggestedQuestionServiceSource = readFileSync(
      join(root, 'packages', 'agent-session', 'src', 'services', 'suggested-question-service.ts'),
      'utf8',
    );

    expect(appSessionCompositionSource).not.toContain('randomUUID');
    expect(appSessionCompositionSource).not.toContain('createOperationId');
    expect(suggestedQuestionServiceSource).toContain("import { randomUUID } from 'node:crypto';");
    expect(suggestedQuestionServiceSource).toContain('operationId = randomUUID();');
  });

  it('does not create a local FetchGateway implementation', () => {
    const gatewayContractSource = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');
    const localGatewayRoot = join(root, 'packages', 'agent-platform-gateway-local', 'src');
    const localSources = sourceFiles(localGatewayRoot)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const modelSources = sourceFiles(join(root, 'packages', 'agent-model', 'src'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(gatewayContractSource).toContain('export interface FetchGateway');
    expect(localSources).not.toContain('FetchGateway');
    expect(modelSources).not.toContain('FetchGateway');
  });
});
