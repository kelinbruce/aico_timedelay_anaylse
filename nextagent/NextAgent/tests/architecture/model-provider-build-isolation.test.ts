import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const agentModelSourceRoot = join(root, 'packages', 'agent-model', 'src');
const agentAppSourceRoot = join(root, 'packages', 'agent-app', 'src');

describe('model provider build isolation', () => {
  it('keeps OpenAI-compatible SDK invocation code out of the generic model runtime', () => {
    const configuredRuntimeSource = readFileSync(join(agentModelSourceRoot, 'runtime', 'configured-model-runtime.ts'), 'utf8');
    const registrationSource = readFileSync(join(agentModelSourceRoot, 'providers', 'openai-compatible', 'registration.ts'), 'utf8');
    const providerSource = readFileSync(join(agentModelSourceRoot, 'providers', 'openai-compatible', 'openai-compatible-provider.ts'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(root, 'packages', 'agent-model', 'package.json'), 'utf8')) as {
      readonly exports?: Record<string, unknown>;
    };

    expect(configuredRuntimeSource).not.toContain('openai-compatible-provider');
    expect(configuredRuntimeSource).not.toContain('createOpenAICompatibleModelProviderRegistration');
    expect(registrationSource).not.toContain('@ai-sdk/openai-compatible');
    expect(registrationSource).not.toContain("await import('./openai-compatible-provider.js')");
    expect(registrationSource).toContain("const implementationModuleSpecifier = './openai-compatible-provider.js'");
    expect(providerSource).toContain('@ai-sdk/openai-compatible');
    expect(manifest.exports).toHaveProperty('./providers/openai-compatible');
  });

  it('excludes OpenAI-compatible invocation code from the gateway-only TypeScript build graph', () => {
    const modelGatewayProject = JSON.parse(readFileSync(join(root, 'packages', 'agent-model', 'tsconfig.model-gateway-only.json'), 'utf8')) as {
      readonly exclude?: string[];
    };
    const appGatewayProject = JSON.parse(readFileSync(join(root, 'packages', 'agent-app', 'tsconfig.model-gateway-only.json'), 'utf8')) as {
      readonly references?: Array<{ readonly path: string }>;
    };
    const appDefaultProject = JSON.parse(readFileSync(join(root, 'packages', 'agent-app', 'tsconfig.json'), 'utf8')) as {
      readonly references?: Array<{ readonly path: string }>;
    };

    expect(modelGatewayProject.exclude).toEqual([
      'src/providers/openai-compatible/openai-compatible-provider.ts',
      'src/providers/shared/tool-use-normalizer.ts',
    ]);
    expect(appGatewayProject.references).toEqual(
      (appDefaultProject.references ?? []).map((reference) =>
        reference.path === '../agent-model' ? { path: '../agent-model/tsconfig.model-gateway-only.json' } : reference,
      ),
    );
  });

  it('keeps OpenAI-compatible SDK dependencies inside the provider boundary', () => {
    const sdkImports = /(?:from\s+|import\()(['"])@ai-sdk\/openai-compatible\1|(?:from\s+|import\()(['"])ai\2/u;
    const allowedFiles = new Set([
      join(agentModelSourceRoot, 'providers', 'openai-compatible', 'openai-compatible-provider.ts'),
      join(agentModelSourceRoot, 'providers', 'shared', 'tool-use-normalizer.ts'),
    ]);
    const modelViolations = sourceFiles(agentModelSourceRoot)
      .filter((file) => !allowedFiles.has(file))
      .filter((file) => sdkImports.test(readFileSync(file, 'utf8')));
    const appViolations = sourceFiles(agentAppSourceRoot).filter((file) => sdkImports.test(readFileSync(file, 'utf8')));

    expect(modelViolations).toEqual([]);
    expect(appViolations).toEqual([]);
  });

  it('keeps OpenAI access environment names out of product source and scripts', () => {
    const productFiles = [...sourceFiles(agentAppSourceRoot), ...sourceFiles(agentModelSourceRoot)];
    const scriptSources = sourceFiles(join(root, 'scripts')).map((file) => readFileSync(file, 'utf8'));

    for (const source of [...scriptSources, ...productFiles.map((file) => readFileSync(file, 'utf8'))]) {
      expect(source).not.toContain('OPENAI_API_KEY');
      expect(source).not.toContain('OPENAI_BASE_URL');
    }
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}
