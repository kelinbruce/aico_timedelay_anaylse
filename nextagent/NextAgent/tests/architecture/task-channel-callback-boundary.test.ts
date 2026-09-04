import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const taskChannelRoot = join(root, 'packages', 'agent-channel-task');

describe('Task Channel callback architecture boundary', () => {
  it('keeps Task Channel independent from CLIP, capability, gateway implementation, and Web Channel owners', () => {
    const packageJson = JSON.parse(readFileSync(join(taskChannelRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const source = readTypeScriptSource(join(taskChannelRoot, 'src'));

    expect(Object.keys(packageJson.dependencies)).not.toContain('@nextagent/agent-capability');
    expect(source).not.toContain('@nextagent/agent-capability');
    expect(source).not.toContain('@nextagent/agent-channel-web');
    expect(source).not.toContain('@nextagent/agent-platform-gateway-');
    expect(source.toLowerCase()).not.toContain('clipcapability');
  });

  it('keeps the callback port narrower than a generic HTTP request executor', () => {
    const callbackSource = readFileSync(join(taskChannelRoot, 'src', 'task-callback.ts'), 'utf8');
    const requestShape = callbackSource.slice(
      callbackSource.indexOf('export interface TaskCallbackDeliveryPortRequest'),
      callbackSource.indexOf('export interface TaskCallbackDeliveryPort {'),
    );

    expect(requestShape).toContain('readonly target: TaskCallbackTarget');
    expect(requestShape).toContain('readonly events: readonly TaskEvent[]');
    expect(requestShape).not.toContain('method:');
    expect(requestShape).not.toContain('headers:');
    expect(requestShape).not.toContain('body:');
    expect(requestShape).not.toContain('credentials:');
  });

  it('does not import generic HTTP client abstractions', () => {
    const packageJson = JSON.parse(readFileSync(join(taskChannelRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const source = readTypeScriptSource(join(taskChannelRoot, 'src'));

    const forbiddenDeps = ['undici', 'axios', 'node-fetch', 'got', 'request', 'superagent'];
    for (const dep of forbiddenDeps) {
      expect(Object.keys(packageJson.dependencies)).not.toContain(dep);
    }
    expect(source).not.toMatch(/import\s.+from\s+["']undici["']/);
    expect(source).not.toMatch(/import\s.+from\s+["']axios["']/);
    expect(source).not.toMatch(/import\s.+from\s+["']node-fetch["']/);
    expect(source).not.toMatch(/import\s.+from\s+["']got["']/);
  });
});

function readTypeScriptSource(directory: string): string {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? [readTypeScriptSource(path)] : path.endsWith('.ts') ? [readFileSync(path, 'utf8')] : [];
    })
    .join('\n');
}
