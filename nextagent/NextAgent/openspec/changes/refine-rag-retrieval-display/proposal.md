## Why

RAG 检索结果当前在后端 safe result 中只发送来源 basename 和 40/100 code point 的内容预览，用户在过程面板中无法查看完整内容。当运维用户需要根据检索到的知识片段判断故障处置方案时，被截断的预览无法提供足够的上下文。

本次变更将展示截断逻辑从前端 guard 后移至前端 render 层：后端 DETAIL 投影直接发送原始 `source` 和完整 `content`，前端负责按 `|` 分割来源取首段、512 字符展示截断、悬停显示完整内容、点击来源标签弹出 Markdown 弹窗。SUMMARY 继续只返回召回数量。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- RAG DETAIL safe result items 字段从 `{ displaySource, sourceMissing, contentPreview, contentTruncated }` 改为 `{ source, content }`，后端不再做来源 basename 截取和内容预览截断。
- 前端 guard 删除 RAG 专用的长度校验，仅保留 string 类型 fail-closed。
- 前端 projection 从 `source` 按 `|` 分割取首段作为 `displaySource`，保留完整 `content`。
- 前端 render 对 content 做 512 字符截断并追加 `...`，悬停 Tooltip 显示完整内容，点击来源标签弹出 Modal 以 Markdown 格式渲染完整 content。
- 删除后端 `projectRagDisplaySource`、`previewUnicodeCodePoints`、`resolveRagContentPreviewMaxCodePoints` 及 RAG 专用 code point 常量等 dead code。

**非目标：**

- 不改变 `resultListPreviewMaxItems = 50` 的 items 数量上限。
- 不改变 RAG SUMMARY 只返回召回数量的既有行为。
- 不新增 capability contract、Gateway 契约、事件类型或持久化 owner。
- 不改变其他 Capability（Bash、Python、ToolSearch、Cron、TodoWrite 等）的 safe result 字段。
- 不改变 `provenance`、`score`、`rankHint` 等字段的不可见约束。

## What Changes

- `ts-run-status-visibility` spec 中 `RAG 检索结果具有可展示的安全摘要` Requirement：DETAIL items 字段从 `{ displaySource, sourceMissing, contentPreview, contentTruncated }` 改为 `{ source, content }`；删除 contentPreview 截断规则和 "MUST NOT 包含完整 content" 约束；安全边界改为允许发送完整 `source` 和 `content`，由前端负责展示截断。
- `ts-run-status-visibility` spec 中 `RAG 过程详情以来源标签和单行预览呈现` Requirement：更新为来源标签可点击弹出弹窗、内容预览默认 512 字符截断、悬停显示完整内容、弹窗以 Markdown 格式渲染。
- 后端 `projectRagRetrievalSafeResult` 直接发送 `{ source, content }`，删除 `projectRagDisplaySource`、`previewUnicodeCodePoints`、`resolveRagContentPreviewMaxCodePoints`。
- 前端 `SafeRagRetrievalItem` 类型改为 `{ source, content }`，删除长度校验。
- 前端 `RagRetrievalDisplayItem` 改为 `{ displaySource, content }`，`displaySource` 由 `source.split('|')[0]` 派生。
- 前端 `RagRetrievalDetails` 组件新增 Tooltip + Modal + 点击交互。

## Feature 影响（Features）

### 修改的 Feature

- `F-2.4 查看请求状态`：用户可在 RAG 过程详情中点击来源标签查看完整检索内容，悬停查看完整内容预览，默认展示截断为 512 字符；Function 组成不变。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-2.4 查看请求状态` → `specs/ts-run-status-visibility/spec.md`
  - 功能边界：调整 RAG DETAIL safe result 字段集合和前端展示逻辑；不改变 runtime Capability 执行、模型上下文或三档呈现策略。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：`ts-run-status-visibility` 是 canonical spec；本次不触及其他 legacy spec。

## 影响范围（Impact）

- RAG DETAIL 的 safe result items 将包含完整 `source` 和 `content`，前端负责展示截断。
- `source` 字段可能包含路径分隔符或管道符，前端按 `|` 分割取首段展示。
- `content` 可能较长（由 RAG gateway schema 的 maxLength 约束），前端 512 字符截断 + Tooltip + Modal 负责用户友好展示。
- local、immersive、collaborative 三种宿主及 live/history 使用同一后端策略和同一前端 presenter。
- 受影响实现集中在 shared Capability 结果投影、前端 safe result reader、前端 process detail projection 和前端 ProcessPanel 组件。
