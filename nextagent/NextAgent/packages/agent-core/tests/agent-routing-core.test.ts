import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { AgentError, brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { RecipeDefinition, WorkflowExecutionObserver, WorkflowExecutionService } from '@nextagent/agent-contracts/core';
import type { ContextAssembly, ContextEnginePort } from '@nextagent/agent-contracts/context';
import type {
  ModelFinalResult,
  ModelInvocationRequest,
  ModelInvocationService,
  ModelMessage,
  ModelStreamDelta,
} from '@nextagent/agent-contracts/model';
import type {
  AgentPolicyResolution,
  AgentPolicyResolverPort,
  AgentRunStatePort,
  LifecycleHookInvocationPort,
  RequestContext,
  RequestRun,
  RunTimelineEvent,
} from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-routing-core');
const subjectId = brand<string, 'SubjectId'>('subject-routing-core');
const agentId = brand<string, 'AgentId'>('agent-routing-core');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-routing-core');
const requestId = brand<string, 'MessageId'>('request-routing-core');
const runId = brand<string, 'RequestRunId'>('run-routing-core');

describe('agent routing core', () => {
  it('routes a normal accepted request through MODEL_DRIVEN_LOOP before model execution', async () => {
    const harness = makeHarness();

    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(harness.assemblyRegistry.require).toHaveBeenCalledTimes(1);
    expect(harness.assemblyRegistry.require).toHaveBeenCalledWith(agentId, agentVersion);
    expect(harness.capabilityCatalog.listAvailable).toHaveBeenCalledTimes(1);
    expect(harness.contextEngine.assemble).toHaveBeenCalledTimes(1);
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events.some((event) => event.type === 'LLM_CONTENT_DELTA')).toBe(true);
  });

  it('projects only trusted string flow variables into context assembly', async () => {
    const harness = makeHarness();
    const context = makeContext({
      flowVariables: {
        networkEnvironment: 'lab',
        operationLevel: 'PRODUCTION',
        input_question: 'user-controlled template selector',
        internalState: { retryCount: 2 },
        terminalLifecycleHookApplied: true,
      },
    });

    await harness.agent.execute(makeRun(), context, new AbortController().signal);

    expect(harness.contextEngine.assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        flowVariables: {
          networkEnvironment: 'lab',
          operationLevel: 'PRODUCTION',
        },
      }),
      undefined,
      expect.any(AbortSignal),
    );
  });

  it('projects stream deltas once when the terminal result carries its finish marker', async () => {
    const model: ModelInvocationService = {
      complete: vi.fn(async () => {
        throw new Error('not used');
      }),
      stream: vi.fn(
        modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta | ModelFinalResult> {
          yield { content: 'hel' };
          yield { content: 'lo' };
          yield { content: 'hello', finishReason: 'stop' } satisfies ModelFinalResult;
        }),
      ),
    };
    const harness = makeHarness({ model });

    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);

    const contentEvents = harness.runState.events.filter((event) => event.type === 'LLM_CONTENT_DELTA');
    expect(contentEvents.map((event) => event.inlinePayload)).toEqual([
      { content: 'hel', stepId: 'turn-1' },
      { content: 'hello', stepId: 'turn-1' },
      { final: true, content: 'hello' },
    ]);
  });

  it('accepts built-in policy:intent-recognition routing config and stays on the governed default path', async () => {
    const harness = makeHarness({
      assembly: makeAssembly({ routing: { mode: 'policy', policy: { method: 'policy:intent-recognition' } } }),
    });

    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(harness.contextEngine.assemble).toHaveBeenCalledTimes(1);
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'selected',
          reasonCode: 'DEFAULT_MODEL_DRIVEN_LOOP',
        }),
      }),
    );
  });

  it('resolves an Agent-scoped routing policy when no explicit routing is specified', async () => {
    const assembly = makeAssembly({
      policies: [
        {
          policyPointId: 'agentRoutingPolicy',
          pluginId: 'telecom-routing',
          policyId: 'reject-maintenance',
        },
      ],
    });
    const pluginDecide = vi.fn(async () => ({
      kind: 'REJECT' as const,
      safeReason: 'PLUGIN_ROUTING_REJECTED',
    }));
    const policyResolver: AgentPolicyResolverPort = {
      resolve: vi.fn(async (request) => ({
        assembly,
        activation: assembly.policies![0]!,
        policy: {
          policyPointId: request.policyPointId,
          policyId: 'reject-maintenance',
          decide: pluginDecide,
        },
        executable: { decide: pluginDecide },
      })),
    };
    const harness = makeHarness({
      assembly,
      policyResolver,
    });

    await expect(harness.agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_REJECTED',
    });

    expect(policyResolver.resolve).toHaveBeenCalledWith({
      agentId,
      agentVersion,
      agentAssemblyRef: 'agent-routing-core:v1',
      policyPointId: 'agentRoutingPolicy',
    });
    expect(pluginDecide).toHaveBeenCalledWith(makeRun(), makeContext(), expect.any(AbortSignal));
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'rejected',
          reasonCode: 'PLUGIN_ROUTING_REJECTED',
        }),
      }),
    );
  });

  it('matches ordered regex rules and routes the first matching rule to a governed Skill path', async () => {
    const harness = makeHarness({
      assembly: makeAssembly({
        routing: {
          mode: 'policy',
          policy: {
            method: 'policy:intent-recognition',
            rules: [
              { reg: 'alarm', target: { kind: 'SKILL', name: 'alarm-diagnosis' } },
              { reg: 'alarm burst', target: { kind: 'SKILL', name: 'secondary-skill' } },
            ],
          },
        },
      }),
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });

    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'diagnose alarm burst on gNodeB' }), new AbortController().signal);

    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: 'Skill',
        arguments: { name: 'alarm-diagnosis' },
      }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'selected',
          reasonCode: 'POLICY_RULE_SKILL_MATCHED',
        }),
      }),
    );
  });

  it('matches regex rules and routes a workflow target through the workflow execution path', async () => {
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'workflow-execution',
        status: 'COMPLETED' as const,
        outputVariables: { message: 'workflow completed' },
        nodeResults: [],
        startedAt: new Date('2026-06-23T00:00:00.000Z'),
        completedAt: new Date('2026-06-23T00:00:01.000Z'),
      })),
    };
    const harness = makeHarness({
      assembly: makeAssembly({
        routing: {
          mode: 'policy',
          policy: {
            method: 'policy:intent-recognition',
            rules: [{ reg: 'RAN|gNodeB', target: { kind: 'WORKFLOW', name: 'ran-alarm-diagnosis' } }],
          },
        },
      }),
      recipes: [workflowRecipeDefinition()],
      workflowExecutionService,
    });

    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: 'run RAN alarm diagnosis for this gNodeB' }),
      new AbortController().signal,
    );

    expect(workflowExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeName: 'ran-alarm-diagnosis',
      }),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.any(Object),
    );
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'selected',
          reasonCode: 'POLICY_RULE_WORKFLOW_MATCHED',
        }),
      }),
    );
  });

  it('falls back to the model-driven loop when configured regex rules do not match the accepted input', async () => {
    const harness = makeHarness({
      assembly: makeAssembly({
        routing: {
          mode: 'policy',
          policy: {
            method: 'policy:intent-recognition',
            rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }],
          },
        },
      }),
    });

    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'check OSS topology health' }), new AbortController().signal);

    expect(harness.contextEngine.assemble).toHaveBeenCalledTimes(1);
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'selected',
          reasonCode: 'DEFAULT_MODEL_DRIVEN_LOOP',
        }),
      }),
    );
  });

  it('falls back to the model-driven loop when a configured Skill rule targets an unavailable Skill', async () => {
    const harness = makeHarness({
      assembly: makeAssembly({
        routing: {
          mode: 'policy',
          policy: {
            method: 'policy:intent-recognition',
            rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }],
          },
        },
      }),
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => (capabilityId === 'Skill' ? skillToolDescriptor() : undefined)),
      },
    });

    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'diagnose alarm burst on gNodeB' }), new AbortController().signal);

    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
    expect(harness.contextEngine.assemble).toHaveBeenCalledTimes(1);
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'selected',
          reasonCode: 'POLICY_RULE_SKILL_MISS_FALLBACK',
        }),
      }),
    );
  });

  it('does not reinterpret a workflow capability as a configured Skill rule target', async () => {
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => {
        throw new Error('Workflow execution must not run for a Skill rule target.');
      }),
    };
    const harness = makeHarness({
      assembly: makeAssembly({
        routing: {
          mode: 'policy',
          policy: {
            method: 'policy:intent-recognition',
            rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'ran-alarm-diagnosis' } }],
          },
        },
      }),
      recipes: [workflowRecipeDefinition()],
      workflowExecutionService,
    });

    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'diagnose alarm burst on gNodeB' }), new AbortController().signal);

    expect(workflowExecutionService.execute).not.toHaveBeenCalled();
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'selected',
          reasonCode: 'POLICY_RULE_SKILL_MISS_FALLBACK',
        }),
      }),
    );
  });

  it('discloses the routed Skill to the governed Skill loader so it does not require model-side discovery', async () => {
    const harness = makeHarness({
      assembly: makeAssembly({
        routing: {
          mode: 'policy',
          policy: {
            method: 'policy:intent-recognition',
            rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }],
          },
        },
      }),
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });

    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'diagnose alarm burst on gNodeB' }), new AbortController().signal);

    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: 'Skill',
        arguments: { name: 'alarm-diagnosis' },
      }),
      expect.any(AbortSignal),
      expect.objectContaining({
        capabilityResolver: expect.any(Object),
        discoveredSkills: ['alarm-diagnosis'],
      }),
    );
    expect(harness.capabilityCatalog.resolve).toHaveBeenCalledWith(expect.objectContaining({ capabilityId: 'alarm-diagnosis', sessionId }));
  });

  it('keeps a trusted targetSkill constraint ahead of configured policy rules', async () => {
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => {
        throw new Error('Configured rules must not override a trusted targetSkill constraint.');
      }),
    };
    const harness = makeHarness({
      assembly: makeAssembly({
        routing: {
          mode: 'policy',
          policy: {
            method: 'policy:intent-recognition',
            rules: [{ reg: 'RAN|gNodeB', target: { kind: 'WORKFLOW', name: 'ran-alarm-diagnosis' } }],
          },
        },
      }),
      recipes: [workflowRecipeDefinition()],
      workflowExecutionService,
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return capabilityId === 'ran-alarm-diagnosis' ? recipeDescriptor('ran-alarm-diagnosis') : undefined;
        }),
      },
    });

    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: 'diagnose RAN alarms on this gNodeB', routingConstraints: { targetSkill: 'alarm-diagnosis' } }),
      new AbortController().signal,
    );

    expect(workflowExecutionService.execute).not.toHaveBeenCalled();
    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: 'Skill',
        arguments: { name: 'alarm-diagnosis' },
      }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'selected',
          reasonCode: 'POLICY_RULE_TARGET_SKILL_PRIORITY',
        }),
      }),
    );
  });

  it('consumes skillName on DETERMINISTIC_FLOW through the governed Skill loading path', async () => {
    const pluginPolicy = makePluginRoutingPolicy(async () => ({
      kind: 'DETERMINISTIC_FLOW',
      safeReason: 'ROUTE_TO_SKILL',
      skillName: 'alarm-diagnosis',
    }));
    const harness = makeHarness({
      ...pluginPolicy,
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });

    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: 'Skill',
        arguments: { name: 'alarm-diagnosis' },
      }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
    expect(harness.contextEngine.assemble).toHaveBeenCalledTimes(1);
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
  });

  it('consumes recipeName on DETERMINISTIC_FLOW through the plugin routing policy and dispatches to workflow execution', async () => {
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'workflow-execution',
        status: 'COMPLETED' as const,
        outputVariables: { message: 'workflow completed' },
        nodeResults: [],
        startedAt: new Date('2026-06-23T00:00:00.000Z'),
        completedAt: new Date('2026-06-23T00:00:01.000Z'),
      })),
    };
    const pluginPolicy = makePluginRoutingPolicy(async () => ({
      kind: 'DETERMINISTIC_FLOW',
      safeReason: 'PLUGIN_ROUTING_WORKFLOW_MATCHED',
      recipeName: 'ran-alarm-diagnosis',
    }));
    const harness = makeHarness({
      ...pluginPolicy,
      recipes: [workflowRecipeDefinition()],
      workflowExecutionService,
    });

    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(workflowExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeName: 'ran-alarm-diagnosis',
      }),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.any(Object),
    );
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'selected',
          reasonCode: 'PLUGIN_ROUTING_WORKFLOW_MATCHED',
        }),
      }),
    );
  });

  it('prefers recipeName over skillName when both are present on a DETERMINISTIC_FLOW', async () => {
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'workflow-execution',
        status: 'COMPLETED' as const,
        outputVariables: { message: 'workflow completed' },
        nodeResults: [],
        startedAt: new Date('2026-06-23T00:00:00.000Z'),
        completedAt: new Date('2026-06-23T00:00:01.000Z'),
      })),
    };
    const pluginPolicy = makePluginRoutingPolicy(async () => ({
      kind: 'DETERMINISTIC_FLOW',
      safeReason: 'PLUGIN_ROUTING_WORKFLOW_MATCHED',
      recipeName: 'ran-alarm-diagnosis',
      skillName: 'alarm-diagnosis',
    }));
    const harness = makeHarness({
      ...pluginPolicy,
      recipes: [workflowRecipeDefinition()],
      workflowExecutionService,
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });

    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(workflowExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeName: 'ran-alarm-diagnosis',
      }),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.any(Object),
    );
    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: 'Skill' }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
  });

  it('routes a skill directive from accepted input text through the governed Skill loading path', async () => {
    const harness = makeHarness({
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });

    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$skill:alarm-diagnosis diagnose alarms' }),
      new AbortController().signal,
    );

    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: 'Skill',
        arguments: { name: 'alarm-diagnosis' },
      }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'selected',
          reasonCode: 'CAPABILITY_DIRECTIVE_SKILL_MATCHED',
        }),
      }),
    );
  });

  it('routes a workflow directive from accepted input text through workflow execution', async () => {
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'workflow-execution',
        status: 'COMPLETED' as const,
        outputVariables: { message: 'workflow completed' },
        nodeResults: [],
        startedAt: new Date('2026-06-23T00:00:00.000Z'),
        completedAt: new Date('2026-06-23T00:00:01.000Z'),
      })),
    };
    const harness = makeHarness({ recipes: [workflowRecipeDefinition()], workflowExecutionService });

    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$workflow:ran-alarm-diagnosis diagnose RAN alarms' }),
      new AbortController().signal,
    );

    expect(workflowExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeName: 'ran-alarm-diagnosis',
      }),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.any(Object),
    );
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'selected',
          reasonCode: 'CAPABILITY_DIRECTIVE_WORKFLOW_MATCHED',
        }),
      }),
    );
  });

  it('rejects ambiguous capability directives before model, skill, or workflow execution', async () => {
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => {
        throw new Error('not used');
      }),
    };
    const harness = makeHarness({ recipes: [workflowRecipeDefinition()], workflowExecutionService });

    await expect(
      harness.agent.execute(
        makeRun(),
        makeContext({ acceptedInputText: '$skill:alarm-diagnosis $workflow:ran-alarm-diagnosis' }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'ROUTING_REJECTED',
    });

    expect(harness.capabilityInvocation.invoke).not.toHaveBeenCalled();
    expect(workflowExecutionService.execute).not.toHaveBeenCalled();
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'rejected',
          reasonCode: 'CAPABILITY_DIRECTIVE_AMBIGUOUS',
        }),
      }),
    );
  });

  it('does not reinterpret workflow-only capability as a skill directive target', async () => {
    const harness = makeHarness({
      recipes: [workflowRecipeDefinition()],
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [recipeDescriptor('ran-alarm-diagnosis')]),
        resolve: vi.fn(async ({ capabilityId }) => (capabilityId === 'ran-alarm-diagnosis' ? recipeDescriptor('ran-alarm-diagnosis') : undefined)),
      },
    });

    await expect(
      harness.agent.execute(
        makeRun(),
        makeContext({ acceptedInputText: '$skill:ran-alarm-diagnosis diagnose RAN alarms' }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'ROUTING_PREFERRED_SKILL_UNAVAILABLE',
    });

    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
  });

  it('dispatches trusted targetRecipe to workflow execution when the recipe is registered', async () => {
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'workflow-execution',
        status: 'COMPLETED' as const,
        outputVariables: { message: 'workflow completed' },
        nodeResults: [],
        startedAt: new Date('2026-06-23T00:00:00.000Z'),
        completedAt: new Date('2026-06-23T00:00:01.000Z'),
      })),
    };
    const harness = makeHarness({ recipes: [workflowRecipeDefinition()], workflowExecutionService });

    const outcome = await harness.agent.execute(
      makeRun(),
      makeContext({
        routingConstraints: {
          targetRecipe: 'ran-alarm-diagnosis',
        },
      }),
      new AbortController().signal,
    );

    expect(workflowExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeName: 'ran-alarm-diagnosis',
        recipeVersion: 'v1',
        agentId,
        agentVersion,
        sessionId,
        requestId,
        runId,
      }),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.any(Object),
    );
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'COMPLETED' });
    expect(harness.runState.capabilityTerminalAnswers).toEqual(['workflow completed']);
    expect(harness.runState.events).not.toContainEqual(
      expect.objectContaining({ type: 'LLM_CONTENT_DELTA', inlinePayload: expect.objectContaining({ final: true }) }),
    );
  });

  it('projects workflow node visible deltas onto the runtime stream before terminal content', async () => {
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async (_request, _signal, observer) => {
        await observer?.emitEvent({
          executionId: 'workflow-execution',
          nodeId: 'callTool',
          nodeType: 'TOOL',
          eventType: 'NODE_STARTED',
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
        });
        await observer?.emitEvent({
          executionId: 'workflow-execution',
          nodeId: 'callTool',
          nodeType: 'TOOL',
          eventType: 'NODE_COMPLETED',
          output: {
            answer: 'tool final result',
          },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:01.000Z'),
        });
        await observer?.emitEvent({
          executionId: 'workflow-execution',
          nodeId: 'askModel',
          nodeType: 'LLM',
          eventType: 'NODE_OUTPUT_DELTA',
          visibleDelta: {
            channel: 'THINKING',
            content: 'analyzing',
          },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
        });
        await observer?.emitEvent({
          executionId: 'workflow-execution',
          nodeId: 'askModel',
          nodeType: 'LLM',
          eventType: 'NODE_OUTPUT_DELTA',
          visibleDelta: {
            channel: 'CONTENT',
            content: 'workflow ',
          },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
        });
        await observer?.emitEvent({
          executionId: 'workflow-execution',
          nodeId: 'askModel',
          nodeType: 'LLM',
          eventType: 'NODE_OUTPUT_DELTA',
          visibleDelta: {
            channel: 'CONTENT',
            content: 'completed',
          },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
        });
        return {
          executionId: 'workflow-execution',
          status: 'COMPLETED' as const,
          outputVariables: { message: 'workflow completed' },
          nodeResults: [],
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:01.000Z'),
        };
      }),
    };
    const harness = makeHarness({ recipes: [workflowRecipeDefinition()], workflowExecutionService });

    await harness.agent.execute(
      makeRun(),
      makeContext({
        routingConstraints: {
          targetRecipe: 'ran-alarm-diagnosis',
        },
      }),
      new AbortController().signal,
    );

    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'CAPABILITY_STARTED',
        inlinePayload: expect.objectContaining({
          capabilityId: 'code',
          toolCallId: 'workflow:workflow-execution:callTool',
          workflowEventType: 'NODE_STARTED',
          nodeId: 'callTool',
          nodeType: 'TOOL',
        }),
      }),
    );
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'CAPABILITY_COMPLETED',
        inlinePayload: expect.objectContaining({
          capabilityId: 'code',
          toolCallId: 'workflow:workflow-execution:callTool',
          status: 'SUCCEEDED',
        }),
      }),
    );
    expect(
      harness.runState.events.some(
        (event) => event.type === 'CAPABILITY_RESULT_DELTA' && event.inlinePayload['toolCallId'] === 'workflow:workflow-execution:callTool',
      ),
    ).toBe(false);
    const completed = harness.runState.events.find(
      (event) => event.type === 'CAPABILITY_COMPLETED' && event.inlinePayload['toolCallId'] === 'workflow:workflow-execution:callTool',
    );
    expect(completed?.inlinePayload).not.toHaveProperty('output');
    expect(completed?.inlinePayload).not.toHaveProperty('result');
    expect(completed?.inlinePayload).not.toHaveProperty('messageId');
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'LLM_THINKING_DELTA',
        inlinePayload: expect.objectContaining({ reasoning: 'analyzing' }),
      }),
    );
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: expect.objectContaining({ content: 'workflow ' }),
      }),
    );
    expect(harness.runState.capabilityTerminalAnswers).toEqual(['workflow completed']);
    expect(harness.runState.events).not.toContainEqual(
      expect.objectContaining({ type: 'LLM_CONTENT_DELTA', inlinePayload: expect.objectContaining({ final: true }) }),
    );
    expect(harness.runState.appendedMessages).toEqual([]);
  });

  it('uses the registered child recipe and SUB scope for Direct nested Workflow events', async () => {
    const parentRecipe = workflowRecipeDefinition();
    const childRecipe = {
      recipeName: 'child-workflow',
      version: 'v1',
      flowGraph: {
        nodes: {
          childAnswer: {
            type: 'DISPLAY',
            presentation: {
              outputParser: {
                type: 'PIU',
                message_level: 'ANSWER',
                data: { piuName: 'childDiagnosis', piuVersion: '1.0.0' },
              },
            },
            next: {},
          },
        },
      },
    } as unknown as RecipeDefinition;
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async (_request, _signal, observer) => {
        const recipeAwareObserver = observer as WorkflowExecutionObserver & {
          readonly registerExecutionRecipe?: (executionId: string, recipe: RecipeDefinition) => void;
        };
        recipeAwareObserver.registerExecutionRecipe?.('parent-execution', parentRecipe);
        recipeAwareObserver.registerExecutionRecipe?.('child-execution', childRecipe);
        await observer?.emitEvent({
          executionId: 'child-execution',
          nodeExecutionId: 'child-answer-execution',
          nodeId: 'childAnswer',
          nodeType: 'DISPLAY',
          eventType: 'NODE_COMPLETED',
          output: { fallback: 'parent projector must not serialize this value' },
          retryCount: 0,
          startedAt: new Date('2026-06-23T00:00:00.000Z'),
          completedAt: new Date('2026-06-23T00:00:01.000Z'),
        });
        return {
          executionId: 'parent-execution',
          status: 'COMPLETED' as const,
          outputVariables: { message: 'workflow completed' },
          nodeResults: [],
          startedAt: new Date('2026-06-23T00:00:00.000Z'),
          completedAt: new Date('2026-06-23T00:00:01.000Z'),
        };
      }),
    };
    const context = makeContext({ routingConstraints: { targetRecipe: parentRecipe.recipeName } });
    const harness = makeHarness({ recipes: [parentRecipe], workflowExecutionService });

    await harness.agent.execute(makeRun(), context, new AbortController().signal);

    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'TOOL_STRUCTURED_DELTA',
        inlinePayload: expect.objectContaining({
          workflowEventType: 'NODE_COMPLETED',
          nodeId: 'childAnswer',
          toolEventType: 'SUB_CONCLUSION',
          toolMessageType: 'PIU',
          content: { piuName: 'childDiagnosis', piuVersion: '1.0.0' },
        }),
      }),
    );
  });

  it('fails closed after projecting safe workflow terminal content when workflow execution fails', async () => {
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'workflow-execution',
        status: 'FAILED' as const,
        outputVariables: {},
        nodeResults: [
          {
            nodeId: brand<string, 'WorkflowNodeId'>('diagnose'),
            nodeType: 'TOOL' as const,
            status: 'NODE_FAILED' as const,
            safeError: {
              code: 'WORKFLOW_STEP_FAILED',
              message: 'Workflow step failed safely.',
              category: 'INTERNAL' as const,
              retryable: false,
            },
            retryCount: 0,
            startedAt: new Date('2026-06-23T00:00:00.000Z'),
            completedAt: new Date('2026-06-23T00:00:01.000Z'),
          },
        ],
        startedAt: new Date('2026-06-23T00:00:00.000Z'),
        completedAt: new Date('2026-06-23T00:00:01.000Z'),
      })),
    };
    const harness = makeHarness({ recipes: [workflowRecipeDefinition()], workflowExecutionService });

    await expect(
      harness.agent.execute(
        makeRun(),
        makeContext({
          routingConstraints: {
            targetRecipe: 'ran-alarm-diagnosis',
          },
        }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'WORKFLOW_STEP_FAILED',
    });

    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: { final: true, content: 'Workflow step failed safely.' },
      }),
    );
  });

  it('falls back to the model-driven loop when targetRecipe is not registered', async () => {
    const harness = makeHarness({
      workflowExecutionService: {
        execute: vi.fn(async () => {
          throw new Error('not used');
        }),
      },
    });

    await harness.agent.execute(
      makeRun(),
      makeContext({
        routingConstraints: {
          targetRecipe: 'missing-workflow',
        },
      }),
      new AbortController().signal,
    );

    expect(harness.contextEngine.assemble).toHaveBeenCalledTimes(1);
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'selected',
          reasonCode: 'TARGET_RECIPE_MISS_FALLBACK',
        }),
      }),
    );
  });

  it('routes by recipe capability even when assembly recipeIds metadata is stale', async () => {
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'workflow-execution',
        status: 'COMPLETED' as const,
        outputVariables: { message: 'workflow completed' },
        nodeResults: [],
        startedAt: new Date('2026-06-23T00:00:00.000Z'),
        completedAt: new Date('2026-06-23T00:00:01.000Z'),
      })),
    };
    const harness = makeHarness({
      assembly: makeAssembly({ recipeIds: ['other-workflow'] }),
      recipes: [workflowRecipeDefinition()],
      workflowExecutionService,
    });

    await harness.agent.execute(
      makeRun(),
      makeContext({
        routingConstraints: {
          targetRecipe: 'ran-alarm-diagnosis',
        },
      }),
      new AbortController().signal,
    );

    expect(workflowExecutionService.execute).toHaveBeenCalledTimes(1);
    expect(harness.model.stream).not.toHaveBeenCalled();
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'selected',
          reasonCode: 'TARGET_RECIPE_MATCHED',
        }),
      }),
    );
  });

  it('resets accumulated thinking between model invocations separated by capability calls', async () => {
    const modelEvents: ReadonlyArray<readonly ModelStreamDelta[]> = [
      [
        { reasoning: 'A' } as ModelStreamDelta,
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'tool-thinking-1', toolName: 'alarm-diagnosis', arguments: {} }],
        } as ModelStreamDelta,
      ],
      [
        { reasoning: 'B' } as ModelStreamDelta,
        { reasoning: ' + C' } as ModelStreamDelta,
        { content: 'done', finishReason: 'stop' } as ModelStreamDelta,
      ],
    ];
    let modelInvocationIndex = 0;
    const model = {
      complete: vi.fn(async () => {
        throw new Error('not used');
      }),
      stream: vi.fn(
        modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta> {
          const events = modelEvents[Math.min(modelInvocationIndex, modelEvents.length - 1)] ?? [];
          modelInvocationIndex += 1;
          for (const event of events) {
            yield event;
          }
        }),
      ),
    } satisfies ModelInvocationService;
    const harness = makeHarness({
      assembly: makeAssembly({ runtimeSettings: { maxTurns: 2, maxToolCallsPerTurn: 30 } }),
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => (capabilityId === 'alarm-diagnosis' ? preferredSkillDescriptor() : undefined)),
      },
      model,
    });

    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(harness.model.stream).toHaveBeenCalledTimes(2);
    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: 'alarm-diagnosis',
        toolCallId: 'tool-thinking-1',
      }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
    const thinkingEvents = harness.runState.events.filter((event) => event.type === 'LLM_THINKING_DELTA');
    expect(thinkingEvents.map((event) => event.inlinePayload.reasoning)).toEqual(['A', 'A', 'B', 'B + C', 'B + C']);
    expect(thinkingEvents.map((event) => event.inlinePayload.completed)).toEqual([undefined, true, undefined, undefined, true]);
    for (const finalThinking of thinkingEvents.filter((event) => event.inlinePayload.completed === true)) {
      const terminalIndex = harness.runState.events.findIndex(
        (event) => event.type === 'MODEL_INVOCATION_COMPLETED' && event.inlinePayload.stepId === finalThinking.inlinePayload.stepId,
      );
      expect(harness.runState.events.indexOf(finalThinking)).toBeLessThan(terminalIndex);
    }
  });

  it('isolates live accumulated content by model step across capability rounds', async () => {
    const modelEvents: ReadonlyArray<ReadonlyArray<ModelStreamDelta | ModelFinalResult>> = [
      [
        { content: 'same explanation' },
        {
          content: 'same explanation',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'tool-content-1', toolName: 'alarm-diagnosis', arguments: {} }],
        },
      ],
      [
        { content: ' ' },
        {
          content: ' ',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'tool-content-2', toolName: 'alarm-diagnosis', arguments: {} }],
        },
      ],
      [
        { content: 'same explanation' },
        {
          content: 'same explanation',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'tool-content-3', toolName: 'alarm-diagnosis', arguments: {} }],
        },
      ],
      [{ content: 'done' }, { content: 'done', finishReason: 'stop' }],
    ];
    let modelInvocationIndex = 0;
    const model = {
      complete: vi.fn(async () => {
        throw new Error('not used');
      }),
      stream: vi.fn(
        modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta | ModelFinalResult> {
          const events = modelEvents[modelInvocationIndex] ?? [];
          modelInvocationIndex += 1;
          for (const event of events) {
            yield event;
          }
        }),
      ),
    } satisfies ModelInvocationService;
    const descriptor = preferredSkillDescriptor();
    const harness = makeHarness({
      assembly: makeAssembly({ runtimeSettings: { maxTurns: 4, maxToolCallsPerTurn: 30 } }),
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [descriptor]),
        resolve: vi.fn(async ({ capabilityId }) => (capabilityId === descriptor.capabilityId ? descriptor : undefined)),
      },
      model,
    });

    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);

    const liveContent = harness.runState.events
      .filter((event) => event.type === 'LLM_CONTENT_DELTA' && event.inlinePayload.final !== true && typeof event.inlinePayload.content === 'string')
      .map((event) => ({ content: event.inlinePayload.content, stepId: event.inlinePayload.stepId }));
    expect(liveContent).toEqual([
      { content: 'same explanation', stepId: 'turn-1' },
      { content: ' ', stepId: 'turn-2' },
      { content: 'same explanation', stepId: 'turn-3' },
      { content: 'done', stepId: 'turn-4' },
    ]);
  });

  it('does not complete a thinking delta when the invocation has no reasoning', async () => {
    const harness = makeHarness();

    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(harness.runState.events.filter((event) => event.type === 'LLM_THINKING_DELTA')).toEqual([]);
    expect(harness.runState.events.some((event) => event.type === 'MODEL_INVOCATION_COMPLETED')).toBe(true);
  });

  it('ignores blank reasoning deltas instead of emitting invalid thinking events', async () => {
    const model = {
      complete: vi.fn(async () => {
        throw new Error('not used');
      }),
      stream: vi.fn(
        modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta> {
          yield { reasoning: ' \n\t' } as ModelStreamDelta;
          yield { content: 'done', finishReason: 'stop' } as ModelStreamDelta;
        }),
      ),
    } satisfies ModelInvocationService;
    const harness = makeHarness({ model });

    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(harness.runState.events.filter((event) => event.type === 'LLM_THINKING_DELTA')).toEqual([]);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: expect.objectContaining({ content: 'done' }),
      }),
    );
  });

  it('does not publish model terminal when the last thinking delta cannot be persisted', async () => {
    const failure = new Error('completed thinking append failed');
    const model = {
      complete: vi.fn(async () => {
        throw new Error('not used');
      }),
      stream: vi.fn(
        modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta> {
          yield { reasoning: 'checking' } as ModelStreamDelta;
          yield { content: 'done', finishReason: 'stop' } as ModelStreamDelta;
        }),
      ),
    } satisfies ModelInvocationService;
    const harness = makeHarness({ model });
    vi.mocked(harness.runState.emitEvent).mockImplementation(async (_run, _context, event) => {
      if (event.type === 'LLM_THINKING_DELTA' && event.inlinePayload.completed === true) {
        throw failure;
      }
      harness.runState.events.push(event);
    });

    await expect(harness.agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toBe(failure);

    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'LLM_THINKING_DELTA',
        inlinePayload: { reasoning: 'checking', stepId: 'turn-1' },
      }),
    );
    expect(harness.runState.events.some((event) => event.type === 'MODEL_INVOCATION_COMPLETED' || event.type === 'MODEL_INVOCATION_FAILED')).toBe(
      false,
    );
  });

  it('leaves model lifecycle hook mutation to the model-owned wrapper', async () => {
    const hookInputs: unknown[] = [];
    const lifecycleHook: LifecycleHookInvocationPort = {
      invoke: vi.fn(async (request) => {
        hookInputs.push(request);
        if (request.stage === 'BEFORE_MODEL_INVOKE') {
          return { status: 'CONTINUE' as const, boundary: { ...request.boundary, timeoutMs: 1234 } };
        }
        return { status: 'CONTINUE' as const, boundary: request.boundary };
      }),
    };
    const harness = makeHarness({ lifecycleHook });

    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(harness.model.stream).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 30_000 }), expect.any(AbortSignal), expect.any(Function));
    expect(hookInputs).not.toContainEqual(expect.objectContaining({ stage: 'BEFORE_MODEL_INVOKE' }));
    expect(hookInputs).not.toContainEqual(expect.objectContaining({ stage: 'AFTER_MODEL_RESULT' }));
  });

  it('does not duplicate model-result hooks for a tool-call-only model round', async () => {
    const hookInputs: unknown[] = [];
    const lifecycleHook: LifecycleHookInvocationPort = {
      invoke: vi.fn(async (request) => {
        hookInputs.push(request);
        return { status: 'CONTINUE' as const, boundary: request.boundary };
      }),
    };
    const model = {
      complete: vi.fn(async () => {
        throw new Error('not used');
      }),
      stream: vi.fn(
        modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta> {
          yield {
            content: '',
            finishReason: 'tool-calls',
            toolCalls: [{ toolCallId: 'missing-tool-call', toolName: 'Missing', arguments: {} }],
          } as ModelStreamDelta;
        }),
      ),
    } satisfies ModelInvocationService;
    const harness = makeHarness({ lifecycleHook, model });

    await expect(harness.agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toBeInstanceOf(Error);

    expect(hookInputs).not.toContainEqual(expect.objectContaining({ stage: 'AFTER_MODEL_RESULT' }));
  });

  it('restores TodoWrite state from request context into the next model assembly and checkpoint', async () => {
    const todo = { content: 'Inspect AMF alarm', activeForm: 'Inspecting AMF alarm', status: 'completed' as const };
    let modelInvocationIndex = 0;
    const modelEvents: ReadonlyArray<readonly ModelStreamDelta[]> = [
      [
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'todo-call-1', toolName: 'TodoWrite', arguments: { todos: [todo] } }],
        } as ModelStreamDelta,
      ],
      [{ content: 'done', finishReason: 'stop' } as ModelStreamDelta],
    ];
    const model = {
      complete: vi.fn(async () => {
        throw new Error('not used');
      }),
      stream: vi.fn(
        modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta> {
          const events = modelEvents[Math.min(modelInvocationIndex, modelEvents.length - 1)] ?? [];
          modelInvocationIndex += 1;
          for (const event of events) {
            yield event;
          }
        }),
      ),
    } satisfies ModelInvocationService;
    const harness = makeHarness({
      assembly: makeAssembly({ runtimeSettings: { maxTurns: 3, maxToolCallsPerTurn: 30 } }),
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [todoWriteDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => (capabilityId === 'TodoWrite' ? todoWriteDescriptor() : undefined)),
      },
      capabilityInvocation: {
        invoke: vi.fn(async () => ({
          status: 'SUCCEEDED' as const,
          structuredPayload: { oldTodos: [], newTodos: [todo] },
          generatedMessages: [],
          artifactRefs: [],
        })),
      },
      model,
    });
    const context = makeContext();

    await harness.agent.execute(makeRun(), context, new AbortController().signal);

    expect(context.flowVariables['todoWriteState']).toMatchObject({ todos: [todo], updatedAtRunId: runId });
    expect(harness.runState.saveCheckpoint).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), 'CAPABILITY_AFTER_RETURN');
    expect(harness.contextEngine.assemble).toHaveBeenCalledTimes(2);
    expect(harness.contextEngine.assemble).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        capabilityGeneratedMessages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining('Current TodoWrite state'),
          }),
        ]),
      }),
      undefined,
      expect.any(AbortSignal),
    );
  });

  it('gives the model one more turn before terminal completion when TodoWrite has unfinished items', async () => {
    const context = makeContext({
      flowVariables: {
        todoWriteState: {
          todos: [{ content: 'Check UPF route', activeForm: 'Checking UPF route', status: 'pending' }],
        },
      },
    });
    let modelInvocationIndex = 0;
    const model = {
      complete: vi.fn(async () => {
        throw new Error('not used');
      }),
      stream: vi.fn(
        modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta> {
          modelInvocationIndex += 1;
          yield { content: modelInvocationIndex === 1 ? 'premature' : 'confirmed', finishReason: 'stop' } as ModelStreamDelta;
        }),
      ),
    } satisfies ModelInvocationService;
    const harness = makeHarness({
      assembly: makeAssembly({ runtimeSettings: { maxTurns: 3, maxToolCallsPerTurn: 30 } }),
      model,
    });

    await harness.agent.execute(makeRun(), context, new AbortController().signal);

    expect(harness.model.stream).toHaveBeenCalledTimes(2);
    expect(context.flowVariables['todoWriteTerminalGuarded']).toBe(true);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'DEGRADATION_NOTICE',
        inlinePayload: expect.objectContaining({ code: 'TODO_WRITE_UNFINISHED_TERMINAL_GUARD' }),
      }),
    );
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: { final: true, content: 'confirmed' },
      }),
    );
  });

  it('fails closed when a routing policy returns an invalid decision kind', async () => {
    const pluginPolicy = makePluginRoutingPolicy(async () => ({ kind: 'NOT_A_ROUTE', safeReason: 'INVALID' }) as never);
    const harness = makeHarness({
      ...pluginPolicy,
    });

    await expect(harness.agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_REJECTED',
    });
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'rejected',
          reasonCode: 'PLUGIN_ROUTING_POLICY_INVALID_RESULT',
        }),
      }),
    );
  });

  it('fails closed when a routing policy returns a non-string optional field', async () => {
    const pluginPolicy = makePluginRoutingPolicy(async () => ({
      kind: 'DETERMINISTIC_FLOW',
      safeReason: 'ROUTE_TO_WORKFLOW',
      recipeName: 123 as unknown as string,
    }));
    const harness = makeHarness({
      ...pluginPolicy,
      recipes: [workflowRecipeDefinition()],
      workflowExecutionService: {
        execute: vi.fn(async () => {
          throw new Error('not used');
        }),
      },
    });

    await expect(harness.agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_REJECTED',
    });
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'rejected',
          reasonCode: 'PLUGIN_ROUTING_POLICY_INVALID_RESULT',
        }),
      }),
    );
  });

  it('translates REJECT into a safe error path without entering the model loop', async () => {
    const pluginPolicy = makePluginRoutingPolicy(async () => ({ kind: 'REJECT', safeReason: 'POLICY_REJECTED' }));
    const harness = makeHarness({
      ...pluginPolicy,
    });

    await expect(harness.agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_REJECTED',
    });
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({
          policyDomain: 'ROUTING',
          outcome: 'rejected',
          reasonCode: 'POLICY_REJECTED',
        }),
      }),
    );
  });

  it('fails closed when trusted routing policy configuration is invalid', async () => {
    const harness = makeHarness({
      assembly: makeAssembly({ routing: { mode: 'policy' } as never }),
    });

    await expect(harness.agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_POLICY_CONFIGURATION_INVALID',
    });
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
  });

  it('fails closed when trusted routing policy regex configuration is invalid', async () => {
    const harness = makeHarness({
      assembly: makeAssembly({
        routing: {
          mode: 'policy',
          policy: {
            method: 'policy:intent-recognition',
            rules: [{ reg: '(', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }],
          },
        },
      }),
    });

    await expect(
      harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'diagnose alarm' }), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'ROUTING_POLICY_CONFIGURATION_INVALID',
    });
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
  });

  it('fails closed when trusted routing policy regex configuration has nested quantifiers', async () => {
    const harness = makeHarness({
      assembly: makeAssembly({
        routing: {
          mode: 'policy',
          policy: {
            method: 'policy:intent-recognition',
            rules: [{ reg: '(a+)+', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }],
          },
        },
      }),
    });

    await expect(
      harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'aaaaaaaaaaaaaaaa!' }), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'ROUTING_POLICY_CONFIGURATION_INVALID',
    });
    expect(harness.contextEngine.assemble).not.toHaveBeenCalled();
    expect(harness.model.stream).not.toHaveBeenCalled();
  });
});
describe('explicit routing priority over plugin routing policy', () => {
  it('plugin is not called when skill directive is present', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly,
      policyResolver,
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });
    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$skill:alarm-diagnosis diagnose alarms' }),
      new AbortController().signal,
    );
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({ reasonCode: 'CAPABILITY_DIRECTIVE_SKILL_MATCHED' }),
      }),
    );
  });

  it('plugin is not called when workflow directive hits a recipe', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'wf',
        status: 'COMPLETED' as const,
        outputVariables: {},
        nodeResults: [],
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:00:01.000Z'),
      })),
    };
    const harness = makeHarness({ assembly, policyResolver, recipes: [workflowRecipeDefinition()], workflowExecutionService });
    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$workflow:ran-alarm-diagnosis diagnose RAN alarms' }),
      new AbortController().signal,
    );
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(workflowExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ recipeName: 'ran-alarm-diagnosis' }),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('plugin is not called when workflow directive misses and degrades to model loop', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({ assembly, policyResolver });
    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$workflow:nonexistent-recipe do something' }),
      new AbortController().signal,
    );
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({ reasonCode: 'CAPABILITY_DIRECTIVE_WORKFLOW_MISS_FALLBACK' }),
      }),
    );
  });

  it('plugin is not called when directive conflict triggers fail-closed', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({ assembly, policyResolver });
    await expect(
      harness.agent.execute(
        makeRun(),
        makeContext({ acceptedInputText: '$skill:alarm-diagnosis $workflow:ran-alarm-diagnosis diagnose' }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'ROUTING_REJECTED' });
    expect(pluginDecide).not.toHaveBeenCalled();
  });

  it('plugin is not called when targetRecipe constraint is present and recipe is available', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'wf',
        status: 'COMPLETED' as const,
        outputVariables: {},
        nodeResults: [],
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:00:01.000Z'),
      })),
    };
    const harness = makeHarness({ assembly, policyResolver, recipes: [workflowRecipeDefinition()], workflowExecutionService });
    await harness.agent.execute(
      makeRun(),
      makeContext({ routingConstraints: { targetRecipe: 'ran-alarm-diagnosis' } }),
      new AbortController().signal,
    );
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(workflowExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ recipeName: 'ran-alarm-diagnosis' }),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('plugin is not called when targetSkill constraint is present', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly,
      policyResolver,
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });
    await harness.agent.execute(makeRun(), makeContext({ routingConstraints: { targetSkill: 'alarm-diagnosis' } }), new AbortController().signal);
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({ reasonCode: 'POLICY_RULE_TARGET_SKILL_PRIORITY' }),
      }),
    );
  });

  it('plugin is not called when policy rule matches an available Skill target', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly: makeAssembly({
        ...assembly,
        routing: {
          mode: 'policy',
          policy: { method: 'policy:intent-recognition', rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }] },
        },
      }),
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });
    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'diagnose alarm' }), new AbortController().signal);
    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: 'Skill', arguments: { name: 'alarm-diagnosis' } }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
  });

  it('plugin is not called when policy rule matches but target Skill is unavailable and degrades', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly: makeAssembly({
        ...assembly,
        routing: {
          mode: 'policy',
          policy: { method: 'policy:intent-recognition', rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'missing-skill' } }] },
        },
      }),
    });
    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'diagnose alarm' }), new AbortController().signal);
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({ type: 'POLICY_APPLIED', inlinePayload: expect.objectContaining({ reasonCode: 'POLICY_RULE_SKILL_MISS_FALLBACK' }) }),
    );
  });

  it('plugin is called when policy rules do not match the input text', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'PLUGIN_DECIDED_MODEL_LOOP' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly: makeAssembly({
        ...assembly,
        routing: {
          mode: 'policy',
          policy: { method: 'policy:intent-recognition', rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }] },
        },
      }),
      policyResolver,
    });
    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'check topology' }), new AbortController().signal);
    expect(pluginDecide).toHaveBeenCalledWith(makeRun(), expect.any(Object), expect.any(AbortSignal));
  });

  it('plugin is called when no explicit routing is specified', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'PLUGIN_DECIDED_MODEL_LOOP' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({ assembly, policyResolver });
    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);
    expect(pluginDecide).toHaveBeenCalledWith(makeRun(), expect.any(Object), expect.any(AbortSignal));
  });

  it('built-in default model loop is used when no plugin and no explicit routing', async () => {
    const harness = makeHarness();
    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({ type: 'POLICY_APPLIED', inlinePayload: expect.objectContaining({ reasonCode: 'DEFAULT_MODEL_DRIVEN_LOOP' }) }),
    );
  });

  it('explicit routing produces same decision for plugin and non-plugin agents', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const capCatalog = {
      listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
      resolve: vi.fn(async ({ capabilityId }: { capabilityId: string }) => {
        if (capabilityId === 'alarm-diagnosis') {
          return preferredSkillDescriptor();
        }
        if (capabilityId === 'Skill') {
          return skillToolDescriptor();
        }
        return undefined;
      }),
    };
    const pluginHarness = makeHarness({ assembly, policyResolver, capabilityCatalog: capCatalog });
    const builtinHarness = makeHarness({ capabilityCatalog: capCatalog });
    await pluginHarness.agent.execute(makeRun(), makeContext({ acceptedInputText: '$skill:alarm-diagnosis diagnose' }), new AbortController().signal);
    await builtinHarness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$skill:alarm-diagnosis diagnose' }),
      new AbortController().signal,
    );
    const pluginReason = (
      pluginHarness.runState.events.find((e: RunTimelineEvent) => e.type === 'POLICY_APPLIED') as { inlinePayload?: { reasonCode?: string } }
    )?.inlinePayload?.reasonCode;
    const builtinReason = (
      builtinHarness.runState.events.find((e: RunTimelineEvent) => e.type === 'POLICY_APPLIED') as { inlinePayload?: { reasonCode?: string } }
    )?.inlinePayload?.reasonCode;
    expect(pluginReason).toBe(builtinReason);
    expect(pluginDecide).not.toHaveBeenCalled();
  });

  it('plugin is not called when AbortSignal is already aborted', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({ assembly, policyResolver });
    const controller = new AbortController();
    controller.abort();
    await expect(harness.agent.execute(makeRun(), makeContext(), controller.signal)).rejects.toMatchObject({ code: 'ROUTING_ABORTED' });
    expect(pluginDecide).not.toHaveBeenCalled();
  });
});

describe('explicit routing priority over plugin routing policy', () => {
  it('plugin is not called when skill directive is present', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly,
      policyResolver,
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });
    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$skill:alarm-diagnosis diagnose alarms' }),
      new AbortController().signal,
    );
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({ reasonCode: 'CAPABILITY_DIRECTIVE_SKILL_MATCHED' }),
      }),
    );
  });

  it('plugin is not called when workflow directive hits a recipe', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'wf',
        status: 'COMPLETED' as const,
        outputVariables: {},
        nodeResults: [],
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:00:01.000Z'),
      })),
    };
    const harness = makeHarness({ assembly, policyResolver, recipes: [workflowRecipeDefinition()], workflowExecutionService });
    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$workflow:ran-alarm-diagnosis diagnose RAN alarms' }),
      new AbortController().signal,
    );
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(workflowExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ recipeName: 'ran-alarm-diagnosis' }),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('plugin is not called when workflow directive misses and degrades to model loop', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({ assembly, policyResolver });
    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$workflow:nonexistent-recipe do something' }),
      new AbortController().signal,
    );
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({ reasonCode: 'CAPABILITY_DIRECTIVE_WORKFLOW_MISS_FALLBACK' }),
      }),
    );
  });

  it('plugin is not called when directive conflict triggers fail-closed', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({ assembly, policyResolver });
    await expect(
      harness.agent.execute(
        makeRun(),
        makeContext({ acceptedInputText: '$skill:alarm-diagnosis $workflow:ran-alarm-diagnosis diagnose' }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'ROUTING_REJECTED' });
    expect(pluginDecide).not.toHaveBeenCalled();
  });

  it('plugin is not called when targetRecipe constraint is present and recipe is available', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'wf',
        status: 'COMPLETED' as const,
        outputVariables: {},
        nodeResults: [],
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:00:01.000Z'),
      })),
    };
    const harness = makeHarness({ assembly, policyResolver, recipes: [workflowRecipeDefinition()], workflowExecutionService });
    await harness.agent.execute(
      makeRun(),
      makeContext({ routingConstraints: { targetRecipe: 'ran-alarm-diagnosis' } }),
      new AbortController().signal,
    );
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(workflowExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ recipeName: 'ran-alarm-diagnosis' }),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('plugin is not called when targetSkill constraint is present', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly,
      policyResolver,
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });
    await harness.agent.execute(makeRun(), makeContext({ routingConstraints: { targetSkill: 'alarm-diagnosis' } }), new AbortController().signal);
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({ reasonCode: 'POLICY_RULE_TARGET_SKILL_PRIORITY' }),
      }),
    );
  });

  it('plugin is not called when policy rule matches an available Skill target', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly: makeAssembly({
        ...assembly,
        routing: {
          mode: 'policy',
          policy: { method: 'policy:intent-recognition', rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }] },
        },
      }),
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });
    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'diagnose alarm' }), new AbortController().signal);
    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: 'Skill', arguments: { name: 'alarm-diagnosis' } }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
  });

  it('plugin is not called when policy rule matches but target Skill is unavailable and degrades', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly: makeAssembly({
        ...assembly,
        routing: {
          mode: 'policy',
          policy: { method: 'policy:intent-recognition', rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'missing-skill' } }] },
        },
      }),
    });
    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'diagnose alarm' }), new AbortController().signal);
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({ type: 'POLICY_APPLIED', inlinePayload: expect.objectContaining({ reasonCode: 'POLICY_RULE_SKILL_MISS_FALLBACK' }) }),
    );
  });

  it('plugin is called when policy rules do not match the input text', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'PLUGIN_DECIDED_MODEL_LOOP' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly: makeAssembly({
        ...assembly,
        routing: {
          mode: 'policy',
          policy: { method: 'policy:intent-recognition', rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }] },
        },
      }),
      policyResolver,
    });
    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'check topology' }), new AbortController().signal);
    expect(pluginDecide).toHaveBeenCalledWith(makeRun(), expect.any(Object), expect.any(AbortSignal));
  });

  it('plugin is called when no explicit routing is specified', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'PLUGIN_DECIDED_MODEL_LOOP' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({ assembly, policyResolver });
    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);
    expect(pluginDecide).toHaveBeenCalledWith(makeRun(), expect.any(Object), expect.any(AbortSignal));
  });

  it('built-in default model loop is used when no plugin and no explicit routing', async () => {
    const harness = makeHarness();
    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({ type: 'POLICY_APPLIED', inlinePayload: expect.objectContaining({ reasonCode: 'DEFAULT_MODEL_DRIVEN_LOOP' }) }),
    );
  });

  it('explicit routing produces same decision for plugin and non-plugin agents', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const capCatalog = {
      listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
      resolve: vi.fn(async ({ capabilityId }: { capabilityId: string }) => {
        if (capabilityId === 'alarm-diagnosis') {
          return preferredSkillDescriptor();
        }
        if (capabilityId === 'Skill') {
          return skillToolDescriptor();
        }
        return undefined;
      }),
    };
    const pluginHarness = makeHarness({ assembly, policyResolver, capabilityCatalog: capCatalog });
    const builtinHarness = makeHarness({ capabilityCatalog: capCatalog });
    await pluginHarness.agent.execute(makeRun(), makeContext({ acceptedInputText: '$skill:alarm-diagnosis diagnose' }), new AbortController().signal);
    await builtinHarness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$skill:alarm-diagnosis diagnose' }),
      new AbortController().signal,
    );
    const pluginReason = (
      pluginHarness.runState.events.find((e: RunTimelineEvent) => e.type === 'POLICY_APPLIED') as { inlinePayload?: { reasonCode?: string } }
    )?.inlinePayload?.reasonCode;
    const builtinReason = (
      builtinHarness.runState.events.find((e: RunTimelineEvent) => e.type === 'POLICY_APPLIED') as { inlinePayload?: { reasonCode?: string } }
    )?.inlinePayload?.reasonCode;
    expect(pluginReason).toBe(builtinReason);
    expect(pluginDecide).not.toHaveBeenCalled();
  });

  it('plugin is not called when AbortSignal is already aborted', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({ assembly, policyResolver });
    const controller = new AbortController();
    controller.abort();
    await expect(harness.agent.execute(makeRun(), makeContext(), controller.signal)).rejects.toMatchObject({ code: 'ROUTING_ABORTED' });
    expect(pluginDecide).not.toHaveBeenCalled();
  });
});

describe('explicit routing priority over plugin routing policy', () => {
  it('plugin is not called when skill directive is present', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly,
      policyResolver,
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });
    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$skill:alarm-diagnosis diagnose alarms' }),
      new AbortController().signal,
    );
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({ reasonCode: 'CAPABILITY_DIRECTIVE_SKILL_MATCHED' }),
      }),
    );
  });

  it('plugin is not called when workflow directive hits a recipe', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'wf',
        status: 'COMPLETED' as const,
        outputVariables: {},
        nodeResults: [],
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:00:01.000Z'),
      })),
    };
    const harness = makeHarness({ assembly, policyResolver, recipes: [workflowRecipeDefinition()], workflowExecutionService });
    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$workflow:ran-alarm-diagnosis diagnose RAN alarms' }),
      new AbortController().signal,
    );
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(workflowExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ recipeName: 'ran-alarm-diagnosis' }),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('plugin is not called when workflow directive misses and degrades to model loop', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({ assembly, policyResolver });
    await harness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$workflow:nonexistent-recipe do something' }),
      new AbortController().signal,
    );
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({ reasonCode: 'CAPABILITY_DIRECTIVE_WORKFLOW_MISS_FALLBACK' }),
      }),
    );
  });

  it('plugin is not called when directive conflict triggers fail-closed', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({ assembly, policyResolver });
    await expect(
      harness.agent.execute(
        makeRun(),
        makeContext({ acceptedInputText: '$skill:alarm-diagnosis $workflow:ran-alarm-diagnosis diagnose' }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'ROUTING_REJECTED' });
    expect(pluginDecide).not.toHaveBeenCalled();
  });

  it('plugin is not called when targetRecipe constraint is present and recipe is available', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const workflowExecutionService: WorkflowExecutionService = {
      execute: vi.fn(async () => ({
        executionId: 'wf',
        status: 'COMPLETED' as const,
        outputVariables: {},
        nodeResults: [],
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:00:01.000Z'),
      })),
    };
    const harness = makeHarness({ assembly, policyResolver, recipes: [workflowRecipeDefinition()], workflowExecutionService });
    await harness.agent.execute(
      makeRun(),
      makeContext({ routingConstraints: { targetRecipe: 'ran-alarm-diagnosis' } }),
      new AbortController().signal,
    );
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(workflowExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ recipeName: 'ran-alarm-diagnosis' }),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('plugin is not called when targetSkill constraint is present', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly,
      policyResolver,
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });
    await harness.agent.execute(makeRun(), makeContext({ routingConstraints: { targetSkill: 'alarm-diagnosis' } }), new AbortController().signal);
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({
        type: 'POLICY_APPLIED',
        inlinePayload: expect.objectContaining({ reasonCode: 'POLICY_RULE_TARGET_SKILL_PRIORITY' }),
      }),
    );
  });

  it('plugin is not called when policy rule matches an available Skill target', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly: makeAssembly({
        ...assembly,
        routing: {
          mode: 'policy',
          policy: { method: 'policy:intent-recognition', rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }] },
        },
      }),
      capabilityCatalog: {
        listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
        resolve: vi.fn(async ({ capabilityId }) => {
          if (capabilityId === 'alarm-diagnosis') {
            return preferredSkillDescriptor();
          }
          if (capabilityId === 'Skill') {
            return skillToolDescriptor();
          }
          return undefined;
        }),
      },
    });
    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'diagnose alarm' }), new AbortController().signal);
    expect(harness.capabilityInvocation.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: 'Skill', arguments: { name: 'alarm-diagnosis' } }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
  });

  it('plugin is not called when policy rule matches but target Skill is unavailable and degrades', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'REJECT' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly: makeAssembly({
        ...assembly,
        routing: {
          mode: 'policy',
          policy: { method: 'policy:intent-recognition', rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'missing-skill' } }] },
        },
      }),
    });
    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'diagnose alarm' }), new AbortController().signal);
    expect(pluginDecide).not.toHaveBeenCalled();
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({ type: 'POLICY_APPLIED', inlinePayload: expect.objectContaining({ reasonCode: 'POLICY_RULE_SKILL_MISS_FALLBACK' }) }),
    );
  });

  it('plugin is called when policy rules do not match the input text', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'PLUGIN_DECIDED_MODEL_LOOP' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({
      assembly: makeAssembly({
        ...assembly,
        routing: {
          mode: 'policy',
          policy: { method: 'policy:intent-recognition', rules: [{ reg: 'alarm', target: { kind: 'SKILL', name: 'alarm-diagnosis' } }] },
        },
      }),
      policyResolver,
    });
    await harness.agent.execute(makeRun(), makeContext({ acceptedInputText: 'check topology' }), new AbortController().signal);
    expect(pluginDecide).toHaveBeenCalledWith(makeRun(), expect.any(Object), expect.any(AbortSignal));
  });

  it('plugin is called when no explicit routing is specified', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'PLUGIN_DECIDED_MODEL_LOOP' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({ assembly, policyResolver });
    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);
    expect(pluginDecide).toHaveBeenCalledWith(makeRun(), expect.any(Object), expect.any(AbortSignal));
  });

  it('built-in default model loop is used when no plugin and no explicit routing', async () => {
    const harness = makeHarness();
    await harness.agent.execute(makeRun(), makeContext(), new AbortController().signal);
    expect(harness.model.stream).toHaveBeenCalledTimes(1);
    expect(harness.runState.events).toContainEqual(
      expect.objectContaining({ type: 'POLICY_APPLIED', inlinePayload: expect.objectContaining({ reasonCode: 'DEFAULT_MODEL_DRIVEN_LOOP' }) }),
    );
  });

  it('explicit routing produces same decision for plugin and non-plugin agents', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const capCatalog = {
      listAvailable: vi.fn(async () => [preferredSkillDescriptor(), skillToolDescriptor()]),
      resolve: vi.fn(async ({ capabilityId }: { capabilityId: string }) => {
        if (capabilityId === 'alarm-diagnosis') {
          return preferredSkillDescriptor();
        }
        if (capabilityId === 'Skill') {
          return skillToolDescriptor();
        }
        return undefined;
      }),
    };
    const pluginHarness = makeHarness({ assembly, policyResolver, capabilityCatalog: capCatalog });
    const builtinHarness = makeHarness({ capabilityCatalog: capCatalog });
    await pluginHarness.agent.execute(makeRun(), makeContext({ acceptedInputText: '$skill:alarm-diagnosis diagnose' }), new AbortController().signal);
    await builtinHarness.agent.execute(
      makeRun(),
      makeContext({ acceptedInputText: '$skill:alarm-diagnosis diagnose' }),
      new AbortController().signal,
    );
    const pluginReason = (
      pluginHarness.runState.events.find((e: RunTimelineEvent) => e.type === 'POLICY_APPLIED') as { inlinePayload?: { reasonCode?: string } }
    )?.inlinePayload?.reasonCode;
    const builtinReason = (
      builtinHarness.runState.events.find((e: RunTimelineEvent) => e.type === 'POLICY_APPLIED') as { inlinePayload?: { reasonCode?: string } }
    )?.inlinePayload?.reasonCode;
    expect(pluginReason).toBe(builtinReason);
    expect(pluginDecide).not.toHaveBeenCalled();
  });

  it('plugin is not called when AbortSignal is already aborted', async () => {
    const pluginDecide = vi.fn(async () => ({ kind: 'MODEL_DRIVEN_LOOP' as const, safeReason: 'SHOULD_NOT_BE_CALLED' }));
    const { assembly, policyResolver } = makePluginRoutingPolicy(pluginDecide);
    const harness = makeHarness({ assembly, policyResolver });
    const controller = new AbortController();
    controller.abort();
    await expect(harness.agent.execute(makeRun(), makeContext(), controller.signal)).rejects.toMatchObject({ code: 'ROUTING_ABORTED' });
    expect(pluginDecide).not.toHaveBeenCalled();
  });
});

function makeRun(): RequestRun {
  return {
    runId,
    sessionId,
    requestId,
    agentId,
    agentVersion,
    agentAssemblyRef: 'agent-routing-core:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-routing-core'),
    sessionId,
    requestId,
    runId,
    identityContext: { tenantId, subjectId, displayName: 'Routing Core' },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId,
    agentVersion,
    agentAssemblyRef: 'agent-routing-core:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
    ...overrides,
    agentTurnIndex: overrides.agentTurnIndex ?? 0,
  };
}

function makeAssembly(overrides: Partial<AgentAssembly> = {}): AgentAssembly {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion,
    agentAssemblyRef: 'agent-routing-core:v1',
    displayName: 'Routing Core Agent',
    description: 'Test',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxTurns: 1, maxToolCallsPerTurn: 30 },
    ...overrides,
  };
}

function makePluginRoutingPolicy(
  decide: AgentPolicyResolution<'agentRoutingPolicy'>['executable']['decide'],
  assembly = makeAssembly({
    policies: [
      {
        policyPointId: 'agentRoutingPolicy',
        pluginId: 'telecom-routing',
        policyId: 'test-routing',
        enabled: true,
      },
    ],
  }),
): { readonly assembly: AgentAssembly; readonly policyResolver: AgentPolicyResolverPort } {
  const activation = assembly.policies![0]!;
  return {
    assembly,
    policyResolver: {
      resolve: vi.fn(async (request) => ({
        assembly,
        activation,
        policy: {
          policyPointId: request.policyPointId,
          policyId: activation.policyId,
          decide,
        },
        executable: { decide },
      })),
    },
  };
}

function makeHarness(
  options: {
    policyResolver?: AgentPolicyResolverPort;
    assembly?: AgentAssembly;
    capabilityCatalog?: CapabilityCatalog;
    model?: ModelInvocationService;
    capabilityInvocation?: CapabilityInvocationPort;
    lifecycleHook?: LifecycleHookInvocationPort;
    recipes?: readonly RecipeDefinition[];
    workflowExecutionService?: WorkflowExecutionService;
    visibleCapabilities?: readonly CapabilityDescriptor[];
  } = {},
) {
  const assembly = options.assembly ?? makeAssembly();
  const recipes = options.recipes ?? [];
  const recipeMap = new Map(recipes.map((recipe) => [recipe.recipeName, recipe]));
  const assemblyRegistry: AgentAssemblyRegistry = {
    active: vi.fn(async () => {
      throw new AgentError({
        code: 'ACTIVE_FALLBACK_FORBIDDEN',
        message: 'active() must not be used in routing.',
        category: 'INTERNAL',
        retryable: false,
      });
    }),
    require: vi.fn(async () => assembly),
  };
  const capabilityCatalog: CapabilityCatalog = options.capabilityCatalog ?? {
    listAvailable: vi.fn(async () => []),
    resolve: vi.fn(async (request) => {
      const recipe = recipeMap.get(String(request.capabilityId));
      return recipe === undefined ? undefined : recipeDescriptor(recipe.recipeName);
    }),
  };
  const contextAssembly: ContextAssembly = {
    request: {
      sessionId,
      requestId,
      requestContextId: brand<string, 'RequestContextId'>('context-routing-core'),
      identityContext: { tenantId, subjectId, displayName: 'Routing Core' },
      agentId,
      agentVersion,
      runId,
      stepId: 'turn-1',
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      purpose: 'minimal-question-answer',
    },
    systemPrompt: { sections: [] },
    selectedMessageRefs: [],
    visibleCapabilities: options.visibleCapabilities ?? [],
    modelConfiguration: {
      modelId: 'test-model',
      contextWindowTokens: 128_000,
      temperature: 0.55,
      maxOutputTokens: 1024,
      topP: 1,
      toolChoice: 'AUTO' as const,
      defaultTimeoutMs: 30_000,
      defaultMaxRetries: 2,
    },
    modelOptions: { maxOutputTokens: 1024 },
    modelSelectionReason: 'test',
  };
  const contextEngine: ContextEnginePort = {
    assemble: vi.fn(async () => contextAssembly),
    render: vi.fn(async () => ({
      requestContextId: brand<string, 'RequestContextId'>('context-routing-core'),
      messages: [],
      tools: [],
      modelConfiguration: {
        modelId: 'test-model',
        contextWindowTokens: 128_000,
        temperature: 0.55,
        maxOutputTokens: 1024,
        topP: 1,
        toolChoice: 'AUTO' as const,
        defaultTimeoutMs: 30_000,
        defaultMaxRetries: 2,
      },
      modelOptions: { maxOutputTokens: 1024 },
      providerOptions: {},
    })),
  };
  const model =
    options.model ??
    ({
      complete: vi.fn(async () => {
        throw new Error('not used');
      }),
      stream: vi.fn(
        modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta> {
          yield { content: 'ok', finishReason: 'stop' } as ModelStreamDelta;
        }),
      ),
    } satisfies ModelInvocationService);
  const runState = makeRunState();
  const capabilityInvocation = options.capabilityInvocation ?? makeCapabilityInvocation();
  const agent = new DefaultAgent({
    contextEngine,
    model,
    capabilityCatalog,
    capabilityInvocation,
    assemblyRegistry,
    runState,
    ...(options.lifecycleHook === undefined ? {} : { lifecycleHook: options.lifecycleHook }),
    ...(recipes.length === 0
      ? {}
      : {
          resolveRecipeDefinition: (request) => {
            const recipe = recipeMap.get(request.recipeName);
            if (recipe === undefined) {
              throw new AgentError({ code: 'RECIPE_NOT_FOUND', message: 'Recipe not found.', category: 'NOT_FOUND', retryable: false });
            }
            return recipe;
          },
        }),
    ...(options.workflowExecutionService === undefined ? {} : { workflowExecutionService: options.workflowExecutionService }),
    ...(options.policyResolver === undefined ? {} : { policyResolver: options.policyResolver }),
  });

  return { agent, assemblyRegistry, capabilityCatalog, capabilityInvocation, contextEngine, model, runState };
}

function makeCapabilityInvocation(): CapabilityInvocationPort {
  return {
    invoke: vi.fn(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
    })),
  };
}

function makeRunState(): AgentRunStatePort & {
  readonly events: RunTimelineEvent[];
  readonly appendedMessages: unknown[];
  readonly capabilityTerminalAnswers: string[];
  readonly setCapabilityTerminalAnswer: ReturnType<typeof vi.fn>;
} {
  const events: RunTimelineEvent[] = [];
  const appendedMessages: unknown[] = [];
  const capabilityTerminalAnswers: string[] = [];
  return {
    events,
    appendedMessages,
    capabilityTerminalAnswers,
    emitEvent: vi.fn(async (_run, _context, event) => {
      events.push(event);
    }),
    appendMessage: vi.fn(async (_run, _context, draft) => {
      appendedMessages.push(draft);
      return brand<string, 'MessageId'>('message-routing-core');
    }),
    setCapabilityTerminalAnswer: vi.fn(async (_run, _context, answer: { readonly content: string }) => {
      capabilityTerminalAnswers.push(answer.content);
    }),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
}

function preferredSkillDescriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('alarm-diagnosis'),
    kind: 'SKILL',
    provider: { providerId: 'bundled-skills', providerKind: 'BUNDLED' },
    displayName: 'Alarm diagnosis',
    description: 'Diagnose telecom alarm conditions.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    outputSchema: { type: 'object', additionalProperties: true },
    compatibility: {
      supportedOsFamilies: [],
      supportedCpuArchitectures: [],
      requiredExecutables: [],
      requiredEnvironmentKeys: [],
      requiredConfigurationKeys: [],
      networkRequired: false,
      runtimeTags: [],
    },
  };
}

function skillToolDescriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('Skill'),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: 'Skill loader',
    description: 'Loads a Skill into the request context.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    outputSchema: { type: 'object', additionalProperties: true },
    compatibility: {
      supportedOsFamilies: [],
      supportedCpuArchitectures: [],
      requiredExecutables: [],
      requiredEnvironmentKeys: [],
      requiredConfigurationKeys: [],
      networkRequired: false,
      runtimeTags: [],
    },
  };
}

function todoWriteDescriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('TodoWrite'),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: 'TodoWrite',
    description: 'Set current scoped todo state.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: { type: 'object', additionalProperties: true },
    outputSchema: { type: 'object', additionalProperties: true },
    replayPolicy: 'IDEMPOTENT',
    compatibility: {
      supportedOsFamilies: [],
      supportedCpuArchitectures: [],
      requiredExecutables: [],
      requiredEnvironmentKeys: [],
      requiredConfigurationKeys: [],
      networkRequired: false,
      runtimeTags: [],
    },
  };
}

function recipeDescriptor(recipeName: string): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(recipeName),
    kind: 'WORKFLOW',
    provider: { providerId: 'local-recipes', providerKind: 'LOCAL_DIRECTORY' },
    displayName: recipeName,
    description: recipeName,
    modelInvocable: false,
    availabilityStatus: 'AVAILABLE',
    inputSchema: { type: 'object', additionalProperties: true },
    outputSchema: { type: 'object', additionalProperties: true },
    replayPolicy: 'NON_IDEMPOTENT',
  };
}

function workflowRecipeDefinition(): RecipeDefinition {
  return {
    recipeName: 'ran-alarm-diagnosis',
    version: 'v1',
    displayName: 'RAN Alarm Diagnosis',
    flowGraph: {
      nodes: {
        start: {
          type: 'START',
          next: {
            callTool: {},
          },
        },
        callTool: {
          type: 'TOOL',
          inputs: {
            tool_name: 'code',
          },
          next: {
            askModel: {},
          },
        },
        askModel: {
          type: 'LLM',
          next: {},
        },
      },
    },
  };
}
