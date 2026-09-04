## ADDED Requirements

### Requirement: add_memory 安全地报告知识准入失败

当存在 guardrail 绑定时，`add_memory` MUST 使用 `agent-memory` package-internal 的知识准入实现，MUST NOT 调用未受 guard 的持久化 port。`createLongTermMemoryToolPort` MAY 接收所选 `GuardrailGatewayPort` 作为依赖，但 MUST NOT 接收来自 `agent-app` 的 `LongTermMemoryWriteCoordinator`。既有 `LongTermMemoryToolPort` 方法签名 MUST 保持不变。被 blocked 的知识检查 MUST 返回 SafeError code 为 `LTM_CONTENT_GUARD_BLOCKED`、category 为 `POLICY_DENIED` 且 retryable 为 false 的结构化 capability 失败。guardrail 不可用结果 MUST 返回 `LTM_CONTENT_GUARD_UNAVAILABLE`、category `UNAVAILABLE` 且 retryable 为 true。持久化前的取消 MUST 返回 CANCELED 结构化失败。

capability 结果、模型可见结果、timeline 投影、日志、metric、trace、audit 和诊断 MUST NOT 包含 memory 内容、知识片段、RobotRouter `detail`、provider 响应体或 raw provider error。失败的准入 MUST NOT 创建长期记忆 record，MUST NOT 改变 RequestRun terminal 所有权。

#### Scenario: add_memory 被 blocked 且不写入

- **WHEN** 模型以有效 tool 输入调用 `add_memory` 且知识检查阻断任一片段
- **THEN** capability 调用 MUST 返回结构化失败 `LTM_CONTENT_GUARD_BLOCKED`
- **AND** 不得创建任何长期记忆 record
- **AND** 失败投影 MUST NOT 包含被阻断文本或 provider `detail`

#### Scenario: add_memory 暴露可重试的 guardrail 不可用

- **WHEN** 模型调用 `add_memory` 且知识 guard 在持久化前不可用
- **THEN** capability 调用 MUST 返回结构化失败 `LTM_CONTENT_GUARD_UNAVAILABLE`
- **AND** 该失败 MUST 可重试
- **AND** 不得创建任何长期记忆 record
