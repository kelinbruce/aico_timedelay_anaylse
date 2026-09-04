import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('SkillHub source architecture boundary', () => {
  it('keeps runtime, core, context, model and channel packages on catalog-facing imports only', () => {
    for (const packageName of ['agent-runtime', 'agent-core', 'agent-context-engine', 'agent-model', 'agent-channel-web']) {
      const imports = collectImports(join(root, 'packages', packageName, 'src'));
      expect(
        forbiddenImports(imports, [
          '@nextagent/agent-platform-gateway-remote',
          '@nextagent/agent-capability/src/skillhub',
          'skillhub/skillhub-source',
          'remote-skill-content-installer',
          'skillhub-installed-index',
          'skillhub-package-installer',
          'zip-package-reader',
        ]),
      ).toEqual([]);
    }
  });

  it('keeps SkillHub remote access behind the capability-owned SPI and app wrapper', () => {
    const capabilityImports = collectImports(join(root, 'packages', 'agent-capability', 'src'));
    const skillhubImports = collectImports(join(root, 'packages', 'agent-capability', 'src', 'skillhub'));
    const remoteImports = collectImports(join(root, 'packages', 'agent-platform-gateway-remote', 'src'));
    const capabilityBarrel = readFileSync(join(root, 'packages', 'agent-capability', 'src', 'index.ts'), 'utf8');
    const gatewayContract = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');

    expect(
      forbiddenImports(capabilityImports, ['@nextagent/agent-platform-gateway-remote', 'node:http', 'node:https', 'undici', 'axios', 'got', 'ky']),
    ).toEqual([]);
    expect(forbiddenImports(skillhubImports, ['@nextagent/agent-contracts/gateway'])).toEqual([]);
    expect(forbiddenImports(remoteImports, ['@nextagent/agent-capability'])).toEqual([]);
    expect(capabilityBarrel).not.toMatch(/SkillHubRemoteAccessPort|skillhub\/skillhub-source/u);
    expect(gatewayContract).not.toMatch(/\b(?:interface|type|class|function)\s+SkillHub|SkillHubRemote|skillhubRemote/u);
  });
});

interface ImportEdge {
  readonly file: string;
  readonly specifier: string;
}

function collectImports(directory: string): readonly ImportEdge[] {
  return sourceFiles(directory).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return importSpecifiers(source).map((specifier) => ({
      file: relative(root, file).replace(/\\/gu, '/'),
      specifier,
    }));
  });
}

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith('.ts') ? [path] : [];
  });
}

function importSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/\bimport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?["']([^"']+)["']/gu)) {
    specifiers.push(match[1]!);
  }
  for (const match of source.matchAll(/\bexport\s+(?:type\s+)?[^'"]+\s+from\s+["']([^"']+)["']/gu)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

function forbiddenImports(imports: readonly ImportEdge[], forbiddenFragments: readonly string[]): readonly ImportEdge[] {
  return imports.filter((edge) => forbiddenFragments.some((fragment) => edge.specifier.includes(fragment)));
}
