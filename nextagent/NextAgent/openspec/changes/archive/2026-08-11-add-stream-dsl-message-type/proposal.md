## 背景与问题（Why）

现有 `TOOL_STRUCTURED_DELTA` 结构化展示支持六种 `toolMessageType`：`PIU`、`DSL`、`ACTION`、`OPERATOR`、`FILE`、`TEXT`。其中 `DSL` 类型以一次性完整 payload 交给 `DslRenderer`（裸 `<DSLEngine data={[content]} />`）渲染。

电信运维场景中，部分能力（如 ApiCall 流式调用后端 API）需要以增量分块方式返回 DSL 内容，前端渐进式渲染。现有 `DSL` 类型不支持流式累积——它的累积语义是非 TEXT 类型"每个事件独立成段堆叠不替换"，无法将多个分片合并为一份完整内容。

同时，`@cloudsop/dsl-engine-web` 升级后提供 `genui-components` 子路径，导出 `DSLRenderer`、`StreamDSLContext`、`init` 三个 API，支持 `dataModel` + `response` + `isStreaming` 的流式渲染模式。现有代码从 `@cloudsop/dsl-engine-web/generateui` 导入 `StreamDSLContext`，需要迁移到新子路径。

## 变更范围（What Changes）

1. **新增 `STREAM_DSL` `ToolMessageType`**：在 `agent-common` 的 `ToolMessageType` 枚举和 `TOOL_MESSAGE_TYPES` 数组中加入 `"STREAM_DSL"`。后端识别逻辑不感知 `STREAM_DSL` 内部分片协议，外层校验 `content` 存在即可。

2. **STREAM_DSL 流式分片协议**：`STREAM_DSL` 的 `content` 是带 `type` 标记的分片对象。`type: "dataModel"` 先到（只来一次），`type: "dsl"` 为文本片段（需拼接），`type: "done"` 标记流结束。连续的 `STREAM_DSL` ANSWER 事件按此协议累积为单个 segment。

3. **前端累积语义**：`buildAnswerSegments` 新增第四种累积模式。连续 `STREAM_DSL` ANSWER 事件合并为单个 segment，content 聚合为 `{ dataModel, dsl, isDone }`。遇到 `type: "dataModel"` 时 flush 前一段（兼容流中断），遇到非 `STREAM_DSL` 事件时 flush。

4. **`@cloudsop/dsl-engine-web/genui-components` 引入**：新增 vite/vitest alias 指向 stub（dev）或真实包（production）。移除旧的 `@cloudsop/dsl-engine-web/generateui` alias 和对应 stub。

5. **`StreamDSLContext` 外层化**：从 `ReportAnswerCard` 组件内部移到 `TurnBlock` 答案区外层，覆盖 `ReportAnswerCard` 和 `AnswerSegments`。`StreamDSLContext` 只传 `local`、`theme`、`conversationId`；`expandPanelId` 和 `handleExpandPanel` 移入 `init` 方法。

6. **`init` 方法调用**：在 `renderRoot.tsx` 中 `loadRuntimeConfig()` 之后、`root.render()` 之前调用 `init`，带模块级 flag 保证幂等。三个宿主入口（local、immersive、collaborative）全部经过 `renderRoot`，全覆盖。

7. **`DslRenderer` 改名为 `SimpleDslRenderer`**：避免与 `@cloudsop/dsl-engine-web/genui-components` 导出的 `DSLRenderer` 命名冲突。更新所有调用点。

## Capability 影响

### 修改的 Capability

- `tool-structured-delta`：`TOOL_MESSAGE_TYPES` 枚举加入 `STREAM_DSL`；`Structured Event Shape Validation` 的 `messageType` 校验集合扩展。
- `agent-web-structured-message-rendering`：`buildAnswerSegments` 新增 STREAM_DSL 累积语义；`AnswerSegments` 渲染分发新增 `STREAM_DSL` case；`DslRenderer` 改名为 `SimpleDslRenderer`。
- `agent-web-bi-report-generation`：`ReportAnswerCard` 去掉 `StreamDSLContext` 包裹；`StreamDSLContext` 移到 `TurnBlock` 答案区外层；`genui-components` 引入 + `init` 调用。

### 新增 Capability

无。

## 影响范围

- `packages/agent-common/src/index.ts`：`ToolMessageType` + `TOOL_MESSAGE_TYPES` 加 `STREAM_DSL`。
- `frontend/agent-web/src/features/chat/presentation/answerContent.ts`：本地 `ToolMessageType` + `validToolMessageTypes` 同步加；`buildAnswerSegments` 新增 STREAM_DSL 累积逻辑。
- `frontend/agent-web/src/features/chat/components/structured/`：`DslRenderer.tsx` -> `SimpleDslRenderer.tsx`（重命名）；`AnswerSegments.tsx` import 改名 + 新增 `STREAM_DSL` case；新增 `StreamDslAnswerCard.tsx`；`ReportAnswerCard.tsx` 去掉 `StreamDSLContext`。
- `frontend/agent-web/src/features/expand-panel/ExpandPanel.tsx`：import 改名。
- `frontend/agent-web/src/features/chat/components/TurnBlock.tsx`：答案区外层包 `StreamDSLContext`。
- `frontend/agent-web/src/entries/renderRoot.tsx`：加 `init` 调用。
- `frontend/agent-web/src/vendor/`：新增 `dsl-engine-genui-components-stub.tsx`；移除 `dsl-engine-generateui-stub.tsx`。
- `frontend/agent-web/vite.config.ts`、`vitest.config.ts`：alias 更新。
- 测试文件同步更新。

后端识别逻辑（`structured-delta-identification.ts`、`structured-delta-safety.ts`、`tool-loop.ts`）不修改。

## 归档前更新基线

- `openspec/specs/tool-structured-delta/spec.md`：`Structured Event Shape Validation` 的 `messageType` 集合加入 `STREAM_DSL`。
- `openspec/specs/agent-web-structured-message-rendering/spec.md`：新增 STREAM_DSL 累积语义、渲染分发、`SimpleDslRenderer` 改名 requirement。
- `openspec/specs/agent-web-bi-report-generation/spec.md`：`StreamDSLContext` 外层化、`genui-components` 引入、`init` 调用 requirement。

## Non-Goals

- 不修改后端结构化识别逻辑（`identifyStructuredDelta`、`hasSensitiveStructuredContent`）。
- 不修改进程面板累积逻辑（`appendProcessDetailSegment`），STREAM_DSL 只走 ANSWER 路径。
- 不修改 `WorkflowVisibleDeltaChannel`（不加 `STREAM_DSL` channel）。
- 不修改 stream-envelope 投影逻辑。
- 不处理 `STREAM_DSL` 出现在 DETAIL/SUB_DETAIL 路径的场景（当前只走 ANSWER）。
- 不清理 `@cloudsop/dsl-engine-web`（主包）和 `DSLEngine` 的现有使用。