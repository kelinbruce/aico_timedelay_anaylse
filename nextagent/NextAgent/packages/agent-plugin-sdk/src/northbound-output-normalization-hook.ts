import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { JsonObject } from '@nextagent/agent-common';
import type { HookInput, HookResult, LifecycleHook } from '@nextagent/agent-contracts/runtime';
import type { NextAgentPlugin } from './index.js';

export const northboundOutputNormalizationHookId = 'northbound-output-normalization-hook';

type NorthboundOutputNormalizationStage = 'AFTER_CAPABILITY_RESULT';

const supportedStages = Object.freeze(['AFTER_CAPABILITY_RESULT'] as const);

export interface NorthboundOutputNormalizationPluginArtifactOptions {
  readonly targetDirectory: string;
  readonly overwrite?: boolean;
}

export interface NorthboundOutputNormalizationPluginArtifactResult {
  readonly pluginId: typeof northboundOutputNormalizationHookId;
  readonly files: readonly ['plugin.json', 'index.js'];
}

export function createNorthboundOutputNormalizationPlugin(): NextAgentPlugin {
  const defaultExecutable = createExecutable();
  const hook: LifecycleHook<typeof supportedStages> = Object.freeze({
    hookId: northboundOutputNormalizationHookId,
    kind: 'CUSTOM',
    supportedStages,
    effects: Object.freeze(['TRANSFORM'] as const),
    failureMode: 'CONTINUE',
    configSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['matchText'],
      properties: {
        matchText: { type: 'string', minLength: 1 },
      },
    }),
    configure(config: JsonObject) {
      return createExecutable(readMatchText(config));
    },
    execute(input: HookInput<NorthboundOutputNormalizationStage>) {
      return defaultExecutable.execute(input);
    },
  });
  return Object.freeze({
    apiVersion: '1.0',
    pluginId: northboundOutputNormalizationHookId,
    version: '1.0.0',
    hooks: Object.freeze([hook]),
  });
}

export function createNorthboundOutputNormalizationPluginArtifact(
  options: NorthboundOutputNormalizationPluginArtifactOptions,
): NorthboundOutputNormalizationPluginArtifactResult {
  const targetDirectory = resolve(options.targetDirectory);
  if (existsSync(targetDirectory) && !statSync(targetDirectory).isDirectory()) {
    throw new Error('Northbound output normalization plugin artifact target must be a directory.');
  }
  mkdirSync(targetDirectory, { recursive: true });
  const files = Object.freeze(['plugin.json', 'index.js'] as const);
  for (const file of files) {
    if (existsSync(resolve(targetDirectory, file)) && options.overwrite !== true) {
      throw new Error('Northbound output normalization plugin artifact file already exists.');
    }
  }
  writeFileSync(resolve(targetDirectory, 'plugin.json'), `${JSON.stringify(pluginManifest(), null, 2)}\n`, 'utf8');
  writeFileSync(resolve(targetDirectory, 'index.js'), pluginBundle(), 'utf8');
  return Object.freeze({ pluginId: northboundOutputNormalizationHookId, files });
}

function createExecutable(matchText?: string): {
  readonly execute: (input: HookInput<NorthboundOutputNormalizationStage>) => HookResult<NorthboundOutputNormalizationStage>;
} {
  return Object.freeze({
    execute(input) {
      const boundary = input.boundary;
      if (
        matchText === undefined ||
        boundary.capabilityId !== 'Bash' ||
        !containsMatchText(boundary.arguments, matchText) ||
        boundary.structuredPayload === undefined
      ) {
        return { outcome: 'SKIP' };
      }
      return { outcome: 'PASS', resultSummary: boundary.structuredPayload, mutation: { structuredPayload: boundary.structuredPayload } };
    },
  });
}

function readMatchText(config: JsonObject): string | undefined {
  const matchText = config.matchText;
  if (matchText === undefined) {
    return undefined;
  }
  if (typeof matchText !== 'string' || matchText.trim().length === 0) {
    throw new Error('Northbound output normalization Hook matchText must be a non-empty string.');
  }
  return matchText;
}

function containsMatchText(arguments_: HookInput<'AFTER_CAPABILITY_RESULT'>['boundary']['arguments'], matchText: string): boolean {
  const command = arguments_['command'];
  if (typeof command === 'string' && command.includes(matchText)) {
    return true;
  }
  const args = arguments_['args'];
  return Array.isArray(args) && args.some((value) => typeof value === 'string' && value.includes(matchText));
}

function pluginManifest(): JsonObject {
  return {
    pluginId: northboundOutputNormalizationHookId,
    version: '1.0.0',
    apiVersion: '1.0',
    main: './index.js',
    artifactType: 'esm-bundle',
    hostExternals: [],
  };
}

function pluginBundle(): string {
  return `const pluginId = ${JSON.stringify(northboundOutputNormalizationHookId)};
const hookId = ${JSON.stringify(northboundOutputNormalizationHookId)};
const supportedStages = Object.freeze(['AFTER_CAPABILITY_RESULT']);
const configSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['matchText'],
  properties: { matchText: { type: 'string', minLength: 1 } }
});
function executable(matchText) {
  return Object.freeze({
    execute(input) {
      const boundary = input.boundary;
      const command = boundary.arguments.command;
      const args = boundary.arguments.args;
      const matches = matchText !== undefined &&
        ((typeof command === 'string' && command.includes(matchText)) ||
          (Array.isArray(args) && args.some((value) => typeof value === 'string' && value.includes(matchText))));
      if (boundary.capabilityId !== 'Bash' || !matches || boundary.structuredPayload === undefined) {
        return { outcome: 'SKIP' };
      }
      return { outcome: 'PASS', resultSummary: boundary.structuredPayload, mutation: { structuredPayload: boundary.structuredPayload } };
    }
  });
}
function configure(config) {
  const matchText = config.matchText;
  if (matchText === undefined) {
    return executable(undefined);
  }
  if (typeof matchText !== 'string' || matchText.trim().length === 0) {
    throw new Error('Northbound output normalization Hook matchText must be a non-empty string.');
  }
  return executable(matchText);
}
const defaultExecutable = executable(undefined);
const hook = Object.freeze({
  hookId,
  kind: 'CUSTOM',
  supportedStages,
  effects: Object.freeze(['TRANSFORM']),
  failureMode: 'CONTINUE',
  configSchema,
  configure,
  execute(input) { return defaultExecutable.execute(input); }
});
const plugin = Object.freeze({ apiVersion: '1.0', pluginId, version: '1.0.0', hooks: Object.freeze([hook]) });
export default plugin;
`;
}
