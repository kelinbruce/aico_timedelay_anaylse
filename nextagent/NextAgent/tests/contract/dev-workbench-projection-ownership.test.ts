import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCapabilityStartedTimelinePayload, isModelInvocationSafePayload, isPolicyProjectionPayload } from '@nextagent/agent-core';

const root = process.cwd();

describe('dev workbench projection ownership', () => {
  it('exposes producer-owned safe projection validators through owner public exports', () => {
    expect(
      isModelInvocationSafePayload('started', {
        stepId: 'turn-1',
        modelId: 'gpt',
        messageCountBucket: '1',
        timeoutMsBucket: '1-1000',
        maxOutputTokensBucket: 'unspecified',
        disclosedCapabilityNames: ['Read'],
        disclosedCapabilityNamesTruncated: 'false',
        modelOptionSummary: { timeoutMs: 1000, toolCount: 0 },
        providerOptionKeys: [],
        selectedMessageRefs: ['message-1'],
        disclosedCapabilityIds: ['Read'],
        modelMessageCount: 1,
      }),
    ).toBe(true);
    expect(
      isCapabilityStartedTimelinePayload({
        capabilityId: 'Read',
        toolCallId: 'tool-1',
        stepId: 'turn-1',
        toolBatchExecutionMode: 'PARALLEL',
        toolBatchOrdinal: 1,
        toolBatchSize: 2,
      }),
    ).toBe(true);
    expect(
      isPolicyProjectionPayload({
        policyId: 'agent-routing-policy',
        policyVersion: 'v1',
        policyDomain: 'ROUTING',
        policyPoint: 'ROUTING',
      }),
    ).toBe(true);
  });

  it('does not add dev workbench payload schemas to agent-contracts/runtime', () => {
    const runtimeContracts = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'runtime', 'index.ts'), 'utf8');
    const gatewayContracts = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');
    const capabilityOwner = readFileSync(join(root, 'packages', 'agent-capability', 'src', 'index.ts'), 'utf8');
    const workbenchSource = readFileSync(join(root, 'packages', 'agent-dev-workbench', 'src', 'index.ts'), 'utf8');

    expect(runtimeContracts).not.toMatch(/GatewayOperationSummary|DevWorkbench|modelInvocation.*PayloadSchema|safeContextProjection.*Schema/u);
    expect(gatewayContracts).not.toMatch(/GatewayOperationSummary|DevWorkbench.*Record|AgentDevWorkbenchLocalReadPort/u);
    expect(capabilityOwner).not.toMatch(/GatewayOperationSummary|gateway-operation-summary/u);
    expect(workbenchSource).not.toMatch(/from\s+["']@nextagent\/agent-capability\/src|from\s+["']@nextagent\/agent-contracts\/runtime\/src/u);
  });

  it('keeps model timeline authoring in the run-bound invocation boundary', () => {
    const boundary = readFileSync(join(root, 'packages', 'agent-core', 'src', 'model', 'run-bound-model-invocation.ts'), 'utf8');
    const defaultAgent = readFileSync(join(root, 'packages', 'agent-core', 'src', 'agent', 'default-agent.ts'), 'utf8');
    const modelSources = readFileSync(join(root, 'packages', 'agent-model', 'src', 'index.ts'), 'utf8');
    const contextContracts = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'context', 'index.ts'), 'utf8');
    const contextEngine = readFileSync(join(root, 'packages', 'agent-context-engine', 'src', 'assembly', 'assemble-context.ts'), 'utf8');

    expect(boundary).toMatch(/MODEL_INVOCATION_STARTED/u);
    expect(boundary).toMatch(/MODEL_INVOCATION_COMPLETED/u);
    expect(boundary).toMatch(/MODEL_INVOCATION_FAILED/u);
    expect(defaultAgent).not.toMatch(/type:\s*["']MODEL_INVOCATION_(?:STARTED|COMPLETED|FAILED)/u);
    expect(modelSources).not.toMatch(/MODEL_INVOCATION_(?:STARTED|COMPLETED|FAILED)|AgentRunStatePort/u);
    expect(contextContracts).not.toMatch(/RenderedModelInputSafeContextProjection|safeContextProjection/u);
    expect(contextEngine).not.toMatch(/RenderedModelInputSafeContextProjection|safeContextProjection/u);
  });
});
