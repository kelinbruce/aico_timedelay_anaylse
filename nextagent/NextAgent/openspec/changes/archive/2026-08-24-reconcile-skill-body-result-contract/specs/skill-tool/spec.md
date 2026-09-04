## Function

- **所属 Function**：`FN-5.9 调用技能`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Inline Skill 正文必须保持单一隐藏注入

当 inline Skill 成功加载时，系统 MUST 通过同一个 `CapabilityInvocationResult` 返回受治理的 `name`、`status: "loaded"` 和 canonical Skill 正文。`CapabilityInvocationResult.structuredPayload` MUST 包含 `name`、`status` 和 `body`，其中 `body` MUST 使用 `<skill_content>` envelope 携带已经加载的 canonical Skill 正文。`CapabilityInvocationResult.generatedMessages` MUST 为空，系统 MUST NOT 再通过单独的 hidden generated message 重复传输同一正文。普通用户可见会话内容、ProcessDetail 和过程投影 MUST NOT 展示 `structuredPayload.body`。

如果该 Skill 没有模型可读附属资源，`body` MUST NOT 包含 Skill resource root 或资源枚举提示。如果该 Skill 至少有一个模型可读附属资源，`body` MUST 在正文之前提供该 Skill resource root，并 MUST 明确资源根只用于访问正文明确引用的附属资源；系统 MUST NOT 指示模型枚举整个 Skill 目录或重新读取 `SKILL.md`。

**需求类别**：功能性需求

#### Scenario: 成功结果携带单一 Skill 正文

- **WHEN** inline Skill 成功加载
- **THEN** `structuredPayload` MUST 包含受治理的 `name`、`status: "loaded"` 和 `<skill_content>` envelope 正文
- **AND** `generatedMessages` MUST 为空
- **AND** 系统 MUST NOT 为同一正文追加单独的 hidden generated message

#### Scenario: 用户可见输出不暴露正文

- **WHEN** inline Skill 成功加载并产生 Capability result
- **THEN** 普通会话内容、ProcessDetail 和过程投影 MUST NOT 展示 `structuredPayload.body`
- **AND** 模型上下文 MUST 继续获得该正文以执行后续推理

#### Scenario: 无附属资源时不披露资源根

- **GIVEN** inline Skill 只有 canonical `SKILL.md` 正文且没有模型可读附属资源
- **WHEN** 该 Skill 成功加载
- **THEN** `structuredPayload.body` MUST 包含 canonical Skill 正文
- **AND** `structuredPayload.body` MUST NOT 包含 Skill resource root、目录枚举提示或重新读取 `SKILL.md` 的提示

#### Scenario: 有附属资源时只提示按正文引用访问

- **GIVEN** inline Skill 至少包含一个模型可读附属资源
- **WHEN** 该 Skill 成功加载
- **THEN** `structuredPayload.body` MUST 在 canonical Skill 正文之前提供 Skill resource root
- **AND** `structuredPayload.body` MUST 明确只访问正文明确引用的附属资源
- **AND** `structuredPayload.body` MUST NOT 指示模型枚举整个 Skill 目录或重新读取 `SKILL.md`

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：inline Skill 成功结果把 canonical 正文收敛到同一 `structuredPayload.body`，`generatedMessages` 保持为空，用户可见投影不披露正文。
- **依据 Requirements**：`Inline Skill 正文必须保持单一隐藏注入`

### 规格

- **规格项**：inline Skill 正文承载位置
- **变更类型**：修改
- **原规格值**：正文通过恰好一条 hidden generated message 传输，`structuredPayload` 仅含 name/status。
- **目标规格值**：正文通过同一 `structuredPayload.body` 传输，`generatedMessages` 为空。
- **依据 Requirements**：`Inline Skill 正文必须保持单一隐藏注入`

### 主规格

- **变更类型**：修改
- **目标内容**：`skill-tool`
- **依据 Requirements**：`Inline Skill 正文必须保持单一隐藏注入`
