import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('prompt template assembly architecture boundary', () => {
  it('keeps prompt template assembly implementation out of public context contracts', () => {
    const contextContract = read('packages/agent-contracts/src/context/index.ts');
    for (const exportedName of [
      'PromptPurpose',
      'PromptModelCandidate',
      'PromptModelCompatibilityRequest',
      'PromptModelCompatibilityResolver',
      'PromptAssemblyRequest',
      'PromptTemplate',
      'PromptSection',
      'PromptAssemblyResult',
      'PromptTemplateAssembler',
      'SystemPromptContext',
      'SystemPromptBuilder',
      'TemplateVariableResolver',
      'TemplateVariableResolution',
      'SystemPromptContribution',
    ]) {
      expect(contextContract).not.toMatch(new RegExp(`export\\s+(interface|type|class|const)\\s+${exportedName}\\b`, 'u'));
    }
    expect(contextContract).toMatch(/export interface PromptTemplateResolverPort\b/u);
    expect(contextContract).toMatch(/export const PromptTemplateResolveRequestSchema\b/u);
  });

  it('keeps the public resolver implementation-neutral and composes it only in agent-app', () => {
    const contextContract = read('packages/agent-contracts/src/context/index.ts');
    const corePackage = read('packages/agent-core/package.json');
    const promptComposition = read('packages/agent-app/src/composition/prompt-template-composition.ts');

    expect(contextContract).not.toMatch(/PromptTemplateRegistry|PromptTemplateCompiler|PromptTemplateLoader|rootPath|templatePath/u);
    expect(corePackage).not.toContain('@nextagent/agent-context-engine');
    expect(promptComposition).toContain('createPromptTemplateResolver');
  });

  it('keeps request-path consumers on the context-engine PromptTemplateAssembler boundary', () => {
    const requestPathSources = [
      'packages/agent-context-engine/src/assembly/assemble-context.ts',
      'packages/agent-context-engine/src/summary/default-traceable-summary-generator.ts',
    ]
      .map(read)
      .join('\n');

    expect(requestPathSources).toContain('promptTemplateAssembler.assemble');
    expect(requestPathSources).not.toMatch(
      /loadSummaryPrompt|loadPromptConfig|loadSectionContents|prompt-configs|TelecomSystemPromptBuilder|LayeredProfileResolver|PromptTemplateLoader/u,
    );
  });

  it('keeps app composition as prompt-root registrar, not prompt manifest owner', () => {
    const appCompositionSources = [
      'packages/agent-app/src/composition/create-app.ts',
      'packages/agent-app/src/composition/assembly-composition.ts',
      'packages/agent-app/src/composition/prompt-template-composition.ts',
    ]
      .map(read)
      .join('\n');
    const appAssemblySources = [
      'packages/agent-app/src/assembly/agent-definition.ts',
      'packages/agent-app/src/assembly/agent-definition-parser.ts',
      'packages/agent-app/src/assembly/agent-assembly-compiler.ts',
      'packages/agent-app/src/assembly/resource-registry.ts',
      'packages/agent-app/src/config/component-config.ts',
    ]
      .map(read)
      .join('\n');

    expect(appCompositionSources).toContain("'prompts'");
    expect(appCompositionSources).toContain('promptTemplateRegistry.register');
    expect(appCompositionSources).not.toMatch(/compilePromptRoot|template\.yaml|PromptTemplateResource|defaultTelecomPrompt/u);
    expect(appAssemblySources).not.toMatch(/promptTemplateIds|defaultPromptTemplateId|PromptTemplateResource/u);
  });

  it('ships builtin prompt templates through the target dist asset path', () => {
    const assetScripts = [
      'scripts/copy-builtin-skill-assets.mjs',
      'scripts/runtime-assets.mjs',
      'scripts/pack-local-runtime.mjs',
      'scripts/validate-fullstack-packaging.mjs',
    ]
      .map(read)
      .join('\n');

    expect(assetScripts).toContain('prompt-templates');
    expect(assetScripts).not.toMatch(/Prompt config assets|promptConfigsDist|distPromptConfigs/u);
  });

  it('keeps the router default selection task owned by agent-router-plugin', () => {
    const pluginSource = read('packages/agent-plugin-sdk/src/agent-router-plugin.ts');
    const coreRuntime = join(root, 'packages/agent-core/src/routing/agent-router-plugin-runtime.ts');
    const contextBuiltin = join(root, 'packages/agent-context-engine/prompt-templates/builtin/AGENT_ROUTING_SELECTION');

    expect(existsSync(contextBuiltin)).toBe(false);
    expect(existsSync(coreRuntime)).toBe(false);
    expect(pluginSource).toContain('authoritative candidate set');
    expect(pluginSource).toContain('defaultAgentRouterSelectionTask');
  });

  it('keeps SYSTEM_PROMPT specialization behind private purpose policies', () => {
    const compiler = read('packages/agent-context-engine/src/prompt-shaping/prompt-template-compiler.ts');
    const assembler = read('packages/agent-context-engine/src/prompt-shaping/prompt-template-assembler.ts');
    const renderer = read('packages/agent-context-engine/src/prompt-shaping/model-input-renderer.ts');
    const variableRenderer = read('packages/agent-context-engine/src/prompt-shaping/variable-resolver.ts');
    const policy = read('packages/agent-context-engine/src/prompt-shaping/prompt-template-purpose-policy.ts');
    const packageBarrel = read('packages/agent-context-engine/src/prompt-shaping/index.ts');

    expect(compiler).toContain('compilePolicyForPurpose');
    expect(compiler).not.toMatch(/input\.purpose\s*===\s*SYSTEM_PROMPT|allowedSystemSections|systemSectionOrder/u);
    expect(assembler).toContain('renderPolicyForPurpose');
    expect(assembler).not.toMatch(/template\.purpose\s*===\s*SYSTEM_PROMPT|orderSystemSections|defaultSystemPromptSectionOrder/u);
    expect(renderer).toContain('renderSystemPromptContent');
    expect(renderer).not.toContain('SYSTEM_PROMPT_CACHE_BOUNDARY_MARKER');
    expect(variableRenderer).not.toMatch(
      /SYSTEM_PROMPT|SystemPromptContext|systemSection|cache_boundary|providerContribution|promptMode|telecomContext/u,
    );
    expect(packageBarrel).not.toMatch(/configurable-system-prompt-builder|dynamic-resolvers|section-definition/u);

    expect(policy).toMatch(/purpose\s*===\s*SYSTEM_PROMPT/u);
    expect(policy).toContain('sealedSystemPlacements');
    expect(policy).toContain('SYSTEM_PROMPT_CACHE_BOUNDARY_MARKER');
    expect(policy).toContain('system_protocol');
    expect(policy).toContain('developer_protocol');
  });

  it('registers memory as a builder-owned system section filtered by memoryEnabled', () => {
    const policy = read('packages/agent-context-engine/src/prompt-shaping/prompt-template-purpose-policy.ts');
    // `memory` is a builder-owned system section id in the ordered allowlist.
    expect(policy).toMatch(/'memory'/u);
    // The system render policy filters the memory section on the memoryEnabled flag.
    expect(policy).toContain('memoryEnabled');
  });

  it('registers skill_disclosure as a builder-owned dynamic system section gated by the governed skill list', () => {
    const policy = read('packages/agent-context-engine/src/prompt-shaping/prompt-template-purpose-policy.ts');
    const variableRenderer = read('packages/agent-context-engine/src/prompt-shaping/variable-resolver.ts');
    // `skill_disclosure` is a builder-owned system section id in the ordered allowlist...
    expect(policy).toMatch(/'skill_disclosure'/u);
    // ...classified as dynamic so it renders after the cache boundary, like the renderer-era append.
    expect(policy).toMatch(/dynamicSystemSections[\s\S]*'skill_disclosure'/u);
    // The system render policy filters the section on the governed skill list projection.
    expect(policy).toContain('skillDisclosureVisible');
    // The retired enabledSkills variable and its enabledCapabilities projection stay removed.
    expect(variableRenderer).not.toContain('enabledSkills');
    expect(variableRenderer).not.toContain('enabledCapabilities');
  });

  it('injects the memory gating capability id from app composition into the context engine', () => {
    const contextComposition = read('packages/agent-app/src/composition/context-engine-composition.ts');
    // App composition owns the memory tool name; the context engine stays agnostic.
    expect(contextComposition).toContain('memoryToolCapabilityId');
  });

  it('keeps generic prompt rendering off system-only context fields', () => {
    const assembler = read('packages/agent-context-engine/src/prompt-shaping/prompt-template-assembler.ts');
    const compiler = read('packages/agent-context-engine/src/prompt-shaping/prompt-template-compiler.ts');

    expect(assembler).toContain('PromptTemplateRenderContext');
    expect(assembler).toContain('buildPromptTemplateRenderContext');
    expect(assembler).not.toMatch(/SystemPromptContext|providerContribution|promptMode|telecomContext/u);
    expect(compiler).toContain('createDefaultPromptTemplateVariableResolver');
    expect(compiler).not.toContain('createDefaultTemplateVariableResolver');
  });
});

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}
