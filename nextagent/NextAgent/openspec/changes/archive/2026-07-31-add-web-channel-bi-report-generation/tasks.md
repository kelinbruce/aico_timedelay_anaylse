## 1. DSL generateui dev stub 与独立 vite alias

- [x] 1.1 新建 `frontend/agent-web/src/vendor/dsl-engine-generateui-stub.tsx`，导出 no-op `StreamDSLContext`（透传 children，不注入 context 值）
  验证：单测 import `StreamDSLContext` from `@cloudsop/dsl-engine-web/generateui`，渲染 children 透传
  来源：spec `agent-web-structured-message-rendering` MODIFIED Requirement "DSL Vite Alias Stub"
- [x] 1.2 在 `frontend/agent-web/vite.config.ts` 的 `resolve.alias` 新增独立条目 `"@cloudsop/dsl-engine-web/generateui"`，dev 指向 stub 文件，production 指向真实包子路径；不修改现有 `"@cloudsop/dsl-engine-web"` alias
  验证：`npm run build` 通过，现有 DSL 渲染行为不变；单测 `DSLEngine` from `@cloudsop/dsl-engine-web` 行为与改动前一致
  来源：spec `agent-web-structured-message-rendering` MODIFIED Requirement "DSL Vite Alias Stub" scenario "Existing DSLEngine alias unaffected by generateui alias"

## 2. resolveReportableRequestId 可勾选规则

- [x] 2.1 新建 `frontend/agent-web/src/features/chat/presentation/reportSelection.ts`，导出 `resolveReportableRequestId(block: TurnBlock): string | undefined`，实现终结校验、答案存在性校验、答案类型校验（LLM_CONTENT_DELTA 纯文本 / TOOL_STRUCTURED_DELTA ANSWER 且 toolMessageType 为 TEXT 或 DSL，DSL 时校验 `obj.type === "piu" && obj.properties.name === "dte-bi-agent"`），返回 `requestId`
  验证：单测文件 `reportSelection.test.ts`，覆盖已完成纯文本/TEXT 结构化/满足 dte-bi-agent 的 DSL 可勾选、正在回答中/FAILED/不满足 dte-bi-agent 的 DSL/其他 toolMessageType/无正文不可勾选
  来源：spec `agent-web-bi-report-generation` Requirement "报告可勾选规则"
- [x] 2.2 验证命令：`npm test -- reportSelection`
  验证：所有正反向 case 断言通过
  来源：spec `agent-web-bi-report-generation` Requirement "报告可勾选规则"

## 3. biReportService

- [x] 3.1 新建 `frontend/agent-web/src/services/biReportService.ts`，导出 `biReportService.generateReport(params)`，`requestIds` 以 JSON body 传递，调用 `apiClient.post`；返回值为 DSL content 对象本身（`unknown`）
  验证：单测文件 `biReportService.test.ts`，mock `apiClient.post`，断言 URL 为 `/rest/naie/aicoservice/v1/sessions/{sessionId}/bi-reports`，断言 body 为 `{ requestIds: ["R1", "R2"] }`，断言返回值结构正确
  来源：spec `agent-web-bi-report-generation` Requirement "生成报告接口调用"
- [x] 3.2 验证命令：`npm test -- biReportService`
  验证：单测通过
  来源：spec `agent-web-bi-report-generation` Requirement "生成报告接口调用"

## 4. ReportAnswerCard 组件

- [x] 4.1 新建 `frontend/agent-web/src/features/chat/components/structured/ReportAnswerCard.tsx`，以 `StreamDSLContext`（from `@cloudsop/dsl-engine-web/generateui`）包裹 `DSLEngine`（from `@cloudsop/dsl-engine-web`）；props：`content`、`sessionId`；`local` 取 `supportedLocaleToHostLocale(getCurrentLocale())`，`theme` 取 `useAppHostContext().hostTheme`，`conversationId` 为 `sessionId`，`expandPanelId` 为 `EXPAND_PANEL_DIV_ID`，`handleExpandPanel(isOpen)` 联动 `expandPanelStore`（true 调用 `setContent({toolMessageType:"DSL", content}, "bi-report") + open()`，false 调用 `close()`）
  验证：单测文件 `ReportAnswerCard.test.tsx`，渲染组件断言 `StreamDSLContext` 包裹 `DSLEngine`，断言 `handleExpandPanel(true)` 调用 `expandPanelStore.setContent + open`，`handleExpandPanel(false)` 调用 `close`
  来源：spec `agent-web-bi-report-generation` Requirement "报告 DSL 渲染与 StreamDSLContext"
- [x] 4.2 验证命令：`npm test -- ReportAnswerCard`
  验证：单测通过
  来源：spec `agent-web-bi-report-generation` Requirement "报告 DSL 渲染与 StreamDSLContext"

## 5. TurnBlock 操作栏生成报告按钮 + 报告勾选 props + ReportAnswerCard 渲染分支

- [x] 5.1 修改 `frontend/agent-web/src/features/chat/components/TurnBlock.tsx`：在助手答案操作栏（`BubbleActions`）中新增"生成报告"按钮，位于"重新生成"按钮之前；当 TurnBlock 满足可报告判定且不处于任何勾选模式且非合成报告 TurnBlock 时渲染该按钮；新增 props `onGenerateReport(rootMessageId, requestId)`、`reportSelection`、`reportSelected`、`onToggleReportSelection`；勾选模式（报告或分享）时不渲染生成报告按钮，分享/派生按钮隐藏
  验证：单测文件 `TurnBlock.reportButton.test.tsx`，覆盖可报告 TurnBlock 显示按钮、不可报告 TurnBlock 不显示按钮、勾选模式下不显示按钮、点击按钮调用 onGenerateReport、合成报告 TurnBlock 不显示按钮
  来源：spec `agent-web-bi-report-generation` Requirement "答案操作栏生成报告入口"
- [x] 5.2 修改 `TurnBlock.tsx`：检测合成报告 TurnBlock（`rootMessageId` 前缀 `bi-report:`）时渲染 `<ReportAnswerCard>` 替代 `AnswerSegments + BubbleActions`，不渲染 checkbox
  验证：单测合成报告 TurnBlock 渲染 ReportAnswerCard 且无 checkbox/操作按钮
  来源：spec `agent-web-bi-report-generation` Requirement "报告答案合成 TurnBlock 渲染"
- [x] 5.3 修改 `frontend/agent-web/src/features/chat/components/MessageList.tsx`：透传报告勾选相关 props；修改 `TurnBlock.tsx` checkbox 渲染逻辑：不可报告 TurnBlock 渲染禁用 checkbox（与分享勾选模式一致），合成报告 TurnBlock 不渲染 checkbox
  验证：`npm run build` 通过；单测覆盖不可报告 TurnBlock 的禁用 checkbox
  来源：spec `agent-web-bi-report-generation` Requirement "报告勾选模式交互"
- [x] 5.4 验证命令：`npm test -- TurnBlock.reportButton`
  验证：单测通过
  来源：spec `agent-web-bi-report-generation` Requirement "答案操作栏生成报告入口"

## 6. ChatPage 报告勾选模式状态机 + 接口调用编排

- [x] 6.1 修改 `frontend/agent-web/src/pages/ChatPage.tsx`：新增 `reportSelectionMode`、`selectedReportRequestIds` 状态；`selectableReportRequestIds` 用 `resolveReportableRequestId`；进入报告勾选模式时退出分享勾选模式（互斥），进入分享勾选模式时退出报告勾选模式；切换会话时两者都退出
  验证：单测文件 `ChatPage.reportMode.test.tsx`，覆盖进入/退出报告勾选模式、与分享模式互斥、切换会话退出
  来源：spec `agent-web-bi-report-generation` Requirement "报告勾选约束"
- [x] 6.2 实现"生成报告"按钮 `onClick`：校验非空 -> 调用 `biReportService.generateReport` -> 成功后构建合成 TurnBlock 追加到 turnBlocks -> 退出勾选模式；接口失败时 `antdMessage.error`；全选/已选计数/最多 10 个约束
  验证：单测覆盖最多 10 个约束、生成报告接口调用参数、成功后追加合成 TurnBlock、失败 error 提示
  来源：spec `agent-web-bi-report-generation` Requirement "生成报告接口调用"、"报告答案合成 TurnBlock 渲染"
- [x] 6.3 渲染报告操作栏（复用或参数化 `ShareModeBar`），文案为报告相关 i18n key，确认按钮文案为"生成报告"
  验证：`npm run build` 通过，无缺失 key 警告
  来源：spec `agent-web-bi-report-generation` Requirement "报告勾选模式交互"
- [x] 6.4 验证命令：`npm test -- ChatPage.reportMode`
  验证：单测通过
  来源：spec `agent-web-bi-report-generation` Requirement "报告勾选约束"

## 7. i18n 文案与 local 取值验证

- [x] 7.1 在 `frontend/agent-web/src/i18n/resources/zh-CN.ts` 和 `en-US.ts` 新增报告相关 i18n key（生成报告、已选 x 个对话、全选、取消等）
  验证：`npm run build` 通过，无缺失 key 警告
  来源：spec `agent-web-bi-report-generation` Requirement "报告 DSL 渲染与 StreamDSLContext"（local 取值）
- [x] 7.2 单测：`supportedLocaleToHostLocale(getCurrentLocale())` 在中文环境返回 `"zh-cn"`，英文环境返回 `"en-us"`
  验证：`npm test` 相关单测通过
  来源：spec `agent-web-bi-report-generation` Requirement "报告 DSL 渲染与 StreamDSLContext"

## 8. 报告勾选模式与分享勾选模式互斥 negative 验证

- [x] 8.1 单测/Playwright：处于分享勾选模式时通过点击操作栏"生成报告"按钮进入报告勾选模式，断言分享勾选模式已退出、分享已选集合清空、报告勾选模式激活
  验证：`npm test -- reportShareMutex` 或对应 e2e
  来源：spec `conversation-share` MODIFIED Requirement "Frontend share interaction behavior"
- [x] 8.2 单测/Playwright：处于报告勾选模式时点击分享按钮进入分享勾选模式，断言报告勾选模式已退出、报告已选集合清空、分享勾选模式激活
  验证：`npm test -- reportShareMutex` 或对应 e2e
  来源：spec `conversation-share` MODIFIED Requirement "Frontend share interaction behavior"

## 9. 现有 DSL 渲染和分享功能 non-regression 验证

- [x] 9.1 运行现有 `AnswerSegments`/`DslRenderer`/`ExpandPanel`/分享相关测试全部通过
  验证：`npm test`
  来源：spec `agent-web-structured-message-rendering` MODIFIED Requirement "DSL Vite Alias Stub"
- [x] 9.2 涉及 artifact/宿主模式时追加 `npm run build:vite:modes`
  验证：`npm run build:vite:modes` 通过
  来源：spec `agent-web-structured-message-rendering` MODIFIED Requirement "DSL Vite Alias Stub"

## 10. openspec 验证与 push 前检视

- [x] 10.1 `openspec validate --all --strict` 通过
  验证：`openspec validate --all --strict`
  来源：proposal 验证入口
- [x] 10.2 push 前运行 `$nextagent-code-review` 检视
  验证：检视结论为 PASS 或 PASS WITH FOLLOW-UP
  来源：AGENTS.md Push 门禁