# question-recommendation Specification

## Purpose
定义两类相互独立的问题推荐边界：回答完成后由 `SuggestedQuestionPort` 生成下一步问题的运行时与 Web/前端行为，以及通过 Working Memory `QuestionRecommendationGateway` 查询历史高频问题和预置相似问题的 canonical contract、runtime schema、可信 scope、取消与安全失败语义。

## Function

- **所属 Function**：`FN-1.20 查看推荐问题`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: SuggestedQuestionPort Contract

系统 SHALL 提供独立的 `SuggestedQuestionPort`，接收已完成 request run 的 owner-scoped 和 agent-scoped 坐标（`tenantId`、`subjectId`、`agentId`、`sessionId`、`requestId`、`runId`），异步返回推荐问题列表。Port MUST 是 async contract 并接收 `AbortSignal`；当 signal 已 abort 时 MUST 立即返回空列表。Port MUST NOT 进入 runtime lifecycle、MUST NOT 修改 RequestRun 状态、MUST NOT 写入 canonical timeline。

#### Scenario: 正常生成推荐问题
- **WHEN** 调用 `SuggestedQuestionPort.generate(request, signal)` 且 request 对应的 run 已 terminal committed 且 `terminalStatus === "COMPLETED"`
- **THEN** Port MUST 返回 `{ questions: string[] }`，数组长度 MUST 为 3

#### Scenario: AbortSignal 已取消
- **WHEN** 调用时 `signal.aborted === true`
- **THEN** Port MUST 立即返回 `{ questions: [] }` 且 MUST NOT 发起 model invocation

#### Scenario: 不修改 runtime 状态
- **WHEN** Port 执行推荐生成
- **THEN** MUST NOT 调用 `RuntimeCommandPort`、MUST NOT 修改 `RequestRun` 状态、MUST NOT 向 canonical timeline 追加事件

### Requirement: Terminal Status Guard

Port 实现 MUST 在生成推荐前校验 request run 的 terminal status。只有 `status === "COMPLETED"` 且 `terminalCommitState === "COMMITTED"` 的 run SHALL 生成推荐问题。`status` 为 `FAILED`、`CANCELED` 或 `SUPERSEDED` 时 MUST 返回 `{ questions: [] }` 且 MUST NOT 发起 model invocation。伴随 `DEGRADATION_NOTICE` 但 `status === "COMPLETED"` 且 `terminalCommitState === "COMMITTED"` 的 run（如 `TOOL_ROUND_LIMIT_EXCEEDED`）MUST 视为成功并生成推荐。

#### Scenario: 成功完成的请求
- **WHEN** request run 的 `status === "COMPLETED"` 且 `terminalCommitState === "COMMITTED"`
- **THEN** Port MUST 继续生成推荐问题

#### Scenario: 失败的请求
- **WHEN** request run 的 `status === "FAILED"`
- **THEN** Port MUST 返回 `{ questions: [] }` 且 MUST NOT 发起 model invocation

#### Scenario: 用户取消的请求
- **WHEN** request run 的 `status === "CANCELED"`
- **THEN** Port MUST 返回 `{ questions: [] }` 且 MUST NOT 发起 model invocation

#### Scenario: 降级但完成的请求
- **WHEN** request run 的 `status === "COMPLETED"` 且 `terminalCommitState === "COMMITTED"` 且 timeline 中存在 `DEGRADATION_NOTICE` 事件（如 `TOOL_ROUND_LIMIT_EXCEEDED`）
- **THEN** Port MUST 视为成功并继续生成推荐问题

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

### Requirement: Skill Context Resolution

`{skill}` 变量 MUST 按以下优先级两路取值，取到第一个非空值后立即返回，不再尝试后续路径：

1. **Timeline Routing Evidence 指定 Skill**：从 request run 的 timeline events 中查找 `type === "POLICY_APPLIED"` 且 `inlinePayload.policyDomain === "TARGETED_SKILL"` 且 `inlinePayload.outcome === "constraint-accepted"` 的事件，取其 `inlinePayload.selectedCapabilityId`，通过 `CapabilityCatalog.resolve()` 获取 `CapabilityDescriptor`。若 descriptor 的 `kind === "SKILL"`，取 `displayName + ": " + description`。`AgentRoutingDecision` 不持久化为独立字段，Port 实现通过 timeline routing evidence 事件推断 routing decision。
2. **Timeline 实际调用的 Skill**：从 request run 的 timeline events 中筛选 `type === "CAPABILITY_STARTED"` 的事件，对 `inlinePayload.capabilityId` 去重后逐个通过 `CapabilityCatalog.resolve()` 获取 `CapabilityDescriptor`，过滤 `kind === "SKILL"` 的 descriptor，将每个的 `displayName + ": " + description` 以换行分隔拼接。若无 SKILL capability 调用记录，MUST 使用空字符串。

Recipe/workflow routing decision 路径当前不可实现：`RoutingPolicyEvidence`（由 `RoutingEvidenceRecorder` 记录到 timeline `POLICY_APPLIED` 事件）不包含 `recipeName` 字段，因此 Port 实现无法从 timeline events 推断 recipe routing decision。此路径为 deferred 扩展点，未来若 `RoutingPolicyEvidence` 增加 recipe 信息可通过 OpenSpec change 引入。

Port MUST NOT 在 `{skill}` 中包含 `CapabilityKind === "TOOL"` 的 capability。

#### Scenario: 路由指定 Skill
- **WHEN** request run 的 timeline 中存在 `POLICY_APPLIED` 事件且 `policyDomain === "TARGETED_SKILL"` 且 `outcome === "constraint-accepted"`
- **THEN** `{skill}` MUST 为该 skill 的 `displayName + ": " + description`

#### Scenario: Model-Driven Loop 中调用了 Skill
- **WHEN** request run 的 timeline 中不存在 `TARGETED_SKILL` policy 事件，但存在 `CAPABILITY_STARTED` 事件且对应的 capability `kind === "SKILL"`
- **THEN** `{skill}` MUST 为所有被调用的 SKILL capability 的 `displayName + ": " + description`，以换行分隔拼接

#### Scenario: Model-Driven Loop 中未调用 Skill
- **WHEN** request run 的 timeline 中既不存在 `TARGETED_SKILL` policy 事件，也不存在 `kind === "SKILL"` 的 `CAPABILITY_STARTED` 事件
- **THEN** `{skill}` MUST 为空字符串

#### Scenario: 不包含 Tool capability
- **WHEN** Port 解析 `{skill}` 变量
- **THEN** 结果 MUST NOT 包含任何 `CapabilityKind === "TOOL"` 的 capability 信息

### Requirement: Model Invocation for Recommendations

推荐生成 MUST 通过 `ModelSelectionService.select(request, signal)` 为当前 accepted Agent 和已完成 request/run 的可信 Owner/Agent scope 选择一个 `AVAILABLE` model configuration，再通过 `ModelInvocationService.complete()` 调用该 canonical `modelId`。Model invocation request MUST 满足：

- `SuggestedQuestionRequest` MUST 保持既有 closed fields `tenantId`、`subjectId`、`agentId`、`sessionId`、`requestId` 和 `runId`，MUST NOT 增加由 Web/client 或上游 lifecycle 提供的 operation identity。
- suggested-question service MUST 在每次实际启动推荐模型调用前通过 service-owned cryptographically secure UUID generator 建立 fresh `operationId`；App composition MUST NOT 注入或感知该 generator。该 identity MUST NOT 接受 Web/client、模型输出、Capability 参数或其他不可信 metadata 提供或覆盖。缓存命中且未启动模型调用时 MUST NOT 生成 operation identity。
- `tools` 数组 MUST 为空。
- `modelId` MUST 来自同一次 `ModelSelectionResult.status="SELECTED"` 的 configuration。
- `messages` MUST 包含组装后的 prompt（system message + user message）。
- `invocationScope` MUST 使用模型调用契约定义的 closed scope；tenant/subject、agent/version/assembly MUST 来自已完成 accepted run，scope `operationId` MUST 等于系统为本次实际推荐模型调用建立的 identity。completed run 的 session/request/run coordinates MUST 作为 all-or-none 的真实 causal correlation 进入 scope；这些坐标不成为 lifecycle authority，MUST NOT 使推荐进入 run-bound timeline。
- 推荐 Port MUST 以 closed `ModelInvocationRequest` 交付 canonical `modelId`、scope、messages 和空 tools。locale 只供 recommendation model selection 和 prompt assembly 使用；provider access、header 和 transport 由模型边界拥有。adapter 发起 outbound model HTTP request 时，framework-owned correlation header 集合 MUST 恰好为既有 Agent/Session/Request/Run 四个 headers。background invocation MUST NOT 产生 request-run 模型调用时间线事实。
- 推荐调用 MUST 与其他 concrete provider invocation 使用同一个 `ModelInvocationService`，并执行当前 Agent 已激活的 `BEFORE_MODEL_INVOKE` 与 `AFTER_MODEL_RESULT` hook。合法 model mutation MUST 生效；background `BEFORE_MODEL_INVOKE` hook 返回 `DENY`、`BLOCK` 或 `PEND` 时 MUST 沿用推荐失败/空结果语义且不得启动 provider。推荐 hook MUST NOT 创建 pending input、synthetic run coordinates 或 request-run hook/model timeline。

terminal 后预计算与 Web cache miss/on-demand 生成 MUST 遵守上述相同 selection、identity 和 invocation contract。`RequestLifecycleDependencies.postTerminalCallback` MUST 保持既有 `(command, run, status)` contract；attachment cleanup、非 completed terminal status 和其他 callback consumer MUST NOT 因推荐模型 identity 发生签名或调用语义变化。

推荐 Port MUST NOT 自行读取主/default/first model profile、全局目录或 provider binding，也 MUST NOT 使用 `ModelInvocationService.stream()`。对一次 logical invocation，它 MUST 只调用一次 `ModelInvocationService.complete()`，MUST NOT 包裹同模型 retry 或重置 timeout。Selection、prompt assembly 和 invocation MUST 共享 required cancellation signal；selection failure、cancellation、identity 建立失败或模型调用安全失败 MUST 沿用既有推荐失败/空结果语义，MUST NOT 选择其他 Agent、全局默认或未激活模型。

**需求类别**：功能性需求

#### Scenario: 调用已选择模型生成推荐
- **WHEN** Port 执行推荐生成
- **THEN** MUST 先通过 `ModelSelectionService` 获得当前 accepted Agent 的 selected configuration
- **AND** MUST 以该 configuration 的 canonical `modelId` 调用 `ModelInvocationService.complete()`
- **AND** `tools` MUST 为空数组

#### Scenario: Terminal commit 后生成推荐
- **WHEN** completed run 的 terminal commit 后发起推荐生成
- **THEN** `postTerminalCallback` MUST 继续只接收 `command`、`run` 和 `status`
- **AND** 系统 MUST 在实际模型调用前建立 fresh trusted `operationId`
- **AND** model invocation scope MUST 使用该 identity
- **AND** scope MUST 包含 completed run 的完整 `sessionId`、`requestId` 和 `runId` causal correlation
- **AND** scope MUST 通过 `ModelInvocationScope` closed schema validation
- **AND** adapter 发起 outbound model HTTP request 时，framework-owned correlation header 集合 MUST 恰好为既有 Agent/Session/Request/Run 四个 headers

#### Scenario: Web 按需生成推荐
- **WHEN** Web 推荐请求未命中可用缓存并进入实际模型生成
- **THEN** Web request MUST NOT 提供 operation identity
- **AND** 系统 MUST 按与 terminal 预计算相同的规则建立 fresh trusted `operationId`
- **AND** scope MUST 保留对应 completed run 的真实 causal correlation

#### Scenario: 推荐 operation identity 无法建立
- **WHEN** suggested-question service 的 UUID generator 无法建立合法 `operationId`
- **THEN** provider execution MUST NOT 启动
- **AND** 推荐生成 MUST 沿用既有失败或空结果语义

#### Scenario: Post-terminal callback 的其他责任不受影响
- **WHEN** terminal status 不是 `COMPLETED` 或 callback 执行 attachment cleanup 等既有责任
- **THEN** callback MUST 继续遵守既有三参数 contract 和状态语义
- **AND** 系统 MUST NOT 为没有实际推荐模型调用的路径生成 recommendation operation identity

#### Scenario: 推荐消费者不自行选择主模型
- **WHEN** Agent assembly 有多个 activated models
- **THEN** 推荐 Port MUST NOT 自行读取 default/first profile 或按 display name 选择
- **AND** final model MUST 由 `ModelSelectionService` 唯一决定

#### Scenario: 不使用流式模型调用
- **WHEN** Port 执行推荐生成
- **THEN** MUST NOT 调用 `ModelInvocationService.stream()`

#### Scenario: 推荐模型选择被取消或失败
- **WHEN** selection 被取消或返回 `FAILED`
- **THEN** 推荐 Port MUST NOT 启动 provider execution
- **AND** MUST NOT 回退到全局默认、其他 Agent 或未激活模型

#### Scenario: 推荐调用执行 model hook

- **WHEN** 推荐 Port 通过统一 `ModelInvocationService.complete()` 启动实际 background 模型调用
- **THEN** 当前 Agent 已激活的 `BEFORE_MODEL_INVOKE` 与 `AFTER_MODEL_RESULT` hook MUST 执行
- **AND** background hook MUST NOT 创建 request-run hook/model timeline
- **AND** background `PEND` MUST 在 provider execution 前安全失败并沿用推荐空结果语义

### Requirement: Recommendation Output Cleaning

Port MUST 在解析前清洗模型原始输出，并按以下顺序处理异常格式：

1. 对完整的 `<think>...</think>` 标签对，系统 MUST 删除标签及其内部内容。
2. 对没有对应 `</think>` 的 `<think>`，系统 MUST 删除该开启标签及其后的全部内容。
3. 完整标签对和未闭合开启标签清洗后，如果剩余内容包含一个或多个孤立 `</think>`，系统 MUST 以最后一个孤立闭合标签为边界，删除该标签及其之前的全部内容，只保留标签之后的内容。匹配 MUST 不区分标签大小写。
4. 系统 MUST 删除 Markdown 代码围栏标记行，包括带语言标记的围栏行。
5. 系统 MUST 过滤以“以下是”“下面是”“推荐”或“建议”开头的叙述性段落。
6. 系统 MUST 删除候选问题段首的 Markdown 标题标记。

系统 MUST 过滤清洗后为空的字符串段。清洗后不存在有效内容时，Port MUST 返回 `{ questions: [] }`。系统 MUST NOT 把孤立 `</think>` 之前无法与最终答案可靠区分的内容投影为推荐问题。

**需求类别**：功能性需求

#### Scenario: 完整 think 推理块后包含问题
- **WHEN** 模型输出为 `<think>推理过程</think>\n\n问题1\n\n问题2\n\n问题3`
- **THEN** Port MUST 返回问题1、问题2和问题3，并且结果 MUST NOT 包含推理内容

#### Scenario: 未闭合 think 开启标签
- **WHEN** 模型输出为 `<think>被截断的推理过程`，且不存在闭合标签
- **THEN** Port MUST 返回 `{ questions: [] }`

#### Scenario: 开启标签缺失且推理位于孤立闭合标签之前
- **WHEN** 模型输出为 `裸露推理过程\n</think>\n问题1\n问题2\n问题3`
- **THEN** Port MUST 返回问题1、问题2和问题3，并且结果 MUST NOT 包含裸露推理过程

#### Scenario: 存在多个孤立闭合标签
- **WHEN** 模型输出包含多个没有对应开启标签的 `</think>`，且最后一个孤立闭合标签之后包含三个问题
- **THEN** Port MUST 只解析最后一个孤立闭合标签之后的三个问题

#### Scenario: 孤立闭合标签之后没有有效问题
- **WHEN** 模型输出仅包含裸露推理过程和孤立 `</think>`，标签之后为空白
- **THEN** Port MUST 返回 `{ questions: [] }`

#### Scenario: 孤立闭合标签大小写混合
- **WHEN** 模型输出包含 `</THINK>`，其前方是裸露推理过程且后方包含三个问题
- **THEN** Port MUST 返回标签之后的三个问题，并且结果 MUST NOT 包含裸露推理过程

#### Scenario: Markdown 和叙述性文本清洗
- **WHEN** 模型输出的问题被 Markdown 代码围栏、标题标记或叙述性段落包围
- **THEN** Port MUST 删除这些格式内容并返回清洗后的问题文本

### Requirement: Recommendation Output Parsing

Port MUST 将模型输出解析为恰好 3 个推荐问题。解析规则：
- MUST 在解析前先执行 Recommendation Output Cleaning 的全部清洗规则。
- MUST 按空行分割清洗后的输出为多个问题段。
- 每个问题段 MUST 去除首尾空白后作为一条推荐问题。
- MUST 过滤掉空字符串段。
- 若解析后问题数量不足 3 条，MUST 返回已解析到的非空问题（数量可少于 3）。
- 若解析后问题数量超过 3 条，MUST 只取前 3 条。
- 推荐问题 MUST NOT 包含序号前缀；若模型输出包含序号，MUST 去除序号前缀。

#### Scenario: 正常输出解析
- **WHEN** 模型输出为 3 个由空行分隔的问题段
- **THEN** Port MUST 返回包含 3 条问题的 `{ questions: string[] }`

#### Scenario: 输出不足 3 条
- **WHEN** 模型输出只包含 2 个非空问题段
- **THEN** Port MUST 返回包含 2 条问题的 `{ questions: string[] }`

#### Scenario: 输出超过 3 条
- **WHEN** 模型输出包含 5 个非空问题段
- **THEN** Port MUST 只返回前 3 条问题

#### Scenario: 输出包含序号前缀
- **WHEN** 模型输出的问题段以序号前缀开头（如 "1. " 或 "1、 "）
- **THEN** Port MUST 去除序号前缀后返回纯问题文本

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

### Requirement: No Caching

每次调用 `SuggestedQuestionPort.generate()` 或 REST API 端点 MUST 重新生成推荐问题。系统 MUST NOT 缓存推荐结果。同一 `requestId` 的多次调用 MAY 返回不同结果（因模型非确定性）。

#### Scenario: 重复调用重新生成
- **WHEN** 对同一 `requestId` 连续调用两次推荐接口
- **THEN** 两次调用 MUST 各自独立发起 model invocation
- **AND** MUST NOT 使用任何缓存的推荐结果

### Requirement: Frontend Recommendation Trigger

前端 MUST 在收到 `REQUEST_COMPLETED` stream event、会话中最新的 turn 通过实时 stream 接收、且 runtime bootstrap 的 `portalAbilityConfig.suggestedQuestionsEnabled` 不为 `false` 时自动调用推荐接口。前端 MUST NOT 在 `REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED` 事件后调用推荐接口。若推荐接口请求失败或返回空列表，前端 MUST 静默不展示推荐区域，MUST NOT 向用户报错。

前端 MUST 仅对会话中最新的 turn（`isLatest`）且该 turn 是通过实时 stream 接收的（`isLiveStreamed`，即 turn 的事件不包含 `history-load` transport hint）触发推荐接口调用。从会话历史加载的 turn MUST NOT 触发推荐接口调用。当 bootstrap 未返回 `portalAbilityConfig` 或该字段非法时，前端 MUST 使用默认值 `true` 判断是否展示下一步问题推荐组件。

**需求类别**：功能性需求

#### Scenario: 流式回答完成后触发推荐
- **WHEN** 前端收到 `REQUEST_COMPLETED` stream event 且该 turn 是会话中最新的 turn 且通过实时 stream 接收
- **AND** `portalAbilityConfig.suggestedQuestionsEnabled` 不为 `false`
- **THEN** 前端 MUST 自动调用 `POST /api/v1/sessions/:sessionId/requests/:requestId/suggested-questions`

#### Scenario: 推荐问题开关关闭时不调用接口
- **WHEN** 前端收到满足既有触发条件的 `REQUEST_COMPLETED` stream event
- **AND** `portalAbilityConfig.suggestedQuestionsEnabled === false`
- **THEN** 前端 MUST NOT 挂载推荐问题组件
- **AND** MUST NOT 调用推荐接口

#### Scenario: bootstrap 缺失 portalAbilityConfig 时使用默认开启
- **WHEN** runtime bootstrap response 未包含 `portalAbilityConfig`
- **AND** 前端收到满足既有触发条件的 `REQUEST_COMPLETED` stream event
- **THEN** 前端 MUST 按 `suggestedQuestionsEnabled=true` 处理
- **AND** MUST 保持既有推荐问题触发行为

#### Scenario: 失败的请求不触发推荐
- **WHEN** 前端收到 `REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED` stream event
- **THEN** 前端 MUST NOT 调用推荐接口

#### Scenario: 历史加载的 turn 不触发推荐
- **WHEN** 前端从会话历史加载一个已完成的 turn（turn 事件包含 `history-load` transport hint）
- **THEN** 前端 MUST NOT 调用推荐接口

#### Scenario: 推荐接口失败时静默
- **WHEN** 推荐接口返回错误或返回 `{ questions: [] }`
- **THEN** 前端 MUST NOT 展示推荐区域且 MUST NOT 向用户显示错误

### Requirement: Frontend Recommendation Component

推荐问题组件 MUST 渲染在当前消息的点赞、点踩、收藏按钮下方 16px 处，左侧对齐。每个推荐问题 MUST 以独立圆角矩形展示，矩形参数：`height: 32px; display: flex; flex-direction: row; justify-content: flex-start; align-items: center; gap: 4px; padding: 5px 12px; border-radius: 8px;`。每个矩形占一行，行间距 12px，所有矩形左侧对齐。点击推荐问题矩形后 MUST 自动将该问题作为下一个请求发送（等价于用户在输入框输入该问题并提交）。推荐问题组件 MUST 在推荐接口请求期间展示 loading 状态。

#### Scenario: 推荐问题渲染
- **WHEN** 推荐接口返回 `{ questions: ["问题1", "问题2", "问题3"] }`
- **THEN** 前端 MUST 在点赞/点踩/收藏按钮下方 16px 处渲染 3 个圆角矩形
- **AND** 每个矩形占一行，行间距 12px，左侧对齐
- **AND** 矩形内显示对应的推荐问题文本

#### Scenario: 点击推荐问题发送
- **WHEN** 用户点击某个推荐问题矩形
- **THEN** 前端 MUST 自动将该问题文本作为下一个请求提交
- **AND** 行为 MUST 等价于用户在输入框输入该文本并点击发送

#### Scenario: Loading 状态
- **WHEN** 推荐接口请求进行中
- **THEN** 前端 MUST 展示 loading 状态
- **AND** MUST NOT 展示空的推荐问题矩形

#### Scenario: 无推荐问题时不展示
- **WHEN** 推荐接口返回 `{ questions: [] }` 或请求失败
- **THEN** 前端 MUST NOT 渲染推荐问题组件

### Requirement: Question recommendation Working Memory binding

`agent-contracts/gateway` MUST 定义唯一的 `QuestionRecommendationGateway`，并通过 `WorkingMemoryGatewayBindings.questionRecommendations` 暴露该 gateway。`GatewayBindings` MUST NOT 增加平行的顶层问题推荐 binding，`GatewayAdapterKind` MUST NOT 增加问题推荐专用 kind。

`questionRecommendations` MUST 是可选 binding。仅当当前 deployment 尚未提供正式问题推荐 adapter 时，composition MAY 不注入该 binding；未注入时，gateway consumer MUST 将正式问题推荐能力视为不可用，MUST NOT 改为调用既有 Pin、高频问题或问题联想 persistence contract。

#### Scenario: Working Memory 提供问题推荐 gateway
- **GIVEN** 当前 deployment 已配置正式问题推荐 adapter
- **WHEN** app composition 构造 `WorkingMemoryGatewayBindings`
- **THEN** `questionRecommendations` MUST 指向一个 `QuestionRecommendationGateway`
- **AND** 顶层 `GatewayBindings` MUST NOT 出现第二个问题推荐 binding

#### Scenario: 问题推荐 adapter 尚未配置
- **GIVEN** 当前 deployment 未配置正式问题推荐 adapter
- **WHEN** app composition 构造 `WorkingMemoryGatewayBindings`
- **THEN** `questionRecommendations` MAY 缺失
- **AND** consumer MUST 将该能力判定为不可用
- **AND** consumer MUST NOT 用现有问题活动 store 伪造正式问题推荐结果

### Requirement: 历史高频问题查询契约

`QuestionRecommendationGateway.listFrequentHistoryQuestions()` MUST 接收 `ListFrequentHistoryQuestionsRequest`，并返回 `Promise<ListFrequentHistoryQuestionsResult | SafeError>`。该方法 MUST 接收可选 `AbortSignal`；signal 在调用前已取消或调用中被取消时，gateway MUST 停止可取消的远程工作并返回取消类 `SafeError`。

请求 MUST 包含非空 `tenantId`、`subjectId`、`agentId` 和整数 `limit`；`limit` 的允许范围为 1 至 10（含边界）。请求 MAY 包含长度为 1 至 10 个字符的 `locale`；当调用方不提供 `locale` 时，gateway MUST 不附加语言筛选。调用方 MUST 从可信 identity 和 Agent Scope 提供 `tenantId`、`subjectId`、`agentId`，gateway MUST NOT 接受客户端 metadata、模型输出或 capability 参数覆盖这些值。

成功结果 MUST 包含 `questions` 数组；每项 MUST 包含非空 `content` 和 0 至 2147483647 范围内的整数 `frequency`。结果条目数量 MUST 小于或等于请求的 `limit`，并 MUST 保持服务返回的相对顺序；服务返回数量超过 `limit` 时，gateway MUST 只保留前 `limit` 项。无匹配数据时 MUST 返回 `{ questions: [] }`。gateway 不得修改任何持久化状态。

#### Scenario: 查询当前 scope 的历史高频问题
- **WHEN** 调用方以可信 scope `(T1, U1, A1)` 调用 `listFrequentHistoryQuestions({ tenantId: T1, subjectId: U1, agentId: A1, limit: 5 })`
- **THEN** gateway MUST 只查询该 scope 的历史高频问题
- **AND** 成功结果中的每项 MUST 只包含 canonical 问题文本和非负整数频次

#### Scenario: 历史高频问题为空
- **WHEN** 当前 Owner Scope 和 Agent Scope 没有历史高频问题
- **THEN** gateway MUST 返回 `{ questions: [] }`
- **AND** MUST NOT 返回 `undefined` 或伪造默认问题

#### Scenario: 历史高频问题数量越界
- **WHEN** `limit` 小于 1 或大于 10，或者 `limit` 不是整数
- **THEN** request schema validation MUST 失败
- **AND** gateway adapter MUST NOT 发起远程调用

#### Scenario: 历史高频问题结果不合法
- **WHEN** provider 成功响应包含空问题文本、负频次或非整数频次
- **THEN** result schema validation MUST 失败
- **AND** gateway MUST 返回安全的无效 provider result `SafeError`
- **AND** MUST NOT 向 consumer 返回部分未验证数据

### Requirement: 预置相似问题查询契约

`QuestionRecommendationGateway.recommendSimilarPresetQuestions()` MUST 接收 `RecommendSimilarPresetQuestionsRequest`，并返回 `Promise<RecommendSimilarPresetQuestionsResult | SafeError>`。该方法 MUST 接收可选 `AbortSignal`；signal 在调用前已取消或调用中被取消时，gateway MUST 停止可取消的远程工作并返回取消类 `SafeError`。

请求 MUST 包含非空 `tenantId`、`subjectId`、`agentId`、`query` 和整数 `limit`。`query` 长度 MUST 为 1 至 512 个字符（含边界），`limit` MUST 为 1 至 20（含边界）。请求 MAY 包含 `locale`、`product`、`domain` 和 `scene`；缺失的可选字段 MUST 保持缺失，不得由 gateway 推断。`locale` 长度 MUST 为 1 至 10 个字符（含边界）；`product` MUST 匹配 `^[a-zA-Z0-9-]{1,64}$`；`domain` 和 `scene` 长度 MUST 为 1 至 128 个字符（含边界）。

成功结果 MUST 包含 `questions` 数组；每项 MUST 包含非空 `questionId` 和非空 `content`。结果条目数量 MUST 小于或等于请求的 `limit`，并 MUST 保持服务返回的相对顺序；服务返回数量超过 `limit` 时，gateway MUST 只保留前 `limit` 项。无匹配数据时 MUST 返回 `{ questions: [] }`。gateway 不得修改任何持久化状态。

#### Scenario: 查询预置相似问题
- **WHEN** 调用方以可信 scope、非空查询文本和合法 `limit` 调用 `recommendSimilarPresetQuestions()`
- **THEN** gateway MUST 返回按 provider 顺序排列的 canonical `questions`
- **AND** 每项 MUST 包含非空 `questionId` 和 `content`

#### Scenario: 不提供可选检索维度
- **WHEN** 请求未提供 `locale`、`product`、`domain` 和 `scene`
- **THEN** gateway MUST 保持这些字段缺失
- **AND** MUST NOT 根据客户端 metadata、模型输出或 capability 参数补齐这些字段

#### Scenario: 相似问题请求越界
- **WHEN** `query` 为空或超过 512 个字符，或者 `limit` 不在 1 至 20 的整数范围内
- **THEN** request schema validation MUST 失败
- **AND** gateway adapter MUST NOT 发起远程调用

#### Scenario: 相似问题结果不合法
- **WHEN** provider 成功响应中的任一项缺少非空 `questionId` 或非空 `content`
- **THEN** result schema validation MUST 失败
- **AND** gateway MUST 返回安全的无效 provider result `SafeError`
- **AND** MUST NOT 向 consumer 返回部分未验证数据

### Requirement: 问题推荐 runtime schema

`agent-contracts/gateway` MUST 为两类 request 和两类成功 result 分别导出 runtime JSON schema。全部 schema MUST 拒绝未知字段；字符串范围、整数范围、必填字段和可选字段 MUST 与 TypeScript contract 一致。gateway adapter MUST 在访问外部服务前验证 canonical request，并在返回 consumer 前验证 canonical success result。

#### Scenario: request 包含未知字段
- **WHEN** 任一问题推荐 request 包含 contract 未定义的字段
- **THEN** 对应 request schema MUST 拒绝该对象
- **AND** gateway adapter MUST NOT 发起远程调用

#### Scenario: result 包含未知字段
- **WHEN** canonical success result 包含 contract 未定义的字段
- **THEN** 对应 result schema MUST 拒绝该对象
- **AND** gateway MUST 返回安全的无效 provider result `SafeError`

### Requirement: 问题推荐安全失败语义

`QuestionRecommendationGateway` MUST 使用以下穷尽的 `SafeError.code` 表达失败，MUST NOT 把服务错误体、URL、credential、查询文本、推荐内容或原始异常放入 `message` 或 `safeDetails`：

- canonical request validation 失败：`QUESTION_RECOMMENDATION_INVALID_INPUT`，category 为 `VALIDATION`，`retryable=false`；
- `AbortSignal` 已取消或调用中取消：`QUESTION_RECOMMENDATION_CANCELED`，category 为 `CANCELED`，`retryable=false`；
- 服务不可用、超时或调用失败：`QUESTION_RECOMMENDATION_UNAVAILABLE`，category 为 `UNAVAILABLE`，`retryable=true`；
- 服务成功响应不能形成合法 canonical result：`QUESTION_RECOMMENDATION_INVALID_PROVIDER_RESULT`，category 为 `UNAVAILABLE`，`retryable=true`。

#### Scenario: 服务调用失败
- **WHEN** 问题推荐服务不可用、超时或调用失败
- **THEN** gateway MUST 返回 `SafeError { code: "QUESTION_RECOMMENDATION_UNAVAILABLE", category: "UNAVAILABLE", retryable: true }`
- **AND** SafeError MUST NOT 包含服务错误体、URL、credential、查询文本、推荐内容或原始异常

#### Scenario: 调用被取消
- **WHEN** 调用方提供的 `AbortSignal` 在调用前已取消或调用中被取消
- **THEN** gateway MUST 返回 `SafeError { code: "QUESTION_RECOMMENDATION_CANCELED", category: "CANCELED", retryable: false }`
- **AND** gateway MUST 停止仍可取消的远程工作

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

### Requirement: Suggested questions backend feature gate

当 effective `suggested-questions-enabled=false` 时，该功能开关 MUST 优先于推荐问题生成和 `No Caching` 的生成义务。系统 MUST 跳过 completed request terminal 后的推荐问题预计算，MUST NOT 发起推荐问题 model invocation。推荐问题 REST endpoint MUST 返回 HTTP 200 和 `{ questions: [] }`，且 MUST NOT 调用 `SuggestedQuestionPort.generate()` 或发起 model invocation。当开关为 `true` 时，既有推荐问题状态校验、生成、解析和失败降级行为 MUST 保持不变。

**需求类别**：系统质量属性

**质量属性**：性能/容量

**适用范围**：`FN-1.20 查看推荐问题`

#### Scenario: 关闭开关时 terminal 后不预计算
- **WHEN** request run 成功 terminal commit
- **AND** effective `suggested-questions-enabled=false`
- **THEN** 系统 MUST NOT 执行推荐问题预计算
- **AND** MUST NOT 发起推荐问题 model invocation

#### Scenario: 关闭开关时 REST 返回空列表
- **WHEN** client 调用 suggested-questions REST endpoint
- **AND** effective `suggested-questions-enabled=false`
- **THEN** endpoint MUST 返回 HTTP 200 和 `{ questions: [] }`
- **AND** MUST NOT 调用 `SuggestedQuestionPort.generate()`
- **AND** MUST NOT 发起 model invocation

#### Scenario: 开启开关时保持既有行为
- **WHEN** effective `suggested-questions-enabled=true`
- **THEN** 系统 MUST 保持既有 terminal 状态校验、推荐生成和空结果降级行为
