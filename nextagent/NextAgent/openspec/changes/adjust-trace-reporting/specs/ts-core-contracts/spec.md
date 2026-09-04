# ts-core-contracts Specification Delta

## ADDED Requirements

### Requirement: 外部调用方可通过 RuntimeCommandPort 获取 ExecutionCorrelationPort

`RuntimeCommandPort` 实现类 SHALL 暴露 `getExecutionCorrelation()` 方法，返回 `ExecutionCorrelationPort | undefined`。该返回值与 runtime 内部使用的 `executionCorrelation` 是同一实例。外部调用方 MUST 通过该方法获取 `ExecutionCorrelationPort`，并使用 `withIncomingCarrier(carrier, operation)` 将 W3C trace 上下文注入 `incomingCarrier` ALS，随后在 `operation` 回调中调用 `submit` 或 `answerPendingInput`。

`getExecutionCorrelation()` 返回 `undefined` 时，外部调用方 MUST 直接调用 runtime 方法，不注入 trace 上下文。`withIncomingCarrier` 的 `incomingCarrier` ALS 只在 `REQUEST_ACCEPTED` timeline event 写入时被消费以创建 Request Span parent；该事件在 `submit` 方法体同步路径内写入，ALS 在 enqueue 异步执行前已退出 scope。后续子 Span（model/tool/workflow_node）的 parent 通过 `requestSpanContext(requestRunId)` 从 registry 查找，不依赖 `incomingCarrier` ALS。对于 `answerPendingInput`，resume 路径直接 `await executeQueuedWork` 在同一 async chain 内执行，ALS 可传播。

trace carrier 中的 `traceparent` 和 `tracestate` 的 W3C 语法校验 MUST 由 `agent-observability` 的 `parseIncomingCarrier` 统一完成。trace carrier MUST NOT 进入 `DiagnosticContext`、public DTO、gateway Record、timeline payload 或 runtime command 字段。

**需求类别**：功能性需求

#### Scenario: 外部调用方通过 getExecutionCorrelation 注入 trace 上下文

- **WHEN** 外部调用方获取 `runtime.getExecutionCorrelation()` 返回非 `undefined`
- **AND** 调用方构造合法 `W3CTraceCarrier`（包含 `traceparent`）
- **AND** 调用 `withIncomingCarrier(carrier, () => runtime.submit(command))`
- **THEN** runtime MUST 在 `incomingCarrier` ALS 中持有入站 SpanContext
- **AND** 后续 Request Span 创建 MUST 以入站 carrier 的 SpanContext 作为 parent

#### Scenario: getExecutionCorrelation 返回 undefined 时直接调用

- **WHEN** `runtime.getExecutionCorrelation()` 返回 `undefined`
- **THEN** 调用方 MUST 直接调用 `runtime.submit(command)`
- **AND` 行为 MUST 与 trace 未启用时完全一致

#### Scenario: traceparent 格式非法时安全降级

- **WHEN** `W3CTraceCarrier.traceparent` 格式非法、全零或超长
- **THEN** `parseIncomingCarrier` MUST 返回 `undefined`
- **AND` runtime MUST 正常执行 submit/answerPendingInput 逻辑
- **AND` Request Span MUST 作为 root span 创建（无 parent）

#### Scenario: trace carrier 不进入 DiagnosticContext 或 gateway Record

- **WHEN** trace carrier 通过 `withIncomingCarrier` 注入
- **THEN` trace carrier MUST NOT 出现在 `DiagnosticContext`、Web response DTO、gateway Record 或 timeline payload
- **AND` trace carrier 的唯一效果是注入 `incomingCarrier` ALS

#### Scenario: submit 异步执行不依赖 incomingCarrier ALS

- **WHEN** `submit` 将 work enqueue 到 scheduler 队列后返回
- **AND` scheduler 异步执行 `executeQueuedWork`
- **THEN` `incomingCarrier` ALS MAY 已退出 scope
- **AND` 子 Span 创建 MUST 通过 `requestSpanContext(requestRunId)` 从 registry 查找 parent
- **AND` MUST NOT 依赖 `incomingCarrier` ALS 获取子 Span parent
