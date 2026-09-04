## Function

- **所属 Function**：`FN-1.20 查看推荐问题`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Prompt Variable Resolution

推荐生成 MUST 使用职责分离的 system message 和非空 user message。system message MUST 只描述推荐任务、问题选择规则和输出格式；当产品能力范围非空时，system message MUST 额外包含一条选择规则，指示模型在提供产品能力范围和追问偏好时推荐相关问题，并优先参考追问偏好中同类意图的推荐方向。本 change 不新增追问偏好数据源，user message MUST NOT 因此包含空的追问偏好字段或标签。user message MUST 包含从可信 owner scope 和 agent scope 数据源读取的当前用户问题与最终回答，并且仅在产品能力范围非空时包含产品能力范围段，仅在 Skill 上下文非空时包含 Skill 段。

user message 的动态上下文 MUST 按以下规则解析：
- 用户问题 MUST 来自 request run 对应的首条 `role === "USER"` session message content；缺失时在 user message 中使用显式“未提供”占位。
- 最终回答 MUST 来自该 request 最后一条 visible `role === "ASSISTANT"` session message content；缺失时在 user message 中使用显式“未提供”占位。
- 产品能力范围 MUST 按 Capability Description Resolution requirement 解析；结果为空时 MUST 省略整个产品能力范围段。
- Skill 上下文 MUST 按 Skill Context Resolution requirement 解析；结果为空时 MUST 省略整个 Skill 段。
- 当前未接入用户特征数据，Prompt MUST NOT 发送空的用户特征字段或预留标签。

Prompt MUST 要求模型输出恰好三条与当前主题一致、每条只有单一意图、使用用户口吻和当前会话语言术语、可直接作为用户追问的问题。输出语言 MUST 优先跟随用户问题；用户问题缺失时 MUST 跟随最终回答；两者都缺失时 MUST 使用中文。问题选择 MUST 优先预测用户当前任务最自然的下一步追问，其次预测用户可能用于确认结果、追问原因或补充条件的追问。当上下文不足时，Prompt MUST 指示模型预测用户可能提出的追问，而不是返回空内容。Prompt MUST 禁止输出“是否需要”“是否想要”“建议您”等助手口吻。

Prompt MUST NOT 声称输入包含未实际提供的完整 session history、高频追问、用户特征、追问偏好或外部知识来源。Prompt MUST 要求模型不得编造输入中不存在的事实，但可以通过问题询问缺失事实。输出格式 MUST 为每行一条问题，不带序号、标题、解释、Markdown、代码块或推理过程。

所有动态上下文 MUST 来自服务端可信 session message、request run、capability catalog、timeline event 或 agent-owned resource 文件，MUST NOT 从 HTTP 请求体、客户端 metadata 或模型输出中取得。

**需求类别**：功能性需求

#### Scenario: 正常上下文组装

- **WHEN** Port 为一个成功完成的 request run 组装模型请求
- **THEN** system message MUST 包含用户追问预测任务和三行纯文本输出约束
- **AND** system message MUST 要求站在用户视角预测当前回答后的追问
- **AND** user message MUST 非空并包含该 run 的用户问题和最终回答
- **AND** user message MUST 包含明确的本轮生成请求，不能只有字段标签
- **AND** user message MUST 在产品能力范围非空时包含产品能力范围段
- **AND** user message MUST 在 Skill 上下文非空时包含 Skill 描述

#### Scenario: 没有 Skill 上下文

- **WHEN** 当前 run 没有 targeted 或实际执行的 Skill
- **THEN** user message MUST 省略 Skill 段
- **AND** Prompt MUST NOT 包含空的 Skill、用户特征或追问偏好标签

#### Scenario: 产品能力范围非空时包含

- **WHEN** `CapabilityDescriptionProvider` 返回非空字符串
- **THEN** user message MUST 包含产品能力范围段
- **AND** system message MUST 包含关于产品能力范围和追问偏好的选择规则
- **AND** 产品能力范围段 MUST 位于最终回答段之后、Skill 段之前

#### Scenario: 产品能力范围为空时省略

- **WHEN** `CapabilityDescriptionProvider` 返回 `undefined` 或空字符串，或 Provider 未注入
- **THEN** user message MUST 省略产品能力范围段
- **AND** system message MUST 省略产品能力范围附加规则
- **AND** Prompt MUST NOT 包含空的产品能力范围或追问偏好标签

#### Scenario: 上下文不足

- **WHEN** 用户问题或最终回答不足以支持具体的事实型下一步问题
- **THEN** user message MUST 使用显式“未提供”占位，而不是发送空字段值
- **AND** Prompt MUST 指示模型预测用户可能提出的追问
- **AND** MUST NOT 指示模型因为缺少外部知识来源而返回空内容

#### Scenario: 用户口吻

- **WHEN** 模型生成推荐结果
- **THEN** Prompt MUST 要求每条问题使用用户口吻和当前会话的语言术语
- **AND** MUST 禁止“是否需要”“是否想要”“建议您”等助手口吻

#### Scenario: 不声明未提供的数据

- **WHEN** Port 组装推荐 prompt
- **THEN** Prompt MUST NOT 声称已提供完整 session history、高频追问、用户特征、追问偏好或外部知识来源

#### Scenario: 输出格式

- **WHEN** 模型生成推荐结果
- **THEN** Prompt MUST 要求恰好输出三行且每行仅包含一条完整、自然的用户追问
- **AND** MUST 禁止序号、标题、解释、Markdown、代码块和推理过程
