import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('long-term memory knowledge guardrail boundary', () => {
  it('keeps the RobotRouter knowledge endpoint inside the REMOTE guardrail adapter', () => {
    const matches = sourceFiles(join(root, 'packages'))
      .filter((file) => readFileSync(file, 'utf8').includes('/rest/naie/guardrail/v1/text/security/check'))
      .map((file) => relative(root, file).replaceAll('\\', '/'));

    expect(matches).toEqual(['packages/agent-platform-gateway-remote/src/guardrail/robotrouter-guardrail-gateway.ts']);
  });

  it('keeps memory admission provider-neutral and persistence adapters guardrail-free', () => {
    const memorySource = sourceText(join(root, 'packages', 'agent-memory', 'src'));
    const localGatewaySource = sourceText(join(root, 'packages', 'agent-platform-gateway-local', 'src'));

    expect(memorySource).not.toMatch(/agent-platform-gateway-remote|RobotRouter|\/rest\/naie\/guardrail/u);
    expect(localGatewaySource).not.toMatch(/GuardrailGatewayPort|checkKnowledge|LTM_CONTENT_GUARD/u);
  });

  it('keeps the coordinator package-internal and fixes privacy without a caller override', () => {
    const coordinator = readFileSync(join(root, 'packages', 'agent-memory', 'src', 'long-term-memory-write-coordinator.ts'), 'utf8');
    const publicIndex = readFileSync(join(root, 'packages', 'agent-memory', 'src', 'index.ts'), 'utf8');
    const callerSource = ['memory-tool-port.ts', 'memory-extraction.ts', 'long-term-memory-management.ts']
      .map((file) => readFileSync(join(root, 'packages', 'agent-memory', 'src', file), 'utf8'))
      .join('\n');
    const appCompositionSource = sourceText(join(root, 'packages', 'agent-app', 'src', 'composition'));
    const webSource = sourceText(join(root, 'packages', 'agent-channel-web', 'src'));
    const configSource = sourceText(join(root, 'packages', 'agent-app', 'src', 'config'));

    expect(coordinator).toContain('guardrail.checkKnowledge({ texts, isPrivacy: true }, signal)');
    expect(publicIndex).not.toContain('long-term-memory-write-coordinator');
    expect(appCompositionSource).not.toContain('LongTermMemoryWriteCoordinator');
    expect(appCompositionSource).not.toContain('longTermMemoryWriteCoordinator');
    expect(appCompositionSource).not.toContain('writeCoordinator');
    expect(callerSource).not.toContain('isPrivacy');
    expect(webSource).not.toContain('checkKnowledge');
    expect(configSource).not.toContain('checkKnowledge');
  });
});

function sourceText(directory: string): string {
  return sourceFiles(directory)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}
