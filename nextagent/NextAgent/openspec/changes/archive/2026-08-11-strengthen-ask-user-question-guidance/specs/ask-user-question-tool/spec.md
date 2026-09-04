## Function

- **所属 Function**：`FN-5.6 向用户提问`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: User-facing agents trigger AskUserQuestion for blocking ordinary user input

当面向用户的 Agent 实际需要用户回答一个普通问题时，NextAgent MUST 通过模型可见指导要求 Agent 调用 `AskUserQuestion`，并 MUST 禁止 Agent 只在普通 assistant 文本中直接写出需要用户回答的问题。本 Requirement 中的普通问题由追问、澄清、偏好、实现选择和普通确认五类组成；当同一次交互同时符合普通问题和禁止用途时，禁止用途 MUST 优先。

模型可见指导 MUST 保持 System Prompt、Tool description 和输入 Schema description 的语义一致，并 MUST NOT 增加自然语言推断、forced tool choice、自动 pending-input routing 或 runtime 语义路由。

**需求类别**：功能性需求

#### Scenario: 需要用户回答的普通问题使用 AskUserQuestion

- **WHEN** 面向用户的 Agent 需要用户回答追问、澄清、偏好、实现选择或普通确认
- **AND** 该问题不属于禁止用途
- **THEN** 模型可见指导 MUST 要求 Agent 调用 `AskUserQuestion`
- **AND** 模型可见指导 MUST 禁止 Agent 在普通 assistant 文本中直接写出该问题
- **AND** 面向用户的问题文本 MUST 直接表达问题，不得暴露内部 Tool 名称

#### Scenario: 可从上下文或工具取得的信息不形成用户问题

- **WHEN** Agent 可以从对话上下文推断所需信息、通过可用工具取得所需信息或使用安全且明确的假设继续
- **THEN** Agent MUST 先使用该信息来源或假设，而不是构造一个不需要用户回答的问题
- **AND** 如果 Agent 最终仍实际需要用户回答，模型可见指导 MUST 要求该问题通过 `AskUserQuestion` 发出

#### Scenario: 已知选项时使用结构化选项

- **WHEN** Agent 已知普通问题的全部有效选项
- **THEN** 模型可见指导 MUST 要求 Agent 使用 `AskUserQuestion` 的预设选项
- **AND** 仅当有效选项未知时，Agent MUST 使用自由文本问题

#### Scenario: 禁止用途不使用 AskUserQuestion

- **WHEN** 交互用于 generic permission to proceed、plan approval、status acknowledgement、credential、secret、authorization grant、protected-operation approval、high-risk confirmation、human handoff、survey 或 long-form form
- **THEN** 模型可见指导 MUST 要求 Agent 不调用 `AskUserQuestion`
- **AND** 系统 MUST 继续依赖对应 owner 已定义的 purpose-specific pending input、guard 或 safe refusal 行为

#### Scenario: AskUserQuestion 不可用时不退化为文本问句

- **WHEN** 面向用户的 Agent 实际需要用户回答普通问题，但 `AskUserQuestion` 不可用
- **THEN** Agent MUST NOT 在普通 assistant 文本中直接写出该问题
- **AND** Agent MUST 使用无需用户回答的安全假设继续，或输出不含问句的 blocked explanation

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：模型通过统一的 `AskUserQuestion` 交互向用户发出全部需要回答的普通问题，并保持禁止用途的独立安全边界。
- **依据 Requirements**：`User-facing agents trigger AskUserQuestion for blocking ordinary user input`

### 处理过程

- **变更类型**：修改
- **目标内容**：Agent 在需要用户回答普通问题时创建结构化提问；禁止用途进入其既有专用交互或安全拒绝边界。
- **依据 Requirements**：`User-facing agents trigger AskUserQuestion for blocking ordinary user input`

### 规格

- **规格项**：用户问题通道
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：全部需要用户回答的普通追问、澄清、偏好、实现选择和普通确认均使用 `AskUserQuestion`；禁止用途不使用该 Tool。
- **依据 Requirements**：`User-facing agents trigger AskUserQuestion for blocking ordinary user input`

### 主规格

- **变更类型**：修改
- **目标内容**：`ask-user-question-tool`
- **依据 Requirements**：`User-facing agents trigger AskUserQuestion for blocking ordinary user input`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`ask-user-question-trigger-policy` 保留未迁移的 `network-explorer` 可见性 Requirement；用户问题触发 Requirement 由主规格承载。
- **依据 Requirements**：`User-facing agents trigger AskUserQuestion for blocking ordinary user input`
