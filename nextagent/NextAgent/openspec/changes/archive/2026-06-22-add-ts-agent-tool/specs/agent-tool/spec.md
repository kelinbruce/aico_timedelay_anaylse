## ADDED Requirements

### Requirement: Agent 工具调用受治理且上下文隔离的 AGENT 能力

系统 SHALL 仅以 Tool entry 的形式暴露 `Agent` 工具，该工具请求一次已受治理且带有隔离上下文的 AGENT 能力调用。它 MUST NOT 绕过 capability governance、capability resolver、owner scope、agent scope、cancellation 或 audit 边界。subagent SHALL 以全新 context 运行，且 MUST NOT 继承父级 conversation history、timeline、attachment 或 active context。

`Agent` 工具输入 SHALL 是 `{ agentId: string, prompt: string }` 并带有 `additionalProperties: false`。`prompt` MUST NOT 超过 `8192` UTF-8 字节，并作为 subagent run 的第一条用户 message。工具 SHALL 在 `SubagentExecutionRequest` 中传递 `context.toolCallId` 作为 `parentToolCallId` 以提供可追溯性。

成功输出 SHALL 是 `{ agentId: string, status: "completed", result: { text: string } }`。`result.text` MUST 是 subagent 终端响应的安全文本投影，且 MUST NOT 超过 `100_000` UTF-8 字节。`result.text` MUST NOT 暴露原始 prompt、provider 私有元数据、credential、原始 provider 错误、路径或高基数字段。

#### Scenario: Agent 工具提交受治理的委托并返回 completed 结果
- **WHEN** 模型以有效的 `agentId` 和 `prompt` 调用 `Agent`
- **THEN** 系统用 `additionalProperties: false` 校验输入 schema
- **AND** 通过 `RuntimeCapabilityResolver` 以 `kind="AGENT"` 解析目标
- **AND** 校验 descriptor 具有 `availabilityStatus="AVAILABLE"` 和 `modelInvocable=true`
- **AND** 通过 `SubagentExecutionPort` 提交，后者调用 `submit()` 创建子 session、子 run 和全新 context
- **AND** 同步等待子 run 终端状态
- **AND** 返回 `{ agentId, status: "completed", result: { text } }`，其中是安全的终端响应投影。

#### Scenario: Subagent 以隔离上下文运行
- **WHEN** 一次 `Agent` 工具调用被接受
- **THEN** subagent run MUST 使用全新 context
- **AND** 它 MUST NOT 继承父级 conversation history、timeline、attachment 或 active context
- **AND** 工具结果 MUST 只在 `result.text` 中包含安全的终端响应投影
- **AND** 工具结果 MUST NOT 包含子 run 内部状态、原始 prompt、隐藏 context 或目标 Agent 私有配置。

#### Scenario: 超大 prompt 被拒绝
- **WHEN** `prompt` 超过 `8192` UTF-8 字节
- **THEN** 系统以 reason code `INVALID_INPUT` 拒绝该调用
- **AND** 它不解析目标也不提交子 run。

#### Scenario: 自调用被拒绝
- **WHEN** `agentId` 等于当前父级 agent 的 `agentId`
- **THEN** 系统以 reason code `SELF_INVOCATION_REJECTED` 拒绝该调用
- **AND** 它不解析目标也不提交子 run。

#### Scenario: 目标 agent 不可用
- **WHEN** `RuntimeCapabilityResolver.resolveCapability()` 返回 `undefined`（目标不存在、未被绑定、非默认可见或 binding 被禁用），或解析出的 descriptor 具有 `availabilityStatus !== "AVAILABLE"` 或 `modelInvocable !== true`
- **THEN** 系统以 reason code `AGENT_NOT_AVAILABLE` 拒绝该调用
- **AND** 它不提交子 run。

#### Scenario: Model 提供的 scope 被忽略
- **WHEN** 工具输入包含 owner 或 agent scope 类字段
- **THEN** 这些字段 MUST 被 `additionalProperties: false` schema 校验拒绝
- **AND** 可信 scope MUST 只来自 app composition、解析后的 assembly、session/run 或 runtime context。

### Requirement: Agent 工具通过受治理的 capability resolver 解析目标

`Agent` 工具 SHALL 只通过 `RuntimeCapabilityResolver.resolveCapability({ kind: "AGENT", capabilityId })` 解析目标 agent。它 MUST NOT 通过临时 agent 列表、raw assembly 扫描或不可信元数据解析目标。如果 resolver 返回 `undefined`，工具 SHALL 返回 `AGENT_NOT_AVAILABLE`。

#### Scenario: 通过 capability resolver 解析目标
- **WHEN** `Agent` 工具需要解析目标 agent
- **THEN** 它 MUST 以 `kind="AGENT"` 和请求的 `agentId` 调用 `RuntimeCapabilityResolver`
- **AND** 它 MUST NOT 读取 raw `agent.yaml`、扫描 `subagents/` 或使用未治理的 agent 列表。

#### Scenario: Resolver 返回 undefined
- **WHEN** `RuntimeCapabilityResolver` 对请求的 `agentId` 返回 `undefined`
- **THEN** 工具 MUST 返回 `AGENT_NOT_AVAILABLE`
- **AND** 它 MUST NOT 尝试通过其他路径进行回退解析。

### Requirement: SubagentExecutionPort 调用 submit() 创建子 session 和 run

系统 SHALL 提供一个 `SubagentExecutionPort`，它调用 `RuntimeCommandPort.submit()`，其中 `agentId` 设置为目标 agent，并带有用于父级关联的 `parentSessionId`/`parentRunId`/`parentRequestId`。`submit()` SHALL 创建一个子 `Session`（绑定到目标 agent 的 `agentId` 并带有父级关联）和一个子 `RequestRun`，执行目标 Agent 的 model 循环，并通过既有 `AgentRunStatePort` 持久化 timeline。该 port SHALL 同步等待子 run 终端状态并返回安全的终端响应投影。该 port SHALL NOT 直接创建 session、run、调用 `AgentInstanceManager.getOrCreate` 或调用 `Agent.execute()`。

#### Scenario: SubagentExecutionPort 以 agentId 和父级关联调用 submit
- **WHEN** 调用 `SubagentExecutionPort.executeSubagent`
- **THEN** 它 MUST 通过 `assemblyRegistry` 解析目标 assembly（如果存在则使用 `targetAgentVersion`，否则使用 `active()`）
- **AND** 它 MUST 从 `assembly.runtimeSettings.requestTimeoutMs` 提取 `timeoutMs`
- **AND** 它 MUST 以解析出的 assembly 中的 `agentId` 和 `agentVersion` 调用 `submit()`
- **AND** 它 MUST 在 `SubmitRequestCommand` 中包含 `parentSessionId`、`parentRunId` 和 `parentRequestId`
- **AND** 它 MUST NOT 包含 `sessionId`（submit 会创建一个新的子 session）
- **AND** 它 MUST 将 `priority` 设置为 `"LOW"`
- **AND** 它 MUST NOT 设置 `forbiddenCapabilityIds` 或 `allowSubagents`（submit 自动强制 no-nesting）。
- **AND** 它 MUST 基于 `targetProviderKind` 分发：`BUNDLED`/`LOCAL_DIRECTORY` 走 local，其他 kind 返回 safe error

#### Scenario: submit() 创建带目标 agentId 和父级关联的子 session
- **WHEN** `submit()` 收到一个带有 `agentId` 和 `parentSessionId` 但没有 `sessionId` 的 command
- **THEN** 它 MUST 用 command 中的 `agentId` 创建一个子 `Session`
- **AND** 它 MUST 在子 session 上设置 `parentSessionId`、`parentRunId` 和 `parentRequestId`
- **AND** 它 MUST 从 command 继承 `identityContext`（owner scope）。

#### Scenario: submit() 创建带目标 scope 的子 run
- **WHEN** 一个子 session 被 `submit()` 创建
- **THEN** 子 `RequestRun` MUST 具有来自目标 assembly 的 `agentId`/`agentVersion`/`agentAssemblyRef`
- **AND** 它 MUST 具有链接到父 run 的 `parentRunId` 和 `parentRequestId`
- **AND** 它 MUST 具有从 command 设置的 `priority`。

#### Scenario: Port 同步等待子 run 终端状态
- **WHEN** `submit()` 返回 `RequestAccepted`
- **THEN** port MUST 通过 `RuntimeEventStreamPort.streamEvents` 同步等待子 run 到达终端状态
- **AND** 它 MUST 等待 `REQUEST_COMPLETED`、`REQUEST_FAILED` 或 `REQUEST_CANCELED` 事件
- **AND** 它 MUST 尊重 `timeoutMs` 和 `AbortSignal`。

#### Scenario: 从子 run 提取终端文本
- **WHEN** 子 run 到达终端状态
- **THEN** port MUST 通过 `RuntimeSessionPort.listMessages` 从子 run 最后一条 `role="ASSISTANT"` message 提取安全的终端响应文本
- **AND** 如果不存在 assistant message，`terminalText` MUST 是空字符串
- **AND** 它 MUST 返回带有 `status`、`terminalText`、`childSessionId` 和 `childRunId` 的 `SubagentExecutionResult`
- **AND** `terminalText` MUST NOT 超过 `100_000` UTF-8 字节。

#### Scenario: 流中断且 run 已不活跃后恢复终端文本
- **WHEN** `RuntimeEventStreamPort.streamEvents` 在子 run 已离开 active run 集合后中断
- **THEN** port MUST 在返回失败前调用 `RuntimeSessionPort.listMessages`
- **AND** 如果 message 中包含 assistant 终端响应，port MUST 返回 `status="COMPLETED"` 和该安全的终端文本
- **AND** 如果 message 页存在但为空，port MUST 返回 `status="FAILED"` 和一个与 not-found 不同的 safe error
- **AND** 如果 message 页未找到，port MUST 返回 `status="FAILED"` 和一个 not-found 的 safe error
- **AND** 只要子 submit 已被接受，结果 MUST 包含 `childSessionId` 和 `childRunId`。

#### Scenario: Abort 或超时取消子 run
- **WHEN** port 收到 `AbortSignal` cancellation 或 `timeoutMs` 到期
- **THEN** 它 MUST 通过 `RequestControlCommand` 以 `action="CANCEL"` 取消子 run
- **AND** 它 MUST 返回 `status="CANCELED"` 或 `status="TIMED_OUT"` 的 `SubagentExecutionResult`。

#### Scenario: 子 run 失败返回 safe error
- **WHEN** 子 run 失败
- **THEN** port MUST 返回带有 `status="FAILED"` 和 `safeError` 的 `SubagentExecutionResult`
- **AND** 该 `safeError` MUST NOT 暴露原始 prompt、provider 错误或内部子 run 状态。

#### Scenario: 远程 providerKind 返回 safe error
- **WHEN** `request.targetProviderKind` 不是 `BUNDLED` 或 `LOCAL_DIRECTORY`（例如 `AGENT_REGISTRY`）
- **THEN** port MUST 返回带有 `status="FAILED"` 和指示远程 agent 执行尚不支持的 safe error 的 `SubagentExecutionResult`
- **AND** 它 MUST NOT 尝试远程调用。

### Requirement: Subagent run 的调度优先级低于顶层请求

Subagent run SHALL 以 `priority="LOW"` 提交。顶层用户请求 SHALL 默认为 `priority="NORMAL"`。runtime scheduler SHALL 在并发槽位可用时先于 `LOW` 优先级 run 分发 `NORMAL` 优先级 run。这确保顶层用户请求不会因共享同一全局并发配额的 subagent run 而被饿死。

#### Scenario: Subagent run 以 LOW 优先级提交
- **WHEN** `SubagentExecutionPort` 为子 run 调用 `submit()`
- **THEN** `SubmitRequestCommand` MUST 包含 `priority: "LOW"`
- **AND** 子 `RequestRun` MUST 持久化 `priority: "LOW"`。

#### Scenario: 顶层请求先于排队的 subagent 被调度
- **WHEN** 一个顶层请求（`NORMAL`）和一个 subagent 请求（`LOW`）都在排队
- **AND** 一个并发槽位变为可用
- **THEN** scheduler MUST 先于 `LOW` 请求分发 `NORMAL` 请求。

### Requirement: 框架自动为子 run 拒绝 Agent 工具（no-nesting 架构规则）

"Subagent 不能再派生 subagent" 是由框架强制执行的架构决策，而非用户配置。Agent 工具是所有 agent 都可用的默认启用 builtin tool。同一个 agent assembly 既可以作为顶层 agent（Agent 工具可用），也可以作为 subagent（Agent 工具被拒绝）。因此，工具可用性 MUST 由框架在运行时基于该 run 是否为子 run 来决定，而不是在 assembly/binding 配置时决定。

`submit()` SHALL 在存在 `parentRunId` 时自动向子 run 的路由约束注入 `forbiddenCapabilityIds: ["Agent"]` 和 `allowSubagents: false`。这是一条不可覆盖的框架规则——调用方不能为子 run 启用 Agent 工具。`SubagentExecutionPort` 不设置这些约束；`submit()` 自动强制执行它们。

#### Scenario: submit() 为子 run 自动注入 no-nesting 约束
- **WHEN** `submit()` 创建一个带有 `parentRunId` 的子 run
- **THEN** 它 MUST 自动向路由约束注入 `forbiddenCapabilityIds: ["Agent"]`
- **AND** 它 MUST 在路由约束中自动设置 `allowSubagents: false`
- **AND** 这些约束 MUST NOT 可被调用方覆盖。

#### Scenario: 子 run capability catalog 排除 Agent 工具
- **WHEN** 一个子 run 由 `submit()` 以 `parentRunId` 创建
- **THEN** 子 run 的 capability catalog MUST NOT 包含 Agent 工具 descriptor
- **AND** 子 run 的 system prompt MUST NOT 将 Agent 工具列为可用
- **AND** model MUST 不能调用 Agent 工具。

#### Scenario: 同一 agent 作为顶层与 subagent 时具有不同的工具可用性
- **WHEN** agent A 作为顶层 agent 被调用（无 `parentRunId`）
- **THEN** Agent 工具 MUST 在其 capability catalog 中可用
- **AND** 当同一 agent A 作为 subagent 被调用时（带 `parentRunId`）
- **THEN** Agent 工具 MUST NOT 在其 capability catalog 中可用。

#### Scenario: SubagentExecutionPort 不设置 no-nesting 约束
- **WHEN** `SubagentExecutionPort` 为子 run 调用 `submit()`
- **THEN** 它 MUST NOT 在 `SubmitRequestCommand` 中设置 `forbiddenCapabilityIds` 或 `allowSubagents`
- **AND** `submit()` MUST 基于 `parentRunId` 自动强制 no-nesting。

### Requirement: Agent 工具不拥有子 session、run 或生命周期

`Agent` 工具 SHALL NOT 创建子 session、子 run、写入子 run timeline、拥有 terminal commit 或拥有 canonical timeline。`SubagentExecutionPort` SHALL 只调用 `submit()` 并同步等待终端结果。`submit()` SHALL 拥有子 session/run 创建、scope 继承、生命周期、cancellation、terminal commit 和终端结果投影。

#### Scenario: 工具将生命周期委托给 SubagentExecutionPort 和 submit()
- **WHEN** `Agent` 工具提交一个委托
- **THEN** 它 MUST 通过 `SubagentExecutionPort.executeSubagent` 提交
- **AND** `SubagentExecutionPort` MUST 调用 `submit()` 由后者创建子 session 和 run
- **AND** 该工具 MUST NOT 创建子 session、子 run、写入子 timeline 或执行 terminal commit。

#### Scenario: 超时或 abort 传播到子 run
- **WHEN** 工具收到超时或 `AbortSignal` cancellation
- **THEN** 它 MUST 将 cancellation 传播给 `SubagentExecutionPort.executeSubagent`
- **AND** `SubagentExecutionPort` MUST 通过 `RequestControlCommand(CANCEL)` 取消子 run
- **AND** 工具 MUST 返回 `TIMEOUT` 或 `ABORTED` 的安全失败结果。

### Requirement: Agent 工具复用既有 audit 和 timeline 边界

`Agent` 工具 SHALL NOT 引入新的 audit schema、audit 事件 kind 或 timeline 事件 kind。Capability invocation audit SHALL 由既有 `invocation-audit` 边界拥有。子 run timeline SHALL 由既有 `local-run-timeline-store` 边界通过 `AgentRunStatePort` 拥有。父子 session/run/message 关联 SHALL 由 `SessionRecord`/`UserSession`/`RequestRun` 上的可选父级关联字段承载，而不是由新的事件 kind 承载。

#### Scenario: 无新的 audit 或 timeline contract
- **WHEN** 实现 `Agent` 工具
- **THEN** 它 MUST NOT 定义新的 audit 事件 kind 或 timeline 事件 kind
- **AND** 它 MUST 复用既有 `invocation-audit` 边界进行 capability invocation audit
- **AND** 子 run timeline MUST 由 `submit()` 通过既有 `AgentRunStatePort` 持久化。

#### Scenario: 通过 contract 字段承载父子关联
- **WHEN** 创建一个子 session 和 run
- **THEN** 父子关联 MUST 由 `SessionRecord`/`UserSession` 上的 `parentSessionId`/`parentRunId`/`parentRequestId` 和 `RequestRun` 上的 `parentRunId`/`parentRequestId` 承载
- **AND** 它 MUST NOT 依赖新的 timeline 事件 kind 来承载父子关联。
