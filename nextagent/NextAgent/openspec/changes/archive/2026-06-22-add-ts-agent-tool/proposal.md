## 背景与问题（Why）

模型在 model-driven loop 中需要通过受治理的 Tool 入口调用另一个 Agent，用于委派探索、规划、校验等独立子任务。被调用的 Agent 可能是本地 subagent（builtin/local assembly），也可能是远端 agent（通过 Agent Registry 发现，future）。当前系统具备 AGENT capability discovery（`add-ts-invoked-agent-discovery`）和 `CapabilityInvocationPort` dispatch 基础设施，但缺少：

1. AGENT capability executor：`GovernedCapabilityInvocationPort` 对 `kind="AGENT"` 显式返回 `AGENT_CAPABILITY_EXECUTOR_UNAVAILABLE`（`executor.ts:126-128`）。
2. Tool 层 invocation port 依赖：`ToolDependencies` 只有 `approval`/`sandbox`/`workspaceFiles`/`skillSources`。
3. `submit()` 不支持指定目标 agent 和创建 child session：当前 `submit()` 的 agentId 来自 session，无法在 submit 时指定 agent；`sessionId` 是 required，无法让 `submit()` 内部创建 session。
4. Parent-child session/run/message 关联：`SessionRecord`、`UserSession`、`RequestRun` 没有 parent linkage 字段，无法追溯 subagent invocation chain。
5. 优先级调度：subagent 和顶层请求共用并发配额，需要优先级保证顶层请求不被 subagent 饿死。

本 change 补齐从 Tool 入口到子 agent 终态返回的全流程，聚焦**独立上下文（isolated context）**场景：子 Agent 使用 fresh context，不继承父 Agent 的对话历史、timeline、attachments 或 active context；但子 session/run/message **必须关联**父 agent 的 session/run/message，用于 traceability、cancellation cascade、timeline correlation 和 audit。**继承上下文**场景（子 Agent 可见父 context、结果回流父 context）显式 defer 到 `add-ts-invoked-agent-context-inheritance`。

本 change 实现本地 subagent 路径。远端 agent 路径（通过 Agent Registry 发现并调用远端 agent）defer 到后续 change，但 `SubagentExecutionPort` 契约设计为可扩展以支持远端 dispatch。

## 变更范围（What Changes）

- 新增 `Agent` tool entry 的 descriptor、input/output schema 和 safe result 语义。
- 新增 `SubagentExecutionPort` 契约（`agent-contracts/capability`）：从父 run 上下文调用 `submit()`（由 `submit()` 内部创建 child session + child run + 执行目标 Agent）、同步等待终态、返回安全终态文本。Port 根据 `descriptor.provider.providerKind` 内部分发本地 vs 远端路径；首版只实现本地路径。
- 修改 `SubmitRequestCommand`：`sessionId` 从 required 变为 optional；增加 optional `agentId?`（仅在无 `sessionId` 时使用，有 `sessionId` 时不可覆盖 `session.agentId`——session-bound Agent Scope）、`agentVersion?`（pin 特定 assembly 版本）、`parentSessionId?`/`parentRunId?`/`parentRequestId?`（child session parent linkage）、`priority?`（调度优先级）。`submit()` 是 agent 调度的唯一控制点：有 `sessionId` 时验证 session 可用性 + 用户可访问性，run 的 agentId 为 `session.agentId`（不允许 override）；无 `sessionId` 时用 `agentId` 创建新 session。
- 在 frozen core contract 上增加 optional parent linkage 字段：`SessionRecord`/`UserSession` 增加 `parentSessionId?`/`parentRunId?`/`parentRequestId?`；`RequestRun` 增加 `parentRunId?`/`parentRequestId?`/`priority?`。
- 在 `agent-runtime` 实现 `SubagentExecutionPort` 本地路径：调用 `submit({ agentId, parentSessionId, parentRunId, parentRequestId, priority: "LOW", ... })`、同步等待终态（通过 `RuntimeEventStreamPort.streamEvents`）、terminal text 提取。不重复 `submit()` 已有的 session/run 创建、context assembly、agent execution、timeline、terminal commit 逻辑。
- 在 `agent-capability` 的 `tool-spi.ts` 增加 `SubagentExecutionPort` 依赖，使 Agent tool 的 `execute()` 能提交子 run。
- 禁止嵌套：`submit()` 检测 `parentRunId` 存在时自动注入 `forbiddenCapabilityIds: ["Agent"]` 和 `allowSubagents: false` 到 routing constraints（框架架构规则，不可覆盖）。Agent tool 是默认开启的 builtin tool，同一 agent 既可作顶层（Agent tool 可用）又可作 subagent（Agent tool 不可用），因此 no-nesting 必须由框架在运行时根据 `parentRunId` 决定，不能由 assembly binding 配置控制。
- 定义 agent scope、owner scope、safe error 和 audit 的黑盒约束。
- 输入为 `{ agentId, prompt }`，输出为 `{ agentId, status: "completed", result: { text } }`；失败返回 safe failed result。

## Capability 影响（Capabilities）

### 新增 Capability

- `agent-tool`：builtin Tool descriptor（`kind="TOOL"`），模型通过受治理 Tool 入口请求调用另一个已治理的 AGENT capability。它本身不是 AGENT capability kind，也不新增 `CapabilityKind`。

## 影响范围（Impact）

- `agent-contracts`：
  - 新增 `SubagentExecutionPort`、`SubagentExecutionRequest`、`SubagentExecutionResult` 契约（`capability` subpath）。
  - 新增 `RequestPriority` enum（`"HIGH" | "NORMAL" | "LOW"`）（`agent-common`）。
  - 修改 `SubmitRequestCommand`（`runtime` subpath）：`sessionId` 变为 optional；增加 `agentId?`/`agentVersion?`/`parentSessionId?`/`parentRunId?`/`parentRequestId?`/`priority?`。
  - 修改 `CapabilityInvocationRequest`（`capability` subpath）：增加 optional `locale?`，使 tool 执行上下文能访问 request locale。
  - 修改 `SessionRecord`（`gateway` subpath）：增加 optional `parentSessionId?`/`parentRunId?`/`parentRequestId?`。
  - 修改 `UserSession`（`session` subpath）：增加 optional `parentSessionId?`/`parentRunId?`/`parentRequestId?`。
  - 修改 `RequestRun`（`runtime` subpath）：增加 optional `parentRunId?`/`parentRequestId?`/`priority?`。
- `agent-capability`：Agent tool descriptor、executor adapter、safe result mapping；在 `tool-spi.ts` 增加 capability contract-owned `SubagentExecutionPort` 依赖、`ToolExecutionContext.toolCallId` 和 `ToolExecutionContext.locale` 字段。Tool 只做 governance（resolve descriptor + validate），不做 assembly resolution。
- `agent-runtime`：
  - 修改 `submit()`：支持无 `sessionId` 时创建新 session（用 `agentId`）；支持 `parentSessionId` 时创建 child session；支持 `priority` 持久化到 `RequestRun.priority`；失败时记录 diagnostic log（accept-and-log，不清理 orphan child session）。
  - 修改 scheduler：将 `submit()` 的直接 dispatch 改为独立异步调度组件——`submit()` 只入队 + `wakeScheduler()`，scheduler 独立从队列按 priority（`HIGH > NORMAL > LOW`）跨 lane dispatch；增加全局执行门（`maxConcurrent`）和同步 reservation（work + lane + slot）防 race。
  - 实现 `SubagentExecutionPort` 本地路径（调用 `submit()` + 同步等待终态 + terminal text 提取 + 错误恢复）。
- `agent-context-engine`：无变更；child session 由 `submit()` 内部创建（无历史消息），fresh context 是 child session 创建的自然结果，不需要新增 context engine 逻辑。
- `agent-core`：无变更；`Agent.execute(run, context, signal)` 已是 agent 执行入口。
- `agent-app`：composition 中注册 Agent tool、绑定 `SubagentExecutionPort` 实现到 tool dependencies。
- `agent-platform-gateway-local`：`SessionRecord` 持久化增加 parent linkage 字段的 row mapping；`RequestRun` 持久化增加 `priority` 字段。

## 主要 Owner

- `agent-runtime`：拥有 `submit()` child session/run 创建、scheduler priority dispatch、`SubagentExecutionPort` 本地实现、child run lifecycle、terminal wait 和 cancellation。
- 协作边界：`agent-capability` 只拥有 Agent tool descriptor/executor adapter 和 safe result mapping；`agent-app` 只做 composition wiring；`agent-platform-gateway-local` 只做 parent linkage / priority persistence mapping。

## 非目标（Non-Goals）

- 不定义 Agent package/assembly 格式，由 `add-ts-agent-package-assembly` 承载。
- 不定义远端 Agent 协议、Agent Registry discovery、远端 agent 调用或 multi-agent recovery。`SubagentExecutionPort` 契约设计为可扩展，但首版只实现本地路径。
- 不在 `GovernedCapabilityInvocationPort` 注册 AGENT kind executor；Agent tool 直接调用 `SubagentExecutionPort`，不通过 `CapabilityInvocationPort` re-entrant 调用。
- 不定义**继承上下文** subagent 场景（子 Agent 可见父对话/timeline/attachments、结果回流父 context）；由 `add-ts-invoked-agent-context-inheritance` 承载。
- 不支持异步/background agent 调用或 `runRef` 观测路径；本 change 只做同步 completed 返回。
- 不新增 timeline event kind；parent-child 关联通过 `SessionRecord`/`RequestRun` 的 parent linkage 字段承载。
- 不实现 host agent 路由策略（intent recognition、fallback、multi-agent）；本 change 只定义 `submit({ agentId })` 契约能力，路由策略实现由路由层承载，可在后续 change 细化。
- 不允许 Agent tool 绕过 capability governance、capability resolver、agent scope 或 owner scope。
