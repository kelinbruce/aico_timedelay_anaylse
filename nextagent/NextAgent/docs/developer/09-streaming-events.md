# 流式事件

这一篇讲 NextAgent 的流式事件协议：SSE/WebSocket 两种传输、`StreamEnvelope` 结构、事件类型，以及断线后怎么重连续传。

## 传输方式

NextAgent 同时支持 SSE 与 WebSocket 两种等价流式传输。transport 选择由 **后端 bootstrap projection** 决定，不由 client 配置：

```bash
GET /api/v1/runtime/bootstrap
→ {"transportKind":"SSE"}    # 或 "WEBSOCKET"
```

| 方式 | 路径 | 帧格式 |
|------|------|--------|
| SSE | `GET /api/v1/sessions/{sessionId}/stream` | `text/event-stream`，每条 `event: <eventType>\ndata: <StreamEnvelope JSON>\n\n` |
| WebSocket | `ws://host/api/v1/sessions/{sessionId}/ws` | 每个 text frame 是一个 `StreamEnvelope` JSON |

`transportKind` 从 trusted app/channel configuration 派生，MUST NOT 从 client query、request body、localStorage、build-time env、model output 或 user metadata 派生（见 `ts-web-sse-ws-transports` spec）。两种 transport 的 resume 语义等价。

### 查询参数

SSE 与 WebSocket 都支持：

| 参数 | 描述 |
|------|------|
| `lastSeenSequence` | 已消费的最后 sequence（非负整数），用于断点续传；省略时为无游标 live-tail |
| `requestId` | 限定请求 ID（scoped bounded replay） |
| `runId` | 限定运行 ID（scoped bounded replay） |

`lastSeenSequence` 必须匹配 `^(0|[1-9][0-9]*)$`，否则返回 `STREAM_REPLAY_ANCHOR_INVALID`。

## 双层事件模型

NextAgent 使用**双层事件模型**：runtime 拥有 timeline 事实，channel 只做 projection。

```
运行时层 (Runtime)                      传输层 (Channel / agent-channel-web)
─────────────────────                  ─────────────────────────────────────
RunTimelineEvent                       StreamEnvelope
  (运行时内部 durable fact)              (客户端可见 wire projection)
        │                                     │
TimelineEventType                      StreamEventType
        └───────── 投影 / redaction ──────────┘
```

### RunTimelineEvent（运行时内部）

`RunTimelineEvent`（`packages/agent-contracts/src/runtime`）：

```typescript
interface RunTimelineEvent {
  eventId?: string;
  tenantId?: TenantId;
  subjectId?: SubjectId;
  sessionId?: SessionId;
  runId?: RequestRunId;
  requestId?: MessageId;
  requestContextId?: RequestContextId;
  agentId?: AgentId;
  agentVersion?: AgentVersion;
  persistence?: "PERSISTED" | "LIVE_ONLY";
  sequence?: TimelineSequence;
  type: TimelineEventType;
  inlinePayload: JsonObject;
  contentRef?: string;
  createdAt?: Date;
}
```

### StreamEnvelope（客户端可见）

`StreamEnvelope`（`packages/agent-contracts/src/channel`）：

```typescript
interface StreamEnvelope {
  eventId: string;
  sessionId: SessionId;
  requestId: MessageId;
  runId?: RequestRunId;
  requestContextId?: RequestContextId;
  sequence: TimelineSequence;
  eventType: StreamEventType;
  timelineEventRef?: string;        // 仅作追溯引用，不授予 raw payload 权限
  transportHints: readonly string[];
  payload: JsonObject;               // channel-safe projection，已 redaction
  createdAt: EpochMillis;            // epoch milliseconds
}
```

> `StreamEnvelope` 是 wire projection，**不是** durable execution fact。拥有 `timelineEventRef` 不等于获得 raw timeline payload / raw model output / raw tool result 权限。

## 事件类型速查

### StreamEventType（canonical vocabulary）

`StreamEventType`（`packages/agent-contracts/src/channel`）共 23 个，是 user-visible vocabulary：

```typescript
type StreamEventType =
  | "REQUEST_ACCEPTED"
  | "LLM_THINKING_DELTA"
  | "LLM_CONTENT_DELTA"
  | "CAPABILITY_STARTED"
  | "CAPABILITY_RESULT_DELTA"
  | "CAPABILITY_COMPLETED"
  | "TOOL_STRUCTURED_DELTA"
  | "DEGRADATION_NOTICE"
  | "REQUEST_COMPLETED"
  | "REQUEST_FAILED"
  | "REQUEST_CANCELED"
  | "REQUEST_SUPERSEDED"
  | "USER_INPUT_REQUIRED"
  | "USER_INPUT_RECEIVED"
  | "USER_INPUT_TIMEOUT"
  | "USER_INPUT_CANCELED"
  | "ATTACHMENT_ACCEPTED"
  | "ATTACHMENT_REJECTED"
  | "CONTEXT_COMPACTED"
  | "BACKGROUND_TASK_STARTED"
  | "BACKGROUND_TASK_COMPLETED"
  | "BACKGROUND_TASK_FAILED"
  | "OUTPUT_GUARD_BLOCKED";
```

客户端必须**容忍未知事件类型**（向前兼容）：不要因为收到本表之外的事件而断连或抛错。`TOOL_STRUCTURED_DELTA` 承载 Tool 结构化产物（如 workflow 产出、流式结构化块）；`OUTPUT_GUARD_BLOCKED` 表示输出护栏拦截了本轮回答。

deprecated 名称（`THINKING_SUMMARY`、`CONTENT_DELTA`、`CAPABILITY_PROGRESS`、`CAPABILITY_FINISHED`、`CAPABILITY_DISCOVERED`）被视为 projection contract violation，MUST NOT 发送给客户端。

### TimelineEventType（运行时内部，更全）

`TimelineEventType`（`packages/agent-common`）除上述 stream 事件外还包含只存在于 timeline 的 `PLANNING_STARTED`、`MODEL_INVOCATION_STARTED`、`MODEL_INVOCATION_COMPLETED`、`MODEL_INVOCATION_FAILED`、`POLICY_APPLIED`、`HOOK_INVOKED`。这些 **不进入** 首版 stream projection（`HOOK_INVOKED`、`POLICY_APPLIED` 明确不输出）。

### 按分类速查

**请求生命周期**

| 事件 | 说明 |
|------|------|
| `REQUEST_ACCEPTED` | 请求已被 runtime 接受 |
| `REQUEST_COMPLETED` | 请求成功完成（terminal） |
| `REQUEST_FAILED` | 请求执行失败（terminal） |
| `REQUEST_CANCELED` | 请求被取消（terminal） |
| `REQUEST_SUPERSEDED` | 请求被重试/编辑替换（terminal） |

> Web channel MUST NOT 因 stream close、client disconnect、empty output 或 transport success 而合成 `REQUEST_COMPLETED`。

**模型输出**

| 事件 | 说明 | payload 关键字段 |
|------|------|------------------|
| `LLM_THINKING_DELTA` | 模型思考过程增量 | `reasoning` / `content` / `text`、`contentType=PLAIN_TEXT` |
| `LLM_CONTENT_DELTA` | 模型输出内容增量 | `content` / `text`、`contentType=MARKDOWN`、`role` |

**能力调用**

| 事件 | 说明 | payload 关键字段 |
|------|------|------------------|
| `CAPABILITY_STARTED` | 能力调用开始 | `capabilityId`、`toolCallId`、`status` |
| `CAPABILITY_RESULT_DELTA` | 能力结果增量 | `text`/`content`、`safeResult`、`safeSummary`、`safeErrorCode` |
| `CAPABILITY_COMPLETED` | 能力调用完成 | `capabilityId`、`status`、可选 `safeErrorCode`/`safeErrorCategory` |

**用户交互**

| 事件 | 说明 |
|------|------|
| `USER_INPUT_REQUIRED` | 需要用户输入（run 阻塞） |
| `USER_INPUT_RECEIVED` | 已收到用户输入 |
| `USER_INPUT_TIMEOUT` | 用户输入超时 |
| `USER_INPUT_CANCELED` | 用户输入被取消 |

**系统**

| 事件 | 说明 |
|------|------|
| `DEGRADATION_NOTICE` | 降级通知（含 `code`/`message`/`category`/`reasonCode`） |
| `ATTACHMENT_ACCEPTED` | 附件已接受 |
| `ATTACHMENT_REJECTED` | 附件被拒绝 |
| `CONTEXT_COMPACTED` | 上下文已压缩（含 `summaryMessageId`、`tokenEstimate`） |
| `TOOL_STRUCTURED_DELTA` | Tool 结构化产物增量（workflow 产出、流式结构化块） |
| `BACKGROUND_TASK_STARTED` / `BACKGROUND_TASK_COMPLETED` / `BACKGROUND_TASK_FAILED` | 后台任务生命周期 |
| `OUTPUT_GUARD_BLOCKED` | 输出护栏拦截（terminal） |

## USER_INPUT_REQUIRED 事件详细

### 触发场景（PendingInputKind）

| kind | 含义 |
|------|------|
| `QUESTION` | 模型/能力需要用户回答问题 |
| `CONFIRMATION` | 继续执行前需要确认意图 |
| `AUTHORIZATION` | 受限操作需要授权 |
| `HUMAN_HANDOFF` | 转人工接管 |

> 真实枚举是 `QUESTION` / `CONFIRMATION` / `AUTHORIZATION` / `HUMAN_HANDOFF`，不是旧文档的 `CLARIFICATION` / `APPROVAL` / `SELECTION`。

### payload 示例

projection（`packages/agent-channel-web/src/projections/stream-envelope.ts`）从 `inlinePayload` 提取 channel-safe 字段：

```json
{
  "rootMessageId": "req_1",
  "requestId": "req_1",
  "runId": "run_1",
  "pendingInputId": "pending_1",
  "kind": "CONFIRMATION",
  "status": "PENDING",
  "timeoutAt": 1719878460000,
  "questions": [
    {
      "prompt": "是否继续执行此高风险操作？",
      "options": [
        {"label": "继续", "value": "yes"},
        {"label": "取消", "value": "no"}
      ],
      "multiple": false,
      "custom": false
    }
  ],
  "metadata": {"accumulated": true}
}
```

前端通过 `POST /api/v1/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer` 回答，`answers` 为非空二维字符串数组（每个内层数组对应一个 question 的回答）。

## 事件持久化策略

`RunTimelineEvent.persistence` 区分（权威来源 `packages/agent-runtime/src/timeline/event-persistence-policy.ts`）：

| 类别 | 策略 | 说明 |
|------|------|------|
| 终态 / `REQUEST_ACCEPTED` / `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` / `USER_INPUT_*` / `ATTACHMENT_*` / `CONTEXT_COMPACTED` / `DEGRADATION_NOTICE` | `PERSISTED` | 落盘保留，用于重连回放与审计 |
| streaming `LLM_THINKING_DELTA`（thinking 增量）/ streaming `LLM_CONTENT_DELTA`（内容增量）/ 无 capability 归属的 `CAPABILITY_RESULT_DELTA` / 未限定形态的 `TOOL_STRUCTURED_DELTA` | `LIVE_ONLY` | 仅内存缓冲，用于活跃重连 |
| final thinking payload（`LLM_THINKING_DELTA`）/ completed content reference（`LLM_CONTENT_DELTA`）/ qualified workflow product 与 `streaming=true` 的 `TOOL_STRUCTURED_DELTA` | `PERSISTED` | 最终形态会落盘，供 `GET /sessions/{sessionId}/runs/{runId}/events` 历史回放 |

> 持久化事件可通过 `GET /api/v1/sessions/{sessionId}/runs/{runId}/events` 查询（外部客户端断线后补历史的手段之一）。实时增量事件只保留在内存中用于活跃重连。历史对话应通过 `GET /sessions/{sessionId}/conversation` 查询 `SessionMessage`，不依赖事件全量回放。

## 重连与恢复语义

见 `ts-stream-resume-replay`、`ts-stream-history-consistency` spec：

- **无游标 live-tail**：省略 `lastSeenSequence`，连接只接收连接之后产生的 live 事件（不回放历史）。
- **`lastSeenSequence=0` replay**：从 sequence 0 开始 bounded replay，常用于 activeRun 恢复。
- **requestId / runId scoped bounded replay**：限定单个 request 或 run 的有界回放。
- **同页面重连**：`lastSeenSequence` 是 in-memory、session-scoped cursor，仅当前页面生命周期内有效。页面未接受过 timeline-backed envelope 时不发送 `lastSeenSequence=0` 作为替代。
- **ActiveRun bootstrap replay**：会话 bootstrap 返回非终态 `activeRun {requestId, runId, status}` 时，前端以 `requestId`+`runId`+`lastSeenSequence=0` 打开 run-scoped stream 恢复进行中的 run。
- **Gap recovery**：检测到 gap 时先刷新 `conversation` 历史，成功后才用 `lastSeenSequence=resumeAfterSequence` 重连。
- **跨页面/新设备**：不持久化 cursor，通过 activeRun bootstrap 恢复。
- SSE 与 WebSocket 的 resume 输入等价（`sessionId`、可选 `lastSeenSequence`、可选 `requestId`、可选 `runId`）。

## SSE 使用示例

### 连接并消费事件

```javascript
const eventSource = new EventSource(
  `http://127.0.0.1:3000/api/v1/sessions/${sessionId}/stream`,
  { withCredentials: true } // 携带 nextagent_local_auth Cookie
);

eventSource.addEventListener("LLM_CONTENT_DELTA", (event) => {
  const data = JSON.parse(event.data);
  console.log(data.payload.content); // 增量文本
});

eventSource.addEventListener("REQUEST_COMPLETED", (event) => {
  const data = JSON.parse(event.data);
  console.log("请求完成", data.payload.status);
  eventSource.close();
});

eventSource.addEventListener("USER_INPUT_REQUIRED", (event) => {
  const data = JSON.parse(event.data);
  // 展示 data.payload.questions，收集 answers 后调用 /pending-inputs/{pendingInputId}/answer
});
```

SSE 连接打开时先发送 `: stream-open` comment frame，随后每条事件为 `event: <eventType>\ndata: <StreamEnvelope JSON>\n\n`。

### 同页面重连恢复

```javascript
// 记住已消费的最后 sequence（仅内存）
let lastSequence = 0;
eventSource.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  lastSequence = data.sequence;
});

// 重连时传入 lastSeenSequence
const resumed = new EventSource(
  `http://127.0.0.1:3000/api/v1/sessions/${sessionId}/stream?lastSeenSequence=${lastSequence}`,
  { withCredentials: true }
);
```

若重连缓冲区可连续回放，客户端继续接收增量；若无法回放，客户端应刷新 `conversation` 历史。

### curl 示例

```bash
curl -N "http://127.0.0.1:3000/api/v1/sessions/sess_123/stream?lastSeenSequence=11&requestId=req_1" \
  -b cookies.txt
```

## 事件所有权规则

`RunTimelineEvent` 的所有权按组件划分，`agent-channel-web` **不发射**域事件，只做 projection：

| 组件 | 拥有的 timeline 事件 |
|------|----------------------|
| `agent-runtime` | `REQUEST_ACCEPTED`、`REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED`、`DEGRADATION_NOTICE`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED`、`ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED` |
| `agent-core` / Model-driven agent | `PLANNING_STARTED` 等业务决策事件（timeline-only） |
| `agent-model` | `LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`MODEL_INVOCATION_*`（timeline-only） |
| `SkillExecutor` / `ToolExecutor` / `InvokedAgentExecutor` | `CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED`、`USER_INPUT_REQUIRED` |
| `agent-context-engine` | `CONTEXT_COMPACTED`（经 runtime 提交） |
| `agent-channel-web` | **不发射域事件**，只把 `RunTimelineEvent` → `StreamEnvelope` projection |

### Projection 决策顺序

见 `ts-run-status-visibility` spec：

1. 校验 trusted identity 与 owner scope（最先）
2. 校验 request/run/timeline 坐标
3. 校验 canonical status/event vocabulary
4. 执行 event-specific projection 与 redaction（raw prompt / model output / tool args/result / attachment content / secret / 本地路径 MUST NOT 进入 payload）
5. 输出 stream/status、safe diagnostic、audit event 或 observability metric

projection failure（如 `STREAM_PROJECTION_SESSION_MISSING`、`STREAM_PROJECTION_PAYLOAD_UNSAFE`、`DEPRECATED_STREAM_EVENT_NAME`）会被投影为 `DEGRADATION_NOTICE` 终止流。

## 智能体开发者的关注点

### 在 capability 中发射事件

capability 通过 runtime 注入的 `RunTimelineEventPort` 发射 timeline 事件（由 runtime 持久化并投影为 stream）。capability **不应**直接写 stream envelope。

### 触发用户输入暂停

capability 通过 `USER_INPUT_REQUIRED` 事件 + `PendingInput` 机制暂停，runtime 保存 checkpoint，前端回答后恢复同一 run。`kind` 必须是 `QUESTION` / `CONFIRMATION` / `AUTHORIZATION` / `HUMAN_HANDOFF` 之一。

## 相关资源

- OpenSpec specs：`ts-web-sse-ws-transports/`、`ts-stream-resume-replay/`、`ts-stream-history-consistency/`、`ts-run-status-visibility/`、`ts-web-command-idempotency/`、`human-pending-input-core/`
- API 参考（含 stream 端点）：[API 参考](./10-api-reference.md)
- 会话与状态管理：[会话与状态管理](./07-session-state-management.md)
- 上下文管理（含 `CONTEXT_COMPACTED`）：[上下文管理](./08-context-management.md)
