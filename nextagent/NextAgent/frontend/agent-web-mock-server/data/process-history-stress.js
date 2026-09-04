const PROCESS_HISTORY_STRESS_SESSION_ID = 'session-process-history-stress-200';
const PROCESS_HISTORY_STRESS_TURN_COUNT = 200;
const PROCESS_HISTORY_CAPACITY_TURN_COUNT = 10_000;

const THINKING_STAGES = ['规划诊断路径并确认本轮检查边界', '关联接口、路由与遥测证据，排除瞬时噪声', '复核结论、风险级别和建议动作'];

const TOOL_DEFINITIONS = [
  { name: 'interfaceAudit', label: '接口状态检查' },
  { name: 'routePolicyAudit', label: '路由策略检查' },
  { name: 'telemetryCorrelation', label: '遥测关联检查' },
];

function buildUserMessage(common, ordinal, createdAt) {
  return {
    ...common,
    messageId: common.rootMessageId,
    role: 'USER',
    sequence: (ordinal - 1) * 5 + 1,
    content: `第 ${ordinal} 轮：检查骨干网络节点配置、接口、路由策略和遥测指标是否一致。`,
    contentType: 'PLAIN_TEXT',
    metadata: {
      status: 'COMPLETED',
      requestContextId: common.requestContextId,
    },
    createdAt,
    visible: true,
  };
}

function buildCapabilityResult(common, ordinal, toolIndex, createdAt, detailRepeat) {
  const tool = TOOL_DEFINITIONS[toolIndex - 1];
  const toolCallId = `tool-${toolIndex}-stress-${ordinal}`;
  return {
    ...common,
    messageId: `capability-${toolIndex}-stress-${ordinal}`,
    role: 'CAPABILITY_RESULT',
    sequence: (ordinal - 1) * 5 + toolIndex + 1,
    content:
      `${tool.label}完成。第 ${ordinal} 轮证据显示关键对象状态稳定，采样结果、阈值判断和关联坐标均已保留，用于展开工具卡片时验证大内容投影。`.repeat(
        detailRepeat,
      ),
    contentType: 'PLAIN_TEXT',
    metadata: {
      kind: 'CAPABILITY_RESULT',
      toolCallId,
      toolName: tool.name,
      status: 'COMPLETED',
    },
    createdAt,
    visible: true,
  };
}

function buildAssistantMessage(common, ordinal, createdAt) {
  return {
    ...common,
    messageId: `assistant-stress-${ordinal}`,
    role: 'ASSISTANT',
    sequence: (ordinal - 1) * 5 + 5,
    content:
      `## 第 ${ordinal} 轮诊断结论\n\n接口、路由策略和遥测证据已经完成交叉验证。本轮未发现阻断性异常；建议继续观察关键链路利用率、路由收敛时间和告警关联结果。\n\n`.repeat(
        3,
      ),
    contentType: 'MARKDOWN',
    metadata: {},
    createdAt,
    visible: true,
  };
}

function buildPreviewMarker(common, ordinal, createdAt) {
  return {
    messageId: common.rootMessageId,
    requestId: common.requestId,
    createdAt,
    previewText: `第 ${ordinal} 轮网络诊断问题`,
    previewTruncated: false,
    answerPreviewText: `第 ${ordinal} 轮诊断结论`,
    answerPreviewTruncated: false,
  };
}

function buildRunEvents(common, ordinal, createdAt, toolCount, detailRepeat) {
  const events = [];
  for (let stageIndex = 1; stageIndex <= toolCount; stageIndex += 1) {
    const tool = TOOL_DEFINITIONS[stageIndex - 1];
    const toolCallId = `tool-${stageIndex}-stress-${ordinal}`;
    const thinkingSequence = (stageIndex - 1) * 3 + 1;
    events.push({
      ...common,
      eventId: `thinking-${stageIndex}-stress-${ordinal}`,
      sequence: thinkingSequence,
      eventType: 'LLM_THINKING_DELTA',
      timelineEventRef: `timeline-thinking-${stageIndex}-stress-${ordinal}`,
      payload: {
        text: `${THINKING_STAGES[stageIndex - 1]}。第 ${ordinal} 轮需要保持 session、request、root message 和 run 坐标一致，并核对历史加载不会跨轮污染。`.repeat(
          detailRepeat,
        ),
        contentType: 'PLAIN_TEXT',
        metadata: { accumulated: true, completed: true },
      },
      transportHints: [],
      createdAt,
    });
    events.push({
      ...common,
      eventId: `tool-${stageIndex}-start-stress-${ordinal}`,
      sequence: thinkingSequence + 1,
      eventType: 'CAPABILITY_STARTED',
      timelineEventRef: `timeline-tool-${stageIndex}-start-stress-${ordinal}`,
      payload: {
        capabilityId: tool.name,
        toolCallId,
        toolName: tool.name,
      },
      transportHints: [],
      createdAt,
    });
    events.push({
      ...common,
      eventId: `tool-${stageIndex}-complete-stress-${ordinal}`,
      sequence: thinkingSequence + 2,
      eventType: 'CAPABILITY_COMPLETED',
      timelineEventRef: `timeline-tool-${stageIndex}-complete-stress-${ordinal}`,
      payload: {
        capabilityId: tool.name,
        toolCallId,
        toolName: tool.name,
        status: 'SUCCEEDED',
      },
      transportHints: [],
      createdAt,
    });
  }
  return events;
}

function buildProcessHistoryFixture(options = {}) {
  const sessionId = PROCESS_HISTORY_STRESS_SESSION_ID;
  const turnCount = options.turnCount ?? PROCESS_HISTORY_STRESS_TURN_COUNT;
  const toolCount = options.toolCount ?? 3;
  const detailRepeat = options.detailRepeat ?? 4;
  const conversationItems = [];
  const previewMarkers = [];
  const eventsByRun = {};

  for (let index = 0; index < turnCount; index += 1) {
    const ordinal = index + 1;
    const rootMessageId = `root-stress-${ordinal}`;
    const requestId = `request-stress-${ordinal}`;
    const requestContextId = `context-stress-${ordinal}`;
    const runId = `run-stress-${ordinal}`;
    const createdAt = new Date(Date.UTC(2026, 6, 27, 0, index, 0)).toISOString();
    const common = {
      sessionId,
      requestId,
      requestContextId,
      rootMessageId,
      runId,
    };

    conversationItems.push(buildUserMessage(common, ordinal, createdAt));
    for (let toolIndex = 1; toolIndex <= toolCount; toolIndex += 1) {
      conversationItems.push(buildCapabilityResult(common, ordinal, toolIndex, createdAt, detailRepeat));
    }
    conversationItems.push(buildAssistantMessage(common, ordinal, createdAt));
    previewMarkers.push(buildPreviewMarker(common, ordinal, createdAt));
    eventsByRun[runId] = buildRunEvents(common, ordinal, createdAt, toolCount, detailRepeat);
  }

  return {
    session: {
      sessionId,
      displayTitle: `${turnCount}轮复杂网络诊断历史`,
      lastMessagePreview: `第 ${turnCount} 轮网络诊断结论`,
      lastRunStatus: 'COMPLETED',
      lastActivityAt: Date.parse('2026-07-27T03:20:00.000Z'),
      hasInFlightRequest: false,
    },
    detail: {
      sessionId,
      deploymentMode: 'LOCAL',
      channel: 'WEB',
      locale: 'zh-CN',
      status: 'COMPLETED',
      activeRequestId: null,
      activeRequestContextId: null,
      lastCompletedRequestId: `request-stress-${turnCount}`,
      lastCompletedRequestContextId: `context-stress-${turnCount}`,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T03:20:00.000Z',
    },
    conversation: {
      sessionId,
      items: conversationItems,
      nextCursor: null,
    },
    previewMarkers,
    eventsByRun,
  };
}

function buildProcessHistoryStressFixture() {
  return buildProcessHistoryFixture();
}

function buildProcessHistoryCapacityFixture() {
  return buildProcessHistoryFixture({
    turnCount: PROCESS_HISTORY_CAPACITY_TURN_COUNT,
    toolCount: 2,
    detailRepeat: 1,
  });
}

module.exports = {
  PROCESS_HISTORY_CAPACITY_TURN_COUNT,
  PROCESS_HISTORY_STRESS_SESSION_ID,
  PROCESS_HISTORY_STRESS_TURN_COUNT,
  buildProcessHistoryCapacityFixture,
  buildProcessHistoryStressFixture,
};
