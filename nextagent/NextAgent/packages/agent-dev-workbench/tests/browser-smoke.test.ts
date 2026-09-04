/// <reference lib="dom" />
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerAgentDevWorkbench, type AgentDevWorkbenchGraphView, type AgentDevWorkbenchLocalReadPort } from '../src/index.js';

const port = 18410;
const base = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof Fastify>;
const require = createRequire(import.meta.url);
const workbenchRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workbenchIndex = resolve(workbenchRoot, 'web-dist', 'index.html');
const playwright = loadPlaywright();
const browserExecutable = playwright === undefined ? undefined : resolveBrowserExecutable(playwright);

const now = Date.now();

const readPort: AgentDevWorkbenchLocalReadPort = {
  async listAgents() {
    return {
      entries: [
        {
          agentId: 'default-agent',
          agentVersion: 'v1',
          agentAssemblyRef: 'asm-1',
          displayName: 'Network Diagnosis Agent',
          description: 'Diagnoses network faults',
          sourceKind: 'BUILTIN',
          agentInvocation: 'BOUND',
          kind: 'agent' as const,
          userInvocable: true,
          sessionCount: 2,
          configuration: agentConfiguration('default-agent', 'asm-1', 'Network Diagnosis Agent'),
          configurationAvailability: { status: 'available' as const },
        },
        {
          agentId: 'child-agent',
          agentVersion: 'v1',
          agentAssemblyRef: 'asm-child',
          displayName: 'Child Agent',
          description: 'Handles delegated diagnosis',
          sourceKind: 'LOCAL',
          agentInvocation: 'PARENT',
          kind: 'subagent' as const,
          userInvocable: false,
          parentAgentScope: { agentId: 'default-agent', agentVersion: 'v1', agentAssemblyRef: 'asm-1' },
          sessionCount: 1,
          configuration: agentConfiguration('child-agent', 'asm-child', 'Child Agent'),
          configurationAvailability: { status: 'available' as const },
        },
        {
          agentId: 'zero-child',
          agentVersion: 'v1',
          agentAssemblyRef: 'asm-zero',
          displayName: 'Zero Child',
          description: 'No sessions yet',
          sourceKind: 'LOCAL',
          agentInvocation: 'PARENT',
          kind: 'subagent' as const,
          userInvocable: false,
          parentAgentScope: { agentId: 'default-agent', agentVersion: 'v1', agentAssemblyRef: 'asm-1' },
          sessionCount: 0,
          configuration: agentConfiguration('zero-child', 'asm-zero', 'Zero Child'),
          configurationAvailability: { status: 'available' as const },
        },
      ],
      detailAvailability: { status: 'available' as const },
    };
  },
  async listSessions() {
    return {
      entries: [
        {
          tenantId: 't1',
          subjectId: 's1',
          agentId: 'default-agent',
          sessionId: 'sess-1',
          title: '信号丢失诊断',
          createdAt: now - 600000,
          updatedAt: now - 60000,
          latestRunStatus: 'COMPLETED',
        },
        {
          tenantId: 't1',
          subjectId: 's1',
          agentId: 'default-agent',
          sessionId: 'sess-2',
          title: '容量规划',
          createdAt: now - 1200000,
          updatedAt: now - 300000,
          latestRunStatus: 'FAILED',
        },
        {
          tenantId: 't1',
          subjectId: 's1',
          agentId: 'child-agent',
          sessionId: 'sess-child',
          title: '子任务诊断',
          parentSessionId: 'sess-1',
          parentRunId: 'run-subagent',
          parentRequestId: 'req-1',
          createdAt: now - 580000,
          updatedAt: now - 570000,
          latestRunStatus: 'COMPLETED',
        },
      ],
      detailAvailability: { status: 'available' },
    };
  },
  async listConversation() {
    return {
      sessionId: 'sess-1',
      messages: [
        {
          messageId: 'm1',
          requestId: 'req-1',
          runId: 'run-1',
          role: 'USER',
          contentType: 'TEXT',
          content: '诊断 BC-042 基站信号丢失问题。',
          visible: true,
          createdAt: now - 600000,
        },
        {
          messageId: 'm2',
          requestId: 'req-1',
          runId: 'run-1',
          role: 'ASSISTANT',
          contentType: 'TEXT',
          content: '我来帮你排查信号丢失问题。',
          visible: true,
          createdAt: now - 590000,
        },
      ],
      detailAvailability: { status: 'available' },
    };
  },
  async listRuns(_scope, query) {
    if (query.sessionId === 'sess-child') {
      return {
        entries: [
          {
            tenantId: 't1',
            subjectId: 's1',
            agentId: 'child-agent',
            agentVersion: 'v1',
            sessionId: 'sess-child',
            requestId: 'req-child',
            runId: 'run-child',
            parentRunId: 'run-subagent',
            parentRequestId: 'req-1',
            agentAssemblyRef: 'asm-child',
            attempt: 1,
            status: 'COMPLETED',
            terminalCommitState: 'COMMITTED',
            createdAt: now - 580000,
            updatedAt: now - 570000,
          },
        ],
        detailAvailability: { status: 'available' as const },
      };
    }
    return {
      entries: [
        {
          tenantId: 't1',
          subjectId: 's1',
          agentId: 'default-agent',
          agentVersion: 'v1',
          sessionId: 'sess-1',
          requestId: 'req-1',
          runId: 'run-model',
          agentAssemblyRef: 'asm-1',
          attempt: 1,
          status: 'COMPLETED',
          terminalCommitState: 'COMMITTED',
          createdAt: now - 600000,
          updatedAt: now - 580000,
        },
        {
          tenantId: 't1',
          subjectId: 's1',
          agentId: 'default-agent',
          agentVersion: 'v1',
          sessionId: 'sess-1',
          requestId: 'req-1',
          runId: 'run-parallel',
          agentAssemblyRef: 'asm-1',
          attempt: 1,
          status: 'COMPLETED',
          terminalCommitState: 'COMMITTED',
          createdAt: now - 605000,
          updatedAt: now - 585000,
        },
        {
          tenantId: 't1',
          subjectId: 's1',
          agentId: 'default-agent',
          agentVersion: 'v1',
          sessionId: 'sess-1',
          requestId: 'req-1',
          runId: 'run-tool',
          agentAssemblyRef: 'asm-1',
          attempt: 1,
          status: 'COMPLETED',
          terminalCommitState: 'COMMITTED',
          createdAt: now - 610000,
          updatedAt: now - 590000,
        },
        {
          tenantId: 't1',
          subjectId: 's1',
          agentId: 'default-agent',
          agentVersion: 'v1',
          sessionId: 'sess-1',
          requestId: 'req-1',
          runId: 'run-subagent',
          agentAssemblyRef: 'asm-1',
          attempt: 1,
          status: 'COMPLETED',
          terminalCommitState: 'COMMITTED',
          createdAt: now - 620000,
          updatedAt: now - 600000,
        },
      ],
      detailAvailability: { status: 'available' },
    };
  },
  async getRunGraph(_scope, query): Promise<AgentDevWorkbenchGraphView> {
    const toolRun = query.requestRunId === 'run-tool';
    const parallelRun = query.requestRunId === 'run-parallel';
    const subagentRun = query.requestRunId === 'run-subagent';
    const childRun = query.requestRunId === 'run-child';
    return {
      requestRunId: query.requestRunId,
      nodes: parallelRun
        ? parallelGraphNodes()
        : childRun
          ? [
              {
                actionId: 'timeline:child-model',
                type: 'model',
                label: '模型调用',
                status: 'completed',
                durationMs: 1200,
                refs: { eventId: 'child-model', payload: { stepId: 'turn-1', modelId: 'child-model' } },
                detailAvailability: { status: 'available' },
              },
            ]
          : subagentRun
            ? [
                {
                  actionId: 'timeline:subagent',
                  type: 'subagent',
                  label: 'child-agent',
                  status: 'completed',
                  durationMs: 2200,
                  refs: {
                    eventId: 'subagent',
                    toolCallId: 'call-agent',
                    targetAgentId: 'child-agent',
                    childLinkAvailability: 'available',
                    childAgentId: 'child-agent',
                    childSessionId: 'sess-child',
                    childRunId: 'run-child',
                    childRunStatus: 'COMPLETED',
                    payload: { capabilityId: 'child-agent', capabilityKind: 'AGENT', toolName: 'Agent' },
                  },
                  detailAvailability: { status: 'available' },
                },
              ]
            : toolRun
              ? [
                  {
                    actionId: 'timeline:tool',
                    type: 'capability',
                    label: 'Bash',
                    status: 'completed',
                    startedAt: now - 585000,
                    durationMs: 4000,
                    refs: {
                      eventId: 'tool',
                      sequence: 1,
                      timelineType: 'CAPABILITY_COMPLETED',
                      toolCallId: 'call-bash',
                      commandPreview: 'npm run build',
                      payload: { toolCallId: 'call-bash', toolName: 'Bash', capabilityKind: 'TOOL', fallbackTriggered: true },
                    },
                    detailAvailability: { status: 'available' },
                  },
                ]
              : [
                  {
                    actionId: 'timeline:model',
                    type: 'model',
                    label: '模型调用',
                    status: 'completed',
                    startedAt: now - 597000,
                    durationMs: 7000,
                    refs: {
                      eventId: 'model',
                      sequence: 1,
                      timelineType: 'MODEL_INVOCATION_COMPLETED',
                      payload: {
                        stepId: 'turn-1',
                        modelId: 'MiniMax-M3',
                        finishReason: 'stop',
                        promptTemplateRef: 'default-prompt',
                        selectedMessageRefs: ['m1'],
                        renderedToolNames: ['query_alarms'],
                        usage: { inputTokens: 1000, outputTokens: 234, totalTokens: 1234 },
                      },
                    },
                    detailAvailability: { status: 'available' },
                  },
                ],
      edges: parallelRun ? parallelGraphEdges() : [],
      effectiveView: {
        status: 'reconstructed',
        agentId: 'default-agent',
        agentVersion: 'v1',
        agentAssemblyRef: 'asm-1',
        modelIds: ['MiniMax-M2.7-highspeed'],
        promptTemplateRefs: ['default-prompt'],
        disclosedCapabilityIds: ['query_alarms', 'telecom-qa', 'diagnosis-agent'],
        renderedToolNames: ['query_alarms'],
        skillCapabilityIds: ['telecom-qa'],
        agentCapabilityIds: ['diagnosis-agent'],
        agentConfiguration: {
          agentId: 'default-agent',
          agentType: 'GENERAL',
          agentVersion: 'v1',
          agentAssemblyRef: 'asm-1',
          displayName: 'Network Diagnosis Agent',
          description: 'Diagnoses network faults',
          workspacePolicy: { schemaVersion: 'v1', isolationMode: 'session', roots: [] },
          modelIds: ['MiniMax-M2.7-highspeed'],
          capabilityBindings: [
            { capabilityId: 'query_alarms', capabilityType: 'TOOL', providerId: 'builtin' },
            { capabilityId: 'telecom-qa', capabilityType: 'SKILL', providerId: 'builtin' },
            { capabilityId: 'diagnosis-agent', capabilityType: 'AGENT', providerId: 'builtin' },
          ],
          userInvocable: true,
          agentInvocation: 'NONE',
          runtimeSettings: { maxTurns: 8, maxToolCallsPerTurn: 30 },
        },
        agentConfigurationAvailability: { status: 'available' },
      },
      detailAvailability: { status: 'available' },
    };
  },
  async getActionDetail(_scope, query) {
    if (query.requestRunId === 'run-subagent') {
      return {
        actionId: 'timeline:subagent',
        detailAvailability: { status: 'available' },
        status: 'completed',
        refs: {
          toolCallId: 'call-agent',
          targetAgentId: 'child-agent',
          childLinkAvailability: 'available',
          childAgentId: 'child-agent',
          childSessionId: 'sess-child',
          childRunId: 'run-child',
          childRunStatus: 'COMPLETED',
          payload: { capabilityId: 'child-agent', capabilityKind: 'AGENT', toolName: 'Agent' },
        },
        safeSummary: {
          label: 'child-agent',
          rawUnavailable: false,
          effectiveView: {
            status: 'reconstructed',
            capabilityId: 'child-agent',
            capabilityKind: 'AGENT',
            targetAgentId: 'child-agent',
            childRunId: 'run-child',
          },
        },
        input: { agentId: 'child-agent', prompt: '检查 LTE 小区告警并给出结论' },
        output: { agentId: 'child-agent', status: 'completed', result: { text: '未发现活动告警' } },
      };
    }
    if (query.requestRunId === 'run-tool' && query.actionId !== 'timeline:tool') {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        actionId: query.actionId,
        detailAvailability: { status: 'unavailable', reasonCode: 'ACTION_NOT_FOUND' },
        refs: {},
        safeSummary: {},
      };
    }
    return query.requestRunId === 'run-tool'
      ? {
          actionId: 'timeline:tool',
          detailAvailability: { status: 'available' },
          status: 'completed',
          refs: {
            eventId: 'tool',
            timelineType: 'CAPABILITY_COMPLETED',
            toolCallId: 'call-bash',
            payload: { toolCallId: 'call-bash', toolName: 'Bash', capabilityKind: 'TOOL', fallbackTriggered: true },
          },
          safeSummary: { label: 'Bash', rawUnavailable: false },
          input: { command: 'npm run build\nnpm test' },
          output: { stdout: 'build completed', exitCode: 0 },
        }
      : {
          actionId: 'timeline:model',
          detailAvailability: { status: 'partial', reasonCode: 'SAFE_SUMMARY_ONLY' },
          status: 'completed',
          timing: { startedAt: now - 597000, endedAt: now - 590000, durationMs: 7000 },
          refs: {
            eventId: 'model',
            timelineType: 'MODEL_INVOCATION_COMPLETED',
            payload: {
              stepId: 'turn-1',
              modelId: 'MiniMax-M3',
              finishReason: 'stop',
              usage: { inputTokens: 1000, outputTokens: 234, totalTokens: 1234 },
            },
          },
          safeSummary: {
            label: '模型调用',
            rawUnavailable: true,
            effectiveView: {
              renderedToolNames: ['query_alarms'],
              skillCapabilityIds: ['telecom-qa'],
              agentCapabilityIds: ['diagnosis-agent'],
            },
          },
          promptApproximation: {
            status: 'approximate' as const,
            authoritative: false as const,
            templateRef: 'default-prompt',
            template: {
              templateId: 'system',
              templateRef: 'default-prompt',
              purpose: 'SYSTEM_PROMPT',
              sourceLayer: 'agent',
              sections: [{ id: 'identity', content: '你是电信网络诊断智能体。', variables: [] }],
            },
            selectedMessageRefs: ['m1'],
            selectedMessages: [{ messageId: 'm1', role: 'USER', contentType: 'TEXT', content: '诊断 BC-042 基站信号丢失问题。' }],
            missingMessageRefs: [],
            renderedToolNames: ['query_alarms'],
            limitations: [
              'DYNAMIC_TEMPLATE_VARIABLES_NOT_REPLAYED',
              'TOOL_SCHEMAS_NOT_RECONSTRUCTED',
              'BEFORE_MODEL_INVOKE_HOOK_MUTATIONS_NOT_RECONSTRUCTED',
            ],
          },
        };
  },
  async listLogEvidence() {
    return {
      requestRunId: 'run-1',
      entries: [
        {
          source: 'runtime-diagnostic-log' as const,
          timestamp: now - 590000,
          message: '{"level":"info","msg":"模型调用完成","runId":"run-1"}',
          refs: { requestRunId: 'run-1' },
        },
      ],
      detailAvailability: { status: 'available' },
    };
  },
};

function agentConfiguration(agentId: string, agentAssemblyRef: string, displayName: string) {
  return {
    agentId,
    agentType: 'GENERAL',
    agentVersion: 'v1',
    agentAssemblyRef,
    displayName,
    description: `${displayName} configuration`,
    workspacePolicy: { schemaVersion: 'v1', isolationMode: 'session', roots: [] },
    modelIds: ['MiniMax-M2.7-highspeed'],
    capabilityBindings: [],
    userInvocable: agentId === 'default-agent',
    agentInvocation: agentId === 'default-agent' ? 'BOUND' : 'PARENT',
    runtimeSettings: { maxTurns: 8, maxToolCallsPerTurn: 30 },
  };
}

describe('agent dev workbench browser smoke', () => {
  beforeAll(async () => {
    if (!existsSync(workbenchIndex)) {
      buildWorkbenchWeb();
    }
    server = Fastify({ logger: false });
    server.get('/favicon.ico', async (_request: FastifyRequest, reply: FastifyReply) => reply.code(204).send());
    server.get('/launcher-host', async (_request: FastifyRequest, reply: FastifyReply) =>
      reply
        .type('text/html')
        .send('<!doctype html><html><body><main>Agent page</main><script src="/__nextagent/dev/workbench/launcher.js"></script></body></html>'),
    );
    registerAgentDevWorkbench(server, {
      readPort,
      resolveAccessScope: () => ({ tenantId: 'tenant-a', subjectId: 'subject-a', allowedAgentIds: ['agent-a', 'child-agent', 'zero-child'] }),
    });
    await server.listen({ port, host: '127.0.0.1' });
  }, 120_000);

  afterAll(async () => {
    await server?.close();
  });

  it.skipIf(browserExecutable === undefined)(
    'renders the workbench with graph, conversation, detail and effective view without console errors',
    async () => {
      if (playwright === undefined || browserExecutable === undefined) {
        throw new Error('Browser smoke prerequisites are unavailable.');
      }
      const browser = await playwright.chromium.launch({ executablePath: browserExecutable });
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.addInitScript(() => {
        const drawnTexts: string[] = [];
        Object.defineProperty(window, '__workbenchDrawnTexts', { value: drawnTexts });
        const original = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
          drawnTexts.push(String(text));
          return original.call(this, text, ...args);
        };
      });
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.goto(`${base}/__nextagent/dev/workbench?sessionId=not-authorized`, { waitUntil: 'networkidle', timeout: 15_000 });
      await page.getByText('当前会话不在可访问的调测范围内', { exact: true }).waitFor();
      await page.goto(`${base}/launcher-host#/session/sess-1`, { waitUntil: 'networkidle', timeout: 15_000 });
      await page.getByRole('button', { name: '打开开发者调测工作台' }).click();
      await page.getByText('信号丢失诊断', { exact: true }).first().waitFor();
      expect(await page.evaluate(() => new URLSearchParams(window.location.search).get('sessionId'))).toBe('sess-1');
      await page.waitForTimeout(2500);
      await page.getByText('Token 消耗').waitFor();
      await page.getByText('1,234').waitFor();
      await page.getByText('telecom-qa', { exact: true }).waitFor();
      await page.getByText('diagnosis-agent', { exact: true }).waitFor();
      await page.getByText('Prompt 近似视图', { exact: true }).waitFor();
      await page.getByText('你是电信网络诊断智能体。', { exact: true }).waitFor();
      await page.getByText('动态模板变量未重放', { exact: true }).waitFor();
      await page.getByText('不等同于模型提供商最终收到的请求。', { exact: false }).waitFor();
      expect(await page.getByText('可见能力', { exact: true }).count()).toBe(0);
      expect(await page.getByText('用量', { exact: true }).count()).toBe(0);
      const effectiveTab = page.getByRole('tab', { name: '运行配置' });
      await effectiveTab.click();
      expect(await effectiveTab.getAttribute('aria-selected')).toBe('true');
      await page.getByText('Agent 完整配置', { exact: true }).waitFor();
      await page.getByText('Network Diagnosis Agent', { exact: true }).waitFor();
      await page.getByText('run-parallel', { exact: true }).click();
      await page.waitForTimeout(500);
      const parallelDrawnTexts = await page.evaluate(
        () => (window as unknown as { readonly __workbenchDrawnTexts: readonly string[] }).__workbenchDrawnTexts,
      );
      for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
        expect(parallelDrawnTexts.some((text) => text.includes(`Glob${ordinal}`))).toBe(true);
        expect(parallelDrawnTexts.some((text) => text.includes(`并行 ${ordinal}/5`))).toBe(true);
      }
      expect(parallelDrawnTexts.some((text) => text.includes('并行执行 · 5'))).toBe(true);
      await page.getByText('run-tool', { exact: true }).click();
      await page.waitForTimeout(500);
      await page.getByText('npm run build', { exact: false }).waitFor();
      await page.getByText('build completed').waitFor();
      await page.getByText('fallback 已触发', { exact: true }).waitFor();
      expect(await page.getByText('降级', { exact: true }).count()).toBe(0);
      const drawnTexts = await page.evaluate(
        () => (window as unknown as { readonly __workbenchDrawnTexts: readonly string[] }).__workbenchDrawnTexts,
      );
      expect(drawnTexts.some((text) => text.includes('npm run build'))).toBe(true);
      await effectiveTab.click();
      expect(await page.getByText('模型 ID', { exact: true }).count()).toBeGreaterThan(0);
      await page.getByText('run-subagent', { exact: true }).click();
      await page.getByText('检查 LTE 小区告警并给出结论', { exact: true }).waitFor();
      await page.getByText('未发现活动告警', { exact: false }).waitFor();
      await page.getByRole('button', { name: '打开子运行' }).click();
      await page.getByText('run-child', { exact: true }).first().waitFor();
      const subagentDrawnTexts = await page.evaluate(
        () => (window as unknown as { readonly __workbenchDrawnTexts: readonly string[] }).__workbenchDrawnTexts,
      );
      expect(subagentDrawnTexts.some((text) => text.includes('Subagent · child-agent'))).toBe(true);
      await page.waitForTimeout(200);
      expect(await page.getByText('ACTION_NOT_FOUND').count()).toBe(0);
      const diagnostics = await page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll('.process-graph-canvas canvas')) as HTMLCanvasElement[];
        const canvasRect = document.querySelector('.process-graph-canvas')?.getBoundingClientRect();
        const graphArea = document.querySelector('.wb-graph-area')?.getBoundingClientRect();
        const sidebar = document.querySelector('.wb-sidebar')?.getBoundingClientRect();
        const context = document.querySelector('.wb-context')?.getBoundingClientRect();
        const sessionItems = document.querySelectorAll('.wb-list-item').length;
        const tabLabels = Array.from(document.querySelectorAll('.ant-tabs-tab')).map((t: Element) => t.textContent ?? '');
        let nonBlank = 0;
        for (const canvas of canvases) {
          try {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
              for (let i = 0; i < d.data.length; i += 4) {
                const red = d.data[i] ?? 0;
                const green = d.data[i + 1] ?? 0;
                const blue = d.data[i + 2] ?? 0;
                const alpha = d.data[i + 3] ?? 0;
                if (alpha === 0 || (red > 240 && green > 240 && blue > 240)) {
                  continue;
                }
                nonBlank++;
              }
            }
          } catch {
            /* taint */
          }
        }
        return {
          canvasCount: canvases.length,
          canvasWidth: canvasRect?.width,
          canvasHeight: canvasRect?.height,
          graphAreaWidth: graphArea?.width,
          sidebarWidth: sidebar?.width,
          contextWidth: context?.width,
          sessionItems,
          tabLabels,
          canvasNonBlankPixels: nonBlank,
        };
      });

      console.log('DIAGNOSTICS:', JSON.stringify(diagnostics, null, 2));
      console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors, null, 2));
      console.log('PAGE_ERRORS:', JSON.stringify(pageErrors, null, 2));

      const screenshot = await page.screenshot();

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(diagnostics.sessionItems).toBeGreaterThan(0);
      expect(diagnostics.canvasCount).toBeGreaterThan(0);
      expect(diagnostics.canvasWidth ?? 0).toBeGreaterThan(500);
      expect(diagnostics.canvasHeight ?? 0).toBeGreaterThan(300);
      expect(diagnostics.canvasNonBlankPixels).toBeGreaterThan(100);
      expect(screenshot.byteLength).toBeGreaterThan(100);
      expect(diagnostics.tabLabels.join(',')).toContain('对话');
      expect(diagnostics.tabLabels.join(',')).toContain('详情');
      expect(diagnostics.tabLabels).toHaveLength(4);
      expect(diagnostics.tabLabels.join(',')).not.toContain('Agent');
      expect(diagnostics.tabLabels.join(',')).toContain('运行配置');
      expect(diagnostics.tabLabels.join(',')).toContain('日志');

      await page.evaluate(() => window.history.back());
      await page.getByText('run-subagent', { exact: true }).first().waitFor();

      await browser.close();
    },
    60_000,
  );
});

function loadPlaywright(): PlaywrightModule | undefined {
  try {
    return require('playwright') as PlaywrightModule;
  } catch {
    return undefined;
  }
}

function buildWorkbenchWeb(): void {
  const viteCli = resolve(workbenchRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  execFileSync(process.execPath, [viteCli, 'build', '--config', 'web/vite.config.ts'], {
    cwd: workbenchRoot,
    stdio: 'pipe',
  });
}

function resolveBrowserExecutable(module: PlaywrightModule): string | undefined {
  const candidates = [
    module.chromium.executablePath(),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

interface PlaywrightModule {
  readonly chromium: {
    executablePath: () => string;
    launch: (options: { readonly executablePath: string }) => Promise<BrowserLike>;
  };
}

interface BrowserLike {
  newPage: (options: { readonly viewport: { readonly width: number; readonly height: number } }) => Promise<PageLike>;
  close: () => Promise<void>;
}

interface PageLike {
  addInitScript: (script: () => void) => Promise<void>;
  on: ((event: 'console', handler: (message: ConsoleMessageLike) => void) => void) & ((event: 'pageerror', handler: (error: Error) => void) => void);
  goto: (url: string, options: { readonly waitUntil: 'networkidle'; readonly timeout: number }) => Promise<unknown>;
  waitForTimeout: (timeoutMs: number) => Promise<void>;
  getByText: (text: string, options?: { readonly exact?: boolean }) => LocatorLike;
  getByRole: (role: string, options: { readonly name: string }) => LocatorLike;
  locator: (selector: string) => LocatorLike;
  evaluate: <T>(script: () => T) => Promise<T>;
  screenshot: () => Promise<Uint8Array>;
}

interface ConsoleMessageLike {
  type: () => string;
  text: () => string;
}

interface LocatorLike {
  waitFor: () => Promise<void>;
  count: () => Promise<number>;
  click: () => Promise<void>;
  getAttribute: (name: string) => Promise<string | null>;
  first: () => LocatorLike;
  filter: (options: { readonly hasText: string }) => LocatorLike;
}

function parallelGraphNodes(): AgentDevWorkbenchGraphView['nodes'] {
  return [
    graphNode('parallel-model', 'model', '模型调用', {}),
    ...Array.from({ length: 5 }, (_, index) =>
      graphNode(`parallel-tool-${index + 1}`, 'capability', `Glob${index + 1}`, {
        toolName: `Glob${index + 1}`,
        toolCallId: `parallel-call-${index + 1}`,
        stepId: 'turn-1',
        toolBatchExecutionMode: 'PARALLEL',
        toolBatchOrdinal: index + 1,
        toolBatchSize: 5,
      }),
    ),
    graphNode('parallel-terminal', 'terminal', '请求已完成', {}),
  ];
}

function parallelGraphEdges(): AgentDevWorkbenchGraphView['edges'] {
  return [
    { from: 'timeline:parallel-model', to: 'timeline:parallel-tool-1', kind: 'parallel' as const },
    ...Array.from({ length: 4 }, (_, index) => ({
      from: 'timeline:parallel-model',
      to: `timeline:parallel-tool-${index + 2}`,
      kind: 'parallel' as const,
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      from: `timeline:parallel-tool-${index + 1}`,
      to: 'timeline:parallel-terminal',
      kind: 'parallel' as const,
    })),
  ];
}

function graphNode(
  actionId: string,
  type: AgentDevWorkbenchGraphView['nodes'][number]['type'],
  label: string,
  refs: Record<string, unknown>,
): AgentDevWorkbenchGraphView['nodes'][number] {
  return {
    actionId: `timeline:${actionId}`,
    type,
    label,
    status: 'completed',
    durationMs: 100,
    refs: { eventId: actionId, ...refs },
    detailAvailability: { status: 'available' },
  };
}
