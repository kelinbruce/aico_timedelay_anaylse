import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import {
  BuiltinToolsExecutor,
  StaticCapabilityCatalog,
  StaticCapabilityExecutorFactory,
  builtinToolDefinitions,
  builtinToolsProvider,
  createCapabilitySubsystem,
  createToolCatalog,
  createWorkspaceFilePort,
  readCapabilityId,
} from '@nextagent/agent-capability';
import {
  AgentError,
  bindRuntimeLoggerProvider,
  brand,
  type EpochMillis,
  type JsonObject,
  type RuntimeLoggerProviderBinding,
} from '@nextagent/agent-common';
import { createDefaultContextEngine } from '@nextagent/agent-context-engine';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CapabilityDescriptor,
  CapabilityDiscovery,
  CapabilityInvocationPort,
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
} from '@nextagent/agent-contracts/capability';
import type { SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, PendingInputIntent, PendingInputRequest, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { DefaultAgent, executeToolCallsInOrder, type RequestLocalCapabilityState } from '@nextagent/agent-core';
import { Ajv } from 'ajv/dist/ajv.js';
import { readDescriptor } from '../fixtures/capability.js';
import { afterEach, describe, expect, it } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

const tenantId = brand<string, 'TenantId'>('tenant-1');
const subjectId = brand<string, 'SubjectId'>('subject-1');
const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');

describe('capability provider governance skeleton', () => {
  it('marks local builtin editing and execution tools as eager non-lazy defaults', () => {
    const policies = new Map(builtinToolDefinitions.map((definition) => [String(definition.metadata.name), definition.metadata.disclosurePolicy]));

    for (const capabilityId of ['Read', 'Write', 'Glob', 'Grep', 'Bash', 'Python', 'Edit']) {
      expect(policies.get(capabilityId)).toEqual({ mode: 'EAGER' });
    }
    expect(policies.get('Skill')).toBeUndefined();
    expect(policies.get('ToolSearch')).toBeUndefined();
  });

  it('creates trusted builtin read through subsystem and rejects external builtin or unsupported custom config', async () => {
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir: process.cwd() } });
    const available = await subsystem.catalog.listAvailable({ tenantId, subjectId, agentAssembly: assembly(), includeUnavailable: false });

    expect(available).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capabilityId: 'Read', provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' } }),
        expect.objectContaining({ capabilityId: 'Write', provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' } }),
        expect.objectContaining({ capabilityId: 'Glob', provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' } }),
        expect.objectContaining({ capabilityId: 'Grep', provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' } }),
        expect.objectContaining({ capabilityId: 'Edit', provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' } }),
        expect.objectContaining({ capabilityId: 'Skill', provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' }, kind: 'TOOL' }),
        expect.objectContaining({
          capabilityId: 'AskUserQuestion',
          provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
          kind: 'TOOL',
        }),
        expect.objectContaining({ capabilityId: 'ToolSearch', provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' }, kind: 'TOOL' }),
        expect.objectContaining({
          capabilityId: 'skill-creator',
          provider: { providerId: 'builtin-skills', providerKind: 'BUNDLED' },
          kind: 'SKILL',
        }),
      ]),
    );
    expect(
      available
        .filter((descriptor) => descriptor.provider.providerId === 'builtin-skills' && descriptor.kind === 'SKILL')
        .map((descriptor) => descriptor.capabilityId)
        .sort(),
    ).toEqual(['skill-creator']);
    expect(available.map((descriptor) => descriptor.capabilityId)).not.toContain('telecom-domain-qa');

    expect(() =>
      createCapabilitySubsystem({
        providerConfigs: [
          { provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' }, discoveryMode: 'EAGER', options: { customOptions: {} } },
        ],
      }),
    ).toThrow('BUNDLED capability providers');
    expect(() =>
      createCapabilitySubsystem({
        providerConfigs: [
          {
            provider: { providerId: 'builtin-skills', providerKind: 'CUSTOM', providerType: 'external' },
            discoveryMode: 'SEARCH',
            options: { customOptions: {} },
          },
        ],
      }),
    ).toThrow('Duplicate capability provider id');
    expect(() =>
      createCapabilitySubsystem({
        providerConfigs: [
          {
            provider: { providerId: 'custom-a', providerKind: 'CUSTOM', providerType: 'vendor-a' },
            discoveryMode: 'SEARCH',
            options: { customOptions: {} },
          },
        ],
      }),
    ).toThrow('Unsupported custom capability provider type');
    expect(() =>
      createCapabilitySubsystem({
        providerConfigs: [
          { provider: { providerId: 'external-local', providerKind: 'LOCAL_DIRECTORY' }, discoveryMode: 'EAGER', options: { directoryRef: '/tmp' } },
        ],
      }),
    ).toThrow('LOCAL_DIRECTORY capability providers are registered by trusted local capability sources');
  });

  it('exposes acquire_skill only as a SkillHub-backed provider capability', async () => {
    const withoutSkillHub = createCapabilitySubsystem({ read: { workspaceDir: process.cwd() } });
    await expect(
      withoutSkillHub.catalog.resolve({
        tenantId,
        subjectId,
        agentAssembly: assembly({ capabilityBindings: [{ capabilityId: 'acquire_skill', capabilityType: 'TOOL', providerId: 'hub-local' }] }),
        capabilityId: brand<string, 'CapabilityId'>('acquire_skill'),
      }),
    ).resolves.toBeUndefined();

    const withSkillHub = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      skillHubSourceAuthorization: () => true,
      skillHubRemoteAccessFactory: () => ({
        async listCandidates() {
          return { status: 'ok', candidates: [] };
        },
        async fetchContent() {
          return { status: 'failed', reasonCode: 'unavailable' };
        },
      }),
      providerConfigs: [
        {
          provider: { providerId: 'hub-local', providerKind: 'SKILL_HUB' },
          discoveryMode: 'SEARCH',
          options: { gatewayId: 'skillhub', managedInstallRef: process.cwd() },
        },
      ],
    });
    await expect(
      withSkillHub.catalog.resolve({
        tenantId,
        subjectId,
        agentAssembly: assembly({ capabilityBindings: [{ capabilityId: 'acquire_skill', capabilityType: 'TOOL', providerId: 'hub-local' }] }),
        capabilityId: brand<string, 'CapabilityId'>('acquire_skill'),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        capabilityId: 'acquire_skill',
        kind: 'TOOL',
        provider: { providerId: 'hub-local', providerKind: 'SKILL_HUB' },
        availabilityStatus: 'AVAILABLE',
      }),
    );
  });

  it('exposes the canonical AskUserQuestion descriptor with bounded question shape only', async () => {
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir: process.cwd() } });
    const available = await subsystem.catalog.listAvailable({ tenantId, subjectId, agentAssembly: assembly(), includeUnavailable: false });
    const askUserQuestion = available.find((descriptor) => descriptor.capabilityId === 'AskUserQuestion');

    expect(askUserQuestion).toMatchObject({
      capabilityId: 'AskUserQuestion',
      displayName: 'AskUserQuestion',
      kind: 'TOOL',
      provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
      availabilityStatus: 'AVAILABLE',
      replayPolicy: 'NON_IDEMPOTENT',
    });
    expect(askUserQuestion?.description).toContain('You MUST call this tool whenever you need to ask the user any ordinary question');
    expect(askUserQuestion?.description).toContain('questions must be a native JSON array with one to three question objects');
    expect(askUserQuestion?.description).toContain('Omit options for free-text answers');
    expect(askUserQuestion?.description).toContain('set requiresTextInput=true on that option');
    expect(askUserQuestion?.description).toContain('Set question-level custom=true');
    expect(askUserQuestion?.description).toContain('do not add a synthetic custom option');
    expect(askUserQuestion?.description).toContain('generic permission to proceed');
    expect(askUserQuestion?.description).not.toContain('twenty');
    expect(askUserQuestion?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['prompt'],
          },
        },
      },
    });
    const schema = askUserQuestion?.inputSchema as
      | {
          readonly properties?: {
            readonly questions?: {
              readonly items?: {
                readonly properties?: Record<string, unknown>;
              };
            };
          };
        }
      | undefined;
    const questionProperties = schema?.properties?.questions?.items?.properties ?? {};
    const optionProperties =
      (questionProperties['options'] as { readonly items?: { readonly properties?: Record<string, unknown> } } | undefined)?.items?.properties ?? {};
    const schemaText = JSON.stringify(askUserQuestion?.inputSchema);
    expect(schemaText).toContain('Each option needs a unique value');
    expect(schemaText).toContain('Only valid when requiresTextInput=true');
    expect(Object.keys(questionProperties).sort()).toEqual(['custom', 'multiple', 'options', 'prompt']);
    expect(Object.keys(optionProperties).sort()).toEqual(['inputPlaceholder', 'label', 'requiresTextInput', 'value']);
    const validate = new Ajv({ strict: false, allErrors: true }).compile(askUserQuestion?.inputSchema ?? false);
    expect(validate({ questions: [{ prompt: 'Which time window?' }] })).toBe(true);
    expect(validate({ questions: [{ prompt: 'Which time window?', custom: true }] })).toBe(true);
    expect(validate({ questions: [{ prompt: 'Which time window?', custom: false }] })).toBe(true);
    expect(validate({ questions: JSON.stringify([{ prompt: 'Which region?' }]) })).toBe(false);
    expect(validate({ questions: [{ prompt: 'Which region?', options: [{ value: 'later', label: 'I will provide it' }] }] })).toBe(false);
    expect(
      validate({
        questions: [
          {
            prompt: 'Which KPI?',
            options: [
              { value: 'drop_call_rate', label: 'Drop call rate' },
              { value: 'throughput', label: 'Throughput' },
            ],
            custom: true,
          },
        ],
      }),
    ).toBe(true);
    expect(
      validate({
        questions: [
          {
            prompt: 'What should receive tests?',
            options: [
              { value: 'existing_project', label: 'Existing project', requiresTextInput: true, inputPlaceholder: 'Enter the project path' },
              { value: 'single_file', label: 'Single file', requiresTextInput: true, inputPlaceholder: 'Enter the file path' },
            ],
          },
        ],
      }),
    ).toBe(true);
    expect(
      validate({
        questions: [
          {
            prompt: 'What should receive tests?',
            options: [
              { value: 'existing_project', label: 'Existing project', requiresTextInput: true },
              { value: 'single_file', label: 'Single file' },
            ],
            custom: true,
          },
        ],
      }),
    ).toBe(true);
    expect(
      validate({
        questions: [
          {
            prompt: 'What should receive tests?',
            options: [
              { value: 'existing_project', label: 'Existing project', inputPlaceholder: 'Enter the project path' },
              { value: 'single_file', label: 'Single file' },
            ],
          },
        ],
      }),
    ).toBe(false);
    expect(schemaText).not.toMatch(/questionType|header|annotations|answerSchema|identity|idempotency|timeoutBehavior|producerRef/u);
  });

  it('honors disabled AskUserQuestion bindings even though builtin tools are default-enabled', async () => {
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir: process.cwd() } });
    const available = await subsystem.catalog.listAvailable({
      tenantId,
      subjectId,
      agentAssembly: assembly({
        capabilityBindings: [{ capabilityId: 'AskUserQuestion', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false }],
      }),
      includeUnavailable: false,
    });

    expect(available).toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'Read' })]));
    expect(available).not.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'AskUserQuestion' })]));
  });

  it('registers external EAGER discoveries into the startup catalog (not just SEARCH)', async () => {
    const externalDescriptor: CapabilityDescriptor = {
      ...descriptor('external-eager', 'eager-external'),
      kind: 'AGENT',
      provider: { providerId: 'eager-external', providerKind: 'AGENT_REGISTRY' },
    };
    let listAllCount = 0;
    const provider = { providerId: 'eager-external', providerKind: 'AGENT_REGISTRY' as const };
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      externalProviders: [
        {
          identity: provider,
          discovery: {
            provider,
            discoveryMode: 'EAGER',
            async listAll() {
              listAllCount += 1;
              return [externalDescriptor];
            },
          },
        },
      ],
    });
    const externalAssembly = assembly({
      capabilityBindings: [{ capabilityId: 'external-eager', capabilityType: 'AGENT', providerId: 'eager-external' }],
    });

    const available = await subsystem.catalog.listAvailable({ tenantId, subjectId, agentAssembly: externalAssembly, includeUnavailable: false });
    expect(listAllCount).toBe(1);
    expect(available).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capabilityId: 'Read', provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' } }),
        externalDescriptor,
      ]),
    );
  });

  it('keeps catalog gates consistent for binding, availability, search scope, and unresolved conflicts', async () => {
    const unavailable = { ...readDescriptor(), availabilityStatus: 'UNAVAILABLE' as const };
    const unbound = descriptor('unbound', 'other-provider');
    const searchDescriptor = descriptor('search-read', 'search-provider');
    const searchCalls: unknown[] = [];
    const searchDiscovery: CapabilityDiscovery = {
      provider: { providerId: 'search-provider', providerKind: 'MCP_SERVER' },
      discoveryMode: 'SEARCH',
      async search(criteria) {
        searchCalls.push(criteria);
        return [searchDescriptor, descriptor('not-bound', 'search-provider')];
      },
    };
    const catalog = new StaticCapabilityCatalog([unavailable, unbound], { searchDiscoveries: [searchDiscovery] });
    const scopedAssembly = assembly({
      capabilityBindings: [
        { capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools' },
        { capabilityId: 'search-read', capabilityType: 'TOOL', providerId: 'search-provider' },
      ],
    });

    await expect(catalog.listAvailable({ tenantId, subjectId, agentAssembly: scopedAssembly, includeUnavailable: false })).resolves.toEqual([
      searchDescriptor,
    ]);
    await expect(catalog.resolve({ tenantId, subjectId, agentAssembly: scopedAssembly, capabilityId: readCapabilityId })).resolves.toBeUndefined();
    await expect(
      catalog.resolve({ tenantId, subjectId, agentAssembly: scopedAssembly, capabilityId: brand<string, 'CapabilityId'>('search-read') }),
    ).resolves.toEqual(searchDescriptor);
    expect(searchCalls).toHaveLength(3);
    expect(searchCalls[0]).toMatchObject({ tenantId, subjectId, agentId, agentVersion, agentAssemblyRef: 'default-agent:v1' });
    expect(searchCalls[0]).not.toHaveProperty('agentAssembly');
    expect(searchCalls[0]).not.toHaveProperty('boundCapabilityIds');

    const conflicted = new StaticCapabilityCatalog([descriptor('same', 'p1'), descriptor('same', 'p2')]);
    const conflictAssembly = assembly({
      capabilityBindings: [
        { capabilityId: 'same', capabilityType: 'TOOL', providerId: 'p1' },
        { capabilityId: 'same', capabilityType: 'TOOL', providerId: 'p2' },
      ],
    });
    await expect(conflicted.listAvailable({ tenantId, subjectId, agentAssembly: conflictAssembly, includeUnavailable: false })).resolves.toEqual([]);
    await expect(
      conflicted.resolve({ tenantId, subjectId, agentAssembly: conflictAssembly, capabilityId: brand<string, 'CapabilityId'>('same') }),
    ).resolves.toBeUndefined();
  });

  it('routes execution by exact provider id and kind instead of provider kind fallback', async () => {
    const factory = new StaticCapabilityExecutorFactory([{ provider: builtinToolsProvider, executor: builtinExecutor() }]);
    expect(factory.create({ descriptor: readDescriptor() })).toBeDefined();
    expect(factory.create({ descriptor: descriptor('other', 'another-bundled') })).toBeUndefined();

    const duplicateFactory = new StaticCapabilityExecutorFactory([
      { provider: builtinToolsProvider, executor: builtinExecutor() },
      { provider: builtinToolsProvider, executor: builtinExecutor() },
    ]);
    expect(() => duplicateFactory.create({ descriptor: readDescriptor() })).toThrow('Multiple capability executors');
  });
});

describe('capability result consumption', () => {
  it('does not let ToolSearch rediscover an eagerly visible governed Tool', async () => {
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir: process.cwd() } });
    const appended: unknown[] = [];
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await executeToolCallsInOrder(
      {
        capabilityCatalog: subsystem.catalog,
        capabilityInvocation: subsystem.invocationPort,
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState(appended),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-search-1', toolName: 'ToolSearch', arguments: { query: 'bounded slice' } }],
        requestLocalState,
      },
    );

    const resultMessage = appended
      .map((entry) => (entry as { readonly draft?: { readonly content?: string; readonly metadata?: { readonly kind?: string } } }).draft)
      .find((draft) => draft?.metadata?.kind === 'CAPABILITY_RESULT');
    expect(resultMessage).toBeDefined();
    const content = JSON.parse(resultMessage!.content!) as { readonly payload: JsonObject };

    expect(content.payload).toMatchObject({ tools: [], truncated: false });
    expect(JSON.stringify(content.payload)).not.toContain('inputSchema');
    expect(JSON.stringify(content.payload)).not.toContain('providerId');
    expect(JSON.stringify(content.payload)).not.toContain('workspaceDir');
    expect(requestLocalState.contextPatch).toBeUndefined();
  });

  it('keeps runtime resolver independent from request-local allowedTools', async () => {
    const writeCapabilityId = brand<string, 'CapabilityId'>('Write');
    const catalog = new StaticCapabilityCatalog([readDescriptor(), descriptor('Write', 'builtin-tools')]);
    const acceptedAssembly = assembly();
    let resolved: CapabilityDescriptor | undefined;

    await executeToolCallsInOrder(
      {
        capabilityCatalog: catalog,
        capabilityInvocation: {
          async invoke(_request, signal, runtimeContext) {
            resolved = await runtimeContext?.capabilityResolver?.resolveCapability({ kind: 'TOOL', capabilityId: writeCapabilityId }, signal);
            return { status: 'SUCCEEDED', structuredPayload: { ok: true }, generatedMessages: [], artifactRefs: [] };
          },
        },
        assemblyRegistry: assemblyRegistry(acceptedAssembly),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([]),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-1', toolName: 'Read', arguments: {} }],
        requestLocalState: { generatedMessages: [], contextPatch: { allowedTools: [readCapabilityId] } },
      },
    );

    expect(resolved).toEqual(expect.objectContaining({ capabilityId: 'Write' }));
  });

  it('accumulates request-local allowed tools across multiple ToolSearch calls', async () => {
    const writeCapabilityId = brand<string, 'CapabilityId'>('Write');
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([
          descriptor('ToolSearch', 'builtin-tools'),
          readDescriptor(),
          descriptor('Write', 'builtin-tools'),
        ]),
        capabilityInvocation: {
          async invoke(request) {
            return {
              status: 'SUCCEEDED',
              structuredPayload: { tools: [], truncated: false },
              generatedMessages: [],
              contextPatch: { allowedTools: [request.toolCallId === 'tool-search-1' ? readCapabilityId : writeCapabilityId] },
              artifactRefs: [],
            };
          },
        },
        assemblyRegistry: assemblyRegistry(
          assembly({
            capabilityBindings: [
              { capabilityId: 'ToolSearch', capabilityType: 'TOOL', providerId: 'builtin-tools' },
              { capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools' },
              { capabilityId: 'Write', capabilityType: 'TOOL', providerId: 'builtin-tools' },
            ],
          }),
        ),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([]),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [
          { toolCallId: 'tool-search-1', toolName: 'ToolSearch', arguments: { query: 'read' } },
          { toolCallId: 'tool-search-2', toolName: 'ToolSearch', arguments: { query: 'write' } },
        ],
        requestLocalState,
      },
    );

    expect(requestLocalState.contextPatch?.allowedTools).toEqual([readCapabilityId, writeCapabilityId]);
  });

  it('passes request-local discovered Skills from ToolSearch to Skill calls in a later round', async () => {
    const discoveredSkillId = brand<string, 'CapabilityId'>('radio-qos');
    const seenDiscoveredSkills: unknown[] = [];
    const toolSearchDescriptor = descriptor('ToolSearch', 'builtin-tools');
    const skillToolDescriptor = descriptor('Skill', 'builtin-tools');
    const sharedRequestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    // Round 0: ToolSearch discovers a Skill and merges discoveredSkills into requestLocalState.contextPatch.
    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([toolSearchDescriptor, skillToolDescriptor]),
        capabilityInvocation: {
          async invoke(request, _signal, runtimeContext) {
            if (request.capabilityId === 'ToolSearch') {
              return {
                status: 'SUCCEEDED',
                structuredPayload: { tools: [{ capability_id: 'radio-qos', name: 'Radio QoS', kind: 'SKILL' }], truncated: false },
                generatedMessages: [],
                contextPatch: { discoveredSkills: [discoveredSkillId] },
                artifactRefs: [],
              };
            }
            seenDiscoveredSkills.push(runtimeContext?.discoveredSkills);
            return { status: 'SUCCEEDED', structuredPayload: { ok: true }, generatedMessages: [], artifactRefs: [] };
          },
        },
        assemblyRegistry: assemblyRegistry(
          assembly({
            capabilityBindings: [
              { capabilityId: 'ToolSearch', capabilityType: 'TOOL', providerId: 'builtin-tools' },
              { capabilityId: 'Skill', capabilityType: 'TOOL', providerId: 'builtin-tools' },
            ],
          }),
        ),
        toolSearchSkillSearchEnabled: true,
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([]),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-search-1', toolName: 'ToolSearch', arguments: { query: 'radio' } }],
        requestLocalState: sharedRequestLocalState,
      },
    );

    // Parallel tool calls (support-parallel-tool-calls) make same-round invocations concurrent,
    // so discoveredSkills cannot flow within the same round. The shared requestLocalState persists
    // across rounds, so a Skill call in a later round observes the merged discoveredSkills.
    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([toolSearchDescriptor, skillToolDescriptor]),
        capabilityInvocation: {
          async invoke(request, _signal, runtimeContext) {
            if (request.capabilityId === 'ToolSearch') {
              return {
                status: 'SUCCEEDED',
                structuredPayload: { tools: [{ capability_id: 'radio-qos', name: 'Radio QoS', kind: 'SKILL' }], truncated: false },
                generatedMessages: [],
                contextPatch: { discoveredSkills: [discoveredSkillId] },
                artifactRefs: [],
              };
            }
            seenDiscoveredSkills.push(runtimeContext?.discoveredSkills);
            return { status: 'SUCCEEDED', structuredPayload: { ok: true }, generatedMessages: [], artifactRefs: [] };
          },
        },
        assemblyRegistry: assemblyRegistry(
          assembly({
            capabilityBindings: [
              { capabilityId: 'ToolSearch', capabilityType: 'TOOL', providerId: 'builtin-tools' },
              { capabilityId: 'Skill', capabilityType: 'TOOL', providerId: 'builtin-tools' },
            ],
          }),
        ),
        toolSearchSkillSearchEnabled: true,
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([]),
        signal: new AbortController().signal,
        round: 1,
        toolCalls: [{ toolCallId: 'skill-1', toolName: 'Skill', arguments: { name: 'radio-qos' } }],
        requestLocalState: sharedRequestLocalState,
      },
    );

    expect(seenDiscoveredSkills).toEqual([[discoveredSkillId]]);
  });

  it('keeps acquisition replan results on the generic capability result path', async () => {
    const acquiredSkillId = brand<string, 'CapabilityId'>('ran-qos-skill');
    const events: unknown[] = [];
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([descriptor('acquire_skill', 'hub-local', 'SKILL_HUB')]),
        capabilityInvocation: {
          async invoke() {
            return {
              status: 'SUCCEEDED',
              structuredPayload: {
                outcomeCode: 'ACQUIRED_REQUIRES_REPLAN',
                requiresReplan: true,
                providerKind: 'SKILL_HUB',
                providerId: 'hub-local',
                skillId: acquiredSkillId,
                message: 'Skill acquired; rebuild the capability snapshot before use.',
              },
              generatedMessages: [],
              contextPatch: { discoveredSkills: [acquiredSkillId] },
              artifactRefs: [],
            };
          },
        },
        assemblyRegistry: assemblyRegistry(
          assembly({
            capabilityBindings: [{ capabilityId: 'acquire_skill', capabilityType: 'TOOL', providerId: 'hub-local' }],
          }),
        ),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([], { events }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'acquire-skill-1', toolName: 'acquire_skill', arguments: { requested_capability_id: 'ran-qos-skill' } }],
        requestLocalState,
      },
    );

    expect(requestLocalState.contextPatch?.discoveredSkills).toEqual([acquiredSkillId]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'CAPABILITY_RESULT_DELTA',
          inlinePayload: expect.objectContaining({
            capabilityId: 'acquire_skill',
            toolCallId: 'acquire-skill-1',
            result: expect.objectContaining({
              outcomeCode: 'ACQUIRED_REQUIRES_REPLAN',
              providerKind: 'SKILL_HUB',
              providerId: 'hub-local',
              skillId: 'ran-qos-skill',
            }),
          }),
        }),
      ]),
    );
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'SKILL_ACQUISITION_COMPLETED' }),
        expect.objectContaining({ type: 'CAPABILITY_SNAPSHOT_REBUILT' }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain('credential');
    expect(JSON.stringify(events)).not.toContain('skillhub-managed');
    expect(JSON.stringify(events)).not.toContain('staging');
    expect(JSON.stringify(events)).not.toContain('raw-package');
    expect(JSON.stringify(events)).not.toContain('sourceIdentity');
  });

  it('keeps canonical capability start and terminal facts out of the direct runtime logger', async () => {
    const entries: unknown[] = [];
    const events: unknown[] = [];
    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([readDescriptor()]),
        capabilityInvocation: {
          async invoke() {
            return { status: 'SUCCEEDED', structuredPayload: { ok: true }, generatedMessages: [], artifactRefs: [] };
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([], { events }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-log-1', toolName: 'Read', arguments: { file_path: 'package.json', limit: 1 } }],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(entries).toEqual([]);
    expect(events.map((event) => (event as { readonly type?: string }).type)).toEqual([
      'CAPABILITY_STARTED',
      'CAPABILITY_RESULT_DELTA',
      'CAPABILITY_COMPLETED',
    ]);
  });

  it('emits raw exception data for tool invocation failures by default', async () => {
    const entries: unknown[] = [];
    testRuntimeLogger(entries);
    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([readDescriptor()]),
        capabilityInvocation: {
          async invoke() {
            const error = new Error('tool failed at C:\\secret\\tool.ts');
            error.cause = new Error('spawn EPERM /tmp/agent-run/child');
            throw error;
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([]),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-fail-raw-exception-1', toolName: 'Read', arguments: { file_path: 'package.json', limit: 1 } }],
        requestLocalState: { generatedMessages: [] },
      },
    );

    const failed = entries.find((entry) => (entry as { readonly event?: string }).event === 'tool.call.failed') as
      Record<string, unknown> | undefined;
    expect(failed).toMatchObject({
      event: 'tool.call.failed',
      toolCallId: 'tool-fail-raw-exception-1',
      rawExceptionData: expect.objectContaining({
        name: 'Error',
        message: 'tool failed at C:\\secret\\tool.ts',
        stack: expect.stringContaining('C:\\secret\\tool.ts'),
        cause: expect.objectContaining({
          name: 'Error',
          message: 'spawn EPERM /tmp/agent-run/child',
        }),
      }),
    });
    expect(JSON.stringify(entries)).toContain('C:\\\\secret\\\\tool.ts');
    expect(JSON.stringify(entries)).toContain('/tmp/agent-run/child');
  });

  it('passes raw runtime Tool input to the centralized writer without a logging flag', async () => {
    const entries: unknown[] = [];
    testRuntimeLogger(entries);
    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([readDescriptor()]),
        capabilityInvocation: {
          async invoke() {
            throw new Error('tool failed');
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([]),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [
          {
            toolCallId: 'tool-fail-raw-input-1',
            toolName: 'Read',
            arguments: {
              file_path: 'C:\\workspace\\alarm\\input.txt',
              limit: 10,
              token: 'sk-runtime-tool-input-secret',
            },
          },
        ],
        requestLocalState: { generatedMessages: [] },
      },
    );

    const failed = entries.find((entry) => (entry as { readonly event?: string }).event === 'tool.call.failed') as
      Record<string, unknown> | undefined;
    expect(failed).toMatchObject({
      event: 'tool.call.failed',
      toolInput: {
        file_path: 'C:\\workspace\\alarm\\input.txt',
        limit: 10,
        token: 'sk-runtime-tool-input-secret',
      },
      safeErrorSummary:
        'Capability invocation failed unexpectedly after dispatch and has stopped. Choose another capability, provide a safe response without this operation, or end and report the failure.',
      toolSafeSummary: expect.any(String),
    });
    expect(failed).not.toHaveProperty('toolInputPreview');
  });

  it('passes effective Tool input and output to the centralized writer for a completed normal diagnostic', async () => {
    const entries: unknown[] = [];
    testRuntimeLogger(entries);
    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([readDescriptor()]),
        capabilityInvocation: {
          async invoke(): Promise<CapabilityInvocationResult> {
            return {
              status: 'SUCCEEDED',
              structuredPayload: {
                content: 'raw tool output token=sk-runtime-tool-output-secret',
                path: 'C:\\workspace\\alarm\\output.txt',
              },
              generatedMessages: [],
              artifactRefs: [],
            };
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([]),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [
          {
            toolCallId: 'tool-completed-raw-payload-1',
            toolName: 'Read',
            arguments: {
              file_path: 'C:\\workspace\\alarm\\input.txt',
              token: 'sk-runtime-tool-input-secret',
            },
          },
        ],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'tool.payload.captured',
          toolCallId: 'tool-completed-raw-payload-1',
          status: 'SUCCEEDED',
          toolInput: expect.objectContaining({
            file_path: 'C:\\workspace\\alarm\\input.txt',
            token: 'sk-runtime-tool-input-secret',
          }),
          toolOutput: expect.objectContaining({
            status: 'SUCCEEDED',
            structuredPayload: {
              content: 'raw tool output token=sk-runtime-tool-output-secret',
              path: 'C:\\workspace\\alarm\\output.txt',
            },
          }),
        }),
      ]),
    );
  });

  it('keeps capability timeline payloads free of detail fields available from persisted messages and catalog facts', async () => {
    const events: unknown[] = [];
    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([skillToolDescriptor(), descriptor('Grep', 'builtin-tools')]),
        capabilityInvocation: {
          async invoke(): Promise<CapabilityInvocationResult> {
            return {
              status: 'SUCCEEDED',
              structuredPayload: { content: 'safe result' },
              generatedMessages: [{ role: 'USER', content: 'generated message' }],
              artifactRefs: [brand<string, 'ArtifactId'>('artifact-1')],
              resultRef: 'result-ref-1',
              fallbackTriggered: true,
              contextPatch: { allowedTools: [brand<string, 'CapabilityId'>('Grep')], modelOptions: { maxOutputTokens: 10 } },
            };
          },
        },
        assemblyRegistry: assemblyRegistry(
          assembly({
            modelIds: ['test-model', 'patched-model'],
            capabilityBindings: [
              { capabilityId: 'Skill', capabilityType: 'TOOL', providerId: 'builtin-tools' },
              { capabilityId: 'Grep', capabilityType: 'TOOL', providerId: 'builtin-tools' },
            ],
          }),
        ),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([], { events }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-safe-1', toolName: 'Skill', arguments: { name: 'telecom-domain-qa' } }],
        requestLocalState: { generatedMessages: [] },
      },
    );

    const started = events.find((event) => (event as { readonly type?: string }).type === 'CAPABILITY_STARTED') as
      { readonly inlinePayload: Record<string, unknown> } | undefined;
    const completed = events.find((event) => (event as { readonly type?: string }).type === 'CAPABILITY_COMPLETED') as
      { readonly inlinePayload: Record<string, unknown> } | undefined;
    expect(started?.inlinePayload).toMatchObject({
      capabilityId: 'Skill',
      toolCallId: 'tool-safe-1',
      stepId: 'turn-1',
    });
    expect(completed?.inlinePayload).toMatchObject({
      capabilityId: 'Skill',
      toolCallId: 'tool-safe-1',
      status: 'SUCCEEDED',
      result: { content: 'safe result' },
    });
    expect(started?.inlinePayload).not.toHaveProperty('argumentKeys');
    expect(started?.inlinePayload).not.toHaveProperty('argumentSizeBucket');
    expect(completed?.inlinePayload).not.toHaveProperty('generatedMessageCount');
    expect(completed?.inlinePayload).not.toHaveProperty('artifactCount');
    expect(completed?.inlinePayload).not.toHaveProperty('contextPatchSummary');
    expect(completed?.inlinePayload).not.toHaveProperty('safeResultSummary');
    expect(JSON.stringify([started, completed])).not.toMatch(/C:\\secret\\alarm\.log|raw result|token=secret|generated message/u);
  });

  it('does not copy provider metadata into capability timeline details', async () => {
    const events: unknown[] = [];
    const invalidProviderId = 'x'.repeat(300);
    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([descriptor('Read', invalidProviderId)]),
        capabilityInvocation: {
          async invoke(): Promise<CapabilityInvocationResult> {
            return {
              status: 'SUCCEEDED',
              structuredPayload: { content: 'safe' },
              generatedMessages: [],
              artifactRefs: [],
            };
          },
        },
        assemblyRegistry: assemblyRegistry(
          assembly({
            capabilityBindings: [{ capabilityId: brand<string, 'CapabilityId'>('Read'), capabilityType: 'TOOL', providerId: invalidProviderId }],
          }),
        ),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([], { events }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-invalid-projection-1', toolName: 'Read', arguments: { limit: 1 } }],
        requestLocalState: { generatedMessages: [] },
      },
    );

    const started = events.find((event) => (event as { readonly type?: string }).type === 'CAPABILITY_STARTED') as
      { readonly inlinePayload: Record<string, unknown> } | undefined;
    const completed = events.find((event) => (event as { readonly type?: string }).type === 'CAPABILITY_COMPLETED') as
      { readonly inlinePayload: Record<string, unknown> } | undefined;
    expect(started?.inlinePayload).toMatchObject({
      capabilityId: 'Read',
      toolCallId: 'tool-invalid-projection-1',
    });
    expect(completed?.inlinePayload).toMatchObject({
      capabilityId: 'Read',
      toolCallId: 'tool-invalid-projection-1',
      status: 'SUCCEEDED',
    });
    expect(started?.inlinePayload).not.toHaveProperty('providerId');
    expect(completed?.inlinePayload).not.toHaveProperty('providerId');
    expect(started?.inlinePayload).not.toHaveProperty('projectionUnavailable');
    expect(completed?.inlinePayload).not.toHaveProperty('projectionUnavailable');
    expect(completed?.inlinePayload).not.toHaveProperty('safeResultSummary');
  });

  it('keeps failed capability results model-visible and emits a bounded runtime diagnostic', async () => {
    const entries: unknown[] = [];
    testRuntimeLogger(entries);
    const events: unknown[] = [];
    const messages: unknown[] = [];
    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([descriptor('Grep', 'builtin-tools')]),
        capabilityInvocation: {
          async invoke() {
            return {
              status: 'FAILED',
              structuredPayload: { total_matches: 12, total_files_with_matches: 4, truncated: true },
              generatedMessages: [],
              artifactRefs: [],
              safeError: { code: 'GREP_FAILED', message: 'Grep failed safely.', category: 'UNAVAILABLE', retryable: false },
            };
          },
        },
        assemblyRegistry: assemblyRegistry(
          assembly({
            capabilityBindings: [{ capabilityId: brand<string, 'CapabilityId'>('Grep'), capabilityType: 'TOOL', providerId: 'builtin-tools' }],
          }),
        ),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState(messages, { events }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [
          {
            toolCallId: 'tool-grep-failed-result-1',
            toolName: 'Grep',
            arguments: { pattern: 'Severity=critical', path: 'diagnostics', output_mode: 'content', token: 'sk-grep-failed-result-secret' },
          },
        ],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'tool.call.failed',
          toolCallId: 'tool-grep-failed-result-1',
          safeErrorCode: 'GREP_FAILED',
          safeErrorSummary: 'Grep failed safely.',
          toolInput: expect.objectContaining({
            pattern: 'Severity=critical',
            path: 'diagnostics',
            output_mode: 'content',
            token: 'sk-grep-failed-result-secret',
          }),
          toolOutput: expect.objectContaining({
            status: 'FAILED',
            structuredPayload: { total_matches: 12, total_files_with_matches: 4, truncated: true },
          }),
        }),
        expect.objectContaining({
          event: 'tool.failure_feedback.appended',
          toolCallId: 'tool-grep-failed-result-1',
          status: 'FAILED',
          safeErrorCode: 'GREP_FAILED',
          safeErrorCategory: 'UNAVAILABLE',
          safeErrorSummary: 'Grep failed safely.',
          retryable: false,
          feedbackMessageKind: 'CAPABILITY_RESULT',
        }),
      ]),
    );
    expect(JSON.stringify(entries)).toContain('sk-grep-failed-result-secret');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'CAPABILITY_COMPLETED',
          inlinePayload: expect.objectContaining({ status: 'FAILED', safeErrorCode: 'GREP_FAILED' }),
        }),
      ]),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        draft: expect.objectContaining({ role: 'CAPABILITY_RESULT', content: expect.stringContaining('"code":"GREP_FAILED"') }),
      }),
    );
  });

  it('emits a canonical failed capability fact and returns an invalid result to the model context', async () => {
    const entries: unknown[] = [];
    const events: unknown[] = [];
    const appended: unknown[] = [];
    testRuntimeLogger(entries);
    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([readDescriptor()]),
        capabilityInvocation: {
          async invoke() {
            return {
              status: 'SUCCEEDED',
              structuredPayload: 'bad',
              generatedMessages: [],
              artifactRefs: [],
            } as unknown as CapabilityInvocationResult;
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState(appended, { events }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-invalid-result-1', toolName: 'Read', arguments: { file_path: 'package.json' } }],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'tool.call.result_invalid',
          toolCallId: 'tool-invalid-result-1',
          safeErrorCode: 'CAPABILITY_RESULT_INVALID',
          rawExceptionData: expect.objectContaining({
            name: 'AgentError',
            code: 'CAPABILITY_RESULT_INVALID',
          }),
        }),
      ]),
    );
    expect(JSON.stringify(appended)).toContain('CAPABILITY_RESULT_INVALID');
    expect(JSON.stringify(appended)).not.toContain('"bad"');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'CAPABILITY_COMPLETED',
          inlinePayload: expect.objectContaining({
            toolCallId: 'tool-invalid-result-1',
            status: 'FAILED',
            safeErrorCode: 'CAPABILITY_RESULT_INVALID',
          }),
        }),
      ]),
    );
  });

  it('keeps generated messages, tool context patch, model patch, and safe refs request-local', async () => {
    const capturedRequests: ModelInvocationRequest[] = [];
    const appended: unknown[] = [];
    const result: CapabilityInvocationResult = {
      status: 'SUCCEEDED',
      structuredPayload: { ok: true },
      generatedMessages: [{ role: 'USER', content: 'generated request-local instruction', meta: true }],
      contextPatch: {
        allowedTools: [readCapabilityId],
        deniedTools: [readCapabilityId],
        modelId: 'patched-model',
        modelOptions: { temperature: 0.7 },
      },
      resultRef: 'result-ref-1',
      artifactRefs: [brand<string, 'ArtifactId'>('artifact-1')],
      fallbackTriggered: true,
      metadata: { source: 'safe' },
    };

    await createAgentHarness({
      model: captureModel(capturedRequests, [
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'tool-1', toolName: 'Skill', arguments: { name: 'telecom-domain-qa' } }],
        },
        { content: 'done', finishReason: 'stop' },
      ]),
      invocation: async () => result,
      capabilities: [skillToolDescriptor(), readDescriptor()],
      acceptedAssembly: assembly({
        modelIds: ['test-model', 'patched-model'],
        capabilityBindings: [
          { capabilityId: 'Skill', capabilityType: 'TOOL', providerId: 'builtin-tools' },
          { capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools' },
        ],
      }),
      appended,
    }).execute();

    expect(capturedRequests).toHaveLength(2);
    expect(capturedRequests[1]?.messages).toContainEqual({ role: 'USER', content: [{ type: 'text', text: 'generated request-local instruction' }] });
    expect(capturedRequests[1]?.temperature).toBe(0.7);
    expect(capturedRequests[1]?.modelId).toBe('patched-model');
    expect(capturedRequests[1]?.tools.map((tool) => tool.name)).toEqual(['Skill']);
    expect(appended.map((item) => (item as { draft: { role: string } }).draft.role)).toEqual(['ASSISTANT', 'CAPABILITY_RESULT']);
    expect(JSON.stringify(appended)).toContain('result-ref-1');
    expect(JSON.stringify(appended)).not.toContain('generated request-local instruction');
  });

  it('does not duplicate Skill content when a Skill result already carries the hidden generated message', async () => {
    const capturedRequests: ModelInvocationRequest[] = [];
    const appended: unknown[] = [];
    const skillContent = '<skill_content name="network-diagnostics">\nUse network diagnosis rules.\n</skill_content>';
    const result: CapabilityInvocationResult = {
      status: 'SUCCEEDED',
      structuredPayload: { name: 'network-diagnostics', status: 'loaded' },
      generatedMessages: [{ role: 'USER', content: skillContent, meta: true }],
      artifactRefs: [],
      metadata: { targetSkillId: 'network-diagnostics' },
    };

    await createAgentHarness({
      model: captureModel(capturedRequests, [
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'tool-skill-1', toolName: 'Skill', arguments: { name: 'network-diagnostics' } }],
        },
        { content: 'done', finishReason: 'stop' },
      ]),
      invocation: async () => result,
      capabilities: [skillToolDescriptor()],
      acceptedAssembly: assembly({
        modelIds: ['test-model', 'patched-model'],
        capabilityBindings: [{ capabilityId: 'Skill', capabilityType: 'TOOL', providerId: 'builtin-tools' }],
      }),
      appended,
    }).execute();

    const rendered = JSON.stringify(capturedRequests[1]?.messages ?? []);
    expect(rendered.match(/<skill_content name=\\"network-diagnostics\\">/gu)).toHaveLength(1);
    expect(JSON.stringify(appended)).toContain('"toolName":"Skill"');
    expect(JSON.stringify(appended)).not.toContain('<skill_content');
  });

  it('returns invalid generated messages and unauthorized tool patches to the next model round', async () => {
    const generatedMessageRequests: ModelInvocationRequest[] = [];
    const generatedMessageAppended: unknown[] = [];
    await createAgentHarness({
      model: captureModel(generatedMessageRequests, [
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'tool-generated-message', toolName: 'Read', arguments: {} }],
        },
        { content: 'recovered', finishReason: 'stop' },
      ]),
      invocation: async () =>
        ({
          status: 'SUCCEEDED',
          structuredPayload: {},
          generatedMessages: [{ role: 'ASSISTANT', content: 'must-not-apply' }],
          artifactRefs: [],
        }) as unknown as CapabilityInvocationResult,
      appended: generatedMessageAppended,
    }).execute();

    expect(JSON.stringify(generatedMessageRequests[1]?.messages)).toContain('CAPABILITY_GENERATED_MESSAGE_INVALID');
    expect(JSON.stringify(generatedMessageRequests[1]?.messages)).not.toContain('must-not-apply');
    expect(JSON.stringify(generatedMessageAppended)).not.toContain('must-not-apply');

    const contextPatchRequests: ModelInvocationRequest[] = [];
    const contextPatchAppended: unknown[] = [];
    await createAgentHarness({
      model: captureModel(contextPatchRequests, [
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'tool-context-patch', toolName: 'Read', arguments: {} }],
        },
        { content: 'recovered', finishReason: 'stop' },
      ]),
      invocation: async () => ({
        status: 'SUCCEEDED',
        structuredPayload: {},
        generatedMessages: [{ role: 'USER', content: 'must-not-apply-with-patch' }],
        contextPatch: { allowedTools: [brand<string, 'CapabilityId'>('Write')] },
        artifactRefs: [],
      }),
      appended: contextPatchAppended,
    }).execute();

    expect(JSON.stringify(contextPatchRequests[1]?.messages)).toContain('CAPABILITY_CONTEXT_PATCH_DENIED');
    expect(JSON.stringify(contextPatchRequests[1]?.messages)).not.toContain('must-not-apply-with-patch');
    expect(JSON.stringify(contextPatchAppended)).not.toContain('must-not-apply-with-patch');
  });
});

describe('AskUserQuestion producer branch', () => {
  it.each([8, 9, 10, 14, 15])('accepts and preserves %i short options in one pending question', async (optionCount) => {
    const pendingRequests: PendingInputIntent[] = [];
    const options = alarmSeverityOptions(optionCount);

    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([askUserQuestionDescriptor()]),
        capabilityInvocation: {
          async invoke() {
            throw new Error('AskUserQuestion must not use ordinary invocation.');
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([], {
          async requestPendingInput(_run, _context, intent) {
            pendingRequests.push(intent);
            return {
              id: brand<string, 'PendingInputId'>(`pending-options-${optionCount}`),
              sessionId: brand<string, 'SessionId'>('session-1'),
              kind: 'QUESTION',
              questions: [],
              timeoutAt: now(10),
            };
          },
        }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [
          {
            toolCallId: `ask-options-${optionCount}`,
            toolName: 'AskUserQuestion',
            arguments: { questions: [{ prompt: 'Which alarm severity?', options }] },
          },
        ],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(pendingRequests).toEqual([{ kind: 'QUESTION', questions: [{ prompt: 'Which alarm severity?', options }] }]);
  });

  it('rejects sixteen options without creating or truncating a pending question', async () => {
    await expectAskUserQuestionFailure({
      requestPendingInput: async () => {
        throw new Error('pending input must not be created');
      },
      expectedCode: 'CAPABILITY_INPUT_INVALID',
      arguments: { questions: [{ prompt: 'Which alarm severity?', options: alarmSeverityOptions(16) }] },
    });
  });

  it('creates runtime-owned question pending input without ordinary capability invocation or immediate result', async () => {
    const appended: unknown[] = [];
    const events: unknown[] = [];
    const pendingRequests: Array<{ readonly context: RequestContext; readonly intent: PendingInputIntent }> = [];
    const pendingInput: PendingInputRequest = {
      id: brand<string, 'PendingInputId'>('pending-ask-1'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      kind: 'QUESTION',
      questions: [
        {
          prompt: 'Which region should I inspect?',
          options: [
            { value: 'north', label: 'North', requiresTextInput: true, inputPlaceholder: 'Enter the site ID' },
            { value: 'south', label: 'South', requiresTextInput: true, inputPlaceholder: 'Enter the site ID' },
          ],
        },
      ],
      timeoutAt: now(10),
    };

    const result = await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([askUserQuestionDescriptor()]),
        capabilityInvocation: {
          async invoke() {
            throw new Error('AskUserQuestion must not use ordinary invocation.');
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState(appended, {
          events,
          async requestPendingInput(_run, context, intent) {
            pendingRequests.push({ context, intent });
            return pendingInput;
          },
        }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [
          {
            toolCallId: 'ask-user-1',
            toolName: 'AskUserQuestion',
            arguments: {
              questions: [
                {
                  prompt: 'Which region should I inspect?',
                  options: [
                    { value: 'north', label: 'North', requiresTextInput: true, inputPlaceholder: 'Enter the site ID' },
                    { value: 'south', label: 'South', requiresTextInput: true, inputPlaceholder: 'Enter the site ID' },
                  ],
                },
                {
                  prompt: 'Which time window should I inspect?',
                  custom: true,
                },
              ],
            },
          },
        ],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(result).toBe(pendingInput);
    expect(pendingRequests).toEqual([
      {
        context: expect.objectContaining({
          nextLifecycleStage: 'BEFORE_CAPABILITY_INVOKE',
          toolCallStates: [expect.objectContaining({ toolCallId: 'ask-user-1', capabilityId: 'AskUserQuestion', status: 'PENDING' })],
        }),
        intent: {
          kind: 'QUESTION',
          questions: [
            {
              prompt: 'Which region should I inspect?',
              options: [
                { value: 'north', label: 'North', requiresTextInput: true, inputPlaceholder: 'Enter the site ID' },
                { value: 'south', label: 'South', requiresTextInput: true, inputPlaceholder: 'Enter the site ID' },
              ],
            },
            {
              prompt: 'Which time window should I inspect?',
              options: [],
            },
          ],
        },
      },
    ]);
    expect(appended.map((item) => (item as { draft: { role: string } }).draft.role)).toEqual(['ASSISTANT']);
    expect(events).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'CAPABILITY_STARTED' })]));
  });

  it('normalizes stringified model question arrays before producer validation', async () => {
    const pendingRequests: Array<{ readonly intent: PendingInputIntent }> = [];
    const pendingInput: PendingInputRequest = {
      id: brand<string, 'PendingInputId'>('pending-ask-stringified'),
      sessionId: brand<string, 'SessionId'>('session-stringified'),
      kind: 'QUESTION',
      questions: [],
      timeoutAt: now(10),
    };

    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([askUserQuestionDescriptor()]),
        capabilityInvocation: {
          async invoke() {
            throw new Error('AskUserQuestion must not use ordinary invocation.');
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([], {
          async requestPendingInput(_run, _context, intent) {
            pendingRequests.push({ intent });
            return pendingInput;
          },
        }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [
          {
            toolCallId: 'ask-user-stringified',
            toolName: 'AskUserQuestion',
            arguments: {
              questions: JSON.stringify([
                {
                  prompt: 'Which region should I inspect?',
                  custom: true,
                },
                {
                  prompt: 'Which time window should I inspect?',
                  options: [
                    { value: 'today', label: 'Today' },
                    { value: 'custom', label: 'Custom' },
                  ],
                },
              ]),
            },
          },
        ],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(pendingRequests).toEqual([
      {
        intent: {
          kind: 'QUESTION',
          questions: [
            {
              prompt: 'Which region should I inspect?',
              options: [],
            },
            {
              prompt: 'Which time window should I inspect?',
              options: [
                { value: 'today', label: 'Today' },
                { value: 'custom', label: 'Custom' },
              ],
            },
          ],
        },
      },
    ]);
  });

  it('normalizes underspecified one-option questions to text questions before producer validation', async () => {
    const pendingRequests: Array<{ readonly intent: PendingInputIntent }> = [];

    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([askUserQuestionDescriptor()]),
        capabilityInvocation: {
          async invoke() {
            throw new Error('AskUserQuestion must not use ordinary invocation.');
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([], {
          async requestPendingInput(_run, _context, intent) {
            pendingRequests.push({ intent });
            return {
              id: brand<string, 'PendingInputId'>('pending-one-option'),
              sessionId: brand<string, 'SessionId'>('session-one-option'),
              kind: 'QUESTION',
              questions: [],
              timeoutAt: now(10),
            };
          },
        }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [
          {
            toolCallId: 'ask-one-option',
            toolName: 'AskUserQuestion',
            arguments: {
              questions: [
                {
                  prompt: 'Please provide the region to inspect.',
                  options: [{ value: 'later', label: 'I will provide it' }],
                },
              ],
            },
          },
        ],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(pendingRequests).toEqual([
      {
        intent: {
          kind: 'QUESTION',
          questions: [
            {
              prompt: 'Please provide the region to inspect.',
              options: [],
            },
          ],
        },
      },
    ]);
  });

  it.each([3, 4, 20])('accepts %i otherwise valid questions as one pending input', async (questionCount) => {
    const appended: unknown[] = [];
    const pendingRequests: PendingInputIntent[] = [];
    const questions = Array.from({ length: questionCount }, (_, index) => ({
      prompt: `Question ${index + 1}?`,
    }));

    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([askUserQuestionDescriptor()]),
        capabilityInvocation: {
          async invoke() {
            throw new Error('AskUserQuestion must not use ordinary invocation.');
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState(appended, {
          async requestPendingInput(_run, _context, intent) {
            pendingRequests.push(intent);
            return {
              id: brand<string, 'PendingInputId'>(`pending-${questionCount}`),
              sessionId: brand<string, 'SessionId'>('session-1'),
              kind: 'QUESTION',
              questions: [],
              timeoutAt: now(10),
            };
          },
        }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [
          {
            toolCallId: `ask-${questionCount}`,
            toolName: 'AskUserQuestion',
            arguments: { questions },
          },
        ],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(pendingRequests).toHaveLength(1);
    expect(pendingRequests[0]).toMatchObject({ kind: 'QUESTION', questions });
    expect(appended.map((item) => (item as { draft: { role: string } }).draft.role)).toEqual(['ASSISTANT']);
  });

  it('feeds 21-question failure as a fully paired batch before executing any tool', async () => {
    const appended: unknown[] = [];
    const events: unknown[] = [];
    let invoked = false;
    let pendingCreated = false;

    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([readDescriptor(), askUserQuestionDescriptor()]),
        capabilityInvocation: {
          async invoke() {
            invoked = true;
            return { status: 'SUCCEEDED', structuredPayload: {}, generatedMessages: [], artifactRefs: [] };
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState(appended, {
          events,
          async requestPendingInput() {
            pendingCreated = true;
            throw new Error('pending input must not be created');
          },
        }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [
          {
            toolCallId: 'read-before-overflow',
            toolName: 'Read',
            arguments: { filePath: 'README.md' },
          },
          {
            toolCallId: 'ask-21',
            toolName: 'AskUserQuestion',
            arguments: {
              questions: Array.from({ length: 21 }, (_, index) => ({ prompt: `Question ${index + 1}?` })),
            },
          },
        ],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(appended.map((item) => (item as { draft: { role: string } }).draft.role)).toEqual(['ASSISTANT', 'CAPABILITY_RESULT', 'CAPABILITY_RESULT']);
    expect(JSON.stringify(appended)).toContain('CAPABILITY_BATCH_REJECTED');
    expect(JSON.stringify(appended)).toContain('CAPABILITY_INPUT_INVALID');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'CAPABILITY_COMPLETED',
          inlinePayload: expect.objectContaining({
            messageId: 'message-2',
            capabilityId: 'Read',
            toolCallId: 'read-before-overflow',
            status: 'FAILED',
            safeErrorCode: 'CAPABILITY_BATCH_REJECTED',
          }),
        }),
        expect.objectContaining({
          type: 'CAPABILITY_COMPLETED',
          inlinePayload: expect.objectContaining({
            messageId: 'message-3',
            capabilityId: 'AskUserQuestion',
            toolCallId: 'ask-21',
            status: 'FAILED',
            safeErrorCode: 'CAPABILITY_INPUT_INVALID',
          }),
        }),
      ]),
    );
    expect(invoked).toBe(false);
    expect(pendingCreated).toBe(false);
  });

  it('corrects a 21-question model batch and accepts a bounded retry in the same run', async () => {
    const capturedRequests: ModelInvocationRequest[] = [];
    const appended: unknown[] = [];
    const events: unknown[] = [];
    const pendingRequests: PendingInputIntent[] = [];
    const overLimitToolCall = {
      toolCallId: 'ask-over-limit',
      toolName: 'AskUserQuestion',
      arguments: {
        questions: Array.from({ length: 21 }, (_, index) => ({ prompt: `Hidden question ${index + 1}?` })),
      },
    };
    const acceptedQuestions = Array.from({ length: 3 }, (_, index) => ({ prompt: `Accepted question ${index + 1}?` }));

    const outcome = await createAgentHarness({
      model: captureModel(capturedRequests, [
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [overLimitToolCall],
        },
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'ask-corrected',
              toolName: 'AskUserQuestion',
              arguments: { questions: acceptedQuestions },
            },
          ],
        },
      ]),
      invocation: async () => {
        throw new Error('AskUserQuestion must not use ordinary invocation.');
      },
      capabilities: [askUserQuestionDescriptor()],
      appended,
      events,
      requestPendingInput: async (_run, _context, intent) => {
        pendingRequests.push(intent);
        return {
          id: brand<string, 'PendingInputId'>('pending-corrected'),
          sessionId: brand<string, 'SessionId'>('session-1'),
          kind: 'QUESTION',
          questions: [],
          timeoutAt: now(10),
        };
      },
    }).execute();

    expect(outcome).toMatchObject({ status: 'PENDING_INPUT' });
    expect(pendingRequests).toHaveLength(1);
    expect(pendingRequests[0]).toMatchObject({ kind: 'QUESTION', questions: acceptedQuestions });
    expect(appended.map((item) => (item as { draft: { role: string } }).draft.role)).toEqual(['ASSISTANT', 'CAPABILITY_RESULT', 'ASSISTANT']);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'DEGRADATION_NOTICE',
          inlinePayload: {
            code: 'ASK_USER_QUESTION_COUNT_EXCEEDED',
            questionCount: 21,
            maxQuestions: 3,
            attempt: 1,
          },
        }),
      ]),
    );
    const correctionMessage = capturedRequests[1]?.messages.find(
      (message) => message.role === 'TOOL' && JSON.stringify(message.content).includes('CAPABILITY_INPUT_INVALID'),
    );
    const renderedCorrection = JSON.stringify(correctionMessage);
    expect(renderedCorrection).toContain('Capability input failed validation:');
    expect(renderedCorrection).toContain('at most 3 items');
    expect(renderedCorrection).not.toContain('Hidden question');
  });

  it('returns repeated question-count failures before the model-only finalizing turn', async () => {
    const capturedRequests: ModelInvocationRequest[] = [];
    const appended: unknown[] = [];
    const events: unknown[] = [];
    const overLimitResult = (attempt: number): ModelFinalResult => ({
      content: '',
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolCallId: `ask-over-limit-${attempt}`,
          toolName: 'AskUserQuestion',
          arguments: {
            questions: Array.from({ length: 21 }, (_, index) => ({ prompt: `Hidden question ${index + 1}?` })),
          },
        },
      ],
    });

    await expect(
      createAgentHarness({
        model: captureModel(capturedRequests, [1, 2].map(overLimitResult)),
        invocation: async () => {
          throw new Error('ordinary invocation must not run');
        },
        capabilities: [askUserQuestionDescriptor()],
        appended,
        events,
        acceptedAssembly: assembly({ runtimeSettings: { requestTimeoutMs: 1000, maxTurns: 2, maxToolCallsPerTurn: 30 } }),
      }).execute(),
    ).rejects.toMatchObject({
      code: 'TOOL_ROUND_LIMIT_EXCEEDED',
      category: 'VALIDATION',
    });

    expect(capturedRequests).toHaveLength(3);
    expect(capturedRequests[2]?.toolChoice).toBe('NONE');
    expect(appended.map((item) => (item as { draft: { role: string } }).draft.role)).toEqual([
      'ASSISTANT',
      'CAPABILITY_RESULT',
      'ASSISTANT',
      'CAPABILITY_RESULT',
    ]);
    for (const attempt of [1, 2]) {
      expect(JSON.stringify(appended)).toContain(`ask-over-limit-${attempt}`);
    }
    expect(
      events.filter(
        (event) =>
          (event as { type?: string; inlinePayload?: { code?: string } }).type === 'DEGRADATION_NOTICE' &&
          (event as { inlinePayload?: { code?: string } }).inlinePayload?.code === 'ASK_USER_QUESTION_COUNT_EXCEEDED',
      ),
    ).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain('CAPABILITY_REPEATED_FAILURE');
  });

  it('returns actionable input validation to the model and accepts a corrected attached-input question', async () => {
    const capturedRequests: ModelInvocationRequest[] = [];
    const appended: unknown[] = [];
    const events: unknown[] = [];
    const pendingRequests: PendingInputIntent[] = [];
    const placeholderCanary = 'PRIVATE_PROJECT_PATH_CANARY';

    const outcome = await createAgentHarness({
      model: captureModel(capturedRequests, [
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'ask-invalid-header',
              toolName: 'AskUserQuestion',
              arguments: {
                questions: [{ prompt: 'What should receive tests?', header: 'Scope', placeholder: placeholderCanary }],
              },
            },
          ],
        },
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'ask-corrected-attached-input',
              toolName: 'AskUserQuestion',
              arguments: {
                questions: [
                  {
                    prompt: 'What should receive tests?',
                    options: [
                      { value: 'existing_project', label: 'Existing project', requiresTextInput: true, inputPlaceholder: 'Enter the project path' },
                      { value: 'single_file', label: 'Single file', requiresTextInput: true, inputPlaceholder: 'Enter the file path' },
                    ],
                    multiple: false,
                    custom: false,
                  },
                ],
              },
            },
          ],
        },
      ]),
      invocation: async () => {
        throw new Error('AskUserQuestion must not use ordinary invocation.');
      },
      capabilities: [askUserQuestionDescriptor()],
      appended,
      events,
      requestPendingInput: async (_run, _context, intent) => {
        pendingRequests.push(intent);
        return {
          id: brand<string, 'PendingInputId'>('pending-corrected-input'),
          sessionId: brand<string, 'SessionId'>('session-1'),
          kind: 'QUESTION',
          questions: [],
          timeoutAt: now(10),
        };
      },
    }).execute();

    expect(outcome).toMatchObject({ status: 'PENDING_INPUT' });
    expect(capturedRequests).toHaveLength(2);
    expect(pendingRequests).toHaveLength(1);
    expect(appended.map((item) => (item as { draft: { role: string } }).draft.role)).toEqual(['ASSISTANT', 'CAPABILITY_RESULT', 'ASSISTANT']);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'DEGRADATION_NOTICE',
          inlinePayload: { code: 'ASK_USER_QUESTION_INPUT_INVALID', attempt: 1 },
        }),
      ]),
    );
    const correctionResult = JSON.stringify(capturedRequests[1]?.messages.find((message) => message.role === 'TOOL'));
    expect(correctionResult).toContain('Capability input failed validation:');
    expect(correctionResult).toContain('AskUserQuestion input validation failed for');
    expect(correctionResult).toContain('"constraint":"additionalProperties"');
    expect(correctionResult).toContain('"path":"/questions/0"');
    expect(correctionResult).toContain('\\"prompt\\"');
    expect(correctionResult).toContain('\\"options\\"');
    expect(correctionResult).toContain('\\"multiple\\"');
    expect(correctionResult).toContain('\\"custom\\"');
    expect(correctionResult).not.toContain('\\"header\\"');
    expect(correctionResult).not.toContain('\\"placeholder\\"');
    expect(correctionResult).not.toContain('questions.0.header');
    expect(correctionResult).not.toContain(placeholderCanary);
  });

  it('returns repeated AskUserQuestion input failures before the model-only finalizing turn', async () => {
    const capturedRequests: ModelInvocationRequest[] = [];
    const appended: unknown[] = [];
    const events: unknown[] = [];
    const invalidResult = (attempt: number): ModelFinalResult => ({
      content: '',
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolCallId: `ask-invalid-input-${attempt}`,
          toolName: 'AskUserQuestion',
          arguments: { questions: [{ prompt: 'Which region?', header: 'Region' }] },
        },
      ],
    });

    await expect(
      createAgentHarness({
        model: captureModel(capturedRequests, [1, 2].map(invalidResult)),
        invocation: async () => {
          throw new Error('ordinary invocation must not run');
        },
        capabilities: [askUserQuestionDescriptor()],
        appended,
        events,
        acceptedAssembly: assembly({ runtimeSettings: { requestTimeoutMs: 1000, maxTurns: 2, maxToolCallsPerTurn: 30 } }),
      }).execute(),
    ).rejects.toMatchObject({
      code: 'TOOL_ROUND_LIMIT_EXCEEDED',
      category: 'VALIDATION',
    });

    expect(capturedRequests).toHaveLength(3);
    expect(capturedRequests[2]?.toolChoice).toBe('NONE');
    expect(appended.map((item) => (item as { draft: { role: string } }).draft.role)).toEqual([
      'ASSISTANT',
      'CAPABILITY_RESULT',
      'ASSISTANT',
      'CAPABILITY_RESULT',
    ]);
    for (const attempt of [1, 2]) {
      expect(JSON.stringify(appended)).toContain(`ask-invalid-input-${attempt}`);
    }
    expect(
      events.filter(
        (event) =>
          (event as { type?: string; inlinePayload?: { code?: string } }).type === 'DEGRADATION_NOTICE' &&
          (event as { inlinePayload?: { code?: string } }).inlinePayload?.code === 'ASK_USER_QUESTION_INPUT_INVALID',
      ),
    ).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain('CAPABILITY_REPEATED_FAILURE');
  });

  it.each([4, 20])('keeps non-count safety validation for the %i-question compatibility path', async (questionCount) => {
    const appended: unknown[] = [];
    let pendingCreated = false;
    const questions = Array.from({ length: questionCount }, (_, index) => ({
      prompt: index === questionCount - 1 ? 'What is your API key?' : `Question ${index + 1}?`,
    }));

    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([askUserQuestionDescriptor()]),
        capabilityInvocation: {
          async invoke() {
            throw new Error('ordinary invocation must not run');
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState(appended, {
          async requestPendingInput() {
            pendingCreated = true;
            throw new Error('pending input must not be created');
          },
        }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [
          {
            toolCallId: `ask-forbidden-${questionCount}`,
            toolName: 'AskUserQuestion',
            arguments: { questions },
          },
        ],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(pendingCreated).toBe(false);
    expect(JSON.stringify(appended)).toContain('ASK_USER_QUESTION_FORBIDDEN_PURPOSE');
    expect(JSON.stringify(appended)).toContain('VALIDATION');
  });

  it('feeds a forbidden AskUserQuestion purpose to the model without treating it as count recovery', async () => {
    const capturedRequests: ModelInvocationRequest[] = [];
    const appended: unknown[] = [];

    const outcome = await createAgentHarness({
      model: captureModel(capturedRequests, [
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'ask-forbidden',
              toolName: 'AskUserQuestion',
              arguments: { questions: [{ prompt: 'What is your API key?' }] },
            },
          ],
        },
        {
          content: 'I cannot request protected input; I will continue without it.',
          finishReason: 'stop',
        },
      ]),
      invocation: async () => {
        throw new Error('ordinary invocation must not run');
      },
      capabilities: [askUserQuestionDescriptor()],
      appended,
    }).execute();

    expect(outcome).toMatchObject({ status: 'COMPLETED' });
    expect(capturedRequests).toHaveLength(2);
    expect(JSON.stringify(capturedRequests[1]?.messages)).toContain('ASK_USER_QUESTION_FORBIDDEN_PURPOSE');
    expect(JSON.stringify(capturedRequests[1]?.messages)).toContain('INVALID_INPUT');
  });

  it('feeds invalid or forbidden question input to the model without creating pending input', async () => {
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly args: JsonObject;
      readonly reasonCode: string;
      readonly message?: string;
    }> = [
      {
        name: 'blank prompt',
        args: { questions: [{ prompt: ' ' }] },
        reasonCode: 'ASK_USER_QUESTION_INPUT_CORRECTABLE',
        message: 'Capability input failed validation:',
      },
      {
        name: 'duplicate option value',
        args: {
          questions: [
            {
              prompt: 'Pick a region.',
              options: [
                { value: 'north', label: 'North' },
                { value: 'north', label: 'North duplicate' },
              ],
            },
          ],
        },
        reasonCode: 'ASK_USER_QUESTION_INPUT_CORRECTABLE',
        message: 'Capability input failed validation:',
      },
      {
        name: 'text modifier',
        args: { questions: [{ prompt: 'Which region?', custom: false }] },
        reasonCode: 'ASK_USER_QUESTION_INPUT_CORRECTABLE',
        message: 'Capability input failed validation:',
      },
      {
        name: 'attached input with custom',
        args: {
          questions: [
            {
              prompt: 'What should receive tests?',
              options: [
                { value: 'project', label: 'Project', requiresTextInput: true },
                { value: 'file', label: 'File' },
              ],
              custom: true,
            },
          ],
        },
        reasonCode: 'ASK_USER_QUESTION_INPUT_CORRECTABLE',
        message: 'AskUserQuestion input validation failed for',
      },
      {
        name: 'placeholder without attached input',
        args: {
          questions: [
            {
              prompt: 'What should receive tests?',
              options: [
                { value: 'project', label: 'Project', inputPlaceholder: 'Project path' },
                { value: 'file', label: 'File' },
              ],
            },
          ],
        },
        reasonCode: 'ASK_USER_QUESTION_INPUT_CORRECTABLE',
        message: 'AskUserQuestion input validation failed for',
      },
      {
        name: 'questions encoded as malformed string',
        args: { questions: '\n[{"prompt":"查询到"151wx"的非精确匹配结果"}]\n' },
        reasonCode: 'ASK_USER_QUESTION_INPUT_CORRECTABLE',
        message: 'AskUserQuestion input validation failed for',
      },
      {
        name: 'root multiple',
        args: { questions: [{ prompt: 'Which region?' }], multiple: false },
        reasonCode: 'ASK_USER_QUESTION_INPUT_CORRECTABLE',
        message: 'AskUserQuestion input validation failed for',
      },
      {
        name: 'question header',
        args: { questions: [{ prompt: 'Which region?', header: 'Region' }] },
        reasonCode: 'ASK_USER_QUESTION_INPUT_CORRECTABLE',
        message: 'AskUserQuestion input validation failed for',
      },
      {
        name: 'forbidden visible text',
        args: { questions: [{ prompt: 'What is your API key?' }] },
        reasonCode: 'ASK_USER_QUESTION_FORBIDDEN_PURPOSE',
      },
    ];

    for (const entry of cases) {
      const appended: unknown[] = [];
      const events: unknown[] = [];
      const logs: unknown[] = [];
      testRuntimeLogger(logs);
      let pendingCreated = false;
      await executeToolCallsInOrder(
        {
          capabilityCatalog: new StaticCapabilityCatalog([askUserQuestionDescriptor()]),
          capabilityInvocation: {
            async invoke() {
              throw new Error('ordinary invocation must not run');
            },
          },
          assemblyRegistry: assemblyRegistry(assembly()),
        },
        {
          run: run(),
          context: requestContext(),
          runState: runState(appended, {
            events,
            async requestPendingInput() {
              pendingCreated = true;
              throw new Error('pending should not be created');
            },
          }),
          signal: new AbortController().signal,
          round: 0,
          toolCalls: [{ toolCallId: `ask-invalid-${entry.name}`, toolName: 'AskUserQuestion', arguments: entry.args }],
          requestLocalState: { generatedMessages: [] },
        },
      );

      expect(pendingCreated, entry.name).toBe(false);
      expect(
        appended.map((item) => (item as { draft: { role: string } }).draft.role),
        entry.name,
      ).toEqual(['ASSISTANT', 'CAPABILITY_RESULT']);
      expect(events, entry.name).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'CAPABILITY_COMPLETED',
            inlinePayload: expect.objectContaining({
              messageId: 'message-2',
              capabilityId: 'AskUserQuestion',
              toolCallId: `ask-invalid-${entry.name}`,
              status: 'FAILED',
              safeErrorCode: entry.reasonCode === 'ASK_USER_QUESTION_FORBIDDEN_PURPOSE' ? 'INVALID_INPUT' : 'CAPABILITY_INPUT_INVALID',
            }),
          }),
        ]),
      );
      const renderedFailure = JSON.stringify(appended);
      expect(renderedFailure, entry.name).toContain(entry.reasonCode);
      if (entry.message !== undefined) {
        expect(renderedFailure, entry.name).toContain(entry.message);
      }
      if (entry.reasonCode === 'ASK_USER_QUESTION_INPUT_CORRECTABLE') {
        const capabilityResult = appended.find((item) => (item as { draft: { role: string } }).draft.role === 'CAPABILITY_RESULT') as {
          readonly draft: { readonly content: string };
        };
        expect(capabilityResult.draft.content, entry.name).toContain('The question was not presented to the user.');
        expect(capabilityResult.draft.content, entry.name).toContain('No pending input was created and no user answer was received.');
        expect(capabilityResult.draft.content, entry.name).toContain('Options in the rejected call are unconfirmed candidates, not user selections.');
        expect(capabilityResult.draft.content, entry.name).toContain('Correct every listed field and call AskUserQuestion again.');
        if (entry.name === 'questions encoded as malformed string') {
          expect(capabilityResult.draft.content).toContain('a native JSON array, not a JSON-encoded string');
          expect(capabilityResult.draft.content).not.toContain('151wx');
        }
      }
      expect(JSON.stringify(logs), entry.name).not.toContain('API key');
      expect(JSON.stringify(logs), entry.name).not.toContain('Project path');
    }
  });

  it('does not route aliases, same-schema ordinary tools, or non-bundled AskUserQuestion descriptors into the producer', async () => {
    const aliases = ['question', 'AskUser', 'ask_user_question', 'askUserQuestion', 'askUser', 'ask_user', 'ask_user_questions'];
    for (const alias of aliases) {
      let pendingCreated = false;
      await executeToolCallsInOrder(
        {
          capabilityCatalog: new StaticCapabilityCatalog([askUserQuestionDescriptor()]),
          capabilityInvocation: {
            async invoke() {
              throw new Error('alias must not invoke AskUserQuestion');
            },
          },
          assemblyRegistry: assemblyRegistry(assembly()),
        },
        {
          run: run(),
          context: requestContext(),
          runState: runState([], {
            async requestPendingInput() {
              pendingCreated = true;
              throw new Error('alias must not create pending input');
            },
          }),
          signal: new AbortController().signal,
          round: 0,
          toolCalls: [{ toolCallId: `alias-${alias}`, toolName: alias, arguments: { questions: [{ prompt: 'Which region?' }] } }],
          requestLocalState: { generatedMessages: [] },
        },
      );
      expect(pendingCreated, alias).toBe(false);
    }

    let ordinaryInvoked = false;
    let ordinaryPendingCreated = false;
    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([
          askUserQuestionDescriptor({ capabilityId: brand<string, 'CapabilityId'>('ordinary-question'), displayName: 'ordinary-question' }),
        ]),
        capabilityInvocation: {
          async invoke() {
            ordinaryInvoked = true;
            return { status: 'SUCCEEDED', structuredPayload: { ok: true }, generatedMessages: [], artifactRefs: [] };
          },
        },
        assemblyRegistry: assemblyRegistry(assembly()),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([], {
          async requestPendingInput() {
            ordinaryPendingCreated = true;
            throw new Error('ordinary same-schema tool must not create pending input');
          },
        }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'ordinary-question-1', toolName: 'ordinary-question', arguments: { questions: [{ prompt: 'Which region?' }] } }],
        requestLocalState: { generatedMessages: [] },
      },
    );
    expect(ordinaryInvoked).toBe(true);
    expect(ordinaryPendingCreated).toBe(false);

    let nonBundledInvoked = false;
    let nonBundledPendingCreated = false;
    await executeToolCallsInOrder(
      {
        capabilityCatalog: new StaticCapabilityCatalog([
          askUserQuestionDescriptor({
            provider: { providerId: 'external-question', providerKind: 'CUSTOM', providerType: 'test' },
          }),
        ]),
        capabilityInvocation: {
          async invoke() {
            nonBundledInvoked = true;
            return { status: 'SUCCEEDED', structuredPayload: { ok: true }, generatedMessages: [], artifactRefs: [] };
          },
        },
        assemblyRegistry: assemblyRegistry(
          assembly({
            capabilityBindings: [
              {
                capabilityId: brand<string, 'CapabilityId'>('AskUserQuestion'),
                capabilityType: 'TOOL',
                providerId: 'external-question',
                enabled: true,
              },
            ],
          }),
        ),
      },
      {
        run: run(),
        context: requestContext(),
        runState: runState([], {
          async requestPendingInput() {
            nonBundledPendingCreated = true;
            throw new Error('non-bundled descriptor must not create pending input');
          },
        }),
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'ask-non-bundled-1', toolName: 'AskUserQuestion', arguments: { questions: [{ prompt: 'Which region?' }] } }],
        requestLocalState: { generatedMessages: [] },
      },
    );
    expect(nonBundledInvoked).toBe(false);
    expect(nonBundledPendingCreated).toBe(false);
  });

  it('maps AskUserQuestion producer failures to safe reason codes', async () => {
    await expectAskUserQuestionFailure({
      requestPendingInput: async () => {
        throw new AgentError({ code: 'PENDING_INPUT_ACTIVE_CONFLICT', message: 'active pending', category: 'CONFLICT', retryable: false });
      },
      expectedCode: 'PENDING_INPUT_UNAVAILABLE',
    });

    const aborted = new AbortController();
    aborted.abort();
    await expectAskUserQuestionFailure({
      signal: aborted.signal,
      requestPendingInput: async () => {
        throw new Error('should not reach pending creation');
      },
      expectedCode: 'ABORTED',
    });

    await expectAskUserQuestionFailure({
      requestPendingInput: async () => {
        throw new Error('database melted');
      },
      expectedCode: 'EXECUTION_FAILED',
    });
  });
});

function createAgentHarness(input: {
  readonly model: ModelInvocationService;
  readonly invocation: (request: CapabilityInvocationRequest) => Promise<CapabilityInvocationResult>;
  readonly appended?: unknown[];
  readonly events?: unknown[];
  readonly requestPendingInput?: AgentRunStatePort['requestPendingInput'];
  readonly capabilities?: CapabilityDescriptor[];
  readonly acceptedAssembly?: AgentAssembly;
}) {
  const acceptedAssembly = input.acceptedAssembly ?? assembly();
  const registry = assemblyRegistry(acceptedAssembly);
  const catalog = new StaticCapabilityCatalog(input.capabilities ?? [readDescriptor()]);
  const persistedMessages: SessionMessageRecord[] = [
    {
      tenantId,
      subjectId,
      agentId,
      messageId: brand<string, 'MessageId'>('request-1'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('request-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      role: 'USER',
      content: 'current request',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: now(0),
    },
  ];
  const contextEngine = createDefaultContextEngine({
    activeContextStore: {
      async loadActiveContext() {
        return {
          state: activeState(),
          items: persistedMessages.map((message, ordinal) => ({
            tenantId,
            subjectId,
            agentId,
            sessionId: message.sessionId,
            ordinal,
            messageId: message.messageId,
          })),
        };
      },
      async appendItem() {
        return { status: 'VERSION_CONFLICT' as const };
      },
      async commitCompaction() {
        return { status: 'VERSION_CONFLICT' as const };
      },
      async updateMetadata() {
        return { status: 'UPDATED' as const };
      },
    },
    messageStore: {
      async appendSessionMessage(record) {
        return record;
      },
      async loadMessage(request) {
        return persistedMessages.find((message) => message.messageId === request.messageId);
      },
      async loadMessages(request) {
        return request.messageIds.flatMap((messageId) => persistedMessages.filter((message) => message.messageId === messageId));
      },
      async listConversationPreview() {
        return { sessionId: brand<string, 'SessionId'>('session-capability-governance'), totalMarkers: 0, offset: 0, limit: 100, markers: [] };
      },
      async listMessages() {
        return { items: persistedMessages, limit: 20, hasMore: false };
      },
      async listCurrentRequestMessages() {
        return { items: persistedMessages, offset: 0, limit: 20, hasMore: false };
      },
      async hideMessage() {
        return undefined;
      },
      async hideRequestMessages() {
        return 0;
      },
    },
    assemblyRegistry: registry,
    capabilityCatalog: catalog,
    modelSelectionService: {
      async select(request, signal) {
        if (signal.aborted) {
          throw signal.reason;
        }
        if (request.modelId !== undefined && request.modelId !== 'patched-model') {
          throw new AgentError({
            code: 'CAPABILITY_MODEL_PATCH_DENIED',
            message: 'Capability model patch is not authorized.',
            category: 'AUTHORIZATION',
            retryable: false,
          });
        }
        return {
          status: 'SELECTED',
          reason: request.modelId === undefined ? 'AGENT_DEFAULT' : 'EXPLICIT_MODEL_ID',
          configuration: {
            modelId: request.modelId ?? 'base-model',
            contextWindowTokens: 128_000,
            temperature: 0.2,
            maxOutputTokens: 32_000,
            topP: 1,
            toolChoice: 'AUTO' as const,
            defaultTimeoutMs: 1_000,
            defaultMaxRetries: 2,
          },
        };
      },
    },
  });
  const agent = new DefaultAgent({
    contextEngine,
    model: input.model,
    capabilityCatalog: catalog,
    capabilityInvocation: { invoke: input.invocation } satisfies CapabilityInvocationPort,
    assemblyRegistry: registry,
    runState: runState(input.appended ?? [], {
      ...(input.events === undefined ? {} : { events: input.events }),
      ...(input.requestPendingInput === undefined ? {} : { requestPendingInput: input.requestPendingInput }),
      onAppend(draft) {
        persistedMessages.push({
          tenantId,
          subjectId,
          agentId,
          messageId: brand<string, 'MessageId'>(`persisted-message-${persistedMessages.length + 1}`),
          sessionId: brand<string, 'SessionId'>('session-1'),
          requestId: brand<string, 'MessageId'>('request-1'),
          runId: brand<string, 'RequestRunId'>('run-1'),
          role: draft.role,
          content: draft.content,
          contentType: draft.contentType,
          metadata: draft.metadata ?? {},
          visible: draft.visible,
          createdAt: now(persistedMessages.length + 1),
        });
      },
    }),
  });
  return {
    execute: () => agent.execute(run(), requestContext(), new AbortController().signal),
  };
}

function captureModel(captured: ModelInvocationRequest[], steps: readonly ModelFinalResult[]): ModelInvocationService {
  let index = 0;
  return {
    async complete() {
      return steps[index++] ?? { content: '' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield steps[index++] ?? { content: '' };
    }),
  };
}

function descriptor(
  capabilityId: string,
  providerId: string,
  providerKind: CapabilityDescriptor['provider']['providerKind'] = 'BUNDLED',
): CapabilityDescriptor {
  return { ...readDescriptor({ providerId, providerKind }), capabilityId: brand<string, 'CapabilityId'>(capabilityId) };
}

function skillToolDescriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('Skill'),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: 'Skill',
    description: 'Load a governed Skill.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  };
}

function askUserQuestionDescriptor(overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('AskUserQuestion'),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    version: '1',
    displayName: 'AskUserQuestion',
    description:
      'Ask the current user one to three short, directly answerable ordinary clarification questions required to continue the current task.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: askUserQuestionInputSchema(),
    outputSchema: { type: 'object' },
    replayPolicy: 'NON_IDEMPOTENT',
    ...overrides,
  };
}

function alarmSeverityOptions(count: number): Array<{ readonly value: string; readonly label: string }> {
  return Array.from({ length: count }, (_, index) => ({ value: `severity-${index + 1}`, label: `Severity ${index + 1}` }));
}

function askUserQuestionInputSchema(): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['prompt'],
          allOf: [
            {
              if: {
                properties: {
                  options: {
                    contains: {
                      type: 'object',
                      required: ['requiresTextInput'],
                      properties: { requiresTextInput: { const: true } },
                    },
                  },
                },
                required: ['options'],
              },
              then: {
                properties: {
                  multiple: { const: false },
                  custom: { const: false },
                },
              },
            },
          ],
          properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 500 },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 15,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['value', 'label'],
                allOf: [
                  {
                    if: { required: ['inputPlaceholder'] },
                    then: {
                      required: ['requiresTextInput'],
                      properties: { requiresTextInput: { const: true } },
                    },
                  },
                ],
                properties: {
                  value: { type: 'string', minLength: 1, maxLength: 500 },
                  label: { type: 'string', minLength: 1, maxLength: 500 },
                  requiresTextInput: { type: 'boolean' },
                  inputPlaceholder: { type: 'string', minLength: 1, maxLength: 200 },
                },
              },
            },
            multiple: { type: 'boolean' },
            custom: { type: 'boolean' },
          },
        },
      },
    },
  };
}

async function expectAskUserQuestionFailure(input: {
  readonly requestPendingInput: AgentRunStatePort['requestPendingInput'];
  readonly expectedCode: string;
  readonly signal?: AbortSignal;
  readonly arguments?: JsonObject;
}): Promise<void> {
  const appended: unknown[] = [];
  const execution = executeToolCallsInOrder(
    {
      capabilityCatalog: new StaticCapabilityCatalog([askUserQuestionDescriptor()]),
      capabilityInvocation: {
        async invoke() {
          throw new Error('ordinary invocation must not run');
        },
      },
      assemblyRegistry: assemblyRegistry(assembly()),
    },
    {
      run: run(),
      context: requestContext(),
      runState: runState(appended, { requestPendingInput: input.requestPendingInput }),
      signal: input.signal ?? new AbortController().signal,
      round: 0,
      toolCalls: [
        {
          toolCallId: 'ask-failure-1',
          toolName: 'AskUserQuestion',
          arguments: input.arguments ?? { questions: [{ prompt: 'Which region?' }] },
        },
      ],
      requestLocalState: { generatedMessages: [] },
    },
  );
  if (input.expectedCode === 'ABORTED') {
    await expect(execution).rejects.toMatchObject({ code: input.expectedCode });
    return;
  }
  await execution;
  expect(JSON.stringify(appended)).toContain(input.expectedCode);
}

function builtinExecutor(): BuiltinToolsExecutor {
  return new BuiltinToolsExecutor(
    createToolCatalog({
      provider: builtinToolsProvider,
      tools: builtinToolDefinitions,
      dependencies: { workspaceFiles: createWorkspaceFilePort({ workspaceDir: process.cwd() }) },
    }),
  );
}

function assembly(overrides: Partial<AgentAssembly> = {}): AgentAssembly {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion,
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default',
    description: 'Telecom test agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelIds: ['test-model'],
    capabilityBindings: [{ capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools' }],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
    ...overrides,
  };
}

function assemblyRegistry(acceptedAssembly: AgentAssembly): AgentAssemblyRegistry {
  return {
    async active() {
      return acceptedAssembly;
    },
    async require() {
      return acceptedAssembly;
    },
  };
}

function run(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    agentId,
    agentVersion,
    agentAssemblyRef: 'default-agent:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: now(1),
    updatedAt: now(1),
  };
}

function requestContext(): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    agentTurnIndex: 0,
    identityContext: { tenantId, subjectId, displayName: 'tester' },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId,
    agentVersion,
    agentAssemblyRef: 'default-agent:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
}

function runState(
  appended: unknown[],
  options: {
    readonly events?: unknown[];
    readonly requestPendingInput?: AgentRunStatePort['requestPendingInput'];
    readonly onAppend?: (draft: Parameters<AgentRunStatePort['appendMessage']>[2]) => void;
  } = {},
): AgentRunStatePort {
  return {
    async setCapabilityTerminalAnswer(): Promise<void> {},
    async emitEvent(_run, _context, event) {
      options.events?.push(event);
    },
    async appendMessage(_run, _context, draft) {
      appended.push({ draft });
      options.onAppend?.(draft);
      return brand<string, 'MessageId'>(`message-${appended.length}`);
    },
    async saveCheckpoint() {},
    requestPendingInput:
      options.requestPendingInput ??
      (async () => {
        throw new Error('not used');
      }),
  };
}

function testRuntimeLogger(entries: unknown[]) {
  const logger = {
    info(obj: object) {
      entries.push(obj);
    },
    warn(obj: object) {
      entries.push(obj);
    },
    error(obj: object) {
      entries.push(obj);
    },
    debug(obj: object) {
      entries.push(obj);
    },
  };
  loggerBinding?.unbind();
  loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
}

function activeState() {
  return { tenantId, subjectId, agentId, sessionId: brand<string, 'SessionId'>('session-1'), activeContextVersion: 1, updatedAt: now(1) };
}

function now(value: number): EpochMillis {
  return brand<number, 'EpochMillis'>(value);
}
