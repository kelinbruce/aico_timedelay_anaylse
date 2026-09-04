# 会话与状态管理

这一篇讲 NextAgent 的会话生命周期、请求执行模型和状态持久化。

## 平台与运行时

NextAgent 后端基于 Node.js（>=22）、Fastify、Pino、TypeBox/Ajv、Vitest 与 Kysely/SQLite。本地单实例部署使用 SQLite 作为运行时事实存储（`agent-platform-gateway-local`）。所有运行时状态都以 owner scope（`tenantId` + `subjectId`）与 Agent scope（`agentId`）双重隔离。

## 核心概念

NextAgent 把"会话历史展示"与"请求执行状态"严格分离：

```
会话层 (Session Layer)                  执行层 (Execution Layer)
──────────────────────────              ──────────────────────────
UserSession                             RequestRun
  └── SessionMessage (历史事实)            └── RequestContext (内存工作态)
                                           └── CheckpointRecord (恢复快照)
                                           └── RunTimelineEvent (过程事实)
```

### 核心概念速查

| 概念 | 说明 | 归属包 |
|------|------|--------|
| `UserSession` | 会话容器，绑定 `agentId`，记录活跃/最近 run | `agent-session` |
| `SessionMessage` | 模型可见历史事实（USER/ASSISTANT/CAPABILITY_RESULT/SUMMARY） | `agent-session` |
| `RequestRun` | 一次请求执行尝试的生命周期记录，含 `attempt`、`status`、`terminalCommitState` | `agent-runtime` |
| `RequestContext` | 单次 run 的内存工作态（`toolCallStates`、`flowVariables`、`nextLifecycleStage`） | `agent-runtime` |
| `CheckpointRecord` | 可恢复的持久化快照，含 `triggerReason` | `agent-runtime` |
| `RunTimelineEvent` | 运行过程事实（`type`、`sequence`、`inlinePayload`、`persistence`） | `agent-runtime` |

### 为什么分离

- **历史事实**（`SessionMessage`）：用于快速打开会话、继续对话，不承担运行中的工作记忆。
- **执行状态**（`RequestContext`）：运行中推进上下文，不承担长期历史展示。
- **恢复快照**（`CheckpointRecord`）：进程重启后恢复到断点，配合 capability replay guard 避免重复执行外部副作用。

## 双 Scope 校验

主路径同时校验 **Agent Scope + Owner Scope**：

- 可信 `IdentityContext`（`tenantId` + `subjectId`）由 Channel/command boundary 注入，命令负载不得覆盖。
- `Session` 必须绑定 `agentId`；`requireSession`、`listSessions`、`listMessages`、`getActiveRun`、stream 等持久化查询都按 `(tenantId, subjectId, agentId, sessionId)` 定位。
- 跨 owner、跨 Agent 访问统一返回 safe not-found，不泄露目标对象是否存在（见 `session-delete`、`ts-run-status-visibility` spec）。

## 会话生命周期

### 创建会话

```bash
POST /api/v1/sessions
Content-Type: application/json
Cookie: nextagent_local_auth=...

{"locale":"zh-CN"}
```

Response:

```json
{
  "sessionId": "sess_123",
  "displayTitle": "Untitled session",
  "lastActivityAt": 1719878400000
}
```

会话在创建时绑定当前可信 `agentId`（由 `defaultAgentId` / hostedAgent 配置决定）。`locale` 可省略，默认 `zh-CN`。

### 会话列表

```bash
GET /api/v1/sessions?offset=0&limit=50&q=基站&createdFrom=...&createdTo=...
```

支持分页（`offset`/`limit`）、问题文本搜索（`q`，ASCII ≥3、非 ASCII ≥2，最大 50 字符）、创建时间范围过滤（`createdFrom`/`createdTo` 必须同时提供，范围不超过 90 天）。每条 entry 携带 `lastRunStatus` 与 `hasInFlightRequest`。

### 会话标题

```bash
PUT /api/v1/sessions/{sessionId}/title
{"title":"基站故障诊断"}
```

`title` 最大 100 字符。

### 删除会话

```bash
DELETE /api/v1/sessions/{sessionId}
→ 204 No Content
```

物理删除（hard delete）：在单个数据库事务内删除该 session 的 session、messages、active context、request runs、timeline events、checkpoints、annotations、shares、favorites 等从属事实。运行中的会话删除会失败关闭。删除受 owner + agent scope 隔离，跨 scope 返回 safe not-found。

### 会话对话历史

```bash
GET /api/v1/sessions/{sessionId}/conversation?limit=50&includeCapabilityResults=true
```

返回 `items`（`SessionMessage` 页）+ `nextCursor`/`newerCursor`（向前/向后翻页，三种游标不能组合）+ `activeRun`（当前活跃 run 摘要 `{requestId, runId, status}`）。`includeCapabilityResults=true` 时包含 capability result 消息。

预览接口 `GET /api/v1/sessions/{sessionId}/conversation/preview` 用于侧边栏标记页（`limit` 1–500）。

## 请求执行模型

### 提交请求

```bash
POST /api/v1/sessions/{sessionId}/requests
Content-Type: application/json

{
  "inputText": "分析小区掉话率升高原因",
  "idempotencyKey": "idem-001",
  "locale": "zh-CN",
  "routingConstraints": {"targetSkill":"network-diagnosis"}
}
```

必填字段：`inputText`、`idempotencyKey`。返回 `RequestAccepted`：

```json
{
  "sessionId": "sess_123",
  "requestId": "req_1",
  "runId": "run_1",
  "attempt": 1
}
```

> Acceptance response 不暴露 stream cursor 或 timeline sequence。

### Accepted run 固化 assembly

runtime acceptance 时固化 `agentId` / `agentVersion` / `agentAssemblyRef` 到 `RequestRun`，后续整个 run 都使用这份冻结的 assembly。`RequestRun` 还记录 `attempt`、`retryOfRunId`、`parentRunId`、`priority`、`status`、`version`、`terminalCommitState`。

### RunStatus 流转

```
ACCEPTED → QUEUED → PLANNING → EXECUTING → COMPLETED
                                  → FAILED
                                  → CANCELED
                                  → SUPERSEDED
```

分类（见 `session-lane-scheduling` spec）：

- **queued / pre-execution**：`ACCEPTED`、`QUEUED`、`PLANNING`
- **executing**：`EXECUTING`
- **terminal**：`COMPLETED`、`FAILED`、`CANCELED`、`SUPERSEDED`
- **terminal-pending**：`terminalCommitState` 为 `PENDING` 或 `RETRYING` 的 run，受保护不被 same-lane dispatch 越过

### Same-session lane 调度

每个 `tenantId + subjectId + agentId + sessionId` 组合是独立 session lane（见 `session-lane-scheduling` spec）：

- 同一 lane 默认至多一个 `EXECUTING` run；新 submit 被接为 `QUEUED`。
- Scheduler 只在 lane clear（无 blocking executing / terminal-pending run）时把 queued run 推进到 `EXECUTING`。
- Durable `RequestRun.status=QUEUED` 是 authoritative queue 状态，scheduler pending queue 可重建。
- Queue capacity / per-lane pending-depth 耗尽时返回安全 failure，不让 accepted run 无限挂起。

### 请求控制命令

| 操作 | 端点 | Runtime command | 说明 |
|------|------|-----------------|------|
| 提交 | `POST /sessions/{sessionId}/requests` | `submit` | 提交新请求 |
| 取消 | `POST /sessions/{sessionId}/cancel` | `cancel` | 取消最新请求（`action` 后端固定为 `CANCEL`） |
| 重试 | `POST /sessions/{sessionId}/retry` | `retryLatest` | 重试最新已 terminal-committed 请求 |
| 编辑 | `POST /sessions/{sessionId}/requests/latest/edit` | `editLatest` | 编辑并重新提交 |
| 回答 pending input | `POST /sessions/{sessionId}/pending-inputs/{pendingInputId}/answer` | `answerPendingInput` | 回答模型/能力请求的补充输入 |

cancel / retry 都需要 `expectedLatestRequestId` + `idempotencyKey`。

### 重试语义

- 只对 latest 且已 terminal-committed 的请求生效（`COMPLETED`/`FAILED`/`CANCELED`/`SUPERSEDED`）。
- 在**同一个 `requestId`** 下创建新 `RequestRun` attempt（`attempt = 上一个 attempt + 1`），新 run 通过 `retryOfRunId` 链接到前一个 attempt，保留 original request identity、owner scope、agent scope 与 execution assembly。
- 新 attempt 完成后，旧 attempt 的 assistant/capability 消息默认 `visible=false`，被替换。

### 编辑语义

- 创建新的 root `SessionMessage(role=USER)` 与新 `RequestRun(attempt=1)`。
- 旧 user/assistant/capability 消息默认 `visible=false`，被替换。
- 支持多部分附件（`multipart/form-data`），需额外提供 `expectedLatestRequestId`。

### 消息可见性

- `visible=false` 的消息在重试/编辑后被替换，不出现在模型可见历史与对话历史默认视图中。
- 例外：in-flight 的 `ASSISTANT_TOOL_USE` 消息由 runtime 写为 `visible=false` 但 `metadata.kind="ASSISTANT_TOOL_USE"`，render 阶段仍允许它进入模型，以保证下一次模型调用能看到自己的 tool call 与匹配的 capability_result。

### 取消语义

- 可取消 `ACCEPTED`/`QUEUED`/`PLANNING`/`EXECUTING` 的最新请求。
- 已 terminal 或 terminal-pending 已取消的请求幂等拒绝。
- 取消在 terminalizing 前会 signal executing work；adapter 不支持取消时返回 typed cancellation outcome。

## 恢复与 replay guard

本地单实例 runtime recovery（见 `local-runtime-recovery`、`runtime-recovery-idempotency-guard` spec）：

```
进程重启
  → bounded recovery pass 加载 durable RequestRun facts
  → 分类：queued recovery 重建 scheduler work；executing recovery 先 claim 再继续
  → 从 CheckpointRecord + SessionMessage 重建 RequestContext
  → 通过已定义 lifecycle stages 继续
  → terminal recovery 必须幂等
```

- Executing recovery 从 checkpoint 与 messages 重建 `RequestContext`，只通过已定义 lifecycle stages 推进。
- **Capability replay guard**：recovery 期间对 pending tool replay 逐个 tool 独立 reconcile：
  - 已持久化的 capability result 优先复用（`REUSE_RESULT`）。
  - 仅当 capability 具备 stable idempotency key 且 policy 允许时，才 `REPLAY_ALLOWED`。
  - unsafe recovery handoff 到 `RECOVERY_FAILED` terminal path。
- Recovery 保留 assembly 与 owner boundaries，不跨 scope 恢复。

## 幂等键

所有写入命令都需要非空 canonical `idempotencyKey`（由 Channel/command boundary 提供）：

- `submit` / `cancel` / `retry` / `editLatest` 的 command 前置条件。
- runtime 在创建 `RequestRun`、scheduling、terminalizing、publishing timeline 前，对缺失/空白 key 返回 `SUBMIT_IDEMPOTENCY_REQUIRED`（或对应 control 命令的稳定错误码）。
- `idempotencyKey` 不得从 client metadata、model output、capability input 或 hidden payload 推断补填。
- 相同 key 的重复 cancel/retry 保持幂等。

## 用户输入暂停与接续

当 agent 或 capability 需要用户补充输入时，runtime 发射 `USER_INPUT_REQUIRED` 事件，保存 `CheckpointRecord` + `PendingInput`，当前 `RequestRun` 阻塞。前端通过 `POST /api/v1/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer` 回答（`answers` 为非空二维字符串数组），runtime 加载 checkpoint 恢复同一 run 继续。

`PendingInputKind` 取值：`QUESTION`、`CONFIRMATION`、`AUTHORIZATION`、`HUMAN_HANDOFF`。`PendingInputStatus`：`PENDING`、`RECEIVED`、`TIMED_OUT`、`CANCELED`。

关键规则：

- 暂停不创建新 root request，而是当前 `RequestRun` 的阻塞/恢复。
- 恢复时比较 `RequestRun.version`，防止过期。
- 超时/取消产生对应 `USER_INPUT_TIMEOUT` / `USER_INPUT_CANCELED` 事件。

## 智能体开发者的关注点

### 可以做的事

1. 通过 REST API 管理会话与请求（创建、提交、取消、重试、编辑、回答 pending input）。
2. 在 capability / lifecycle hook 中通过 `USER_INPUT_REQUIRED` 暂停等待用户。
3. 依赖 runtime 的 lane 调度与 recovery 保证执行安全。

### 不应做的事

- 不要直接修改 `SessionMessage` 或 `RequestRun` 状态——这些是 runtime 拥有的 durable facts。
- 不要绕过 Runtime command boundary 推送终态或修改 attempt visibility。
- 不要在 capability 中实现自己的状态持久化——使用 checkpoint 与 capability replay guard 机制。
- 不要从 client payload / model output / capability input 覆盖可信 identity 或 agent scope。

## 配置参考

会话与执行相关配置分布在两处：

`agent.yaml`（agent 定义，`runtimeSettings`，见 `packages/agent-core/src/builtin-agents/default-agent/agent.yaml`）：

```json
{
  "defaultModelId": "MiniMax-M2.7-highspeed",
  "runtimeSettings": {
    "defaultLanguage": "zh-CN",
    "maxTurns": 50,
    "maxToolCallsPerTurn": 30,
    "maxContextMessages": 50,
    "requestTimeoutMs": 1800000
  }
}
```

`AgentRuntimeSettings` 允许字段：`defaultLanguage`、`maxTurns`、`maxToolCallsPerTurn`、`maxContextMessages`、`requestTimeoutMs`。模型默认值是 `agent.yaml` 顶层的可选 `defaultModelId`，不属于 runtime settings。

应用级 system config 由框架 `default-system.yaml` 与开发者 `application.yaml` 合成，包含 `channel.host`/`port`、`hostedAgent.activeAgentId`、`gateway`（sqlite gateway）、`auth`（local auth）、`nextAgent.memory.*` 等。stream transport 由 `GET /api/v1/runtime/bootstrap` 的 `transportKind` 返回，不由 `.properties` 配置。

## 相关资源

- Runtime / Session 完整设计：见 OpenSpec specs `session-lane-scheduling/`、`request-cancel/`、`request-retry/`、`local-runtime-recovery/`、`runtime-recovery-idempotency-guard/`、`ts-run-status-visibility/`、`session-delete/`
- 流式事件协议：[流式事件](./09-streaming-events.md)
- API 参考：[API 参考](./10-api-reference.md)
- 上下文装配：[上下文管理](./08-context-management.md)
