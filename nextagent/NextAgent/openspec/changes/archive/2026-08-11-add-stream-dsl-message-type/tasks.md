## 1. agent-common 枚举扩展

- [x] 1.1 在 `packages/agent-common/src/index.ts` 的 `ToolMessageType` 类型加入 `"STREAM_DSL"`，在 `TOOL_MESSAGE_TYPES` 数组加入 `"STREAM_DSL"`。
  验证：`npm run build` 编译通过；`TOOL_MESSAGE_TYPES` 包含 7 个元素。
  满足：Requirement "Structured Event Shape Validation"。

## 2. 前端 answerContent.ts 累积语义

- [x] 2.1 在 `frontend/agent-web/src/features/chat/presentation/answerContent.ts` 的本地 `ToolMessageType` 类型和 `validToolMessageTypes` 数组加入 `"STREAM_DSL"`。
  验证：TypeScript 编译通过；`validToolMessageTypes` 包含 7 个元素。
  满足：Requirement "STREAM_DSL Accumulation Semantics"。

- [x] 2.2 在 `buildAnswerSegments` 中新增 STREAM_DSL 累积逻辑：连续 STREAM_DSL ANSWER 事件按 `content.type`（`dataModel`/`dsl`/`done`）累积为单个 segment，content 聚合为 `{ dataModel, dsl, isDone }`。flush 时机：收到 `done`、收到新 `dataModel`（flush 前一段）、遇到非 STREAM_DSL 事件、事件流结束。
  验证：`npm test -- answerContent` 新增测试覆盖：完整流、无 done 流中断、两段独立流、新 dataModel 打断、STREAM_DSL 后跟 TEXT。
  满足：Requirement "STREAM_DSL Accumulation Semantics"。

## 3. SimpleDslRenderer 改名

- [x] 3.1 将 `frontend/agent-web/src/features/chat/components/structured/DslRenderer.tsx` 重命名为 `SimpleDslRenderer.tsx`，export 改名为 `SimpleDslRenderer`。
  验证：文件存在；export 名称为 `SimpleDslRenderer`。
  满足：Requirement "MessageType Renderer Components"。

- [x] 3.2 更新 `AnswerSegments.tsx` 的 import 和 JSX 调用从 `DslRenderer` 改为 `SimpleDslRenderer`。
  验证：`AnswerSegments.tsx` 编译通过；DSL case 使用 `SimpleDslRenderer`。
  满足：Requirement "MessageType Renderer Components"。

- [x] 3.3 更新 `ExpandPanel.tsx` 的 import 和 JSX 调用从 `DslRenderer` 改为 `SimpleDslRenderer`。
  验证：`ExpandPanel.tsx` 编译通过；DSL case 使用 `SimpleDslRenderer`。
  满足：Requirement "MessageType Renderer Components"。

- [x] 3.4 更新 `AnswerSegments.test.tsx` 的 import、mock 和断言从 `DslRenderer` 改为 `SimpleDslRenderer`。
  验证：`npm test -- AnswerSegments.test` 通过。
  满足：Requirement "MessageType Renderer Components"。

## 4. StreamDslAnswerCard 新组件

- [x] 4.1 创建 `frontend/agent-web/src/features/chat/components/structured/StreamDslAnswerCard.tsx`，从 `@cloudsop/dsl-engine-web/genui-components` 导入 `DSLRenderer`，接收 `{ dataModel, dsl, isDone }` props，渲染 `<DSLRenderer dataModel={dataModel} response={dsl} isStreaming={!isDone} />`。
  验证：TypeScript 编译通过；组件存在且 props 正确。
  满足：Requirement "MessageType Renderer Components"。

- [x] 4.2 在 `AnswerSegments.tsx` 的 switch 新增 `"STREAM_DSL"` case，从 segment content 解构 `dataModel`、`dsl`、`isDone`，传给 `StreamDslAnswerCard`。
  验证：TypeScript 编译通过；STREAM_DSL segment 渲染为 `StreamDslAnswerCard`。
  满足：Requirement "MessageType Renderer Components"。

## 5. genui-components alias 与 stub

- [x] 5.1 创建 `frontend/agent-web/src/vendor/dsl-engine-genui-components-stub.tsx`，导出 `DSLRenderer`（no-op 组件）、`StreamDSLContext`（no-op Provider）、`init`（no-op 函数）。
  验证：文件存在；导出三个 API。
  满足：Requirement "DSL Engine genui-components Integration"。

- [x] 5.2 在 `vite.config.ts` 新增 `@cloudsop/dsl-engine-web/genui-components` alias（dev 指向 stub，production 指向真实包）。
  验证：vite 配置包含新 alias。
  满足：Requirement "DSL Engine genui-components Integration"。

- [x] 5.3 在 `vitest.config.ts` 新增 `@cloudsop/dsl-engine-web/genui-components` alias 指向 stub。
  验证：vitest 配置包含新 alias。
  满足：Requirement "DSL Engine genui-components Integration"。

- [x] 5.4 移除 `vite.config.ts` 和 `vitest.config.ts` 中的 `@cloudsop/dsl-engine-web/generateui` alias。
  验证：配置中不再包含 `generateui` alias。
  满足：Requirement "DSL Engine genui-components Integration"。

- [x] 5.5 删除 `frontend/agent-web/src/vendor/dsl-engine-generateui-stub.tsx`。
  验证：文件不存在。
  满足：Requirement "DSL Engine genui-components Integration"。

## 6. StreamDSLContext 外层化

- [x] 6.1 在 `TurnBlock.tsx` 答案区外层包裹 `<StreamDSLContext local={...} theme={...} conversationId={sessionId}>`，覆盖 BI 报告路径和常规答案路径。`local` 来自 `supportedLocaleToHostLocale(getCurrentLocale())`，`theme` 来自 `useAppHostContext().hostTheme`。
  验证：TurnBlock 编译通过；答案区被 StreamDSLContext 包裹。
  满足：Requirement "报告 DSL 渲染与 StreamDSLContext"。

- [x] 6.2 从 `ReportAnswerCard.tsx` 移除 `StreamDSLContext` import 和包裹，移除 `useAppHostContext`、`getCurrentLocale`、`supportedLocaleToHostLocale`、`EXPAND_PANEL_DIV_ID`、`expandPanelStore`、`ExpandPanelContent` 等不再需要的 import。`ReportAnswerCard` 只保留 `<DSLEngine data={[content]} />`。
  验证：ReportAnswerCard 编译通过；不再 import StreamDSLContext；不再包裹 StreamDSLContext。
  满足：Requirement "报告 DSL 渲染与 StreamDSLContext"。

- [x] 6.3 更新 `ReportAnswerCard.test.tsx`，移除 StreamDSLContext mock 和相关断言，更新为验证 ReportAnswerCard 直接渲染 DSLEngine。
  验证：`npm test -- ReportAnswerCard.test` 通过。
  满足：Requirement "报告 DSL 渲染与 StreamDSLContext"。

## 7. init 方法调用

- [x] 7.1 在 `renderRoot.tsx` 中 `loadRuntimeConfig()` 之后、`root.render(node)` 之前调用 `init`，带模块级 flag 保证幂等。参数：`instanceId: "nextagent-dsl-instance"`、`expandPanelId: EXPAND_PANEL_DIV_ID`、`handleExpandPanel`（通过 expandPanelStore open/close）、`handleConversation: () => {}`。
  验证：renderRoot 编译通过；init 被调用一次；重复调用 renderRoot 时 init 只执行一次。
  满足：Requirement "DSL Engine init Call"。

## 8. 验证和审核

- [x] 8.1 运行 `npm run build`（后端 workspace）。
  验证：build 通过。
  满足：AGENTS.md 验证门禁。

- [x] 8.2 在 `frontend/agent-web` 运行 `npm run build` 和 `npm test`。
  验证：前端 build 和 test 通过。
  满足：AGENTS.md 验证门禁。

- [x] 8.3 运行 `openspec validate add-stream-dsl-message-type --strict`。
  验证：openspec strict 验证通过。
  满足：AGENTS.md OpenSpec 验证。

- [x] 8.4 运行 `$nextagent-code-review` 检视提交范围，确认架构边界、安全、Clean Code 无 P0/P1 问题。
  验证：检视结论 PASS。
  满足：AGENTS.md Push 门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，按 proposal/design 的归档前更新基线处理：
- `openspec/specs/tool-structured-delta/spec.md`：`Structured Event Shape Validation` 的 `messageType` 集合加入 `STREAM_DSL`。
- `openspec/specs/agent-web-structured-message-rendering/spec.md`：新增 STREAM_DSL 累积语义、渲染分发、`SimpleDslRenderer` 改名、genui-components 引入、init 调用 requirement。
- `openspec/specs/agent-web-bi-report-generation/spec.md`：`StreamDSLContext` 外层化、`ReportAnswerCard` 简化 requirement。