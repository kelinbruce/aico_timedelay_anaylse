## ADDED Requirements

### Requirement: 本地 runtime 执行异常诊断保留受控详细信息

当 Tool 执行、Tool 结果校验或 request terminal submit 因执行异常失败时，系统 SHALL 经本地 `RuntimeLogger` 输出结构化 `rawExceptionData`，且配置的 `runtime.log` SHALL 包含该 runtime diagnostic。该字段 SHALL 保留异常 name、message、stack、cause 链和可序列化异常对象字段，以支持执行故障定位。

`rawExceptionData` SHALL 对字段名匹配 `password`、`apiKey`、`token`、`secret`、`credential` 或 `authorization` 的值脱敏，并对 `prompt` 字段脱敏；文本中出现的 OpenAI-style key、Bearer value 或 `token=` 等凭据形态也 MUST 脱敏。执行 sandbox 路径和 URL SHALL 在该本地诊断字段中保留。普通短字符串 SHALL 保留；长文本或含空白文本 SHALL 以不超过 96 字符的 excerpt 保留。

#### Scenario: Tool 执行失败写入受控详细异常
- **WHEN** 已执行的 Tool 抛出带 cause 的异常
- **THEN** `runtime.log` 中的 `tool.call.failed` SHALL 包含 `rawExceptionData`
- **AND** 该字段保留 sandbox 路径和异常 cause 的定位信息
- **AND** credential、token 和 `prompt` 字段值 MUST 被脱敏

#### Scenario: Terminal submit 失败写入受控详细异常
- **WHEN** request 进入 terminal submit 后因执行异常失败
- **THEN** `runtime.log` 中的 `runtime.run.failed` SHALL 包含 `rawExceptionData`
- **AND** 既有 safe terminal status 和 safe reason code SHALL 保持不变

### Requirement: 本地执行异常诊断不得扩散到产品输出面

`rawExceptionData` SHALL 仅经本地 `RuntimeLogger` 输出，且配置的 `runtime.log` SHALL 包含该 runtime diagnostic。系统 MUST NOT 将它投影到 Web API、SSE、WebSocket、timeline event、SafeError、audit record、metric sample、trace attribute 或 `ObservabilityObservationEvent`。

#### Scenario: 执行异常不改变客户端安全错误
- **WHEN** Tool 或 terminal submit 失败并写入 `rawExceptionData`
- **THEN** 客户端和 stream 只接收既有 SafeError 或安全 terminal 投影
- **AND** 它们不得包含 exception message、stack、cause、sandbox path 或 URL

### Requirement: 模型 loop 诊断只记录安全执行元数据

每次模型调用 SHALL 在第一段非空 `content` 到达时写入 `model.call.first_content` runtime diagnostic。日志记录时刻 SHALL 表示首段内容到达时间，并 SHALL 包含从调用开始计算的非负整数 `firstContentLatencyMs`；日志不得包含 content 本身。

模型调用日志 SHALL 包含本轮模型可用的 `toolCount` 和 `toolNames`，其中 `toolNames` 仅包含模型 Tool descriptor name，不得包含工具参数。模型 loop 在某轮返回零个 tool call 时 SHALL 写入 `tool.loop.no_tool_calls`，包含轮次、零调用数量和模型输出字符数，不得包含模型输出内容。

#### Scenario: 首段内容延迟和工具清单可诊断
- **WHEN** 模型调用收到第一段非空 content
- **THEN** `runtime.log` SHALL 写入 `model.call.first_content`，包括 `firstContentLatencyMs`、`toolCount` 和 `toolNames`
- **AND** 日志不得包含 content 或工具参数

#### Scenario: 模型轮次没有 Tool 调用
- **WHEN** 一轮模型调用返回空的 tool call 列表
- **THEN** `runtime.log` SHALL 写入 `tool.loop.no_tool_calls`
- **AND** 该日志不得包含模型输出或 final content
