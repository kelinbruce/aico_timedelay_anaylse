## 设计目标

 在 `agent-web` 前端实现历史对话勾选生成 BI 报告的完整链路：操作栏按钮入口 -> 报告勾选模式 -> 调用 aicoservice `bi-report` 接口 -> 合成报告答案 TurnBlock 渲染 -> DSL 卡片内查看报告联动扩展面板。复用现有分享勾选模式骨架和现有 DSL 渲染路径，不新增平行业务语义。

## 唯一实现路径

### 1. 答案操作栏生成报告按钮

在 `TurnBlock` 的助手答案操作栏（`BubbleActions`）中新增"生成报告"按钮，位于"重新生成"按钮之前，与复制、点赞/点踩、分享等操作按钮处于同一操作行。按钮使用 `BarChartOutlined` 图标，`data-testid="btn-generate-report"`，tooltip/aria-label 为 `t("report.generate")`。

按钮渲染条件：`onGenerateReport` 存在且不处于任何勾选模式（`!anySelectionMode`）且 `reportableRequestId` 存在且非合成报告 TurnBlock（`!isBiReportTurn`）。不满足条件时不渲染按钮。

"生成报告"按钮的 `onClick` 调用 `handleGenerateReport`，后者调用 `onGenerateReport(rootMessageId, reportableRequestId)`，由 `ChatPage` 处理进入报告勾选模式。

### 2. 报告勾选模式状态机（ChatPage）

`ChatPage` 新增状态：
- `reportSelectionMode: boolean`
- `selectedReportRequestIds: Set<string>`

进入报告勾选模式时：若 `shareSelectionMode` 为 true，先 `setShareSelectionMode(false)` + `setSelectedRunIds(new Set())`，再 `setReportSelectionMode(true)`。默认勾选触发源的 requestId。

退出时：`setReportSelectionMode(false)` + `setSelectedReportRequestIds(new Set())`。

互斥对称：进入分享勾选模式时同样退出报告勾选模式。切换会话时两者都退出（复用现有 `prevSessionIdRef` effect）。

`selectableReportRequestIds` = `new Set(turnBlocks.map(resolveReportableRequestId).filter(Boolean))`。全选/已选计数/最多 10 个约束在此层实现：勾选时若 `selectedReportRequestIds.size >= 10` 则禁止新增。

### 3. 可勾选规则 resolveReportableRequestId

新建 `agent-web/src/features/chat/presentation/reportSelection.ts`，与 `shareSelection.ts` 平行。核心差异：

```
shareSelection.resolveShareableRunId(block)      reportSelection.resolveReportableRequestId(block)
  -> runId                                         -> requestId
  -> 终结 + 有答案                                  -> 终结 + 有答案 + 答案类型受限
```

实现步骤：
1. 取 `requestId = block.aiEvents.find(e => e.requestId)?.requestId`，无则 `undefined`。
2. 终结校验：`TERMINAL_RUN_STATUSES` 含 `block.status` 且 `block.status !== "FAILED"`。
3. 答案存在性 + 类型校验：遍历 `aiEvents`，
   - `LLM_CONTENT_DELTA`（非 `CAPABILITY_RESULT` role）累积文本非空 -> 可勾选（纯文本）。
   - `TOOL_STRUCTURED_DELTA` 且 `toolEventType === "ANSWER"`：
     - `toolMessageType === "TEXT"` -> 可勾选。
     - `toolMessageType === "DSL"` -> `JSON.parse(content)` 得 `obj`，校验 `obj?.type === "piu" && obj?.properties?.name === "dte-bi-agent"`，满足可勾选。
     - 其他 `toolMessageType` -> 不可勾选。
4. 仅当存在至少一个可勾选答案来源时返回 `requestId`。

合成报告 TurnBlock（`rootMessageId` 前缀 `bi-report:`）天然不满足此规则（其 requestId 为合成值，且 `aiEvents` 为合成事件），因此不参与勾选。

### 4. biReportService

新建 `agent-web/src/services/biReportService.ts`：

```ts
export const biReportService = {
  async generateReport(params: { sessionId: string; requestIds: readonly string[]; signal?: AbortSignal }): Promise<unknown> {
    return apiClient.post<unknown>(
      `/rest/naie/aicoservice/v1/sessions/${encodeURIComponent(params.sessionId)}/bi-reports`,
      { requestIds: [...params.requestIds] },
      params.signal ? { signal: params.signal } : undefined,
    );
  },
};
```

鉴权由 `apiClient` 的 `applyRequestInterceptors` 自动注入（`roarand`/`x-tenant-id`/`x-subject-id`/`x-display-name`/`credentials: include`），不手动设置。
接口返回值为 DSL content 对象本身（非包装信封），直接交给 `DSLEngine` 渲染。

### 5. 合成报告 TurnBlock + ReportAnswerCard

`ChatPage` 在接口成功后构建合成 TurnBlock：

```ts
const content = await biReportService.generateReport({ sessionId, requestIds: [...selectedReportRequestIds] });
const reportId = crypto.randomUUID();
const syntheticBlock: TurnBlock = {
  rootMessageId: `bi-report:${reportId}`,
  userMessage: { content: "" } as SessionConversationMessage,
  aiEvents: [{
    eventId: `bi-report-${reportId}`,
    sessionId, requestId: `bi-report:${reportId}`,
    runId: null, rootMessageId: `bi-report:${reportId}`,
    sequence: 0, eventType: "TOOL_STRUCTURED_DELTA",
    timelineEventRef: null,
    transportHints: ["history-load"],
    payload: { toolEventType: "ANSWER", toolMessageType: "DSL", content },
    createdAt: now,
  }],
  status: "COMPLETED",
  isLatest: false,
};
```

`TurnBlock` 渲染分支：检测 `rootMessageId` 前缀 `bi-report:` 时（`isBiReportTurn`），替换 `AnswerSegments + BubbleActions` 为 `<ReportAnswerCard content={biReportContent} sessionId={sessionId} />`。

报告勾选模式下 checkbox 渲染规则：有 `rawRequestId`（`aiEvents.find(e => e.requestId)?.requestId`）且非合成报告 TurnBlock（`!isBiReportTurn`）时渲染 checkbox；不可报告 TurnBlock（`resolveReportableRequestId` 返回 `undefined`）的 checkbox 渲染但禁用（`disabled={!reportableRequestId || reportSelectionDisabled}`），与分享勾选模式中不可分享 TurnBlock 的处理方式一致。合成报告 TurnBlock 不渲染 checkbox。

`ReportAnswerCard`：
```tsx
<StreamDSLContext
  local={supportedLocaleToHostLocale(getCurrentLocale())}
  theme={hostTheme}
  conversationId={sessionId}
  expandPanelId={EXPAND_PANEL_DIV_ID}
  handleExpandPanel={(isOpen) => {
    if (isOpen) {
      expandPanelStore.getState().setContent({ toolMessageType: "DSL", content }, "bi-report");
      expandPanelStore.getState().open();
    } else {
      expandPanelStore.getState().close();
    }
  }}
>
  <DSLEngine data={[content]} />
</StreamDSLContext>
```

### 6. DSL generateui dev stub

新建 `agent-web/src/vendor/dsl-engine-generateui-stub.tsx`：
```tsx
import type { ReactNode } from "react";
export function StreamDSLContext({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
```

`vite.config.ts` 在 `resolve.alias` 新增独立条目：
```ts
"@cloudsop/dsl-engine-web/generateui":
  mode === "production"
    ? "@cloudsop/dsl-engine-web/generateui"
    : path.resolve(__dirname, "src/vendor/dsl-engine-generateui-stub.tsx"),
```

现有 `"@cloudsop/dsl-engine-web"` alias 不动。两条 alias 独立，Vite 字符串 alias 前缀匹配互不干扰。

### 7. 报告操作栏

复用 `ShareModeBar` 的样式骨架新建 `ReportModeBar`（或参数化 `ShareModeBar`），差异：文案为报告相关 i18n key，确认按钮文案为"生成报告"，`onConfirm` 调用报告生成流程。为遵循"同形同策"，若 `ShareModeBar` 可通过 props 参数化复用则优先复用，否则新建平行组件。

## 扩展面板联动路径选择

扩展面板有两种打开路径：
- 场景 1（React 渲染）：`expandPanelStore.setContent({toolMessageType, content}) + open()`，内容由 `ExpandPanel` 内 React 组件渲染。
- 场景 2（PIU 直渲染）：PIU 调用 `handleExpandPanelOpen()`，`content` 设为 null，PIU 自行往 `expandPanelId` div 渲染。

报告 DSL 卡片的"查看报告"使用场景 1：报告内容是 `DSLEngine` 可渲染的 DSL data，由 `ExpandPanel` 的 `renderExpandPanelContent` 在 `toolMessageType === "DSL"` 分支用 `DslRenderer` 渲染。`handleExpandPanel(true)` 调用 `setContent` + `open`，复用现有 React 渲染路径，不引入 PIU 直渲染路径。`handleExpandPanel(false)` 调用 `close()`。

此选择理由：报告内容是结构化 DSL data，无需 PIU 加载流程，场景 1 已能完整渲染；引入场景 2 会增加容器清理复杂度且无收益。

## 质量属性审视

### 安全

- `bi-report` 接口走 `apiClient`，鉴权信息由拦截器注入，不暴露 credential。
- `requestIds` 来自前端已渲染的 TurnBlock（可信来源为已持久化/已流式的 requestId），不接受用户手输。
- 报告 DSL `content` 来自 aicoservice 响应，经 `DSLEngine` 渲染，不直接 `dangerouslySetInnerHTML`。
- 合成 TurnBlock 不参与任何写操作（无 retry/edit/fork/share），不发起 runtime 请求。

### 性能/容量

- 最多勾选 10 个，接口请求 URL 长度可控。
- 合成 TurnBlock 仅 1 条 aiEvent，渲染开销与单条 DSL 答案等同。
- 操作栏按钮为普通按钮元素，无性能影响。

### 可靠性/恢复

- 接口失败时展示 safe error（antd `message.error`），不破坏会话状态。
- 报告答案为页面态，刷新/切会话即消失，不影响持久化会话数据。
- 合成 TurnBlock 标记 `isLatest: false` + `transportHints: ["history-load"]`，不干扰 `useChatViewportController` 的 latest-turn 逻辑。

### 可维护性

- `resolveReportableRequestId` 与 `resolveShareableRunId` 平行独立，各自单一职责，不相互耦合。
- `ReportAnswerCard` 独立组件，`StreamDSLContext` 仅包裹报告 DSL，不影响现有 `DslRenderer`/`AnswerSegments`。
- 两条 vite alias 独立，现有 DSL 渲染行为零影响。

### 可测试性

- `resolveReportableRequestId` 为纯函数，可独立单测（正反向 case）。
- `biReportService` 可 mock `apiClient` 测试 URL 拼接和参数。
- 操作栏按钮/勾选模式/渲染可用 `@testing-library/react` + Playwright 测试。
- dev stub 透传行为可单测。

### 审计/可追溯

- 报告生成调用 aicoservice 外部接口，aicoservice 侧自行审计；NextAgent 前端不产生持久化审计事实。
- 合成 TurnBlock 不进入 NextAgent 持久化，不产生 audit/log。

## implementation-vs-spec gap

无。当前实现路径与目标设计一致。遗留问题（持久化）为已知延期项，非 gap。

## 遗留问题（明确延期）

**报告答案持久化**：当前版本报告答案仅存在于前端页面状态，切换会话/刷新后消失。是否持久化取决于 aicoservice 的 `bi-report` 接口生成报告后是否将报告消息写入 NextAgent runtime 可读的会话消息存储。

- 若 aicoservice 与 NextAgent 共享消息存储且按 `conversationAdapter.toHistoryEnvelope` 期望的 shape（`role: "CAPABILITY_RESULT"` + content JSON payload 含 `payload.eventType`/`payload.messageType`/`payload.content`）写入，则前端切会话回来时 `GET /api/v1/sessions/{sessionId}/conversation` 会自然带回，`conversationMessagesToHistoryEnvelopes` 自动还原为 `TOOL_STRUCTURED_DELTA`/`ANSWER`/`DSL` 事件，前端零成本持久化。
- 若不共享存储，需 NextAgent runtime 新增"写入外部生成报告消息"API，属另一个 change 范畴。

此问题需与 aicoservice 团队确认存储关系，确认前不实现持久化，不生成依赖该未定规格的可实施任务。

## 归档前更新长期设计

- `openspec/designs/modules/agent-web.md`：补充报告生成功能的模块职责（操作栏按钮入口、勾选模式、合成 TurnBlock、ReportAnswerCard）和渲染落点。
- `openspec/designs/spec-to-design-map.md`：补充 `agent-web-bi-report-generation` spec 到模块设计的导航。
- `openspec/overview.md`：补充电信运维 BI 报告聚合场景背景。

## 验证入口

- `openspec validate --all --strict`
- `agent-web` 内：`npm run build`、`npm test`、涉及浏览器用户旅程时追加 `npm run test:e2e`
- 可重复验证路径：`resolveReportableRequestId` 单测 + 操作栏按钮/勾选模式 Playwright

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-1.1-查看会话消息流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/agent-web-bi-report-generation/spec.md`、`openspec/specs/agent-web-structured-message-rendering/spec.md`、`openspec/specs/conversation-share/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
