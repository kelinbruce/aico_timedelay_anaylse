import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import {
  createAppCredentialResolver,
  createComposedApp,
  validateDefaultSystemConfig,
  type AgentDefinition,
  type DefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type { OperationalLogWriter } from '@nextagent/agent-log';
import type { RecipeDefinition, WorkflowExecutionRequest, WorkflowExecutionService } from '@nextagent/agent-contracts/core';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { RuntimeLifecycleHookExecutor } from '@nextagent/agent-runtime';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('local-tenant'),
  subjectId: brand<string, 'SubjectId'>('local-subject'),
  displayName: 'Local developer',
};

describe('workflow package composition', () => {
  it('does not populate recipeIds on assembly (recipes discovered at runtime via default-enabled provider)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-recipe-snapshot-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'ran-alarm-diagnosis.yaml'),
        JSON.stringify(recipe('ran-alarm-diagnosis', 'v2')),
        'utf8',
      );
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'ran-capacity-triage.yaml'),
        JSON.stringify(recipe('ran-capacity-triage', 'v1')),
        'utf8',
      );

      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionServiceFactory: () => workflowService([]),
        },
        captureModel([]),
      );

      expect((await app.assemblyRegistry.active(agentId)).recipeIds).toBeUndefined();
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('registers recipes that use the supported parallel gateway during composition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-parallel-load-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'parallel-only.yaml'),
        JSON.stringify(parallelRecipe('parallel-only', 'v1')),
        'utf8',
      );
      const warnings: Array<{ readonly obj: object; readonly msg?: string }> = [];
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          operationalLogWriter: captureOperationalLogWriter(warnings),
          workflowExecutionServiceFactory: () => workflowService([]),
        },
        captureModel([]),
      );

      expect((await app.assemblyRegistry.active(agentId)).recipeIds).toBeUndefined();
      expect(JSON.stringify(warnings)).not.toContain('WORKFLOW_RECIPE_UNSUPPORTED_PARALLEL_GATEWAY');
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('registers recipes that use the inclusive gateway during composition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-inclusive-load-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'inclusive-only.yaml'),
        JSON.stringify(inclusiveRecipe('inclusive-only', 'v1')),
        'utf8',
      );
      const warnings: Array<{ readonly obj: object; readonly msg?: string }> = [];
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          operationalLogWriter: captureOperationalLogWriter(warnings),
          workflowExecutionServiceFactory: () => workflowService([]),
        },
        captureModel([]),
      );

      expect((await app.assemblyRegistry.active(agentId)).recipeIds).toBeUndefined();
      expect(JSON.stringify(warnings)).not.toContain('WORKFLOW_RECIPE_INVALID');
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('emits deprecation warnings for deprecated node types during recipe lazy load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-deprecated-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'deprecated-nodes.yaml'),
        JSON.stringify({
          name: 'deprecated-nodes',
          version: 'v1',
          description: 'deprecated node types',
          nodes: {
            start: { type: 'start-event', next: { agent: { condition: '' } } },
            agent: { type: 'agent', next: { end: { condition: '' } } },
            end: { type: 'end-event' },
          },
        }),
        'utf8',
      );
      const warnings: Array<{ readonly obj: object; readonly msg?: string }> = [];
      const executed: WorkflowExecutionRequest[] = [];
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          operationalLogWriter: captureOperationalLogWriter(warnings),
          workflowExecutionServiceFactory: () => workflowService(executed),
        },
        captureModel([]),
      );

      expect((await app.assemblyRegistry.active(agentId)).recipeIds).toBeUndefined();

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:deprecated-nodes run deprecated workflow',
          idempotencyKey: 'idem-workflow-deprecated',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ sessionId: string; requestId: string; runId: string }>();
      await waitForRunTerminal(app, body.runId);

      const deprecatedWarnings = JSON.stringify(warnings);
      expect(deprecatedWarnings).toContain('WORKFLOW_NODE_DEPRECATED');
      expect(deprecatedWarnings).toContain('AGENT');
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads restful recipes with snake_case batch fields without rejection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-batch-snake-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'batch-snake.yaml'),
        JSON.stringify({
          name: 'batch-snake',
          version: 'v1',
          description: 'snake_case batch fields',
          nodes: {
            start: { type: 'start-event', next: { api: { condition: '' } } },
            api: {
              type: 'restful',
              inputs: {
                api_name: 'alarm_query',
                batch_input_data_item: [{ ne_id: 'NE-1' }, { ne_id: 'NE-2' }],
                batch_element_variable: 'element',
                batch_size: 2,
                batch_mode: 'serial',
                batch_fail_strategy: 'continue',
                batch_result_merge: 'append',
              },
              next: { end: { condition: '' } },
            },
            end: { type: 'end-event' },
          },
        }),
        'utf8',
      );
      const warnings: Array<{ readonly obj: object; readonly msg?: string }> = [];
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          operationalLogWriter: captureOperationalLogWriter(warnings),
          workflowExecutionServiceFactory: () => workflowService([]),
        },
        captureModel([]),
      );

      expect((await app.assemblyRegistry.active(agentId)).recipeIds).toBeUndefined();
      expect(JSON.stringify(warnings)).not.toContain('WORKFLOW_RECIPE_INVALID');
      expect(JSON.stringify(warnings)).not.toContain('WORKFLOW_RECIPE_PARSE_FAILED');
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads agent-scoped recipe roots and routes targetRecipe into the workflow service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-composition-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'ran-alarm-diagnosis.yaml'),
        JSON.stringify(recipe('ran-alarm-diagnosis', 'v2')),
        'utf8',
      );
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'ran-capacity-triage.yaml'),
        JSON.stringify(recipe('ran-capacity-triage', 'v1')),
        'utf8',
      );
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'invalid.yaml'), '{"recipeName":1}', 'utf8');

      const executed: WorkflowExecutionRequest[] = [];
      const modelCalls: ModelInvocationRequest[] = [];
      const warnings: Array<{ readonly obj: object; readonly msg?: string }> = [];
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          operationalLogWriter: captureOperationalLogWriter(warnings),
          workflowExecutionServiceFactory: () => workflowService(executed),
        },
        captureModel(modelCalls),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:ran-alarm-diagnosis run workflow',
          idempotencyKey: 'idem-workflow-route',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ sessionId: string; requestId: string; runId: string }>();
      await waitForRunTerminal(app, body.runId);
      const messages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        requestId: brand<string, 'MessageId'>(body.requestId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        includeHidden: false,
        offset: 0,
        limit: 20,
      });
      expect(executed).toHaveLength(1);
      expect(executed[0]).toMatchObject({
        recipeName: 'ran-alarm-diagnosis',
        recipeVersion: 'v2',
        agentId: 'default-agent',
        inputText: 'run workflow',
        inputVariables: {},
      });
      expect((await app.assemblyRegistry.active(agentId)).recipeIds).toBeUndefined();
      expect(messages.items.some((item) => item.role === 'ASSISTANT' && item.content === 'workflow completed')).toBe(true);
      expect(modelCalls).toHaveLength(0);
      expect(warnings.some((entry) => JSON.stringify(entry.obj).includes('WORKFLOW_RECIPE_INVALID'))).toBe(true);
      expect(JSON.stringify(warnings)).not.toContain(root);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps Direct Workflow product-process events out of active context and later provider input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-product-process-context-'));
    const productProcessMarker = 'WORKFLOW-PRODUCT-PROCESS-PIU-MUST-NOT-ENTER-MODEL-CONTEXT';
    const modelCalls: ModelInvocationRequest[] = [];
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'product-process.yaml'),
        JSON.stringify({
          name: 'product-process',
          version: 'v1',
          description: 'product process context isolation',
          nodes: {
            start: { type: 'start-event', next: { renderResult: { condition: '' } } },
            renderResult: { type: 'display-content', next: { end: { condition: '' } } },
            end: { type: 'end-event' },
          },
        }),
        'utf8',
      );
      let workflowExecutionCount = 0;
      const workflowExecutionService: WorkflowExecutionService = {
        async execute(_request, _signal, observer) {
          workflowExecutionCount += 1;
          const executionId = `workflow-execution-product-process-${workflowExecutionCount}`;
          const startedAt = new Date('2026-06-23T00:00:00.000Z');
          const completedAt = new Date('2026-06-23T00:00:01.000Z');
          if (workflowExecutionCount === 1) {
            await observer?.emitEvent({
              executionId,
              nodeExecutionId: `${executionId}:renderResult:0`,
              nodeId: 'renderResult',
              nodeType: 'DISPLAY',
              eventType: 'NODE_COMPLETED',
              output: {
                level: 'answer',
                type: 'PIU',
                content: {
                  piuName: 'ranDiagnosis',
                  piuVersion: '1.0.0',
                  marker: productProcessMarker,
                },
              },
              retryCount: 0,
              startedAt,
              completedAt,
            });
          }
          return {
            executionId,
            status: 'COMPLETED',
            outputVariables: { message: 'workflow completed without exposing product process' },
            nodeResults: [],
            startedAt,
            completedAt,
          };
        },
      };
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionServiceFactory: () => workflowExecutionService,
        },
        captureModel(modelCalls),
      );

      const workflowResponse = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:product-process run workflow with a product PIU',
          idempotencyKey: 'idem-workflow-product-process',
        },
      });
      expect(workflowResponse.statusCode, workflowResponse.body).toBe(200);
      const workflowBody = workflowResponse.json<{ sessionId: string; requestId: string; runId: string }>();
      await waitForRunTerminal(app, workflowBody.runId);

      const events = await app.gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(workflowBody.sessionId),
        runId: brand<string, 'RequestRunId'>(workflowBody.runId),
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });
      const productProcessEvent = events.find(
        (event) => event.type === 'TOOL_STRUCTURED_DELTA' && JSON.stringify(event.inlinePayload).includes(productProcessMarker),
      );
      expect(productProcessEvent?.inlinePayload).toMatchObject({
        capabilityId: 'renderResult',
        toolCallId: 'workflow:workflow-execution-product-process-1:renderResult',
        workflowEventType: 'NODE_COMPLETED',
        nodeExecutionId: 'workflow-execution-product-process-1:renderResult:0',
        nodeId: 'renderResult',
        nodeType: 'DISPLAY',
        toolEventType: 'ANSWER',
        toolMessageType: 'PIU',
        accumulated: true,
      });

      const workflowMessages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(workflowBody.sessionId),
        requestId: brand<string, 'MessageId'>(workflowBody.requestId),
        runId: brand<string, 'RequestRunId'>(workflowBody.runId),
        includeHidden: true,
        offset: 0,
        limit: 20,
      });
      expect(JSON.stringify(workflowMessages.items)).not.toContain(productProcessMarker);
      expect(workflowMessages.items.some((message) => message.role === 'CAPABILITY_RESULT')).toBe(false);
      const activeContext = await app.gateway.activeContext.loadActiveContext({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(workflowBody.sessionId),
      });
      const activeMessages = await Promise.all(
        activeContext.items.map((item) =>
          app!.gateway.messages.loadMessage({
            tenantId: identity.tenantId,
            subjectId: identity.subjectId,
            agentId,
            messageId: item.messageId,
          }),
        ),
      );
      expect(JSON.stringify(activeMessages)).toContain('workflow completed without exposing product process');
      expect(JSON.stringify(activeMessages)).not.toContain(productProcessMarker);
      expect(modelCalls).toHaveLength(0);

      const followUpResponse = await app.server.inject({
        method: 'POST',
        url: `/api/v1/sessions/${workflowBody.sessionId}/requests`,
        payload: {
          inputText: 'continue in the model loop',
          idempotencyKey: 'idem-workflow-product-process-follow-up',
        },
      });
      expect(followUpResponse.statusCode, followUpResponse.body).toBe(200);
      const followUpBody = followUpResponse.json<{ runId: string }>();
      await waitForRunTerminal(app, followUpBody.runId);
      const followUpModelCall = modelCalls.find((request) => request.invocationScope?.runId === followUpBody.runId);
      expect(followUpModelCall).toBeDefined();
      const renderedProviderInput = JSON.stringify(followUpModelCall?.messages ?? []);
      expect(renderedProviderInput).toContain('workflow completed without exposing product process');
      expect(renderedProviderInput).toContain('continue in the model loop');
      expect(renderedProviderInput).not.toContain(productProcessMarker);
      expect(renderedProviderInput).not.toContain('TOOL_STRUCTURED_DELTA');

      const controlWorkflowResponse = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:product-process run workflow with a product PIU',
          idempotencyKey: 'idem-workflow-product-process-control',
        },
      });
      expect(controlWorkflowResponse.statusCode, controlWorkflowResponse.body).toBe(200);
      const controlWorkflowBody = controlWorkflowResponse.json<{ sessionId: string; runId: string }>();
      await waitForRunTerminal(app, controlWorkflowBody.runId);
      const controlEvents = await app.gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(controlWorkflowBody.sessionId),
        runId: brand<string, 'RequestRunId'>(controlWorkflowBody.runId),
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });
      expect(JSON.stringify(controlEvents)).not.toContain(productProcessMarker);
      const controlFollowUpResponse = await app.server.inject({
        method: 'POST',
        url: `/api/v1/sessions/${controlWorkflowBody.sessionId}/requests`,
        payload: {
          inputText: 'continue in the model loop',
          idempotencyKey: 'idem-workflow-product-process-control-follow-up',
        },
      });
      expect(controlFollowUpResponse.statusCode, controlFollowUpResponse.body).toBe(200);
      const controlFollowUpBody = controlFollowUpResponse.json<{ runId: string }>();
      await waitForRunTerminal(app, controlFollowUpBody.runId);
      const controlModelCall = modelCalls.find((request) => request.invocationScope?.runId === controlFollowUpBody.runId);
      expect(controlModelCall).toBeDefined();
      expect(modelCalls).toHaveLength(2);
      expect(followUpModelCall?.messages).toEqual(controlModelCall?.messages);
      expect(followUpModelCall?.tools).toEqual(controlModelCall?.tools);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes supported recipe capability node types from the recipe DSL before execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-capability-dsl-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    let resolvedRecipe: RecipeDefinition | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'capability-chain.yaml'),
        JSON.stringify(capabilityDslRecipe('capability-chain', 'v1')),
        'utf8',
      );
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionServiceFactory: (options) => ({
            async execute(request) {
              resolvedRecipe = options.resolveRecipeDefinition(request);
              return {
                executionId: 'workflow-execution-capability-dsl',
                status: 'COMPLETED',
                outputVariables: { message: 'workflow completed' },
                nodeResults: [],
                startedAt: new Date('2026-06-23T00:00:00.000Z'),
                completedAt: new Date('2026-06-23T00:00:00.000Z'),
              };
            },
          }),
        },
        captureModel([]),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:capability-chain run capability workflow',
          idempotencyKey: 'idem-workflow-capability-dsl',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);
      expect(resolvedRecipe?.flowGraph.nodes).toMatchObject({
        start: { type: 'START' },
        askModel: { type: 'LLM_ROUTER' },
        chooseTool: { type: 'TOOL_CHOICE' },
        callApi: { type: 'RESTFUL' },
        runPython: { type: 'PYTHON' },
        callAgent: { type: 'AGENT' },
        callSkill: { type: 'SKILL' },
        callSubflow: { type: 'SUBFLOW' },
        wait: { type: 'DELAY' },
        end: { type: 'END' },
      });
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes supported recipe llm node types from the recipe DSL before execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-llm-dsl-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    let resolvedRecipe: RecipeDefinition | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'llm-chain.yaml'), JSON.stringify(llmDslRecipe('llm-chain', 'v1')), 'utf8');
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionServiceFactory: (options) => ({
            async execute(request) {
              resolvedRecipe = options.resolveRecipeDefinition(request);
              return {
                executionId: 'workflow-execution-llm-dsl',
                status: 'COMPLETED',
                outputVariables: { message: 'workflow completed' },
                nodeResults: [],
                startedAt: new Date('2026-06-23T00:00:00.000Z'),
                completedAt: new Date('2026-06-23T00:00:00.000Z'),
              };
            },
          }),
        },
        captureModel([]),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:llm-chain run llm workflow',
          idempotencyKey: 'idem-workflow-llm-dsl',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);
      expect(resolvedRecipe?.flowGraph.nodes).toMatchObject({
        start: { type: 'START' },
        route: { type: 'LLM_ROUTER' },
        classify: { type: 'INTENT_RECOGNITION' },
        rewrite: { type: 'QUESTION_REWRITING' },
        translate: { type: 'TRANSLATION' },
        analyze: { type: 'DATA_ANALYSIS' },
        extract: { type: 'PARAM_EXTRACT' },
        end: { type: 'END' },
      });
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes supported recipe interaction node types from the recipe DSL before execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-interaction-dsl-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    let resolvedRecipe: RecipeDefinition | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'interaction-chain.yaml'),
        JSON.stringify(interactionDslRecipe('interaction-chain', 'v1')),
        'utf8',
      );
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionServiceFactory: (options) => ({
            async execute(request) {
              resolvedRecipe = options.resolveRecipeDefinition(request);
              return {
                executionId: 'workflow-execution-interaction-dsl',
                status: 'COMPLETED',
                outputVariables: { message: 'workflow completed' },
                nodeResults: [],
                startedAt: new Date('2026-06-23T00:00:00.000Z'),
                completedAt: new Date('2026-06-23T00:00:00.000Z'),
              };
            },
          }),
        },
        captureModel([]),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:interaction-chain run interaction workflow',
          idempotencyKey: 'idem-workflow-interaction-dsl',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);
      expect(resolvedRecipe?.flowGraph.nodes).toMatchObject({
        start: { type: 'START' },
        askUser: { type: 'USER_CHECK' },
        showResult: { type: 'DISPLAY' },
        verify: { type: 'GUARDRAIL' },
        pause: { type: 'INTERRUPT' },
        end: { type: 'END' },
      });
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes supported recipe knowledge node types from the recipe DSL before execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-knowledge-dsl-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    let resolvedRecipe: RecipeDefinition | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'knowledge-chain.yaml'),
        JSON.stringify(knowledgeDslRecipe('knowledge-chain', 'v1')),
        'utf8',
      );
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionServiceFactory: (options) => ({
            async execute(request) {
              resolvedRecipe = options.resolveRecipeDefinition(request);
              return {
                executionId: 'workflow-execution-knowledge-dsl',
                status: 'COMPLETED',
                outputVariables: { message: 'workflow completed' },
                nodeResults: [],
                startedAt: new Date('2026-06-23T00:00:00.000Z'),
                completedAt: new Date('2026-06-23T00:00:00.000Z'),
              };
            },
          }),
        },
        captureModel([]),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:knowledge-chain run knowledge workflow',
          idempotencyKey: 'idem-workflow-knowledge-dsl',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);
      expect(resolvedRecipe?.flowGraph.nodes).toMatchObject({
        start: { type: 'START' },
        search: { type: 'KNOWLEDGE_SEARCH' },
        answer: { type: 'KNOWLEDGE_QA' },
        chooseApi: { type: 'API_CHOICE' },
        chooseRecipe: { type: 'RECIPE_CHOICE' },
        end: { type: 'END' },
      });
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('routes knowledge-search and knowledge-qa through bounded evidence without exposing raw full documents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-knowledge-search-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await mkdir(join(root, 'workspaces', 'kb'), { recursive: true });
      await mkdir(join(root, 'workspaces', 'shared-data'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'knowledge-search-qa.yaml'),
        JSON.stringify(knowledgeSearchQaRecipe('knowledge-search-qa', 'v1')),
        'utf8',
      );
      await writeFile(
        join(root, 'workspaces', 'kb', 'paging-guide.txt'),
        'Paging failure handling guide. Check paging congestion, RRC setup, and retry KPIs. This sentence is the safe evidence excerpt used by the workflow.',
        'utf8',
      );
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
        },
        {
          async complete(request) {
            if (request.invocationScope.operationId === 'workflow:answer') {
              return {
                content: JSON.stringify({
                  answer: 'Check paging congestion and RRC setup KPIs first.',
                  sourceRefs: ['kb/paging-guide.txt'],
                }),
              };
            }
            return { content: 'ok' };
          },
          stream: modelEventStreamFixture(async function* () {
            yield { content: 'ok', finishReason: 'stop' };
          }),
        },
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:knowledge-search-qa run workflow with knowledge search',
          idempotencyKey: 'idem-workflow-knowledge-search',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ requestId: string; runId: string; sessionId: string }>();
      await waitForRunTerminal(app, body.runId);
      const messages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        requestId: brand<string, 'MessageId'>(body.requestId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        includeHidden: true,
        offset: 0,
        limit: 20,
      });

      expect(
        messages.items.some(
          (message) => message.role === 'ASSISTANT' && message.content.includes('Check paging congestion and RRC setup KPIs first.'),
        ),
      ).toBe(true);
      expect(messages.items.some((message) => message.content.includes('Paging failure handling guide.'))).toBe(false);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps api-choice bounded to candidate selection without executing restful side effects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-api-choice-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'api-choice-display.yaml'),
        JSON.stringify(apiChoiceDisplayRecipe('api-choice-display', 'v1')),
        'utf8',
      );
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
        },
        {
          async complete(request) {
            if (request.invocationScope.operationId === 'workflow:chooseApi:api_choice') {
              return {
                content: '',
                toolCalls: [
                  {
                    toolCallId: 'api-choice-1',
                    toolName: 'query_incident',
                    arguments: { incidentId: 'INC-42' },
                  },
                ],
              };
            }
            return { content: 'ok' };
          },
          stream: modelEventStreamFixture(async function* () {
            yield { content: 'ok', finishReason: 'stop' };
          }),
        },
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:api-choice-display run workflow with api choice',
          idempotencyKey: 'idem-workflow-api-choice',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ requestId: string; runId: string; sessionId: string }>();
      await waitForRunTerminal(app, body.runId);
      const messages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        requestId: brand<string, 'MessageId'>(body.requestId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        includeHidden: true,
        offset: 0,
        limit: 20,
      });

      expect(messages.items.some((message) => message.role === 'ASSISTANT' && message.content === 'query_incident')).toBe(true);
      expect(messages.items.some((message) => message.role === 'CAPABILITY_RESULT')).toBe(false);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('routes recipe-choice output through DSL recipe_name into sub-recipe execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-recipe-choice-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'recipe-choice-parent.yaml'),
        JSON.stringify(recipeChoiceParentRecipe('recipe-choice-parent', 'v1')),
        'utf8',
      );
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'recipe-choice-child.yaml'),
        JSON.stringify(recipeChoiceChildRecipe('recipe-choice-child', 'v1')),
        'utf8',
      );
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
        },
        {
          async complete(request) {
            if (request.invocationScope.operationId === 'workflow:chooseRecipe:recipe_choice') {
              return {
                content: '',
                toolCalls: [
                  {
                    toolCallId: 'recipe-choice-1',
                    toolName: 'recipe-choice-child',
                    arguments: {},
                  },
                ],
              };
            }
            return { content: 'ok' };
          },
          stream: modelEventStreamFixture(async function* () {
            yield { content: 'ok', finishReason: 'stop' };
          }),
        },
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:recipe-choice-parent run workflow with recipe choice',
          idempotencyKey: 'idem-workflow-recipe-choice',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ requestId: string; runId: string; sessionId: string }>();
      await waitForRunTerminal(app, body.runId);
      const messages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        requestId: brand<string, 'MessageId'>(body.requestId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        includeHidden: true,
        offset: 0,
        limit: 20,
      });

      expect(messages.items.some((message) => message.role === 'ASSISTANT' && message.content === 'child:selected')).toBe(true);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('routes user-check waiting through runtime pending input and resumes the workflow without capability projection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-user-check-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'user-check-resume.yaml'),
        JSON.stringify(userCheckResumeRecipe('user-check-resume', 'v1')),
        'utf8',
      );
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
        },
        captureModel([]),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:user-check-resume run workflow with user-check',
          idempotencyKey: 'idem-workflow-user-check',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ requestId: string; runId: string; sessionId: string }>();
      const pending = await waitForPendingInput(app, body.sessionId);

      expect(pending).toMatchObject({
        producerRef: {
          kind: 'WORKFLOW_NODE',
          recipeName: 'user-check-resume',
          nodeId: 'askUser',
          nodeType: 'USER_CHECK',
        },
        status: 'PENDING',
      });

      await app.runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-workflow-user-check-answer'),
        answer: {
          sessionId: brand<string, 'SessionId'>(body.sessionId),
          pendingInputId: pending.pendingInputId,
          answers: [['approve']],
        },
      });

      await waitForRunTerminal(app, body.runId);
      const messages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        requestId: brand<string, 'MessageId'>(body.requestId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        includeHidden: true,
        offset: 0,
        limit: 20,
      });
      const events = await app.gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });

      expect(messages.items.some((message) => message.role === 'CAPABILITY_RESULT')).toBe(false);
      const terminalMessage = messages.items.find((message) => message.role === 'ASSISTANT');
      const terminalEvent = events.find((event) => event.type === 'REQUEST_COMPLETED');
      expect(terminalMessage?.content).toBe('approve');
      expect(terminalEvent?.inlinePayload.terminalMessageId).toBe(terminalMessage?.messageId);
      expect(terminalEvent?.inlinePayload).not.toHaveProperty('content');
      expect(events.some((event) => event.type === 'LLM_CONTENT_DELTA')).toBe(false);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('routes interrupt-gateway waiting through runtime pending input and resumes the workflow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-interrupt-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'interrupt-resume.yaml'),
        JSON.stringify(interruptResumeRecipe('interrupt-resume', 'v1')),
        'utf8',
      );
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
        },
        captureModel([]),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:interrupt-resume run workflow with interrupt',
          idempotencyKey: 'idem-workflow-interrupt',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ requestId: string; runId: string; sessionId: string }>();
      const pending = await waitForPendingInput(app, body.sessionId);

      expect(pending).toMatchObject({
        producerRef: {
          kind: 'WORKFLOW_NODE',
          recipeName: 'interrupt-resume',
          nodeId: 'pause',
          nodeType: 'INTERRUPT',
        },
        status: 'PENDING',
      });
      expect(pending.request).toMatchObject({
        kind: 'QUESTION',
        questions: [],
      });

      await app.runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-workflow-interrupt-answer'),
        answer: {
          sessionId: brand<string, 'SessionId'>(body.sessionId),
          pendingInputId: pending.pendingInputId,
          answers: [['resume']],
        },
      });

      await waitForRunTerminal(app, body.runId);
      const messages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        requestId: brand<string, 'MessageId'>(body.requestId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        includeHidden: true,
        offset: 0,
        limit: 20,
      });
      const events = await app.gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });

      expect(messages.items.some((message) => message.role === 'CAPABILITY_RESULT')).toBe(false);
      const terminalMessage = messages.items.find((message) => message.role === 'ASSISTANT');
      const terminalEvent = events.find((event) => event.type === 'REQUEST_COMPLETED');
      expect(terminalMessage?.content).toBe('resume:true');
      expect(terminalEvent?.inlinePayload.terminalMessageId).toBe(terminalMessage?.messageId);
      expect(terminalEvent?.inlinePayload).not.toHaveProperty('content');
      expect(events.some((event) => event.type === 'LLM_CONTENT_DELTA')).toBe(false);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('routes guardrail-check through the lifecycle hook boundary and blocks the protected path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-guardrail-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input) {
        if (input.hookId === 'telecom-guardrail') {
          return {
            outcome: 'DENY',
            safeReason: 'SENSITIVE_TERM_BLOCKED',
          };
        }
        return {};
      },
    };
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'guardrail-route.yaml'),
        JSON.stringify(guardrailRouteRecipe('guardrail-route', 'v1')),
        'utf8',
      );
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          lifecycleHook,
        },
        captureModel([]),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:guardrail-route run workflow with guardrail',
          idempotencyKey: 'idem-workflow-guardrail',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ requestId: string; runId: string; sessionId: string }>();
      await waitForRunTerminal(app, body.runId);
      const messages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        requestId: brand<string, 'MessageId'>(body.requestId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        includeHidden: true,
        offset: 0,
        limit: 20,
      });
      const events = await app.gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });

      const terminalMessage = messages.items.find((message) => message.role === 'ASSISTANT');
      const terminalEvent = events.find((event) => event.type === 'REQUEST_COMPLETED');
      expect(terminalMessage?.content).toBe('blocked:SENSITIVE_TERM_BLOCKED');
      expect(terminalEvent?.inlinePayload.terminalMessageId).toBe(terminalMessage?.messageId);
      expect(terminalEvent?.inlinePayload).not.toHaveProperty('content');
      expect(events.some((event) => event.type === 'LLM_CONTENT_DELTA')).toBe(false);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('executes sub-recipe nodes through recipe definition source resolution, explicit mapping, and depth limits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-sub-recipe-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'sub-recipe-parent.yaml'),
        JSON.stringify(subRecipeParentRecipe('sub-recipe-parent', 'v1')),
        'utf8',
      );
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'sub-recipe-child.yaml'),
        JSON.stringify(subRecipeChildRecipe('sub-recipe-child', 'v1')),
        'utf8',
      );
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'sub-recipe-depth-1.yaml'),
        JSON.stringify(subRecipeDepthRecipe('sub-recipe-depth-1', 'v1', 'sub-recipe-depth-2')),
        'utf8',
      );
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'sub-recipe-depth-2.yaml'),
        JSON.stringify(subRecipeDepthRecipe('sub-recipe-depth-2', 'v1', 'sub-recipe-depth-3')),
        'utf8',
      );
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'sub-recipe-depth-3.yaml'),
        JSON.stringify(subRecipeDepthRecipe('sub-recipe-depth-3', 'v1', 'sub-recipe-depth-4')),
        'utf8',
      );
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'sub-recipe-depth-4.yaml'),
        JSON.stringify(subRecipeDepthRecipe('sub-recipe-depth-4', 'v1', 'sub-recipe-depth-5')),
        'utf8',
      );
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'sub-recipe-depth-5.yaml'),
        JSON.stringify(subRecipeDepthRecipe('sub-recipe-depth-5', 'v1')),
        'utf8',
      );
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
        },
        captureModel([]),
      );

      const parentResponse = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:sub-recipe-parent run workflow with sub recipe',
          idempotencyKey: 'idem-workflow-sub-recipe',
        },
      });
      expect(parentResponse.statusCode).toBe(200);
      const parentBody = parentResponse.json<{ requestId: string; runId: string; sessionId: string }>();
      await waitForRunTerminal(app, parentBody.runId);
      const parentMessages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(parentBody.sessionId),
        requestId: brand<string, 'MessageId'>(parentBody.requestId),
        runId: brand<string, 'RequestRunId'>(parentBody.runId),
        includeHidden: true,
        offset: 0,
        limit: 20,
      });

      expect(parentMessages.items.some((message) => message.role === 'ASSISTANT' && message.content === 'child:ran-incident-7')).toBe(true);

      const depthResponse = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:sub-recipe-depth-1 run workflow with deep sub recipe',
          idempotencyKey: 'idem-workflow-sub-recipe-depth',
        },
      });
      expect(depthResponse.statusCode).toBe(200);
      const depthBody = depthResponse.json<{ requestId: string; runId: string; sessionId: string }>();
      await waitForRunTerminal(app, depthBody.runId);
      const depthMessages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(depthBody.sessionId),
        requestId: brand<string, 'MessageId'>(depthBody.requestId),
        runId: brand<string, 'RequestRunId'>(depthBody.runId),
        includeHidden: true,
        offset: 0,
        limit: 20,
      });
      const depthRun = await app.gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId: brand<string, 'RequestRunId'>(depthBody.runId),
      });

      expect(depthRun?.status).toBe('FAILED');
      expect(depthMessages.items.some((message) => message.role === 'ASSISTANT')).toBe(true);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to the model-driven loop when targetRecipe is missing from the registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-fallback-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(
        join(root, 'agents', 'default-agent', 'recipes', 'other-workflow.yaml'),
        JSON.stringify(recipe('other-workflow', 'v1')),
        'utf8',
      );
      const executed: WorkflowExecutionRequest[] = [];
      const modelCalls: ModelInvocationRequest[] = [];
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionServiceFactory: () => workflowService(executed),
        },
        captureModel(modelCalls),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:missing-workflow fallback to model',
          idempotencyKey: 'idem-workflow-miss',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);
      expect(executed).toHaveLength(0);
      expect(modelCalls).toHaveLength(1);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not auto-enter boot-recipe when targetRecipe is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-boot-recipe-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      const bootRecipe = {
        recipeName: 'boot-greeting',
        version: 'v1',
        displayName: 'Boot Greeting',
        type: 'boot-recipe',
        flowGraph: { nodes: { start: { type: 'START', next: {} } } },
      };
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'boot-greeting.yaml'), JSON.stringify(bootRecipe), 'utf8');

      const executed: WorkflowExecutionRequest[] = [];
      const modelCalls: ModelInvocationRequest[] = [];
      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionServiceFactory: () => workflowService(executed),
        },
        captureModel(modelCalls),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: 'hello without targetRecipe',
          idempotencyKey: 'idem-boot-recipe-no-auto',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);
      expect(executed).toHaveLength(0);
      expect(modelCalls).toHaveLength(1);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the workflow service factory throws during composition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-wiring-failure-'));
    try {
      expect(() =>
        createComposedApp(
          {
            identity,
            systemConfig: createSystemConfig(root),
            agentDefinition: createAgentDefinition(),
            credentialResolver: testCredentialResolver(),
            workflowExecutionServiceFactory: () => {
              throw new Error('workflow wiring failed');
            },
          },
          captureModel([]),
        ),
      ).toThrow('workflow wiring failed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when a trusted default recipe root escapes the packaged app root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-unsafe-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'nextagent-workflow-outside-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent'), { recursive: true });
      try {
        await symlink(outside, join(root, 'agents', 'default-agent', 'recipes'), 'dir');
      } catch {
        return;
      }

      expect(
        () =>
          (app = createComposedApp(
            {
              identity,
              systemConfig: createSystemConfig(root),
              agentDefinition: createAgentDefinition(),
              credentialResolver: testCredentialResolver(),
            },
            captureModel([]),
          )),
      ).toThrow('Workflow recipe root must be a normal directory.');
    } finally {
      await app?.close().catch(() => undefined);
      await removeTempTree(root);
      await removeTempTree(outside);
    }
  });
});

async function waitForRunTerminal(app: ReturnType<typeof createComposedApp>, runId: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(runId),
    });
    if (run?.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for workflow request terminal commit.');
}

async function removeTempTree(root: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EBUSY') {
        throw error;
      }
      if (attempt === 49) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function waitForPendingInput(app: ReturnType<typeof createComposedApp>, sessionId: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = await app.gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(sessionId),
    });
    if (pending !== undefined) {
      return pending;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for workflow pending input.');
}

function createSystemConfig(root: string): DefaultSystemConfig {
  return validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver: testCredentialResolver() });
}

function createAgentDefinition(): AgentDefinition {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    displayName: 'Workflow composition test agent',
    description: 'Workflow composition test agent.',
    modelIds: ['MiniMax-M2.7'],
    capabilityBindings: [],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 30_000,
    },
    resources: [],
  };
}

function workflowService(captured: WorkflowExecutionRequest[]): WorkflowExecutionService {
  return {
    async execute(request) {
      captured.push(request);
      return {
        executionId: 'workflow-execution-1',
        status: 'COMPLETED',
        outputVariables: { message: 'workflow completed' },
        nodeResults: [],
        startedAt: new Date('2026-06-23T00:00:00.000Z'),
        completedAt: new Date('2026-06-23T00:00:00.000Z'),
      };
    },
  };
}

function captureModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'ok' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield { content: 'ok', finishReason: 'stop' };
    }),
  };
}

function captureOperationalLogWriter(warnings: Array<{ readonly obj: object }>): OperationalLogWriter {
  const logger = {
    error() {},
    warn(fields: object) {
      warnings.push({ obj: fields });
    },
    info() {},
    debug() {},
  };
  return {
    getLogger: () => logger,
    getObservationLogger: () => logger,
    activeIdentity: () => undefined,
    flush: async () => {},
    close: async () => {},
  };
}

function recipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          end: {
            condition: '',
          },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function parallelRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          fork: {
            condition: '',
          },
        },
      },
      fork: {
        type: 'parallel-gateway',
        next: {
          branchA: {
            condition: '',
          },
          branchB: {
            condition: '',
          },
        },
      },
      branchA: {
        type: 'restful',
        next: {
          end: {
            condition: '',
          },
        },
      },
      branchB: {
        type: 'skill',
        next: {
          end: {
            condition: '',
          },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function inclusiveRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          fork: {
            condition: '',
          },
        },
      },
      fork: {
        type: 'inclusive-gateway',
        next: {
          branchA: {
            condition: '',
          },
          branchB: {
            condition: '',
          },
        },
      },
      branchA: {
        type: 'restful',
        next: {
          end: {
            condition: '',
          },
        },
      },
      branchB: {
        type: 'skill',
        next: {
          end: {
            condition: '',
          },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function capabilityDslRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          askModel: {
            condition: '',
          },
        },
      },
      askModel: {
        type: 'llm-router',
        next: {
          chooseTool: {
            condition: '',
          },
        },
      },
      chooseTool: {
        type: 'tool_choice',
        next: {
          callApi: {
            condition: '',
          },
        },
      },
      callApi: {
        type: 'restful',
        next: {
          runPython: {
            condition: '',
          },
        },
      },
      runPython: {
        type: 'python',
        next: {
          callAgent: {
            condition: '',
          },
        },
      },
      callAgent: {
        type: 'agent',
        next: {
          callSkill: {
            condition: '',
          },
        },
      },
      callSkill: {
        type: 'skill',
        next: {
          callSubflow: {
            condition: '',
          },
        },
      },
      callSubflow: {
        type: 'sub-recipe',
        next: {
          wait: {
            condition: '',
          },
        },
      },
      wait: {
        type: 'delay-gateway',
        next: {
          end: {
            condition: '',
          },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function llmDslRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          route: { condition: '' },
        },
      },
      route: {
        type: 'llm-router',
        next: {
          classify: { condition: '' },
        },
      },
      classify: {
        type: 'intent-recognition',
        next: {
          rewrite: { condition: '' },
        },
      },
      rewrite: {
        type: 'question-rewriting',
        next: {
          translate: { condition: '' },
        },
      },
      translate: {
        type: 'translation',
        next: {
          analyze: { condition: '' },
        },
      },
      analyze: {
        type: 'data-analysis',
        next: {
          extract: { condition: '' },
        },
      },
      extract: {
        type: 'param-extract',
        next: {
          end: { condition: '' },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function interactionDslRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          askUser: { condition: '' },
        },
      },
      askUser: {
        type: 'user-check',
        next: {
          showResult: { condition: '' },
        },
      },
      showResult: {
        type: 'display-content',
        next: {
          verify: { condition: '' },
        },
      },
      verify: {
        type: 'guardrail_check',
        next: {
          pause: { condition: '' },
        },
      },
      pause: {
        type: 'interrupt-gateway',
        next: {
          end: { condition: '' },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function knowledgeDslRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          search: { condition: '' },
        },
      },
      search: {
        type: 'knowledge-search',
        outputs: {
          knowledge_search_result: '${knowledge_search_result}',
        },
        next: {
          answer: { condition: '' },
        },
      },
      answer: {
        type: 'knowledge-qa',
        next: {
          chooseApi: { condition: '' },
        },
      },
      chooseApi: {
        type: 'api-choice',
        next: {
          chooseRecipe: { condition: '' },
        },
      },
      chooseRecipe: {
        type: 'recipe-choice',
        next: {
          end: { condition: '' },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function knowledgeSearchQaRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          search: { condition: '' },
        },
      },
      search: {
        type: 'knowledge-search',
        inputs: {
          rag_index: [{ index_name: 'ran-kb' }],
          query: 'paging failure',
          rank_topN: '1',
          vs_topN: '3',
          es_topN: '3',
        },
        outputs: {
          knowledge_search_result: '${knowledge_search_result}',
        },
        next: {
          answer: { condition: '' },
        },
      },
      answer: {
        type: 'knowledge-qa',
        inputs: {
          rag_index: [{ index_name: 'ran-kb' }],
          query: 'What should we check for paging failures?',
          llm_summary_prompt: 'Summarize the supplied knowledge evidence without adding unsupported claims.',
        },
        outputs: {
          answer: '${llm_completion}',
        },
        next: {
          show: { condition: '' },
        },
      },
      show: {
        type: 'display-content',
        inputs: {
          content: '${answer}',
        },
        outputs: {
          message: '${display_content}',
        },
        next: {
          end: { condition: '' },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function apiChoiceDisplayRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          chooseApi: { condition: '' },
        },
      },
      chooseApi: {
        type: 'api-choice',
        outputs: {
          api_name: '${api_name}',
        },
        inputs: {
          taskDescription: 'Query the incident detail safely',
          top1_choice_prompt: 'Select exactly one candidate API and return only the bounded selection tool call.',
          candidateApis: [
            {
              apiName: 'query_incident',
              paramsSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  incidentId: { type: 'string' },
                },
              },
            },
            {
              apiName: 'close_incident',
              paramsSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  incidentId: { type: 'string' },
                },
              },
            },
          ],
        },
        next: {
          show: { condition: '' },
        },
      },
      show: {
        type: 'display-content',
        inputs: {
          content: '${api_name}',
        },
        outputs: {
          message: '${display_content}',
        },
        next: {
          end: { condition: '' },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function recipeChoiceParentRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          chooseRecipe: { condition: '' },
        },
      },
      chooseRecipe: {
        type: 'recipe-choice',
        inputs: {
          taskDescription: 'Pick the child remediation recipe',
          candidateRecipes: [{ recipe_name: 'recipe-choice-child' }, { recipe_name: 'other-child' }],
        },
        next: {
          runChild: { condition: '' },
        },
      },
      runChild: {
        type: 'sub-recipe',
        inputs: {
          recipe_name: '${recipe_name}',
          inputMapping: {},
          outputMapping: {
            childMessage: '${outputs.childMessage}',
          },
        },
        next: {
          show: { condition: '' },
        },
      },
      show: {
        type: 'display-content',
        inputs: {
          content: '${childMessage}',
        },
        outputs: {
          message: '${display_content}',
        },
        next: {
          end: { condition: '' },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function recipeChoiceChildRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          show: { condition: '' },
        },
      },
      show: {
        type: 'display-content',
        inputs: {
          content: 'child:selected',
        },
        outputs: {
          childMessage: '${display_content}',
        },
        next: {
          end: { condition: '' },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function userCheckResumeRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          askUser: { condition: '' },
        },
      },
      askUser: {
        type: 'user-check',
        inputs: {
          question: 'Approve the workflow?',
          action_type: 'choice',
          options: [{ label: 'Approve', value: 'approve' }],
        },
        next: {
          showAnswer: { condition: '' },
        },
      },
      showAnswer: {
        type: 'display-content',
        inputs: {
          content: '${selectedOption}',
        },
        outputs: {
          content: '${display_content}',
        },
        next: {
          end: { condition: '' },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function interruptResumeRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          pause: { condition: '' },
        },
      },
      pause: {
        type: 'interrupt-gateway',
        inputs: {
          prompt: 'Resume this workflow externally.',
        },
        next: {
          showState: { condition: '' },
        },
      },
      showState: {
        type: 'display-content',
        inputs: {
          content: 'resume:${resumed}',
        },
        outputs: {
          content: '${display_content}',
        },
        next: {
          end: { condition: '' },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function guardrailRouteRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          verify: { condition: '' },
        },
      },
      verify: {
        type: 'guardrail_check',
        inputs: {
          policyId: 'telecom-guardrail',
          content: 'subscriber secret',
        },
        next: {
          route: { condition: '' },
        },
      },
      route: {
        type: 'exclusive-gateway',
        next: {
          allow: { condition: "${result == 'pass'}" },
          block: { condition: '' },
        },
      },
      allow: {
        type: 'display-content',
        inputs: {
          content: 'allowed',
        },
        outputs: {
          message: '${display_content}',
        },
        next: {
          end: { condition: '' },
        },
      },
      block: {
        type: 'display-content',
        inputs: {
          content: 'blocked:${reason}',
        },
        outputs: {
          message: '${display_content}',
        },
        next: {
          end: { condition: '' },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function subRecipeParentRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          callChild: { condition: '' },
        },
      },
      callChild: {
        type: 'sub-recipe',
        inputs: {
          recipe_name: 'sub-recipe-child',
          inputMapping: {
            inputText: 'ran-incident-7',
          },
          outputMapping: {
            childMessage: '${outputs.childMessage}',
          },
        },
        next: {
          show: { condition: '' },
        },
      },
      show: {
        type: 'display-content',
        inputs: {
          content: '${childMessage}',
        },
        outputs: {
          message: '${display_content}',
        },
        next: {
          end: { condition: '' },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function subRecipeChildRecipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          show: { condition: '' },
        },
      },
      show: {
        type: 'display-content',
        inputs: {
          content: 'child:${inputText}',
        },
        outputs: {
          childMessage: '${display_content}',
        },
        next: {
          end: { condition: '' },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}

function subRecipeDepthRecipe(recipeName: string, version: string, nextRecipeName?: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          ...(nextRecipeName === undefined ? { show: { condition: '' } } : { callChild: { condition: '' } }),
        },
      },
      ...(nextRecipeName === undefined
        ? {}
        : {
            callChild: {
              type: 'sub-recipe',
              inputs: {
                recipe_name: nextRecipeName,
                inputMapping: {},
                outputMapping: {},
              },
              next: {
                end: { condition: '' },
              },
            },
          }),
      ...(nextRecipeName !== undefined
        ? {}
        : {
            show: {
              type: 'display-content',
              inputs: {
                content: 'depth-ok',
              },
              outputs: {
                message: '${display_content}',
              },
              next: {
                end: { condition: '' },
              },
            },
          }),
      end: {
        type: 'end-event',
      },
    },
  };
}

function rawSystemConfig() {
  return {
    deployment: { mode: 'LOCAL' },
    paths: { workspaceRoot: 'workspaces', logDirectory: 'logs' },
    auth: {
      mode: 'local',
      localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject', displayName: 'Local developer' },
    },
    channel: { transport: 'fastify', host: '127.0.0.1', port: 3000 },
    hostedAgent: { activeAgentId: 'default-agent' },
    modelProfiles: [
      {
        providerId: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com/v1',
        credentialRef: 'env:OPENAI_API_KEY',
        models: [
          {
            modelId: 'MiniMax-M2.7',
            timeoutMs: 30_000,
            contextWindowTokens: 128_000,
            fallbackEligible: false,
          },
        ],
      },
    ],
    gateway: {
      gateways: [
        { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
        { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
      ],
    },
    noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
  };
}

function testCredentialResolver() {
  return createAppCredentialResolver({
    OPENAI_API_KEY: 'test-only',
    OPENAI_MODEL_NAME: 'MiniMax-M2.7',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
  });
}
