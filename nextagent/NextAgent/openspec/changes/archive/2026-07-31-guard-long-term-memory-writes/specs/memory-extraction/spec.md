## ADDED Requirements

### Requirement: 提取写入遵守长期记忆知识准入

当存在 guardrail 绑定时，自动提取 MUST 将新的候选写入和既有 record 的 `saveLongTermMemory` 更新，提交给与其他长期记忆写入相同的 `agent-memory` package-internal 知识安全准入实现。提取 MUST 通过其既有 `agent-memory` 工厂/选项边界接收所选 guardrail 绑定，MUST NOT 接收 app 组合的 coordinator 对象。既有本地候选校验 MUST 在远程 guard 调用之前运行，MUST NOT 取代、绕过或削弱知识检查。

被 blocked 的知识检查 MUST 以 reason `CANDIDATE_UNSAFE` 拒绝该候选，MUST 递增 rejected/skipped 结果计数，并 MUST 在提取 deadline 和取消状态允许时继续处理后续候选。guardrail 不可用结果 MUST 将该候选标记为失败，reason 为 `LTM_CONTENT_GUARD_UNAVAILABLE`；当至少另一个候选已被写入时，cycle MUST 为 `PARTIAL`，当没有任何候选被写入时为 `FAILED`。取消 MUST 保持既有 `MEMORY_EXTRACTION_CANCELED` cycle 行为。任何 guard 结果都不得改变源 RequestRun 的 terminal 状态。

提取诊断、audit、日志、metric 和 trace MUST NOT 包含准入文本、单个片段、RobotRouter `detail`、provider 响应体、raw error 或长期记忆内容。它们 MAY 只包含已授权的既有安全 scope 字段、memory 类别、有界计数和稳定 reason code。

#### Scenario: 不安全的提取候选在持久化前被拒绝

- **WHEN** 一个提取候选通过本地校验但任一知识片段被 blocked
- **THEN** 该候选 MUST 以 `CANDIDATE_UNSAFE` 被拒绝
- **AND** 长期记忆 store MUST NOT 持久化该候选
- **AND** 提取 MUST 在其 deadline 和取消状态允许时继续处理后续候选

#### Scenario: guardrail 故障使提取部分完成

- **WHEN** 一个候选已被写入且较后的候选收到 `LTM_CONTENT_GUARD_UNAVAILABLE`
- **THEN** cycle MUST 以状态 `PARTIAL` 完成
- **AND** 其安全 reason code MUST 包含 `LTM_CONTENT_GUARD_UNAVAILABLE`
- **AND** 源 RequestRun 的 terminal 状态 MUST 保持不变

#### Scenario: guardrail 故障阻止全部提取写入

- **WHEN** 每个被接受的候选都因 guardrail 不可用而未通过知识准入
- **THEN** cycle MUST 以状态 `FAILED` 完成
- **AND** 其失败计数 MUST 等于尝试的候选数
- **AND** 不得写入任何长期记忆 record
