## ADDED Requirements

### Requirement: Pending option 契约支持附加文本输入

core、runtime、gateway 和 Web 投影中的 pending input option 契约 SHALL 支持可选 `requiresTextInput` 和 `inputPlaceholder` 字段，并在各边界保持同一 canonical 含义。`requiresTextInput=true` 表示选择该特定选项需要一个附加文本值；`inputPlaceholder` 是有界的安全呈现文本，MUST NOT 携带身份、授权、路径权限、生命周期所有权或回答数据。

#### Scenario: 契约字段跨边界保持同一含义

- **WHEN** 一个可信生产者创建一个包含带 `requiresTextInput=true` 选项的 `QUESTION` pending intent
- **THEN** core intent、runtime request、gateway Record 和 Web 投影 MUST 保留相同的选项值、label、`requiresTextInput` 和可选 `inputPlaceholder`
- **AND** 持久化映射 MUST 使用既有 pending input 事实，MUST NOT 引入第二个 pending store 或私有 capability 生命周期。

#### Scenario: 既有回答 envelope 携带选项与附加文本

- **WHEN** 所选的已接受选项需要附加文本
- **THEN** `PendingInputAnswer.answers` MUST 保持有序字符串矩阵
- **AND** 该问题的条目 MUST 恰好包含 `[optionValue, inputText]`
- **AND** 该精化 MUST NOT 新增平行的回答 DTO、runtime command 或客户端提供的回答 schema。

#### Scenario: agent-contracts 精化要求显式评审

- **WHEN** 该 change 为公开 pending option 契约新增这两个可选字段
- **THEN** 契约评审 MUST 确认 `agent-contracts/runtime` 和 `agent-contracts/gateway` 中的命名和语义完全一致
- **AND** `WorkflowPendingInputOption` MUST 保持不变
- **AND** 契约测试 MUST 在该 change 具备 push 资格前拒绝字段漂移、非法组合和 无界呈现文本。
