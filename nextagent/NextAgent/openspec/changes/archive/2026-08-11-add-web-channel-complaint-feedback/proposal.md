## 背景与问题（Why）

电信网络运维场景中，用户在向网络智能体提问并获得答案后，需要对不满意的答案发起投诉反馈，并查看历史投诉记录。当前 `agent-web` 缺少面向答案的投诉入口与投诉历史查看能力。

外部已提供投诉相关 REST 服务：

- `GET /rest/naie/guardrail/config/v1/report/risks` 返回投诉类型配置（`records`），同时作为投诉能力可见性探针；
- `POST /rest/naie/guardrail/config/v1/report/create` 提交一次投诉。

该路径与现有 `biReportService` 调用的 `/rest/naie/aicoservice/...` 同前缀，已由 vite dev proxy 与生产网关统一同源可达，前端复用 `apiClient`（自动注入 `roarand`/`x-tenant-id`/`x-subject-id`/`x-display-name`/`credentials: include`）即可，无需新增鉴权路径。

投诉历史由外部 PIU `RobotRouterPIU`（`renderComplaintList`）渲染，前端只需提供容器并复用现有 `PiuRenderer` 机制。

## 变更范围（What Changes）

- **新增** 报告风险配置探针：进入服务时探一次 `GET /report/risks`，HTTP 200 缓存其 `records` 并使两块投诉能力可见；非 200 静默隐藏两块能力且不报错；刷新页面重新探一次。探针结果同时作为 feature gate 与投诉类型列表来源，弹框打开不再重复请求。
- **新增** 答案反馈图标：在已完成的助手答案 `BubbleActions` 中渲染反馈图标，显示条件与点赞/点踩一致（`canShowAnnotations`，即 `showAnnotations && sessionId && runId && isTerminal`）且探针通过。`answerOperator` 配置在场时整体替换 `BubbleActions`，反馈图标随之消失（与点赞/点踩同命运）。图标不套 `AuthGate(Write)`——投诉权限语义已由探针表达。点击图标打开投诉中心弹框。
- **新增** 投诉中心弹框：标题"投诉中心"，含投诉类型与投诉描述两块，下方提交/取消按钮。投诉类型以探针返回的 `records` 渲染为带边框文本，按当前语言显示 `name_zh`/`name_en`，选中与 hover 时边框变色，必选。投诉描述为多行文本框；当选中类型 `id === "8"` 时必填，其余非必填；填写时内容不得以空白字符开头（正则 `/^[^\s].*/`），长度上限 2600。
- **新增** 投诉提交接口调用：提交时 `POST /report/create`，body 为 `{ alog_card, tenant_id: "", user_id, reason_id, reason_detail }`。`alog_card` 拼接为 `[Q]${question}\n[A]${textAnswers}`，答案仅取 Text 类型段（`LLM_CONTENT_DELTA` 文本与 `TOOL_STRUCTURED_DELTA` ANSWER 中 `toolMessageType === "TEXT"`），多个 Text 段以 `\n` 拼接；无 Text 段时 `[A]` 后为空串。`user_id` 取 `useAppHostContext().site?.user?.id`，local 模式兜底 `"subject-1"`（与 `setSubjectId` 兜底一致）。成功 `message.success` 并关闭弹框，失败 `message.error`。
- **新增** 投诉历史入口（多宿主）：immersive 左布局在 `Sidebar` 新增 NavButton，切换 `contentView` 至 `"complaint"` 渲染 `PiuRenderer`；immersive 右布局在 header 新增按钮，切换 `panelView` 至 `"complaint"` 渲染 `PiuRenderer`；collaborative 在 `PiuPanelHeader` 新增按钮，点击打开 antd `Modal` 内嵌 `PiuRenderer`。local 模式不渲染投诉历史入口。PIU 信息为 `{ piuName: "RobotRouterPIU", piuVersion: "1.0.0", renderFunc: "renderComplaintList" }`。入口可见性受探针控制。

## Capability 影响

### 新增 Capability

- `agent-web-complaint-feedback`：浏览器前端答案投诉反馈与投诉历史查看能力，含报告风险配置探针、答案反馈图标、投诉中心弹框、投诉提交接口调用与多宿主投诉历史入口。

### 修改的 Capability

无。反馈图标加入 `BubbleActions` 与 `answerOperator` 替换 `BubbleActions` 的既有行为自然兼容（被替换即消失），不修改 `aico-piu-injection` 的 `answerOperator` requirement。

## 影响范围

- 代码：
  - `frontend/agent-web/src/services/complaintService.ts`（新增，探针 + 提交接口）
  - `frontend/agent-web/src/state/complaintFeatureStore.ts`（新增，探针结果缓存与 feature gate）
  - `frontend/agent-web/src/features/chat/components/ComplaintFeedbackButton.tsx`（新增，反馈图标）
  - `frontend/agent-web/src/features/complaint/components/ComplaintDialog.tsx`（新增，投诉中心弹框）
  - `frontend/agent-web/src/features/complaint/components/ComplaintHistoryView.tsx`（新增，PiuRenderer 包装）
  - `frontend/agent-web/src/features/chat/presentation/complaintAnswerText.ts`（新增，Text 段 `\n` 拼接）
  - `frontend/agent-web/src/features/chat/components/TurnBlock.tsx`（反馈图标接入 BubbleActions）
  - `frontend/agent-web/src/features/sidebar/components/Sidebar.tsx`（immersive 投诉历史 NavButton）
  - `frontend/agent-web/src/app/ImmersiveApp.tsx`（contentView/panelView `"complaint"`）
  - `frontend/agent-web/src/piu/AIAgentPiuRuntime.tsx`（PiuPanelHeader 投诉历史按钮 + Modal）
  - `frontend/agent-web/src/app/AppProviders.tsx`（探针触发点）
  - `frontend/agent-web/src/i18n/resources/zh-CN.ts`、`en-US.ts`（新增 i18n key）
- API：新增对外部 `GET /rest/naie/guardrail/config/v1/report/risks` 与 `POST /rest/naie/guardrail/config/v1/report/create` 的调用；NextAgent runtime API 不变。
- 认证：投诉接口复用 `apiClient` 拦截器注入的鉴权信息，不新增认证路径。
- 依赖：无新增第三方依赖。
- 测试：覆盖探针成功/失败显隐、反馈图标显隐条件、弹框校验（含 reason_id=8 必填、空白开头拒绝、长度上限）、提交接口参数与 alog_card 拼接、多宿主入口渲染与 local 不渲染。

## 归档前更新基线

行为约定：

- `openspec/specs/agent-web-complaint-feedback/spec.md`：新增。

长期背景：

- `openspec/overview.md`：补充答案投诉反馈与投诉历史查看场景背景。

设计视图：

- `openspec/designs/modules/agent-web.md`：补充投诉反馈功能模块职责与渲染落点。
- `openspec/designs/spec-to-design-map.md`：补充 `agent-web-complaint-feedback` spec 到模块设计的导航。

验证入口：

- `openspec validate --all --strict`
- `agent-web` 内 `npm run build`、`npm test`，涉及浏览器用户旅程时追加 `npm run test:e2e`
