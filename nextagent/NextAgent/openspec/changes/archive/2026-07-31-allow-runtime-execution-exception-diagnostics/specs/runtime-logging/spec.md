## MODIFIED Requirements

### Requirement: Runtime 日志 helper 安全、可诊断且非致命

Runtime logging helper SHALL 不抛出异常。Runtime 日志 MAY 在由 runtime 拥有的生命周期边界发出时，包含有界诊断细节（如原始 tool 输入、原始路径和错误消息），用于本地问题定位。

Runtime 日志 MUST NOT 序列化 prompt 文本、模型输出、stream delta、附件内容、provider raw body、stack trace 或类 credential 值。唯一例外是 `runtime-execution-exception-diagnostics` 本地执行诊断：Tool 执行、Tool result 校验和 terminal submit 失败 MAY 通过本地 `RuntimeLogger` 写入 `rawExceptionData`，且已配置的 operational runtime 日志文件 MUST 包含该事件。`rawExceptionData` MAY 针对已确认的执行诊断用例包含异常 message、stack、cause、sandbox path 和 URL，但 MUST 脱敏类 credential key、内联 credential/token 形式和 `prompt` 字段。它 MUST NOT 被投影到 Web、stream、SafeError、timeline、audit、metric、trace 或 `ObservabilityObservationEvent`。

Runtime logger helper SHALL 脱敏类 secret key 和内联类 secret 值，包括 API key、bearer credential、password、token、secret、credential 和 authorization 字段。

#### Scenario: 日志失败不影响主路径
- **WHEN** 一个 runtime logger 实现在某个 helper 发出诊断时抛出异常
- **THEN** 该 helper 捕获该失败
- **AND** request lifecycle、context assembly、terminal commit 和 gateway 行为保持不变

#### Scenario: Tool 失败 runtime 日志保留诊断输入且不含 credential
- **WHEN** 一个 tool 调用失败
- **THEN** runtime 诊断日志 MAY 包含 tool call id、tool 名称、原始 tool 输入、错误消息和 `rawExceptionData`
- **AND** 类 credential 字段和内联 secret 值被脱敏

#### Scenario: terminal 执行失败保留本地原始异常诊断
- **WHEN** terminal submit 因执行异常而失败
- **THEN** 本地 runtime 诊断日志 MAY 包含带 stack、cause、sandbox path 和 URL 的 `rawExceptionData`
- **AND** 相同数据 MUST NOT 进入任何面向产品的、audit、metric、trace 或 observation 输出
