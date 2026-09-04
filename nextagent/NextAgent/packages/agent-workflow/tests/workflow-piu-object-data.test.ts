import type { JsonObject } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionEvent } from '@nextagent/agent-contracts/core';
import { describe, expect, it } from 'vitest';
import { createService, recipe, node, baseRequest } from './test-helpers.js';

describe('display-content PIU object data', () => {
  const pyresult = { cell_id: 'NB123', status: 'alarm' } as const;
  const parserTemplate = {
    type: 'PIU',
    data: {
      piuName: 'reportViewer',
      method: 'render',
      piuVersion: '1.0.0',
      data: '${pyresult}',
    },
  };

  function piuRecipe(parserSource: 'outputs' | 'node' | 'presentation' = 'outputs', inputs?: JsonObject): RecipeDefinition {
    const show: RecipeDefinition['flowGraph']['nodes'][string] = {
      type: 'DISPLAY',
      ...(inputs === undefined ? {} : { inputs }),
      ...(parserSource === 'outputs'
        ? { outputs: { output_parser: parserTemplate } }
        : parserSource === 'node'
          ? { outputParser: parserTemplate }
          : { presentation: { outputParser: parserTemplate } }),
      next: { end: {} },
    };
    return recipe({
      start: node('START', { show: {} }),
      show,
      end: node('END'),
    });
  }

  function requestWithUpstream() {
    return {
      ...baseRequest(),
      inputVariables: { pyresult } as unknown as JsonObject,
    };
  }

  it('does not throw WORKFLOW_NODE_INPUT_INVALID for PIU type with object upstream data', async () => {
    const service = createService({ recipe: piuRecipe() });
    const result = await service.execute(requestWithUpstream(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    const showResult = result.nodeResults.find((item) => item.nodeId === 'show');
    expect(showResult?.status).toBe('NODE_COMPLETED');
  });

  it('resolves output_parser.data.data template against upstream variables', async () => {
    const service = createService({ recipe: piuRecipe() });
    const result = await service.execute(requestWithUpstream(), new AbortController().signal);
    const showResult = result.nodeResults.find((item) => item.nodeId === 'show');
    const parser = (showResult?.output as Record<string, unknown>)?.output_parser as Record<string, unknown> | undefined;
    expect(parser?.data).toMatchObject({
      piuName: 'reportViewer',
      method: 'render',
      piuVersion: '1.0.0',
      data: pyresult,
    });
  });

  it.each(['outputs', 'node', 'presentation'] as const)(
    'does not emit a redundant CONTENT stream delta for %s parser PIU object data',
    async (parserSource) => {
      const observedEvents: WorkflowExecutionEvent[] = [];
      const service = createService({
        recipe: piuRecipe(parserSource),
        emitEvent: async (event) => {
          observedEvents.push(event);
        },
      });
      await service.execute(requestWithUpstream(), new AbortController().signal);
      const redundantContentDelta = observedEvents.find(
        (event) =>
          event.nodeId === 'show' &&
          event.eventType === 'NODE_OUTPUT_DELTA' &&
          (event.visibleDelta as unknown as Record<string, unknown>)?.channel === 'CONTENT',
      );
      expect(redundantContentDelta).toBeUndefined();
    },
  );

  it('projects safe text input when PIU object data is also present', async () => {
    const observedEvents: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: piuRecipe('outputs', { content: 'safe report' }),
      emitEvent: async (event) => {
        observedEvents.push(event);
      },
    });
    const result = await service.execute(requestWithUpstream(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(
      observedEvents.some(
        (event) =>
          event.nodeId === 'show' &&
          event.eventType === 'NODE_OUTPUT_DELTA' &&
          (event.visibleDelta as unknown as Record<string, unknown>)?.content === 'safe report',
      ),
    ).toBe(true);
  });

  it('still rejects unsafe text input when PIU object data is present', async () => {
    const service = createService({
      recipe: piuRecipe('outputs', { content: '<script>alert(1)</script>' }),
    });
    const result = await service.execute(requestWithUpstream(), new AbortController().signal);
    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'show')).toMatchObject({
      status: 'NODE_FAILED' as const,
      safeError: {
        code: 'WORKFLOW_DISPLAY_CONTENT_UNSAFE',
        category: 'VALIDATION',
      },
    });
  });

  it('serializes OBJECT display content as a JSON string', async () => {
    const observedEvents: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { show: {} }),
        show: {
          type: 'DISPLAY',
          outputs: {
            cell_id: 'NB123',
            status: '告警恢复',
            output_parser: { type: 'OBJECT' },
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      emitEvent: async (event) => {
        observedEvents.push(event);
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(
      observedEvents.find(
        (event) =>
          event.nodeId === 'show' &&
          event.eventType === 'NODE_OUTPUT_DELTA' &&
          (event.visibleDelta as unknown as Record<string, unknown>)?.channel === 'CONTENT',
      ),
    ).toMatchObject({
      visibleDelta: {
        channel: 'CONTENT',
        content: '{"cell_id":"NB123","status":"告警恢复"}',
      },
    });
  });
});
