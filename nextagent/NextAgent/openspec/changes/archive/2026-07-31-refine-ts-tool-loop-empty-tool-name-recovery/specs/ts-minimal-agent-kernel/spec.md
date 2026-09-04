## ADDED Requirements

### Requirement: Tool loop 在不中断 run 的情况下恢复空 tool name 的 tool call

Agent Core tool loop SHALL 在 capability resolution 之前检测 `toolName`（trim 之后）为空的 tool call。空 tool name 属于模型输出质量缺陷，而不是 capability 或授权失败；run SHALL NOT 在首次出现时立即终止。

当某个 round 包含至少一个空 name 的 tool call，且连续空 name 重试计数低于 `toolCallLimitRecoveryLimit`（3）时，Agent Core SHALL：
- 发出一条 `tool.loop.empty_tool_name_recoverable` warn 日志，携带模型返回的 tool call 信息（toolCallId、toolName，以及经 `failure_snapshot` 脱敏模式处理的安全参数快照）；
- 发出 code 为 `TOOL_NAME_EMPTY` 的 `DEGRADATION_NOTICE`；
- 注入一条模型可见的 USER 纠正消息，列出缺失 tool name 的 toolCallId；
- 不执行该批次中的任何 tool call；
- 不持久化空 name 的 assistant tool-use 消息（保持 tool_use/tool_result 配对不变量）；
- 重新进入模型 round。

连续空 name 计数器 SHALL 在任何进入正常 tool 执行的 round 上重置为零。当连续空 name 重试计数达到 `toolCallLimitRecoveryLimit` 时，Agent Core SHALL 落入 `executeToolCallsInOrder`，其防御性 guard 发出 `DEGRADATION_NOTICE`（code `TOOL_NAME_EMPTY`）并以安全的 `REQUEST_FAILED` 结束 run。

空 name 检查 SHALL 在超限预检查之后、`executeToolCallsInOrder` 之前运行。当某个批次同时超限且包含空 name 时，超限检查优先。

#### Scenario: 模型返回空 tool name 并在下一 round 恢复

- **GIVEN** 某个模型 round 返回一个 `toolName` 为空的 tool call
- **WHEN** 连续空 name 重试计数低于 `toolCallLimitRecoveryLimit`
- **THEN** Agent Core MUST 发出 code 为 `TOOL_NAME_EMPTY` 的 `DEGRADATION_NOTICE`
- **AND** Agent Core MUST 发出一条 `tool.loop.empty_tool_name_recoverable` warn 日志，包含该批次中每个 tool call 的 toolCallId 和 toolName
- **AND** Agent Core MUST 注入一条模型可见的 USER 纠正消息，指明空 name 的 toolCallId
- **AND** Agent Core MUST NOT 执行该批次中的任何 tool call
- **AND** Agent Core MUST NOT 持久化该批次的 assistant tool-use 消息
- **AND** 若模型随后返回有效响应，run MUST 重新进入模型 round 并继续

#### Scenario: 持续的空 tool name 耗尽恢复上限并安全失败

- **GIVEN** 模型在连续多个 round 返回 `toolName` 为空的 tool call
- **WHEN** 连续空 name 重试计数达到 `toolCallLimitRecoveryLimit`
- **THEN** Agent Core MUST 发出 code 为 `TOOL_NAME_EMPTY` 的 `DEGRADATION_NOTICE`
- **AND** Agent Core MUST 以安全的 `REQUEST_FAILED` 结束 run
- **AND** Agent Core MUST NOT 执行已耗尽批次中的任何 tool call

#### Scenario: 正常执行重置空 name 重试计数器

- **GIVEN** 先前某个 round 触发了空 name 恢复
- **WHEN** 后续 round 返回 tool name 有效（非空）的 tool call
- **THEN** Agent Core MUST 把连续空 name 重试计数器重置为零
- **AND** Agent Core MUST 正常执行这些 tool call

#### Scenario: 超限优先于空 name 恢复

- **GIVEN** 某个模型 round 返回的批次既超限又包含空 name 的 tool call
- **WHEN** 超限恢复尚未耗尽
- **THEN** Agent Core MUST 应用超限恢复（发出 `TOOL_CALL_LIMIT_EXCEEDED` 及其纠正消息）
- **AND** Agent Core MUST NOT 为该批次递增空 name 重试计数器
