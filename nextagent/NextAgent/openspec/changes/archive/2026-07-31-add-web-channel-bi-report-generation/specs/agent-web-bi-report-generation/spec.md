## ADDED Requirements

### Requirement: 答案操作栏生成报告入口

`agent-web` SHALL 在每轮已完成问答的助手答案操作栏（`BubbleActions`）中提供"生成报告"按钮入口。该按钮 MUST 位于"重新生成"按钮之前，与复制、点赞/点踩、分享等操作按钮处于同一操作行。当 TurnBlock 满足可报告判定（`resolveReportableRequestId` 返回非 `undefined`）且不处于任何勾选模式（报告勾选模式或分享勾选模式）且不是合成报告 TurnBlock（`rootMessageId` 不以 `bi-report:` 开头）时，MUST 渲染"生成报告"按钮；否则 MUST NOT 渲染该按钮。

当处于报告勾选模式或分享勾选模式时，"生成报告"按钮 MUST NOT 出现。当 TurnBlock 不满足可报告判定时，"生成报告"按钮 MUST NOT 出现。

#### Scenario: 可报告 TurnBlock 显示生成报告按钮

- **GIVEN** 一个已完成的助手答案 TurnBlock 满足可报告判定
- **AND** 当前不处于任何勾选模式
- **THEN** 答案操作栏 MUST 出现"生成报告"按钮
- **AND** 该按钮 MUST 位于"重新生成"按钮之前

#### Scenario: 不可报告 TurnBlock 不显示生成报告按钮

- **GIVEN** 一个 TurnBlock 不满足可报告判定（如非终结状态、FAILED、无正文等）
- **THEN** 答案操作栏 MUST NOT 出现"生成报告"按钮

#### Scenario: 勾选模式下不显示生成报告按钮

- **GIVEN** 当前处于报告勾选模式或分享勾选模式
- **WHEN** 渲染助手答案操作栏
- **THEN** MUST NOT 出现"生成报告"按钮

#### Scenario: 合成报告 TurnBlock 不显示生成报告按钮

- **GIVEN** 一个合成报告 TurnBlock（`rootMessageId` 以 `bi-report:` 开头）
- **THEN** MUST NOT 出现"生成报告"按钮

### Requirement: 生成报告按钮触发报告勾选模式

点击答案操作栏的"生成报告"按钮 SHALL 进入报告勾选模式。进入报告勾选模式时，分享勾选模式 MUST 自动退出（互斥），当前问答对的 requestId MUST 默认被勾选。进入报告勾选模式后，答案操作栏的"生成报告"按钮 MUST 隐藏（因处于勾选模式）。

#### Scenario: 点击生成报告进入勾选模式

- **WHEN** 用户点击答案操作栏的"生成报告"按钮
- **THEN** MUST 进入报告勾选模式
- **AND** 若当前处于分享勾选模式，分享勾选模式 MUST 退出
- **AND** 该按钮所属问答对的 requestId MUST 默认勾选
- **AND** 答案操作栏的"生成报告"按钮 MUST 隐藏

### Requirement: 报告勾选模式交互

报告勾选模式 SHALL 镜像分享勾选模式的交互骨架：每轮有 requestId 的问答对（非合成报告 TurnBlock）左侧出现 checkbox，会话面板底部出现报告操作栏（全选 checkbox + 已选 x 个对话 + 取消按钮 + 生成报告按钮）。进入报告勾选模式后，所有 TurnBlock 的分享按钮和派生按钮 MUST 隐藏。

不可报告的 TurnBlock（`resolveReportableRequestId` 返回 `undefined`）的 checkbox MUST 渲染但处于禁用状态，与分享勾选模式中不可分享 TurnBlock 的处理方式一致。合成报告 TurnBlock（`rootMessageId` 以 `bi-report:` 开头）MUST NOT 出现 checkbox。

报告勾选模式 MUST 支持退出：点击取消按钮或按 ESC 退出，退出后恢复正常对话视图并清空已选集合。

#### Scenario: 进入报告勾选模式后 UI 变化

- **WHEN** 进入报告勾选模式
- **THEN** 每轮有 requestId 的问答对（非合成报告 TurnBlock）左侧 MUST 出现 checkbox
- **AND** 底部 MUST 出现报告操作栏（全选 + 已选计数 + 取消 + 生成报告）
- **AND** 所有 TurnBlock 的分享按钮和派生按钮 MUST 隐藏

#### Scenario: 不可报告 TurnBlock 的 checkbox 禁用

- **GIVEN** 一个 TurnBlock 有 requestId 但不满足可报告判定（如非终结状态、FAILED、无正文等）
- **WHEN** 进入报告勾选模式
- **THEN** 该 TurnBlock 左侧 MUST 出现 checkbox
- **AND** 该 checkbox MUST 处于禁用状态

#### Scenario: 合成报告 TurnBlock 不出现 checkbox

- **GIVEN** 一个合成报告 TurnBlock（`rootMessageId` 以 `bi-report:` 开头）
- **WHEN** 进入报告勾选模式或分享勾选模式
- **THEN** 该 TurnBlock MUST NOT 出现 checkbox

#### Scenario: 取消退出报告勾选模式

- **GIVEN** 当前处于报告勾选模式
- **WHEN** 用户点击取消按钮或按 ESC
- **THEN** MUST 退出报告勾选模式
- **AND** checkbox 和报告操作栏 MUST 消失
- **AND** 已选集合 MUST 被清空
- **AND** 分享按钮和派生按钮 MUST 恢复显示

### Requirement: 报告可勾选规则

`resolveReportableRequestId(block)` SHALL 返回符合以下全部条件的 TurnBlock 的 `requestId`，否则返回 `undefined`：

1. 该 TurnBlock 已终结（`status` 为 `COMPLETED`/`CANCELED`/`SUPERSEDED`，不含 `FAILED`）；正在回答中的 TurnBlock（非终结状态）MUST NOT 可勾选。
2. 该 TurnBlock 的答案区有正文。正文判定来源为 `LLM_CONTENT_DELTA` 累积文本或 `TOOL_STRUCTURED_DELTA`（`toolEventType === "ANSWER"`）结构化片段。
3. 对答案正文类型有限制：
   - 当正文来源为 `LLM_CONTENT_DELTA` 时，MUST 为纯文本。
   - 当正文来源为 `TOOL_STRUCTURED_DELTA`（`toolEventType === "ANSWER"`）时，`toolMessageType` MUST 为 `TEXT` 或 `DSL`。
   - 当 `toolMessageType` 为 `DSL` 时，解析其 `content` 为对象 `obj`，MUST 满足 `obj.type === "piu"` 且 `obj.properties.name === "dte-bi-agent"`；不满足的 DSL MUST NOT 可勾选。
   - 其他 `toolMessageType`（`PIU`/`ACTION`/`OPERATOR`/`FILE`）的 ANSWER MUST NOT 可勾选。

`resolveReportableRequestId` MUST 返回 `requestId`（取自该 TurnBlock 的 `aiEvents` 中首个事件的 `requestId`），而非 `runId`。该函数是 TurnBlock（per-item checkbox）和 ChatPage（select-all 集合）的单一事实来源。

#### Scenario: 已完成且有纯文本答案可勾选

- **GIVEN** 一个 TurnBlock `status === "COMPLETED"`，答案来自 `LLM_CONTENT_DELTA` 纯文本
- **THEN** `resolveReportableRequestId` MUST 返回该 TurnBlock 的 `requestId`

#### Scenario: 已完成且有 TEXT 结构化答案可勾选

- **GIVEN** 一个 TurnBlock `status === "COMPLETED"`，答案来自 `TOOL_STRUCTURED_DELTA`（`toolEventType === "ANSWER"`，`toolMessageType === "TEXT"`）
- **THEN** `resolveReportableRequestId` MUST 返回该 TurnBlock 的 `requestId`

#### Scenario: DSL 结构化答案满足 dte-bi-agent 可勾选

- **GIVEN** 一个 TurnBlock `status === "COMPLETED"`，答案来自 `TOOL_STRUCTURED_DELTA`（`toolEventType === "ANSWER"`，`toolMessageType === "DSL"`），其 `content` 解析后 `obj.type === "piu"` 且 `obj.properties.name === "dte-bi-agent"`
- **THEN** `resolveReportableRequestId` MUST 返回该 TurnBlock 的 `requestId`

#### Scenario: 正在回答中的不可勾选

- **GIVEN** 一个 TurnBlock `status` 为 `ACCEPTED`/`QUEUED`/`PLANNING`/`EXECUTING`
- **THEN** `resolveReportableRequestId` MUST 返回 `undefined`

#### Scenario: FAILED 的不可勾选

- **GIVEN** 一个 TurnBlock `status === "FAILED"`
- **THEN** `resolveReportableRequestId` MUST 返回 `undefined`

#### Scenario: DSL 结构化答案不满足 dte-bi-agent 不可勾选

- **GIVEN** 一个 TurnBlock 答案来自 `TOOL_STRUCTURED_DELTA`（`toolEventType === "ANSWER"`，`toolMessageType === "DSL"`），其 `content` 解析后 `obj.type !== "piu"` 或 `obj.properties.name !== "dte-bi-agent"`
- **THEN** `resolveReportableRequestId` MUST 返回 `undefined`

#### Scenario: 其他 toolMessageType 不可勾选

- **GIVEN** 一个 TurnBlock 答案来自 `TOOL_STRUCTURED_DELTA`（`toolEventType === "ANSWER"`），`toolMessageType` 为 `PIU`/`ACTION`/`OPERATOR`/`FILE`
- **THEN** `resolveReportableRequestId` MUST 返回 `undefined`

#### Scenario: 无正文的不可勾选

- **GIVEN** 一个 TurnBlock `status === "COMPLETED"` 但无 `LLM_CONTENT_DELTA` 纯文本且无 `TOOL_STRUCTURED_DELTA` ANSWER 事件
- **THEN** `resolveReportableRequestId` MUST 返回 `undefined`

### Requirement: 报告勾选约束

报告勾选 SHALL 受以下约束：

1. 不可跨会话：勾选的问答对 MUST 全部属于当前会话。切换会话时，报告勾选模式 MUST 自动退出并清空已选集合。
2. 一次最多勾选 10 个：当已选数量达到 10 时，其余可勾选项的 checkbox MUST 变为禁用状态。取消已选项后，被禁用的 checkbox MUST 恢复可勾选。

#### Scenario: 切换会话退出报告勾选模式

- **GIVEN** 当前处于报告勾选模式且已勾选若干问答对
- **WHEN** 用户切换到另一个会话
- **THEN** 报告勾选模式 MUST 自动退出
- **AND** 已选集合 MUST 被清空

#### Scenario: 最多勾选 10 个

- **GIVEN** 当前会话有 12 个可勾选问答对，用户已勾选 10 个
- **THEN** 其余 2 个可勾选项的 checkbox MUST 变为禁用
- **AND** 用户 MUST NOT 能继续勾选第 11 个

#### Scenario: 取消后恢复可勾选

- **GIVEN** 已勾选 10 个，其余 checkbox 禁用
- **WHEN** 用户取消勾选其中一个
- **THEN** 之前禁用的 checkbox MUST 恢复可勾选

### Requirement: 生成报告接口调用

点击报告操作栏的"生成报告"按钮 SHALL 校验已选集合非空（为空时按钮禁用），通过后调用 `POST /rest/naie/aicoservice/v1/sessions/{sessionId}/bi-reports`。`requestIds` 为已勾选问答对的 `requestId` 数组，以 JSON request body `{ requestIds: string[] }` 形式传递。鉴权信息由 `apiClient` 拦截器自动注入（`roarand` csrf token、`x-tenant-id`、`x-subject-id`、`x-display-name`、`credentials: include`），调用方不手动设置鉴权头。

接口返回值为 DSL content 对象本身（非包装信封），直接作为报告 DSL 内容交给 `DSLEngine` 渲染。

#### Scenario: 勾选后调用接口

- **WHEN** 用户勾选 2 个问答对（requestId 为 `R1`、`R2`）后点击"生成报告"按钮
- **THEN** MUST 调用 `POST /rest/naie/aicoservice/v1/sessions/{sessionId}/bi-reports`
- **AND** request body MUST 为 `{ requestIds: ["R1", "R2"] }`
- **AND** 请求 MUST 通过 `apiClient` 发送，携带鉴权信息

#### Scenario: 未勾选时生成报告按钮禁用

- **GIVEN** 当前处于报告勾选模式，已选集合为空
- **THEN** "生成报告"按钮 MUST 禁用
- **AND** MUST NOT 发起接口调用

#### Scenario: 接口返回处理

- **WHEN** 接口返回 DSL content 对象
- **THEN** MUST 将该对象直接作为报告 DSL 内容
- **AND** MUST 用该内容合成报告答案 TurnBlock 并渲染

### Requirement: 报告答案合成 TurnBlock 渲染

接口成功返回后，`agent-web` SHALL 在会话区当前 TurnBlock 列表末尾追加一个合成的报告 TurnBlock。合成 TurnBlock 的结构为：

- `rootMessageId`：合成值，前缀 `bi-report:`（如 `bi-report:<uuid>`）。
- `userMessage`：`SyntheticUserMessage`，`content` 为空字符串（无 question）。
- `aiEvents`：单条合成 `StreamEnvelope`，`eventType` 为 `TOOL_STRUCTURED_DELTA`，`payload.toolEventType` 为 `"ANSWER"`，`payload.toolMessageType` 为 `"DSL"`，`payload.content` 为接口返回的 `content`。
- `status`：`"COMPLETED"`。
- `isLatest`：`false`。

合成事件的 `transportHints` MUST 包含 `"history-load"`，以确保 `isLiveStreamed` 为 `false`，从而避免触发 fork/share/suggested-questions 等副作用。`isLatest` 为 `false` 以避免触发 `showLatestTurnActions`。

合成 TurnBlock MUST 由独立组件 `ReportAnswerCard` 渲染（详见"报告 DSL 渲染与 StreamDSLContext"要求），渲染出 DSL 卡片。合成 TurnBlock MUST NOT 出现 checkbox（不参与勾选）、MUST NOT 出现分享/派生/重试/编辑等操作按钮。

#### Scenario: 合成 TurnBlock 无 question 渲染答案

- **WHEN** 接口返回成功
- **THEN** 会话区末尾 MUST 追加一个合成 TurnBlock
- **AND** 该 TurnBlock MUST NOT 渲染用户问 bubble（`userMessage.content` 为空）
- **AND** 该 TurnBlock MUST 渲染 DSL 答案卡片

#### Scenario: 合成 TurnBlock 不触发副作用

- **WHEN** 合成 TurnBlock 被追加到会话区
- **THEN** MUST NOT 触发 suggested-questions 请求
- **AND** MUST NOT 出现 fork/share/retry/edit 操作按钮
- **AND** MUST NOT 出现勾选 checkbox

#### Scenario: 合成 TurnBlock 不参与勾选

- **WHEN** 进入报告勾选模式或分享勾选模式
- **THEN** 合成报告 TurnBlock MUST NOT 出现 checkbox
- **AND** `resolveReportableRequestId` 对合成 TurnBlock MUST 返回 `undefined`（因 `rootMessageId` 前缀为 `bi-report:`，非真实 requestId）

### Requirement: 报告 DSL 渲染与 StreamDSLContext

报告 DSL 卡片 SHALL 由独立组件 `ReportAnswerCard` 渲染。`ReportAnswerCard` MUST 以 `@cloudsop/dsl-engine-web/generateui` 导出的 `StreamDSLContext` 作为 Provider 包裹 `DSLEngine`，`StreamDSLContext` 的 props 为：

- `local`：当前语言，取 `supportedLocaleToHostLocale(getCurrentLocale())`，值为 `"zh-cn"` 或 `"en-us"`。
- `theme`：当前主题，取 `useAppHostContext()` 的 `hostTheme`，值为 `"lightday"` 或 `"evening"`。
- `conversationId`：当前会话 `sessionId`。
- `expandPanelId`：固定值 `EXPAND_PANEL_DIV_ID`（`"nextagent-expand-panel-container"`）。
- `handleExpandPanel`：函数，接收 `isOpen: boolean`。`isOpen === true` 时调用 `expandPanelStore.setContent({ toolMessageType: "DSL", content: reportContent }, "bi-report")` 后调用 `expandPanelStore.open()`；`isOpen === false` 时调用 `expandPanelStore.close()`。

`StreamDSLContext` 在 dev 模式下 MUST 解析为透传 children 的 no-op Provider（不影响子组件渲染），在 production 模式下 MUST 解析为真实 `@cloudsop/dsl-engine-web/generateui` 导出的 `StreamDSLContext`。

#### Scenario: 报告卡片用 StreamDSLContext 包裹 DSLEngine

- **WHEN** 渲染报告 DSL 卡片
- **THEN** MUST 以 `StreamDSLContext` 包裹 `DSLEngine`
- **AND** `local` MUST 为当前 `HostLocale`
- **AND** `theme` MUST 为当前 `HostTheme`
- **AND** `conversationId` MUST 为当前 `sessionId`
- **AND** `expandPanelId` MUST 为 `"nextagent-expand-panel-container"`

#### Scenario: 查看报告打开扩展面板

- **WHEN** 报告卡片内"查看报告"按钮触发 `handleExpandPanel(true)`
- **THEN** `expandPanelStore.setContent({ toolMessageType: "DSL", content: reportContent }, "bi-report")` MUST 被调用
- **AND** `expandPanelStore.open()` MUST 被调用
- **AND** 扩展面板 MUST 打开并渲染该 DSL 报告内容

#### Scenario: 关闭报告扩展面板

- **WHEN** 触发 `handleExpandPanel(false)`
- **THEN** `expandPanelStore.close()` MUST 被调用
- **AND** 扩展面板 MUST 关闭

### Requirement: 报告答案生命周期

报告答案 TurnBlock 仅存在于前端页面状态，不持久化。切换会话、刷新页面或关闭会话后，报告答案 MUST 消失。重新加载会话历史时，报告答案 MUST NOT 从 `GET /api/v1/sessions/{sessionId}/conversation` 返回（除非 aicoservice 将报告消息写入 NextAgent runtime 存储，此为遗留问题，当前版本不依赖）。

#### Scenario: 切换会话报告消失

- **GIVEN** 当前会话已生成报告答案
- **WHEN** 用户切换到另一个会话
- **THEN** 报告答案 MUST 从页面消失
- **AND** 切回原会话时报告答案 MUST NOT 重新出现

#### Scenario: 刷新页面报告消失

- **GIVEN** 当前会话已生成报告答案
- **WHEN** 用户刷新页面
- **THEN** 报告答案 MUST NOT 重新出现