# trace-log-linking Specification Delta

## MODIFIED Requirements

### Requirement: trace/log linking 必须明确范围和安全排除

本 change SHALL 定义 request/run 诊断上下文传播、runtime `RunTimelineEvent` listener、诊断快照采集和统一观测输入。结构化日志 schema、audit truth、metric inventory、health judgment、runtime lifecycle state、trace context carrier、TraceDiagnosticRecord、local trace JSONL、remote trace adapter 和 OpenTelemetry exporter 行为继续由各自 change 拥有。

本 change 管辖的诊断输出必须只使用有界安全字段。raw prompt、raw thinking、raw model output、tool args/result、attachment content、raw provider response、credential、secret、token、stack trace、未脱敏本地路径、free-text reason、动态 payload 和开放式 usage/metric key 不属于 log、audit、metric、trace diagnostic、health diagnostic、runtime/channel DTO 或 gateway record 的允许输出形态。

`DiagnosticContext` MUST NOT 携带 `traceId`、`spanId` 或 `traceContext`。`agent-contracts`、公共业务 DTO 和 gateway Record MUST NOT 增加独立 trace ID、span ID 或 SDK context 字段；唯一持久化例外是 `RunTimelineEventRecord.inlinePayload.trace` 中由 trace-aware decorator 写入的受控 JSON snapshot。

外部调用方通过 `getExecutionCorrelation()` 获取 `ExecutionCorrelationPort`，并使用 `withIncomingCarrier(carrier, operation)` 注入 trace carrier 到 `incomingCarrier` ALS。trace carrier 只存在于 `withIncomingCarrier` 的 ALS scope 内，不进入 `DiagnosticContext`、public DTO、gateway Record、runtime command 字段或 timeline payload，不违反上述约束。

**需求类别**：功能性需求

#### Scenario: owner 范围保持明确
- **WHEN** 后续 change 需要新增 metric name、audit record、health judgment 或 OpenTelemetry exporter 行为
- **THEN** 对应 change 必须定义 schema、sink、owner、validation 和安全规则
- **AND** 本 change 只提供该 owner 所需的共享 diagnostic context / observation 输入

#### Scenario: 通过 getExecutionCorrelation 注入的 trace carrier 不进入 DiagnosticContext

- **WHEN** 外部调用方通过 `getExecutionCorrelation()` 获取 port 并调用 `withIncomingCarrier(carrier, operation)` 包裹 runtime 调用
- **THEN** trace carrier MUST NOT 出现在 `DiagnosticContext`、结构化日志字段、audit record 或 gateway Record
- **AND** trace carrier MUST 只存在于 `incomingCarrier` ALS scope 内
- **AND** 后续 timeline event 和 diagnostic snapshot MUST NOT 携带 trace carrier 原文
