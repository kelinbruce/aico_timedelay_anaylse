## ADDED Requirements

### Requirement: add_memory 来源由可信入口确定

`add_memory` 成功创建长期记忆时，系统 MUST 将该记录的 `knowledgeSourceType` 设置为 `LEARNED`。该来源 MUST 由受信的 `add_memory` 调用入口确定，MUST NOT 接受模型输入选择或覆盖。

`knowledgeSourceType` MUST NOT 出现在 `add_memory` 的模型可见输入字段中。模型输入包含 `knowledgeSourceType` 时，能力输入校验 MUST 拒绝整个调用，且系统 MUST NOT 创建长期记忆记录。

#### Scenario: 智能体工具写入归类为智能沉淀
- **WHEN** 模型使用合法输入调用 `add_memory`
- **AND** `add_memory` 成功创建长期记忆
- **THEN** 新记录的 `knowledgeSourceType` MUST 为 `LEARNED`

#### Scenario: 模型不能指定记忆来源
- **WHEN** 模型调用 `add_memory` 且输入包含 `knowledgeSourceType`
- **THEN** 能力输入校验 MUST 返回 `CAPABILITY_INPUT_INVALID`
- **AND** 系统 MUST NOT 创建长期记忆记录
