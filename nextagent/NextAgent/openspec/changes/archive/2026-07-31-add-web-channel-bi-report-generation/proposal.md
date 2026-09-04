## 背景与问题（Why）

电信网络运维场景中，网络智能体经常产出一组历史诊断问答。运维人员需要从已完成的多轮问答中勾选有价值的回答，汇总生成一份 BI 报告，以卡片形式在会话区呈现，并支持从卡片打开扩展面板查看完整报告。

当前 `agent-web` 已有对话分享能力（`conversation-share`），其勾选模式（checkbox + 全选 + 已选计数 + 底部确认栏）是成熟可复用的交互范式。但分享和报告生成是两件事：分享是把已有问答对外发布，报告生成是调用外部 `aicoservice` 的 `bi-report` 接口把选中问答聚合成一份新的 DSL 卡片答案，并在当前会话内渲染出来。二者共享勾选交互骨架，但目标、可勾选规则和后续动作完全不同。

目前会话区缺少：右键答案触发报告生成的入口、报告专用勾选模式、`bi-report` 接口调用、报告答案的渲染（需 `StreamDSLContext` 包裹 DSL 组件并联动扩展面板）。

## 变更范围（What Changes）

- **新增** 答案操作栏生成报告按钮：在助手答案操作栏（`BubbleActions`）中新增"生成报告"按钮，位于"重新生成"按钮之前。当 TurnBlock 满足可报告判定且不处于任何勾选模式且非合成报告 TurnBlock 时渲染该按钮。勾选模式期间该按钮隐藏，分享和派生按钮也一并隐藏。
- **新增** 报告勾选模式：镜像分享勾选模式的交互骨架（每轮有 requestId 的非合成报告 TurnBlock 左侧出现 checkbox、底部全选 + 已选 x 个对话 + 取消/生成报告按钮）。不可报告 TurnBlock 的 checkbox 渲染但禁用，与分享勾选模式一致。进入报告勾选模式后隐藏分享按钮和派生按钮。
- **新增** 可勾选规则解析 `resolveReportableRequestId`：与分享的 `resolveShareableRunId` 平行，但返回 `requestId`（而非 `runId`），且可勾选约束更严格。规则见下方 specs。
- **新增** `biReportService`：调用外部 `aicoservice` 接口 `POST /rest/naie/aicoservice/v1/sessions/{sessionId}/bi-reports`，`requestIds` 以 JSON body `{ requestIds: string[] }` 传递，鉴权复用 `apiClient` 拦截器（`roarand`/`x-tenant-id`/`x-subject-id`/`x-display-name`/`credentials: include`）。返回值为 DSL content 对象本身（非包装信封），直接交给 `DSLEngine` 渲染。
- **新增** 报告答案渲染：调用接口成功后，在会话区合成一个"无 question"的答案 TurnBlock（空 `userMessage` + 单条合成 `TOOL_STRUCTURED_DELTA`/`ANSWER`/`DSL` 事件），由独立 `ReportAnswerCard` 组件渲染。`ReportAnswerCard` 以 `@cloudsop/dsl-engine-web/generateui` 的 `StreamDSLContext` 包裹 `DSLEngine`，传入 `local`/`theme`/`conversationId`/`expandPanelId`/`handleExpandPanel`。`handleExpandPanel(true)` 通过 `expandPanelStore.setContent({toolMessageType:"DSL", content}) + open()` 打开扩展面板（React 渲染路径，非 PIU 直渲染路径）；`handleExpandPanel(false)` 关闭。
- **新增** DSL generateui 子路径 dev stub：新增独立 vite alias `@cloudsop/dsl-engine-web/generateui` 指向独立 stub 文件，导出 no-op `StreamDSLContext`（透传 children）。现有 `@cloudsop/dsl-engine-web` alias 和 `DSLEngine` stub 不动，现有 DSL 渲染行为零影响。
- **遗留问题（明确延期）**：报告答案当前仅存在于页面状态，切换会话后消失（按需生成、不持久化）。是否持久化取决于 `aicoservice` 生成报告后是否将报告消息写入 NextAgent runtime 可读的会话消息存储（即 `GET /api/v1/sessions/{sessionId}/conversation` 是否能返回该报告消息）。此问题需与 aicoservice 团队确认，确认前不实现持久化。

## Capability 影响（Capabilities）

### 新增 Capability

 - `agent-web-bi-report-generation`: 浏览器前端历史对话勾选生成 BI 报告能力，包括答案操作栏生成报告入口、报告勾选模式、可勾选规则、`bi-report` 接口调用和报告答案的 DSL 渲染（含 `StreamDSLContext` 与扩展面板联动）。

### 修改的 Capability

- `agent-web-structured-message-rendering`: 新增 DSL generateui 子路径的 vite alias stub 规则，并明确报告 DSL 渲染使用 `StreamDSLContext` 包裹。
- `conversation-share`: 明确报告勾选模式与分享勾选模式互斥（同一时间只能处于其中一种模式），进入任一模式时退出另一种。

## 影响范围（Impact）

 - 代码：`agent-web/src/features/chat/components/TurnBlock.tsx`（操作栏生成报告按钮 + 报告勾选 props）、`agent-web/src/features/chat/components/MessageList.tsx`（报告勾选 props 透传）、`agent-web/src/pages/ChatPage.tsx`（报告勾选模式状态机 + 接口调用编排）、`agent-web/src/features/chat/presentation/reportSelection.ts`（新增，可勾选规则）、`agent-web/src/services/biReportService.ts`（新增）、`agent-web/src/features/chat/components/structured/ReportAnswerCard.tsx`（新增）、`agent-web/src/vendor/dsl-engine-generateui-stub.tsx`（新增）、`agent-web/vite.config.ts`（新增独立 alias）、`agent-web/src/i18n/resources/`（新增文案）。
- API：新增外部 `aicoservice` 的 `POST /rest/naie/aicoservice/v1/sessions/{sessionId}/bi-reports` 调用；现有 NextAgent runtime API 不变。
- 认证：`bi-report` 接口复用 `apiClient` 拦截器注入的鉴权信息，不新增认证路径。
- 依赖：新增对 `@cloudsop/dsl-engine-web/generateui` 子路径的 import（production 走真实包，dev 走 stub）。
 - 测试：覆盖操作栏按钮显示/隐藏、报告勾选模式进入/退出/互斥、可勾选规则正反向、接口调用参数、报告答案渲染、`StreamDSLContext` 包裹、扩展面板联动、dev stub 透传。
- 运维：无新增运维负担；`/rest` 路径已在 vite dev proxy 和生产网关中配置。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-web-bi-report-generation/spec.md`：新增
- `openspec/specs/agent-web-structured-message-rendering/spec.md`：合并 DSL generateui 子路径 stub delta
- `openspec/specs/conversation-share/spec.md`：合并报告勾选模式互斥 delta

长期背景：
- `openspec/overview.md`：补充报告生成能力背景（电信运维 BI 报告聚合场景）

设计视图：
- `openspec/designs/modules/agent-web.md`：补充报告生成功能的模块职责和渲染落点（如该文件已存在）
- `openspec/designs/spec-to-design-map.md`：补充导航

验证入口：
- `openspec validate --all --strict`
- `agent-web` 内 `npm run build`、`npm test`、涉及前端用户旅程时追加 `npm run test:e2e`
