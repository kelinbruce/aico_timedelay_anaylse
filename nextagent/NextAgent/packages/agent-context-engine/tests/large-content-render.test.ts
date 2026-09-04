import { createTestModelSelectionService } from './test-model-selection-helpers.js';
import { DefaultContextEngine } from '@nextagent/agent-context-engine';
import { brand, type MessageId } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextItemRecord,
  ActiveContextStateRecord,
  ActiveContextStoreGateway,
  ActiveContextViewRecord,
  SessionForkStoreGateway,
  SessionMessageRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';

const TENANT = brand<string, 'TenantId'>('tenant-lc');
const SUBJECT = brand<string, 'SubjectId'>('subject-lc');
const AGENT = brand<string, 'AgentId'>('agent-lc');
const AGENT_V = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-lc');

function msgId(name: string): MessageId {
  return brand<string, 'MessageId'>(name);
}

function makeMessage(role: string, messageId: string, content: string, requestId: string): SessionMessageRecord {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    messageId: msgId(messageId),
    sessionId: SESSION,
    requestId: msgId(requestId),
    role: role as SessionMessageRecord['role'],
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function activeContextView(messageIds: readonly string[], version = 1): ActiveContextViewRecord {
  const state: ActiveContextStateRecord = {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    activeContextVersion: version,
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
  const items: readonly ActiveContextItemRecord[] = messageIds.map((id, ordinal) => ({
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    ordinal,
    messageId: msgId(id),
  }));
  return { state, items };
}

function makeAssembly(): AgentAssembly {
  return {
    agentId: AGENT,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-lc:v1',
    displayName: 'large-content test',
    description: 'large-content test',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxTurns: 1, maxToolCallsPerTurn: 30, maxContextMessages: 50 },
  };
}

function makeDeps(
  messageIds: readonly string[],
  messages: SessionMessageRecord[],
  forkPromotionContentStore?: Pick<SessionForkStoreGateway, 'loadCommittedForkPromotionContent'>,
) {
  const messagesMap = new Map<string, SessionMessageRecord>();
  for (const r of messages) {
    messagesMap.set(r.messageId, r);
  }
  return {
    activeContextStore: {
      async loadActiveContext() {
        return activeContextView(messageIds);
      },
      async appendItem() {
        throw new Error('unused');
      },
      async commitCompaction() {
        throw new Error('unused');
      },
      async updateMetadata() {
        return { status: 'UPDATED' as const };
      },
    } as ActiveContextStoreGateway,
    messageStore: {
      async loadMessage(req) {
        return messagesMap.get(req.messageId);
      },
      async loadMessages(req) {
        return req.messageIds.map((id) => messagesMap.get(id)!).filter(Boolean);
      },
      async appendSessionMessage() {
        throw new Error('unused');
      },
      async listConversationPreview() {
        throw new Error('unused');
      },
      async listMessages() {
        throw new Error('unused');
      },
      async listCurrentRequestMessages() {
        throw new Error('unused');
      },
      async hideMessage() {
        throw new Error('unused');
      },
      async hideRequestMessages() {
        throw new Error('unused');
      },
    } as SessionMessageStoreGateway,
    assemblyRegistry: {
      async active() {
        return makeAssembly();
      },
      async require() {
        return makeAssembly();
      },
    } as AgentAssemblyRegistry,
    capabilityCatalog: {
      async listAvailable() {
        return [];
      },
      async resolve() {
        return undefined;
      },
    } as CapabilityCatalog,
    ...(forkPromotionContentStore === undefined ? {} : { forkPromotionContentStore }),
  };
}

async function assembleAndRender(deps: ReturnType<typeof makeDeps>) {
  const engine = new DefaultContextEngine({
    ...deps,
    modelSelectionService: createTestModelSelectionService({ modelId: 'test', contextWindowTokens: 128_000, maxOutputTokens: 4096 }),
  });
  const result = await engine.assemble(
    {
      sessionId: SESSION,
      requestId: msgId('current'),
      requestContextId: brand<string, 'RequestContextId'>('rc-lc'),
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
      agentId: AGENT,
      agentVersion: AGENT_V,
      runId: brand<string, 'RequestRunId'>('run-lc'),
      stepId: 'step-lc',
      locale: brand<string, 'RequestLocale'>('en-US'),
      purpose: 'test',
    },
    undefined,
    new AbortController().signal,
  );
  return engine.render(result);
}

function getToolResultText(rendered: Awaited<ReturnType<typeof assembleAndRender>>): string | null {
  const toolMsg = rendered.messages.find((m) => m.role === 'TOOL');
  if (!toolMsg) {
    return null;
  }
  const content = toolMsg.content;
  if (Array.isArray(content)) {
    const textPart = content.find((p) => p.type === 'tool-result');
    if (textPart && 'output' in textPart) {
      return JSON.stringify(textPart.output);
    }
    const txtPart = content.find((p) => p.type === 'text');
    if (txtPart && 'text' in txtPart) {
      return txtPart.text;
    }
  }
  return null;
}

// Helper: build a valid tool-call/tool-result pair
function toolCallAssistantMessage(
  messageId: string,
  toolCallId: string,
  requestId: string,
  toolName = 'Read',
  content?: string,
): SessionMessageRecord {
  return makeMessage(
    'ASSISTANT',
    messageId,
    JSON.stringify({
      ...(content === undefined ? {} : { content }),
      toolCalls: [{ toolCallId, toolName, arguments: { file_path: 'test.txt' } }],
    }),
    requestId,
  );
}

function toolResultMessage(
  messageId: string,
  toolCallId: string,
  payload: Record<string, unknown>,
  requestId: string,
  toolName = 'Read',
): SessionMessageRecord {
  return makeMessage(
    'CAPABILITY_RESULT',
    messageId,
    JSON.stringify({
      toolCallId,
      toolName,
      payload,
    }),
    requestId,
  );
}

describe('Large-content render-time classification', () => {
  it('renders public assistant content before tool calls while legacy tool-use messages remain tool-call-only', async () => {
    const publicContent = 'I will read the file before continuing.';
    const mixedMessages = [
      makeMessage('USER', 'u1', 'read file', 'req-1'),
      toolCallAssistantMessage('a1', 'call-1', 'req-1', 'Read', publicContent),
      toolResultMessage('t1', 'call-1', { content: 'result' }, 'req-1'),
      makeMessage('ASSISTANT', 'a1-final', 'done', 'req-1'),
      makeMessage('USER', 'current', 'next question', 'current'),
    ];
    const mixedRendered = await assembleAndRender(makeDeps(['u1', 'a1', 't1', 'a1-final', 'current'], mixedMessages));
    const mixedToolUse = mixedRendered.messages.find(
      (message) => message.role === 'ASSISTANT' && message.content.some((part) => part.type === 'tool-call'),
    );

    expect(mixedToolUse?.content).toEqual([
      { type: 'text', text: publicContent },
      { type: 'tool-call', toolCall: { toolCallId: 'call-1', toolName: 'Read', arguments: { file_path: 'test.txt' } } },
    ]);
    expect(mixedRendered.messages.filter((message) => message.role === 'TOOL')).toHaveLength(1);

    const legacyMessages = [
      makeMessage('USER', 'u2', 'read legacy file', 'req-2'),
      toolCallAssistantMessage('a2', 'call-2', 'req-2'),
      toolResultMessage('t2', 'call-2', { content: 'legacy result' }, 'req-2'),
      makeMessage('ASSISTANT', 'a2-final', 'done', 'req-2'),
      makeMessage('USER', 'current', 'next question', 'current'),
    ];
    const legacyRendered = await assembleAndRender(makeDeps(['u2', 'a2', 't2', 'a2-final', 'current'], legacyMessages));
    const legacyToolUse = legacyRendered.messages.find(
      (message) => message.role === 'ASSISTANT' && message.content.some((part) => part.type === 'tool-call'),
    );
    expect(legacyToolUse?.content).toEqual([
      { type: 'tool-call', toolCall: { toolCallId: 'call-2', toolName: 'Read', arguments: { file_path: 'test.txt' } } },
    ]);
    expect(legacyRendered.messages.filter((message) => message.role === 'TOOL')).toHaveLength(1);
  });

  it('leaves CAPABILITY_RESULT content unchanged when under inline threshold (≤8KB)', async () => {
    const smallPayload = { file_path: 'test.txt', content: 'x'.repeat(100) };
    const messages = [
      makeMessage('USER', 'u1', 'read file', 'req-1'),
      toolCallAssistantMessage('a1', 'call-1', 'req-1'),
      toolResultMessage('t1', 'call-1', smallPayload, 'req-1'),
      makeMessage('ASSISTANT', 'a2', 'done', 'req-1'),
      makeMessage('USER', 'current', 'next question', 'current'),
    ];
    const deps = makeDeps(['u1', 'a1', 't1', 'a2', 'current'], messages);
    const rendered = await assembleAndRender(deps);
    const text = getToolResultText(rendered);
    expect(text).toBeDefined();
    expect(text).toContain('x'.repeat(100));
    expect(text).not.toContain('<large-content-preview>');
  });

  it('leaves oversized Read results intact so the model can page with Read offset and limit', async () => {
    const largePayload = { file_path: 'big.txt', content: 'x'.repeat(10_000) };
    const largeContent = JSON.stringify({ toolCallId: 'call-1', toolName: 'Read', payload: largePayload });
    expect(largeContent.length).toBeGreaterThan(8192);

    const messages = [
      makeMessage('USER', 'u1', 'read large file', 'req-1'),
      toolCallAssistantMessage('a1', 'call-1', 'req-1'),
      toolResultMessage('t1', 'call-1', largePayload, 'req-1'),
      makeMessage('ASSISTANT', 'a2', 'done', 'req-1'),
      makeMessage('USER', 'current', 'next question', 'current'),
    ];
    const deps = makeDeps(['u1', 'a1', 't1', 'a2', 'current'], messages);
    const rendered = await assembleAndRender(deps);

    // Find the TOOL message
    const toolMsg = rendered.messages.find((m) => m.role === 'TOOL');
    expect(toolMsg).toBeDefined();
    // The content should be a tool-result with truncated output
    const content = toolMsg!.content;
    expect(Array.isArray(content)).toBe(true);
    const resultPart = (content as any[]).find((p) => p.type === 'tool-result');
    expect(resultPart).toBeDefined();
    const outputStr = JSON.stringify(resultPart.output);
    expect(outputStr).not.toContain('<large-content-preview>');
    expect(outputStr).toContain('x'.repeat(1000));
  });

  it('hydrates committed fork-promoted capability result content during render', async () => {
    let requested: Parameters<SessionForkStoreGateway['loadCommittedForkPromotionContent']>[0] | undefined;
    const fullContent = 'FULL PROMOTED RESULT';
    const messages = [
      makeMessage('USER', 'u1', 'run command', 'req-1'),
      toolCallAssistantMessage('a1', 'call-1', 'req-1', 'Bash'),
      toolResultMessage('t1', 'call-1', { preview: 'short preview for fork-promoted:promoted-1' }, 'req-1', 'Bash'),
      makeMessage('ASSISTANT', 'a2', 'done', 'req-1'),
      makeMessage('USER', 'current', 'next question', 'current'),
    ];
    messages[2] = {
      ...messages[2]!,
      metadata: {
        replacement: {
          kind: 'PERSISTED_PREVIEW',
          reason: 'size-above-inline-threshold',
          contentRef: { refId: 'fork-promoted:promoted-1', refType: 'CAPABILITY_RESULT' },
          originalSize: 4096,
          previewSize: 12,
          contentType: 'text/plain',
        },
      },
    };
    const deps = makeDeps(['u1', 'a1', 't1', 'a2', 'current'], messages, {
      async loadCommittedForkPromotionContent(request) {
        requested = request;
        return {
          refType: 'CAPABILITY_RESULT',
          bytes: Buffer.from(fullContent, 'utf8'),
          mimeType: 'text/plain;charset=utf-8',
          sizeBytes: Buffer.byteLength(fullContent, 'utf8'),
        };
      },
    });

    const rendered = await assembleAndRender(deps);

    expect(requested).toMatchObject({
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      childSessionId: SESSION,
      childMessageId: 't1',
      promotedContentId: 'fork-promoted:promoted-1',
    });
    const toolMsg = rendered.messages.find((m) => m.role === 'TOOL');
    const resultPart = toolMsg?.content.find((part) => part.type === 'tool-result');
    expect(resultPart).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'Bash',
      output: { content: fullContent },
    });
    expect(JSON.stringify(rendered.messages)).not.toContain('fork-promoted:promoted-1');
  });

  it('replaces non-Read CAPABILITY_RESULT content with bounded preview when over inline threshold (>50KB)', async () => {
    const largePayload = { content: 'x'.repeat(60_000) };
    const largeContent = JSON.stringify({ toolCallId: 'call-1', toolName: 'DiagnosticDump', payload: largePayload });
    expect(largeContent.length).toBeGreaterThan(50000);

    const messages = [
      makeMessage('USER', 'u1', 'dump diagnostics', 'req-1'),
      toolCallAssistantMessage('a1', 'call-1', 'req-1', 'DiagnosticDump'),
      toolResultMessage('t1', 'call-1', largePayload, 'req-1', 'DiagnosticDump'),
      makeMessage('ASSISTANT', 'a2', 'done', 'req-1'),
      makeMessage('USER', 'current', 'next question', 'current'),
    ];
    const deps = makeDeps(['u1', 'a1', 't1', 'a2', 'current'], messages);
    const rendered = await assembleAndRender(deps);

    const toolMsg = rendered.messages.find((m) => m.role === 'TOOL');
    expect(toolMsg).toBeDefined();
    const content = toolMsg!.content;
    expect(Array.isArray(content)).toBe(true);
    const resultPart = (content as any[]).find((p) => p.type === 'tool-result');
    expect(resultPart).toBeDefined();
    const outputStr = JSON.stringify(resultPart.output);
    expect(outputStr).toContain('<large-content-preview>');
    expect(outputStr).toContain('Original size:');
    expect(outputStr).toContain('</large-content-preview>');
    expect(outputStr.length).toBeLessThan(largeContent.length);
  });

  it('passes through externalized CAPABILITY_RESULT records with their readback file path', async () => {
    const preview = [
      '<persisted-content>',
      'Reason: policy:oversized-single-result',
      'Full content ref: CAPABILITY_RESULT:tool-results/result-1.txt',
      'File path: tool-results/result-1.txt',
      'Access: Invoke the Read tool with file_path="tool-results/result-1.txt".',
      '</persisted-content>',
    ].join('\n');
    const externalized = {
      toolCallId: 'call-1',
      toolName: 'DiagnosticDump',
      payload: { preview },
    };
    const replacement = {
      kind: 'PERSISTED_PREVIEW',
      reason: 'policy:oversized-single-result',
      contentRef: { refId: 'tool-results/result-1.txt', refType: 'CAPABILITY_RESULT' },
      originalSize: 20_000,
      previewSize: preview.length,
      lineage: { sourceMessageId: 't1', sourceRunId: 'run-1', sourceInvocationId: null, stepId: null },
    };
    const messages = [
      makeMessage('USER', 'u1', 'dump diagnostics', 'req-1'),
      toolCallAssistantMessage('a1', 'call-1', 'req-1', 'DiagnosticDump'),
      {
        ...toolResultMessage('t1', 'call-1', externalized.payload, 'req-1', 'DiagnosticDump'),
        content: JSON.stringify(externalized),
        metadata: { replacement },
      },
      makeMessage('ASSISTANT', 'a2', 'done', 'req-1'),
      makeMessage('USER', 'current', 'next question', 'current'),
    ];
    const deps = makeDeps(['u1', 'a1', 't1', 'a2', 'current'], messages);
    const rendered = await assembleAndRender(deps);

    const output = getToolResultText(rendered);
    expect(output).toContain('tool-results/result-1.txt');
    expect(output).toContain('Invoke the Read tool');
    expect(output).not.toContain('<large-content-preview>');
  });

  it('does NOT classify USER or ASSISTANT messages regardless of content size', async () => {
    const largeUserContent = 'Please analyze: ' + 'x'.repeat(10_000);
    const messages = [
      makeMessage('USER', 'u1', largeUserContent, 'req-1'),
      makeMessage('ASSISTANT', 'a1', 'ok', 'req-1'),
      makeMessage('USER', 'current', 'next', 'current'),
    ];
    const deps = makeDeps(['u1', 'a1', 'current'], messages);
    const rendered = await assembleAndRender(deps);
    // Find the large USER message — it should be preserved as-is
    const userMsgs = rendered.messages.filter((m) => m.role === 'USER');
    const largeUser = userMsgs.find((m) => {
      const content = m.content;
      if (Array.isArray(content)) {
        const textPart = content.find((p) => p.type === 'text');
        return textPart && 'text' in textPart && (textPart.text as string).length > 8192;
      }
      return false;
    });
    expect(largeUser).toBeDefined();
  });
});
