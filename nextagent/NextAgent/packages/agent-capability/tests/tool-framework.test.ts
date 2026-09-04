import {
  BuiltinToolsExecutor,
  GovernedCapabilityInvocationPort,
  StaticCapabilityCatalog,
  createStaticCapabilityExecutorFactory,
  createBuiltinToolDefinitions,
  defineTool,
  createToolCatalog,
  readCapabilityId,
  readToolDefinition,
  type ToolDependencies,
} from '@nextagent/agent-capability';
import { bindRuntimeLoggerProvider, brand, type JsonObject, type RuntimeLogger } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityInvocationRequest, CapabilityInvocationResult, CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';
import { describe, expect, it, vi } from 'vitest';

const provider: CapabilityProviderIdentity = { providerId: 'builtin-tools', providerKind: 'BUNDLED' };
const inputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['value'],
  properties: { value: { type: 'string' } },
};
const outputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['value'],
  properties: { value: { type: 'string' } },
};

describe('defineTool authoring helper', () => {
  it('returns explicit definitions without config or dependency ceremony', () => {
    const definition = echoTool('echo');

    expect(definition.metadata).toMatchObject({ name: 'echo', inputSchema, outputSchema });
    expect(definition.metadata).not.toHaveProperty('configSchema');
    expect(definition.metadata).not.toHaveProperty('requiredDependencies');
  });

  it('preserves config schema, configure, and required dependencies without implicit registration', async () => {
    const configured = defineTool({
      name: brand<string, 'CapabilityId'>('configured'),
      description: 'Configured test Tool.',
      inputSchema,
      outputSchema,
      configSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['prefix'],
        properties: { prefix: { type: 'string' } },
      },
      requiredDependencies: ['workspaceFiles'],
      configure(config) {
        return {
          async execute(input) {
            return { value: `${config.prefix}${input.value}` };
          },
        };
      },
      async execute(input: JsonObject) {
        return input;
      },
    });

    const emptyCatalog = createToolCatalog({ provider, tools: [], dependencies: workspaceDeps() });
    expect(await emptyCatalog.listAll(new AbortController().signal)).toEqual([]);
    const catalog = createToolCatalog({
      provider,
      tools: [configured],
      config: { tools: { configured: { config: { prefix: 'ok-' } } } },
      dependencies: workspaceDeps(),
    });
    const [descriptor] = await catalog.listAll(new AbortController().signal);
    expect(descriptor).toMatchObject({ capabilityId: 'configured', availabilityStatus: 'AVAILABLE' });
    await expect(catalog.resolveExecutable(brand<string, 'CapabilityId'>('configured'))?.tool.execute({ value: 'value' })).resolves.toEqual({
      value: 'ok-value',
    });
  });

  it('projects optional stable and localized Tool names without changing the canonical name', async () => {
    const locales = {
      language: {
        'zh-CN': { displayName: '查询网元状态' },
        'en-US': { displayName: 'Query network element status' },
      },
    };
    const tool = defineTool({
      name: brand<string, 'CapabilityId'>('network-status'),
      displayName: 'Network status',
      locales,
      description: 'Reads network element status.',
      inputSchema,
      outputSchema,
      async execute(input: JsonObject) {
        return input;
      },
    } as never);

    expect(tool.metadata).toMatchObject({ name: 'network-status', displayName: 'Network status', locales });
    await expect(createToolCatalog({ provider, tools: [tool] }).listAll(new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'network-status', displayName: 'Network status', locales }),
    ]);
  });

  it('preserves trusted disclosure policy metadata on projected descriptors', async () => {
    const eager = defineTool({
      name: brand<string, 'CapabilityId'>('eager-tool'),
      description: 'Eager test Tool.',
      inputSchema,
      outputSchema,
      disclosurePolicy: { mode: 'EAGER' },
      async execute(input) {
        return input;
      },
    });

    const [descriptor] = await createToolCatalog({ provider, tools: [eager] }).listAll(new AbortController().signal);

    expect(eager.metadata.disclosurePolicy).toEqual({ mode: 'EAGER' });
    expect(descriptor).toMatchObject({ capabilityId: 'eager-tool', disclosurePolicy: { mode: 'EAGER' } });
  });
});

describe('ToolCatalog discovery and executable lookup', () => {
  it('provides stable zh-CN and en-US presentation names for user-visible builtin tools', () => {
    const expected = {
      Read: ['Read file', '读取文件'],
      Write: ['Save file', '保存文件'],
      Edit: ['Update file', '更新文件'],
      Glob: ['Find files', '查找文件'],
      Grep: ['Search file contents', '搜索文件内容'],
      Bash: ['Run command', '执行命令'],
      Python: ['Run program', '执行程序'],
      Rag: ['Search knowledge', '检索知识'],
      ToolSearch: ['Find available capabilities', '查找可用能力'],
      TodoWrite: ['Update task plan', '更新任务计划'],
      Cron: ['Manage scheduled tasks', '管理定时任务'],
    } as const;

    const definitions = new Map<string, ReturnType<typeof createBuiltinToolDefinitions>[number]['metadata']>(
      createBuiltinToolDefinitions().map((definition) => [definition.metadata.name, definition.metadata]),
    );
    for (const [capabilityId, [english, chinese]] of Object.entries(expected)) {
      expect(definitions.get(capabilityId)).toMatchObject({
        name: capabilityId,
        displayName: english,
        locales: { language: { 'zh-CN': { displayName: chinese }, 'en-US': { displayName: english } } },
      });
    }
  });

  it('projects descriptors through CapabilityDiscovery and applies safe description override', async () => {
    const catalog = createToolCatalog({
      provider,
      tools: [echoTool('echo')],
      config: { tools: { echo: { safeDescriptionOverride: 'Trusted override.' } } },
    });

    const descriptors = await catalog.listAll(new AbortController().signal);
    expect(descriptors).toEqual([
      expect.objectContaining({
        capabilityId: 'echo',
        kind: 'TOOL',
        provider,
        description: 'Trusted override.',
        inputSchema,
        outputSchema,
        availabilityStatus: 'AVAILABLE',
      }),
    ]);
  });

  it('fails deterministically for unknown configured tools and duplicate names', () => {
    expect(() => createToolCatalog({ provider, tools: [echoTool('echo')], config: { tools: { missing: {} } } })).toThrow(
      'Unknown builtin Tool configuration',
    );
    expect(() => createToolCatalog({ provider, tools: [echoTool('echo'), echoTool('echo')] })).toThrow('Duplicate Tool name');
  });

  it('applies the planning tool calling mode as a TodoWrite or Task-series mutual exclusion', async () => {
    const tools = [echoTool('Read'), echoTool('TodoWrite'), echoTool('TaskCreate')];

    const todoMode = await createToolCatalog({
      provider,
      tools,
      config: { planningToolCallingMode: 'todo-write' },
    }).listAll(new AbortController().signal);
    const taskMode = await createToolCatalog({
      provider,
      tools,
      config: { planningToolCallingMode: 'task-tools' },
    }).listAll(new AbortController().signal);

    expect(todoMode.map((descriptor) => descriptor.capabilityId)).toEqual(['Read', 'TodoWrite']);
    expect(taskMode.map((descriptor) => descriptor.capabilityId)).toEqual(['Read', 'TaskCreate']);
  });

  it('exposes unavailable descriptors for invalid config and missing dependencies', async () => {
    const configured = defineTool({
      name: brand<string, 'CapabilityId'>('configured'),
      description: 'Configured test Tool.',
      inputSchema,
      outputSchema,
      configSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['prefix'],
        properties: { prefix: { type: 'string' } },
      },
      async execute(input) {
        return input;
      },
    });
    const needsSandbox = defineTool({
      name: brand<string, 'CapabilityId'>('needs-sandbox'),
      description: 'Sandbox test Tool.',
      inputSchema,
      outputSchema,
      requiredDependencies: ['sandbox'],
      async execute(input) {
        return input;
      },
    });
    const catalog = createToolCatalog({
      provider,
      tools: [configured, needsSandbox],
      config: { tools: { configured: { config: { other: 'no' } } } },
      dependencies: {},
    });

    await expect(catalog.listAll(new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'configured', availabilityStatus: 'UNAVAILABLE', availabilityReason: 'TOOL_CONFIG_INVALID' }),
      expect.objectContaining({ capabilityId: 'needs-sandbox', availabilityStatus: 'UNAVAILABLE', availabilityReason: 'TOOL_DEPENDENCY_MISSING' }),
    ]);
    expect(catalog.resolveExecutable(brand<string, 'CapabilityId'>('configured'))).toBeUndefined();
  });

  it('keeps executable lookup provider-bound internally and leaves unresolved conflicts to capability catalog', async () => {
    const providerA = { providerId: 'provider-a', providerKind: 'BUNDLED' as const };
    const providerB = { providerId: 'provider-b', providerKind: 'BUNDLED' as const };
    const catalogA = createToolCatalog({ provider: providerA, tools: [echoTool('same', 'a')] });
    const catalogB = createToolCatalog({ provider: providerB, tools: [echoTool('same', 'b')] });
    const descriptorA = (await catalogA.listAll(new AbortController().signal))[0]!;
    const descriptorB = (await catalogB.listAll(new AbortController().signal))[0]!;
    const governed = new StaticCapabilityCatalog([descriptorA, descriptorB]);

    await expect(catalogA.resolveExecutable(brand<string, 'CapabilityId'>('same'))?.tool.execute({ value: 'input' })).resolves.toEqual({
      value: 'ainput',
    });
    await expect(catalogB.resolveExecutable(brand<string, 'CapabilityId'>('same'))?.tool.execute({ value: 'input' })).resolves.toEqual({
      value: 'binput',
    });
    expect(
      await governed.listAvailable({
        tenantId: tenantId(),
        subjectId: subjectId(),
        agentAssembly: assembly('same', ['provider-a', 'provider-b']),
        includeUnavailable: false,
      }),
    ).toEqual([]);
    await expect(
      governed.resolve({
        tenantId: tenantId(),
        subjectId: subjectId(),
        agentAssembly: assembly('same', ['provider-a', 'provider-b']),
        capabilityId: brand<string, 'CapabilityId'>('same'),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('BuiltinToolExecutor', () => {
  it('executes provider-free requests, validates output, and wraps success payloads', async () => {
    const catalog = createToolCatalog({ provider, tools: [echoTool('echo')] });
    const [descriptor] = await catalog.listAll(new AbortController().signal);
    const executor = new BuiltinToolsExecutor(catalog);

    await expect(executor.invoke(descriptor!, request({ value: 'ok' }, 'echo'), new AbortController().signal)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { value: 'ok' },
    });
  });

  it('returns all safe schema violations before dispatching a Builtin Tool', async () => {
    const execute = vi.fn(async () => ({ value: 'ok' }));
    const definition = defineTool({
      name: brand<string, 'CapabilityId'>('diagnostic-tool'),
      description: 'Diagnostic test Tool.',
      inputSchema: diagnosticInputSchema(),
      outputSchema,
      execute,
    });
    const catalog = createToolCatalog({ provider, tools: [definition] });
    const secretCanary = 'SECRET_TOKEN_VALUE_SHOULD_NOT_LEAK';
    const result = await governedBuiltinPort(catalog).invoke(
      request({ config: { limit: 0, tags: '["encoded"]', [secretCanary]: true } }, 'diagnostic-tool'),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CAPABILITY_INPUT_INVALID',
        category: 'VALIDATION',
        retryable: false,
        message: 'Input validation failed for 3 constraints. Correct every listed field before calling the capability again.',
        safeDetails: {
          violations: [
            { path: '/config', constraint: 'additionalProperties', expected: expect.stringContaining('"mode"') },
            { path: '/config/limit', constraint: 'minimum', expected: 'a number no less than 1' },
            { path: '/config/tags', constraint: 'type', expected: expect.stringContaining('array') },
          ],
        },
      },
    });
    expect(JSON.stringify(result.safeError)).not.toContain(secretCanary);
    expect(execute).not.toHaveBeenCalled();
  });

  it('lets the model correct a failed call without automatically retrying the invalid input', async () => {
    const execute = vi.fn(async () => ({ value: 'ok' }));
    const definition = defineTool({
      name: brand<string, 'CapabilityId'>('correction-tool'),
      description: 'Correction test Tool.',
      inputSchema,
      outputSchema,
      execute,
    });
    const catalog = createToolCatalog({ provider, tools: [definition] });
    const invocationPort = governedBuiltinPort(catalog);

    const failedCall = await invocationPort.invoke(request({ value: 1 }, 'correction-tool'), new AbortController().signal);
    expect(failedCall).toMatchObject({
      status: 'FAILED',
      safeError: {
        message: 'Input validation failed for 1 constraint. Correct every listed field before calling the capability again.',
        safeDetails: { violations: [{ path: '/value', constraint: 'type', expected: 'a string' }] },
      },
    });
    expect(execute).not.toHaveBeenCalled();

    await expect(invocationPort.invoke(request({ value: 'corrected' }, 'correction-tool'), new AbortController().signal)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { value: 'ok' },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('raw-adapts unknown executables, Tool output, abort, and Tool throws without leaking raw values', async () => {
    const invalidOutput = defineTool({
      name: brand<string, 'CapabilityId'>('bad-output'),
      description: 'Bad output Tool.',
      inputSchema,
      outputSchema,
      async execute() {
        return { value: 1 } as unknown as JsonObject;
      },
    });
    const throwsRaw = defineTool({
      name: brand<string, 'CapabilityId'>('throws'),
      description: 'Throwing Tool.',
      inputSchema,
      outputSchema,
      async execute() {
        throw new Error('RAW_SECRET_SHOULD_NOT_LEAK');
      },
    });
    const catalog = createToolCatalog({ provider, tools: [invalidOutput, throwsRaw] });
    const descriptors = await catalog.listAll(new AbortController().signal);
    const executor = new BuiltinToolsExecutor(catalog);
    const unknownDescriptor = { ...descriptors[0]!, capabilityId: brand<string, 'CapabilityId'>('unknown') };
    const aborted = new AbortController();
    aborted.abort();

    await expect(executor.invoke(unknownDescriptor, request({ value: 'ok' }, 'unknown'), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_UNAVAILABLE' },
    });
    await expect(executor.invoke(descriptors[0]!, request({ value: 'ok' }, 'bad-output'), new AbortController().signal)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { value: 1 },
    });
    await expect(executor.invoke(descriptors[1]!, request({ value: 'ok' }, 'throws'), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_EXECUTION_FAILED' },
    });
    await expect(executor.invoke(descriptors[0]!, request({ value: 'ok' }, 'bad-output'), aborted.signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_ABORTED' },
    });
    expect(JSON.stringify(await executor.invoke(descriptors[1]!, request({ value: 'ok' }, 'throws'), new AbortController().signal))).not.toContain(
      'RAW_SECRET_SHOULD_NOT_LEAK',
    );
  });

  it('logs only unknown execution exceptions with trusted invocation coordinates', async () => {
    const unknownError = new Error('RAW_SECRET_SHOULD_NOT_LEAK');
    const throwsRaw = defineTool({
      name: brand<string, 'CapabilityId'>('throws-diagnostic'),
      description: 'Throwing diagnostic Tool.',
      inputSchema,
      outputSchema,
      async execute() {
        throw unknownError;
      },
    });
    const invalidOutput = defineTool({
      name: brand<string, 'CapabilityId'>('invalid-output-diagnostic'),
      description: 'Invalid output diagnostic Tool.',
      inputSchema,
      outputSchema,
      async execute() {
        return { value: 1 } as unknown as JsonObject;
      },
    });
    const catalog = createToolCatalog({ provider, tools: [throwsRaw, invalidOutput] });
    const descriptors = await catalog.listAll(new AbortController().signal);
    const errors: Array<Record<string, unknown>> = [];
    const binding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        debug() {},
        info() {},
        warn() {},
        error(fields) {
          errors.push(fields as Record<string, unknown>);
        },
      }),
    });
    try {
      const unknownResult = await new BuiltinToolsExecutor(catalog).invoke(
        descriptors[0]!,
        { ...request({ value: 'ok' }, 'throws-diagnostic'), toolCallId: 'tool-call-diagnostic' },
        new AbortController().signal,
      );
      const invalidOutputResult = await new BuiltinToolsExecutor(catalog).invoke(
        descriptors[1]!,
        request({ value: 'ok' }, 'invalid-output-diagnostic'),
        new AbortController().signal,
      );

      expect(unknownResult).toMatchObject({ safeError: { code: 'CAPABILITY_EXECUTION_FAILED' } });
      expect(invalidOutputResult).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { value: 1 } });
      expect(errors).toEqual([
        {
          event: 'capability.execution.exception_captured',
          failureStage: 'CAPABILITY_EXECUTION',
          agentId: 'default-agent',
          agentVersion: 'v1',
          sessionId: 'session-tool',
          requestId: 'request-tool',
          runId: 'run-tool',
          stepId: 'turn-1',
          toolCallId: 'tool-call-diagnostic',
          capabilityId: 'throws-diagnostic',
          providerId: 'builtin-tools',
          providerKind: 'BUNDLED',
          safeErrorCode: 'CAPABILITY_EXECUTION_FAILED',
          safeErrorCategory: 'INTERNAL',
          retryable: false,
          err: expect.any(Error),
        },
      ]);
      expect(JSON.stringify(errors)).not.toContain('capability.invocation.error');
    } finally {
      binding.unbind();
    }
  });

  it('keeps unknown execution result stable when the diagnostic logger throws', async () => {
    const throwsRaw = defineTool({
      name: brand<string, 'CapabilityId'>('throws-with-broken-logger'),
      description: 'Throwing Tool with broken logger.',
      inputSchema,
      outputSchema,
      async execute() {
        throw new Error('hidden');
      },
    });
    const catalog = createToolCatalog({ provider, tools: [throwsRaw] });
    const [descriptor] = await catalog.listAll(new AbortController().signal);
    const binding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        debug() {},
        info() {},
        warn() {},
        error() {
          throw new Error('logger unavailable');
        },
      }),
    });
    try {
      await expect(
        new BuiltinToolsExecutor(catalog).invoke(descriptor!, request({ value: 'ok' }, 'throws-with-broken-logger'), new AbortController().signal),
      ).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false },
      });
    } finally {
      binding.unbind();
    }
  });

  it('reserves toolDiagnostics metadata for Tool observability definitions', async () => {
    const manualDiagnostics = capabilityResultTool('manual-diagnostics', {
      retained: 'safe',
      toolDiagnostics: [{ key: 'toolResultStatus', value: 'SPOOFED' }],
    });
    const declaredDiagnostics = defineTool({
      name: brand<string, 'CapabilityId'>('declared-diagnostics'),
      description: 'Declared diagnostics Tool.',
      inputSchema,
      outputSchema,
      returnsCapabilityResult: true,
      observability: {
        safeCompletionDiagnostics() {
          return [{ key: 'toolResultStatus', value: 'DECLARED' }];
        },
      },
      async execute() {
        return capabilityResult({
          retained: 'safe',
          toolDiagnostics: [{ key: 'toolResultStatus', value: 'SPOOFED' }],
        });
      },
    });
    const catalog = createToolCatalog({ provider, tools: [manualDiagnostics, declaredDiagnostics] });
    const descriptors = await catalog.listAll(new AbortController().signal);
    const executor = new BuiltinToolsExecutor(catalog);

    await expect(
      executor.invoke(descriptors[0]!, request({ value: 'ok' }, 'manual-diagnostics'), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      metadata: { retained: 'safe' },
    });
    expect(
      JSON.stringify(await executor.invoke(descriptors[0]!, request({ value: 'ok' }, 'manual-diagnostics'), new AbortController().signal)),
    ).not.toContain('SPOOFED');

    await expect(
      executor.invoke(descriptors[1]!, request({ value: 'ok' }, 'declared-diagnostics'), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      metadata: {
        retained: 'safe',
        toolDiagnostics: [{ key: 'toolResultStatus', value: 'DECLARED' }],
      },
    });
  });

  it('keeps tool result stable when completion diagnostics projection fails', async () => {
    const throwingDiagnostics = defineTool({
      name: brand<string, 'CapabilityId'>('throwing-diagnostics'),
      description: 'Throwing diagnostics Tool.',
      inputSchema,
      outputSchema,
      returnsCapabilityResult: true,
      observability: {
        safeCompletionDiagnostics() {
          throw new Error('diagnostics sink failed with RAW_SECRET');
        },
      },
      async execute() {
        return capabilityResult({ retained: 'safe' });
      },
    });
    const warnings: object[] = [];
    const runtimeLogger: RuntimeLogger = {
      debug() {},
      info() {},
      warn(caughtOrFields, fieldsOrMsg?: object | string) {
        warnings.push(typeof fieldsOrMsg === 'object' ? fieldsOrMsg : (caughtOrFields as object));
      },
      error() {},
    };
    const catalog = createToolCatalog({ provider, tools: [throwingDiagnostics] });
    const [descriptor] = await catalog.listAll(new AbortController().signal);
    const loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => runtimeLogger });

    await expect(
      new BuiltinToolsExecutor(catalog).invoke(descriptor!, request({ value: 'ok' }, 'throwing-diagnostics'), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { value: 'ok' },
      metadata: { retained: 'safe' },
    });
    expect(warnings).toEqual([
      expect.objectContaining({
        event: 'tool.diagnostics.projection_failed',
        safeReasonCode: 'TOOL_DIAGNOSTICS_PROJECTION_FAILED',
        capabilityId: 'throwing-diagnostics',
        status: 'SUCCEEDED',
      }),
    ]);
    loggerBinding.unbind();
    expect(JSON.stringify(warnings)).not.toContain('RAW_SECRET');
  });

  it('wraps a non-envelope Tool output as succeeded when it matches the declared output schema', async () => {
    const execute = vi.fn(async () => ({ value: 'wrapped-data' }));
    const nonEnvelopeTool = defineTool({
      name: brand<string, 'CapabilityId'>('non-envelope'),
      description: 'Non-envelope test Tool.',
      inputSchema,
      outputSchema,
      returnsCapabilityResult: true,
      execute,
    });
    const catalog = createToolCatalog({ provider, tools: [nonEnvelopeTool] });

    const result = await governedBuiltinPort(catalog).invoke(request({ value: 'ok' }, 'non-envelope'), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { value: 'wrapped-data' },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reports CAPABILITY_OUTPUT_INVALID when a non-envelope Tool output does not match the declared output schema', async () => {
    const execute = vi.fn(async () => ({ foo: 'RAW_BUILTIN_ENVELOPE' }));
    const invalidOutputTool = defineTool({
      name: brand<string, 'CapabilityId'>('invalid-output'),
      description: 'Invalid output test Tool.',
      inputSchema,
      outputSchema,
      returnsCapabilityResult: true,
      execute,
    });
    const catalog = createToolCatalog({ provider, tools: [invalidOutputTool] });
    const errors: Array<Record<string, unknown>> = [];
    const loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        debug() {},
        info() {},
        warn() {},
        error(fields) {
          errors.push(fields as Record<string, unknown>);
        },
      }),
    });

    try {
      const result = await governedBuiltinPort(catalog).invoke(request({ value: 'ok' }, 'invalid-output'), new AbortController().signal);

      expect(result).toMatchObject({
        status: 'FAILED',
        structuredPayload: {},
        safeError: {
          code: 'CAPABILITY_OUTPUT_INVALID',
          category: 'VALIDATION',
          retryable: false,
        },
      });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain('RAW_BUILTIN_ENVELOPE');
      expect(JSON.stringify(errors)).not.toContain('RAW_BUILTIN_ENVELOPE');
    } finally {
      loggerBinding.unbind();
    }
  });

  it('uses an envelope-shaped Tool output directly even when returnsCapabilityResult is not declared', async () => {
    const envelopeResult: CapabilityInvocationResult = {
      status: 'SUCCEEDED',
      structuredPayload: { value: 'envelope-data' },
      generatedMessages: [],
      artifactRefs: [],
    };
    const envelopeShapedTool = defineTool({
      name: brand<string, 'CapabilityId'>('envelope-shaped'),
      description: 'Envelope-shaped test Tool.',
      inputSchema,
      outputSchema,
      execute: vi.fn(async () => envelopeResult),
    });
    const catalog = createToolCatalog({ provider, tools: [envelopeShapedTool] });

    const result = await governedBuiltinPort(catalog).invoke(request({ value: 'ok' }, 'envelope-shaped'), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { value: 'envelope-data' },
    });
  });

  it('forwards cumulative tool result deltas through runtimeContext without changing terminal results', async () => {
    const streamingTool = defineTool({
      name: brand<string, 'CapabilityId'>('streaming-tool'),
      description: 'Streaming test Tool.',
      inputSchema,
      outputSchema,
      async execute(input, options) {
        await options?.context?.emitResultDelta?.({ value: 'partial-1' });
        await options?.context?.emitResultDelta?.({ value: 'partial-2' });
        return input;
      },
    });
    const emitted: JsonObject[] = [];
    const catalog = createToolCatalog({ provider, tools: [streamingTool] });
    const [descriptor] = await catalog.listAll(new AbortController().signal);

    await expect(
      new BuiltinToolsExecutor(catalog).invoke(descriptor!, request({ value: 'ok' }, 'streaming-tool'), new AbortController().signal, {
        emitResultDelta: async (payload) => {
          emitted.push(payload.structuredPayload);
        },
      }),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { value: 'ok' },
    });
    expect(emitted).toEqual([{ value: 'partial-1' }, { value: 'partial-2' }]);
  });

  it('fails closed when a tool emits an unsafe result delta', async () => {
    const unsafeDeltaTool = defineTool({
      name: brand<string, 'CapabilityId'>('unsafe-delta-tool'),
      description: 'Unsafe delta Tool.',
      inputSchema,
      outputSchema,
      async execute(_input, options) {
        await options?.context?.emitResultDelta?.('unsafe' as unknown as JsonObject);
        return { value: 'ok' };
      },
    });
    const emitResultDelta = vi.fn(async () => {});
    const catalog = createToolCatalog({ provider, tools: [unsafeDeltaTool] });
    const [descriptor] = await catalog.listAll(new AbortController().signal);

    await expect(
      new BuiltinToolsExecutor(catalog).invoke(descriptor!, request({ value: 'ok' }, 'unsafe-delta-tool'), new AbortController().signal, {
        emitResultDelta,
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_RESULT_DELTA_INVALID', category: 'VALIDATION' },
    });
    expect(emitResultDelta).not.toHaveBeenCalled();
  });

  it('executes read through ToolCatalog and marks it unavailable without workspaceFiles dependency', async () => {
    const unavailable = createToolCatalog({ provider, tools: [readToolDefinition] });
    await expect(unavailable.listAll(new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'Read', availabilityStatus: 'UNAVAILABLE', availabilityReason: 'TOOL_DEPENDENCY_MISSING' }),
    ]);
    expect(unavailable.resolveExecutable(readCapabilityId)).toBeUndefined();

    const catalog = createToolCatalog({ provider, tools: [readToolDefinition], dependencies: workspaceDeps() });
    const [descriptor] = await catalog.listAll(new AbortController().signal);
    const result = await new BuiltinToolsExecutor(catalog).invoke(
      descriptor!,
      request({ file_path: 'package.json', offset: 0, limit: 1 }),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { file_path: 'package.json', offset: 0, limit: 1 } });
  });
});

function echoTool(name: string, prefix = '') {
  return defineTool({
    name: brand<string, 'CapabilityId'>(name),
    description: `${name} test Tool.`,
    inputSchema,
    outputSchema,
    async execute(input) {
      return { value: `${prefix}${input.value}` };
    },
  });
}

function capabilityResultTool(name: string, metadata: JsonObject) {
  return defineTool({
    name: brand<string, 'CapabilityId'>(name),
    description: `${name} test Tool.`,
    inputSchema,
    outputSchema,
    returnsCapabilityResult: true,
    async execute() {
      return capabilityResult(metadata);
    },
  });
}

function capabilityResult(metadata: JsonObject): CapabilityInvocationResult {
  return {
    status: 'SUCCEEDED',
    structuredPayload: { value: 'ok' },
    generatedMessages: [],
    artifactRefs: [],
    metadata,
  };
}

function diagnosticInputSchema(): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['config'],
    properties: {
      config: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { enum: ['safe', 'strict'] },
          limit: { type: 'integer', minimum: 1, maximum: 3 },
          tags: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
          label: { type: 'string', minLength: 1, maxLength: 5 },
          enabled: { const: false },
        },
      },
    },
  };
}

function governedBuiltinPort(catalog: ReturnType<typeof createToolCatalog>): GovernedCapabilityInvocationPort {
  return new GovernedCapabilityInvocationPort(
    {
      async resolveForInvocation(capabilityId, signal) {
        return (await catalog.listAll(signal)).find((descriptor) => descriptor.capabilityId === capabilityId);
      },
    },
    createStaticCapabilityExecutorFactory([{ provider: catalog.provider, executor: new BuiltinToolsExecutor(catalog) }]),
  );
}

function workspaceDeps(): ToolDependencies {
  return {
    workspaceFiles: {
      async readText(input) {
        return {
          file_path: String(input.file_path),
          offset: Number(input.offset ?? 0),
          limit: Number(input.limit ?? 1),
          content: 'ok',
          truncated: false,
        };
      },
      async writeText(input) {
        return { type: 'create', file_path: String(input.file_path) };
      },
      async editText(input) {
        return {
          type: 'update',
          file_path: String(input.file_path),
          old_string: String(input.old_string),
          new_string: String(input.new_string),
          replaced_count: 1,
        };
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
      async projectSkillResources() {
        return { skillProjectionKey: 'test-projection', rootRelativePath: '.nextagent/skills/test-projection/test/', projectedCount: 0 };
      },
      async sandboxFilesystem() {
        return { defaultCwd: process.cwd(), roots: [] };
      },
      async resolveView() {
        return { workspaceDir: 'workspace/', defaultCwd: process.cwd(), roots: [] };
      },
      clearRun() {},
    },
  };
}

function request(argumentsValue: JsonObject, capabilityId: string = readCapabilityId): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-tool',
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    arguments: argumentsValue,
    sessionId: brand<string, 'SessionId'>('session-tool'),
    requestId: brand<string, 'MessageId'>('request-tool'),
    runId: brand<string, 'RequestRunId'>('run-tool'),
    requestContextId: brand<string, 'RequestContextId'>('context-tool'),
    stepId: 'turn-1',
    identityContext: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'Tool tester' },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tool'),
  };
}

function assembly(capabilityId: string = readCapabilityId, providerIds: readonly string[] = ['builtin-tools']): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
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
    capabilityBindings: providerIds.map((providerId) => ({ capabilityId, capabilityType: 'TOOL', providerId })),
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-tool');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-tool');
}
