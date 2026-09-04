## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-2.4 查看请求状态` | RAG DETAIL safe result 改为发送原始 source 和完整 content，前端负责展示截断、悬停和弹窗 | `ts-run-status-visibility` | `FN-2.4 查看请求状态` |

## `FN-2.4 查看请求状态`

### 目标与规范依据

本设计让用户在 RAG 过程详情中查看更完整的检索内容。后端 DETAIL 投影发送按 `source → title → content 前 256 字符（截断时追加 `...`）` 兜底链派生的 `source` 和完整 `content`，前端负责所有展示逻辑：来源分割、来源标签 512 字符截断、悬停 Tooltip 显示完整来源标签、点击弹窗 Markdown 渲染完整 content。SUMMARY 继续只返回召回数量。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `MODIFIED`：`RAG 检索结果具有可展示的安全摘要`
- `MODIFIED`：`RAG 过程详情以来源标签和单行预览呈现`

### 与 active change 的关系

本 change 与 `refine-capability-result-card-presentation` 均修改 `RAG 检索结果具有可展示的安全摘要` Requirement。`refine-capability-result-card-presentation` 将 RAG 从 SUMMARY 改为 DETAIL 默认档位，并拆分 SUMMARY（只含计数）与 DETAIL（含来源预览）。本 change 在此基础上进一步将 DETAIL items 字段从 `{ displaySource, sourceMissing, contentPreview, contentTruncated }` 改为 `{ source, content }`，并将展示截断逻辑从后端 safe projection 后移至前端 render 层。

如果 `refine-capability-result-card-presentation` 先归档，本 change 的 delta 将正确应用于已更新的 canonical spec。如果本 change 先归档，`refine-capability-result-card-presentation` 的 RAG DETAIL 字段定义部分需要相应调整。design 建议先归档 `refine-capability-result-card-presentation`。

### 当前实现

1. `agent-channel-common` 的 `projectRagRetrievalSafeResult` 读取 `record.source` 和 `record.content`，调用 `projectRagDisplaySource`（按 `/` 分割取 basename）、`previewUnicodeCodePoints`（按 40/100 code point 截断），输出 `{ displaySource, sourceMissing, contentPreview, contentTruncated }`。
2. 前端 `readRagRetrievalItems` 做严格长度校验（displaySource ≤ 259 code point、contentPreview ≤ 40/100 code point），超限整批 reject。
3. 前端 `describeRagRetrievalSafeResult` 将 `sourceMissing=true` 的条目 displaySource 替换为 i18n 占位标签，`normalizeRagContentPreview` 做空白归一化。
4. 前端 `RagRetrievalDetails` 渲染来源标签和单行预览文本，`contentTruncated=true` 时追加 `...`。
5. `previewUnicodeCodePoints`、`projectRagDisplaySource`、`resolveRagContentPreviewMaxCodePoints` 及三个 RAG code point 常量仅在 `stream-envelope.ts` 中被 RAG 使用。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| DETAIL items 发送 { source, content } | items 发送 { displaySource, sourceMissing, contentPreview, contentTruncated } | 后端 projector 需改为直接输出 source 和 content |
| 前端 guard 不做长度校验 | guard 做 displaySource ≤ 259、contentPreview ≤ 40/100 长度校验 | 删除长度校验，仅保留 string 类型校验 |
| 前端按 `|` 分割 source 取首段 | 前端直接使用后端已截取的 displaySource | projection 层改为 `source.split('|')[0]` |
| 前端来源标签 512 字符截断 + Tooltip + Modal | 前端使用后端已截断的 contentPreview | render 层新增来源标签截断、Tooltip、Modal 逻辑 |
| 删除 dead code | previewUnicodeCodePoints 等函数仍在 | 随改动删除 |

### 修改方案

唯一实施路径是继续复用 "shared channel safe projection → Agent Web typed safe-result reader → process detail projection → ProcessPanel presenter" 的链路，只做以下增量：

1. **后端 projector**：`projectRagRetrievalSafeResult` 直接输出 `{ source, content }`，不再调用 `projectRagDisplaySource`、`previewUnicodeCodePoints`、`resolveRagContentPreviewMaxCodePoints`。删除这三个函数和三个 RAG code point 常量。保留 `resultListPreviewMaxItems = 50` 上限不变。`source` 按以下顺序派生（`extractRagSafeSource`）：原始结果 `source` 字段按 `|` 分割取首段并去除首尾空白；该段为空时回退原始结果 `title` 字段去除首尾空白；`title` 缺失或为空时回退原始结果 `content` 字段去除首尾空白后的文本——超过 256 个字符时截断为前 256 个字符并在末尾追加 `...`，不超过 256 个字符时使用完整文本（`ragSourceFallbackContentMaxChars = 256`，与 `cronProjectionInlineTextMaxChars`、`toolSearchIdentityMaxChars` 同级常量）；三者均缺失或为空时为空字符串。`content` 字段始终发送完整原始内容，不受 256 字符兜底截断影响。`provenance`、`score`、`rankHint`、诊断字段继续不发送。
2. **前端 guard**：`SafeRagRetrievalItem` 改为 `{ source, content }`，`readRagRetrievalItems` 仅校验 string 类型，删除所有长度校验和 `resolveRagContentPreviewMaxCodePoints`。删除三个 RAG code point 常量。
3. **前端 projection**：`RagRetrievalDisplayItem` 改为 `{ displaySource, content }`，`displaySource = source.split('|')[0]`（空则使用 i18n 占位标签），`content` 保留完整内容。`detail` 字符串用于可访问性 fallback，仍做空白归一化。
4. **前端 render**：新增常量 `RAG_SOURCE_DISPLAY_LIMIT = 512`。每个条目渲染为独立的可点击来源标签；来源标签超过 512 字符截断 + `...`，Tooltip 显示完整 `displaySource`，点击来源标签触发 Modal，Modal 内用 `MarkdownContent` 渲染完整 `content`；不渲染内联 `content` 预览。新增 CSS `.turn-process-rag-retrieval-source--clickable` 样式。
5. **dead code 清理**：`normalizeRagPreviewForDisplay` 如果不再被使用则删除；`normalizeRagContentPreview` 保留用于 `detail` 字符串的空白归一化。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `RAG 检索结果具有可展示的安全摘要` | 继续由 shared channel projector 唯一生成字段；`provenance`、`score`、`rankHint` 继续不发送；前端 raw/JSON fallback fail closed | DETAIL payload 无 `provenance`/`score`；SUMMARY 仍无 `safeResult`；unknown/invalid 不泄漏 |
| 可维护性 | 无新增黑盒质量目标 | 删除 RAG 专用截断函数和常量，简化 guard 校验链路 | backend kind 与 frontend reader 一一对应；无残留 dead code |
| 可测试性 | 无新增黑盒质量目标 | 后端 projector、前端 reader/projection、ProcessPanel 分别在现有测试层验证 | items shape、source 分割、来源标签 512 截断、Modal/Tooltip 交互、live/history fixture |

## 验证策略（Verification Strategy）

- **unit/contract**：验证 RAG DETAIL items shape 为 `{ source, content }`，source 为原始字符串（含 `|` 和路径分隔符），content 为完整内容；source→title→content 前 256 字符兜底链（含截断追加 `...` 与不截断不追加的边界）各级行为；`provenance`/`score` 不泄漏；SUMMARY 仍无 safeResult。
- **frontend unit**：验证 guard 读取 `source` 和 `content` 字段、类型校验 fail-closed；projection 按 `|` 分割取首段；render 来源标签 512 字符截断、Tooltip 和 Modal 交互。
- **integration/characterization**：复用 shared stream/history projection fixtures，验证 live 与 history 形成相同安全字段和显示结果。
- **negative case**：覆盖 `provenance`、`score`、`rankHint`、诊断字段不进入浏览器；非法 shape 继续 fail closed。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-run-status-visibility/spec.md`：更新 RAG DETAIL items 字段定义和安全边界。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.4-查看请求状态.md`：更新 RAG DETAIL 字段说明。
- `openspec/designs/features/D2-请求运行时/D2.2-请求状态与处理/F-2.4-查看请求状态.md`：提炼"可查看完整检索内容"的用户价值。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/stream-projection.md`：更新 RAG DETAIL 字段说明。
- `openspec/designs/modules/agent-channel-web.md`、`openspec/designs/modules/agent-web.md`：更新 shared projector 与 ProcessPanel 的长期说明。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：更新 `ts-run-status-visibility` 的 RAG DETAIL 字段说明。

## 风险与取舍（Risks / Trade-offs）

- 后端发送完整 `content` 会增加 SSE/历史重建的 payload 体积。通过保持 50 项 items 上限和前端来源标签 512 字符展示截断控制用户可见影响；后端 `content` 字段的原始长度仍由 RAG gateway schema 的 maxLength 约束。
- 后端发送原始 `source` 可能包含路径分隔符或管道符。前端按 `|` 分割取首段，与后端之前按 `/` 分割取 basename 的行为不同，但用户明确要求按 `|` 分割。
- 删除 `previewUnicodeCodePoints` 后，该函数在 `stream-envelope.ts` 中不再有其他调用方；确认后删除。

## 待确认问题（Open Questions）

无。`source` 字段为单数（gateway contract 已定义），`content` 完整发送由用户明确要求。`MarkdownContent` 组件（marked + xss）已存在，可直接用于 Modal 内 Markdown 渲染。
