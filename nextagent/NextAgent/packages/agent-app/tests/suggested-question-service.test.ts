import {
  brand,
  type AgentId,
  type CapabilityId,
  type JsonObject,
  type MessageId,
  type RequestRunId,
  type SessionId,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { RequestRunRecord, RunTimelineEventRecord, SessionMessageRecord, SessionMessageRecordPage } from '@nextagent/agent-contracts/gateway';
import type { SuggestedQuestionRequest } from '@nextagent/agent-contracts/runtime';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { createSuggestedQuestionService, parseQuestions } from '@nextagent/agent-session';

const TENANT_ID = brand<string, 'TenantId'>('T1');
const SUBJECT_ID = brand<string, 'SubjectId'>('U1');
const AGENT_ID = brand<string, 'AgentId'>('default-agent');
const SESSION_ID = brand<string, 'SessionId'>('S1');
const REQUEST_ID = brand<string, 'MessageId'>('msg-1');
const RUN_ID = brand<string, 'RequestRunId'>('R1');

function makeRequest(): SuggestedQuestionRequest {
  return { tenantId: TENANT_ID, subjectId: SUBJECT_ID, agentId: AGENT_ID, sessionId: SESSION_ID, requestId: REQUEST_ID, runId: RUN_ID };
}

function makeRunRecord(overrides: Partial<RequestRunRecord> = {}): RequestRunRecord {
  return {
    runId: RUN_ID,
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    agentId: AGENT_ID,
    agentVersion: brand<string, 'AgentVersion'>('1.0.0'),
    agentAssemblyRef: 'assembly-ref',
    attempt: 1,
    status: 'COMPLETED',
    version: 1,
    terminalCommitState: 'COMMITTED',
    createdAt: brand<number, 'EpochMillis'>(0),
    updatedAt: brand<number, 'EpochMillis'>(0),
    tenantId: TENANT_ID,
    subjectId: SUBJECT_ID,
    ...overrides,
  };
}

function makeMessage(role: 'USER' | 'ASSISTANT', content: string, overrides: Partial<SessionMessageRecord> = {}): SessionMessageRecord {
  return {
    messageId: brand<string, 'MessageId'>('m-' + Math.random()),
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    role,
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {} as JsonObject,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(0),
    agentId: AGENT_ID,
    tenantId: TENANT_ID,
    subjectId: SUBJECT_ID,
    ...overrides,
  };
}

function makeTimelineEvent(type: string, inlinePayload: JsonObject): RunTimelineEventRecord {
  return {
    agentId: AGENT_ID,
    agentVersion: brand<string, 'AgentVersion'>('1.0.0'),
    eventId: 'evt-' + Math.random(),
    sessionId: SESSION_ID,
    runId: RUN_ID,
    requestId: REQUEST_ID,
    requestContextId: brand<string, 'RequestContextId'>('ctx-1'),
    sequence: brand<number, 'TimelineSequence'>(1),
    type: type as RunTimelineEventRecord['type'],
    inlinePayload,
    createdAt: brand<number, 'EpochMillis'>(0),
    tenantId: TENANT_ID,
    subjectId: SUBJECT_ID,
  };
}

function makeModelResult(content: string): ModelFinalResult {
  return { content };
}

function makeAssembly(): AgentAssembly {
  return {
    agentId: AGENT_ID,
    agentVersion: brand<string, 'AgentVersion'>('1.0.0'),
    acceptedAt: brand<number, 'EpochMillis'>(0),
  } as unknown as AgentAssembly;
}

function makeDescriptor(id: string, kind: 'TOOL' | 'SKILL', displayName: string, description: string): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(id),
    kind,
    provider: 'BUILTIN',
    displayName,
    description,
    availabilityStatus: 'AVAILABLE',
  } as unknown as CapabilityDescriptor;
}

interface MockDeps {
  model: { complete: ReturnType<typeof vi.fn>; stream?: ReturnType<typeof vi.fn> };
  assemblyRegistry: { active: ReturnType<typeof vi.fn>; require: ReturnType<typeof vi.fn> };
  modelSelectionService: { select: ReturnType<typeof vi.fn> };
  catalog: { resolve: ReturnType<typeof vi.fn>; listAvailable: ReturnType<typeof vi.fn> };
  requestRuns: { loadRun: ReturnType<typeof vi.fn> };
  messages: { listCurrentRequestMessages: ReturnType<typeof vi.fn> };
  timeline: { listEvents: ReturnType<typeof vi.fn> };
  capabilityDescriptionProvider?: { get: ReturnType<typeof vi.fn> };
}

function makeMockDeps(overrides: Partial<MockDeps> = {}): MockDeps {
  const assembly = makeAssembly();
  return {
    model: { complete: vi.fn(async () => makeModelResult('question1\n\nquestion2\n\nquestion3')) } as any,
    assemblyRegistry: { active: vi.fn(async () => assembly), require: vi.fn(async () => assembly) },
    modelSelectionService: {
      select: vi.fn(async () => ({
        status: 'SELECTED',
        reason: 'AGENT_DEFAULT',
        configuration: {
          modelId: 'gpt-4o',
          contextWindowTokens: 128_000,
          temperature: 0.55,
          maxOutputTokens: 32_000,
          topP: 1,
          toolChoice: 'AUTO' as const,
          defaultTimeoutMs: 30_000,
          defaultMaxRetries: 2,
        },
      })),
    },
    catalog: { resolve: vi.fn(async () => undefined), listAvailable: vi.fn(async () => []) },
    requestRuns: { loadRun: vi.fn(async () => makeRunRecord()) },
    messages: {
      listCurrentRequestMessages: vi.fn(async (): Promise<SessionMessageRecordPage> => ({
        items: [makeMessage('USER', 'hello'), makeMessage('ASSISTANT', 'hi there')],
        limit: 50,
        hasMore: false,
      })),
    },
    timeline: { listEvents: vi.fn(async () => []) },
    ...overrides,
  };
}

describe('parseQuestions', () => {
  it('parses 3 questions separated by blank lines', () => {
    const result = parseQuestions('question1\n\nquestion2\n\nquestion3');
    expect(result.questions).toEqual(['question1', 'question2', 'question3']);
  });

  it('returns fewer than 3 when output has fewer segments', () => {
    const result = parseQuestions('only one\n\n  \n');
    expect(result.questions).toEqual(['only one']);
  });

  it('truncates to 3 when output has more than 3 segments', () => {
    const result = parseQuestions('q1\n\nq2\n\nq3\n\nq4\n\nq5');
    expect(result.questions).toEqual(['q1', 'q2', 'q3']);
  });

  it('strips numeric prefix patterns', () => {
    const result = parseQuestions('1. question one\n\n2、 question two\n\n3) question three');
    expect(result.questions).toEqual(['question one', 'question two', 'question three']);
  });

  it('returns empty for blank output', () => {
    const result = parseQuestions('  \n\n  ');
    expect(result.questions).toEqual([]);
  });

  it('strips complete <think> reasoning blocks', () => {
    const result = parseQuestions('<think>let me think about this\n\nsome reasoning</think>\n\nquestion one?\n\nquestion two?\n\nquestion three?');
    expect(result.questions).toEqual(['question one?', 'question two?', 'question three?']);
  });

  it('strips unclosed <think> tag and everything after it', () => {
    const result = parseQuestions('<think>reasoning that got truncated');
    expect(result.questions).toEqual([]);
  });

  it('strips unclosed <think> tag but keeps content after a closed block', () => {
    const result = parseQuestions('<think>block one</think>\n\nq1?\n\nq2?\n\nq3?');
    expect(result.questions).toEqual(['q1?', 'q2?', 'q3?']);
  });

  it('strips orphaned </think> closing tag', () => {
    const result = parseQuestions('</think>\n\nquestion one?\n\nquestion two?\n\nquestion three?');
    expect(result.questions).toEqual(['question one?', 'question two?', 'question three?']);
  });

  it('discards exposed reasoning before an orphaned </think> closing tag', () => {
    const result = parseQuestions('exposed reasoning\n</think>\nquestion one?\nquestion two?\nquestion three?');
    expect(result.questions).toEqual(['question one?', 'question two?', 'question three?']);
  });

  it('uses the last orphaned </think> closing tag as the reasoning boundary', () => {
    const result = parseQuestions('reasoning one\n</think>\nreasoning two\n</think>\nquestion one?\nquestion two?\nquestion three?');
    expect(result.questions).toEqual(['question one?', 'question two?', 'question three?']);
  });

  it('matches an orphaned </think> closing tag case-insensitively', () => {
    const result = parseQuestions('exposed reasoning\n</THINK>\nquestion one?\nquestion two?\nquestion three?');
    expect(result.questions).toEqual(['question one?', 'question two?', 'question three?']);
  });

  it('returns empty when no content follows an orphaned </think> closing tag', () => {
    const result = parseQuestions('exposed reasoning\n</think>\n  ');
    expect(result.questions).toEqual([]);
  });

  it('strips Markdown code fence lines', () => {
    const result = parseQuestions('\`\`\`\nquestion one?\n\nquestion two?\n\nquestion three?\n\`\`\`');
    expect(result.questions).toEqual(['question one?', 'question two?', 'question three?']);
  });

  it('strips Markdown code fence with language tag', () => {
    const result = parseQuestions('\`\`\`markdown\nquestion one?\n\nquestion two?\n\nquestion three?\n\`\`\`');
    expect(result.questions).toEqual(['question one?', 'question two?', 'question three?']);
  });

  it('filters narrative lead-in segments', () => {
    const result = parseQuestions('以下是推荐问题：\n\nquestion one?\n\nquestion two?\n\nquestion three?');
    expect(result.questions).toEqual(['question one?', 'question two?', 'question three?']);
  });

  it('filters multiple narrative prefixes', () => {
    const result = parseQuestions('推荐问题如下\n\nquestion one?\n\nquestion two?\n\nquestion three?');
    expect(result.questions).toEqual(['question one?', 'question two?', 'question three?']);
  });

  it('strips Markdown heading markers', () => {
    const result = parseQuestions('### question one?\n\n## question two?\n\n# question three?');
    expect(result.questions).toEqual(['question one?', 'question two?', 'question three?']);
  });

  it('handles think block plus narrative plus markdown combined', () => {
    const result = parseQuestions(
      '<think>reasoning</think>\n\n以下是推荐：\n\n\`\`\`\n### 1. question one?\n\n### 2. question two?\n\n### 3. question three?\n\`\`\`',
    );
    expect(result.questions).toEqual(['question one?', 'question two?', 'question three?']);
  });

  it('returns empty when output is all reasoning with no questions', () => {
    const result = parseQuestions('<think>let me think\n\nabout what to recommend\n\nbut no questions generated</think>');
    expect(result.questions).toEqual([]);
  });

  it('parses questions separated by single newlines without blank lines', () => {
    const result = parseQuestions(
      '5G相比4G在哪些具体场景中有显著的优势？\n5G网络部署时，SA和NSA两种模式的主要区别是什么？\n如何测试和优化5G网络的覆盖与性能指标？',
    );
    expect(result.questions).toEqual([
      '5G相比4G在哪些具体场景中有显著的优势？',
      '5G网络部署时，SA和NSA两种模式的主要区别是什么？',
      '如何测试和优化5G网络的覆盖与性能指标？',
    ]);
  });

  it('parses single-newline questions with numeric prefixes', () => {
    const result = parseQuestions('1. q one?\n2. q two?\n3. q three?');
    expect(result.questions).toEqual(['q one?', 'q two?', 'q three?']);
  });

  it('parses single-newline questions with Markdown heading markers', () => {
    const result = parseQuestions('### q one?\n## q two?\n# q three?');
    expect(result.questions).toEqual(['q one?', 'q two?', 'q three?']);
  });

  it('parses mixed separation: first question alone, then three single-newline questions', () => {
    const result = parseQuestions('q zero?\n\nq one?\nq two?\nq three?');
    expect(result.questions).toEqual(['q zero?', 'q one?', 'q two?', 'q three?'].slice(0, 3));
  });

  it('parses mixed separation with numeric prefixes in second segment', () => {
    const result = parseQuestions('q zero?\n\n1. q one?\n2. q two?\n3. q three?');
    expect(result.questions).toEqual(['q zero?', 'q one?', 'q two?']);
  });
});

describe('SuggestedQuestionService', () => {
  it('returns 3 questions for a COMPLETED run', async () => {
    const deps = makeMockDeps();
    const service = createSuggestedQuestionService(deps as any);
    const result = await service.generate(makeRequest());
    expect(result.questions).toHaveLength(3);
    expect(deps.model.complete).toHaveBeenCalledTimes(1);
  });

  it('returns empty list when run status is FAILED', async () => {
    const deps = makeMockDeps({
      requestRuns: { loadRun: vi.fn(async () => makeRunRecord({ status: 'FAILED' })) },
    });
    const service = createSuggestedQuestionService(deps as any);
    const result = await service.generate(makeRequest());
    expect(result.questions).toEqual([]);
    expect(deps.model.complete).not.toHaveBeenCalled();
  });

  it('returns empty list when run status is CANCELED', async () => {
    const deps = makeMockDeps({
      requestRuns: { loadRun: vi.fn(async () => makeRunRecord({ status: 'CANCELED' })) },
    });
    const service = createSuggestedQuestionService(deps as any);
    const result = await service.generate(makeRequest());
    expect(result.questions).toEqual([]);
    expect(deps.model.complete).not.toHaveBeenCalled();
  });

  it('returns empty list when terminalCommitState is not COMMITTED', async () => {
    const deps = makeMockDeps({
      requestRuns: { loadRun: vi.fn(async () => makeRunRecord({ terminalCommitState: 'PENDING' })) },
    });
    const service = createSuggestedQuestionService(deps as any);
    const result = await service.generate(makeRequest());
    expect(result.questions).toEqual([]);
    expect(deps.model.complete).not.toHaveBeenCalled();
  });

  it('proceeds when DEGRADATION_NOTICE exists but status is COMPLETED', async () => {
    const deps = makeMockDeps({
      timeline: { listEvents: vi.fn(async () => [makeTimelineEvent('DEGRADATION_NOTICE', { reasonCode: 'TOOL_ROUND_LIMIT_EXCEEDED' })]) },
    });
    const service = createSuggestedQuestionService(deps as any);
    const result = await service.generate(makeRequest());
    expect(result.questions).toHaveLength(3);
    expect(deps.model.complete).toHaveBeenCalledTimes(1);
  });

  it('returns empty list immediately when signal is already aborted', async () => {
    const deps = makeMockDeps();
    const service = createSuggestedQuestionService(deps as any);
    const controller = new AbortController();
    controller.abort();
    const result = await service.generate(makeRequest(), controller.signal);
    expect(result.questions).toEqual([]);
    expect(deps.model.complete).not.toHaveBeenCalled();
  });

  it('returns empty list when model invocation throws', async () => {
    const deps = makeMockDeps({
      model: {
        complete: vi.fn(async () => {
          throw new Error('network error');
        }),
      } as any,
    });
    const service = createSuggestedQuestionService(deps as any);
    const result = await service.generate(makeRequest());
    expect(result.questions).toEqual([]);
  });

  it('returns empty list when model returns safeError', async () => {
    const deps = makeMockDeps({
      model: { complete: vi.fn(async () => ({ content: '', safeError: { code: 'PROVIDER_ERROR', message: 'timeout' } })) } as any,
    });
    const service = createSuggestedQuestionService(deps as any);
    const result = await service.generate(makeRequest());
    expect(result.questions).toEqual([]);
  });

  it('sends model request with empty tools array', async () => {
    const deps = makeMockDeps();
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    expect(modelRequest.tools).toEqual([]);
  });

  it('uses model profile from agent assembly', async () => {
    const deps = makeMockDeps();
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    expect(modelRequest.modelId).toBe('gpt-4o');
    expect(modelRequest.invocationScope.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it('does not invoke the model when UUID generation fails', async () => {
    const deps = makeMockDeps();
    const service = createSuggestedQuestionService(deps as any);
    const randomUuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('UUID source unavailable');
    });
    syncBuiltinESMExports();
    try {
      await expect(service.generate(makeRequest())).resolves.toEqual({ questions: [] });
      expect(deps.model.complete).not.toHaveBeenCalled();
    } finally {
      randomUuid.mockRestore();
      syncBuiltinESMExports();
    }
  });

  it('separates stable instructions from trusted request context', async () => {
    const deps = makeMockDeps({
      messages: {
        listCurrentRequestMessages: vi.fn(async (): Promise<SessionMessageRecordPage> => ({
          items: [makeMessage('USER', 'what is the alarm?'), makeMessage('ASSISTANT', 'there is a link down alarm')],
          limit: 50,
          hasMore: false,
        })),
      },
    });
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    const systemPrompt = (modelRequest.messages[0]!.content[0]! as { type: string; text: string }).text;
    const userPrompt = (modelRequest.messages[1]!.content[0]! as { type: string; text: string }).text;
    expect(systemPrompt).not.toContain('what is the alarm?');
    expect(systemPrompt).not.toContain('there is a link down alarm');
    expect(userPrompt).toContain('请基于以下本轮对话上下文生成 3 个后续问题');
    expect(userPrompt).toContain('输出语言必须与用户问题一致');
    expect(userPrompt).toContain('用户问题：\nwhat is the alarm?');
    expect(userPrompt).toContain('最终回答：\nthere is a link down alarm');
  });

  it('sends a meaningful non-empty user message when conversation fields are missing', async () => {
    const deps = makeMockDeps({
      messages: {
        listCurrentRequestMessages: vi.fn(async (): Promise<SessionMessageRecordPage> => ({
          items: [],
          limit: 50,
          hasMore: false,
        })),
      },
    });
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    const userPrompt = (modelRequest.messages[1]!.content[0]! as { type: string; text: string }).text;
    expect(userPrompt.trim().length).toBeGreaterThan(0);
    expect(userPrompt).toContain('不得返回空内容');
    expect(userPrompt).toContain('两者都未提供时使用中文');
    expect(userPrompt).toContain('用户问题：\n（未提供）');
    expect(userPrompt).toContain('最终回答：\n（未提供）');
  });

  it('uses a user-perspective prompt that predicts follow-up questions', async () => {
    const deps = makeMockDeps();
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    const systemPrompt = (modelRequest.messages[0]!.content[0]! as { type: string; text: string }).text;
    const userPrompt = (modelRequest.messages[1]!.content[0]! as { type: string; text: string }).text;
    expect(systemPrompt).toContain('你是用户追问预测助手');
    expect(systemPrompt).toContain('站在用户视角思考');
    expect(systemPrompt).toContain('上下文不足');
    expect(systemPrompt).toContain('预测用户可能提出的追问');
    expect(systemPrompt).toContain('用户的口吻');
    expect(systemPrompt).toContain('避免“是否需要”“是否想要”“建议您”等助手口吻');
    expect(systemPrompt).toContain('恰好输出三行');
    expect(systemPrompt).toContain('不要输出序号、标题、解释、Markdown、代码块或推理过程');
    expect(systemPrompt).not.toContain('澄清问题');
    expect(systemPrompt).not.toContain('追问偏好');
    expect(systemPrompt).not.toContain('完整会话');
    expect(systemPrompt).not.toContain('高频追问');
    expect(systemPrompt).not.toContain('可靠的知识出处');
    expect(userPrompt).not.toContain('用户特征');
  });

  it('resolves skill context from TARGETED_SKILL policy event', async () => {
    const skillDescriptor = makeDescriptor('skill-1', 'SKILL', 'Network Explorer', 'explores network topology');
    const deps = makeMockDeps({
      timeline: {
        listEvents: vi.fn(async () => [
          makeTimelineEvent('POLICY_APPLIED', {
            policyDomain: 'TARGETED_SKILL',
            outcome: 'constraint-accepted',
            reasonCode: 'skill-selected',
            selectedCapabilityId: 'skill-1',
          }),
        ]),
      },
      catalog: { resolve: vi.fn(async () => skillDescriptor), listAvailable: vi.fn(async () => []) },
    });
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    const userPrompt = (modelRequest.messages[1]!.content[0]! as { type: string; text: string }).text;
    expect(userPrompt).toContain('相关 Skill：\nNetwork Explorer: explores network topology');
  });

  it('resolves skill context from CAPABILITY_STARTED events with SKILL kind', async () => {
    const skillDescriptor = makeDescriptor('skill-a', 'SKILL', 'Alarm Analyzer', 'analyzes alarms');
    const toolDescriptor = makeDescriptor('tool-1', 'TOOL', 'Ping Tool', 'pings hosts');
    const deps = makeMockDeps({
      timeline: {
        listEvents: vi.fn(async () => [
          makeTimelineEvent('CAPABILITY_STARTED', { capabilityId: 'tool-1', toolCallId: 'tc-1' }),
          makeTimelineEvent('CAPABILITY_STARTED', { capabilityId: 'skill-a', toolCallId: 'tc-2' }),
        ]),
      },
      catalog: {
        resolve: vi.fn(async (req: { capabilityId: CapabilityId }) => {
          if (req.capabilityId === brand<string, 'CapabilityId'>('skill-a')) {
            return skillDescriptor;
          }
          if (req.capabilityId === brand<string, 'CapabilityId'>('tool-1')) {
            return toolDescriptor;
          }
          return undefined;
        }),
        listAvailable: vi.fn(async () => []),
      },
    });
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    const userPrompt = (modelRequest.messages[1]!.content[0]! as { type: string; text: string }).text;
    expect(userPrompt).toContain('Alarm Analyzer: analyzes alarms');
    expect(userPrompt).not.toContain('Ping Tool');
  });

  it('returns empty skill context when only TOOL capabilities were used', async () => {
    const toolDescriptor = makeDescriptor('tool-1', 'TOOL', 'Ping Tool', 'pings hosts');
    const deps = makeMockDeps({
      timeline: { listEvents: vi.fn(async () => [makeTimelineEvent('CAPABILITY_STARTED', { capabilityId: 'tool-1', toolCallId: 'tc-1' })]) },
      catalog: { resolve: vi.fn(async () => toolDescriptor), listAvailable: vi.fn(async () => []) },
    });
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    const userPrompt = (modelRequest.messages[1]!.content[0]! as { type: string; text: string }).text;
    expect(userPrompt).not.toContain('相关 Skill');
  });

  it('does not cache: two calls each invoke model independently', async () => {
    const deps = makeMockDeps();
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    await service.generate(makeRequest());
    expect(deps.model.complete).toHaveBeenCalledTimes(2);
  });

  it('escapes template variables to prevent injection', async () => {
    const deps = makeMockDeps({
      messages: {
        listCurrentRequestMessages: vi.fn(async (): Promise<SessionMessageRecordPage> => ({
          items: [makeMessage('USER', '{skill} injection'), makeMessage('ASSISTANT', 'answer')],
          limit: 50,
          hasMore: false,
        })),
      },
    });
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    const userPrompt = (modelRequest.messages[1]!.content[0]! as { type: string; text: string }).text;
    expect(userPrompt).toContain('\\{skill\\} injection');
  });

  it('includes capability description section when provider returns non-empty content', async () => {
    const deps = makeMockDeps({
      capabilityDescriptionProvider: { get: vi.fn(async () => '5G基站告警诊断能力范围') },
      messages: {
        listCurrentRequestMessages: vi.fn(async (): Promise<SessionMessageRecordPage> => ({
          items: [makeMessage('USER', '查看告警'), makeMessage('ASSISTANT', '发现3条告警')],
          limit: 50,
          hasMore: false,
        })),
      },
    });
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    const systemPrompt = (modelRequest.messages[0]!.content[0]! as { type: string; text: string }).text;
    const userPrompt = (modelRequest.messages[1]!.content[0]! as { type: string; text: string }).text;
    expect(userPrompt).toContain('产品能力范围：');
    expect(userPrompt).toContain('5G基站告警诊断能力范围');
    expect(systemPrompt).toContain('7. 当提供了产品能力范围和追问偏好时，推荐问题应与之相关，优先参考追问偏好中同类意图的推荐方向。');
    // Section order: query -> final_answer -> capability_description -> skill
    const capIndex = userPrompt.indexOf('产品能力范围');
    const queryIndex = userPrompt.indexOf('用户问题');
    const answerIndex = userPrompt.indexOf('最终回答');
    expect(queryIndex).toBeLessThan(answerIndex);
    expect(answerIndex).toBeLessThan(capIndex);
  });

  it('omits capability description section when provider returns undefined', async () => {
    const deps = makeMockDeps({
      capabilityDescriptionProvider: { get: vi.fn(async () => undefined) },
    });
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    const systemPrompt = (modelRequest.messages[0]!.content[0]! as { type: string; text: string }).text;
    const userPrompt = (modelRequest.messages[1]!.content[0]! as { type: string; text: string }).text;
    expect(userPrompt).not.toContain('产品能力范围');
    expect(systemPrompt).not.toContain('产品能力范围');
    expect(systemPrompt).not.toContain('追问偏好');
  });

  it('omits capability description section when provider is not injected', async () => {
    const deps = makeMockDeps();
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    const systemPrompt = (modelRequest.messages[0]!.content[0]! as { type: string; text: string }).text;
    const userPrompt = (modelRequest.messages[1]!.content[0]! as { type: string; text: string }).text;
    expect(userPrompt).not.toContain('产品能力范围');
    expect(systemPrompt).not.toContain('产品能力范围');
    expect(systemPrompt).not.toContain('追问偏好');
  });

  it('escapes braces in capability description content', async () => {
    const deps = makeMockDeps({
      capabilityDescriptionProvider: { get: vi.fn(async () => 'content with {braces}') },
    });
    const service = createSuggestedQuestionService(deps as any);
    await service.generate(makeRequest());
    const modelRequest = deps.model.complete.mock.calls[0]![0] as ModelInvocationRequest;
    const userPrompt = (modelRequest.messages[1]!.content[0]! as { type: string; text: string }).text;
    expect(userPrompt).toContain('\\{braces\\}');
  });
});
