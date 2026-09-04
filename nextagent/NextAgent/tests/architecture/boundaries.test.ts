import { classifyArchitectureImport } from '@nextagent/agent-test-kit';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('architecture boundaries', () => {
  it('ships negative fixtures for forbidden architecture imports', () => {
    const fixtures = ['forbidden-contract-import', 'private-import', 'framework-leakage', 'provider-sdk-leakage', 'channel-web-local-auth'];

    for (const fixture of fixtures) {
      expect(existsSync(join(root, 'tests', 'fixtures', 'architecture', fixture, 'packages'))).toBe(true);
    }

    expect(classifyArchitectureImport('@nextagent/agent-contracts/runtime')).toBe('public');
    expect(classifyArchitectureImport('../../agent-runtime/src/index.js')).toBe('private');
  });

  it('keeps AI SDK and OpenAI-compatible adapter types inside agent-model', () => {
    for (const packageName of ['agent-contracts', 'agent-core', 'agent-runtime', 'agent-channel-web']) {
      for (const file of sourceFiles(join(root, 'packages', packageName, 'src'))) {
        const source = readFileSync(file, 'utf8');
        expect(source).not.toMatch(/from ["'](?:ai|@ai-sdk\/openai-compatible)["']/u);
      }
    }
  });

  it('keeps compatible stream aggregation on the AI SDK result surface', () => {
    const adapter = readFileSync(
      join(root, 'packages', 'agent-model', 'src', 'providers', 'openai-compatible', 'openai-compatible-provider.ts'),
      'utf8',
    );

    expect(adapter).toContain('extractReasoningMiddleware');
    expect(adapter).toContain('wrapLanguageModel');
    expect(adapter).toContain('onChunk:');
    for (const sdkResult of ['result.text', 'result.reasoningText', 'result.toolCalls', 'result.totalUsage']) {
      expect(adapter).toContain(sdkResult);
    }
    expect(adapter).not.toMatch(/includeRawChunks|readOpenAICompatibleRawDelta|createThinkMarkupState|rawFinishReason|finish-step/u);
    expect(existsSync(join(root, 'packages', 'agent-model', 'src', 'providers', 'shared', 'stream-normalizer.ts'))).toBe(false);
  });

  it('keeps agent-channel-web decoupled from agent-capability internals', () => {
    for (const file of sourceFiles(join(root, 'packages', 'agent-channel-web', 'src'))) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/from ["']@nextagent\/agent-capability["']/u);
      expect(source).not.toMatch(/CapabilityCatalog|AssemblyRegistry/u);
    }
  });

  it('keeps agent-channel-web decoupled from share gateway internals', () => {
    for (const file of sourceFiles(join(root, 'packages', 'agent-channel-web', 'src'))) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(
        /ConversationShareStoreGateway|ConversationShareRecord|createShare.*record.*ConversationShareRecord|loadShare.*request.*LoadShareRequest/u,
      );
    }
  });

  it('keeps share gateway port out of agent-runtime, agent-context-engine, agent-capability', () => {
    for (const packageName of ['agent-runtime', 'agent-context-engine', 'agent-capability']) {
      for (const file of sourceFiles(join(root, 'packages', packageName, 'src'))) {
        const source = readFileSync(file, 'utf8');
        expect(source).not.toMatch(/ConversationShareStoreGateway|RuntimeConversationSharePort/u);
      }
    }
  });

  it('keeps task trajectory builder out of runtime, gateway-local internals, and memory tools', () => {
    for (const file of sourceFiles(join(root, 'packages', 'agent-runtime', 'src'))) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('TaskTrajectoryBuilder');
      expect(source).not.toContain('task-trajectory-builder');
    }

    for (const file of sourceFiles(join(root, 'packages', 'agent-memory', 'src'))) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/agent-platform-gateway-local|node:sqlite|SqliteGatewayStores|SessionMessageRow|FTS5/iu);
    }

    const memoryToolsSource = readFileSync(join(root, 'packages', 'agent-memory', 'src', 'memory-tools.ts'), 'utf8');
    expect(memoryToolsSource).not.toMatch(/TaskTrajectory|taskTrajectory|task-trajectory/iu);
  });

  it('keeps agent-workflow decoupled from fetch/HTTP driver via gateway port', () => {
    for (const file of sourceFiles(join(root, 'packages', 'agent-workflow', 'src'))) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/from ["']node:http["']|from ["']node:https["']|from ["']undici["']/u);
      expect(source).not.toMatch(/from ["']@nextagent\/agent-platform-gateway-remote["']/u);
    }
  });

  it('keeps agent-platform-gateway-remote decoupled from agent-workflow internals', () => {
    for (const file of sourceFiles(join(root, 'packages', 'agent-platform-gateway-remote', 'src'))) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/from ["']@nextagent\/agent-workflow["']/u);
      expect(source).not.toMatch(/createWorkflowExecutionService|WorkflowExecutionEngine|RemoteWorkflowExecutionService/u);
    }
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}
