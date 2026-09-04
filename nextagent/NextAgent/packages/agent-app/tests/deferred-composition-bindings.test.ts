import type { CapabilityInvocationPort, SubagentExecutionPort } from '@nextagent/agent-contracts/capability';
import type { LifecycleHookInvocationPort, SessionTimelineEventInput } from '@nextagent/agent-contracts/runtime';
import type { createWorkflowRuntimeAdapters } from '@nextagent/agent-workflow';
import { describe, expect, it, vi } from 'vitest';
import { createCompositionDeferredBindings } from '../src/composition/deferred-composition-bindings.js';

type WorkflowRuntimeAdapters = ReturnType<typeof createWorkflowRuntimeAdapters>;

describe('composition deferred bindings', () => {
  it('keeps only the six fixed cycle bindings', () => {
    const bindings = createCompositionDeferredBindings();

    expect(Object.keys(bindings).sort()).toEqual([
      'backgroundRuntimeTimeline',
      'bindBackgroundRuntimeTimelineTarget',
      'bindLifecycleHookInvocationTarget',
      'bindRuntimeSubagentExecution',
      'bindWorkflowCapabilityInvocation',
      'bindWorkflowRuntimeAdapters',
      'bindWorkflowSandboxExecution',
      'lifecycleHookInvocation',
      'runtimeSubagentExecution',
      'workflowCapabilityInvocation',
      'workflowRuntimeAdapters',
      'workflowSandboxExecution',
    ]);
    expect(bindings).not.toHaveProperty('services');
    expect(bindings).not.toHaveProperty('registry');
    expect(bindings).not.toHaveProperty('get');
    expect(bindings).not.toHaveProperty('set');
  });

  it('preserves the lifecycle default and optional workflow/runtime lookups before binding', async () => {
    const bindings = createCompositionDeferredBindings();
    const request = { stage: 'BEFORE_REQUEST', boundary: 'REQUEST' } as unknown as Parameters<LifecycleHookInvocationPort['invoke']>[0];

    await expect(bindings.lifecycleHookInvocation.invoke(request)).resolves.toEqual({
      status: 'CONTINUE',
      boundary: 'REQUEST',
    });
    expect(bindings.workflowCapabilityInvocation()).toBeUndefined();
    expect(bindings.workflowSandboxExecution()).toBeUndefined();
    expect(bindings.workflowRuntimeAdapters()).toBeUndefined();
    expect(bindings.runtimeSubagentExecution()).toBeUndefined();
  });

  it('fails closed when the background timeline is called before its target is bound', async () => {
    const bindings = createCompositionDeferredBindings();

    await expect(bindings.backgroundRuntimeTimeline.emitSessionTimelineEvent({} as SessionTimelineEventInput)).rejects.toThrow(
      'Composition deferred binding for background runtime timeline is not bound.',
    );
  });

  it('rejects rebinding every deferred target', () => {
    const bindings = createCompositionDeferredBindings();
    const lifecycleTarget = { invoke: vi.fn() } as unknown as LifecycleHookInvocationPort;
    const capabilityTarget = { invoke: vi.fn() } as unknown as CapabilityInvocationPort;
    const workflowTarget = {} as WorkflowRuntimeAdapters;
    const subagentTarget = { execute: vi.fn() } as unknown as SubagentExecutionPort;
    const timelineTarget = { emitSessionTimelineEvent: vi.fn(async () => {}) };

    const bindTwice = [
      () => bindings.bindLifecycleHookInvocationTarget(lifecycleTarget),
      () => bindings.bindWorkflowCapabilityInvocation(capabilityTarget),
      () => bindings.bindWorkflowRuntimeAdapters(workflowTarget),
      () => bindings.bindRuntimeSubagentExecution(subagentTarget),
      () => bindings.bindBackgroundRuntimeTimelineTarget(timelineTarget),
    ];
    for (const bind of bindTwice) {
      bind();
      expect(bind).toThrow('already bound');
    }
  });
});
