## Function

- **所属 Function**：`FN-1.20 查看推荐问题`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Capability Description Provider

系统 MAY 提供 `CapabilityDescriptionProvider`，从当前 active Agent 的 agent-owned resource 目录热加载 `capabilityDescription.md` 文件内容。Provider MUST 支持 LOCAL 和 REMOTE 两种 deployment mode，由 app composition 根据 `systemConfig.deployment.mode` 选择。

LOCAL mode 下，Provider MUST 在首次调用时加载文件并缓存结果；后续调用返回缓存值，MUST NOT 检测文件变化。

REMOTE mode 下，Provider MUST 在每次调用时通过 `statSync` 计算文件指纹（`path:size:mtimeMs`）；指纹不变时返回缓存值，指纹变化时 MUST 重新加载文件内容。

Provider MUST 返回 `string | undefined`：文件存在且可读时返回文件原文（UTF-8 文本），文件不存在或不可读时返回 `undefined`。Provider MUST 接收可选 `AbortSignal`；当 signal 已 abort 时 MUST 立即返回 `undefined`。

文件路径 MUST 为 `agents/{agentId}/resource/capabilityDescription.md`，其中 `agentId` 为当前 active Agent 的 ID。Provider MUST 通过 source locator 定位 agent package root，并拼接到 `resource/capabilityDescription.md`。source locator 接口形状 MUST 与 `ChatUploadConfigSourceLocator` 同构。

Provider MUST NOT 解析、校验或转换 markdown 内容，只返回文件原文。Provider MUST NOT 将文件内容暴露给 Web API、SSE、WebSocket、timeline、SafeError、audit、metric 或 trace。Provider 的加载失败 MUST NOT 抛出异常，MUST 返回 `undefined`。

**需求类别**：功能性需求

#### Scenario: 文件存在时返回原文
- **WHEN** `agents/{agentId}/resource/capabilityDescription.md` 文件存在且可读
- **THEN** Provider MUST 返回文件原文（UTF-8 文本）
- **AND** MUST NOT 对内容做解析、校验或转换

#### Scenario: 文件不存在时返回 undefined
- **WHEN** `agents/{agentId}/resource/capabilityDescription.md` 文件不存在或不可读
- **THEN** Provider MUST 返回 `undefined`
- **AND** MUST NOT 抛出异常

#### Scenario: LOCAL 模式不检测文件变化
- **WHEN** deployment mode 为 LOCAL 且首次加载后文件被替换
- **THEN** Provider MUST 返回首次加载时的缓存值
- **AND** MUST NOT 重新读取文件

#### Scenario: REMOTE 模式检测文件变化
- **WHEN** deployment mode 为 REMOTE 且文件被替换（size 或 mtimeMs 变化）
- **THEN** Provider MUST 重新加载文件内容并返回新值
- **AND** 文件未变化时 MUST 返回缓存值

#### Scenario: AbortSignal 已取消
- **WHEN** 调用 `get(signal)` 时 `signal.aborted === true`
- **THEN** Provider MUST 立即返回 `undefined`
- **AND** MUST NOT 发起文件读取

#### Scenario: 内容不进入不可信边界
- **WHEN** Provider 加载文件内容
- **THEN** 内容 MUST NOT 出现在 Web API、SSE、WebSocket、timeline、SafeError、audit、metric 或 trace 中

### Requirement: Capability Description Resolution

`{capability_description}` 变量 MUST 通过 `CapabilityDescriptionProvider.get(signal)` 解析。Provider 返回 `undefined` 或空字符串时，`{capability_description}` MUST 视为空字符串，user message MUST 省略整个产品能力范围段。Provider 返回非空字符串时，MUST 经过 `escapeTemplateVariable` 转义后填入 user message 的产品能力范围段。

`CapabilityDescriptionProvider` 为可选依赖。当 app composition 未注入该 Provider 时，`{capability_description}` MUST 视为空字符串，行为与文件不存在时一致；推荐生成 MUST NOT 因此失败或返回空结果。

`{capability_description}` 的转义策略 MUST 与 `{query}`、`{final_answer}` 和 `{skill}` 一致：转义 `{` 和 `}` 字符，防止模板注入。

**需求类别**：功能性需求

#### Scenario: 产品能力范围非空时填入
- **WHEN** `CapabilityDescriptionProvider.get()` 返回非空字符串
- **THEN** `{capability_description}` MUST 经过 `escapeTemplateVariable` 转义后填入 user message
- **AND** user message MUST 包含产品能力范围段

#### Scenario: 产品能力范围为空时省略
- **WHEN** `CapabilityDescriptionProvider.get()` 返回 `undefined` 或空字符串
- **THEN** user message MUST 省略整个产品能力范围段
- **AND** MUST NOT 包含空的产品能力范围标签

#### Scenario: Provider 未注入时行为不变
- **WHEN** app composition 未注入 `CapabilityDescriptionProvider`
- **THEN** `{capability_description}` MUST 视为空字符串
- **AND** 推荐行为 MUST 与文件不存在时完全一致
- **AND** 推荐生成 MUST NOT 因此失败

#### Scenario: 转义与现有变量一致
- **WHEN** 产品能力范围内容包含 `{` 或 `}` 字符
- **THEN** `escapeTemplateVariable` MUST 转义这些字符
- **AND** 转义策略 MUST 与 `{query}`、`{final_answer}` 和 `{skill}` 一致

## MODIFIED Requirements

### Requirement: Prompt Variable Resolution

推荐生成 MUST 使用职责分离的 system message 和非空 user message。system message MUST 只描述推荐任务、问题选择规则和输出格式；当产品能力范围非空时，system message MUST 额外包含一条选择规则，指示模型推荐问题应与产品能力范围相关，避免推荐产品不支持的问题。user message MUST 包含从可信 owner scope 和 agent scope 数据源读取的当前用户问题与最终回答，并且仅在产品能力范围非空时包含产品能力范围段，仅在 Skill 上下文非空时包含 Skill 段。

user message 的动态上下文 MUST 按以下规则解析：
- 用户问题 MUST 来自 request run 对应的首条 `role === "USER"` session message content；缺失时在 user message 中使用显式"未提供"占位。
- 最终回答 MUST 来自该 request 最后一条 visible `role === "ASSISTANT"` session message content；缺失时在 user message 中使用显式"未提供"占位。
- 产品能力范围 MUST 按 Capability Description Resolution requirement 解析；结果为空时 MUST 省略整个产品能力范围段。
- Skill 上下文 MUST 按 Skill Context Resolution requirement 解析；结果为空时 MUST 省略整个 Skill 段。
- 当前未接入用户特征数据，Prompt MUST NOT 发送空的用户特征字段或预留标签。

Prompt MUST 要求模型输出恰好三条与当前主题一致、每条只有单一意图且可直接点击追问的问题。输出语言 MUST 优先跟随用户问题；用户问题缺失时 MUST 跟随最终回答；两者都缺失时 MUST 使用中文。问题选择 MUST 优先推动当前任务的下一步，其次验证回答或补充关键条件；当输入不足以提出事实型追问时，MUST 改为提出具体的澄清问题，而不是因为 Skill、用户特征或外部知识来源缺失而返回空内容。

Prompt MUST NOT 声称输入包含未实际提供的完整 session history、高频追问、用户特征或外部知识来源。Prompt MUST 要求模型不得编造输入中不存在的事实。输出格式 MUST 为每行一条问题，不带序号、标题、解释、Markdown 或推理过程。

所有动态上下文 MUST 来自服务端可信 session message、request run、capability catalog、timeline event 或 agent-owned resource 文件，MUST NOT 从 HTTP 请求体、客户端 metadata 或模型输出中取得。

#### Scenario: 正常上下文组装

- **WHEN** Port 为一个成功完成的 request run 组装模型请求
- **THEN** system message MUST 包含推荐任务和三行纯文本输出约束
- **AND** user message MUST 非空并包含该 run 的用户问题和最终回答
- **AND** user message MUST 包含明确的本轮生成请求，不能只有字段标签
- **AND** user message MUST 在产品能力范围非空时包含产品能力范围段
- **AND** user message MUST 在 Skill 上下文非空时包含 Skill 描述

#### Scenario: 没有 Skill 上下文

- **WHEN** 当前 run 没有 targeted 或实际执行的 Skill
- **THEN** user message MUST 省略 Skill 段
- **AND** Prompt MUST NOT 包含空的 Skill 或用户特征标签

#### Scenario: 产品能力范围非空时包含

- **WHEN** `CapabilityDescriptionProvider` 返回非空字符串
- **THEN** user message MUST 包含产品能力范围段
- **AND** system message MUST 包含关于产品能力范围的选择规则
- **AND** 产品能力范围段 MUST 位于最终回答段之后、Skill 段之前

#### Scenario: 产品能力范围为空时省略

- **WHEN** `CapabilityDescriptionProvider` 返回 `undefined` 或空字符串，或 Provider 未注入
- **THEN** user message MUST 省略产品能力范围段
- **AND** Prompt MUST NOT 包含空的产品能力范围标签
- **AND** 推荐行为 MUST 与未提供该变量时完全一致

#### Scenario: 上下文不足

- **WHEN** 用户问题或最终回答不足以支持具体的事实型下一步问题
- **THEN** user message MUST 使用显式"未提供"占位，而不是发送空字段值
- **THEN** Prompt MUST 指示模型生成与当前主题相关的具体澄清问题
- **AND** MUST NOT 指示模型因为缺少外部知识来源而返回空内容

#### Scenario: 不声明未提供的数据

- **WHEN** Port 组装推荐 prompt
- **THEN** Prompt MUST NOT 声称已提供完整 session history、高频追问、用户特征或外部知识来源

#### Scenario: 输出格式

- **WHEN** 模型生成推荐结果
- **THEN** Prompt MUST 要求恰好输出三行且每行仅包含一条完整问题
- **AND** MUST 禁止序号、标题、解释、Markdown 和推理过程

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：推荐生成在组装 prompt 时，通过 `CapabilityDescriptionProvider` 从 agent-owned resource 文件 `agents/{agentId}/resource/capabilityDescription.md` 读取产品能力范围；文件存在时将内容作为 `{capability_description}` 填入 user message 的产品能力范围段，并在 system message 中增加产品能力范围选择规则；文件不存在或 Provider 未注入时省略该段，行为不变。
- **依据 Requirements**：`Prompt Variable Resolution`、`Capability Description Provider`、`Capability Description Resolution`

### 结果

- **变更类型**：修改
- **目标内容**：当 `capabilityDescription.md` 存在时，推荐 prompt 包含产品能力范围上下文，推荐问题与 Agent 产品能力对齐；文件不存在时推荐结果与当前行为完全一致。
- **依据 Requirements**：`Prompt Variable Resolution`、`Capability Description Resolution`
