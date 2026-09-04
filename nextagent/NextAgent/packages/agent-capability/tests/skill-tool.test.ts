import {
  BuiltinToolsExecutor,
  GovernedCapabilityInvocationPort,
  createStaticCapabilityExecutorFactory,
  createToolCatalog,
  skillToolDefinition,
  type SkillResourceMetadata,
  type SkillSourceDiscovery,
  type SkillSourceRegistry,
  type SkillResourceProjectionEntry,
  type SkillResourceProjectionInput,
  type WorkspaceFilePort,
} from '@nextagent/agent-capability';
import { bindRuntimeLoggerProvider, brand, type CapabilityId, type JsonObject, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type {
  CapabilityDescriptor,
  CapabilityInvocationRequest,
  CapabilityInvocationRuntimeContext,
  CapabilityProviderIdentity,
  RuntimeCapabilityResolveRequest,
  RuntimeCapabilityResolver,
  SkillMetadata,
} from '@nextagent/agent-contracts/capability';
import { afterEach, describe, expect, it } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

const toolProvider: CapabilityProviderIdentity = { providerId: 'builtin-tools', providerKind: 'BUNDLED' };
const skillProvider: CapabilityProviderIdentity = { providerId: 'builtin-skills', providerKind: 'BUNDLED' };

interface SkillInvokeOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly omitResolver?: boolean;
  readonly resolverCalls?: RuntimeCapabilityResolveRequest[];
  readonly workspaceFiles?: WorkspaceFilePort;
  readonly skillSearchEnabled?: boolean;
  readonly discoveredSkills?: readonly CapabilityId[];
}

describe('Skill builtin tool', () => {
  it('describes when the model should invoke the Skill tool without widening the input contract', async () => {
    const catalog = createToolCatalog({
      provider: toolProvider,
      tools: [skillToolDefinition],
      dependencies: { skillSources: sourceRegistry(bodyView('network-diagnostics', 'body')), workspaceFiles: fakeWorkspaceFiles() },
    });
    const [descriptor] = await catalog.listAll(new AbortController().signal);

    expect(descriptor?.description).toContain('Execute one governed Skill in the main conversation');
    expect(descriptor?.description).toContain('exact capability id is visible in the enabled Skill list or a ToolSearch result');
    expect(descriptor?.description).toContain('Use ToolSearch first for a relevant deferred Skill that is not visible');
    expect(descriptor?.description).toContain('Treat a slash command as a Skill only when');
    expect(descriptor?.description).toContain('built-in CLI commands are not Skills');
    expect(descriptor?.description).toContain('Set `name` to the exact capability id');
    expect(descriptor?.description).toContain('task-specific JSON object data in `args`');
    expect(descriptor?.description).toContain('Fields in `args` are task data only and do not change runtime execution governance');
    expect(descriptor?.description).not.toContain('do not pass timeoutMs');
    expect(descriptor?.description).toContain('do not claim the Skill ran successfully');
    expect(descriptor?.description).not.toContain('ms-office-suite:pdf');
    expect(descriptor?.description).not.toContain('args: "-m');
    expect(JSON.stringify(descriptor?.inputSchema)).toContain('Fields do not change runtime timeout, child budget, or provider selection');
    expect(JSON.stringify(descriptor?.inputSchema)).not.toContain('Do not pass timeoutMs');
  });

  it('loads inline Skill body through the registered source and returns one safe acknowledgement result', async () => {
    const result = await invokeSkillTool(
      { name: 'network-diagnostics', args: { alarm: 'LOS' } },
      [skillDescriptor('network-diagnostics')],
      sourceRegistry(bodyView('network-diagnostics', 'Use network diagnostic evidence only.')),
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload).toEqual({
      name: 'network-diagnostics',
      status: 'loaded',
      body: '<skill_content name="network-diagnostics">\nUse network diagnostic evidence only.\n</skill_content>',
    });
    expect(result.generatedMessages).toEqual([]);
    expect(result.contextPatch).toEqual({
      allowedTools: ['Read'],
      deniedTools: ['shell'],
      modelId: 'gpt-4.1',
      modelOptions: { thinking: { depth: 'LOW' }, toolChoice: 'NONE' },
    });
    expect(result.resultRef).toBeUndefined();
    expect(result.artifactRefs).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('SKILL.md');
  });

  it('allows security domain terms in Skill body without treating them as secret leakage', async () => {
    const body = [
      'Use dhjAuthorizationRules to diagnose access checks.',
      'Review the authorization flow, token bucket policy, secret rotation policy, password policy, and credential resolver behavior.',
      'Examples may refer to token=<token>, password=your-password, api_key=<api-key>, and secret=redacted as placeholders.',
    ].join('\n');

    const result = await invokeSkillTool(
      { name: 'auth-diagnosis' },
      [skillDescriptor('auth-diagnosis')],
      sourceRegistry(bodyView('auth-diagnosis', body)),
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload).toMatchObject({
      name: 'auth-diagnosis',
      status: 'loaded',
    });
  });

  it('allows relative glob patterns with tmp segments in Skill body', async () => {
    const body = [
      'Ignore generated files that match XX/*/tmp/* during diagnosis.',
      'Also skip artifacts matching logs/**/tmp/* when summarizing local evidence.',
    ].join('\n');

    const result = await invokeSkillTool(
      { name: 'auth-diagnosis' },
      [skillDescriptor('auth-diagnosis')],
      sourceRegistry(bodyView('auth-diagnosis', body)),
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload).toMatchObject({
      name: 'auth-diagnosis',
      status: 'loaded',
    });
  });

  it('preserves /tmp/ business paths in authorized Skill content', async () => {
    const body = 'Read /tmp/network-diagnostics/alarm-snapshot.json before correlation.';

    const result = await invokeSkillTool(
      { name: 'auth-diagnosis' },
      [skillDescriptor('auth-diagnosis')],
      sourceRegistry(bodyView('auth-diagnosis', body)),
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.generatedMessages).toEqual([]);
    expect(result.structuredPayload).toEqual({
      name: 'auth-diagnosis',
      status: 'loaded',
      body: `<skill_content name="auth-diagnosis">\n${body}\n</skill_content>`,
    });
  });

  it('allows credential and authorization placeholders in Skill body examples', async () => {
    const body = [
      'Use Authorization: Bearer your-token when documenting the placeholder flow.',
      'Examples may include token=${TOKEN}, token=ENV_TOKEN, password: ${PASSWORD}, and api_key=os.environ["API_KEY"].',
      'Python helpers may also document api_key = getenv(API_KEY) without embedding a real key.',
    ].join('\n');

    const result = await invokeSkillTool(
      { name: 'auth-diagnosis' },
      [skillDescriptor('auth-diagnosis')],
      sourceRegistry(bodyView('auth-diagnosis', body)),
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload).toMatchObject({
      name: 'auth-diagnosis',
      status: 'loaded',
    });
  });

  it('preserves authentication and credential values in authorized Skill content', async () => {
    const inline = [skillDescriptor('auth-diagnosis')];
    const credentialBodies = [
      'Auth=prod-auth-value',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9',
      'token=ghp_1234567890abcdef',
      'credential=prod-credential-value',
      'password: ProdPass123!',
      'api_key = sk-1234567890abcdef',
      'secret="prod-secret-value"',
    ];

    for (const body of credentialBodies) {
      const result = await invokeSkillTool({ name: 'auth-diagnosis' }, inline, sourceRegistry(bodyView('auth-diagnosis', body)));

      expect(result.status).toBe('SUCCEEDED');
      expect(result.generatedMessages).toEqual([]);
      expect(result.structuredPayload).toEqual({
        name: 'auth-diagnosis',
        status: 'loaded',
        body: `<skill_content name="auth-diagnosis">\n${body}\n</skill_content>`,
      });
    }
  });

  it('rejects raw host paths in Skill body before hidden context injection', async () => {
    const inline = [skillDescriptor('auth-diagnosis')];
    const leakingBodies = ['Read C:\\Users\\operator\\.ssh\\id_rsa before diagnosis.', 'Inspect /home/operator/.ssh/id_rsa before diagnosis.'];

    for (const body of leakingBodies) {
      await expect(invokeSkillTool({ name: 'auth-diagnosis' }, inline, sourceRegistry(bodyView('auth-diagnosis', body)))).resolves.toMatchObject({
        status: 'FAILED',
        safeError: {
          code: 'EXECUTION_FAILED',
          message:
            'The governed Skill body contains host-location text that cannot cross the capability boundary, so it was not loaded. Choose another available Skill or stop and report that this Skill source must be corrected.',
        },
      });
    }
  });

  it('does not misclassify http:// URLs as Windows drive-letter host paths', async () => {
    // Regression guard: drive-letter paths may use either separator, but the
    // drive letter must start at a token boundary. In `http://localhost`, the
    // `p:/` substring is part of a URL token and must not be treated as a host
    // path.
    const inline = [skillDescriptor('network-diagnostics')];
    const urlBodies = [
      'curl http://localhost/rest/naie/km/v1/vector_stores/chatbi_terminology_knowledge/search',
      'GET http://localhost/rest/udmc/datafederation/v1/noemate/value/query',
      'POST https://example.com/rest/icnchatbiservice/v1/ir/chatmate',
    ];

    for (const body of urlBodies) {
      await expect(
        invokeSkillTool({ name: 'network-diagnostics' }, inline, sourceRegistry(bodyView('network-diagnostics', body))),
      ).resolves.toMatchObject({
        status: 'SUCCEEDED',
      });
    }
  });

  it('rejects a Skill body containing U+FFFD replacement characters before hidden context injection', async () => {
    // Defense-in-depth backstop: a body decoded from non-UTF-8 bytes (e.g. GBK)
    // carries U+FFFD where the model cannot read the original instruction.
    // validateInlineBody MUST reject it rather than inject garbled context.
    const inline = [skillDescriptor('auth-diagnosis')];
    const garbledBodies = ['Use this skill to ��� the network.', '�'];

    for (const body of garbledBodies) {
      await expect(invokeSkillTool({ name: 'auth-diagnosis' }, inline, sourceRegistry(bodyView('auth-diagnosis', body)))).resolves.toMatchObject({
        status: 'FAILED',
        safeError: {
          code: 'EXECUTION_FAILED',
          message:
            'The governed Skill body has an unsupported encoding and cannot be loaded safely. Choose another available Skill or stop and report that this Skill source must be re-encoded as UTF-8.',
        },
      });
    }
  });

  it('rejects unavailable names, path-like names, and Tool/Agent confusion without loading a source', async () => {
    const source = countingSource(bodyView('network-diagnostics', 'body'));
    await expect(
      invokeSkillTool({ name: '../network-diagnostics' }, [skillDescriptor('network-diagnostics')], sourceRegistryWithSource(source)),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'SKILL_NOT_AVAILABLE' },
    });
    await expect(
      invokeSkillTool({ name: 'Read' }, [toolDescriptor('Read'), skillDescriptor('network-diagnostics')], sourceRegistryWithSource(source)),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'SKILL_NOT_AVAILABLE' },
    });
    await expect(
      invokeSkillTool({ name: 'agent-default' }, [skillDescriptor('network-diagnostics')], sourceRegistryWithSource(source)),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'SKILL_NOT_AVAILABLE' },
    });
    expect(source.calls).toBe(0);
  });

  it('requires ToolSearch discovery before loading a non-model-invocable Skill', async () => {
    await expect(
      invokeSkillTool(
        { name: 'network-diagnostics' },
        [skillDescriptor('network-diagnostics', { modelInvocable: false, userInvocable: true })],
        sourceRegistry(bodyView('network-diagnostics', 'body')),
      ),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'SKILL_NOT_DISCOVERED' },
    });

    await expect(
      invokeSkillTool(
        { name: 'network-diagnostics' },
        [skillDescriptor('network-diagnostics', { modelInvocable: false, userInvocable: true })],
        sourceRegistry(bodyView('network-diagnostics', 'body')),
        { discoveredSkills: [brand<string, 'CapabilityId'>('network-diagnostics')] },
      ),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { name: 'network-diagnostics', status: 'loaded' },
    });
  });

  it('requires ToolSearch discovery before loading deferred Skills', async () => {
    const source = countingSource(bodyView('radio-qos', 'Use RAN QoS evidence.'));
    const deferred = { ...skillDescriptor('radio-qos'), disclosurePolicy: { mode: 'DEFERRED' as const, searchHint: 'RAN QoS' } };

    await expect(
      invokeSkillTool({ name: 'radio-qos' }, [deferred], sourceRegistryWithSource(source), { skillSearchEnabled: true }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'SKILL_NOT_DISCOVERED' },
    });
    expect(source.calls).toBe(0);

    await expect(
      invokeSkillTool({ name: 'radio-qos' }, [deferred], sourceRegistryWithSource(source), {
        skillSearchEnabled: true,
        discoveredSkills: [brand<string, 'CapabilityId'>('radio-qos')],
      }),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { name: 'radio-qos', status: 'loaded' },
    });
  });

  it('allows eager disclosure Skills to load directly in Skill ToolSearch mode', async () => {
    await expect(
      invokeSkillTool(
        { name: 'always-load-skill' },
        [{ ...skillDescriptor('always-load-skill'), disclosurePolicy: { mode: 'EAGER' as const } }],
        sourceRegistry(bodyView('always-load-skill', 'body')),
        { skillSearchEnabled: true },
      ),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { name: 'always-load-skill', status: 'loaded' },
    });
  });

  it('allows generated agent-owned local Skills to load immediately without ToolSearch rediscovery', async () => {
    await expect(
      invokeSkillTool(
        { name: 'generated-network-skill' },
        [
          {
            ...skillDescriptor('generated-network-skill'),
            provider: { providerId: 'local-skills-agent-owned', providerKind: 'LOCAL_DIRECTORY' },
            disclosurePolicy: { mode: 'DEFERRED' as const, searchHint: 'Generated local skill' },
          },
        ],
        {
          resolveSkillSource(providerId) {
            return providerId === 'local-skills-agent-owned'
              ? countingSource({
                  ...bodyView('generated-network-skill', 'Generated network skill body.'),
                  providerId: 'local-skills-agent-owned',
                })
              : undefined;
          },
        },
        { skillSearchEnabled: true },
      ),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { name: 'generated-network-skill', status: 'loaded' },
    });
  });

  it('allows runtime-generated local Skills to load immediately without ToolSearch rediscovery', async () => {
    await expect(
      invokeSkillTool(
        { name: 'generated-list-workspace-files' },
        [
          {
            ...skillDescriptor('generated-list-workspace-files'),
            provider: { providerId: 'local-skills-runtime-generated', providerKind: 'LOCAL_DIRECTORY' },
            disclosurePolicy: { mode: 'DEFERRED' as const, searchHint: 'Runtime-generated local skill' },
          },
        ],
        {
          resolveSkillSource(providerId) {
            return providerId === 'local-skills-runtime-generated'
              ? countingSource({
                  ...bodyView('generated-list-workspace-files', 'Runtime generated skill body.'),
                  providerId: 'local-skills-runtime-generated',
                })
              : undefined;
          },
        },
        { skillSearchEnabled: true },
      ),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { name: 'generated-list-workspace-files', status: 'loaded' },
    });
  });

  it('allows runtime-generated local Skills to load directly by their manifest name', async () => {
    await expect(
      invokeSkillTool(
        { name: 'space-view' },
        [
          {
            ...skillDescriptor('space-view'),
            provider: { providerId: 'local-skills-runtime-generated', providerKind: 'LOCAL_DIRECTORY' },
            disclosurePolicy: { mode: 'DEFERRED' as const, searchHint: 'Runtime-generated local skill' },
          },
        ],
        {
          resolveSkillSource(providerId) {
            return providerId === 'local-skills-runtime-generated'
              ? countingSource({
                  ...bodyView('space-view', 'Runtime generated skill body.'),
                  providerId: 'local-skills-runtime-generated',
                })
              : undefined;
          },
        },
        { skillSearchEnabled: true },
      ),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { name: 'space-view', status: 'loaded' },
    });
  });

  it('projects source-owned resource entries into the execution workspace and exposes only logical projection metadata', async () => {
    const resources: SkillResourceProjectionEntry[] = [
      {
        relativePath: 'scripts/rag_query.py',
        kind: 'script',
        contentStream: streamText("print('ok')\n"),
        sizeBytes: 12,
        contentHash: 'sha256-resource',
      },
    ];
    const source = countingSource(bodyView('network-diagnostics', 'body'), resources);
    const projections: SkillResourceProjectionInput[] = [];
    const result = await invokeSkillTool(
      { name: 'network-diagnostics' },
      [skillDescriptor('network-diagnostics')],
      sourceRegistryWithSource(source),
      { workspaceFiles: fakeWorkspaceFiles(projections, { projectedCount: 1 }) },
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(source.lists).toBe(0);
    expect(source.reads).toBe(0);
    expect(projections).toHaveLength(1);
    expect(projections[0]).toMatchObject({
      providerId: 'builtin-skills',
      skillName: 'network-diagnostics',
      skillVersion: 'unversioned',
    });
    expect(projections[0]?.listResources).toEqual(expect.any(Function));
    expect(projections[0]?.readResource).toEqual(expect.any(Function));
    const listed = await projections[0]!.listResources!();
    expect(listed.map((resource) => resource.relativePath)).toEqual(['scripts/rag_query.py']);
    const scriptMetadata = listed[0];
    expect(scriptMetadata).toBeDefined();
    if (scriptMetadata === undefined) {
      throw new Error('Expected projected script metadata.');
    }
    const readResource = projections[0]?.readResource;
    expect(readResource).toBeDefined();
    if (readResource === undefined) {
      throw new Error('Expected projected resource reader.');
    }
    const script = await readResource(scriptMetadata);
    expect(script).toBeDefined();
    if (script === undefined) {
      throw new Error('Expected projected script content.');
    }
    await expect(projectionEntryText(script)).resolves.toBe("print('ok')\n");
    expect(result.metadata).toMatchObject({
      agenticSkillLoaded: true,
      skillName: 'network-diagnostics',
      providerId: 'builtin-skills',
    });
    expect(result.structuredPayload).toMatchObject({ name: 'network-diagnostics', status: 'loaded' });
    expect(result.generatedMessages).toEqual([]);
    expect(result.structuredPayload.body).toEqual(expect.any(String));
    const projectedSkillBody = String(result.structuredPayload.body);
    expect(projectedSkillBody).toContain('Skill resource root: .nextagent/skills/projection-test/network-diagnostics/');
    expect(projectedSkillBody).toContain('The Skill body below is already loaded.');
    expect(projectedSkillBody).toContain('Only access auxiliary files explicitly referenced by it.');
    expect(projectedSkillBody).toContain('Do not enumerate the Skill directory or read SKILL.md.');
    expect(projectedSkillBody).toContain('system-managed read-only projection');
    expect(projectedSkillBody).toContain('Do not use Edit or Write on `.nextagent/skills/...` files');
    expect(projectedSkillBody).toContain('provide a patch/diff');
    expect(projectedSkillBody).toContain('copy the script and required dependency files into `workspace/`');
    expect(projectedSkillBody).toContain('preserving their relative layout');
    expect(projectedSkillBody).not.toContain('Glob hint: to enumerate Skill files');
    expect(projectedSkillBody).not.toContain('Sandbox resource root:');
    expect(JSON.stringify(result)).not.toContain('/opt/skills');
  });

  it('safe-fails resource projection when list metadata and read content no longer match', async () => {
    const resource: SkillResourceProjectionEntry = {
      relativePath: 'references/guide.md',
      kind: 'reference',
      contentStream: streamText('changed'),
      sizeBytes: 7,
      contentHash: 'sha256-changed',
    };
    const listed: SkillResourceMetadata = { ...resource, sizeBytes: 8, contentHash: 'sha256-listed' };
    const projections: SkillResourceProjectionInput[] = [];

    const result = await invokeSkillTool(
      { name: 'network-diagnostics' },
      [skillDescriptor('network-diagnostics')],
      sourceRegistryWithSource(countingSource(bodyView('network-diagnostics', 'body'), [resource], [listed])),
      { workspaceFiles: fakeWorkspaceFiles(projections, { readResources: true }) },
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'SCOPE_MISMATCH' },
    });
    expect(result.generatedMessages).toEqual([]);
    expect(projections).toEqual([]);
  });

  it('keeps the Skill document internal and does not disclose a resource root when no auxiliary resources exist', async () => {
    const projections: SkillResourceProjectionInput[] = [];
    const result = await invokeSkillTool(
      { name: 'network-diagnostics' },
      [skillDescriptor('network-diagnostics')],
      sourceRegistry(bodyView('network-diagnostics', 'body')),
      { workspaceFiles: fakeWorkspaceFiles(projections, { readResources: true, projectedCount: 0 }) },
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(result.metadata).toMatchObject({
      agenticSkillLoaded: true,
      skillName: 'network-diagnostics',
      providerId: 'builtin-skills',
    });
    const listed = await projections[0]!.listResources!();
    expect(listed).toEqual([]);
    expect(result.structuredPayload).toMatchObject({ name: 'network-diagnostics', status: 'loaded' });
    expect(result.generatedMessages).toEqual([]);
    expect(String(result.structuredPayload.body)).toContain('<skill_content name="network-diagnostics">\nbody\n</skill_content>');
    expect(String(result.structuredPayload.body)).not.toContain('Skill resource root:');
    expect(String(result.structuredPayload.body)).not.toContain('Glob hint:');
    expect(String(result.structuredPayload.body)).not.toContain('SKILL.md');
  });

  it('resolves the target through runtime resolver instead of model-visible capabilities', async () => {
    const calls: RuntimeCapabilityResolveRequest[] = [];
    const result = await invokeSkillTool(
      { name: 'hidden-telecom-skill' },
      [skillDescriptor('hidden-telecom-skill', { modelInvocable: false })],
      sourceRegistry(bodyView('hidden-telecom-skill', 'body')),
      {
        resolverCalls: calls,
        discoveredSkills: [brand<string, 'CapabilityId'>('hidden-telecom-skill')],
      },
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(calls).toEqual([{ kind: 'SKILL', capabilityId: 'hidden-telecom-skill' }]);
  });

  it('does not pass runtime owner or Agent scope into canonical body loading', async () => {
    const loadedInputs: unknown[] = [];
    const source: SkillSourceDiscovery = {
      async loadCanonicalBodyView(input) {
        loadedInputs.push(input);
        return bodyView('network-diagnostics', 'body');
      },
    };

    await expect(
      invokeSkillTool({ name: 'network-diagnostics' }, [skillDescriptor('network-diagnostics')], sourceRegistryWithSource(source)),
    ).resolves.toMatchObject({ status: 'SUCCEEDED' });

    expect(loadedInputs).toEqual([
      {
        skillName: 'network-diagnostics',
        skillVersion: 'unversioned',
        capabilityId: 'network-diagnostics',
        sourceIdentity: 'builtin-skills:network-diagnostics',
        frontmatterHash: 'network-diagnostics-frontmatter',
      },
    ]);
    expect(JSON.stringify(loadedInputs)).not.toContain('agentAssemblyRef');
    expect(JSON.stringify(loadedInputs)).not.toContain('tenant-skill');
    expect(JSON.stringify(loadedInputs)).not.toContain('subject-skill');
  });

  it('safe-fails when the runtime resolver is not provided', async () => {
    await expect(
      invokeSkillTool({ name: 'network-diagnostics' }, [], sourceRegistry(bodyView('network-diagnostics', 'body')), { omitResolver: true }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'SKILL_NOT_AVAILABLE' },
    });
  });

  it('validates args as bounded JSON task data without field-name restrictions', async () => {
    const visible = [skillDescriptor('network-diagnostics')];
    const registry = sourceRegistry(bodyView('network-diagnostics', 'body'));
    await expect(invokeSkillTool({ name: 'network-diagnostics', args: [] as unknown as JsonObject }, visible, registry)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID' },
    });
    const allowedBusinessArgs = {
      mode: 'current',
      path: 'A-B-C protection route',
      directory: 'north-region',
      provider: 'Huawei',
      providerId: 'cmcc-access',
      timeout: 'business-window',
      budget: 'annual-capex',
      timeoutMs: 'alarm-correlation-window',
      timeout_ms: 'legacy-alarm-window',
      childBudget: 'regional-child-budget',
      child_budget: 'legacy-regional-budget',
      providerOverride: 'business-provider-preference',
      nested: {
        mode: 'historical',
        path: 'D-E-F restoration route',
        directory: 'south-region',
        provider: 'ZTE',
        providerId: 'cucc-access',
        timeout: 'maintenance-window',
        budget: 'quarterly-opex',
        timeoutMs: 'nested-alarm-window',
        timeout_ms: 'nested-legacy-window',
        childBudget: 'nested-child-budget',
        child_budget: 'nested-legacy-budget',
        providerOverride: 'nested-business-provider-preference',
      },
    };
    await expect(invokeSkillTool({ name: 'network-diagnostics', args: allowedBusinessArgs }, visible, registry)).resolves.toMatchObject({
      status: 'SUCCEEDED',
    });
    await expect(invokeSkillTool({ name: 'network-diagnostics', args: nested(9) }, visible, registry)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'INVALID_INPUT',
        message: 'Skill validation failed before loading: args nesting must not exceed 8 levels. Flatten the args and call again.',
      },
    });
    await expect(invokeSkillTool({ name: 'network-diagnostics', args: { value: 'x'.repeat(9000) } }, visible, registry)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'INVALID_INPUT',
        message: 'Skill validation failed before loading: args must not exceed 8192 UTF-8 bytes. Reduce the args and call again.',
      },
    });
  });

  it('allows domain-level context key in args without treating it as governance', async () => {
    const visible = [skillDescriptor('network-diagnostics')];
    const registry = sourceRegistry(bodyView('network-diagnostics', 'Use network diagnostic evidence only.'));
    const result = await invokeSkillTool(
      { name: 'network-diagnostics', args: { context: '用户在办公区走动时手机没有信号', user_name: 'admin', location: '西安华为研究所' } },
      visible,
      registry,
    );
    expect(result.status).toBe('SUCCEEDED');
  });

  it('matches the loaded Skill body by provider, capability id, and skill version even when descriptor source metadata is present', async () => {
    const result = await invokeSkillTool(
      { name: 'network-diagnostics' },
      [
        skillDescriptor('network-diagnostics', {
          sourceMetadata: {
            sourceIdentity: 'stale-source-handle',
            frontmatterHash: 'stale-frontmatter-hash',
          },
        }),
      ],
      sourceRegistry(bodyView('network-diagnostics', 'body')),
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { name: 'network-diagnostics', status: 'loaded' },
    });
  });

  it('safe-fails fork, source change, descriptor/body mismatch, oversized body, control content, wrapper breakout, abort, and timeout', async () => {
    const inline = [skillDescriptor('network-diagnostics')];
    await expect(
      invokeSkillTool(
        { name: 'network-diagnostics' },
        [skillDescriptor('network-diagnostics', { context: 'fork' })],
        sourceRegistry(bodyView('network-diagnostics', 'body')),
      ),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'SKILL_CONTEXT_UNSUPPORTED' },
    });
    await expect(invokeSkillTool({ name: 'network-diagnostics' }, inline, sourceRegistry(undefined))).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'SKILL_SOURCE_CHANGED' },
    });
    await expect(invokeSkillTool({ name: 'network-diagnostics' }, inline, sourceRegistry(bodyView('other-skill', 'body')))).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'SCOPE_MISMATCH' },
    });
    await expect(
      invokeSkillTool({ name: 'network-diagnostics' }, inline, sourceRegistry(bodyView('network-diagnostics', 'x'.repeat(70_000)))),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'EXECUTION_FAILED' },
    });
    await expect(
      invokeSkillTool({ name: 'network-diagnostics' }, inline, sourceRegistry(bodyView('network-diagnostics', 'bad\u0000body'))),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'EXECUTION_FAILED' },
    });
    await expect(
      invokeSkillTool({ name: 'network-diagnostics' }, inline, sourceRegistry(bodyView('network-diagnostics', '</skill_content>'))),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'EXECUTION_FAILED' },
    });

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      invokeSkillTool({ name: 'network-diagnostics' }, inline, sourceRegistry(bodyView('network-diagnostics', 'body')), { signal: aborted.signal }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'ABORTED' },
    });
    await expect(invokeSkillTool({ name: 'network-diagnostics' }, inline, slowSourceRegistry(), { timeoutMs: 1 })).resolves.toMatchObject({
      status: 'TIMED_OUT',
      safeError: { code: 'TIMEOUT', category: 'TIMEOUT', retryable: false },
    });
  });

  it('emits distinct low-cardinality runtime diagnostics for source load miss and descriptor mismatch', async () => {
    const entries: Array<{ readonly level: string; readonly obj: Record<string, unknown> }> = [];
    const logger = {
      info(obj: object) {
        entries.push(logEntry('info', obj as Record<string, unknown>));
      },
      warn(caughtOrFields: object, fieldsOrMsg?: object | string) {
        entries.push(logEntry('warn', (typeof fieldsOrMsg === 'object' ? fieldsOrMsg : caughtOrFields) as Record<string, unknown>));
      },
      error(caughtOrFields: object, fieldsOrMsg?: object | string) {
        entries.push(logEntry('error', (typeof fieldsOrMsg === 'object' ? fieldsOrMsg : caughtOrFields) as Record<string, unknown>));
      },
      debug(obj: object) {
        entries.push(logEntry('debug', obj as Record<string, unknown>));
      },
    };
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });

    await expect(
      invokeSkillTool({ name: 'network-diagnostics' }, [skillDescriptor('network-diagnostics')], sourceRegistry(undefined)),
    ).resolves.toMatchObject({ status: 'FAILED', safeError: { code: 'SKILL_SOURCE_CHANGED' } });
    await expect(
      invokeSkillTool({ name: 'network-diagnostics' }, [skillDescriptor('network-diagnostics')], sourceRegistry(bodyView('other-skill', 'body'))),
    ).resolves.toMatchObject({ status: 'FAILED', safeError: { code: 'SCOPE_MISMATCH' } });

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          obj: expect.objectContaining({
            event: 'skill.tool.source_load_miss',
            safeReasonCode: 'SKILL_SOURCE_CHANGED',
            requestedSkillName: 'network-diagnostics',
            targetSkillId: 'network-diagnostics',
            providerId: 'builtin-skills',
            skillVersion: 'unversioned',
            sourceHandleMode: 'fallback',
            hasGovernedSourceIdentity: false,
            hasGovernedFrontmatterHash: false,
          }),
        }),
        expect.objectContaining({
          level: 'warn',
          obj: expect.objectContaining({
            event: 'skill.tool.descriptor_mismatch',
            safeReasonCode: 'SCOPE_MISMATCH',
            requestedSkillName: 'network-diagnostics',
            targetSkillId: 'network-diagnostics',
            providerId: 'builtin-skills',
            skillVersion: 'unversioned',
            sourceHandleMode: 'fallback',
            hasGovernedSourceIdentity: false,
            hasGovernedFrontmatterHash: false,
          }),
        }),
      ]),
    );
  });

  it('logs low-cardinality diagnostics when Skill resource projection fails', async () => {
    const entries: Array<{ readonly level: string; readonly obj: Record<string, unknown> }> = [];
    const logger = {
      info(obj: object) {
        entries.push(logEntry('info', obj as Record<string, unknown>));
      },
      warn(caughtOrFields: object, fieldsOrMsg?: object | string) {
        entries.push(logEntry('warn', (typeof fieldsOrMsg === 'object' ? fieldsOrMsg : caughtOrFields) as Record<string, unknown>));
      },
      error(caughtOrFields: object, fieldsOrMsg?: object | string) {
        entries.push(logEntry('error', (typeof fieldsOrMsg === 'object' ? fieldsOrMsg : caughtOrFields) as Record<string, unknown>));
      },
      debug(obj: object) {
        entries.push(logEntry('debug', obj as Record<string, unknown>));
      },
    };
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
    const permissionError = Object.assign(new Error('EACCES: permission denied, mkdir C:\\secret\\skill'), { code: 'EACCES' });

    await expect(
      invokeSkillTool(
        { name: 'network-diagnostics', args: { task: 'query alarm' } },
        [skillDescriptor('network-diagnostics')],
        sourceRegistry(bodyView('network-diagnostics', 'body')),
        { workspaceFiles: fakeWorkspaceFiles([], { projectionError: permissionError }) },
      ),
    ).resolves.toMatchObject({ status: 'FAILED', safeError: { code: 'EXECUTION_FAILED' } });

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          obj: expect.objectContaining({
            event: 'skill.tool.resource_projection_failed',
            safeReasonCode: 'EXECUTION_FAILED',
            targetSkillId: 'network-diagnostics',
            providerId: 'builtin-skills',
            skillVersion: 'unversioned',
            sourceHandleMode: 'fallback',
            hasListResources: true,
            hasReadResource: true,
            exceptionName: 'Error',
            nodeErrorCode: 'EACCES',
            failureKind: 'PERMISSION_DENIED',
          }),
        }),
      ]),
    );
    expect(JSON.stringify(entries)).not.toContain('C:\\secret\\skill');
  });

  it('returns retryable unavailable when Skill resource projection is locked', async () => {
    const projectionLocked = {
      code: 'CAPABILITY_PATH_REJECTED',
      message: 'Skill resource projection is locked.',
      category: 'CONFLICT',
      retryable: false,
    };

    await expect(
      invokeSkillTool(
        { name: 'network-diagnostics', args: { task: 'query alarm' } },
        [skillDescriptor('network-diagnostics')],
        sourceRegistry(bodyView('network-diagnostics', 'body')),
        { workspaceFiles: fakeWorkspaceFiles([], { projectionError: projectionLocked }) },
      ),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CAPABILITY_PATH_REJECTED',
        category: 'UNAVAILABLE',
        retryable: true,
      },
    });
  });

  it('logs only allowlisted Skill projection diagnostic details', async () => {
    const entries: Array<{ readonly level: string; readonly obj: Record<string, unknown> }> = [];
    const logger = {
      info(obj: object) {
        entries.push(logEntry('info', obj as Record<string, unknown>));
      },
      warn(caughtOrFields: object, fieldsOrMsg?: object | string) {
        entries.push(logEntry('warn', (typeof fieldsOrMsg === 'object' ? fieldsOrMsg : caughtOrFields) as Record<string, unknown>));
      },
      error(caughtOrFields: object, fieldsOrMsg?: object | string) {
        entries.push(logEntry('error', (typeof fieldsOrMsg === 'object' ? fieldsOrMsg : caughtOrFields) as Record<string, unknown>));
      },
      debug(obj: object) {
        entries.push(logEntry('debug', obj as Record<string, unknown>));
      },
    };
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
    const projectionError = {
      code: 'RESOURCE_TOO_LARGE',
      message: 'Skill resource projection exceeds the file count limit.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        failureStage: 'LIST_RESOURCES',
        failureReasonCode: 'SKILL_PROJECTION_RESOURCE_COUNT_LIMIT',
        resourceCount: 201,
        maxResourceCount: 200,
        unsafePath: 'C:\\secret\\skill',
        rawMessage: 'must not log',
      },
    };

    await invokeSkillTool(
      { name: 'network-diagnostics', args: { task: 'query alarm' } },
      [skillDescriptor('network-diagnostics')],
      sourceRegistry(bodyView('network-diagnostics', 'body')),
      { workspaceFiles: fakeWorkspaceFiles([], { projectionError }) },
    );

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          obj: expect.objectContaining({
            event: 'skill.tool.resource_projection_failed',
            failureStage: 'LIST_RESOURCES',
            failureReasonCode: 'SKILL_PROJECTION_RESOURCE_COUNT_LIMIT',
            resourceCount: 201,
            maxResourceCount: 200,
          }),
        }),
      ]),
    );
    expect(JSON.stringify(entries)).not.toContain('C:\\secret\\skill');
    expect(JSON.stringify(entries)).not.toContain('must not log');
  });
});

function logEntry(level: string, obj: Record<string, unknown>): { readonly level: string; readonly obj: Record<string, unknown> } {
  return { level, obj };
}

async function invokeSkillTool(
  args: JsonObject,
  resolvableCapabilities: readonly CapabilityDescriptor[],
  skillSources: SkillSourceRegistry,
  options: SkillInvokeOptions = {},
) {
  const catalog = createToolCatalog({
    provider: toolProvider,
    tools: [skillToolDefinition],
    dependencies: { skillSources, workspaceFiles: options.workspaceFiles ?? fakeWorkspaceFiles() },
  });
  const invocationPort = new GovernedCapabilityInvocationPort(
    {
      async resolveForInvocation(capabilityId, signal) {
        return (await catalog.listAll(signal)).find((descriptor) => descriptor.capabilityId === capabilityId);
      },
    },
    createStaticCapabilityExecutorFactory([{ provider: catalog.provider, executor: new BuiltinToolsExecutor(catalog) }]),
  );
  return invocationPort.invoke(
    request(args, options.timeoutMs),
    options.signal ?? new AbortController().signal,
    options.omitResolver === true ? undefined : runtimeContext(resolvableCapabilities, options.resolverCalls, options),
  );
}

function request(args: JsonObject, timeoutMs = 30_000): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-skill',
    capabilityId: brand<string, 'CapabilityId'>('Skill'),
    arguments: args,
    sessionId: brand<string, 'SessionId'>('session-skill'),
    requestId: brand<string, 'MessageId'>('request-skill'),
    runId: brand<string, 'RequestRunId'>('run-skill'),
    requestContextId: brand<string, 'RequestContextId'>('context-skill'),
    stepId: 'turn-1',
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-skill'),
      subjectId: brand<string, 'SubjectId'>('subject-skill'),
      displayName: 'Skill tester',
    },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-skill'),
  };
}

function runtimeContext(
  capabilities: readonly CapabilityDescriptor[],
  calls: RuntimeCapabilityResolveRequest[] = [],
  options: Pick<SkillInvokeOptions, 'skillSearchEnabled' | 'discoveredSkills'> = {},
): CapabilityInvocationRuntimeContext {
  const capabilityResolver: RuntimeCapabilityResolver = {
    async resolveCapability(request) {
      calls.push(request);
      return capabilities.find(
        (capability) =>
          capability.kind === request.kind &&
          capability.capabilityId === request.capabilityId &&
          capability.availabilityStatus === 'AVAILABLE' &&
          (request.providerId === undefined || capability.provider.providerId === request.providerId),
      );
    },
  };
  return {
    capabilityResolver,
    ...(options.skillSearchEnabled === true ? { toolSearchSkillSearchEnabled: true } : {}),
    ...(options.discoveredSkills === undefined ? {} : { discoveredSkills: options.discoveredSkills }),
  };
}

function skillDescriptor(name: string, overrides: Partial<SkillMetadata> = {}): CapabilityDescriptor {
  const metadata: SkillMetadata = {
    metadataKind: 'nextagent.skill',
    context: 'inline',
    userInvocable: false,
    modelInvocable: true,
    model: 'gpt-4.1',
    modelOptions: { thinking: { depth: 'LOW' }, toolChoice: 'NONE' },
    allowedTools: ['Read'],
    deniedTools: ['shell'],
    ...overrides,
  };
  return {
    capabilityId: brand<string, 'CapabilityId'>(name),
    kind: 'SKILL',
    provider: skillProvider,
    displayName: name,
    description: 'Safe network Skill.',
    modelInvocable: metadata.modelInvocable,
    availabilityStatus: 'AVAILABLE',
    metadata,
  };
}

function toolDescriptor(name: string): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(name),
    kind: 'TOOL',
    provider: toolProvider,
    displayName: name,
    description: 'Tool descriptor.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  };
}

function bodyView(name: string, body: string) {
  return {
    providerId: 'builtin-skills',
    capabilityId: brand<string, 'CapabilityId'>(name),
    skillVersion: 'unversioned',
    body,
    documentSource: [
      '---',
      `name: ${name}`,
      'description: Test Skill fixture.',
      'context: inline',
      'user-invocable: true',
      'model-invocable: true',
      '---',
      '',
      body,
    ].join('\n'),
  };
}

function sourceRegistry(view: Awaited<ReturnType<SkillSourceDiscovery['loadCanonicalBodyView']>>): SkillSourceRegistry {
  return sourceRegistryWithSource(countingSource(view));
}

function countingSource(
  view: Awaited<ReturnType<SkillSourceDiscovery['loadCanonicalBodyView']>>,
  resources: readonly SkillResourceProjectionEntry[] = [],
  listedResources: readonly SkillResourceMetadata[] = resources.map(({ contentStream: _contentStream, ...metadata }) => metadata),
) {
  const source = {
    calls: 0,
    lists: 0,
    reads: 0,
    async loadCanonicalBodyView() {
      source.calls += 1;
      return view;
    },
    async listSkillResources() {
      source.lists += 1;
      return listedResources;
    },
    async readSkillResource(input: { readonly resource: SkillResourceMetadata }) {
      source.reads += 1;
      return resources.find((resource) => resource.relativePath === input.resource.relativePath);
    },
  };
  return source;
}

async function* streamText(text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text);
}

async function projectionEntryText(entry: SkillResourceProjectionEntry): Promise<string> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = '';
  for await (const chunk of entry.contentStream) {
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

function sourceRegistryWithSource(source: SkillSourceDiscovery & { calls?: number }): SkillSourceRegistry {
  return {
    resolveSkillSource(providerId) {
      return providerId === 'builtin-skills' ? source : undefined;
    },
  };
}

function slowSourceRegistry(): SkillSourceRegistry {
  return {
    resolveSkillSource() {
      return {
        async loadCanonicalBodyView() {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return bodyView('network-diagnostics', 'body');
        },
      };
    },
  };
}

function nested(depth: number): JsonObject {
  let value: JsonObject = {};
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }
  return value;
}

function fakeWorkspaceFiles(
  projections: SkillResourceProjectionInput[] = [],
  options: { readonly readResources?: boolean; readonly projectedCount?: number; readonly projectionError?: unknown } = {},
): WorkspaceFilePort {
  return {
    async readText() {
      return {};
    },
    async writeText() {
      return {};
    },
    async editText() {
      return {};
    },
    async globFiles() {
      return { filenames: [], truncated: false };
    },
    async grepFiles() {
      return {
        output_mode: 'files_with_matches',
        filenames: [],
        matches: [],
        total_files_with_matches: 0,
        total_matches: 0,
        truncated: false,
      };
    },
    async projectSkillResources(input) {
      if (options.projectionError !== undefined) {
        throw options.projectionError;
      }
      if (options.readResources === true) {
        const resources = (await input.listResources?.()) ?? [];
        for (const resource of resources) {
          const loaded = await input.readResource?.(resource);
          if (loaded === undefined) {
            throw Object.assign(new Error('Skill resource is outside the allowed scope.'), {
              code: 'SCOPE_MISMATCH',
              category: 'AUTHORIZATION',
            });
          }
        }
      }
      projections.push(input);
      return {
        skillProjectionKey: 'projection-test',
        rootRelativePath: `.nextagent/skills/projection-test/${input.skillName}/`,
        projectedCount: options.projectedCount ?? 0,
      };
    },
    async sandboxFilesystem() {
      return { defaultCwd: '/work', roots: [] };
    },
    async resolveView() {
      return { workspaceDir: 'workspace/', defaultCwd: '/work', roots: [] };
    },
    clearRun() {
      // no state in this test fake
    },
  };
}
