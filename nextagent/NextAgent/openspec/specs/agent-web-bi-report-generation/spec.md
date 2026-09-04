# agent-web-bi-report-generation Specification

## Purpose
定义 agent-web 从已完成助手回答发起、选择和提交报告生成的用户交互契约，确保上下文菜单、勾选状态和提交结果在各宿主中保持一致。
## Requirements
### Requirement: 答案区右键生成报告入口

`agent-web` SHALL 在每轮已完成问答的助手答案区域提供右键上下文菜单入口。当用户在助手答案区域（`assistant-content-region`）内右键时，MUST 在鼠标坐标位置渲染一个"生成报告"按钮。该按钮 MUST 具有阴影样式以与底部答案操作行视觉区分。当用户点击页面任意非按钮位置、或在另一个答案区域右键、或进入报告勾选模式时，当前按钮 MUST 消失。同一时间最多只存在一个"生成报告"按钮。

当处于报告勾选模式时，右键 MUST NOT 触发"生成报告"按钮。当处于分享勾选模式时，右键 MUST NOT 触发"生成报告"按钮。

#### Scenario: 右键答案区弹出生成报告按钮

- **WHEN** 用户在一个已完成的助手答案区域内右键
- **THEN** MUST 在鼠标坐标位置出现一个"生成报告"按钮
- **AND** 该按钮 MUST 带有阴影样式

#### Scenario: 点击其他位置按钮消失

- **WHEN** "生成报告"按钮已显示
- **AND** 用户点击按钮以外的任意位置
- **THEN** 按钮 MUST 立即消失

#### Scenario: 右键另一答案区时旧按钮消失

- **GIVEN** 答案区域 A 的"生成报告"按钮已显示
- **WHEN** 用户在答案区域 B 右键
- **THEN** 答案区域 A 的按钮 MUST 消失
- **AND** 答案区域 B 的鼠标位置 MUST 出现新的"生成报告"按钮

#### Scenario: 进入勾选模式后右键不再触发

- **GIVEN** 当前处于报告勾选模式或分享勾选模式
- **WHEN** 用户在答案区域右键
- **THEN** MUST NOT 出现"生成报告"按钮

### Requirement: 生成报告按钮触发报告勾选模式

点击"生成报告"按钮 SHALL 进入报告勾选模式。进入报告勾选模式时，分享勾选模式 MUST 自动退出（互斥），当前问答对的 requestId MUST 默认被勾选。

#### Scenario: 点击生成报告进入勾选模式

- **WHEN** 用户点击"生成报告"按钮
- **THEN** MUST 进入报告勾选模式
- **AND** 若当前处于分享勾选模式，分享勾选模式 MUST 退出
- **AND** 该按钮所属问答对的 requestId MUST 默认勾选
- **AND** "生成报告"按钮 MUST 消失

### Requirement: 报告勾选模式交互

报告勾选模式 SHALL 镜像分享勾选模式的交互骨架：每轮可勾选问答对左侧出现 checkbox，会话面板底部出现报告操作栏（全选 checkbox + 已选 x 个对话 + 取消按钮 + 生成报告按钮）。进入报告勾选模式后，所有 TurnBlock 的分享按钮和派生按钮 MUST 隐藏。

报告勾选模式 MUST 支持退出：点击取消按钮或按 ESC 退出，退出后恢复正常对话视图并清空已选集合。

#### Scenario: 进入报告勾选模式后 UI 变化

- **WHEN** 进入报告勾选模式
- **THEN** 每轮可勾选问答对左侧 MUST 出现 checkbox
- **AND** 底部 MUST 出现报告操作栏（全选 + 已选计数 + 取消 + 生成报告）
- **AND** 所有 TurnBlock 的分享按钮和派生按钮 MUST 隐藏

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

报告 DSL 卡片 SHALL 由独立组件 `ReportAnswerCard` 渲染。`ReportAnswerCard` MUST 直接使用 `DSLEngine` 渲染 DSL 卡片，不再自行包裹 `StreamDSLContext`。`StreamDSLContext` 由 `TurnBlock` 答案区外层提供，覆盖 `ReportAnswerCard` 和 `AnswerSegments` 两条渲染路径。

`StreamDSLContext` 的 props 在 `TurnBlock` 中组装，只传递 `local`、`theme`、`conversationId`（即 `sessionId`）。`expandPanelId` 和 `handleExpandPanel` 不再通过 `StreamDSLContext` props 传递，而是通过 `init` 方法全局注册。

`ReportAnswerCard` MUST NOT import `StreamDSLContext`、`useAppHostContext`、`getCurrentLocale`、`supportedLocaleToHostLocale`、`EXPAND_PANEL_DIV_ID` 或 `expandPanelStore`。这些职责已移至 `TurnBlock` 和 `renderRoot`。

`ReportAnswerCard` 的 `import` 来源 MUST 从 `@cloudsop/dsl-engine-web/generateui` 迁移到 `@cloudsop/dsl-engine-web/genui-components`（如果仍需要 `StreamDSLContext`），或完全移除（如果 `StreamDSLContext` 包裹已移至外层）。

#### Scenario: ReportAnswerCard 不再包裹 StreamDSLContext

- **WHEN** `ReportAnswerCard` 渲染 BI 报告 DSL 卡片
- **THEN** `ReportAnswerCard` MUST NOT 包裹 `StreamDSLContext`
- **AND** MUST 直接渲染 `<DSLEngine data={[content]} />`

#### Scenario: TurnBlock 答案区外层提供 StreamDSLContext

- **WHEN** `TurnBlock` 渲染答案区（BI 报告路径或常规答案路径）
- **THEN** 答案区 MUST 被 `<StreamDSLContext local={...} theme={...} conversationId={sessionId}>` 包裹
- **AND** `StreamDSLContext` MUST 覆盖 `ReportAnswerCard` 和 `AnswerSegments` 两条渲染路径

#### Scenario: StreamDSLContext 只传 local theme conversationId

- **WHEN** `StreamDSLContext` 在 `TurnBlock` 中渲染
- **THEN** props MUST 只包含 `local`、`theme`、`conversationId`
- **AND** MUST NOT 包含 `expandPanelId` 或 `handleExpandPanel`

#### Scenario: 不再从 generateui 导入 StreamDSLContext

- **WHEN** 前端代码引用 `StreamDSLContext`
- **THEN** import 来源 MUST 为 `@cloudsop/dsl-engine-web/genui-components`
- **AND** MUST NOT 从 `@cloudsop/dsl-engine-web/generateui` 导入

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
