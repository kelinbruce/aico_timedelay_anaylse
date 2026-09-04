import {
  createAppCredentialResolver,
  createComposedApp,
  validateDefaultSystemConfig,
  type AgentDefinition,
  type DefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { SandboxExecutionRequest } from '@nextagent/agent-contracts/gateway';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import { createTraceProjector } from '@nextagent/agent-observability';
import { SpanKind } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';

const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('local-tenant'),
  subjectId: brand<string, 'SubjectId'>('local-subject'),
  displayName: 'Local developer',
};
const spanExporter = new InMemorySpanExporter();
const traceProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
traceProvider.register();
const tracer = traceProvider.getTracer('timeline-correlation-integration');
const TASK_CALLBACK_ORIGIN = 'https://callback.example';

describe('task timeline trace correlation', () => {
  beforeEach(() => {
    spanExporter.reset();
  });

  it('keeps an accepted two-node workflow active and reconstructs its controlled span hierarchy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-timeline-correlation-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    let releaseModel: (() => void) | undefined;
    const modelGate = new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'trace-two-node.yaml'), JSON.stringify(twoNodeRecipe()), 'utf8');
      app = createTraceApp(root, {
        async complete() {
          await modelGate;
          return { content: 'alarm diagnosed' };
        },
        stream: modelEventStreamFixture(async function* () {
          yield { content: 'alarm diagnosed' };
        }),
      });

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/async-tasks',
        headers: {
          traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
          'x-tenant-id': identity.tenantId,
          'x-subject-id': identity.subjectId,
        },
        payload: {
          tasks: [
            {
              taskMessages: [
                {
                  text: '$workflow:trace-two-node diagnose alarm',
                  metadata: { eventId: 'event.workflow.01' },
                },
              ],
              callbackTarget: { url: `${TASK_CALLBACK_ORIGIN}/tasks/trace-two-node` },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const control = response.json<{ results: ReadonlyArray<{ readonly sessionId: string; readonly taskId: string }> }>().results[0]!;
      const accepted = {
        sessionId: control.sessionId,
        runId: await waitForRequestRunId(app, control.sessionId, control.taskId),
      };
      await waitForTimelineType(app, accepted.sessionId, accepted.runId, 'CAPABILITY_STARTED');
      expect(finishedExecutionSpans('event.workflow.01').some((span) => span.attributes['nextagent.observation_type'] === 'request')).toBe(false);

      releaseModel?.();
      await waitForRunTerminal(app, accepted!.runId);
      const events = await listRunEvents(app, accepted!.sessionId, accepted!.runId);
      const acceptedEvent = requireEvent(events, 'REQUEST_ACCEPTED');
      const requestTrace = requireTrace(acceptedEvent.inlinePayload);
      const nodeStarts = events.filter((event) => event.type === 'CAPABILITY_STARTED' && typeof event.inlinePayload['nodeExecutionId'] === 'string');
      expect(nodeStarts).toHaveLength(2);
      const firstNodeTrace = requireTrace(nodeStarts[0]!.inlinePayload);
      const secondNodeTrace = requireTrace(nodeStarts[1]!.inlinePayload);

      expect(requestTrace).toMatchObject({
        traceId: '11111111111111111111111111111111',
        parentSpanId: '2222222222222222',
      });
      expect(firstNodeTrace).toMatchObject({
        parentSpanId: requestTrace.spanId,
        previewSpanIds: [],
      });
      expect(secondNodeTrace).toMatchObject({
        parentSpanId: requestTrace.spanId,
        previewSpanIds: [firstNodeTrace.spanId],
      });
      expect(events.some((event) => event.type.startsWith('MODEL_INVOCATION_'))).toBe(false);
      expect(
        [acceptedEvent, ...nodeStarts, requireEvent(events, 'REQUEST_COMPLETED')].every(
          (event) => (event.inlinePayload['attributes'] as JsonObject | undefined)?.eventId === 'event.workflow.01',
        ),
      ).toBe(true);
      expect(finishedExecutionSpans('event.workflow.01')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            attributes: expect.objectContaining({
              'nextagent.observation_type': 'request',
              eventId: 'event.workflow.01',
            }),
          }),
          expect.objectContaining({
            attributes: expect.objectContaining({
              'nextagent.observation_type': 'workflow_node',
              eventId: 'event.workflow.01',
            }),
          }),
        ]),
      );
      expect(finishedExecutionSpans('event.workflow.01').some((span) => span.attributes['nextagent.observation_type'] === 'model')).toBe(false);
      expect(finishedExecutionSpans('event.workflow.01').some((span) => span.kind === SpanKind.SERVER)).toBe(false);
    } finally {
      releaseModel?.();
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('propagates the ext_api workflow node trace and eventId to the weather_query CLIP call', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-weather-query-correlation-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    const sandboxRequests: SandboxExecutionRequest[] = [];
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'demo_recipe.yaml'), JSON.stringify(weatherQueryRecipe()), 'utf8');
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root, { withWeatherQueryClipProvider: true }),
          agentDefinition: createAgentDefinition({ withWeatherQueryClipBinding: true }),
          credentialResolver: credentialResolver(),
          traceProjector: createTraceProjector({ tracer }),
          sandboxGateway: {
            async execute(request) {
              sandboxRequests.push(request);
              return successfulSandboxResult(request);
            },
          },
        },
        {
          async complete() {
            return { content: '天气晴朗，适合出行。' };
          },
          stream: modelEventStreamFixture(async function* () {
            yield { content: '天气晴朗，适合出行。' };
          }),
        },
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/async-tasks',
        headers: {
          traceparent: '00-33333333333333333333333333333333-4444444444444444-01',
          'x-tenant-id': identity.tenantId,
          'x-subject-id': identity.subjectId,
        },
        payload: {
          tasks: [
            {
              taskMessages: [
                {
                  text: '$workflow:demo_recipe 上海天气怎么样？',
                  metadata: { eventId: 'weather.trace.01' },
                },
              ],
              callbackTarget: { url: `${TASK_CALLBACK_ORIGIN}/tasks/weather-query` },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const control = response.json<{ results: ReadonlyArray<{ readonly sessionId: string; readonly taskId: string }> }>().results[0]!;
      const accepted = {
        sessionId: control.sessionId,
        runId: await waitForRequestRunId(app, control.sessionId, control.taskId),
      };
      await waitForRunTerminal(app, accepted.runId);

      const events = await listRunEvents(app, accepted.sessionId, accepted.runId);
      const acceptedTrace = requireTrace(requireEvent(events, 'REQUEST_ACCEPTED').inlinePayload);
      const nodeStarts = events.filter((event) => event.type === 'CAPABILITY_STARTED' && typeof event.inlinePayload['nodeExecutionId'] === 'string');
      const extApiStart = nodeStarts.find((event) => event.inlinePayload['nodeId'] === 'ext_api');
      const lastLlmStart = nodeStarts.find((event) => event.inlinePayload['nodeId'] === 'last_llm');
      expect(extApiStart).toBeDefined();
      expect(lastLlmStart).toBeDefined();
      if (extApiStart === undefined || lastLlmStart === undefined) {
        throw new Error('Weather workflow did not emit both real node starts.');
      }
      const extApiTrace = requireTrace(extApiStart.inlinePayload);
      const lastLlmTrace = requireTrace(lastLlmStart.inlinePayload);

      expect(extApiTrace).toMatchObject({
        parentSpanId: acceptedTrace.spanId,
        previewSpanIds: [],
      });
      expect(lastLlmTrace).toMatchObject({
        parentSpanId: acceptedTrace.spanId,
        previewSpanIds: [extApiTrace.spanId],
      });
      expect(events.some((event) => event.type.startsWith('MODEL_INVOCATION_'))).toBe(false);

      const clipRequest = sandboxRequests.find((request) => request.args[0] === 'query');
      expect(clipRequest).toBeDefined();
      if (clipRequest === undefined) {
        throw new Error('Weather workflow did not invoke the CLIP query.');
      }
      expect(clipRequest.args.slice(0, 3)).toEqual(['query', 'weather_query', '/weather_query']);
      const clipHeaders = readClipHeaders(clipRequest);
      expect(clipHeaders['x-task-event-id']).toBe('weather.trace.01');
      expect(clipHeaders.traceparent).toBe(`00-${extApiTrace.traceId}-${extApiTrace.spanId}-01`);
      expect(nodeStarts).toHaveLength(2);
      expect(
        events.filter(
          (event) =>
            event.type === 'CAPABILITY_STARTED' &&
            typeof event.inlinePayload['toolCallId'] === 'string' &&
            typeof event.inlinePayload['nodeExecutionId'] !== 'string',
        ),
      ).toHaveLength(0);
      expect(
        events.filter(
          (event) =>
            event.type === 'CAPABILITY_COMPLETED' &&
            typeof event.inlinePayload['toolCallId'] === 'string' &&
            typeof event.inlinePayload['nodeExecutionId'] !== 'string',
        ),
      ).toHaveLength(0);
      const acceptedSequence = requireEvent(events, 'REQUEST_ACCEPTED').sequence;
      expect(
        events
          .filter(
            (event) =>
              event.sequence >= acceptedSequence &&
              event.type !== 'HOOK_INVOKED' &&
              (event.inlinePayload['attributes'] as JsonObject | undefined)?.eventId !== 'weather.trace.01',
          )
          .map((event) => event.type),
      ).toEqual([]);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists every parallel branch span as a join-node preview predecessor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-parallel-preview-correlation-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'parallel-preview.yaml'), parallelPreviewRecipeYaml(), 'utf8');
      app = createTraceApp(root, {
        async complete() {
          return { content: 'unused' };
        },
        stream: modelEventStreamFixture(async function* () {
          yield { content: 'unused' };
        }),
      });

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/async-tasks',
        headers: {
          traceparent: '00-55555555555555555555555555555555-6666666666666666-01',
          'x-tenant-id': identity.tenantId,
          'x-subject-id': identity.subjectId,
        },
        payload: {
          tasks: [
            {
              taskMessages: [
                {
                  text: '$workflow:parallel-preview verify parallel predecessors',
                  metadata: { eventId: 'event.parallel.join.01' },
                },
              ],
              callbackTarget: { url: `${TASK_CALLBACK_ORIGIN}/tasks/parallel-preview` },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const control = response.json<{ results: ReadonlyArray<{ readonly sessionId: string; readonly taskId: string }> }>().results[0]!;
      const accepted = {
        sessionId: control.sessionId,
        runId: await waitForRequestRunId(app, control.sessionId, control.taskId),
      };
      await waitForRunTerminal(app, accepted.runId);

      const events = await listRunEvents(app, accepted.sessionId, accepted.runId);
      const requestTrace = requireTrace(requireEvent(events, 'REQUEST_ACCEPTED').inlinePayload);
      const nodeStarts = events.filter((event) => event.type === 'CAPABILITY_STARTED' && typeof event.inlinePayload['nodeExecutionId'] === 'string');
      const tracesByNodeId = new Map(nodeStarts.map((event) => [String(event.inlinePayload['nodeId']), requireTrace(event.inlinePayload)]));
      const forkTrace = tracesByNodeId.get('fork');
      const branchATrace = tracesByNodeId.get('branch_a');
      const branchBTrace = tracesByNodeId.get('branch_b');
      const joinTrace = tracesByNodeId.get('join');
      expect(forkTrace).toBeDefined();
      expect(branchATrace).toBeDefined();
      expect(branchBTrace).toBeDefined();
      expect(joinTrace).toBeDefined();
      if (forkTrace === undefined || branchATrace === undefined || branchBTrace === undefined || joinTrace === undefined) {
        throw new Error('Parallel workflow did not emit every real node start.');
      }

      expect(forkTrace).toMatchObject({
        parentSpanId: requestTrace.spanId,
        previewSpanIds: [],
      });
      expect(branchATrace).toMatchObject({
        parentSpanId: requestTrace.spanId,
        previewSpanIds: [forkTrace.spanId],
      });
      expect(branchBTrace).toMatchObject({
        parentSpanId: requestTrace.spanId,
        previewSpanIds: [forkTrace.spanId],
      });
      expect(joinTrace).toMatchObject({
        parentSpanId: requestTrace.spanId,
        previewSpanIds: [branchATrace.spanId, branchBTrace.spanId],
      });
      expect(new Set([forkTrace.spanId, branchATrace.spanId, branchBTrace.spanId, joinTrace.spanId]).size).toBe(4);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('isolates batch eventIds under one upstream trace and preserves valid items around an invalid item', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-timeline-batch-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      app = createTraceApp(root, {
        async complete() {
          return { content: 'ok' };
        },
        stream: modelEventStreamFixture(async function* () {
          yield { content: 'ok' };
        }),
      });
      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/async-tasks',
        headers: {
          traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
          'x-tenant-id': identity.tenantId,
          'x-subject-id': identity.subjectId,
        },
        payload: {
          tasks: [
            {
              taskMessages: [{ text: 'first', metadata: { eventId: 'batch.event.01' } }],
              callbackTarget: { url: `${TASK_CALLBACK_ORIGIN}/tasks/first` },
            },
            {
              taskMessages: [{ text: 'invalid', metadata: { eventId: 'invalid/event' } }],
              callbackTarget: { url: `${TASK_CALLBACK_ORIGIN}/tasks/invalid` },
            },
            {
              taskMessages: [{ text: 'second', metadata: { eventId: 'batch.event.02' } }],
              callbackTarget: { url: `${TASK_CALLBACK_ORIGIN}/tasks/second` },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const results = response.json<{
        results: ReadonlyArray<{
          readonly sessionId?: string;
          readonly taskId?: string;
          readonly error?: { readonly code: string };
        }>;
      }>().results;
      expect(results[1]?.error?.code).toBe('REQUEST_VALIDATION_FAILED');
      const successful = [results[0], results[2]];
      expect(successful.every((result) => result?.sessionId !== undefined && result.taskId !== undefined)).toBe(true);
      const acceptedRuns = await Promise.all(
        successful.map(async (result) => ({
          sessionId: result!.sessionId!,
          runId: await waitForRequestRunId(app!, result!.sessionId!, result!.taskId!),
        })),
      );
      await Promise.all(acceptedRuns.map((result) => waitForRunTerminal(app!, result.runId)));

      const acceptedEvents = await Promise.all(
        acceptedRuns.map(async (result) => requireEvent(await listRunEvents(app!, result.sessionId, result.runId), 'REQUEST_ACCEPTED')),
      );
      const traces = acceptedEvents.map((event) => requireTrace(event.inlinePayload));
      expect(traces.map((trace) => trace.traceId)).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
      expect(traces[0]!.spanId).not.toBe(traces[1]!.spanId);
      expect(acceptedEvents.map((event) => (event.inlinePayload['attributes'] as JsonObject | undefined)?.eventId)).toEqual([
        'batch.event.01',
        'batch.event.02',
      ]);
      expect(finishedExecutionSpans('batch.event.01')).not.toHaveLength(0);
      expect(finishedExecutionSpans('batch.event.02')).not.toHaveLength(0);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createTraceApp(root: string, model: ModelInvocationService) {
  return createComposedApp(
    {
      identity,
      systemConfig: createSystemConfig(root),
      agentDefinition: createAgentDefinition(),
      credentialResolver: credentialResolver(),
      traceProjector: createTraceProjector({ tracer }),
    },
    model,
  );
}

function createSystemConfig(root: string, options: { readonly withWeatherQueryClipProvider?: boolean } = {}): DefaultSystemConfig {
  return validateDefaultSystemConfig(
    {
      deployment: { mode: 'LOCAL' },
      paths: { workspaceRoot: 'workspaces', logDirectory: 'logs' },
      observability: {
        tracing: { enabled: true },
        logging: { console: { enabled: false }, file: { enabled: false } },
      },
      auth: {
        mode: 'local',
        localIdentity: {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          displayName: identity.displayName,
        },
      },
      channel: { transport: 'fastify', host: '127.0.0.1', port: 3000 },
      taskCallback: {
        allowedOrigins: [TASK_CALLBACK_ORIGIN],
        timeoutMs: 100,
        maxRetries: 1,
      },
      hostedAgent: { activeAgentId: agentId },
      modelProfiles: [
        {
          providerId: 'openai-compatible',
          baseUrl: 'https://model.example.test/v1',
          credentialRef: 'env:OPENAI_API_KEY',
          models: [
            {
              modelId: 'test-model',
              displayName: 'Test Model',
              contextWindowTokens: 128_000,
              fallbackEligible: false,
              timeoutMs: 30_000,
            },
          ],
        },
      ],
      gateway: {
        gateways: [
          { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
          {
            gatewayId: 'local-sqlite',
            gatewayKind: 'sqlite',
            deploymentMode: 'LOCAL',
            sqliteFileRef: 'paths.sqliteFile',
          },
          { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
        ],
      },
      ...(options.withWeatherQueryClipProvider === true
        ? {
            nextAgent: {
              system: {
                'capability-providers': [
                  {
                    id: 'clip-backed',
                    type: 'custom',
                    adapter: 'clip_server',
                    config: {
                      enabled: true,
                      clipPathRef: 'clipc',
                      endpointRef: 'clip-daemon',
                      timeoutMs: 5_000,
                      retry: { maxAttempts: 1 },
                    },
                  },
                ],
              },
            },
          }
        : {}),
      noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
    },
    root,
    { credentialResolver: credentialResolver() },
  );
}

function createAgentDefinition(options: { readonly withWeatherQueryClipBinding?: boolean } = {}): AgentDefinition {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    displayName: 'Timeline correlation agent',
    description: 'Timeline correlation integration agent.',
    modelIds: ['test-model'],
    capabilityBindings:
      options.withWeatherQueryClipBinding === true
        ? [
            {
              capabilityId: brand<string, 'CapabilityId'>('weather_query'),
              capabilityType: 'TOOL',
              providerId: 'clip-backed',
              enabled: true,
            },
          ]
        : [],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',
      requestTimeoutMs: 30_000,
    },
    resources: [],
  };
}

function twoNodeRecipe() {
  return {
    name: 'trace-two-node',
    version: 'v1',
    description: 'two node trace recipe',
    nodes: {
      start: {
        type: 'start-event',
        next: { diagnose: { condition: '' } },
      },
      diagnose: {
        type: 'llm-router',
        inputs: {
          prompt: 'Diagnose the alarm.',
          prompt_template: 'Return a concise telecom alarm diagnosis.',
        },
        outputs: { diagnosis: '${llm_completion}' },
        next: { show: { condition: '' } },
      },
      show: {
        type: 'display-content',
        inputs: { content: '${diagnosis}' },
        outputs: { message: '${display_content}' },
        next: { end: { condition: '' } },
      },
      end: { type: 'end-event' },
    },
  };
}

function weatherQueryRecipe() {
  return {
    name: 'demo_recipe',
    description: 'demo desc',
    domain: 'NAIE',
    scene: 'demo',
    type: 'boot-recipe',
    version: '1.1.0',
    expandFields: {
      recipe_ne_version: 1,
      recipe_ne_type: 'xxx',
    },
    nodes: {
      start_node: {
        type: 'start-event',
        description: '开始处理您的问题',
        next: {
          ext_api: { condition: '' },
        },
      },
      ext_api: {
        type: 'restful',
        description: '查询天气接口',
        inputs: {
          api_name: 'weather_query',
        },
        outputs: {
          elementVariables: '${api_response}',
        },
        next: {
          last_llm: {
            condition: '${elementVariables[0] == "晴"}',
          },
          end_node: {
            condition: '${elementVariables[0] != "晴"}',
          },
        },
      },
      last_llm: {
        type: 'llm-router',
        description: '总结天气，给出建议',
        inputs: {
          llm_type: 'NetGPT',
          prompt_template: '请根据天气状态：${elementVariables}，和用户的问题：${input_question}，给出出行建议。',
        },
        outputs: {
          result: '${llm_completion}',
        },
        next: {
          end_node: { condition: '' },
        },
      },
      end_node: {
        type: 'end-event',
        description: 'this is a end node.',
      },
    },
  };
}

function parallelPreviewRecipeYaml(): string {
  return [
    'name: parallel-preview',
    'description: Verify multiple workflow preview span ids.',
    'domain: NAIE',
    'scene: trace-validation',
    'type: boot-recipe',
    'version: 1.0.0',
    'nodes:',
    '  start:',
    '    type: "start-event"',
    '    next:',
    '      fork:',
    '        condition: ""',
    '  fork:',
    '    type: "parallel-gateway"',
    '    description: "Fork two independent branches."',
    '    inputs:',
    '      join_node: "join"',
    '    next:',
    '      branch_a:',
    '        condition: ""',
    '      branch_b:',
    '        condition: ""',
    '  branch_a:',
    '    type: "display-content"',
    '    description: "Complete branch A."',
    '    outputs:',
    '      branch_a_result: "A"',
    '    next:',
    '      join:',
    '        condition: ""',
    '  branch_b:',
    '    type: "display-content"',
    '    description: "Complete branch B."',
    '    outputs:',
    '      branch_b_result: "B"',
    '    next:',
    '      join:',
    '        condition: ""',
    '  join:',
    '    type: "display-content"',
    '    description: "Join both branches."',
    '    outputs:',
    '      result: "joined"',
    '    next:',
    '      end:',
    '        condition: ""',
    '  end:',
    '    type: "end-event"',
    '',
  ].join('\n');
}

function successfulSandboxResult(request: SandboxExecutionRequest) {
  const command = request.args[0];
  const traceParameters = [
    { name: 'traceparent', location: 'header', required: false },
    { name: 'tracestate', location: 'header', required: false },
    { name: 'x-task-event-id', location: 'header', required: false },
  ];
  let stdout: string;
  if (command === 'list') {
    stdout = JSON.stringify({
      items: [
        {
          target: 'weather_query',
          ref: '/weather_query',
          operation: 'query',
          status: 'enabled',
          params: traceParameters,
        },
      ],
    });
  } else if (command === 'describe') {
    stdout = JSON.stringify({
      data: {
        structured: {
          capabilities: [
            {
              target_id: 'weather_query',
              ref_template: '/weather_query',
              operation: 'query',
              body_required: false,
              params: traceParameters,
              responses: [
                {
                  status: '200',
                  description: 'Weather query response.',
                  content_types: ['application/json'],
                },
              ],
            },
          ],
        },
      },
    });
  } else if (command === 'query') {
    stdout = JSON.stringify({
      '0': '晴',
      description: '上海天气晴朗',
    });
  } else {
    throw new Error(`Unexpected CLIP command: ${command ?? 'missing'}.`);
  }
  return {
    executionId: request.executionId,
    exitCode: 0,
    stdout,
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false,
    durationMs: 5,
  };
}

function readClipHeaders(request: SandboxExecutionRequest): Readonly<Record<string, string>> {
  const paramsIndex = request.args.indexOf('--params');
  if (paramsIndex < 0 || request.args[paramsIndex + 1] === undefined) {
    throw new Error('CLIP request does not contain --params.');
  }
  const serializedParams = request.args[paramsIndex + 1];
  if (serializedParams === undefined) {
    throw new Error('CLIP request params are unavailable.');
  }
  const parsed = JSON.parse(serializedParams) as {
    readonly header?: Readonly<Record<string, string>>;
  };
  if (parsed.header === undefined) {
    throw new Error('CLIP request does not contain params.header.');
  }
  return parsed.header;
}

function credentialResolver() {
  return createAppCredentialResolver({ OPENAI_API_KEY: 'test-only' });
}

async function waitForRunTerminal(app: ReturnType<typeof createComposedApp>, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(runId),
    });
    if (run !== undefined && (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELED' || run.status === 'SUPERSEDED')) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for run ${runId}.`);
}

async function waitForRequestRunId(app: ReturnType<typeof createComposedApp>, sessionId: string, requestId: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const snapshot = await app.gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(sessionId),
    });
    const run = [snapshot.latestRun, snapshot.executingRun, snapshot.terminalPendingRun, ...snapshot.queuedRuns].find(
      (candidate) => candidate?.requestId === brand<string, 'MessageId'>(requestId),
    );
    if (run !== undefined) {
      return String(run.runId);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out resolving run for request ${requestId}.`);
}

async function waitForTimelineType(app: ReturnType<typeof createComposedApp>, sessionId: string, runId: string, type: string): Promise<void> {
  let observedEvents: readonly string[] = [];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const events = await listRunEvents(app, sessionId, runId);
    observedEvents = events.map((event) => `${event.type}:${JSON.stringify(event.inlinePayload)}`);
    if (events.some((event) => event.type === type)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for timeline event ${type}; observed ${observedEvents.join(',')}.`);
}

function listRunEvents(app: ReturnType<typeof createComposedApp>, sessionId: string, runId: string) {
  return app.gateway.timeline.listEvents({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId: brand<string, 'SessionId'>(sessionId),
    runId: brand<string, 'RequestRunId'>(runId),
    afterSequence: brand<number, 'TimelineSequence'>(0),
    limit: 100,
  });
}

function requireEvent<T extends Awaited<ReturnType<typeof listRunEvents>>[number]>(events: readonly T[], type: string): T {
  const event = events.find((candidate) => candidate.type === type);
  if (event === undefined) {
    throw new Error(`Missing timeline event ${type}.`);
  }
  return event;
}

function requireTrace(payload: JsonObject): {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly previewSpanIds?: readonly string[];
} {
  const value = payload['trace'];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Timeline trace payload is missing.');
  }
  return value as {
    readonly traceId: string;
    readonly spanId: string;
    readonly parentSpanId?: string;
    readonly previewSpanIds?: readonly string[];
  };
}

function finishedExecutionSpans(eventId: string) {
  return spanExporter.getFinishedSpans().filter((span) => span.attributes.eventId === eventId);
}
