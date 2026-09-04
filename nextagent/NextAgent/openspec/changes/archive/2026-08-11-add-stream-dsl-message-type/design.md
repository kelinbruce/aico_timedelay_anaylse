## D1. STREAM_DSL 作为独立 ToolMessageType 而非扩展 DSL [已确认 2026-08-01，稳定。]

`DSL` 和 `STREAM_DSL` 的语义不同：`DSL` 是一次性完整 payload，用裸 `SimpleDslRenderer`（`<DSLEngine data={[content]} />`）渲染；`STREAM_DSL` 是增量分块流式，用 `@cloudsop/dsl-engine-web/genui-components` 的 `DSLRenderer`（`<DSLRenderer dataModel={...} response={...} isStreaming={...} />`）渲染，且需要 `StreamDSLContext` 包裹。

两者不复用同一个 `ToolMessageType`，原因：
- 累积语义完全不同（独立堆叠 vs 分片协议累积）。
- 渲染组件不同（`SimpleDslRenderer` vs `DSLRenderer`）。
- 渲染上下文不同（裸渲染 vs `StreamDSLContext` 包裹）。

后端识别逻辑（`identifyStructuredDelta`）不感知 `STREAM_DSL` 的内部分片协议。外层校验 `content` 存在即可，`content` 的 `type` 字段由前端解析。这与现有 `DSL`、`PIU` 等类型一致——后端只校验 `content` 存在，不校验内部结构。

## D2. STREAM_DSL 流式分片协议 [已确认 2026-08-01，稳定。]

`STREAM_DSL` 的 `content` 是带 `type` 标记的 JSON 对象，三种分片类型：

```
事件1  content = { type: "dataModel", content: {...} }   # 数据模型，只来一次，先到
事件2  content = { type: "dsl", content: "chunk1" }       # DSL 文本片段，需拼接
事件3  content = { type: "dsl", content: "chunk2" }       # 继续拼接
...
事件N  content = { type: "done" }                         # 流结束信号，无 content
```

累积规则：
- `type: "dataModel"`：记录 `dataModel` 字段。如果已有累积中的 `STREAM_DSL` segment（收到新的 `dataModel` 但前一段未收到 `done`），flush 前一段（渲染已有部分内容），再开始新段。这兼容流中断场景。
- `type: "dsl"`：将 `content` 字符串追加到 `dsl` 字段。
- `type: "done"`：设置 `isDone = true`，flush 当前 segment。

累积后的 segment content 结构：

```typescript
interface StreamDslAccumulatedContent {
  readonly dataModel: unknown;      // 首个 dataModel 分片的 content
  readonly dsl: string;             // 所有 dsl 分片 content 拼接
  readonly isDone: boolean;         // 是否收到 done
}
```

## D3. STREAM_DSL 累积在 buildAnswerSegments 中的位置 [已确认 2026-08-01，稳定。]

STREAM_DSL 只走 `ANSWER` 路径（`toolEventType: "ANSWER"`），不进 `DETAIL`/`SUB_DETAIL`/`SUB_CONCLUSION`。因此 `appendProcessDetailSegment` 不需要修改。

在 `buildAnswerSegments` 中，STREAM_DSL 事件是连续的（中间不会插入其他 messageType 的事件）。累积逻辑：

```
遇到 STREAM_DSL ANSWER 事件:
  - 如果没有累积中的 STREAM_DSL segment → 开始新段
  - 如果有累积中的 segment → 按 content.type 累积
  - content.type === "dataModel" 且已有累积中 segment → flush 前一段，开始新段
  - content.type === "done" → 标记 isDone，flush
遇到非 STREAM_DSL 事件 → flush 累积中的 STREAM_DSL segment
```

flush 时机：
1. 收到 `type: "done"` → flush
2. 收到新的 `type: "dataModel"` 但已有累积段 → flush 前一段
3. 遇到非 STREAM_DSL 事件 → flush
4. 事件流结束 → flush

## D4. StreamDSLContext 外层化 [已确认 2026-08-01，稳定。]

现有 `StreamDSLContext` 在 `ReportAnswerCard` 内部包裹，传 `local`、`theme`、`conversationId`、`expandPanelId`、`handleExpandPanel` 五个参数。

变更后：
- `StreamDSLContext` 移到 `TurnBlock` 答案区外层，覆盖 `ReportAnswerCard` 和 `AnswerSegments` 两条渲染路径。
- 只传 `local`、`theme`、`conversationId`（即 `sessionId`）。
- `expandPanelId` 和 `handleExpandPanel` 移入 `init` 方法，全局注册一次。

`TurnBlock` 中 `StreamDSLContext` 的放置位置：在 BI 报告渲染路径和常规答案渲染路径的共同外层。`local` 来自 `supportedLocaleToHostLocale(getCurrentLocale())`，`theme` 来自 `useAppHostContext().hostTheme`，`conversationId` 来自 `sessionId`。这些在 `TurnBlock` 作用域内均可获取。

`ReportAnswerCard` 去掉 `StreamDSLContext` 后只保留 `<DSLEngine data={[content]} />`，不再需要 `useAppHostContext()`、`getCurrentLocale()`、`expandPanelStore` 等 import。

## D5. genui-components 引入与 alias 配置 [已确认 2026-08-01，稳定。]

新增 `@cloudsop/dsl-engine-web/genui-components` 子路径：
- production：解析为真实包 `@cloudsop/dsl-engine-web/genui-components`。
- dev/test：解析为 stub `src/vendor/dsl-engine-genui-components-stub.tsx`。

stub 导出三个 API：
- `DSLRenderer`：no-op 组件，渲染占位 div。
- `StreamDSLContext`：no-op Provider，透传 children。
- `init`：no-op 函数。

移除旧的 `@cloudsop/dsl-engine-web/generateui` alias 和对应 stub 文件 `src/vendor/dsl-engine-generateui-stub.tsx`，变更后无代码引用。

## D6. init 方法调用位置 [已确认 2026-08-01，稳定。]

`init` 在 `renderRoot.tsx` 中调用，时机为 `loadRuntimeConfig()` 成功之后、`root.render(node)` 之前。

三个宿主入口全部经过 `renderRoot`：
- `local.tsx` → `renderRoot()`
- `immersive.tsx` → `renderRoot()`（via `createRootWithRuntimeConfig`）
- `collaborative.ts` → `registerAIAgentPIU` → `loadAIAgentWithConfig` → `renderRoot()`

`renderRoot` 可能被多次调用（collaborative 的 `loadAIAgentWithConfig` 和 `renderKnowledgeWithConfig` 各调一次），因此用模块级 flag 保证 `init` 只执行一次。

init 参数：
```typescript
init({
  instanceId: "nextagent-dsl-instance",
  expandPanelId: EXPAND_PANEL_DIV_ID,
  handleExpandPanel: (open: boolean) => {
    if (open) { expandPanelStore.getState().open(); }
    else { expandPanelStore.getState().close(); }
  },
  handleConversation: () => {}
});
```

## D7. SimpleDslRenderer 改名 [已确认 2026-08-01，稳定。]

现有 `DslRenderer`（`src/features/chat/components/structured/DslRenderer.tsx`）改名为 `SimpleDslRenderer`。调用点：
- `AnswerSegments.tsx`：import + JSX 调用。
- `ExpandPanel.tsx`：import + JSX 调用。
- `AnswerSegments.test.tsx`：import + mock + 断言。

改名后与 `@cloudsop/dsl-engine-web/genui-components` 的 `DSLRenderer` 不冲突。`SimpleDslRenderer` 继续使用 `@cloudsop/dsl-engine-web`（主包）的 `DSLEngine`，行为不变。

## D8. StreamDslAnswerCard 新组件 [已确认 2026-08-01，稳定。]

新增 `StreamDslAnswerCard.tsx`，渲染 STREAM_DSL segment：

```tsx
import { DSLRenderer } from "@cloudsop/dsl-engine-web/genui-components";

interface StreamDslAnswerCardProps {
  readonly dataModel: unknown;
  readonly dsl: string;
  readonly isDone: boolean;
}

export function StreamDslAnswerCard({ dataModel, dsl, isDone }: StreamDslAnswerCardProps) {
  return (
    <div data-testid="stream-dsl-answer-card">
      <DSLRenderer dataModel={dataModel} response={dsl} isStreaming={!isDone} />
    </div>
  );
}
```

不需要自己包 `StreamDSLContext`，因为外层（`TurnBlock`）已经包裹。`AnswerSegments` 的 switch 新增 `"STREAM_DSL"` case，从 segment content 中解构 `dataModel`、`dsl`、`isDone` 传给 `StreamDslAnswerCard`。