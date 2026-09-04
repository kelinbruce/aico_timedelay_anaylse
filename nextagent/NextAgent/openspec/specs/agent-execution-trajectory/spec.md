# agent-execution-trajectory Specification

## Purpose
定义 agent 执行轨迹首版的稳定复盘骨架，确保 context assembly、capability selection、sandbox execution、first visible model content 和 terminal outcome 能以安全摘要和稳定业务 refs 被重放，而不泄漏 raw prompt、raw output、tool payload 或 tracing SDK 字段。

## Requirements

### Requirement: Agent execution trajectory SHALL provide a stable replay skeleton

系统 MUST 为一次已接受 request 的 agent 执行过程提供可复盘的稳定轨迹骨架。首版骨架至少覆盖：context assembly 完成、capability selection、sandbox execution 完成、first visible model content 以及 terminal committed。

这些轨迹点 MUST 优先使用稳定业务关联键表达关联，包括 `sessionId`、`requestRunId`、`requestId`、`requestContextId` 和 `capabilityInvocationId`。当实现已经拥有稳定 turn ref 时 MAY 附带，但首版 MUST NOT 为了 replay 强行引入新的 tracing SDK 标识、fake turn id 或 traceparent/span id 作为业务主关联键。

#### Scenario: Request trajectory can be replayed by stable business refs
- **WHEN** 一个 request 在同一 run 中经历多轮 model/capability 执行后进入 terminal committed
- **THEN** 系统 MUST 能输出 context assembly、capability selection、sandbox execution、first visible model content 和 terminal 的安全轨迹点
- **AND** 这些轨迹点 MUST 带稳定的 `requestRunId`
- **AND** 复盘时无需依赖 raw prompt、raw model output 或 trace SDK 字段即可串起主执行路径

### Requirement: Context assembly trajectory SHALL record safe decision summaries only

系统 MUST 为每一轮 context assembly 输出安全的决策摘要轨迹。该轨迹只能记录低基数、可审计的决策字段，例如 budget decision、compression mode、reason code、omitted context type count、degradation mode count 和估算输入规模。

该轨迹 MUST NOT 记录 raw prompt、原始上下文正文、message body、tool result 正文、附件正文、free-text reasoning、路径、credential、token 或 provider raw payload。

#### Scenario: Context assembly completion is visible without leaking prompt material
- **WHEN** 一轮 request 在进入 model invocation 前完成 context assembly
- **THEN** 系统 MUST 输出 `CONTEXT_ASSEMBLY_COMPLETED` 轨迹点
- **AND** 该轨迹点 MUST 只包含安全摘要字段和稳定 refs
- **AND** 它 MUST NOT 包含上下文正文、prompt 文本或原始 message 内容

### Requirement: Capability selection and sandbox execution SHALL be separately observable

系统 MUST 把“选择 capability”与“执行 capability / sandbox”视为不同的轨迹阶段。`CAPABILITY_SELECTED` 用于表示 agent 已决定选择某个 capability；sandbox 相关轨迹用于表示受控执行阶段已经完成，而不是替代 capability 选择决策。

`CAPABILITY_SELECTED` 和 `SANDBOX_EXECUTION_COMPLETED` MUST 只记录 capability id、capability kind、toolCallId、selection reason code、command kind、outcome、reason code、durationMs 等安全字段。它们 MUST NOT 记录 raw tool args、raw tool output、resolved executable path、host path、stack trace 或 provider payload。

#### Scenario: Tool path distinguishes selection from execution
- **WHEN** 一轮 agent 执行选择了一个需要 sandbox 的 builtin tool
- **THEN** 系统 MUST 先输出 `CAPABILITY_SELECTED`
- **AND** 在 sandbox 阶段结束后输出 `SANDBOX_EXECUTION_COMPLETED`
- **AND** 复盘时可以区分“为何选择该工具”与“该工具如何执行结束”

### Requirement: First visible model content SHALL align internal execution with visible progression

系统 MUST 提供 first visible model content 对齐轨迹，使内部执行阶段能够与用户开始看到内容的时间点对应。首版实现使用 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` 表达该边界，而不是新增独立的 `STREAM_VISIBLE_OUTPUT_STARTED` timeline vocabulary。

该轨迹 MUST 复用当前 request/run/turn 的稳定业务 refs，并且 MUST NOT 复制原始 stream delta 或最终正文内容。

#### Scenario: First visible model content can be correlated with the internal run
- **WHEN** 一个 request 已完成内部 model/capability 路径并开始向 channel 产生用户可见内容
- **THEN** 系统 MUST 输出 `MODEL_STREAM_FIRST_VISIBLE_CONTENT`
- **AND** 该轨迹点 MUST 可以与同一 `requestRunId` 对齐
- **AND** 它 MUST NOT 包含 raw stream delta 或正文内容

### Requirement: Trajectory degradation SHALL remain non-blocking

轨迹点发布、trajectory structured log 投影、trajectory audit 跳过或任何 trajectory diagnostics sink failure MUST NOT 改变 request lifecycle、terminal commit、stream projection、capability invocation、gateway response 或 health response 的业务结果。

发生 trajectory 相关失败时，系统 MUST 产生 bounded degradation evidence，而不是阻断主路径或伪造轨迹成功。

#### Scenario: Trajectory projection failure does not change terminal truth
- **WHEN** trajectory 轨迹点已经被创建但在 observability 投影阶段失败
- **THEN** request terminal truth MUST 保持不变
- **AND** 系统 MUST 记录 bounded degradation evidence
- **AND** 主路径 MUST NOT 因 trajectory 失败而回滚或阻塞
