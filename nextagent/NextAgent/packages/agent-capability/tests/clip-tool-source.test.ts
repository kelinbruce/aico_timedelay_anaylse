import {
  buildClipExecutionArgs,
  clipServerProviderType,
  createCapabilitySubsystem,
  createSandboxClipCommandRunner,
  normalizeClipDescribeResult,
  type ClipCommandRunner,
  type ClipSafeDiagnostic,
} from '@nextagent/agent-capability';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCurrentViewPort, CapabilityInvocationRequest, CapabilityProviderConfig } from '@nextagent/agent-contracts/capability';
import type { SandboxExecutionRequest } from '@nextagent/agent-contracts/gateway';
import { describe, expect, it, vi } from 'vitest';

const provider = { providerId: 'clip-backed', providerKind: 'CUSTOM' as const, providerType: clipServerProviderType };
const inputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['neId'],
  properties: { neId: { type: 'string' } },
};
const outputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string' } },
};

describe('CLIP-backed tool source', () => {
  it('uses the catalog page limit accepted by the current CLIP CLI', async () => {
    const execute = vi.fn(async (request: SandboxExecutionRequest) => ({
      executionId: request.executionId,
      stdout: JSON.stringify({ items: [] }),
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      durationMs: 1,
      exitCode: 0,
    }));
    const runner = createSandboxClipCommandRunner({
      sandboxGateway: { execute },
      identity: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'CLIP tester' },
    });

    await runner.listTools(
      provider,
      { enabled: true, clipPathRef: 'clipc', endpointRef: 'local-daemon', timeoutMs: 5_000 },
      new AbortController().signal,
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['list', '--status', 'all', '--limit', '1000', '--json', '--show-id'] }),
      expect.any(AbortSignal),
    );
  });

  it('maps discovered CLIP APIs to ordinary Tool descriptors without leaking private routing facts', async () => {
    const runner = fakeRunner();
    const diagnostics: ClipSafeDiagnostic[] = [];
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner, clipDiagnostics: diagnostics });

    const descriptors = (
      await subsystem.catalog.listAvailable({
        tenantId: tenantId(),
        subjectId: subjectId(),
        agentAssembly: assembly(['alarm-check', 'kpi-read', 'ticket-open']),
        includeUnavailable: true,
      })
    ).filter((descriptor) => descriptor.provider.providerId === 'clip-backed');

    expect(descriptors.map((descriptor) => descriptor.capabilityId)).toEqual(['alarm-check', 'kpi-read', 'ticket-open']);
    expect(descriptors).toEqual([
      expect.objectContaining({ capabilityId: 'alarm-check', kind: 'TOOL', provider, availabilityStatus: 'AVAILABLE', inputSchema, outputSchema }),
      expect.objectContaining({ capabilityId: 'kpi-read', kind: 'TOOL', provider, availabilityStatus: 'AVAILABLE' }),
      expect.objectContaining({ capabilityId: 'ticket-open', kind: 'TOOL', provider, availabilityStatus: 'AVAILABLE' }),
    ]);
    expect(JSON.stringify(descriptors)).not.toContain('clip-a-private');
    expect(JSON.stringify(descriptors)).not.toContain('primitive-a');
    expect(JSON.stringify(descriptors)).not.toContain('clipc');
    expect(JSON.stringify(descriptors)).not.toContain('clip_api_call');
    expect(diagnostics).toEqual([]);
  });

  it('serves presentation current view from startup facts without repeating CLIP list or describe calls', async () => {
    const runner = fakeRunner();
    const listTools = vi.spyOn(runner, 'listTools');
    const describeTool = vi.spyOn(runner, 'describeTool');
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });
    await subsystem.validateStartupRegistration();
    const callsAfterStartup = { list: listTools.mock.calls.length, describe: describeTool.mock.calls.length };

    const descriptors = await (subsystem.catalog as unknown as CapabilityCurrentViewPort).listCurrent(
      {
        tenantId: tenantId(),
        subjectId: subjectId(),
        sessionId: brand<string, 'SessionId'>('session-clip-current'),
        agentAssembly: assembly(['alarm-check', 'kpi-read', 'ticket-open']),
      },
      new AbortController().signal,
    );

    expect(descriptors).toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'alarm-check' })]));
    expect(listTools).toHaveBeenCalledTimes(callsAfterStartup.list);
    expect(describeTool).toHaveBeenCalledTimes(callsAfterStartup.describe);
  });

  it('marks CLIP tools as deferred when CLIP disclosure uses ToolSearch mode', async () => {
    const describeTool = vi.fn<ClipCommandRunner['describeTool']>(async (_provider, _options, listedTool) => {
      const capabilityId = listedCapabilityId(listedTool);
      return toolFact(capabilityId, `private-${capabilityId}`, 'query');
    });
    const subsystem = createCapabilitySubsystem({
      providerConfigs: [clipConfig()],
      clipCommandRunner: fakeSearchRunner(describeTool),
      clipcDisclosureMode: 'tool-search',
    });

    const descriptors = await clipDescriptors(subsystem, ['alarm-check']);

    expect(descriptors).toEqual([
      expect.objectContaining({
        capabilityId: 'alarm-check',
        kind: 'TOOL',
        inputSchema: { type: 'object', additionalProperties: true },
        disclosurePolicy: { mode: 'DEFERRED', searchHint: 'Deferred CLIP catalog entry for alarm-check.' },
      }),
    ]);
    expect(describeTool).not.toHaveBeenCalled();
  });

  it('hydrates only the requested CLIP tool when deferred metadata is resolved', async () => {
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async () => ({ status: 'ok' }));
    const describeTool = vi.fn<ClipCommandRunner['describeTool']>(async (_provider, _options, listedTool) => {
      const capabilityId = listedCapabilityId(listedTool);
      return toolFact(capabilityId, `private-${capabilityId}`, 'query');
    });
    const subsystem = createCapabilitySubsystem({
      providerConfigs: [clipConfig()],
      clipCommandRunner: fakeSearchRunner(describeTool, executeTool),
      clipcDisclosureMode: 'tool-search',
    });

    await subsystem.validateStartupRegistration();
    await clipDescriptors(subsystem, ['alarm-check', 'kpi-read', 'ticket-open']);
    expect(describeTool).not.toHaveBeenCalled();

    const resolved = await subsystem.catalog.resolve({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check', 'kpi-read', 'ticket-open']),
      capabilityId: brand<string, 'CapabilityId'>('kpi-read'),
    });

    expect(resolved).toEqual(expect.objectContaining({ capabilityId: 'kpi-read', inputSchema }));
    expect(describeTool).toHaveBeenCalledTimes(1);

    const result = await subsystem.invocationPort.invoke(request('ticket-open', { neId: 'NE-1' }), new AbortController().signal);

    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { status: 'ok' } });
    expect(describeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'clip-backed',
        clipCapabilityId: 'private-ticket-open',
        primitive: 'query',
        arguments: { neId: 'NE-1' },
      }),
      expect.any(AbortSignal),
      expect.objectContaining({ emitResultDelta: expect.any(Function) }),
    );
  });

  it('keeps ToolSearch-selected CLIP tools executable when describe schema lookup fails', async () => {
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async () => ({ dynamic: 'ok' }));
    const describeTool = vi.fn<ClipCommandRunner['describeTool']>(async () => {
      throw new Error('RAW_SCHEMA_LOOKUP_FAILURE');
    });
    const runner: ClipCommandRunner = {
      async listTools() {
        return [
          {
            target: 'getHello',
            ref: '/api/hello',
            operation: 'query',
            params: [{ name: 'neId', location: 'query', required: true }],
            description: 'Hello API from listed CLIP metadata.',
          },
        ];
      },
      describeTool,
      executeTool,
    };
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner, clipcDisclosureMode: 'tool-search' });

    await clipDescriptors(subsystem, ['getHello']);
    const resolved = await subsystem.catalog.resolve({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['getHello']),
      capabilityId: brand<string, 'CapabilityId'>('getHello'),
    });
    const result = await subsystem.invocationPort.invoke(request('getHello', { neId: 'NE-1' }), new AbortController().signal);

    expect(describeTool).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual(
      expect.objectContaining({
        capabilityId: 'getHello',
        inputSchema: {
          type: 'object',
          additionalProperties: true,
          properties: { neId: { type: 'string' } },
        },
        outputSchema: { type: 'object', additionalProperties: true },
      }),
    );
    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { dynamic: 'ok' } });
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        clipCapabilityId: 'getHello',
        primitive: 'query',
        ref: '/api/hello',
        parameters: [{ name: 'neId', location: 'query', required: true }],
        arguments: { neId: 'NE-1' },
      }),
      expect.any(AbortSignal),
      expect.objectContaining({ emitResultDelta: expect.any(Function) }),
    );
    expect(JSON.stringify(result)).not.toContain('RAW_SCHEMA_LOOKUP_FAILURE');
  });

  it('resolves a CLIP tool lazily in list disclosure mode without prior listAvailable warmup', async () => {
    const describeTool = vi.fn<ClipCommandRunner['describeTool']>(async (_provider, _options, listedTool) => {
      const capabilityId = listedCapabilityId(listedTool);
      return toolFact(capabilityId, `private-${capabilityId}`, 'query');
    });
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async () => ({ status: 'ok' }));
    const runner: ClipCommandRunner = {
      async listTools() {
        return ['alarm-check', 'kpi-read', 'ticket-open'];
      },
      describeTool,
      executeTool,
    };
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });

    const resolved = await subsystem.catalog.resolve({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['kpi-read']),
      capabilityId: brand<string, 'CapabilityId'>('kpi-read'),
    });

    expect(resolved).toEqual(expect.objectContaining({ capabilityId: 'kpi-read', kind: 'TOOL', availabilityStatus: 'AVAILABLE', inputSchema }));
    expect(resolved?.disclosurePolicy).toBeUndefined();
    expect(describeTool).toHaveBeenCalledTimes(1);

    const result = await subsystem.invocationPort.invoke(request('kpi-read', { neId: 'NE-1' }), new AbortController().signal);

    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { status: 'ok' } });
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ clipCapabilityId: 'private-kpi-read', primitive: 'query', arguments: { neId: 'NE-1' } }),
      expect.any(AbortSignal),
      expect.objectContaining({ emitResultDelta: expect.any(Function) }),
    );
  });

  it('resolves a CLIP capability through resolveForInvocation in list mode for runtime api_name lookup', async () => {
    const describeTool = vi.fn<ClipCommandRunner['describeTool']>(async (_provider, _options, listedTool) => {
      const capabilityId = listedCapabilityId(listedTool);
      return toolFact(capabilityId, `private-${capabilityId}`, 'query');
    });
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async () => ({ status: 'ok' }));
    const runner: ClipCommandRunner = {
      async listTools() {
        return ['2607restful_test'];
      },
      describeTool,
      executeTool,
    };
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });

    const result = await subsystem.invocationPort.invoke(request('2607restful_test', { neId: 'NE-1' }), new AbortController().signal);

    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { status: 'ok' } });
    expect(describeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ clipCapabilityId: 'private-2607restful_test', primitive: 'query', arguments: { neId: 'NE-1' } }),
      expect.any(AbortSignal),
      expect.objectContaining({ emitResultDelta: expect.any(Function) }),
    );
  });

  it('returns CAPABILITY_UNAVAILABLE when resolveForInvocation targets an unknown api_name in list mode', async () => {
    const runner = fakeRunner();
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });

    const result = await subsystem.invocationPort.invoke(request('nonexistent_api', { neId: 'NE-1' }), new AbortController().signal);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_UNAVAILABLE', category: 'UNAVAILABLE' } });
  });

  it('falls back to listed CLIP metadata when described output schema is invalid', async () => {
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async () => ({ status: 'ok', extra: 'allowed-by-generic-schema' }));
    const runner: ClipCommandRunner = {
      async listTools() {
        return [
          {
            target: 'getHello',
            ref: '/api/hello',
            operation: 'query',
            params: [{ name: 'neId', location: 'query', required: true }],
          },
        ];
      },
      async describeTool() {
        return {
          capabilityId: 'getHello',
          clipCapabilityId: 'private-should-not-be-used',
          primitive: 'query',
          displayName: 'getHello',
          description: 'Invalid response schema should not block execution.',
          inputSchema,
          outputSchema: { type: 1 },
        };
      },
      executeTool,
    };
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });

    const descriptors = await clipDescriptors(subsystem, ['getHello']);
    const result = await subsystem.invocationPort.invoke(request('getHello', { neId: 'NE-1' }), new AbortController().signal);

    expect(descriptors[0]).toEqual(
      expect.objectContaining({
        capabilityId: 'getHello',
        outputSchema: { type: 'object', additionalProperties: true },
      }),
    );
    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { status: 'ok', extra: 'allowed-by-generic-schema' } });
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        clipCapabilityId: 'getHello',
        ref: '/api/hello',
        arguments: { neId: 'NE-1' },
      }),
      expect.any(AbortSignal),
      expect.objectContaining({ emitResultDelta: expect.any(Function) }),
    );
    expect(JSON.stringify(descriptors)).not.toContain('private-should-not-be-used');
  });

  it('matches described CLIP capabilities by listed target/ref instead of taking the first entry', () => {
    const normalized = normalizeClipDescribeResult(
      { target: 'ticket-open', ref: '/ticket-open', operation: 'create' },
      {
        data: {
          structured: {
            capabilities: [
              {
                target_id: 'alarm-check',
                ref_template: '/alarm-check',
                operation: 'query',
                params: [{ name: 'neId', location: 'query', required: true }],
                responses: [{ description: 'Alarm check telecom Tool.' }],
              },
              {
                target_id: 'ticket-open',
                ref_template: '/ticket-open',
                operation: 'create',
                body_required: true,
                params: [{ name: 'ticketId', location: 'path', required: true }],
                responses: [{ description: 'Ticket creation telecom Tool.' }],
              },
            ],
          },
        },
      },
    );

    expect(normalized).toMatchObject({
      capabilityId: 'ticket-open',
      clipCapabilityId: 'ticket-open',
      primitive: 'create',
      ref: '/ticket-open',
      description: 'Ticket creation telecom Tool.',
      bodyRequired: true,
      replayPolicy: 'NON_IDEMPOTENT',
    });
    expect(normalized.inputSchema).toEqual({
      type: 'object',
      additionalProperties: true,
      properties: {
        ticketId: { type: 'string' },
        body: { type: 'object', additionalProperties: true },
      },
    });
  });

  it('relaxes inputSchema to additionalProperties true when bodyRequired is true and no parameters are declared', () => {
    const normalized = normalizeClipDescribeResult(
      { target: 'search_feature', ref: '/search_feature', operation: 'query' },
      {
        data: {
          structured: {
            callable_capabilities: [
              {
                target_id: 'search_feature',
                ref_template: '/search_feature',
                operation: 'query',
                body_required: true,
                params: [],
                responses: [{ description: 'Search feature telecom Tool.' }],
              },
            ],
          },
        },
      },
    );

    expect(normalized).toMatchObject({
      capabilityId: 'search_feature',
      bodyRequired: true,
    });
    expect(normalized.inputSchema).toEqual({ type: 'object', additionalProperties: true });
  });

  it('preserves CLIP response schemas as descriptor metadata', async () => {
    const streamSchema: JsonObject = {
      type: 'object',
      properties: {
        event: { type: 'string' },
        data: {
          type: 'object',
          properties: { char: { type: 'string' }, index: { type: 'integer' } },
          required: ['char', 'index'],
        },
      },
    };
    const describeTool = vi.fn<ClipCommandRunner['describeTool']>(async (_provider, _options, listedTool) =>
      normalizeClipDescribeResult(listedTool, {
        data: {
          structured: {
            callable_capabilities: [
              {
                target_id: 'getHelloStream',
                ref_template: '/api/hello/stream',
                operation: 'subscribe',
                body_required: false,
                params: [],
                responses: [
                  {
                    status: '200',
                    description: 'Successful SSE stream',
                    content_types: ['text/event-stream'],
                    content: { 'text/event-stream': { schema: streamSchema } },
                  },
                ],
              },
            ],
          },
        },
      }),
    );
    const runner: ClipCommandRunner = {
      async listTools() {
        return [{ target: 'getHelloStream', ref: '/api/hello/stream', operation: 'subscribe' }];
      },
      describeTool,
      async executeTool() {
        return { status: 'ok' };
      },
    };
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });

    const descriptors = await clipDescriptors(subsystem, ['getHelloStream']);

    expect(descriptors[0]?.metadata).toEqual({
      clip: {
        operation: 'subscribe',
        responses: [
          {
            status: '200',
            description: 'Successful SSE stream',
            contentTypes: ['text/event-stream'],
            content: { 'text/event-stream': { schema: streamSchema } },
          },
        ],
        streamEventSchema: streamSchema,
      },
    });
    expect(descriptors[0]?.outputSchema).toEqual({
      type: 'object',
      additionalProperties: true,
      properties: {
        events: {
          type: 'array',
          items: streamSchema,
        },
        completion: {
          type: 'object',
          additionalProperties: true,
        },
      },
    });
  });

  it('leaves CLIP descriptor disclosure policy unchanged by default for compatibility', async () => {
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: fakeRunner() });

    const descriptors = await clipDescriptors(subsystem, ['alarm-check']);

    expect(descriptors).toEqual([
      expect.objectContaining({
        capabilityId: 'alarm-check',
      }),
    ]);
    expect(descriptors[0]?.disclosurePolicy).toBeUndefined();
  });

  it('rejects invalid configuration and runner absence without registering partial executable descriptors', async () => {
    const invalidConfigSubsystem = createCapabilitySubsystem({
      providerConfigs: [{ ...clipConfig(), options: { customOptions: { enabled: true, clipPathRef: 'clipc' } } }],
    });
    await expect(clipDescriptors(invalidConfigSubsystem, ['alarm-check'])).resolves.toEqual([]);

    const missingRunnerSubsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()] });
    const descriptors = await clipDescriptors(missingRunnerSubsystem, ['clip_server_unavailable']);
    expect(descriptors).toEqual([
      expect.objectContaining({
        capabilityId: 'clip_server_unavailable',
        availabilityStatus: 'UNAVAILABLE',
        availabilityReason: 'CLIP_RUNNER_UNAVAILABLE',
      }),
    ]);
  });

  it('filters invalid candidates and never creates a generic CLIP dispatch tool', async () => {
    const runner: ClipCommandRunner = {
      async listTools() {
        return ['clip-a-private', 'private-dispatch', 'bad-private'];
      },
      async describeTool(_provider, _options, listedTool) {
        if (listedTool === 'clip-a-private') {
          return toolFact('alarm-check', 'clip-a-private', 'primitive-a');
        }
        if (listedTool === 'private-dispatch') {
          return toolFact('clipc', 'private-dispatch', 'dispatch');
        }
        return { capabilityId: 'bad', description: 'missing fields' };
      },
      async executeTool() {
        return { status: 'ok' };
      },
    };
    const diagnostics: ClipSafeDiagnostic[] = [];
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner, clipDiagnostics: diagnostics });

    const descriptors = await clipDescriptors(subsystem, ['alarm-check', 'clipc', 'clip_api_call']);

    expect(descriptors.map((descriptor) => descriptor.capabilityId)).toEqual(['alarm-check']);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ reasonCode: 'CLIP_DESCRIPTOR_INVALID', providerId: 'clip-backed', failureClass: 'VALIDATION' }),
    );
  });

  it('invokes CLIP through capabilityId-derived registry mapping', async () => {
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async () => ({ status: 'ok' }));
    const runner = fakeRunner(executeTool);
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });
    await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check']),
      includeUnavailable: true,
    });

    const result = await subsystem.invocationPort.invoke(request('alarm-check', { neId: 'NE-1' }), new AbortController().signal);

    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { status: 'ok' } });
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'clip-backed',
        clipCapabilityId: 'clip-a-private',
        primitive: 'primitive-a',
        arguments: { neId: 'NE-1' },
      }),
      expect.any(AbortSignal),
      expect.objectContaining({ emitResultDelta: expect.any(Function) }),
    );
  });

  it('unwraps CLIP data.structured payload directly', async () => {
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async () => ({
      data: { structured: { status: 'ok' } },
    }));
    const runner: ClipCommandRunner = fakeRunner(executeTool);
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });
    await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check']),
      includeUnavailable: true,
    });
    const result = await subsystem.invocationPort.invoke(request('alarm-check', { neId: 'NE-1' }), new AbortController().signal);
    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { status: 'ok' } });
  });

  it('falls back to CLIP data.raw when structured is null', async () => {
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async () => ({
      data: { structured: null, raw: '{"status":"ok"}' },
    }));
    const runner: ClipCommandRunner = fakeRunner(executeTool);
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });
    await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check']),
      includeUnavailable: true,
    });
    const result = await subsystem.invocationPort.invoke(request('alarm-check', { neId: 'NE-1' }), new AbortController().signal);
    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { status: 'ok' } });
  });

  it('falls back to CLIP data.raw when structured is absent', async () => {
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async () => ({
      data: { raw: '{"status":"ok"}' },
    }));
    const runner: ClipCommandRunner = fakeRunner(executeTool);
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });
    await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check']),
      includeUnavailable: true,
    });
    const result = await subsystem.invocationPort.invoke(request('alarm-check', { neId: 'NE-1' }), new AbortController().signal);
    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { status: 'ok' } });
  });

  it('forwards CLIP execution result deltas through the runtime context', async () => {
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async (_request, _signal, options) => {
      await options?.emitResultDelta?.({ event: { type: 'data', data: { chunk: 'H' } } });
      await options?.emitResultDelta?.({ event: { type: 'data', data: { chunk: 'i' } } });
      return { status: 'ok' };
    });
    const runner = fakeRunner(executeTool);
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });
    await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check']),
      includeUnavailable: true,
    });
    const emitted: JsonObject[] = [];

    const result = await subsystem.invocationPort.invoke(request('alarm-check', { neId: 'NE-1' }), new AbortController().signal, {
      emitResultDelta: async (payload) => {
        emitted.push(payload.structuredPayload);
      },
    });

    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { status: 'ok' } });
    expect(emitted).toEqual([{ event: { type: 'data', data: { chunk: 'H' } } }, { event: { type: 'data', data: { chunk: 'i' } } }]);
  });

  it('unwraps CLIP subscribe envelopes to original event data without leaking routing fields', async () => {
    const subscribeOutputSchema: JsonObject = {
      type: 'object',
      additionalProperties: false,
      required: ['events'],
      properties: {
        events: { type: 'array', items: { type: 'object', additionalProperties: true } },
        completion: { type: 'object', additionalProperties: true },
      },
    };
    const dataRaw = JSON.stringify({ char: 'H', timestamp: '2026-07-07T11:04:40.027814800+01:00', index: 0 });
    const eventEnvelope: JsonObject = {
      type: 'clip.subscribe.event',
      operation: 'subscribe',
      target: 'getHelloStream',
      ref: '/api/hello/stream',
      trace_id: 'trace-should-stay-private',
      index: 1,
      event: 'char',
      data_raw: dataRaw,
      data_json: { char: 'H', timestamp: '2026-07-07T11:04:40.027814800+01:00', index: 0 },
      received_at: 1783418680058,
    };
    const completionEnvelope: JsonObject = {
      type: 'clip.subscribe.completed',
      operation: 'subscribe',
      target: 'getHelloStream',
      ref: '/api/hello/stream',
      trace_id: 'trace-should-stay-private',
      reason: 'max_events',
      event_count: 1,
      received_at: 1783418689133,
    };
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async (_request, _signal, options) => {
      await options?.emitResultDelta?.(eventEnvelope);
      return { events: [], lines: [eventEnvelope, completionEnvelope] };
    });
    const runner: ClipCommandRunner = {
      async listTools() {
        return ['getHelloStream'];
      },
      async describeTool() {
        return toolFact('getHelloStream', 'getHelloStream', 'subscribe', subscribeOutputSchema);
      },
      executeTool,
    };
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });
    await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['getHelloStream']),
      includeUnavailable: true,
    });
    const emitted: JsonObject[] = [];

    const result = await subsystem.invocationPort.invoke(request('getHelloStream', { neId: 'NE-1' }), new AbortController().signal, {
      emitResultDelta: async (payload) => {
        emitted.push(payload.structuredPayload);
      },
    });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        events: [
          {
            event: 'char',
            data: { char: 'H', timestamp: '2026-07-07T11:04:40.027814800+01:00', index: 0 },
            data_raw: dataRaw,
          },
        ],
        completion: { type: 'clip.subscribe.completed', reason: 'max_events', event_count: 1 },
      },
    });
    expect(emitted).toEqual([
      {
        event: 'char',
        data: { char: 'H', timestamp: '2026-07-07T11:04:40.027814800+01:00', index: 0 },
        data_raw: dataRaw,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('trace-should-stay-private');
    expect(JSON.stringify(result)).not.toContain('/api/hello/stream');
    expect(JSON.stringify(emitted)).not.toContain('trace-should-stay-private');
  });

  it('rejects model-supplied routing fields before CLIP execution', async () => {
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async () => ({ status: 'ok' }));
    const runner = fakeRunner(executeTool);
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });
    await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check']),
      includeUnavailable: true,
    });

    const result = await subsystem.invocationPort.invoke(
      request('alarm-check', { neId: 'NE-1', clipCapabilityId: 'model-supplied', primitive: 'model-primitive', api_name: 'dispatch' }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CAPABILITY_INPUT_INVALID',
        category: 'VALIDATION',
        retryable: false,
        message: 'Input validation failed for 1 constraint. Correct every listed field before calling the capability again.',
        safeDetails: {
          violations: [{ path: '', constraint: 'additionalProperties', expected: 'only "neId" are allowed' }],
        },
      },
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('builds CLIP execution args from governed target metadata only', () => {
    expect(
      buildClipExecutionArgs({
        providerId: 'clip-backed',
        clipPathRef: 'clipc',
        endpointRef: 'clip-daemon',
        clipCapabilityId: 'ticket-open',
        primitive: 'create',
        ref: '/ticket-open',
        parameters: [{ name: 'ticketId', location: 'path', required: true }],
        bodyRequired: true,
        arguments: { ticketId: 'T-100', body: { severity: 'high' } },
        timeoutMs: 5_000,
      }),
    ).toEqual([
      'create',
      'ticket-open',
      '/ticket-open',
      '--params',
      JSON.stringify({ path: { ticketId: 'T-100' } }),
      '-b',
      JSON.stringify({ severity: 'high' }),
    ]);
  });

  it('places only declared trusted trace headers in CLIP params and overrides model-supplied values', () => {
    const args = buildClipExecutionArgs(
      {
        providerId: 'clip-backed',
        clipPathRef: 'clipc',
        endpointRef: 'clip-daemon',
        clipCapabilityId: 'ticket-open',
        primitive: 'create',
        ref: '/ticket-open',
        parameters: [{ name: 'TraceParent', location: 'header', required: false }],
        arguments: { TraceParent: 'untrusted' },
        timeoutMs: 5_000,
      },
      {
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
        'x-task-event-id': 'task-01',
      },
    );

    expect(JSON.parse(args[args.indexOf('--params') + 1]!)).toEqual({
      header: {
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
      },
    });
  });

  it('places every trusted trace header declared by the CLIP descriptor', () => {
    const args = buildClipExecutionArgs(
      {
        providerId: 'clip-backed',
        clipPathRef: 'clipc',
        endpointRef: 'clip-daemon',
        clipCapabilityId: 'ticket-open',
        primitive: 'create',
        ref: '/ticket-open',
        parameters: [
          { name: 'TraceParent', location: 'header', required: false },
          { name: 'TraceState', location: 'header', required: false },
          { name: 'X-Task-Event-Id', location: 'header', required: false },
        ],
        arguments: {},
        timeoutMs: 5_000,
      },
      {
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
        tracestate: 'vendor=value',
        'x-task-event-id': 'task-01',
      },
    );

    expect(JSON.parse(args[args.indexOf('--params') + 1]!)).toEqual({
      header: {
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
        tracestate: 'vendor=value',
        'x-task-event-id': 'task-01',
      },
    });
  });

  it('removes model-supplied trace headers when no trusted execution context exists', () => {
    const args = buildClipExecutionArgs({
      providerId: 'clip-backed',
      clipPathRef: 'clipc',
      endpointRef: 'clip-daemon',
      clipCapabilityId: 'ticket-open',
      primitive: 'create',
      ref: '/ticket-open',
      parameters: [
        { name: 'TraceParent', location: 'header', required: false },
        { name: 'x-task-event-id', location: 'header', required: false },
        { name: 'x-business-header', location: 'header', required: false },
      ],
      arguments: {
        TraceParent: 'untrusted-trace',
        'x-task-event-id': 'untrusted-event',
        'x-business-header': 'preserved',
      },
      timeoutMs: 5_000,
    });

    expect(JSON.parse(args[args.indexOf('--params') + 1]!)).toEqual({
      header: {
        'x-business-header': 'preserved',
      },
    });
  });

  it('places declared session and identity headers in CLIP params from trusted systemHeaders', () => {
    const args = buildClipExecutionArgs(
      {
        providerId: 'clip-backed',
        clipPathRef: 'clipc',
        endpointRef: 'clip-daemon',
        clipCapabilityId: 'ticket-open',
        primitive: 'create',
        ref: '/ticket-open',
        parameters: [
          { name: 'chatId', location: 'header', required: false },
          { name: 'conversationId', location: 'header', required: false },
          { name: 'x-user-id', location: 'header', required: false },
          { name: 'x-user-name', location: 'header', required: false },
        ],
        arguments: {},
        timeoutMs: 5_000,
      },
      {
        chatId: 'request-clip',
        conversationId: 'session-clip',
        'x-user-id': 'subject-clip',
        'x-user-name': 'CLIP tester',
      },
    );

    expect(JSON.parse(args[args.indexOf('--params') + 1]!)).toEqual({
      header: {
        chatId: 'request-clip',
        conversationId: 'session-clip',
        'x-user-id': 'subject-clip',
        'x-user-name': 'CLIP tester',
      },
    });
  });

  it('builds trustedHeaders from invocation request and passes them to executeTool options', async () => {
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async () => ({ status: 'ok' }));
    const runner = fakeRunner(executeTool);
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });
    await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check']),
      includeUnavailable: true,
    });

    await subsystem.invocationPort.invoke(request('alarm-check', { neId: 'NE-1' }), new AbortController().signal);

    expect(executeTool).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(AbortSignal),
      expect.objectContaining({
        trustedHeaders: {
          chatId: 'request-clip',
          conversationId: 'session-clip',
          'x-user-id': 'subject-clip',
          'x-user-name': 'CLIP tester',
        },
      }),
    );
  });

  it('trusted session and identity headers override model-supplied values in CLIP params', () => {
    const args = buildClipExecutionArgs(
      {
        providerId: 'clip-backed',
        clipPathRef: 'clipc',
        endpointRef: 'clip-daemon',
        clipCapabilityId: 'ticket-open',
        primitive: 'create',
        ref: '/ticket-open',
        parameters: [
          { name: 'chatId', location: 'header', required: false },
          { name: 'conversationId', location: 'header', required: false },
        ],
        arguments: {
          chatId: 'forged-chat',
          conversationId: 'forged-conv',
        },
        timeoutMs: 5_000,
      },
      {
        chatId: 'request-clip',
        conversationId: 'session-clip',
      },
    );

    expect(JSON.parse(args[args.indexOf('--params') + 1]!)).toEqual({
      header: {
        chatId: 'request-clip',
        conversationId: 'session-clip',
      },
    });
  });

  it('requests JSONL output when building CLIP subscribe execution args', () => {
    expect(
      buildClipExecutionArgs({
        providerId: 'clip-backed',
        clipPathRef: 'clipc',
        endpointRef: 'clip-daemon',
        clipCapabilityId: 'getHelloStream',
        primitive: 'subscribe',
        ref: '/api/hello/stream',
        arguments: {},
        timeoutMs: 20_000,
      }),
    ).toEqual(['subscribe', 'getHelloStream', '/api/hello/stream', '--format', 'jsonl', '--params', JSON.stringify({})]);
  });

  it('passes body directly via -b when bodyRequired is true and no parameters are declared', () => {
    const args = { type: 'TASK_COMPLETED', taskId: 'task-1', sequence: 1, timestamp: 1000, data: { result: 'ok' } };
    expect(
      buildClipExecutionArgs(
        {
          providerId: 'clip-backed',
          clipPathRef: 'clipc',
          endpointRef: 'clip-daemon',
          clipCapabilityId: 'product-task-callback',
          primitive: 'execute',
          ref: '/callback',
          bodyRequired: true,
          arguments: args as unknown as JsonObject,
          timeoutMs: 30_000,
        },
        {
          traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
          'x-task-event-id': 'task-01',
        },
      ),
    ).toEqual(['execute', 'product-task-callback', '/callback', '-b', JSON.stringify(args)]);
  });

  it('extracts request_header from arguments into params header bucket without leaking into body', () => {
    const args = buildClipExecutionArgs({
      providerId: 'clip-backed',
      clipPathRef: 'clipc',
      endpointRef: 'clip-daemon',
      clipCapabilityId: 'IR-CreateConversation',
      primitive: 'create',
      ref: '/IR-CreateConversation',
      parameters: [{ name: 'neId', location: 'path', required: true }],
      bodyRequired: true,
      arguments: {
        neId: 'NE-1',
        request_header: { 'Agent-Tenant-ID': '0', Authorization: 'Bearer token' },
        field1: 'value1',
      },
      timeoutMs: 5_000,
    });

    const params = JSON.parse(args[args.indexOf('--params') + 1]!) as Record<string, unknown>;
    expect(params['header']).toEqual({ 'Agent-Tenant-ID': '0', Authorization: 'Bearer token' });
    expect(params['path']).toEqual({ neId: 'NE-1' });
    expect(JSON.stringify(params)).not.toContain('request_header');

    const body = JSON.parse(args[args.indexOf('-b') + 1]!) as Record<string, unknown>;
    expect(body).toEqual({ field1: 'value1' });
    expect(JSON.stringify(body)).not.toContain('request_header');
    expect(JSON.stringify(body)).not.toContain('neId');
  });

  it('omits empty buckets from --params envelope', () => {
    const args = buildClipExecutionArgs({
      providerId: 'clip-backed',
      clipPathRef: 'clipc',
      endpointRef: 'clip-daemon',
      clipCapabilityId: 'simple-query',
      primitive: 'query',
      ref: '/simple-query',
      arguments: {},
      timeoutMs: 5_000,
    });

    const params = JSON.parse(args[args.indexOf('--params') + 1]!) as Record<string, unknown>;
    expect(Object.keys(params)).toEqual([]);
  });

  it('quotes args for REMOTE sandbox to protect JSON from shell interpretation', () => {
    const executeSpy = vi.fn(async (request: SandboxExecutionRequest) => ({
      executionId: request.executionId,
      stdout: '{}',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      durationMs: 1,
      exitCode: 0,
    }));
    const remoteRunner = createSandboxClipCommandRunner({
      sandboxGateway: { execute: executeSpy },
      identity: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'CLIP remote tester' },
      remoteSandbox: true,
    });

    void remoteRunner.executeTool(
      {
        providerId: 'clip-backed',
        clipPathRef: 'clipc',
        endpointRef: 'clip-daemon',
        clipCapabilityId: 'ticket-open',
        primitive: 'create',
        ref: '/ticket-open',
        parameters: [{ name: 'ticketId', location: 'path', required: true }],
        bodyRequired: true,
        arguments: { ticketId: 'T-100', body: { severity: 'high' } },
        timeoutMs: 5_000,
      },
      new AbortController().signal,
    );

    const call = executeSpy.mock.calls[0]!;
    const quotedJsonArg = call[0].args.find((arg: string) => arg.startsWith("'{"));
    expect(quotedJsonArg).toBeDefined();
    expect(quotedJsonArg!.startsWith("'")).toBe(true);
    expect(quotedJsonArg!.endsWith("'")).toBe(true);
    const unquoted = quotedJsonArg!.slice(1, -1);
    expect(() => JSON.parse(unquoted)).not.toThrow();
  });

  it('does not quote args in LOCAL sandbox mode', () => {
    const executeSpy = vi.fn(async (request: SandboxExecutionRequest) => ({
      executionId: request.executionId,
      stdout: '{}',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      durationMs: 1,
      exitCode: 0,
    }));
    const localRunner = createSandboxClipCommandRunner({
      sandboxGateway: { execute: executeSpy },
      identity: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'CLIP local tester' },
      remoteSandbox: false,
    });

    void localRunner.executeTool(
      {
        providerId: 'clip-backed',
        clipPathRef: 'clipc',
        endpointRef: 'clip-daemon',
        clipCapabilityId: 'ticket-open',
        primitive: 'create',
        ref: '/ticket-open',
        parameters: [{ name: 'ticketId', location: 'path', required: true }],
        bodyRequired: true,
        arguments: { ticketId: 'T-100', body: { severity: 'high' } },
        timeoutMs: 5_000,
      },
      new AbortController().signal,
    );

    const call = executeSpy.mock.calls[0]!;
    const jsonArg = call[0].args.find((arg: string) => arg.startsWith('{'));
    expect(jsonArg).toBeDefined();
    expect(jsonArg!.startsWith("'")).toBe(false);
  });

  it('does not auto-register a default CLIP provider when clip_server is already configured', async () => {
    const runner = fakeRunner();
    const subsystem = createCapabilitySubsystem({ providerConfigs: [clipConfig()], clipCommandRunner: runner });

    const descriptors = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check', 'kpi-read', 'ticket-open']),
      includeUnavailable: true,
    });

    const defaultProviders = descriptors.filter((d) => d.provider.providerId === 'clip-server-default');
    expect(defaultProviders).toEqual([]);
  });

  it('does not auto-register when clipCommandRunner is not available', async () => {
    const subsystem = createCapabilitySubsystem({});

    const descriptors = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check']),
      includeUnavailable: true,
    });

    const defaultProviders = descriptors.filter((d) => d.provider.providerId === 'clip-server-default');
    expect(defaultProviders).toEqual([]);
  });

  it('normalizes runner failures and invalid results into safe invocation outcomes', async () => {
    const unavailable = createCapabilitySubsystem({
      providerConfigs: [clipConfig()],
      clipCommandRunner: fakeRunner(async () => {
        throw new Error('RAW_CLIP_SECRET');
      }),
    });
    await unavailable.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check']),
      includeUnavailable: true,
    });
    const failed = await unavailable.invocationPort.invoke(request('alarm-check', { neId: 'NE-1' }), new AbortController().signal);
    expect(failed).toMatchObject({ status: 'FAILED', safeError: { code: 'CLIP_EXECUTION_UNAVAILABLE', category: 'UNAVAILABLE' } });
    expect(JSON.stringify(failed)).not.toContain('RAW_CLIP_SECRET');

    const invalid = createCapabilitySubsystem({
      providerConfigs: [clipConfig()],
      clipCommandRunner: fakeRunner(async () => ({ raw: 'not-schema' })),
    });
    await invalid.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check']),
      includeUnavailable: true,
    });
    await expect(invalid.invocationPort.invoke(request('alarm-check', { neId: 'NE-1' }), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_OUTPUT_INVALID', category: 'VALIDATION', retryable: false },
    });
  });
  it('auto-registers a default CLIP provider when no clip_server is configured but runner is available', async () => {
    const runner = fakeRunner();
    const subsystem = createCapabilitySubsystem({ clipCommandRunner: runner });

    const descriptors = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(['alarm-check', 'kpi-read', 'ticket-open'], 'clip-server-default'),
      includeUnavailable: true,
    });

    const clipDescriptors = descriptors.filter((d) => d.provider.providerId === 'clip-server-default');
    expect(clipDescriptors.length).toBeGreaterThan(0);
    expect(clipDescriptors.map((d) => d.capabilityId)).toEqual(['alarm-check', 'kpi-read', 'ticket-open']);
  });
});

async function clipDescriptors(subsystem: ReturnType<typeof createCapabilitySubsystem>, capabilityIds: readonly string[]) {
  return (
    await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(capabilityIds),
      includeUnavailable: true,
    })
  ).filter((descriptor) => descriptor.provider.providerId === 'clip-backed');
}

function fakeRunner(executeTool: ClipCommandRunner['executeTool'] = async () => ({ status: 'ok' })): ClipCommandRunner {
  const facts = new Map([
    ['clip-a-private', toolFact('alarm-check', 'clip-a-private', 'primitive-a')],
    ['clip-b-private', toolFact('kpi-read', 'clip-b-private', 'primitive-b')],
    ['clip-c-private', toolFact('ticket-open', 'clip-c-private', 'primitive-c')],
  ]);
  return {
    async listTools() {
      return [...facts.keys()];
    },
    async describeTool(_provider, _options, listedTool) {
      return facts.get(String(listedTool));
    },
    executeTool,
  };
}

function fakeSearchRunner(
  describeTool: ClipCommandRunner['describeTool'],
  executeTool: ClipCommandRunner['executeTool'] = async () => ({ status: 'ok' }),
): ClipCommandRunner {
  return {
    async listTools() {
      return ['alarm-check', 'kpi-read', 'ticket-open'].map((capabilityId) => ({
        capabilityId,
        displayName: capabilityId,
        description: `Deferred CLIP catalog entry for ${capabilityId}.`,
      }));
    },
    describeTool,
    executeTool,
  };
}

function listedCapabilityId(listedTool: unknown): string {
  if (typeof listedTool === 'object' && listedTool !== null && 'capabilityId' in listedTool) {
    return String(listedTool.capabilityId);
  }
  return String(listedTool);
}

function toolFact(capabilityId: string, clipCapabilityId: string, primitive: string, schema: JsonObject = outputSchema) {
  return {
    capabilityId,
    clipCapabilityId,
    primitive,
    displayName: capabilityId,
    description: `${capabilityId} telecom Tool.`,
    inputSchema,
    outputSchema: schema,
    replayPolicy: 'NON_IDEMPOTENT',
  };
}

function clipConfig(): CapabilityProviderConfig {
  return {
    provider,
    discoveryMode: 'EAGER',
    options: { customOptions: { enabled: true, clipPathRef: 'clipc', endpointRef: 'clip-daemon', timeoutMs: 5000, retry: { maxAttempts: 1 } } },
  };
}

function request(capabilityId: string, argumentsValue: JsonObject): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-clip',
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    arguments: argumentsValue,
    sessionId: brand<string, 'SessionId'>('session-clip'),
    requestId: brand<string, 'MessageId'>('request-clip'),
    runId: brand<string, 'RequestRunId'>('run-clip'),
    requestContextId: brand<string, 'RequestContextId'>('context-clip'),
    stepId: 'turn-1',
    identityContext: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'CLIP tester' },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
  };
}

function assembly(capabilityIds: readonly string[], providerId: string = 'clip-backed'): AgentAssembly {
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
    capabilityBindings: capabilityIds.map((capabilityId) => ({
      capabilityId: brand<string, 'CapabilityId'>(capabilityId),
      capabilityType: 'TOOL',
      providerId,
    })),
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-clip');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-clip');
}
