## Function

- **所属 Function**：`FN-5.9 调用技能`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Inline Skill 正文必须保持单一隐藏注入

当 inline Skill 成功加载时，系统 MUST 通过同一个 `CapabilityInvocationResult` 返回固定可见确认，并把 canonical Skill 正文作为恰好一条 request-local hidden generated message 提供给下一模型步骤。`CapabilityInvocationResult.structuredPayload` MUST 精确包含受治理的 `name` 和 `status: "loaded"`，MUST NOT 包含 Skill 正文、`<skill_content>` envelope 或资源内容。hidden generated message MUST 使用 `<skill_content>` envelope 携带已经加载的 canonical Skill 正文。

当模型调用 `Skill` 并产生对应 tool result 时，系统 MUST 在下一模型步骤及本次 request 的每个后续模型步骤中，把该 hidden generated message 放在包含同名 Skill 最近一个对应 tool result 的完整 tool-result batch 之后、任何后续轮次产生的消息之前。存在该对应 tool result 时，系统 MUST NOT 把 hidden Skill message 作为 request-level 尾部消息追加在全部已选消息之后。当同一 assistant tool-use batch 还包含其他 Tool 时，系统 MUST 先保持该 batch 的全部 tool results 连续并完成配对，再放置 hidden Skill message。当 Skill 在模型 loop 前通过受治理的定向路由加载且没有对应模型 tool result 时，系统 MUST 把 hidden generated message 放在当前已选消息之后。

如果该 Skill 没有模型可读附属资源，hidden generated message MUST NOT 包含 Skill resource root 或资源枚举提示。如果该 Skill 至少有一个模型可读附属资源，hidden generated message MUST 在正文之前提供该 Skill resource root，并 MUST 明确资源根只用于访问正文明确引用的附属资源；系统 MUST NOT 指示模型枚举整个 Skill 目录或重新读取 `SKILL.md`。

**需求类别**：功能性需求

#### Scenario: 可见结果不携带 Skill 正文

- **WHEN** inline Skill 成功加载
- **THEN** 可见 tool result MUST 精确包含受治理的 `name` 和 `status: "loaded"`
- **AND** 可见 tool result MUST NOT 包含 Skill 正文或 `<skill_content>` envelope
- **AND** 下一模型步骤 MUST 通过恰好一条 hidden generated message 获得 canonical Skill 正文

#### Scenario: 后续工具轮次保持 Skill 正文与结果相邻

- **GIVEN** 模型调用 inline Skill 后又在后续轮次调用 `Read`
- **WHEN** 系统为 `Read` 完成后的下一模型步骤组装消息
- **THEN** hidden Skill message MUST 紧随包含对应 Skill tool result 的完整 tool-result batch
- **AND** `Read` tool call 与 tool result MUST 位于该 hidden Skill message 之后
- **AND** hidden Skill message MUST NOT 被重新追加到全部已选消息末尾

#### Scenario: 并行 Tool 结果保持完整配对

- **GIVEN** 同一 assistant tool-use batch 同时调用 inline Skill 和另一个 Tool
- **WHEN** 系统组装下一模型步骤
- **THEN** 该 batch 的全部 tool results MUST 在 hidden Skill message 之前连续完成配对
- **AND** hidden Skill message MUST 位于完整 tool-result batch 与下一轮 assistant message 之间

#### Scenario: 模型 loop 前加载的 Skill 没有结果锚点

- **GIVEN** inline Skill 通过受治理的定向路由在模型 loop 前加载
- **AND** 当前已选消息中不存在对应 Skill tool result
- **WHEN** 系统组装下一模型步骤
- **THEN** hidden Skill message MUST 位于当前已选消息之后

#### Scenario: 无附属资源时不披露资源根

- **GIVEN** inline Skill 只有 canonical `SKILL.md` 正文且没有模型可读附属资源
- **WHEN** 该 Skill 成功加载
- **THEN** hidden generated message MUST 包含已经加载的 canonical Skill 正文
- **AND** hidden generated message MUST NOT 包含 Skill resource root、目录枚举提示或重新读取 `SKILL.md` 的提示

#### Scenario: 有附属资源时只提示按正文引用访问

- **GIVEN** inline Skill 至少包含一个模型可读附属资源
- **WHEN** 该 Skill 成功加载
- **THEN** hidden generated message MUST 在 canonical Skill 正文之前提供 Skill resource root
- **AND** hidden generated message MUST 明确只访问正文明确引用的附属资源
- **AND** hidden generated message MUST NOT 指示模型枚举整个 Skill 目录或重新读取 `SKILL.md`

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：inline Skill 返回固定可见确认，并通过恰好一条隐藏消息向下一模型步骤提供已经加载的正文；资源提示仅在存在附属资源时出现。
- **依据 Requirements**：`Inline Skill 正文必须保持单一隐藏注入`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统区分已加载的 Skill 正文与正文明确引用的附属资源；模型调用 Skill 时把正文稳定放在对应 Skill tool result 之后，模型 loop 前加载时把正文放在当前已选消息之后；系统不提供重复读取正文或枚举整个 Skill 目录的提示。
- **依据 Requirements**：`Inline Skill 正文必须保持单一隐藏注入`

### 结果

- **变更类型**：修改
- **目标内容**：模型在下一步骤直接使用唯一隐藏注入的 Skill 正文；后续工具轮次不改变正文与对应 Skill result 的相对位置，并且仅在正文明确需要时访问披露的附属资源。
- **依据 Requirements**：`Inline Skill 正文必须保持单一隐藏注入`
