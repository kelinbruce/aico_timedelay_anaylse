/**
 * Deterministic mock stream event generator.
 * The mock server is a contract exercise harness for agent-web, so the default
 * stream is intentionally stable and long enough to expose rendering issues.
 * The stream terminal event is emitted by data/stream.js, not here.
 */

const StreamEventType = {
  REQUEST_ACCEPTED: 'REQUEST_ACCEPTED',
  LLM_THINKING_DELTA: 'LLM_THINKING_DELTA',
  LLM_CONTENT_DELTA: 'LLM_CONTENT_DELTA',
  TOOL_STRUCTURED_DELTA: 'TOOL_STRUCTURED_DELTA',
  CAPABILITY_STARTED: 'CAPABILITY_STARTED',
  CAPABILITY_RESULT_DELTA: 'CAPABILITY_RESULT_DELTA',
  CAPABILITY_COMPLETED: 'CAPABILITY_COMPLETED',
  ATTACHMENT_ACCEPTED: 'ATTACHMENT_ACCEPTED',
  ATTACHMENT_REJECTED: 'ATTACHMENT_REJECTED',
  DEGRADATION_NOTICE: 'DEGRADATION_NOTICE',
  CONTEXT_COMPACTED: 'CONTEXT_COMPACTED',
  REQUEST_CANCELED: 'REQUEST_CANCELED',
  REQUEST_COMPLETED: 'REQUEST_COMPLETED',
  REQUEST_FAILED: 'REQUEST_FAILED',
  REQUEST_SUPERSEDED: 'REQUEST_SUPERSEDED',
  USER_INPUT_REQUIRED: 'USER_INPUT_REQUIRED',
  USER_INPUT_RECEIVED: 'USER_INPUT_RECEIVED',
  USER_INPUT_TIMEOUT: 'USER_INPUT_TIMEOUT',
  USER_INPUT_CANCELED: 'USER_INPUT_CANCELED',
};

const CONTRACT_WEB_EVENT_TYPES = new Set(Object.values(StreamEventType));
const RESULT_STREAM_EVENT_TYPES = new Set([
  StreamEventType.LLM_THINKING_DELTA,
  StreamEventType.LLM_CONTENT_DELTA,
  StreamEventType.CAPABILITY_RESULT_DELTA,
]);

const VISIBLE_THINKING_SUMMARY = `阶段一：建立可见执行计划
本次请求会先按会话上下文确认目标网络、设备范围和用户希望看到的输出粒度。系统会把用户问题归一为“网络健康诊断 + 风险解释 + 操作建议”，并把需要展示给前端的运行状态限制在安全、可审计、可读的摘要中。

阶段二：确认数据来源
 mock 后端会模拟读取核心交换、汇聚交换、防火墙、DHCP 地址池、告警聚合和链路利用率。这里不会暴露真实 prompt、原始模型输出、文件路径或 provider error，只输出用户可见的诊断状态。

阶段三：规划能力调用
模拟能力调用会覆盖拓扑发现、日志聚合、KPI 统计、配置核查和地址池检查。能力结果较长，并通过 CAPABILITY_RESULT_DELTA 分片投递，确保 agent-web 能把工具过程放入执行详情，而不是混入最终回复正文。

阶段四：准备最终回复
最终回复会包含中文长报告、Markdown 表格、代码块、Mermaid 图、英文诊断段落，以及一段后端观测到的英文 token cadence。默认主线使用累计 delta 快照，英文 cadence 也以累计快照表达，避免偏离 StreamEnvelope 契约。

阶段五：扩大长流覆盖面
本次默认计划会尽量接近一千个 stream event，用于压测前端的增量合并、虚拟滚动、执行详情折叠、终态快照合并和 reconnect cursor 处理。事件数量增加不代表契约增加，只是把同一契约下的内容拆得更细。

阶段六：确认英文空格语义
英文 token 会包含带前导空格的片段，例如 " this"、" is"、" for" 和 " test"。mock 会把这些片段折入逐步增长的累计快照，目的是确认前端不会 trim、不会错误折叠空格，也不会把英文词边界合并坏。`;

const CAPABILITY_RESULT_REPORT = `# Capability Result: network-diagnostic-suite

## 1. Collection Window

- Time range: 2026-06-01 09:00:00 to 2026-06-01 09:15:00
- Tenant scope: local-demo-tenant
- Session scope: current web channel request
- Collection strategy: bounded read, redacted output, no raw credential exposure

## 2. Device Health Summary

| Device | Role | Status | CPU | Memory | Packet Loss | Notes |
|:--|:--|:--|--:|--:|--:|:--|
| Core-SW-01 | Core switch | NORMAL | 42% | 58% | 0.01% | Aggregation links are stable |
| Core-SW-02 | Core switch | NORMAL | 39% | 55% | 0.00% | Standby route is healthy |
| Edge-RTR-02 | Edge router | DEGRADED | 88% | 74% | 0.18% | CPU pressure persisted for 11 minutes |
| FW-01 | Firewall | NORMAL | 51% | 63% | 0.03% | Session table is below threshold |
| Access-SW-02 | Access switch | UNREACHABLE | n/a | n/a | n/a | Last heartbeat was 8 minutes ago |

## 3. Alarm Aggregation

The alarm collector returned 37 raw entries and grouped them into four user-visible buckets. The high priority bucket contains repeated CPU pressure on Edge-RTR-02 and a short unreachable window for Access-SW-02. The medium priority bucket contains DHCP pool pressure for the wireless segment and several link utilization warnings near the office aggregation layer. Informational records include scheduled backup traffic, normal route refreshes, and low-volume policy hits on FW-01.

## 4. KPI Trend Snapshot

| KPI | Baseline | Current | Direction | Interpretation |
|:--|--:|--:|:--|:--|
| Internet egress utilization | 48% | 83% | up | Traffic is close to busy-hour threshold |
| Wireless DHCP usage | 71% | 96% | up | Pool expansion should be prepared |
| Firewall drop ratio | 0.06% | 0.04% | down | No evidence of firewall saturation |
| Core uplink packet loss | 0.02% | 0.01% | stable | Core path is not the primary bottleneck |
| Edge CPU utilization | 55% | 88% | up | Router process investigation is required |

## 5. Safe Findings

1. The edge router is the strongest candidate root cause because CPU pressure, egress utilization, and short control-plane delay spikes overlap in time.
2. Access-SW-02 should be verified physically or through out-of-band management because the mock trace marks it unreachable, but no upstream aggregation failure was observed.
3. Wireless DHCP exhaustion is not the current outage trigger, but it is a near-term capacity risk and should be handled before the next busy hour.
4. The firewall does not show packet-loss growth or session-table saturation, so replacing or rebooting FW-01 is not recommended.

## 6. Bounded Command Output

\`\`\`text
display cpu-usage slot 0
CPU Usage Stat. Cycle: 60 (Second)
CPU Usage            : 88%
Max CPU Usage        : 91%
Task with High Usage : route-refresh, telemetry-export

display interface brief | include up
GE0/0/0       up      up      83% egress utilization
GE0/0/1       up      up      31% egress utilization
GE0/0/2       up      up      12% egress utilization
\`\`\`

## 7. Capability Conclusion

The simulated capability result indicates a degraded but recoverable network condition. The recommended order is: confirm Edge-RTR-02 control-plane load, reduce backup or synchronization traffic on the internet egress path, check Access-SW-02 power or uplink state, and expand Wireless-DHCP after the current incident is stable.

## 8. Additional Contract Observations

The capability output is intentionally verbose so that agent-web has to keep tool output separate from the assistant answer while the stream is still active. The result includes stable toolCallId and invocationId metadata, repeated KPI names, mixed Chinese and English terminology, and several Markdown structures. This helps verify that CAPABILITY_RESULT_DELTA is rendered as process detail, that CAPABILITY_COMPLETED updates the same tool lane, and that terminal history snapshots do not incorrectly duplicate tool text into the final assistant body.`;

const FINAL_ASSISTANT_REPORT = `# 网络诊断联调长回复

## 1. 摘要

本次 mock-server 按照当前 StreamEnvelope 契约生成一条确定性的长流式回复，用于帮助 agent-web 联调真实后端可能出现的长文本、工具结果、Markdown、英文 token、重连 replay 和终态展示问题。诊断结论是：当前网络整体仍可用，但边界路由器 Edge-RTR-02 出现持续 CPU 压力，Access-SW-02 存在短时离线，Wireless-DHCP 地址池已经接近耗尽，需要按优先级处理。

默认主线使用累计 delta 快照。也就是说，模型内部可以一个 token 一个 token 到达后端，但 channel 投影给前端时，每个 LLM_CONTENT_DELTA 都携带当前可见回复的累计全量。这样既能制造高频更新压力，也能保持 replay 时不依赖补齐每一个历史 delta。

## 2. 关键发现

| 编号 | 对象 | 现象 | 影响 | 建议 |
|:--|:--|:--|:--|:--|
| F-01 | Edge-RTR-02 | CPU 持续高于 85%，峰值达到 91% | 可能导致控制面延迟、路由刷新变慢 | 先确认高 CPU 进程，再调整同步窗口 |
| F-02 | Access-SW-02 | 最近 8 分钟无心跳 | 局部接入用户可能离线 | 检查电源、上联端口和维护窗口 |
| F-03 | Wireless-DHCP | 地址池使用率 96% | 新终端可能无法获取地址 | 扩容地址池并回收长期租约 |
| F-04 | FW-01 | 丢包率下降，策略命中正常 | 暂无直接异常 | 不建议重启防火墙 |

## 3. 事件解释

系统首先接受用户请求，然后输出可见执行状态，随后模拟调用网络诊断能力。能力输出会保存在执行详情区域，最终回复只展示面向用户的结论和建议。这个 mock 流故意包含长表格、长段落和代码块，目的是确认前端不会因为 Markdown 还没闭合、表格行正在流式到达、或者内容快速增长而出现错位、重复、滚动跳动或最终状态丢失。

## 4. 推荐处置顺序

1. 在 Edge-RTR-02 上查看高 CPU 任务，优先确认 route-refresh、telemetry-export 或异常日志采集是否在忙时放大。
2. 如果同步任务正在占用出口链路，把数据库同步和大文件备份调整到低峰窗口，避免与业务访问争抢带宽。
3. 对 Access-SW-02 做物理链路和电源检查；如果属于计划维护，需要在会话摘要中标注，避免误判为故障。
4. 为 Wireless-DHCP 准备扩容方案，将可用地址数恢复到至少 20% 以上，并清理长期未释放租约。
5. 继续观察 FW-01，但不要把防火墙作为第一处置点，因为当前证据不支持防火墙饱和。

## 5. Markdown 压力片段

下面的表格和代码块会在流式过程中被拆开，前端需要在未完整到达时仍保持可读，完整到达后再稳定渲染。

| 指标 | 当前值 | 阈值 | 结论 |
|:--|--:|--:|:--|
| Edge CPU | 88% | 85% | 超阈值 |
| Internet egress | 83% | 80% | 接近上限 |
| Wireless DHCP usage | 96% | 90% | 需要扩容 |
| Firewall drop ratio | 0.04% | 1.00% | 正常 |

\`\`\`bash
display cpu-usage slot 0
display interface brief | include GE0/0/0
display ip pool name Wireless-DHCP
display alarm active | include Edge-RTR-02
\`\`\`

\`\`\`mermaid
graph TD
  Internet --> FW01[FW-01]
  FW01 --> Edge[Edge-RTR-02]
  Edge --> Core[Core-SW-01]
  Core --> Agg[Agg-SW-01]
  Agg --> Access[Access-SW-02]
  Core --> Wireless[Wireless-DHCP]
\`\`\`

## 6. English Diagnostic Section

The access network diagnosis indicates that packet pressure is concentrated around the aggregation gateway and the edge router. The firewall path remains healthy, while the DHCP pool for wireless clients is approaching exhaustion. The recommended action is to reduce non-critical synchronization traffic, inspect the routing process on Edge-RTR-02, and expand the wireless address pool before the next peak period.

This English section is intentionally long enough to exercise whitespace preservation, word-boundary merging, and mixed Chinese-English rendering. A common provider stream may produce fragments like " this", " is", " for", and " test", where the leading space is part of the token. The mock channel represents that cadence as cumulative snapshots, so the frontend must preserve those spaces without duplicating text.

## 7. 风险与回滚

- 如果高 CPU 与业务同步流量相关，调整同步窗口的回滚方式是恢复原计划任务时间。
- 如果 Access-SW-02 是计划维护，需要把事件标注为维护状态，不应继续升级为故障。
- 如果 DHCP 扩容引入地址冲突，需要立即回退地址池配置，并清理异常租约。
- 如果后续发现防火墙策略异常，再单独进入策略核查流程，不要在当前证据不足时执行重启。

## 8. 最终结论

当前最可能的主因是 Edge-RTR-02 在忙时承受了过高控制面和出口流量压力；Access-SW-02 离线是并行风险，Wireless-DHCP 地址池耗尽是容量风险。建议先处理边界路由器，再确认接入交换状态，最后扩容地址池并持续观察 24 小时。

## 9. Additional English Token Stress

This final section adds more English material so the cumulative contract stream can approach one thousand events without inventing a new public API. The purpose is to verify that a long response remains stable while the user scrolls, opens process details, switches sessions, and waits for terminal reconciliation. The text repeats realistic operational phrases such as access gateway pressure, aggregation path stability, wireless address exhaustion, rollback readiness, and safe diagnostic redaction.`;

const FAILURE_ASSISTANT_CONTEXT = `# Safe Failure Context

系统已经完成请求接收、上下文校验和基础能力选择，但模拟的模型输出超过安全限制。mock-server 将发布 DEGRADATION_NOTICE，并以 REQUEST_FAILED 终止请求。这个路径用于验证 agent-web 能否展示失败终态、恢复输入区状态，并避免把失败请求误认为已完成。`;

const PROCESS_HANDOFF_EXPLANATION = `已完成基础链路指标采集：核心链路没有持续丢包，但边界路由器负载偏高。基于这些结果，我将继续核查路由收敛记录和高负载时间窗口，确认它是否与用户感知到的时延相吻合。`;

const PROCESS_HANDOFF_FINAL_ANSWER = `## 骨干网络延迟检查结果

基础链路和路由收敛两轮检查均已完成。核心链路未发现持续丢包，主要风险集中在边界路由器忙时负载升高，以及一次短时路由收敛抖动。

建议先核查边界路由器高负载进程并调整非关键同步任务窗口，然后持续观察核心链路时延和路由收敛时间。`;

const PIU_PROCESS_DETAIL_ANSWER = `## 骨干网络链路检查完成

PIU 结构化诊断已生成。核心链路没有持续丢包，边界路由器忙时延迟峰值为 63ms，建议继续观察高负载进程。`;

const PIU_ANSWER_INTRO = `诊断能力已经返回结构化结果，下面先展示可交互的链路诊断卡片：`;

const PIU_ANSWER_FINAL_SUMMARY = `## 模型总结

从诊断卡片和采集数据看，核心链路没有持续丢包，当前主要风险是边界路由器忙时负载偏高，延迟峰值达到 63ms。

建议先核查高负载进程和非关键同步任务，再持续观察忙时延迟趋势。上方 PIU 卡片保留结构化指标，本段文字提供面向用户的结论与行动建议。`;

const NETWORK_DIAGNOSTIC_PIU_CONTENT = {
  piuName: 'network-diagnostic',
  piuVersion: '1.0.0',
  method: 'render',
  data: {
    title: '骨干网络链路诊断',
    latencyMs: 63,
    packetLossPercent: 0.01,
    status: 'DEGRADED',
  },
};

const ENGLISH_CADENCE_TOKENS = [
  '\n\n## Backend-observed English token cadence\n',
  ' The',
  ' access',
  ' network',
  ' diagnosis',
  ' shows',
  ' that',
  ' this',
  ' is',
  ' for',
  ' test',
  ' and',
  ' should',
  ' preserve',
  ' leading',
  ' spaces',
  ' in',
  ' every',
  ' appended',
  ' token.',
  ' If',
  ' the',
  ' frontend',
  ' trims',
  ' these',
  ' fragments,',
  ' the',
  ' final',
  ' English',
  ' sentence',
  ' will',
  ' lose',
  ' natural',
  ' word',
  ' boundaries.',
  '\n\n',
  ' This',
  ' second',
  ' cadence',
  ' paragraph',
  ' intentionally',
  ' arrives',
  ' as',
  ' many',
  ' small',
  ' fragments.',
  ' It',
  ' is',
  ' meant',
  ' to',
  ' make',
  ' live',
  ' rendering',
  ' visibly',
  ' progressive',
  ' while',
  ' the',
  ' main',
  ' contract',
  ' stream',
  ' still',
  ' uses',
  ' cumulative',
  ' snapshots.',
  ' Operators',
  ' should',
  ' be',
  ' able',
  ' to',
  ' watch',
  ' each',
  ' sentence',
  ' grow',
  ' without',
  ' losing',
  ' spaces',
  ' before',
  ' words.',
  ' this',
  ' is',
  ' for',
  ' test',
  ' and',
  ' it',
  ' should',
  ' remain',
  ' readable',
  ' in',
  ' both',
  ' dark',
  ' and',
  ' light',
  ' themes.',
];

const SUPPORTED_ATTACHMENT_MEDIA_TYPES = ['WORD', 'EXCEL', 'PDF', 'MARKDOWN'];
const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;

function firstText(payload, fields) {
  for (const field of fields) {
    const value = payload[field];
    if (typeof value !== 'string') {
      continue;
    }
    if (field === 'delta' ? value.length > 0 : value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function defaultEventText(eventType) {
  switch (eventType) {
    case StreamEventType.REQUEST_ACCEPTED:
      return 'Request accepted';
    case StreamEventType.CAPABILITY_STARTED:
      return 'Capability started';
    case StreamEventType.CAPABILITY_COMPLETED:
      return 'Capability completed';
    case StreamEventType.CAPABILITY_RESULT_DELTA:
      return '';
    case StreamEventType.DEGRADATION_NOTICE:
      return 'Degradation notice';
    case StreamEventType.CONTEXT_COMPACTED:
      return 'Context compacted';
    case StreamEventType.REQUEST_COMPLETED:
      return 'Request completed';
    case StreamEventType.REQUEST_FAILED:
      return 'Request failed';
    case StreamEventType.REQUEST_CANCELED:
      return 'Request canceled';
    default:
      return eventType;
  }
}

function normalizeContractPayload(eventType, payload) {
  if (!CONTRACT_WEB_EVENT_TYPES.has(eventType)) {
    return payload;
  }
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata) ? { ...payload.metadata } : {};
  const usesDelta = typeof payload.delta === 'string';
  if (typeof metadata.accumulated !== 'boolean') {
    metadata.accumulated =
      typeof payload.accumulated === 'boolean' ? payload.accumulated : RESULT_STREAM_EVENT_TYPES.has(eventType) && usesDelta ? false : true;
  }
  return {
    ...payload,
    text:
      (typeof payload.text === 'string' ? payload.text : undefined) ??
      firstText(payload, ['content', 'delta', 'progress', 'result', 'message', 'summary', 'reason', 'uiMessage']) ??
      defaultEventText(eventType),
    contentType:
      typeof payload.contentType === 'string' && payload.contentType.trim()
        ? payload.contentType
        : eventType === StreamEventType.LLM_CONTENT_DELTA
          ? 'MARKDOWN'
          : 'PLAIN_TEXT',
    metadata,
  };
}

function createEnvelope(sessionId, requestId, sequence, eventType, payload, transportHints = ['SSE', 'WS']) {
  const rootMessageId = payload.rootMessageId || requestId;
  const requestContextId = payload.requestContextId || requestId;
  const runId = payload.runId || rootMessageId;
  const normalizedPayload = normalizeContractPayload(eventType, {
    ...payload,
    runId,
    rootMessageId,
    requestContextId,
  });
  delete normalizedPayload.rootMessageId;
  return {
    eventId: payload.eventId || `evt-${requestId}-${sequence}-${eventType.toLowerCase()}`,
    sessionId,
    requestId,
    runId,
    requestContextId,
    sequence,
    eventType,
    timelineEventRef: payload.timelineEventRef || null,
    transportHints,
    payload: normalizedPayload,
    createdAt: Date.now(),
  };
}

function splitTokenLike(text) {
  const matches = text.match(/\s+|[A-Za-z0-9_.:/#-]+|[\u4e00-\u9fff]|[^\sA-Za-z0-9_\u4e00-\u9fff]/gu);
  return matches && matches.length > 0 ? matches : [text];
}

function splitIntoCumulativeSnapshots(text, targetCount) {
  const units = splitTokenLike(text);
  const snapshotCount = Math.max(1, Math.min(targetCount, units.length));
  const snapshots = [];
  for (let index = 1; index <= snapshotCount; index += 1) {
    const end = Math.max(index, Math.round((index * units.length) / snapshotCount));
    const snapshot = units.slice(0, end).join('');
    if (snapshots[snapshots.length - 1] !== snapshot) {
      snapshots.push(snapshot);
    }
  }
  if (snapshots[snapshots.length - 1] !== text) {
    snapshots.push(text);
  }
  return snapshots;
}

function appendCumulativeTextEvents(events, context, eventType, text, options) {
  const snapshots = splitIntoCumulativeSnapshots(text, options.targetCount);
  for (const [index, snapshot] of snapshots.entries()) {
    events.push(
      createEnvelope(context.sessionId, context.requestId, context.nextSequence(), eventType, {
        ...context.identity,
        ...options.payload,
        ...(options.finalLast && index === snapshots.length - 1 ? { final: true } : {}),
        text: snapshot,
        contentType: options.contentType,
        metadata: {
          ...options.metadata,
          accumulated: true,
          ...(options.completeLast && index === snapshots.length - 1 ? { completed: true } : {}),
        },
      }),
    );
  }
}

function appendTokenTextEvents(events, context, eventType, text, options) {
  const tokens = splitTokenLike(text);
  appendRawTokenTextEvents(events, context, eventType, tokens, options);
}

function appendRawTokenTextEvents(events, context, eventType, tokens, options) {
  tokens.forEach((token, index) => {
    events.push(
      createEnvelope(context.sessionId, context.requestId, context.nextSequence(), eventType, {
        ...context.identity,
        delta: token,
        contentType: options.contentType,
        metadata: {
          ...options.metadata,
          accumulated: false,
          tokenIndex: (options.tokenOffset || 0) + index + 1,
        },
      }),
    );
  });
}

function appendEnglishCumulativeCadenceEvents(events, context, baseContent) {
  let cumulativeSuffix = '';
  ENGLISH_CADENCE_TOKENS.forEach((token, index) => {
    cumulativeSuffix += token;
    events.push(
      createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.LLM_CONTENT_DELTA, {
        ...context.identity,
        text: `${baseContent}${cumulativeSuffix}`,
        contentType: 'MARKDOWN',
        metadata: {
          accumulated: true,
          cadenceCase: 'backend-observed-english-token-cumulative',
          tokenIndex: index + 1,
        },
      }),
    );
  });
}

function appendAssistantAnswerEvents(events, context) {
  const answerDeltaMode = context.mockControls.answerDeltaMode || 'cumulative';
  if (answerDeltaMode === 'append-token') {
    appendTokenTextEvents(events, context, StreamEventType.LLM_CONTENT_DELTA, FINAL_ASSISTANT_REPORT, {
      contentType: 'MARKDOWN',
      metadata: {
        actor: 'LLM',
        streamProfile: 'backend-observed-append-token-cadence',
        compatibilityCase: 'backend-observed-english-token-append',
      },
    });
    const tokenOffset = splitTokenLike(FINAL_ASSISTANT_REPORT).length;
    appendRawTokenTextEvents(events, context, StreamEventType.LLM_CONTENT_DELTA, ENGLISH_CADENCE_TOKENS, {
      contentType: 'MARKDOWN',
      tokenOffset,
      metadata: {
        actor: 'LLM',
        streamProfile: 'backend-observed-append-token-cadence',
        compatibilityCase: 'backend-observed-english-token-append',
      },
    });
    return;
  }

  appendCumulativeTextEvents(events, context, StreamEventType.LLM_CONTENT_DELTA, FINAL_ASSISTANT_REPORT, {
    targetCount: 900,
    contentType: 'MARKDOWN',
    metadata: {
      actor: 'LLM',
      streamProfile: 'contract-cumulative-token-cadence',
    },
  });
  appendEnglishCumulativeCadenceEvents(events, context, FINAL_ASSISTANT_REPORT);
}

function appendAttachmentEvents(events, context, attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return;
  }
  const tooMany = attachments.length > MAX_ATTACHMENT_COUNT;
  for (const attachment of attachments) {
    const mediaType = String(attachment.mediaType || '').toUpperCase();
    const sizeBytes = Number(attachment.sizeBytes || 0);
    const rejected = tooMany || sizeBytes > MAX_ATTACHMENT_SIZE_BYTES || (mediaType && !SUPPORTED_ATTACHMENT_MEDIA_TYPES.includes(mediaType));
    const reasonCode = tooMany
      ? 'ATTACHMENT_LIMIT_EXCEEDED'
      : sizeBytes > MAX_ATTACHMENT_SIZE_BYTES
        ? 'ATTACHMENT_TOO_LARGE'
        : 'ATTACHMENT_MEDIA_TYPE_UNSUPPORTED';
    const reasonMessage = tooMany
      ? `附件数量超出限制，最多 ${MAX_ATTACHMENT_COUNT} 个`
      : sizeBytes > MAX_ATTACHMENT_SIZE_BYTES
        ? `文件大小超出限制，最大 ${MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024} MiB`
        : '不支持的文件类型';

    events.push(
      createEnvelope(
        context.sessionId,
        context.requestId,
        context.nextSequence(),
        rejected ? StreamEventType.ATTACHMENT_REJECTED : StreamEventType.ATTACHMENT_ACCEPTED,
        {
          ...context.identity,
          attachmentId: attachment.attachmentId || `att-${context.requestId}`,
          fileName: attachment.fileName,
          mediaType,
          sizeBytes,
          ...(rejected
            ? { code: reasonCode, message: reasonMessage, reason: reasonMessage }
            : { message: `附件 ${attachment.fileName || attachment.attachmentId || 'unknown'} 已接收` }),
        },
      ),
    );
  }
}

function createGenerationContext(sessionId, requestId, options) {
  let seq = 1;
  const rootMessageId = options.rootMessageId || requestId;
  const requestContextId = options.requestContextId || requestId;
  const runId = options.runId || rootMessageId;
  return {
    sessionId,
    requestId,
    identity: {
      runId,
      rootMessageId,
      requestContextId,
    },
    mockControls: options.mockControls || {},
    nextSequence() {
      const value = seq;
      seq += 1;
      return value;
    },
  };
}

function appendCommonOpeningEvents(events, context, attachments) {
  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.REQUEST_ACCEPTED, {
      ...context.identity,
      message: '已开始处理本次契约联调请求',
      attempt: 1,
    }),
  );
  appendAttachmentEvents(events, context, attachments);
  appendCumulativeTextEvents(events, context, StreamEventType.LLM_THINKING_DELTA, VISIBLE_THINKING_SUMMARY, {
    targetCount: 120,
    contentType: 'PLAIN_TEXT',
    completeLast: true,
    metadata: {
      actor: 'LLM',
      visibility: 'user-visible-execution-summary',
    },
  });
}

function appendCapabilityEvents(events, context) {
  const toolCallId = `tool-${context.requestId}-network-diagnostic`;
  const invocationId = `inv-${context.requestId}-network-diagnostic`;

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.CAPABILITY_STARTED, {
      ...context.identity,
      toolCallId,
      capabilityId: 'networkDiagnostic',
      toolName: 'networkDiagnostic',
      message: 'networkDiagnostic started',
      kind: 'TOOL',
      metadata: {
        invocationId,
      },
    }),
  );

  appendCumulativeTextEvents(events, context, StreamEventType.CAPABILITY_RESULT_DELTA, CAPABILITY_RESULT_REPORT, {
    targetCount: 220,
    contentType: 'MARKDOWN',
    payload: {
      invocationId,
      capabilityId: 'networkDiagnostic',
      toolCallId,
      toolName: 'networkDiagnostic',
    },
    metadata: {
      invocationId,
      capabilityId: 'networkDiagnostic',
      toolCallId,
      toolName: 'networkDiagnostic',
    },
  });

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.CAPABILITY_COMPLETED, {
      ...context.identity,
      toolCallId,
      capabilityId: 'networkDiagnostic',
      toolName: 'networkDiagnostic',
      status: 'COMPLETED',
      message: 'networkDiagnostic completed',
      metadata: {
        invocationId,
      },
    }),
  );
}

function appendHandoffCapabilityEvents(events, context, options) {
  const toolCallId = `tool-${context.requestId}-${options.toolSuffix}`;
  const invocationId = `inv-${context.requestId}-${options.toolSuffix}`;

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.CAPABILITY_STARTED, {
      ...context.identity,
      toolCallId,
      capabilityId: options.capabilityId,
      toolName: options.capabilityId,
      message: `${options.capabilityId} started`,
      kind: 'TOOL',
      metadata: { invocationId },
    }),
  );

  appendCumulativeTextEvents(events, context, StreamEventType.CAPABILITY_RESULT_DELTA, options.resultText, {
    targetCount: 6,
    contentType: 'MARKDOWN',
    payload: {
      invocationId,
      capabilityId: options.capabilityId,
      toolCallId,
      toolName: options.capabilityId,
    },
    metadata: {
      invocationId,
      capabilityId: options.capabilityId,
      toolCallId,
      toolName: options.capabilityId,
    },
  });

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.CAPABILITY_COMPLETED, {
      ...context.identity,
      toolCallId,
      capabilityId: options.capabilityId,
      toolName: options.capabilityId,
      status: 'COMPLETED',
      message: `${options.capabilityId} completed`,
      metadata: { invocationId },
    }),
  );
}

function appendPresentationCapability(events, context, options) {
  const toolCallId = `tool-${context.requestId}-${options.toolSuffix}`;
  const invocationId = `inv-${context.requestId}-${options.toolSuffix}`;
  const publicProjection = {
    text: options.detailText || '',
    content: options.detailText || '',
    contentType: 'PLAIN_TEXT',
    resultPresentationLevel: options.resultPresentationLevel,
    ...(options.safeSummary ? { safeSummary: options.safeSummary } : {}),
    ...(options.safeSummaryCode ? { safeSummaryCode: options.safeSummaryCode } : {}),
    ...(options.safeSummaryArgs ? { safeSummaryArgs: options.safeSummaryArgs } : {}),
    ...(options.safeResult ? { safeResult: options.safeResult } : {}),
    ...(options.safeErrorCode ? { safeErrorCode: options.safeErrorCode } : {}),
    ...(options.safeErrorCategory ? { safeErrorCategory: options.safeErrorCategory } : {}),
  };

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.CAPABILITY_STARTED, {
      ...context.identity,
      toolCallId,
      capabilityId: options.capabilityId,
      toolName: options.capabilityId,
      message: `${options.capabilityId} started`,
      kind: 'TOOL',
      metadata: { invocationId },
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.CAPABILITY_RESULT_DELTA, {
      ...context.identity,
      toolCallId,
      capabilityId: options.capabilityId,
      toolName: options.capabilityId,
      status: options.status || 'SUCCEEDED',
      ...publicProjection,
      metadata: { invocationId, accumulated: true },
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.CAPABILITY_COMPLETED, {
      ...context.identity,
      toolCallId,
      capabilityId: options.capabilityId,
      toolName: options.capabilityId,
      status: options.status === 'FAILED' ? 'FAILED' : 'COMPLETED',
      ...publicProjection,
      message: `${options.capabilityId} completed`,
      metadata: { invocationId },
    }),
  );
}

function appendCapabilityPresentationEvents(events, context) {
  const ordinaryDetailText = 'Core-Router-01 latency=18ms packet-loss=0.01%\nEdge-Router-02 latency=63ms packet-loss=0.18%';
  const detailFixture = {
    rawResult: {
      stdout: `SECRET-CAPABILITY-RESULT-MUST-NOT-LEAK\n${'raw-network-output\n'.repeat(300)}`,
      credential: 'SECRET-CAPABILITY-RESULT-MUST-NOT-LEAK',
    },
    publicProjection: {
      detailText: `${ordinaryDetailText}\n...`,
      safeSummary: '命令执行完成，返回了输出。',
    },
  };

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.REQUEST_ACCEPTED, {
      ...context.identity,
      message: '已开始验证工具结果三级展示策略',
      attempt: 1,
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.LLM_THINKING_DELTA, {
      ...context.identity,
      text: '依次验证仅状态、摘要和详情三种工具结果投影，并确认原始敏感字段不会发送到浏览器。',
      contentType: 'PLAIN_TEXT',
      metadata: {
        actor: 'LLM',
        phase: 'capability-presentation',
        accumulated: true,
        completed: true,
      },
    }),
  );

  appendPresentationCapability(events, context, {
    toolSuffix: 'status-only',
    capabilityId: 'CustomNetworkProbe',
    resultPresentationLevel: 'STATUS_ONLY',
  });
  appendPresentationCapability(events, context, {
    toolSuffix: 'summary',
    capabilityId: 'Read',
    resultPresentationLevel: 'SUMMARY',
    safeSummary: 'Read workspace/backbone-latency.csv and returned its content.',
    safeSummaryCode: 'CAPABILITY_RESULT_FILE_READ',
    safeSummaryArgs: { filePath: 'workspace/backbone-latency.csv' },
  });
  appendPresentationCapability(events, context, {
    toolSuffix: 'rag-summary',
    capabilityId: 'Rag',
    resultPresentationLevel: 'SUMMARY',
    safeSummary: 'Retrieved 3 RAG result(s).',
    safeSummaryCode: 'CAPABILITY_RESULT_RAG_RETRIEVAL',
    safeSummaryArgs: { totalCount: 3 },
  });
  appendPresentationCapability(events, context, {
    toolSuffix: 'detail',
    capabilityId: 'Bash',
    resultPresentationLevel: 'DETAIL',
    safeSummary: detailFixture.publicProjection.safeSummary,
    safeSummaryCode: 'CAPABILITY_RESULT_COMMAND_SUCCEEDED_WITH_OUTPUT',
    safeSummaryArgs: { exitCode: 0 },
    detailText: ordinaryDetailText,
    safeResult: {
      kind: 'commandOutput',
      exitCode: 0,
      stdoutPreview: ordinaryDetailText,
      stderrPreview: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  });
  appendPresentationCapability(events, context, {
    toolSuffix: 'detail-truncated',
    capabilityId: 'Bash',
    resultPresentationLevel: 'DETAIL',
    safeSummary: detailFixture.publicProjection.safeSummary,
    safeSummaryCode: 'CAPABILITY_RESULT_COMMAND_SUCCEEDED_WITH_OUTPUT',
    safeSummaryArgs: { exitCode: 0 },
    detailText: detailFixture.publicProjection.detailText,
    safeResult: {
      kind: 'commandOutput',
      exitCode: 0,
      stdoutPreview: detailFixture.publicProjection.detailText,
      stderrPreview: '',
      stdoutTruncated: true,
      stderrTruncated: false,
    },
  });
  appendPresentationCapability(events, context, {
    toolSuffix: 'failure-full-read-required',
    capabilityId: 'Write',
    status: 'FAILED',
    resultPresentationLevel: 'STATUS_ONLY',
    safeErrorCode: 'WRITE_REQUIRES_FULL_READ',
    safeErrorCategory: 'CONFLICT',
    safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_FULL_READ_REQUIRED',
    safeSummaryArgs: {},
  });
  appendPresentationCapability(events, context, {
    toolSuffix: 'failure-platform-unsupported',
    capabilityId: 'Agent',
    status: 'FAILED',
    resultPresentationLevel: 'STATUS_ONLY',
    safeErrorCode: 'PLATFORM_UNSUPPORTED',
    safeErrorCategory: 'UNAVAILABLE',
    safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_PLATFORM_UNSUPPORTED',
    safeSummaryArgs: {},
  });
  appendPresentationCapability(events, context, {
    toolSuffix: 'failure-category-fallback',
    capabilityId: 'CustomConflictProbe',
    status: 'FAILED',
    resultPresentationLevel: 'STATUS_ONLY',
    safeErrorCode: 'UNKNOWN_UPSTREAM_FAILURE',
    safeErrorCategory: 'CONFLICT',
    safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_CONFLICT',
    safeSummaryArgs: {},
  });
  appendPresentationCapability(events, context, {
    toolSuffix: 'failure-generic-fallback',
    capabilityId: 'CustomUnknownProbe',
    status: 'FAILED',
    resultPresentationLevel: 'STATUS_ONLY',
    safeSummaryCode: 'CAPABILITY_RESULT_FAILURE',
    safeSummaryArgs: {},
  });
  appendPresentationCapability(events, context, {
    toolSuffix: 'follow-up-read',
    capabilityId: 'Read',
    resultPresentationLevel: 'SUMMARY',
    safeSummary: 'Read workspace/router-current.cfg and returned its content.',
    safeSummaryCode: 'CAPABILITY_RESULT_FILE_READ',
    safeSummaryArgs: { filePath: 'workspace/router-current.cfg' },
  });

  appendCumulativeTextEvents(
    events,
    context,
    StreamEventType.LLM_CONTENT_DELTA,
    '## 展示策略验证完成\n\n十个工具步骤已依次展示成功结果三级投影、四类事实性失败，以及失败后的真实读取步骤。刷新页面后，执行详情应保持相同效果。',
    {
      targetCount: 6,
      contentType: 'MARKDOWN',
      finalLast: true,
      metadata: { actor: 'LLM', streamProfile: 'capability-presentation-final' },
    },
  );
}

function appendProcessHandoffEvents(events, context) {
  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.REQUEST_ACCEPTED, {
      ...context.identity,
      message: '已开始执行骨干网络延迟检查',
      attempt: 1,
    }),
  );

  appendCumulativeTextEvents(
    events,
    context,
    StreamEventType.LLM_THINKING_DELTA,
    '先采集核心链路时延、丢包和边界设备负载，判断问题是否来自基础链路。',
    {
      targetCount: 8,
      contentType: 'PLAIN_TEXT',
      completeLast: true,
      metadata: { actor: 'LLM', phase: 'link-baseline' },
    },
  );

  appendHandoffCapabilityEvents(events, context, {
    toolSuffix: 'link-metrics',
    capabilityId: 'collectLinkMetrics',
    resultText: '已采集核心链路指标：平均时延 18ms，峰值 63ms，持续丢包率 0.01%，边界路由器 CPU 峰值 89%。',
  });

  appendCumulativeTextEvents(
    events,
    context,
    StreamEventType.LLM_THINKING_DELTA,
    '基础链路没有持续异常，继续把高负载窗口与路由收敛记录进行关联核查。',
    {
      targetCount: 8,
      contentType: 'PLAIN_TEXT',
      completeLast: true,
      metadata: { actor: 'LLM', phase: 'route-convergence' },
    },
  );

  appendCumulativeTextEvents(events, context, StreamEventType.LLM_CONTENT_DELTA, PROCESS_HANDOFF_EXPLANATION, {
    targetCount: 12,
    contentType: 'MARKDOWN',
    completeLast: true,
    payload: {
      stepId: 'process-handoff-route-convergence',
    },
    metadata: {
      actor: 'LLM',
      streamProfile: 'process-handoff-explanation',
    },
  });

  appendHandoffCapabilityEvents(events, context, {
    toolSuffix: 'route-convergence',
    capabilityId: 'analyzeRouteConvergence',
    resultText: '路由收敛核查完成：忙时出现一次 1.8 秒收敛抖动，与边界路由器 CPU 高负载窗口重合。',
  });

  appendCumulativeTextEvents(events, context, StreamEventType.LLM_CONTENT_DELTA, PROCESS_HANDOFF_FINAL_ANSWER, {
    targetCount: 18,
    contentType: 'MARKDOWN',
    finalLast: true,
    metadata: {
      actor: 'LLM',
      streamProfile: 'process-handoff-final',
    },
  });
}

function appendPiuProcessDetailEvents(events, context) {
  const toolCallId = `tool-${context.requestId}-piu-network-diagnostic`;
  const invocationId = `inv-${context.requestId}-piu-network-diagnostic`;

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.REQUEST_ACCEPTED, {
      ...context.identity,
      message: '已开始执行 PIU 骨干网络链路检查',
      attempt: 1,
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.LLM_THINKING_DELTA, {
      ...context.identity,
      text: '先采集骨干链路的时延、丢包和边界设备负载，再生成结构化诊断视图。',
      contentType: 'PLAIN_TEXT',
      metadata: {
        actor: 'LLM',
        phase: 'piu-network-diagnostic',
        accumulated: true,
        completed: true,
      },
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.CAPABILITY_STARTED, {
      ...context.identity,
      toolCallId,
      capabilityId: 'networkDiagnostic',
      toolName: 'networkDiagnostic',
      message: 'networkDiagnostic started',
      kind: 'TOOL',
      metadata: { invocationId },
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.TOOL_STRUCTURED_DELTA, {
      ...context.identity,
      toolCallId,
      capabilityId: 'networkDiagnostic',
      toolEventType: 'TITLE',
      toolMessageType: 'TEXT',
      content: '骨干网络链路诊断',
      metadata: { invocationId, accumulated: true },
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.TOOL_STRUCTURED_DELTA, {
      ...context.identity,
      toolCallId,
      capabilityId: 'networkDiagnostic',
      toolEventType: 'DETAIL',
      toolMessageType: 'PIU',
      content: NETWORK_DIAGNOSTIC_PIU_CONTENT,
      metadata: { invocationId, accumulated: true },
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.CAPABILITY_COMPLETED, {
      ...context.identity,
      toolCallId,
      capabilityId: 'networkDiagnostic',
      toolName: 'networkDiagnostic',
      status: 'COMPLETED',
      message: 'networkDiagnostic completed',
      metadata: { invocationId },
    }),
  );

  appendCumulativeTextEvents(events, context, StreamEventType.LLM_CONTENT_DELTA, PIU_PROCESS_DETAIL_ANSWER, {
    targetCount: 1,
    contentType: 'MARKDOWN',
    metadata: {
      actor: 'LLM',
      streamProfile: 'piu-process-detail-final',
    },
  });
}

function appendPiuAnswerEvents(events, context) {
  const toolCallId = `tool-${context.requestId}-piu-answer`;
  const invocationId = `inv-${context.requestId}-piu-answer`;

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.REQUEST_ACCEPTED, {
      ...context.identity,
      message: '已开始生成 PIU 诊断答案',
      attempt: 1,
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.LLM_THINKING_DELTA, {
      ...context.identity,
      text: '先完成链路指标诊断，再把结构化卡片与模型总结按输出顺序组织到答案区域。',
      contentType: 'PLAIN_TEXT',
      metadata: {
        actor: 'LLM',
        phase: 'piu-answer',
        accumulated: true,
        completed: true,
      },
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.CAPABILITY_STARTED, {
      ...context.identity,
      toolCallId,
      capabilityId: 'networkDiagnostic',
      toolName: 'networkDiagnostic',
      message: 'networkDiagnostic started',
      kind: 'TOOL',
      metadata: { invocationId },
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.TOOL_STRUCTURED_DELTA, {
      ...context.identity,
      toolCallId,
      capabilityId: 'networkDiagnostic',
      toolEventType: 'ANSWER',
      toolMessageType: 'TEXT',
      content: PIU_ANSWER_INTRO,
      metadata: { invocationId, accumulated: true },
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.TOOL_STRUCTURED_DELTA, {
      ...context.identity,
      toolCallId,
      capabilityId: 'networkDiagnostic',
      toolEventType: 'ANSWER',
      toolMessageType: 'PIU',
      content: NETWORK_DIAGNOSTIC_PIU_CONTENT,
      metadata: { invocationId, accumulated: true },
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.CAPABILITY_COMPLETED, {
      ...context.identity,
      toolCallId,
      capabilityId: 'networkDiagnostic',
      toolName: 'networkDiagnostic',
      status: 'COMPLETED',
      message: 'networkDiagnostic completed',
      metadata: { invocationId },
    }),
  );

  appendCumulativeTextEvents(events, context, StreamEventType.LLM_CONTENT_DELTA, PIU_ANSWER_FINAL_SUMMARY, {
    targetCount: 8,
    contentType: 'MARKDOWN',
    metadata: {
      actor: 'LLM',
      streamProfile: 'piu-answer-final-summary',
    },
  });
}

function appendContractSuiteEvents(events, context) {
  appendCapabilityEvents(events, context);

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.DEGRADATION_NOTICE, {
      ...context.identity,
      code: 'OBSERVABILITY_SAMPLE_REDACTED',
      message: '已隐藏原始 provider 诊断细节，仅保留安全摘要。',
      reason: 'SAFE_DIAGNOSTIC_REDACTION',
      metadata: {
        source: 'mock-contract-suite',
      },
    }),
  );

  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.CONTEXT_COMPACTED, {
      ...context.identity,
      reason: 'CONTEXT_WINDOW_POLICY',
      message: '已压缩较早上下文以继续处理当前长回复。',
      compactedCount: 6,
      remainingContextTokens: 3600,
      metadata: {
        trigger: 'mock-long-stream',
      },
    }),
  );

  appendAssistantAnswerEvents(events, context);
}

function appendFailureEvents(events, context) {
  appendCumulativeTextEvents(events, context, StreamEventType.LLM_CONTENT_DELTA, FAILURE_ASSISTANT_CONTEXT, {
    targetCount: 18,
    contentType: 'MARKDOWN',
    metadata: {
      actor: 'LLM',
      streamProfile: 'contract-cumulative-before-safe-failure',
    },
  });
  events.push(
    createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.DEGRADATION_NOTICE, {
      ...context.identity,
      code: 'MODEL_OUTPUT_LIMIT_EXCEEDED',
      message: '模型输出超过安全限制，已停止本次请求。',
      reason: 'SAFE_FAILURE',
      metadata: {
        source: 'mock-contract-suite',
      },
    }),
  );
}

function appendPendingInputEvents(events, context) {
  appendCapabilityEvents(events, context);
  appendCumulativeTextEvents(
    events,
    context,
    StreamEventType.LLM_THINKING_DELTA,
    `需要用户确认
系统已经完成网络诊断前置检查，但模拟风险操作需要用户确认后才能继续。该路径用于验证 agent-web 的 pending input 状态、提交按钮恢复、取消输入和输入请求消息展示。`,
    {
      targetCount: 10,
      contentType: 'PLAIN_TEXT',
      completeLast: true,
      metadata: {
        actor: 'LLM',
        phase: 'pending-input',
      },
    },
  );
}

function resolveMockRequestMode(inputText, mockControls = {}) {
  if (mockControls.requestMode === 'capability-presentation') {
    return 'capability-presentation';
  }
  if (mockControls.requestMode === 'piu-answer') {
    return 'piu-answer';
  }
  if (mockControls.requestMode === 'piu-process-detail') {
    return 'piu-process-detail';
  }
  if (mockControls.requestMode === 'process-handoff') {
    return 'process-handoff';
  }
  const text = String(inputText || '').toLowerCase();
  if (text.includes('mock:fail') || text.includes('测试：失败') || text.includes('测试:失败')) {
    return 'failure';
  }
  if (text.includes('mock:pending') || text.includes('测试：补充输入') || text.includes('测试:补充输入')) {
    return 'pending-input';
  }
  if (text.includes('mock:guard-block') || text.includes('测试：护栏拦截') || text.includes('测试:护栏拦截')) {
    return 'guard-block';
  }
  return 'contract-suite';
}

function resolveMockDelayMs(options, fallback = 8) {
  return Number.isFinite(options.mockControls?.delayMs) ? options.mockControls.delayMs : fallback;
}

function resolveMockTerminalDelayMs(options) {
  return Number.isFinite(options.mockControls?.terminalDelayMs) ? options.mockControls.terminalDelayMs : 0;
}

function resolveMockPauseAfterAnswerDeltas(options) {
  return Number.isFinite(options.mockControls?.pauseAfterAnswerDeltas) ? options.mockControls.pauseAfterAnswerDeltas : null;
}

function resolveMockPauseAfterProcessDeltas(options) {
  return Number.isFinite(options.mockControls?.pauseAfterProcessDeltas) ? options.mockControls.pauseAfterProcessDeltas : null;
}

function resolveMockPauseMs(options) {
  return Number.isFinite(options.mockControls?.pauseMs) ? options.mockControls.pauseMs : 0;
}

function buildMockRequestPlan(sessionId, requestId, options = {}) {
  const mode = resolveMockRequestMode(options.inputText, options.mockControls);
  const events = [];
  const context = createGenerationContext(sessionId, requestId, options);
  const delayMs = resolveMockDelayMs(options);
  const terminalDelayMs = resolveMockTerminalDelayMs(options);
  const pauseAfterAnswerDeltas = resolveMockPauseAfterAnswerDeltas(options);
  const pauseAfterProcessDeltas = resolveMockPauseAfterProcessDeltas(options);
  const pauseMs = resolveMockPauseMs(options);

  if (mode === 'guard-block') {
    // Reproduces the output-guardrail block scenario: stream assistant content,
    // then inject OUTPUT_GUARD_BLOCKED (guard terminal) followed by the runtime
    // terminal REQUEST_COMPLETED. Per openscript `refine-stream-guard-blocked-event`
    // 决策 2 the two terminals coexist independently — this is the exact ordering
    // that exposed the frontend rollback/refusal bug. Minimal opening (no thinking
    // deltas) keeps the scenario fast and deterministic.
    events.push(
      createEnvelope(context.sessionId, context.requestId, context.nextSequence(), StreamEventType.REQUEST_ACCEPTED, {
        ...context.identity,
        message: '已开始处理本次请求',
        attempt: 1,
      }),
    );
    appendCumulativeTextEvents(
      events,
      context,
      StreamEventType.LLM_CONTENT_DELTA,
      '这是一段用于验证「输出 + 回撤」能力的答案。\n\n第一段：正在逐步生成可见内容，便于观察流式输出过程。\n\n第二段：内容中包含敏感信息 SECRET-MUST-NOT-APPEAR-12345，应当被安全护栏识别并拦截。\n\n第三段：拦截发生后，以上已输出的内容必须整体回撤，并替换为拦截话术。\n\n第四段：如果拦截后仍能看到这段文字，说明回撤未生效。',
      {
        targetCount: 10,
        contentType: 'MARKDOWN',
        metadata: { actor: 'LLM' },
      },
    );
    events.push(
      createEnvelope(context.sessionId, context.requestId, context.nextSequence(), 'OUTPUT_GUARD_BLOCKED', {
        ...context.identity,
        guardReason: 'OUTPUT_VIOLATION',
        phase: 'OUTPUT_GUARD',
        refusalMessage: '抱歉，该回答已被安全护栏拦截，无法展示。',
      }),
    );
    return {
      mode,
      events,
      terminalEventType: StreamEventType.REQUEST_COMPLETED,
      terminalPayload: {
        message: 'Request completed',
        summary: 'Request completed',
      },
      delayMs: delayMs ?? 80,
      terminalDelayMs: terminalDelayMs ?? 400,
      pauseAfterAnswerDeltas,
      pauseAfterProcessDeltas,
      pauseMs,
    };
  }

  if (mode === 'process-handoff') {
    appendProcessHandoffEvents(events, context);
    return {
      mode,
      events,
      terminalEventType: StreamEventType.REQUEST_COMPLETED,
      terminalPayload: {
        message: 'Process handoff completed',
        summary: 'Process handoff completed',
      },
      delayMs,
      terminalDelayMs,
      pauseAfterAnswerDeltas,
      pauseAfterProcessDeltas,
      pauseMs,
    };
  }

  if (mode === 'capability-presentation') {
    appendCapabilityPresentationEvents(events, context);
    return {
      mode,
      events,
      terminalEventType: StreamEventType.REQUEST_COMPLETED,
      terminalPayload: {
        message: 'Capability presentation verification completed',
        summary: 'Capability presentation verification completed',
      },
      delayMs,
      terminalDelayMs,
      pauseAfterAnswerDeltas,
      pauseAfterProcessDeltas,
      pauseMs,
    };
  }

  if (mode === 'piu-process-detail') {
    appendPiuProcessDetailEvents(events, context);
    return {
      mode,
      events,
      terminalEventType: StreamEventType.REQUEST_COMPLETED,
      terminalPayload: {
        message: 'PIU process detail completed',
        summary: 'PIU process detail completed',
      },
      delayMs,
      terminalDelayMs,
      pauseAfterAnswerDeltas,
      pauseAfterProcessDeltas,
      pauseMs,
    };
  }

  if (mode === 'piu-answer') {
    appendPiuAnswerEvents(events, context);
    return {
      mode,
      events,
      terminalEventType: StreamEventType.REQUEST_COMPLETED,
      terminalPayload: {
        message: 'PIU answer completed',
        summary: 'PIU answer completed',
      },
      delayMs,
      terminalDelayMs,
      pauseAfterAnswerDeltas,
      pauseAfterProcessDeltas,
      pauseMs,
    };
  }

  appendCommonOpeningEvents(events, context, options.attachments);

  if (mode === 'failure') {
    appendFailureEvents(events, context);
    return {
      mode,
      events,
      terminalEventType: StreamEventType.REQUEST_FAILED,
      terminalPayload: {
        message: 'Request failed safely',
        summary: 'Request failed safely',
        reason: 'MODEL_OUTPUT_LIMIT_EXCEEDED',
      },
      delayMs,
      terminalDelayMs,
      pauseAfterAnswerDeltas,
      pauseAfterProcessDeltas,
      pauseMs,
    };
  }

  if (mode === 'pending-input') {
    appendPendingInputEvents(events, context);
    return {
      mode,
      events,
      autoTerminal: false,
      pendingInput: {
        inputKind: 'CONFIRMATION',
        prompt: '检测到模拟高风险操作，是否继续执行边界路由器流量调度建议？',
        options: [
          { id: 'confirm', label: '继续执行' },
          { id: 'deny', label: '暂不执行' },
        ],
        riskLevel: 'MEDIUM',
      },
      delayMs,
      terminalDelayMs,
      pauseAfterAnswerDeltas,
      pauseAfterProcessDeltas,
      pauseMs,
    };
  }

  appendContractSuiteEvents(events, context);
  return {
    mode,
    events,
    terminalEventType: StreamEventType.REQUEST_COMPLETED,
    terminalPayload: {
      message: 'Contract suite completed',
      summary: 'Contract suite completed',
    },
    delayMs,
    terminalDelayMs,
    pauseAfterAnswerDeltas,
    pauseAfterProcessDeltas,
    pauseMs,
  };
}

module.exports = {
  buildMockRequestPlan,
  resolveMockRequestMode,
  StreamEventType,
};
