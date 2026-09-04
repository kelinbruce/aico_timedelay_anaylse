## MODIFIED Requirements

### Requirement: Prompt Variable Resolution

推荐生成 MUST 使用职责分离的 system message 和非空 user message。system message MUST 只描述推荐任务、问题选择规则和输出格式；user message MUST 包含从可信 owner scope 和 agent scope 数据源读取的当前用户问题与最终回答，并且仅在 Skill 上下文非空时包含 Skill 段。

user message 的动态上下文 MUST 按以下规则解析：
- 用户问题 MUST 来自 request run 对应的首条 `role === "USER"` session message content；缺失时在 user message 中使用显式“未提供”占位。
- 最终回答 MUST 来自该 request 最后一条 visible `role === "ASSISTANT"` session message content；缺失时在 user message 中使用显式“未提供”占位。
- Skill 上下文 MUST 按 Skill Context Resolution requirement 解析；结果为空时 MUST 省略整个 Skill 段。
- 当前未接入用户特征数据，Prompt MUST NOT 发送空的用户特征字段或预留标签。

Prompt MUST 要求模型输出恰好三条与当前主题一致、每条只有单一意图且可直接点击追问的问题。输出语言 MUST 优先跟随用户问题；用户问题缺失时 MUST 跟随最终回答；两者都缺失时 MUST 使用中文。问题选择 MUST 优先推动当前任务的下一步，其次验证回答或补充关键条件；当输入不足以提出事实型追问时，MUST 改为提出具体的澄清问题，而不是因为 Skill、用户特征或外部知识来源缺失而返回空内容。

Prompt MUST NOT 声称输入包含未实际提供的完整 session history、高频追问、用户特征或外部知识来源。Prompt MUST 要求模型不得编造输入中不存在的事实。输出格式 MUST 为每行一条问题，不带序号、标题、解释、Markdown 或推理过程。

所有动态上下文 MUST 来自服务端可信 session message、request run、capability catalog 或 timeline event，MUST NOT 从 HTTP 请求体、客户端 metadata 或模型输出中取得。

#### Scenario: 正常上下文组装

- **WHEN** Port 为一个成功完成的 request run 组装模型请求
- **THEN** system message MUST 包含推荐任务和三行纯文本输出约束
- **AND** user message MUST 非空并包含该 run 的用户问题和最终回答
- **AND** user message MUST 包含明确的本轮生成请求，不能只有字段标签
- **AND** user message MUST 在 Skill 上下文非空时包含 Skill 描述

#### Scenario: 没有 Skill 上下文

- **WHEN** 当前 run 没有 targeted 或实际执行的 Skill
- **THEN** user message MUST 省略 Skill 段
- **AND** Prompt MUST NOT 包含空的 Skill 或用户特征标签

#### Scenario: 上下文不足

- **WHEN** 用户问题或最终回答不足以支持具体的事实型下一步问题
- **THEN** user message MUST 使用显式“未提供”占位，而不是发送空字段值
- **THEN** Prompt MUST 指示模型生成与当前主题相关的具体澄清问题
- **AND** MUST NOT 指示模型因为缺少外部知识来源而返回空内容

#### Scenario: 不声明未提供的数据

- **WHEN** Port 组装推荐 prompt
- **THEN** Prompt MUST NOT 声称已提供完整 session history、高频追问、用户特征或外部知识来源

#### Scenario: 输出格式

- **WHEN** 模型生成推荐结果
- **THEN** Prompt MUST 要求恰好输出三行且每行仅包含一条完整问题
- **AND** MUST 禁止序号、标题、解释、Markdown 和推理过程

### Requirement: Model Invocation for Recommendations

推荐生成 MUST 通过 `ModelInvocationService.complete()` 调用主模型。Model invocation request MUST 满足：
- `tools` 数组 MUST 为空。
- `modelName` 和 `providerKind` MUST 来自 agent assembly 的主 model profile。
- `messages` MUST 包含 Prompt Variable Resolution 定义的 system message 和非空 user message。
- `invocationScope` MUST 使用已完成 run 的 `{ agentId, sessionId, requestId, runId }`。

Port MUST NOT 使用 `ModelInvocationService.stream()`，因为推荐结果不需要流式输出。

#### Scenario: 调用主模型生成推荐

- **WHEN** Port 执行推荐生成
- **THEN** MUST 调用 `ModelInvocationService.complete()` 且 `tools` 为空数组
- **AND** `modelName` 和 `providerKind` MUST 来自 agent assembly 的主 model profile
- **AND** user message MUST 非空

#### Scenario: 不使用流式模型调用

- **WHEN** Port 执行推荐生成
- **THEN** MUST NOT 调用 `ModelInvocationService.stream()`

### Requirement: REST API Endpoint

系统 MUST 提供 `POST /api/v1/sessions/:sessionId/requests/:requestId/suggested-questions` 端点。端点 MUST 从 trusted Web channel identity resolver 解析 owner scope，从 `Session.agentId` 解析 agent scope，并校验 session 和 request 归属。端点 MUST 从当前 request 的有序消息中选择最后一条带 `runId` 消息所引用的 run；当同一 request 因 retry 或 supersede 包含多个 run 时，MUST NOT 选择较早的 run。成功时 MUST 返回 HTTP 200 和 `{ questions: string[] }`。

#### Scenario: 单一 run

- **WHEN** 当前 request 的消息只引用一个 runId
- **THEN** 端点 MUST 使用该 runId 调用 `SuggestedQuestionPort.generate()`

#### Scenario: 同一 request 包含多个 run

- **WHEN** 当前 request 的有序消息先引用旧的 superseded run，后引用新的 completed run
- **THEN** 端点 MUST 使用最后一条带 runId 消息所引用的新 run
- **AND** MUST NOT 使用旧 run 生成推荐

#### Scenario: 没有 runId

- **WHEN** 当前 request 的消息均不包含 runId
- **THEN** 端点 MUST 返回 HTTP 404
