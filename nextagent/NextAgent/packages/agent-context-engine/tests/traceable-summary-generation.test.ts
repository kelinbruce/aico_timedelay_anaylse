import {
  COMPACT_SUMMARY_TEMPLATE_VERSION,
  DefaultTraceableSummaryGenerator,
  TraceableSummaryGenerationError,
  buildCompactSummaryUserPrompt,
  classifyCoveredRange,
  createDefaultTraceableSummaryGenerator,
  estimateSerializedInputUnits,
  listPresentCategories,
  parseSummaryModelOutput,
  serializeCoveredRangeForSummary,
  type PromptTemplateAssembler,
} from '@nextagent/agent-context-engine';
import {
  brand,
  type AgentId,
  type AgentVersion,
  type IdentityContext,
  type MessageId,
  type RequestLocale,
  type RequestRunId,
  type SessionId,
} from '@nextagent/agent-common';
import type {
  ModelFinalResult,
  ModelInferenceOptions,
  ModelInvocationRequest,
  ModelInvocationService,
  ModelMessage,
} from '@nextagent/agent-contracts/model';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import type { TraceableSummaryGenerationPort, TraceableSummaryGenerationRequest } from '@nextagent/agent-contracts/context';
import { describe, expect, it } from 'vitest';

// =============================================================================
// Fixture helpers
// =============================================================================

const TENANT = brand<string, 'TenantId'>('tenant-summary');
const SUBJECT = brand<string, 'SubjectId'>('subject-summary');
const AGENT = brand<string, 'AgentId'>('agent-summary');
const AGENT_V = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-summary');
const LOCALE = brand<string, 'RequestLocale'>('en-US');

function msgId(name: string): MessageId {
  return brand<string, 'MessageId'>(name);
}

function runId(name: string): RequestRunId {
  return brand<string, 'RequestRunId'>(name);
}

function makeIdentity(): IdentityContext {
  return { tenantId: TENANT, subjectId: SUBJECT, displayName: 'summary test' };
}

function userMessage(messageId: string, content: string, requestId = messageId): SessionMessage {
  return {
    messageId: msgId(messageId),
    sessionId: SESSION,
    requestId: msgId(requestId),
    role: 'USER',
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence: 0,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function assistantMessage(messageId: string, content: string, requestId = messageId): SessionMessage {
  return {
    messageId: msgId(messageId),
    sessionId: SESSION,
    requestId: msgId(requestId),
    role: 'ASSISTANT',
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence: 0,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function toolResultMessage(messageId: string, content: string, options: { hasArtifact?: boolean; hasError?: boolean } = {}): SessionMessage {
  return {
    messageId: msgId(messageId),
    sessionId: SESSION,
    requestId: msgId(messageId),
    role: 'CAPABILITY_RESULT',
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {
      ...(options.hasError ? { kind: 'CAPABILITY_FAILED' } : {}),
      ...(options.hasArtifact ? { capabilityResult: { status: 'SUCCEEDED', artifactRefs: [{ kind: 'FILE', refId: 'report-2026-06-11' }] } } : {}),
    },
    sequence: 0,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeRequest(covered: readonly SessionMessage[]): TraceableSummaryGenerationRequest {
  return {
    identityContext: makeIdentity(),
    agentId: AGENT,
    agentVersion: AGENT_V,
    sessionId: SESSION,
    requestId: msgId('req-summary-1'),
    runId: runId('run-summary-1'),
    locale: LOCALE,
    purpose: 'test-summary',
    flowVariables: {},
    coveredMessages: covered,
    coveredMessageRefs: covered.map((m) => m.messageId),
    retainedTailMessageRefs: [],
    targetBudgetUnits: 800,
  };
}

function makeModelReturning(rawText: string, options: { toolCalls?: number } = {}): ModelInvocationService {
  const final: ModelFinalResult = {
    content: rawText,
    finishReason: 'stop',
    ...(options.toolCalls && options.toolCalls > 0
      ? {
          toolCalls: Array.from({ length: options.toolCalls }, (_, i) => ({
            toolCallId: `call-${i}`,
            toolName: 'noop',
            arguments: {},
          })),
        }
      : {}),
  };
  return {
    complete: async (_request, _signal) => final,
    stream: streamFrom([final]),
  };
}

function makeModelThrowing(error: Error): ModelInvocationService {
  return {
    complete: async () => {
      throw error;
    },
    stream: streamFromError(error),
  };
}

function streamFrom(items: readonly ModelFinalResult[]): ModelInvocationService['stream'] {
  const gen = (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
  return gen as unknown as ModelInvocationService['stream'];
}

function streamFromError(error: unknown): ModelInvocationService['stream'] {
  const gen = (async function* () {
    throw error;
  })();
  return gen as unknown as ModelInvocationService['stream'];
}

function makeModelWithSafeError(safeError: {
  code: string;
  message: string;
  category: 'INTERNAL' | 'VALIDATION' | 'AUTHORIZATION' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE' | 'TIMEOUT' | 'CANCELED' | 'POLICY_DENIED';
  retryable: boolean;
}): ModelInvocationService {
  const final: ModelFinalResult = {
    content: '',
    finishReason: 'error',
    safeError,
  };
  return {
    complete: async () => final,
    stream: streamFrom([final]),
  };
}

/** Model returning a scripted sequence of finals across `complete` calls; last result repeats. */
function makeModelWithSequence(results: readonly [ModelFinalResult, ...ModelFinalResult[]]): {
  readonly model: ModelInvocationService;
  readonly callCount: () => number;
} {
  let index = 0;
  let count = 0;
  const last = results[results.length - 1] ?? results[0];
  const model: ModelInvocationService = {
    complete: async () => {
      count += 1;
      const result = results[index] ?? last;
      if (index < results.length - 1) {
        index += 1;
      }
      return result;
    },
    stream: streamFrom(last === undefined ? [] : [last]),
  };
  return { model, callCount: () => count };
}

function buildGenerator(
  model: ModelInvocationService,
  overrides: Partial<{
    inferenceOptions: Partial<ModelInferenceOptions>;
    timeoutMs: number;
    promptTemplateAssembler: PromptTemplateAssembler;
  }> = {},
): TraceableSummaryGenerationPort {
  return createDefaultTraceableSummaryGenerator({
    model,
    modelSelectionService: {
      async select() {
        return {
          status: 'SELECTED',
          reason: 'AGENT_DEFAULT',
          configuration: {
            modelId: 'test-model',
            contextWindowTokens: 128_000,
            temperature: 0.1,
            maxOutputTokens: 32_000,
            topP: 1,
            toolChoice: 'AUTO' as const,
            defaultTimeoutMs: overrides.timeoutMs ?? 5_000,
            defaultMaxRetries: 2,
            ...overrides.inferenceOptions,
          },
        };
      },
    },
    assemblyRegistry: {
      require: async () => ({ agentAssemblyRef: 'agent-summary:v1' }) as never,
    },
    ...(overrides.promptTemplateAssembler === undefined ? {} : { promptTemplateAssembler: overrides.promptTemplateAssembler }),
  });
}

// =============================================================================
// Unit tests: classifier
// =============================================================================

describe('classifyCoveredRange', () => {
  it('returns all-false for an empty covered range', () => {
    const c = classifyCoveredRange([]);
    expect(c).toEqual({
      user_intent: false,
      confirmed_facts: false,
      constraints: false,
      tool_outcomes: false,
      artifact_outcomes: false,
      unresolved_errors: false,
      pending_tasks: false,
      next_step: false,
    });
  });

  it('user_intent + next_step are present when the last turn is a non-empty USER message', () => {
    const c = classifyCoveredRange([assistantMessage('a1', 'ok'), userMessage('u1', 'continue with the next step')]);
    expect(c.user_intent).toBe(true);
    expect(c.confirmed_facts).toBe(true);
    expect(c.next_step).toBe(true);
  });

  it('tool_outcomes + artifact_outcomes are present when a CAPABILITY_RESULT carries artifactRefs', () => {
    const c = classifyCoveredRange([toolResultMessage('t1', 'ok', { hasArtifact: true })]);
    expect(c.tool_outcomes).toBe(true);
    expect(c.artifact_outcomes).toBe(true);
    expect(c.unresolved_errors).toBe(false);
  });

  it('unresolved_errors is present when a CAPABILITY_RESULT metadata.kind is CAPABILITY_FAILED', () => {
    const c = classifyCoveredRange([toolResultMessage('t1', 'failed', { hasError: true })]);
    expect(c.unresolved_errors).toBe(true);
  });

  it('constraints is present when content matches MUST / SHALL / CONSTRAINT:', () => {
    const c = classifyCoveredRange([userMessage('u1', 'the agent MUST NOT generate URLs that are not in the allowed list')]);
    expect(c.constraints).toBe(true);
  });

  it('pending_tasks is present when content has TODO or FIXME', () => {
    const c = classifyCoveredRange([assistantMessage('a1', 'I left a TODO for the network configuration step')]);
    expect(c.pending_tasks).toBe(true);
  });

  it('user_intent is false when all USER messages have empty content', () => {
    const c = classifyCoveredRange([userMessage('u1', '   ')]);
    expect(c.user_intent).toBe(false);
    expect(c.next_step).toBe(false);
  });

  it('listPresentCategories returns the categories in canonical order', () => {
    const c = classifyCoveredRange([toolResultMessage('t1', 'ok', { hasArtifact: true }), userMessage('u1', 'go')]);
    // No ASSISTANT message in the covered range, so confirmed_facts is
    // absent (the function only marks it present when an ASSISTANT
    // message with non-empty content is observed). `next_step` is
    // present because the LAST message is a non-empty USER message.
    expect(listPresentCategories(c)).toEqual(['user_intent', 'tool_outcomes', 'artifact_outcomes', 'next_step']);
  });
});

// =============================================================================
// Unit tests: input serializer
// =============================================================================

describe('serializeCoveredRangeForSummary', () => {
  it('renders one turn per line with role tags and ordinals', () => {
    const out = serializeCoveredRangeForSummary([userMessage('u1', 'first question'), assistantMessage('a1', 'first answer')]);
    expect(out).toContain('#0 [USER]');
    expect(out).toContain('first question');
    expect(out).toContain('#1 [ASSISTANT]');
    expect(out).toContain('first answer');
  });

  it('annotates externalized large content with a safe replacement summary', () => {
    const out = serializeCoveredRangeForSummary([
      {
        ...toolResultMessage('t1', 'huge blob'),
        metadata: {
          replacement: { kind: 'PERSISTED_PREVIEW', reason: 'OVERSIZED', contentRef: { refId: 'blob-abc' } },
        },
      },
    ]);
    expect(out).toContain('large content externalized');
    expect(out).toContain('kind=PERSISTED_PREVIEW');
    expect(out).toContain('contentRef=blob-abc');
  });

  it('redacts absolute local paths and secret-shaped substrings in user content', () => {
    const out = serializeCoveredRangeForSummary([userMessage('u1', 'the file at /home/admin/secret.txt has sk-cp-AbCdEf1234567890 in it')]);
    expect(out).toContain('[REDACTED:LOCAL_PATH]');
    expect(out).toContain('[REDACTED:SECRET]');
    expect(out).not.toContain('/home/admin/secret.txt');
    expect(out).not.toContain('sk-cp-AbCdEf1234567890');
  });

  it('does not modify the original message content', () => {
    const original = userMessage('u1', 'MUST keep this constraint');
    const before = original.content;
    serializeCoveredRangeForSummary([original]);
    expect(original.content).toBe(before);
  });
});

describe('estimateSerializedInputUnits', () => {
  it('counts every code point (CJK counts as 1 unit, supplementary plane counts as 1 unit)', () => {
    expect(estimateSerializedInputUnits('')).toBe(0);
    expect(estimateSerializedInputUnits('a')).toBe(1);
    expect(estimateSerializedInputUnits('hello')).toBe(5);
    expect(estimateSerializedInputUnits('你好')).toBe(2);
    expect(estimateSerializedInputUnits('🎉')).toBe(1);
  });
});

// =============================================================================
// Unit tests: output parser
// =============================================================================

describe('parseSummaryModelOutput', () => {
  it('extracts the first non-empty <summary> block and discards <analysis>', () => {
    const out = parseSummaryModelOutput('<analysis>thinking only</analysis>\n<summary>final summary content</summary>', false);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.summaryContent).toBe('final summary content');
      expect(out.value.usedFullTextFallback).toBe(false);
    }
  });

  it('skips an empty <summary></summary> and uses the next non-empty one', () => {
    const out = parseSummaryModelOutput('<summary></summary>\n<summary>final</summary>', false);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.summaryContent).toBe('final');
    }
  });

  it('uses the full raw text as fallback when no <summary> block exists', () => {
    const out = parseSummaryModelOutput('just plain text no markup', false);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.summaryContent).toBe('just plain text no markup');
      expect(out.value.usedFullTextFallback).toBe(true);
    }
  });

  it('extracts the <checklist> block and parses <fact> entries by category', () => {
    const out = parseSummaryModelOutput(
      '<summary>x</summary><checklist><fact name="user_intent">go</fact><fact name="next_step">finish report</fact></checklist>',
      false,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.checklist.presentCategoriesInOrder).toEqual(['user_intent', 'next_step']);
      expect(out.value.checklist.presentCategoryFacts.get('user_intent')).toBe('go');
      expect(out.value.checklist.presentCategoryFacts.get('next_step')).toBe('finish report');
    }
  });

  it('treats empty output as safe failure', () => {
    const out = parseSummaryModelOutput('   \n  ', false);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('empty_output');
    }
  });

  it('treats tool call attempt as safe failure', () => {
    const out = parseSummaryModelOutput('<summary>anything</summary>', true);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('tool_call_attempt');
    }
  });

  it('flags duplicate <fact> entries as present-but-duplicated', () => {
    const out = parseSummaryModelOutput(
      '<summary>x</summary><checklist><fact name="user_intent">a</fact><fact name="user_intent">b</fact></checklist>',
      false,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.checklist.duplicateCategories).toEqual(['user_intent']);
      expect(out.value.checklist.presentCategoryFacts.get('user_intent')).toBe('a');
    }
  });
});

// =============================================================================
// Integration tests: DefaultTraceableSummaryGenerator
// =============================================================================

describe('DefaultTraceableSummaryGenerator', () => {
  it('uses the request flow variables for both model selection and prompt assembly', async () => {
    const flowVariables = {
      networkEnvironment: 'lab',
      operationLevel: 'PRODUCTION',
    };
    let selectedFlowVariables: Readonly<Record<string, string>> | undefined;
    let assembledFlowVariables: Readonly<Record<string, string>> | undefined;
    let requiredAgentScope: readonly [string, string] | undefined;
    let selectedAgentScope: readonly [string, string, string] | undefined;
    const generator = createDefaultTraceableSummaryGenerator({
      model: makeModelReturning('<summary>short</summary>'),
      modelSelectionService: {
        async select(request) {
          selectedFlowVariables = request.flowVariables;
          selectedAgentScope = [request.agentId, request.agentVersion, request.agentAssemblyRef];
          return {
            status: 'SELECTED',
            reason: 'AGENT_DEFAULT',
            configuration: {
              modelId: 'test-model',
              contextWindowTokens: 128_000,
              temperature: 0.1,
              maxOutputTokens: 32_000,
              topP: 1,
              toolChoice: 'AUTO' as const,
              defaultTimeoutMs: 5_000,
              defaultMaxRetries: 2,
            },
          };
        },
      },
      assemblyRegistry: {
        require: async (agentId, agentVersion) => {
          requiredAgentScope = [agentId, agentVersion];
          return { agentAssemblyRef: 'agent-summary:v1' } as never;
        },
      },
      promptTemplateAssembler: {
        async assemble(request) {
          assembledFlowVariables = request.flowVariables;
          return {
            templateId: 'SUMMARY_GENERATION',
            templateRef: 'agent:agent-summary:v1:SUMMARY_GENERATION:lab',
            sections: [{ id: 'main', content: 'summary system prompt' }],
            renderedContent: 'summary system prompt',
          };
        },
      },
    });

    await generator.generate({
      ...makeRequest([userMessage('u1', 'x')]),
      flowVariables,
    });

    expect(selectedFlowVariables).toEqual(flowVariables);
    expect(assembledFlowVariables).toEqual(flowVariables);
    expect(requiredAgentScope).toEqual([AGENT, AGENT_V]);
    expect(selectedAgentScope).toEqual([AGENT, AGENT_V, 'agent-summary:v1']);
  });

  it('keeps prompt assembler failures on the context-engine safe error path', async () => {
    const generator = buildGenerator(makeModelReturning('unused'), {
      promptTemplateAssembler: {
        async assemble() {
          throw new Error('raw prompt body must stay hidden');
        },
      },
    });

    await expect(generator.generate(makeRequest([userMessage('u1', 'x')]))).rejects.toMatchObject({
      code: 'TRACEABLE_SUMMARY_GENERATION_FAILED',
      safeDetails: { reason: 'prompt_template_failed' },
    });
  });

  it('returns a draft on a healthy <summary> + matching <checklist> response', async () => {
    const covered = [
      userMessage('u1', '查 BTS-001 的告警'),
      assistantMessage('a1', '已查到告警，需要写入报告'),
      toolResultMessage('t1', 'found alarm', { hasArtifact: true }),
      userMessage('u2', '把告警详情写到 report-2026-06-11'),
    ];
    const modelOutput = [
      '<analysis>enumerate present categories</analysis>',
      '<summary>用户查询 BTS-001 告警，已查到告警详情并需要写入 report-2026-06-11。</summary>',
      '<checklist>',
      '  <fact name="user_intent">查 BTS-001 告警并写入报告</fact>',
      '  <fact name="confirmed_facts">已查到告警，需要写入报告</fact>',
      '  <fact name="tool_outcomes">告警查询工具返回结果</fact>',
      '  <fact name="artifact_outcomes">report-2026-06-11</fact>',
      '  <fact name="next_step">把告警详情写入 report-2026-06-11</fact>',
      '</checklist>',
    ].join('\n');
    const generator = buildGenerator(makeModelReturning(modelOutput));
    const draft = await generator.generate(makeRequest(covered));
    expect(draft.content).toContain('已查到告警详情');
    expect(draft.content).not.toContain('enumerate'); // analysis must not leak
    expect(draft.promptTemplateVersion).toMatch(/^builtin:SUMMARY_GENERATION:/u);
    expect(draft.generationMode).toBe('normal');
    expect(draft.sourceReferences).toEqual(covered.map((m) => m.messageId));
    expect(draft.rehydrationHints).toEqual([]);
  });

  it('records the model-visible input but the checklist is NEVER included in the draft', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    const modelOutput = '<summary>short</summary><checklist><fact name="user_intent">x</fact><fact name="next_step">y</fact></checklist>';
    const generator = buildGenerator(makeModelReturning(modelOutput));
    const draft = await generator.generate(makeRequest(covered));
    expect(draft.content).not.toContain('<checklist>');
    expect(draft.content).not.toContain('<fact');
    expect(draft.content).not.toContain('user_intent');
  });

  it('uses full-text fallback when the model returns plain text without markup', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    const generator = buildGenerator(makeModelReturning('just plain text answer'));
    const draft = await generator.generate(makeRequest(covered));
    expect(draft.content).toBe('just plain text answer');
  });

  it('throws TraceableSummaryGenerationError on tool call attempt', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    const generator = buildGenerator(makeModelReturning('<summary>x</summary><checklist></checklist>', { toolCalls: 1 }));
    await expect(generator.generate(makeRequest(covered))).rejects.toMatchObject({
      code: 'TRACEABLE_SUMMARY_GENERATION_FAILED',
      safeDetails: { reason: 'tool_call_attempt' },
    });
  });

  it('accepts summary when a present category is missing from the <checklist> (relaxed validation)', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    // Missing `next_step` (the last message is USER with non-empty content)
    const modelOutput = '<summary>short</summary><checklist><fact name="user_intent">x</fact></checklist>';
    const generator = buildGenerator(makeModelReturning(modelOutput));
    const result = await generator.generate(makeRequest(covered));
    expect(result.content).toBe('short');
  });

  it('accepts summary when a <fact> body is empty for a present category (relaxed validation)', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    const modelOutput = '<summary>short</summary><checklist><fact name="user_intent">   </fact><fact name="next_step">y</fact></checklist>';
    const generator = buildGenerator(makeModelReturning(modelOutput));
    const result = await generator.generate(makeRequest(covered));
    expect(result.content).toBe('short');
  });

  it('accepts summary when the <checklist> declares extra categories (relaxed validation)', async () => {
    // No tool calls / errors in covered range, but the model emits tool_outcomes
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    const modelOutput =
      '<summary>s</summary><checklist><fact name="user_intent">x</fact><fact name="next_step">y</fact><fact name="tool_outcomes">fake</fact></checklist>';
    const generator = buildGenerator(makeModelReturning(modelOutput));
    const result = await generator.generate(makeRequest(covered));
    expect(result.content).toBe('s');
  });

  it('accepts summary when the <checklist> block is missing entirely (relaxed validation)', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    const modelOutput = '<summary>short without checklist</summary>';
    const generator = buildGenerator(makeModelReturning(modelOutput));
    const result = await generator.generate(makeRequest(covered));
    expect(result.content).toBe('short without checklist');
  });

  it('propagates abort from the model invocation as a structured failure', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    const abortError = Object.assign(new Error('aborted'), { code: 'AbortError' });
    const generator = buildGenerator(makeModelThrowing(abortError));
    await expect(generator.generate(makeRequest(covered))).rejects.toMatchObject({
      code: 'TRACEABLE_SUMMARY_GENERATION_FAILED',
      safeDetails: { reason: 'aborted' },
    });
  });

  it('treats auth denied (401) as a safe failure that the caller can fall back from', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    const generator = buildGenerator(makeModelThrowing(Object.assign(new Error('unauthorized'), { code: 401 })));
    await expect(generator.generate(makeRequest(covered))).rejects.toMatchObject({
      code: 'TRACEABLE_SUMMARY_GENERATION_FAILED',
      category: 'AUTHORIZATION',
      safeDetails: { reason: 'auth_denied' },
    });
  });

  it('treats a model safeError as a safe failure', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    const generator = buildGenerator(
      makeModelWithSafeError({ code: 'PROVIDER_RATE_LIMIT', message: 'rate limited', category: 'INTERNAL', retryable: true }),
    );
    await expect(generator.generate(makeRequest(covered))).rejects.toMatchObject({
      code: 'TRACEABLE_SUMMARY_GENERATION_FAILED',
      safeDetails: { reason: 'model_safe_error' },
    });
  });

  const validSummaryResult: ModelFinalResult = {
    content: '<summary>short</summary><checklist><fact name="user_intent">x</fact><fact name="next_step">y</fact></checklist>',
    finishReason: 'stop',
  };
  const timeoutResult: ModelFinalResult = {
    content: '',
    finishReason: 'error',
    safeError: { code: 'MODEL_TIMEOUT', message: 'Model invocation timed out.', category: 'TIMEOUT', retryable: true },
  };
  it('delegates same-model retry to the model boundary and invokes it once', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    const { model, callCount } = makeModelWithSequence([timeoutResult, validSummaryResult]);
    const generator = buildGenerator(model);
    await expect(generator.generate(makeRequest(covered))).rejects.toMatchObject({
      code: 'TRACEABLE_SUMMARY_GENERATION_FAILED',
      safeDetails: { reason: 'model_safe_error' },
    });
    expect(callCount()).toBe(1);
  });

  it('forwards the request identity coordinates to the model call', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    let capturedRequest: ModelInvocationRequest | undefined;
    const recordingModel: ModelInvocationService = {
      complete: async (request, _signal) => {
        capturedRequest = request;
        return {
          content: ['<summary>short</summary>', '<checklist><fact name="user_intent">x</fact><fact name="next_step">y</fact></checklist>'].join(''),
          finishReason: 'stop',
        };
      },
      stream: streamFrom([{ content: '', finishReason: 'stop' }]),
    };
    const generator = buildGenerator(recordingModel);
    await generator.generate(makeRequest(covered));
    expect(capturedRequest).toBeDefined();
    expect(capturedRequest!.tools).toEqual([]);
    expect(capturedRequest!.modelId).toBe('test-model');
    expect(capturedRequest!.messages.length).toBe(2);
    expect(capturedRequest!.messages[0]!.role).toBe('SYSTEM');
    expect(capturedRequest!.messages[1]!.role).toBe('USER');
    // The user prompt must NOT contain raw secrets / paths from the covered range.
    const userText = (capturedRequest!.messages[1]!.content as ReadonlyArray<{ readonly text: string }>)[0]!.text;
    expect(userText).toContain('Target output budget');
    expect(userText).toContain('Covered older turns');
  });

  it('applies summary prompt modelOptions in the invocation owner', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    let capturedRequest: ModelInvocationRequest | undefined;
    const recordingModel: ModelInvocationService = {
      complete: async (request) => {
        capturedRequest = request;
        return {
          content: ['<summary>short</summary>', '<checklist><fact name="user_intent">x</fact><fact name="next_step">y</fact></checklist>'].join(''),
          finishReason: 'stop',
        };
      },
      stream: streamFrom([{ content: '', finishReason: 'stop' }]),
    };
    const promptTemplateAssembler: PromptTemplateAssembler = {
      assemble: async () => ({
        templateId: 'SUMMARY_GENERATION',
        templateRef: 'agent:agent-summary:v1:SUMMARY_GENERATION:test',
        sections: [{ id: 'main', content: 'summary system prompt' }],
        renderedContent: 'summary system prompt',
        modelOptions: { temperature: 0.4, maxOutputTokens: 256 },
      }),
    };
    const generator = createDefaultTraceableSummaryGenerator({
      model: recordingModel,
      modelSelectionService: {
        async select() {
          return {
            status: 'SELECTED',
            reason: 'AGENT_DEFAULT',
            configuration: {
              modelId: 'test-model',
              contextWindowTokens: 128_000,
              temperature: 0.1,
              maxOutputTokens: 32_000,
              topP: 0.8,
              toolChoice: 'AUTO' as const,
              defaultTimeoutMs: 5_000,
              defaultMaxRetries: 2,
            },
          };
        },
      },
      assemblyRegistry: {
        require: async () => ({ agentAssemblyRef: 'agent-summary:v1' }) as never,
      },
      promptTemplateAssembler,
    });

    await generator.generate(makeRequest(covered));

    expect(capturedRequest).toMatchObject({
      temperature: 0.4,
      maxOutputTokens: 256,
      topP: 0.8,
    });
  });

  it('NEVER includes raw secret-shaped substrings from the covered range in the model input', async () => {
    const covered = [userMessage('u1', 'the credential is sk-cp-AbCdEf1234567890XY at /home/admin/.env')];
    let capturedUserText = '';
    const recordingModel: ModelInvocationService = {
      complete: async (request) => {
        capturedUserText = (request.messages[1]!.content as ReadonlyArray<{ readonly text: string }>)[0]!.text;
        return {
          content: '<summary>s</summary><checklist><fact name="user_intent">x</fact></checklist>',
          finishReason: 'stop',
        };
      },
      stream: streamFrom([{ content: '', finishReason: 'stop' }]),
    };
    const generator = buildGenerator(recordingModel);
    // Relaxed validation: no longer throws on missing checklist categories
    await generator.generate(makeRequest(covered));
    expect(capturedUserText).toContain('[REDACTED:LOCAL_PATH]');
    expect(capturedUserText).toContain('[REDACTED:SECRET]');
    expect(capturedUserText).not.toContain('sk-cp-AbCdEf1234567890XY');
    expect(capturedUserText).not.toContain('/home/admin/.env');
  });

  it('consumer integration: the draft can be read by a fake compression consumer', async () => {
    const covered = [userMessage('u1', 'x'), userMessage('u2', 'y')];
    const generator = buildGenerator(
      makeModelReturning(
        '<summary>the long history was: a) user asked X, b) we got Y</summary><checklist><fact name="user_intent">asked X</fact><fact name="next_step">continue Y</fact></checklist>',
      ),
    );
    const draft = await generator.generate(makeRequest(covered));
    // A fake compression consumer would do: persist draft.content as a SUMMARY
    // SessionMessage, then the next assemble() reads the prior history
    // (now compressed) plus the current request. The draft shape matches
    // exactly what compression expects: content + sourceReferences +
    // historyLookupLinkage + generationMode + promptTemplateVersion.
    expect(draft.content.length).toBeGreaterThan(0);
    expect(draft.sourceReferences.length).toBe(2);
    expect(draft.historyLookupLinkage.length).toBe(0);
    expect(draft.generationMode).toBe('normal');
    expect(draft.promptTemplateVersion).toMatch(/^builtin:SUMMARY_GENERATION:/u);
  });
});

// =============================================================================
// Built-in template smoke test
// =============================================================================

describe('compact-summary/v1 template', () => {
  it('names the prompt template version and builds user prompts', () => {
    expect(COMPACT_SUMMARY_TEMPLATE_VERSION).toBe('compact-summary/v1');
    expect(buildCompactSummaryUserPrompt('x', 100)).toContain('x');
  });
});
