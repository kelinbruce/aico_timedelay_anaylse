import { brand, type CapabilityId, type JsonObject } from '@nextagent/agent-common';
import type { HookInput } from '@nextagent/agent-contracts/runtime';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createNorthboundOutputNormalizationPluginArtifact,
  createNorthboundOutputNormalizationPlugin,
  northboundOutputNormalizationHookId,
} from '../src/northbound-output-normalization-hook.js';

const structuredPayload: JsonObject = {
  stdout: 'ok',
  stderr: '',
  exitCode: 0,
  stdoutTruncated: false,
  stderrTruncated: false,
};

const matchText = 'northbound-entry.py';

function makeInput(capabilityId: CapabilityId, arguments_: JsonObject, payload?: JsonObject): HookInput<'AFTER_CAPABILITY_RESULT'> {
  return {
    hookId: northboundOutputNormalizationHookId,
    agentId: brand<string, 'AgentId'>('agent-northbound'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    stage: 'AFTER_CAPABILITY_RESULT',
    boundary: {
      capabilityId,
      capabilityInvocationId: 'run-northbound:tool-northbound',
      arguments: arguments_,
      status: 'SUCCEEDED',
      safeResultSummary: 'result fields=5',
      generatedMessageCount: 0,
      artifactCount: 0,
      ...(payload === undefined ? {} : { structuredPayload: payload }),
    },
  };
}

describe('northbound output normalization hook', () => {
  it('declares one explicitly activated transform result hook', () => {
    const plugin = createNorthboundOutputNormalizationPlugin();

    expect(plugin).toMatchObject({
      apiVersion: '1.0',
      pluginId: northboundOutputNormalizationHookId,
      version: '1.0.0',
    });
    expect(plugin.hooks).toHaveLength(1);
    expect(plugin.hooks?.[0]).toMatchObject({
      hookId: northboundOutputNormalizationHookId,
      kind: 'CUSTOM',
      supportedStages: ['AFTER_CAPABILITY_RESULT'],
      effects: ['TRANSFORM'],
      failureMode: 'CONTINUE',
      configSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['matchText'],
      },
    });
  });

  it.each([
    ['command', { command: 'python workspace/actions/northbound-entry.py --site 001' }],
    ['args', { command: 'python', args: ['workspace/actions/northbound-entry.py', '--site', '001'] }],
    ['command and args', { command: 'python northbound-entry.py', args: ['northbound-entry.py'] }],
  ])('returns the original structured payload when Bash %s contains configured match text', async (_caseName, arguments_) => {
    const hook = createNorthboundOutputNormalizationPlugin().hooks?.[0]?.configure?.({ matchText });

    expect(await hook?.execute(makeInput(brand<string, 'CapabilityId'>('Bash'), arguments_, structuredPayload))).toEqual({
      outcome: 'PASS',
      resultSummary: structuredPayload,
      mutation: { structuredPayload },
    });
  });

  it.each([
    ['different case', 'Bash', { command: 'python Northbound-entry.py' }, structuredPayload],
    ['previous fixed text', 'Bash', { command: 'python action.py' }, structuredPayload],
    ['non-Bash capability', 'Python', { command: 'python northbound-entry.py' }, structuredPayload],
    ['non-string command', 'Bash', { command: 1 }, structuredPayload],
    ['non-matching args', 'Bash', { command: 'python', args: [1, 'worker.py'] }, structuredPayload],
    ['description only', 'Bash', { command: 'python', description: 'run northbound-entry.py' }, structuredPayload],
    ['environment only', 'Bash', { command: 'python', env: { TARGET: 'northbound-entry.py' } }, structuredPayload],
    ['result only', 'Bash', { command: 'python' }, { stdout: 'northbound-entry.py' }],
    ['missing structured payload', 'Bash', { command: 'python northbound-entry.py' }, undefined],
  ])('returns SKIP for %s', async (_caseName, capabilityId, arguments_, payload) => {
    const hook = createNorthboundOutputNormalizationPlugin().hooks?.[0]?.configure?.({ matchText });

    expect(await hook?.execute(makeInput(brand<string, 'CapabilityId'>(capabilityId), arguments_, payload))).toEqual({ outcome: 'SKIP' });
  });

  it.each(['', '   '])('rejects an empty matchText configuration: %j', (invalidMatchText) => {
    const hook = createNorthboundOutputNormalizationPlugin().hooks?.[0];

    expect(() => hook?.configure?.({ matchText: invalidMatchText })).toThrow(
      'Northbound output normalization Hook matchText must be a non-empty string.',
    );
  });

  it('keeps the unconfigured packaged hook inert', async () => {
    const hook = createNorthboundOutputNormalizationPlugin().hooks?.[0];

    expect(await hook?.execute(makeInput(brand<string, 'CapabilityId'>('Bash'), { command: matchText }, structuredPayload))).toEqual({
      outcome: 'SKIP',
    });
  });

  it('writes a loadable local plugin artifact', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'northbound-output-normalization-hook-'));
    try {
      expect(createNorthboundOutputNormalizationPluginArtifact({ targetDirectory })).toEqual({
        pluginId: northboundOutputNormalizationHookId,
        files: ['plugin.json', 'index.js'],
      });
      expect(existsSync(join(targetDirectory, 'plugin.json'))).toBe(true);
      const manifest = JSON.parse(readFileSync(join(targetDirectory, 'plugin.json'), 'utf8')) as JsonObject;
      expect(manifest).toMatchObject({
        pluginId: northboundOutputNormalizationHookId,
        main: './index.js',
        artifactType: 'esm-bundle',
      });
      const artifactModule = (await import(`${pathToFileURL(join(targetDirectory, 'index.js')).href}?test=${Date.now()}`)) as {
        default: ReturnType<typeof createNorthboundOutputNormalizationPlugin>;
      };
      const artifactHook = artifactModule.default.hooks?.[0]?.configure?.({ matchText });
      expect(await artifactHook?.execute(makeInput(brand<string, 'CapabilityId'>('Bash'), { command: matchText }, structuredPayload))).toEqual({
        outcome: 'PASS',
        resultSummary: structuredPayload,
        mutation: { structuredPayload },
      });
    } finally {
      rmSync(targetDirectory, { recursive: true, force: true });
    }
  });
});
