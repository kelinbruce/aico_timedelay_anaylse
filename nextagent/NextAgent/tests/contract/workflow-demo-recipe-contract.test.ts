import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import {
  createAppCredentialResolver,
  createComposedApp,
  validateDefaultSystemConfig,
  type AgentDefinition,
  type DefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type AgentId } from '@nextagent/agent-common';
import { createWorkflowExecutionService } from '@nextagent/agent-workflow';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('local-tenant'),
  subjectId: brand<string, 'SubjectId'>('local-subject'),
  displayName: 'Local developer',
};

const DEMO_RECIPE_YAML = `
name: demo_recipe
description: Demo recipe for weather query and network operation advice
domain: NAIE
scene: demo
type: boot-recipe
version: '1.0.0'
nodes:
  start_node:
    type: start-event
    description: 开始处理您的问题
    next:
      recipe_choice:
        condition: ''
  recipe_choice:
    type: recipe-choice
    description: 检索匹配的 recipe
    next:
      ext_api:
        condition: ''
  ext_api:
    type: restful
    description: 查询天气接口
    inputs:
      api_name: weather_query
    next:
      last_llm:
        condition: ''
  last_llm:
    type: llm-router
    description: 总结天气，给出运维建议
    inputs:
      llm_type: NetGPT
      prompt_template: '请根据天气状态和用户的问题，给出出行和现场运维建议。'
    outputs:
      result: \${llm_completion}
    next:
      end_node:
        condition: ''
  end_node:
    type: end-event
    description: 结束
`.trim();

const EXPECTED_DEMO_ANSWER = '天气状态为晴，适合出行。建议正常前往现场，注意防晒和补水；网络运维侧可按计划执行巡检，户外作业注意设备散热和人员安全。';

describe('workflow demo recipe contract regression', () => {
  it('completes $workflow:demo_recipe through real web API, runtime, recipe loader and terminal commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-demo-contract-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'demo_recipe.yaml'), DEMO_RECIPE_YAML, 'utf8');

      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
          workflowExecutionServiceFactory: (options) =>
            createWorkflowExecutionService({
              resolveRecipeDefinition: options.resolveRecipeDefinition,
              nodeCatalog: {
                handlers: Object.freeze({
                  ...(options.nodeCatalog?.handlers ?? {}),
                  RECIPE_CHOICE: async (context) => executeMockRecipeChoice(context),
                  RESTFUL: async (context) => executeMockRestful(context),
                }),
              },
            }),
        },
        createDemoModelInvocationService(),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:demo_recipe 查询深圳天气并给出网络现场运维建议',
          idempotencyKey: 'idem-workflow-demo-contract',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string; sessionId: string }>();
      await waitForRunTerminal(app, body.runId);

      const messages = await app.gateway.messages.listMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        includeHidden: true,
        includeCapabilityResults: true,
        limit: 50,
      });

      const allText = messages.items
        .flatMap((message) => message.content)
        .filter((part): part is string => typeof part === 'string')
        .join('\n');

      expect(allText).toContain(EXPECTED_DEMO_ANSWER);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});

async function waitForRunTerminal(app: ReturnType<typeof createComposedApp>, runId: string, timeoutMs = 10_000): Promise<void> {
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for run terminal.');
}

function createSystemConfig(root: string): DefaultSystemConfig {
  return validateDefaultSystemConfig(
    {
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
          baseUrl: 'https://mock.local/v1',
          credentialRef: 'env:NEXTAGENT_TEST_ONLY',
          models: [
            {
              modelId: 'demo-model',
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
    },
    root,
    { credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }) },
  );
}

function createAgentDefinition(): AgentDefinition {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    displayName: 'Workflow demo contract regression test agent',
    description: 'Workflow demo contract regression test agent.',
    modelIds: ['demo-model'],
    capabilityBindings: [],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',
      requestTimeoutMs: 30_000,
    },
    resources: [],
  };
}

function executeMockRecipeChoice(context: { readonly variables: { readonly input_question?: unknown } }) {
  const query = String(context.variables.input_question ?? '');
  const matched = /天气|出行|外出|运维|站点|网络|NAIE/i.test(query);
  if (!matched) {
    return {
      outputVariables: {
        recipeRecallResult: [],
        recipeDiagnostic: { status: 'OK', reason: 'MOCK_RECIPE_NOT_FOUND' },
      },
    };
  }
  const recall = [
    {
      ref: 'mock-rag://recipes/demo_network_recipe',
      title: 'demo_network_recipe',
      excerpt: '面向NAIE网络运维场景，先多轮改写，再选择天气mock API，最后总结出行和现场运维建议。',
      score: 0.98,
    },
  ];
  return {
    outputVariables: {
      recipe_name: 'demo_network_recipe',
      recipe_name_list: ['demo_network_recipe'],
      recall_result: recall,
      knowledge_diagnostic: { status: 'OK', source: 'mock_recipe_rag' },
      selectedRecipeName: 'demo_network_recipe',
      recipeRecallResult: recall,
      recipeDiagnostic: { status: 'OK', source: 'mock_recipe_rag' },
    },
  };
}

function executeMockRestful(context: {
  readonly node: { readonly inputs?: { readonly api_name?: unknown } };
  readonly executionId: string;
  readonly nodeId: string;
}) {
  return {
    outputVariables: {
      api_response: ['晴'],
      api_response_summary: ['晴'],
      invocation_trace: {
        capabilityId: String(context.node.inputs?.api_name ?? 'weather_query'),
        executionId: context.executionId,
        nodeId: context.nodeId,
        source: 'demo_mock',
      },
    },
  };
}

function createDemoModelInvocationService() {
  return {
    async complete() {
      return {
        content: EXPECTED_DEMO_ANSWER,
        finishReason: 'stop' as const,
      };
    },
    stream: modelEventStreamFixture(async function* () {
      yield { content: EXPECTED_DEMO_ANSWER };
    }),
  };
}
