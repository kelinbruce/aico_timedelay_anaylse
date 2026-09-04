## ADDED Requirements

### Requirement: Runtime 日志与 observability 日志分离

Runtime 日志 SHALL 是由产品/运行时代码为本地问题诊断而直接发出的操作性诊断。它们 MUST NOT 被视为 audit 事实、metric 事实、health 事实、request lifecycle 事实或结构化 observability 事实。

Observability 结构化日志 SHALL 保持从 `ObservabilityObservationEvent` 经由 `ObservabilityProjectorHost` 和 `StructuredLogProjector` 派生。

#### Scenario: Runtime logger 不创建 observability 事实

- **WHEN** 一个业务 package 写入一条 runtime 诊断日志
- **THEN** 它通过 runtime logger contract 写入
- **AND** 它不调用 `ObservabilityProjectorHost.acceptObservation`
- **AND** 它不创建 `StructuredLogEntry`

### Requirement: 业务 package 使用 agent-common 的 runtime logger contract

业务 package SHALL 依赖 `agent-common` 获取 runtime 日志类型和 helper。它们 MUST NOT 仅为打印 runtime 诊断而 import Pino、`agent-observability` 的 logger helper、日志 transport、metric registry、tracer 或 observability SDK。

Runtime logger contract SHALL 是结构化的，并支持 `error`、`warn`、`info` 和 `debug` 方法，签名形状为 `(obj, msg)`。

#### Scenario: 业务依赖可以打印 runtime 诊断

- **WHEN** runtime、context、model、core、capability、session、attachment、memory 或 gateway 拥有的代码需要一个操作性诊断
- **THEN** 它 MAY 接受或使用来自 `agent-common` 的 `RuntimeLogger` contract
- **AND** 该 package 不需要直接的 `pino` 或 `agent-observability` 依赖

### Requirement: Logger 实现被复用但不合并表面

具体 logger factory SHALL 位于共享的 runtime 日志边界之后，并继续产出与结构化日志 transport 兼容的 logger。`agent-observability` MAY 为兼容性 re-export 该 factory，但结构化日志投影的 ownership 保持在 `agent-observability`。

#### Scenario: App 以一个兼容 logger 组合两个日志消费方

- **WHEN** app composition 创建产品 logger
- **THEN** runtime 诊断将其作为 `RuntimeLogger` 消费
- **AND** 结构化日志投影将其作为 `StructuredLogTransport` 消费
- **AND** 两个消费方保持为具有独立 contract 的独立表面

### Requirement: Runtime 日志 helper 是安全、诊断性且非致命的

Runtime 日志 helper SHALL 不抛出异常。Runtime 日志在由 runtime 拥有的 lifecycle 边界发出用于本地问题诊断时，MAY 包含有界诊断细节，例如原始 tool 输入、原始路径和错误消息。

Runtime 日志 MUST NOT 序列化 prompt 文本、model 输出、stream delta、附件内容、provider 原始正文、stack trace 或类似 credential 的值。Runtime logger helper SHALL 脱敏类似 secret 的 key 和内联类似 secret 的值，包括 API key、bearer credential、密码、token、secret、credential 和 authorization 字段。

#### Scenario: 日志失败不影响主路径

- **WHEN** 一个 runtime logger 实现在某个 helper 发出诊断时抛出异常
- **THEN** 该 helper 捕获该失败
- **AND** request lifecycle、context assembly、terminal commit 和 gateway 行为保持不变

#### Scenario: Tool 失败的 runtime 日志保留诊断输入且不带 credential

- **WHEN** 一次 tool 调用失败
- **THEN** runtime 诊断日志 MAY 包含 tool call id、tool 名称、原始 tool 输入和错误消息
- **AND** 类似 credential 的字段和内联 secret 值被脱敏
