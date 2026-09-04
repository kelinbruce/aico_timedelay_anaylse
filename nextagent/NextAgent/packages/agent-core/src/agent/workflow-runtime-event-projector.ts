import type { JsonObject, JsonValue, ToolEventType, ToolMessageType } from '@nextagent/agent-common';
import { TOOL_EVENT_TYPES, TOOL_MESSAGE_TYPES } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionEvent, WorkflowNodeDef, WorkflowVisibleDeltaChannel } from '@nextagent/agent-contracts/core';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';

const HIDDEN_OUTPUT_MARKER = '[HIDDEN]' as const;
const DEGRADED_STATUS = 'DEGRADED' as const;
const lifecycleProjectionOptions = { omitInput: true, omitOutput: true, omitDescription: true } as const;

const VALID_DISPLAY_TYPES = ['TEXT', 'CHART', 'CHART_PRO', 'HTML', 'TABLE', 'PIU', 'DSL', 'FILE', 'OPERATOR', 'ACTION'] as const;

export class WorkflowRuntimeEventProjector {
  private readonly llmVisibleContent = new Map<string, string>();
  private readonly llmVisibleThinking = new Map<string, string>();
  private readonly structuredStreamedSteps = new Map<string, { readonly level: ToolEventType; readonly messageType: ToolMessageType }>();
  private readonly structuredAccumulatedContent = new Map<string, string>();

  private readonly answerNodeId?: string | undefined;

  constructor(
    private readonly recipe: RecipeDefinition,
    private readonly levelScope: 'MAIN' | 'SUB' = 'MAIN',
    private readonly parentToolCallId?: string,
  ) {
    this.answerNodeId = resolveAnswerNodeId(recipe.flowGraph);
  }

  project(event: WorkflowExecutionEvent): RunTimelineEvent[] {
    if (event.eventType === 'NODE_OUTPUT_DELTA' && event.visibleDelta?.level !== undefined) {
      const displayControl = this.resolveDisplayControl(event);
      if (displayControl.displayType !== undefined) {
        return this.projectBase(event);
      }
      if (!isTitleLevel(event.visibleDelta.level) && !isContentLevel(event.visibleDelta.level)) {
        // Not a title or content level 鈥?always allow.
      } else if (!displayControl.showTitle && isTitleLevel(event.visibleDelta.level)) {
        return [];
      } else if (!displayControl.showContent && isContentLevel(event.visibleDelta.level)) {
        return [];
      }
      const stepId = workflowStepId(event);
      const scopedLevel = this.mapLevelToScope(event.visibleDelta.level);
      const toolMessageType = mapDeltaChannelToMessageType(event.visibleDelta.channel);
      this.structuredStreamedSteps.set(stepId, { level: scopedLevel, messageType: toolMessageType });
      const accumulatedContent = accumulateVisibleText(this.structuredAccumulatedContent, stepId, event.visibleDelta.content);
      return [this.buildStructuredEvent(event, scopedLevel, toolMessageType, accumulatedContent)];
    }
    const base = this.projectBase(event);
    const structured = this.projectStructuredDelta(event);
    const projected = structured === undefined ? base : [...base, structured];
    if (isWorkflowNodeTerminalEvent(event)) {
      const stepId = workflowStepId(event);
      this.llmVisibleThinking.delete(stepId);
      this.llmVisibleContent.delete(stepId);
      this.structuredStreamedSteps.delete(stepId);
      this.structuredAccumulatedContent.delete(stepId);
    }
    return projected;
  }

  private projectBase(event: WorkflowExecutionEvent): RunTimelineEvent[] {
    if (isWorkflowScaffoldNode(event.nodeType)) {
      return [];
    }
    if (isCapabilityLikeWorkflowNode(event.nodeType)) {
      return this.projectCapabilityNodeEvent(event);
    }
    if (isVisibleTextWorkflowNode(event.nodeType)) {
      return this.projectLlmNodeEvent(event);
    }
    return this.projectGenericNodeEvent(event);
  }

  private projectLlmNodeEvent(event: WorkflowExecutionEvent): RunTimelineEvent[] {
    const identity = workflowCapabilityIdentity(this.recipe, event);
    const displayControl = this.resolveDisplayControl(event);
    if (event.eventType === 'NODE_STARTED' && event.nodeExecutionId !== undefined) {
      if (!displayControl.showTitle) {
        return [];
      }
      return [
        {
          type: 'CAPABILITY_STARTED',
          inlinePayload: this.attachWorkflowFields(
            event,
            { capabilityId: identity.capabilityId, toolCallId: identity.toolCallId, ...workflowVisibleNodeCapabilityIdentity(this.recipe, event) },
            lifecycleProjectionOptions,
          ),
        },
      ];
    }
    if (event.eventType === 'NODE_COMPLETED' && event.nodeExecutionId !== undefined) {
      if (!displayControl.showTitle && !displayControl.showContent) {
        return [];
      }
      return [
        {
          type: 'CAPABILITY_COMPLETED',
          inlinePayload: this.attachWorkflowFields(
            event,
            {
              capabilityId: identity.capabilityId,
              ...workflowVisibleNodeCapabilityIdentity(this.recipe, event),
              toolCallId: identity.toolCallId,
              status: 'SUCCEEDED',
              durationMs: durationMs(event.startedAt, event.completedAt),
            },
            lifecycleProjectionOptions,
          ),
        },
      ];
    }
    if (event.eventType === 'NODE_SKIPPED' && event.nodeExecutionId !== undefined) {
      return [
        {
          type: 'CAPABILITY_COMPLETED',
          inlinePayload: this.attachWorkflowFields(
            event,
            {
              capabilityId: identity.capabilityId,
              ...workflowVisibleNodeCapabilityIdentity(this.recipe, event),
              toolCallId: identity.toolCallId,
              status: DEGRADED_STATUS,
              durationMs: durationMs(event.startedAt, event.completedAt),
            },
            lifecycleProjectionOptions,
          ),
        },
      ];
    }
    if (event.eventType === 'NODE_WAITING' && event.nodeExecutionId !== undefined) {
      return [this.buildWaitingNodeTerminal(event)];
    }
    if (event.eventType === 'NODE_FAILED' && event.nodeExecutionId !== undefined) {
      return [
        {
          type: 'CAPABILITY_COMPLETED',
          inlinePayload: this.attachWorkflowFields(
            event,
            {
              capabilityId: identity.capabilityId,
              ...workflowVisibleNodeCapabilityIdentity(this.recipe, event),
              toolCallId: identity.toolCallId,
              status: event.safeError?.category === 'TIMEOUT' ? 'TIMED_OUT' : 'FAILED',
              durationMs: durationMs(event.startedAt, event.completedAt),
              ...(event.safeError?.code === undefined ? {} : { safeErrorCode: event.safeError.code }),
              ...(event.safeError?.category === undefined ? {} : { safeErrorCategory: event.safeError.category }),
            },
            lifecycleProjectionOptions,
          ),
        },
      ];
    }
    if (event.eventType !== 'NODE_OUTPUT_DELTA' || event.visibleDelta === undefined) {
      return [];
    }
    if (event.visibleDelta.channel === 'CONTENT' && !displayControl.showContent) {
      return [];
    }
    if (event.visibleDelta.channel !== 'CONTENT' && !displayControl.showTitle) {
      return [];
    }
    const stepId = workflowStepId(event);
    if (event.visibleDelta.channel === 'CONTENT') {
      const content = accumulateVisibleText(this.llmVisibleContent, stepId, event.visibleDelta.content);
      return [
        {
          type: 'LLM_CONTENT_DELTA',
          inlinePayload: this.attachWorkflowFields(event, { content, stepId }, lifecycleProjectionOptions),
        },
      ];
    }

    const reasoning = accumulateVisibleText(this.llmVisibleThinking, stepId, event.visibleDelta.content);
    return [
      {
        type: 'LLM_THINKING_DELTA',
        persistence: 'LIVE_ONLY',
        inlinePayload: this.attachWorkflowFields(event, { reasoning, stepId }, lifecycleProjectionOptions),
      },
    ];
  }

  private projectCapabilityNodeEvent(event: WorkflowExecutionEvent): RunTimelineEvent[] {
    const identity = workflowCapabilityIdentity(this.recipe, event);
    const displayControl = this.resolveDisplayControl(event);
    switch (event.eventType) {
      case 'NODE_STARTED':
        if (!displayControl.showTitle) {
          return [];
        }
        return [
          {
            type: 'CAPABILITY_STARTED',
            inlinePayload: this.attachWorkflowFields(
              event,
              {
                capabilityKind: identity.capabilityKind,
                capabilityId: identity.capabilityId,
                toolCallId: identity.toolCallId,
              },
              lifecycleProjectionOptions,
            ),
          },
        ];
      case 'NODE_OUTPUT_DELTA':
        return [];
      case 'NODE_COMPLETED':
        if (!displayControl.showTitle && !displayControl.showContent) {
          return [];
        }
        return [
          ...(event.nodeType === 'RESTFUL' && event.output !== undefined && displayControl.showContent
            ? [this.buildCapabilityResultDelta(event, identity)]
            : []),
          {
            type: 'CAPABILITY_COMPLETED',
            inlinePayload: this.attachWorkflowFields(
              event,
              {
                capabilityKind: identity.capabilityKind,
                capabilityId: identity.capabilityId,
                toolCallId: identity.toolCallId,
                status: 'SUCCEEDED',
                durationMs: durationMs(event.startedAt, event.completedAt),
              },
              lifecycleProjectionOptions,
            ),
          },
        ];
      case 'NODE_SKIPPED':
        return [
          {
            type: 'CAPABILITY_COMPLETED',
            inlinePayload: this.attachWorkflowFields(
              event,
              {
                capabilityKind: identity.capabilityKind,
                capabilityId: identity.capabilityId,
                toolCallId: identity.toolCallId,
                status: 'DEGRADED',
                durationMs: durationMs(event.startedAt, event.completedAt),
              },
              lifecycleProjectionOptions,
            ),
          },
        ];
      case 'NODE_FAILED':
        return [
          {
            type: 'CAPABILITY_COMPLETED',
            inlinePayload: this.attachWorkflowFields(
              event,
              {
                capabilityKind: identity.capabilityKind,
                capabilityId: identity.capabilityId,
                toolCallId: identity.toolCallId,
                status: event.safeError?.category === 'TIMEOUT' ? 'TIMED_OUT' : 'FAILED',
                durationMs: durationMs(event.startedAt, event.completedAt),
                ...(event.safeError?.code === undefined ? {} : { safeErrorCode: event.safeError.code }),
                ...(event.safeError?.category === undefined ? {} : { safeErrorCategory: event.safeError.category }),
              },
              lifecycleProjectionOptions,
            ),
          },
        ];
      case 'NODE_WAITING':
        return event.nodeExecutionId === undefined ? [] : [this.buildWaitingNodeTerminal(event)];
      default: {
        const exhaustive: never = event.eventType;
        throw new Error(`Unhandled case: ${String(exhaustive)}`);
      }
    }
  }

  // RESTFUL 节点完成时将聚合结果实时投递为 CAPABILITY_RESULT_DELTA
  // （LIVE_ONLY）。聚合结果同时经 projectStructuredDelta 的
  // TOOL_STRUCTURED_DELTA（PERSISTED）持久化；CAPABILITY_COMPLETED
  // 保持 body-free（timeline 持久化策略拒绝携带可恢复内容）。
  private buildCapabilityResultDelta(event: WorkflowExecutionEvent, identity: WorkflowCapabilityIdentity): RunTimelineEvent {
    return {
      type: 'CAPABILITY_RESULT_DELTA',
      persistence: 'LIVE_ONLY',
      inlinePayload: this.attachWorkflowFields(
        event,
        {
          capabilityId: identity.capabilityId,
          toolCallId: identity.toolCallId,
          result: this.resolveVisibleOutput(event),
        },
        lifecycleProjectionOptions,
      ),
    };
  }

  private projectGenericNodeEvent(event: WorkflowExecutionEvent): RunTimelineEvent[] {
    const identity = workflowCapabilityIdentity(this.recipe, event);
    const displayControl = this.resolveDisplayControl(event);
    switch (event.eventType) {
      case 'NODE_STARTED':
        if (!displayControl.showTitle) {
          return [];
        }
        return [
          {
            type: 'CAPABILITY_STARTED',
            inlinePayload: this.attachWorkflowFields(
              event,
              { capabilityId: identity.capabilityId, toolCallId: identity.toolCallId },
              lifecycleProjectionOptions,
            ),
          },
        ];
      case 'NODE_COMPLETED':
        if (!displayControl.showTitle && !displayControl.showContent) {
          return [];
        }
        return [
          {
            type: 'CAPABILITY_COMPLETED',
            inlinePayload: this.attachWorkflowFields(
              event,
              {
                capabilityId: identity.capabilityId,
                toolCallId: identity.toolCallId,
                status: 'SUCCEEDED',
                durationMs: durationMs(event.startedAt, event.completedAt),
              },
              lifecycleProjectionOptions,
            ),
          },
        ];
      case 'NODE_SKIPPED':
        return [
          {
            type: 'CAPABILITY_COMPLETED',
            inlinePayload: this.attachWorkflowFields(
              event,
              {
                capabilityId: identity.capabilityId,
                toolCallId: identity.toolCallId,
                status: DEGRADED_STATUS,
                durationMs: durationMs(event.startedAt, event.completedAt),
              },
              lifecycleProjectionOptions,
            ),
          },
        ];
      case 'NODE_FAILED':
        return [
          {
            type: 'CAPABILITY_COMPLETED',
            inlinePayload: this.attachWorkflowFields(
              event,
              {
                capabilityId: identity.capabilityId,
                toolCallId: identity.toolCallId,
                status: event.safeError?.category === 'TIMEOUT' ? 'TIMED_OUT' : 'FAILED',
                durationMs: durationMs(event.startedAt, event.completedAt),
                ...(event.safeError?.code === undefined ? {} : { safeErrorCode: event.safeError.code }),
                ...(event.safeError?.category === undefined ? {} : { safeErrorCategory: event.safeError.category }),
              },
              lifecycleProjectionOptions,
            ),
          },
        ];
      case 'NODE_WAITING':
        return event.nodeExecutionId === undefined ? [] : [this.buildWaitingNodeTerminal(event)];
      case 'NODE_OUTPUT_DELTA':
        return [];
      default: {
        const exhaustive: never = event.eventType;
        throw new Error(`Unhandled case: ${String(exhaustive)}`);
      }
    }
  }

  private buildWaitingNodeTerminal(event: WorkflowExecutionEvent): RunTimelineEvent {
    const identity = workflowCapabilityIdentity(this.recipe, event);
    return {
      type: 'CAPABILITY_COMPLETED',
      inlinePayload: this.attachWorkflowFields(
        event,
        {
          ...workflowNodeCapabilityIdentity(this.recipe, event),
          capabilityId: identity.capabilityId,
          toolCallId: identity.toolCallId,
          status: DEGRADED_STATUS,
          reasonCode: 'WORKFLOW_NODE_WAITING',
          durationMs: durationMs(event.startedAt, event.completedAt),
        },
        lifecycleProjectionOptions,
      ),
    };
  }

  private attachWorkflowFields(
    event: WorkflowExecutionEvent,
    base: JsonObject,
    options: { readonly omitInput?: boolean; readonly omitOutput?: boolean; readonly omitDescription?: boolean } = {},
  ): JsonObject {
    const displayControl = this.resolveDisplayControl(event);
    const payload: Record<string, unknown> = { ...base };
    payload.workflowEventType = event.eventType;
    payload.nodeId = event.nodeId;
    payload.nodeType = event.nodeType;
    if (event.nodeExecutionId !== undefined) {
      payload.nodeExecutionId = event.nodeExecutionId;
    }
    if (event.predecessorNodeExecutionIds !== undefined) {
      payload.predecessorNodeExecutionIds = event.predecessorNodeExecutionIds;
    }
    if (this.parentToolCallId !== undefined) {
      payload.parentToolCallId = this.parentToolCallId;
    }
    if (!options.omitDescription && displayControl.showTitle) {
      const nodeDesc = this.resolveNodeDescription(event);
      if (nodeDesc !== undefined) {
        payload.description = nodeDesc;
      }
    }
    if (event.retryCount > 0) {
      payload.retryCount = event.retryCount;
    }
    if (event.diagnostic?.reasonCode !== undefined) {
      payload.diagnostic = { reasonCode: event.diagnostic.reasonCode };
    }
    if (!options.omitInput && event.input !== undefined) {
      payload.input = event.input;
    }
    if (!options.omitOutput && event.output !== undefined && event.eventType !== 'NODE_STARTED') {
      payload.output = displayControl.showContent ? this.resolveVisibleOutput(event) : HIDDEN_OUTPUT_MARKER;
    }
    return payload as JsonObject;
  }

  private resolveDisplayControl(event: WorkflowExecutionEvent): {
    readonly showTitle: boolean;
    readonly showContent: boolean;
    readonly displayType?: string | undefined;
    readonly displayData?: JsonValue | undefined;
    readonly messageLevel?: ToolEventType | undefined;
    readonly showAigc: boolean;
  } {
    try {
      const parser = this.resolveOutputParser(event);
      if (parser === undefined) {
        return { showTitle: true, showContent: true, displayType: undefined, displayData: undefined, messageLevel: undefined, showAigc: false };
      }
      const rawType = typeof parser.type === 'string' ? parser.type.trim().toUpperCase() : undefined;
      const displayType = rawType !== undefined && (VALID_DISPLAY_TYPES as readonly string[]).includes(rawType) ? rawType : undefined;
      const rawData = parser.data;
      const displayData = rawData !== undefined && rawData !== null ? rawData : undefined;
      const rawLevel =
        typeof parser.message_level === 'string' ? parser.message_level : typeof parser.messageLevel === 'string' ? parser.messageLevel : undefined;
      const upperLevel = rawLevel?.trim().toUpperCase();
      const messageLevel =
        upperLevel !== undefined && (TOOL_EVENT_TYPES as readonly string[]).includes(upperLevel) ? (upperLevel as ToolEventType) : undefined;
      return {
        showTitle: parser.show_title !== false && parser.showTitle !== false,
        showContent: parser.show_content !== false && parser.showContent !== false,
        displayType,
        displayData,
        messageLevel,
        showAigc: parser.show_aigc === true || parser.showAigc === true,
      };
    } catch {
      return { showTitle: true, showContent: true, displayType: undefined, displayData: undefined, messageLevel: undefined, showAigc: false };
    }
  }

  private resolveOutputParser(event: WorkflowExecutionEvent): JsonObject | undefined {
    const fromOutput =
      event.output !== undefined && typeof event.output === 'object' && !Array.isArray(event.output)
        ? (event.output as Record<string, unknown>).output_parser
        : undefined;
    if (fromOutput !== undefined && typeof fromOutput === 'object' && !Array.isArray(fromOutput)) {
      return fromOutput as JsonObject;
    }
    const node = this.recipe.flowGraph.nodes[event.nodeId];
    if (node === undefined) {
      return undefined;
    }
    const fromPresentation = node.presentation?.outputParser;
    if (fromPresentation !== undefined && typeof fromPresentation === 'object') {
      return fromPresentation as JsonObject;
    }
    const fromNode = node.outputParser;
    if (fromNode !== undefined && typeof fromNode === 'object') {
      return fromNode as JsonObject;
    }
    const fromOutputs = typeof node.outputs === 'object' && node.outputs !== null ? (node.outputs as JsonObject).output_parser : undefined;
    if (fromOutputs !== undefined && typeof fromOutputs === 'object') {
      return fromOutputs as JsonObject;
    }
    return undefined;
  }

  private resolveNodeDescription(event: WorkflowExecutionEvent): string | undefined {
    const node = this.recipe.flowGraph.nodes[event.nodeId];
    return node?.description;
  }

  private resolveVisibleOutput(event: WorkflowExecutionEvent): JsonObject {
    const raw = event.output ?? {};
    if (typeof raw !== 'object' || raw === null) {
      return raw;
    }
    const { output_parser, ...rest } = raw as Record<string, unknown>;
    return rest as JsonObject;
  }

  private projectStructuredDelta(event: WorkflowExecutionEvent): RunTimelineEvent | undefined {
    if (isGatewayWorkflowNode(event.nodeType)) {
      return undefined;
    }
    if (event.eventType === 'NODE_STARTED') {
      const displayControl = this.resolveDisplayControl(event);
      if (!displayControl.showTitle) {
        return undefined;
      }
      const desc = this.resolveNodeDescription(event);
      if (desc === undefined) {
        return undefined;
      }
      return this.buildStructuredEvent(event, this.titleLevel(), 'TEXT', desc);
    }
    if (event.eventType === 'NODE_COMPLETED') {
      const displayControl = this.resolveDisplayControl(event);
      if (!displayControl.showContent) {
        return undefined;
      }
      const stepId = workflowStepId(event);
      // output_parser-driven display (data, message_level) takes precedence
      // over streamed content. When output_parser has explicit data (e.g. PIU),
      // the structured delta must carry that data with the correct messageType,
      // not the streamed text fragment.
      const llmContent = this.llmVisibleContent.get(stepId);
      const isAnswer = this.answerNodeId !== undefined && event.nodeId === this.answerNodeId;
      if (displayControl.displayData !== undefined || displayControl.messageLevel !== undefined || displayControl.displayType !== undefined) {
        const level =
          displayControl.messageLevel !== undefined
            ? this.mapLevelToScope(displayControl.messageLevel)
            : isAnswer
              ? this.answerLevel()
              : this.detailLevel();
        const messageType = mapDisplayTypeToMessageType(displayControl.displayType);
        const content =
          displayControl.displayData !== undefined
            ? displayControl.displayData
            : llmContent !== undefined && llmContent.length > 0
              ? llmContent
              : this.serializeOutput(event);
        return this.buildStructuredEvent(event, level, messageType, content, displayControl.displayType, displayControl.showAigc);
      }
      const streamed = this.structuredStreamedSteps.get(stepId);
      if (streamed !== undefined) {
        // Streaming fragments are LIVE_ONLY; completion carries the full text
        // that history uses to settle the same product item.
        const content = this.structuredAccumulatedContent.get(stepId) ?? '';
        return this.buildStructuredEvent(event, streamed.level, streamed.messageType, content);
      }
      // Interaction prompt text is carried by USER_INPUT_REQUIRED via the
      // pending input bridge; suppress the structured delta to avoid
      // showing it as an ANSWER or DETAIL.
      if (isUserCheckLevel(event.output)) {
        return undefined;
      }
      const outputDriven = this.tryOutputDrivenDelta(event);
      if (outputDriven !== undefined) {
        return outputDriven;
      }
      // When visible content was streamed via LLM_CONTENT_DELTA, use the
      // accumulated content for the persisted structured delta instead of
      // suppressing it. LLM_CONTENT_DELTA is LIVE_ONLY; this PERSISTED
      // event carries the full text for history replay.
      if (llmContent !== undefined && llmContent.length > 0) {
        return this.buildStructuredEvent(event, isAnswer ? this.answerLevel() : this.detailLevel(), 'TEXT', llmContent);
      }
      return this.buildStructuredEvent(event, isAnswer ? this.answerLevel() : this.detailLevel(), 'TEXT', this.serializeOutput(event));
    }
    return undefined;
  }

  private tryOutputDrivenDelta(event: WorkflowExecutionEvent): RunTimelineEvent | undefined {
    const output = event.output;
    if (output === undefined) {
      return undefined;
    }
    const level = output['level'];
    if (typeof level !== 'string') {
      return undefined;
    }

    const toolEventType = mapToolEventType(level);
    if (toolEventType === undefined) {
      return undefined;
    }
    const rawType = output['type'];
    const toolMessageType = typeof rawType === 'string' ? mapToolMessageType(rawType) : 'TEXT';
    if (toolMessageType === undefined) {
      return undefined;
    }
    let content = (output['content'] ?? output) as JsonValue;
    const stepId = workflowStepId(event);
    // When the same step streamed visible text via LLM_CONTENT_DELTA, use
    // the accumulated content for persistence. LLM_CONTENT_DELTA is
    // LIVE_ONLY and not persisted; this PERSISTED event carries the full
    // text for history replay.
    const llmContent = this.llmVisibleContent.get(stepId);
    if (llmContent !== undefined && llmContent.length > 0) {
      content = llmContent;
    }
    return this.buildStructuredEvent(event, this.mapLevelToScope(toolEventType), toolMessageType, content);
  }

  private buildStructuredEvent(
    event: WorkflowExecutionEvent,
    toolEventType: ToolEventType,
    toolMessageType: ToolMessageType,
    content: JsonValue,
    displayType: string | undefined = undefined,
    showAigc: boolean = false,
  ): RunTimelineEvent {
    const identity = workflowCapabilityIdentity(this.recipe, event);
    const payload: Record<string, unknown> = {
      capabilityId: identity.capabilityId,
      toolCallId: identity.toolCallId,
      toolEventType,
      toolMessageType,
      content,
      accumulated: true,
    };
    if (displayType !== undefined) {
      payload.displayType = displayType;
    }
    if (showAigc) {
      payload.aigc = true;
    }
    return {
      type: 'TOOL_STRUCTURED_DELTA',
      inlinePayload: this.attachWorkflowFields(event, payload as JsonObject, { omitInput: true, omitOutput: true }),
    };
  }

  private serializeOutput(event: WorkflowExecutionEvent): string {
    const output = this.resolveVisibleOutput(event);
    if (Object.keys(output).length === 0) {
      return '';
    }
    const entries = Object.entries(output);
    if (entries.length === 0) {
      return '';
    }
    if (entries.length === 1) {
      return formatOutputValue(entries[0]![1]);
    }
    return entries.map(([, v]) => formatOutputValue(v)).join('\n');
  }

  private mapLevelToScope(level: ToolEventType): ToolEventType {
    if (level === 'FINAL_ANSWER') {
      return 'ANSWER';
    }
    if (this.levelScope !== 'SUB') {
      return level;
    }
    switch (level) {
      case 'TITLE':
        return 'SUB_TITLE';
      case 'DETAIL':
        return 'SUB_DETAIL';
      case 'ANSWER':
        return 'SUB_CONCLUSION';
      default:
        return level;
    }
  }

  private titleLevel(): ToolEventType {
    return this.levelScope === 'SUB' ? 'SUB_TITLE' : 'TITLE';
  }

  private detailLevel(): ToolEventType {
    return this.levelScope === 'SUB' ? 'SUB_DETAIL' : 'DETAIL';
  }

  private answerLevel(): ToolEventType {
    return this.levelScope === 'SUB' ? 'SUB_CONCLUSION' : 'ANSWER';
  }
}

interface WorkflowCapabilityIdentity {
  readonly capabilityKind: 'TOOL' | 'SKILL' | 'WORKFLOW';
  readonly capabilityId: string;
  readonly toolCallId: string;
}

function isCapabilityLikeWorkflowNode(nodeType: WorkflowExecutionEvent['nodeType']): boolean {
  return nodeType === 'TOOL' || nodeType === 'SKILL' || nodeType === 'SUBFLOW' || nodeType === 'RESTFUL';
}

function isVisibleTextWorkflowNode(nodeType: WorkflowExecutionEvent['nodeType']): boolean {
  return nodeType === 'LLM' || nodeType === 'DISPLAY' || nodeType === 'AGENT';
}

function workflowCapabilityIdentity(recipe: RecipeDefinition, event: WorkflowExecutionEvent): WorkflowCapabilityIdentity {
  const node = recipe.flowGraph.nodes[event.nodeId];
  const inputs = node?.inputs;
  const capabilityId =
    event.nodeType === 'TOOL'
      ? (readString(inputs, 'tool_name') ?? event.nodeId)
      : event.nodeType === 'SUBFLOW'
        ? (readString(inputs, 'recipe_name') ?? event.nodeId)
        : event.nodeType === 'RESTFUL'
          ? (readString(inputs, 'api_name') ?? event.nodeId)
          : (readString(inputs, 'skill_name') ?? readString(inputs, 'name') ?? event.nodeId);
  return {
    capabilityKind: event.nodeType === 'TOOL' || event.nodeType === 'RESTFUL' ? 'TOOL' : event.nodeType === 'SUBFLOW' ? 'WORKFLOW' : 'SKILL',
    capabilityId,
    toolCallId: `workflow:${event.executionId}:${event.nodeId}`,
  };
}

function workflowVisibleNodeCapabilityIdentity(recipe: RecipeDefinition, event: WorkflowExecutionEvent): JsonObject {
  if (event.nodeType !== 'AGENT') {
    return {};
  }
  return {
    capabilityKind: 'AGENT',
    capabilityId: readString(recipe.flowGraph.nodes[event.nodeId]?.inputs, 'agent_name') ?? event.nodeId,
  };
}

function workflowNodeCapabilityIdentity(recipe: RecipeDefinition, event: WorkflowExecutionEvent): JsonObject {
  if (isCapabilityLikeWorkflowNode(event.nodeType)) {
    return { ...workflowCapabilityIdentity(recipe, event) };
  }
  return workflowVisibleNodeCapabilityIdentity(recipe, event);
}

function readString(source: RecipeDefinition['flowGraph']['nodes'][string]['inputs'] | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function durationMs(startedAt: Date, completedAt?: Date): number {
  return completedAt === undefined ? 0 : Math.max(0, completedAt.getTime() - startedAt.getTime());
}

function accumulateVisibleText(buffer: Map<string, string>, key: string, fragment: string): string {
  const next = `${buffer.get(key) ?? ''}${fragment}`;
  buffer.set(key, next);
  return next;
}

function workflowStepId(event: WorkflowExecutionEvent): string {
  const nodeIdentity = `workflow:${event.executionId}:${event.nodeId}`;
  return event.nodeExecutionId === undefined ? nodeIdentity : `${nodeIdentity}:${event.nodeExecutionId}`;
}

function isWorkflowNodeTerminalEvent(event: WorkflowExecutionEvent): boolean {
  return event.eventType === 'NODE_COMPLETED' || event.eventType === 'NODE_FAILED' || event.eventType === 'NODE_SKIPPED';
}

function isGatewayWorkflowNode(nodeType: WorkflowExecutionEvent['nodeType']): boolean {
  return nodeType === 'START' || nodeType === 'END' || nodeType === 'CONDITION' || nodeType === 'PARALLEL';
}

function isWorkflowScaffoldNode(nodeType: WorkflowExecutionEvent['nodeType']): boolean {
  return nodeType === 'START' || nodeType === 'END';
}

function mapToolEventType(raw: string): ToolEventType | undefined {
  const upper = raw.toUpperCase();
  return (TOOL_EVENT_TYPES as readonly string[]).includes(upper) ? (upper as ToolEventType) : undefined;
}

function isUserCheckLevel(output?: JsonValue): boolean {
  if (output === undefined || typeof output !== 'object' || Array.isArray(output)) {
    return false;
  }
  const level = (output as Record<string, unknown>)['level'];
  return typeof level === 'string' && level.toLowerCase() === 'user_check';
}

function mapToolMessageType(raw: string): ToolMessageType | undefined {
  const upper = raw.toUpperCase();
  return (TOOL_MESSAGE_TYPES as readonly string[]).includes(upper) ? (upper as ToolMessageType) : undefined;
}

// Walk back from END along the single-predecessor chain and return the first
// non-gateway node. This aligns the parent recipe's answer node with the DSL
// "last non-gateway node output" semantics and matches the sub-recipe answer resolution in
// agent-workflow/nodes/shared.ts (resolveSubRecipeAnswerNodeId). Both functions
// implement the same END-reverse algorithm; they are kept as two copies because
// agent-core cannot depend on agent-workflow (architecture layer rule), and
// agent-contracts does not host pure navigation functions.
export function resolveAnswerNodeId(flowGraph: RecipeDefinition['flowGraph']): string | undefined {
  const entries = Object.entries(flowGraph.nodes);
  const endEntry = entries.find(([, node]) => node.type === 'END');
  if (endEntry === undefined) {
    return undefined;
  }
  const predecessors = new Map<string, string[]>();
  for (const [id, node] of entries) {
    for (const nextId of Object.keys(node.next ?? {})) {
      const list = predecessors.get(nextId);
      if (list === undefined) {
        predecessors.set(nextId, [id]);
      } else {
        list.push(id);
      }
    }
  }
  const visited = new Set<string>();
  let currentId: string | undefined = endEntry[0];
  while (currentId !== undefined && !visited.has(currentId)) {
    visited.add(currentId);
    const node: WorkflowNodeDef | undefined = flowGraph.nodes[currentId];
    if (node === undefined) {
      break;
    }
    if (!isGatewayWorkflowNode(node.type)) {
      return currentId;
    }
    const preds = predecessors.get(currentId);
    currentId = preds !== undefined && preds.length === 1 ? preds[0] : undefined;
  }
  return undefined;
}

function mapDeltaChannelToMessageType(channel: WorkflowVisibleDeltaChannel): ToolMessageType {
  switch (channel) {
    case 'DSL':
      return 'DSL';
    default:
      return 'TEXT';
  }
}

function isTitleLevel(level: string): boolean {
  return level === 'TITLE' || level === 'SUB_TITLE';
}

function isContentLevel(level: string): boolean {
  return level === 'DETAIL' || level === 'ANSWER' || level === 'SUB_DETAIL' || level === 'SUB_CONCLUSION';
}

function formatOutputValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function mapDisplayTypeToMessageType(displayType?: string): ToolMessageType {
  switch (displayType) {
    case 'PIU':
      return 'PIU';
    case 'DSL':
      return 'DSL';
    case 'FILE':
      return 'FILE';
    case 'OPERATOR':
      return 'OPERATOR';
    case 'ACTION':
      return 'ACTION';
    default:
      return 'TEXT';
  }
}
