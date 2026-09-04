## 1. complaintService 与 complaintFeatureStore

- [x] 1.1 新增 `frontend/agent-web/src/services/complaintService.ts`，导出 `ComplaintRiskRecord`、`ComplaintRiskConfig` 类型与 `complaintService.fetchRiskConfig(signal?)`、`complaintService.createReport(params, signal?)`；`fetchRiskConfig` 调 `apiClient.get("/rest/naie/guardrail/config/v1/report/risks")` 并从 `body.records` 过滤出 `{id,name_en,name_zh}`；`createReport` 调 `apiClient.post("/rest/naie/guardrail/config/v1/report/create", params)`
  验证：单测 `complaintService.test.ts`，mock `apiClient`，断言 URL、records 过滤、`createReport` body 透传
  来源：spec `agent-web-complaint-feedback` Requirement "投诉能力可见性由报告风险配置探针决定"、"投诉提交接口调用"
- [x] 1.2 新增 `frontend/agent-web/src/state/complaintFeatureStore.ts`，zustand store 含 `{enabled, records, status}`，`probe()` 进程内只探一次（`ready`/`loading` 不重复），成功 `enabled=true`+`records`+`ready`，失败 `enabled=false`+空 `records`+`failed` 不抛错；组件通过 `useComplaintFeatureStore((s) => ...)` 消费，非组件场景通过 `getState()`
  验证：单测 `complaintFeatureStore.test.ts`，断言成功态、失败态、重复 `probe` 不再请求、重置后可重探
  来源：spec `agent-web-complaint-feedback` Requirement "投诉能力可见性由报告风险配置探针决定"
- [x] 1.3 在 `frontend/agent-web/src/app/AppProviders.tsx` 的 `useEffect` 中调用 `complaintFeatureStore.probe()`，保证三种宿主进入服务时探一次
  验证：`npm run build` 通过；单测断言 `probe` 被触发一次
  来源：spec `agent-web-complaint-feedback` Requirement "投诉能力可见性由报告风险配置探针决定"

## 2. 答案反馈图标

- [x] 2.1 新增 `frontend/agent-web/src/features/chat/components/ComplaintFeedbackButton.tsx`，用 `useComplaintFeatureStore((s) => s.enabled)` 读 store，`enabled` 为 `false` 返回 `null`；否则渲染 `actionButtonStyle()` 图标按钮，点击回调 `onOpenComplaint`
  验证：单测 `ComplaintFeedbackButton.test.tsx`，`enabled=false` 不渲染、`enabled=true` 渲染、点击触发回调
  来源：spec `agent-web-complaint-feedback` Requirement "答案反馈图标触发投诉中心弹框"
- [x] 2.2 修改 `frontend/agent-web/src/features/chat/components/TurnBlock.tsx` 的 `BubbleActions`：在 `showAnnotations && annotationState` 分支内、`AuthGate(Write)` 之外渲染 `<ComplaintFeedbackButton onOpenComplaint={...} />`；显示条件沿用 `canShowAnnotations`；本地持有 `ComplaintDialog` open 状态
  验证：单测 `TurnBlock.complaintButton.test.tsx`，断言已完成答案显示图标、`answerOperator` 在场时不显示、探针未使能时不显示、点击打开弹框
  来源：spec `agent-web-complaint-feedback` Requirement "答案反馈图标触发投诉中心弹框"
- [x] 2.3 验证命令：`npm test -- ComplaintFeedbackButton TurnBlock.complaintButton`
  验证：单测通过
  来源：spec `agent-web-complaint-feedback` Requirement "答案反馈图标触发投诉中心弹框"

## 3. 投诉中心弹框 ComplaintDialog

- [x] 3.1 新增 `frontend/agent-web/src/features/complaint/components/ComplaintDialog.tsx`，antd `Modal` 标题 `t("complaint.title")`；投诉类型以 `records` 渲染带边框文本，按 locale 显示 `name_zh`/`name_en`，选中/hover 边框变色，单选必选；投诉描述 `Input.TextArea` `maxLength=2600`；校验 `reason_id` 必选、`reason_id === "8"` 时描述必填、描述填写时匹配 `/^[^\s].*/` 且长度 <= 2600；取消关闭、提交校验通过后调 `createReport`
  验证：单测 `ComplaintDialog.test.tsx`，覆盖类型按语言显示、必选禁用提交、`id=8` 必填、空白开头拒绝、长度上限、取消关闭、提交成功/失败提示
  来源：spec `agent-web-complaint-feedback` Requirement "投诉中心弹框渲染与校验"
- [x] 3.2 验证命令：`npm test -- ComplaintDialog`
  验证：单测通过
  来源：spec `agent-web-complaint-feedback` Requirement "投诉中心弹框渲染与校验"

## 4. alog_card 拼接

- [x] 4.1 新增 `frontend/agent-web/src/features/chat/presentation/complaintAnswerText.ts`，导出 `buildComplaintAlogCard(question, segments)`：过滤 text 与 structured-TEXT 段，内容以 `\n` join，返回 `[Q]${question}\n[A]${texts.join("\n")}`，无 Text 段时 `[A]` 后空串
  验证：单测 `complaintAnswerText.test.ts`，覆盖单 Text、多 Text 以 `\n` 拼接、含非 Text 段被过滤、无 Text 段 A 段为空
  来源：spec `agent-web-complaint-feedback` Requirement "投诉提交接口调用"
- [x] 4.2 验证命令：`npm test -- complaintAnswerText`
  验证：单测通过
  来源：spec `agent-web-complaint-feedback` Requirement "投诉提交接口调用"

## 5. 投诉提交链路

- [x] 5.1 在 `ComplaintDialog` 提交逻辑中：取 `useAppHostContext().site?.user?.id`（local 兜底 `"subject-1"`）作为 `user_id`，`tenant_id=""`，`reason_id` 取已选 `record.id`，`reason_detail` 取描述；调用 `complaintService.createReport`；成功 `message.success` + 关闭，失败 `message.error` + 保留弹框草稿
  验证：单测覆盖 `user_id` 取值（remote 取 `site.user.id`、local 取 `subject-1`）、`tenant_id` 为空串、成功关闭、失败保留草稿
  来源：spec `agent-web-complaint-feedback` Requirement "投诉提交接口调用"
- [x] 5.2 验证命令：`npm test -- ComplaintDialog`
  验证：单测通过
  来源：spec `agent-web-complaint-feedback` Requirement "投诉提交接口调用"

## 6. 多宿主投诉历史入口

- [x] 6.1 新增 `frontend/agent-web/src/features/complaint/components/ComplaintHistoryView.tsx`，`enabled` 为 `false` 返回 `null`；否则渲染 `<PiuRenderer piuInfo={COMPLAINT_HISTORY_PIU} theme={hostTheme} containerStyle={{width:"100%",height:"100%"}} />`，PIU 常量 `{piuName:"RobotRouterPIU",piuVersion:"1.0.0",renderFunc:"renderComplaintList"}`
  验证：单测 `ComplaintHistoryView.test.tsx`，`enabled=false` 不渲染、`enabled=true` 渲染 `PiuRenderer`、`Prel` 不可用显示占位符不抛错
  来源：spec `agent-web-complaint-feedback` Requirement "投诉历史入口在多宿主下渲染 RobotRouterPIU"
- [x] 6.2 修改 `frontend/agent-web/src/features/sidebar/components/Sidebar.tsx`：新增投诉历史 NavButton（icon、label=`t("sidebar.complaintHistory")`），`isComplaintHistoryVisible = mode !== "local" && complaintFeatureStore.enabled`，点击 `onSelectComplaintHistory`；参照记忆管理 NavButton 的 active 态与 gate 模式
  验证：单测断言 local 模式不渲染、immersive 且 `enabled` 渲染、`enabled=false` 不渲染
  来源：spec `agent-web-complaint-feedback` Requirement "投诉历史入口在多宿主下渲染 RobotRouterPIU"
- [x] 6.3 修改 `frontend/agent-web/src/app/ImmersiveApp.tsx`：`ImmersiveLeftLayout` 的 `contentView` 扩展 `"complaint"`，`"complaint"` 渲染 `<ComplaintHistoryView />`；`ImmersiveRightLayout` 的 `RightPanelView` 扩展 `"complaint"`，header 新增投诉历史按钮，`panelView === "complaint"` 渲染 `<ComplaintHistoryView />`
  验证：单测/Playwright 断言左布局点击切换内容视图、右布局点击切换 panelView、均渲染 PIU
  来源：spec `agent-web-complaint-feedback` Requirement "投诉历史入口在多宿主下渲染 RobotRouterPIU"
- [x] 6.4 修改 `frontend/agent-web/src/piu/AIAgentPiuRuntime.tsx` 的 `PiuPanelHeader`：新增投诉历史按钮（参照 memory 按钮），点击设置 `complaintHistoryOpen`，渲染 antd `Modal`（`destroyOnHidden`）内嵌 `<ComplaintHistoryView />`
  验证：单测/Playwright 断言 collaborative 点击打开 Modal、Modal 内渲染 PIU、关闭 Modal
  来源：spec `agent-web-complaint-feedback` Requirement "投诉历史入口在多宿主下渲染 RobotRouterPIU"
- [x] 6.5 验证命令：`npm test -- ComplaintHistoryView`；涉及浏览器旅程追加 `npm run test:e2e -- complaint`
  验证：单测/e2e 通过
  来源：spec `agent-web-complaint-feedback` Requirement "投诉历史入口在多宿主下渲染 RobotRouterPIU"

## 7. i18n 文案

- [x] 7.1 在 `frontend/agent-web/src/i18n/resources/zh-CN.ts` 与 `en-US.ts` 新增投诉相关 key（`complaint.title`、投诉类型/描述/提交/取消、`sidebar.complaintHistory`、成功/失败提示等）
  验证：`npm run build` 通过，无缺失 key 警告
  来源：spec `agent-web-complaint-feedback` Requirement "投诉中心弹框渲染与校验"、"投诉历史入口在多宿主下渲染 RobotRouterPIU"

## 8. negative 与 non-regression 验证

- [x] 8.1 单测：探针失败时反馈图标与投诉历史入口均不可见，断言两处渲染为 `null`
  验证：`npm test -- complaintFeatureStore ComplaintFeedbackButton ComplaintHistoryView`
  来源：spec `agent-web-complaint-feedback` Requirement "投诉能力可见性由报告风险配置探针决定"
- [x] 8.2 单测：`answerOperator` 在场时 `TurnBlock` 渲染 `PiuRenderer` 替代 `BubbleActions`，断言反馈图标与点赞/点踩均不渲染
  验证：`npm test -- TurnBlock.complaintButton`
  来源：spec `agent-web-complaint-feedback` Requirement "答案反馈图标触发投诉中心弹框"
- [x] 8.3 单测：local 模式 `Sidebar` 不渲染投诉历史 NavButton
  验证：`npm test -- Sidebar`
  来源：spec `agent-web-complaint-feedback` Requirement "投诉历史入口在多宿主下渲染 RobotRouterPIU"
- [ ] 8.4 运行现有 `TurnBlock`/`MessageList`/`ChatPage`/分享/BI 报告相关测试全部通过
  验证：`npm test`
  来源：non-regression

## 9. openspec 验证与 push 前检视

- [x] 9.1 `openspec validate --all --strict` 通过
  验证：`openspec validate --all --strict`
  来源：proposal 验证入口
- [x] 9.2 push 前运行 `$nextagent-code-review` 检视
  验证：检视结论为 PASS 或 PASS WITH FOLLOW-UP
  来源：AGENTS.md Push 门禁
- [x] 9.3 涉及 artifact/宿主模式时追加 `npm run build:vite:modes`
  验证：`npm run build:vite:modes` 通过
  来源：AGENTS.md 前端验证门禁
