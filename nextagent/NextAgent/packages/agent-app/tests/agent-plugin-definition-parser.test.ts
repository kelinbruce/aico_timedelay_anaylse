import { describe, expect, it } from 'vitest';
import { parseAgentDefinition } from '../src/assembly/agent-definition-parser.js';
import { compileWorkspaceFileExtensionPolicy } from '../src/assembly/agent-assembly-compiler.js';

describe('agent plugin definition parser', () => {
  it('preserves optional localized Agent display names', () => {
    const locales = {
      language: {
        'zh-CN': { displayName: '网络诊断智能体' },
        'en-US': { displayName: 'Network diagnostic agent' },
      },
    };

    expect(parseAgentDefinition(rawAgentDefinition({ locales }))).toMatchObject({
      displayName: 'Default telecom agent',
      locales,
    });
  });

  it('keeps Agent definitions without localized names backward compatible', () => {
    expect(parseAgentDefinition(rawAgentDefinition({}))).not.toHaveProperty('locales');
  });

  it.each([
    null,
    [],
    { language: {} },
    { language: { 'zh-CN': { displayName: '   ' } } },
    { language: { 'zh-CN': { displayName: 'bad\u0000name' } } },
  ])('rejects invalid Agent locales without publishing a partial definition: %j', (locales) => {
    expect(() => parseAgentDefinition(rawAgentDefinition({ locales }))).toThrow(/AgentDefinition\.locales/u);
  });

  it('preserves omitted modelIds for assembly-time inheritance', () => {
    const definition = parseAgentDefinition(rawAgentDefinition({ modelIds: undefined }));

    expect(definition).not.toHaveProperty('modelIds');
  });

  it('rejects an explicitly empty modelIds array', () => {
    expect(() => parseAgentDefinition(rawAgentDefinition({ modelIds: [] }))).toThrow('AgentDefinition.modelIds must be a non-empty string array.');
  });

  it('parses explicit Agent-scoped policy activation facts', () => {
    const definition = parseAgentDefinition(
      rawAgentDefinition({
        policies: [
          {
            policyPointId: 'agentRoutingPolicy',
            pluginId: 'telecom',
            policyId: 'route-alarms',
            enabled: true,
            timeoutMs: 1_000,
            config: { mode: 'strict' },
          },
        ],
      }),
    );

    expect(definition.policies).toEqual([
      {
        policyPointId: 'agentRoutingPolicy',
        pluginId: 'telecom',
        policyId: 'route-alarms',
        enabled: true,
        timeoutMs: 1_000,
        config: { mode: 'strict' },
      },
    ]);
  });

  it.each([
    'providerId',
    'capabilityId',
    'toolSchema',
    'executionMapping',
    'hookId',
    'hookImplementation',
    'pluginPath',
    'modulePath',
    'script',
    'remoteCall',
    'dsl',
  ])('rejects policy entries that try to define %s', (key) => {
    expect(() =>
      parseAgentDefinition(
        rawAgentDefinition({
          policies: [
            {
              policyPointId: 'agentRoutingPolicy',
              pluginId: 'telecom',
              policyId: 'route-alarms',
              [key]: 'not-activation',
            },
          ],
        }),
      ),
    ).toThrow(`AgentDefinition.policies must not contain ${key}.`);
  });

  it('rejects routing policy regexes with nested quantifiers', () => {
    expect(() =>
      parseAgentDefinition(
        rawAgentDefinition({
          routing: {
            mode: 'policy',
            policy: {
              method: 'policy:intent-recognition',
              rules: [{ reg: '(a+)+', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }],
            },
          },
        }),
      ),
    ).toThrow('AgentDefinition.routing.policy.rules.reg must not use nested quantifiers.');
  });

  it('parses and compiles independent Read and Write extension policies', () => {
    const definition = parseAgentDefinition(
      rawAgentDefinition({
        workspaceFiles: {
          readAllowedExtensions: ['.json', '.log'],
          readDeniedExtensions: ['.log'],
          writeAllowedExtensions: [],
          writeDeniedExtensions: ['.exe'],
        },
      }),
    );

    expect(compileWorkspaceFileExtensionPolicy(definition.workspaceFiles)).toMatchObject({
      readAllowedExtensions: ['.json', '.log'],
      readDeniedExtensions: ['.log'],
      writeAllowedExtensions: [],
      writeDeniedExtensions: ['.exe'],
    });
  });

  it('keeps the default Agent extension policy unrestricted', () => {
    const definition = parseAgentDefinition(rawAgentDefinition({}));

    expect(compileWorkspaceFileExtensionPolicy(definition.workspaceFiles)).toEqual({});
  });

  it.each([
    ['missing dot', ['json']],
    ['uppercase', ['.JSON']],
    ['compound suffix', ['.tar.gz']],
    ['wildcard', ['.*']],
    ['dot only', ['.']],
    ['path separator', ['.json/log']],
    ['duplicate', ['.json', '.json']],
  ])('rejects invalid workspace extension configuration: %s', (_caseName, extensions) => {
    expect(() =>
      parseAgentDefinition(
        rawAgentDefinition({
          workspaceFiles: { readAllowedExtensions: extensions },
        }),
      ),
    ).toThrow(/AgentDefinition\.workspaceFiles\.readAllowedExtensions/u);
  });
});

function rawAgentDefinition(overrides: Record<string, unknown>) {
  return {
    agentId: 'default-agent',
    agentType: 'telecom',
    agentVersion: 'v1',
    displayName: 'Default telecom agent',
    description: 'Default telecom agent.',
    modelIds: ['test-model'],
    capabilityBindings: [],
    runtimeSettings: {},
    resources: [],
    ...overrides,
  };
}
