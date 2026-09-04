## 设计目标

在 `agent-web` 前端实现答案投诉反馈与投诉历史查看的完整链路：报告风险配置探针 -> 答案反馈图标 -> 投诉中心弹框（类型 + 描述 + 校验）-> 投诉提交接口；以及多宿主（immersive 左/右布局、collaborative）下的投诉历史入口，local 不处理投诉历史。复用现有 `apiClient`、`PiuRenderer`、`useAppHostContext` 与记忆管理的入口参照模式，不新增鉴权路径或第三方依赖。

## 唯一实现路径

### 1. complaintService + complaintFeatureStore

新增 `frontend/agent-web/src/services/complaintService.ts`：

```ts
export interface ComplaintRiskRecord { readonly id: string; readonly name_en: string; readonly name_zh: string; }
export interface ComplaintRiskConfig { readonly records: readonly ComplaintRiskRecord[]; }

function isRiskRecord(value: unknown): value is ComplaintRiskRecord {
  return typeof value === "object" && value !== null
    && typeof (value as Record<string, unknown>).id === "string"
    && typeof (value as Record<string, unknown>).name_en === "string"
    && typeof (value as Record<string, unknown>).name_zh === "string";
}

export const complaintService = {
  async fetchRiskConfig(signal?: AbortSignal): Promise<ComplaintRiskConfig> {
    const body = await apiClient.get<{ records?: unknown }>(
      "/rest/naie/guardrail/config/v1/report/risks",
      signal ? { signal } : undefined,
    );
    if (!Array.isArray(body?.records)) {
      throw new Error("Complaint risk config response must contain a records array.");
    }
    const records = body.records.filter(isRiskRecord);
    return { records };
  },
  async createReport(
    params: { alog_card: string; tenant_id: string; user_id: string; reason_id: string; reason_detail: string },
    signal?: AbortSignal,
  ): Promise<void> {
    await apiClient.post("/rest/naie/guardrail/config/v1/report/create", params, signal ? { signal } : undefined);
  },
};
```

新增 `frontend/agent-web/src/state/complaintFeatureStore.ts`（zustand store，与 `src/state/` 下 `categorySelectionStore`/`skillSelectionStore` 等一致）：

- 状态：`{ enabled: boolean; records: readonly ComplaintRiskRecord[]; status: "idle" | "loading" | "ready" | "failed" }`
- `probe()`：若 `status` 已为 `ready` 或 `loading` 则直接返回（进程生命周期内只探一次，刷新页面重置）；调用 `complaintService.fetchRiskConfig()`，成功 -> `enabled=true, records, status="ready"`，失败 -> `enabled=false, records=[], status="failed"`，MUST NOT 抛错。
- 组件通过 `useComplaintFeatureStore((s) => s.enabled)` 消费；非组件场景通过 `useComplaintFeatureStore.getState()` 访问。

探针触发点：在 `frontend/agent-web/src/app/AppProviders.tsx` 内 `useEffect` 启动后调一次 `complaintFeatureStore.probe()`。三种宿主都经 `AppProviders`，单一触发点保证"进入服务时探一次"。

### 2. 答案反馈图标

新增 `frontend/agent-web/src/features/chat/components/ComplaintFeedbackButton.tsx`：用 `useComplaintFeatureStore((s) => s.enabled)` 读 store，`enabled` 为 `false` 时返回 `null`；否则渲染一个 `actionButtonStyle()` 的图标按钮，点击调用 `onOpenComplaint` 回调。

接入 `frontend/agent-web/src/features/chat/components/TurnBlock.tsx` 的 `BubbleActions`：在点赞/点踩同一 `showAnnotations && annotationState` 分支内、`AuthGate(Write)` 之外渲染 `<ComplaintFeedbackButton onOpenComplaint={...} />`。显示条件沿用 `canShowAnnotations`（`showAnnotations && sessionId && runId && isTerminal`）。因 `answerOperator` 在场时 `TurnBlock` 用 `PiuRenderer` 替代整个 `BubbleActions`，反馈图标自然不渲染——与点赞/点踩同命运，无需额外判断。

图标不套 `AuthGate(Write)`：投诉权限由探针表达，避免与 NextAgent AICO Write 权限错配。

弹框状态由 `TurnBlock` 本地持有（`ComplaintDialog` 在 `TurnBlock` 内渲染，`open` 本地管理），不改动 `MessageList`/`ChatPage` 的 props 链，与既有 `onFork`/`onShare`/`onGenerateReport` 的透传风格保持一致的最小改动。

### 3. 投诉中心弹框 ComplaintDialog

新增 `frontend/agent-web/src/features/complaint/components/ComplaintDialog.tsx`，antd `Modal`，`title` = `t("complaint.title")`（"投诉中心"）。内容：

- 投诉类型：`records` 渲染为带边框文本块列表；`locale === "zh-CN"` 显示 `name_zh`，否则 `name_en`；选中态与 hover 态边框变主题色；单选；未选时提交禁用。
- 投诉描述：`Input.TextArea`，`maxLength={2600}`。
- 校验：
  - `reason_id` 必选。
  - `reason_detail`：当 `reason_id === "8"` 时必填；填写时须匹配 `/^[^\s].*/`（不以空白开头）且长度 <= 2600。
- 取消：关闭弹框并清空草稿。提交：校验通过后调 `complaintService.createReport`，成功 `message.success` + 关闭，失败 `message.error`（保留弹框与草稿）。

### 4. alog_card 拼接

新增 `frontend/agent-web/src/features/chat/presentation/complaintAnswerText.ts`：

```ts
export function buildComplaintAlogCard(question: string, segments: readonly AnswerSegment[]): string {
  const texts = segments
    .filter((s) => s.kind === "text" || (s.kind === "structured" && s.toolMessageType === "TEXT"))
    .map((s) => (s.kind === "text" ? s.content : typeof s.content === "string" ? s.content : ""))
    .filter((t) => t.length > 0);
  return `[Q]${question}\n[A]${texts.join("\n")}`;
}
```

`question` 取 `userMessage.content`，`segments` 取 `buildAnswerSegments(block.aiEvents)`。无 Text 段时 `[A]` 后为空串。

### 5. 多宿主投诉历史入口

PIU 信息常量：`COMPLAINT_HISTORY_PIU = { piuName: "RobotRouterPIU", piuVersion: "1.0.0", renderFunc: "renderComplaintList" }`。

新增 `frontend/agent-web/src/features/complaint/components/ComplaintHistoryView.tsx`：`enabled` 为 `false` 时返回 `null`；否则渲染 `<PiuRenderer piuInfo={COMPLAINT_HISTORY_PIU} theme={hostTheme} containerStyle={{ width: "100%", height: "100%" }} />`。本地 dev 无 `window.Prel` 时 `PiuRenderer` 渲染占位符（符合 `aico-piu-injection` spec）。

- immersive 左布局（`ImmersiveLeftLayout`）：`Sidebar` 新增 NavButton（icon、label=`t("sidebar.complaintHistory")`），`isComplaintHistoryVisible = mode !== "local" && complaintFeatureStore.enabled`；点击 `onSelectComplaintHistory` 回调，`ImmersiveApp` 将 `contentView` 扩展为 `"conversation" | "memory" | "complaint"`，`"complaint"` 渲染 `<ComplaintHistoryView />`。参照记忆管理 NavButton 与 `memoryManagementActive` 的 active 态。
- immersive 右布局（`ImmersiveRightLayout`）：header 新增按钮，`RightPanelView` 扩展 `"complaint"`；`panelView === "complaint"` 时渲染 `<ComplaintHistoryView />`（覆盖在 conversation 之上，参照 history/favorites 的绝对定位 CardList 模式）。
- collaborative（`AIAgentPiuRuntime` 的 `PiuPanelHeader`）：header 新增按钮（参照 memory 按钮），点击设置本地 `complaintHistoryOpen` 状态，渲染 antd `Modal`（`destroyOnHidden`）内嵌 `<ComplaintHistoryView />`。
- local：`Sidebar` 不渲染投诉历史 NavButton（`mode === "local"` 跳过）。

## 质量属性审视

### 安全

- 投诉接口经 `apiClient`，鉴权信息由拦截器注入，不暴露 credential；`reason_detail`/`alog_card` 为用户输入，不 `dangerouslySetInnerHTML`。
- `alog_card` 的 question/answer 来自已渲染的 TurnBlock（可信来源），不接受用户手输。
- `reason_id` 仅来自探针 `records` 的 id，提交前校验其属于已缓存 `records`。

### 性能/容量

- 探针进程内一次，结果缓存；弹框打开不重复请求。
- `records` 固定 8 条，渲染开销可忽略。
- `alog_card` 长度受答案体量约束，无额外容量风险。

### 可靠性/恢复

- 探针失败静默隐藏能力，不阻塞主对话。
- 提交失败 `message.error` 保留草稿，用户可重试。

### 可维护性

- `complaintFeatureStore` 单一 feature gate 来源；`ComplaintHistoryView` 复用 `PiuRenderer`；入口参照记忆管理既有模式，无平行抽象。

### 可测试性

- `buildComplaintAlogCard` 纯函数可单测。
- `complaintService` mock `apiClient` 可单测 URL/body。
- 弹框校验可用 `@testing-library/react` 触发；探针显隐可用 store mock。

### 审计/可追溯

- 投诉由外部 report 服务审计；NextAgent 前端不产生持久化审计事实。

## 归档前更新长期设计

- `openspec/designs/modules/agent-web.md`：补充投诉反馈模块职责（探针、反馈图标、弹框、提交、多宿主入口）与渲染落点。
- `openspec/designs/spec-to-design-map.md`：补充 `agent-web-complaint-feedback` 导航。
- `openspec/overview.md`：补充电信运维答案投诉反馈与投诉历史场景背景。

## 验证入口

- `openspec validate --all --strict`
- `agent-web` 内 `npm run build`、`npm test`，涉及浏览器旅程追加 `npm run test:e2e`
