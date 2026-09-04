import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('session activity architecture boundary', () => {
  it('keeps the Web channel independent from the session implementation owner', () => {
    const webSource = readTypeScriptSource(join(root, 'packages', 'agent-channel-web', 'src'));

    expect(webSource).not.toMatch(/@nextagent\/agent-session/u);
  });

  it('keeps Activity out of channel contracts and the Request Execution Stream facade', () => {
    const channelSource = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'channel', 'index.ts'), 'utf8');
    const runtimeSource = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'runtime', 'index.ts'), 'utf8');
    const runtimeSessionPortStart = runtimeSource.indexOf('export interface RuntimeSessionPort');
    const runtimeSessionPortEnd = runtimeSource.indexOf('\n}\n', runtimeSessionPortStart) + 3;
    const runtimeSessionPort = runtimeSource.slice(runtimeSessionPortStart, runtimeSessionPortEnd);

    expect(channelSource).not.toMatch(/SessionActivity|SESSION_ACTIVITY/u);
    expect(runtimeSessionPort).not.toMatch(/SessionActivity|sessionActivit/u);
  });

  it('does not create a Web contract subpath for Activity', () => {
    const contractsRoot = join(root, 'packages', 'agent-contracts');
    const packageJson = JSON.parse(readFileSync(join(contractsRoot, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };

    expect(existsSync(join(contractsRoot, 'src', 'web'))).toBe(false);
    expect(Object.keys(packageJson.exports)).not.toContain('./web');
  });

  it('keeps Activity contracts and implementation independent from adapters and frontend source', () => {
    const sessionContracts = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'session', 'index.ts'), 'utf8');
    const runtimeContracts = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'runtime', 'index.ts'), 'utf8');
    const sessionImplementation = readTypeScriptSource(join(root, 'packages', 'agent-session', 'src'));
    const activityContracts = [sessionContracts, runtimeContracts].filter((source) => source.includes('SessionActivity')).join('\n');

    expect(activityContracts).not.toMatch(/agent-platform-gateway-local|frontend\/agent-web/u);
    expect(sessionImplementation).not.toMatch(/@nextagent\/agent-platform-gateway-local|frontend\/agent-web/u);
  });
});

function readTypeScriptSource(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return [readTypeScriptSource(path)];
      }
      return entry.name.endsWith('.ts') ? [readFileSync(path, 'utf8')] : [];
    })
    .join('\n');
}
