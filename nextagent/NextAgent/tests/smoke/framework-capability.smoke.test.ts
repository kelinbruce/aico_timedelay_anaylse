/**
 * E2E Case: feature-tree smoke - 框架能力.
 * Entry: Workflow capability routed from model tool call through app composition and gateway.
 */
import { createAppCredentialResolver, createComposedApp, createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import type { JsonObject } from '@nextagent/agent-common';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import type { WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import { expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  captureModel,
  copySkillFixturesToWorkspace,
  createAgentDefinition,
  createSystemConfig,
  describeRealModelSmoke,
  deterministicModel,
  idem,
  recipe,
  reserveFreePort,
  smokeIdentity,
  trackCleanupPath,
  waitForWorkflowRunTerminal,
  workflowService,
} from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 框架能力', () => {
  it('executes a Workflow tool call through framework composition and persisted conversation', async () => {
    const root = trackCleanupPath(await mkdtemp(join(tmpdir(), 'nextagent-framework-smoke-')));
    await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
    await writeFile(
      join(root, 'agents', 'default-agent', 'recipes', 'ran-smoke-diagnosis.yaml'),
      JSON.stringify(recipe('ran-smoke-diagnosis', 'v1')),
      'utf8',
    );

    const executed: WorkflowExecutionRequest[] = [];
    const modelCalls: ModelInvocationRequest[] = [];
    const port = await reserveFreePort();
    const app = createComposedApp(
      {
        identity: smokeIdentity,
        systemConfig: createSystemConfig(root, port),
        agentDefinition: createAgentDefinition(),
        credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
        workflowExecutionServiceFactory: () => workflowService(executed),
      },
      captureModel(
        modelCalls,
        deterministicModel([
          {
            toolCalls: [
              {
                toolCallId: 'workflow-smoke-call',
                toolName: 'Workflow',
                arguments: {
                  recipeName: 'ran-smoke-diagnosis',
                  inputText: '诊断 RAN 小区高掉线率',
                } as unknown as JsonObject,
              },
            ],
          },
          { content: 'workflow smoke completed' },
        ]),
      ),
    );
    await app.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputText: '诊断 RAN 小区高掉线率', idempotencyKey: idem('framework-workflow') }),
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as { sessionId: string; runId: string };
    await waitForWorkflowRunTerminal(app, acceptedBody.runId);

    expect(modelCalls.length).toBeGreaterThan(0);
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({ recipeName: 'ran-smoke-diagnosis', recipeVersion: 'v1', agentId: 'default-agent' });

    const conversation = await fetch(`${baseUrl}/api/v1/sessions/${acceptedBody.sessionId}/conversation?limit=20`);
    expect(conversation.status).toBe(200);
    expect(JSON.stringify(await conversation.json())).toContain('workflow smoke completed');
  }, 20_000);

  it('routes a workflow directive into execution without model finalization', async () => {
    const root = trackCleanupPath(await mkdtemp(join(tmpdir(), 'nextagent-framework-target-recipe-smoke-')));
    await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
    await writeFile(
      join(root, 'agents', 'default-agent', 'recipes', 'ran-target-recipe.yaml'),
      JSON.stringify(recipe('ran-target-recipe', 'v1')),
      'utf8',
    );

    const executed: WorkflowExecutionRequest[] = [];
    const modelCalls: ModelInvocationRequest[] = [];
    const port = await reserveFreePort();
    const app = createComposedApp(
      {
        identity: smokeIdentity,
        systemConfig: createSystemConfig(root, port),
        agentDefinition: createAgentDefinition(),
        credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
        workflowExecutionServiceFactory: () => workflowService(executed),
      },
      captureModel(modelCalls, deterministicModel([{ content: 'model should not be used' }])),
    );
    await app.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: '$workflow:ran-target-recipe run target recipe',
        idempotencyKey: idem('framework-target-recipe'),
      }),
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as { sessionId: string; runId: string };
    await waitForWorkflowRunTerminal(app, acceptedBody.runId);

    expect(modelCalls).toHaveLength(0);
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({ recipeName: 'ran-target-recipe', recipeVersion: 'v1', agentId: 'default-agent' });

    const conversation = await fetch(`${baseUrl}/api/v1/sessions/${acceptedBody.sessionId}/conversation?limit=20`);
    expect(conversation.status).toBe(200);
    expect(JSON.stringify(await conversation.json())).toContain('workflow smoke completed');
  }, 20_000);

  it('loads a targetSkill into the model routing context without exposing local paths', async () => {
    const root = trackCleanupPath(await mkdtemp(join(tmpdir(), 'nextagent-framework-target-skill-smoke-')));
    await copySkillFixturesToWorkspace(root, ['hello-clip-test']);
    const modelCalls: ModelInvocationRequest[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: root,
      modelRequestSink: modelCalls,
      modelSteps: [{ content: 'target skill smoke completed.' }],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: {
        inputText: '验证 hello clip skill 的目标路由。',
        idempotencyKey: idem('framework-target-skill'),
        routingConstraints: { targetSkill: 'hello-clip-test' },
      },
    });
    expect(accepted.statusCode).toBe(200);
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain('event: REQUEST_COMPLETED');

    expect(modelCalls).toHaveLength(1);
    const promptJson = JSON.stringify(modelCalls[0]?.messages);
    expect(promptJson).toContain('hello-clip-test');
    expect(promptJson).toContain('Available skills');
    expect(promptJson).toContain('<skill_content name=\\\"hello-clip-test\\\">');
    expect(promptJson).not.toContain(root);
  });
});
