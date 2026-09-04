import { brand } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import { projectTimelineEventToStreamEnvelope, requiresProcessMessageAssociation } from '@nextagent/agent-channel-common';
import type { CapabilityResultPresentationLevel, CapabilityResultPresentationPolicy } from '@nextagent/agent-channel-common';
import { describe, expect, it } from 'vitest';

describe('process message association projection', () => {
  it('restores the committed terminal preview/ref from its visible Assistant Message association', () => {
    const persistedPreview = '<persisted-content>\nFile path: tool-results/terminal-result.txt\nPreview: bounded terminal result';
    const terminalMessage = message('terminal-message-1', {
      content: persistedPreview,
      contentType: 'MARKDOWN',
      metadata: {
        eventType: 'REQUEST_COMPLETED',
        status: 'COMPLETED',
        replacement: { contentRef: { refId: 'tool-results/terminal-result.txt', refType: 'CAPABILITY_RESULT' } },
      },
    });
    const timelineEvent = event('REQUEST_COMPLETED', {
      terminalMessageId: terminalMessage.messageId,
      hookResults: [],
    });

    expect(requiresProcessMessageAssociation(timelineEvent)).toBe(true);
    expect(
      projectTimelineEventToStreamEnvelope(timelineEvent, {
        processMessageAssociation: { message: terminalMessage },
      }),
    ).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          status: 'COMPLETED',
          content: terminalMessage.content,
          text: terminalMessage.content,
          contentType: 'MARKDOWN',
        },
      },
    });
    expect(JSON.stringify(timelineEvent.inlinePayload)).not.toContain('bounded terminal result');
  });

  it.each([
    ['missing association', undefined],
    ['hidden Message', message('terminal-hidden', { visible: false, metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' } })],
    ['wrong role', message('terminal-role', { role: 'USER', metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' } })],
    ['wrong metadata', message('terminal-metadata', { metadata: { eventType: 'REQUEST_FAILED', status: 'FAILED' } })],
  ])('fails closed for terminal content with %s and never returns a legacy Event body', (_label, terminalMessage) => {
    const timelineEvent = event('REQUEST_COMPLETED', {
      terminalMessageId: terminalMessage?.messageId ?? 'terminal-missing',
      content: 'legacy Event body must not be returned',
      hookResults: [],
    });

    const outcome = projectTimelineEventToStreamEnvelope(timelineEvent, {
      ...(terminalMessage === undefined ? {} : { processMessageAssociation: { message: terminalMessage } }),
    });

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          status: 'COMPLETED',
          content: '',
          text: '',
          contentUnavailable: true,
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('legacy Event body must not be returned');
  });

  it('preserves the final assistant marker for live answer handoff', () => {
    const outcome = projectTimelineEventToStreamEnvelope(event('LLM_CONTENT_DELTA', { content: 'Final diagnosis.', final: true }));

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        eventType: 'LLM_CONTENT_DELTA',
        payload: {
          content: 'Final diagnosis.',
          final: true,
        },
      },
    });
  });

  it('projects completed public assistant text from the referenced message only', () => {
    const message = assistantToolUseMessage({
      content: 'I will inspect the alarm evidence.',
      toolCalls: [{ toolCallId: 'call-1', toolName: 'Read', arguments: { path: 'alarm.json' } }],
    });
    const outcome = projectTimelineEventToStreamEnvelope(
      event('LLM_CONTENT_DELTA', { messageId: message.messageId, stepId: 'turn-1', completed: true }),
      { processMessageAssociation: { message }, capabilityResultPresentationPolicy: detailPolicy },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          content: 'I will inspect the alarm evidence.',
          text: 'I will inspect the alarm evidence.',
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('alarm.json');
    expect(JSON.stringify(outcome)).not.toContain('"visible"');
  });

  it('validates a capability start against the referenced tool call without exposing arguments', () => {
    const message = assistantToolUseMessage({
      toolCalls: [{ toolCallId: 'call-1', toolName: 'Read', arguments: { path: 'secret.json' } }],
    });
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_STARTED', { messageId: message.messageId, capabilityId: 'Read', toolCallId: 'call-1' }),
      { processMessageAssociation: { message }, capabilityResultPresentationPolicy: detailPolicy },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: { payload: { capabilityId: 'Read', toolCallId: 'call-1' } },
    });
    expect(JSON.stringify(outcome)).not.toContain('secret.json');
    expect(JSON.stringify(outcome)).not.toContain('contentUnavailable');
  });

  it.each([
    ['Skill', { name: 'network-diagnostics' }, 'network-diagnostics'],
    ['Agent', { agentId: 'network-explorer' }, 'network-explorer'],
    ['ApiCall', { apiName: 'query_network.kpi-v2' }, 'query_network.kpi-v2'],
  ])('projects the allowlisted technical target name for %s', (capabilityId, argumentsValue, expectedTargetName) => {
    const message = assistantToolUseMessage({
      toolCalls: [{ toolCallId: 'call-1', toolName: capabilityId, arguments: argumentsValue }],
    });
    for (const level of ['STATUS_ONLY', 'SUMMARY', 'DETAIL'] as const) {
      const outcome = projectTimelineEventToStreamEnvelope(
        event('CAPABILITY_STARTED', { messageId: message.messageId, capabilityId, toolCallId: 'call-1' }),
        { processMessageAssociation: { message }, capabilityResultPresentationPolicy: presentationPolicy(level) },
      );

      expect(outcome).toMatchObject({
        kind: 'ENVELOPE',
        envelope: { payload: { capabilityId, toolCallId: 'call-1', capabilityTargetName: expectedTargetName } },
      });
    }
  });

  it.each([
    ['Read', { name: 'spoofed-skill', agentId: 'spoofed-agent', apiName: 'spoofed-api' }],
    ['Skill', { name: '' }],
    ['Skill', { name: 'network diagnostics' }],
    ['Agent', { agentId: '../private-agent' }],
    ['ApiCall', { apiName: `a${'b'.repeat(128)}` }],
  ])('omits an unavailable or unsafe technical target name for %s', (capabilityId, argumentsValue) => {
    const message = assistantToolUseMessage({
      toolCalls: [{ toolCallId: 'call-1', toolName: capabilityId, arguments: argumentsValue }],
    });
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_STARTED', { messageId: message.messageId, capabilityId, toolCallId: 'call-1' }),
      { processMessageAssociation: { message }, capabilityResultPresentationPolicy: detailPolicy },
    );
    const payload = outcome.kind === 'ENVELOPE' ? outcome.envelope.payload : undefined;

    expect(payload).toMatchObject({ capabilityId, toolCallId: 'call-1' });
    expect(payload).not.toHaveProperty('capabilityTargetName');
  });

  it('does not expose non-allowlisted Skill arguments with its technical target name', () => {
    const message = assistantToolUseMessage({
      toolCalls: [
        {
          toolCallId: 'call-1',
          toolName: 'Skill',
          arguments: {
            name: 'network-diagnostics',
            args: { credential: 'must-not-leak' },
            path: '/private/network-data',
            prompt: 'private orchestration prompt',
          },
        },
      ],
    });
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_STARTED', { messageId: message.messageId, capabilityId: 'Skill', toolCallId: 'call-1' }),
      { processMessageAssociation: { message }, capabilityResultPresentationPolicy: detailPolicy },
    );
    const serialized = JSON.stringify(outcome);

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: { payload: { capabilityTargetName: 'network-diagnostics' } },
    });
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).not.toContain('/private/network-data');
    expect(serialized).not.toContain('private orchestration prompt');
  });

  it('degrades a duplicated tool-call association without selecting either target name', () => {
    const message = assistantToolUseMessage({
      toolCalls: [
        { toolCallId: 'call-1', toolName: 'Skill', arguments: { name: 'network-diagnostics' } },
        { toolCallId: 'call-1', toolName: 'Skill', arguments: { name: 'private-diagnostics' } },
      ],
    });
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_STARTED', { messageId: message.messageId, capabilityId: 'Skill', toolCallId: 'call-1' }),
      { processMessageAssociation: { message }, capabilityResultPresentationPolicy: detailPolicy },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          capabilityId: 'Skill',
          toolCallId: 'call-1',
          contentUnavailable: true,
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('network-diagnostics');
    expect(JSON.stringify(outcome)).not.toContain('private-diagnostics');
    expect(outcome.kind === 'ENVELOPE' ? outcome.envelope.payload : undefined).not.toHaveProperty('capabilityTargetName');
  });

  it('keeps wrapper target identity while hiding referenced invocation arguments', () => {
    const message = assistantToolUseMessage({
      toolCalls: [{ toolCallId: 'call-1', toolName: 'Skill', arguments: { name: 'network-diagnosis', args: { secret: true } } }],
    });
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_STARTED', {
        messageId: message.messageId,
        capabilityKind: 'TOOL',
        capabilityId: 'Skill',
        targetCapabilityId: 'network-diagnosis',
        toolCallId: 'call-1',
      }),
      { processMessageAssociation: { message }, capabilityResultPresentationPolicy: detailPolicy },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          capabilityKind: 'TOOL',
          capabilityId: 'Skill',
          targetCapabilityId: 'network-diagnosis',
          toolCallId: 'call-1',
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('secret');
    expect(JSON.stringify(outcome)).not.toContain('"args"');
  });

  it('projects a completed capability result through the existing safe result projector', () => {
    const message = capabilityResultMessage('call-1', 'Bash', {
      exitCode: 0,
      stdout: 'diagnosis complete',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_COMPLETED', {
        messageId: message.messageId,
        capabilityId: 'Bash',
        toolCallId: 'call-1',
        status: 'SUCCEEDED',
      }),
      { processMessageAssociation: { message }, capabilityResultPresentationPolicy: detailPolicy },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        eventType: 'CAPABILITY_COMPLETED',
        payload: {
          capabilityId: 'Bash',
          toolCallId: 'call-1',
          status: 'SUCCEEDED',
          content: 'Exit code: 0\nOutput:\ndiagnosis complete',
        },
      },
    });
  });

  it('ignores a legacy completed inline result when no Message association is available', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_COMPLETED', {
        messageId: brand<string, 'MessageId'>('message-2'),
        capabilityId: 'Bash',
        toolCallId: 'call-1',
        status: 'SUCCEEDED',
        result: {
          exitCode: 0,
          stdout: 'diagnosis complete',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        },
      }),
      { capabilityResultPresentationPolicy: detailPolicy },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        eventType: 'CAPABILITY_COMPLETED',
        payload: {
          capabilityId: 'Bash',
          toolCallId: 'call-1',
          status: 'SUCCEEDED',
          contentUnavailable: true,
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('diagnosis complete');
  });

  it('restores the Workflow-as-Tool outer result through policy while leaving inner product history unchanged', () => {
    const message = capabilityResultMessage('outer-workflow-call', 'Workflow', {
      recipeName: 'alarm-analysis',
      status: 'succeeded',
      answerPreviews: ['Safe workflow answer.'],
    });
    const outerCompletion = event('CAPABILITY_COMPLETED', {
      messageId: message.messageId,
      capabilityId: 'Workflow',
      toolCallId: 'outer-workflow-call',
      status: 'SUCCEEDED',
    });
    const innerProduct = event('TOOL_STRUCTURED_DELTA', {
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'render-result',
      nodeType: 'DISPLAY',
      nodeExecutionId: 'render-result-attempt-1',
      capabilityId: 'render-result',
      toolCallId: 'workflow:execution-1:render-result',
      toolEventType: 'SUB_CONCLUSION',
      toolMessageType: 'PIU',
      content: { piuName: 'ranDiagnosis' },
      accumulated: true,
    });
    const levels = ['STATUS_ONLY', 'SUMMARY', 'DETAIL'] as const;
    const outerPayloads = levels.map((level) => {
      const outcome = projectTimelineEventToStreamEnvelope(outerCompletion, {
        processMessageAssociation: { message },
        capabilityResultPresentationPolicy: presentationPolicy(level),
      });
      expect(outcome.kind).toBe('ENVELOPE');
      if (outcome.kind !== 'ENVELOPE') {
        throw new Error('Expected a message-backed Workflow result envelope.');
      }
      return outcome.envelope.payload;
    });
    const innerPayloads = levels.map((level) => {
      const outcome = projectTimelineEventToStreamEnvelope(innerProduct, {
        capabilityResultPresentationPolicy: presentationPolicy(level),
      });
      expect(outcome.kind).toBe('ENVELOPE');
      if (outcome.kind !== 'ENVELOPE') {
        throw new Error('Expected a Workflow product envelope.');
      }
      return outcome.envelope.payload;
    });

    expect(outerPayloads.map((payload) => payload['resultPresentationLevel'])).toEqual(levels);
    expect(outerPayloads[0]).not.toHaveProperty('safeSummary');
    expect(outerPayloads[0]).not.toHaveProperty('safeResult');
    expect(outerPayloads[1]).toHaveProperty('safeSummary');
    expect(outerPayloads[1]).not.toHaveProperty('safeResult');
    expect(outerPayloads[2]).toHaveProperty('safeResult');
    expect(innerPayloads[1]).toEqual(innerPayloads[0]);
    expect(innerPayloads[2]).toEqual(innerPayloads[0]);
    expect(innerPayloads[0]).toMatchObject({
      toolEventType: 'SUB_CONCLUSION',
      toolMessageType: 'PIU',
      content: { piuName: 'ranDiagnosis' },
    });
    expect(innerPayloads[0]).not.toHaveProperty('resultPresentationLevel');
  });

  it('rebuilds a classified CLIP completion from its referenced result Message', () => {
    const message = capabilityResultMessage('clip-1', 'dynamic-clip-network-inspector', {
      event: 'DETAIL',
      data_raw: 'bounded CLIP output',
      data: { credential: 'must not leak' },
    });
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_COMPLETED', {
        messageId: message.messageId,
        capabilityId: 'dynamic-clip-network-inspector',
        toolCallId: 'clip-1',
        status: 'SUCCEEDED',
        resultProjectionKind: 'CLIP_STREAM_V1',
      }),
      { processMessageAssociation: { message }, capabilityResultPresentationPolicy: detailPolicy },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          resultPresentationLevel: 'DETAIL',
          safeSummary: 'CLIP stream event received.',
          safeResult: {
            kind: 'clipStreamEvent',
            eventType: 'DETAIL',
            dataRawPreview: 'bounded CLIP output',
          },
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('credential');
    expect(JSON.stringify(outcome)).not.toContain('resultProjectionKind');
  });

  it('does not treat capability result fields as trusted completion failure facts', () => {
    const message = capabilityResultMessage('call-1', 'CustomCapability', {
      safeErrorCode: 'COMMAND_NOT_ALLOWED',
      safeErrorCategory: 'POLICY_DENIED',
      safeSummary: 'secret result text must not become a safe failure summary',
      content: 'private capability output',
    });
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_COMPLETED', {
        messageId: message.messageId,
        capabilityId: 'CustomCapability',
        toolCallId: 'call-1',
        status: 'SUCCEEDED',
      }),
      { processMessageAssociation: { message }, capabilityResultPresentationPolicy: detailPolicy },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          capabilityId: 'CustomCapability',
          toolCallId: 'call-1',
          status: 'SUCCEEDED',
          content: '',
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('secret result text');
    expect(JSON.stringify(outcome)).not.toContain('private capability output');
    expect(JSON.stringify(outcome)).not.toContain('COMMAND_NOT_ALLOWED');
    expect(JSON.stringify(outcome)).not.toContain('POLICY_DENIED');
  });

  it('keeps trusted completion failure facts while ignoring conflicting message fields', () => {
    const message = capabilityResultMessage('call-1', 'Bash', {
      safeErrorCode: 'MESSAGE_SPOOFED_CODE',
      safeErrorCategory: 'MESSAGE_SPOOFED_CATEGORY',
      safeSummary: 'message spoofed summary',
      stdout: 'private failure output',
    });
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_COMPLETED', {
        messageId: message.messageId,
        capabilityId: 'Bash',
        toolCallId: 'call-1',
        status: 'FAILED',
        safeErrorCode: 'COMMAND_NOT_ALLOWED',
        safeErrorCategory: 'POLICY_DENIED',
      }),
      { processMessageAssociation: { message }, capabilityResultPresentationPolicy: detailPolicy },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          status: 'FAILED',
          safeErrorCode: 'COMMAND_NOT_ALLOWED',
          safeErrorCategory: 'POLICY_DENIED',
          safeSummary: expect.stringContaining('blocked'),
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('MESSAGE_SPOOFED');
    expect(JSON.stringify(outcome)).not.toContain('message spoofed summary');
    expect(JSON.stringify(outcome)).not.toContain('private failure output');
  });

  it.each([
    [
      'CAPABILITY_STARTED' as const,
      {
        workflowEventType: 'NODE_STARTED',
        nodeId: 'tool-1',
        nodeType: 'TOOL',
        nodeExecutionId: 'node-execution-1',
        capabilityId: 'Read',
        toolCallId: 'workflow:execution-1:tool-1',
        retryCount: 1,
      },
    ],
    [
      'CAPABILITY_COMPLETED' as const,
      {
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'tool-1',
        nodeType: 'TOOL',
        nodeExecutionId: 'node-execution-1',
        predecessorNodeExecutionIds: ['node-execution-0'],
        capabilityId: 'Read',
        toolCallId: 'workflow:execution-1:tool-1',
        status: 'SUCCEEDED',
        durationMs: 12,
        diagnostic: { reasonCode: 'WORKFLOW_NODE_COMPLETED' },
        attributes: { eventId: 'task-event-1' },
      },
    ],
    [
      'CAPABILITY_COMPLETED' as const,
      {
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'condition-1',
        nodeType: 'CONDITION',
        nodeExecutionId: 'condition-execution-1',
        capabilityId: 'condition-1',
        toolCallId: 'workflow:execution-1:condition-1',
        status: 'SUCCEEDED',
        durationMs: 3,
      },
    ],
  ])('projects a trusted message-free Workflow %s lifecycle without Message association', (type, inlinePayload) => {
    const timelineEvent = event(type, inlinePayload);

    expect(requiresProcessMessageAssociation(timelineEvent)).toBe(false);
    expect(projectTimelineEventToStreamEnvelope(timelineEvent)).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        eventType: type,
        payload: {
          workflowEventType: inlinePayload.workflowEventType,
          nodeId: inlinePayload.nodeId,
          nodeType: inlinePayload.nodeType,
          nodeExecutionId: inlinePayload.nodeExecutionId,
          capabilityId: inlinePayload.capabilityId,
          toolCallId: inlinePayload.toolCallId,
        },
      },
    });
    expect(JSON.stringify(projectTimelineEventToStreamEnvelope(timelineEvent))).not.toContain('contentUnavailable');
  });

  it.each([
    [
      'CAPABILITY_STARTED' as const,
      {
        workflowEventType: 'NODE_STARTED',
        nodeId: 'condition-1',
        nodeType: 'CONDITION',
        capabilityId: 'condition-1',
        toolCallId: 'workflow:execution-1:condition-1',
        input: { route: 'private' },
      },
    ],
    [
      'CAPABILITY_COMPLETED' as const,
      {
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'display-1',
        nodeType: 'DISPLAY',
        capabilityId: 'display-1',
        toolCallId: 'workflow:execution-1:display-1',
        status: 'SUCCEEDED',
        description: 'product body belongs in a separate event',
      },
    ],
    [
      'CAPABILITY_COMPLETED' as const,
      {
        workflowEventType: 'NODE_FAILED',
        nodeId: 'condition-1',
        nodeType: 'CONDITION',
        capabilityId: 'condition-1',
        toolCallId: 'workflow:execution-1:condition-1',
        status: 'SUCCEEDED',
      },
    ],
    [
      'CAPABILITY_STARTED' as const,
      {
        workflowEventType: 'NODE_STARTED',
        nodeId: 'condition-1',
        nodeType: 'UNKNOWN',
        capabilityId: 'condition-1',
        toolCallId: 'workflow:execution-1:condition-1',
      },
    ],
    [
      'CAPABILITY_STARTED' as const,
      {
        workflowEventType: 'NODE_STARTED',
        nodeId: 'condition-1',
        nodeType: 'CONDITION',
        nodeExecutionId: '',
        capabilityId: 'condition-1',
        toolCallId: 'workflow:execution-1:condition-1',
      },
    ],
  ])('does not grant the message-free exception to malformed Workflow %s lifecycle', (type, inlinePayload) => {
    const timelineEvent = event(type, inlinePayload);

    expect(requiresProcessMessageAssociation(timelineEvent)).toBe(true);
    const outcome = projectTimelineEventToStreamEnvelope(timelineEvent);
    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind !== 'ENVELOPE') {
      throw new Error('Expected ordinary lifecycle projection.');
    }
    expect(outcome.envelope.payload).not.toHaveProperty('workflowEventType');
    expect(outcome.envelope.payload).not.toHaveProperty('nodeId');
    expect(outcome.envelope.payload).not.toHaveProperty('nodeType');
  });

  it('projects a trusted completed Workflow product without defaulting its product types', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      event('TOOL_STRUCTURED_DELTA', {
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'render-result',
        nodeType: 'DISPLAY',
        nodeExecutionId: 'render-result-attempt-2',
        capabilityId: 'render-result',
        toolCallId: 'workflow:execution-1:render-result',
        toolEventType: 'ANSWER',
        toolMessageType: 'PIU',
        content: { piuName: 'ranDiagnosis' },
        accumulated: true,
      }),
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        eventType: 'TOOL_STRUCTURED_DELTA',
        payload: {
          workflowEventType: 'NODE_COMPLETED',
          nodeId: 'render-result',
          nodeType: 'DISPLAY',
          nodeExecutionId: 'render-result-attempt-2',
          capabilityId: 'render-result',
          toolCallId: 'workflow:execution-1:render-result',
          toolEventType: 'ANSWER',
          toolMessageType: 'PIU',
          content: { piuName: 'ranDiagnosis' },
          metadata: { accumulated: true },
        },
      },
    });
  });

  it('preserves an explicit structured-delta truncation marker in stream and history projection', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      event('TOOL_STRUCTURED_DELTA', {
        capabilityId: 'ApiCall',
        toolCallId: 'call-truncated',
        toolEventType: 'ANSWER',
        toolMessageType: 'PIU',
        content: { uuid: 'piu-1', data: [] },
        truncated: true,
      }),
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        eventType: 'TOOL_STRUCTURED_DELTA',
        payload: {
          capabilityId: 'ApiCall',
          toolCallId: 'call-truncated',
          content: { uuid: 'piu-1', data: [] },
          truncated: true,
        },
      },
    });
  });

  it.each([false, 'true', 1])('does not project a non-true structured-delta truncation marker (%j)', (truncated) => {
    const outcome = projectTimelineEventToStreamEnvelope(
      event('TOOL_STRUCTURED_DELTA', {
        capabilityId: 'ApiCall',
        toolCallId: 'call-not-truncated',
        toolEventType: 'ANSWER',
        toolMessageType: 'TEXT',
        content: 'complete',
        truncated,
      }),
    );

    expect(outcome).toMatchObject({ kind: 'ENVELOPE' });
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload['truncated']).toBeUndefined();
    }
  });

  it('preserves the outer Workflow tool call identity on an inner product projection', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      event('TOOL_STRUCTURED_DELTA', {
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'render-result',
        nodeType: 'DISPLAY',
        nodeExecutionId: 'render-result-attempt-3',
        capabilityId: 'render-result',
        toolCallId: 'workflow:execution-1:render-result',
        parentToolCallId: 'outer-workflow-call',
        toolEventType: 'SUB_CONCLUSION',
        toolMessageType: 'TEXT',
        content: 'Workflow product',
        accumulated: true,
      }),
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        eventType: 'TOOL_STRUCTURED_DELTA',
        payload: {
          toolCallId: 'workflow:execution-1:render-result',
          parentToolCallId: 'outer-workflow-call',
        },
      },
    });
  });

  it('does not project a self-reported parent identity from an ordinary structured delta', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      event('TOOL_STRUCTURED_DELTA', {
        workflowEventType: 'NODE_COMPLETED',
        nodeId: 'ordinary-result',
        nodeType: 'DISPLAY',
        capabilityId: 'ordinary-result',
        toolCallId: 'ordinary-call',
        parentToolCallId: 'outer-workflow-call',
        toolEventType: 'DETAIL',
        toolMessageType: 'TEXT',
        content: 'Ordinary structured output',
        accumulated: true,
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind !== 'ENVELOPE') {
      throw new Error('Expected an ordinary structured envelope.');
    }
    expect(outcome.envelope.payload).not.toHaveProperty('parentToolCallId');
  });

  it('reuses the AskUserQuestion answer safety projection', () => {
    const message = capabilityResultMessage('ask-1', 'AskUserQuestion', {
      status: 'RECEIVED',
      pendingInputId: 'pending-1',
      kind: 'QUESTION',
      answers: [['North']],
    });
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_COMPLETED', {
        messageId: message.messageId,
        capabilityId: 'AskUserQuestion',
        toolCallId: 'ask-1',
        status: 'SUCCEEDED',
      }),
      { processMessageAssociation: { message }, capabilityResultPresentationPolicy: detailPolicy },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          safeResult: { kind: 'pendingInputAnswer', answers: [['North']] },
        },
      },
    });
  });

  it('preserves requiresTextInput questions with custom in USER_INPUT_REQUIRED projection', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      event('USER_INPUT_REQUIRED', {
        pendingInputId: 'pending-custom',
        kind: 'QUESTION',
        questions: [
          {
            prompt: 'Which device?',
            options: [
              { value: 'device-a', label: 'Device A', requiresTextInput: true, inputPlaceholder: 'Enter ID' },
              { value: 'device-b', label: 'Device B' },
            ],
            custom: true,
          },
        ],
      }),
    );
    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind !== 'ENVELOPE') {
      throw new Error('Expected an envelope.');
    }
    expect(outcome.envelope.payload).toHaveProperty('questions');
  });

  it('drops requiresTextInput questions with multiple in USER_INPUT_REQUIRED projection', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      event('USER_INPUT_REQUIRED', {
        pendingInputId: 'pending-multiple',
        kind: 'QUESTION',
        questions: [
          {
            prompt: 'Which device?',
            options: [
              { value: 'device-a', label: 'Device A', requiresTextInput: true, inputPlaceholder: 'Enter ID' },
              { value: 'device-b', label: 'Device B' },
            ],
            multiple: true,
          },
        ],
      }),
    );
    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind !== 'ENVELOPE') {
      throw new Error('Expected an envelope.');
    }
    expect(outcome.envelope.payload).not.toHaveProperty('questions');
  });

  it.each([
    undefined,
    { message: message('wrong-role', { role: 'USER', content: 'must not leak' }) },
    { message: assistantToolUseMessage({ toolCalls: [{ toolCallId: 'other-call', toolName: 'Read', arguments: {} }] }) },
    { message: message('wrong-run', { runId: brand<string, 'RequestRunId'>('other-run'), content: 'must not leak' }) },
  ])('degrades invalid associations to status-only output', (processMessageAssociation) => {
    const outcome = projectTimelineEventToStreamEnvelope(
      event('CAPABILITY_STARTED', {
        messageId: 'assistant-tool-use',
        capabilityId: 'Read',
        toolCallId: 'call-1',
        input: { residual: 'must not leak' },
      }),
      processMessageAssociation === undefined ? {} : { processMessageAssociation },
    );

    expect(outcome).toMatchObject({
      kind: 'ENVELOPE',
      envelope: {
        payload: {
          capabilityId: 'Read',
          toolCallId: 'call-1',
          contentUnavailable: true,
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('must not leak');
  });
});

function event(type: RunTimelineEvent['type'], inlinePayload: Record<string, unknown>): RunTimelineEvent {
  return {
    type,
    inlinePayload,
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    sequence: brand<number, 'TimelineSequence'>(1),
    createdAt: new Date(1),
  } as RunTimelineEvent;
}

function assistantToolUseMessage(content: Record<string, unknown>): SessionMessage {
  return message('assistant-tool-use', {
    role: 'ASSISTANT',
    content: JSON.stringify(content),
    visible: false,
    metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['call-1'] },
  });
}

function capabilityResultMessage(toolCallId: string, toolName: string, payload: Record<string, unknown>): SessionMessage {
  return message('capability-result', {
    role: 'CAPABILITY_RESULT',
    content: JSON.stringify({ toolCallId, toolName, payload }),
    metadata: { kind: 'CAPABILITY_RESULT', toolCallId, toolName },
  });
}

function message(messageId: string, overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    messageId: brand<string, 'MessageId'>(messageId),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    role: 'ASSISTANT',
    content: '',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence: 1,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
    ...overrides,
  };
}

const detailPolicy: CapabilityResultPresentationPolicy = Object.freeze({
  defaultLevel: 'DETAIL',
  levelByCapabilityId: new Map(),
});

function presentationPolicy(level: CapabilityResultPresentationPolicy['defaultLevel']): CapabilityResultPresentationPolicy {
  return Object.freeze({
    defaultLevel: level,
    levelByCapabilityId: new Map(),
  });
}
