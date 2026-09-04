import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { createDefaultAgentTestAssemblyRegistry } from '@nextagent/agent-app/testing';
import { brand } from '@nextagent/agent-common';
import { createDefaultContextEngine, createDefaultProportionalBudgetPolicy, createDefaultTokenEstimator } from '@nextagent/agent-context-engine';
import { SYSTEM_PROMPT_CACHE_BOUNDARY_MARKER, type ContextAssemblyRequest } from '@nextagent/agent-contracts/context';
import type { SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import { describe, expect, it } from 'vitest';

import { createTestModelSelectionService } from '../../packages/agent-context-engine/tests/test-model-selection-helpers.js';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-workflow-context-boundary'),
  subjectId: brand<string, 'SubjectId'>('subject-workflow-context-boundary'),
  displayName: 'Workflow context boundary tester',
};
const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-workflow-context-boundary');
const previousRequestId = brand<string, 'MessageId'>('request-workflow-context-previous');
const currentRequestId = brand<string, 'MessageId'>('request-workflow-context-current');
const previousRunId = brand<string, 'RequestRunId'>('run-workflow-context-previous');
const currentRunId = brand<string, 'RequestRunId'>('run-workflow-context-current');

describe('Workflow Event context boundary', () => {
  it('does not change provider input, token budget, or the cache-boundary prefix', async () => {
    const gateway = createTestGatewayStores();
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });

    const messages = [
      message(previousRequestId, previousRequestId, previousRunId, 'USER', 'Inspect the RAN route.'),
      message(brand<string, 'MessageId'>('answer-workflow-context-previous'), previousRequestId, previousRunId, 'ASSISTANT', 'The route is stable.'),
      message(currentRequestId, currentRequestId, currentRunId, 'USER', 'Check the next cell.'),
    ];
    for (const [index, item] of messages.entries()) {
      await gateway.messages.appendSessionMessage(item);
      await gateway.activeContext.appendItem({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        messageId: item.messageId,
        expectedActiveContextVersion: index,
      });
    }

    const contextEngine = createDefaultContextEngine({
      activeContextStore: gateway.activeContext,
      messageStore: gateway.messages,
      assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
      capabilityCatalog: createStaticCapabilityCatalog(),
      modelSelectionService: createTestModelSelectionService({ modelId: 'deterministic-test-model' }),
      budgetPolicy: createDefaultProportionalBudgetPolicy(),
      tokenEstimator: createDefaultTokenEstimator(),
    });
    const request: ContextAssemblyRequest = {
      sessionId,
      requestId: currentRequestId,
      requestContextId: brand<string, 'RequestContextId'>('context-workflow-context-current'),
      identityContext: identity,
      agentId,
      agentVersion,
      runId: currentRunId,
      stepId: 'turn-1',
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      purpose: 'workflow-event-context-boundary',
    };

    const beforeAssembly = await contextEngine.assemble(request, undefined, new AbortController().signal);
    const beforeInput = await contextEngine.render(beforeAssembly);
    const eventOnlyMarker = 'WORKFLOW-PRODUCT-EVENT-MUST-NOT-ENTER-PROVIDER-CONTEXT';
    await gateway.timeline.appendEvent({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      agentVersion,
      eventId: 'workflow-product-context-boundary',
      sessionId,
      requestId: previousRequestId,
      runId: previousRunId,
      requestContextId: brand<string, 'RequestContextId'>('context-workflow-product-event'),
      sequence: brand<number, 'TimelineSequence'>(0),
      type: 'TOOL_STRUCTURED_DELTA',
      inlinePayload: {
        capabilityId: 'render-result',
        toolCallId: 'workflow:workflow-execution-1:render-result',
        workflowEventType: 'NODE_COMPLETED',
        nodeExecutionId: 'workflow-execution-1:render-result:0',
        nodeId: 'render-result',
        nodeType: 'DISPLAY',
        toolEventType: 'ANSWER',
        toolMessageType: 'PIU',
        content: { piuName: 'ranDiagnosis', piuVersion: '1.0.0', marker: eventOnlyMarker },
        accumulated: true,
      },
      createdAt: brand<number, 'EpochMillis'>(2),
    });

    const afterAssembly = await contextEngine.assemble(request, undefined, new AbortController().signal);
    const afterInput = await contextEngine.render(afterAssembly);

    expect(beforeAssembly.budgetPlan).toBeDefined();
    expect(afterAssembly.selectedMessageRefs).toEqual(beforeAssembly.selectedMessageRefs);
    expect(afterAssembly.budgetPlan).toEqual(beforeAssembly.budgetPlan);
    expect(afterAssembly.budgetEvidence).toEqual(beforeAssembly.budgetEvidence);
    expect(afterInput).toEqual(beforeInput);
    expect(JSON.stringify(afterInput.messages)).toContain(SYSTEM_PROMPT_CACHE_BOUNDARY_MARKER);
    expect(JSON.stringify(afterInput)).not.toContain(eventOnlyMarker);
  });
});

function message(
  messageId: SessionMessageRecord['messageId'],
  requestId: SessionMessageRecord['requestId'],
  runId: NonNullable<SessionMessageRecord['runId']>,
  role: 'USER' | 'ASSISTANT',
  content: string,
): SessionMessageRecord {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId,
    messageId,
    requestId,
    runId,
    role,
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}
