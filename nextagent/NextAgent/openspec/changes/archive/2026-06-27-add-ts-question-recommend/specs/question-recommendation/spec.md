## ADDED Requirements

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

推荐生成的 prompt MUST 包含以下 4 个变量，由 Port 实现从可信数据源组装：
- `{query}`：用户原始问题，MUST 来自 request run 对应的 `role === "USER"` 的 session message content。若 inputText 为空（如 pending input 恢复场景）MUST 使用空字符串。
- `{skill}`：当前意图上下文，MUST 按 Skill Context Resolution requirement 的两路逻辑解析。
- `{final_answer}`：AI 最终回答，MUST 来自 terminal commit 写入的 `role === "ASSISTANT"` 的 session message content。若 terminal content 超长被截断 MUST 使用截断后的 `safeTerminalSummary`。
- `{user_features}`：用户特征，当前 MUST 为空字符串。此变量为预留扩展点，未来可从 `USER_CHARACTERISTICS` 或 `USER_PREFERENCE` memory category 获取。

所有变量 MUST 从可信 owner scope 和 agent scope 数据源获取，MUST NOT 从请求体、客户端 metadata 或模型输出中获取。

#### Scenario: 正常变量组装
- **WHEN** Port 为一个 COMPLETED 的 request run 组装 prompt
- **THEN** `{query}` MUST 来自该 run 的 USER message content
- **AND** `{final_answer}` MUST 来自该 run 的 terminal ASSISTANT message content
- **AND** `{skill}` MUST 按 Skill Context Resolution 逻辑解析
- **AND** `{user_features}` MUST 为空字符串

#### Scenario: 变量来源安全
- **WHEN** Port 组装 prompt 变量
- **THEN** 所有变量 MUST 从服务端可信数据源（session message、request run、capability catalog、timeline event）获取
- **AND** MUST NOT 从 HTTP 请求体、客户端 metadata 或模型输出中获取变量值

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

推荐生成 MUST 通过 `ModelInvocationService.complete()` 调用主模型。Model invocation request MUST 满足：
- `tools` 数组 MUST 为空（不携带任何 tool descriptor）。
- `modelName` 和 `providerKind` MUST 来自 agent assembly 的主 model profile。
- `messages` MUST 包含组装后的 prompt（system message + user message）。
- `invocationScope` MUST 使用已完成 run 的 `{ agentId, sessionId, requestId, runId }`。

Port MUST NOT 使用 `ModelInvocationService.stream()`，因为推荐结果是同步返回的 JSON，不需要流式输出。

#### Scenario: 调用主模型生成推荐
- **WHEN** Port 执行推荐生成
- **THEN** MUST 调用 `ModelInvocationService.complete()` 且 `tools` 为空数组
- **AND** `modelName` 和 `providerKind` MUST 来自 agent assembly 的主 model profile

#### Scenario: 不使用流式模型调用
- **WHEN** Port 执行推荐生成
- **THEN** MUST NOT 调用 `ModelInvocationService.stream()`

### Requirement: Recommendation Output Cleaning

Port MUST 在解析前对模型原始输出进行清洗，处理模型常见的异常输出格式。清洗规则按以下顺序执行：

1. **推理块剥离**：MUST 移除完整的 `<think>...</think>` 标签对及其内部内容。MUST 移除未闭合的 `<think>` 标签及其后所有内容（模型推理被截断的场景）。MUST 移除孤立的 `</think>` 闭合标签。
2. **Markdown 围栏剥离**：MUST 移除 ` ``` ` 代码围栏标记行（包括带语言标记的 ` ```markdown ` 等）。
3. **叙述性前导/尾部文本过滤**：MUST 过滤掉以常见叙述性短语开头的段（如"以下是"、"下面是"、"推荐"、"建议"等），这些段不是推荐问题本身。
4. **Markdown 标题标记剥离**：MUST 移除段首的 Markdown 标题标记（`#`、`##`、`###` 等）。

清洗后剩余的空字符串段 MUST 被过滤。若清洗后无有效内容，MUST 返回 `{ questions: [] }`。

#### Scenario: 输出包含完整 think 推理块
- **WHEN** 模型输出包含 `<think>推理过程</think>\n\n问题1\n\n问题2\n\n问题3`
- **THEN** Port MUST 剥离 think 块后返回 3 条问题，不包含推理内容

#### Scenario: 输出包含未闭合 think 标签
- **WHEN** 模型输出包含 `<think>推理过程被截断`（无闭合标签）
- **THEN** Port MUST 移除 `<think>` 及其后的所有内容；若其后无有效问题段，MUST 返回 `{ questions: [] }`

#### Scenario: 输出包含孤立闭合 think 标签
- **WHEN** 模型输出包含 `</think>\n\n问题1\n\n问题2\n\n问题3`
- **THEN** Port MUST 移除孤立的 `</think>` 标签后返回 3 条问题

#### Scenario: 输出包含 Markdown 代码围栏
- **WHEN** 模型输出包含代码围栏标记行 ` ``` ` 包裹问题
- **THEN** Port MUST 移除围栏标记行后返回问题

#### Scenario: 输出包含叙述性前导文本
- **WHEN** 模型输出包含以"以下是"、"下面是"、"推荐"等叙述性短语开头的段
- **THEN** Port MUST 过滤该段，不将其作为推荐问题

#### Scenario: 输出包含 Markdown 标题标记
- **WHEN** 模型输出的问题段以 `#`、`##`、`###` 等 Markdown 标题标记开头
- **THEN** Port MUST 移除标题标记后返回纯问题文本

#### Scenario: 清洗后无有效内容
- **WHEN** 模型输出全部是推理内容或叙述性文本，清洗后无有效问题段
- **THEN** Port MUST 返回 `{ questions: [] }`

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

系统 MUST 提供 `POST /api/v1/sessions/:sessionId/requests/:requestId/suggested-questions` 端点。端点行为：
- MUST 通过 trusted Web channel identity resolver 从请求认证信息解析 owner scope（`tenantId`、`subjectId`）。
- MUST 通过 `Session.agentId` 解析 agent scope，MUST NOT 从请求体获取 `agentId`。
- MUST 校验 `sessionId` 属于当前 owner scope。
- MUST 校验 `requestId` 属于当前 `sessionId` 且其 `agentId` 与 session-bound `agentId` 一致。
- 成功时 MUST 返回 HTTP 200 和 `{ questions: string[] }` JSON 响应。
- 当 `sessionId` 不属于当前 owner scope 时 MUST 返回 HTTP 404（`requireSession()` 按 `tenantId` + `subjectId` 查询，不匹配时抛 `SESSION_NOT_FOUND`）。
- 当 request 不存在或不属于当前 `sessionId` 时 MUST 返回 HTTP 404。
- 当 terminal status 不是 `COMPLETED` 时 MUST 返回 HTTP 200 和 `{ questions: [] }`（非错误状态）。

端点 MUST NOT 将 `questions` 内容写入日志、metric、trace 或 audit。端点 MUST NOT 在响应中暴露 prompt 原文、模型原始输出或 provider response metadata。

#### Scenario: 正常请求
- **WHEN** 已认证用户 POST 有效的 `sessionId` 和 `requestId`，且对应 run 已 `COMPLETED`
- **THEN** 端点 MUST 返回 HTTP 200 和 `{ questions: [...] }` JSON

#### Scenario: Session 不属于当前用户
- **WHEN** `sessionId` 不属于当前 owner scope
- **THEN** 端点 MUST 返回 HTTP 404

#### Scenario: Request 不属于当前 session
- **WHEN** `requestId` 不属于 `sessionId` 或 `agentId` 不一致
- **THEN** 端点 MUST 返回 HTTP 404

#### Scenario: 未完成的请求
- **WHEN** request run 的 `terminalStatus` 不是 `COMPLETED`
- **THEN** 端点 MUST 返回 HTTP 200 和 `{ questions: [] }`

#### Scenario: 推荐内容不记入日志
- **WHEN** 端点处理推荐请求
- **THEN** 日志、metric、trace 和 audit MUST NOT 包含 `questions` 内容、prompt 原文或模型原始输出

### Requirement: No Caching

每次调用 `SuggestedQuestionPort.generate()` 或 REST API 端点 MUST 重新生成推荐问题。系统 MUST NOT 缓存推荐结果。同一 `requestId` 的多次调用 MAY 返回不同结果（因模型非确定性）。

#### Scenario: 重复调用重新生成
- **WHEN** 对同一 `requestId` 连续调用两次推荐接口
- **THEN** 两次调用 MUST 各自独立发起 model invocation
- **AND** MUST NOT 使用任何缓存的推荐结果

### Requirement: Frontend Recommendation Trigger

前端 MUST 在收到 `REQUEST_COMPLETED` stream event 后自动调用推荐接口。前端 MUST NOT 在 `REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED` 事件后调用推荐接口。若推荐接口请求失败或返回空列表，前端 MUST 静默不展示推荐区域，MUST NOT 向用户报错。
前端 MUST 仅对会话中最新的 turn（`isLatest`）且该 turn 是通过实时 stream 接收的（`isLiveStreamed`，即 turn 的事件不包含 `history-load` transport hint）触发推荐接口调用。从会话历史加载的 turn MUST NOT 触发推荐接口调用。

#### Scenario: 流式回答完成后触发推荐
- **WHEN** 前端收到 `REQUEST_COMPLETED` stream event 且该 turn 是会话中最新的 turn 且通过实时 stream 接收
- **THEN** 前端 MUST 自动调用 `POST /api/v1/sessions/:sessionId/requests/:requestId/suggested-questions`

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
