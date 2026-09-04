# agent-tool Specification

## Purpose

定义受治理的本地 Agent 工具，使父 Agent 可以通过统一 Capability Catalog 和 runtime 拥有的 subagent 执行生命周期，把一个有界 prompt 委托给另一个可被模型调用的 Agent capability。
## Requirements
### Requirement: Agent 工具调用受治理且上下文隔离的 AGENT 能力

系统 SHALL 仅以 Tool entry 的形式暴露 `Agent` 工具，该工具请求一次已受治理且上下文隔离的 AGENT capability 调用。它 MUST NOT 绕过 capability governance、capability resolver、owner scope、agent scope、cancellation 或 audit 边界。subagent SHALL 以全新 context 运行，MUST NOT 继承父级会话历史、timeline、附件或 active context。

`Agent` 工具的输入 SHALL 为 `{ agentId: string, prompt: string }`，并带有 `additionalProperties: false`。`prompt` MUST NOT 超过 `8192` UTF-8 bytes，并作为 subagent run 的第一条用户消息。工具 SHALL 在 `SubagentExecutionRequest` 中把 `context.toolCallId` 作为 `parentToolCallId` 传递，以保持可追溯性。

成功输出 SHALL 为 `{ agentId: string, status: "completed", result: { text: string } }`。`result.text` MUST 为 subagent terminal response 的安全文本投影，且 MUST NOT 超过 `100_000` UTF-8 bytes。`result.text` MUST NOT 暴露原始 prompt、provider 私有 metadata、credential、raw provider error、路径或高基数字段。

#### Scenario: Agent 工具提交受治理的委托并返回 completed 结果
- **WHEN** 模型以有效的 `agentId` 和 `prompt` 调用 `Agent`
- **THEN** 系统用 `additionalProperties: false` 校验输入 schema
- **AND** 通过 `RuntimeCapabilityResolver` 以 `kind="AGENT"` 解析目标
- **AND** 校验 descriptor 具备 `availabilityStatus="AVAILABLE"` 和 `modelInvocable=true`
- **AND** 通过 `SubagentExecutionPort` 提交，后者调用 `submit()` 创建 child session、child run 和全新 context
- **AND** 同步等待 child run 到达 terminal state
- **AND** 返回 `{ agentId, status: "completed", result: { text } }`，附带安全的 terminal response 投影。

#### Scenario: Subagent 以隔离 context 运行
- **WHEN** 一次 `Agent` 工具调用被接受
- **THEN** subagent run MUST 使用全新 context
- **AND** 它 MUST NOT 继承父级会话历史、timeline、附件或 active context
- **AND** 工具结果 MUST 只在 `result.text` 中包含安全的 terminal response 投影
- **AND** 工具结果 MUST NOT 包含 child run 内部状态、原始 prompt、hidden context 或目标 Agent 私有配置。

#### Scenario: 超限 prompt 被拒绝
- **WHEN** `prompt` 超过 `8192` UTF-8 bytes
- **THEN** 系统以 reason code `INVALID_INPUT` 拒绝该调用
- **AND** 它不解析目标，也不提交 child run。

#### Scenario: 自我调用被拒绝
- **WHEN** `agentId` 等于当前父 Agent 的 `agentId`
- **THEN** 系统以 reason code `SELF_INVOCATION_REJECTED` 拒绝该调用
- **AND** 它不解析目标，也不提交 child run。

#### Scenario: 目标 Agent 不可用
- **WHEN** `RuntimeCapabilityResolver.resolveCapability()` 返回 `undefined`（目标不存在、未绑定、非 default-visible，或绑定被禁用），或解析出的 descriptor 具有 `availabilityStatus !== "AVAILABLE"` 或 `modelInvocable !== true`
- **THEN** 系统以 reason code `AGENT_NOT_AVAILABLE` 拒绝该调用
- **AND** 它不提交 child run。

#### Scenario: 模型提供的 scope 被忽略
- **WHEN** 工具输入包含类似 owner 或 agent scope 的字段
- **THEN** 这些字段 MUST 被 `additionalProperties: false` schema 校验拒绝
- **AND** 可信 scope MUST 只来自 app composition、已解析 assembly、session/run 或 runtime context。

### Requirement: Agent 工具通过受治理的 capability resolver 解析目标

`Agent` 工具 SHALL 只通过 `RuntimeCapabilityResolver.resolveCapability({ kind: "AGENT", capabilityId })` 解析目标 Agent。它 MUST NOT 通过临时 agent 列表、原始 assembly 扫描或不可信 metadata 解析目标。如果 resolver 返回 `undefined`，工具 SHALL 返回 `AGENT_NOT_AVAILABLE`。

#### Scenario: 目标通过 capability resolver 解析
- **WHEN** `Agent` 工具需要解析目标 Agent
- **THEN** 它 MUST 以 `kind="AGENT"` 和所请求的 `agentId` 调用 `RuntimeCapabilityResolver`
- **AND** 它 MUST NOT 读取原始 `agent.yaml`、扫描 `subagents/` 或使用不受治理的 agent 列表。

#### Scenario: Resolver 返回 undefined
- **WHEN** `RuntimeCapabilityResolver` 对所请求的 `agentId` 返回 `undefined`
- **THEN** 工具 MUST 返回 `AGENT_NOT_AVAILABLE`
- **AND** 它 MUST NOT 尝试通过其他路径进行 fallback 解析。

### Requirement: SubagentExecutionPort 调用 submit() 创建 child session 和 run

系统 SHALL 提供一个 `SubagentExecutionPort`，它调用 `RuntimeCommandPort.submit()`，其中 `agentId` 设为目标 Agent，并带 `parentSessionId`/`parentRunId`/`parentRequestId` 用于父级关联。`submit()` SHALL 创建一个 child `Session`（绑定到目标 Agent 的 `agentId` 并带父级关联）和一个 child `RequestRun`，执行目标 Agent 的 model loop，并通过既有 `AgentRunStatePort` 持久化 timeline。该 port SHALL 同步等待 child run 到达 terminal state 并返回安全的 terminal response 投影。该 port SHALL NOT 直接创建 session、run、调用 `AgentInstanceManager.getOrCreate` 或调用 `Agent.execute()`。

#### Scenario: SubagentExecutionPort 以 agentId 和父级关联调用 submit
- **WHEN** `SubagentExecutionPort.executeSubagent` 被调用
- **THEN** 它 MUST 通过 `assemblyRegistry` 解析目标 assembly（若存在 `targetAgentVersion` 则使用它，否则使用 `active()`）
- **AND** 它 MUST 从 `assembly.runtimeSettings.requestTimeoutMs` 提取 `timeoutMs`
- **AND** 它 MUST 以已解析 assembly 的 `agentId` 和 `agentVersion` 调用 `submit()`
- **AND** 它 MUST 在 `SubmitRequestCommand` 中包含 `parentSessionId`、`parentRunId` 和 `parentRequestId`
- **AND** 它 MUST NOT 包含 `sessionId`（submit 会创建新的 child session）
- **AND** 它 MUST 把 `priority` 设为 `"LOW"`
- **AND** 它 MUST NOT 设置 `forbiddenCapabilityIds` 或 `allowSubagents`（submit 自动强制 no-nesting）。
- **AND** 它 MUST 基于 `targetProviderKind` 分发：`BUNDLED`/`LOCAL_DIRECTORY` 走 local，其他 kind 返回 safe error

#### Scenario: submit() 以目标 agentId 和父级关联创建 child session
- **WHEN** `submit()` 收到一个带 `agentId` 和 `parentSessionId` 但不带 `sessionId` 的 command
- **THEN** 它 MUST 用 command 中的 `agentId` 创建一个 child `Session`
- **AND** 它 MUST 在 child session 上设置 `parentSessionId`、`parentRunId` 和 `parentRequestId`
- **AND** 它 MUST 从 command 继承 `identityContext`（owner scope）。

#### Scenario: submit() 以目标 scope 创建 child run
- **WHEN** 一个 child session 由 `submit()` 创建
- **THEN** child `RequestRun` MUST 具有来自目标 assembly 的 `agentId`/`agentVersion`/`agentAssemblyRef`
- **AND** 它 MUST 具有链接到父 run 的 `parentRunId` 和 `parentRequestId`
- **AND** 它 MUST 具有 command 所设置的 `priority`。

#### Scenario: Port 同步等待 child run terminal state
- **WHEN** `submit()` 返回 `RequestAccepted`
- **THEN** port MUST 通过 `RuntimeEventStreamPort.streamEvents` 同步等待 child run 到达 terminal state
- **AND** 它 MUST 等待 `REQUEST_COMPLETED`、`REQUEST_FAILED` 或 `REQUEST_CANCELED` 事件
- **AND** 它 MUST 遵守 `timeoutMs` 和 `AbortSignal`。

#### Scenario: 从 child run 提取 terminal text
- **WHEN** child run 到达 terminal state
- **THEN** port MUST 通过 `RuntimeSessionPort.listMessages` 从 child run 最后一条 `role="ASSISTANT"` message 提取安全的 terminal response 文本
- **AND** 若不存在 assistant message，`terminalText` MUST 为空字符串
- **AND** 它 MUST 返回带 `status`、`terminalText`、`childSessionId` 和 `childRunId` 的 `SubagentExecutionResult`
- **AND** `terminalText` MUST NOT 超过 `100_000` UTF-8 bytes。

#### Scenario: stream 断开且 run 已不活跃后恢复 terminal text
- **WHEN** `RuntimeEventStreamPort.streamEvents` 在 child run 已离开 active run 集合之后断开
- **THEN** port MUST 在返回失败之前调用 `RuntimeSessionPort.listMessages`
- **AND** 若 messages 中包含 assistant terminal response，port MUST 返回 `status="COMPLETED"` 并附带该安全 terminal text
- **AND** 若 message page 存在但为空，port MUST 返回 `status="FAILED"` 并附带与 not-found 不同的 safe error
- **AND** 若 message page 不存在，port MUST 返回 `status="FAILED"` 并附带 not-found safe error
- **AND** 只要 child submit 已被接受，结果 MUST 包含 `childSessionId` 和 `childRunId`。

#### Scenario: Abort 或 timeout 取消 child run
- **WHEN** port 收到 `AbortSignal` 取消或 `timeoutMs` 到期
- **THEN** 它 MUST 通过带 `action="CANCEL"` 的 `RequestControlCommand` 取消 child run
- **AND** 它 MUST 返回带 `status="CANCELED"` 或 `status="TIMED_OUT"` 的 `SubagentExecutionResult`。

#### Scenario: Child run 失败返回 safe error
- **WHEN** child run 失败
- **THEN** port MUST 返回带 `status="FAILED"` 和 `safeError` 的 `SubagentExecutionResult`
- **AND** `safeError` MUST NOT 暴露原始 prompt、provider error 或 child run 内部状态。

#### Scenario: 远程 providerKind 返回 safe error
- **WHEN** `request.targetProviderKind` 不是 `BUNDLED` 或 `LOCAL_DIRECTORY`（例如 `AGENT_REGISTRY`）
- **THEN** port MUST 返回带 `status="FAILED"` 和 safe error 的 `SubagentExecutionResult`，该 safe error 表明远程 agent 执行尚不受支持
- **AND** 它 MUST NOT 尝试远程调用。

### Requirement: Subagent run 的调度优先级低于顶层 request

Subagent run SHALL 以 `priority="LOW"` 提交。顶层用户 request SHALL 默认为 `priority="NORMAL"`。当并发槽位可用时，runtime scheduler SHALL 先分发 `NORMAL` 优先级 run，再分发 `LOW` 优先级 run。这确保顶层用户 request 不会被共享同一全局并发配额的 subagent run 饿死。

#### Scenario: Subagent run 以 LOW 优先级提交
- **WHEN** `SubagentExecutionPort` 为 child run 调用 `submit()`
- **THEN** `SubmitRequestCommand` MUST 包含 `priority: "LOW"`
- **AND** child `RequestRun` MUST 持久化 `priority: "LOW"`。

#### Scenario: 顶层 request 先于排队中的 subagent 被调度
- **WHEN** 一个顶层 request（`NORMAL`）和一个 subagent request（`LOW`）都在排队
- **AND** 一个并发槽位变为可用
- **THEN** scheduler MUST 先分发 `NORMAL` request，再分发 `LOW` request。

### Requirement: 框架自动为 subagent 拒绝 child-run-only 工具

"subagent 不能再派生 subagent"和"subagent 不能直接向用户提问"是由框架强制执行的架构决策，而非用户配置。Agent 和 AskUserQuestion 工具是面向顶层用户 Agent 默认启用的 builtin 工具。同一个 agent assembly 既可以作为顶层 Agent（Agent 和 AskUserQuestion 可用），也可以作为 subagent（Agent 和 AskUserQuestion 被拒绝）。因此，工具可用性 MUST 由框架在运行时基于该 run 是否为 child run 来决定，而不是在 assembly/binding 配置时决定。

`submit()` SHALL 在 `parentRunId` 存在时，自动向 child run 的 routing constraints 注入包含 `"Agent"` 和 `"AskUserQuestion"` 的 `forbiddenCapabilityIds`，以及 `allowSubagents: false`。这是一条不可覆盖的框架规则 — 调用方不能为 child run 启用 Agent 或 AskUserQuestion 工具。`SubagentExecutionPort` 不设置这些约束；`submit()` 自动强制执行它们。

#### Scenario: submit() 为 child run 自动注入 no-nesting 约束
- **WHEN** `submit()` 创建一个带 `parentRunId` 的 child run
- **THEN** 它 MUST 自动向 routing constraints 注入包含 `"Agent"` 和 `"AskUserQuestion"` 的 `forbiddenCapabilityIds`
- **AND** 它 MUST 在 routing constraints 中自动设置 `allowSubagents: false`
- **AND** 这些约束 MUST NOT 可被调用方覆盖。

#### Scenario: Child run 的 capability catalog 排除 child-run-only 工具
- **WHEN** 一个 child run 由带 `parentRunId` 的 `submit()` 创建
- **THEN** child run 的 capability catalog MUST NOT 包含 Agent 工具 descriptor
- **AND** child run 的 capability catalog MUST NOT 包含 AskUserQuestion 工具 descriptor
- **AND** child run 的 system prompt MUST NOT 将 Agent 或 AskUserQuestion 工具列为可用
- **AND** 模型 MUST NOT 能够调用 Agent 或 AskUserQuestion 工具。

#### Scenario: 同一 Agent 作为顶层与 subagent 时工具可用性不同
- **WHEN** agent A 作为顶层 Agent 被调用（无 `parentRunId`）
- **THEN** Agent 和 AskUserQuestion 工具 MUST 在其 capability catalog 中可用
- **AND** 当同一个 agent A 作为 subagent 被调用（带 `parentRunId`）时
- **THEN** Agent 和 AskUserQuestion 工具 MUST NOT 在其 capability catalog 中可用。

#### Scenario: SubagentExecutionPort 不设置 no-nesting 约束
- **WHEN** `SubagentExecutionPort` 为 child run 调用 `submit()`
- **THEN** 它 MUST NOT 在 `SubmitRequestCommand` 中设置 `forbiddenCapabilityIds` 或 `allowSubagents`
- **AND** `submit()` MUST 基于 `parentRunId` 自动强制执行 no-nesting。

### Requirement: Agent 工具不拥有 child session、run 或 lifecycle

`Agent` 工具 SHALL NOT 创建 child session、child run、写入 child run timeline、拥有 terminal commit 或拥有 canonical timeline。`SubagentExecutionPort` SHALL 只调用 `submit()` 并同步等待 terminal result。`submit()` SHALL 拥有 child session/run 创建、scope 继承、lifecycle、cancellation、terminal commit 和 terminal result 投影。

#### Scenario: 工具把 lifecycle 委托给 SubagentExecutionPort 和 submit()
- **WHEN** `Agent` 工具提交一次委托
- **THEN** 它 MUST 通过 `SubagentExecutionPort.executeSubagent` 提交
- **AND** `SubagentExecutionPort` MUST 调用 `submit()`，由后者创建 child session 和 run
- **AND** 工具 MUST NOT 创建 child session、child run、写入 child timeline 或执行 terminal commit。

#### Scenario: Timeout 或 abort 传播到 child run
- **WHEN** 工具收到 timeout 或 `AbortSignal` 取消
- **THEN** 它 MUST 把取消传播给 `SubagentExecutionPort.executeSubagent`
- **AND** `SubagentExecutionPort` MUST 通过 `RequestControlCommand(CANCEL)` 取消 child run
- **AND** 工具 MUST 返回 `TIMEOUT` 或 `ABORTED` 安全失败结果。

### Requirement: Agent 工具复用既有 audit 和 timeline 边界

`Agent` 工具 SHALL NOT 引入新的 audit schema、audit event kind 或 timeline event kind。capability 调用 audit SHALL 由既有 `invocation-audit` 边界拥有。child run timeline SHALL 由既有 `local-run-timeline-store` 边界通过 `AgentRunStatePort` 拥有。父子 session/run/message 关联 SHALL 由 `SessionRecord`/`UserSession`/`RequestRun` 上的可选父级关联字段承载，而不是由新的 event kind 承载。

#### Scenario: 无新增 audit 或 timeline contract
- **WHEN** 实现 `Agent` 工具
- **THEN** 它 MUST NOT 定义新的 audit event kind 或 timeline event kind
- **AND** 它 MUST 复用既有 `invocation-audit` 边界进行 capability 调用 audit
- **AND** child run timeline MUST 由 `submit()` 通过既有 `AgentRunStatePort` 持久化。

#### Scenario: 通过 contract 字段承载父子关联
- **WHEN** 创建一个 child session 和 run
- **THEN** 父子关联 MUST 由 `SessionRecord`/`UserSession` 上的 `parentSessionId`/`parentRunId`/`parentRequestId` 以及 `RequestRun` 上的 `parentRunId`/`parentRequestId` 承载
- **AND** 它 MUST NOT 依赖新的 timeline event kind 来承载父子关联。
