import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('frontend dev profiles', () => {
  it('targets the default backend from the backend dev profile', () => {
    const envBackend = parseEnvFile(readFileSync(join(root, 'frontend', 'agent-web', '.env.backend'), 'utf8'));

    expect(envBackend).toMatchObject({
      VITE_PROXY_TARGET: 'http://localhost:3000',
      VITE_TRANSPORT_KIND: 'SSE',
    });
  });

  it('keeps websocket transport selection out of package-local script profiles', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'frontend', 'agent-web', 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const runtimeConfigSource = readFileSync(join(root, 'frontend', 'agent-web', 'src', 'config', 'runtimeConfig.ts'), 'utf8');
    const contractsSource = readFileSync(join(root, 'frontend', 'agent-web', 'src', 'state', 'contracts.ts'), 'utf8');

    expect(existsSync(join(root, 'frontend', 'agent-web', '.env.websocket'))).toBe(false);
    expect(packageJson.scripts).not.toHaveProperty('dev:ws');
    expect(runtimeConfigSource).toContain('VITE_TRANSPORT_KIND');
    expect(contractsSource).toMatch(/['"]WEBSOCKET['"]/u);
  });

  it('ignores local runtime data', () => {
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');

    expect(gitignore).toMatch(/^data\/$/m);
  });

  it('keeps the app icon as an inline SVG favicon', () => {
    const indexHtml = readFileSync(join(root, 'frontend', 'agent-web', 'index.html'), 'utf8');

    expect(indexHtml).toContain('rel="icon"');
    expect(indexHtml).toContain('type="image/svg+xml"');
    expect(indexHtml).toContain('href="data:image/svg+xml;base64,');
  });
});

function parseEnvFile(source: string): Record<string, string> {
  return Object.fromEntries(
    source
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}
