import { brand, type CapabilityId, type TimelineSequence } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { ModelSelectionService } from '@nextagent/agent-contracts/context';
import type { ModelInvocationRequest, ModelInvocationService, ModelFinalResult } from '@nextagent/agent-contracts/model';
import type { SuggestedQuestionPort, SuggestedQuestionRequest, SuggestedQuestionResult } from '@nextagent/agent-contracts/runtime';
import type { CapabilityDescriptionProvider } from './capability-description-provider.js';
import type {
  RequestRunRecord,
  RequestRunStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageRecord,
  SessionMessageRecordPage,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import { randomUUID } from 'node:crypto';

// --- Prompt template (固化在 spec/design 中) ---

const SUGGESTED_QUESTION_SYSTEM_PROMPT = `你是用户追问预测助手。你的唯一任务是根据本轮对话上下文，预测用户在得到当前回答后接下来最可能提出的 3 个追问。你必须站在用户视角思考：用户完成这一步后，会自然地接着问什么？
选择规则：
1. 优先预测用户当前任务最自然的下一步追问——用户得到回答后通常会接着问什么。
2. 其次预测用户可能用于确认结果、追问原因或补充条件的追问。
3. 如果上下文不足，不要返回空内容；改为预测用户可能提出的追问。
4. 每个问题只表达一个意图，使用用户的口吻和当前会话的语言术语，不重复、不宽泛。
5. 不得编造输入中不存在的事实，可以通过问题询问缺失事实。
6. 推荐的问题必须是用户会说的自然问句，而非助手的引导提问。避免“是否需要”“是否想要”“建议您”等助手口吻。
输出规则：
- 恰好输出三行，每行仅包含一个完整、自然、用户口吻的追问问题。
- 不要输出序号、标题、解释、Markdown、代码块或推理过程。`;
const CAPABILITY_DESCRIPTION_SYSTEM_RULE = '7. 当提供了产品能力范围和追问偏好时，推荐问题应与之相关，优先参考追问偏好中同类意图的推荐方向。';

// --- Dependencies ---

export interface SuggestedQuestionServiceDependencies {
  readonly model: ModelInvocationService;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly modelSelectionService: ModelSelectionService;
  readonly catalog: CapabilityCatalog;
  readonly requestRuns: Pick<RequestRunStoreGateway, 'loadRun'>;
  readonly messages: Pick<SessionMessageStoreGateway, 'listCurrentRequestMessages'>;
  readonly timeline: Pick<RunTimelineEventStoreGateway, 'listEvents'>;
  readonly capabilityDescriptionProvider?: CapabilityDescriptionProvider;
}

const EMPTY_RESULT: SuggestedQuestionResult = { questions: [] };
const MAX_QUESTIONS = 3;
const MODEL_TIMEOUT_MS = 30_000;
const MODEL_MAX_OUTPUT_TOKENS = 1024;
const MODEL_TEMPERATURE = 0.7;

// --- Port implementation ---

export function createSuggestedQuestionService(deps: SuggestedQuestionServiceDependencies): SuggestedQuestionPort {
  return {
    async generate(request: SuggestedQuestionRequest, signal?: AbortSignal): Promise<SuggestedQuestionResult> {
      if (signal?.aborted === true) {
        return EMPTY_RESULT;
      }

      const run = await deps.requestRuns.loadRun({
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        runId: request.runId,
      });
      if (run === undefined) {
        return EMPTY_RESULT;
      }

      // Terminal status guard: only COMPLETED with committed terminal proceeds.
      if (run.terminalCommitState !== 'COMMITTED' || run.status !== 'COMPLETED') {
        return EMPTY_RESULT;
      }

      const assembly = await deps.assemblyRegistry.active(request.agentId);

      // Load messages and timeline in parallel.
      const [messagesPage, events] = await Promise.all([
        deps.messages.listCurrentRequestMessages({
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          sessionId: request.sessionId,
          requestId: request.requestId,
          runId: request.runId,
          includeHidden: false,
          offset: 0,
          limit: 50,
        }),
        deps.timeline.listEvents({
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          sessionId: request.sessionId,
          afterSequence: 0 as TimelineSequence,
          limit: 100,
          runId: request.runId,
        }),
      ]);

      // Resolve prompt variables.
      const query = resolveQuery(messagesPage.items);
      const finalAnswer = resolveFinalAnswer(messagesPage.items);
      const skillContext = await resolveSkillContext(deps, request, assembly, events);
      const capabilityDescription = await resolveCapabilityDescription(deps, signal);

      // Build and send model request.
      const userPrompt = renderRecommendationContext({
        query,
        skill: skillContext,
        final_answer: finalAnswer,
        capability_description: capabilityDescription,
      });

      const systemPrompt =
        capabilityDescription.length > 0
          ? `${SUGGESTED_QUESTION_SYSTEM_PROMPT}\n${CAPABILITY_DESCRIPTION_SYSTEM_RULE}`
          : SUGGESTED_QUESTION_SYSTEM_PROMPT;

      const selected = await deps.modelSelectionService.select(
        {
          identityContext: {
            tenantId: request.tenantId,
            subjectId: request.subjectId,
            displayName: String(request.subjectId),
          },
          agentId: assembly.agentId,
          agentVersion: assembly.agentVersion,
          agentAssemblyRef: assembly.agentAssemblyRef,
          purpose: 'SUGGESTED_QUESTION',
          flowVariables: {},
          mode: 'INITIAL',
        },
        signal ?? new AbortController().signal,
      );
      if (selected.status === 'FAILED') {
        return EMPTY_RESULT;
      }

      let operationId: string;
      try {
        operationId = randomUUID();
      } catch {
        return EMPTY_RESULT;
      }

      const modelRequest: ModelInvocationRequest = {
        invocationScope: {
          tenantId: request.tenantId,
          subjectId: request.subjectId,
          agentId: request.agentId,
          agentVersion: assembly.agentVersion,
          agentAssemblyRef: assembly.agentAssemblyRef,
          operationId,
          sessionId: request.sessionId,
          requestId: request.requestId,
          runId: request.runId,
        },
        modelId: selected.configuration.modelId,
        messages: [
          { role: 'SYSTEM', content: [{ type: 'text', text: systemPrompt }] },
          { role: 'USER', content: [{ type: 'text', text: userPrompt }] },
        ],
        tools: [],
        temperature: MODEL_TEMPERATURE,
        maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
        thinking: { depth: 'OFF' },
        timeoutMs: MODEL_TIMEOUT_MS,
      };

      let result: ModelFinalResult;
      try {
        result = await deps.model.complete(modelRequest, signal ?? new AbortController().signal);
      } catch {
        return EMPTY_RESULT;
      }

      if (result.safeError !== undefined) {
        return EMPTY_RESULT;
      }

      return parseQuestions(result.content);
    },
  };
}

// --- Variable resolution ---

function resolveQuery(messages: readonly SessionMessageRecord[]): string {
  const userMessage = messages.find((m) => m.role === 'USER');
  return userMessage?.content ?? '';
}

function resolveFinalAnswer(messages: readonly SessionMessageRecord[]): string {
  const assistantMessages = messages.filter((m) => m.role === 'ASSISTANT' && m.visible);
  const last = assistantMessages[assistantMessages.length - 1];
  return last?.content ?? '';
}

// --- Skill two-path resolution ---
// Path 1: TARGETED_SKILL POLICY_APPLIED event with constraint-accepted outcome
//   resolves the selected skill via CapabilityCatalog.
// Path 2: Timeline CAPABILITY_STARTED events with capabilityKind === "SKILL"
//   resolves each invoked skill via CapabilityCatalog.
// (Recipe/workflow path was removed: RoutingPolicyEvidence does not record
//  recipeName, so recipe routing cannot be inferred from timeline events.
//  See design.md D5 and spec Skill Context Resolution for details.)

async function resolveSkillContext(
  deps: SuggestedQuestionServiceDependencies,
  request: SuggestedQuestionRequest,
  assembly: AgentAssembly,
  events: readonly RunTimelineEventRecord[],
): Promise<string> {
  // Path 1: TARGETED_SKILL policy event (routing decision specified a skill).
  const targetedSkillEvent = events.find(
    (e) =>
      e.type === 'POLICY_APPLIED' &&
      (e.inlinePayload as { policyDomain?: string }).policyDomain === 'TARGETED_SKILL' &&
      (e.inlinePayload as { outcome?: string }).outcome === 'constraint-accepted',
  );
  const skillCapabilityId = targetedSkillEvent?.inlinePayload.selectedCapabilityId as string | undefined;
  if (skillCapabilityId !== undefined) {
    const descriptor = await resolveCapabilitySafely(deps, request, assembly, brand<string, 'CapabilityId'>(skillCapabilityId));
    if (descriptor !== undefined && descriptor.kind === 'SKILL') {
      return formatDescriptor(descriptor);
    }
  }

  // Path 2: Timeline CAPABILITY_STARTED events — resolve each and filter SKILL kind.
  const capabilityStartedEvents = events.filter((e) => e.type === 'CAPABILITY_STARTED');
  const capabilityIds = new Set<string>();
  for (const event of capabilityStartedEvents) {
    const rawId = event.inlinePayload.capabilityId as string | undefined;
    if (rawId !== undefined) {
      capabilityIds.add(rawId);
    }
  }

  const skillDescriptors: CapabilityDescriptor[] = [];
  for (const rawId of capabilityIds) {
    const descriptor = await resolveCapabilitySafely(deps, request, assembly, brand<string, 'CapabilityId'>(rawId));
    if (descriptor !== undefined && descriptor.kind === 'SKILL') {
      skillDescriptors.push(descriptor);
    }
  }

  if (skillDescriptors.length === 0) {
    return '';
  }
  return skillDescriptors.map(formatDescriptor).join('\n');
}

async function resolveCapabilitySafely(
  deps: SuggestedQuestionServiceDependencies,
  request: SuggestedQuestionRequest,
  assembly: AgentAssembly,
  capabilityId: CapabilityId,
): Promise<CapabilityDescriptor | undefined> {
  try {
    return await deps.catalog.resolve({
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentAssembly: assembly,
      capabilityId,
    });
  } catch {
    return undefined;
  }
}

function formatDescriptor(descriptor: CapabilityDescriptor): string {
  return `${descriptor.displayName}: ${descriptor.description}`;
}

// --- Capability description resolution ---

async function resolveCapabilityDescription(deps: SuggestedQuestionServiceDependencies, signal?: AbortSignal): Promise<string> {
  if (deps.capabilityDescriptionProvider === undefined) {
    return '';
  }
  try {
    const content = await deps.capabilityDescriptionProvider.get(signal);
    return content?.trim() ?? '';
  } catch {
    return '';
  }
}

// --- Prompt rendering with variable escaping ---

function escapeTemplateVariable(value: string): string {
  return value.replaceAll('{', '\\{').replaceAll('}', '\\}');
}

function renderPrompt(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const escaped = escapeTemplateVariable(value);
    result = result.replaceAll(`{${key}}`, escaped);
  }
  return result;
}

function renderRecommendationContext(variables: {
  readonly query: string;
  readonly skill: string;
  readonly final_answer: string;
  readonly capability_description: string;
}): string {
  const query = variables.query.trim().length > 0 ? variables.query : '（未提供）';
  const finalAnswer = variables.final_answer.trim().length > 0 ? variables.final_answer : '（未提供）';
  const sections = [
    '请基于以下本轮对话上下文生成 3 个后续问题。输出语言必须与用户问题一致；用户问题未提供时跟随最终回答的语言；两者都未提供时使用中文。即使部分字段未提供，也必须围绕已有主题提出具体的澄清或下一步问题，不得返回空内容。',
    renderPrompt('用户问题：\n{query}', { query }),
    renderPrompt('最终回答：\n{final_answer}', { final_answer: finalAnswer }),
  ];
  if (variables.capability_description.length > 0) {
    sections.push(renderPrompt('产品能力范围：\n{capability_description}', { capability_description: variables.capability_description }));
  }
  if (variables.skill.length > 0) {
    sections.push(renderPrompt('相关 Skill：\n{skill}', { skill: variables.skill }));
  }
  return sections.join('\n\n');
}

// --- Output cleaning and parsing ---

const NUMBER_PREFIX_PATTERN = /^\d+[.\)、\s]+/;
const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s+/;
const NARRATIVE_PREFIX_PATTERN = /^(以下是|下面是|推荐|建议|这些建议)/;

function cleanModelOutput(raw: string): string {
  let output = raw;

  // 1. Strip <think>...</think> complete reasoning blocks.
  output = output.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // 1b. Strip unclosed <think> tag and everything after it (truncated reasoning).
  output = output.replace(/<think>[\s\S]*$/gi, '');

  // 1c. An orphaned closing tag means the provider omitted the opening tag.
  // Discard everything through the last orphaned tag so hidden reasoning
  // cannot be projected as a suggested question.
  const orphanedThinkClose = output.toLowerCase().lastIndexOf('</think>');
  if (orphanedThinkClose >= 0) {
    output = output.slice(orphanedThinkClose + '</think>'.length);
  }

  // 2. Strip Markdown code fence lines (``` or ```markdown etc.).
  output = output.replace(/^```[^\n]*$/gim, '');

  return output.trim();
}

export function parseQuestions(rawOutput: string): SuggestedQuestionResult {
  const cleaned = cleanModelOutput(rawOutput);
  // Split on blank lines first (handles double-newline separation).
  // Then, for each resulting segment that still contains newlines, re-split
  // on single newlines. This handles the common case where the model outputs
  // each question on its own line without blank-line separation — which
  // matches the prompt's own example format and accounts for ~70% of real
  // model outputs observed in production.
  const rawSegments = cleaned.split(/\n\s*\n/);
  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (segment.includes('\n')) {
      segments.push(...segment.split(/\n/));
    } else {
      segments.push(segment);
    }
  }
  const questions: string[] = [];
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) {
      continue;
    }
    // 3. Filter narrative lead-in segments.
    if (NARRATIVE_PREFIX_PATTERN.test(trimmed)) {
      continue;
    }
    // 4. Strip Markdown heading markers.
    let question = trimmed.replace(MARKDOWN_HEADING_PATTERN, '').trim();
    // Strip numeric prefix.
    question = question.replace(NUMBER_PREFIX_PATTERN, '').trim();
    if (question.length > 0) {
      questions.push(question);
    }
    if (questions.length >= MAX_QUESTIONS) {
      break;
    }
  }
  return { questions };
}
