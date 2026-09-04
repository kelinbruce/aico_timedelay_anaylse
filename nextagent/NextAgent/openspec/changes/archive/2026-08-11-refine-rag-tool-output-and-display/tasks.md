## 1. `FN-5.13 检索知识库`

- [x] 1.1 为 `ragOutputSchema` 与 `ragToolDefinition` 增加开放结果对象、`topK` 截断和既有提供方结果校验的行为测试。
  来源：`FN-5.13 + Result shape is safe and bounded + 提供方结果按既有字段投影、结果数量仍受检索请求约束`
  验证：先运行相关 RAG Tool 测试，确认新增断言在实现前失败；完成后运行相同测试，预期全部通过。

- [x] 1.2 将 `rag-schemas.ts` 的输出 schema 改为开放顶层、开放结果对象和开放诊断对象，并保持输入 schema 不变。
  来源：`FN-5.13 + Result shape is safe and bounded + 提供方返回扩展结果字段`
  验证：运行 RAG Tool schema 测试，预期扩展字段通过且输入约束回归通过。

- [x] 1.3 按附件迁移 `rag-tool.ts` 的提供方结果接收实现，并保留状态映射、`topK` 截断与既有结果校验行为。
  来源：`FN-5.13 + Result shape is safe and bounded + 结果数量仍受检索请求约束、提供方结果按既有字段投影`
  验证：运行相关 RAG Tool 测试，预期已接受结果字段成功返回、超量结果截断、无效结果返回既有失败映射。

## 2. `FN-1.1 查看会话消息流`

- [x] 2.1 为 RAG live projection、历史重建和过程详情增加数量、来源顺序、50 字符预览、截断标记、缺失来源标签与完整正文不泄漏的失败复现测试。
  来源：`FN-1.1 + RAG 检索结果具有可展示的安全摘要 + 成功检索展示数量和来源、长内容预览带截断标记、缺少来源的结果显示占位标签、历史重建与实时展示一致`
  验证：先运行 `frontend/agent-web` 的相关安全结果与过程详情测试，确认新增断言在实现前失败。

- [x] 2.2 在 channel 安全投影和 frontend 历史重建中生成同形 `ragRetrieval` 摘要，包含 `totalCount`、`displaySource`、`sourceMissing`、50 字符 `contentPreview` 与 `contentTruncated`。
  来源：`FN-1.1 + RAG 检索结果具有可展示的安全摘要 + 历史重建与实时展示一致`
  验证：运行 channel projection 与 `frontend/agent-web` 安全结果测试，预期实时和历史摘要深度相等，且不含检索正文。

- [x] 2.3 在过程面板添加 RAG 摘要展示和本地化文案，显示召回数量、来源名称或来源缺失标签及内容预览，并仅在 `contentTruncated=true` 时追加 `...`。
  来源：`FN-1.1 + RAG 检索结果具有可展示的安全摘要 + 成功检索展示数量和来源、缺少来源的结果显示占位标签`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/safeCapabilityResult.test.ts tests/processDetailsProjection.test.ts`，预期 RAG 结果不再渲染通用无摘要成功文案。

- [x] 2.4 将 RAG 来源呈现为独立标签，并将内容预览的连续空白归一化为单个空格。  来源：`RAG 过程详情以来源标签和单行预览呈现`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts src/features/chat/components/ProcessPanel.test.ts`，预期来源和预览分开呈现，预览不含换行。

- [x] 2.5 将 RAG 内容预览改为中文主导内容 40 个、英文主导内容 100 个 Unicode code point，并覆盖实时投影、历史重建和越界安全摘要拒绝。  来源：`FN-1.1 + RAG 检索结果具有可展示的安全摘要 + 中文主导内容按 40 字符截断、英文主导内容按 100 字符截断`
  验证：运行 channel 与 frontend RAG 投影测试，预期中文第 41 个字符和英文第 101 个字符均不进入预览。
- [x] 2.6 将 RAG Tool 的结果状态、结果数量桶和原因码投影到 capability completed observation，并新增 local RAG 索引构建与检索的低基数 runtime diagnostic。  来源：`FN-5.13 + RAG 检索具有低基数执行诊断`
  验证：运行 observability mapper 与 local RAG governance 测试，断言结果数量桶可见且日志不含 query、正文、source 或 provenance。

## 3. Change 整体验证

- [x] 3.1 执行 OpenSpec、RAG Tool、channel 和前端构建验证，并记录实际结果。
  来源：`design.md` 的“验证策略（Verification Strategy）”
  验证：运行 `openspec validate refine-rag-tool-output-and-display --strict`、`openspec validate --all --strict`、相关 RAG/channel 测试，以及在 `frontend/agent-web` 运行 `npm run build`；预期全部通过。

## 归档前更新基线检查（非实施任务）

归档流程按 `design.md` 的“长期基线刷新计划（Baseline Promotion Plan）”同步 stable spec、Function、Feature、architecture、module design 和 `spec-to-design-map`，并确认长期文档不重复定义输出 schema 或安全投影语义。
