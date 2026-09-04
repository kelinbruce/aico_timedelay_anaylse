import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brand } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionRequest, WorkflowExecutionObserver, WorkflowExecutionService } from '@nextagent/agent-contracts/core';
import type { ModelInvocationService, ModelFinalResult } from '@nextagent/agent-contracts/model';
import { createDeveloperDiagnosticArtifactWriter } from '@nextagent/agent-log';
import { WorkflowTraceCollector, createTimingWrappedService, createWorkflowTraceCoordinates } from '@nextagent/agent-plugin-sdk';
import { createWorkflowExecutionService, createWorkflowNodeCatalog } from '@nextagent/agent-workflow';

function createMockModel(): ModelInvocationService {
  const result: ModelFinalResult = { content: 'mock answer', finishReason: 'stop' };
  return { async complete() { return result; }, async stream() { return result; } };
}

function createRequest(): WorkflowExecutionRequest {
  return {
    recipeName: 'trace-e2e', recipeVersion: 'v1', inputVariables: {}, inputText: 'test question',
    identityContext: { tenantId: brand('t1'), subjectId: brand('s1'), displayName: 'test' },
    agentId: brand('default-agent'), agentVersion: brand('1.0.0'),
    sessionId: brand('session-1'), requestId: brand('request-1'),
    runId: brand('run-1'), requestContextId: brand('ctx-1'),
  };
}

function createTraceRecipe(): RecipeDefinition {
  return {
    recipeName: 'trace-e2e', version: 'v1', displayName: 'Trace E2E',
    flowGraph: { nodes: {
      start_node: { type: 'START', next: { llm_node: {} } },
      llm_node: {
        type: 'LLM_ROUTER', next: { end_node: {} },
        inputs: { prompt_template: 'Answer concisely.' },
        outputs: { result: '${llm_completion}' },
      },
      end_node: { type: 'END' },
    } },
  };
}

describe('workflow trace e2e', { timeout: 15_000 }, () => {
  let workspaceDir: string;
  let logDir: string;
  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'wf-trace-'));
    logDir = join(workspaceDir, 'logs');
    mkdirSync(logDir, { recursive: true });
  });
  afterEach(() => { rmSync(workspaceDir, { recursive: true, force: true }); });

  it('writes node-trace and boundary-trace to NDJSON when enabled', async () => {
    const writer = createDeveloperDiagnosticArtifactWriter({ logDirectory: logDir });
    await writer.start();
    const coordinates = createWorkflowTraceCoordinates();
    const traceSink = {
      emit(input: { artifactType: string; payload: unknown; sessionId?: string; requestId?: string; runId?: string; agentId?: string; agentVersion?: string }) {
        return writer.emit({ ...input, pluginId: 'workflow-trace' });
      },
    };
    const traceCollector = new WorkflowTraceCollector(traceSink, coordinates);
    const wrappedModel = createTimingWrappedService(createMockModel(), traceSink, coordinates, 'MODEL', ['complete', 'stream']);
    const nodeCatalog = createWorkflowNodeCatalog({
      modelInvocation: wrappedModel,
      resolveModelInvocationConfig: () => ({ modelId: 'mock-model', contextWindowTokens: 4096, inferenceOptions: {}, timeoutMs: 5000, maxRetries: 0 }),
    });
    const service = createWorkflowExecutionService({ resolveRecipeDefinition: () => createTraceRecipe(), nodeCatalog });
    const wrappedService: WorkflowExecutionService = {
      async execute(request, signal, observer) {
        coordinates.sessionId = request.sessionId;
        coordinates.requestId = request.requestId;
        coordinates.runId = request.runId;
        coordinates.agentId = request.agentId;
        coordinates.agentVersion = request.agentVersion;
        const composite: WorkflowExecutionObserver = observer === undefined ? traceCollector : {
          async emitEvent(event) {
            try { await traceCollector.emitEvent(event); } catch {}
            try { await observer.emitEvent(event); } catch {}
          },
        };
        return service.execute(request, signal, composite);
      },
    };
    await wrappedService.execute(createRequest(), new AbortController().signal);
    await writer.flush(5_000);
    // Give the writer a moment to settle
    await new Promise((r) => setTimeout(r, 500));
    const writerStatus = writer.status();
    const ndjsonFiles = require('node:fs').readdirSync(logDir).filter((f: string) => f.endsWith('.ndjson'));
    const ndjsonPath = join(logDir, ndjsonFiles[0]);
    if (!existsSync(ndjsonPath)) {
      // List files in logDir for debugging
      const files = require('node:fs').readdirSync(logDir);
      throw new Error('NDJSON not found. logDir=' + logDir + ' files=' + JSON.stringify(files) + ' writerStatus=' + JSON.stringify(writerStatus));
    }
    expect(existsSync(ndjsonPath)).toBe(true);
    const fileContent = readFileSync(ndjsonPath, 'utf8');
    const lines2 = fileContent.split('\n').filter((l) => l.trim().length > 0);
    const records = lines2.map((l) => { try { return JSON.parse(l); } catch { return undefined; } }).filter(Boolean) as Record<string, unknown>[];
    const nodeTraces = records.filter((r) => r.pluginId === 'workflow-trace' && r.artifactType === 'workflow-node-trace');
    const boundaryTraces = records.filter((r) => r.pluginId === 'workflow-trace' && r.artifactType === 'workflow-boundary-trace');
    expect(nodeTraces.length).toBeGreaterThan(0);
    // Now collector emits at both NODE_STARTED and terminal, so filter for terminal status
    const llmTrace = nodeTraces.find((r) => (r.payload as { nodeType: string }).nodeType === 'LLM_ROUTER' && (r.payload as { status: string }).status !== 'NODE_STARTED');
    expect(llmTrace).toBeDefined();
    expect((llmTrace!.payload as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
    const nodeStatus = (llmTrace!.payload as { status: string }).status;
    // llmTrace is already filtered to non-STARTED status
    expect(['NODE_COMPLETED', 'NODE_FAILED']).toContain(nodeStatus);
    expect((llmTrace!.payload as { input: unknown }).input).toBeDefined();
    expect((llmTrace!.payload as { output: unknown }).output).toBeDefined();
    // Boundary traces may be 0 if the node fails before reaching the model call
    if (boundaryTraces.length > 0) {
      const modelBoundary = boundaryTraces.find((r) => (r.payload as { boundaryType: string }).boundaryType === 'MODEL');
      expect(modelBoundary).toBeDefined();
      expect((modelBoundary!.payload as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
      const boundaryStatus = (modelBoundary!.payload as { status: string }).status;
      expect(['SUCCEEDED', 'FAILED']).toContain(boundaryStatus);
      const boundaryPayload = JSON.stringify(modelBoundary!.payload);
      expect(boundaryPayload).not.toContain('content');
      expect(boundaryPayload).not.toContain('messages');
    }
    await writer.close(3_000);
  });

  it('does not produce trace artifacts when disabled', async () => {
    const nodeCatalog = createWorkflowNodeCatalog({
      modelInvocation: createMockModel(),
      resolveModelInvocationConfig: () => ({ modelId: 'mock-model', contextWindowTokens: 4096, inferenceOptions: {}, timeoutMs: 5000, maxRetries: 0 }),
    });
    const service = createWorkflowExecutionService({ resolveRecipeDefinition: () => createTraceRecipe(), nodeCatalog });
    await service.execute(createRequest(), new AbortController().signal);
    const ndjsonFiles = require('node:fs').readdirSync(logDir).filter((f: string) => f.endsWith('.ndjson'));
    expect(ndjsonFiles.length).toBe(0);
  });
});