## ADDED Requirements

### Requirement: 同轮工具调用受控并行执行

Agent core 在一个模型 round 中接收到多个已通过 routing constraint 的 ordinary tool call 时，SHALL 将这些 tool call 作为同一批独立行动并行调度。并行调度 MUST 不改变每轮 `maxToolCalls` 上限、`maxToolIterations` 上限、capability governance、sandbox boundary、pending input handoff、safe error、stream/history 一致性或 terminal commit 语义。

同一批 tool call 的结果 MUST 按模型返回的 tool call 顺序提交给下一轮模型，不能按工具完成顺序重排。若单个 tool call 返回 `FAILED` / `TIMED_OUT` safe result，系统 MUST 将该结果作为对应 tool call 的 safe failed result 回填，并保留同批其他已完成 tool call 的结果，除非请求级 `AbortSignal` 已触发。Capability invocation 抛出的异常沿用既有 request failure 语义。

#### Scenario: 同轮多个工具调用并行启动

- **WHEN** 模型在同一 round 返回 2 到 5 个 tool call
- **AND** routing constraint 允许这些 tool call 执行
- **THEN** Agent core MUST 在等待任一 tool call 完成前调度同批全部 tool call
- **AND** 同批实际调度数量 MUST 不超过当前 `maxToolCalls`
- **AND** capability invocation MUST 仍通过既有 capability invocation boundary 执行

#### Scenario: 工具结果按模型顺序回填

- **WHEN** 同一 round 的多个并行 tool call 以不同顺序完成
- **THEN** Agent core MUST 按模型返回的 tool call 顺序构造下一轮模型输入中的 tool result
- **AND** 完成顺序 MUST NOT 改变 tool result 的回填顺序

#### Scenario: 同轮单个工具失败不丢弃其他结果

- **WHEN** 同一 round 的多个并行 tool call 中至少一个返回 safe failed result
- **AND** 请求级 `AbortSignal` 未触发
- **THEN** Agent core MUST 将失败结果作为对应 tool call 的 tool result 回填
- **AND** 同批其他成功 tool call 的结果 MUST 继续回填
- **AND** 系统 MUST NOT 因单个 tool call 失败而跳过同批其他已调度 tool call 的结果

#### Scenario: 并行工具调用日志可定位到批次内具体调用

- **WHEN** Agent core 在同一 round 并行调度多个 ordinary tool call
- **THEN** runtime log MUST include stable request coordinates and the tool identity
- **AND** runtime log SHOULD include same-round batch diagnostics sufficient to identify the tool call ordinal and batch size
- **AND** completion logs SHOULD distinguish capability invocation duration from ordered-result-finalization wait time

#### Scenario: 请求取消传播到同批工具调用

- **WHEN** 同一 round 的多个 tool call 正在并行执行
- **AND** 请求级 `AbortSignal` 被触发
- **THEN** Agent core MUST 将同一个取消信号传递给同批全部 capability invocation
- **AND** 请求终止结果 MUST 继续遵守既有 safe error 和 terminal consistency 契约

#### Scenario: 每轮工具调用上限不因并行提升

- **WHEN** 模型在一个 round 返回超过当前 `maxToolCalls` 的 tool call
- **THEN** Agent core MUST 在调度任何 tool call 前拒绝该 round
- **AND** 拒绝行为 MUST 与既有 `TOOL_CALL_LIMIT_EXCEEDED` 安全失败语义一致
- **AND** 并行执行能力 MUST NOT 将每轮工具调用上限提升到 5 以上

#### Scenario: Pending-input 工具保持互斥语义

- **WHEN** 同一 round 的 tool call 批次包含会创建 runtime-owned pending input 的工具调用
- **THEN** Agent core MUST preserve the existing pending input handoff semantics for that tool call
- **AND** Agent core MUST NOT invoke tool calls that appear after the pending-input tool call before the run is resumed
- **AND** 并行执行能力 MUST NOT create multiple pending input facts from one model round
