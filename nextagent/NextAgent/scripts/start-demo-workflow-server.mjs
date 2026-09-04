import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noopRuntimeLogger } from '@nextagent/agent-common';
import {
  createAppCredentialResolver,
  createComposedApp,
  createTestSystemConfig,
  loadBuiltInDefaultAgentDefinition,
} from '@nextagent/agent-platform-gateway-local/testing';
import { createWorkflowExecutionService } from '@nextagent/agent-workflow';

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

const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-workflow-demo-'));
mkdirSync(join(workspaceDir, 'agents', 'default-agent', 'recipes'), { recursive: true });
writeFileSync(join(workspaceDir, 'agents', 'default-agent', 'recipes', 'demo_recipe.yaml'), DEMO_RECIPE_YAML, 'utf8');

const credentialResolver = createAppCredentialResolver({
  OPENAI_MODEL_NAME: 'demo-model',
});
const systemConfig = createTestSystemConfig(workspaceDir, credentialResolver);
const model = createDemoModelInvocationService();

const app = createComposedApp(
  {
    credentialResolver,
    systemConfig: {
      ...systemConfig,
      channel: {
        ...systemConfig.channel,
        port: 3010,
      },
    },
    agentDefinition: { ...loadBuiltInDefaultAgentDefinition(), workspaceDir: '.' },
    runtimeLogger: noopRuntimeLogger,
    structuredLogTransport: noopRuntimeLogger,
    workflowExecutionServiceFactory: (options) =>
      createWorkflowExecutionService({
        resolveRecipeDefinition: options.resolveRecipeDefinition,
        nodeCatalog: {
          handlers: Object.freeze({
            ...options.nodeCatalog.handlers,
            RECIPE_CHOICE: async (context) => executeMockRecipeChoice(context),
            RESTFUL: async (context) => executeMockRestful(context),
          }),
        },
      }),
  },
  model,
  'OPENAI',
);

app.server.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Headers', 'Content-Type');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  if (request.method === 'OPTIONS') {
    await reply.status(204).send();
  }
});

function cleanup() {
  app.close().catch(() => undefined);
  rmSync(workspaceDir, { recursive: true, force: true });
}

process.on('SIGINT', async () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  cleanup();
  process.exit(0);
});

await app.start();
console.log('NextAgent demo workflow server listening on http://127.0.0.1:3010');
console.log('Open http://127.0.0.1:3011/ and submit a question to target recipe demo_recipe.');

await new Promise(() => undefined);

function executeMockRecipeChoice(context) {
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

function executeMockRestful(context) {
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
    async complete(request) {
      const stepId = String(request.stepId ?? '');
      if (stepId.includes('api_choice') && request.tools.length > 0) {
        const tool = request.tools[0];
        return {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              id: 'mock-tool-call-weather-query',
              toolName: tool.name,
              arguments: {
                city: '深圳',
                scene: 'network-operation-travel',
              },
            },
          ],
        };
      }
      if (stepId.includes('question-rewriting')) {
        const source = lastUserText(request);
        const round2 = source.includes('API') || source.includes('天气查询');
        return {
          content: JSON.stringify({
            rewrittenQuery: round2
              ? 'NAIE网络运维出行场景：选择天气查询API，查询深圳天气并生成现场运维建议'
              : 'NAIE网络运维出行场景：将用户问题改写为天气查询和现场运维建议任务',
          }),
          finishReason: 'stop',
        };
      }
      return {
        content: '天气状态为晴，适合出行。建议正常前往现场，注意防晒和补水；网络运维侧可按计划执行巡检，户外作业注意设备散热和人员安全。',
        finishReason: 'stop',
      };
    },
    async stream(request, signal) {
      return await this.complete(request, signal);
    },
  };
}

function lastUserText(request) {
  const userMessages = request.messages.filter((message) => message.role === 'USER');
  const last = userMessages[userMessages.length - 1];
  if (last === undefined) {
    return '';
  }
  return last.content.map((part) => (typeof part.text === 'string' ? part.text : '')).join('\n');
}
