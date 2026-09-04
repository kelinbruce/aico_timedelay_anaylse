import {
  BuiltinToolsExecutor,
  GovernedCapabilityInvocationPort,
  createStaticCapabilityExecutorFactory,
  createToolCatalog,
  toolSearchCapabilityId,
  toolSearchDefaultLimit,
  toolSearchMaxLimit,
  toolSearchToolDefinition,
} from '@nextagent/agent-capability';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type {
  CapabilityDescriptor,
  CapabilityInvocationRequest,
  CapabilityInvocationRuntimeContext,
  CapabilityProviderIdentity,
  RuntimeCapabilityListRequest,
} from '@nextagent/agent-contracts/capability';
import { describe, expect, it } from 'vitest';

const toolProvider: CapabilityProviderIdentity = { providerId: 'builtin-tools', providerKind: 'BUNDLED' };

describe('ToolSearch builtin tool', () => {
  it('describes a governed query Tool with fixed safe schemas and bounded defaults', async () => {
    const [descriptor] = await toolCatalog().listAll(new AbortController().signal);

    expect(descriptor).toMatchObject({
      capabilityId: toolSearchCapabilityId,
      kind: 'TOOL',
      provider: toolProvider,
      modelInvocable: true,
      availabilityStatus: 'AVAILABLE',
      replayPolicy: 'IDEMPOTENT',
      inputSchema: expect.objectContaining({
        additionalProperties: false,
        properties: expect.objectContaining({
          limit: expect.objectContaining({ maximum: toolSearchMaxLimit }),
          matchMode: expect.objectContaining({ enum: ['keyword', 'natural'] }),
          filters: expect.objectContaining({
            additionalProperties: expect.objectContaining({
              anyOf: expect.any(Array),
            }),
            properties: expect.objectContaining({
              kind: expect.objectContaining({ enum: ['TOOL', 'SKILL'] }),
            }),
          }),
        }),
      }),
      outputSchema: expect.objectContaining({ oneOf: expect.any(Array) }),
    });
    expect(descriptor?.description).toContain('deferred Tools and Skills that are not already exposed to the model');
    expect(descriptor?.description).toContain('does not search Agents, Workflows, files, knowledge content, or memory');
    expect(descriptor?.description).toContain('should not rediscover an already visible Tool or enabled Skill');
    expect(descriptor?.description).toContain('`filters.kind` accepts only TOOL or SKILL');
    expect(descriptor?.description).toContain('other filter fields exactly match governed scalar metadata');
    expect(descriptor?.description).toContain('Returned TOOL entries become callable on the next model step');
    expect(descriptor?.description).toContain('Returned SKILL entries must next be invoked with Skill');
    expect(descriptor?.description).toContain('Zero results is a valid search result');
    expect(toolSearchDefaultLimit).toBe(20);
  });

  it('searches only current-run deferred safe Tool metadata without default-visible Skill duplication', async () => {
    const result = await invokeToolSearch({ query: 'alarm' }, [
      visibleTool('alarm-check', 'Alarm Check', 'Inspect telecom alarm summary.'),
      visibleTool('ticket-open', 'Ticket Open', 'Open incident ticket.'),
      hiddenTool('alarm-private', 'Private Alarm', 'Hidden matching Tool.'),
      enabledSkill('alarm-skill', 'Alarm Skill', 'Default-visible Skill.'),
    ]);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [{ capability_id: 'alarm-check', name: 'Alarm Check', kind: 'TOOL', description: 'Inspect telecom alarm summary.' }],
        truncated: false,
      },
      contextPatch: { allowedTools: ['alarm-check'] },
    });
    expect(JSON.stringify(result)).not.toContain('alarm-private');
    expect(JSON.stringify(result)).not.toContain('alarm-skill');
    expect(JSON.stringify(result)).not.toContain('rawInputSchemaSecret');
    expect(JSON.stringify(result)).not.toContain('provider-private-ref');
  });

  it('searches governed deferred Skill metadata without default-visible Skill duplication', async () => {
    const skillSearchResult = await invokeToolSearch({ query: 'alarm-skill' }, [
      visibleTool('alarm-check', 'Alarm Check', 'Inspect telecom alarm summary.'),
      visibleSkill('alarm-skill', 'Alarm Skill', 'Skill for alarm triage.'),
      enabledSkill('enabled-alarm-skill', 'Enabled Alarm Skill', 'Default-visible Skill for alarm triage.'),
    ]);

    expect(skillSearchResult).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [{ capability_id: 'alarm-skill', name: 'Alarm Skill', kind: 'SKILL' }],
        truncated: false,
      },
      contextPatch: { discoveredSkills: ['alarm-skill'] },
    });
    expect(JSON.stringify(skillSearchResult.structuredPayload)).not.toContain('Skill for alarm triage.');
    expect(JSON.stringify(skillSearchResult)).not.toContain('enabled-alarm-skill');
    expect(skillSearchResult.generatedMessages[0]).toMatchObject({ role: 'USER', meta: true });
    expect(skillSearchResult.generatedMessages[0]?.content).toContain('<available-skills>');
    expect(skillSearchResult.generatedMessages[0]?.content).toContain('- capability_id=alarm-skill | name=Alarm Skill | kind=SKILL');
    expect(skillSearchResult.generatedMessages[0]?.content).not.toContain('description=');
    expect(skillSearchResult.generatedMessages[0]?.content).not.toContain('Skill for alarm triage.');
    expect(skillSearchResult.generatedMessages[0]?.content).toContain('</available-skills>');
    expect(skillSearchResult.generatedMessages[0]?.content).toContain('Use the Skill tool with name equal to one capability_id above');
    expect(skillSearchResult.generatedMessages[0]?.content).toContain('only metadata is loaded until the Skill tool succeeds');
  });

  it('does not return default-visible model-invocable Tools', async () => {
    const result = await invokeToolSearch({ query: 'alarm' }, [
      visibleTool('deferred-alarm-check', 'Deferred Alarm Check', 'Deferred alarm search candidate.'),
      enabledTool('alarm-check', 'Alarm Check', 'Default-visible alarm Tool.'),
    ]);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [{ capability_id: 'deferred-alarm-check', name: 'Deferred Alarm Check', kind: 'TOOL' }],
        truncated: false,
      },
      contextPatch: { allowedTools: ['deferred-alarm-check'] },
    });
    expect(JSON.stringify(result)).not.toContain('"capability_id":"alarm-check"');
  });

  it('uses safe search hints for matching without returning hidden descriptors or leaking hints', async () => {
    const result = await invokeToolSearch(
      { query: 'ran qos' },
      [
        visibleSkill('radio-skill', 'Radio Skill', 'General telecom procedure.', {
          mode: 'DEFERRED',
          searchHint: 'RAN QoS degradation investigation',
        }),
        visibleSkill('hidden-radio-skill', 'Hidden Radio Skill', 'RAN QoS hidden procedure.', { mode: 'HIDDEN', searchHint: 'RAN QoS hidden' }),
      ],
      [],
      false,
      true,
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [{ capability_id: 'radio-skill', name: 'Radio Skill', kind: 'SKILL' }],
        truncated: false,
      },
      contextPatch: { discoveredSkills: ['radio-skill'] },
    });
    expect(JSON.stringify(result.structuredPayload)).not.toContain('General telecom procedure.');
    expect(JSON.stringify(result)).not.toContain('RAN QoS degradation investigation');
    expect(JSON.stringify(result)).not.toContain('hidden-radio-skill');
    expect(result.generatedMessages[0]?.content).toContain('<available-skills>');
    expect(result.generatedMessages[0]?.content).toContain('radio-skill');
    expect(result.generatedMessages[0]?.content).not.toContain('RAN QoS degradation investigation');
    expect(result.generatedMessages[0]?.content).not.toContain('hidden-radio-skill');
  });

  it('matches an exact deferred Skill capability_id through keyword search', async () => {
    const result = await invokeToolSearch(
      { query: 'radio-skill' },
      [
        visibleSkill('radio-skill', 'Radio Skill', 'General telecom procedure.'),
        visibleSkill('other-skill', 'Other Skill', 'Other telecom procedure.'),
      ],
      [],
      false,
      true,
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [{ capability_id: 'radio-skill', name: 'Radio Skill', kind: 'SKILL' }],
        truncated: false,
      },
      contextPatch: { discoveredSkills: ['radio-skill'] },
    });
    expect(JSON.stringify(result.structuredPayload)).not.toContain('General telecom procedure.');
    expect(JSON.stringify(result)).not.toContain('other-skill');
  });

  it('matches a deferred Skill display name through keyword search', async () => {
    const result = await invokeToolSearch(
      { query: 'Radio Skill' },
      [visibleSkill('radio-skill', 'Radio Skill', 'General telecom procedure.')],
      [],
      false,
      true,
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [{ capability_id: 'radio-skill', name: 'Radio Skill', kind: 'SKILL' }],
        truncated: false,
      },
      contextPatch: { discoveredSkills: ['radio-skill'] },
    });
    expect(result.generatedMessages[0]?.content).toContain('radio-skill');
  });

  it('projects deferred CLIP Tool matches into available-clipc and allowedTools', async () => {
    const result = await invokeToolSearch({ query: 'clipc-api-021' }, [
      clipcTool('clipc-api-021', 'CLIP API 021', 'Query telecom KPI snapshot.'),
      visibleTool('other-tool', 'Other Tool', 'Other telecom Tool.'),
    ]);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [{ capability_id: 'clipc-api-021', name: 'CLIP API 021', kind: 'TOOL' }],
        truncated: false,
      },
      contextPatch: { allowedTools: ['clipc-api-021'] },
    });
    expect(JSON.stringify(result.structuredPayload)).not.toContain('Query telecom KPI snapshot.');
    expect(result.generatedMessages).toHaveLength(1);
    expect(result.generatedMessages[0]).toMatchObject({ role: 'USER', meta: true });
    expect(result.generatedMessages[0]?.content).toContain('<available-clipc>');
    expect(result.generatedMessages[0]?.content).toContain('- capability_id=clipc-api-021 | name=CLIP API 021 | kind=TOOL');
    expect(result.generatedMessages[0]?.content).not.toContain('description=');
    expect(result.generatedMessages[0]?.content).not.toContain('Query telecom KPI snapshot.');
    expect(result.generatedMessages[0]?.content).toContain('</available-clipc>');
    expect(result.generatedMessages[0]?.content).toContain('Use the exact model tool named by one capability_id above');
    expect(JSON.stringify(result)).not.toContain('clip-private-021');
    expect(JSON.stringify(result)).not.toContain('primitive-query');
    expect(JSON.stringify(result)).not.toContain('clip_api_call');
  });

  it('does not emit available-clipc or CLIP allowedTools when no CLIP result matches', async () => {
    const result = await invokeToolSearch({ query: 'missing-clip-api' }, [clipcTool('clipc-api-021', 'CLIP API 021', 'Query telecom KPI snapshot.')]);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { tools: [], truncated: false },
    });
    expect(result.generatedMessages).toEqual([]);
    expect(result.contextPatch).toBeUndefined();
  });

  it('returns stable bounded results and reports truncation', async () => {
    const candidates = [
      visibleTool('zeta-kpi', 'Zeta KPI', 'network search candidate'),
      visibleTool('alpha-kpi', 'Alpha KPI', 'network search candidate'),
      visibleTool('beta-kpi', 'Beta KPI', 'network search candidate'),
    ];

    const result = await invokeToolSearch({ query: 'kpi', limit: 2 }, candidates);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [
          { capability_id: 'alpha-kpi', name: 'Alpha KPI' },
          { capability_id: 'beta-kpi', name: 'Beta KPI' },
        ],
        truncated: true,
      },
      metadata: {
        reasonCode: 'OK',
        resultCount: 2,
        truncated: true,
      },
    });
  });

  it('lists deferred candidates when query is omitted, empty, or star', async () => {
    const candidates = [
      visibleTool('zeta-kpi', 'Zeta KPI', 'network search candidate'),
      visibleTool('alpha-kpi', 'Alpha KPI', 'network search candidate'),
      visibleSkill('beta-skill', 'Beta Skill', 'deferred Skill candidate'),
      enabledTool('enabled-tool', 'Enabled Tool', 'default-visible Tool'),
    ];

    const omitted = await invokeToolSearch({ limit: 2 }, candidates);
    const empty = await invokeToolSearch({ query: '   ', limit: 3 }, candidates);
    const star = await invokeToolSearch({ query: '*', limit: 10 }, candidates);

    expect(omitted).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [
          { capability_id: 'beta-skill', name: 'Beta Skill', kind: 'SKILL' },
          { capability_id: 'alpha-kpi', name: 'Alpha KPI', kind: 'TOOL' },
        ],
        truncated: true,
      },
      contextPatch: { allowedTools: ['alpha-kpi'], discoveredSkills: ['beta-skill'] },
    });
    expect(empty).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [{ capability_id: 'beta-skill' }, { capability_id: 'alpha-kpi' }, { capability_id: 'zeta-kpi' }],
        truncated: false,
      },
      contextPatch: { allowedTools: ['alpha-kpi', 'zeta-kpi'], discoveredSkills: ['beta-skill'] },
    });
    expect(star).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [{ capability_id: 'beta-skill' }, { capability_id: 'alpha-kpi' }, { capability_id: 'zeta-kpi' }],
        truncated: false,
      },
    });
    expect(JSON.stringify(star)).not.toContain('enabled-tool');
  });

  it('filters deferred candidates by kind and descriptor metadata scalar fields', async () => {
    const result = await invokeToolSearch({ query: '*', filters: { kind: 'SKILL', level: '1', owner: 'ran-team' } }, [
      skillWithMetadata('ran-level-one', 'RAN Level One', 'Level one Skill.', { sourceMetadata: { level: '1', owner: 'ran-team' } }),
      skillWithMetadata('ran-level-two', 'RAN Level Two', 'Level two Skill.', { sourceMetadata: { level: '2', owner: 'ran-team' } }),
      skillWithMetadata('ran-other-owner', 'RAN Other Owner', 'Other owner Skill.', { sourceMetadata: { level: '1', owner: 'core-team' } }),
      toolWithMetadata('ran-level-one-tool', 'RAN Tool', 'Level one Tool.', { level: '1', owner: 'ran-team' }),
    ]);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [{ capability_id: 'ran-level-one', name: 'RAN Level One', kind: 'SKILL' }],
        truncated: false,
      },
      contextPatch: { discoveredSkills: ['ran-level-one'] },
    });
    expect(JSON.stringify(result)).not.toContain('ran-level-two');
    expect(JSON.stringify(result)).not.toContain('ran-other-owner');
    expect(JSON.stringify(result)).not.toContain('ran-level-one-tool');
    expect(JSON.stringify(result)).not.toContain('"level"');
    expect(JSON.stringify(result)).not.toContain('"owner"');
  });

  it('filters Tool candidates by descriptor metadata scalar fields', async () => {
    const result = await invokeToolSearch({ query: '*', filters: { kind: 'TOOL', level: '2', stable: true } }, [
      toolWithMetadata('tool-level-one', 'Tool Level One', 'Level one Tool.', { level: '1', stable: true }),
      toolWithMetadata('tool-level-two', 'Tool Level Two', 'Level two Tool.', { level: 2, stable: true }),
      toolWithMetadata('tool-unstable-two', 'Tool Unstable Two', 'Unstable level two Tool.', { level: 2, stable: false }),
      skillWithMetadata('skill-level-two', 'Skill Level Two', 'Level two Skill.', { sourceMetadata: { level: '2', stable: 'true' } }),
    ]);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [{ capability_id: 'tool-level-two', name: 'Tool Level Two', kind: 'TOOL' }],
        truncated: false,
      },
      contextPatch: { allowedTools: ['tool-level-two'] },
    });
  });

  it('accepts natural match mode with deterministic safe metadata ranking', async () => {
    const result = await invokeToolSearch({ query: 'alarm', matchMode: 'natural' }, [
      visibleTool('zeta-helper', 'Zeta Helper', 'mentions alarm in a long description'),
      visibleTool('alarm-summary', 'Summary Reader', 'generic network inspection'),
      visibleTool('beta-alarm', 'Beta Alarm', 'generic network inspection'),
    ]);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [
          { capability_id: 'alarm-summary', name: 'Summary Reader' },
          { capability_id: 'beta-alarm', name: 'Beta Alarm' },
          { capability_id: 'zeta-helper', name: 'Zeta Helper' },
        ],
        truncated: false,
      },
    });
  });

  it('ranks stronger metadata matches before weaker stable matches', async () => {
    const result = await invokeToolSearch({ query: 'alarm' }, [
      visibleTool('zeta-helper', 'Zeta Helper', 'mentions alarm in a long description'),
      visibleTool('alarm-summary', 'Summary Reader', 'generic network inspection'),
      visibleTool('beta-alarm', 'Beta Alarm', 'generic network inspection'),
    ]);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: [
          { capability_id: 'alarm-summary', name: 'Summary Reader' },
          { capability_id: 'beta-alarm', name: 'Beta Alarm' },
          { capability_id: 'zeta-helper', name: 'Zeta Helper' },
        ],
        truncated: false,
      },
    });
  });

  it('enforces limit boundaries and the default result limit', async () => {
    const candidates = Array.from({ length: toolSearchDefaultLimit + 1 }, (_, index) =>
      visibleTool(`kpi-${String(index).padStart(2, '0')}`, `KPI ${String(index).padStart(2, '0')}`, 'network kpi candidate'),
    );

    const defaultLimited = await invokeToolSearch({ query: 'kpi' }, candidates);

    expect(defaultLimited).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        tools: expect.arrayContaining([expect.objectContaining({ capability_id: 'kpi-00', name: 'KPI 00', description: 'network kpi candidate' })]),
        truncated: true,
      },
    });
    expect(defaultLimited.structuredPayload.tools as readonly unknown[]).toHaveLength(toolSearchDefaultLimit);

    await expect(invokeToolSearch({ query: 'kpi', limit: 0 }, candidates)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID' },
    });
    await expect(invokeToolSearch({ query: 'kpi', limit: toolSearchMaxLimit + 1 }, candidates)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID' },
    });
  });

  it('does not scan unknown sources beyond the runtime projection', async () => {
    const calls: RuntimeCapabilityListRequest[] = [];
    const result = await invokeToolSearch(
      { query: 'external' },
      [visibleTool('external-visible', 'External Visible', 'governed external tool')],
      calls,
    );

    expect(calls).toEqual([{ modelInvocable: false }]);
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { tools: [{ capability_id: 'external-visible' }], truncated: false },
    });
  });

  it('safe-fails invalid input and unavailable projection without logging query content', async () => {
    await expect(invokeToolSearch({ query: 1 as never }, [])).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID' },
    });
    await expect(invokeToolSearch({ query: 'alarm', matchMode: 'semantic' }, [])).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID' },
    });
    await expect(invokeToolSearch({ query: 'alarm', filters: { kind: 'AGENT' } }, [])).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID' },
    });
    await expect(invokeToolSearch({ query: 'alarm', filters: { owner: { team: 'ran' } } }, [])).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID' },
    });

    const unavailable = await invokeToolSearch({ query: 'secret-query' }, [], [], true);
    expect(unavailable).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'SEARCH_UNAVAILABLE' },
      metadata: { reasonCode: 'SEARCH_UNAVAILABLE', resultCount: 0 },
    });
    expect(JSON.stringify(unavailable)).not.toContain('secret-query');
  });

  it('safe-fails when the governed projection lookup throws', async () => {
    const result = await invokeToolSearchWithThrowingProjection({ query: 'alarm' });

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'SEARCH_UNAVAILABLE' },
      metadata: { reasonCode: 'SEARCH_UNAVAILABLE', resultCount: 0 },
    });
  });
});

async function invokeToolSearch(
  args: JsonObject,
  capabilities: readonly CapabilityDescriptor[],
  calls: RuntimeCapabilityListRequest[] = [],
  omitProjection = false,
  skillSearchEnabled = false,
) {
  const catalog = toolCatalog();
  return governedToolSearchPort(catalog).invoke(
    request(args),
    new AbortController().signal,
    omitProjection ? undefined : runtimeContext(capabilities, calls, skillSearchEnabled),
  );
}

function toolCatalog() {
  return createToolCatalog({ provider: toolProvider, tools: [toolSearchToolDefinition] });
}

function runtimeContext(
  capabilities: readonly CapabilityDescriptor[],
  calls: RuntimeCapabilityListRequest[],
  skillSearchEnabled = false,
): CapabilityInvocationRuntimeContext {
  return {
    ...(skillSearchEnabled ? { toolSearchSkillSearchEnabled: true } : {}),
    capabilityResolver: {
      async resolveCapability() {
        return undefined;
      },
      async listCapabilities(request) {
        calls.push(request);
        return capabilities;
      },
    },
  };
}

async function invokeToolSearchWithThrowingProjection(args: JsonObject) {
  const catalog = toolCatalog();
  return governedToolSearchPort(catalog).invoke(request(args), new AbortController().signal, {
    capabilityResolver: {
      async resolveCapability() {
        return undefined;
      },
      async listCapabilities() {
        throw new Error('catalog unavailable');
      },
    },
  });
}

function governedToolSearchPort(catalog: ReturnType<typeof toolCatalog>): GovernedCapabilityInvocationPort {
  return new GovernedCapabilityInvocationPort(
    {
      async resolveForInvocation(capabilityId, signal) {
        return (await catalog.listAll(signal)).find((descriptor) => descriptor.capabilityId === capabilityId);
      },
    },
    createStaticCapabilityExecutorFactory([{ provider: catalog.provider, executor: new BuiltinToolsExecutor(catalog) }]),
  );
}

function request(args: JsonObject): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-tool-search',
    capabilityId: toolSearchCapabilityId,
    arguments: args,
    sessionId: brand<string, 'SessionId'>('session-tool-search'),
    requestId: brand<string, 'MessageId'>('request-tool-search'),
    runId: brand<string, 'RequestRunId'>('run-tool-search'),
    requestContextId: brand<string, 'RequestContextId'>('context-tool-search'),
    stepId: 'turn-1',
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-tool-search'),
      subjectId: brand<string, 'SubjectId'>('subject-tool-search'),
      displayName: 'ToolSearch tester',
    },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tool-search'),
  };
}

function visibleTool(capabilityId: string, displayName: string, description: string): CapabilityDescriptor {
  return descriptor(capabilityId, 'TOOL', displayName, description, false, 'AVAILABLE');
}

function toolWithMetadata(capabilityId: string, displayName: string, description: string, metadata: JsonObject): CapabilityDescriptor {
  return {
    ...visibleTool(capabilityId, displayName, description),
    metadata,
  };
}

function enabledTool(capabilityId: string, displayName: string, description: string): CapabilityDescriptor {
  return descriptor(capabilityId, 'TOOL', displayName, description, true, 'AVAILABLE');
}

function clipcTool(capabilityId: string, displayName: string, description: string): CapabilityDescriptor {
  return {
    ...visibleTool(capabilityId, displayName, description),
    provider: { providerId: 'clip-backed', providerKind: 'CUSTOM', providerType: 'clip_server' },
    disclosurePolicy: { mode: 'DEFERRED', searchHint: `${description} clip-private-021 primitive-query` },
    metadata: { privateClipCapabilityId: 'clip-private-021', primitive: 'primitive-query', dispatchTool: 'clip_api_call' },
  };
}

function hiddenTool(capabilityId: string, displayName: string, description: string): CapabilityDescriptor {
  return descriptor(capabilityId, 'TOOL', displayName, description, false, 'AVAILABLE', { mode: 'HIDDEN' });
}

function visibleSkill(
  capabilityId: string,
  displayName: string,
  description: string,
  disclosurePolicy?: CapabilityDescriptor['disclosurePolicy'],
): CapabilityDescriptor {
  return descriptor(capabilityId, 'SKILL', displayName, description, false, 'AVAILABLE', disclosurePolicy);
}

function skillWithMetadata(capabilityId: string, displayName: string, description: string, metadata: JsonObject): CapabilityDescriptor {
  return {
    ...visibleSkill(capabilityId, displayName, description),
    metadata,
  };
}

function enabledSkill(
  capabilityId: string,
  displayName: string,
  description: string,
  disclosurePolicy?: CapabilityDescriptor['disclosurePolicy'],
): CapabilityDescriptor {
  return descriptor(capabilityId, 'SKILL', displayName, description, true, 'AVAILABLE', disclosurePolicy);
}

function descriptor(
  capabilityId: string,
  kind: 'TOOL' | 'SKILL',
  displayName: string,
  description: string,
  modelInvocable: boolean,
  availabilityStatus: 'AVAILABLE' | 'DISABLED' | 'UNAVAILABLE',
  disclosurePolicy?: CapabilityDescriptor['disclosurePolicy'],
): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind,
    provider: { providerId: `${capabilityId}-provider`, providerKind: 'MCP_SERVER' },
    displayName,
    description,
    modelInvocable,
    availabilityStatus,
    inputSchema: { type: 'object', properties: { rawInputSchemaSecret: { const: 'SHOULD_NOT_LEAK' } } },
    outputSchema: { type: 'object' },
    metadata: { privateRef: 'provider-private-ref' },
    ...(disclosurePolicy === undefined ? {} : { disclosurePolicy }),
    replayPolicy: 'NON_IDEMPOTENT',
  };
}
