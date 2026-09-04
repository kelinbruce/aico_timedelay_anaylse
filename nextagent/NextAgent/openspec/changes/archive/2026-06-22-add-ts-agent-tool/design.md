## 目标和边界

`Agent` tool 是 Tool kind 的模型入口，用于在 model-driven loop 中请求已治理的 AGENT capability。它不是 `AGENT` capability kind 本身，也不定义 Agent package、routing policy 或远端协议。

本 change 覆盖**独立上下文**场景的全流程：子 Agent 使用 fresh context，不继承父 Agent 的对话历史、timeline、attachments 或 active context。但子 session/run/message **必须关联**父 agent 的 session/run/message。Tool 同步等待子 Agent 终态并返回安全报告。**继承上下文**场景 defer 到 `add-ts-invoked-agent-context-inheritance`。

本 change 实现本地 subagent 路径。`SubagentExecutionPort` 根据 `descriptor.provider.providerKind` 内部分发：`BUNDLED`/`LOCAL_DIRECTORY` → 本地路径（本 change 实现）；`AGENT_REGISTRY` → 远端路径（deferred）。

本 change 不在 `GovernedCapabilityInvocationPort` 注册 AGENT kind executor。Agent tool 解析 target descriptor 后直接调用 `SubagentExecutionPort`，不通过 `CapabilityInvocationPort` re-entrant 调用。

## 现状与缺口

| 组件 | 状态 |
|---|---|
| `CapabilityInvocationPort` 契约 + `GovernedCapabilityInvocationPort` dispatch | ✅ 已有 |
| `RuntimeCapabilityResolver`（Tool 可用） | ✅ 已有 |
| `RuntimeCommandPort.submit()` | ✅ 已有（但不支持指定 agentId、创建 child session、priority） |
| `RuntimeEventStreamPort.streamEvents` | ✅ 已有（可监听 run 终态事件） |
| `RequestRun.retryOfRunId?` | ✅ 已有（run 间关系字段先例） |
| AGENT kind executor in `GovernedCapabilityInvocationPort` | ❌ 显式 fail closed |
| `SubagentExecutionPort` 契约 + runtime 实现 | ❌ 不存在 |
| `ToolDependencies` 中的 subagent execution 依赖 | ❌ 不存在 |
| `submit()` 支持指定 agentId + 创建 session + parent linkage + priority | ❌ 不存在 |
| `SessionRecord`/`UserSession`/`RequestRun` parent linkage + priority 字段 | ❌ 不存在 |
| `RequestPriority` enum | ❌ 不存在 |
| 同步等待 child run 终态 + terminal text 提取 | ❌ 不存在 |

## 黑盒输入输出

Input schema:

```text
{ agentId: string, prompt: string }
```

- `agentId`：目标 Agent capability id，必须在当前 agent-scoped capability bindings 中可解析。
- `prompt`：子 Agent 的任务 prompt，作为子 run 的首条 user message。最大 `8192` UTF-8 bytes。

Success output schema:

```text
{ agentId: string, status: "completed", result: { text: string } }
```

- `result.text`：子 Agent 终态响应的安全文本投影，最大 `100_000` UTF-8 bytes。MUST NOT 包含 raw prompt、provider-private metadata、credential、raw provider error、路径或高基数字段。

Failure uses safe failed result with reason code:

- `INVALID_INPUT` — schema 校验失败或 `prompt` 超预算。
- `AGENT_NOT_AVAILABLE` — `RuntimeCapabilityResolver.resolveCapability()` 返回 `undefined`（target 不存在、未绑定、非默认可见或 binding 被 disable），或 descriptor `availabilityStatus !== "AVAILABLE"`，或 `modelInvocable !== true`。resolver 已通过 catalog 治理覆盖显式 binding（`agentInvocation="BOUND"`）和默认可见（`agentInvocation="PARENT"` + parentAgentScope 匹配）两条路径，无需额外 binding 检查。
- `SELF_INVOCATION_REJECTED` — `agentId` 等于当前父 Agent 的 `agentId`。
- `TIMEOUT` — 子 run 超过 timeout。
- `ABORTED` — 通过 `AbortSignal` 取消。
- `EXECUTION_FAILED` — 子 run 内部失败，safe error 不暴露内部细节。

## 契约变更

### 新增：SubagentExecutionPort（`agent-contracts/capability`）

```text
SubagentExecutionRequest {
  targetAgentId: AgentId
  targetAgentVersion?: AgentVersion       // from descriptor; if absent, port uses active()
  targetProviderKind: CapabilityProviderKind // from descriptor.provider.providerKind; port dispatches local vs remote
  prompt: string
  parentSessionId: SessionId
  parentRunId: RequestRunId
  parentRequestId: MessageId
  parentToolCallId: string                // from ToolExecutionContext.toolCallId; audit traceability
  identityContext: IdentityContext
  locale: RequestLocale                     // passed to submit() as child run locale
  idempotencyKey: IdempotencyKey            // passed to submit() as child run idempotency key
}

SubagentExecutionResult {
  status: "COMPLETED" | "FAILED" | "TIMED_OUT" | "CANCELED"
  terminalText: string  // safe projection, max 100_000 UTF-8 bytes
  childSessionId?: SessionId  // for traceability
  childRunId?: RequestRunId   // for traceability
  safeError?: SafeError
}
```

**设计原则**：Tool 只做 governance（resolve descriptor + validate），不做 assembly resolution。Port 负责 assembly resolution（获取 timeoutMs + version）和 `submit()` 调用。`timeoutMs` 不在 request 中——port 从 target assembly `runtimeSettings.requestTimeoutMs` 获取（fallback 120_000ms）。`targetAgentAssemblyRef` 不需要——local path 用 `require(agentId, agentVersion)`，remote path 用 `agentId`。

SubagentExecutionPort {
  executeSubagent(request: SubagentExecutionRequest, signal: AbortSignal): Promise<SubagentExecutionResult>
}
```

### 新增：RequestPriority（`agent-common`）

```text
RequestPriority = "HIGH" | "NORMAL" | "LOW"
```

- `NORMAL`：顶层用户请求默认优先级。
- `LOW`：subagent 请求优先级。scheduler 在并发槽位释放时优先调度 HIGH/NORMAL，再调度 LOW。
- `HIGH`：预留，用于未来高优先级场景。

### 修改：SubmitRequestCommand（`agent-contracts/runtime`）

```text
SubmitRequestCommand {
  // Session specification (mutually exclusive: provide sessionId for existing, agentId for new)
  sessionId?: SessionId        // was required, now optional; if absent, submit creates new session
  agentId?: AgentId            // required when sessionId absent (new session creation); MUST NOT override session.agentId when sessionId present (session-bound Agent Scope)
  agentVersion?: AgentVersion  // optional; when present, submit uses require(agentId, agentVersion) instead of active(agentId)

  identityContext: IdentityContext
  inputText: string
  attachmentIds: readonly AttachmentId[]
  locale: RequestLocale
  routingConstraints?: RoutingConstraints
  idempotencyKey: IdempotencyKey

  // Parent linkage (for child session creation, only when sessionId absent)
  parentSessionId?: SessionId
  parentRunId?: RequestRunId
  parentRequestId?: MessageId

  // Scheduling
  priority?: RequestPriority   // defaults to NORMAL; subagent sets LOW
}
```

`submit()` 逻辑：
- 有 `sessionId`：验证 session 可用 + 用户可访问 → run 的 `agentId` MUST 为 `session.agentId`（session-bound Agent Scope，不允许 override）。若 `command.agentId` 存在且与 `session.agentId` 不一致，`submit()` MUST reject。`command.agentVersion` 可用于 pin 特定版本（`require(session.agentId, agentVersion)`），但 `agentId` 不可覆盖。
- 无 `sessionId`：用 `command.agentId`（required）创建新 session → 创建 run。有 `parentSessionId` 时创建 child session（带 parent linkage）。
- Assembly 解析：有 `command.agentVersion` 时用 `assemblyRegistry.require(agentId, agentVersion)`（pin 特定版本，用于 subagent）；无 `agentVersion` 时用 `assemblyRegistry.active(agentId)`（最新激活版本，用于顶层 agent，向后兼容）。
- `priority` 持久化到 `RequestRun.priority`，默认 `NORMAL`。
- **框架自动 no-nesting 强制**：当 `parentRunId` 存在（child run）时，`submit()` 自动注入 no-nesting 约束到 routing constraints。合并语义：framework 注入的 `forbiddenCapabilityIds: ["Agent"]` 与 caller 提供的 `forbiddenCapabilityIds` 做 union merge（`["Agent", ...callerProvided]`），确保 `"Agent"` 不可被 caller 移除；framework 注入的 `allowSubagents: false` 覆盖 caller 提供的 `allowSubagents`（若 caller 提供 `true` 则被覆盖为 `false`）。Caller 提供的其他 `routingConstraints` 字段（`targetSkill`/`executionMode`/`maxToolCalls` 等）不受影响。

### 修改：SessionRecord（`agent-contracts/gateway`）/ UserSession（`agent-contracts/session`）

增加 optional 字段：

```text
parentSessionId?: SessionId
parentRunId?: RequestRunId
parentRequestId?: MessageId
```

### 修改：RequestRun（`agent-contracts/runtime`）

增加 optional 字段：

```text
parentRunId?: RequestRunId
parentRequestId?: MessageId
priority?: RequestPriority
```

## 核心流程

### Agent tool execute() 流程

1. Validate input schema；`additionalProperties: false`。
2. Reject `prompt` over `8192` UTF-8 bytes with `INVALID_INPUT`。
3. Reject self-invocation：`agentId === context.agentId` 时返回 `SELF_INVOCATION_REJECTED`。
4. 通过 `RuntimeCapabilityResolver.resolveCapability({ kind: "AGENT", capabilityId: agentId })` 解析 target descriptor；忽略 client/model supplied scope fields。Resolver 返回 `undefined` → `AGENT_NOT_AVAILABLE`（覆盖 not exist / not bound / not default-visible / disabled）。
5. 校验 descriptor：`kind === "AGENT"`、`availabilityStatus === "AVAILABLE"`、`modelInvocable === true`。校验失败返回 `AGENT_NOT_AVAILABLE`。
6. 从 descriptor 提取 `version`（→ `targetAgentVersion`）和 `provider.providerKind`（→ `targetProviderKind`）。Tool 不解析 assembly——assembly resolution 由 port 负责。
7. 调用 `deps.subagentExecution.executeSubagent({ targetAgentId: agentId, targetAgentVersion: descriptor.version, targetProviderKind: descriptor.provider.providerKind, prompt, parentSessionId: context.sessionId, parentRunId: context.runId, parentRequestId: context.requestId, parentToolCallId: context.toolCallId, identityContext: context.identityContext, locale: context.locale, idempotencyKey: deriveSubagentIdempotencyKey(context.runId, context.toolCallId) }, signal)`。
8. 映射 `SubagentExecutionResult` 到 tool output：`COMPLETED` → `{ agentId, status: "completed", result: { text: terminalText } }`；其他 → safe failed result。
9. `terminalText` 超过 `100_000` UTF-8 bytes 时通过 `agent-common.truncateUtf8` 安全截断。

Tool 不解析 assembly、不计算 timeout、不创建 child session/run、不写 child timeline、不执行 terminal commit。

### SubagentExecutionPort 本地路径实现流程（agent-runtime）

`SubagentExecutionPort` 是薄编排层，复用现有 `submit()` flow，不重复 `submit()` 已有的 session/run 创建、context assembly、`Agent.execute()`、timeline 或 terminal commit 逻辑。

1. 根据 `request.targetProviderKind` 分发：`BUNDLED`/`LOCAL_DIRECTORY` → 本地路径（下述）；`AGENT_REGISTRY` → 远端路径（deferred）。
2. 解析 target assembly：有 `targetAgentVersion` 时用 `assemblyRegistry.require(targetAgentId, targetAgentVersion)`；无版本时用 `assemblyRegistry.active(targetAgentId)`。Port 从 assembly `runtimeSettings.requestTimeoutMs` 获取 `timeoutMs`（fallback 120_000ms）。
3. 调用 `RuntimeCommandPort.submit({ agentId: targetAgentId, agentVersion: assembly.agentVersion, identityContext, inputText: prompt, attachmentIds: [], locale: request.locale, parentSessionId, parentRunId, parentRequestId, priority: "LOW", idempotencyKey: request.idempotencyKey })`。**无 `sessionId`** — `submit()` 内部创建 child session（`agentId` = target，`parentSessionId`/`parentRunId`/`parentRequestId` linkage）+ 创建 child run + 执行 Agent。`priority: "LOW"` 保证顶层请求优先调度。`submit()` 返回 `RequestAccepted`（含 `sessionId`/`runId`）。

`SubagentExecutionPort` 不设置 `forbiddenCapabilityIds` 或 `allowSubagents` — no-nesting 约束由 `submit()` 框架机制自动注入（见"禁止嵌套"章节）。
2. 同步等待 child run 终态：通过 `RuntimeEventStreamPort.streamEvents` 监听 child session/run 的 timeline events，等待 `REQUEST_COMPLETED` / `REQUEST_FAILED` / `REQUEST_CANCELED` 事件，或 timeout/abort。
3. 从 child run 终态消息提取安全文本投影（`terminalText`）：通过 `RuntimeSessionPort.listMessages` 读取 child run 的消息列表，取最后一条 `role="ASSISTANT"` 消息的 `content` 作为 `terminalText`。若 child run 无 assistant 消息（例如失败前未产出），`terminalText` 为空字符串；若 run 已不可 active 但消息可读，port MUST 用消息恢复终态文本；若消息页不存在或为空，MUST 分别返回不同 safe error。
4. 返回 `SubagentExecutionResult`（含 `childSessionId`/`childRunId` 供 traceability，`status`/`terminalText`/`safeError`）。若失败发生在 `submit()` accept 之后，outer catch 仍 MUST 返回 `childSessionId`/`childRunId`。

### Abort/timeout 传播

当父 tool 的 `AbortSignal` 触发或 timeout 到期：
1. `SubagentExecutionPort` 通过 `RequestControlCommand`（`action: "CANCEL"`）取消 child run。
2. Child run 的 `agent.execute()` 收到 cancellation，进入 `CANCELED` 终态。
3. Port 返回 `SubagentExecutionResult` with `status="CANCELED"` → tool 映射为 `ABORTED`。
4. Timeout 到期时同上，返回 `status="TIMED_OUT"` → tool 映射为 `TIMEOUT`。

### Port 错误恢复

如果 `streamEvents` 中途断开（网络异常、内部错误），port MUST：
1. 通过 `RuntimeSessionPort.getActiveRun({ sessionId: childSessionId })` 回查 child run 状态。
2. 若 active run 不存在，先通过 `RuntimeSessionPort.listMessages` 尝试恢复 terminalText；这覆盖 run 已终态且从 active run map 移除的正常窗口。
3. 若 terminal messages 可读且存在 assistant message，返回 `COMPLETED` 和恢复出的 `terminalText`；若消息页存在但无 assistant message，返回 `COMPLETED` 和空 `terminalText`。
4. 若消息页为空，返回 `FAILED` with safe error `SUBAGENT_TERMINAL_MESSAGES_EMPTY`；若消息页找不到，返回 `FAILED` with safe error `SUBAGENT_TERMINAL_MESSAGES_NOT_FOUND`。
5. 若 child run 仍在执行：重试 `streamEvents`（从上次 `lastSeenSequence` 继续）。
6. 若 `listMessages` 发生其他错误：返回 `EXECUTION_FAILED` with safe error（不暴露内部细节），但 `childSessionId`/`childRunId` 仍返回供 traceability。

### submit() 失败后 orphan child session 处理

当 `submit()` 无 `sessionId`（内部创建 session）且后续步骤（run save、checkpoint、persist message）失败时：

`SessionStoreGateway` 当前只有 `loadSession`/`listSessions`/`saveSession`，没有 `deleteSession`。不修改 `SessionRecord` 字段（避免污染 title 等业务语义）。采用 **accept-and-log 策略**：

1. `submit()` 失败后，orphan child session 保留在 store 中，但无 runs。
2. `submit()` MUST 记录 diagnostic log（包含 orphan sessionId、parentRunId、失败原因）。
3. Orphan session 无 runs → 不消耗并发配额、不出现在 active run 列表、不影响功能正确性。
4. 后台清理 job（deferred）可定期扫描无 runs 的 child sessions 并清理。
5. `SubagentExecutionPort` 收到 error，知道 child session 不可用，无需额外处理。

对于有 `sessionId` 的调用（web channel 模式），session 由外部创建，`submit()` 失败不影响 session（保留给用户重试）。

### 优先级调度 — scheduler 架构变更

当前 scheduler 是 per-lane 独立 drain（`enqueueWork` → `void drainLane(laneKey)`），`submit()` 直接触发 dispatch，职责混合。本 change 将 scheduler 改为**独立异步调度组件**：`submit()` 只入队，scheduler 独立从队列调度。

**当前架构**（问题）：
```
submit() → enqueueWork(lane) → void drainLane(lane) → executeQueuedWork()
                 ↑ submission 和 dispatch 混在一起
                 ↑ per-lane 独立 drain，无全局并发控制
```

**目标架构**：
```
submit() → enqueueWork(lane) → wakeScheduler() → return RequestAccepted
                                        ↓
Scheduler (单循环，event-driven):
  runSchedulerLoop():
    while (executingRuns.size + inflightCount) < maxConcurrent:
      reservation = reserveNextWork()        // 同步选中 work + lane + slot
      if reservation === undefined → break
      void dispatchReservedWork(reservation) // fire-and-forget, 只消费已保留 work
    schedulerRunning = false
    if hasDispatchableWork() and hasCapacity():
      wakeScheduler()                        // 处理 loop 结束窗口内到达的新 work

  wakeScheduler():                           // 新 work 到达 或 run 完成 时调用
    if schedulerRunning → return
    schedulerRunning = true
    void runSchedulerLoop()

reserveNextWork() [sync]:
  laneKey = pickHighestPriorityLane()        // 跳过 drainingLanes
  if laneKey === undefined → undefined
  work = queue.shift()
  drainingLanes.add(laneKey)                 // 同步保留 lane，避免重复 dispatch
  inflightCount++                            // 同步保留全局 slot
  return { laneKey, work }

dispatchReservedWork(reservation) [async]:
  snapshot check (supersession)
  if work is skipped before execution:
    release inflightCount and drainingLanes
    wakeScheduler()
    return
  transfer reservation to executingRuns      // inflightCount-- 与 executingRuns.set 同步完成
  await executeQueuedWork(work)              // 阻塞直到终态

executeQueuedWork() finally:
  executingRuns.delete(runId)
  drainingLanes.delete(laneKey)
  wakeScheduler()                            // 槽位释放，唤醒 scheduler
```

**变更点**：
1. `scheduler` config 增加 `maxConcurrent?: number`（全局并发上限，如 50）。
2. 新增 `schedulerRunning: boolean`（防循环重入）、`inflightCount: number`（已保留 slot 但尚未进入 `executingRuns` 的 reservation 计数，防 TOCTOU race）。
3. `enqueueWork` 不再调 `drainLane`，改为调 `wakeScheduler()`。
4. 新增 `reserveNextWork()`：在同一个同步步骤内从所有 lane queue 中选 priority 最高的可 dispatch work（跳过 `drainingLanes`），`queue.shift()`、`drainingLanes.add(laneKey)`、`inflightCount++`。这是唯一允许 fire-and-forget 之前改变 dispatch 状态的位置。
5. 新增 `runSchedulerLoop()`：循环检查 `(executingRuns.size + inflightCount) < maxConcurrent`，调用 `reserveNextWork()`；若有 reservation，fire-and-forget `dispatchReservedWork(reservation)`。loop 结束后设置 `schedulerRunning=false`，并在还有可 dispatch work 且仍有 capacity 时重新 `wakeScheduler()`，避免 loop 结束窗口丢 wake。
6. 新增 `dispatchReservedWork(reservation)`：替代 `drainLane`。只消费已经保留的 work/lane/slot；做 supersession/terminal snapshot 检查；若 work 在执行前被跳过，释放 `inflightCount` 和 `drainingLanes` 并 `wakeScheduler()`；若进入执行，必须在同一同步段完成 `inflightCount--` 与 `executingRuns.set(runId, state)` 的 reservation transfer。
7. `executeQueuedWork` finally 中 `drainLane(work.laneKey)` 改为 `executingRuns.delete(runId)` + `drainingLanes.delete(laneKey)` + `wakeScheduler()`——槽位释放后由 scheduler 全局选下一个 work。
8. `drainLane` 方法被 `reserveNextWork` + `dispatchReservedWork` + `runSchedulerLoop` 替代，删除。
9. `drainAllLanes()` 被 scheduler drain/wake 语义替代：`close()` 和 recovery-gate release 只调用 `wakeScheduler()`，不得直接按 lane 启动 dispatch。
10. `close()` 的 idle 条件必须包含 `pendingWorkCount() === 0`、`drainingLanes.size === 0`、`executingRuns.size === 0`、`inflightCount === 0`、`schedulerRunning === false`；循环等待期间可重复 `wakeScheduler()`。
11. `maxPendingQueueDepth` 仍限制全局 pending 总深度（排队上限，如 50）。
12. Recovery：启动时扫描所有 QUEUED runs，用 `enqueueWork({ startDispatch: false })` 重建队列；recovery gate release 后统一调用 `wakeScheduler()`，scheduler 自然 picks up。

**并发模型**：
- 全局并发上限 `maxConcurrent`（如 50）：`executingRuns.size + inflightCount` 不超过此值。
- 全局排队上限 `maxPendingQueueDepth`（如 50）：所有 lane 的 pending 总和不超过此值。
- Priority 跨 lane 生效：`runSchedulerLoop` 每次迭代从所有 lane 中选 priority 最高的可 dispatch work（`HIGH > NORMAL > LOW`，同 priority 按 lane FIFO）。
- Lane 内串行：`reserveNextWork()` 同步写入 `drainingLanes`，保证一个 lane 同时只有一个 reserved/executing work。
- Subagent（`priority=LOW`）和顶层请求（`priority=NORMAL`）共用并发配额，但顶层优先。

### 禁止嵌套 — submit() 框架自动强制

"Subagent 不能再起 subagent" 是架构决策，由框架机制在 `submit()` 中自动强制，不是用户配置。

**为什么不能用 binding 层控制**：
1. Agent tool 是默认开启的 builtin tool，不需要显式 binding，所有 agent 默认可用。
2. 同一个 agent 既是顶层 agent（Agent tool 可用）又可能是 subagent（Agent tool 不可用）。同一个 assembly、同一个 binding，工具可用性取决于运行时上下文（顶层 vs 子调用），不是 assembly 配置。

**框架强制机制**：`submit()` 检测到 `parentRunId` 存在时（child run），自动注入 no-nesting 约束到 routing constraints：
- `forbiddenCapabilityIds: ["Agent"]` — 在 catalog 层移除 Agent tool，模型看不到，无法调用
- `allowSubagents: false` — 在 tool-loop 层阻断 AGENT kind capability 调用（defense-in-depth）

这两个约束是**框架自动注入、不可覆盖**的。即使 caller 提供了其他 `routingConstraints`，框架注入的 no-nesting 约束优先级最高。`SubagentExecutionPort` 不需要、也不应该设置这些约束——这是框架规则，不是 caller 决定。

`routingConstraints.forbiddenCapabilityIds` 作为通用机制仍然可用——caller 可以用它 deny 其他工具。但 `["Agent"]` for child runs 是框架自动行为，不由 caller 控制。

### Fresh context isolation（由 submit() 自然保证）

Child session 是 `submit()` 内部新建 session（`agentId` = target），没有历史消息。`submit()` 在创建 child run 时，context engine 从 child session 组装 context，自然不包含父 session 的：

- session history（对话消息）
- timeline events
- attachments
- active context / context window

Child run context 由 `submit()` 内部的 context assembly 产出，包含：
- target Agent assembly 的 system prompt（由 child session 的 `agentId` 决定）
- `prompt` 作为首条 user message（由 `submit()` 的 `inputText` 持久化）
- target Agent 的 capability bindings、model profile、prompt profile（由 target assembly 决定）

本 change 不需要新增 context engine 逻辑——fresh context 是 child session 创建的自然结果。

### submit() agentId — 统一 subagent 和 host agent 调度

`submit()` 是 agent 调度的唯一控制点：

- **有 `sessionId`**（已有 session）：`submit()` 验证 session 可用 + 用户可访问 → run 的 agentId MUST 为 `session.agentId`（session-bound Agent Scope）。若 `command.agentId` 存在且与 `session.agentId` 不一致，`submit()` MUST reject。`command.agentVersion` 可用于 pin 特定版本。
- **无 `sessionId`**（新 session）：`submit()` 用 `command.agentId`（required）创建新 session → 创建 run。有 `parentSessionId` 时创建 child session（带 parent linkage）。

这统一了三种场景：
1. **顶层 agent，已有 session**：web channel 调 `submit({ sessionId, inputText })` → 用 `session.agentId`（session-bound，不允许 override）。
2. **顶层 agent，新 session**：web channel 调 `submit({ agentId, inputText })` → `submit()` 创建 session。
3. **Subagent**：`SubagentExecutionPort` 调 `submit({ agentId: targetAgentId, agentVersion, parentSessionId, parentRunId, parentRequestId, priority: "LOW", inputText: prompt })` → `submit()` 创建 child session + run。

场景 2 和 3 使用相同的 "submit 创建 session" 机制，统一了 agent 调度入口。

### Timeout

`tool-loop.ts:142` hardcodes `timeoutMs: 30_000` for all capability invocations — too short for subagent. Agent tool 不在 `SubagentExecutionRequest` 中传 `timeoutMs`。`SubagentExecutionPort` 从 target assembly `runtimeSettings.requestTimeoutMs` 获取（fallback 120_000ms）。Parent run 的 `AbortSignal`（from `assembly.runtimeSettings.requestTimeoutMs`，默认 300s）是最终 backstop。Parent run 的剩余时间不通过 API 暴露，不计算 `parentRemaining`。

### Local vs remote dispatch

`SubagentExecutionPort` 是 Agent tool 到 subagent 执行的唯一抽象层。Agent tool 不感知 local/remote 区别，只调 `executeSubagent()`。

`SubagentExecutionPort` 实现根据 `descriptor.provider.providerKind` 分发：

- `BUNDLED` / `LOCAL_DIRECTORY` → 本地路径（上述流程）：通过 `submit()` 创建 child session/run，runtime 执行 Agent。
- `AGENT_REGISTRY` → 远端路径（deferred）：通过 A2A 协议经 `agent-platform-gateway-remote` 调用远端 agent。远端 agent 在远端 runtime 创建 session/run，本地 port 通过 A2A 协议等待远端终态并提取 terminal text。首版遇此 providerKind 返回 `EXECUTION_FAILED` with safe error "Remote agent execution is not yet supported."

### 依赖注入架构

```
agent-contracts/capability ← 定义 SubagentExecutionPort 契约
       ↑          ↑
agent-capability   agent-runtime
(ToolDependencies     (实现 SubagentExecutionPort)
 依赖契约类型)
       ↑          ↑
       agent-app (composition root: 创建 runtime port 实例，注入到 ToolDependencies.subagentExecution)
```

- `agent-capability` 导入 `@nextagent/agent-contracts/capability` 的 `SubagentExecutionPort` 类型，因为该 port 是 Agent capability SPI 依赖契约；不依赖 `agent-runtime` 实现。
- `agent-runtime` 实现 `SubagentExecutionPort`——runtime 拥有 lifecycle，可访问 `RuntimeCommandPort`/`RuntimeEventStreamPort`/`RuntimeSessionPort`。
- `agent-app` 在 composition 中创建 `SubagentExecutionPort` 实例并注入到 `ToolDependencies.subagentExecution`。

### routingConstraints 设计目的

`RoutingConstraints` 是 per-request 运行时治理机制（非 per-agent 配置），允许 request 提交者在 `submit()` 时约束 agent 执行期间的行为：

- `forbiddenCapabilityIds` — 在 catalog 解析前移除特定 capability，模型看不到（`tool-loop.ts:78`）
- `allowSubagents` — 阻断 AGENT kind capability 调用（`tool-loop.ts:106`）
- `maxToolCalls` — 限制每轮 tool 调用数
- `executionMode` — `"default"` vs `"model-only"`
- `allowHumanInput` — 是否允许 pending input

本 change 的 no-nesting 机制利用 `forbiddenCapabilityIds` + `allowSubagents`——框架在 `submit()` 中为 child run（`parentRunId` 存在）自动注入，控制 agent 执行期间的 tool 可用性。这是运行时行为控制，不是 assembly 配置。

## DFX

- Security: `result.text` 不含 raw prompt、target private config、credentials、provider-private metadata 或 hidden routing data；target resolution 使用 trusted agent/owner scope；child run 继承 owner scope 但 fresh context。
- Reliability: 支持 `AbortSignal` 和 timeout；子 run 失败返回 safe structured error；child run lifecycle 由 runtime 拥有。
- Capacity: `prompt` 限制 `8192` UTF-8 bytes；`result.text` 限制 `100_000` UTF-8 bytes。
- Testability: cover unavailable agent、self-invocation、oversized prompt、timeout、abort、fresh context isolation、parent linkage、priority scheduling、no-nesting 和 architecture boundary。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | target resolution 使用 `RuntimeCapabilityResolver`（`kind="AGENT"`）和 trusted scope；child run 继承 owner scope 但 fresh context；`result.text` 不含敏感数据；`submit()` 自动注入 no-nesting 约束 for child runs | security test: scope override rejection; test: child run context isolation; test: no secret leakage in result.text; test: Agent tool denied in child run via submit() auto-injection |
| 性能/容量 | `prompt` ≤ 8192 UTF-8 bytes；`result.text` ≤ 100_000 UTF-8 bytes | unit test: budget boundary enforcement |
| 可靠性/恢复 | 支持 timeout 和 AbortSignal；子 run 失败返回 safe error；child run lifecycle 由 runtime 拥有 | contract test: error format; integration test: timeout/abort propagation |
| 可维护性 | Tool 只负责 resolve + invoke + safe result projection；`SubagentExecutionPort` 是薄编排层复用 `submit()` | architecture test: no lifecycle ownership in tool; architecture test: port reuses submit() |
| 可测试性 | unavailable、self-invocation、oversized prompt、timeout、abort、fresh context、parent linkage、priority、no-nesting 均可独立验证 | unit + contract + integration test |
| 审计/可追溯性 | parent-child session/run/message 关联通过 `SessionRecord`/`RequestRun` parent linkage 字段承载；复用现有 `invocation-audit`；不新增 timeline event kind | test: parent linkage persisted; test: audit via existing invocation-audit |
| 电信级并发 | subagent priority=LOW，顶层 priority=NORMAL；scheduler 优先调度顶层请求；共用全局并发配额但顶层不被饿死 | integration test: priority scheduling; test: subagent queued behind top-level |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| input schema 验证（`additionalProperties: false`） | T1.1 | unit test: input validation |
| `prompt` 超预算拒绝 | T1.2 | unit test: prompt budget boundary |
| self-invocation 禁止 | T1.3 | unit test: self-invocation rejection |
| target 通过 `RuntimeCapabilityResolver`（`kind="AGENT"`）解析 | T2.1 | integration test: capability resolver invocation |
| descriptor 校验 | T2.2 | unit test: unavailable/non-modelInvocable rejection |
| scope override rejection | T2.3 | security test: scope override rejection |
| `SubagentExecutionPort` 契约定义 | T3.1 | contract test: port shape |
| `SubmitRequestCommand` 变更（sessionId optional, agentId, parent linkage, priority） | T3.2 | contract test: command shape |
| `SessionRecord`/`UserSession`/`RequestRun` parent linkage + priority 字段 | T3.3 | contract test: fields present |
| `RequestPriority` enum 定义 | T3.4 | contract test: enum values |
| `submit()` 支持无 sessionId 创建 session | T4.1 | integration test: submit creates session when sessionId absent |
| `submit()` 支持 parent linkage 创建 child session | T4.2 | integration test: child session created with parent linkage |
| `submit()` 支持 priority 持久化 | T4.3 | integration test: priority persisted to RequestRun |
| scheduler 按 priority 调度（NORMAL 先于 LOW） | T4.4 | integration test: priority scheduling |
| scheduler 同步 reservation 防超发/重复 lane dispatch | T4.5 | integration tests: rapid wake no over-dispatch; same-lane double-dispatch negative case |
| scheduler close/recovery 通过统一 wake/drain 语义 | T4.6 | integration tests: close waits for scheduler idle; recovery gate release wakes scheduler |
| `SubagentExecutionPort` 调用 `submit({ agentId, parentSessionId, ..., priority: "LOW" })` | T5.1 | integration test: port invokes submit with correct params |
| 同步等待终态（通过 `streamEvents`） | T5.2 | integration test: port waits for terminal event |
| terminal text 提取 | T5.3 | integration test: terminalText from child run terminal message |
| timeout/abort 传播（通过 `RequestControlCommand(CANCEL)`） | T5.4 | integration test: timeout and abort propagation |
| completed output shape | T5.5 | contract test: completed output shape |
| `result.text` safety | T5.6 | security test: result.text leakage scan |
| `result.text` truncation | T5.7 | unit test: result budget boundary |
| Tool 不创建 child session/run/timeline | T6.1 | architecture test: no lifecycle ownership in tool |
| `SubagentExecutionPort` 不直接调 `AgentInstanceManager`/`Agent.execute` | T6.2 | architecture test: port reuses submit() |
| 不新增 audit/timeline event kind | T6.3 | architecture test: no new audit/timeline contract |
| `submit()` auto-injects no-nesting constraints for child runs | T6.4 | architecture test: submit() injects forbiddenCapabilityIds when parentRunId present |
| Parent linkage persisted | T6.5 | integration test: parent linkage in session/run records |
| Remote providerKind returns safe error | T6.6 | unit test: remote providerKind returns EXECUTION_FAILED |

## 上下游协作

- `add-ts-invoked-agent-discovery`：定义 `CapabilityDescriptor(kind="AGENT")` 的 discovery 和 catalog 治理。本 change 的 target resolution 复用其 descriptor 和 `RuntimeCapabilityResolver`。No-nesting 由 `submit()` 框架在运行时自动强制，不依赖 assembly binding 配置。
- `agent-routing-core`：Agent tool 是 model-driven loop 内的 Tool 入口，不调用 routing policy；`AGENT_NOT_AVAILABLE` 覆盖 resolver 返回 `undefined`（target 不存在、未绑定、非默认可见或被 disable）。
- `invocation-audit`：capability invocation audit 由现有 spec 承载，不新增 audit 字段。
- `local-run-timeline-store`：child run timeline 由 `submit()` 内部通过 `AgentRunStatePort` 持久化，不新增 timeline event kind。
- `ts-core-contracts`：`SubmitRequestCommand`/`SessionRecord`/`UserSession`/`RequestRun` 增加 optional parent linkage + priority 字段；`sessionId` 变为 optional。
- `session-lane-scheduling`：priority scheduling 与 session lane scheduling 分离（per existing spec line 29）；priority 影响 dispatch 顺序，不影响 lane 内串行语义。
- `add-ts-invoked-agent-context-inheritance`（deferred）：继承上下文 subagent 场景。
- Remote agent registry + remote invocation（deferred）：`SubagentExecutionPort` 契约可扩展，首版只实现本地路径。

## 风险与取舍（Risks / Trade-offs）

- [风险] 子 run 同步等待导致父 request 长时间阻塞。-> timeout 由 effective subagent timeout 和 `AbortSignal` 治理。
- [风险] child session/run lifecycle 管理不当导致资源泄漏。-> `submit()` 由 runtime 拥有 child session/run lifecycle；Tool 不持有引用。
- [风险] parent cancel 时 child run 未被 cancel。-> 首版通过 `AbortSignal` 同步传播；异步 cancellation cascade defer 到后续 change。
- [风险] frozen core contract 变更影响现有 session/run。-> parent linkage + priority 字段为 optional，`sessionId` 变为 optional 但现有调用方仍提供 sessionId，行为不变。
- [风险] subagent 占满全局并发配额导致顶层请求饿死。-> priority scheduling 保证顶层请求（NORMAL）优先于 subagent（LOW）获得释放的槽位。
- [取舍] 首版只实现本地路径，远端 agent 返回 safe error。-> 契约可扩展，远端路径 defer 到后续 change。
- [取舍] 首版不支持异步/background、继承上下文。-> 独立上下文 + 同步 completed 安全边界最干净。
- [取舍] 不实现 host agent 路由策略。-> 本 change 只定义 `submit({ agentId })` 契约能力，路由策略实现由路由层承载。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/agent-tool/spec.md`：工具黑盒规格、输入输出 schema、错误码、budget 规则、self-invocation 禁止、capability resolver 约束、`SubagentExecutionPort` 契约、fresh context isolation、parent linkage、priority scheduling、no-nesting。
- 修改 `openspec/specs/ts-core-contracts/spec.md`：`SubmitRequestCommand`（sessionId optional + agentId + parent linkage + priority）、`SessionRecord`/`UserSession`/`RequestRun` parent linkage + priority 字段、`RequestPriority` enum。
- 更新 `openspec/designs/modules/agent-capability.md`：补充 Agent tool 入口边界和 `SubagentExecutionPort` 依赖。
- 更新 `openspec/designs/modules/agent-runtime.md`：补充 `SubagentExecutionPort` 实现、`submit()` session 创建和 priority 调度。
- 更新 `openspec/designs/architecture/capability-spi.md`：补充 Agent tool 复用 `RuntimeCapabilityResolver` 和 `SubagentExecutionPort` 的转接边界。
- 更新 `openspec/designs/spec-to-design-map.md`：新增 `agent-tool` 导航。
